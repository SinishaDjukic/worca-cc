// test/run-progress.test.mjs
// Run progress: the pure core (src/shared/run-progress.mjs). State in, one bar out. No DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runProgress, chainProgress, ordinal, progressWidth, progressTone, askWhat,
  PROGRESS_STAGES, STAGE_LABEL, REVIEW_STEP, REVIEW_CAP, START_SHARE, groupProgress,
} from '../src/shared/run-progress.mjs';
import { buildGraphManifest } from '../src/shared/graph/manifest.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import {
  GRAPH_DEFAULT_WORKFLOW, GRAPH_PR_FIX_WORKFLOW, GRAPH_MEMORY_DEFRAG_WORKFLOW, GRAPH_WORKSPACE_SCAN_WORKFLOW,
  GRAPH_SHAPE_WORKFLOW, GRAPH_SHAPE_UX_WORKFLOW,
} from '../src/core/graph/builtin-workflows.mjs';
import { GRAPH_ARCHITECTURE_WORKFLOW } from '../src/core/graph/architecture-workflow.mjs';
import { GRAPH_PRESENTATION_WORKFLOW } from '../src/core/graph/presentation-workflow.mjs';
import { GRAPH_PROMO_VIDEO_WORKFLOW } from '../src/core/graph/promo-video-workflow.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { checkRows } from './helpers/rows.mjs';

// ── fixture builders (shaped as the engine writes them) ─────────────────────
const agent = (id, key, over = {}) => ({
  id, kind: 'agent', key, label: key[0].toUpperCase() + key.slice(1), color: 'violet',
  ports: { inputs: [{ id: 'task', type: 'md', loop: false }], outputs: [{ id: 'out', type: 'md', when: 'always' }], await: true },
  ...over,
});
const end = (id = 'n_end') => ({ id, kind: 'end', key: null, label: 'End', color: '',
  ports: { inputs: [{ id: 'result', type: 'any' }], outputs: [], await: false } });
const reviewer = (over = {}) => agent('n_rev', 'reviewer', {
  progressStage: 'review', label: 'Review',
  ports: { inputs: [{ id: 'plan', type: 'md' }], await: true,
    outputs: [{ id: 'review', type: 'md', when: 'blocking' }, { id: 'pass', type: 'md', when: 'clean' }] },
  ...over,
});
const DEFAULT_NODES = () => [
  agent('n_clarify', 'clarify', { progressStage: 'plan', label: 'Clarify' }),
  agent('n_plan', 'planner', { progressStage: 'plan', label: 'Planner' }),
  agent('n_refine', 'refiner', { progressStage: 'plan', label: 'Refine' }),
  agent('n_impl', 'implementer', { progressStage: 'build', label: 'Implementation' }),
  reviewer(),
  end(),
];
const manifest = (nodes, wires = []) => ({ version: 2, template: { id: 'wf_t', name: 'T' }, graph: { nodes, wires } });
const step = (over) => ({ key: over.executionId, cycle: over.ordinal ?? 1, ordinal: over.ordinal ?? 1,
  kind: 'cycle', status: 'done', startedAt: '2026-10-14T10:00:00.000Z', ...over });
const row = (nodeId, ordinal = 1, over = {}) => step({ executionId: `x:${nodeId}:${ordinal}`, nodeId, ordinal, ...over });
const live = (nodeId, ordinal = 1) => ({ nodeId, executionId: `x:${nodeId}:${ordinal}` });
const S = (over = {}) => ({ stepper: manifest(DEFAULT_NODES()), status: 'running', steps: [], active: [],
  endReached: false, pendingQuestion: null, tokens: {}, progressFacts: { tasks: {}, reviews: {} }, ...over });
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ''} ${a} !~ ${b}`);

// Decomposer (build) → implementer (build, `task` input expands:true wired from the decomposer).
const taskNodes = () => [
  agent('n_decomp', 'decomposer', { progressStage: 'build', label: 'Decompose' }),
  agent('n_impl', 'implementer', { progressStage: 'build', label: 'Implementation',
    ports: { inputs: [{ id: 'task', type: 'md', expands: true }], outputs: [{ id: 'done', type: 'void', when: 'always' }], await: true } }),
  reviewer(), end(),
];
const taskWire = { id: 'w1', from: { node: 'n_decomp', port: 'out' }, to: { node: 'n_impl', port: 'task' } };
const TS = (over = {}) => S({ stepper: manifest(taskNodes(), [taskWire]), ...over });
const slice = (n, phase, total, status, extra = {}) => step({ executionId: `x:n_impl:1:p${phase}t${n}`, nodeId: 'n_impl',
  kind: 'task', taskId: `p${phase}t${n}`, phaseOrdinal: phase, taskIndex: n, taskTotal: total, status, ...extra });

test('stages map: the wf_default shape moves Plan → Build → Review → Ready', async () => {
  await checkRows([
    { name: 'clarify + planner done, refiner active → Plan, (2/3)/4', run: () => {
      const p = runProgress(S({ steps: [row('n_clarify'), row('n_plan'), row('n_refine', 1, { status: 'start' })], active: [live('n_refine')] }));
      assert.equal(p.mode, 'stages');
      assert.equal(p.stage, 'plan');
      near(p.fraction, (2 / 3) / 4);
      assert.equal(p.text, 'Plan · Refine');
      assert.equal(p.tone, 'blue');
    } },
    { name: 'implementer active → Build · Implementation, plan quarter whole', run: () => {
      const p = runProgress(S({ steps: [row('n_clarify'), row('n_plan'), row('n_refine'), row('n_impl', 1, { status: 'start' })], active: [live('n_impl')] }));
      assert.equal(p.stage, 'build');
      assert.equal(p.text, 'Build · Implementation');
      near(p.fraction, 0.25 + START_SHARE / 4);
    } },
    { name: 'reviewer active at cycle 1 → Review · 1st pass', run: () => {
      const p = runProgress(S({ steps: [row('n_plan'), row('n_impl'), row('n_rev', 1, { status: 'start' })], active: [live('n_rev')] }));
      assert.equal(p.stage, 'review');
      assert.equal(p.text, 'Review · 1st pass');
      near(p.fraction, 0.5 + REVIEW_STEP / 4);
    } },
    { name: 'done + endReached → ready, fraction 1, green', run: () => {
      const p = runProgress(S({ status: 'done', endReached: true, steps: [row('n_plan'), row('n_impl'), row('n_rev')] }));
      assert.equal(p.stage, 'ready');
      assert.equal(p.fraction, 1);
      assert.equal(p.text, 'Ready');
      assert.equal(p.tone, 'green');
      assert.deepEqual(p.stages.map((s) => s.state), ['done', 'done', 'done', 'done']);
    } },
    { name: 'done without End keeps its fill, reads "finished"', run: () => {
      const p = runProgress(S({ status: 'done', endReached: false, steps: [row('n_plan'), row('n_impl'), row('n_rev')] }));
      assert.notEqual(p.stage, 'ready');
      assert.ok(p.fraction < 1);
      assert.match(p.text, /· finished$/);
      assert.equal(p.tone, 'green');
    } },
    { name: 'Auto deciding: empty graph tagged deciding → Plan, fraction 0', run: () => {
      const stepper = buildGraphManifest({ id: 'auto', version: 2, nodes: [], wires: [] }, {});
      stepper.auto = { status: 'deciding' };
      const p = runProgress(S({ stepper }));
      assert.equal(p.mode, 'stages');
      assert.equal(p.stage, 'plan');
      assert.equal(p.fraction, 0);
      assert.equal(p.text, 'Plan · choosing the workflow');
      const q = runProgress(S({ stepper, pendingQuestion: { kind: 'workflow' } }));
      assert.equal(q.text, 'Plan · needs you · review the workflow');
      assert.equal(q.tone, 'amber');
    } },
    { name: 'the same empty graph WITHOUT the auto tag stays P6', run: () => {
      const stepper = buildGraphManifest({ id: 'auto', version: 2, nodes: [], wires: [] }, {});
      assert.equal(runProgress(S({ stepper })).mode, 'nodes');
    } },
  ]);
});

test('shipped workflows built from the real sidecars: staged ones get stages, the rest P6', async () => {
  const registry = loadAgentRegistry(undefined, { userAgentsDir: null });
  const modeOf = (tpl) => runProgress({ stepper: buildGraphManifest(tpl, registry), status: 'running', steps: [], active: [] }).mode;
  await checkRows([
    { name: 'wf_default', run: () => assert.equal(modeOf(GRAPH_DEFAULT_WORKFLOW), 'stages') },
    ...SEED_TEMPLATES.map((tpl) => ({ name: `seed ${tpl.id}`, run: () => assert.equal(modeOf(tpl), 'stages') })),
    { name: 'wf_shape', run: () => assert.equal(modeOf(GRAPH_SHAPE_WORKFLOW), 'stages') },
    { name: 'wf_shape_ux', run: () => assert.equal(modeOf(GRAPH_SHAPE_UX_WORKFLOW), 'stages') },
    { name: 'wf_pr_fix', run: () => assert.equal(modeOf(GRAPH_PR_FIX_WORKFLOW), 'stages') },
    { name: 'wf_architecture_c4', run: () => assert.equal(modeOf(GRAPH_ARCHITECTURE_WORKFLOW), 'stages') },
    { name: 'wf_memory_defrag', run: () => assert.equal(modeOf(GRAPH_MEMORY_DEFRAG_WORKFLOW), 'nodes') },
    { name: 'wf_workspace_scan', run: () => assert.equal(modeOf(GRAPH_WORKSPACE_SCAN_WORKFLOW), 'nodes') },
    { name: 'wf_presentation', run: () => assert.equal(modeOf(GRAPH_PRESENTATION_WORKFLOW), 'nodes') },
  ]);
});

// Known bugs 1 and 2 over every shipped workflow's real step list.
const SHIPPED = () => [GRAPH_DEFAULT_WORKFLOW, GRAPH_PR_FIX_WORKFLOW, GRAPH_ARCHITECTURE_WORKFLOW, GRAPH_SHAPE_WORKFLOW,
  GRAPH_SHAPE_UX_WORKFLOW, ...SEED_TEMPLATES, GRAPH_MEMORY_DEFRAG_WORKFLOW, GRAPH_WORKSPACE_SCAN_WORKFLOW,
  GRAPH_PRESENTATION_WORKFLOW, GRAPH_PROMO_VIDEO_WORKFLOW];

test('every shipped workflow: each staged step reports its own stage, and no step repeats its stage (Known bugs 1, 2)', async () => {
  const registry = loadAgentRegistry(undefined, { userAgentsDir: null });
  const rows = [];
  for (const tpl of SHIPPED()) {
    const stepper = buildGraphManifest(tpl, registry);
    // Walk the steps in stage order: RR appends n_roles (a plan-stage reviewer) after n_review / n_end in the node list.
    const rank = (n) => { const i = ['plan', 'build', 'review'].indexOf(n.progressStage); return i < 0 ? 9 : i; };
    const order = stepper.graph.nodes.filter((n) => n.kind === 'agent' || n.kind === 'script').sort((x, y) => rank(x) - rank(y));
    order.forEach((n, i) => rows.push({ name: `${tpl.id} ${n.key}`, run: () => {
      const done = order.slice(0, i).map((d) => row(d.id));
      const p = runProgress({ stepper, status: 'running', steps: [...done, row(n.id, 1, { status: 'start' })],
        active: [live(n.id)], tokens: {}, progressFacts: { tasks: {}, reviews: {} } });
      if (n.progressStage) assert.equal(p.stage, n.progressStage, `${n.label} is a ${n.progressStage} step`);
      const [head, ...tail] = p.text.split(' · ');
      assert.notEqual(tail.join(' · ').toLowerCase(), head.toLowerCase(), `"${p.text}" repeats its stage`);
    } }));
  }
  await checkRows(rows);
});

test('the real planner (displayName "Plan") reads "Plan", its step is empty', () => {
  const registry = loadAgentRegistry(undefined, { userAgentsDir: null });
  const stepper = buildGraphManifest(GRAPH_DEFAULT_WORKFLOW, registry);
  const p = runProgress({ stepper, status: 'running', steps: [row('n_clarify'), row('n_plan', 1, { status: 'start' })],
    active: [live('n_plan')], tokens: {}, progressFacts: { tasks: {}, reviews: {} } });
  assert.equal(p.text, 'Plan');
  assert.equal(p.step, '');
  assert.equal(p.what, '');
});

test('start share: a begun stage with nothing finished fills START_SHARE of its quarter', () => {
  const p = runProgress(S({ steps: [row('n_clarify', 1, { status: 'start' })], active: [live('n_clarify')] }));
  near(p.fraction, START_SHARE / 4);
  assert.deepEqual(p.fill.map((f) => Number(f.toFixed(4))), [START_SHARE, 0, 0, 0]);
});

test('groupProgress: (finished + current fill) ÷ members, Planning counted', () => {
  const cur = { state: 'current', progress: { fraction: 0.5 } };
  near(groupProgress([{ state: 'done' }, cur, { state: 'waiting' }]).fraction, 1.5 / 3);
  near(groupProgress([{ state: 'done' }, cur, { state: 'waiting' }], { planning: { state: 'done' } }).fraction, 2.5 / 4);
  const memo = {};
  groupProgress([cur], { memo });
  near(groupProgress([{ state: 'current', progress: { fraction: 0.2 } }], { memo }).fraction, 0.5, 'never backwards');
});

test('absent stages count as passed once every stage before them is whole', async () => {
  await checkRows([
    { name: 'wf_pr_fix before any row: Build, fraction .25', run: () => {
      const nodes = [agent('n_impl', 'implementer', { progressStage: 'build', label: 'Implementation' }), reviewer(), end()];
      const p = runProgress(S({ stepper: manifest(nodes) }));
      assert.equal(p.stage, 'build');
      near(p.fraction, 0.25);
      assert.equal(p.stages[0].state, 'skipped');
    } },
    { name: 'wf_architecture_c4 with both plan agents done: Plan, .75', run: () => {
      const nodes = [agent('n_setup', 'architectSetup', { progressStage: 'plan' }), agent('n_arch', 'architect', { progressStage: 'plan' }), end()];
      const p = runProgress(S({ stepper: manifest(nodes), steps: [row('n_setup'), row('n_arch')] }));
      assert.equal(p.stage, 'plan');
      near(p.fraction, 0.75);
    } },
  ]);
});

test('P6 nodes: workflows with no staged agent count finished steps', async () => {
  const three = () => manifest([agent('n_a', 'deckA'), agent('n_b', 'deckB', { label: 'Deck B' }), agent('n_c', 'deckC'), end()]);
  await checkRows([
    { name: 'one done, one active → 1/3, text is the active label, no marks', run: () => {
      const p = runProgress(S({ stepper: three(), steps: [row('n_a'), row('n_b', 1, { status: 'start' })], active: [live('n_b')] }));
      assert.equal(p.mode, 'nodes');
      near(p.fraction, 1 / 3);
      assert.equal(p.text, 'Deck B');
      assert.deepEqual(p.stages, []);
      assert.equal(p.stage, null);
    } },
    { name: 'a node re-firing (done then active) keeps its fraction', run: () => {
      const p = runProgress(S({ stepper: three(), steps: [row('n_a'), row('n_a', 2, { status: 'start' })], active: [live('n_a', 2)] }));
      near(p.fraction, 1 / 3);
    } },
    { name: 'two active → "2 steps"; no rows → Starting; done → Finished', run: () => {
      assert.equal(runProgress(S({ stepper: three(), steps: [row('n_a', 1, { status: 'start' }), row('n_b', 1, { status: 'start' })], active: [live('n_a'), live('n_b')] })).text, '2 steps');
      assert.equal(runProgress(S({ stepper: three() })).text, 'Starting');
      const d = runProgress(S({ stepper: three(), status: 'done', endReached: true, steps: [row('n_a')] }));
      assert.equal(d.text, 'Finished');
      assert.equal(d.fraction, 1);
    } },
  ]);
});

test('build by tasks: a decomposition feeding a build agent moves the fill on tasks', async () => {
  await checkRows([
    { name: 'facts say 4, one slice done → "task 2 of 4", fraction .25 + .25·(1/4)', run: () => {
      const p = runProgress(TS({
        steps: [row('n_decomp'), slice(1, 1, 4, 'done'), slice(2, 1, 4, 'start')],
        active: [live('n_impl')], progressFacts: { tasks: { n_impl: 4 }, reviews: {} },
      }));
      assert.equal(p.text, 'Build · task 2 of 4');
      near(p.fraction, 0.25 + 0.25 * (1 / 4));
      assert.deepEqual(p.tasks, { done: 1, total: 4 });
    } },
    { name: 'without facts: two phase-1 slices (taskTotal 2), one done → "task 2 of 2"', run: () => {
      const p = runProgress(TS({
        steps: [row('n_decomp'), slice(1, 1, 2, 'done'), slice(2, 1, 2, 'start')], active: [live('n_impl')],
        progressFacts: undefined,
      }));
      assert.equal(p.text, 'Build · task 2 of 2');
    } },
    { name: 'a later phase appearing at taskTotal 3 grows the total to 5', run: () => {
      const p = runProgress(TS({
        steps: [row('n_decomp'), slice(1, 1, 2, 'done'), slice(2, 1, 2, 'done'), slice(1, 2, 3, 'start')], active: [live('n_impl')],
        progressFacts: undefined,
      }));
      assert.deepEqual(p.tasks, { done: 2, total: 5 });
      assert.equal(p.text, 'Build · task 3 of 5');
    } },
    { name: 'a re-run slice counts once', run: () => {
      const p = runProgress(TS({
        steps: [row('n_decomp'), slice(1, 1, 2, 'done'), slice(1, 1, 2, 'done', { executionId: 'x:n_impl:1:p1t1:r2' }), slice(2, 1, 2, 'start')],
        active: [live('n_impl')], progressFacts: undefined,
      }));
      assert.equal(p.tasks.done, 1);
    } },
    { name: 'decomposer active with no tasks yet → "Build · Decompose" at .25 + START_SHARE / 4', run: () => {
      const p = runProgress(TS({ steps: [row('n_decomp', 1, { status: 'start' })], active: [live('n_decomp')] }));
      assert.equal(p.text, 'Build · Decompose');
      near(p.fraction, 0.25 + START_SHARE / 4);
    } },
  ]);
});

test('monotonic (P3): fill never decreases and the stage never leaves Review during a fix loop', async () => {
  const blocked = { tasks: {}, reviews: { n_rev: { pass: 1, blocking: 2 } } };
  const frameA = () => S({ steps: [row('n_plan'), row('n_impl'), row('n_rev')], progressFacts: blocked });
  const frameB = () => S({ steps: [row('n_plan'), row('n_impl'), row('n_rev'), row('n_impl', 2, { status: 'start' })],
    active: [live('n_impl', 2)], progressFacts: blocked });
  const frameC = () => S({ steps: [row('n_plan'), row('n_impl'), row('n_rev'), row('n_impl', 2), row('n_rev', 2, { status: 'start' })],
    active: [live('n_rev', 2)], progressFacts: blocked });
  await checkRows([
    { name: 'A → B → C with a memo', run: () => {
      const memo = {};
      const a = runProgress(frameA(), memo);
      const b = runProgress(frameB(), memo);
      const c = runProgress(frameC(), memo);
      assert.equal(a.stage, 'review');
      assert.equal(b.stage, 'review');
      assert.equal(b.text, 'Review · 2nd pass, fixing 2 issues');
      assert.equal(c.text, 'Review · 2nd pass');
      assert.ok(b.fraction >= a.fraction && c.fraction >= b.fraction);
    } },
    { name: 'frame B alone (no memo) is still Review: the ledger has review rows', run: () => {
      assert.equal(runProgress(frameB()).stage, 'review');
    } },
    { name: 'a memo already at .7 keeps .7 on a lower frame', run: () => {
      const memo = { fraction: 0.7, stage: 2 };
      const p = runProgress(S({ steps: [row('n_clarify', 1, { status: 'start' })], active: [live('n_clarify')] }), memo);
      assert.equal(p.fraction, 0.7);
      assert.equal(p.stage, 'review');
      assert.equal(memo.fraction, 0.7);
    } },
  ]);
});

test('fixing N issues counts only the newest pass across review agents (no stale facts)', async () => {
  const nodes = () => [...DEFAULT_NODES().slice(0, 4),
    reviewer({ id: 'n_wui', key: 'manualWebUiTesting', label: 'Web UI' }), reviewer(), end()];
  const wui = (n, o) => row('n_wui', n, o);
  await checkRows([
    { name: 'web UI pass 1 blocked 3, reviewer pass 2 blocked 2, implementer running → 2 issues', run: () => {
      const p = runProgress(S({ stepper: manifest(nodes()),
        steps: [row('n_plan'), row('n_impl'), wui(1), row('n_impl', 2), row('n_rev', 1), row('n_impl', 3, { status: 'start' })],
        active: [live('n_impl', 3)],
        progressFacts: { tasks: {}, reviews: { n_wui: { pass: 1, blocking: 3 }, n_rev: { pass: 2, blocking: 2 } } } }));
      assert.match(p.text, /fixing 2 issues$/);
    } },
    { name: 'two review agents blocking on the SAME pass add up', run: () => {
      const p = runProgress(S({ stepper: manifest(nodes()),
        steps: [row('n_plan'), row('n_impl'), wui(1), row('n_rev', 1), row('n_impl', 2, { status: 'start' })],
        active: [live('n_impl', 2)],
        progressFacts: { tasks: {}, reviews: { n_wui: { pass: 1, blocking: 3 }, n_rev: { pass: 1, blocking: 2 } } } }));
      assert.match(p.text, /fixing 5 issues$/);
    } },
  ]);
});

test('the review pass does not flicker back to 1st while the next pass is active but has no row yet', () => {
  const p = runProgress(S({ steps: [row('n_plan'), row('n_impl'), row('n_rev'), row('n_impl', 2)], active: [live('n_rev', 2)],
    progressFacts: { tasks: {}, reviews: { n_rev: { pass: 1, blocking: 1 } } } }));
  assert.equal(p.text, 'Review · 2nd pass');
  assert.equal(p.passes, 2);
});

test('review cap: passes fill the quarter up to 0.8 until a clean pass', async () => {
  const passRows = (n) => Array.from({ length: n }, (_, i) => row('n_rev', i + 1, { startedAt: `2026-10-14T10:0${i}:00.000Z` }));
  const base = [row('n_plan'), row('n_impl')];
  await checkRows([
    { name: 'five blocking passes leave the share at 0.8 (fraction .7), never .75', run: () => {
      const p = runProgress(S({ steps: [...base, ...passRows(5)], progressFacts: { tasks: {}, reviews: { n_rev: { pass: 5, blocking: 1 } } } }));
      near(p.fraction, 0.5 + 0.25 * REVIEW_CAP);
      assert.ok(p.fraction < 0.75);
    } },
    { name: 'a clean final pass with nothing active → .75', run: () => {
      const p = runProgress(S({ steps: [...base, ...passRows(2)], progressFacts: { tasks: {}, reviews: { n_rev: { pass: 2, blocking: 0 } } } }));
      near(p.fraction, 0.75);
    } },
    { name: 'fallback: a blocking token fired after the last row started counts as blocking', run: () => {
      const rows = [...base, ...passRows(1)];
      const t = Date.parse(rows[rows.length - 1].startedAt) + 5000;
      const p = runProgress(S({ steps: rows, progressFacts: undefined, tokens: { 'n_rev.review': { seq: 1, firedAt: t } } }));
      assert.ok(p.fraction < 0.75);
    } },
    { name: 'fallback: a latched blocking token from pass 1 does not block a clean pass 2', run: () => {
      const rows = [...base, ...passRows(2)];
      const t1 = Date.parse(rows[2].startedAt) + 5000;   // after pass 1 started, before pass 2
      const t2 = Date.parse(rows[3].startedAt) + 5000;
      const p = runProgress(S({ steps: rows, progressFacts: undefined,
        tokens: { 'n_rev.review': { seq: 1, firedAt: t1 }, 'n_rev.pass': { seq: 1, firedAt: t2 } } }));
      near(p.fraction, 0.75);
    } },
    { name: 'fallback: an ISO-string firedAt is read; a row with no startedAt counts as not blocking', run: () => {
      const rows = [...base, ...passRows(1)];
      const iso = new Date(Date.parse(rows[rows.length - 1].startedAt) + 5000).toISOString();
      const blocked = runProgress(S({ steps: rows, progressFacts: undefined, tokens: { 'n_rev.review': { seq: 1, firedAt: iso } } }));
      assert.ok(blocked.fraction < 0.75);
      const noStart = [...base, row('n_rev', 1, { startedAt: undefined })];
      const clean = runProgress(S({ steps: noStart, progressFacts: undefined, tokens: { 'n_rev.review': { seq: 1, firedAt: Date.now() } } }));
      near(clean.fraction, 0.75);
    } },
  ]);
});

test('tone and text while waiting, parked or ended', async () => {
  const planning = { steps: [row('n_clarify', 1, { status: 'start' })], active: [live('n_clarify')] };
  await checkRows([
    { name: 'three questions while planning → amber, "Plan · needs you · answer 3 questions"', run: () => {
      const p = runProgress(S({ ...planning, pendingQuestion: { questions: [{}, {}, {}] } }));
      assert.equal(p.tone, 'amber');
      assert.equal(p.text, 'Plan · needs you · answer 3 questions');
    } },
    { name: 'gate / form / recovery / one question', run: () => {
      assert.equal(runProgress(S({ ...planning, pendingQuestion: { kind: 'gate' } })).text, 'Plan · needs you · a decision');
      assert.equal(runProgress(S({ ...planning, pendingQuestion: { kind: 'form' } })).text, 'Plan · needs you · input needed');
      assert.equal(runProgress(S({ ...planning, pendingQuestion: { kind: 'recovery' } })).text, 'Plan · needs you · a step failed');
      assert.equal(runProgress(S({ ...planning, pendingQuestion: { questions: [{}] } })).text, 'Plan · needs you · answer 1 question');
      assert.equal(runProgress(S({ ...planning, pendingQuestion: {} })).text, 'Plan · needs you · answer a question');
    } },
    { name: 'a plan approval, a slice outline and Clarify name the wait (D33)', run: () => {
      const text = (pq) => runProgress(S({ ...planning, pendingQuestion: pq })).text;
      assert.equal(text({ kind: 'plan', plan: { round: 1, nodeId: 'n_plan' } }), 'Plan · needs you · approve the plan');
      assert.equal(text({ kind: 'plan', plan: { port: 'outline', outline: { why: 'w', slices: [{}, {}] } } }), 'Plan · needs you · approve the slices');
      assert.equal(text({ kind: 'clarify', questions: [{}, {}] }), 'Plan · needs you · answer 2 questions');
      assert.notEqual(text({ kind: 'plan', plan: {} }), 'Plan · needs you · answer a question');
      const p6 = { stepper: manifest([agent('n_a', 'deckA'), end()]) };
      assert.equal(runProgress(S({ ...p6, pendingQuestion: { kind: 'plan', plan: {} } })).text, 'Needs you · approve the plan');
    } },
    { name: 'paused / pausing / interrupted → amber', run: () => {
      assert.equal(runProgress(S({ ...planning, status: 'paused' })).tone, 'amber');
      assert.equal(runProgress(S({ ...planning, status: 'paused' })).text, 'Plan · paused');
      assert.equal(runProgress(S({ ...planning, status: 'pausing' })).text, 'Plan · pausing');
      assert.equal(runProgress(S({ ...planning, status: 'interrupted' })).tone, 'amber');
    } },
    { name: 'stopped and error → red', run: () => {
      const stopped = runProgress(S({ ...planning, status: 'stopped' }));
      assert.equal(stopped.tone, 'red');
      assert.equal(stopped.text, 'Plan · stopped');
      const failed = runProgress(S({ ...planning, status: 'error' }));
      assert.equal(failed.tone, 'red');
      assert.equal(failed.text, 'Plan · failed');
    } },
    { name: 'no rows yet → "Plan · starting", blue', run: () => {
      const p = runProgress(S());
      assert.equal(p.text, 'Plan · starting');
      assert.equal(p.tone, 'blue');
    } },
    { name: 'P6 waiting text', run: () => {
      const st = { stepper: manifest([agent('n_a', 'deckA'), end()]) };
      assert.equal(runProgress(S({ ...st, pendingQuestion: { kind: 'gate' } })).text, 'Needs you · a decision');
      assert.equal(runProgress(S({ ...st, status: 'paused' })).text, 'Paused');
      assert.equal(runProgress(S({ ...st, status: 'stopped' })).text, 'Stopped');
      assert.equal(runProgress(S({ ...st, status: 'error' })).text, 'Failed');
    } },
  ]);
});

test('small helpers: ordinal, progressWidth, progressTone, askWhat, constants', async () => {
  await checkRows([
    { name: 'ordinal', run: () => {
      const want = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 11: '11th', 12: '12th', 13: '13th', 21: '21st', 22: '22nd' };
      for (const [n, s] of Object.entries(want)) assert.equal(ordinal(Number(n)), s);
    } },
    { name: 'progressWidth formats and clamps', run: () => {
      assert.equal(progressWidth(0.375), '37.50%');
      assert.equal(progressWidth(-1), '0.00%');
      assert.equal(progressWidth(7), '100.00%');
      assert.equal(progressWidth(NaN), '0.00%');
    } },
    { name: 'progressTone mirrors the status families', run: () => {
      assert.equal(progressTone(null), 'blue');
      assert.equal(progressTone({ status: 'running' }), 'blue');
      assert.equal(progressTone({ status: 'running', pendingQuestion: {} }), 'amber');
    } },
    { name: 'askWhat', run: () => {
      assert.equal(askWhat(null), '');
      assert.equal(askWhat({ kind: 'workflow' }), 'review the workflow');
      assert.equal(askWhat({ kind: 'plan', plan: { round: 2 } }), 'approve the plan');
      assert.equal(askWhat({ kind: 'plan', plan: { outline: { slices: [] } } }), 'approve the slices');
      assert.equal(askWhat({ kind: 'plan', plan: { port: 'outline' } }), 'approve the slices');
      assert.equal(askWhat({ kind: 'plan' }), 'approve the plan');
      assert.equal(askWhat({ kind: 'clarify', questions: [{}] }), 'answer 1 question');
    } },
    { name: 'constants', run: () => {
      assert.deepEqual([...PROGRESS_STAGES], ['plan', 'build', 'review']);
      assert.equal(STAGE_LABEL.ready, 'Ready');
    } },
  ]);
});

test('chainProgress: slice noun and needs you', () => {
  const m = [{ state: 'done' }, { state: 'current', needs: true, progress: { fraction: 0.3, tone: 'blue', label: 'Plan' } }, { state: 'waiting' }];
  const p = chainProgress(m, { noun: 'Slice' });
  assert.equal(p.text, 'Slice 2 of 3 · Needs you');
  assert.equal(p.tone, 'amber');
  const quiet = chainProgress(m.map((x) => ({ ...x, needs: false })));
  assert.equal(quiet.text, 'Run 2 of 3 · Plan');
  assert.equal(quiet.tone, 'blue');
});

test('chainProgress: one equal part per run', async () => {
  const cur = (fraction, label = 'Build', tone = 'blue') => ({ state: 'current', progress: { fraction, label, tone } });
  await checkRows([
    { name: '[done, current(.5 Build), waiting]', run: () => {
      const c = chainProgress([{ state: 'done' }, cur(0.5), { state: 'waiting' }]);
      assert.equal(c.total, 3);
      assert.equal(c.index, 2);
      near(c.fraction, 1.5 / 3);
      assert.equal(c.text, 'Run 2 of 3 · Build');
      assert.deepEqual(c.parts.map((p) => p.tone), ['green', 'blue', 'blue']);
    } },
    { name: '[done, done, waiting] → index 3', run: () => {
      assert.equal(chainProgress([{ state: 'done' }, { state: 'done' }, { state: 'waiting' }]).index, 3);
    } },
    { name: 'a failed member is red at 1 and excluded from the overall fraction', run: () => {
      const c = chainProgress([{ state: 'done' }, { state: 'failed' }, { state: 'waiting' }]);
      assert.equal(c.parts[1].tone, 'red');
      assert.equal(c.parts[1].fraction, 1);
      near(c.fraction, 1 / 3);
    } },
    { name: 'the current tone follows the current run; empty chain', run: () => {
      assert.equal(chainProgress([cur(0.2, 'Plan', 'amber')]).tone, 'amber');
      const e = chainProgress([]);
      assert.equal(e.total, 0);
      assert.equal(e.text, '');
    } },
  ]);
});

// ── role reviews (spec §3/§4a): "Plan · role reviews[, round N]", and never "Plan · Plan" ──

test('role reviews: the shape workflows read "Plan · role reviews[, round 2]" while n_roles runs; an active Planner reads "Plan"', async () => {
  const registry = loadAgentRegistry(undefined, { userAgentsDir: null });
  const sliceRow = (ordinal, role, status) => step({ executionId: `x:n_roles:${ordinal}:role-${role}`, nodeId: 'n_roles', ordinal,
    kind: 'task', taskId: `role-${role}`, phaseOrdinal: 1, status });
  const rows = [];
  for (const tpl of [GRAPH_SHAPE_WORKFLOW, GRAPH_SHAPE_UX_WORKFLOW]) {
    const stepper = buildGraphManifest(tpl, registry);
    const at = (over) => runProgress(S({ stepper, ...over }));
    rows.push({ name: `${tpl.id} planner`, run: () => {
      const p = at({ steps: [row('n_clarify')], active: [live('n_plan')] });
      assert.equal(p.text, 'Plan', 'known bug 1: never "Plan · Plan"');
    } });
    rows.push({ name: `${tpl.id} round 1`, run: () => {
      const p = at({ steps: [row('n_clarify'), row('n_plan'), sliceRow(1, 'ux', 'start')], active: [live('n_roles')],
        progressFacts: { tasks: {}, reviews: {}, roleReview: { nodeId: 'n_roles', round: 1 } } });
      assert.equal(p.text, 'Plan · role reviews');
      assert.equal(p.stage, 'plan');
    } });
    rows.push({ name: `${tpl.id} round 2`, run: () => {
      const p = at({ steps: [row('n_clarify'), row('n_plan'), sliceRow(1, 'ux', 'done'), row('n_refine'), sliceRow(2, 'ux', 'start')],
        active: [live('n_roles', 2)], progressFacts: { tasks: {}, reviews: {}, roleReview: { nodeId: 'n_roles', round: 2 } } });
      assert.equal(p.text, 'Plan · role reviews, round 2');
      assert.equal(p.stage, 'plan');
    } });
    rows.push({ name: `${tpl.id} replay never decreases`, run: () => {
      const memo = {};
      const fact = (round) => ({ tasks: {}, reviews: {}, roleReview: { nodeId: 'n_roles', round } });
      const frames = [
        { steps: [row('n_clarify')], active: [live('n_plan')] },
        { steps: [row('n_clarify'), row('n_plan')], active: [live('n_roles')], progressFacts: fact(1) },
        { steps: [row('n_clarify'), row('n_plan'), sliceRow(1, 'ux', 'done')], active: [live('n_refine')], progressFacts: fact(1) },
        { steps: [row('n_clarify'), row('n_plan'), sliceRow(1, 'ux', 'done'), row('n_refine')], active: [live('n_roles', 2)], progressFacts: fact(2) },
        { steps: [row('n_clarify'), row('n_plan'), sliceRow(1, 'ux', 'done'), row('n_refine'), sliceRow(2, 'ux', 'done')],
          active: [live('n_refine', 2)], progressFacts: fact(2) },
      ];
      let prev = -1;
      for (const f of frames) {
        const p = runProgress(S({ stepper, ...f }), memo);
        assert.equal(p.stage, 'plan');
        assert.ok(p.fraction >= prev, `${p.fraction} < ${prev}`);
        assert.doesNotMatch(p.text, /Plan · Plan/);
        prev = p.fraction;
      }
    } });
  }
  await checkRows(rows);
});
