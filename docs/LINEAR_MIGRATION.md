# Legacy Linear Migration

Claw Task Hub does not require Linear for normal use. Linear migration is an optional one-off recovery path for users who already have Linear history and want to copy that history into a local Claw Task Hub database.

The migration tool is intentionally separate from the normal API, MCP server, and hub CLI. It is disabled by default. Enable it only for a planned import window, then turn it off again.

## What Is Migrated

The current importer copies:

- Linear teams into local teams;
- Linear projects into local projects;
- Linear issues into local issues;
- issue identifiers such as imported `SAV-*` records when available;
- external Linear ids into `external_id` for idempotent re-runs;
- title, description, status, status type, priority, assignee, labels, URL, archive/completion timestamps, created/updated timestamps;
- sync run metadata, including status, stats, cursor, and error text.

The importer also supports incremental re-runs. After a successful run, Claw Task Hub stores the latest imported update timestamp as the Linear sync checkpoint and uses it for later imports.

## What Is Not Migrated

The current legacy importer is issue-history oriented. It does not aim to be a full Linear clone.

Do not assume it migrates:

- Linear workspace membership and permissions;
- cycles, roadmaps, views, integrations, automations, or notifications;
- hosted Linear authentication settings;
- comments or attachments unless a future importer explicitly adds them;
- remote Linear behavior after import.

After migration, Claw Task Hub remains the local source of truth.

## Safety Rules

- Run migration on a backed-up database.
- Do not run migration during normal agent work unless the operator has explicitly scheduled it.
- Do not commit the local SQLite database, WAL files, logs, screenshots, or migration scratch files.
- Do not store Linear credentials, OAuth tokens, cookies, private keys, or proxy credentials in issues, comments, docs, or repo files.
- Keep `CLAW_TASK_HUB_ALLOW_LINEAR_IMPORT` unset or set to `0` after the migration window.

## Prerequisites

- Claw Task Hub dependencies are installed with `npm ci`.
- The target local database is selected, either by default or with `CLAW_TASK_HUB_DB`.
- The operator has access to the Linear workspace being migrated.
- The optional `mcp-remote` Linear flow can authenticate in the operator environment.
- Network/proxy settings, if needed, are configured outside the repository.

Optional Linear recovery environment variables:

| Variable | Purpose |
| --- | --- |
| `CLAW_TASK_HUB_ALLOW_LINEAR_IMPORT=1` | Enables the standalone migration command for this process only. |
| `CLAW_TASK_HUB_LINEAR_MCP_COMMAND` | Overrides the command used to start the Linear MCP bridge. Defaults to `npx.cmd` on Windows and `npx` elsewhere. |
| `CLAW_TASK_HUB_LINEAR_MCP_URL` | Overrides the Linear MCP URL. |
| `CLAW_TASK_HUB_LINEAR_MCP_CALLBACK_PORT` | Overrides the local OAuth callback port. |
| `CLAW_TASK_HUB_LINEAR_MCP_HOST` | Overrides the local callback host. |
| `CLAW_TASK_HUB_LINEAR_MCP_AUTH_TIMEOUT` | Overrides the authentication timeout in seconds. |
| `CLAW_TASK_HUB_LINEAR_MCP_ENABLE_PROXY=1` | Adds the bridge proxy flag when the operator environment requires it. |

## Step 1: Stop Normal Work

Before importing, pause agents that are actively writing to the same local database. Migration is idempotent for imported Linear records, but a quiet window makes verification easier.

For the safest backup, stop the Claw Task Hub API and UI before copying database files. If the app must stay open, make sure no agents or users are writing during the backup and import window.

Check the current dashboard:

```powershell
npm run hub -- tools/call dashboard "{}"
```

## Step 2: Back Up The Database

Use the database path shown by `/api/health`, by your `CLAW_TASK_HUB_DB` value, or by the default database rules in the README.

PowerShell example:

```powershell
$db = "data/claw-task-hub.sqlite"
if (Test-Path "data/codex-task-hub.sqlite") { $db = "data/codex-task-hub.sqlite" }
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item $db "$db.backup-$stamp"
if (Test-Path "$db-wal") { Copy-Item "$db-wal" "$db-wal.backup-$stamp" }
if (Test-Path "$db-shm") { Copy-Item "$db-shm" "$db-shm.backup-$stamp" }
```

## Step 3: Enable The One-Off Import Window

Set the import gate for the current terminal only:

```powershell
$env:CLAW_TASK_HUB_ALLOW_LINEAR_IMPORT = "1"
```

If your environment needs the bridge proxy flag:

```powershell
$env:CLAW_TASK_HUB_LINEAR_MCP_ENABLE_PROXY = "1"
```

Do not save these values in committed repo files.

## Step 4: Run The Bootstrap Import

The normal API, MCP server, and hub CLI do not expose Linear migration. Run the separate operator tool directly:

```powershell
npm run migrate:linear -- import --pages 1000
```

The command returns a `runId`, import stats, and the next checkpoint cursor when successful.

## Step 5: Backfill Truncated Descriptions

Some Linear list responses can include truncated descriptions. Run the backfill tool after the main import:

```powershell
npm run migrate:linear -- backfill-descriptions --limit 500
```

Repeat with a higher limit or run again until the repaired count reaches zero.

## Step 6: Verify The Import

Check dashboard counts:

```powershell
npm run hub -- tools/call dashboard "{}"
```

List imported projects:

```powershell
npm run hub -- tools/call list_projects "{}"
```

Check imported issues by visible identifier or query:

```powershell
$json = '{"query":"SAV","limit":20}'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
npm run hub -- tools/call list_issues "base64:$b64"
```

Read a specific imported issue:

```powershell
$json = '{"id":"SAV-264"}'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
npm run hub -- tools/call get_issue "base64:$b64"
```

If the API is running, sync run history is available at:

```text
http://127.0.0.1:4781/api/sync-runs
```

## Step 7: Disable The Import Gate

Close the terminal or unset the gate:

```powershell
Remove-Item Env:\CLAW_TASK_HUB_ALLOW_LINEAR_IMPORT -ErrorAction SilentlyContinue
Remove-Item Env:\CLAW_TASK_HUB_LINEAR_MCP_ENABLE_PROXY -ErrorAction SilentlyContinue
```

Confirm the normal hub CLI has no Linear import tool:

```powershell
npm run hub -- tools/call import_linear "{}"
```

Expected result: the command exits with an `Unknown tool: import_linear` error.

Confirm the standalone migration command is disabled without the gate:

```powershell
npm run migrate:linear -- import --pages 1
```

Expected result: the command exits with an error explaining that `CLAW_TASK_HUB_ALLOW_LINEAR_IMPORT=1` is required.

## Rollback

If verification fails, stop Claw Task Hub, restore the database backup files, and restart the app.

PowerShell example:

```powershell
Copy-Item "data/claw-task-hub.sqlite.backup-YYYYMMDD-HHMMSS" "data/claw-task-hub.sqlite" -Force
```

Use the exact file names created during your backup step.

## Troubleshooting

If authentication fails:

- confirm the operator can access the Linear workspace in a browser;
- increase `CLAW_TASK_HUB_LINEAR_MCP_AUTH_TIMEOUT`;
- verify the callback port is available;
- configure required network/proxy settings outside the repository;
- re-run only after the OAuth flow has completed successfully.

If counts look wrong:

- check `/api/sync-runs` for the failed run and error text;
- re-run the import with the same database, because imported records use `external_id` for idempotent updates;
- run `npm run migrate:linear -- backfill-descriptions --limit 500` for truncated descriptions;
- keep the backup until project and issue spot checks pass.

## Acceptance Checklist

- Database backup exists.
- `npm run migrate:linear -- import --pages 1000` completed successfully.
- `npm run migrate:linear -- backfill-descriptions --limit 500` completed or has documented remaining failures.
- Dashboard counts match expectations.
- Sample projects and issues open locally.
- Retired Linear tools are disabled again.
- No secrets, tokens, cookies, or private network details were written into the repo or into Claw Task Hub records.
