import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { platform } from "node:os";
import { finishSyncRun, getIssue, getSyncCheckpoint, listTruncatedLinearIssues, startSyncRun, upsertIssue, upsertProject, upsertTeam } from "../../server/store.js";

type McpText = { content?: { type: string; text: string }[] };
type LinearIssue = {
  id?: string;
  identifier?: string;
  title?: string;
  description?: string;
  status?: string;
  statusType?: string;
  priority?: number | { value?: number };
  project?: string | { name?: string };
  projectId?: string;
  teamId?: string;
  parentId?: string;
  assignee?: string | { name?: string };
  labels?: string[];
  url?: string;
  archivedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export function assertLinearImportAllowed(toolName = "Linear import") {
  if (process.env.CLAW_TASK_HUB_ALLOW_LINEAR_IMPORT !== "1") {
    throw new Error(`${toolName} is retired and disabled. Set CLAW_TASK_HUB_ALLOW_LINEAR_IMPORT=1 only for an explicit one-off legacy recovery run.`);
  }
}

function decodeToolResult(result: McpText) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) return result;
  return JSON.parse(text);
}

class LinearMcpSession {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private stdout = Buffer.alloc(0);
  private stderr = "";
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  constructor() {
    const command = process.env.CLAW_TASK_HUB_LINEAR_MCP_COMMAND ?? (platform() === "win32" ? "npx.cmd" : "npx");
    const args = [
      "-y",
      "mcp-remote",
      process.env.CLAW_TASK_HUB_LINEAR_MCP_URL ?? "https://mcp.linear.app/mcp",
      process.env.CLAW_TASK_HUB_LINEAR_MCP_CALLBACK_PORT ?? "3334",
      "--host",
      process.env.CLAW_TASK_HUB_LINEAR_MCP_HOST ?? "localhost",
      "--auth-timeout",
      process.env.CLAW_TASK_HUB_LINEAR_MCP_AUTH_TIMEOUT ?? "300",
    ];
    if (process.env.CLAW_TASK_HUB_LINEAR_MCP_ENABLE_PROXY === "1") {
      args.push("--enable-proxy");
    }
    this.child = spawn(command, args, {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout.on("data", (chunk) => {
      this.stdout = Buffer.concat([this.stdout, chunk]);
      this.parseMessages();
    });
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk.toString("utf8");
    });
    this.child.on("error", (error) => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
    });
  }

  async initialize() {
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "claw-task-hub-linear-import", version: "0.1.0" },
    }, 360000);
    this.notify("notifications/initialized", {});
  }

  async callTool(tool: string, args: Record<string, unknown> = {}) {
    const result = await this.request("tools/call", { name: tool, arguments: args }, 300000);
    return decodeToolResult(result as McpText);
  }

  close() {
    this.child.stdin.end();
    this.child.kill();
  }

  private write(message: unknown) {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private request(method: string, params: unknown, timeoutMs: number) {
    const id = this.nextId++;
    this.write({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout waiting for ${method}. stderr: ${this.stderr.slice(-3000)}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  private notify(method: string, params: unknown) {
    this.write({ jsonrpc: "2.0", method, params });
  }

  private parseMessages() {
    while (true) {
      const lineEnd = this.stdout.indexOf(Buffer.from("\n"));
      if (lineEnd < 0) return;
      const line = this.stdout.subarray(0, lineEnd).toString("utf8").replace(/\r$/, "");
      this.stdout = this.stdout.subarray(lineEnd + 1);
      let message: { id?: number; result?: unknown; error?: unknown };
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (!message.id || !this.pending.has(message.id)) continue;
      const pending = this.pending.get(message.id)!;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    }
  }
}

function isTruncatedLinearDescription(description: unknown) {
  return typeof description === "string" && description.includes("truncated, use `get_issue` for full description");
}

function priorityValue(priority: LinearIssue["priority"]) {
  return typeof priority === "number" ? priority : priority?.value ?? 3;
}

function projectName(project: LinearIssue["project"]) {
  return typeof project === "string" ? project : project?.name ?? "Imported Linear project";
}

function assigneeName(assignee: LinearIssue["assignee"]) {
  return typeof assignee === "string" ? assignee : assignee?.name;
}

async function hydrateIssueDescription(session: LinearMcpSession, issue: LinearIssue) {
  if (!isTruncatedLinearDescription(issue.description)) return { issue, hydrated: false };
  const fullIssue = await session.callTool("get_issue", { id: issue.id ?? issue.identifier });
  return { issue: { ...issue, ...fullIssue }, hydrated: true };
}

function saveLinearIssue(issue: LinearIssue) {
  if (issue.projectId && issue.project) {
    upsertProject({
      external_id: issue.projectId,
      name: projectName(issue.project),
      source: "linear",
    });
  }
  const existing = getIssue(issue.id ?? issue.identifier ?? "") as Record<string, unknown> | null;
  const existingDescription = typeof existing?.description === "string" ? existing.description : undefined;
  const incomingDescription = typeof issue.description === "string" ? issue.description : undefined;
  const description = !incomingDescription || isTruncatedLinearDescription(incomingDescription) ? existingDescription : incomingDescription;

  return upsertIssue({
    external_id: issue.id,
    identifier: issue.id?.startsWith("SAV-") ? issue.id : issue.identifier,
    title: issue.title ?? issue.id ?? "Untitled Linear issue",
    description,
    status: issue.status,
    status_type: issue.statusType,
    priority: priorityValue(issue.priority),
    project_id: issue.projectId,
    team_id: issue.teamId,
    parent_id: issue.parentId,
    assignee: assigneeName(issue.assignee),
    labels: issue.labels ?? [],
    source: "linear",
    url: issue.url,
    archived_at: issue.archivedAt,
    completed_at: issue.completedAt,
    created_at: issue.createdAt,
    updated_at: issue.updatedAt,
  });
}

export async function importLinear(limitPages = 1000) {
  assertLinearImportAllowed();
  const runId = startSyncRun("linear");
  const stats = { teams: 0, projects: 0, issues: 0, hydratedDescriptions: 0, hydrateFailures: 0, projectPages: 0, issuePages: 0, mode: "bootstrap" };
  let cursor: string | undefined;
  let maxUpdatedAt: string | undefined;
  const session = new LinearMcpSession();
  try {
    await session.initialize();
    const checkpoint = getSyncCheckpoint("linear");
    const updatedAfter = checkpoint?.cursor && /^\d{4}-\d{2}-\d{2}T/.test(checkpoint.cursor) ? checkpoint.cursor : undefined;
    if (updatedAfter) stats.mode = "incremental";

    const teamsResult = await session.callTool("list_teams", { limit: 250 });
    for (const team of teamsResult.teams ?? []) {
      upsertTeam({
        external_id: team.id,
        name: team.name,
        key: team.key,
        source: "linear",
        created_at: team.createdAt,
        updated_at: team.updatedAt,
      });
      stats.teams += 1;
    }

    let projectCursor: string | undefined;
    do {
      const projectsResult = await session.callTool("list_projects", { limit: 250, cursor: projectCursor });
      for (const project of projectsResult.projects ?? []) {
        upsertProject({
          external_id: project.id,
          name: project.name,
          summary: project.summary,
          description: project.description,
          status: project.status?.name ?? project.status?.type ?? "Backlog",
          priority: project.priority?.value ?? 3,
          lead: project.lead?.name,
          source: "linear",
          created_at: project.createdAt,
          updated_at: project.updatedAt,
          archived_at: project.archivedAt,
        });
        stats.projects += 1;
      }
      stats.projectPages += 1;
      projectCursor = projectsResult.cursor;
      if (!projectsResult.hasNextPage) break;
    } while (projectCursor);

    for (let page = 0; page < limitPages; page += 1) {
      const issuesResult = await session.callTool("list_issues", { limit: 250, cursor, includeArchived: true, ...(updatedAfter ? { updatedAt: updatedAfter } : {}) });
      for (const issue of issuesResult.issues ?? []) {
        let issueToSave = issue;
        try {
          const hydrated = await hydrateIssueDescription(session, issue);
          issueToSave = hydrated.issue;
          if (hydrated.hydrated) stats.hydratedDescriptions += 1;
        } catch {
          stats.hydrateFailures += 1;
        }
        if (issueToSave.projectId && issueToSave.project) stats.projects += 1;
        if (issueToSave.updatedAt && (!maxUpdatedAt || issueToSave.updatedAt > maxUpdatedAt)) maxUpdatedAt = issueToSave.updatedAt;
        saveLinearIssue(issueToSave);
        stats.issues += 1;
      }
      stats.issuePages += 1;
      cursor = issuesResult.cursor;
      if (!issuesResult.hasNextPage || !cursor) break;
    }
    finishSyncRun(runId, "completed", stats, maxUpdatedAt ?? updatedAfter);
    return { runId, stats, cursor: maxUpdatedAt ?? updatedAfter };
  } catch (error) {
    finishSyncRun(runId, "failed", stats, cursor, error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    session.close();
  }
}

export async function backfillLinearDescriptions(limit = 500) {
  assertLinearImportAllowed();
  const runId = startSyncRun("linear-description-backfill");
  const targets = listTruncatedLinearIssues(limit);
  const stats = { scanned: targets.length, repaired: 0, failed: 0, skipped: 0, failures: [] as { id: string; error: string }[] };
  const session = new LinearMcpSession();
  try {
    await session.initialize();
    for (const target of targets) {
      const linearId = target.external_id ?? target.identifier ?? target.id;
      try {
        const fullIssue = await session.callTool("get_issue", { id: linearId });
        if (isTruncatedLinearDescription(fullIssue.description)) {
          stats.skipped += 1;
          continue;
        }
        saveLinearIssue(fullIssue);
        stats.repaired += 1;
      } catch (error) {
        stats.failed += 1;
        stats.failures.push({ id: linearId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    finishSyncRun(runId, "completed", stats);
    return { runId, stats };
  } catch (error) {
    finishSyncRun(runId, "failed", stats, undefined, error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    session.close();
  }
}

