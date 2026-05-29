# Claw Task Hub MVP Acceptance

## Goal

Claw Task Hub is a local-first, Linear-like task workspace designed primarily for AI agents and agentic harnesses. The MVP must run on one machine, keep a local source of truth, survive cloud/MCP outages, and preserve imported or mirrored history without making any hosted tracker a runtime dependency.

The system should be useful to MCP-compatible clients, CLIs, and agent-driven development or operations workflows. Human operators remain first-class users, but the task model, CLI/MCP surface, and activity history should be especially ergonomic for autonomous or semi-autonomous agents.

## Must Pass

- Local SQLite database initializes from an empty checkout without manual setup.
- SQLite schema versions are recorded in `schema_migrations`; rerunning migrations is idempotent on fresh and existing local databases.
- SQLite uses WAL mode, indexes, and FTS5 search suitable for 250k+ issues.
- Projects, teams, issues, comments, documents, sync runs, and checkpoints have stable local IDs plus optional external IDs.
- Replayed or mirrored writes are idempotent: external IDs update rows instead of creating duplicates.
- Local REST API supports health, dashboard, teams, projects, issue list, issue detail, issue create, and comments.
- Local tool CLI exposes stable issue-tracker names: `list_projects`, `save_project`, `list_issues`, `get_issue`, `save_issue`, `save_comment`, `list_teams`.
- Harness context bindings map a repository, working directory, thread, or context key to the correct project.
- UI deep links open project overview, activity, issues, individual issues, workspace issues, and context-bound project pages after refresh.
- UI supports project filtering, status filtering, indexed search, list/detail flow, quick local issue creation, and comments.
- Cloud/MCP outage leaves local read/write flows usable and visible as degraded mode.
- Historical sync metadata can record status, stats, cursor, and error text without making any cloud service a runtime dependency.
- Existing legacy installations continue to work through compatibility aliases until host configs are migrated.

## Performance Targets

- 250k issue synthetic dataset can be stored without schema changes.
- First page of filtered issues returns in under 400 ms on the target machine.
- FTS search over 250k issues returns a 20-50 item page in under 500 ms.
- Incremental import of 1000 changed issues completes in under 5 minutes.

## Review Gates

- Build passes with `npm run build`.
- Seed passes with `npm run seed`.
- API health returns OK on `http://127.0.0.1:4781/api/health`.
- CLI smoke passes with `npm run hub -- tools/call dashboard "{}"`.
- Store regression passes with `npm run store-regression`.
- UI smoke passes with `npm run ui-smoke`.
- Public hygiene passes with `npm run public-hygiene`.
- Reviewer-opponent approves MVP direction before expanding import breadth.
