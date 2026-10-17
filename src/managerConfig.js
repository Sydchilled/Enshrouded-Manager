// Manager's own settings — where things live on disk, separate from the
// game server's own enshrouded_server.json (see configEditor.js).
const fs = require('fs');
const path = require('path');
const { appRoot } = require('./appRoot');

const PROJECT_ROOT = appRoot;
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'manager-settings.json');

// Everything lives in a folder next to the app itself by default, rather
// than under C:\ directly. A plain (non-admin) Windows account often can't
// create new folders at the drive root — that silent permission failure is
// a real candidate for "it just doesn't start" reports — but can always
// write next to wherever they unzipped this project.
const GAMEDATA_ROOT = path.join(PROJECT_ROOT, 'EnshroudedServer');

const DEFAULTS = {
  // Root folder where enshrouded_server.exe lives (SteamCMD force_install_dir).
  installDir: path.join(GAMEDATA_ROOT, 'server'),
  // Where steamcmd.exe lives / gets installed to. Kept separate from
  // installDir on purpose — running steamcmd.exe from inside the game's own
  // install folder is a documented cause of SteamCMD nesting the game under
  // steamapps\\common instead of honoring force_install_dir.
  steamCmdDir: path.join(GAMEDATA_ROOT, 'steamcmd'),
  steamAppId: '2278520',
  // Backups
  backupDir: path.join(GAMEDATA_ROOT, 'backups'),
  backupIntervalMinutes: 60,
  backupRetentionCount: 10,
  backupsEnabled: false,
  // Manager's own captured console log (separate from the game's own
  // logDirectory, which only appears once the server has actually run).
  managerLogDir: path.join(DATA_DIR, 'console-logs'),
  // Networking for the panel itself
  panelPort: 8790
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadSettings() {
  ensureDataDir();
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULTS, null, 2));
    return { ...DEFAULTS };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return { ...DEFAULTS, ...raw };
  } catch (err) {
    console.error('manager-settings.json was unreadable, resetting to defaults:', err.message);
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULTS, null, 2));
    return { ...DEFAULTS };
  }
}

function saveSettings(partial) {
  const current = loadSettings();
  const merged = { ...current, ...partial };
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2));
  return merged;
}

function getServerExePath(settings) {
  return path.join(settings.installDir, 'enshrouded_server.exe');
}

function getConfigJsonPath(settings) {
  return path.join(settings.installDir, 'enshrouded_server.json');
}

module.exports = {
  DEFAULTS,
  loadSettings,
  saveSettings,
  getServerExePath,
  getConfigJsonPath
};
