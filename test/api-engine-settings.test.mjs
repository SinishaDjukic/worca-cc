// test/api-engine-settings.test.mjs — the per-engine model settings over HTTP (plans/cascading-settings-design.md §5,
// §8 test 9): stepModels / utilityModels on POST /api/settings, a model of the wrong engine refused naming the slot,
// and GET /api/run-defaults naming each step slot's source.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);
let sandboxHome, srv, base, projectDir;
const prevEnv = {};
const post = async (p, b) => { const r = await fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b ?? {}) }); return { status: r.status, body: await r.json() }; };
const get = async (p) => { const r = await fetch(`${base}${p}`); return { status: r.status, body: await r.json() }; };

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cc-engset-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  const { addProject } = await import('../src/core/projects.mjs');
  projectDir = gitDir('engset');
  await addProject({ name: 'engset', path: projectDir });
});
after(async () => {
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
});

test('POST /api/settings stepModels: a sparse patch per engine; null clears a role', async () => {
  const r = await post('/api/settings', { stepModels: { codex: { planner: { model: 'gpt-5.5', effort: 'low' } }, claude: { reviewer: { model: 'claude-sonnet-5' } } } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.stepModels, { codex: { planner: { model: 'gpt-5.5', effort: 'low' } }, claude: { reviewer: { model: 'claude-sonnet-5' } } });
  const d = await get(`/api/run-defaults?projectDir=${encodeURIComponent(projectDir)}`);
  assert.deepEqual(d.body.steps.codex.planner, { model: 'gpt-5.5', effort: 'low', source: 'user' });
  assert.deepEqual(d.body.steps.claude.reviewer, { model: 'claude-sonnet-5', source: 'user' });
  const c = await post('/api/settings', { stepModels: { claude: { reviewer: null } } });
  assert.deepEqual(c.body.stepModels, { codex: { planner: { model: 'gpt-5.5', effort: 'low' } } });
  assert.deepEqual((await get('/api/settings')).body.stepModels, c.body.stepModels);
});

test('a model of the other engine, or an effort the engine lacks, is refused naming the slot; nothing is written', async () => {
  const before = (await get('/api/settings')).body.stepModels;
  const wrong = await post('/api/settings', { stepModels: { codex: { reviewer: { model: 'claude-opus-5-5' } } } });
  assert.equal(wrong.status, 400);
  // #555: the error names the visible label; `field` keeps the slot.
  assert.equal(wrong.body.error, '“Step models”: "claude-opus-5-5" runs on Claude — this slot picks a model Codex can run.');
  assert.equal(wrong.body.field, 'stepModels.codex.reviewer');
  const effort = await post('/api/settings', { stepModels: { codex: { reviewer: { effort: 'max' } } } });
  assert.equal(effort.status, 400);
  assert.equal(effort.body.error, '“Step models” must be one of minimal, low, medium, high.');
  assert.equal(effort.body.field, 'stepModels.codex.reviewer.effort');
  const engine = await post('/api/settings', { stepModels: { gpt: {} } });
  assert.match(engine.body.error, /unknown engine "gpt"/);
  assert.deepEqual((await get('/api/settings')).body.stepModels, before);
});

test('POST /api/settings utilityModels: Codex helper slots; Claude ones are today\'s keys', async () => {
  const r = await post('/api/settings', { utilityModels: { codex: { title: { model: 'gpt-5.5' }, memoryDefrag: { model: 'gpt-5.5', effort: 'medium' } } } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.utilityModels, { codex: { title: { model: 'gpt-5.5' }, memoryDefrag: { model: 'gpt-5.5', effort: 'medium' } } });
  const claude = await post('/api/settings', { utilityModels: { claude: { title: { model: 'claude-haiku-4-5' } } } });
  assert.equal(claude.status, 400);
  assert.equal(claude.body.error, 'Claude’s helper models are set in Title generation model, Auto workflow model, PR description model and Defragment model.');
  assert.equal(claude.body.field, 'utilityModels.claude');
  const wrong = await post('/api/settings', { utilityModels: { codex: { overview: { model: 'claude-opus-5-5' } } } });
  assert.equal(wrong.body.error, '“Helper models”: "claude-opus-5-5" runs on Claude — this slot picks a model Codex can run.');
  assert.equal(wrong.body.field, 'utilityModels.codex.overview');
  const job = await post('/api/settings', { utilityModels: { codex: { summary: { model: 'gpt-5.5' } } } });
  assert.equal(job.status, 400);
  assert.equal(job.body.field, 'utilityModels.codex', 'the job ids are internal keys, so #555 words it generically');
});

test('GET /api/workflows/wf_memory_defrag pins the pair of the engine asked for', async () => {
  await post('/api/settings', { utilityModels: { codex: { memoryDefrag: { model: 'gpt-5.5', effort: 'medium' } } } });
  const codex = await get('/api/workflows/wf_memory_defrag?engine=codex');
  assert.deepEqual(codex.body.pinnedAgentModel, { model: 'gpt-5.5', effort: 'medium', source: 'settings' });
  const claude = await get('/api/workflows/wf_memory_defrag');
  assert.equal(claude.body.pinnedAgentModel, undefined, 'no Claude pair stored: the template\'s own model');
  await post('/api/settings', { utilityModels: { codex: { memoryDefrag: null, title: null } } });
});

// The Requirements interview row is behind the `requirements` flag (docs/feature-flags.md): on for its own tests.
const reqFlagOn = (t) => {
  const was = process.env.WORCA_FLAGS;
  process.env.WORCA_FLAGS = 'requirements';
  t.after(() => { if (was === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = was; });
};

test('requirementsInterview with the requirements flag off: GET has neither key and POST ignores it', async () => {
  const g = await get('/api/settings');
  assert.equal('requirementsInterview' in g.body, false);
  assert.equal('requirementsInterviewDefault' in g.body, false);
  const r = await post('/api/settings', { requirementsInterview: { effort: 'high' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal('requirementsInterview' in r.body, false);
  const { requirementsInterviewSetting } = await import('../src/core/settings.mjs');
  assert.equal(requirementsInterviewSetting() ?? null, null, 'nothing stored');
});

test('POST /api/settings requirementsInterview: stored per user, echoed with its default, cleared by null', async (t) => {
  reqFlagOn(t);
  const g = await get('/api/settings');
  assert.equal(g.body.requirementsInterview, null);
  assert.match(g.body.requirementsInterviewDefault.model, /^claude-opus-/);
  assert.equal(g.body.requirementsInterviewDefault.effort, 'medium');
  const r = await post('/api/settings', { requirementsInterview: { model: g.body.requirementsInterviewDefault.model, effort: 'high' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.requirementsInterview, { model: g.body.requirementsInterviewDefault.model, effort: 'high' });
  assert.equal(r.body.requirementsInterviewDefault.effort, 'medium');
  assert.deepEqual((await get('/api/settings')).body.requirementsInterview, r.body.requirementsInterview);
  const c = await post('/api/settings', { requirementsInterview: null });
  assert.equal(c.status, 200);
  assert.equal(c.body.requirementsInterview, null);
  assert.equal((await get('/api/settings')).body.requirementsInterview, null);
});

test('POST /api/settings requirementsInterview: unknown model, Codex model and a bad effort are 400s naming the field', async (t) => {
  reqFlagOn(t);
  for (const value of [{ model: 'no-such-model-xyz' }, { model: 'gpt-5.5' }, { effort: 'low' }]) {
    const r = await post('/api/settings', { requirementsInterview: value });
    assert.equal(r.status, 400, JSON.stringify(value));
    assert.match(r.body.field, /^requirementsInterview(.effort)?$/, JSON.stringify(r.body));
  }
  assert.equal((await get('/api/settings')).body.requirementsInterview, null, 'nothing was written');
});

test('POST /api/settings requirementsInterview: an effort the model does not offer is refused', async (t) => {
  reqFlagOn(t);
  const { listModels } = await import('../src/core/config.mjs');
  const m = (await listModels('')).find((x) => /^claude-/.test(x.id) && Array.isArray(x.efforts) && x.efforts.length && x.efforts.length < 4);
  if (!m) { t.skip('every Claude catalog model offers every effort: no model to refuse an effort on'); return; }
  const missing = ['medium', 'high', 'xhigh', 'max'].find((e) => !m.efforts.includes(e));
  const r = await post('/api/settings', { requirementsInterview: { model: m.id, effort: missing } });
  assert.equal(r.status, 400);
  assert.equal(r.body.field, 'requirementsInterview');
});

test('POST /api/settings requirementsInterview: a change emits a settings-changed frame', async (t) => {
  reqFlagOn(t);
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`);
  const frames = [];
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  ws.on('message', (d) => { try { frames.push(JSON.parse(String(d))); } catch { /* not JSON */ } });
  try {
    const r = await post('/api/settings', { requirementsInterview: { effort: 'high' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    for (const t0 = Date.now(); !frames.some((f) => f.type === 'settings-changed') && Date.now() - t0 < 1500;) await new Promise((res) => setTimeout(res, 10));
    assert.ok(frames.some((f) => f.type === 'settings-changed'), JSON.stringify(frames.map((f) => f.type)));
  } finally {
    ws.close();
    await post('/api/settings', { requirementsInterview: null });
  }
});
