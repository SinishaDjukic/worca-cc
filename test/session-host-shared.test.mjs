// test/session-host-shared.test.mjs — "one conversation": every step a turn of the same session, opt-in only (Task 65).
import { test, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { getDb } from '../src/core/db.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { tracePath, readTrace } from '../src/core/session-trace.mjs';
import { _testing as mockT } from '../src/core/engines/mock-session.mjs';
import { createSessionHosts, defaultTransport } from '../src/core/session-host.mjs';
import { sharedTurnOpts, SHARED_SESSION_PREAMBLE, SHARED_ROLE_HEADING } from '../src/core/engines/session-dispatch.mjs';
import { createClaudeNormalizer } from '../src/core/engines/claude-events.mjs';
import { createCodexNormalizer } from '../src/core/engines/codex.mjs';
import { priceUsage } from '../src/core/session-cost.mjs';
import { listCostRates } from '../src/core/config.mjs';
import { spec, decisions, fakePort, member } from './helpers/session-host-fakes.mjs';
import { runOnce } from './helpers/session-parity.mjs';

useTempHome(after);
const SID = 's_aaaaaaaa';
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-9, `${m ?? ''} ${a} vs ${b}`);
before(async () => {
  process.env.WORCA_FLAGS = 'sessionGroups';
  const t = structuredClone(SEED_TEMPLATES.find((s) => s.id === 'wf_quick-fix'));
  for (const id of ['n_impl', 'n_review']) t.nodes.find((n) => n.id === id).config.session = SID;
  t.sessions = { [SID]: { mode: 'shared' } };
  await writeGraphWorkflow({ ...t, id: 'wf_shared', name: 'Shared' });
  await writeGraphWorkflow({ ...structuredClone(SEED_TEMPLATES.find((s) => s.id === 'wf_quick-fix')), id: 'wf_shared_plain', name: 'Shared plain' });
});
after(() => { delete process.env.WORCA_FLAGS; });
beforeEach(() => {
  mockT.resetSessions();
  Object.assign(mockT, { behave: null, onTurn: null, onMemberStart: null, spendBeforeHang: null, resolvedModel: null, restoreCutCost: true,
    costFor: ({ turn }) => 0.01 * turn });                         // a distinct figure per turn: Δ, not the running total, is booked
});

test('members share one session id; the role travels in the user turn; no sub-agent records; cost is all the step\'s', { timeout: 120000 }, async () => {
  const turns = [];
  mockT.onTurn = ({ hostOpts }) => turns.push(hostOpts);
  const o = createOrchestrator({ projectDir: gitDir('shared'), workflowId: 'wf_shared', prompt: 'demo', auto: true, claude: { mock: true } });
  assert.equal((await o.run()).status, 'done');
  const st = o.getState();
  const rows = st.steps.filter((s) => s.session?.sid === SID);
  assert.deepEqual(rows.map((s) => s.key), ['x:n_impl:1', 'x:n_review:1', 'x:n_impl:2', 'x:n_review:2']);
  assert.deepEqual([...new Set(rows.map((s) => s.sessionId))], ['mock-host-1'], 'one conversation id on every member row');
  assert.equal(mockT.seen.length, 4);
  assert.ok(mockT.seen.every((s) => s.shared === true && s.prompt.startsWith('## Your role for this step')));
  assert.deepEqual(turns.map((h) => [h.systemPrompt === SHARED_SESSION_PREAMBLE, h.resumeSessionId ?? null]),
    [[true, null], [true, 'mock-host-1'], [true, 'mock-host-1'], [true, 'mock-host-1']], 'the conversation is resumed from its second turn');
  const { records } = await readTrace(tracePath(st.pipelineDir, SID));
  assert.equal(records.find((r) => r.kind === 'mode').mode, 'shared');
  assert.deepEqual(records.filter((r) => ['member_bound', 'member_done', 'watchdog', 'rotate', 'restart'].includes(r.kind)), []);
  const costs = records.filter((r) => r.kind === 'cost');
  assert.deepEqual(costs.map((r) => [r.executionId, r.costSource, r.hostOverheadUsd]), rows.map((s) => [s.key, 'harness', 0]));
  rows.forEach((s, i) => near(s.costUsd, 0.01 * (i + 1), s.key));
  assert.ok(st.steps.every((s) => !s.auxCosts?.session), 'no hand-off booked or counted');
  assert.equal(st.subAgents.filter((s) => /^worca-x-/.test(s.subagentType || '')).length, 0);
  assert.deepEqual(rows[0].session, { sid: SID, hostEpoch: 1, hostSessionId: 'mock-host-1', turnId: `t:${SID}:1`, dispatchId: 'd:x:n_impl:1:a1',
    attempt: 1, memberAgentId: null, memberTranscriptId: null, costSource: 'harness' });
  const sum = st.sessionHosts[SID];
  assert.deepEqual([sum.mode, sum.turns, sum.dispatches, sum.hostSessionId, sum.hostOverheadUsd], ['shared', 4, 4, 'mock-host-1', 0]);
  near(sum.costUsd, 0.1);
});

test('routing parity with the ungrouped run (launch order and loop deliveries)', { timeout: 180000 }, async () => {
  // runOnce moved from test/graph-session-parity.test.mjs to test/helpers/session-parity.mjs in this task.
  const a = await runOnce('wf_shared_plain');
  const b = await runOnce('wf_shared');
  assert.deepEqual(b.starts, a.starts, 'launch order');
  assert.deepEqual(b.deliveries, a.deliveries, 'verdict routing and loop counts');
  assert.deepEqual(b.artifacts, a.artifacts, 'artifact paths');
  assert.deepEqual(b.tokens, a.tokens, 'fired outputs');
  assert.equal(b.rows, a.rows, 'ledger row count');
  assert.deepEqual(b.hostedOk, [], 'no sub-agent definition in one conversation');
  assert.deepEqual(b.sharedOk.map(([x]) => x), ['x:n_impl:1', 'x:n_review:1', 'x:n_impl:2', 'x:n_review:2'], 'every member ran as a turn');
  for (const [x, same] of b.sharedOk) assert.ok(same, `${x}: the preamble, then the role heading, the member's system prompt and its brief`);
  assert.deepEqual(b.briefs, a.briefs, 'every brief of the run, normalized, equals the ungrouped run\'s');
});

test('a turn cut by a pause resumes the same conversation with RESUME_HEADER; its spend lands on its own row', { timeout: 120000 }, async () => {
  let orch = null;
  mockT.resolvedModel = 'claude-haiku-4-5';                         // the cut is priced from its usage (C9)
  mockT.spendBeforeHang = 0.07;
  mockT.behave = ({ turn }) => (turn === 2 ? 'hang' : null);         // turn 2: Review, cycle 1
  mockT.onMemberStart = ({ turn }) => { if (turn === 2) queueMicrotask(() => orch.pause()); };
  orch = createOrchestrator({ projectDir: gitDir('shared-pause'), workflowId: 'wf_shared', prompt: 'demo', auto: true, claude: { mock: true } });
  assert.equal((await orch.run()).status, 'paused');
  const id = orch.getState().id;
  const point = readPipelineForResume(id);
  assert.equal(point.resumePoint.sessionHosts[SID].hostSessionId, 'mock-host-1');
  assert.equal(point.resumePoint.sessionHosts[SID].openCut.executionId, 'x:n_review:1');
  Object.assign(mockT, { behave: null, onMemberStart: null });
  const o2 = createOrchestrator({ projectDir: orch.projectDir, workflowId: 'wf_shared', auto: true, claude: { mock: true }, resume: point });
  assert.equal((await o2.resume()).status, 'done');
  const resumed = mockT.seen[2];
  assert.deepEqual([resumed.resumeSessionId, resumed.hostSessionId], ['mock-host-1', 'mock-host-1'], 'the same conversation, not a new one');
  assert.match(resumed.prompt, /## Resumed session/, 'shared mode keeps RESUME_HEADER (spec §5)');
  assert.doesNotMatch(resumed.prompt, /## Earlier attempt interrupted/);
  const st = o2.getState();
  const { records } = await readTrace(tracePath(st.pipelineDir, SID));
  const costs = records.filter((r) => r.kind === 'cost');
  assert.deepEqual(costs.filter((r) => r.carriedBy).map((r) => r.executionId), ['x:n_review:1']);
  const truth = [...mockT.spent.values()].reduce((a, v) => a + v, 0);
  near(costs.reduce((a, r) => a + (r.memberUsd || 0) + (r.hostOverheadUsd || 0), 0), truth, 'Σ booked');
  near(st.steps.filter((s) => s.session?.sid === SID).reduce((a, s) => a + (s.costUsd || 0), 0), truth, 'Σ member rows');
});

test('a crash in the conversation\'s first turn: the resumed run continues that conversation and books the cut turn\'s spend once (C43)', { timeout: 120000 }, async () => {
  mockT.resolvedModel = 'claude-haiku-4-5';
  mockT.spendBeforeHang = 0.07;
  let started;
  const atStart = new Promise((resolve) => { started = resolve; });
  mockT.behave = ({ turn }) => (turn === 1 ? 'hang' : null);         // turn 1: Implementation, the conversation's first
  mockT.onMemberStart = ({ turn }) => { if (turn === 1) started(); };
  const orch = createOrchestrator({ projectDir: gitDir('shared-crash'), workflowId: 'wf_shared', prompt: 'demo', auto: true, claude: { mock: true } });
  orch.run().catch(() => {});                                        // never settles: the process "died" mid-turn
  await atStart;
  await tick();
  const id = orch.getState().id;
  orch._persist = async () => {};                                    // a dead process writes nothing more
  orch._stopHeartbeat();
  const db = getDb();
  db.prepare("UPDATE pipelines SET status = 'interrupted', heartbeat_at = ? WHERE id = ?").run(new Date(Date.now() - 300_000).toISOString(), id);
  db.prepare("UPDATE pipeline_steps SET status = 'running' WHERE pipeline_id = ? AND key = ?").run(id, 'x:n_impl:1');
  const point = readPipelineForResume(id);
  assert.equal(point.resumePoint.sessionHosts[SID].hostSessionId, 'mock-host-1', 'saved the moment the conversation answered');
  Object.assign(mockT, { behave: null, onMemberStart: null, spendBeforeHang: null });
  const o2 = createOrchestrator({ projectDir: orch.projectDir, workflowId: 'wf_shared', auto: true, claude: { mock: true }, resume: point });
  assert.equal((await o2.resume()).status, 'done');
  assert.deepEqual(mockT.seen.map((x) => x.resumeSessionId), [null, 'mock-host-1', 'mock-host-1', 'mock-host-1', 'mock-host-1'], 'one conversation, before and after the crash');
  const st = o2.getState();
  const { records } = await readTrace(tracePath(st.pipelineDir, SID));
  const truth = [...mockT.spent.values()].reduce((a, v) => a + v, 0);
  near(records.filter((r) => r.kind === 'cost').reduce((a, r) => a + (r.memberUsd || 0), 0), truth, 'Σ booked, the crashed turn\'s 0.07 included');
  near(st.steps.filter((x) => x.session?.sid === SID).reduce((a, x) => a + (x.costUsd || 0), 0), truth, 'Σ member rows');
});

// ── the SessionHost's shared path, on a transport that plays NORMALIZED events (what runClaude hands a plain spawn) ──
const M = 'claude-opus-5-5';
const U = Object.freeze({ input_tokens: 5000, output_tokens: 700 });
const INV = Object.freeze({ input_tokens: 9 });                      // an investigator's message: part of a cut turn's price (C33)
/** A cut turn's price from turnEvents: its own message usage and its investigator's. */
const turnPrice = (o) => priceUsage(M, U, o) + priceUsage(M, INV, o);
const pick = (r, keys) => Object.fromEntries(keys.map((k) => [k, r[k]]));
const abortErr = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
const tick = () => new Promise((r) => setTimeout(r, 5));
/** One turn's normalized events: two session events (the runner's, then the init), the turn's own usage, an investigator's
 *  usage (not the turn's), a text and the result (`usd` null: a result without its figure; `cumulative` false: a turn's own). */
const turnEvents = ({ id = 'C1', usd = null, cumulative = true } = {}) => [
  { type: 'session', sessionId: id },
  { type: 'session', sessionId: id, model: M, init: true },
  { type: 'usage', phase: 'message', parentId: null, messageId: 'm1', model: M, usage: { ...U } },
  { type: 'usage', phase: 'message', parentId: 'toolu_inv', messageId: 'i1', model: M, usage: { ...INV } },
  { type: 'text', text: 'working', parentId: null, from: 'assistant' },
  { type: 'result', text: 'REPORT', usage: { ...U }, subtype: 'success', isError: false, numTurns: 3, sessionId: id,
    ...(usd == null ? {} : { costUsd: usd, ...(cumulative ? { cumulativeCost: true } : {}) }) },
];
const CU = Object.freeze({ input_tokens: 4000, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, output_tokens: 300 });
/** One Codex turn as its adapter hands it on (codex.mjs `createCodexNormalizer`): the thread named at `thread.started` (an
 *  init), the agent's message and `turn.completed`'s result, which has no turn count, no subtype and no session id. Codex
 *  emits no `usage` events. `usd`: the turn's figure (none: a model no list prices, e.g. one on its own endpoint). */
const codexTurn = ({ thread = 'T1', usd = null, model = M } = {}) => {
  const n = createCodexNormalizer({ model });
  const out = [{ type: 'thread.started', thread_id: thread }, { type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: 'REPORT' } },
    { type: 'turn.completed', usage: { input_tokens: 5000, cached_input_tokens: 1000, output_tokens: 300 } }].flatMap((l) => n.push(l));
  if (usd != null) out.at(-1).costUsd = usd;
  return out;
};
/** A Codex turn that ended without `turn.completed` (it failed, hit its cap, was stopped or paused) still ran: codex.mjs
 *  `settleUsage` reads its spend from the thread's rollout and hands it on as an error result, again with no turn count,
 *  before the spawn throws (test/codex-ask-adapter.test.mjs pins that side). */
const codexSettled = ({ thread = 'T1', usd = null } = {}) => [...codexTurn({ thread }).slice(0, 2),
  { type: 'result', subtype: 'error_during_execution', isError: true, text: '', usage: { ...CU }, ...(usd == null ? {} : { costUsd: usd }) }];
/** `play(hostOpts, i)` → the events of call i; `hang(i)`: then wait for the kill; `fail(i)`: then reject with it. */
function sharedTransport(play, { fail = () => null, hang = () => false } = {}) {
  const calls = [];
  const transport = async (hostOpts) => {
    const i = calls.length;
    calls.push(hostOpts);
    for (const e of play(hostOpts, i)) hostOpts.onEvent?.(e);
    if (hang(i)) {
      await new Promise((_, reject) => {
        if (hostOpts.signal.aborted) reject(abortErr());
        else hostOpts.signal.addEventListener('abort', () => reject(abortErr()), { once: true });
      });
    }
    const err = fail(i);
    if (err) throw err;
    return { text: `R${i}`, exitCode: 0 };
  };
  return { transport, calls };
}
const sharedHost = (port, transport, limits = {}) => createSessionHosts({ specs: [spec(['n_a', 'n_b'], { mode: 'shared' })],
  decisions: decisions('shared', { requested: 'shared', reason: 'chosen in the session settings' }), port, transport, limits }).hosts.get(SID);
const memberOpts = (events = [], over = {}) => ({ cwd: tmpdir(), systemPrompt: 'SYS', prompt: 'TASK', allowedTools: ['Read'], model: M,
  signal: new AbortController().signal, onEvent: (e) => events.push(e), engine: 'claude', ...over });
const kinds = (port) => port.records.map((r) => r.kind);
const ROLE = `${SHARED_ROLE_HEADING}SYS\n\nTASK`;

test('sharedTurnOpts: the member\'s own options, the preamble as the system prompt, the role and the task in the user turn', () => {
  const signal = new AbortController().signal;
  const onEvent = () => {};
  const m = { cwd: '/w', systemPrompt: 'SYS', prompt: 'TASK', allowedTools: ['Read'], model: M, effort: 'high', modelEnv: { ANTHROPIC_MODEL: 'x' },
    resumeSessionId: 'own', mcpServerGrants: ['mcp__s'], agents: { 'worca-investigator': { prompt: 'p' } }, signal, onEvent, mock: true, engine: 'codex' };
  const before = { ...m };
  assert.deepEqual(sharedTurnOpts(m, { hostSessionId: 'C1' }), { ...m, systemPrompt: SHARED_SESSION_PREAMBLE, prompt: ROLE, resumeSessionId: 'C1', shared: true });
  assert.deepEqual(m, before, 'the member\'s runOpts are not changed');
  assert.equal(sharedTurnOpts(m, { hostSessionId: null }).resumeSessionId, undefined, 'the conversation\'s first turn starts it');
  assert.equal(Object.hasOwn(sharedTurnOpts(m), 'resumeSessionId'), true);
  assert.equal(sharedTurnOpts(m).resumeSessionId, undefined, 'never the member\'s own session');
  assert.deepEqual(sharedTurnOpts(null), { systemPrompt: SHARED_SESSION_PREAMBLE, prompt: `${SHARED_ROLE_HEADING}\n\n`, resumeSessionId: undefined, shared: true });
  assert.equal(SHARED_SESSION_PREAMBLE, 'You are working through a worca pipeline in one conversation. Each user message gives you your role for that step and its task. Follow the latest role only.');
  assert.equal(SHARED_ROLE_HEADING, '## Your role for this step\n\n');
});

test('a shared turn: the member\'s own spawn, its role in the user turn, the conversation resumed from the second turn', async () => {
  const port = fakePort({ mock: false });
  const snaps = [];
  port.saveSnapshot = (sid, s) => snaps.push([port.booked.length, s.hostSessionId]);
  const { transport, calls } = sharedTransport((h, i) => turnEvents({ usd: [0.4, 0.9][i] }).map((e) => (e.type === 'result' && i === 1 ? { ...e, durationMs: 4200 } : e)));
  const host = sharedHost(port, transport);
  const ev = [];
  let bookedAtResult = null;
  const first = memberOpts(ev, { onEvent: (e) => { if (e.type === 'result') bookedAtResult = port.booked.length; ev.push(e); } });
  assert.deepEqual(await host.run(first, member('n_a')), { text: 'R0', exitCode: 0 });
  assert.deepEqual(await host.run(memberOpts(), member('n_b')), { text: 'R1', exitCode: 0 });
  assert.deepEqual(calls.map((h) => [h.systemPrompt, h.prompt, h.resumeSessionId, h.shared, h.model, h.allowedTools]),
    [[SHARED_SESSION_PREAMBLE, ROLE, undefined, true, M, ['Read']], [SHARED_SESSION_PREAMBLE, ROLE, 'C1', true, M, ['Read']]]);
  assert.ok(calls.every((h) => !['agents', 'maxTurns', 'agentsViaFile', 'forwardSubagentText', 'maxBudgetUsd'].some((k) => k in h)), 'no Agent call, no host flags');
  assert.ok(calls.every((h) => h.signal instanceof AbortSignal && h.onEvent !== first.onEvent), 'the host listens and can cut the turn');
  assert.deepEqual(kinds(port), ['open', 'mode', 'turn_start', 'dispatch', 'turn_end', 'cost', 'reconcile', 'turn_start', 'dispatch', 'turn_end', 'cost', 'reconcile']);
  const recs = (k) => port.records.filter((r) => r.kind === k);
  assert.deepEqual(recs('turn_start').map((r) => pick(r, ['turnId', 'resume', 'maxTurns', 'maxBudgetUsd', 'hostModel', 'hostEffort', 'hostSessionId'])), [
    { turnId: `t:${SID}:1`, resume: false, maxTurns: null, maxBudgetUsd: null, hostModel: null, hostEffort: null, hostSessionId: null },
    { turnId: `t:${SID}:2`, resume: true, maxTurns: null, maxBudgetUsd: null, hostModel: null, hostEffort: null, hostSessionId: 'C1' }]);
  assert.deepEqual(recs('dispatch').map((r) => pick(r, ['dispatchId', 'executionId', 'nodeId', 'attempt', 'agentType', 'cold'])), [
    { dispatchId: 'd:x:n_a:1:a1', executionId: 'x:n_a:1', nodeId: 'n_a', attempt: 1, agentType: null, cold: false },
    { dispatchId: 'd:x:n_b:1:a1', executionId: 'x:n_b:1', nodeId: 'n_b', attempt: 1, agentType: null, cold: false }]);
  assert.deepEqual(recs('turn_end').map((r) => pick(r, ['cumulativeUsd', 'hostUsage', 'hostModel', 'numTurns', 'exit', 'subtype', 'hostSessionId'])), [
    { cumulativeUsd: 0.4, hostUsage: { in: 0, out: 0, cr: 0, cw: 0 }, hostModel: null, numTurns: 3, exit: 'ok', subtype: 'success', hostSessionId: 'C1' },
    { cumulativeUsd: 0.9, hostUsage: { in: 0, out: 0, cr: 0, cw: 0 }, hostModel: null, numTurns: 3, exit: 'ok', subtype: 'success', hostSessionId: 'C1' }]);
  assert.deepEqual(recs('turn_end').map((r) => r.deltaUsd), [0.4, 0.5]);
  assert.equal(recs('turn_end')[1].durationMs, 4200, 'the result\'s own duration, else the wall time');
  assert.equal(typeof recs('turn_end')[0].durationMs, 'number');
  assert.deepEqual(recs('cost').map((r) => pick(r, ['executionId', 'memberUsd', 'hostOverheadUsd', 'costSource'])), [
    { executionId: 'x:n_a:1', memberUsd: 0.4, hostOverheadUsd: 0, costSource: 'harness' }, { executionId: 'x:n_b:1', memberUsd: 0.5, hostOverheadUsd: 0, costSource: 'harness' }]);
  assert.deepEqual(port.booked[0], { sid: SID, hostEpoch: 1, hostSessionId: 'C1', turnId: `t:${SID}:1`, dispatchId: 'd:x:n_a:1:a1', stepKey: 'x:n_a:1',
    nodeId: 'n_a', shared: true, cumulativeUsd: 0.4, carried: null, hostUsage: null, hostModel: null, memberUsage: { ...U }, memberModel: M, investigators: [], hookUsd: null });
  // The member's row gets every frame as it comes, the result last, after its booking, marked booked.
  assert.deepEqual(ev.map((e) => e.type), ['session', 'session', 'usage', 'usage', 'text', 'result']);
  assert.deepEqual([ev.at(-1).sessionBooked, ev.at(-1).text, ev.at(-1).numTurns, ev.at(-1).usage, bookedAtResult], [true, 'REPORT', 3, { ...U }, 1]);
  assert.deepEqual(['costUsd' in ev.at(-1), 'cumulativeCost' in ev.at(-1)], [false, false], 'the conversation\'s running total is no step\'s figure');
  // C43: the conversation's id is on the row and in the snapshot before the turn can be cut, then the full ref after its booking.
  assert.deepEqual(port.stamped.slice(0, 2), [
    { stepKey: 'x:n_a:1', ref: { sid: SID, hostEpoch: 1, hostSessionId: 'C1', turnId: `t:${SID}:1`, dispatchId: 'd:x:n_a:1:a1', attempt: 1, memberAgentId: null } },
    { stepKey: 'x:n_a:1', ref: { sid: SID, hostEpoch: 1, hostSessionId: 'C1', turnId: `t:${SID}:1`, dispatchId: 'd:x:n_a:1:a1', attempt: 1, memberAgentId: null,
      memberTranscriptId: null, costSource: 'harness' } }]);
  assert.deepEqual(port.stamped.map((s) => s.stepKey), ['x:n_a:1', 'x:n_a:1', 'x:n_b:1', 'x:n_b:1'], 'every turn: at its session, then at its booking');
  assert.deepEqual(snaps, [[0, 'C1'], [1, 'C1'], [2, 'C1']], 'saved at adoption (before any booking), then after each booking');
  assert.deepEqual([host.hostSessionId, host.lastCumulativeUsd, host.tokens], ['C1', 0.9, { in: 10000, out: 1400, cr: 0, cw: 0 }]);
  assert.deepEqual(port.summary.mode, 'shared');
});

test('a resumed turn that reports another conversation id is adopted; the next turn resumes it', async () => {
  const port = fakePort({ mock: false });
  const { transport, calls } = sharedTransport((h, i) => turnEvents({ id: ['C1', 'C2', 'C2'][i], usd: [0.1, 0.3, 0.6][i] }));
  const host = sharedHost(port, transport);
  for (const n of ['n_a', 'n_b', 'n_a']) await host.run(memberOpts(), member(n, n === 'n_a' && calls.length ? 2 : 1));
  assert.deepEqual(calls.map((h) => h.resumeSessionId), [undefined, 'C1', 'C2']);
  assert.deepEqual(port.stamped.filter((_, i) => i % 2 === 0).map((s) => s.ref.hostSessionId), ['C1', 'C2', 'C2']);
});

test('turnUsd: an engine whose result is the turn\'s own cost books that figure; the epoch check sums the turns', async () => {
  const port = fakePort({ mock: false, engine: 'codex' });
  const { transport } = sharedTransport((h, i) => codexTurn({ usd: [0.3, 0.2][i] }));
  const host = sharedHost(port, transport);
  await host.run(memberOpts(), member('n_a'));
  await host.run(memberOpts(), member('n_b'));
  assert.deepEqual(port.booked.map((b) => [b.turnUsd, 'cumulativeUsd' in b, 'carried' in b, b.memberUsage]), [[0.3, false, false, CU], [0.2, false, false, CU]]);
  assert.deepEqual(port.records.filter((r) => r.kind === 'turn_end').map((r) => [r.cumulativeUsd, r.deltaUsd]), [[null, 0.3], [null, 0.2]]);
  near(host.lastCumulativeUsd, 0.5);
  await host.close('done');
  const close = port.records.at(-1);
  assert.equal(close.kind, 'close');
  assert.deepEqual([close.reconciled, close.epochChecks.length, close.epochChecks[0].ok], [true, 1, true]);
  near(close.epochChecks[0].harnessTotalUsd, 0.5);
});

test('a result without its figure on Claude Code is held: the next running total carries it back to its own row (C9)', async () => {
  const port = fakePort({ mock: false });
  const { transport } = sharedTransport((h, i) => turnEvents({ usd: [null, 0.9][i] }));
  const host = sharedHost(port, transport);
  await host.run(memberOpts(), member('n_a'));
  assert.equal(port.booked.length, 0);
  assert.deepEqual([host.lastCumulativeUsd, host.snapshot().lastCumulativeUsd], [0, 0], 'no figure moves no running total');
  const cutUsd = turnPrice();
  assert.deepEqual(pick(host.openCut, ['turnId', 'executionId', 'nodeId', 'cutTokens']), { turnId: `t:${SID}:1`, executionId: 'x:n_a:1', nodeId: 'n_a',
    cutTokens: { in: 5000, out: 700, cr: 0, cw: 0 } });
  near(host.openCut.cutUsd, cutUsd);
  near(host.openCut.cutListUsd, turnPrice({ ratesFor: listCostRates }));
  await host.run(memberOpts(), member('n_b'));
  assert.equal(port.booked[0].carried.parts[0].turnId, `t:${SID}:1`);
  const costs = port.records.filter((r) => r.kind === 'cost');
  assert.deepEqual(costs.map((r) => [r.executionId, r.carriedBy ?? null]), [['x:n_a:1', `t:${SID}:2`], ['x:n_b:1', null]]);
  near(costs[0].memberUsd + costs[1].memberUsd, 0.9);
  assert.equal(host.openCut, null);
});

test('no figure where none follows: a turn-cost engine books the turn\'s usage as an estimate now; Copilot books nothing (C24)', async () => {
  const codex = fakePort({ mock: false, engine: 'codex' });
  const a = sharedHost(codex, sharedTransport(() => codexTurn()).transport);
  await a.run(memberOpts(), member('n_a'));
  near(codex.booked[0].cutEstimateUsd, priceUsage(M, CU), 'its result\'s usage (Codex reports no message usage)');
  assert.deepEqual(pick(codex.records.find((r) => r.kind === 'cost'), ['executionId', 'costSource', 'cut']), { executionId: 'x:n_a:1', costSource: 'estimate', cut: true });
  assert.equal(a.openCut, null);
  const copilot = fakePort({ mock: false, engine: 'copilot', engineCost: false });
  const b = sharedHost(copilot, sharedTransport(() => turnEvents({ usd: null })).transport);
  await b.run(memberOpts(), member('n_a'));
  assert.equal(copilot.booked.length, 1);
  assert.ok(Number.isNaN(copilot.booked[0].turnUsd));
  assert.deepEqual(pick(copilot.records.find((r) => r.kind === 'cost'), ['costSource', 'memberUsd', 'hostOverheadUsd']), { costSource: 'none', memberUsd: null, hostOverheadUsd: null });
  assert.equal(b.openCut, null);
});

test('Stop mid-turn: the AbortError, the turn held as a cut from its usage, booked as an estimate when the host closes', async () => {
  const port = fakePort({ mock: false });
  const { transport } = sharedTransport(() => turnEvents({ usd: 0.4 }).slice(0, 3), { hang: () => true });
  const host = sharedHost(port, transport);
  const ac = new AbortController();
  const p = host.run(memberOpts([], { signal: ac.signal }), member('n_a'));
  const settled = assert.rejects(p, { name: 'AbortError' });
  await tick();
  ac.abort();
  await settled;
  assert.equal(port.booked.length, 0);
  assert.deepEqual(port.records.filter((r) => r.kind === 'turn_end').map((r) => [r.exit, r.deltaUsd, r.cumulativeUsd, r.numTurns, r.subtype]), [['aborted', null, null, null, null]]);
  assert.ok(host.activeMs > 0, 'the cut turn\'s time counts');
  assert.deepEqual(port.stamped.map((s) => [s.ref.hostSessionId, 'costSource' in s.ref ? s.ref.costSource : 'partial']), [['C1', 'partial'], ['C1', null]]);
  near(host.openCut.cutUsd, priceUsage(M, U));
  await host.close('stopped');
  near(port.booked[0].cutEstimateUsd, priceUsage(M, U));
  assert.deepEqual(pick(port.records.find((r) => r.kind === 'cost'), ['executionId', 'cut', 'costSource']), { executionId: 'x:n_a:1', cut: true, costSource: 'estimate' });
});

test('a pause closes the host mid-turn: the PauseError, a `pause` record naming the cut, the cut and the id kept for the resume', async () => {
  const port = fakePort({ mock: false });
  const { transport } = sharedTransport(() => turnEvents().slice(0, 3), { hang: () => true });
  const host = sharedHost(port, transport);
  const p = host.run(memberOpts(), member('n_a'));
  const settled = assert.rejects(p, { name: 'PauseError' });
  await tick();
  await host.close('paused');
  await settled;
  const pause = port.records.at(-1);
  assert.deepEqual([pause.kind, pause.turnId, pause.cutTokens], ['pause', `t:${SID}:1`, { in: 5000, out: 700, cr: 0, cw: 0 }]);
  assert.deepEqual([host.snapshot().hostSessionId, host.snapshot().openCut.executionId], ['C1', 'x:n_a:1']);
  assert.equal(port.booked.length, 0);
});

test('a failure after the result: the turn is booked, then the runner\'s error goes on unchanged (C20, C41)', async () => {
  const port = fakePort({ mock: false });
  const boom = Object.assign(new Error('API Error: 529 overloaded'), { errorClass: 'rate_limit', stream: 'x' });
  const ev = [];
  const host = sharedHost(port, sharedTransport(() => turnEvents({ usd: 0.4 }), { fail: () => boom }).transport);
  await assert.rejects(host.run(memberOpts(ev), member('n_a')), (e) => e === boom);
  assert.equal(port.booked.length, 1);
  assert.deepEqual(port.records.filter((r) => r.kind === 'turn_end').map((r) => r.exit), ['error']);
  assert.equal(ev.at(-1).sessionBooked, true, 'its text still reaches the log');
});

test('a lost conversation (C20): one restart on a new conversation, a fresh attempt; never on a first turn or after the conversation answered', async () => {
  const lost = (id) => new Error(`No conversation found with session ID: ${id}`);
  const port = fakePort({ mock: false });
  const { transport, calls } = sharedTransport((h, i) => (i === 1 ? [] : turnEvents({ id: ['C1', null, 'C2'][i], usd: [0.4, null, 0.3][i] })),
    { fail: (i) => (i === 1 ? lost('C1') : null) });
  const host = sharedHost(port, transport);
  await host.run(memberOpts(), member('n_a'));
  assert.deepEqual(await host.run(memberOpts(), member('n_b')), { text: 'R2', exitCode: 0 });
  assert.deepEqual(calls.map((h) => h.resumeSessionId), [undefined, 'C1', undefined]);
  const restart = port.records.find((r) => r.kind === 'restart');
  assert.deepEqual(pick(restart, ['reason', 'fromSessionId']), { reason: 'vanished', fromSessionId: 'C1' });
  assert.deepEqual(port.records.filter((r) => r.kind === 'dispatch' && r.executionId === 'x:n_b:1').map((r) => [r.attempt, r.hostEpoch]), [[1, 1], [2, 2]]);
  assert.equal(host.hostSessionId, 'C2');
  // Only in a log line (the runner's plain output) still counts, as before init.
  const p2 = fakePort({ mock: false });
  const said = sharedTransport((h, i) => (i === 1 ? [{ type: 'log', text: 'No conversation found with session ID: C1' }] : turnEvents({ usd: 0.1 })),
    { fail: (i) => (i === 1 ? new Error('claude exited with code 1') : null) });
  const h2 = sharedHost(p2, said.transport);
  await h2.run(memberOpts(), member('n_a'));
  await h2.run(memberOpts(), member('n_b'));
  assert.equal(said.calls.length, 3);
  // Not lost: a first turn (no --resume), and a turn whose conversation already answered.
  for (const [play, n] of [[() => [], 0], [(h, i) => (i === 0 ? turnEvents({ usd: 0.1 }) : turnEvents({ usd: 0.2 }).slice(0, 2)), 1]]) {
    const p3 = fakePort({ mock: false });
    const err = lost('C1');
    const t = sharedTransport(play, { fail: (i) => (i === n ? err : null) });
    const h3 = sharedHost(p3, t.transport);
    if (n === 1) await h3.run(memberOpts(), member('n_a'));
    await assert.rejects(h3.run(memberOpts(), member('n_b')), (e) => e === err);
    assert.equal(p3.records.some((r) => r.kind === 'restart'), false);
    assert.equal(t.calls.length, n + 1);
  }
});

test('one conversation never rotates: neither the dispatch count nor the context starts a new one', async () => {
  const port = fakePort({ mock: false });
  const { transport, calls } = sharedTransport((h, i) => turnEvents({ usd: 0.1 * (i + 1) }));
  const host = sharedHost(port, transport, { rotateDispatches: 1, rotateContextTokens: 1 });
  for (const n of ['n_a', 'n_b', 'n_a']) await host.run(memberOpts(), member(n, calls.length + 1));
  assert.deepEqual(calls.map((h) => h.resumeSessionId), [undefined, 'C1', 'C1']);
  assert.equal(port.records.some((r) => r.kind === 'rotate'), false);
  assert.equal(host.hostEpoch, 1);
});

test('the real transport: a shared turn is the member\'s own spawn, its events normalized (never the raw frames the demux reads)',
  { skip: process.platform === 'win32' ? 'fake claude is a POSIX shell script' : false }, async () => {
    const prev = { WORCA_MOCK: process.env.WORCA_MOCK, ORCH_MOCK: process.env.ORCH_MOCK };
    delete process.env.WORCA_MOCK;
    delete process.env.ORCH_MOCK;
    try {
      const dir = await mkdtemp(join(tmpdir(), 'worca-shared-real-'));
      const bin = join(dir, 'fake-claude.sh');
      const frames = [{ type: 'system', subtype: 'init', session_id: 'S1', model: M },
        { type: 'assistant', message: { id: 'a1', role: 'assistant', model: M, content: [{ type: 'text', text: 'hi' }], usage: { ...U } } },
        { type: 'result', subtype: 'success', is_error: false, session_id: 'S1', result: 'DONE', total_cost_usd: 0.25, usage: { ...U } }];
      await writeFile(bin, `#!/bin/sh\n${frames.map((f) => `printf '%s\\n' '${JSON.stringify(f)}'`).join('\n')}\nexit 0\n`, 'utf8');
      await chmod(bin, 0o755);
      const port = fakePort({ mock: false });
      const host = createSessionHosts({ specs: [spec(['n_a', 'n_b'], { mode: 'shared' })], decisions: decisions('shared', { requested: 'shared' }), port }).hosts.get(SID);
      const ev = [];
      const out = await host.run({ bin, cwd: dir, systemPrompt: 'SYS', prompt: 'TASK', permissionMode: 'acceptEdits', signal: new AbortController().signal,
        onEvent: (e) => ev.push(e) }, member('n_a'));
      assert.equal(out.text, 'DONE');
      assert.ok(ev.every((e) => !['system', 'assistant', 'user'].includes(e.type)), JSON.stringify(ev.map((e) => e.type)));
      assert.deepEqual(pick(ev.at(-1), ['type', 'text', 'costUsd', 'cumulativeCost', 'sessionBooked']), { type: 'result', text: 'DONE', costUsd: undefined, cumulativeCost: undefined, sessionBooked: true });
      assert.deepEqual(pick(port.booked[0], ['hostSessionId', 'cumulativeUsd', 'shared']), { hostSessionId: 'S1', cumulativeUsd: 0.25, shared: true });
      // A sub-agent host turn on the same transport still gets the raw frames its demux reads.
      const raw = [];
      await defaultTransport({ bin, cwd: dir, systemPrompt: 'S', prompt: 'P', permissionMode: 'acceptEdits', onEvent: (e) => raw.push(e) });
      assert.ok(raw.some((e) => e.type === 'system' && e.raw?.subtype === 'init'), JSON.stringify(raw.map((e) => e.type)));
    } finally {
      for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });

// ── v2: rows the mutation sweep asked for ──
test('v2 — the turn\'s records follow the member: no node id, a cold turn (a re-attached step, a cold re-dispatch), the verdict, the counters', async () => {
  const port = fakePort({ mock: false });
  const { transport } = sharedTransport((h, i) => turnEvents({ usd: 0.1 * (i + 1) }));
  const host = sharedHost(port, transport);
  await host.run(memberOpts(), { executionId: 'x:n_a:1' });
  await host.run(memberOpts([], { resumeSessionId: 'own' }), member('n_b'));
  await host.run(memberOpts([], { coldRedispatch: true }), member('n_a', 2));
  assert.deepEqual(port.records.filter((r) => r.kind === 'dispatch').map((r) => [r.nodeId, r.cold]), [[null, false], ['n_b', true], ['n_a', true]]);
  assert.equal(port.records.find((r) => r.kind === 'cost').nodeId, null);
  host.noteVerdict('x:n_b:1', { verdict: 'blocking', issues: [{}, {}] });
  assert.deepEqual(pick(port.records.at(-1), ['kind', 'dispatchId', 'executionId', 'nodeId', 'verdict', 'issues']),
    { kind: 'verdict', dispatchId: 'd:x:n_b:1:a1', executionId: 'x:n_b:1', nodeId: 'n_b', verdict: 'blocking', issues: 2 });
  assert.deepEqual([host.snapshot().dispatches, host.snapshot().turns, host.snapshot().epochDispatches], [3, 3, 3]);
  await host.close('done');
  assert.deepEqual(pick(port.records.at(-1), ['kind', 'turns', 'dispatches']), { kind: 'close', turns: 3, dispatches: 3 });
});

test('v2 — what the turn listens to: junk reaches nobody, only a real id is adopted, its messages and its investigators\' price a cut', async () => {
  const port = fakePort({ mock: false });
  const { transport } = sharedTransport(() => [null, 'x', { type: 'session', sessionId: '' }, { type: 'session', sessionId: 7 }, ...turnEvents().slice(0, 4),
    { type: 'usage', phase: 'start', parentId: null, messageId: 'm2', usage: { input_tokens: 999 } }, { type: 'usage', phase: 'message', parentId: null, messageId: 'm3' },
    { type: 'usage', phase: 'message', parentId: null, messageId: null, total: true, usage: { input_tokens: 5e6 } }],
  { hang: () => true });
  const host = sharedHost(port, transport);
  const ev = [];
  const ac = new AbortController();
  const settled = assert.rejects(host.run(memberOpts(ev, { signal: ac.signal }), member('n_a')), { name: 'AbortError' });
  await tick();
  ac.abort();
  await settled;
  assert.deepEqual(ev.map((e) => e.type), ['session', 'session', 'session', 'session', 'usage', 'usage', 'usage', 'usage', 'usage'], 'every event object reaches the row; junk does not');
  assert.deepEqual([host.hostSessionId, port.stamped.map((x) => x.ref.hostSessionId)], ['C1', ['C1', 'C1']]);
  near(host.openCut.cutUsd, turnPrice(), 'its own messages and its investigator\'s (C33); not a stream start, not a session\'s sum');
  assert.deepEqual(host.openCut.cutTokens, { in: 5000, out: 700, cr: 0, cw: 0 });
});

test('v2 — the test seams start empty', async () => {
  const fresh = await import(new URL('../src/core/session-host.mjs?seams', import.meta.url).href);
  assert.deepEqual(fresh._testing, { onDefinitions: null, onSharedTurn: null });
});

test('v2 — a lost conversation\'s retry is a cold turn on attempt 2', async () => {
  const port = fakePort({ mock: false });
  const { transport } = sharedTransport((h, i) => (i === 1 ? [] : turnEvents({ id: ['C1', null, 'C2'][i], usd: 0.1 })),
    { fail: (i) => (i === 1 ? new Error('No conversation found with session ID: C1') : null) });
  const host = sharedHost(port, transport);
  await host.run(memberOpts(), member('n_a'));
  await host.run(memberOpts(), member('n_b'));
  assert.deepEqual(port.records.filter((r) => r.kind === 'dispatch').map((r) => [r.executionId, r.attempt, r.cold]),
    [['x:n_a:1', 1, false], ['x:n_b:1', 1, false], ['x:n_b:1', 2, true]]);
});

test('v2 — a member that pins no model is priced at the model its own messages name; only a string names one', async () => {
  const port = fakePort({ mock: false });
  const ev = turnEvents({ usd: 0.4 });
  ev.splice(4, 0, { type: 'usage', phase: 'message', parentId: null, messageId: 'm5', model: '', usage: { input_tokens: 0 } },
    { type: 'usage', phase: 'message', parentId: null, messageId: 'm6', model: 7, usage: { input_tokens: 0 } });
  const host = sharedHost(port, sharedTransport(() => ev).transport);
  await host.run(memberOpts([], { model: undefined }), member('n_a'));
  assert.equal(port.booked[0].memberModel, M);
  const own = fakePort({ mock: false });
  await sharedHost(own, sharedTransport(() => turnEvents({ usd: 0.4 })).transport).run(memberOpts([], { model: 'claude-haiku-4-5' }), member('n_a'));
  assert.equal(own.booked[0].memberModel, 'claude-haiku-4-5', 'its own model first');
});

test('v2 — only the runner\'s plain lines say a conversation is lost, and only the first 20 of them', async () => {
  const lost = 'No conversation found with session ID: C1';
  const cases = [
    [Array.from({ length: 20 }, (_, i) => ({ type: 'log', text: `line ${i}` })).concat({ type: 'log', text: lost }), false, 'the 21st line is past the cap'],
    [[{ type: 'text', text: lost, parentId: null, from: 'assistant' }], false, 'the model\'s own words are no runner line'],
    [Array.from({ length: 19 }, (_, i) => ({ type: 'log', text: `line ${i}` })).concat({ type: 'log', text: lost }), true, 'the 20th line counts'],
  ];
  for (const [said, restarts, why] of cases) {
    const port = fakePort({ mock: false });
    const err = new Error('claude exited with code 1');
    const t = sharedTransport((h, i) => (i === 1 ? said : turnEvents({ usd: 0.1 })), { fail: (i) => (i === 1 ? err : null) });
    const host = sharedHost(port, t.transport);
    await host.run(memberOpts(), member('n_a'));
    if (restarts) await host.run(memberOpts(), member('n_b'));
    else await assert.rejects(host.run(memberOpts(), member('n_b')), (e) => e === err);
    assert.equal(port.records.some((r) => r.kind === 'restart'), restarts, why);
  }
});

test('v2 — a $0 figure is a figure, on both kinds of engine; with no model anywhere the member\'s model is null', async () => {
  for (const [engine, play, key] of [['claude', () => turnEvents({ usd: 0 }), 'cumulativeUsd'], ['codex', () => codexTurn({ usd: 0 }), 'turnUsd']]) {
    const port = fakePort({ mock: false, engine });
    await sharedHost(port, sharedTransport(play).transport).run(memberOpts(), member('n_a'));
    assert.equal(port.booked[0][key], 0, engine);
    assert.equal(port.records.find((r) => r.kind === 'turn_end').deltaUsd, 0, engine);
    assert.deepEqual(pick(port.records.find((r) => r.kind === 'cost'), ['memberUsd', 'costSource']), { memberUsd: 0, costSource: 'harness' }, engine);
  }
  const port = fakePort({ mock: false });
  const bare = turnEvents({ usd: 0.1 }).map((e) => { const x = { ...e }; delete x.model; return x; });
  await sharedHost(port, sharedTransport(() => bare).transport).run(memberOpts([], { model: undefined }), member('n_a'));
  assert.equal(port.booked[0].memberModel, null);
});

test('v2 — a stopped turn rejects as an AbortError: the runner\'s own, as it is, or a fresh one for whatever else it threw when killed', async () => {
  for (const [thrown, same] of [[abortErr(), true], [Object.assign(new Error('claude exited with code 143'), { errorClass: 'unknown' }), false]]) {
    const port = fakePort({ mock: false });
    const transport = (h) => new Promise((_, reject) => { h.onEvent(turnEvents()[0]); h.signal.addEventListener('abort', () => reject(thrown), { once: true }); });
    const host = sharedHost(port, transport);
    const ac = new AbortController();
    const settled = assert.rejects(host.run(memberOpts([], { signal: ac.signal }), member('n_a')), (e) => e.name === 'AbortError' && (e === thrown) === same);
    await tick();
    ac.abort();
    await settled;
  }
});

// ── v3: what the refine's cycle-2 review found (Goose's running total, each engine's lost conversation, an id named
// mid-turn); the override pricing is in test/session-harness-booking.test.mjs ──
test('v3 — Goose reports the session\'s running total: its Δ is booked; its session-sum usage is no turn\'s', async () => {
  const port = fakePort({ mock: false, engine: 'goose' });
  const sum = (i) => ({ input_tokens: 1000 * (i + 1), output_tokens: 10 });
  const { transport } = sharedTransport((h, i) => [{ type: 'session', sessionId: 'goose:C1', model: M, init: true },
    { type: 'usage', phase: 'message', parentId: null, messageId: null, model: M, usage: sum(i), total: true },
    { type: 'result', text: 'R', isError: false, sessionId: 'goose:C1', usage: sum(i), costUsd: [0.3, 0.5][i] }]);
  const host = sharedHost(port, transport);
  await host.run(memberOpts(), member('n_a'));
  await host.run(memberOpts(), member('n_b'));
  assert.deepEqual(port.booked.map((b) => [b.cumulativeUsd, Object.hasOwn(b, 'turnUsd'), b.memberUsage]), [[0.3, false, null], [0.5, false, null]]);
  const ends = port.records.filter((r) => r.kind === 'turn_end');
  assert.deepEqual(ends.map((r) => r.cumulativeUsd), [0.3, 0.5]);
  near(ends[1].deltaUsd, 0.2, 'the second turn books what it added, not the session\'s sum');
  assert.deepEqual(host.tokens, { in: 0, out: 0, cr: 0, cw: 0 }, 'a session\'s sum is no turn\'s tokens');
  near(host.lastCumulativeUsd, 0.5);
});

test('v3 — a lost conversation in each engine\'s own words (C20); a name given before the CLI answered is no answer', async () => {
  const cases = [
    ['codex', [], 'codex: no rollout found for thread id C1'],
    ['copilot', [{ type: 'session', sessionId: 'C1' }], 'copilot: No session, task, or name matched \'C1\''],   // named before it spawns
    ['claude', [{ type: 'stderr', stream: 'err', text: 'No conversation found with session ID: C1' }], 'claude exited with code 1'],
  ];
  for (const [engine, before, msg] of cases) {
    const port = fakePort({ mock: false, engine });
    // Codex's turns as its adapter gives them (its ids `codex:<thread>`), the others' as before.
    const play = engine === 'codex' ? (id) => codexTurn({ thread: id, usd: 0.1 }) : (id) => turnEvents({ id, usd: 0.1 });
    const id = (x) => (engine === 'codex' ? `codex:${x}` : x);
    const { transport, calls } = sharedTransport((h, i) => (i === 1 ? before : play(['C1', null, 'C2'][i])),
      { fail: (i) => (i === 1 ? new Error(msg) : null) });
    const host = sharedHost(port, transport);
    await host.run(memberOpts(), member('n_a'));
    assert.deepEqual(await host.run(memberOpts(), member('n_b')), { text: 'R2', exitCode: 0 }, engine);
    assert.deepEqual(calls.map((h) => h.resumeSessionId), [undefined, id('C1'), undefined], engine);
    assert.equal(port.records.filter((r) => r.kind === 'restart').length, 1, engine);
  }
  // Answered first (its init, or the model's own words), it is the runner's failure, unchanged.
  for (const said of [codexTurn({ thread: 'C1' }).slice(0, 1), codexTurn({ thread: 'C1' }).slice(1, 2)]) {
    const port = fakePort({ mock: false, engine: 'codex' });
    const err = new Error('codex: no rollout found for thread id C1');
    const t = sharedTransport((h, i) => (i === 1 ? said : codexTurn({ thread: 'C1', usd: 0.1 })), { fail: (i) => (i === 1 ? err : null) });
    const host = sharedHost(port, t.transport);
    await host.run(memberOpts(), member('n_a'));
    await assert.rejects(host.run(memberOpts(), member('n_b')), (e) => e === err);
    assert.equal(port.records.some((r) => r.kind === 'restart'), false, said[0].type);
  }
});

test('v3 — an engine that names another conversation mid-turn (its own fresh start after a failed resume) is followed', async () => {
  const port = fakePort({ mock: false, engine: 'gemini' });
  const snaps = [];
  port.saveSnapshot = (sid, snap) => snaps.push(snap.hostSessionId);
  const { transport, calls } = sharedTransport((h, i) => (i === 1
    ? [{ type: 'session', sessionId: 'C1' }, { type: 'session', sessionId: 'C2', init: true }, { type: 'result', text: 'R', isError: false, sessionId: 'C2' }]
    : [{ type: 'session', sessionId: i ? 'C2' : 'C1', init: true }, { type: 'result', text: 'R', isError: false }]));
  const host = sharedHost(port, transport);
  for (const [n, k] of [['n_a', 1], ['n_b', 1], ['n_a', 2]]) await host.run(memberOpts(), member(n, k));
  assert.deepEqual(calls.map((h) => h.resumeSessionId), [undefined, 'C1', 'C2'], 'the next turn resumes the conversation that answered');
  assert.deepEqual(port.stamped.map((x) => x.ref.hostSessionId), ['C1', 'C1', 'C1', 'C2', 'C2', 'C2', 'C2']);
  assert.deepEqual(snaps, ['C1', 'C1', 'C2', 'C2', 'C2'], 'saved the moment it changes, then after each turn');
  assert.equal(host.hostSessionId, 'C2');
});

test('v4 — Claude Code answers a lost conversation with a result of its own (the captured frame): one restart; nothing of it is booked, a held cut is booked at the restart (C20, C9)', async () => {
  // test/fixtures/ask/bogus-resume.jsonl: `--resume` of a conversation that is gone gives one result frame (no init, no
  // turn, $0, the loss in `errors`), then the CLI exits 1. Here only the frame says why: the runner's error does not.
  const line = readFileSync(new URL('./fixtures/ask/bogus-resume.jsonl', import.meta.url), 'utf8').split('\n')[0];
  const lostResult = createClaudeNormalizer()({ type: 'result', raw: JSON.parse(line.replaceAll('00000000-0000-0000-0000-000000000000', 'C1')) });
  assert.deepEqual(pick(lostResult[0], ['type', 'isError', 'numTurns', 'costUsd', 'sessionId']), { type: 'result', isError: true, numTurns: 0, costUsd: 0, sessionId: 'C1' });
  const port = fakePort({ mock: false });
  const ev = [];
  const { transport, calls } = sharedTransport((h, i) => [turnEvents({ usd: 0.4 }), turnEvents({ usd: 0.9 }).slice(0, 3), lostResult, turnEvents({ id: 'C2', usd: 0.3 })][i],
    { hang: (i) => i === 1, fail: (i) => (i === 2 ? new Error('claude exited with code 1') : null) });
  const host = sharedHost(port, transport);
  await host.run(memberOpts(), member('n_a'));
  const ac = new AbortController();
  const stopped = assert.rejects(host.run(memberOpts([], { signal: ac.signal }), member('n_b')), { name: 'AbortError' });
  await tick();
  ac.abort();
  await stopped;
  near(host.openCut.cutUsd, priceUsage(M, U), 'the stopped turn is held for the next running total');
  assert.deepEqual(await host.run(memberOpts(ev), member('n_b', 2)), { text: 'R3', exitCode: 0 });
  assert.deepEqual(calls.map((h) => h.resumeSessionId), [undefined, 'C1', 'C1', undefined]);
  assert.deepEqual(pick(port.records.find((r) => r.kind === 'restart'), ['reason', 'fromSessionId']), { reason: 'vanished', fromSessionId: 'C1' });
  assert.deepEqual(port.booked.map((b) => [b.stepKey, b.cumulativeUsd ?? null, Number.isFinite(b.cutEstimateUsd)]),
    [['x:n_a:1', 0.4, false], ['x:n_b:1', null, true], ['x:n_b:2', 0.3, false]], 'the lost conversation\'s $0 is never booked');
  near(port.booked[1].cutEstimateUsd, priceUsage(M, U), 'the held cut, booked at the restart: the new conversation never holds it');
  assert.equal(port.records.filter((r) => r.kind === 'cost' && r.carriedBy).length, 0);
  assert.deepEqual(port.records.filter((r) => r.kind === 'turn_end').map((r) => [r.exit, r.numTurns]), [['ok', 3], ['aborted', null], ['error', null], ['ok', 3]]);
  assert.deepEqual(ev.filter((e) => e.type === 'result').map((e) => [e.sessionId, e.sessionBooked]), [['C2', true]], 'the dead conversation\'s result never reaches the row');
  assert.equal(host.hostSessionId, 'C2');
  // A result of a turn that ran is an answer, an error one too, and so is one that gives no count: the runner's failure
  // then goes on unchanged, whatever the lines say.
  for (const res of [{ type: 'result', isError: true, numTurns: 2, errors: ['No conversation found with session ID: C1'] }, { type: 'result', isError: false, text: 'R' }]) {
    const p = fakePort({ mock: false });
    const err = new Error('claude exited with code 1');
    const t = sharedTransport((h, i) => (i === 1 ? [{ type: 'stderr', stream: 'err', text: 'No conversation found with session ID: C1' }, res] : turnEvents({ usd: 0.1 })),
      { fail: (i) => (i === 1 ? err : null) });
    const h1 = sharedHost(p, t.transport);
    await h1.run(memberOpts(), member('n_a'));
    await assert.rejects(h1.run(memberOpts(), member('n_b')), (e) => e === err);
    assert.equal(p.records.some((r) => r.kind === 'restart'), false, JSON.stringify(res));
  }
});

test('v5 — a result of a turn that never ran is no turn\'s: never booked or handed on, a held cut kept (a refusal before the CLI starts; a lost conversation\'s result as the turn is stopped)', async () => {
  const noTurn = (errors) => ({ type: 'result', text: '', isError: true, subtype: 'error_during_execution', numTurns: 0, costUsd: 0, cumulativeCost: true, sessionId: 'C1', errors });
  // A refusal before the CLI starts (the sideload safety net runs it again): its error goes on unchanged, no restart.
  const port = fakePort({ mock: false });
  const ev = [];
  const refused = new Error('claude exited with code 1');
  const { transport, calls } = sharedTransport((h, i) => [turnEvents({ usd: 0.4 }), turnEvents({ usd: 0.9 }).slice(0, 3),
    [noTurn(['--plugin-dir is disabled by a managed setting'])], turnEvents({ usd: 1.3 })][i],
  { hang: (i) => i === 1, fail: (i) => (i === 2 ? refused : null) });
  const host = sharedHost(port, transport);
  await host.run(memberOpts(), member('n_a'));
  const ac = new AbortController();
  const stopped = assert.rejects(host.run(memberOpts([], { signal: ac.signal }), member('n_b')), { name: 'AbortError' });
  await tick();
  ac.abort();
  await stopped;
  const held = host.openCut.turnId;
  await assert.rejects(host.run(memberOpts(ev), member('n_b', 2)), (e) => e === refused);
  assert.deepEqual(port.booked.map((b) => b.cumulativeUsd), [0.4], 'its $0 is never booked: the baseline stays at the conversation\'s total');
  assert.deepEqual([host.openCut?.turnId, host.lastCumulativeUsd, host.hostSessionId], [held, 0.4, 'C1'], 'the held cut waits for a turn that ran');
  assert.deepEqual(ev.filter((e) => e.type === 'result'), [], 'nor handed on as the step\'s result');
  assert.equal(port.records.some((r) => r.kind === 'restart'), false);
  assert.deepEqual(port.records.filter((r) => r.kind === 'turn_end').map((r) => [r.exit, r.cumulativeUsd, r.numTurns]).at(-1), ['error', null, null]);
  await host.run(memberOpts(), member('n_b', 2));                        // the retry: the conversation's next running total
  assert.deepEqual(calls.map((h) => h.resumeSessionId), [undefined, 'C1', 'C1', 'C1']);
  assert.deepEqual(port.booked.map((b) => [b.cumulativeUsd, b.carried?.turnId ?? null]), [[0.4, null], [1.3, held]], 'Δ 0.9 from 0.4, the cut carried back');
  // Claude Code's answer to a lost conversation, when the turn is stopped before the CLI exits: no restart, no booking.
  const p2 = fakePort({ mock: false });
  const t2 = sharedTransport((h, i) => [turnEvents({ usd: 0.4 }), [noTurn(['No conversation found with session ID: C1'])]][i], { hang: (i) => i === 1 });
  const h2 = sharedHost(p2, t2.transport);
  await h2.run(memberOpts(), member('n_a'));
  const ac2 = new AbortController();
  const s2 = assert.rejects(h2.run(memberOpts([], { signal: ac2.signal }), member('n_b')), { name: 'AbortError' });
  await tick();
  ac2.abort();
  await s2;
  assert.deepEqual(p2.booked.map((b) => b.cumulativeUsd), [0.4]);
  assert.deepEqual([h2.lastCumulativeUsd, h2.openCut], [0.4, null]);
  // Even after the model spoke, such a result is no running total: the turn is a cut, priced from what it reported.
  const p3 = fakePort({ mock: false });
  const h3 = sharedHost(p3, sharedTransport((h, i) => [turnEvents({ usd: 0.4 }), [...turnEvents().slice(0, 3), noTurn([])]][i]).transport);
  await h3.run(memberOpts(), member('n_a'));
  await h3.run(memberOpts(), member('n_b'));
  assert.deepEqual([p3.booked.map((b) => b.cumulativeUsd), h3.lastCumulativeUsd, h3.openCut?.executionId], [[0.4], 0.4, 'x:n_b:1']);
});

test('v5 — a bridged member\'s turn its upstream priced: booked now for its bridge figure, never a cut held or booked beside it (C34)', async () => {
  const port = fakePort({ mock: false, bridgeUsd: (x) => (x.startsWith('x:n_a:') ? 0.02 : null) });   // n_a runs on a bridged model
  const { transport } = sharedTransport((h, i) => [turnEvents().slice(0, 3), turnEvents(), turnEvents({ usd: 0.05 })][i], { hang: (i) => i === 0 });
  const host = sharedHost(port, transport);
  const ac = new AbortController();
  const stopped = assert.rejects(host.run(memberOpts([], { signal: ac.signal }), member('n_a')), { name: 'AbortError' });
  await tick();
  ac.abort();
  await stopped;
  assert.equal(host.openCut, null);
  assert.deepEqual(port.booked.map((b) => [b.stepKey, b.shared, Number.isNaN(b.cumulativeUsd), b.carried, Object.hasOwn(b, 'cutEstimateUsd')]),
    [['x:n_a:1', true, true, null, false]], 'the booking takes the bridge\'s figure; the turn\'s Δ is none');
  await host.run(memberOpts(), member('n_a', 2));                        // a figure-less result of the same bridged member: booked, not held
  assert.deepEqual([port.booked.length, host.openCut], [2, null]);
  await host.run(memberOpts(), member('n_b'));
  await host.close('stopped');
  assert.deepEqual(port.booked.map((b) => [b.stepKey, b.carried ?? null]), [['x:n_a:1', null], ['x:n_a:2', null], ['x:n_b:1', null]], 'nothing booked at the close');
});

test('v4 — nothing priceable is no estimate: the turn books nothing and its row stays blank, never $0.00 (C24)', async () => {
  const X = 'acme/unpriced-1';                                          // no operator price, no list price
  // A result without its figure on a turn-cost engine, its usage at a model nothing prices: booked as it is (none).
  const codex = fakePort({ mock: false, engine: 'codex' });
  const a = sharedHost(codex, sharedTransport(() => codexTurn({ model: X })).transport);
  await a.run(memberOpts([], { model: X }), member('n_a'));
  assert.deepEqual(codex.booked.map((b) => [Object.hasOwn(b, 'cutEstimateUsd'), Number.isNaN(b.turnUsd)]), [[false, true]]);
  assert.deepEqual(pick(codex.records.find((r) => r.kind === 'cost'), ['costSource', 'memberUsd', 'cut']), { costSource: 'none', memberUsd: null, cut: undefined });
  // Goose: its only usage is the session's sum, which prices no turn; a result without its figure holds no $0 cut.
  const goose = fakePort({ mock: false, engine: 'goose' });
  const g = sharedHost(goose, sharedTransport(() => [{ type: 'session', sessionId: 'goose:C1', model: M, init: true },
    { type: 'usage', phase: 'message', parentId: null, messageId: null, model: M, usage: { ...U }, total: true },
    { type: 'result', text: 'R', isError: false, sessionId: 'goose:C1', usage: { ...U } }]).transport);
  await g.run(memberOpts(), member('n_a'));
  assert.equal(g.openCut, null, 'no $0 cut held for the next running total');
  assert.deepEqual(goose.booked.map((b) => [b.stepKey, Number.isNaN(b.cumulativeUsd)]), [['x:n_a:1', true]]);
  await g.close('done');
  assert.equal(goose.booked.length, 1, 'and none booked at the close');
  // Stopped before the model said a word (its init only): nothing to price, nothing held or booked.
  const claude = fakePort({ mock: false });
  const { transport } = sharedTransport(() => turnEvents({ usd: 0.4 }).slice(0, 2), { hang: () => true });
  const c = sharedHost(claude, transport);
  const ac = new AbortController();
  const stopped = assert.rejects(c.run(memberOpts([], { signal: ac.signal }), member('n_a')), { name: 'AbortError' });
  await tick();
  ac.abort();
  await stopped;
  assert.equal(c.openCut, null);
  await c.close('stopped');
  assert.deepEqual([claude.booked.length, claude.records.filter((r) => r.kind === 'cost').length], [0, 0]);
});

// ── impl review, cycle 1: only Claude Code's result counts its turns; Codex's error result is a turn's (codex.mjs) ──
test('a Codex turn that failed books the spend codex settled from its rollout, then its error goes on unchanged; the next turn and the epoch check count it', async () => {
  const port = fakePort({ mock: false, engine: 'codex' });
  const boom = Object.assign(new Error('codex: turn failed: boom'), { errorClass: 'rate_limit' });
  const ev = [];
  const { transport, calls } = sharedTransport((h, i) => [codexSettled({ usd: 0.4 }), codexTurn({ usd: 0.2 })][i], { fail: (i) => (i === 0 ? boom : null) });
  const host = sharedHost(port, transport);
  await assert.rejects(host.run(memberOpts(ev), member('n_a')), (e) => e === boom && e.message === 'codex: turn failed: boom' && e.errorClass === 'rate_limit');
  assert.deepEqual(port.booked.map((b) => pick(b, ['stepKey', 'shared', 'turnUsd', 'memberUsage', 'hostSessionId'])),
    [{ stepKey: 'x:n_a:1', shared: true, turnUsd: 0.4, memberUsage: CU, hostSessionId: 'codex:T1' }]);
  assert.deepEqual(pick(port.records.find((r) => r.kind === 'cost'), ['executionId', 'memberUsd', 'hostOverheadUsd', 'costSource']),
    { executionId: 'x:n_a:1', memberUsd: 0.4, hostOverheadUsd: 0, costSource: 'harness' });
  assert.deepEqual(pick(port.records.find((r) => r.kind === 'turn_end'), ['exit', 'deltaUsd', 'cumulativeUsd', 'numTurns', 'subtype']),
    { exit: 'error', deltaUsd: 0.4, cumulativeUsd: null, numTurns: null, subtype: 'error_during_execution' });
  assert.deepEqual(ev.filter((e) => e.type === 'result').map((e) => [e.isError, e.sessionBooked, 'costUsd' in e]), [[true, true, false]], 'handed on as booked');
  assert.deepEqual([host.openCut, port.records.some((r) => r.kind === 'restart')], [null, false]);
  await host.run(memberOpts(), member('n_a', 2));
  assert.deepEqual(calls.map((h) => h.resumeSessionId), [undefined, 'codex:T1']);
  assert.deepEqual(port.booked.map((b) => b.turnUsd), [0.4, 0.2]);
  near(host.lastCumulativeUsd, 0.6);
  await host.close('done');
  const close = port.records.at(-1);
  assert.deepEqual([close.kind, close.reconciled, close.epochChecks[0].ok], ['close', true, true]);
  near(close.epochChecks[0].harnessTotalUsd, 0.6, 'the failed turn\'s spend is in the books\' total');
});

test('a Codex turn stopped or paused books what codex settled as the spawn died; the Stop still throws the AbortError, the pause the PauseError', async () => {
  for (const [how, name] of [['stop', 'AbortError'], ['pause', 'PauseError']]) {
    const port = fakePort({ mock: false, engine: 'codex' });
    const [init, said, settled] = codexSettled({ usd: 0.4 });
    // As runCodexProcess does: the kill ends the spawn, settleUsage hands on the turn's spend, then the spawn throws.
    const transport = (h) => new Promise((_, reject) => {
      h.onEvent(init);
      h.onEvent(said);
      h.signal.addEventListener('abort', () => { h.onEvent(settled); reject(abortErr()); }, { once: true });
    });
    const host = sharedHost(port, transport);
    const ac = new AbortController();
    const done = assert.rejects(host.run(memberOpts([], { signal: ac.signal }), member('n_a')), { name });
    await tick();
    if (how === 'stop') ac.abort();
    else await host.close('paused');
    await done;
    assert.deepEqual(port.booked.map((b) => [b.stepKey, b.turnUsd, Object.hasOwn(b, 'cutEstimateUsd')]), [['x:n_a:1', 0.4, false]], how);
    assert.deepEqual(pick(port.records.find((r) => r.kind === 'cost'), ['memberUsd', 'costSource', 'cut']), { memberUsd: 0.4, costSource: 'harness', cut: undefined }, how);
    assert.equal(port.records.find((r) => r.kind === 'turn_end').exit, 'aborted', how);
    assert.equal(host.openCut, null, `${how}: nothing held for a running total Codex never reports`);
    near(host.lastCumulativeUsd, 0.4, how);
  }
});

test('a Codex turn on a model no list prices that ended without turn.completed: its settled usage books an estimate now, the error goes on', async () => {
  const port = fakePort({ mock: false, engine: 'codex' });
  const boom = new Error('codex: turn failed: boom');
  const host = sharedHost(port, sharedTransport(() => codexSettled(), { fail: () => boom }).transport);
  await assert.rejects(host.run(memberOpts(), member('n_a')), (e) => e === boom);
  assert.equal(port.booked.length, 1);
  near(port.booked[0].cutEstimateUsd, priceUsage(M, CU), 'priced from the result\'s usage');
  assert.deepEqual(pick(port.records.find((r) => r.kind === 'cost'), ['executionId', 'costSource', 'cut']), { executionId: 'x:n_a:1', costSource: 'estimate', cut: true });
  assert.deepEqual([host.openCut, host.lastCumulativeUsd], [null, 0]);
});

test('the same no-count error result is still no turn on Claude Code (no engine named: Claude; the offline host plays it): unbooked, no answer, the lost conversation restarts (C20)', async () => {
  const [, , settled] = codexSettled({ usd: 0 });
  const lostResult = { ...settled, sessionId: 'C1', errors: ['No conversation found with session ID: C1'] };
  for (const over of [{ mock: false, engine: 'claude' }, { mock: false, engine: null }, { mock: true, engine: 'codex' }]) {
    const port = fakePort(over);
    const { transport, calls } = sharedTransport((h, i) => [turnEvents({ usd: 0.4 }), [lostResult], turnEvents({ id: 'C2', usd: 0.3 })][i],
      { fail: (i) => (i === 1 ? new Error('claude exited with code 1') : null) });
    const host = sharedHost(port, transport);
    await host.run(memberOpts(), member('n_a'));
    await host.run(memberOpts(), member('n_b'));
    assert.deepEqual(calls.map((h) => h.resumeSessionId), [undefined, 'C1', undefined], JSON.stringify(over));
    assert.deepEqual(port.booked.map((b) => [b.stepKey, b.cumulativeUsd]), [['x:n_a:1', 0.4], ['x:n_b:1', 0.3]], JSON.stringify(over));
  }
  // On Codex the same frame is a turn's: an answer (no restart, whatever the error says) and booked, both.
  const p2 = fakePort({ mock: false, engine: 'codex' });
  const err = new Error('codex: no rollout found for thread id T1');
  const t2 = sharedTransport((h, i) => [codexTurn({ usd: 0.1 }), [codexSettled({ usd: 0.4 })[2]]][i], { fail: (i) => (i === 1 ? err : null) });
  const h2 = sharedHost(p2, t2.transport);
  await h2.run(memberOpts(), member('n_a'));
  await assert.rejects(h2.run(memberOpts(), member('n_b')), (e) => e === err);
  assert.deepEqual([t2.calls.length, p2.records.some((r) => r.kind === 'restart')], [2, false]);
  assert.deepEqual(p2.booked.map((b) => [b.stepKey, b.turnUsd]), [['x:n_a:1', 0.1], ['x:n_b:1', 0.4]]);
});
