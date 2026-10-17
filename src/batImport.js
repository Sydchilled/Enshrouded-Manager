// Best-effort parser for a simple Windows .bat file that used to launch
// enshrouded_server.exe directly, so someone with an existing bare-bones
// install can point this manager at it instead of retyping the folder path
// by hand. This is deliberately forgiving rather than a real batch-file
// interpreter — .bat syntax has endless edge cases (IF/FOR/SETLOCAL,
// environment-variable expansion, etc.) and none of that matters here. All
// that's actually being extracted is: which folder was enshrouded_server.exe
// run from, and was anything typed after it on the command line (which the
// exe has always ignored — see processManager.js's note that it accepts no
// command-line arguments at all, so nothing from an old .bat file's launch
// line can be "lost" by adopting it into the manager).
//
// The one thing pasted text genuinely cannot reveal is *where the .bat file
// itself lives on disk* — a browser only gets a file's contents, never its
// full path. So any folder built from %~dp0 (cmd's "this batch file's own
// folder" token), or from a `cd` with no drive letter at all (which in
// practice resolves the same way for a double-clicked .bat), comes back as
// a *relative* hint rather than a real installDir — see relativeHint below.

const path = require('path');

function tokenize(line) {
  const tokens = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    tokens.push(m[1] !== undefined ? m[1] : m[2]);
  }
  return tokens;
}

function isSkippableLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('::')) return true;
  if (/^rem(\s|$)/i.test(trimmed)) return true;
  return false;
}

function stripLeadingAt(token) {
  return token.startsWith('@') ? token.slice(1) : token;
}

function isAbsoluteWindowsPath(p) {
  return /^[a-zA-Z]:[\\/]/.test(p) || /^\\\\/.test(p);
}

// Strips a %~dp0 token out of a path fragment and reports whether it was
// there, so "%~dp0steamapps\common\Enshrouded" and
// "%~dp0\steamapps\common\Enshrouded" both become "steamapps\common\Enshrouded".
function splitDp0(fragment) {
  const match = /%~dp0/i.exec(fragment);
  if (!match) return { sawDp0: false, rest: fragment };
  let rest = fragment.slice(0, match.index) + fragment.slice(match.index + match[0].length);
  rest = rest.replace(/^[\\/]+/, '');
  return { sawDp0: true, rest };
}

const NOISE_TOKENS = new Set(['>', '>>', '&', '&&', '||', '|']);

function parseBatFile(text) {
  const warnings = [];

  // currentDir tracks the working directory as of the most recent `cd`,
  // either as an absolute path or (relativeChain !== null) as a path still
  // relative to wherever the .bat file itself turns out to live.
  let currentDirAbs = null;
  let relativeChain = null; // e.g. "steamapps\common\Enshrouded", or '' for bare %~dp0
  let sawDp0Anywhere = false;

  let installDir = null;
  let installDirSource = null;
  let relativeHint = null;
  let exeLine = null;
  let extraArgs = [];
  let foundExeLine = false;

  const lines = String(text || '').split(/\r?\n/);

  for (const rawLine of lines) {
    if (isSkippableLine(rawLine)) continue;
    const tokens = tokenize(rawLine).map(stripLeadingAt).filter((t) => t.length > 0);
    if (tokens.length === 0) continue;

    const first = tokens[0].toLowerCase();

    if (!foundExeLine && (first === 'cd' || first === 'pushd' || first === 'chdir')) {
      const rest = tokens.slice(1).filter((t) => t.toLowerCase() !== '/d');
      if (rest.length > 0) {
        const dirArg = rest.join(' ');
        const { sawDp0, rest: withoutDp0 } = splitDp0(dirArg);

        if (sawDp0) {
          sawDp0Anywhere = true;
          currentDirAbs = null;
          relativeChain = withoutDp0; // resets the chain to be dp0-relative from here
        } else if (isAbsoluteWindowsPath(dirArg)) {
          currentDirAbs = dirArg;
          relativeChain = null;
        } else if (currentDirAbs) {
          currentDirAbs = path.win32.join(currentDirAbs, dirArg);
        } else {
          // A relative `cd` with no absolute anchor yet. cmd.exe would
          // resolve this against wherever the .bat was actually launched
          // from, which for a plain double-click is that file's own folder —
          // so treat it the same as a %~dp0-relative hop. path.win32.join
          // normalizes away a leading ".\" and handles relativeChain being
          // null (nothing seen yet) or "" (bare %~dp0 seen) the same way.
          relativeChain = path.win32.join(relativeChain || '', dirArg);
        }
      }
      continue;
    }

    if (foundExeLine) continue; // only use the first real invocation found

    const exeIndex = tokens.findIndex((t) => t.toLowerCase().endsWith('enshrouded_server.exe'));
    if (exeIndex === -1) continue;

    foundExeLine = true;
    exeLine = rawLine.trim();
    const exeToken = tokens[exeIndex];
    const { sawDp0: exeSawDp0, rest: exeWithoutDp0 } = splitDp0(exeToken);

    if (exeSawDp0) {
      sawDp0Anywhere = true;
      const dir = path.win32.dirname(exeWithoutDp0);
      relativeHint = dir === '.' ? null : dir;
    } else if (isAbsoluteWindowsPath(exeToken)) {
      installDir = path.win32.dirname(exeToken);
      installDirSource = 'inline-path';
    } else if (/[\\/]/.test(exeToken)) {
      // A relative path in front of the exe name (e.g. "server\enshrouded_server.exe").
      const dir = path.win32.dirname(exeToken);
      if (currentDirAbs) {
        installDir = path.win32.join(currentDirAbs, dir);
        installDirSource = 'inline-path';
      } else {
        relativeHint = path.win32.join(relativeChain || '', dir);
      }
    } else if (currentDirAbs) {
      installDir = currentDirAbs;
      installDirSource = 'cd';
    } else if (relativeChain !== null) {
      relativeHint = relativeChain || null;
    }

    extraArgs = tokens.slice(exeIndex + 1).filter((t) => !NOISE_TOKENS.has(t) && !/^2?>/.test(t));
  }

  if (!foundExeLine) {
    warnings.push("Couldn't find a line in this file that runs enshrouded_server.exe — double-check this is the right .bat file.");
  } else if (!installDir && (relativeHint !== null || sawDp0Anywhere)) {
    const sub = relativeHint
      ? ` Then, inside that same folder, open into "${relativeHint}" — that's the subfolder this .bat file actually runs from.`
      : " That folder itself is what this .bat file runs enshrouded_server.exe from, with no subfolder underneath it.";
    warnings.push("This .bat file doesn't spell out a folder path — it uses %~dp0 (or a plain `cd` with no drive " +
      "letter), which just means \"wherever this .bat file itself happens to be saved\". A browser can only see a " +
      "pasted file's contents, never the location it's saved at, so that can't be filled in automatically. " +
      'Click the Browse… button next to the Install directory field above and find the folder that this ' +
      `.bat file is actually sitting in on your PC.${sub}`);
  } else if (!installDir) {
    warnings.push('No folder path was found in the file — it likely relies on already being run from inside the ' +
      'server folder. Enter the install directory manually: it\'s the folder containing enshrouded_server.exe.');
  }

  if (extraArgs.length > 0) {
    warnings.push(`Found extra text after enshrouded_server.exe on its launch line ("${extraArgs.join(' ')}") — ` +
      "nothing to worry about either way, since the game server doesn't accept command-line arguments at all, " +
      "so your .bat file's copy of it was already being ignored too.");
  }

  return { installDir, installDirSource, relativeHint, exeLine, extraArgs, warnings };
}

module.exports = { parseBatFile, isAbsoluteWindowsPath };
