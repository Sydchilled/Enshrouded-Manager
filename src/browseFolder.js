// Opens a native Windows "choose a folder" dialog from the server side, so
// the web panel can offer a real Browse button instead of asking people to
// type paths out by hand. A browser's own <input type="file"> deliberately
// never exposes a picked file/folder's absolute path (that's a security
// boundary, not a bug we can code around) — but this manager's backend runs
// as a normal desktop process on the same Windows PC the browser is open
// on, so it can pop a real folder-browser dialog via PowerShell/WinForms
// and hand the chosen path straight back.

const { execFile } = require('child_process');

function escapeForSingleQuotedPs(str) {
  return String(str).replace(/'/g, "''");
}

function browseForFolder(initialDir) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      return reject(new Error('The folder browser only works on Windows (it uses a native Windows dialog).'));
    }

    const initialLine = initialDir
      ? `if (Test-Path -LiteralPath '${escapeForSingleQuotedPs(initialDir)}') { $dialog.SelectedPath = '${escapeForSingleQuotedPs(initialDir)}' }`
      : '';

    // -STA is required: FolderBrowserDialog throws on the default MTA
    // apartment PowerShell otherwise starts child processes in.
    const psScript = [
      "Add-Type -AssemblyName System.Windows.Forms | Out-Null",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$dialog.Description = 'Select the folder that contains (or should contain) enshrouded_server.exe'",
      "$dialog.ShowNewFolderButton = $true",
      initialLine,
      "$result = $dialog.ShowDialog()",
      "if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath } else { Write-Output '' }"
    ].filter(Boolean).join("\n");

    execFile(
      'powershell.exe',
      ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
      { windowsHide: false, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        const selected = String(stdout || '').trim();
        resolve(selected || null); // null = user cancelled the dialog
      }
    );
  });
}

module.exports = { browseForFolder };
