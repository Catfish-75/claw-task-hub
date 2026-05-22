import { claimIssue, dashboard, endAgentSession, getIssue, heartbeatAgentSession, listAgentSessions, listIssueClaims, listIssues, listProjects, listTeams, releaseIssueClaim, repairIssueInvariants, saveComment, startAgentSession, upsertIssue, upsertProject } from "./store.js";

const [, , mode, ...args] = process.argv;

function print(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(raw: string) {
  if (raw.startsWith("base64:")) {
    return JSON.parse(Buffer.from(raw.slice("base64:".length), "base64").toString("utf8"));
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    try {
      return JSON.parse(quotePowerShellObject(raw));
    } catch {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid JSON arguments: ${message}. On PowerShell, prefer base64:<base64-json>.`);
    }
  }
}

function quotePowerShellObject(raw: string) {
  return raw
    .replace(/([{,]\s*)([A-Za-z_][\w-]*)\s*:/g, '$1"$2":')
    .replace(/:\s*([^",{}\s][^,}]*)/g, (_match, value: string) => {
      const trimmed = value.trim();
      if (trimmed.startsWith("[") || trimmed.startsWith("{")) return `:${trimmed}`;
      if (/^-?\d+(\.\d+)?$/.test(trimmed) || /^(true|false|null)$/i.test(trimmed)) {
        return `:${trimmed.toLowerCase()}`;
      }
      return `:${JSON.stringify(trimmed)}`;
    });
}

function requireString(input: Record<string, unknown>, key: string, tool: string) {
  if (typeof input[key] !== "string" || !input[key]) {
    throw new Error(`${tool} requires ${key}`);
  }
}

try {
  if (mode === "tools/list") {
    print({
      tools: [
        "list_teams",
        "list_projects",
        "save_project",
        "list_issues",
        "get_issue",
        "save_issue",
        "save_comment",
        "dashboard",
        "start_agent_session",
        "heartbeat_agent_session",
        "end_agent_session",
        "list_agent_sessions",
        "claim_issue",
        "release_issue_claim",
        "list_issue_claims",
        "repair_issue_invariants",
      ],
    });
  } else if (mode === "tools/call") {
    const [tool, raw = "{}"] = args;
    const input = parseArgs(raw);
    if (tool === "list_teams") print({ teams: listTeams() });
    else if (tool === "list_projects") print({ projects: listProjects() });
    else if (tool === "save_project") print({ project: upsertProject(input) });
    else if (tool === "list_issues") print({ issues: listIssues(input) });
    else if (tool === "get_issue") {
      requireString(input, "id", "get_issue");
      print({ issue: getIssue(input.id) });
    }
    else if (tool === "save_issue") print({ issue: upsertIssue(input) });
    else if (tool === "save_comment") {
      requireString(input, "issue_id", "save_comment");
      if (typeof input.body !== "string" || !input.body) throw new Error("save_comment requires body");
      print({ comment: saveComment(input) });
    }
    else if (tool === "dashboard") print(dashboard());
    else if (tool === "start_agent_session") print({ session: startAgentSession(input) });
    else if (tool === "heartbeat_agent_session") print({ session: heartbeatAgentSession(input) });
    else if (tool === "end_agent_session") print(endAgentSession(input));
    else if (tool === "list_agent_sessions") print({ sessions: listAgentSessions(input) });
    else if (tool === "claim_issue") print(claimIssue(input));
    else if (tool === "release_issue_claim") print(releaseIssueClaim(input));
    else if (tool === "list_issue_claims") print({ claims: listIssueClaims(input) });
    else if (tool === "repair_issue_invariants") print(repairIssueInvariants());
    else throw new Error(`Unknown tool: ${tool}`);
  } else {
    console.error("Usage: npm run hub -- tools/list");
    console.error("   or: npm run hub -- tools/call list_issues '{\"limit\":10}'");
    console.error("   or: npm run hub -- tools/call list_issues base64:<base64-json>");
    process.exit(2);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
}
