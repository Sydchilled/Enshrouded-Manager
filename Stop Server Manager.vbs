' Stops the Enshrouded Server Manager panel itself (not the game server —
' use the Dashboard tab in your browser for that). No terminal window
' appears; you'll just get a confirmation popup.
Option Explicit

Dim fso, shell, scriptDir, pidFile, pid, exitCode, ts

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
pidFile = scriptDir & "\data\manager.pid"

If Not fso.FileExists(pidFile) Then
    MsgBox "The server manager doesn't look like it's running (no PID file found)." & vbCrLf & vbCrLf & _
           "If you expected it to be running, double-click 'Enshrouded Server Manager.vbs' again — " & _
           "if it fails to start it will now open data\manager.log automatically so you can see why.", _
           vbInformation, "Enshrouded Server Manager"
    WScript.Quit 0
End If

Set ts = fso.OpenTextFile(pidFile, 1)
pid = Trim(ts.ReadLine)
ts.Close

exitCode = shell.Run("cmd /c taskkill /PID " & pid & " /T /F >nul 2>&1", 0, True)
If exitCode = 0 Then
    MsgBox "Server manager stopped.", vbInformation, "Enshrouded Server Manager"
Else
    MsgBox "Couldn't stop it automatically — it may already be stopped. " & _
           "You can also end 'node.exe' from Task Manager.", vbExclamation, "Enshrouded Server Manager"
End If
