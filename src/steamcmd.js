// Bootstraps SteamCMD and uses it to install/update the Enshrouded Dedicated
// Server (Steam app id 2278520, a free "Tool" app — anonymous login works).
//
// Known gotcha (hit on the Windrose project too): running steamcmd.exe from
// *inside* the folder you're installing the game into can make SteamCMD nest
// the game under steamcmd\steamapps\common\... instead of honoring
// force_install_dir. That's why managerConfig keeps steamCmdDir and
// installDir as two separate folders by default.

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

const STEAMCMD_ZIP_URL = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function download(url, destFile) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destFile);
    https
      .get(url, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close();
          fs.unlink(destFile, () => {});
          return resolve(download(response.headers.location, destFile));
        }
        if (response.statusCode !== 200) {
          file.close();
          fs.unlink(destFile, () => {});
          return reject(new Error(`Download failed: HTTP ${response.statusCode}`));
        }
        response.pipe(file);
        file.on('finish', () => file.close(resolve));
      })
      .on('error', (err) => {
        fs.unlink(destFile, () => {});
        reject(err);
      });
  });
}

function steamCmdExePath(steamCmdDir) {
  return path.join(steamCmdDir, 'steamcmd.exe');
}

function isSteamCmdInstalled(steamCmdDir) {
  return fs.existsSync(steamCmdExePath(steamCmdDir));
}

// Best-effort guess at where an *existing* install's steamcmd.exe lives,
// used when adopting a bare-bones server that was never set up through this
// manager. "steamapps\common\<App>" is the literal folder structure SteamCMD
// creates on its own default library — seeing it inside an installDir is a
// strong tell that steamcmd.exe was simply run from (and still lives in)
// whatever folder sits in front of that fragment, rather than the separate
// steamCmdDir this manager defaults new installs to. Returns null when the
// install directory doesn't look like a stock SteamCMD layout at all.
function guessSteamCmdDirFromInstallDir(installDir) {
  const match = /^(.*)[\\/]steamapps[\\/]common[\\/][^\\/]+[\\/]?$/i.exec(String(installDir || ''));
  return match ? match[1] : null;
}

/**
 * Downloads steamcmd.zip and extracts it into steamCmdDir.
 * onLine(text) receives progress messages for the UI's live console.
 */
async function installSteamCmd(steamCmdDir, onLine, maxAttempts = 3) {
  ensureDir(steamCmdDir);
  const zipPath = path.join(steamCmdDir, 'steamcmd.zip');
  const extractZip = require('extract-zip');

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      onLine(attempt === 1 ? 'Downloading steamcmd.zip from Valve...' : `Downloading steamcmd.zip from Valve (attempt ${attempt}/${maxAttempts})...`);
      await download(STEAMCMD_ZIP_URL, zipPath);
      onLine('Download complete, extracting...');
      await extractZip(zipPath, { dir: steamCmdDir });
      fs.unlink(zipPath, () => {});
      onLine('SteamCMD installed at ' + steamCmdExePath(steamCmdDir));
      return steamCmdExePath(steamCmdDir);
    } catch (err) {
      lastErr = err;
      fs.unlink(zipPath, () => {});
      if (attempt < maxAttempts) {
        onLine(`Download/extract failed (${err.message}) — this is usually a brief network hiccup. Retrying automatically...`);
        await wait(3000);
      }
    }
  }
  throw lastErr;
}

/**
 * Runs steamcmd once to install or update the Enshrouded dedicated server
 * into installDir. Streams each output line to onLine. Resolves with the
 * exit code (0 = success).
 */
function runAppUpdateOnce({ steamCmdDir, installDir, appId }, onLine) {
  return new Promise((resolve, reject) => {
    ensureDir(installDir);
    const exe = steamCmdExePath(steamCmdDir);
    if (!fs.existsSync(exe)) {
      return reject(new Error('SteamCMD is not installed yet — install it first.'));
    }
    const args = [
      '+force_install_dir', installDir,
      '+login', 'anonymous',
      '+app_update', appId, 'validate',
      '+quit'
    ];
    onLine(`Running: steamcmd.exe ${args.join(' ')}`);
    const child = spawn(exe, args, { cwd: steamCmdDir });

    child.stdout.on('data', (d) => {
      d.toString().split(/\r?\n/).filter(Boolean).forEach(onLine);
    });
    child.stderr.on('data', (d) => {
      d.toString().split(/\r?\n/).filter(Boolean).forEach((line) => onLine('[stderr] ' + line));
    });
    child.on('error', reject);
    child.on('close', (code) => {
      onLine(`SteamCMD exited with code ${code}`);
      resolve(code);
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Same as runAppUpdateOnce, but retries automatically. SteamCMD is notorious
 * for a first-run-after-fresh-install quirk: the very first launch of a
 * newly-extracted steamcmd.exe often just self-updates its own bootstrapper
 * and quits (sometimes with a non-zero exit code) *without* actually running
 * the +app_update command that follows it — it needs to be re-run once it's
 * finished updating itself. Plain transient network hiccups against Steam's
 * CDN show up the same way (a non-zero exit with no clear cause). Valve has
 * never documented these exit codes, so rather than trying to distinguish
 * "harmless, just retry" from "really broken", we just retry a few times
 * with a short pause — that's also what other community server managers
 * (e.g. LinuxGSM) end up doing in practice. This is what makes a from-zero
 * install hands-off instead of needing the user to notice a failure and
 * click Update again themselves.
 */
async function runAppUpdate(opts, onLine, maxAttempts = 3) {
  let exitCode;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      onLine(`Attempt ${attempt}/${maxAttempts}...`);
    }
    exitCode = await runAppUpdateOnce(opts, onLine);
    if (exitCode === 0) return exitCode;
    if (attempt < maxAttempts) {
      onLine(
        `SteamCMD exited with code ${exitCode} — this is often just SteamCMD updating itself on ` +
        `first run, or a brief hiccup talking to Steam. Waiting a few seconds and trying again automatically...`
      );
      await wait(5000);
    }
  }
  return exitCode;
}

module.exports = {
  isSteamCmdInstalled,
  installSteamCmd,
  runAppUpdate,
  steamCmdExePath,
  guessSteamCmdDirFromInstallDir
};
