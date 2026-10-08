// test/api-engine-settings.test.mjs — the per-engine model settings over HTTP (plans/cascading-settings-design.md §5,
// §8 test 9): stepModels / utilityModels on POST /api/settings, a model of the wrong engine refused naming the slot,
// and GET /api/run-defaults naming each step slot's source.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  assert.equal(wrong.body.error, '“Step models”: "claude-opus-5-5" is a Claude model — this slot picks a Codex model.');
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
  assert.equal(wrong.body.error, '“Helper models”: "claude-opus-5-5" is a Claude model — this slot picks a Codex model.');
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
