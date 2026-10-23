// test/api-naming.test.mjs — Smart run naming routes (flag smartRunNaming): 404 while off, the suggest shape, the 400,
// project overrides, the fallback hint, and the body mapping of the form's markers (via the stored schedule request).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);
let sandboxHome, srv, base, runs, projectDir;
const prevEnv = {};
const JSONH = { 'Content-Type': 'application/json' };
const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: JSONH, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cc-naming-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK', 'WORCA_FLAGS']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_FLAGS = '-smartRunNaming';
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  runs = mod.runs;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  const { addProject } = await import('../src/core/projects.mjs');
  projectDir = gitDir('naming');
  await addProject({ name: 'naming', path: projectDir });
});
after(async () => {
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
});

const TASK = 'Login redirects back to /login after SSO on Safari';

test('flag off: both routes answer 404', async () => {
  process.env.WORCA_FLAGS = '-smartRunNaming';
  assert.equal((await call('GET', '/api/naming/config')).status, 404);
  assert.equal((await call('POST', '/api/naming/suggest', { prompt: TASK })).status, 404);
});

test('flag on, mock: 200 shape; an empty prompt is 400', async () => {
  process.env.WORCA_FLAGS = 'smartRunNaming';
  const ok = await call('POST', '/api/naming/suggest', { prompt: TASK });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.source, 'model');
  assert.match(ok.body.branch, /^feat\//);
  assert.deepEqual(ok.body.types, ['feat', 'fix', 'chore', 'docs', 'refactor', 'test']);
  assert.equal((await call('POST', '/api/naming/suggest', { prompt: '  ' })).status, 400);
  const cfg = await call('GET', '/api/naming/config');
  assert.equal(cfg.status, 200);
  assert.equal(cfg.body.pattern, '{type}/{slug}');
});

test('flag on: the saved pattern and the field switches are honoured', async () => {
  process.env.WORCA_FLAGS = 'smartRunNaming';
  assert.equal((await call('POST', '/api/settings', { smartNaming: { pattern: '{type}/x-{slug}', types: ['fix'], suggestBranch: false } })).status, 200);
  const r = await call('POST', '/api/naming/suggest', { prompt: TASK });
  assert.equal(r.body.branch, undefined);
  assert.equal(r.body.title, 'Mock title');
  await call('POST', '/api/settings', { smartNaming: { suggestBranch: true } });
  const b = await call('POST', '/api/naming/suggest', { prompt: TASK });
  assert.match(b.body.branch, /^fix\/x-/);
  await call('POST', '/api/settings', { smartNaming: { suggestTitle: false, suggestBranch: false } });
  assert.equal((await call('POST', '/api/naming/suggest', { prompt: TASK })).body.source, 'off');
  await call('POST', '/api/settings', { smartNaming: null });
});

test('GET /api/naming/config: picked follows namingModel, and leaves it after a clear', async () => {
  process.env.WORCA_FLAGS = 'smartRunNaming';
  let r = await call('POST', '/api/settings', { namingModel: { model: 'claude-opus-5-5', effort: 'high' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  let c = (await call('GET', '/api/naming/config')).body;
  assert.deepEqual([c.picked.model, c.picked.effort, c.picked.source], ['claude-opus-5-5', 'high', 'settings']);
  assert.equal('model' in c, false, 'the smartNaming block carries no model any more');
  r = await call('POST', '/api/settings', { namingModel: null });
  assert.equal(r.status, 200);
  c = (await call('GET', '/api/naming/config')).body;
  assert.notEqual(c.picked?.source, 'settings', 'cleared: the cheapest ready Claude model, or none in a sandbox with no sign-in');
});

test('GET /api/naming/config: a stale namingModel warns once per id, not on every resolve', async () => {
  process.env.WORCA_FLAGS = 'smartRunNaming';
  const { writeFile, readFile, mkdir } = await import('node:fs/promises');
  const file = join(sandboxHome, '.worca-cc', 'settings.json');
  await mkdir(join(sandboxHome, '.worca-cc'), { recursive: true });
  let cur = {};
  try { cur = JSON.parse(await readFile(file, 'utf8')); } catch { /* none yet */ }
  await writeFile(file, JSON.stringify({ ...cur, namingModel: { model: 'gone-naming-model' } }));
  const warn = console.warn;
  const warnings = [];
  console.warn = (...a) => { warnings.push(a.join(' ')); };
  try {
    for (let i = 0; i < 3; i++) assert.equal((await call('GET', '/api/naming/config')).body.picked.stale, 'gone-naming-model');
  } finally { console.warn = warn; }
  const hits = warnings.filter((w) => w === '[worca] namingModel "gone-naming-model" is no longer in the catalog — run naming uses the cheapest ready Claude model');
  assert.equal(hits.length, 1, warnings.join('\n'));
  await call('POST', '/api/settings', { namingModel: null });
});

test('start body markers must be booleans', async () => {
  process.env.WORCA_FLAGS = 'smartRunNaming';
  const r = await call('POST', '/api/run', { projectDir, prompt: TASK, featureBranchSuggested: 'yes' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /featureBranchSuggested must be true or false/);
});

async function startOpts(flag, body) {
  process.env.WORCA_FLAGS = flag;
  const r = await call('POST', '/api/run', { projectDir, prompt: TASK, ...body });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const e = runs.get(r.body.runId);
  const out = { titleLocked: e.orch.opts.titleLocked, branch: { ...e.orch.branchOpts } };
  await call('POST', '/api/stop', { runId: r.body.runId });
  return out;
}

test('start mapping: a given title locks while the flag is on; the markers become branch.suggested / legacy', async () => {
  const on = await startOpts('smartRunNaming', { title: 'My title', featureBranch: 'fix/a', featureBranchSuggested: true });
  assert.equal(on.titleLocked, true);
  assert.equal(on.branch.feature, 'fix/a'); assert.equal(on.branch.suggested, true); assert.equal(on.branch.legacy, false);
  const typed = await startOpts('smartRunNaming', { title: 'My title', featureBranch: 'fix/b' });
  assert.equal(typed.branch.suggested, false);
  const fb = await startOpts('smartRunNaming', { featureBranch: 'worca-cc/x', featureBranchFallback: true });
  assert.equal(fb.branch.feature, null); assert.equal(fb.branch.legacy, true); assert.ok(!fb.titleLocked);
});

test('start mapping: flag off ignores every marker', async () => {
  const off = await startOpts('-smartRunNaming', { title: 'My title', featureBranch: 'fix/c', featureBranchSuggested: true, featureBranchFallback: true });
  assert.ok(!off.titleLocked);
  assert.equal(off.branch.feature, 'fix/c'); assert.equal(off.branch.suggested, false); assert.equal(off.branch.legacy, false);
});
