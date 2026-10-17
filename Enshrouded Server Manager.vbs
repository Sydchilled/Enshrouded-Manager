' Enshrouded Server Manager — double-click this file to start.
' No terminal/console window ever appears; your browser opens automatically.
'
' Two ways this can run:
'   - Release download: EnshroudedServerManager.exe sits right next to this
'     script. That .exe has Node.js and every dependency baked in already
'     (see scripts/generate-embedded-public.js and package.json's
'     "build:win" script in the source repo) — nothing to install, this
'     just launches it.
'   - Running from the source checkout (no .exe built): falls back to the
'     original flow — checks for Node.js, runs `npm install` once, then
'     `node server.js`.
Option Explicit

Dim fso, shell, scriptDir, exitCode, dataDir, installLog, managerLog, pidFile, exePath, runCmd, i

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
dataDir = scriptDir & "\data"
If Not fso.FolderExists(dataDir) Then fso.CreateFolder(dataDir)
installLog = dataDir & "\install.log"
managerLog = dataDir & "\manager.log"
pidFile = dataDir & "\manager.pid"
exePath = scriptDir & "\EnshroudedServerManager.exe"

If fso.FileExists(exePath) Then
    ' Packaged release: everything's already bundled into the .exe.
    runCmd = Chr(34) & exePath & Chr(34)
Else
    ' Running from source: make sure Node.js is installed.
    exitCode = shell.Run("cmd /c where node >nul 2>&1", 0, True)
    If exitCode <> 0 Then
        MsgBox "Node.js isn't installed on this PC (or was just installed and this PC hasn't been " & _
               "restarted yet — that also causes this)." & vbCrLf & vbCrLf & _
               "Download it from https://nodejs.org/ (the LTS version) if needed, install it, restart " & _
               "your PC if you just installed it, then double-click this file again.", _
               vbExclamation, "Enshrouded Server Manager"
        WScript.Quit 1
    End If

    ' First-time setup: install dependencies if they're missing. Logged to
    ' data\install.log since there's no console window to watch.
    If Not fso.FolderExists(scriptDir & "\node_modules") Then
        MsgBox "First time setup — this installs a few files and takes about a minute." & vbCrLf & _
               "Click OK, then wait a minute before checking your browser.", _
               vbInformation, "Enshrouded Server Manager"
        exitCode = shell.Run("cmd /c cd /d " & Chr(34) & scriptDir & Chr(34) & _
            " && npm install --omit=dev > " & Chr(34) & installLog & Chr(34) & " 2>&1", 0, True)
        If exitCode <> 0 Then
            MsgBox "Setup didn't finish correctly. Opening the log so you can see why.", _
                   vbExclamation, "Enshrouded Server Manager"
            shell.Run "notepad.exe " & Chr(34) & installLog & Chr(34), 1, False
            WScript.Quit 1
        End If
    End If

    runCmd = "node server.js"
End If

' Start the manager in the background — fully hidden. Its own output is
' redirected straight to data\manager.log, so even a crash on startup
' (before the app's own logging kicks in) still ends up somewhere you
' can read it, instead of vanishing into a hidden window.
If fso.FileExists(pidFile) Then Call fso.DeleteFile(pidFile, True)
shell.Run "cmd /c cd /d " & Chr(34) & scriptDir & Chr(34) & _
    " && " & runCmd & " >> " & Chr(34) & managerLog & Chr(34) & " 2>&1", 0, False

' Give it a few seconds, then confirm it actually came up. If the PID
' file never appears, something went wrong before the server could even
' start listening — open the log automatically rather than leaving you
' with silence and no clue why.
For i = 1 To 10
    WScript.Sleep 1000
    If fso.FileExists(pidFile) Then Exit For
Next

If Not fso.FileExists(pidFile) Then
    MsgBox "The server manager didn't start correctly. Opening the log so you can see why.", _
           vbExclamation, "Enshrouded Server Manager"
    shell.Run "notepad.exe " & Chr(34) & managerLog & Chr(34), 1, False
End If
