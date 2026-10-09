// test/api-run-engine.test.mjs — POST /api/run's `engine` and `allowUnguardedEngine` body
// fields (harness bridge §10.4): validation 400s, a default/Claude body passes no engine option
// through, and a non-Claude engine's engineStartRefusal() answers 409 before the run is
// registered — or starts cleanly once the consent is given.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);   // outer isolation: mock runs below finish ASYNC in-process

let sandboxHome, projectsRoot, srv, base, runs;
const prevEnv = {};
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b ?? {}) });
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

let projectDir;

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cc-engapi-home-'));
  projectsRoot = await mkdtemp(join(tmpdir(), 'worca-cc-engapi-proot-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_PROJECTS_ROOT', 'WORCA_MOCK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_PROJECTS_ROOT = projectsRoot;
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');       // imported ⇒ no port bind
  ({ runs } = mod);
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  const { addProject } = await import('../src/core/projects.mjs');
  projectDir = gitDir('enginapi');
  await addProject({ name: 'enginapi', path: projectDir });
});
after(async () => {
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
  await rm(projectsRoot, { recursive: true, force: true });
});

const body = () => ({ projectDir, prompt: 'demo task', mock: true });

test('engine: an unknown name, the mock and a non-boolean consent are refused with a 400', async () => {
  for (const [engine, re] of [['codx', /unknown engine "codx"/], ['mock', /"mock" is not a run engine/], [42, /engine must be a string/]]) {
    const r = await post('/api/run', { ...body(), engine });
    assert.equal(r.status, 400, String(engine));
    assert.match((await r.json()).error, re);
  }
  const r = await post('/api/run', { ...body(), engine: 'codex', allowUnguardedEngine: 'yes' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /allowUnguardedEngine must be true or false/);
});

test('engine: a default body, or Claude named, passes no engine option', async () => {
  for (const extra of [{}, { engine: 'claude' }, { engine: 'claude', allowUnguardedEngine: true }]) {
    const r = await post('/api/run', { ...body(), ...extra });
    assert.equal(r.status, 200, JSON.stringify(extra));
    const { runId } = await r.json();
    const o = runs.get(runId).orch;
    assert.equal('engine' in o.opts.claude, false, JSON.stringify(extra));
    assert.equal('allowUnguardedEngine' in o.opts.claude, false, JSON.stringify(extra));
    assert.equal(o.claude.engine, 'claude');
    // wf_default's clarify node always asks a human (only `auto: true` skips it, and a
    // direct POST never sets that) — stop the run instead of waiting for it to finish on
    // its own; the wiring asserted above is this test's whole point.
    await post('/api/stop', { runId });
    await untilSettled(runId);
  }
});

test('engine: codex on a set with permission rules is refused at once, with the consent offered', async () => {
  const before = runs.size;
  const r = await post('/api/run', { ...body(), engine: 'codex', guardrailsId: 'normal' });
  assert.equal(r.status, 409);
  const data = await r.json();
  assert.equal(data.code, 'engine-refused');
  assert.equal(data.overridable, true);
  assert.match(data.error, /^engine codex: guardrail set "normal" has permission rules this engine cannot enforce/);
  assert.match(data.error, /tick Allow unguarded/, 'the UI\'s consent, not the CLI flag');
  assert.doesNotMatch(data.error, /--allow-unguarded-engine/);
  assert.equal(runs.size, before, 'no run entry is left behind');
});

test('engine: a scheduled run on codex is checked when it is scheduled, not only when it fires', async () => {
  const r = await post('/api/run', { ...body(), engine: 'codex', guardrailsId: 'normal', scheduledFor: new Date(Date.now() + 3600_000).toISOString() });
  assert.equal(r.status, 409);
  const data = await r.json();
  assert.equal(data.code, 'engine-refused');
  assert.equal(data.overridable, true);
  const ok = await post('/api/run', { ...body(), engine: 'codex', scheduledFor: new Date(Date.now() + 3600_000).toISOString() });
  assert.equal(ok.status, 202, 'a set the engine can hold schedules as before');
});
test('engine: with the consent the same run starts on codex', async () => {
  const r = await post('/api/run', { ...body(), engine: 'codex', guardrailsId: 'normal', allowUnguardedEngine: true });
  assert.equal(r.status, 200);
  const { runId } = await r.json();
  const o = runs.get(runId).orch;
  assert.equal(o.claude.engine, 'codex');
  assert.equal(o.opts.claude.allowUnguardedEngine, true);
  // Same reason as the test above: wf_default's clarify node blocks on a human answer.
  await post('/api/stop', { runId });
  await untilSettled(runId);
});
