// test/settings-pulse-for.test.mjs — Settings › Notifications › Pulse icon: how long Stillhet's Pulse icon animates.
// SANDBOX: HOME/USERPROFILE point at a temp dir (settings.json lives there, not under WORCA_HOME).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { _resetForTests } from '../src/core/db.mjs';
import { pulseFor, setPulseFor, assertPulseForInput, settingsFile, readSettings, SETTINGS_POST_KEYS } from '../src/core/settings.mjs';

let home; const prev = {};
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-pulsefor-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_PROJECTS_ROOT']) prev[k] = process.env[k];
  process.env.HOME = home; process.env.USERPROFILE = home; delete process.env.WORCA_HOME; delete process.env.WORCA_PROJECTS_ROOT;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  mkdirSync(join(home, '.worca-cc'), { recursive: true });
});
after(async () => {
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(home, { recursive: true, force: true });
});

test('an unset pulseFor reads as until-read', () => {
  if (existsSync(settingsFile())) rmSync(settingsFile());
  assert.equal(pulseFor(), 'until-read');
  writeFileSync(settingsFile(), '{}');
  assert.equal(pulseFor(), 'until-read');
});

test('an invalid stored pulseFor reads as until-read', (t) => {
  t.mock.method(console, 'warn', () => {});
  writeFileSync(settingsFile(), JSON.stringify({ pulseFor: '5s' }));
  assert.equal(pulseFor(), 'until-read');
  assert.equal(console.warn.mock.callCount(), 1);
});

test('setPulseFor stores 10s, 1m and never and drops the default', async () => {
  writeFileSync(settingsFile(), '{}');
  for (const v of ['10s', '1m', 'never']) {
    assert.deepEqual(await setPulseFor(v), { pulseFor: v });
    assert.equal(pulseFor(), v);
    assert.equal(readSettings().pulseFor, v);
  }
  assert.deepEqual(await setPulseFor('until-read'), { pulseFor: 'until-read' });
  assert.equal('pulseFor' in readSettings(), false);
  await setPulseFor('1m');
  await setPulseFor('');
  assert.equal('pulseFor' in readSettings(), false, 'a clear resets to the default');
});

test("setPulseFor('5s') rejects and writes nothing", async () => {
  writeFileSync(settingsFile(), JSON.stringify({ pulseFor: '10s' }));
  const before = readFileSync(settingsFile());
  for (const bad of ['5s', 'always', 10, true]) {
    assert.throws(() => assertPulseForInput(bad), /pulseFor must be until-read, 10s, 1m or never/);
    await assert.rejects(setPulseFor(bad), /pulseFor must be/);
  }
  assert.deepEqual(readFileSync(settingsFile()), before);
});

test('pulseFor is a POST key', () => {
  assert.ok(SETTINGS_POST_KEYS.includes('pulseFor'));
});

test('the settings API round-trips pulseFor', async () => {
  writeFileSync(settingsFile(), '{}');
  _resetForTests();
  const { app } = await import('../ui/server.mjs');
  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const get = async () => (await fetch(`${base}/api/settings`)).json();
  const postJson = (body) => fetch(`${base}/api/settings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    assert.equal((await get()).pulseFor, 'until-read');
    for (const v of ['10s', '1m', 'never']) {
      const r = await postJson({ pulseFor: v });
      assert.equal(r.status, 200);
      assert.equal((await r.json()).pulseFor, v);
      assert.equal((await get()).pulseFor, v);
    }
    const bytes = readFileSync(settingsFile());
    const bad = await postJson({ pulseFor: '5s' });
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: '“Pulse icon” must be until-read, 10s, 1m or never.', field: 'pulseFor' });
    assert.deepEqual(readFileSync(settingsFile()), bytes, 'a refused POST writes nothing');
    assert.equal((await get()).pulseFor, 'never');
  } finally {
    await new Promise((r) => srv.close(r));
    _resetForTests();
  }
});
