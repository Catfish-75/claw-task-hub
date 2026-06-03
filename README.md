# Claw Task Hub

Claw Task Hub is a local-first, Linear-like task hub designed primarily for AI agents and agentic harnesses. Humans can use the familiar issue-tracker UI, but the durable contract is optimized for agents that need deterministic project, issue, comment, session, claim, and acceptance-trail workflows.

It is designed for autonomous and semi-autonomous workflows across MCP-compatible agents, CLIs, and local automation runtimes.

Normal operation is independent of external ticketing services. Optional history import tools, where available, are operator-only utilities and are not part of the normal API, MCP server, or hub CLI.

## Quick Start

Prerequisites:

- Node.js 24 or newer
- npm

### No-command desktop launch

Download the repository from GitHub, extract it, then start Claw Task Hub from the repository folder:

- Windows: double-click `Launch Claw Task Hub.vbs`.
- macOS/Linux: double-click `Launch Claw Task Hub.command` where your file manager supports executable command files.

On the first launch, the launcher installs dependencies if needed, starts the local API and UI in the background, and opens the browser at:

```text
http://localhost:5173
```

To create a one-click shortcut for a specific project:

1. Open the project in Claw Task Hub.
2. Click the link icon in the project header.
3. Save the downloaded `.url` shortcut in the project folder, desktop, or bookmarks folder.
4. Use that shortcut next time to open directly to the project issues page.

### Advanced command-line launch

Agentic harnesses and developers can still install and run Claw Task Hub from a shell:

```powershell
git clone https://github.com/Catfish-75/claw-task-hub.git
cd claw-task-hub
npm ci
npm run dev
```

For a controlled pilot on Linux or macOS, do not background `npm run dev` with plain `nohup`. Some shells and harnesses still terminate the child process when the parent shell exits. Use the supplied detached launcher instead:

```bash
npm run pilot:start
npm run pilot:status
npm run pilot:stop
```

The pilot launcher prefers `setsid`, writes logs under `logs/`, records a PID file, waits for UI/API readiness, and stops the whole process group so the API and Vite server do not become orphaned.

Check the local API from a shell:

```powershell
npm run hub -- tools/call dashboard "{}"
```

PowerShell note: for any payload that contains human text, Markdown, quotes, or newlines, do not pass raw JSON directly to `tools/call`. Use the `base64:<json>` transport shown below, or use the wrapper:

```powershell
$payload = @{
  issue_id = "demo-agent-issue"
  body = @'
Accepted: quotes like "this" and Markdown `ticks` are safe here.
'@
  author = "Demo Agent"
  source = "local"
}
.\tools\cth-call.ps1 -Tool save_comment -InputObject $payload
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

`claim_issue` and `save_comment` are intentionally conservative for agent workflows: `Done`, `Canceled`, and archived issues cannot be claimed or commented on by default. Reopen the issue first; use `allow_closed:true` only for deliberate historical maintenance.

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
- `save_context_binding`
- `get_context_binding`
- `list_context_bindings`
- `resolve_context_project`
- `delete_context_binding`

For active work discovery, call `list_issues` with `include_done:false` so completed records are excluded using normalized status semantics.

The MCP server can be started with:

```powershell
npm run mcp
```

## Project-Bound Links

Claw Task Hub supports durable project bindings for agentic harnesses. A binding maps a local context, such as a repository, working directory, thread id, or harness-specific key, to the project that should open by default.

For humans, the simplest project-bound path is the UI shortcut:

1. Open the project once in Claw Task Hub.
2. Click the link icon in the project header.
3. Save the generated `.url` file next to the local project or on the desktop.
4. Double-click that file later to open the same project directly.

For Codex and similar local harnesses, use a context binding instead of opening bare `http://localhost:5173`. Bare localhost opens the global Projects page; a binding resolves the current workspace and opens the project-specific URL.

Create a local project, bind a workspace, write a shortcut, and open the UI:

```powershell
npm run open:context -- --harness codex --cwd C:/work/demo-agent-project --project-name "Demo Agent Project" --create-project --write-shortcut --open
```

Bind an existing project and open it:

```powershell
npm run open:context -- --harness codex --cwd C:/work/demo-agent-project --project-id demo-agent-project --write-shortcut --open
```

Open an already-bound Codex workspace:

```powershell
npm run codex:open -- --cwd C:/work/demo-agent-project
```

The command prints JSON with `url`, `url_path`, `project`, and `context_key`. With `--write-shortcut`, it also writes `Open Claw Task Hub.url` into the workspace so a human or agent can open the right project in one click later.

Create a binding:

```powershell
$json = '{"context_key":"codex:demo-agent-project","project_id":"demo-agent-project","default_tab":"issues","harness":"codex","cwd":"C:/work/demo-agent-project","repo_remote":"https://github.com/example/demo-agent-project.git","branch":"main"}'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
npm run hub -- tools/call save_context_binding "base64:$b64"
```

Resolve it later:

```powershell
$json = '{"context_key":"codex:demo-agent-project"}'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
npm run hub -- tools/call resolve_context_project "base64:$b64"
```

The UI accepts stable deep links:

- `/projects/<project-id>/overview`
- `/projects/<project-id>/activity`
- `/projects/<project-id>/issues`
- `/issues/<issue-id-or-identifier>`
- `/contexts/<context-key>/issues`
- `/workspace/issues`

Context bindings are local metadata. They must not contain passwords, tokens, cookies, or private keys. Repository remotes are normalized to remove URL credentials before storage.

## Local Data

Claw Task Hub uses SQLite with WAL mode, indexes, and FTS5 search.

Schema initialization is deterministic. `server/db.ts` creates the bootstrap schema and records applied versions in the `schema_migrations` table. The first migration, `0001_baseline_schema`, is a baseline record for the current schema. Future schema changes should be added as explicit migrations and must be idempotent on existing local databases.

Default database path:

- `data/claw-task-hub.sqlite`

Environment variables:

- `CLAW_TASK_HUB_DB`: preferred SQLite database override
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

`harness-smoke` proves the core agent workflow works without the browser UI or external ticketing services.
`ui-smoke` starts an isolated temporary database, API server, and Vite UI on free local ports. Its first run may download the Playwright Chromium browser.

## Documentation

- Agent and harness contract: [docs/AGENTIC_HARNESS.md](docs/AGENTIC_HARNESS.md)
- Optional history import from Linear: [docs/LINEAR_MIGRATION.md](docs/LINEAR_MIGRATION.md)
- Launch kit and announcement drafts: [docs/LAUNCH.md](docs/LAUNCH.md)
- Public release readiness: [docs/GITHUB_OSS_READINESS.md](docs/GITHUB_OSS_READINESS.md)
- MVP acceptance: [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- Security: [SECURITY.md](SECURITY.md)

## Feedback

Use GitHub Discussions for general feedback, agent workflow ideas, and integration notes. Use issues for reproducible bugs, feature requests, and harness integration work.
