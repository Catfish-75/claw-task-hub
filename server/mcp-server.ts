import { claimIssue, dashboard, endAgentSession, getIssue, heartbeatAgentSession, listAgentSessions, listIssueClaims, listIssues, listProjects, listTeams, releaseIssueClaim, repairIssueInvariants, saveComment, startAgentSession, upsertIssue, upsertProject } from "./store.js";

let stdin = Buffer.alloc(0);

function write(message: unknown) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function tool(name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []) {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
  };
}

const tools = [
  tool("dashboard", "Return local Claw Task Hub dashboard counts."),
  tool("list_teams", "List local teams."),
  tool("list_projects", "List local projects."),
  tool("save_project", "Create or update a local project.", {
    name: { type: "string" },
    summary: { type: "string" },
    description: { type: "string" },
    status: { type: "string" },
    priority: { type: "number" },
  }, ["name"]),
  tool("list_issues", "List local issues with optional filters.", {
    project: { type: "string" },
    project_id: { type: "string" },
    team: { type: "string" },
    team_id: { type: "string" },
    status: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
    status_type: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
    include_done: { type: "boolean" },
    query: { type: "string" },
    limit: { type: "number" },
    offset: { type: "number" },
  }),
  tool("get_issue", "Get one local issue by id, external id, or identifier.", {
    id: { type: "string" },
  }, ["id"]),
  tool("save_issue", "Create or update a local issue. New issues require the owning project_id from list_projects; Claw Task Hub never guesses a default project. Title is the human-readable task name, not an issue code. Short local identifiers like CTH-001 are assigned automatically unless a valid imported identifier is provided. Updates can use issue_id, id, external_id, or identifier with partial fields. Use allow_no_project:true only for a deliberate unassigned inbox issue.", {
    id: { type: "string" },
    external_id: { type: "string" },
    identifier: { type: "string" },
    issue_id: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    status: { type: "string" },
    status_type: { type: "string" },
    priority: { type: "number" },
    project_id: { type: "string" },
    allow_no_project: { type: "boolean" },
    team_id: { type: "string" },
    labels: { type: "array", items: { type: "string" } },
  }),
  tool("save_comment", "Create a local comment on an open issue. issue_id accepts the internal id, external id, or visible identifier such as CTH-212. Done, Canceled, and archived issues require allow_closed=true for deliberate historical maintenance.", {
    id: { type: "string" },
    external_id: { type: "string" },
    issue_id: { type: "string" },
    body: { type: "string" },
    author: { type: "string" },
    source: { type: "string" },
    allow_closed: { type: "boolean" },
  }, ["issue_id", "body"]),
  tool("start_agent_session", "Start or renew an agent work session for claim coordination.", {
    id: { type: "string" },
    agent_name: { type: "string" },
    harness: { type: "string" },
    ttl_minutes: { type: "number" },
    metadata: { type: "object" },
  }, ["agent_name"]),
  tool("heartbeat_agent_session", "Renew an active agent session lease.", {
    session_id: { type: "string" },
    ttl_minutes: { type: "number" },
  }, ["session_id"]),
  tool("end_agent_session", "End an agent session and release its active claims by default.", {
    session_id: { type: "string" },
    release_claims: { type: "boolean" },
  }, ["session_id"]),
  tool("list_agent_sessions", "List agent sessions.", {
    include_ended: { type: "boolean" },
    limit: { type: "number" },
  }),
  tool("claim_issue", "Claim an open issue for an active agent session. Fails if the issue is Done, Canceled, or archived unless allow_closed=true is passed for deliberate historical maintenance. Fails if another live claim exists unless force=true.", {
    issue_id: { type: "string" },
    session_id: { type: "string" },
    note: { type: "string" },
    ttl_minutes: { type: "number" },
    force: { type: "boolean" },
    allow_closed: { type: "boolean" },
  }, ["issue_id", "session_id"]),
  tool("release_issue_claim", "Release or complete an active issue claim. Agents may pass claim_id directly, or issue_id plus session_id.", {
    claim_id: { type: "string" },
    issue_id: { type: "string" },
    session_id: { type: "string" },
    status: { type: "string" },
    force: { type: "boolean" },
  }),
  tool("list_issue_claims", "List active or historical issue claims.", {
    issue_id: { type: "string" },
    session_id: { type: "string" },
    include_released: { type: "boolean" },
    limit: { type: "number" },
  }),
  tool("repair_issue_invariants", "Normalize stored issue status_type, completed_at, and labels for legacy rows."),
];

async function callTool(name: string, args: Record<string, unknown>) {
  if (name === "dashboard") return dashboard();
  if (name === "list_teams") return { teams: listTeams() };
  if (name === "list_projects") return { projects: listProjects() };
  if (name === "save_project") return { project: upsertProject(args as { name: string }) };
  if (name === "list_issues") return { issues: listIssues(args) };
  if (name === "get_issue") return { issue: getIssue(String(args.id)) };
  if (name === "save_issue") return { issue: upsertIssue(args as { title: string }) };
  if (name === "save_comment") return { comment: saveComment(args as { issue_id: string; body: string; author?: string }) };
  if (name === "start_agent_session") return { session: startAgentSession(args as { agent_name: string }) };
  if (name === "heartbeat_agent_session") return { session: heartbeatAgentSession(args as { session_id: string }) };
  if (name === "end_agent_session") return endAgentSession(args as { session_id: string });
  if (name === "list_agent_sessions") return { sessions: listAgentSessions(args) };
  if (name === "claim_issue") return claimIssue(args as { issue_id: string; session_id: string });
  if (name === "release_issue_claim") return releaseIssueClaim(args as Parameters<typeof releaseIssueClaim>[0]);
  if (name === "list_issue_claims") return { claims: listIssueClaims(args) };
  if (name === "repair_issue_invariants") return repairIssueInvariants();
  throw new Error(`Unknown tool: ${name}`);
}

async function handle(message: { id?: number; method?: string; params?: Record<string, unknown> }) {
  if (!message.id && message.method === "notifications/initialized") {
    return;
  }
  try {
    if (message.method === "initialize") {
      write({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "claw-task-hub", version: "0.1.0" },
        },
      });
    } else if (message.method === "tools/list") {
      write({ jsonrpc: "2.0", id: message.id, result: { tools } });
    } else if (message.method === "tools/call") {
      const params = message.params as { name: string; arguments?: Record<string, unknown> };
      const result = await callTool(params.name, params.arguments ?? {});
      write({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
    } else {
      write({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Unknown method: ${message.method}` } });
    }
  } catch (error) {
    write({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } });
  }
}

process.stdin.on("data", (chunk) => {
  stdin = Buffer.concat([stdin, chunk]);
  while (true) {
    const lineEnd = stdin.indexOf(Buffer.from("\n"));
    if (lineEnd < 0) return;
    const line = stdin.subarray(0, lineEnd).toString("utf8").replace(/\r$/, "");
    stdin = stdin.subarray(lineEnd + 1);
    if (!line.trim()) continue;
    try {
      const message = JSON.parse(line);
      void handle(message);
    } catch (error) {
      write({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: error instanceof Error ? `Parse error: ${error.message}` : "Parse error",
        },
      });
    }
  }
});

process.stderr.write("Claw Task Hub MCP server ready.\n");
