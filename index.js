const express = require("express");
const mongoose = require("mongoose");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const path = require("path");
const kv = require("./structs/kv.js");
const config = JSON.parse(fs.readFileSync("./Config/config.json").toString());
const WebSocket = require('ws');
const https = require("https");

const log = require("./structs/log.js");
const error = require("./structs/error.js");
const functions = require("./structs/functions.js");
const { migrateUsers } = require("./BetterReload/MigrationService.js");

const app = express();

if (!fs.existsSync("./ClientSettings")) fs.mkdirSync("./ClientSettings");

global.JWT_SECRET = functions.MakeID();
const PORT = config.port;

let httpsServer;

const sslDir = path.resolve(__dirname, "ssl");
const certPath = path.join(sslDir, "fullchain.pem");
const keyPath = path.join(sslDir, "privkey.pem");

let useHTTPS = false;
let httpsOptions;

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    httpsOptions = {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath)
    };
    useHTTPS = true;
    httpsServer = https.createServer(httpsOptions, app);
}


const tokens = JSON.parse(fs.readFileSync("./tokenManager/tokens.json").toString());

for (let tokenType in tokens) {
    for (let tokenIndex in tokens[tokenType]) {
        let decodedToken = jwt.decode(tokens[tokenType][tokenIndex].token.replace("eg1~", ""));
        if (DateAddHours(new Date(decodedToken.creation_date), decodedToken.hours_expire).getTime() <= new Date().getTime()) {
            tokens[tokenType].splice(Number(tokenIndex), 1);
        }
    }
}

fs.writeFileSync("./tokenManager/tokens.json", JSON.stringify(tokens, null, 2));

global.accessTokens = tokens.accessTokens;
global.refreshTokens = tokens.refreshTokens;
global.clientTokens = tokens.clientTokens;
global.kv = kv;
global.exchangeCodes = [];

let updateFound = false;
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "./package.json")).toString());
if (!packageJson) throw new Error("Failed to parse package.json");
const version = packageJson.version;

mongoose.set('strictQuery', true);
mongoose.connect(config.mongodb.database, () => {
    log.backend("App successfully connected to MongoDB!");
    migrateUsers();
});
mongoose.connection.on("error", err => {
    log.error("MongoDB failed to connect, please make sure you have MongoDB installed and running.");
    throw err;
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

fs.readdirSync("./routes").forEach(fileName => {
    try { app.use(require(`./routes/${fileName}`)); } 
    catch (err) { log.error(`Load Error: ${fileName}`); }
});

fs.readdirSync("./BetterReload").forEach(fileName => {
    if (fileName === "MigrationService.js") return; // Skip
    try { 
        app.use(require(`./BetterReload/${fileName}`)); 
    } 
    catch (err) { 
        log.error(`Load Error: ${fileName}\n${err.stack}`); 
    }
});

app.get("/unknown", (req, res) => {
    log.debug('GET /unknown endpoint called');
    res.status(200).send('OK');
});

let server;
if (useHTTPS) {
    server = httpsServer.listen(PORT, () => {
        log.backend(`Backend started on Port: ${PORT}`);
        require("./xmpp/xmpp.js");
        require("./DiscordBot");
    }).on("error", async (err) => {
        if (err.code === "EADDRINUSE") {
            log.error(`Port ${PORT} is already in use!.`);
            await functions.sleep(3000);
            process.exit(0);
        } else throw err;
    });
} else {
    server = app.listen(PORT, () => {
        log.backend(`Backend started on Port: ${PORT} (no SSL)`);
        require("./xmpp/xmpp.js");
        require("./DiscordBot");
    }).on("error", async (err) => {
        if (err.code === "EADDRINUSE") {
            log.error(`Port ${PORT} is already in use!`);
            await functions.sleep(3000);
            process.exit(0);
        } else throw err;
    });
}

if (config.bEnableCalderaService) {
    const createCalderaService = require('./CalderaService/calderaservice');
    const calderaService = createCalderaService();

    if (!config.bGameVersion) {
        log.calderaservice("Please define a version in the config!");
    } else {
        if (useHTTPS) {
            const calderaHttpsServer = https.createServer(httpsOptions, calderaService);
            calderaHttpsServer.listen(config.bCalderaServicePort, () => {
                log.calderaservice(`Caldera Service started listening on port ${config.bCalderaServicePort} (SSL Enabled)`);
            }).on("error", async (err) => {
                if (err.code === "EADDRINUSE") {
                    log.calderaservice(`Caldera Service port ${config.bCalderaServicePort} is already in use!\nClosing in 3 seconds...`);
                    await functions.sleep(3000);
                    process.exit(1);
                } else throw err;
            });
        } else {
            calderaService.listen(config.bCalderaServicePort, () => {
                log.calderaservice(`Caldera Service started listening on port ${config.bCalderaServicePort} (SSL Disabled)`);
            }).on("error", async (err) => {
                if (err.code === "EADDRINUSE") {
                    log.calderaservice(`Caldera Service port ${config.bCalderaServicePort} is already in use!\nClosing in 3 seconds...`);
                    await functions.sleep(3000);
                    process.exit(1);
                } else throw err;
            });
        }
    }
}

app.use((req, res, next) => {
    const url = req.originalUrl;
    log.debug(`Missing endpoint: ${req.method} ${url} request port ${req.socket.localPort}`);
    if (req.url.includes("..")) return;
    error.createError(
        "errors.com.epicgames.common.not_found",
        "Sorry the resource you were trying to find could not be found",
        undefined, 1004, undefined, 404, res
    );
});

function DateAddHours(pdate, number) {
    let date = pdate;
    date.setHours(date.getHours() + number);
    return date;
}

module.exports = app;
