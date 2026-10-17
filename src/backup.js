// Zips up the save-game folder on demand and on a schedule.
//
// Context from research: Enshrouded's own save system already keeps 10
// rolling numbered backups per world plus an "-index" file inside
// saveDirectory, refreshed roughly every 10 minutes and on shutdown. This
// module is a *second, independent* layer on top of that — a full copy of
// the whole savegame folder (including that internal rotation) kept
// wherever the admin wants, e.g. off the same disk. It matters because
// there's no confirmed graceful-shutdown path for the server process (see
// processManager.js), so relying solely on the engine's own autosave is
// riskier than having your own external backups too.

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const extractZip = require('extract-zip');

function resolveSaveDir(settings, saveDirectoryFromConfig) {
  const rel = saveDirectoryFromConfig || './savegame';
  return path.isAbsolute(rel) ? rel : path.resolve(settings.installDir, rel);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function listBackups(settings) {
  ensureDir(settings.backupDir);
  return fs
    .readdirSync(settings.backupDir)
    .filter((f) => f.endsWith('.zip'))
    .map((f) => {
      const full = path.join(settings.backupDir, f);
      const stat = fs.statSync(full);
      return { name: f, sizeBytes: stat.size, createdAt: stat.mtime };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function createBackup(settings, saveDirectoryFromConfig) {
  return new Promise((resolve, reject) => {
    const saveDir = resolveSaveDir(settings, saveDirectoryFromConfig);
    if (!fs.existsSync(saveDir)) {
      return reject(new Error(`Save directory not found: ${saveDir}. Has the server been started at least once?`));
    }
    ensureDir(settings.backupDir);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outFile = path.join(settings.backupDir, `savegame-${stamp}.zip`);
    const output = fs.createWriteStream(outFile);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      pruneOldBackups(settings);
      resolve({ name: path.basename(outFile), sizeBytes: archive.pointer() });
    });
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(saveDir, false);
    archive.finalize();
  });
}

function pruneOldBackups(settings) {
  const keep = settings.backupRetentionCount || 10;
  const backups = listBackups(settings);
  if (backups.length <= keep) return;
  backups.slice(keep).forEach((b) => {
    try {
      fs.unlinkSync(path.join(settings.backupDir, b.name));
    } catch (_) {
      /* ignore */
    }
  });
}

function deleteBackup(settings, name) {
  const safe = path.basename(name); // guard against path traversal
  const full = path.join(settings.backupDir, safe);
  if (!fs.existsSync(full)) throw new Error('Backup not found.');
  fs.unlinkSync(full);
}

async function restoreBackup(settings, name, saveDirectoryFromConfig) {
  const safe = path.basename(name);
  const full = path.join(settings.backupDir, safe);
  if (!fs.existsSync(full)) throw new Error('Backup not found.');
  const saveDir = resolveSaveDir(settings, saveDirectoryFromConfig);
  ensureDir(saveDir);
  await extractZip(full, { dir: saveDir });
  return { restoredTo: saveDir };
}

// --- scheduling ---
let scheduleHandle = null;

function stopSchedule() {
  if (scheduleHandle) {
    clearInterval(scheduleHandle);
    scheduleHandle = null;
  }
}

function startSchedule(getSettings, getSaveDirectory, onEvent) {
  stopSchedule();
  const settings = getSettings();
  if (!settings.backupsEnabled) return;
  const intervalMs = Math.max(5, settings.backupIntervalMinutes || 60) * 60 * 1000;
  scheduleHandle = setInterval(async () => {
    try {
      const s = getSettings();
      const result = await createBackup(s, getSaveDirectory());
      onEvent && onEvent(`Scheduled backup created: ${result.name}`);
    } catch (err) {
      onEvent && onEvent('Scheduled backup failed: ' + err.message);
    }
  }, intervalMs);
}

module.exports = {
  resolveSaveDir,
  listBackups,
  createBackup,
  deleteBackup,
  restoreBackup,
  startSchedule,
  stopSchedule
};
