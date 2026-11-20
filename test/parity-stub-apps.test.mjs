// test/parity-stub-apps.test.mjs — the parity tools' app stub (tools/parity/stub-apps.mjs): pure parts in-process, then one real
// server (startTarget) whose launcher routes must record and open nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { APP_BINS, isAppLaunch, fakeChild, pinClock, appLines } from '../tools/parity/stub-apps.mjs';
import { startTarget, canaryBin } from '../tools/parity/launch.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('isAppLaunch: any spawn inside an app route; app programs anywhere; git, gh and claude never', () => {
  const req = (method, path) => ({ method, path });
  assert.equal(isAppLaunch('/bin/sh', req('POST', '/api/actions/launchers/try')), true);
  assert.equal(isAppLaunch('/bin/sh', req('POST', '/api/runs/r1/builtins/terminal?x=1')), true);
  assert.equal(isAppLaunch('open', req('POST', '/api/ask/threads/t/attachments/a/reveal')), true);
  assert.equal(isAppLaunch('osascript', req('POST', '/api/fs/pick-folder')), true);
  assert.equal(isAppLaunch('/usr/bin/open', null), true);
  assert.equal(isAppLaunch('/opt/homebrew/bin/code', req('GET', '/api/runs')), true);
  for (const f of ['git', '/usr/bin/git', 'gh', 'claude', '/bin/sh', 'caffeinate']) assert.equal(isAppLaunch(f, req('POST', '/api/run')), false, f);
});

test('APP_BINS covers every editor and terminal builtins.mjs can launch', () => {
  const src = readFileSync(join(ROOT, 'src/core/actions/builtins.mjs'), 'utf8');
  const lists = /const EDITORS = \[([\s\S]*?)\];\nconst LINUX_TERMS = \[([\s\S]*?)\];/.exec(src);
  // `\['NAME'` also matches argv arrays such as konsole's `(d) => ['--workdir', d]`: keep only program names (no leading '-')
  const bins = [...`${lists[1]}${lists[2]}`.matchAll(/\['([\w.-]+)'/g)].map((m) => m[1]).filter((b) => !b.startsWith('-'));
  assert.ok(bins.length >= 8, bins.join());   // code, cursor, idea, webstorm, gnome-terminal, konsole, xfce4-terminal, x-terminal-emulator
  for (const bin of bins) assert.ok(APP_BINS.has(bin), bin);
});

test('fakeChild exits 0 on the next tick, the way launchAndWatch and folder-dialog read a child', async () => {
  const c = fakeChild(); const seen = [];
  c.stderr.on('data', () => seen.push('data'));
  c.once('exit', (code) => seen.push(`exit ${code}`)); c.once('close', (code) => seen.push(`close ${code}`));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(seen, ['exit 0', 'close 0']); assert.equal(typeof c.unref, 'function');
});

test('pinClock: now starts at the pin and advances at the real rate; dated constructors and instanceof are untouched', () => {
  let real = 1_000_000;
  const Real = class extends Date { static now() { return real; } };
  const D = pinClock(5_000, Real);
  assert.equal(D.now(), 5_000); real += 250; assert.equal(D.now(), 5_250);
  assert.equal(new D().getTime(), 5_250); assert.equal(new D(42).getTime(), 42);
  assert.ok(new D() instanceof Date); assert.equal(typeof D(), 'string');
  assert.equal(D.UTC(2026, 0, 1), Date.UTC(2026, 0, 1));
});

test('appLines turns the stub log into one net line per launch', () => {
  const log = `${JSON.stringify({ method: 'POST', path: '/api/actions/launchers/try', command: ['/bin/sh', '-c', "open -a Terminal '~'"] })}\n`;
  assert.deepEqual(appLines(log), ["app POST /api/actions/launchers/try /bin/sh -c open -a Terminal '~'"]);
  assert.deepEqual(appLines(''), []);
});

test('canaryBin: an app program run by name opens nothing and leaves a line', { skip: process.platform === 'win32' }, () => {
  const d = mkdtempSync(join(tmpdir(), 'canary-')); const log = join(d, 'canary.log');
  const bin = canaryBin(join(d, 'bin'));
  execFileSync('open', ['-a', 'Terminal', '/x'], { env: { PATH: `${bin}:/usr/bin:/bin`, WORCA_APP_CANARY: log } });
  assert.match(readFileSync(log, 'utf8'), /open -a Terminal \/x/);
});

test('a real stubbed server: Try records method, path and command, answers ok, and no app program runs', { skip: process.platform === 'win32', timeout: 60_000 }, async () => {
  const t = await startTarget({ kind: 'tree', ref: ROOT }, {});
  try {
    for (const body of [{ kind: 'terminal', line: 'open -a Terminal' }, { kind: 'editor', line: 'code --new-window' }]) {
      const r = await fetch(`${t.base}/api/actions/launchers/try`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(r.status, 200, await r.clone().text()); assert.equal((await r.json()).ok, true);
    }
    const lines = readFileSync(t.stubLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    for (const e of lines) { assert.equal(e.method, 'POST'); assert.equal(e.path, '/api/actions/launchers/try'); assert.equal(e.command[0], '/bin/sh'); }
    assert.match(lines[0].command.join(' '), /open -a Terminal/);
    assert.equal(existsSync(t.canaryLog), false, 'no app program ran by name');
  } finally { await t.stop(); }
});
