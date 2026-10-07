import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const marker = '# Managed by Claw Task Hub linux-desktop v1';
const unit = 'claw-task-hub.service';
const ui = 'http://127.0.0.1:5173';

function safe(value) {
  if (/[\r\n\0]/.test(value)) throw new Error('Paths and environment values must not contain newlines or NUL.');
  return value;
}

export function systemdQuote(value) {
  return '"' + safe(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%') + '"';
}

export function desktopQuote(value) {
  // Desktop Entry escaping has two layers: string-value and Exec parsing.
  return '"' + safe(value).replace(/[\\"`$]/g, '\\$&').replaceAll('\\', '\\\\').replaceAll('%', '%%') + '"';
}

export function databasePath(repo, env = process.env) {
  return resolve(repo, env.CLAW_TASK_HUB_DB || env.CODEX_TASK_HUB_DB ||
    (existsSync(join(repo, 'data/codex-task-hub.sqlite')) ? 'data/codex-task-hub.sqlite' : 'data/claw-task-hub.sqlite'));
}

export function renderUnit({ repo, node, npm, db, path }) {
  return `${marker}
[Unit]
Description=Claw Task Hub local service
StartLimitIntervalSec=60
StartLimitBurst=3

[Service]
Type=simple
WorkingDirectory=${safe(repo).replaceAll('\\', '\\\\').replaceAll('%', '%%')}
ExecStart=${systemdQuote(node).replaceAll('$', '$$$$')} ${systemdQuote(npm).replaceAll('$', '$$$$')} run linux:start
Environment=${systemdQuote('PATH=' + path)}
Environment=${systemdQuote('CLAW_TASK_HUB_DB=' + db)}
Environment=PORT=4781
Environment=CLAW_TASK_HUB_HOST=127.0.0.1
Environment=CLAW_TASK_HUB_UNSAFE_BIND=0
Restart=on-failure
RestartSec=3
KillMode=control-group
TimeoutStopSec=30
UMask=0077

[Install]
WantedBy=default.target
`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 45000, ...options });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || `${command} failed (${result.status})`);
  return result.stdout.trim();
}

function ctl(...args) { return run('systemctl', ['--user', ...args]); }
function active() {
  return spawnSync('systemctl', ['--user', 'is-active', '--quiet', unit], { timeout: 5000 }).status === 0;
}
function owned(path) {
  if (existsSync(path) && !readFileSync(path, 'utf8').startsWith(marker + '\n')) {
    throw new Error(`Refusing to replace or remove an unrelated file: ${path}`);
  }
}

export function validateUnitInspection(result, service) {
  if (result.error) throw result.error;
  const fields = Object.fromEntries(String(result.stdout || '').trim().split('\n').map(line => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)];
  }));
  if (fields.LoadState === 'not-found' && !fields.FragmentPath && !fields.DropInPaths) return;
  if (result.status !== 0 || !fields.LoadState) throw new Error('Unable to inspect the loaded systemd unit safely.');
  if (fields.DropInPaths) throw new Error('Unexpected systemd drop-ins: remove or review them before managing desktop integration.');
  const fragment = fields.FragmentPath;
  if (fragment && (!existsSync(service) || realpathSync(fragment) !== realpathSync(service))) {
    throw new Error(`Refusing to manage a unit loaded from another location: ${fragment}`);
  }
  if (!fragment) throw new Error('Loaded service has no verifiable unit file.');
}

function checkLoadedUnit(service) {
  validateUnitInspection(spawnSync('systemctl', ['--user', 'show', unit, '-p', 'FragmentPath,LoadState,DropInPaths'], { encoding: 'utf8', timeout: 5000 }), service);
}

function checkBuild() {
  const manifest = join(root, 'dist/cth-runtime.json');
  if (!existsSync(manifest) || JSON.parse(readFileSync(manifest, 'utf8')).apiBase !== 'http://127.0.0.1:4781/api') {
    throw new Error('Rebuild with the default API URL (unset VITE_CLAW_TASK_HUB_API_BASE). Desktop integration requires port 4781.');
  }
}

function listening(port) {
  return new Promise((done) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (value) => { socket.destroy(); done(value); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1000, () => finish(true));
  });
}

export async function main(args = process.argv.slice(2)) {
  if (process.platform !== 'linux') throw new Error('Desktop integration requires Linux with a systemd user session.');
  const [action, ...flags] = args;
  if (!['install', 'uninstall', 'open'].includes(action) || flags.some(f => f !== '--autostart') || (flags.length && action !== 'install')) {
    throw new Error('Usage: linux-desktop.mjs install [--autostart] | open | uninstall');
  }
  const config = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  const data = process.env.XDG_DATA_HOME || join(homedir(), '.local/share');
  const service = join(config, 'systemd/user', unit);
  const desktop = join(data, 'applications/claw-task-hub.desktop');
  const settings = join(config, 'claw-task-hub/desktop.json');
  for (const path of [service, desktop]) owned(path);
  if (existsSync(settings) && JSON.parse(readFileSync(settings, 'utf8')).managedBy !== marker) {
    throw new Error(`Refusing unrelated configuration: ${settings}`);
  }
  if (existsSync(settings) && JSON.parse(readFileSync(settings, 'utf8')).repo !== root) {
    throw new Error('Desktop integration belongs to another checkout. Uninstall it there first.');
  }
  if (action === 'uninstall' && ![service, desktop, settings].some(existsSync)) {
    console.log('No desktop integration installed; nothing changed.');
    return;
  }
  checkLoadedUnit(service);

  if (action === 'install') {
    if (Number(process.versions.node.split('.')[0]) !== 24) {
      throw new Error('Select Node.js 24 LTS for this checkout before installing desktop integration.');
    }
    if (!existsSync(join(root, 'dist/index.html')) || !existsSync(join(root, 'node_modules/tsx'))) {
      throw new Error('Run npm ci and npm run build before installing desktop integration.');
    }
    checkBuild();
    if (active()) throw new Error('Stop the existing service before reinstalling: systemctl --user stop claw-task-hub');
    const node = realpathSync(process.execPath);
    const npm = process.env.npm_execpath;
    if (!npm || !existsSync(npm)) throw new Error('Run the installer through npm run linux:install.');
    const previous = existsSync(settings) ? JSON.parse(readFileSync(settings, 'utf8')) : null;
    const db = process.env.CLAW_TASK_HUB_DB || process.env.CODEX_TASK_HUB_DB
      ? databasePath(root) : previous?.db || databasePath(root);
    const path = dirname(node) + ':' + (process.env.PATH || '/usr/bin:/bin');
    ctl('show-environment');
    const text = renderUnit({ repo: root, node, npm: realpathSync(npm), db, path });
    const entry = `${marker}
[Desktop Entry]
Type=Application
Name=Claw Task Hub
Comment=Local-first task management for AI agents
Exec=${desktopQuote(node)} ${desktopQuote(join(root, 'tools/linux-desktop.mjs'))} open
Icon=view-list-details
Terminal=false
Categories=Development;ProjectManagement;
StartupNotify=false
`;
    for (const p of [service, desktop, settings]) mkdirSync(dirname(p), { recursive: true });
    writeFileSync(service, text, { mode: 0o600 });
    writeFileSync(desktop, entry, { mode: 0o600 });
    writeFileSync(settings, JSON.stringify({ managedBy: marker, repo: root, db }, null, 2) + '\n', { mode: 0o600 });
    ctl('daemon-reload');
    checkLoadedUnit(service);
    if (flags.includes('--autostart')) ctl('enable', unit);
    const enabled = spawnSync('systemctl', ['--user', 'is-enabled', '--quiet', unit]).status === 0;
    console.log(`Installed application menu entry. Database: ${db}\nAutostart is ${enabled ? 'enabled' : 'disabled'}.`);
  } else if (action === 'uninstall') {
    if (active()) ctl('stop', unit);
    if (existsSync(service)) ctl('disable', unit);
    if (spawnSync('systemctl', ['--user', 'is-failed', '--quiet', unit]).status === 0) ctl('reset-failed', unit);
    for (const p of [service, desktop, settings]) rmSync(p, { force: true });
    ctl('daemon-reload');
    console.log('Desktop integration removed. Repository and database preserved.');
  } else {
    if (!existsSync(service) || !existsSync(settings)) throw new Error('Run npm run linux:install first.');
    checkBuild();
    const installed = JSON.parse(readFileSync(settings, 'utf8'));
    if (installed.repo !== root) throw new Error(`Desktop integration belongs to another checkout: ${installed.repo}`);
    if (!active()) {
      if (await listening(4781) || await listening(5173)) throw new Error('Ports 4781 or 5173 are already in use. Stop the other instance first.');
      ctl('start', unit);
    }
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      if (!active()) throw new Error('Service stopped. Inspect journalctl --user -u claw-task-hub.');
      let ready = false;
      try {
        const health = await fetch('http://127.0.0.1:4781/api/health', { signal: AbortSignal.timeout(1500) });
        const body = await health.json();
        const page = await fetch(ui, { signal: AbortSignal.timeout(1500) });
        const manifest = await fetch(ui + '/cth-runtime.json', { signal: AbortSignal.timeout(1500) });
        if (body.ok && resolve(body.dbPath) === installed.db && page.ok && (await page.text()).includes('<div id="root">') &&
          manifest.ok && (await manifest.json()).apiBase === 'http://127.0.0.1:4781/api') {
          ready = true;
        }
      } catch { /* Allow bounded startup time before reporting failure. */ }
      if (ready) {
        run('xdg-open', [ui]);
        return;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('Service did not become ready within 45 seconds. Inspect journalctl --user -u claw-task-hub.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    if (process.argv[2] === 'open') spawnSync('notify-send', ['Claw Task Hub', error.message], { timeout: 5000 });
    process.exitCode = 1;
  });
}
