# Claw Task Hub

Claw Task Hub is a local-first, Linear-like task hub designed primarily for AI agents and agentic harnesses. Humans can use the UI, but the durable contract is optimized for agents that need deterministic project, issue, comment, session, claim, and acceptance-trail workflows.

The MVP started in a Codex workflow, but it is not Codex-specific. Codex, Claude Code, OpenClaw, Hermes, and other compatible runners should be able to use the same local task hub.

Linear is retired for active work. Existing imported `SAV-*` records are local history only. Normal operation must not connect to Linear, refresh Linear imports, or require a Linear account.

For users who already have Linear history, the optional migration path is a separate operator tool documented in [docs/LINEAR_MIGRATION.md](docs/LINEAR_MIGRATION.md). It is not part of the normal API, MCP server, or hub CLI.

## Quick Start

Prerequisites:

- Node.js 24 or newer
- npm

Install and run:

```powershell
git clone https://github.com/Catfish-75/claw-task-hub.git
cd claw-task-hub
npm ci
npm run dev
```

Open the UI:

```text
http://localhost:5173
```

Check the local API:

```powershell
npm run hub -- tools/call dashboard "{}"
```

The API binds to `127.0.0.1:4781` by default. This is intentional: Claw Task Hub is a local app, not a public network service.

## First Agent Workflow

List the tool surface:

```powershell
npm run hub -- tools/list
```

Create a project:

```powershell
$json = '{"external_id":"demo-agent-project","name":"Demo Agent Project","summary":"Local task flow for an agent.","source":"local"}'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
npm run hub -- tools/call save_project "base64:$b64"
```

Create an issue:

```powershell
$json = '{"external_id":"demo-agent-issue","title":"Verify local task lifecycle","description":"Create, claim, comment, release, and close one local issue.","project_id":"demo-agent-project","status":"Todo","priority":2,"labels":["demo"],"source":"local"}'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
npm run hub -- tools/call save_issue "base64:$b64"
```

New issues must include the owning `project_id` from `list_projects`. Claw Task Hub does not infer a default project; this prevents agents from filing work into the wrong project by accident. Use `allow_no_project:true` only for a deliberate unassigned inbox issue.

Start a session and claim the issue:

```powershell
$json = '{"id":"session-demo-agent","agent_name":"Demo Agent","harness":"CLI","ttl_minutes":60}'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
npm run hub -- tools/call start_agent_session "base64:$b64"

$json = '{"issue_id":"demo-agent-issue","session_id":"session-demo-agent","note":"Running the first local workflow.","ttl_minutes":60}'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
npm run hub -- tools/call claim_issue "base64:$b64"
```

Add acceptance evidence and close:

```powershell
$json = '{"issue_id":"demo-agent-issue","body":"Accepted: local create, claim, comment, and close workflow was verified.","author":"Demo Agent","source":"local"}'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
npm run hub -- tools/call save_comment "base64:$b64"

$json = '{"id":"demo-agent-issue","status":"Done","status_type":"completed"}'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
npm run hub -- tools/call save_issue "base64:$b64"

$json = '{"issue_id":"demo-agent-issue","session_id":"session-demo-agent","status":"completed"}'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
npm run hub -- tools/call release_issue_claim "base64:$b64"
```

The example uses stable demo external IDs so it can be copied more than once without creating duplicate records. In real agent work, use the visible identifier returned by `save_issue`, such as `CTH-272`.

## Agent Tool Surface

The CLI and MCP tool names are intentionally stable and harness-friendly:

- `dashboard`
- `list_teams`
- `list_projects`
- `save_project`
- `list_issues`
- `get_issue`
- `save_issue`
- `save_comment`
- `start_agent_session`
- `heartbeat_agent_session`
- `end_agent_session`
- `list_agent_sessions`
- `claim_issue`
- `release_issue_claim`
- `list_issue_claims`
- `repair_issue_invariants`

For active work discovery, call `list_issues` with `include_done:false` so completed records are excluded using normalized status semantics.

The MCP server can be started with:

```powershell
npm run mcp
```

Some existing local hosts may still use the compatibility MCP server id `codex_task_hub`. Treat it as an alias for Claw Task Hub until host-level configs are migrated.

## Local Data

Claw Task Hub uses SQLite with WAL mode, indexes, and FTS5 search.

Schema initialization is deterministic. `server/db.ts` creates the bootstrap schema and records applied versions in the `schema_migrations` table. The first migration, `0001_baseline_schema`, is a baseline record for the current schema. Future schema changes should be added as explicit migrations and must be idempotent on existing local databases.

Default database paths:

- New installs: `data/claw-task-hub.sqlite`
- Existing compatibility installs: `data/codex-task-hub.sqlite` when that legacy file already exists

Environment variables:

- `CLAW_TASK_HUB_DB`: preferred SQLite database override
- `CODEX_TASK_HUB_DB`: legacy compatibility override
- `PORT`: API port, default `4781`
- `CLAW_TASK_HUB_HOST`: API host, default `127.0.0.1`
- `CLAW_TASK_HUB_CORS_ORIGINS`: optional comma-separated list of extra allowed browser origins
- `CLAW_TASK_HUB_UNSAFE_BIND=1`: required to bind the API to a non-loopback host
- `VITE_CLAW_TASK_HUB_API_BASE`: browser API base override for custom UI/API ports

Do not expose a non-loopback Claw Task Hub API without adding your own authentication, authorization, and network controls.

## Verification

Run the release-oriented local gate:

```powershell
npm run build
npm run lint
npm run store-regression
npm run harness-smoke
npm run ui-smoke
npm run public-hygiene
```

`harness-smoke` proves the core agent workflow works without the UI and without Linear.
`ui-smoke` starts an isolated temporary database, API server, and Vite UI on free local ports. Its first run may download the Playwright Chromium browser.

## Documentation

- Agent and harness contract: [docs/AGENTIC_HARNESS.md](docs/AGENTIC_HARNESS.md)
- Optional legacy Linear migration: [docs/LINEAR_MIGRATION.md](docs/LINEAR_MIGRATION.md)
- Launch kit and announcement drafts: [docs/LAUNCH.md](docs/LAUNCH.md)
- Public release readiness: [docs/GITHUB_OSS_READINESS.md](docs/GITHUB_OSS_READINESS.md)
- MVP acceptance: [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- Security: [SECURITY.md](SECURITY.md)

## Feedback

Use GitHub Discussions for general feedback, agent workflow ideas, and integration notes. Use issues for reproducible bugs, feature requests, and harness integration work.
