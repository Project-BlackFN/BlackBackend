const fs = require("fs");
const config = JSON.parse(fs.readFileSync("./Config/config.json").toString());

function getTimestamp() {
    const now = new Date();
    const date = now.toLocaleDateString('en-US');
    const time = now.toLocaleTimeString();
    
    return `${date} ${time}`; 
}

function formatLog(prefixColor, prefix, ...args) {
    let msg = args.join(" ");
    let formattedMessage = `${prefixColor}[${getTimestamp()}] ${prefix}\x1b[0m: \x1b[37m${msg}\x1b[0m`;
    console.log(formattedMessage);
}

function backend(...args) {
    formatLog("\x1b[96m", "BACKEND |", ...args);
}

function bot(...args) {
    formatLog("\x1b[33m", "DISCORD BOT |", ...args);
}

function xmpp(...args) {
    formatLog("\x1b[34m", "XMPP |", ...args);
}

function error(...args) {
    formatLog("\x1b[31m", "ERROR |", ...args);
}

function debug(...args) {
    formatLog("\x1b[34m", "DEBUG |", ...args);
}

function calderaservice(...args) {
    formatLog("\x1b[33m", "CALDERA SERVICE |", ...args);
}

module.exports = {
    backend,
    bot,
    xmpp,
    error,
    debug,
    calderaservice
};