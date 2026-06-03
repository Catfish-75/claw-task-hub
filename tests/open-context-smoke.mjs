import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const tempDir = mkdtempSync(join(tmpdir(), "claw-task-hub-open-context-"));
const workspaceDir = join(tempDir, "Demo Workspace");
const env = { ...process.env, CLAW_TASK_HUB_DB: join(tempDir, "open-context-smoke.sqlite") };

function runOpenContext(args) {
  const result = spawnSync(process.execPath, ["--import", "tsx", "tools/open-context.ts", ...args], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`open:context failed\nerror:\n${result.error ?? ""}\nstdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`);
  }
  return JSON.parse(result.stdout);
}

try {
  const first = runOpenContext([
    "--cwd", workspaceDir,
    "--harness", "codex",
    "--project-name", "Demo Workspace",
    "--create-project",
    "--write-shortcut",
  ]);

  assert(first.ok === true, "first command did not report ok");
  assert(first.context_key.includes("codex:"), "context key did not use the harness prefix");
  assert(/^project_codex_workspace_demo_workspace_[a-f0-9]{8}$/.test(first.project?.id ?? ""), `unexpected project id: ${first.project?.id}`);
  assert(first.url === `http://localhost:5173/projects/${first.project.id}/issues`, `unexpected URL: ${first.url}`);
  assert(first.shortcut_path, "shortcut path was not returned");
  assert(existsSync(first.shortcut_path), "shortcut was not written");
  assert(readFileSync(first.shortcut_path, "utf8").includes(first.url), "shortcut does not contain the project URL");

  const second = runOpenContext([
    "--cwd", workspaceDir,
    "--harness", "codex",
  ]);

  assert(second.ok === true, "second command did not report ok");
  assert(second.project?.id === first.project.id, "resolve-only run returned a different project");
  assert(second.url === first.url, "resolve-only run returned a different URL");

  console.log("open-context smoke passed");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
