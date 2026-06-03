import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
for (const script of ["pilot:start", "pilot:stop", "pilot:status", "pilot:restart"]) {
  assert(packageJson.scripts?.[script]?.includes("scripts/clawtaskhub-posix.sh"), `${script} does not use the POSIX launcher`);
}

const launcher = readFileSync("scripts/clawtaskhub-posix.sh", "utf8");
assert(launcher.includes("setsid sh -c 'exec npm run dev'"), "launcher does not prefer setsid for detached pilot startup");
assert(launcher.includes("nohup sh -c 'exec npm run dev'"), "launcher does not keep a nohup fallback");
assert(launcher.includes("kill -TERM \"-$pid\""), "launcher does not stop the process group first");
assert(launcher.includes("CLAW_TASK_HUB_PID_FILE"), "launcher does not expose a pid file override");
assert(launcher.includes("CLAW_TASK_HUB_LOG_DIR"), "launcher does not expose a log dir override");

const desktopCommandLauncher = readFileSync("Launch Claw Task Hub.command", "utf8");
assert(desktopCommandLauncher.startsWith("#!/bin/sh\n"), "desktop command launcher is not a shell command file");
assert(!desktopCommandLauncher.includes("\r"), "desktop command launcher must keep LF line endings");
assert(desktopCommandLauncher.includes("npm ci"), "desktop command launcher does not install dependencies on first run");
assert(desktopCommandLauncher.includes("npm install"), "desktop command launcher does not keep an npm install fallback");
assert(desktopCommandLauncher.includes("npm run pilot:start"), "desktop command launcher does not use the detached pilot launcher");
assert(desktopCommandLauncher.includes("http://localhost:5173"), "desktop command launcher does not open the local UI");

const windowsVbsLauncher = readFileSync("Launch Claw Task Hub.vbs", "utf8");
assert(windowsVbsLauncher.includes("scripts"), "Windows launcher does not resolve the scripts folder");
assert(windowsVbsLauncher.includes("launch-clawtaskhub.ps1"), "Windows launcher does not call the PowerShell launcher");
assert(windowsVbsLauncher.includes("shell.Run(command, 0, True)"), "Windows launcher does not run hidden and wait for completion");
assert(windowsVbsLauncher.includes("MsgBox"), "Windows launcher does not show a human-readable failure message");

const windowsPowerShellLauncher = readFileSync("scripts/launch-clawtaskhub.ps1", "utf8");
assert(windowsPowerShellLauncher.includes("npm ci"), "PowerShell launcher does not install dependencies on first run");
assert(windowsPowerShellLauncher.includes("npm install"), "PowerShell launcher does not keep an npm install fallback");
assert(windowsPowerShellLauncher.includes("start-clawtaskhub.ps1"), "PowerShell launcher does not delegate service startup");
assert(windowsPowerShellLauncher.includes("-WindowStyle Hidden"), "PowerShell launcher does not hide child process windows");
assert(windowsPowerShellLauncher.includes("Start-Process \"http://localhost:5173\""), "PowerShell launcher does not open the local UI");

for (const file of ["scripts/clawtaskhub-posix.sh", "scripts/start-clawtaskhub.sh", "scripts/stop-clawtaskhub.sh", "scripts/status-clawtaskhub.sh"]) {
  const content = readFileSync(file, "utf8");
  assert(content.startsWith("#!/usr/bin/env sh"), `${file} is not a POSIX sh script`);
}

if (process.platform !== "win32") {
  for (const file of ["scripts/clawtaskhub-posix.sh", "scripts/start-clawtaskhub.sh", "scripts/stop-clawtaskhub.sh", "scripts/status-clawtaskhub.sh", "Launch Claw Task Hub.command"]) {
    const result = spawnSync("sh", ["-n", file], { encoding: "utf8" });
    assert(result.status === 0, `${file} failed sh -n\n${result.stderr}`);
  }
} else {
  const parsePowerShell = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "$tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile('scripts/launch-clawtaskhub.ps1',[ref]$tokens,[ref]$errors)>$null;if($errors.Count){$errors|ForEach-Object{Write-Error $_.Message};exit 1}",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  assert(parsePowerShell.status === 0, `scripts/launch-clawtaskhub.ps1 failed PowerShell parse\n${parsePowerShell.stderr}`);
}

console.log("Launcher smoke passed");
