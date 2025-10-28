const GameServers = require("../model/gameServers.js");
const axios = require("axios");
const express = require("express");
const app = express.Router();
const functions = require("../structs/functions.js");
const MMCode = require("../model/mmcodes.js");
const { verifyToken } = require("../tokenManager/tokenVerify.js");
const qs = require("qs");
const error = require("../structs/error.js");
const log = require("../structs/log.js");
const config = require("../Config/config.json");

let buildUniqueId = {};

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

async function removeSearchingPlayer(playlist) {
    playlist = resolvePlaylist(playlist);
    try {
        const currentData = await global.kv.get("matchmaking:searching");
        if (!currentData) return;
        let data = JSON.parse(currentData);
        data.total = Math.max(0, (data.total || 0) - 1);
        data.playlists[playlist] = Math.max(0, (data.playlists[playlist] || 0) - 1);
        if (data.playlists[playlist] === 0) delete data.playlists[playlist];
        await global.kv.set("matchmaking:searching", JSON.stringify(data));
    } catch (error) {
        console.error("Error removing searching player:", error);
    }
}

async function findAvailableServer(playlist) {
    playlist = resolvePlaylist(playlist);
    try {
        const allServers = await GameServers.find({ playlist: playlist });
        const now = Date.now();
        const fiveMinAgo = new Date(now - 5 * 60 * 1000);
        const tenMinAgo = new Date(now - 10 * 60 * 1000);

        const availableServers = allServers.filter(server => 
            server.status === 'online' &&
            server.joinable &&
            server.lastHeartbeat && server.lastHeartbeat >= fiveMinAgo &&
            server.lastJoinabilityUpdate && server.lastJoinabilityUpdate >= tenMinAgo
        );

        if (!availableServers.length) return null;
        return availableServers[Math.floor(Math.random() * availableServers.length)];
    } catch {
        return null;
    }
}

app.get("/fortnite/api/matchmaking/session/findPlayer/*", (req, res) => res.status(200).end());

app.get("/fortnite/api/game/v2/matchmakingservice/ticket/player/*", verifyToken, async (req, res) => {
    const query = qs.parse(req.url.split("?")[1], { ignoreQueryPrefix: true });
    const playerCustomKey = query['player.option.customKey'];
    const decodedBucketId = decodeURIComponent(query['bucketId']);

    if (typeof decodedBucketId !== "string" || decodedBucketId.split(":").length !== 4) {
        log.log("[Debug] Invalid bucketId format:", decodedBucketId);
        return res.status(400).end();
    }

    const rawPlaylist = decodedBucketId.split(":")[3];
    const playlist = resolvePlaylist(rawPlaylist);
    if (!playlist || playlist.trim() === '') {
        return error.createError(
            "errors.com.epicgames.common.matchmaking.playlist.not_found",
            `Invalid playlist ID: ${playlist}`,
            [], 1013, "invalid_playlist", 404, res
        );
    }

    await global.kv.set(`playerPlaylist:${req.user.accountId}`, playlist);
    await global.kv.set(`playerMatchmaking:${req.user.accountId}`, JSON.stringify({
        status: 'searching',
        playlist: playlist,
        startedAt: Date.now()
    }));

    if (typeof playerCustomKey === "string") {
        let codeDocument = await MMCode.findOne({ code_lower: playerCustomKey.toLowerCase() });
        if (!codeDocument) {
            return error.createError(
                "errors.com.epicgames.common.matchmaking.code.not_found",
                `The matchmaking code "${playerCustomKey}" was not found`,
                [], 1013, "invalid_code", 404, res
            );
        }

        const kvDocument = JSON.stringify({
            ip: codeDocument.ip,
            port: codeDocument.port,
            playlist: playlist,
        });

        await global.kv.set(`playerCustomKey:${req.user.accountId}`, kvDocument);
        await global.kv.set(`playerMatchmaking:${req.user.accountId}`, JSON.stringify({
            status: 'found',
            playlist: playlist,
            server: kvDocument
        }));
    }

    buildUniqueId[req.user.accountId] = decodedBucketId.split(":")[0];

    const matchmakerIP = config.matchmakerIP;


    let cleanMatchmakerIP = String(matchmakerIP).trim().replace(/\/+$/, '');
    let wsUrl = cleanMatchmakerIP.startsWith('ws://') || cleanMatchmakerIP.startsWith('wss://')
        ? cleanMatchmakerIP
        : `ws://${cleanMatchmakerIP}`;

    const sessionToken = functions.MakeID();
    await global.kv.set(`matchmakingSession:${sessionToken}`, JSON.stringify({
        accountId: req.user.accountId,
        playlist: playlist,
        timestamp: Date.now()
    }));

    const queryParams = new URLSearchParams({
        session: sessionToken,
        playlistId: playlist,
        region: 'EU',
        accountId: req.user.accountId,
        matchmakingId: req.user.matchmakingId
    });

    wsUrl += `?${queryParams.toString()}`;

    try {
        const urlTest = new URL(wsUrl);
        if (!urlTest.searchParams.get('playlistId')) throw new Error('PlaylistId missing from URL');
    } catch (urlError) {
        console.error("[Error] Invalid WebSocket URL generated:", wsUrl, urlError);
        return res.status(500).json({ error: "Invalid matchmaker URL configuration" });
    }

    return res.json({
        "serviceUrl": wsUrl,
        "ticketType": "mms-player",
        "payload": "account",
        "signature": `${req.user.matchmakingId} ${playlist}`,
        "playlistId": playlist
    });
});

app.get("/fortnite/api/game/v2/matchmaking/account/:accountId/session/:sessionId", (req, res) => {
    res.json({
        "accountId": req.params.accountId,
        "sessionId": req.params.sessionId,
        "key": "none"
    });
});

app.get("/fortnite/api/matchmaking/session/:sessionId", verifyToken, async (req, res) => {
    const playlist = resolvePlaylist(await global.kv.get(`playerPlaylist:${req.user.accountId}`));
    let kvDocument = await global.kv.get(`playerCustomKey:${req.user.accountId}`) || await global.kv.get(`playerServer:${req.user.accountId}`);
    
    if (!kvDocument) {
        const dynamicServer = await findAvailableServer(playlist);
        if (dynamicServer) kvDocument = JSON.stringify({
            ip: dynamicServer.ip,
            port: dynamicServer.port,
            playlist: dynamicServer.playlist
        });
        else return error.createError(
            "errors.com.epicgames.common.matchmaking.no.dynamic.server.found",
            `No dynamic server found for playlist ${playlist}`,
            [], 1013, "invalid_playlist", 404, res
        );
    }

    let codeKV = JSON.parse(kvDocument);
    res.json({
        "id": req.params.sessionId,
        "ownerId": functions.MakeID().replace(/-/ig, "").toUpperCase(),
        "ownerName": "[DS]fortnite-liveeugcec1c2e30ubrcore0a-z8hj-1968",
        "serverName": "[DS]fortnite-liveeugcec1c2e30ubrcore0a-z8hj-1968",
        "serverAddress": codeKV.ip,
        "serverPort": parseInt(codeKV.port),
        "maxPublicPlayers": 220,
        "openPublicPlayers": 175,
        "maxPrivatePlayers": 0,
        "openPrivatePlayers": 0,
        "attributes": {
            "REGION_s": "EU",
            "GAMEMODE_s": "FORTATHENA",
            "ALLOWBROADCASTING_b": true,
            "SUBREGION_s": "GB",
            "DCID_s": "FORTNITE-LIVEEUGCEC1C2E30UBRCORE0A-14840880",
            "tenant_s": "Fortnite",
            "MATCHMAKINGPOOL_s": "Any",
            "STORMSHIELDDEFENSETYPE_i": 0,
            "HOTFIXVERSION_i": 0,
            "PLAYLISTNAME_s": codeKV.playlist,
            "SESSIONKEY_s": functions.MakeID().replace(/-/ig, "").toUpperCase(),
            "TENANT_s": "Fortnite",
            "BEACONPORT_i": 15009
        },
        "publicPlayers": [],
        "privatePlayers": [],
        "totalPlayers": 45,
        "allowJoinInProgress": false,
        "shouldAdvertise": false,
        "isDedicated": false,
        "usesStats": false,
        "allowInvites": false,
        "usesPresence": false,
        "allowJoinViaPresence": true,
        "allowJoinViaPresenceFriendsOnly": false,
        "buildUniqueId": buildUniqueId[req.user.accountId] || "0",
        "lastUpdated": new Date().toISOString(),
        "started": false
    });
});

app.post("/fortnite/api/matchmaking/session/*/join", (req, res) => res.status(204).end());
app.post("/fortnite/api/matchmaking/session/matchMakingRequest", (req, res) => res.json([]));

setInterval(async () => {
    try {
        const cutoffTime = new Date(Date.now() - 10 * 60 * 1000);
        await GameServers.updateMany(
            { lastHeartbeat: { $lt: cutoffTime }, status: 'online' },
            { status: 'offline' }
        );
    } catch {}
}, 5 * 60 * 1000);

module.exports = app;
