# Linux / Omarchy Support

Claw Task Hub runs locally on Linux with an application-menu entry and a systemd user service. Omarchy uses the same workflow.

Validated on Arch Linux / Omarchy with Node.js 24: install, repeat opening, API child recovery, occupied-port refusal, opt-in autostart configuration, stop, and uninstall with database preservation. Browser launching is checked with a test opener; graphical menu rendering and a full logout/login cycle remain manual checks.

## Prerequisites

- Node.js 24 LTS and npm, required for the supported installation.
- A graphical Linux session with systemd user services and a browser opener (`xdg-open`).
- A repository checkout in a stable, writable location.

Omarchy may have Node.js 26 selected, which is not supported by the locked `better-sqlite3` dependency. Use Node.js 24 LTS for this repository, not an arbitrary newer version. With mise, run the following from the repository root to select Node 24 locally without changing your global runtime, then verify that `node --version` reports `v24.x`:

```bash
mise use node@24
node --version
npm --version
node -p 'process.execPath'
```

The installer captures the active Node executable path so the user service does not depend on an interactive shell loading mise. Keep that Node installation available; stop the service and reinstall the desktop integration after changing its path. Before moving the repository, uninstall the integration from the old location, then install it again from the new location.

Run all commands as your normal desktop user, from the repository root unless stated otherwise. Do not use `sudo`. User lingering is not required or enabled; this is a desktop-session service, not a boot-time system service.

## Install and Open

```bash
npm ci
npm run build
npm run linux:install
npm run linux:open
```

The installer creates the Claw Task Hub application-menu entry and `claw-task-hub.service` in your user systemd configuration. Installation does not start the service; use the menu entry or `linux:open` when ready. Autostart is opt-in. To request startup at login, install with:

```bash
npm run linux:install -- --autostart
```

Reinstalling without `--autostart` preserves an already-enabled autostart setting. Use the disable command below to turn it off.

Open **Claw Task Hub** from the application menu, or run `npm run linux:open`. The launcher starts the user service, waits for both the API and UI to become ready, then opens the browser.

The local endpoints are:

- API: `http://127.0.0.1:4781`
- UI: `http://127.0.0.1:5173`

Both bind to loopback. This setup is not a public or LAN deployment. Keep ports 4781 and 5173 available; do not run the development or pilot launcher alongside the Linux service.

The Linux runtime serves the built UI through Vite preview and runs the API without watch mode. The API and UI have a shared lifecycle: if either exits, the other is stopped so a partial application is not left running.

## Status, Logs, and Stopping

```bash
systemctl --user status claw-task-hub
journalctl --user -u claw-task-hub -n 100 --no-pager
journalctl --user -u claw-task-hub -f
```

Stop or start the service manually:

```bash
systemctl --user stop claw-task-hub
systemctl --user start claw-task-hub
```

Closing the browser does not stop the service. Stopping it does not disable an existing autostart setting. To disable autostart and stop it now:

```bash
systemctl --user disable --now claw-task-hub
```

For foreground operation or troubleshooting, first stop any running service, then run:

```bash
systemctl --user stop claw-task-hub
npm run linux:start
```

Keep that terminal open; press Ctrl+C to stop the foreground runtime. Build the UI first if you have not already done so. Foreground operation does not require installing the desktop integration.

## Upgrades

Stop the service and any foreground instance before replacing dependencies or rebuilding. Stop MCP processes using this checkout as well. Back up local data before upgrading; if copying SQLite files, stop all writers first and preserve any accompanying WAL files.

Stop the service first:

```bash
systemctl --user stop claw-task-hub
```

Update the checkout to your chosen revision using your normal source-update process. Confirm Node.js 24 LTS is still selected in the repository, then run:

```bash
npm ci
npm run build
npm run linux:install
systemctl --user start claw-task-hub
```

Use `npm run linux:install -- --autostart` in place of the install line when you want startup at login. Reinstallation refreshes the repository and Node paths and preserves the installed database path, including a custom database, when no database override is supplied. Set `CLAW_TASK_HUB_DB` explicitly only when deliberately selecting a different database; this does not migrate existing data. Check the database path printed by the installer, check service status, and open the UI after the upgrade; restart MCP clients afterward.

## Uninstall

```bash
npm run linux:uninstall
```

Uninstall removes the desktop integration and user service, stopping the service as part of removal. It preserves the SQLite database and repository. It does not delete your projects, issues, or comments. Stop any separately launched foreground or MCP processes yourself.

## MCP and Shared Local Data

For a fresh installation, the default database is `data/claw-task-hub.sqlite` in the repository. `CLAW_TASK_HUB_DB` overrides it. Existing installations may reuse `data/codex-task-hub.sqlite` or the legacy `CODEX_TASK_HUB_DB` override. The installer prints the selected absolute database path. The desktop runtime and MCP must use the **same absolute database path**; a different path can produce a separate, apparently empty hub.

For a fresh installation using the default database, run this from the repository root to launch MCP with an explicit path:

```bash
repo="$(pwd -P)"
export CLAW_TASK_HUB_DB="$repo/data/claw-task-hub.sqlite"
npm --silent --prefix "$repo" run mcp
```

For a custom database, use the same absolute `CLAW_TASK_HUB_DB` value configured for the desktop service, rather than the default in this example. When configuring a harness, set its MCP command to `npm`, its arguments to `--silent`, `--prefix`, the absolute repository path, `run`, `mcp`, and its environment variable `CLAW_TASK_HUB_DB` to that shared absolute database path. Resolve the paths before storing them in the harness configuration; do not rely on its working directory or shell expansion. The harness must also have the selected Node/npm on its PATH. `--silent` keeps npm banners out of the MCP protocol stream.

MCP uses stdio and accesses local data; it is not the browser URL or a remote network endpoint. See the [agent and harness contract](AGENTIC_HARNESS.md) for the tool workflow.

## Project-Bound Opening

The desktop menu opens the general UI. For agent work in a known project, reuse [project-bound links](../README.md#project-bound-links) and the [context-binding contract](AGENTIC_HARNESS.md#project-context-binding). Resolve the workspace binding and open its returned project URL instead of the global Projects page. Context bindings must not contain secrets.
