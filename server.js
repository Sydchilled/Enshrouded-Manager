const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const managerConfig = require('./src/managerConfig');
const steamcmd = require('./src/steamcmd');
const processManager = require('./src/processManager');
const configEditor = require('./src/configEditor');
const configSchema = require('./src/configSchema');
const backup = require('./src/backup');
const logs = require('./src/logs');
const quickstart = require('./src/quickstart');
const batImport = require('./src/batImport');
const serverQuery = require('./src/serverQuery');
const { browseForFolder } = require('./src/browseFolder');
const { appRoot } = require('./src/appRoot');

// When launched fully hidden (via the .vbs wrapper, no console window at
// all), there's nowhere to read startup errors. The .vbs wrapper itself
// redirects this process's stdout/stderr straight to data\manager.log at
// the shell level — that covers everything, including a crash before this
// line even runs — so plain console.log/console.error is all this file
// needs; nothing extra to wire up here.

function openBrowser(url) {
  const { exec } = require('child_process');
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : `xdg-open "${url}" || open "${url}"`;
  exec(cmd, () => {});
}

const app = express();
app.use(express.json());

// When packaged with pkg into a single .exe, public/ isn't a real folder on
// disk any more (it's inside the read-only snapshot), and pkg's own asset
// system crashes this Node version at startup (see
// scripts/generate-embedded-public.js for details) — so the packaged build
// serves public/ from a generated, require()'d module instead. Running from
// source (npm start / node server.js) keeps using express.static straight
// off disk, so day-to-day development never needs a build step.
if (process.pkg) {
  const embeddedPublic = require('./src/embeddedPublic');
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const reqPath = req.path === '/' ? '/index.html' : req.path;
    const asset = embeddedPublic[reqPath];
    if (!asset) return next();
    res.set('Content-Type', asset.mime);
    res.send(Buffer.from(asset.base64, 'base64'));
  });
} else {
  app.use(express.static(path.join(__dirname, 'public')));
}

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

function broadcast(channel, message) {
  const payload = JSON.stringify({ channel, message, ts: Date.now() });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

processManager.onOutput((line) => broadcast('console', line));

wss.on('connection', (ws) => {
  // Replay recent console history so a newly-opened tab isn't blank.
  processManager.getRecentLines(300).forEach((line) => {
    ws.send(JSON.stringify({ channel: 'console', message: line, ts: Date.now() }));
  });
  ws.send(JSON.stringify({ channel: 'status', message: processManager.getStatus(), ts: Date.now() }));
});

// Push a status heartbeat every few seconds so the dashboard stays in sync
// even if it missed the exit event (e.g. panel restarted).
setInterval(() => {
  broadcast('status', processManager.getStatus());
}, 3000);

function getSaveDirFromDisk(settings) {
  try {
    const { config } = configEditor.readConfig(settings);
    return config.saveDirectory || './savegame';
  } catch (_) {
    return './savegame';
  }
}

function getLogDirFromDisk(settings) {
  try {
    const { config } = configEditor.readConfig(settings);
    return config.logDirectory || './logs';
  } catch (_) {
    return './logs';
  }
}

// ---------- manager settings ----------

app.get('/api/settings', (req, res) => {
  res.json(managerConfig.loadSettings());
});

app.post('/api/settings', (req, res) => {
  const saved = managerConfig.saveSettings(req.body || {});
  // Re-apply the backup schedule in case the interval/enabled flag changed.
  backup.startSchedule(managerConfig.loadSettings, () => getSaveDirFromDisk(saved), (msg) => broadcast('backup', msg));
  res.json(saved);
});

// ---------- steamcmd / install ----------

app.get('/api/steamcmd/status', (req, res) => {
  const settings = managerConfig.loadSettings();
  res.json({
    steamCmdInstalled: steamcmd.isSteamCmdInstalled(settings.steamCmdDir),
    serverExeInstalled: fs.existsSync(managerConfig.getServerExePath(settings))
  });
});

app.post('/api/steamcmd/install', async (req, res) => {
  const settings = managerConfig.loadSettings();
  try {
    await steamcmd.installSteamCmd(settings.steamCmdDir, (line) => broadcast('steamcmd', line));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/steamcmd/update', async (req, res) => {
  const settings = managerConfig.loadSettings();
  try {
    const code = await steamcmd.runAppUpdate(
      { steamCmdDir: settings.steamCmdDir, installDir: settings.installDir, appId: settings.steamAppId },
      (line) => broadcast('steamcmd', line)
    );
    res.json({ ok: code === 0, exitCode: code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- native "Browse for folder" dialog ----------

app.post('/api/setup/browse-folder', async (req, res) => {
  try {
    const initialDir = (req.body && req.body.initialDir) || '';
    const selected = await browseForFolder(initialDir);
    res.json({ path: selected }); // null means the dialog was cancelled
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- import an existing bare-bones install from an old .bat file ----------

app.post('/api/setup/import-existing', (req, res) => {
  const installDir = ((req.body && req.body.installDir) || '').trim();
  if (!installDir) {
    return res.status(400).json({ ok: false, message: 'Enter or detect an install directory first.' });
  }

  const exePath = path.join(installDir, 'enshrouded_server.exe');
  const exeFound = fs.existsSync(exePath);

  if (!exeFound) {
    return res.json({
      ok: false,
      installDir,
      exeFound: false,
      configFound: false,
      configSummary: null,
      message: `Import failed — enshrouded_server.exe wasn't found in "${installDir}". Nothing was changed ` +
        '— double-check the folder (drive letter included) and try again.'
    });
  }

  // Confirmed real — safe to adopt this as the install directory from here on.
  const beforeSettings = managerConfig.loadSettings();

  // Bonus: if this install sits under the stock SteamCMD "steamapps\common\<App>"
  // layout, its steamcmd.exe conventionally lives right there too — a
  // separate thing from installDir that a plain .bat file never reveals at
  // all (it only ever launches the game exe, never steamcmd itself). Only
  // adopt the guess if the currently-configured SteamCMD folder doesn't
  // already have a real steamcmd.exe in it, so a deliberate existing setup
  // is never silently overridden.
  let steamCmdDirLinked = null;
  if (!steamcmd.isSteamCmdInstalled(beforeSettings.steamCmdDir)) {
    const guess = steamcmd.guessSteamCmdDirFromInstallDir(installDir);
    if (guess && steamcmd.isSteamCmdInstalled(guess)) {
      steamCmdDirLinked = guess;
    }
  }

  const settingsPatch = { installDir };
  if (steamCmdDirLinked) settingsPatch.steamCmdDir = steamCmdDirLinked;
  const saved = managerConfig.saveSettings(settingsPatch);
  backup.startSchedule(managerConfig.loadSettings, () => getSaveDirFromDisk(saved), (msg) => broadcast('backup', msg));

  let configFound = false;
  let configSummary = null;
  let configWarning = null;
  try {
    const { exists, config } = configEditor.readConfig(saved);
    configFound = exists;
    if (exists) {
      configSummary = {
        name: config.name,
        ip: config.ip,
        queryPort: config.queryPort,
        slotCount: config.slotCount,
        saveDirectory: config.saveDirectory,
        gameSettingsPreset: config.gameSettingsPreset
      };
    }
  } catch (err) {
    configWarning = err.message;
  }

  broadcast('setup', `Imported existing install from ${installDir}`);
  if (steamCmdDirLinked) broadcast('setup', `Also linked existing SteamCMD folder: ${steamCmdDirLinked}`);

  let message = configFound
    ? `Import successful — found your existing server and its settings ("${configSummary.name}").`
    : configWarning
      ? `Import partly successful — found enshrouded_server.exe, but enshrouded_server.json couldn't be read: ${configWarning}`
      : "Import successful — found enshrouded_server.exe. This install has never been run yet, so there's " +
        "no enshrouded_server.json to load (that's expected — it'll appear the first time you press Start " +
        'or run Quick Setup).';
  if (steamCmdDirLinked) {
    message += ` Also found and linked your existing SteamCMD folder ("${steamCmdDirLinked}"), so the ` +
      "Setup/Install tab's \"SteamCMD installed\" check should now say Yes too.";
  } else if (!steamcmd.isSteamCmdInstalled(saved.steamCmdDir)) {
    message += ' Couldn\'t automatically work out where your existing steamcmd.exe lives (it doesn\'t follow ' +
      'the standard steamapps\\common layout, or you never used SteamCMD for this install at all) — if you ' +
      "have one already, use the SteamCMD directory field's Browse… button to point at it directly; " +
      "otherwise \"Install SteamCMD\" below will fetch a fresh copy.";
  }

  res.json({
    ok: true,
    installDir,
    exeFound: true,
    configFound,
    configSummary,
    configWarning,
    steamCmdDirLinked,
    message
  });
});

app.post('/api/setup/parse-bat', (req, res) => {
  try {
    const text = (req.body && req.body.text) || '';
    const result = batImport.parseBatFile(text);
    // Only worth an existence check for a real absolute path — a relative
    // one would just be resolved against wherever this manager process
    // happens to be running from, which has nothing to do with the .bat
    // file's own folder and would be a misleading result either way.
    if (result.installDir && batImport.isAbsoluteWindowsPath(result.installDir)) {
      const exeExists = fs.existsSync(path.join(result.installDir, 'enshrouded_server.exe'));
      result.exeFoundAtPath = exeExists;
      if (!exeExists) {
        result.warnings.push(`Heads up: enshrouded_server.exe wasn't found at "${result.installDir}" from here — ` +
          'double-check the path once you apply it (the drive letter or folder may differ on this PC, or the ' +
          'server may have moved since).');
      }
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- quick setup (one button: install + configure + start) ----------

let quickstartRunning = false;

app.post('/api/quickstart', async (req, res) => {
  if (quickstartRunning) {
    return res.status(409).json({ error: 'Quick Setup is already running — check the progress log.' });
  }
  const settings = managerConfig.loadSettings();
  const simple = {
    serverName: (req.body && req.body.serverName) || 'ChillWithSyd Enshrouded Server',
    password: (req.body && req.body.password) || '',
    slotCount: (req.body && req.body.slotCount) || 16,
    preset: (req.body && req.body.preset) || 'Default'
  };

  quickstartRunning = true;
  broadcast('quickstart', '--- Quick Setup started ---');
  res.json({ started: true });

  try {
    await quickstart.run(settings, simple, (line) => broadcast('quickstart', line));
    broadcast('quickstart-done', { ok: true });
  } catch (err) {
    broadcast('quickstart', 'ERROR: ' + err.message);
    broadcast('quickstart-done', { ok: false, error: err.message });
  } finally {
    quickstartRunning = false;
  }
});

app.get('/api/quickstart/status', (req, res) => {
  res.json({ running: quickstartRunning });
});

// ---------- server lifecycle ----------

app.get('/api/server/status', (req, res) => {
  res.json(processManager.getStatus());
});

// Best-effort live player count, queried from the game's own query port via
// A2S_INFO (see src/serverQuery.js for why this is the approach, and its
// confidence caveats). Never throws a hard error to the client -- any
// failure just comes back as { available: false, reason, message } so the
// UI can show "Unknown" instead of breaking.
app.get('/api/server/players', async (req, res) => {
  const status = processManager.getStatus();
  if (!status.running) {
    return res.json({ available: false, reason: 'not-running' });
  }

  const settings = managerConfig.loadSettings();
  let queryPort = null;
  try {
    const { config } = configEditor.readConfig(settings);
    queryPort = config && config.queryPort;
  } catch (_) {
    /* fall through -- treated the same as "no query port known" below */
  }

  if (!queryPort) {
    return res.json({ available: false, reason: 'no-query-port' });
  }

  try {
    const result = await serverQuery.queryPlayers('127.0.0.1', queryPort);
    res.json({ available: true, players: result.players, maxPlayers: result.maxPlayers, bots: result.bots });
  } catch (err) {
    res.json({ available: false, reason: 'query-failed', message: err.message });
  }
});

app.post('/api/server/start', async (req, res) => {
  const settings = managerConfig.loadSettings();
  try {
    const status = await processManager.start(settings);
    res.json(status);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/server/stop', async (req, res) => {
  try {
    const result = await processManager.stop();
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/server/restart', async (req, res) => {
  const settings = managerConfig.loadSettings();
  try {
    const status = await processManager.restart(settings);
    res.json(status);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- config editor ----------

app.get('/api/config', (req, res) => {
  const settings = managerConfig.loadSettings();
  try {
    const result = configEditor.readConfig(settings);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/config/schema', (req, res) => {
  res.json({
    topLevelDefaults: configSchema.TOP_LEVEL_DEFAULTS,
    gameSettingsFields: configSchema.GAME_SETTINGS_FIELDS
  });
});

app.post('/api/config', (req, res) => {
  const settings = managerConfig.loadSettings();
  try {
    const result = configEditor.writeConfig(settings, req.body);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/config/generate-default', (req, res) => {
  const settings = managerConfig.loadSettings();
  try {
    const result = configEditor.writeConfig(settings, configSchema.defaultConfig());
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- backups ----------

app.get('/api/backups', (req, res) => {
  const settings = managerConfig.loadSettings();
  res.json(backup.listBackups(settings));
});

app.post('/api/backups', async (req, res) => {
  const settings = managerConfig.loadSettings();
  try {
    const result = await backup.createBackup(settings, getSaveDirFromDisk(settings));
    broadcast('backup', `Manual backup created: ${result.name}`);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/backups/:name', (req, res) => {
  const settings = managerConfig.loadSettings();
  try {
    backup.deleteBackup(settings, req.params.name);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/backups/:name/restore', async (req, res) => {
  const settings = managerConfig.loadSettings();
  if (processManager.isRunning()) {
    return res.status(400).json({ error: 'Stop the server before restoring a backup.' });
  }
  try {
    const result = await backup.restoreBackup(settings, req.params.name, getSaveDirFromDisk(settings));
    broadcast('backup', `Restored backup: ${req.params.name}`);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/backups/schedule', (req, res) => {
  const settings = managerConfig.loadSettings();
  res.json({
    backupsEnabled: settings.backupsEnabled,
    backupIntervalMinutes: settings.backupIntervalMinutes,
    backupRetentionCount: settings.backupRetentionCount
  });
});

app.post('/api/backups/schedule', (req, res) => {
  const saved = managerConfig.saveSettings({
    backupsEnabled: !!req.body.backupsEnabled,
    backupIntervalMinutes: req.body.backupIntervalMinutes,
    backupRetentionCount: req.body.backupRetentionCount
  });
  backup.startSchedule(managerConfig.loadSettings, () => getSaveDirFromDisk(saved), (msg) => broadcast('backup', msg));
  res.json(saved);
});

// ---------- logs ----------

app.get('/api/logs', (req, res) => {
  const settings = managerConfig.loadSettings();
  const gameLogDir = logs.resolveLogDir(settings, getLogDirFromDisk(settings));
  res.json({
    console: logs.listLogFiles(settings.managerLogDir).map((f) => ({ ...f, source: 'console' })),
    game: logs.listLogFiles(gameLogDir).map((f) => ({ ...f, source: 'game' }))
  });
});

app.get('/api/logs/:source/:name', (req, res) => {
  const settings = managerConfig.loadSettings();
  const { source, name } = req.params;
  const safeName = path.basename(name);
  let dir;
  if (source === 'console') dir = settings.managerLogDir;
  else if (source === 'game') dir = logs.resolveLogDir(settings, getLogDirFromDisk(settings));
  else return res.status(400).json({ error: 'Unknown log source.' });

  const full = path.join(dir, safeName);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'Log file not found.' });
  try {
    res.type('text/plain').send(logs.tailFile(full));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- boot ----------

// Written so a hidden/backgrounded launch (no console window at all) can
// still be stopped cleanly by PID, without the user ever needing Task
// Manager or a terminal.
try {
  fs.mkdirSync(path.join(appRoot, 'data'), { recursive: true });
  fs.writeFileSync(path.join(appRoot, 'data', 'manager.pid'), String(process.pid));
} catch (_) {
  /* best effort */
}

const settings = managerConfig.loadSettings();
backup.startSchedule(managerConfig.loadSettings, () => getSaveDirFromDisk(settings), (msg) => broadcast('backup', msg));

const PORT = settings.panelPort || 8790;

let listenErrorHandled = false;
function handleListenError(err) {
  if (listenErrorHandled) return;
  listenErrorHandled = true;
  if (err.code === 'EADDRINUSE') {
    // Most likely the manager is already running (e.g. double-clicked
    // twice) — just open the browser to the existing instance instead of
    // crashing with no visible window to explain why.
    console.log(`Port ${PORT} is already in use — the manager is probably already running. Opening your browser to it.`);
    openBrowser(`http://localhost:${PORT}`);
    setTimeout(() => process.exit(0), 1500);
  } else {
    console.error('Failed to start:', err.message);
    process.exit(1);
  }
}

// ws proxies the underlying HTTP server's listen error onto itself (wss)
// rather than the http.Server object — both are wired up, defensively.
server.on('error', handleListenError);
wss.on('error', handleListenError);

server.listen(PORT, () => {
  console.log(`ChillWithSyd Enshrouded Server Manager listening on http://localhost:${PORT}`);
  openBrowser(`http://localhost:${PORT}`);
});
