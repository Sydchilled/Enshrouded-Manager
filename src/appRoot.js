// Where to put writable data (SteamCMD, the game install, backups, our own
// settings). When running from source with `node server.js`, that's simply
// the project folder. When running as a pkg-built .exe, __dirname points
// inside pkg's read-only virtual snapshot filesystem, not the real folder
// the .exe lives in — writable data has to go next to the actual .exe
// instead, which is process.execPath's directory in that case.
const path = require('path');

const appRoot = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');

module.exports = { appRoot };
