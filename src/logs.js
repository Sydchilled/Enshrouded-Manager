// Lists and tails two kinds of logs:
//  1. Our own captured console output from processManager.js (the exe's
//     stdout/stderr — since there's no other way to see what the server
//     printed after the fact, given it runs as a plain console app).
//  2. Whatever Enshrouded itself writes into its configured logDirectory
//     (default "./logs" under the install dir), once that exists.

const fs = require('fs');
const path = require('path');

function resolveLogDir(settings, logDirectoryFromConfig) {
  const rel = logDirectoryFromConfig || './logs';
  return path.isAbsolute(rel) ? rel : path.resolve(settings.installDir, rel);
}

function listLogFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => fs.statSync(path.join(dir, f)).isFile())
    .map((f) => {
      const stat = fs.statSync(path.join(dir, f));
      return { name: f, sizeBytes: stat.size, modifiedAt: stat.mtime };
    })
    .sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
}

function tailFile(fullPath, maxBytes = 200000) {
  const stat = fs.statSync(fullPath);
  const start = Math.max(0, stat.size - maxBytes);
  const fd = fs.openSync(fullPath, 'r');
  const length = stat.size - start;
  const buffer = Buffer.alloc(length);
  fs.readSync(fd, buffer, 0, length, start);
  fs.closeSync(fd);
  return buffer.toString('utf8');
}

module.exports = {
  resolveLogDir,
  listLogFiles,
  tailFile
};
