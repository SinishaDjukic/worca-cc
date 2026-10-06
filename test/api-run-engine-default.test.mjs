// test/api-run-engine-default.test.mjs — POST /api/run without an engine starts on the resolved default; an explicit
// engine wins; GET /api/run-defaults; the runEngine settings key (plans/cascading-settings-design.md §4.2, §5).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);
let sandboxHome, srv, base, runs, projectDir, writeProjectSettings;
const prevEnv = {};
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b ?? {}) });
const get = async (p) => { const r = await fetch(`${base}${p}`); return { status: r.status, body: await r.json() }; };
const settled = new Set(['done', 'stopped', 'error', 'paused', 'interrupted']);
async function untilSettled(runId, ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const e = runs.get(runId);
    if (e && settled.has(String(e.status || ''))) return e;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`run ${runId} never settled`);
}

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cc-engdef-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  ({ runs } = mod);
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  const { addProject } = await import('../src/core/projects.mjs');
  ({ writeProjectSettings } = await import('../src/core/settings-cascade.mjs'));
  projectDir = gitDir('engdef');
  await addProject({ name: 'engdef', path: projectDir });
});
after(async () => {
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
});

test('a body without an engine starts on the project default (codex refuses this set at once)', async () => {
  writeProjectSettings({ projectDir }, { 'run.engine': 'codex' });
  try {
    const r = await post('/api/run', { projectDir, prompt: 'demo task', mock: true, guardrailsId: 'normal' });
    assert.equal(r.status, 409);
    const data = await r.json();
    assert.equal(data.code, 'engine-refused');
    assert.match(data.error, /^engine codex: /);
  } finally { writeProjectSettings({ projectDir }, { 'run.engine': null }); }
});

test('an explicit claude beats the project default (Review Focus 1)', async () => {
  writeProjectSettings({ projectDir }, { 'run.engine': 'codex' });
  try {
    const r = await post('/api/run', { projectDir, prompt: 'demo task', mock: true, guardrailsId: 'normal', engine: 'claude' });
    assert.equal(r.status, 200);
    const { runId } = await r.json();
    const o = runs.get(runId).orch;
    assert.equal(o.claude.engine, 'claude');
    assert.equal('engine' in o.opts.claude, false, 'a Claude run\'s options stay byte-identical');
    await post('/api/stop', { runId });
    await untilSettled(runId);
  } finally { writeProjectSettings({ projectDir }, { 'run.engine': null }); }
});

test('GET /api/run-defaults names the engine New pipeline prefills and where it came from', async () => {
  assert.deepEqual((await get('/api/run-defaults')).body.engine, { value: 'claude', source: 'default' });
  writeProjectSettings({ projectDir }, { 'run.engine': 'codex' });
  try {
    assert.deepEqual((await get(`/api/run-defaults?projectDir=${encodeURIComponent(projectDir)}`)).body.engine, { value: 'codex', source: 'project' });
  } finally { writeProjectSettings({ projectDir }, { 'run.engine': null }); }
});

test('POST /api/settings runEngine: stored, shown, validated, cleared', async () => {
  const set = await post('/api/settings', { runEngine: 'codex' });
  assert.equal(set.status, 200);
  assert.equal((await set.json()).runEngine, 'codex');
  assert.equal((await get('/api/settings')).body.runEngine, 'codex');
  assert.deepEqual((await get(`/api/run-defaults?projectDir=${encodeURIComponent(projectDir)}`)).body.engine, { value: 'codex', source: 'user' });
  const bad = await post('/api/settings', { runEngine: 'gpt' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, '“Default engine” must be one of claude, codex, cursor.');
  assert.equal((await (await post('/api/settings', { runEngine: null })).json()).runEngine, null);
});

test('GET /api/engines: each engine\'s readiness from its own preflight; ?recheck=1 checks again', { skip: process.platform === 'win32' && 'POSIX shell fixtures' }, async () => {
  const { fakeCursor } = await import('./helpers/fake-cursor.mjs');
  const { dirname } = await import('node:path');
  const binDir = await mkdtemp(join(tmpdir(), 'worca-cc-engines-bin-'));
  const fake = fakeCursor(binDir, 'x', { statusText: 'Not logged in', statusExit: 1 });
  const saved = { WORCA_MOCK: process.env.WORCA_MOCK, WORCA_CURSOR_BIN: process.env.WORCA_CURSOR_BIN, CURSOR_API_KEY: process.env.CURSOR_API_KEY, PATH: process.env.PATH };
  process.env.WORCA_MOCK = '';
  process.env.WORCA_CURSOR_BIN = fake.bin;
  delete process.env.CURSOR_API_KEY;
  process.env.PATH = `${dirname(process.execPath)}:/bin:/usr/bin`;
  try {
    const r = await get('/api/engines?recheck=1');
    assert.equal(r.status, 200);
    const by = Object.fromEntries(r.body.engines.map((e) => [e.name, e]));
    assert.equal(by.claude.ready, true);
    assert.equal(by.cursor.ready, false);
    assert.match(by.cursor.reason, /not signed in/);
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await rm(binDir, { recursive: true, force: true });
  }
});
