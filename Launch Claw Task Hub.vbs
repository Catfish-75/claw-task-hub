Option Explicit

Dim shell, fso, rootPath, scriptPath, command, exitCode

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
rootPath = fso.GetParentFolderName(WScript.ScriptFullName)
scriptPath = fso.BuildPath(fso.BuildPath(rootPath, "scripts"), "launch-clawtaskhub.ps1")

If Not fso.FileExists(scriptPath) Then
  MsgBox "Claw Task Hub launcher script was not found: " & scriptPath, vbCritical, "Claw Task Hub"
  WScript.Quit 1
End If

command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & scriptPath & Chr(34)
exitCode = shell.Run(command, 0, True)

If exitCode <> 0 Then
  MsgBox "Claw Task Hub could not start. See the logs folder for details.", vbExclamation, "Claw Task Hub"
End If

WScript.Quit exitCode
