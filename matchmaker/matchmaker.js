const functions = require("../structs/functions.js");
const { WebSocket } = require("ws");
const GameServers = require("../model/gameServers.js");

const PLAYLIST_MAP = {
    "2": "/Game/Athena/Playlists/Playlist_DefaultSolo.Playlist_DefaultSolo",
    "10": "/Game/Athena/Playlists/Playlist_DefaultDuo.Playlist_DefaultDuo",
    "9": "/Game/Athena/Playlists/Playlist_DefaultSquad.Playlist_DefaultSquad",
    "playlist_defaultsolo": "/Game/Athena/Playlists/Playlist_DefaultSolo.Playlist_DefaultSolo",
    "playlist_defaultduo": "/Game/Athena/Playlists/Playlist_DefaultDuo.Playlist_DefaultDuo",
    "playlist_defaultsquad": "/Game/Athena/Playlists/Playlist_DefaultSquad.Playlist_DefaultSquad",
    "playlist_solidgold_solo": "/Game/Athena/Playlists/Playlist_SolidGold_Solo.Playlist_SolidGold_Solo",
    "playlist_snipers_solo": "/Game/Athena/Playlists/Playlist_Snipers_Solo.Playlist_Snipers_Solo"
};

function resolvePlaylist(playlist) {
    return PLAYLIST_MAP[playlist] || playlist;
}

async function removeSearchingPlayer(playlist) {
    playlist = resolvePlaylist(playlist);
    try {
        const currentData = await global.kv.get("matchmaking:searching");
        if (!currentData) return;

        let data = JSON.parse(currentData);

        data.total = Math.max(0, (data.total || 0) - 1);
        data.playlists[playlist] = Math.max(0, (data.playlists[playlist] || 0) - 1);

        if (data.playlists[playlist] === 0) {
            delete data.playlists[playlist];
        }

        await global.kv.set("matchmaking:searching", JSON.stringify(data));
    } catch (error) {
        console.error("Error removing searching player:", error);
    }
}

async function addSearchingPlayer(playlist) {
    playlist = resolvePlaylist(playlist);
    try {
        const currentData = await global.kv.get("matchmaking:searching");
        let data = currentData ? JSON.parse(currentData) : { total: 0, playlists: {} };

        data.total = (data.total || 0) + 1;
        data.playlists[playlist] = (data.playlists[playlist] || 0) + 1;

        await global.kv.set("matchmaking:searching", JSON.stringify(data));
    } catch (error) {
        console.error("Error adding searching player:", error);
    }
}

class Matchmaker {
    static clients = 0;
    static serverCheckIntervals = new Map();

    async server(ws, req) {
        const ticketId = functions.MakeID();
        const matchId = functions.MakeID();
        const sessionId = functions.MakeID();

        let accountId = '';
        let playlist = '';
        let sessionToken = '';

        if (req.url) {
            const urlParams = new URLSearchParams(req.url.split('?')[1] || '');
            sessionToken = urlParams.get('session') || '';
        }

        if (sessionToken) {
            try {
                const sessionData = await global.kv.get(`matchmakingSession:${sessionToken}`);
                if (sessionData) {
                    const parsedData = JSON.parse(sessionData);
                    accountId = parsedData.accountId;
                    playlist = parsedData.playlist;
                    await global.kv.delete(`matchmakingSession:${sessionToken}`);
                }
            } catch {}
        }

        if (!accountId || !playlist) {
            const signature = req.url?.split('signature=')[1]?.split('&')[0];
            if (signature) {
                const decodedSignature = decodeURIComponent(signature);
                const parts = decodedSignature.split(' ');
                if (parts.length >= 2) {
                    accountId = parts[0];
                    playlist = parts[1];
                }
            }
        }

        playlist = resolvePlaylist(playlist);
        Matchmaker.clients++;

        if (accountId && playlist && playlist !== 'mms-player') {
            await this.startMatchmaking(ws, accountId, playlist, ticketId, matchId, sessionId);
        } else {
            await this.sendConnecting(ws);
            let attempts = 0;
            const maxAttempts = 5;

            const tryAgain = async () => {
                attempts++;
                if (attempts >= maxAttempts) {
                    if (!accountId) accountId = `temp_${ticketId}`;
                    if (!playlist || playlist === 'mms-player') playlist = 'Playlist_DefaultSolo';
                    playlist = resolvePlaylist(playlist);
                    await this.startMatchmaking(ws, accountId, playlist, ticketId, matchId, sessionId);
                } else {
                    setTimeout(tryAgain, 2000);
                }
            };

            setTimeout(tryAgain, 1000);
        }

        ws.on('message', async (message) => {
            const messageStr = message.toString();
            if (messageStr === 'ping') {
                ws.send('pong');
                return;
            }

            try {
                const data = JSON.parse(messageStr);
                if (data.accountId && !accountId) accountId = data.accountId;
                if (data.playlist && !playlist) playlist = resolvePlaylist(data.playlist);

                if (accountId && playlist && playlist !== 'mms-player' && !Matchmaker.serverCheckIntervals.has(`${accountId}_${ticketId}`)) {
                    await this.searchForServer(ws, accountId, playlist, ticketId, matchId, sessionId);
                }
            } catch {}
        });

        ws.on('close', () => {
            Matchmaker.clients--;
            const intervalKey = `${accountId}_${ticketId}`;
            const interval = Matchmaker.serverCheckIntervals.get(intervalKey);
            if (interval) {
                clearInterval(interval);
                Matchmaker.serverCheckIntervals.delete(intervalKey);
            }

            if (playlist && accountId) this.removeSearchingPlayerIfNeeded(accountId, playlist);
        });
    }

    async startMatchmaking(ws, accountId, playlist, ticketId, matchId, sessionId) {
        playlist = resolvePlaylist(playlist);
        await this.sendConnecting(ws);
        await this.sendWaiting(ws, Matchmaker.clients);
        await this.sendQueued(ws, ticketId, Matchmaker.clients);

        let customKeyServer = null;
        if (accountId) {
            try {
                const customKeyData = await global.kv.get(`playerCustomKey:${accountId}`);
                if (customKeyData) customKeyServer = JSON.parse(customKeyData);
            } catch {}
        }

        if (customKeyServer) {
            await this.proceedToJoin(ws, matchId, sessionId, accountId, customKeyServer, playlist);
        } else {
            await this.searchForServer(ws, accountId, playlist, ticketId, matchId, sessionId);
        }
    }

    async searchForServer(ws, accountId, playlist, ticketId, matchId, sessionId) {
        playlist = resolvePlaylist(playlist);
        const intervalKey = `${accountId}_${ticketId}`;

        if (!playlist) {
            ws.send(JSON.stringify({ payload: { state: "Error", message: "No playlist specified" }, name: "StatusUpdate" }));
            return;
        }

        const checkForServer = async () => {
            try {
                const server = await this.findAvailableServer(playlist);
                if (server) {
                    const interval = Matchmaker.serverCheckIntervals.get(intervalKey);
                    if (interval) {
                        clearInterval(interval);
                        Matchmaker.serverCheckIntervals.delete(intervalKey);
                    }
                    const serverData = { ip: server.ip, port: server.port.toString(), playlist: server.playlist };
                    if (accountId) await global.kv.set(`playerServer:${accountId}`, JSON.stringify(serverData));
                    await this.proceedToJoin(ws, matchId, sessionId, accountId, serverData, playlist);
                } else {
                    await this.addSearchingPlayerIfNeeded(accountId, playlist);
                    await this.sendQueued(ws, ticketId, Matchmaker.clients);
                }
            } catch {
                await this.sendQueued(ws, ticketId, Matchmaker.clients);
            }
        };

        await checkForServer();
        if (!Matchmaker.serverCheckIntervals.has(intervalKey)) {
            const searchInterval = setInterval(checkForServer, 1000);
            Matchmaker.serverCheckIntervals.set(intervalKey, searchInterval);
        }
    }

    async proceedToJoin(ws, matchId, sessionId, accountId, serverData, playlist) {
        if (playlist && accountId) {
            playlist = resolvePlaylist(playlist);
            await this.removeSearchingPlayerIfNeeded(accountId, playlist);
        }

        await this.sendSessionAssignment(ws, matchId);
        setTimeout(async () => {
            await this.sendJoin(ws, matchId, sessionId);
        }, 1000);
    }

    async findAvailableServer(playlist) {
        playlist = resolvePlaylist(playlist);
        try {
            const allServers = await GameServers.find({ playlist });
            const now = Date.now();
            const fiveMinAgo = new Date(now - 5 * 60 * 1000);
            const tenMinAgo = new Date(now - 10 * 60 * 1000);

            const availableServers = allServers.filter(server => {
                if (server.status !== 'online') return false;
                if (!server.joinable) return false;
                if (!server.lastHeartbeat || server.lastHeartbeat < fiveMinAgo) return false;
                if (!server.lastJoinabilityUpdate || server.lastJoinabilityUpdate < tenMinAgo) return false;
                return true;
            });

            if (!availableServers.length) return null;
            return availableServers[Math.floor(Math.random() * availableServers.length)];
        } catch {
            return null;
        }
    }

    async sendConnecting(ws) {
        ws.send(JSON.stringify({ payload: { state: "Connecting" }, name: "StatusUpdate" }));
    }

    async sendWaiting(ws, players) {
        ws.send(JSON.stringify({ payload: { totalPlayers: players, connectedPlayers: players, state: "Waiting" }, name: "StatusUpdate" }));
    }

    async sendQueued(ws, ticketId, players) {
        ws.send(JSON.stringify({
            payload: { ticketId, queuedPlayers: players, estimatedWaitSec: Math.min(30, players * 3), status: {}, state: "Queued" },
            name: "StatusUpdate"
        }));
    }

    async sendSessionAssignment(ws, matchId) {
        ws.send(JSON.stringify({ payload: { matchId, state: "SessionAssignment" }, name: "StatusUpdate" }));
    }

    async sendJoin(ws, matchId, sessionId) {
        ws.send(JSON.stringify({ payload: { matchId, sessionId, joinDelaySec: 1 }, name: "Play" }));
    }

    async addSearchingPlayerIfNeeded(accountId, playlist) {
        playlist = resolvePlaylist(playlist);
        try {
            const playerKey = `playerInSearchCounter:${accountId}`;
            const alreadyCounted = await global.kv.get(playerKey);
            if (!alreadyCounted) {
                await addSearchingPlayer(playlist);
                await global.kv.set(playerKey, "true");
            }
        } catch (error) {
            console.error("Error in addSearchingPlayerIfNeeded:", error);
        }
    }

    async removeSearchingPlayerIfNeeded(accountId, playlist) {
        playlist = resolvePlaylist(playlist);
        try {
            const playerKey = `playerInSearchCounter:${accountId}`;
            const wasCounted = await global.kv.get(playerKey);
            if (wasCounted) {
                await removeSearchingPlayer(playlist);
                await global.kv.delete(playerKey);
            }
        } catch (error) {
            console.error("Error in removeSearchingPlayerIfNeeded:", error);
        }
    }
}

module.exports = new Matchmaker();