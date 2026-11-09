// test/orchestrator-role-reviews.test.mjs — role reviews (spec §3) end to end on the real orchestrator in mock mode:
// one planReviewer slice per picked perspective, in parallel, each with its own brief; one refiner per round on all
// findings; at most 2 rounds, then the plan approval; the round-2 skip; resume; "Ask for changes"; an old manifest.
// It needs the orchestrator and a git dir (no browser, no server).
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { getDb } from '../src/core/db.mjs';
import { _testing } from '../src/core/graph/executor.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { buildGraphManifest } from '../src/shared/graph/manifest.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { GRAPH_SHAPE_WORKFLOW, GRAPH_DEFAULT_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';
import { DEFAULT_PERSPECTIVES } from '../src/shared/shape/perspectives.mjs';
import { roundCounts } from '../src/shared/review/findings.mjs';

useTempHome(after);

let sandboxHome;
const prevEnv = {};
const ENV = ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK_ROLE_REVIEW'];
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-roles-home-'));
  for (const k of ENV) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  delete process.env.WORCA_MOCK_ROLE_REVIEW;
});
afterEach(() => { delete process.env.WORCA_MOCK_ROLE_REVIEW; _testing.runClaude = null; });
after(async () => {
  for (const k of ENV) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const SHAPE = { perspectives: ['product', 'ux', 'qa'] };
const waitFor = async (pred, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error('waitFor timed out');
};
const severities = (table) => { process.env.WORCA_MOCK_ROLE_REVIEW = JSON.stringify(table); };

/** A mock wf_shape run; Clarify answers empty, plan asks go to `onPlan(q, orch)` (default: approve). */
function start(opts = {}, onPlan = (q, orch) => orch.answer(q.id, { decision: 'approve' }), onClarify = null) {
  const dir = opts.projectDir || gitDir('roles');
  const orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_shape', prompt: 'demo', claude: { mock: true }, shape: SHAPE, ...opts });
  const plans = []; const execs = []; const asks = [];
  orch.on('exec', (e) => execs.push(e));
  orch.on('question', (q) => {
    asks.push(q);
    if (q.kind === 'plan') { plans.push(q); setImmediate(() => onPlan(q, orch)); return; }
    if (q.kind === 'clarify' || q.kind === 'questions') {
      setImmediate(() => (onClarify ? onClarify(q, orch) : orch.answer(q.id, { answers: [] })));
    }
  });
  const done = opts.resume ? orch.resume() : orch.run();
  return { orch, plans, execs, asks, done, dir };
}
const shells = (execs, nodeId, status = 'start') => execs.filter((e) => e.nodeId === nodeId && e.kind !== 'task' && e.status === status);
const slices = (execs, status = 'start') => execs.filter((e) => e.nodeId === 'n_roles' && e.kind === 'task' && e.status === status);
/** The plan role rounds (n_roles); Shaper's Review appends its own code rounds (n_review) since #990 slice 4. */
const planRounds = (orch) => orch.state.roleReviews.rounds.filter((r) => r.node === 'n_roles');
const auditOf = (orch) => getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ?').all(orch.getState().id).map((r) => r.text);

test('1-3 one round: 3 parallel reviewers, each with only its own brief; Refine runs once on all their findings', async () => {
  const prompts = [];
  _testing.runClaude = (o) => { prompts.push(o.prompt); return runClaude(o); };
  const h = start();
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);

  // 1. parallel: every slice start precedes the first slice done; Refine starts after the last slice done
  const idx = (e) => h.execs.indexOf(e);
  const starts = slices(h.execs, 'start');
  const dones = slices(h.execs, 'done');
  assert.equal(starts.length, 3);
  assert.deepEqual(starts.map((e) => e.title), ['Product', 'QA', 'UX'], 'titled by perspective, in perspective order');
  assert.ok(Math.max(...starts.map(idx)) < Math.min(...dones.map(idx)), 'all 3 start before any finishes');
  assert.ok(idx(shells(h.execs, 'n_refine')[0]) > Math.max(...dones.map(idx)), 'Refine waits for every reviewer');

  // 2. own brief only
  const reviewerPrompts = prompts.filter((p) => /^MOCK_ROLE: plan-review$/m.test(p));
  assert.equal(reviewerPrompts.length, 3);
  for (const p of reviewerPrompts) {
    const heads = [...p.matchAll(/^## Your role: (.+)$/gm)].map((m) => m[1]);
    const key = /^MOCK_PERSPECTIVE: (\S+)$/m.exec(p)[1];
    assert.deepEqual(heads, [{ product: 'Product', ux: 'UX', qa: 'QA' }[key]]);
  }
  const ux = reviewerPrompts.find((p) => /^MOCK_PERSPECTIVE: ux$/m.test(p));
  assert.match(ux, /`R-ux-1`/);
  assert.doesNotMatch(ux, /`R-qa-1`/);

  // 3. one refiner on the merged findings and on the plan the reviewers read
  assert.equal(shells(h.execs, 'n_refine').length, 1);
  assert.equal(shells(h.execs, 'n_roles').length, 1, 'no blocker: one round');
  const snapExecs = h.orch._graphSnapshot.execs;
  const ref = snapExecs.find((e) => e.nodeId === 'n_refine' && e.ordinal === 1);
  const roles = snapExecs.find((e) => e.nodeId === 'n_roles' && e.ordinal === 1 && e.kind !== 'task');
  assert.equal(ref.bindings.plan.path, roles.bindings.plan.path);
  const findings = await readFile(ref.bindings.findings.path, 'utf8');
  for (const s of ['Product', 'UX', 'QA']) assert.match(findings, new RegExp(`^## ${s}$`, 'm'));
  assert.equal(h.plans.length, 1);

  // 7. state + reviews rows
  assert.deepEqual(planRounds(h.orch).map((r) => [r.pass, r.round]), [[1, 1]]);
  const kinds = getDb().prepare('SELECT kind FROM reviews WHERE pipeline_id = ?').all(h.orch.getState().id).map((r) => r.kind);
  for (const k of ['role-product', 'role-ux', 'role-qa']) assert.ok(kinds.includes(k), `${k} in ${kinds}`);
});

test('4-5 a round-1 critical earns round 2, which starts only the blocked role; then the approval, no gate', async () => {
  severities({ ux: { 1: 'critical' } });
  const h = start();
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.equal(shells(h.execs, 'n_roles').length, 2);
  assert.equal(shells(h.execs, 'n_refine').length, 2);
  const round2 = slices(h.execs).filter((e) => e.executionId.startsWith('x:n_roles:2:'));
  assert.deepEqual(round2.map((e) => e.title), ['UX'], 'product and qa make 0 agent calls in round 2');
  assert.equal(h.asks.filter((a) => a.kind === 'gate').length, 0);
  assert.equal(h.plans.length, 1);
  const rounds = planRounds(h.orch);
  assert.deepEqual(rounds.map((r) => [r.pass, r.round]), [[1, 1], [1, 2]]);
  assert.deepEqual(rounds[1].roles.filter((r) => r.skipped).map((r) => r.key), ['product', 'qa']);
  assert.equal(rounds[0].roles.find((r) => r.key === 'ux').findings[0].status, 'fixed', 'the mock refiner addressed it');
});

test('6 critical in both rounds: exactly 2 rounds, then the approval with a forced token and the open issues', async () => {
  severities({ product: { 1: 'critical', 2: 'critical' }, ux: { 1: 'critical', 2: 'critical' }, qa: { 1: 'critical', 2: 'critical' } });
  let atAsk = null;
  const h = start({}, (q, orch) => {
    atAsk = orch._graphSnapshot.outputs['n_refine.plan'];
    orch.answer(q.id, { decision: 'approve' });
  });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.equal(shells(h.execs, 'n_roles').length, 2, 'never a 3rd round');
  assert.equal(h.asks.filter((a) => a.kind === 'gate').length, 0, 'no gate ask');
  assert.equal(h.plans.length, 1);
  assert.equal(atAsk.forced, true);
  assert.ok(atAsk.meta.issues.length > 0);
  assert.ok(auditOf(h.orch).some((t) => /Loop on wire w5 \(n_refine\) spent after its last round: sent to approval with \d+ open issue/.test(t)));
  assert.ok(!auditOf(h.orch).some((t) => /the user chose \*\*exhausted\*\*/.test(t)));
});

test('8 pause while round 2\'s slice runs: the resume keeps round 1 and re-runs only the ux slice', async () => {
  severities({ ux: { 1: 'critical' } });
  const dir = gitDir('roles-resume');
  const h = start({ projectDir: dir });
  await waitFor(() => slices(h.execs).some((e) => e.executionId.startsWith('x:n_roles:2:')));
  h.orch.pause();
  assert.equal((await h.done).status, 'paused');
  const saved = readPipelineForResume(h.orch.getState().id);
  assert.deepEqual(saved.resumePoint.roleReviews.rounds.map((r) => r.round), [1]);

  const h2 = start({ projectDir: dir, resume: saved, shape: undefined });
  const res = await h2.done;
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(slices(h2.execs).map((e) => e.title), ['UX']);
  assert.deepEqual(planRounds(h2.orch).map((r) => [r.pass, r.round]), [[1, 1], [1, 2]]);
  assert.equal(h2.plans.length, 1);
});

test('9 Ask for changes: the Planner re-runs, then a new pass reviews it at round 1 with every role and no revise', async () => {
  severities({ ux: { 1: 'critical' } });
  const h = start({}, (q, orch) => {
    if (q.id === 'plan-n_refine-1') orch.answer(q.id, { decision: 'revise', feedback: 'Cover the empty state.' });
    else orch.answer(q.id, { decision: 'approve' });
  });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(h.plans.map((q) => q.id), ['plan-n_refine-1', 'plan-n_refine-2']);
  assert.equal(shells(h.execs, 'n_plan', 'done').length, 2);
  const third = h.orch._graphSnapshot.execs.find((e) => e.nodeId === 'n_roles' && e.ordinal === 3 && e.kind !== 'task');
  assert.ok(third, 'n_roles ran for the new plan');
  assert.equal(third.bindings.revise, undefined, 'no stale revise');
  const pass2 = slices(h.execs).filter((e) => e.executionId.startsWith('x:n_roles:3:'));
  assert.deepEqual(pass2.map((e) => e.title), ['Product', 'QA', 'UX'], 'every role');
  const idx = (e) => h.execs.indexOf(e);
  const lastDone = Math.max(...slices(h.execs, 'done').filter((e) => e.executionId.startsWith('x:n_roles:3:')).map(idx));
  assert.ok(idx(shells(h.execs, 'n_refine')[2]) > lastDone, 'Refine waits for the new pass');
  assert.deepEqual(planRounds(h.orch).map((r) => [r.pass, r.round]), [[1, 1], [1, 2], [2, 1]]);
});

// Parity (engine role-review step): a no-picks Shaper run is recorded before the move and must not drift after it.
// Regenerate deliberately with UPDATE_ROLE_PARITY=1 and review the diff.
const PARITY_FILE = join(import.meta.dirname, 'fixtures', 'role-review', 'shaper-parity.json');
const ADDITIVE = ['model', 'effort', 'wanted'];

/** Every run-specific part of a string as a placeholder: the temp homes, the run id, the store key and the date. */
function parityNormalizer(orch, dir) {
  const pipeDir = orch.pipeline.dir;
  const storeDir = dirname(dirname(pipeDir));
  const pairs = [];
  for (const [p, name] of [[pipeDir, '$PIPE'], [storeDir, '$STORE'], [process.env.WORCA_HOME, '$WH'], [dir, '$PROJ']]) {
    for (const v of new Set([p, realpathSync(p)])) pairs.push([v, name]);
  }
  pairs.sort((a, b) => b[0].length - a[0].length);
  const id = orch.getState().id;
  const key = basename(storeDir);
  return (s) => {
    let t = String(s);
    for (const [v, name] of pairs) t = t.split(v).join(name);
    return t.split(id).join('$RUN').split(key).join('$KEY').replace(/\b\d\d-\d\d-\d\d-/g, '$TS-');
  };
}
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);

/** One no-picks Shaper mock run, captured: every n_roles slice prompt, the role reviews, each findings file, and each
 *  Refine's plan/findings bindings and prompt. Additive record keys come back apart in `pairs`. */
async function captureParity(table) {
  if (table) severities(table); else delete process.env.WORCA_MOCK_ROLE_REVIEW;
  const prompts = [];
  _testing.runClaude = (o) => { prompts.push(o.prompt); return runClaude(o); };
  const h = start();
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  const norm = parityNormalizer(h.orch, h.dir);
  const marker = (p, k) => (new RegExp(`^${k}: (.*)$`, 'm').exec(p) || [])[1] || '';
  // Scoped to n_roles: Shaper's Review (n_review) runs code role reviews on the diff since #990 slice 4.
  const slicePrompts = prompts.filter((p) => marker(p, 'MOCK_PERSPECTIVE') && marker(p, 'MOCK_ROLE') === 'plan-review')
    .sort((a, b) => (marker(a, 'MOCK_CYCLE') + marker(a, 'MOCK_PERSPECTIVE')).localeCompare(marker(b, 'MOCK_CYCLE') + marker(b, 'MOCK_PERSPECTIVE')))
    .map(norm);
  const refinePrompts = prompts.filter((p) => marker(p, 'MOCK_ROLE') === 'refiner').map(norm);
  const refines = h.orch._graphSnapshot.execs.filter((e) => e.nodeId === 'n_refine').sort((a, b) => a.ordinal - b.ordinal);
  const pairs = [];
  const rounds = h.orch.state.roleReviews.rounds.filter((r) => (r.node ?? 'n_roles') === 'n_roles').map(({ node, target, ...r }) => ({
    ...r,
    roles: r.roles.map((rec) => {
      const kept = { ...rec };
      for (const k of ADDITIVE) delete kept[k];
      pairs.push({ key: rec.key, pair: Object.fromEntries(ADDITIVE.filter((k) => k in rec).map((k) => [k, rec[k]])) });
      return kept;
    }),
  }));
  const capture = {
    slicePrompts,
    roleReviews: JSON.parse(norm(JSON.stringify(sortKeys({ rounds })))),
    findings: await Promise.all(refines.map(async (e) => norm(await readFile(e.bindings.findings.path, 'utf8')))),
    refine: refines.map((e) => ({ plan: norm(e.bindings.plan.path), findings: norm(e.bindings.findings.path) })),
    refinePrompts,
  };
  return { capture, pairs };
}

test('parity: a no-picks Shaper mock run matches the recorded fixture', async () => {
  const scenarios = { oneRound: null, twoRounds: { ux: { 1: 'critical' } } };
  const actual = {};
  const pairs = [];
  for (const [name, table] of Object.entries(scenarios)) {
    const a = await captureParity(table);
    if (process.env.UPDATE_ROLE_PARITY === '1') {
      // Two captures in a row must be byte-identical before the fixture is ever written.
      const b = await captureParity(table);
      assert.equal(JSON.stringify(b.capture), JSON.stringify(a.capture), `${name}: the capture is not deterministic`);
    }
    actual[name] = a.capture;
    pairs.push(...a.pairs);
  }
  const text = `${JSON.stringify(actual, null, 2)}\n`;
  if (process.env.UPDATE_ROLE_PARITY === '1') {
    mkdirSync(dirname(PARITY_FILE), { recursive: true });
    writeFileSync(PARITY_FILE, text, 'utf8');
    return;
  }
  assert.deepEqual(actual, JSON.parse(readFileSync(PARITY_FILE, 'utf8')),
    'drifted from test/fixtures/role-review/shaper-parity.json. If the change is deliberate, review the diff and regenerate with UPDATE_ROLE_PARITY=1.');
  // The additive keys: every record names the pair its slice ran on (n_roles's own pair, Product's diversity pick), none dropped.
  const reviewed = pairs.filter((p) => Object.keys(p.pair).length);
  assert.ok(reviewed.length >= 4, 'every reviewed record carries its pair');
  for (const p of reviewed) {
    assert.deepEqual(p.pair, p.key === 'product' ? { model: 'claude-opus-5-5', effort: 'medium' } : { model: 'claude-sonnet-5-5', effort: 'medium' }, p.key);
  }
});

test('Shaper review: three code role records against the diff; the implementer\'s fix carries their merged findings', async () => {
  severities({ security: { 1: 'major' } });
  const prompts = [];
  _testing.runClaude = (o) => { prompts.push(o.prompt); return runClaude(o); };
  const h = start();
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  const code = h.orch.state.roleReviews.rounds.filter((r) => r.node === 'n_review');
  assert.deepEqual(code.map((r) => [r.pass, r.round, r.target]), [[1, 1, 'diff'], [1, 2, 'diff']]);
  assert.deepEqual(code[0].roles.map((r) => r.key), ['correctness', 'security', 'fit']);
  assert.deepEqual(code[1].roles.map((r) => [r.key, r.skipped]), [['correctness', true], ['security', false], ['fit', true]], 'fix cycles review the open role only');
  const plan = h.orch.state.roleReviews.rounds.filter((r) => r.node === 'n_roles');
  assert.ok(plan.length >= 1 && plan.every((r) => r.target === 'plan'), 'the plan rounds keep their own node');
  const fix = h.orch._graphSnapshot.execs.filter((e) => e.nodeId === 'n_impl' && e.bindings.fix).map((e) => e.bindings.fix.path);
  assert.equal(fix.length, 1);
  assert.equal(code[0].dispositions, fix[0].replace(/\.md$/, '-dispositions.json'), 'the fix is round 1\'s findings file');
  const md = await readFile(fix[0], 'utf8');
  // Spec D7: the plan's unmet R-item is judged once, on the merged verdict, and reaches the implementer here.
  assert.deepEqual([...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]),
    ['Correctness', 'Security', 'Project fit', 'Dispositions', 'Perspective checklist (added by Worca)']);
  assert.match(md, /^- \*\*\[major\]\*\* R-\w+-1 not met: /m);
  assert.match(md, /^Diff reviewed against the plan: /m);
  const codePrompts = prompts.filter((p) => /^MOCK_ROLE: code-review$/m.test(p));
  assert.equal(codePrompts.length, 4, '3 roles in round 1, security alone in round 2');
  for (const p of codePrompts) assert.doesNotMatch(p, /house brief|`R-fit/, 'no plan checklist or house brief for a code role');
  assert.equal(h.orch.state.progressFacts.reviews.n_review.blocking, 0);
});

test('an old roleReview:true run resumes and reads its records', async () => {
  severities({ ux: { 1: 'critical' } });
  const dir = gitDir('roles-legacy');
  const h = start({ projectDir: dir });
  await waitFor(() => slices(h.execs).some((e) => e.executionId.startsWith('x:n_roles:2:')));
  h.orch.pause();
  assert.equal((await h.done).status, 'paused');
  const saved = readPipelineForResume(h.orch.getState().id);
  // As a run saved before the engine step: the legacy `true` on the cell, no per-role picks, records without a pair.
  const cell = saved.resumePoint.manifest.graph.nodes.find((n) => n.id === 'n_roles');
  cell.config = { ...cell.config, roleReview: true };
  delete cell.roles;
  // ...and before slice 4: a plain Review, rounds that name no node or target.
  saved.resumePoint.manifest.graph.nodes.find((n) => n.id === 'n_review').config = {};
  // ...and before slice 3: no counts, no dispositions path, statuses that came from the refiner's `addressed` list.
  const r1 = saved.resumePoint.roleReviews.rounds[0];
  for (const r of r1.roles) { delete r.model; delete r.effort; delete r.wanted; delete r.counts; }
  delete r1.counts; delete r1.dispositions; delete r1.node; delete r1.target;
  const old = JSON.parse(JSON.stringify(r1.roles));

  const h2 = start({ projectDir: dir, resume: saved, shape: undefined });
  const res = await h2.done;
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(slices(h2.execs).map((e) => e.title), ['UX'], 'it continues at round 2');
  const rr = h2.orch.state.roleReviews;
  assert.deepEqual(rr.rounds.map((r) => [r.pass, r.round]), [[1, 1], [1, 2]]);
  assert.deepEqual(rr.rounds[0].roles, old, 'the old records read unchanged');
  assert.deepEqual([rr.rounds[1].roles.find((r) => r.key === 'ux').model, rr.rounds[1].roles.find((r) => r.key === 'ux').effort],
    ['claude-sonnet-5-5', 'medium'], 'the new round records the node\'s pair');
  assert.equal('counts' in rr.rounds[0], false, 'nothing rewrites the old round');
  assert.deepEqual(roundCounts(rr.rounds[0]), { raised: 3, fixed: 3, disputed: 0, open: 0 }, 'an old resume point reads with derived counts');
  assert.deepEqual(rr.rounds[1].counts, roundCounts(rr.rounds[1]), 'the new round stores its counts');
});

test('a refiner verdict carrying only `addressed`, with no dispositions file, marks those ids fixed', async () => {
  // A refiner that follows its unchanged directive and ignores the findings' ## Dispositions section.
  _testing.runClaude = async (o) => {
    const out = await runClaude(o);
    const findings = /^MOCK_FINDINGS: (.+)$/m.exec(o.prompt)?.[1];
    if (/^MOCK_ROLE: refiner$/m.test(o.prompt) && findings) {
      await rm(/^Dispositions file: (.+)$/m.exec(await readFile(findings, 'utf8'))[1], { force: true });
    }
    return out;
  };
  const h = start();
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  const round = h.orch.state.roleReviews.rounds[0];
  assert.deepEqual(round.roles.flatMap((r) => r.findings.map((f) => f.status)), ['fixed', 'fixed', 'fixed']);
  assert.deepEqual(round.counts, { raised: 3, fixed: 3, disputed: 0, open: 0 });
  assert.ok(auditOf(h.orch).some((t) => /^Role findings, round 1: the dispositions file .* was not written/.test(t)));
});

test('10 an old manifest (refiner self-loop) resumes with its own topology', async () => {
  const dir = gitDir('roles-old');
  let paused = false;
  const h = start({ projectDir: dir }, undefined, (q, orch) => { if (!paused) { paused = true; orch.pause(); } });
  assert.equal((await h.done).status, 'paused');
  const saved = readPipelineForResume(h.orch.getState().id);
  // The pre-change wf_shape: Default's wires, no n_roles, Refine without awaitAll.
  const old = {
    ...GRAPH_SHAPE_WORKFLOW,
    nodes: GRAPH_SHAPE_WORKFLOW.nodes.filter((n) => n.id !== 'n_roles')
      .map((n) => (n.id === 'n_refine' ? { ...n, config: { approve: { kind: 'plan', port: 'plan' } } } : n)),
    wires: GRAPH_DEFAULT_WORKFLOW.wires,
  };
  const manifest = buildGraphManifest(old, loadAgentRegistry(undefined, { userAgentsDir: null }));
  saved.resumePoint.manifest = { ...saved.resumePoint.manifest, graph: manifest.graph };

  const h2 = start({ projectDir: dir, resume: saved, shape: undefined });
  const res = await h2.done;
  assert.equal(res.status, 'done', res.error);
  assert.equal(h2.execs.filter((e) => e.nodeId === 'n_roles').length, 0);
  assert.equal(shells(h2.execs, 'n_refine').length, 2, 'the old self-loop: the mock refiner blocks once');
});

test('diversity default: a no-picks run on the default perspectives runs exactly one plan role (Product) on another model; no Devil\'s advocate', async () => {
  const h = start({ shape: { perspectives: [...DEFAULT_PERSPECTIVES] } });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  const roles = h.orch.state.roleReviews.rounds[0].roles;
  assert.deepEqual(Object.fromEntries(roles.map((r) => [r.key, [r.model, r.effort]])), {
    product: ['claude-opus-5-5', 'medium'], architect: ['claude-sonnet-5-5', 'medium'], qa: ['claude-sonnet-5-5', 'medium'],
  });
  assert.equal(roles.filter((r) => r.model !== h.orch.resolved.nodeCtx.n_roles.model).length, 1, 'exactly one role differs');
  assert.equal(h.orch.state.roleReviews.rounds.flatMap((r) => r.roles).some((r) => r.key === 'devil'), false, 'no devil record');
  assert.deepEqual(h.orch.getState().warnings.filter((w) => w.includes(' is not on ')), [], 'a Claude run drops nothing');
});

test('no silent fallbacks: a Codex run names a dropped Security pick once; the built-in template drops stay quiet', async () => {
  const h = start({
    claude: { mock: true, engine: 'codex' }, guardrailsId: 'permissive', shape: { perspectives: ['product', 'security'] },
    overlay: { nodes: { n_roles: { roles: { security: { model: 'claude-opus-5-5' } } } } },
  });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  const line = "Plan Review · Security: claude-opus-5-5 is not on Codex, runs the node's model";
  const warnings = h.orch.getState().warnings;
  assert.equal(warnings.filter((w) => w === line).length, 1, warnings.join('\n'));
  assert.deepEqual(warnings.filter((w) => w.startsWith('Plan Review')), [line], 'the node\'s sonnet and Product\'s opus are built-in defaults: recorded, not warned');
  const roles = h.orch.resolved.nodeCtx.n_roles.roles;
  assert.deepEqual(roles.security, { source: 'run', wanted: { model: 'claude-opus-5-5' } }, 'the role record keeps the pick');
  assert.deepEqual(roles.product.wanted, { model: 'claude-opus-5-5', effort: 'medium' }, 'the diversity pick is recorded as wanted');
  assert.deepEqual(h.orch.resolved.nodeCtx.n_roles.wanted, { model: 'claude-sonnet-5-5', effort: 'medium', source: 'template' });
  assert.equal(auditOf(h.orch).filter((t) => t === `${line}.`).length, 1, 'one audit line');
});

test('a requirements role-review node fires its requirements output with the reviewed file\'s path; the plan node still fires plan', async () => {
  const h = start({ workflowId: 'wf_shape_req', shape: { ...SHAPE, size: 'large' } });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  const out = h.orch._graphSnapshot.outputs;
  assert.ok(out['n_req.requirements']?.path, 'the drafter published');
  assert.equal(out['n_reqroles.requirements'].path, out['n_req.requirements'].path, 'the reviewed draft passes on');
  assert.ok(out['n_reqroles.findings'].path.endsWith('-requirements-findings-r1.md'));
  assert.ok(out['n_roles.plan'].path, 'the plan role review still fires plan');
  assert.ok(out['n_roles.findings'].path.endsWith('-role-findings-r1.md'));
});
