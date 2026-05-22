# Agentic Harness Contract

Claw Task Hub is a local task system for AI agents first and human operators second. Humans should be able to read every record, but the durable contract is built for agentic harnesses such as Codex, Claude Code, OpenClaw, Hermes, and future local or remote runners.

This document is the canonical contract for agents and harness authors.

## Source Of Truth

- The local SQLite database is the durable source of truth.
- Linear is retired for normal operation. Do not connect to Linear, do not refresh Linear imports, and do not treat Linear as an active fallback.
- Existing `SAV-*` records are imported history and can still be updated locally when work continues.
- New work should be created in Claw Task Hub with local identifiers.

## Local Deployment Boundary

- The public MVP is local-first and binds the API to loopback by default.
- Non-loopback binding requires `CLAW_TASK_HUB_UNSAFE_BIND=1` and is not a secure hosted deployment by itself.
- Harnesses should connect through local stdio MCP or local HTTP only unless the operator has added separate authentication and network controls.
- The browser UI expects the local API unless a downstream distribution intentionally changes that deployment model.

## Identity Model

Each issue has three identity fields:

- `id`: internal stable row id, often `issue_*` for local rows.
- `identifier`: short visible code such as `CTH-267`, `LOCAL-1`, or imported `SAV-264`.
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
- Reconnect to Linear for CTH work.
- Invent long code-like issue titles such as `LOCAL_SAV_...` when a short identifier already exists.
- Mark work `Done` without verification or an explicit owner decision.
- Reassign or close another active agent's issue without reading the current comments and status.

## CLI Fallback

When MCP tools are not injected, run commands from the repository root.

Dashboard:

```powershell
npm run hub -- tools/call dashboard "{}"
```

List projects:

```powershell
npm run hub -- tools/call list_projects "{}"
```

List open issues in the CTH MVP project:

```powershell
$json = '{"project_id":"project_codex_task_hub_mvp","include_done":false,"limit":50}'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
npm run hub -- tools/call list_issues "base64:$b64"
```

For active-work discovery, pass `include_done:false`. This excludes normalized `completed` issues even if old imported rows have inconsistent raw status metadata.

Create a local issue:

```powershell
$json = '{"title":"Document agentic harness contract","description":"Write the canonical harness contract and link it from README and AGENTS.","project_id":"project_codex_task_hub_mvp","team_id":"team_local","parent_id":"LOCAL-1","priority":1,"status":"Todo","status_type":"unstarted","labels":["agentic-harness","docs"],"source":"local"}'
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

Harnesses should prefer MCP when the server is available. Existing host configurations may still use the compatibility server id `codex_task_hub`.

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

Legacy Linear migration is an operator-only tool under `tools/linear-migration`. It is not part of the normal API, MCP server, or hub CLI, and it still requires `CLAW_TASK_HUB_ALLOW_LINEAR_IMPORT=1` for an explicit one-off recovery run. Harnesses must not call it during normal CTH work.

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
