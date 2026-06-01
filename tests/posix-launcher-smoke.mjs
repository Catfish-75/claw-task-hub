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

for (const file of ["scripts/clawtaskhub-posix.sh", "scripts/start-clawtaskhub.sh", "scripts/stop-clawtaskhub.sh", "scripts/status-clawtaskhub.sh"]) {
  const content = readFileSync(file, "utf8");
  assert(content.startsWith("#!/usr/bin/env sh"), `${file} is not a POSIX sh script`);
}

if (process.platform !== "win32") {
  for (const file of ["scripts/clawtaskhub-posix.sh", "scripts/start-clawtaskhub.sh", "scripts/stop-clawtaskhub.sh", "scripts/status-clawtaskhub.sh"]) {
    const result = spawnSync("sh", ["-n", file], { encoding: "utf8" });
    assert(result.status === 0, `${file} failed sh -n\n${result.stderr}`);
  }
}

console.log("POSIX launcher smoke passed");
