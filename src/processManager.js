// Starts/stops/restarts enshrouded_server.exe and captures its console
// output (it's a normal foreground console app — there's no service mode,
// no RCON, and — as far as could be confirmed during research — no
// documented graceful-shutdown command or signal it listens for). That
// means "Stop" in this panel is a hard process kill, not a clean save+exit.
// Enshrouded's own save system takes rolling autosave snapshots roughly
// every 10 minutes independent of shutdown method, which is the best
// available mitigation — see the Backups tab and the warning shown before
// Stop/Restart in the UI.
//
// enshrouded_server.exe takes no command-line arguments (confirmed absent
// during research / open feature request asking for them) and reads
// enshrouded_server.json from its own working directory, which is only
// generated the first time the exe actually runs.

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const MAX_MEMORY_LINES = 2000;

const state = {
  proc: null,
  pid: null,
  startedAt: null,
  stoppedReason: null,
  lines: [], // recent console output, newest last
  logStream: null,
  logFilePath: null
};

let listeners = [];

function onOutput(cb) {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

function pushLine(text) {
  const stamped = `[${new Date().toISOString()}] ${text}`;
  state.lines.push(stamped);
  if (state.lines.length > MAX_MEMORY_LINES) state.lines.shift();
  if (state.logStream) state.logStream.write(stamped + '\n');
  listeners.forEach((cb) => {
    try {
      cb(stamped);
    } catch (_) {
      /* ignore listener errors */
    }
  });
}

function isRunning() {
  return !!state.proc;
}

function getStatus() {
  return {
    running: isRunning(),
    pid: state.pid,
    startedAt: state.startedAt,
    uptimeMs: state.startedAt ? Date.now() - state.startedAt : 0,
    logFilePath: state.logFilePath
  };
}

function ensureLogDir(managerLogDir) {
  if (!fs.existsSync(managerLogDir)) fs.mkdirSync(managerLogDir, { recursive: true });
}

function start(settings) {
  return new Promise((resolve, reject) => {
    if (isRunning()) return reject(new Error('Server is already running.'));

    const exePath = path.join(settings.installDir, 'enshrouded_server.exe');
    if (!fs.existsSync(exePath)) {
      return reject(new Error(`enshrouded_server.exe not found at ${exePath}. Install/update it from the Setup tab first.`));
    }

    ensureLogDir(settings.managerLogDir);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    state.logFilePath = path.join(settings.managerLogDir, `console-${stamp}.log`);
    state.logStream = fs.createWriteStream(state.logFilePath, { flags: 'a' });

    pushLine(`Starting ${exePath} ...`);
    const child = spawn(exePath, [], { cwd: settings.installDir });

    child.stdout.on('data', (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach(pushLine));
    child.stderr.on('data', (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => pushLine('[stderr] ' + l)));

    child.on('error', (err) => {
      pushLine('Failed to start: ' + err.message);
      state.proc = null;
      state.pid = null;
      reject(err);
    });

    child.on('exit', (code, signal) => {
      pushLine(`Process exited (code=${code}, signal=${signal}).`);
      state.proc = null;
      state.pid = null;
      state.startedAt = null;
      if (state.logStream) {
        state.logStream.end();
        state.logStream = null;
      }
    });

    state.proc = child;
    state.pid = child.pid;
    state.startedAt = Date.now();
    resolve(getStatus());
  });
}

/**
 * Hard-stops the server. On Windows we shell out to taskkill /T /F against
 * the PID to make sure any child processes die too — Node's child.kill()
 * on Windows already maps to TerminateProcess (no real SIGTERM), so this
 * isn't skipping a gentler option that exists; it's just the reliable way
 * to make sure nothing is left behind.
 */
function stop() {
  return new Promise((resolve, reject) => {
    if (!isRunning()) return reject(new Error('Server is not running.'));
    const pid = state.pid;
    pushLine(`Stopping server (PID ${pid}). Note: Enshrouded has no known graceful-shutdown ` +
      'command, so this is a hard stop — any progress since the last ~10-minute autosave may be lost.');

    if (process.platform === 'win32') {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], (err) => {
        if (err) {
          pushLine('taskkill reported: ' + err.message);
        }
        resolve({ stopped: true });
      });
    } else {
      // Dev/testing on non-Windows hosts.
      try {
        state.proc.kill('SIGKILL');
      } catch (err) {
        pushLine('kill() reported: ' + err.message);
      }
      resolve({ stopped: true });
    }
  });
}

async function restart(settings) {
  if (isRunning()) {
    await stop();
    await new Promise((r) => setTimeout(r, 2000));
  }
  return start(settings);
}

function getRecentLines(limit = 500) {
  return state.lines.slice(-limit);
}

module.exports = {
  start,
  stop,
  restart,
  isRunning,
  getStatus,
  getRecentLines,
  onOutput
};
