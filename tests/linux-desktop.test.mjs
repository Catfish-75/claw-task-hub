import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { databasePath, desktopQuote, systemdQuote, renderUnit, validateUnitInspection } from '../tools/linux-desktop.mjs';

test('unit ownership inspection fails closed on errors and drop-ins', () => {
  assert.doesNotThrow(() => validateUnitInspection({ status: 1, stdout: 'LoadState=not-found\nFragmentPath=\nDropInPaths=\n' }, '/absent'));
  assert.throws(() => validateUnitInspection({ status: 1, stdout: '' }, '/absent'));
  assert.throws(() => validateUnitInspection({ status: 0, stdout: 'LoadState=loaded\nDropInPaths=/unexpected.conf\nFragmentPath=/a' }, '/a'));
  assert.throws(() => validateUnitInspection({ status: 0, stdout: 'LoadState=loaded\nFragmentPath=/other' }, '/absent'));
});

test('systemd and desktop escape paths without shell interpretation', () => {
  assert.equal(systemdQuote('/a b/100%/"x"'), '"/a b/100%%/\\"x\\""');
  assert.equal(desktopQuote('/a b/100%/$x'), '"/a b/100%%/\\\\$x"');
  for (const quote of [systemdQuote, desktopQuote]) {
    assert.throws(() => quote('/bad\npath'));
    assert.throws(() => quote('/bad\0path'));
  }
});

test('database defaults and overrides match existing runtime precedence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cth-linux-'));
  try {
    assert.equal(databasePath(dir, {}), join(dir, 'data/claw-task-hub.sqlite'));
    mkdirSync(join(dir, 'data'));
    writeFileSync(join(dir, 'data/codex-task-hub.sqlite'), '');
    assert.equal(databasePath(dir, {}), join(dir, 'data/codex-task-hub.sqlite'));
    assert.equal(databasePath(dir, { CLAW_TASK_HUB_DB: 'a.sqlite', CODEX_TASK_HUB_DB: 'b.sqlite' }), resolve(dir, 'a.sqlite'));
    assert.equal(databasePath(dir, { CODEX_TASK_HUB_DB: 'b.sqlite' }), resolve(dir, 'b.sqlite'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('unit is one foreground process group with bounded recovery and explicit database', () => {
  const unit = renderUnit({ repo: '/home/test/a b', node: '/mise/node', npm: '/mise/npm.js', db: '/data/x.sqlite', path: '/mise:/usr/bin' });
  assert.match(unit, /WorkingDirectory=\/home\/test\/a b\n/);
  assert.match(unit, /ExecStart="\/mise\/node" "\/mise\/npm.js" run linux:start/);
  assert.match(unit, /CLAW_TASK_HUB_DB=\/data\/x.sqlite/);
  assert.match(unit, /KillMode=control-group/);
  assert.match(unit, /StartLimitBurst=3/);
  assert.doesNotMatch(unit, /pilot:start|nohup|setsid|sudo/);
  const dollars = renderUnit({ repo: '/a', node: '/a/$node', npm: '/a/${npm}', db: '/a/db', path: '/a' });
  assert.match(dollars, /ExecStart="\/a\/\$\$node" "\/a\/\$\$\{npm\}"/);
});
