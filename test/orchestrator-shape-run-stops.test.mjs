// test/orchestrator-shape-run-stops.test.mjs — Shaper small runs C3 (D2–D7, D10, D14, D17): each of dev's slice-run
// stops in a marked run is a stop question (check, objection, requirement) or is settled by the agents, run 1 included;
// an unmarked run keeps dev's asks; non-decision pauses are unchanged. Seeded as orchestrator-shape-care-run.test.mjs.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { getDb } from '../src/core/db.mjs';
import { createSliceFeature } from '../src/core/shape/features.mjs';
import { normalizeOutline, sliceBrief } from '../src/shared/shape/slices.mjs';
import { MOCK_OUTLINE } from '../src/core/engines/mock.mjs';
import { _testing } from '../src/core/graph/executor.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { STOP_REASONS } from '../src/shared/shape/run-stops.mjs';

useTempHome(after);

let sandboxHome;
const prevEnv = {};
const ENV_KEYS = ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_FLAGS', 'WORCA_MOCK_PLAN_CONCERN'];
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-run-stops-home-'));
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
afterEach(() => { delete process.env.WORCA_MOCK_PLAN_CONCERN; _testing.runClaude = null; });
after(async () => {
  for (const k of ENV_KEYS) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const SHAPE = { perspectives: ['product', 'architect', 'qa'] };
const PASS = { ok: true, passed: 8, total: 8, items: [] };
const FAIL = { ok: false, passed: 3, total: 8, items: [{ label: 'Has a test list', pass: false, detail: 'none' }] };
const CONCERN = { title: 'Store export jobs in the DB, not in memory', detail: 'A restart loses queued exports.', section: 'Decisions' };
const IMPL = /^MOCK_ROLE: implementer$/m;
async function withFlag(on, fn) {
  const prev = process.env.WORCA_FLAGS;
  if (on) process.env.WORCA_FLAGS = 'shaperSmallRuns'; else delete process.env.WORCA_FLAGS;
  try { return await fn(); } finally { if (prev === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prev; }
}
const auditOf = (pid) => getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ? ORDER BY id').all(pid).map((r) => r.text);
const C3_LINE = /decided by you|settled by the agents/;

/** Starts a run; `on` maps an ask to its answer (default: dev's), `afterSpawn(prompt, orch)` runs after each agent. */
function start({ on = {}, afterSpawn = null, setup = null, ...opts } = {}) {
  const orch = createOrchestrator({ workflowId: 'wf_shape', prompt: 'demo', claude: { mock: true }, shape: SHAPE, ...opts });
  if (setup) setup(orch);
  const asked = [];
  const execs = [];
  _testing.runClaude = async (o) => {
    if (afterSpawn) { const r = await afterSpawn(o, orch, 'before'); if (r !== undefined) return r; }
    const r = await runClaude(o);
    if (afterSpawn) await afterSpawn(o, orch, 'after');
    return r;
  };
  orch.on('exec', (e) => execs.push(e));
  orch.on('question', (q) => {
    asked.push(q);
    const own = on[q.kind];
    if (own) return setImmediate(() => own(q, orch));
    if (q.kind === 'care') setImmediate(() => orch.answer(q.id, { care: { position: q.care.pick.position } }));
    else if (q.kind === 'plan') setImmediate(() => orch.answer(q.id, { decision: 'approve' }));
    else if (q.kind === 'clarify' || q.kind === 'questions') setImmediate(() => orch.answer(q.id, { answers: [] }));
    else if (q.kind === 'gate') setImmediate(() => orch.answer(q.id, { decision: 'continue' }));
    else if (q.kind === 'recovery') setImmediate(() => orch.answer(q.id, { decision: 'pause' }));
  });
  const done = opts.resume ? orch.resume() : orch.run();
  return { orch, asked, execs, done, pid: () => orch.getState().id };
}

const AGREED = [{ id: 'R-po-1', text: 'People save a chart', example: 'Ana saves a chart.' }, { id: 'R-arch-1', text: 'Charts live in the store' }];
const RAW = { why: 'two steps', leftOut: [], slices: [1, 2].map((i) => ({ ...MOCK_OUTLINE.slices[i === 1 ? 0 : 1], id: `s${i}`, title: `Part ${i}`,
  dependsOn: i === 1 ? [] : ['s1'], requirements: i === 1 ? ['R-po-1'] : ['R-arch-1'] })) };
const OUTLINE = normalizeOutline(RAW, { agreed: AGREED }).outline;

async function feature({ marked = true, tag = 'f', position = 'lean' } = {}) {
  const dir = gitDir(`run-stops-${tag}`);
  const h = await withFlag(marked, async () => { const x = start({ projectDir: dir }); await x.done; return x; });
  const f = createSliceFeature({ pipelineId: h.pid(), projectDir: dir, title: 'Charts', outline: OUTLINE, perspectives: SHAPE.perspectives,
    workflowId: 'wf_shape', smallRuns: true, care: { position, chosenBy: 'person', worcaPick: 'balanced' } });
  return { f, dir, run1: h };
}
function sliceRun(fx, opts = {}) {
  const shape = { ...SHAPE, slices: 'off', slice: { feature: fx.f.id, index: 2, total: 2, outline: OUTLINE } };
  return start({ projectDir: fx.dir, workflowId: 'wf_shape_slice_req', prompt: sliceBrief({ featureTitle: 'Charts', outline: OUTLINE, index: 2 }), shape, ...opts });
}
/** The mock plan fails its shape check (a check stop): pass it where only another stop is under test. */
const passing = (o) => { o._planCheck = async () => PASS; };
const stopsOf = (asked) => asked.filter((q) => q.stop);
function assertStop(q, reason, pick) {
  assert.ok(STOP_REASONS.includes(q.stop.reason));
  assert.equal(q.stop.reason, reason);
  assert.equal(q.stop.options.length, 2);
  assert.ok(q.stop.options.some((o) => o.value === q.stop.pick));
  assert.equal(q.stop.pick, pick);
}

let marked;
let unmarked;
before(async () => { marked = await feature({ tag: 'm' }); unmarked = await feature({ marked: false, tag: 'u' }); });

test('(a) a marked slice run asks no Clarify; (b) its exhausted w9 with a major issue is one objection stop', async () => {
  const h = sliceRun(marked, { setup: passing });
  assert.equal((await h.done).status, 'done');
  assert.equal(h.asked.filter((q) => q.kind === 'clarify' || q.kind === 'questions').length, 0);
  const gates = h.asked.filter((q) => q.kind === 'gate');
  assert.equal(gates.length, 1);
  assertStop(gates[0], 'objection', 'another');
  assert.match(gates[0].stop.head, /^Run 2 · .+ objects?$/);
  const lines = auditOf(h.pid());
  assert.deepEqual(lines.filter((t) => /decided by you/.test(t)), ['Run 2: accepted as is · decided by you']);
  assert.ok(!lines.some((t) => /^Gate \*\*/.test(t)), 'the stop line replaces dev\'s gate line');
});

test('(b) minor issues only: the agents settle the gate, 0 asks, and the settled line is written', async () => {
  const h = sliceRun(marked);
  await h.done;
  const asked = h.asked.length;
  const d = await h.orch._schedulerAsk({ id: 'gate-w9-7', kind: 'gate', wireId: 'w9', nodeId: 'n_review', deliveryNo: 2,
    issues: [{ severity: 'minor', title: 'naming' }, { severity: 'suggestion', title: 'nit' }] });
  assert.equal(d, 'continue');
  assert.equal(h.asked.length, asked, 'no question was raised');
  assert.ok(auditOf(h.pid()).includes('Review loop ran out with 2 minor issue(s): accepted · settled by the agents.'));
});

test('(c) plan concerns: a first plain one re-plans with 0 asks, a second objects (pick approve), a requirement one asks keep', async () => {
  process.env.WORCA_MOCK_PLAN_CONCERN = JSON.stringify(CONCERN);
  let impl = 0;
  const h = sliceRun(marked, { afterSpawn: (o, orch, when) => {
    if (when === 'after' && IMPL.test(o.prompt) && ++impl >= 2) delete process.env.WORCA_MOCK_PLAN_CONCERN;
  } });
  assert.equal((await h.done).status, 'done');
  const concerns = h.asked.filter((q) => q.concern);
  assert.equal(concerns.length, 1, 'the first concern was settled, the second asked');
  assertStop(concerns[0], 'objection', 'approve');
  assert.equal(h.execs.filter((e) => e.nodeId === 'n_plan' && e.kind !== 'task' && e.status === 'start').length, 2, 'one re-plan');
  const lines = auditOf(h.pid());
  assert.ok(lines.some((t) => /plan concern went back to the Planner: re-planned · settled by the agents\.$/.test(t)));
  assert.ok(lines.includes('Run 2: build the plan · decided by you'));

  // Re-plan on the objection: dev's validator trims the stop's feedback, and the line still names the option.
  process.env.WORCA_MOCK_PLAN_CONCERN = JSON.stringify(CONCERN);
  impl = 0;
  const rp = sliceRun(marked, {
    on: { plan: (q, orch) => orch.answer(q.id, q.stop && q.concern ? q.stop.options.find((o) => o.value === 'revise').payload : { decision: 'approve' }) },
    afterSpawn: (o, orch, when) => { if (when === 'after' && IMPL.test(o.prompt) && ++impl >= 2) delete process.env.WORCA_MOCK_PLAN_CONCERN; },
  });
  assert.equal((await rp.done).status, 'done');
  assert.equal(rp.asked.filter((q) => q.concern).length, 1);
  const rpLines = auditOf(rp.pid()).filter((t) => /decided by you/.test(t));
  assert.ok(rpLines.includes('Run 2: re-plan · decided by you'), JSON.stringify(rpLines));

  process.env.WORCA_MOCK_PLAN_CONCERN = JSON.stringify({ ...CONCERN, kind: 'requirement', requirements: ['R-arch-1'] });
  const r = sliceRun(marked, { afterSpawn: (o, orch, when) => { if (when === 'after' && IMPL.test(o.prompt)) delete process.env.WORCA_MOCK_PLAN_CONCERN; } });
  await r.done;
  const rq = r.asked.filter((q) => q.concern);
  assert.equal(rq.length, 1);
  assertStop(rq[0], 'requirement', 'keep');
});

test('(d) an outline change and a failing check hold the plan as requirement and check stops', async () => {
  const h = sliceRun(marked, { setup: (o) => { o._planCheck = async () => FAIL; o._outlineChangeText = async () => 'Slice 1 did not add the tags table.'; } });
  await h.done;
  const plans = h.asked.filter((q) => q.kind === 'plan' && q.stop);
  assert.equal(plans.length, 1);
  assertStop(plans[0], 'requirement', 'keep');
  const c = sliceRun(marked, { setup: (o) => { o._planCheck = async () => FAIL; } });
  await c.done;
  const cs = c.asked.filter((q) => q.kind === 'plan' && q.stop);
  assert.equal(cs.length, 1);
  assertStop(cs[0], 'check', 'revise');
  assert.equal(cs[0].stop.head, 'Run 2 · the plan check did not pass');
  assert.ok(auditOf(c.pid()).includes('Run 2: approved as is · decided by you'));
});

test('notes alone are settled: the plan auto-approves and says the notes went to the Planner', async () => {
  const h = sliceRun(marked, { setup: (o) => {
    o._planCheck = async () => PASS;
    const real = o._shapeSliceScope.bind(o);
    o._shapeSliceScope = async () => ({ ...(await real()), notes: ['Use the tags table'] });
  } });
  await h.done;
  assert.equal(h.asked.filter((q) => q.kind === 'plan').length, 0);
  assert.ok(auditOf(h.pid()).some((t) => /^Chat notes went to the Planner/.test(t)));
});

test('a stop answer takes in the latest finished work first; Change takes in nothing and stops', async () => {
  const calls = [];
  const h = sliceRun(marked, { setup: (o) => { passing(o); o._takeInLatestFinished = async (a) => { calls.push(a); }; } });
  await h.done;
  assert.deepEqual(calls, [{ smallRuns: true, onAnswer: true }]);
  const c = [];
  const s = sliceRun(marked, { on: { plan: (q, orch) => orch.answer(q.id, q.stop ? q.stop.options.find((o) => o.value === 'change').payload : { decision: 'approve' }) },
    setup: (o) => { o._takeInLatestFinished = async (a) => { c.push(a); }; o._planCheck = async () => PASS; o._outlineChangeText = async () => 'No longer fits.'; } });
  assert.equal((await s.done).status, 'stopped');
  assert.deepEqual(c, []);
  assert.ok(auditOf(s.pid()).includes('Run 2: change · decided by you'));
});

test('flag on: the answer took in the finished same-base work, so dev\'s after-answer take-in (latest run, any base) is skipped', async () => {
  const calls = [];
  const applies = await withFlag(true, async () => {
    const x = sliceRun(marked, { setup: (o) => { passing(o); o._takeInLatestFinished = async (a) => { calls.push(a); }; } });
    const res = await x.done;
    assert.equal(res.status, 'done', res.error);
    return x.orch._takesInBeforeAnswerNow();
  });
  assert.equal(applies, true, 'the fixture is a run that takes in before its answer');
  assert.deepEqual(calls, []);
});

test('answer + pause + resume writes one answered line and replays the answer', async () => {
  const h = sliceRun(marked, { setup: passing, on: { gate: (q, orch) => { orch.answer(q.id, { decision: 'continue' }); orch.pause(); } } });
  const res = await h.done;
  assert.equal(res.status, 'paused', res.error);
  const saved = readPipelineForResume(h.pid());
  const r = start({ projectDir: marked.dir, workflowId: 'wf_shape_slice_req', resume: saved, shape: h.orch.runShape, setup: passing });
  assert.equal((await r.done).status, 'done');
  assert.equal(r.asked.filter((q) => q.kind === 'gate').length, 0, 'the answer was replayed, not asked again');
  assert.equal(auditOf(h.pid()).filter((t) => /decided by you/.test(t)).length, 1);
});

test('the emitted question frame and the night q both carry stop', async () => {
  const h = sliceRun(marked, { on: { gate: (q, orch) => {
    assert.equal(orch._night.q?.stop?.reason, 'objection');
    assert.equal(orch.pendingQuestion.stop.reason, 'objection');
    orch.answer(q.id, { decision: 'continue' });
  } } });
  await h.done;
  assert.ok(stopsOf(h.asked).length >= 1);
});

test('run 1 of a marked feature: the feature Clarify is asked as on dev; a plain concern re-plans with 0 asks; an exhausted w9 is one stop', async () => {
  const r1 = marked.run1;
  assert.equal(r1.orch._smallRunsMarked, true);
  assert.ok(r1.asked.some((q) => q.kind === 'clarify' || q.kind === 'questions') || r1.asked.some((q) => q.kind === 'care'), 'run 1 still shapes the feature');
  const gates = r1.asked.filter((q) => q.kind === 'gate');
  for (const g of gates) assertStop(g, 'objection', 'another');
  const d = await r1.orch._schedulerAsk({ id: 'gate-w9-8', kind: 'gate', wireId: 'w9', nodeId: 'n_review', deliveryNo: 1, issues: [{ severity: 'minor', title: 'x' }] });
  assert.equal(d, 'continue');

  process.env.WORCA_MOCK_PLAN_CONCERN = JSON.stringify(CONCERN);
  const dir = gitDir('run-stops-r1-concern');
  const h = await withFlag(true, async () => {
    const x = start({ projectDir: dir, afterSpawn: (o, orch, when) => { if (when === 'after' && IMPL.test(o.prompt)) delete process.env.WORCA_MOCK_PLAN_CONCERN; } });
    await x.done; return x;
  });
  assert.equal(h.orch._smallRunsMarked, true);
  assert.equal(h.asked.filter((q) => q.concern).length, 0);
  assert.ok(auditOf(h.pid()).some((t) => /settled by the agents\.$/.test(t)));
});

test('unmarked: dev\'s gate, concern and plan asks carry no stop and no C3 line', async () => {
  const h = sliceRun(unmarked, { setup: (o) => { o._planCheck = async () => FAIL; } });
  await h.done;
  assert.equal(h.orch._smallRunsMarked, false);
  assert.ok(h.asked.some((q) => q.kind === 'plan'));
  assert.equal(stopsOf(h.asked).length, 0);
  assert.ok(!auditOf(h.pid()).some((t) => C3_LINE.test(t)));
  process.env.WORCA_MOCK_PLAN_CONCERN = JSON.stringify(CONCERN);
  const c = sliceRun(unmarked, { afterSpawn: (o, orch, when) => { if (when === 'after' && IMPL.test(o.prompt)) delete process.env.WORCA_MOCK_PLAN_CONCERN; } });
  await c.done;
  assert.equal(c.asked.filter((q) => q.concern).length, 1);
  assert.equal(stopsOf(c.asked).length, 0);
});

// ── T6: non-decision pauses as on dev ─────────────────────────────────────────────────────────────────────────────
const LIMIT = "claude exited with code 1: You've hit your session limit · resets 6pm (Europe/Sofia)";
const PAUSES = [
  ['cost_pipeline', (orch) => { orch._pipelineCaps = () => ({ spentHere: 5, ownCap: 1, teamPipe: null }); }],
  ['cost_pipeline_policy', () => { throw Object.assign(new Error('team cost cap reached'), { errorClass: 'cost_pipeline_policy' }); }],
  ['usage_limit', () => { throw new Error(LIMIT); }],
  ['error', () => { throw Object.assign(new Error('engine exploded'), { errorClass: 'model' }); }],
  ['idle time_limit', () => { throw Object.assign(new Error('no output for 20m (idle limit)'), { code: 'NODE_IDLE_LIMIT', errorClass: 'time_limit' }); }],
  ['step time_limit', () => { throw Object.assign(new Error('ran 90m (time limit)'), { code: 'NODE_TIME_LIMIT', errorClass: 'time_limit' }); }],
];
const strip = (t) => t.replace(/[0-9a-f]{8,}/g, 'ID').replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, 'T').replace(/\$\d+\.\d+/g, '$N');

test('non-decision pauses as on dev: marked and unmarked give the same status, reason, ask kind and audit lines', async () => {
  for (const [name, hit] of PAUSES) {
    const out = [];
    for (const fx of [marked, unmarked]) {
      let from = null;
      const h = sliceRun(fx, { afterSpawn: (o, orch, when) => {
        if (when !== 'before' || !IMPL.test(o.prompt) || from !== null) return undefined;
        from = auditOf(orch.getState().id).length;
        return hit(orch);
      } });
      const res = await h.done;
      const lines = auditOf(h.pid()).slice(from ?? 0);
      out.push({ status: res.status, pauseReason: h.orch.pauseReason || null, kind: h.orch.pendingQuestion?.kind ?? null,
        asks: h.asked.filter((q) => q.kind === 'recovery').length, lines: lines.map(strip) });
      assert.ok(!lines.some((t) => C3_LINE.test(t)), `${name}: no C3 line`);
      assert.equal(h.orch.pendingQuestion?.stop, undefined);
    }
    assert.notEqual(out[0].status, 'done', `${name}: the run paused`);
    assert.deepEqual(out[0], out[1], name);
  }
});

// Small runs C4 (D11): Change it with a proposal re-plans from the new text; the run is not stopped.
test('C4: a Change answer with a proposal re-plans with "R-x now reads:", the slice outline carries the new text, the run is not stopped', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  let injected = false;
  const proposalReviews = { rounds: [{ round: 1, pass: 1, target: 'plan', roles: [{ key: 'qa', label: 'QA', findings: [{ id: 'qa-1-1', severity: 'major',
    title: 'the store is too slow', fix: 'use the DB', status: 'open', requirement: 'R-arch-1', proposed: 'Charts live in the DB' }] }] }] };
  const stops = [];
  const s = sliceRun(marked, {
    setup: (o) => {
      passing(o);
      const real = o._planAsk.bind(o);
      o._planAsk = (q) => { if (!injected) { injected = true; o.state.roleReviews = proposalReviews; } return real(q); };
    },
    on: { plan: (q, orch) => {
      stops.push(q.stop || null);
      const change = q.stop && q.stop.change ? q.stop.options.find((o) => o.value === 'change').payload : null;
      orch.answer(q.id, change && stops.length === 1 ? change : q.stop ? q.stop.options.find((o) => o.value === 'keep').payload : { decision: 'approve' });
    } },
  });
  const res = await s.done;
  assert.notEqual(res.status, 'stopped');
  assert.deepEqual(stops[0].change, [{ id: 'R-arch-1', from: 'Charts live in the store', to: 'Charts live in the DB' }]);
  assert.equal(s.orch.runShape.slice.outline.agreed.find((a) => a.id === 'R-arch-1').text, 'Charts live in the DB');
  const dir = s.orch.pipeline.dir;
  const fb = readdirSync(dir).filter((n) => /^plan-feedback-\d+\.md$/.test(n)).map((n) => readFileSync(join(dir, n), 'utf8'));
  assert.ok(fb.some((t) => t.includes('R-arch-1 now reads: Charts live in the DB')), fb.join('\n---\n'));
  assert.ok(auditOf(s.pid()).includes('Run 2: change · decided by you'));
});
