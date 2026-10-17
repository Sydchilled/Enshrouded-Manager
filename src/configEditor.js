const fs = require('fs');
const path = require('path');
const { defaultConfig } = require('./configSchema');

function configPath(settings) {
  return path.join(settings.installDir, 'enshrouded_server.json');
}

function configExists(settings) {
  return fs.existsSync(configPath(settings));
}

/**
 * Returns { exists, config }. If the real config hasn't been generated yet
 * (server never run), `config` is a template the UI can still edit and
 * save — writing it ourselves is the workaround for the fact that
 * enshrouded_server.exe only creates the file after first launch, and
 * there's no command-line flag to pre-seed it.
 */
function readConfig(settings) {
  const p = configPath(settings);
  if (!fs.existsSync(p)) {
    return { exists: false, path: p, config: defaultConfig() };
  }
  const raw = fs.readFileSync(p, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`enshrouded_server.json exists but is not valid JSON: ${err.message}`);
  }
  return { exists: true, path: p, config: parsed };
}

function writeConfig(settings, configObject) {
  const p = configPath(settings);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Keep a one-shot backup of whatever was there before we overwrite it.
  if (fs.existsSync(p)) {
    const backupPath = p + '.bak';
    fs.copyFileSync(p, backupPath);
  }
  fs.writeFileSync(p, JSON.stringify(configObject, null, 2));
  return { path: p };
}

module.exports = {
  configPath,
  configExists,
  readConfig,
  writeConfig
};
