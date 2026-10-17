// One-button setup for non-technical users: installs SteamCMD, installs/
// updates the game server, and — the awkward part — automates the "start
// once to generate enshrouded_server.json, stop, edit it, start again"
// dance that Enshrouded forces on everyone (the file doesn't exist until
// the exe has actually run once, and there's no CLI flag to pre-seed it).
//
// After this runs, the server is left actually running with the simple
// settings the user typed in (name/password/slots/preset) applied.

const fs = require('fs');
const steamcmd = require('./steamcmd');
const processManager = require('./processManager');
const configEditor = require('./configEditor');
const { defaultConfig } = require('./configSchema');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {object} settings manager settings (paths etc.)
 * @param {object} simple { serverName, password, slotCount, preset }
 * @param {(line: string) => void} onLine progress callback for the UI
 */
async function run(settings, simple, onLine) {
  const say = (line) => onLine(line);

  if (processManager.isRunning()) {
    say('Server is already running — stopping it first so Quick Setup can apply cleanly.');
    await processManager.stop();
    await wait(2000);
  }

  // 1. SteamCMD
  if (!steamcmd.isSteamCmdInstalled(settings.steamCmdDir)) {
    say('Installing SteamCMD (one-time, ~10MB download)...');
    await steamcmd.installSteamCmd(settings.steamCmdDir, say);
  } else {
    say('SteamCMD already installed, skipping.');
  }

  // 2. Install/update the game server
  say('Downloading/updating the Enshrouded dedicated server (this can take a few minutes)...');
  const exitCode = await steamcmd.runAppUpdate(
    { steamCmdDir: settings.steamCmdDir, installDir: settings.installDir, appId: settings.steamAppId },
    say
  );
  if (exitCode !== 0) {
    throw new Error(`SteamCMD kept failing (exit code ${exitCode}) even after retrying automatically — the server may not have installed correctly. Check the log above, and check your internet connection / firewall.`);
  }

  // 3. Generate enshrouded_server.json if it doesn't exist yet, by
  // starting the server briefly and letting it create the file itself.
  if (!configEditor.configExists(settings)) {
    say('First-time setup: briefly starting the server so it creates its settings file...');
    await processManager.start(settings);

    const configPath = configEditor.configPath(settings);
    const timeoutMs = 45000;
    const start = Date.now();
    while (!fs.existsSync(configPath) && Date.now() - start < timeoutMs) {
      await wait(1000);
    }

    say('Stopping the server so we can apply your settings...');
    if (processManager.isRunning()) {
      await processManager.stop();
      await wait(2000);
    }

    if (!fs.existsSync(configPath)) {
      throw new Error(
        'The server did not create its settings file in time. It may need longer on this machine — try Quick Setup again in a minute, or use the Advanced Config tab once it appears.'
      );
    }
    say('Settings file created.');
  } else {
    say('Settings file already exists, applying your changes to it.');
  }

  // 4. Apply the simple fields on top of whatever config exists.
  const { config } = configEditor.readConfig(settings);
  const merged = { ...defaultConfig(), ...config };

  if (simple.serverName) merged.name = simple.serverName;
  if (simple.slotCount) merged.slotCount = Number(simple.slotCount);
  if (simple.preset) merged.gameSettingsPreset = simple.preset;

  if (simple.password) {
    if (!Array.isArray(merged.userGroups) || merged.userGroups.length === 0) {
      merged.userGroups = defaultConfig().userGroups;
    }
    // First group is treated as the "main" one non-technical users share
    // with friends — give it the password they chose and full rights.
    merged.userGroups[0] = {
      ...merged.userGroups[0],
      name: merged.userGroups[0].name || 'Admin',
      password: simple.password,
      canKickBan: true,
      canAccessInventories: true,
      canEditBase: true,
      canExtendBase: true
    };
  }

  say('Saving your server settings...');
  configEditor.writeConfig(settings, merged);

  // 5. Start it for real.
  say('Starting the server...');
  await processManager.start(settings);
  say('Done! Your server is starting up — watch the console below for it to come online.');

  return { ok: true };
}

module.exports = { run };
