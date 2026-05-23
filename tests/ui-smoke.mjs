import { chromium } from "playwright";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const tempDir = mkdtempSync(join(tmpdir(), "claw-task-hub-ui-smoke-"));
const apiPort = await getFreePort();
const webPort = await getFreePort();
const env = {
  ...process.env,
  CLAW_TASK_HUB_DB: join(tempDir, "ui-smoke.sqlite"),
  CLAW_TASK_HUB_CORS_ORIGINS: `http://127.0.0.1:${webPort},http://localhost:${webPort}`,
  VITE_CLAW_TASK_HUB_API_BASE: `http://127.0.0.1:${apiPort}/api`,
};
const spawned = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
const pageDiagnostics = [];

page.on("console", (message) => {
  if (["error", "warning"].includes(message.type())) {
    pageDiagnostics.push(`${message.type()}: ${message.text()}`);
  }
});
page.on("pageerror", (error) => {
  pageDiagnostics.push(`pageerror: ${error.message}`);
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runNpm(args) {
  const result = spawnNpmSync(args, {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `npm ${args.join(" ")} failed` +
        `\nerror:\n${result.error?.message ?? ""}` +
        `\nstdout:\n${result.stdout ?? ""}` +
        `\nstderr:\n${result.stderr ?? ""}`,
    );
  }
  return result.stdout;
}

function spawnNpmSync(args, options) {
  if (process.platform !== "win32") {
    return spawnSync("npm", args, options);
  }
  return spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", npmCommand(args)], {
    ...options,
    windowsHide: true,
  });
}

function spawnNpm(args, options) {
  if (process.platform !== "win32") {
    return spawn("npm", args, { ...options, detached: true });
  }
  return spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", npmCommand(args)], {
    ...options,
    windowsHide: true,
  });
}

function npmCommand(args) {
  return ["npm", ...args.map((arg) => String(arg))].join(" ");
}

function runHub(tool, payload = {}) {
  const raw = JSON.stringify(payload);
  const b64 = Buffer.from(raw, "utf8").toString("base64");
  return JSON.parse(runNpm(["run", "-s", "hub", "--", "tools/call", tool, `base64:${b64}`]));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function isReachable(url) {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForUrl(url, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isReachable(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function ensureProcess(url, args, extraEnv = {}) {
  const child = spawnNpm(args, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...env, ...extraEnv },
  });
  spawned.push(child);
  child.stdout.on("data", () => undefined);
  child.stderr.on("data", () => undefined);
  await waitForUrl(url);
}

function cleanup() {
  for (const child of spawned) {
    if (!child.pid) continue;
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }
  }
  rmSync(tempDir, { recursive: true, force: true });
}

process.on("exit", cleanup);

async function assertNoDuplicateVisibleIssueCodes(scopeLabel) {
  const codes = (await page.locator(".linear-issue-row .issue-id").allTextContents())
    .map((code) => code.trim())
    .filter(Boolean);
  const duplicates = codes.filter((code, index) => codes.indexOf(code) !== index);
  assert(duplicates.length === 0, `Issue rows are duplicated in ${scopeLabel}: ${[...new Set(duplicates)].join(", ")}`);
}

async function waitForAppShell() {
  try {
    await page.locator(".linear-shell").waitFor({ state: "visible", timeout: 30000 });
  } catch (error) {
    await page.screenshot({ path: "test-results/ui-smoke-shell-timeout.png", fullPage: true }).catch(() => undefined);
    const html = await page.content().catch(() => "<page content unavailable>");
    throw new Error(
      `Timed out waiting for Claw Task Hub shell.\n` +
        `URL: ${page.url()}\n` +
        `Diagnostics:\n${pageDiagnostics.join("\n") || "(none)"}\n` +
        `HTML preview:\n${html.slice(0, 2000)}`,
      { cause: error },
    );
  }
}

try {
runNpm(["run", "-s", "seed"]);
runHub("save_issue", {
  id: "LOCAL-3",
  external_id: "LOCAL-3",
  identifier: "LOCAL-3",
  title: "Verify paused issue status",
  description: "Seeded by UI smoke to verify paused filtering and icon semantics.",
  project_id: "project_codex_task_hub_mvp",
  status: "Paused",
  priority: 2,
  labels: ["ui-smoke"],
  source: "local",
});
runHub("save_issue", {
  id: "LOCAL-4",
  external_id: "LOCAL-4",
  identifier: "LOCAL-4",
  title: "Verify todo issue status",
  description: "Seeded by UI smoke to verify todo filtering.",
  project_id: "project_codex_task_hub_mvp",
  status: "Todo",
  priority: 3,
  labels: ["ui-smoke"],
  source: "local",
});
runHub("save_comment", {
  issue_id: "LOCAL-1",
  body: "UI smoke seeded activity comment.",
  author: "UI Smoke",
  source: "local",
});

await ensureProcess(`http://127.0.0.1:${apiPort}/api/health`, ["run", "-s", "api"], { PORT: String(apiPort) });
await ensureProcess(`http://127.0.0.1:${webPort}/`, ["run", "-s", "dev:web", "--", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"]);

await page.goto(`http://127.0.0.1:${webPort}/`, { waitUntil: "domcontentloaded" });
await waitForAppShell();
await page.locator(".project-row").filter({ hasText: "Claw Task Hub MVP" }).first().waitFor({ state: "visible", timeout: 15000 });
await page.screenshot({ path: "test-results/linearish-projects.png", fullPage: true });
assert(await page.getByText("Projects", { exact: true }).first().isVisible(), "Projects heading is missing");
const publicProjectRow = page.locator(".project-row").filter({ hasText: "Claw Task Hub MVP" }).first();
assert(await publicProjectRow.isVisible(), "Project table row is missing");

await publicProjectRow.scrollIntoViewIfNeeded();
await publicProjectRow.click();
await page.locator(".project-hero h1", { hasText: "Claw Task Hub MVP" }).waitFor({ state: "visible", timeout: 15000 });
assert(await page.getByRole("button", { name: "Overview", exact: true }).isVisible(), "Overview tab is missing");
assert(await page.getByRole("button", { name: "Activity", exact: true }).isVisible(), "Activity tab is missing");
assert(await page.getByRole("button", { name: "Issues", exact: true }).isVisible(), "Issues tab is missing");
assert(await page.getByText("Properties").isVisible(), "Overview properties are missing");
assert(await page.getByText("Resources").isVisible(), "Overview resources are missing");
await page.screenshot({ path: "test-results/linearish-project-overview.png", fullPage: true });

await page.getByRole("button", { name: "Activity", exact: true }).click();
assert(await page.getByText("Write a project update...").isVisible(), "Activity update composer is missing");
assert(await page.locator(".timeline-row").first().isVisible(), "Activity timeline is missing");
await page.screenshot({ path: "test-results/linearish-project-activity.png", fullPage: true });

await page.getByRole("button", { name: "Issues", exact: true }).click();
await page.locator(".group-head").first().waitFor({ state: "visible", timeout: 10000 });
const issueGroupCount = await page.locator(".group-head").count();
assert(issueGroupCount > 0, "Issue status groups are missing");
const visibleGroupLabels = await page.locator(".group-head strong").allTextContents();
assert(
  visibleGroupLabels.some((label) => label.trim().length > 0),
  `Issue status group labels are empty; saw: ${visibleGroupLabels.join(", ")}`,
);
const issueRowCount = await page.locator(".linear-issue-row").count();
assert(issueRowCount > 0, "Linear-like issue rows are missing");
await assertNoDuplicateVisibleIssueCodes("seed project");
const createdTitle = `UI smoke routed issue ${Date.now()}`;
await page.locator(".linear-create input[name='title']").fill(createdTitle);
await page.locator(".linear-create input[name='description']").fill("Created from a project page to verify issue routing.");
await page.locator(".linear-create button").click();
await page.getByText(createdTitle, { exact: true }).waitFor({ state: "visible", timeout: 10000 });
const routedIssues = runHub("list_issues", {
  project_id: "project_codex_task_hub_mvp",
  query: createdTitle,
  limit: 10,
});
assert(routedIssues.issues.length === 1, `Project-page issue create did not create exactly one routed issue: ${routedIssues.issues.length}`);
assert(routedIssues.issues[0].project_id === "project_codex_task_hub_mvp", `Project-page issue was routed to the wrong project: ${routedIssues.issues[0].project_id}`);
const firstIssueCode = (await page.locator(".linear-issue-row .issue-id").first().textContent())?.trim() ?? "";
assert(/^[A-Z][A-Z0-9]{1,8}-\d{1,6}$/.test(firstIssueCode), `Issue code is not short/local: ${firstIssueCode}`);
await page.locator(".linear-issue-row").first().dblclick();
await page.locator(".issue-dialog").waitFor({ state: "visible", timeout: 10000 });
const dialogCode = (await page.locator(".issue-dialog .detail-top span").first().textContent())?.trim() ?? "";
assert(dialogCode === firstIssueCode, `Issue dialog opened the wrong issue: ${dialogCode} !== ${firstIssueCode}`);
await page.locator(".dialog-close").click();
await page.getByRole("button", { name: /Blockers/i }).click();
const blockerClass = await page.getByRole("button", { name: /Blockers/i }).getAttribute("class");
assert(blockerClass?.includes("active"), "Blockers filter did not become active");
await page.screenshot({ path: "test-results/linearish-project-issues.png", fullPage: true });

await page.getByRole("button", { name: "Paused", exact: true }).click();
const pausedButtonClass = await page.getByRole("button", { name: "Paused", exact: true }).getAttribute("class");
assert(pausedButtonClass?.includes("active"), "Paused filter did not become active");
const pausedFilterLabels = (await page.locator(".group-head strong").allTextContents()).map((label) => label.trim());
assert(pausedFilterLabels.length > 0, "Paused filter has no visible groups");
assert(
  pausedFilterLabels.every((label) => label === "Paused"),
  `Paused filter shows non-paused groups: ${pausedFilterLabels.join(", ")}`,
);
const pausedRows = await page.locator(".issue-group").evaluateAll((groups) => {
  const pausedGroup = groups.find((group) => group.querySelector(".group-head strong")?.textContent?.trim() === "Paused");
  if (!pausedGroup) return [];
  return [...pausedGroup.querySelectorAll(".linear-issue-row")]
    .map((row) => ({
      code: row.querySelector(".issue-id")?.textContent?.trim(),
      pausedIcons: row.querySelectorAll(".sicon.paused").length,
      blockerIcons: row.querySelectorAll(".sicon.blocker").length,
    }));
});
assert(pausedRows.length > 0, "seed project has no visible Paused issue to verify status icon semantics");
for (const row of pausedRows) {
  assert(row.pausedIcons === 1, `${row.code} does not show the Paused status icon`);
  assert(row.blockerIcons === 0, `${row.code} incorrectly shows a blocker icon`);
}
await page.getByRole("button", { name: "Backlog", exact: true }).click();
const backlogButtonClass = await page.getByRole("button", { name: "Backlog", exact: true }).getAttribute("class");
assert(backlogButtonClass?.includes("active"), "Backlog filter did not become active");
const backlogFilterLabels = (await page.locator(".group-head strong").allTextContents()).map((label) => label.trim());
assert(
  backlogFilterLabels.every((label) => label === "Backlog"),
  `Backlog filter shows non-backlog groups: ${backlogFilterLabels.join(", ")}`,
);
await page.getByRole("button", { name: "Todo", exact: true }).click();
const todoFilterLabels = (await page.locator(".group-head strong").allTextContents()).map((label) => label.trim());
assert(
  todoFilterLabels.every((label) => label === "Todo"),
  `Todo filter shows non-Todo groups: ${todoFilterLabels.join(", ")}`,
);

await browser.close();
console.log("UI smoke passed");
} finally {
  await browser.close().catch(() => undefined);
  cleanup();
}
