// test/api-run-perspective-set.test.mjs — POST /api/run's chosen perspective set (flag proposedPerspectives): read
// once per start, refused with a 400 before any run exists, handed to the orchestrator as `perspectiveSet`, and the
// proposal's drops and adds stored once the run id exists (ids only). Flag off: the fields are ignored.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);

let sandboxHome, projectsRoot, srv, base, runs, project, projectDir, setFlags, listPerspectiveChoices, getDb, migrate;
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
async function untilStepper(entry, ms = 30000) {
  const t0 = Date.now();
  for (;;) {
    const s = entry.orch.getState().stepper;
    if (s && s.graph && Array.isArray(s.graph.nodes) && s.graph.nodes.length) return s;
    if (Date.now() - t0 > ms) throw new Error('the run never built its manifest');
    await new Promise((r) => setTimeout(r, 50));
  }
}

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cc-persp-home-'));
  projectsRoot = await mkdtemp(join(tmpdir(), 'worca-cc-persp-proot-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_PROJECTS_ROOT', 'WORCA_MOCK', 'WORCA_FLAGS']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_PROJECTS_ROOT = projectsRoot;
  process.env.WORCA_MOCK = '1';
  delete process.env.WORCA_FLAGS;
  const mod = await import('../ui/server.mjs');
  ({ runs } = mod);
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  ({ setFlags } = await import('../src/core/flags.mjs'));
  ({ listPerspectiveChoices } = await import('../src/core/prompt-check/perspective-choices.mjs'));
  ({ getDb, migrate } = await import('../src/core/db.mjs'));
  const { addProject } = await import('../src/core/projects.mjs');
  projectDir = gitDir('perspapi');
  project = (await addProject({ name: 'perspapi', path: projectDir })).find((p) => p.name === 'perspapi');
});
after(async () => {
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10 });
  await rm(projectsRoot, { recursive: true, force: true, maxRetries: 10 });
  if (projectDir) await rm(projectDir, { recursive: true, force: true, maxRetries: 10 });
});

const flag = (on) => setFlags({ proposedPerspectives: on });
const plain = (over = {}) => ({ projectDir: project.path, workflowId: 'wf_default', guardrailsId: 'normal', prompt: 'demo task', ...over });
const PROPOSAL = { proposed: ['product', 'qa', 'architect', 'security'], kind: 'bug' };

/** Start a run, hand its runs-map entry to `check`, then stop it and wait for it to settle. */
async function started(body, check) {
  const r = await post('/api/run', body);
  const raw = await r.text();
  assert.equal(r.status, 200, raw);
  const { runId } = JSON.parse(raw);
  const entry = runs.get(runId);
  try { await check(entry, runId); } finally {
    await post('/api/stop', { runId });
    await untilSettled(runId);
  }
  return runId;
}
async function refused(body, re) {
  const before = runs.size;
  const rows = listPerspectiveChoices().length;
  const r = await post('/api/run', body);
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, re);
  assert.equal(runs.size, before, 'no run was created');
  assert.equal(listPerspectiveChoices().length, rows, 'no row was written');
}

test('flag off: perspectives and perspectiveProposal are ignored; no perspectiveSet, no row, the reviewer keeps config {}', { timeout: 120000 }, async () => {
  await flag(false);
  const rows = listPerspectiveChoices().length;
  await started(plain({ perspectives: ['product', 'compliance'], perspectiveProposal: { junk: true } }), async (entry) => {
    assert.equal('perspectiveSet' in entry.orch.opts, false);
    const stepper = await untilStepper(entry);
    assert.deepEqual(stepper.graph.nodes.find((n) => n.id === 'n_review').config, {});
  });
  assert.equal(listPerspectiveChoices().length, rows);
});

test('flag off: a shaped run with compliance gets 400 with today\'s message', async () => {
  await flag(false);
  await refused(plain({ workflowId: undefined, shape: { perspectives: ['qa', 'compliance'] } }), /^unknown perspective\(s\): compliance — known: product, architect/);
});

test('flag on: a plain run with perspectives gets perspectiveSet.chosen, product first', { timeout: 120000 }, async () => {
  await flag(true);
  await started(plain({ perspectives: ['security', 'qa'] }), async (entry) => {
    assert.deepEqual(entry.orch.opts.perspectiveSet, { chosen: ['product', 'qa', 'security'] });
  });
});

test('flag on: a shaped run gets shape.perspectives as its set, compliance included', { timeout: 120000 }, async () => {
  await flag(true);
  await started(plain({ workflowId: undefined, shape: { perspectives: ['qa', 'compliance'] }, perspectives: ['ux'] }), async (entry) => {
    assert.deepEqual(entry.orch.opts.perspectiveSet, { chosen: ['product', 'qa', 'compliance'] });
    assert.deepEqual(entry.orch.opts.shape.perspectives, ['product', 'qa', 'compliance']);
  });
});

test('flag on: a plain run without perspectives gets no perspectiveSet', { timeout: 120000 }, async () => {
  await flag(true);
  await started(plain(), async (entry) => { assert.equal('perspectiveSet' in entry.orch.opts, false); });
});

test('flag on: a bad perspectives gets 400 and no run is created', async () => {
  await flag(true);
  await refused(plain({ perspectives: ['nope'] }), /^unknown perspective\(s\): nope/);
  await refused(plain({ perspectives: 'qa' }), /must be an array of perspective keys/);
});

test('flag on: a bad perspectiveProposal gets 400, no run and no row', async () => {
  await flag(true);
  for (const bad of [null, [], 'x', { proposed: [] }, { proposed: ['nope'], kind: 'bug' }, { proposed: ['qa'], kind: 'weird' },
    { proposed: ['product', 'qa', 'ux', 'devil', 'security', 'release', 'devops'], kind: null }]) {
    await refused(plain({ perspectives: ['qa'], perspectiveProposal: bad }), /^perspectiveProposal must be \{ proposed: perspective keys, kind \}$/);
  }
});

test('a proposal writes one row carrying the run id', { timeout: 120000 }, async () => {
  await flag(true);
  const runId = await started(plain({ perspectives: ['product', 'qa', 'compliance'], perspectiveProposal: PROPOSAL }), async () => {});
  const rows = listPerspectiveChoices({ runId });
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].proposed, rows[0].chosen, rows[0].dropped, rows[0].added, rows[0].kind, rows[0].surface],
    [['product', 'architect', 'qa', 'security'], ['product', 'qa', 'compliance'], ['architect', 'security'], ['compliance'], 'bug', 'run-card']);
});

test('a perspectiveProposal carrying text starts the run and stores no text', { timeout: 120000 }, async () => {
  await flag(true);
  const runId = await started(plain({ perspectives: ['qa'], perspectiveProposal: { ...PROPOSAL, text: 'zebra-brief', reasons: { qa: 'zebra' } } }), async () => {});
  assert.equal(listPerspectiveChoices({ runId }).length, 1);
  assert.doesNotMatch(JSON.stringify(listPerspectiveChoices()), /zebra/);
});

test('a failing write still starts the run, and the log names the failure', { timeout: 120000 }, async () => {
  await flag(true);
  const errors = [];
  const orig = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); };
  getDb().exec('DROP TABLE perspective_choices');
  try {
    await started(plain({ perspectives: ['qa'], perspectiveProposal: PROPOSAL }), async (entry) => {
      assert.deepEqual(entry.orch.opts.perspectiveSet, { chosen: ['product', 'qa'] });
    });
  } finally {
    console.error = orig;
    migrate(getDb());
    await flag(false);
  }
  assert.ok(errors.some((e) => /perspective choice record failed/.test(e)), errors.join('\n'));
});
