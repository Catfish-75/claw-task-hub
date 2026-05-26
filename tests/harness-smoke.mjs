import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const tempDir = mkdtempSync(join(tmpdir(), "claw-task-hub-harness-"));
const env = { ...process.env, CLAW_TASK_HUB_DB: join(tempDir, "harness-smoke.sqlite") };
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function runNpm(args, input) {
  if (process.platform === "win32") {
    return spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", ["npm", ...args].join(" ")], {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
      input,
    });
  }
  return spawnSync(npm, args, { cwd: process.cwd(), env, encoding: "utf8", input });
}

function runNpmAsync(args) {
  const child = process.platform === "win32"
    ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", ["npm", ...args].join(" ")], {
      cwd: process.cwd(),
      env,
      windowsHide: true,
    })
    : spawn(npm, args, { cwd: process.cwd(), env });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  return new Promise((resolve) => {
    child.on("error", (error) => resolve({ status: null, error, stdout, stderr }));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function runHub(mode, tool, payload = {}) {
  const raw = JSON.stringify(payload);
  const b64 = Buffer.from(raw, "utf8").toString("base64");
  const args = mode === "tools/list"
    ? ["run", "-s", "hub", "--", "tools/list"]
    : ["run", "-s", "hub", "--", "tools/call", tool, `base64:${b64}`];
  const result = runNpm(args);
  if (result.status !== 0) {
    throw new Error(`hub ${tool ?? mode} failed\nerror:\n${result.error ?? ""}\nstdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`);
  }
  return JSON.parse(result.stdout);
}

async function runHubAsync(tool, payload = {}) {
  const raw = JSON.stringify(payload);
  const b64 = Buffer.from(raw, "utf8").toString("base64");
  const result = await runNpmAsync(["run", "-s", "hub", "--", "tools/call", tool, `base64:${b64}`]);
  if (result.status !== 0) {
    throw new Error(`hub ${tool} failed\nerror:\n${result.error ?? ""}\nstdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`);
  }
  return JSON.parse(result.stdout);
}

function runHubExpectFailure(tool, payload = {}) {
  const raw = JSON.stringify(payload);
  const b64 = Buffer.from(raw, "utf8").toString("base64");
  const started = Date.now();
  const result = runNpm(["run", "-s", "hub", "--", "tools/call", tool, `base64:${b64}`]);
  return { ...result, elapsedMs: Date.now() - started };
}

function runMigrationExpectFailure(args = ["import", "--pages", "1"]) {
  const started = Date.now();
  const result = runNpm(["run", "-s", "migrate:linear", "--", ...args]);
  return { ...result, elapsedMs: Date.now() - started };
}

function runMcpToolsList() {
  const input = [
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    "",
  ].join("\n");
  const result = runNpm(["run", "-s", "mcp"], input);
  if (result.status !== 0) {
    throw new Error(`mcp tools/list failed\nstdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`);
  }
  const messages = String(result.stdout ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("{"))
    .map((line) => JSON.parse(line));
  const toolsList = messages.find((message) => message.id === 2);
  if (!toolsList?.result?.tools) throw new Error(`mcp tools/list response missing tools:\n${result.stdout ?? ""}`);
  return toolsList.result.tools;
}

function runMcpToolExpectFailure(tool, payload = {}) {
  const input = [
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: payload } }),
    "",
  ].join("\n");
  const started = Date.now();
  const result = runNpm(["run", "-s", "mcp"], input);
  if (result.status !== 0) {
    throw new Error(`mcp ${tool} process failed\nstdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`);
  }
  const messages = String(result.stdout ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("{"))
    .map((line) => JSON.parse(line));
  const call = messages.find((message) => message.id === 2);
  return { message: call, elapsedMs: Date.now() - started };
}

function spawnNpm(args, extraEnv = {}) {
  const childEnv = { ...env, ...extraEnv };
  if (process.platform === "win32") {
    return spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", ["npm", ...args].join(" ")], {
      cwd: process.cwd(),
      env: childEnv,
      windowsHide: true,
    });
  }
  return spawn(npm, args, { cwd: process.cwd(), env: childEnv, detached: true });
}

async function stopProcessTree(child) {
  if (!child.pid) return;
  let settled = false;
  const exited = new Promise((resolve) => {
    child.once("exit", resolve);
    child.once("close", resolve);
  });
  exited.then(() => {
    settled = true;
  });
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
  if (!settled && process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1000))]);
  }
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

async function assertApiLinearImportAbsent() {
  const port = await getFreePort();
  const child = spawnNpm(["run", "-s", "api"], { PORT: String(port) });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (response.ok) break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (attempt === 59) throw new Error(`API did not start\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    }
    const response = await fetch(`http://127.0.0.1:${port}/api/import/linear`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert(response.status === 404, `normal API exposed Linear import route with ${response.status}`);
  } finally {
    await stopProcessTree(child);
  }
}

async function assertApiRejectsUnsafeBind() {
  const child = spawnNpm(["run", "-s", "api"], { CLAW_TASK_HUB_HOST: "0.0.0.0" });
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const status = await new Promise((resolve) => {
    child.on("close", resolve);
  });
  assert(status !== 0, "API unexpectedly allowed non-loopback bind without unsafe flag");
  assert(stderr.includes("Refusing to bind Claw Task Hub API"), "unsafe bind failure did not explain the local-first guard");
}

try {
  const tools = runHub("tools/list");
  assert(!tools.tools.includes("import_linear"), "import_linear must not be exposed to normal harness tools");
  assert(!tools.tools.includes("backfill_linear_descriptions"), "backfill_linear_descriptions must not be exposed to normal harness tools");
  for (const name of ["dashboard", "list_projects", "save_project", "save_issue", "get_issue", "save_comment", "start_agent_session", "claim_issue", "release_issue_claim"]) {
    assert(tools.tools.includes(name), `expected harness tool is missing: ${name}`);
  }
  const mcpTools = runMcpToolsList();
  const listIssuesSchema = mcpTools.find((tool) => tool.name === "list_issues")?.inputSchema?.properties;
  assert(listIssuesSchema?.include_done?.type === "boolean", "MCP list_issues schema does not advertise include_done:boolean");
  const saveIssueSchema = mcpTools.find((tool) => tool.name === "save_issue")?.inputSchema?.properties;
  assert(saveIssueSchema?.issue_id?.type === "string", "MCP save_issue schema does not advertise issue_id:string");
  assert(saveIssueSchema?.allow_no_project?.type === "boolean", "MCP save_issue schema does not advertise allow_no_project:boolean");
  const releaseClaimSchema = mcpTools.find((tool) => tool.name === "release_issue_claim")?.inputSchema?.properties;
  assert(releaseClaimSchema?.claim_id?.type === "string", "MCP release_issue_claim schema does not advertise claim_id:string");

  const dashboard = runHub("tools/call", "dashboard");
  assert(dashboard.counts.projects === 0, "fresh harness DB should start with no projects");

  const project = runHub("tools/call", "save_project", {
    name: "Harness Smoke Project",
    summary: "Temp project created by harness smoke.",
    source: "local",
  }).project;
  assert(project.id, "save_project did not return an id");
  const projects = runHub("tools/call", "list_projects").projects;
  assert(projects.some((item) => item.id === project.id), "list_projects did not return the saved project");

  const missingProjectFailure = runHubExpectFailure("save_issue", {
    title: "Harness issue without project must fail",
    status: "Todo",
  });
  assert(missingProjectFailure.status !== 0, "save_issue without project_id unexpectedly succeeded");
  assert(missingProjectFailure.stderr.includes("project_id is required when creating an issue"), "save_issue without project_id did not explain the project requirement");
  const invalidProjectFailure = runHubExpectFailure("save_issue", {
    title: "Harness issue with invalid project must fail",
    project_id: "missing-project",
    status: "Todo",
  });
  assert(invalidProjectFailure.status !== 0, "save_issue with invalid project_id unexpectedly succeeded");
  assert(invalidProjectFailure.stderr.includes("Project not found: missing-project"), "save_issue invalid project_id did not explain the missing project");

  const createdIssue = runHub("tools/call", "save_issue", {
    title: "Harness smoke issue",
    description: "Created through CLI fallback by an agentic harness smoke.",
    project_id: project.id,
    status: "Todo",
    priority: 2,
    labels: ["harness-smoke"],
    source: "local",
  }).issue;
  assert(/^[A-Z][A-Z0-9]{1,8}-\d{1,6}$/.test(createdIssue.identifier), `issue identifier is not short: ${createdIssue.identifier}`);

  const fetched = runHub("tools/call", "get_issue", { id: createdIssue.identifier }).issue;
  assert(fetched.id === createdIssue.id, "get_issue did not resolve the visible identifier");
  const issueIdAliasUpdate = runHub("tools/call", "save_issue", {
    issue_id: createdIssue.identifier,
    status: "In Progress",
    description: "Updated through save_issue issue_id alias.",
  }).issue;
  assert(issueIdAliasUpdate.id === createdIssue.id, "save_issue issue_id alias updated the wrong issue");
  assert(issueIdAliasUpdate.description === "Updated through save_issue issue_id alias.", "save_issue issue_id alias did not update description");
  const issueIdFailure = runHubExpectFailure("save_issue", {
    issue_id: "CTH-DOES-NOT-EXIST",
    title: "Wrong locator must not create a duplicate",
  });
  assert(issueIdFailure.status !== 0, "save_issue issue_id not-found unexpectedly succeeded");
  assert(issueIdFailure.stderr.includes("Issue not found: CTH-DOES-NOT-EXIST"), "save_issue issue_id not-found did not explain the missing issue");

  const firstComment = runHub("tools/call", "save_comment", {
    issue_id: createdIssue.identifier,
    external_id: "harness-smoke-comment",
    body: "First harness smoke comment.",
    author: "Harness Smoke",
    source: "local",
  }).comment;
  const secondComment = runHub("tools/call", "save_comment", {
    issue_id: createdIssue.identifier,
    external_id: "harness-smoke-comment",
    body: "Updated harness smoke comment.",
    author: "Harness Smoke",
    source: "local",
  }).comment;
  assert(secondComment.id === firstComment.id, "save_comment external_id was not idempotent");
  assert(secondComment.body === "Updated harness smoke comment.", "save_comment did not update the idempotent comment body");

  const session = runHub("tools/call", "start_agent_session", {
    id: "session-harness-smoke",
    agent_name: "Harness Smoke",
    harness: "CLI",
    ttl_minutes: 30,
  }).session;
  assert(session.id === "session-harness-smoke", "start_agent_session did not preserve requested session id");
  const claim = runHub("tools/call", "claim_issue", {
    issue_id: createdIssue.identifier,
    session_id: session.id,
    note: "Harness smoke owns this temp issue.",
    ttl_minutes: 30,
  }).claim;
  assert(claim.identifier === createdIssue.identifier, "claim_issue did not claim the expected issue");
  const claims = runHub("tools/call", "list_issue_claims", { issue_id: createdIssue.identifier }).claims;
  assert(claims.length === 1 && claims[0].id === claim.id, "list_issue_claims did not return the active smoke claim");
  const release = runHub("tools/call", "release_issue_claim", {
    claim_id: claim.id,
    status: "completed",
  });
  assert(release.released === true && release.claim.id === claim.id && release.claim.status === "completed", "release_issue_claim did not complete the claim by claim_id");
  const claimsAfterRelease = runHub("tools/call", "list_issue_claims", { issue_id: createdIssue.identifier }).claims;
  assert(!claimsAfterRelease.some((item) => item.id === claim.id), "list_issue_claims returned a completed claim after release");
  const claimsAfterStringFalse = runHub("tools/call", "list_issue_claims", {
    issue_id: createdIssue.identifier,
    include_released: "false",
  }).claims;
  assert(!claimsAfterStringFalse.some((item) => item.id === claim.id), "list_issue_claims include_released:\"false\" returned a completed claim");
  const claimHistory = runHub("tools/call", "list_issue_claims", {
    issue_id: createdIssue.identifier,
    include_released: "true",
  }).claims;
  assert(claimHistory.some((item) => item.id === claim.id && item.status === "completed" && item.released_at), "list_issue_claims include_released:\"true\" missed completed claim history");

  const completed = runHub("tools/call", "save_issue", {
    id: createdIssue.identifier,
    status: "Done",
  }).issue;
  assert(completed.status_type === "completed", "save_issue did not derive completed status_type");

  const activeIssue = runHub("tools/call", "save_issue", {
    title: "Harness active discovery issue",
    description: "Stays active so include_done:false can prove completed rows are excluded.",
    project_id: project.id,
    status: "In Progress",
    priority: 2,
    labels: ["harness-smoke"],
    source: "local",
  }).issue;
  const activeDiscovery = runHub("tools/call", "list_issues", {
    project_id: project.id,
    include_done: false,
    limit: 20,
  }).issues;
  assert(activeDiscovery.some((issue) => issue.id === activeIssue.id), "include_done:false missed an active issue");
  assert(!activeDiscovery.some((issue) => issue.id === completed.id), "include_done:false returned a completed issue");
  assert(activeDiscovery.every((issue) => issue.status_type !== "completed"), "include_done:false active discovery included completed status_type");
  const mixedActiveDiscovery = runHub("tools/call", "list_issues", {
    project_id: project.id,
    status_type: ["started", "backlog"],
    include_done: false,
    limit: 20,
  }).issues;
  assert(mixedActiveDiscovery.some((issue) => issue.id === activeIssue.id), "status_type array with include_done:false missed active issue");
  assert(!mixedActiveDiscovery.some((issue) => issue.id === completed.id), "status_type array with include_done:false returned completed issue");
  const completedSuppressed = runHub("tools/call", "list_issues", {
    project_id: project.id,
    status_type: ["completed"],
    include_done: false,
    limit: 20,
  }).issues;
  assert(completedSuppressed.length === 0, "include_done:false did not suppress explicit completed status_type");

  const concurrentCreates = await Promise.all(
    Array.from({ length: 8 }, (_item, index) =>
      runHubAsync("save_issue", {
        title: `Concurrent harness issue ${index + 1}`,
        description: "Created in parallel to verify automatic CTH identifier allocation is serialized.",
        project_id: project.id,
        status: "Todo",
        priority: 3,
        labels: ["harness-smoke", "concurrency"],
        source: "local",
      }),
    ),
  );
  const concurrentIdentifiers = concurrentCreates.map((result) => result.issue?.identifier);
  assert(concurrentIdentifiers.every((identifier) => /^[A-Z][A-Z0-9]{1,8}-\d{1,6}$/.test(identifier)), "concurrent create returned a non-short identifier");
  assert(new Set(concurrentIdentifiers).size === concurrentIdentifiers.length, `concurrent creates reused identifiers: ${concurrentIdentifiers.join(", ")}`);

  const linearFailure = runHubExpectFailure("import_linear", {});
  assert(linearFailure.status !== 0, "import_linear unexpectedly succeeded");
  assert(linearFailure.elapsedMs < 5000, "import_linear did not fail fast locally");
  assert(linearFailure.stderr.includes("Unknown tool: import_linear"), "import_linear failure did not explain missing normal-runtime tool");
  const linearMcpFailure = runMcpToolExpectFailure("import_linear", {});
  assert(linearMcpFailure.message?.error?.message?.includes("Unknown tool: import_linear"), "MCP import_linear failure did not explain missing normal-runtime tool");
  assert(linearMcpFailure.elapsedMs < 5000, "MCP import_linear did not fail fast locally");
  const backfillFailure = runHubExpectFailure("backfill_linear_descriptions", {});
  assert(backfillFailure.status !== 0, "backfill_linear_descriptions unexpectedly succeeded");
  assert(backfillFailure.elapsedMs < 5000, "backfill_linear_descriptions did not fail fast locally");
  assert(backfillFailure.stderr.includes("Unknown tool: backfill_linear_descriptions"), "backfill_linear_descriptions failure did not explain missing normal-runtime tool");
  const backfillMcpFailure = runMcpToolExpectFailure("backfill_linear_descriptions", {});
  assert(backfillMcpFailure.message?.error?.message?.includes("Unknown tool: backfill_linear_descriptions"), "MCP backfill_linear_descriptions failure did not explain missing normal-runtime tool");
  assert(backfillMcpFailure.elapsedMs < 5000, "MCP backfill_linear_descriptions did not fail fast locally");
  const migrationFailure = runMigrationExpectFailure();
  assert(migrationFailure.status !== 0, "standalone Linear migration unexpectedly succeeded without explicit gate");
  assert(migrationFailure.elapsedMs < 5000, "standalone Linear migration did not fail fast locally");
  assert(migrationFailure.stderr.includes("CLAW_TASK_HUB_ALLOW_LINEAR_IMPORT=1"), "standalone Linear migration failure did not explain the explicit gate");
  const migrationBackfillFailure = runMigrationExpectFailure(["backfill-descriptions", "--limit", "1"]);
  assert(migrationBackfillFailure.status !== 0, "standalone Linear backfill unexpectedly succeeded without explicit gate");
  assert(migrationBackfillFailure.elapsedMs < 5000, "standalone Linear backfill did not fail fast locally");
  assert(migrationBackfillFailure.stderr.includes("CLAW_TASK_HUB_ALLOW_LINEAR_IMPORT=1"), "standalone Linear backfill failure did not explain the explicit gate");
  await assertApiLinearImportAbsent();
  await assertApiRejectsUnsafeBind();

  console.log("Harness smoke passed");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
