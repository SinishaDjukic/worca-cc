// test/api-run-exec-env.test.mjs — the run body's `execEnv` (plans/e2b-execution-design.md §12): GET /api/run-defaults
// names the resolved default, an e2b start or resume the preflight refuses answers 409 before anything is announced or
// committed, an accepted e2b start carries the option, and an explicit `local` (the Watch PR / Resolve merge runs)
// adds nothing to the run options even when the user default is e2b.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { stopAndSettle } from './helpers/stop-and-settle.mjs';

useTempHome(after);
let sandboxHome, srv, base, runs, projectDir, getDb;
const prevEnv = {};
const JSONH = { 'Content-Type': 'application/json' };
const post = async (p, b) => { const r = await fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b ?? {}) }); return { status: r.status, body: await r.json() }; };
const get = async (p) => { const r = await fetch(`${base}${p}`); return { status: r.status, body: await r.json() }; };
const saveUser = async (obj) => {
  await mkdir(join(sandboxHome, '.worca-cc'), { recursive: true });
  await writeFile(join(sandboxHome, '.worca-cc', 'settings.json'), JSON.stringify(obj));
};
async function until(pred, ms = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = pred(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error('condition never held');
}

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cc-execenv-home-'));
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
  ({ getDb } = await import('../src/core/db.mjs'));
  projectDir = gitDir('execenv');
  await addProject({ name: 'execenv', path: projectDir });
});
after(async () => {
  if (runs) await stopAndSettle(runs).catch(() => {});
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
});

async function seedWorkspace() {
  const r = await post('/api/workspaces', { name: `E2B ${Date.now()}`, projectPaths: [gitDir('execenv-a'), gitDir('execenv-b')] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.workspace.id;
}

test('GET /api/run-defaults names the execution environment and where it came from', async () => {
  await saveUser({});
  assert.deepEqual((await get(`/api/run-defaults?projectDir=${encodeURIComponent(projectDir)}`)).body.execEnv, { value: 'local', source: 'default' });
  await saveUser({ execEnv: 'e2b' });
  try { assert.deepEqual((await get('/api/run-defaults')).body.execEnv, { value: 'e2b', source: 'user' }); }
  finally { await saveUser({}); }
});

test('an e2b workspace run is refused with 409 exec-env-refused before anything is announced', async () => {
  const workspaceId = await seedWorkspace();
  const before = runs.size;
  const r = await post('/api/run', { workspaceId, prompt: 'demo task', mock: true, execEnv: 'e2b' });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.code, 'exec-env-refused');
  assert.match(r.body.error, /single-project/);
  assert.equal(runs.size, before);
});

test('a refused e2b resume answers 409 before it commits: the run stays paused', async () => {
  const workspaceId = await seedWorkspace();
  const r = await post('/api/run', { workspaceId, prompt: 'demo task', mock: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await until(() => runs.get(r.body.runId)?.pendingQuestion);
  assert.equal((await post('/api/pause', { runId: r.body.runId })).status, 200);
  const pipelineId = await until(() => {
    const id = runs.get(r.body.runId)?.orch?.state?.id;
    const row = id && getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(id);
    return row?.status === 'paused' ? id : null;
  });
  const row = getDb().prepare('SELECT resume_point FROM pipelines WHERE id = ?').get(pipelineId);
  const rp = JSON.parse(row.resume_point);
  getDb().prepare('UPDATE pipelines SET resume_point = ? WHERE id = ?').run(JSON.stringify({ ...rp, execEnv: { kind: 'e2b' } }), pipelineId);
  const res = await post('/api/resume', { pipelineId });
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'exec-env-refused');
  assert.match(res.body.error, /single-project/);
  assert.equal(getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(pipelineId).status, 'paused');
});

test('an e2b project run is accepted under mock and carries the option', async () => {
  const r = await post('/api/run', { projectDir, prompt: 'demo task', mock: true, execEnv: 'e2b' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const orch = runs.get(r.body.runId).orch;
  assert.equal(orch.execEnvKind, 'e2b');
  assert.equal(orch.opts.execEnv, 'e2b');
  assert.equal(orch.state.execEnv, 'e2b');
  await until(() => getDb().prepare('SELECT id FROM pipelines WHERE id = ?').get(orch.state.id || ''));
  await stopAndSettle(runs, (e) => e.id === r.body.runId);
});

// A chat card's stored execEnv: a request from a card that sends none (a tab still running the code from before the
// card had a Runs in field) runs where the card said; the card's own Default sends '' and keeps the default.
test('a chat card start without execEnv runs where the card said; an explicit empty or local pick wins', async () => {
  const { createThread, appendMessage } = await import('../src/core/ask/store.mjs');
  let n = 0;
  const seed = () => {
    const t = createThread();
    const id = `card_e2b${String(++n).padStart(5, '0')}`;
    appendMessage(t.id, { role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', id, state: 'proposed',
      card: { target: 'project', projectDir, workflowId: 'wf_default', guardrailsId: 'normal', brief: 'demo task', title: 'Demo', execEnv: 'e2b' } }] });
    return { askThreadId: t.id, askCardId: id };
  };
  for (const [name, extra, want] of [['no key', {}, 'e2b'], ['Default', { execEnv: '' }, 'local'], ['Local', { execEnv: 'local' }, 'local']]) {
    const r = await post('/api/run', { projectDir, prompt: 'demo task', mock: true, ...extra, ...seed() });
    assert.equal(r.status, 200, `${name}: ${JSON.stringify(r.body)}`);
    assert.equal(runs.get(r.body.runId).orch.execEnvKind, want, name);
    await stopAndSettle(runs, (e) => e.id === r.body.runId);
  }
});

test('an explicit local beats a user default of e2b and adds no run option (the merge runs rely on it)', async () => {
  await saveUser({ execEnv: 'e2b' });
  try {
    const r = await post('/api/run', { projectDir, prompt: 'demo task', mock: true, execEnv: 'local' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const orch = runs.get(r.body.runId).orch;
    assert.equal(orch.execEnvKind, 'local');
    assert.equal(Object.hasOwn(orch.opts, 'execEnv'), false);
    assert.equal(Object.hasOwn(orch.state, 'execEnv'), false);
    await stopAndSettle(runs, (e) => e.id === r.body.runId);
  } finally { await saveUser({}); }
});

test('a saved e2b default does not refuse runs: a workspace run starts locally, and a codex schedule is accepted', async () => {
  await saveUser({ execEnv: 'e2b' });
  try {
    const workspaceId = await seedWorkspace();
    const r = await post('/api/run', { workspaceId, prompt: 'demo task', mock: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const entry = runs.get(r.body.runId);
    const orch = entry.orch;
    assert.equal(orch.execEnvKind, 'local');
    assert.equal(Object.hasOwn(orch.opts, 'execEnv'), false);
    // The run's own log says why it runs locally (the live stream and live-log.ndjson), not just the server console.
    const why = 'the saved E2B default does not apply to a workspace run; it runs locally';
    const line = await until(() => entry.events.find((e) => e.type === 'log' && e.text === why));
    assert.equal(line.source, 'exec-env');
    assert.equal(line.level, 'warn');
    const logFile = join(await until(() => orch.state.pipelineDir), 'live-log.ndjson');
    await until(() => { try { return readFileSync(logFile, 'utf8').includes(why); } catch { return false; } });
    await stopAndSettle(runs, (e) => e.id === r.body.runId);
    // The Watch PR fix of a codex run sends `engine` and no `execEnv`; a schedule is checked at once.
    const s = await post('/api/run', { projectDir, prompt: 'demo task', mock: true, engine: 'codex', guardrailsId: 'permissive', scheduledFor: new Date(Date.now() + 3600_000).toISOString() });
    assert.equal(s.status, 202, JSON.stringify(s.body));
  } finally { await saveUser({}); }
});

test('an execEnv that is not a string, or an unknown one, is a 400', async () => {
  const bad = await post('/api/run', { projectDir, prompt: 'demo task', mock: true, execEnv: 42 });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /execEnv must be a string/);
  const unknown = await post('/api/run', { projectDir, prompt: 'demo task', mock: true, execEnv: 'docker' });
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.error, /unknown execution environment "docker"/);
});
