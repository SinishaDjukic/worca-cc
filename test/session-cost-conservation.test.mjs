// test/session-cost-conservation.test.mjs — X2: never double-counted, never dropped, never on the wrong step, never $0 when unknown.
import { test, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume, readPipelineStateById } from '../src/core/artifacts.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { tracePath, readTrace } from '../src/core/session-trace.mjs';
import { recordBridgeCost } from '../src/core/bridge/telemetry.mjs';
import { _testing as mockT } from '../src/core/engines/mock-session.mjs';
import { pauseMidTurn, crashMidTurn, fakePort, spec, decisions } from './helpers/session-host-fakes.mjs';
import { createSessionHosts, HOST_CUT_COST_RESTORED } from '../src/core/session-host.mjs';

useTempHome(after);
const SID = 's_aaaaaaaa';
const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} vs ${b}`);
before(async () => {
  process.env.WORCA_FLAGS = 'sessionGroups';
  const t = structuredClone(SEED_TEMPLATES.find((s) => s.id === 'wf_quick-fix'));
  for (const id of ['n_plan', 'n_impl', 'n_review']) t.nodes.find((n) => n.id === id).config.session = SID;
  t.sessions = { [SID]: { hostModel: 'claude-haiku-4-5' } };
  await writeGraphWorkflow({ ...t, id: 'wf_cons', name: 'Cons' });
});
beforeEach(() => { mockT.resetSessions(); mockT.behave = null; mockT.restoreCutCost = true; mockT.costFor = null; mockT.onTurn = null; mockT.onMemberStart = null; });   // priced spend: cut estimates are exact (Task 38)
const rowUsd = (s) => s.costUsd || 0;                                  // _recordCost adds an aux booking to costUsd too (run-harness.mjs:8036)
// Rows are rounded to $0.0001 per booking (roundUsd, run-harness.mjs:274); the trace keeps full precision.
const nearRow = (a, b, what, n = 10) => assert.ok(Math.abs(a - b) <= 1e-4 * n + 1e-12, `${what}: ${a} vs ${b}`);
async function conserve(st) {
  const { records } = await readTrace(tracePath(st.pipelineDir, SID));
  const truth = [...mockT.spent.values()].reduce((a, b) => a + b, 0);
  const costs = records.filter((r) => r.kind === 'cost');
  const booked = costs.reduce((a, r) => a + (r.memberUsd || 0) + (r.hostOverheadUsd || 0), 0);
  const deltas = records.filter((r) => r.kind === 'turn_end').reduce((a, r) => a + (r.deltaUsd || 0), 0);
  const cutEstimates = costs.filter((r) => r.cut).reduce((a, r) => a + (r.memberUsd || 0), 0);   // a cut no later Δ can carry (rotate, restart, engine switch)
  const members = st.steps.filter((s) => s.session?.sid === SID);
  near(booked, truth, 'Σ booked vs the harness truth'); near(deltas + cutEstimates, truth, 'Σ Δ + uncarried cuts');
  nearRow(members.reduce((a, s) => a + rowUsd(s), 0), truth, 'Σ member rows', 2 * costs.length);
  for (const s of members) {
    const mine = costs.filter((r) => r.executionId === s.executionId);
    nearRow(rowUsd(s), mine.reduce((a, r) => a + (r.memberUsd || 0) + (r.hostOverheadUsd || 0), 0), `row ${s.key}`, 2 * mine.length);
  }
  assert.equal(new Set(costs.map((r) => r.turnId)).size, costs.length, 'one cost record per turn (C31)');
  return { records, costs };
}
const run = async (behave, { engine } = {}) => {
  mockT.behave = behave;
  const o = createOrchestrator({ projectDir: gitDir(`cons-${Math.random().toString(36).slice(2, 7)}`), workflowId: 'wf_cons', prompt: 'demo', auto: true, claude: { mock: true, ...(engine ? { engine } : {}) } });
  assert.equal((await o.run()).status, 'done');
  return o.getState();
};
const resumeOf = (orch, id, claude = { mock: true }) => createOrchestrator({ projectDir: orch.projectDir, workflowId: 'wf_cons', auto: true, claude, resume: readPipelineForResume(id) });

test('plain run', { timeout: 120000 }, async () => conserve(await run(null)));
test('watchdog retries (no-dispatch on turn 2)', { timeout: 120000 }, async () => conserve(await run(({ turn }) => (turn === 2 ? 'no-dispatch' : null))));
test('immediate kills: two Agent calls and a stray Bash (no result at all)', { timeout: 120000 }, async () =>
  conserve(await run(({ turn }) => ({ 2: 'two-dispatch', 4: 'stray-bash' })[turn] || null)));
test('rotation on the cap', { timeout: 120000 }, async () => conserve(await run(({ turn }) => (turn === 3 ? 'cap' : null))));

test('REVIEW FOCUS 3 — a cut turn, then resume: the carried spend lands once, on the cut step\'s row', { timeout: 120000 }, async () => {
  const { orch, id } = await pauseMidTurn({ workflowId: 'wf_cons', nodeId: 'n_impl', spendBeforeHang: 0.07 });
  mockT.behave = null;
  const o2 = resumeOf(orch, id);
  assert.equal((await o2.resume()).status, 'done');
  const { costs } = await conserve(o2.getState());
  const carried = costs.filter((r) => r.carriedBy);
  assert.equal(carried.length, 1);
  assert.equal(carried[0].executionId, 'x:n_impl:1');
});

test('REVIEW FOCUS 3 / C12 — the main agent dies after Implementation finished; Review\'s turn carries Implementation\'s dollars to Implementation', { timeout: 120000 }, async () => {
  const st = await run(({ agentType }) => (agentType === 'worca-x-n_impl-1-a1' ? 'host-error-after-member' : null));
  const { costs } = await conserve(st);
  const carried = costs.find((r) => r.carriedBy);
  assert.ok(carried, 'Implementation\'s turn had no result: its spend arrived in Review\'s Δ');
  assert.equal(carried.executionId, 'x:n_impl:1');
});

// v2 (correction 13): the review that ends the run is cycle 2 — the mock reviewer's cycle-1 major sends the loop back to
// Implementation, whose turn carries cycle 1's dollars (the row below). Every assertion of the master row stands.
test('verify major 1 — C12 on the LAST member: no later turn carries Review\'s dollars, so close() books them as an estimate on Review', { timeout: 120000 }, async () => {
  const st = await run(({ agentType }) => (agentType === 'worca-x-n_review-2-a1' ? 'host-error-after-member' : null));
  const { records, costs } = await conserve(st);
  const cut = costs.filter((r) => r.cut);
  assert.equal(cut.length, 1);
  assert.deepEqual([cut[0].executionId, cut[0].costSource], ['x:n_review:2', 'estimate']);
  assert.equal(costs.filter((r) => r.carriedBy).length, 0, 'nothing carried it');
  const close = records.at(-1);
  assert.equal(close.kind, 'close');
  // v4: close() booked it, right before its own record (a cut booked at the turn sits before that turn's verdict instead).
  assert.equal(records.at(-2), costs.find((r) => r.cut), 'booked by close(), right before the close record');
});

test('v2 — C12 on Review cycle 1: the fix cycle\'s turn carries Review\'s dollars to Review, not to Implementation', { timeout: 120000 }, async () => {
  const st = await run(({ agentType }) => (agentType === 'worca-x-n_review-1-a1' ? 'host-error-after-member' : null));
  const { costs } = await conserve(st);
  const carried = costs.filter((r) => r.carriedBy);
  assert.equal(carried.length, 1);
  assert.equal(carried[0].executionId, 'x:n_review:1');
  assert.equal(costs.find((r) => r.turnId === carried[0].carriedBy).executionId, 'x:n_impl:2', 'the next turn of the epoch carried it');
  assert.equal(costs.filter((r) => r.cut).length, 0);
});

test('verify major 1 — Stop mid-turn, never resumed: close(\'stopped\') books the cut turn as an estimate on its row', { timeout: 120000 }, async () => {
  let o;
  mockT.behave = ({ agentType }) => (agentType === 'worca-x-n_impl-1-a1' ? 'hang' : null);
  mockT.onMemberStart = ({ agentType }) => { if (agentType === 'worca-x-n_impl-1-a1') queueMicrotask(() => o.stop()); };
  try {
    o = createOrchestrator({ projectDir: gitDir('cons-stop'), workflowId: 'wf_cons', prompt: 'demo', auto: true, claude: { mock: true } });
    assert.equal((await o.run()).status, 'stopped');
  } finally { mockT.onMemberStart = null; }
  const st = o.getState();
  const { records, costs } = await conserve(st);
  const cut = costs.filter((r) => r.cut);
  assert.deepEqual(cut.map((r) => [r.executionId, r.costSource]), [['x:n_impl:1', 'estimate']]);
  assert.deepEqual([records.at(-1).kind, records.at(-1).status], ['close', 'stopped']);
});

test('vanished after a cut: the carry is dropped with the epoch, and the cut is booked as an estimate', { timeout: 120000 }, async () => {
  const { orch, id } = await pauseMidTurn({ workflowId: 'wf_cons', nodeId: 'n_review', spendBeforeHang: 0.05 });
  mockT.behave = ({ resume }) => (resume ? 'vanished' : null);
  const o2 = resumeOf(orch, id);
  assert.equal((await o2.resume()).status, 'done');
  const st = o2.getState();
  const { records } = await readTrace(tracePath(st.pipelineDir, SID));
  const cut = records.filter((r) => r.kind === 'cost' && r.cut);
  assert.equal(cut.length, 1);
  assert.equal(cut[0].costSource, 'estimate');
  // the vanished host's carried 0.05 never reached a result, so truth excludes nothing the trace claims: Σ booked ≥ Σ Δ by exactly the estimate
  const deltas = records.filter((r) => r.kind === 'turn_end').reduce((a, r) => a + (r.deltaUsd || 0), 0);
  const booked = records.filter((r) => r.kind === 'cost').reduce((a, r) => a + (r.memberUsd || 0) + (r.hostOverheadUsd || 0), 0);
  near(booked - deltas, cut[0].memberUsd, 'the estimate is the only booking outside a Δ');
});

test('C9 — when the CLI does not restore a killed turn\'s cost, the cut is an estimate at the cut and nothing is carried', { timeout: 120000 }, async () => {
  mockT.restoreCutCost = false;
  const { orch, id } = await pauseMidTurn({ workflowId: 'wf_cons', nodeId: 'n_impl', spendBeforeHang: 0.07 });
  mockT.behave = null;
  const o2 = resumeOf(orch, id);
  assert.equal((await o2.resume()).status, 'done');
  const { records } = await readTrace(tracePath(o2.getState().pipelineDir, SID));
  assert.equal(records.filter((r) => r.kind === 'cost' && r.carriedBy).length, 0);
  assert.equal(records.filter((r) => r.kind === 'cost' && r.cut && r.costSource === 'estimate').length, 1);
});

test('crash and resume', { timeout: 120000 }, async () => {
  const { id, orch } = await crashMidTurn({ workflowId: 'wf_cons', nodeId: 'n_review' });
  const o = createOrchestrator({ projectDir: readPipelineStateById(id).projectDir, workflowId: 'wf_cons', auto: true, claude: { mock: true }, resume: readPipelineForResume(id) });
  void orch;
  assert.equal((await o.resume()).status, 'done');
  await conserve(o.getState());
});

test('an engine switch on resume: both epochs conserve', { timeout: 120000 }, async () => {
  const { orch, id } = await pauseMidTurn({ workflowId: 'wf_cons', nodeId: 'n_impl' });
  mockT.behave = null;
  const o2 = resumeOf(orch, id, { mock: true, engine: 'codex' });
  assert.equal((await o2.resume()).status, 'done');
  await conserve(o2.getState());
});

test('C34 — a bridged member: the upstream figure is booked once, on its row', { timeout: 120000 }, async () => {
  const execOf = (agentType) => agentType.replace(/^worca-/, '').replace(/-a\d+$/, '').replaceAll('-', ':');   // worca-x-n_impl-1-a1 → x:n_impl:1
  mockT.onTurn = ({ agentType }) => recordBridgeCost({ tag: execOf(agentType), costUsd: 0.2 });   // the bridge saw 0.2 upstream per turn, under the member's tag
  const st = await run(null);
  mockT.onTurn = null;
  const { records } = await readTrace(tracePath(st.pipelineDir, SID));
  const bridged = records.filter((r) => r.kind === 'cost' && r.costSource === 'bridge');
  assert.ok(bridged.length >= 2);
  for (const s of st.steps.filter((x) => x.session?.sid === SID)) nearRow(rowUsd(s), 0.2 * bridged.filter((r) => r.executionId === s.executionId).length, s.key);
});

test('REVIEW FOCUS 3 — Copilot end to end: rows, breakdown and Summary all blank, never $0', { timeout: 120000 }, async () => {
  const st = await run(() => 'no-cost', { engine: 'copilot' });
  assert.equal(st.sessionHosts[SID].costUsd, null);
  assert.ok(st.steps.filter((s) => s.session?.sid === SID).every((s) => !s.costUsd && !s.auxCosts?.session?.usd));
  const { records } = await readTrace(tracePath(st.pipelineDir, SID));
  assert.ok(records.filter((r) => r.kind === 'cost').every((r) => r.costSource === 'none' && r.memberUsd === null));
});

test('v3 — the conservation rows really ran in the host: every member turn has its cost record', { timeout: 120000 }, async () => {
  const st = await run(null);
  const { costs } = await conserve(st);
  assert.equal(st.sessionHosts[SID].mode, 'subagents');
  assert.deepEqual(costs.map((r) => r.executionId).sort(), ['x:n_impl:1', 'x:n_impl:2', 'x:n_plan:1', 'x:n_review:1', 'x:n_review:2']);
  assert.ok(costs.every((r) => r.costSource === 'harness' && r.memberUsd > 0));
});

test('v3 — Copilot: blank means null, not $0 (every hosted member row, every cost record)', { timeout: 120000 }, async () => {
  const st = await run(() => 'no-cost', { engine: 'copilot' });
  const members = st.steps.filter((s) => s.session?.sid === SID);
  assert.ok(members.length >= 5);
  assert.ok(members.every((s) => s.costUsd == null && s.auxCosts?.session?.usd == null), JSON.stringify(members.map((s) => [s.costUsd, s.auxCosts])));
  const { records } = await readTrace(tracePath(st.pipelineDir, SID));
  assert.ok(records.filter((r) => r.kind === 'cost').length >= 5);
});

test('v3 — correction 14 is the mock transport\'s only: a real CLI\'s host reads HOST_CUT_COST_RESTORED, whatever the mock says', () => {
  mockT.restoreCutCost = false;
  const real = createSessionHosts({ specs: [spec()], decisions: decisions(), port: fakePort({ mock: false }) }).hosts.values().next().value;
  assert.equal(real.limits.cutCostRestored, HOST_CUT_COST_RESTORED);
  const mock = createSessionHosts({ specs: [spec()], decisions: decisions(), port: fakePort({ mock: true }) }).hosts.values().next().value;
  assert.equal(mock.limits.cutCostRestored, false);
  mockT.restoreCutCost = null;                         // the mock's own reading: only an explicit false loses the spend
  assert.equal(createSessionHosts({ specs: [spec()], decisions: decisions(), port: fakePort({ mock: true }) }).hosts.values().next().value.limits.cutCostRestored, true);
});
