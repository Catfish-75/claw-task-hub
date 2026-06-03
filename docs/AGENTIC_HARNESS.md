# Agentic Harness Contract

Claw Task Hub is a local, Linear-like task system for AI agents first and human operators second. Humans get a familiar issue-tracker flow, but the durable contract is built for agentic harnesses, MCP-compatible clients, CLIs, and other local automation runtimes.

This document is the canonical contract for agents and harness authors.

## Source Of Truth

- The local SQLite database is the durable source of truth.
- Normal operation is independent of external ticketing services. Do not connect to external trackers as an active fallback during Claw Task Hub work.
- Imported records from prior systems are local history and can still be updated locally when work continues.
- New work should be created in Claw Task Hub with local identifiers.

## Local Deployment Boundary

- The public MVP is local-first and binds the API to loopback by default.
- Non-loopback binding requires `CLAW_TASK_HUB_UNSAFE_BIND=1` and is not a secure hosted deployment by itself.
- Harnesses should connect through local stdio MCP or local HTTP only unless the operator has added separate authentication and network controls.
- The browser UI expects the local API unless a downstream distribution intentionally changes that deployment model.

## Controlled Pilot Startup

For interactive development, `npm run dev` is enough. For a controlled pilot on Linux or macOS, harnesses should not launch `npm run dev` through plain `nohup`: some parent shells still terminate the process tree when the shell exits.

Use the supplied detached pilot launcher:

```bash
npm run pilot:start
npm run pilot:status
npm run pilot:stop
```

Launcher behavior:

- prefers `setsid` to detach the server from the parent shell;
- falls back to `nohup` only when `setsid` is unavailable;
- writes logs and the PID file under `logs/`;
- waits for both UI and API readiness;
- stops the process group first, then the parent PID if needed.

Optional environment overrides:

- `CLAW_TASK_HUB_LOG_DIR`
- `CLAW_TASK_HUB_PID_FILE`
- `CLAW_TASK_HUB_UI_URL`
- `CLAW_TASK_HUB_API_URL`

## Identity Model

Each issue has three identity fields:

- `id`: internal stable row id, often `issue_*` for local rows.
- `identifier`: short visible code such as `CTH-267`, `LOCAL-1`, or another imported legacy identifier.
- `external_id`: optional foreign-system id for imported or mirrored records.

Agents should use the visible `identifier` in conversation and comments. Tool calls may pass `id`, `external_id`, or `identifier` when updating or reading an existing issue.

New local issues should normally omit `identifier`; Claw Task Hub assigns the next short local code. The issue title must be a short human-readable task name, not a synthetic code.

## Issue Lifecycle

Use these statuses unless a project has a documented local exception:

- `Backlog`: valid work that is not ready to start.
- `Todo`: ready to start when an agent or human takes it.
- `In Progress`: currently owned by an active worker.
- `Blocked`: cannot continue without an explicit external dependency.
- `Paused`: intentionally suspended by policy, timing, owner decision, or a non-urgent dependency.
- `Done`: accepted and no longer active.
- `Canceled`: closed because it should not be done.

`status_type` must match the status:

- `backlog`: `Backlog`
- `unstarted`: `Todo`
- `started`: `In Progress`
- `blocked`: `Blocked`
- `paused`: `Paused`
- `completed`: `Done`
- `canceled`: `Canceled`

When a task is done, write an acceptance comment before or while moving it to `Done`.

## Agent Write Rules

Agents must:

- Create an issue before doing non-trivial work.
- Set `parent_id` when the task is a slice of a larger issue or epic.
- Keep titles concise and task-like.
- Put detailed context, acceptance criteria, evidence, and blockers in `description` or comments.
- Use comments as the acceptance trail.
- Preserve existing project, team, parent, source, URL, and imported metadata unless intentionally changing them.
- Prefer idempotent updates with stable `external_id` for repeated comments or generated records.
- End work by setting the final issue status and writing verification evidence.

Agents must not:

- Store passwords, OAuth tokens, private keys, cookies, or raw secret values in issues or comments.
- Store passwords, OAuth tokens, private keys, cookies, or raw secret values in context binding metadata.
- Reconnect to an external tracker as an active fallback for Claw Task Hub work.
- Invent long code-like issue titles such as `LOCAL_SAV_...` when a short identifier already exists.
- Mark work `Done` without verification or an explicit owner decision.
- Reassign or close another active agent's issue without reading the current comments and status.

## Project Context Binding

Harnesses should bind their local execution context to a Claw Task Hub project once, then resolve that binding on every new or resumed session. This prevents agents from filing work into the wrong project and lets the UI open directly to the correct project after a browser refresh.

### Codex Workspace Launcher

Codex users should not rely on opening bare `http://localhost:5173` from the side panel. That URL is intentionally the global Projects page. Use the workspace launcher so Codex opens the project that matches the current working directory.

Create a local project for a workspace, bind it, write a shortcut, and open the UI:

```powershell
npm run open:context -- --harness codex --cwd C:/work/my-repo --project-name "My Repo" --create-project --write-shortcut --open
```

Bind an existing Claw Task Hub project:

```powershell
npm run open:context -- --harness codex --cwd C:/work/my-repo --project-id project_my_repo --write-shortcut --open
```

Open an already-bound workspace:

```powershell
npm run codex:open -- --cwd C:/work/my-repo
```

The command returns JSON with the resolved `url`, `url_path`, `project`, and `context_key`. Agents can read that URL and hand it to the harness browser. Humans can use the generated `Open Claw Task Hub.url` shortcut. Other harnesses can use the same command by changing `--harness`.

A context binding can include:

- `context_key`: a stable harness-defined key, for example `codex:C:/work/my-repo` or `claude-code:repo:example/my-repo`.
- `project_id`: the owning Claw Task Hub project id from `list_projects`.
- `default_tab`: `overview`, `activity`, or `issues`; use `issues` for most agent work.
- `harness`: the agentic harness name.
- `cwd`: current working directory.
- `repo_remote`: repository remote URL; URL credentials are stripped before storage.
- `branch`: branch name.
- `thread_id`: optional harness thread/session id.
- `metadata`: non-secret structured hints for the harness.

Create or update a binding:

```powershell
$json = '{"context_key":"codex:C:/work/my-repo","project_id":"project_my_repo","default_tab":"issues","harness":"codex","cwd":"C:/work/my-repo","repo_remote":"https://github.com/example/my-repo.git","branch":"main"}'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
npm run hub -- tools/call save_context_binding "base64:$b64"
```

Resolve by exact key:

```powershell
$json = '{"context_key":"codex:C:/work/my-repo"}'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
npm run hub -- tools/call resolve_context_project "base64:$b64"
```

Resolve by repository or working directory when the exact key is unavailable:

```powershell
$json = '{"harness":"codex","cwd":"C:/work/my-repo","repo_remote":"https://github.com/example/my-repo.git","branch":"main"}'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
npm run hub -- tools/call resolve_context_project "base64:$b64"
```

Resolution order is deterministic: exact `context_key`, then `thread_id`, `cwd`, `repo_remote + branch`, `repo_remote`, and finally harness-scoped fallbacks. A resolved binding returns `project`, `binding`, and `url_path`.

UI deep links:

- `/projects/<project-id>/overview`
- `/projects/<project-id>/activity`
- `/projects/<project-id>/issues`
- `/issues/<issue-id-or-identifier>`
- `/contexts/<context-key>/issues`
- `/workspace/issues`

## CLI Fallback

When MCP tools are not injected, run commands from the repository root.

PowerShell rule: never pass raw JSON to `tools/call` when the payload contains human-written text, Markdown, quotes, or newlines. Do not retry by hand-escaping quotes. Use `base64:<json>` or the wrapper below:

```powershell
$payload = @{
  issue_id = "CTH-267"
  body = @'
Accepted: comments can contain "quotes", `ticks`, and multiple lines.
'@
  author = "Demo Agent"
  source = "local"
}
.\tools\cth-call.ps1 -Tool save_comment -InputObject $payload
```

Dashboard:

```powershell
npm run hub -- tools/call dashboard "{}"
```

List projects:

```powershell
npm run hub -- tools/call list_projects "{}"
```

Project routing is mandatory for new issues. Always select the owning project from `list_projects` and pass its `project_id` to `save_issue`. Do not copy a project id from an unrelated example or another project. Claw Task Hub intentionally rejects new issues with no project or an unknown project; `allow_no_project:true` is only for a deliberate unassigned inbox issue.

List open issues in a selected project:

```powershell
$json = '{"project_id":"<target-project-id>","include_done":false,"limit":50}'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
npm run hub -- tools/call list_issues "base64:$b64"
```

For active-work discovery, pass `include_done:false`. This excludes normalized `completed` issues even if old imported rows have inconsistent raw status metadata.

Create a local issue:

```powershell
$json = '{"title":"Document agentic harness contract","description":"Write the canonical harness contract and link it from README and AGENTS.","project_id":"<target-project-id>","team_id":"team_local","parent_id":"LOCAL-1","priority":1,"status":"Todo","status_type":"unstarted","labels":["agentic-harness","docs"],"source":"local"}'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
npm run hub -- tools/call save_issue "base64:$b64"
```

Move an issue to active work:

```powershell
$json = '{"id":"CTH-267","status":"In Progress","status_type":"started"}'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
npm run hub -- tools/call save_issue "base64:$b64"
```

Add an acceptance comment:

```powershell
$json = '{"issue_id":"CTH-267","body":"Accepted: documentation exists, links are updated, build and regression checks pass.","author":"Demo Agent","source":"local"}'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
npm run hub -- tools/call save_comment "base64:$b64"
```

Close an issue:

```powershell
$json = '{"id":"CTH-267","status":"Done","status_type":"completed"}'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
npm run hub -- tools/call save_issue "base64:$b64"
```

## MCP Tool Surface

Harnesses should prefer MCP when the server is available.

Canonical tool names:

- `dashboard`
- `list_projects`
- `save_project`
- `list_issues`
- `get_issue`
- `save_issue`
- `save_comment`
- `list_teams`
- `start_agent_session`
- `heartbeat_agent_session`
- `end_agent_session`
- `list_agent_sessions`
- `claim_issue`
- `release_issue_claim`
- `list_issue_claims`
- `repair_issue_invariants`
- `save_context_binding`
- `upsert_context_binding`
- `get_context_binding`
- `list_context_bindings`
- `resolve_context_project`
- `delete_context_binding`

Optional history import from Linear is an operator-only tool under `tools/linear-migration`. It is not part of the normal API, MCP server, or hub CLI, and it still requires `CLAW_TASK_HUB_ALLOW_LINEAR_IMPORT=1` for an explicit one-off import run. Harnesses must not call it during normal Claw Task Hub work.

For the operator-facing migration procedure, see [LINEAR_MIGRATION.md](LINEAR_MIGRATION.md). That guide is for planned history transfer only, not active task work.

## Multi-Agent Coordination

Use the claim protocol when CLI/MCP tools are available:

```powershell
$json = '{"id":"session-demo-agent-001","agent_name":"Demo Agent","harness":"CLI","ttl_minutes":60,"metadata":{"thread":"local"}}'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
npm run hub -- tools/call start_agent_session "base64:$b64"

$json = '{"session_id":"session-demo-agent-001","ttl_minutes":60}'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
npm run hub -- tools/call heartbeat_agent_session "base64:$b64"

$json = '{"issue_id":"CTH-268","session_id":"session-demo-agent-001","note":"Implement claim protocol","ttl_minutes":60}'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
npm run hub -- tools/call claim_issue "base64:$b64"

$json = '{"issue_id":"CTH-268","session_id":"session-demo-agent-001"}'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
npm run hub -- tools/call list_issue_claims "base64:$b64"

$json = '{"issue_id":"CTH-268","session_id":"session-demo-agent-001","status":"completed"}'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
npm run hub -- tools/call release_issue_claim "base64:$b64"
```

Claim rules:

- One active claim may own an issue at a time.
- The same session can renew its claim idempotently.
- A different session must wait for expiry or use `force=true` with a clear comment.
- `Done`, `Canceled`, and archived issues cannot be claimed or commented on by default. Reopen the issue first; use `allow_closed:true` only for deliberate historical maintenance.
- Ending a session releases its active claims by default.
- Completing work should release the claim with `status:"completed"` and leave acceptance evidence.

When claim tools are not available, use issue status and comments:

1. Read the issue and recent comments.
2. Add a comment that names the agent, scope, and intended next step.
3. Set the issue to `In Progress` only for the slice being actively worked.
4. Avoid touching unrelated files or records owned by another active agent.
5. On handoff, leave a comment with exact state, verification, and remaining work.

## Pre-Production Gate

Use [GITHUB_OSS_READINESS.md](GITHUB_OSS_READINESS.md) as the public GitHub release checklist.

Before public GitHub publication, the repo should pass:

- `npm run build`
- `npm run lint`
- `npm run store-regression`
- `npm run harness-smoke`
- `npm run ui-smoke`
- `npm run public-hygiene`
- a secret scan and data exclusion review
- README, license, sample config, and contribution documentation review
