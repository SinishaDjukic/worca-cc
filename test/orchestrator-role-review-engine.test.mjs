// test/orchestrator-role-review-engine.test.mjs — the engine role-review step on a hand-built workflow that is not
// Shaper: a `reviewer` node declares `correctness` and `security` in its config and nothing else. The run fans out one
// independent slice per role, records each role with the model and effort its slice ran on (run > project > template,
// else the node's pair), merges the findings and hands plan and findings to one refiner. Mock mode, a git dir, no server.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { _testing } from '../src/core/graph/executor.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { writeGraphWorkflow, readWorkflow } from '../src/core/workflows.mjs';
import { setNodeModel } from '../src/core/config.mjs';
import { getDb } from '../src/core/db.mjs';

useTempHome(after);

let sandboxHome;
const prevEnv = {};
const ENV = ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK_ROLE_REVIEW'];
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-role-engine-home-'));
  for (const k of ENV) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  delete process.env.WORCA_MOCK_ROLE_REVIEW;
});
afterEach(() => { _testing.runClaude = null; });
after(async () => {
  for (const k of ENV) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const ROLE_REVIEW = {
  roles: [{ key: 'correctness', label: 'Correctness' }, { key: 'security', label: 'Security', model: 'claude-haiku-4-5', effort: 'high' }],
  source: 'declared', target: 'plan', sink: 'refiner',
};
const GRAPH = {
  name: 'Independent reviewers', domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
    { id: 'n_reviewer', kind: 'agent', key: 'reviewer', x: 600, y: 0, config: { model: 'claude-sonnet-5-5', effort: 'medium', roleReview: ROLE_REVIEW } },
    { id: 'n_refine', kind: 'agent', key: 'refiner', x: 900, y: 0, config: { awaitAll: true } },
    { id: 'n_end', kind: 'end', x: 1200, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_reviewer', port: 'plan' } },
    { id: 'w3', from: { node: 'n_reviewer', port: 'plan' }, to: { node: 'n_refine', port: 'plan' } },
    { id: 'w4', from: { node: 'n_reviewer', port: 'findings' }, to: { node: 'n_refine', port: 'findings' } },
    { id: 'w5', from: { node: 'n_refine', port: 'revise' }, to: { node: 'n_reviewer', port: 'revise' }, config: { maxCycles: 2, onExhausted: 'clean' } },
    { id: 'w6', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_end', port: 'result' } }],
};

let workflowId;
before(async () => {
  ({ id: workflowId } = await writeGraphWorkflow({ ...GRAPH }));
  const saved = await readWorkflow(workflowId);
  assert.deepEqual(saved.nodes.find((n) => n.id === 'n_reviewer').config.roleReview, ROLE_REVIEW, 'the saved workflow keeps the spec');
});

const marker = (p, k) => (new RegExp(`^${k}: (.*)$`, 'm').exec(p) || [])[1] || '';

/** One mock run of the hand-built graph; every spawn's prompt and the pair its runner was handed. */
async function runOnce({ dir = gitDir('role-engine'), overlay } = {}) {
  const spawns = [];
  _testing.runClaude = (o) => { spawns.push({ prompt: o.prompt, model: o.model, effort: o.effort }); return runClaude(o); };
  const orch = createOrchestrator({ projectDir: dir, workflowId, prompt: 'demo', claude: { mock: true }, ...(overlay ? { overlay } : {}) });
  const execs = [];
  orch.on('exec', (e) => execs.push(e));
  orch.on('question', (q) => setImmediate(() => orch.answer(q.id, q.kind === 'plan' ? { decision: 'approve' } : { answers: [] })));
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  return { orch, execs, spawns };
}
const roleSpawns = (spawns) => spawns.filter((s) => marker(s.prompt, 'MOCK_PERSPECTIVE'));
const pairs = (orch) => Object.fromEntries(orch.state.roleReviews.rounds[0].roles.map((r) => [r.key, [r.model, r.effort]]));

test('a hand-built reviewer node: 2 parallel slices, each with only its own role, 2 records, 1 findings file, 1 refiner', async () => {
  const { orch, execs, spawns } = await runOnce();
  const slices = (status) => execs.filter((e) => e.nodeId === 'n_reviewer' && e.kind === 'task' && e.status === status);
  assert.deepEqual(slices('start').map((e) => e.title), ['Correctness', 'Security'], 'declared order');
  const idx = (e) => execs.indexOf(e);
  assert.ok(Math.max(...slices('start').map(idx)) < Math.min(...slices('done').map(idx)), 'both start before either finishes');

  const prompts = roleSpawns(spawns).map((s) => s.prompt);
  assert.equal(prompts.length, 2);
  for (const p of prompts) {
    const heads = [...p.matchAll(/^## Your role: (.+)$/gm)].map((m) => m[1]);
    assert.deepEqual(heads, [{ correctness: 'Correctness', security: 'Security' }[marker(p, 'MOCK_PERSPECTIVE')]]);
    assert.doesNotMatch(p, /## Perspectives|`R-|Your checklist prefix|house brief/, 'no Shaper perspective text');
  }

  const rr = orch.state.roleReviews;
  assert.equal(rr.rounds.length, 1);
  assert.deepEqual(rr.rounds[0].roles.map((r) => [r.key, r.label]), [['correctness', 'Correctness'], ['security', 'Security']]);
  assert.deepEqual(pairs(orch), { correctness: ['claude-sonnet-5-5', 'medium'], security: ['claude-haiku-4-5', 'high'] },
    'security: the template pick; correctness: no pick, the node\'s pair');
  // The record names what ran: the pair handed to the slice's runner.
  for (const s of roleSpawns(spawns)) {
    const rec = rr.rounds[0].roles.find((r) => r.key === marker(s.prompt, 'MOCK_PERSPECTIVE'));
    assert.deepEqual([s.model, s.effort], [rec.model, rec.effort]);
  }

  const snap = orch._graphSnapshot.execs;
  const refines = snap.filter((e) => e.nodeId === 'n_refine');
  assert.equal(refines.length, 1, 'the refiner runs once');
  const reviewer = snap.find((e) => e.nodeId === 'n_reviewer' && e.kind !== 'task');
  assert.equal(refines[0].bindings.plan.path, reviewer.bindings.plan.path, 'the refiner gets the reviewed plan');
  const findings = await readFile(refines[0].bindings.findings.path, 'utf8');
  assert.deepEqual([...findings.matchAll(/^## (.+)$/gm)].map((m) => m[1]), ['Correctness', 'Security', 'Dispositions'], 'the contract ends the file');
});

test('the project pick beats the template; a run overlay pick beats the project, per role', async () => {
  const dir = gitDir('role-engine-project');
  await setNodeModel(dir, workflowId, 'n_reviewer', { roles: { correctness: { model: 'claude-opus-5-5', effort: 'max' } } });
  const project = await runOnce({ dir });
  assert.deepEqual(pairs(project.orch), { correctness: ['claude-opus-5-5', 'max'], security: ['claude-haiku-4-5', 'high'] });
  for (const s of roleSpawns(project.spawns)) {
    const rec = project.orch.state.roleReviews.rounds[0].roles.find((r) => r.key === marker(s.prompt, 'MOCK_PERSPECTIVE'));
    assert.deepEqual([s.model, s.effort], [rec.model, rec.effort]);
  }

  const run = await runOnce({ dir, overlay: { nodes: { n_reviewer: { roles: { correctness: { model: 'claude-haiku-4-5', effort: 'medium' } } } } } });
  assert.deepEqual(pairs(run.orch), { correctness: ['claude-haiku-4-5', 'medium'], security: ['claude-haiku-4-5', 'high'] });
  const cell = run.orch.state.stepper.graph.nodes.find((n) => n.id === 'n_reviewer');
  assert.deepEqual(cell.roles.correctness, { model: 'claude-haiku-4-5', effort: 'medium', source: 'run' }, 'the manifest records it');
});

test('a role that names only an effort runs on the node\'s model with the role\'s effort, and records that pair', async () => {
  const roleReview = { ...ROLE_REVIEW, roles: [{ key: 'correctness', label: 'Correctness', effort: 'high' }, { key: 'security', label: 'Security' }] };
  const { id } = await writeGraphWorkflow({ ...GRAPH, name: 'Effort-only reviewers',
    nodes: GRAPH.nodes.map((n) => (n.id === 'n_reviewer' ? { ...n, config: { ...n.config, roleReview } } : n)) });
  const spawns = [];
  _testing.runClaude = (o) => { spawns.push({ prompt: o.prompt, model: o.model, effort: o.effort }); return runClaude(o); };
  const orch = createOrchestrator({ projectDir: gitDir('role-engine-effort'), workflowId: id, prompt: 'demo', claude: { mock: true } });
  orch.on('question', (q) => setImmediate(() => orch.answer(q.id, q.kind === 'plan' ? { decision: 'approve' } : { answers: [] })));
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(pairs(orch), { correctness: ['claude-sonnet-5-5', 'high'], security: ['claude-sonnet-5-5', 'medium'] });
  for (const s of roleSpawns(spawns)) {
    const rec = orch.state.roleReviews.rounds[0].roles.find((r) => r.key === marker(s.prompt, 'MOCK_PERSPECTIVE'));
    assert.deepEqual([s.model, s.effort], [rec.model, rec.effort], 'the dispatched pair');
  }
});

// A usage limit during a role slice names the connection that ROLE ran on, not the node's (D8).
const LIMIT_ERR = () => new Error("claude exited with code 1: You've hit your session limit · resets 6pm (Europe/Sofia)");
async function limitedRun(limitedRole) {
  const { addGlobalModel, listGlobalModels } = await import('../src/core/settings.mjs');
  if (!listGlobalModels().some((m) => m.id === 'gw-role-limited')) await addGlobalModel({ id: 'gw-role-limited', upstream: { provider: 'openai', api: 'openai-chat', model: 'x', baseUrl: 'http://127.0.0.1:9/v1' } });
  _testing.runClaude = (o) => { if (marker(o.prompt, 'MOCK_PERSPECTIVE') === limitedRole) throw LIMIT_ERR(); return runClaude(o); };
  const orch = createOrchestrator({
    projectDir: gitDir('role-limit'), workflowId, prompt: 'demo', claude: { mock: true },
    overlay: { nodes: { n_reviewer: { roles: { security: { model: 'gw-role-limited' } } } } },
  });
  orch.on('question', (q) => setImmediate(() => orch.answer(q.id, q.kind === 'plan' ? { decision: 'approve' } : { answers: [] })));
  return orch.run();
}

test('a usage limit on a role slice that runs on a provider model names that provider; the node stays on the sign-in', async () => {
  const res = await limitedRun('security');
  assert.equal(res.status, 'paused', res.error);
  assert.equal(res.reason, 'usage_limit');
  assert.match(res.detail, /^OpenAI-compatible limit — /);
  assert.equal(res.limitEngine, null, 'another harness on the same provider would hit it too');
});

test('a usage limit on a role slice that runs on the node\'s model is the sign-in\'s', async () => {
  const res = await limitedRun('correctness');
  assert.equal(res.status, 'paused', res.error);
  assert.equal(res.reason, 'usage_limit');
  assert.equal(res.limitEngine, 'claude');
  assert.doesNotMatch(res.detail, /limit — /);
});

// ── dispositions and counts (#990 slice 3): any sink answers in the dispositions file the findings name ──

const isCounts = (c) => !!c && ['raised', 'fixed', 'disputed', 'open'].every((k) => Number.isInteger(c[k]) && c[k] >= 0)
  && c.raised === c.fixed + c.disputed + c.open;
const auditOf = (orch) => getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ?').all(orch.getState().id).map((r) => r.text);
async function withKnobs(vars, fn) {
  const prev = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  try {
    for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}
const NO_KNOBS = { WORCA_MOCK_DISPOSITIONS: undefined, WORCA_MOCK_CONFLICTS: undefined };

/** One mock run; `onSpawn(o, orch)` runs before each spawn, `afterSpawn(o, orch)` after it. */
async function runWith({ id = workflowId, dir = gitDir('role-engine-disp'), onSpawn, afterSpawn } = {}) {
  let orch = null;
  const spawns = [];
  _testing.runClaude = async (o) => {
    spawns.push(o.prompt);
    if (onSpawn) await onSpawn(o, orch);
    const out = await runClaude(o);
    if (afterSpawn) await afterSpawn(o, orch);
    return out;
  };
  orch = createOrchestrator({ projectDir: dir, workflowId: id, prompt: 'demo', claude: { mock: true } });
  orch.on('question', (q) => setImmediate(() => orch.answer(q.id, q.kind === 'plan' ? { decision: 'approve' } : { answers: [] })));
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  return { orch, spawns };
}

test('every round carries numeric counts, right after the review and after the refiner answers', async () => {
  const atSink = [];
  const { orch } = await withKnobs(NO_KNOBS, () => runWith({
    onSpawn: (o, orch) => { if (marker(o.prompt, 'MOCK_ROLE') === 'refiner') atSink.push(structuredClone(orch.state.roleReviews.rounds.at(-1))); },
  }));
  assert.equal(atSink.length, 1);
  assert.deepEqual(atSink[0].counts, { raised: 2, fixed: 0, disputed: 0, open: 2 }, 'born with counts, all open');
  assert.ok(atSink[0].dispositions.endsWith('-dispositions.json'), 'the round names its dispositions file');
  for (const r of orch.state.roleReviews.rounds) {
    assert.ok(isCounts(r.counts), JSON.stringify(r.counts));
    for (const rec of r.roles.filter((x) => !x.skipped)) assert.ok(isCounts(rec.counts), rec.key);
  }
  assert.deepEqual(orch.state.roleReviews.rounds[0].counts, { raised: 2, fixed: 2, disputed: 0, open: 0 }, 'the mock refiner fixed both');
  assert.ok(auditOf(orch).includes('Role findings, round 1: 2 raised, 2 fixed, 0 disputed, 0 open; 0 conflict(s) for the person.'));
});

test('an omitted answer counts as open and a disputed one as disputed', async () => {
  const { orch } = await withKnobs({ WORCA_MOCK_DISPOSITIONS: '{"security-1-1":"omit","correctness-1-1":"disputed"}', WORCA_MOCK_CONFLICTS: undefined },
    () => runWith());
  const round = orch.state.roleReviews.rounds[0];
  assert.deepEqual(round.counts, { raised: 2, fixed: 0, disputed: 1, open: 1 });
  const [c, s] = round.roles.map((r) => r.findings[0]);
  assert.deepEqual([c.status, s.status], ['disputed', 'open']);
  assert.ok(c.reason);
});

test('a conflict between the two roles on one section rides round.conflicts', async () => {
  const conflicts = [{ findings: ['correctness-1-1', 'security-1-1'], question: 'Which way?', options: ['A', 'B'] }];
  const { orch } = await withKnobs({ WORCA_MOCK_DISPOSITIONS: undefined, WORCA_MOCK_CONFLICTS: JSON.stringify(conflicts) }, () => runWith());
  const round = orch.state.roleReviews.rounds[0];
  const sections = round.roles.map((r) => r.findings[0].section);
  assert.equal(sections[0], sections[1], 'the mock reviewer files both findings under one section');
  assert.deepEqual(round.conflicts.map((c) => [c.id, c.findings, c.roles]), [['conflict-1', ['correctness-1-1', 'security-1-1'], ['correctness', 'security']]]);
  assert.ok(auditOf(orch).some((t) => /^Role findings, round 1: .*; 1 conflict\(s\) for the person\.$/.test(t)));
});

test('an unreadable dispositions file counts as open, with an audit line, and never fails the run', async () => {
  for (const junk of ['not json {', `{"dispositions":[],"pad":"${'x'.repeat(262144)}"}`]) {
    const { orch } = await withKnobs({ WORCA_MOCK_DISPOSITIONS: '{"correctness-1-1":"omit","security-1-1":"omit"}', WORCA_MOCK_CONFLICTS: undefined },
      () => runWith({ afterSpawn: async (o, orch) => {
        if (marker(o.prompt, 'MOCK_ROLE') === 'refiner') await writeFile(orch.state.roleReviews.rounds.at(-1).dispositions, junk);
      } }));
    assert.deepEqual(orch.state.roleReviews.rounds[0].counts, { raised: 2, fixed: 0, disputed: 0, open: 2 });
    assert.ok(auditOf(orch).some((t) => /dispositions file .*(unreadable|over 262144 bytes)/.test(t)), auditOf(orch).join('\n'));
  }
});

test('an implementer sink records the same counts; its fix input carries the findings, with no implementer branch in the engine', async () => {
  const graph = {
    ...GRAPH, name: 'Reviewers into the implementer',
    nodes: [...GRAPH.nodes.filter((n) => !['n_refine', 'n_reviewer'].includes(n.id)),
      { id: 'n_reviewer', kind: 'agent', key: 'reviewer', x: 600, y: 0, config: { roleReview: { ...ROLE_REVIEW, sink: 'implementer' } } },
      { id: 'n_impl', kind: 'agent', key: 'implementer', x: 900, y: 0, config: {} }],
    wires: [GRAPH.wires[0], GRAPH.wires[1],
      { id: 'w3', from: { node: 'n_reviewer', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
      { id: 'w4', from: { node: 'n_reviewer', port: 'findings' }, to: { node: 'n_impl', port: 'fix' } },
      { id: 'w6', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_end', port: 'result' } }],
  };
  const { id } = await writeGraphWorkflow(graph);
  const { orch, spawns } = await withKnobs({ WORCA_MOCK_DISPOSITIONS: '{"security-1-1":"disputed"}', WORCA_MOCK_CONFLICTS: undefined },
    () => runWith({ id, dir: gitDir('role-engine-impl') }));
  const rounds = orch.state.roleReviews.rounds;
  assert.equal(rounds.length, 1);
  assert.deepEqual(rounds[0].counts, { raised: 2, fixed: 1, disputed: 1, open: 0 });
  assert.equal('fixedIn' in rounds[0].roles[0].findings[0], false, 'no plan version for a non-refiner sink');
  const findingsPath = orch._graphSnapshot.execs.find((e) => e.nodeId === 'n_impl').bindings.fix.path;
  const impl = spawns.find((p) => marker(p, 'MOCK_ROLE') === 'implementer');
  assert.ok(impl.includes(findingsPath), 'the implementer prompt names the findings path');
  assert.equal(marker(impl, 'MOCK_IN'), findingsPath);
  const src = readFileSync(new URL('../src/core/orchestrator.mjs', import.meta.url), 'utf8');
  const hook = src.slice(src.indexOf('  async _applyRoleReviewVerdict('), src.indexOf('\n  }\n', src.indexOf('  async _applyRoleReviewVerdict(')));
  assert.doesNotMatch(hook, /implementer/, 'the hook has no implementer branch');
});
