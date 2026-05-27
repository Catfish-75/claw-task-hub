Option Explicit

Dim shell, fso, scriptPath, command, exitCode

Set fso = CreateObject("Scripting.FileSystemObject")
scriptPath = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "start-clawtaskhub.ps1")

Set shell = CreateObject("WScript.Shell")
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & scriptPath & Chr(34)

exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode
