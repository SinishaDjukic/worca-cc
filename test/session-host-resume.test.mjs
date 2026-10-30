// test/session-host-resume.test.mjs — a session survives pause, crash, a lost transcript, an engine switch, a usage limit and the kill switch.
import { test, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume, readPipelineStateById, readPipeline } from '../src/core/artifacts.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { tracePath, readTrace } from '../src/core/session-trace.mjs';
import { COLD_REDISPATCH_HEADER, COLD_FOLLOWUP_HEADER } from '../src/core/phases.mjs';
import { createSessionHosts } from '../src/core/session-host.mjs';
import { runMockSession, _testing as mockT } from '../src/core/engines/mock-session.mjs';
import { _testing as execT } from '../src/core/graph/executor.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { pauseMidTurn, crashMidTurn, spec, decisions, fakePort, member, mockMember } from './helpers/session-host-fakes.mjs';
import { reduceTrace, readTraceSync } from '../src/core/session-trace.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

useTempHome(after);
const SID = 's_aaaaaaaa';
before(async () => {
  process.env.WORCA_FLAGS = 'sessionGroups';
  const t = structuredClone(SEED_TEMPLATES.find((s) => s.id === 'wf_quick-fix'));
  for (const id of ['n_plan', 'n_impl', 'n_review']) t.nodes.find((n) => n.id === id).config.session = SID;
  await writeGraphWorkflow({ ...t, id: 'wf_sess_resume', name: 'Sess resume' });
});
beforeEach(() => { mockT.resetSessions(); mockT.behave = null; mockT.seen = []; delete process.env.WORCA_SESSIONS_DISABLE; execT.runClaude = null; });
const kinds = async (st) => (await readTrace(tracePath(st.pipelineDir, SID))).records.map((r) => r.kind);
const resumeOf = (orch, id, claude = { mock: true }) => createOrchestrator({ projectDir: orch.projectDir, workflowId: 'wf_sess_resume', auto: true, claude, resume: readPipelineForResume(id) });

test('REVIEW FOCUS 1 — a usage limit inside the child pauses as usage_limit; resumed from the DB row on the SAME host, cold, attempt 2', { timeout: 120000 }, async () => {
  mockT.behave = ({ agentType }) => (agentType === 'worca-x-n_impl-1-a1' ? 'usage-limit' : null);
  const o = createOrchestrator({ projectDir: gitDir('sess-limit'), workflowId: 'wf_sess_resume', prompt: 'demo', auto: true, claude: { mock: true } });
  const r1 = await o.run();
  assert.equal(r1.status, 'paused');
  const saved = readPipelineForResume(o.getState().id);                // the DB row, as a restarted server reads it
  assert.equal(saved.state.pauseReason, 'usage_limit');                // readPipelineForResume → { row, resumePoint, steps, state } (artifacts.mjs:1902-1912)
  assert.ok(saved.state.limitResetAt, 'the reset time is parsed, as for an ungrouped step');
  const snap = saved.resumePoint.sessionHosts[SID];
  assert.match(snap.hostSessionId, /^mock-host-/);
  mockT.behave = null;
  const res = await resumeOf(o, o.getState().id).resume();
  assert.equal(res.status, 'done', res.error);
  const redispatch = mockT.seen.find((s) => s.agentType === 'worca-x-n_impl-1-a2');
  assert.ok(redispatch, 'attempt 2, unique type');
  assert.equal(redispatch.resumeSessionId, snap.hostSessionId, 'the same host session');
  assert.ok(redispatch.briefPrompt.startsWith(COLD_REDISPATCH_HEADER), 'cold header, not RESUME_HEADER (R3)');
});

test('REVIEW FOCUS 1 / C29 — a failed re-dispatch after a pause goes through recovery, never the silent resume fallback', { timeout: 120000 }, async () => {
  const { orch, id } = await pauseMidTurn({ workflowId: 'wf_sess_resume', nodeId: 'n_impl' });
  const from = mockT.seen.length;                                       // the paused a1 turn is already in `seen`
  mockT.behave = ({ agentType }) => (agentType === 'worca-x-n_impl-1-a2' ? 'no-dispatch' : null);
  const o2 = resumeOf(orch, id);
  assert.equal((await o2.resume()).status, 'done');
  const impl = mockT.seen.slice(from).filter((s) => s.agentType.startsWith('worca-x-n_impl-1-'));
  assert.deepEqual(impl.map((s) => s.agentType), ['worca-x-n_impl-1-a2', 'worca-x-n_impl-1-a3'], 'the session_host attempt advanced');
  assert.ok(impl[1].briefPrompt.startsWith(COLD_REDISPATCH_HEADER), 'the header survived the failed attempt');
  const audit = (await readPipeline(o2.projectDir, o2.state.id)).auditMarkdown;
  assert.doesNotMatch(audit, /Resume fallback/);
  assert.match(audit, /dispatch d:x:n_impl:1:a2 failed — SESSION_HOST_NO_DISPATCH/);
});

test('C43 / minor 9 — a pause during the epoch\'s FIRST dispatch keeps the host id', { timeout: 120000 }, async () => {
  const { orch, id } = await pauseMidTurn({ workflowId: 'wf_sess_resume', nodeId: 'n_plan' });
  const snap = readPipelineForResume(id).resumePoint.sessionHosts[SID];
  assert.match(snap.hostSessionId, /^mock-host-/);
  assert.equal((await resumeOf(orch, id).resume()).status, 'done');
  assert.equal(mockT.seen.find((s) => s.agentType === 'worca-x-n_plan-1-a2').resumeSessionId, snap.hostSessionId);
});

test('crash mid-turn: the host is restored, the member re-runs in it', { timeout: 120000 }, async () => {
  const { id, hostSessionId } = await crashMidTurn({ workflowId: 'wf_sess_resume', nodeId: 'n_review' });
  const orch = createOrchestrator({ projectDir: readPipelineStateById(id).projectDir, workflowId: 'wf_sess_resume', auto: true, claude: { mock: true }, resume: readPipelineForResume(id) });
  assert.equal((await orch.resume()).status, 'done');
  const again = mockT.seen.filter((s) => s.agentType.startsWith('worca-x-n_review-1-')).at(-1);
  assert.equal(again.resumeSessionId, hostSessionId);
  assert.ok((await kinds(orch.getState())).includes('resume'));
});

test('a vanished host session: a new host, a restart record, an audit line, the run finishes', { timeout: 120000 }, async () => {
  const { orch, id } = await pauseMidTurn({ workflowId: 'wf_sess_resume', nodeId: 'n_review' });
  mockT.behave = ({ resume }) => (resume ? 'vanished' : null);
  const o2 = resumeOf(orch, id);
  assert.equal((await o2.resume()).status, 'done');
  const st = o2.getState();
  assert.equal(st.sessionHosts[SID].restarts, 1);
  assert.ok((await kinds(st)).includes('restart'));
});

test('an engine switch on resume opens a new host on the new engine and re-chooses the mode', { timeout: 120000 }, async () => {
  const { orch, id } = await pauseMidTurn({ workflowId: 'wf_sess_resume', nodeId: 'n_impl' });
  const o2 = resumeOf(orch, id, { mock: true, engine: 'codex' });         // as test/engine-switch-pause.test.mjs switches a paused run
  assert.equal((await o2.resume()).status, 'done');
  const recs = (await readTrace(tracePath(o2.getState().pipelineDir, SID))).records;
  const r = recs.find((x) => x.kind === 'restart');
  assert.deepEqual([r.reason, r.engine], ['engine-switch', 'codex']);
  assert.equal(recs.at(-1).hostEpoch, r.hostEpoch + 1);
  assert.ok(recs.slice(recs.indexOf(r)).some((x) => x.kind === 'mode'));
  assert.equal(o2.getState().sessionHosts[SID].engine, 'codex', 'minor 5');
});

test('C38 — a questions round re-dispatches cold with the follow-up header and the answers', { timeout: 120000 }, async () => {
  const t = structuredClone(SEED_TEMPLATES.find((s) => s.id === 'wf_quick-fix'));
  for (const id of ['n_impl', 'n_review']) t.nodes.find((n) => n.id === id).config.session = SID;
  t.nodes.find((n) => n.id === 'n_impl').config.askQuestions = true;          // the mock writes its questions through MOCK_ASK
  await writeGraphWorkflow({ ...t, id: 'wf_sess_ask', name: 'Sess ask' });
  const o = createOrchestrator({ projectDir: gitDir('sess-ask'), workflowId: 'wf_sess_ask', prompt: 'demo', auto: false, claude: { mock: true } });
  o.on('question', (q) => setImmediate(() => o.answer(q.id, { answers: [] })));   // test/orchestrator-questions.test.mjs:226
  assert.equal((await o.run()).status, 'done');
  const impl = mockT.seen.filter((s) => s.agentType.startsWith('worca-x-n_impl-1-'));
  assert.deepEqual(impl.map((s) => s.agentType), ['worca-x-n_impl-1-a1', 'worca-x-n_impl-1-a2']);
  assert.equal(impl[1].resumeSessionId, impl[0].hostSessionId, 'the same host session');
  assert.ok(impl[1].briefPrompt.startsWith(COLD_FOLLOWUP_HEADER));
  assert.match(impl[1].briefPrompt, /## Already answered — DO NOT ask these again|No more question rounds/);
  assert.doesNotMatch(impl[1].briefPrompt, /MOCK_ASK/, 'the answered round does not re-ask');
});

test('C42 / critique M-13 — pause, set the kill switch, resume: the member spawns plain, never --resume <host>, cold header', { timeout: 120000 }, async () => {
  const { orch, id } = await pauseMidTurn({ workflowId: 'wf_sess_resume', nodeId: 'n_impl' });
  const hostId = readPipelineForResume(id).resumePoint.sessionHosts[SID].hostSessionId;
  process.env.WORCA_SESSIONS_DISABLE = '1';
  const hostTurnsBefore = mockT.seen.length;
  const plain = [];
  execT.runClaude = async (opts) => { plain.push(opts); return runClaude(opts); };
  const o2 = resumeOf(orch, id);
  assert.equal((await o2.resume()).status, 'done');
  const impl = plain.find((o) => /MOCK_ROLE: implementer|Implementation/.test(o.systemPrompt + o.prompt));
  assert.ok(impl);
  assert.notEqual(impl.resumeSessionId, hostId);
  assert.equal(impl.resumeSessionId, undefined);
  assert.ok(impl.prompt.startsWith(COLD_REDISPATCH_HEADER));
  assert.equal(mockT.seen.length, hostTurnsBefore, 'no host turn ran after the resume');
});

test('M-19 — a 529 inside the child retries like an ungrouped step', { timeout: 120000 }, async () => {
  mockT.behave = ({ agentType }) => (agentType === 'worca-x-n_review-1-a1' ? 'child-overloaded' : null);
  const o = createOrchestrator({ projectDir: gitDir('sess-529'), workflowId: 'wf_sess_resume', prompt: 'demo', auto: true, claude: { mock: true } });
  assert.equal((await o.run()).status, 'done');
  assert.deepEqual(mockT.seen.filter((s) => s.agentType.startsWith('worca-x-n_review-1-')).map((s) => s.agentType), ['worca-x-n_review-1-a1', 'worca-x-n_review-1-a2']);
});

test('M-1 — a capped run resumed mid-session: the first resumed turn\'s budget counts the restored total; the baseline is seeded', async () => {
  const port = fakePort({ remainingBudgetUsd: () => 2 });
  const restore = { [SID]: { sid: SID, mode: 'subagents', engine: 'claude', hostEpoch: 1, hostSessionId: 'mock-host-9', turns: 2, dispatches: 2, rotations: 0, restarts: 0, attempts: {}, lastCumulativeUsd: 0.5, epochOpeningUsd: 0, status: 'paused' } };
  const seen = [];
  const hosts = createSessionHosts({ specs: [spec()], decisions: decisions(), port, transport: (o) => { seen.push(o); return runMockSession(o); }, restore });
  assert.deepEqual(port.seeded, [['mock-host-9', 0.5]]);
  await hosts.hostFor('n_a').run(mockMember('x:n_a:1'), member('n_a')).catch(() => {});
  assert.ok(Math.abs(seen[0].maxBudgetUsd - 2.5) < 1e-9);
});

test('C30 — a degraded session stays degraded across resume', async () => {
  const plain = [];
  const restore = { [SID]: { sid: SID, mode: 'separate', degradeReason: 'the main agent did not dispatch', engine: 'claude', hostEpoch: 1, hostSessionId: 'mock-host-9', turns: 3, dispatches: 3, rotations: 0, restarts: 0, attempts: { 'x:n_a:1': 3 }, consecutiveWatchdog: 3, lastCumulativeUsd: 0, status: 'paused' } };
  const hosts = createSessionHosts({ specs: [spec()], decisions: decisions(), port: fakePort(), transport: runMockSession, plainRun: async (o) => { plain.push(o); return { text: 'P', exitCode: 0 }; }, restore });
  assert.equal((await hosts.hostFor('n_a').run(mockMember('x:n_a:1'), member('n_a'))).text, 'P');
  assert.equal(plain.length, 1);
});

// ── v2: the merge rules one by one (C28), on a trace a first host really wrote ──
async function firstRun({ turns = 2, pauseLast = false } = {}) {
  const port = fakePort();
  const hosts = createSessionHosts({ specs: [spec()], decisions: decisions(), port, transport: runMockSession });
  for (let i = 1; i <= turns; i += 1) {
    const last = i === turns && pauseLast;
    const ac = new AbortController();
    if (last) mockT.behave = () => 'hang';
    if (last) mockT.onMemberStart = () => queueMicrotask(() => ac.abort());
    await hosts.hostFor('n_a').run(mockMember(`x:n_a:${i}`, [], { signal: ac.signal }), member('n_a', i)).catch(() => {});
    mockT.behave = null; mockT.onMemberStart = null;
  }
  await hosts.close(pauseLast ? 'paused' : 'done');
  return { port, snap: hosts.snapshot()[SID_V2] };
}
const SID_V2 = 's_aaaaaaaa';
const second = (port, restore, over = {}) => {
  const p2 = fakePort({ pipelineDir: port.pipelineDir, ...over });
  const hosts = createSessionHosts({ specs: [spec()], decisions: over.decisions || decisions(), port: p2, transport: runMockSession, restore: { [SID_V2]: restore } });
  return { p2, hosts, host: hosts.hosts.get(SID_V2) };
};

test('v2 — C28: a crash keeps an older snapshot; the trace\'s epoch id, attempts, turns and cumulative win, and the baseline is seeded with them', async () => {
  const { port, snap } = await firstRun({ turns: 2 });
  const stale = { ...snap, hostSessionId: null, turns: 1, dispatches: 1, epochDispatches: 0, attempts: { 'x:n_a:1': 1 }, lastCumulativeUsd: 0.001, status: 'idle' };
  const { p2, host } = second(port, stale);
  const recs = readTraceSync(host.trace.path).records;
  const lastEnd = recs.filter((r) => r.kind === 'turn_end').at(-1);
  assert.equal(host.hostSessionId, snap.hostSessionId);
  assert.deepEqual([host.turns, host.dispatches], [2, 2]);
  assert.deepEqual(Object.fromEntries(host.attempts), { 'x:n_a:1': 1, 'x:n_a:2': 1 });
  assert.equal(host.lastCumulativeUsd, lastEnd.cumulativeUsd);
  assert.deepEqual(p2.seeded, [[snap.hostSessionId, lastEnd.cumulativeUsd]]);
  assert.deepEqual([p2.records.at(-1).kind, p2.records.at(-1).after], ['resume', 'crash']);
  assert.equal(host.epochOpeningUsd, lastEnd.cumulativeUsd, 'the resumed epoch is checked from the restored figure');
  assert.equal(host.epochDispatches, 2, 'v3: the epoch\'s dispatch records beat an older snapshot');
});

test('v2 — C28: a snapshot ahead of a trace that lost its last writes keeps the higher figures', async () => {
  const { port, snap } = await firstRun({ turns: 1 });
  const ahead = { ...snap, hostEpoch: 2, hostSessionId: 'mock-host-77', turns: 5, dispatches: 5, rotations: 1, restarts: 2, attempts: { 'x:n_a:1': 3 }, lastCumulativeUsd: 0.9,
    lastContextTokens: 9000, hostResolvedModel: 'claude-haiku-4-5-20251001', consecutiveWatchdog: 2, status: 'paused' };
  const { p2, host } = second(port, ahead);
  assert.deepEqual([host.hostEpoch, host.hostSessionId, host.turns, host.dispatches, host.rotations], [2, 'mock-host-77', 5, 5, 1]);
  assert.equal(host.attempts.get('x:n_a:1'), 3);
  assert.equal(host.lastCumulativeUsd, 0.9, 'no turn_end of epoch 2 in the trace: the snapshot\'s figure');
  assert.deepEqual(p2.seeded, [['mock-host-77', 0.9]]);
  assert.equal(p2.records.at(-1).after, 'pause');
  assert.deepEqual([host.restarts, host.lastContextTokens, host.hostResolvedModel, host.consecutiveWatchdog], [2, 9000, 'claude-haiku-4-5-20251001', 2],
    'v3: the snapshot\'s epoch figures, and the watchdog streak (one more failure degrades, C30)');
});

test('v2 — C6: the restored live summary is the fold of the whole file, resume record included', async () => {
  const { port, snap } = await firstRun({ turns: 2, pauseLast: true });
  const { p2, host } = second(port, snap);
  await host.trace.flush();
  const recs = readTraceSync(host.trace.path).records;
  assert.deepEqual(reduceTrace(recs), p2.summary);
  assert.equal(p2.summary.status, 'idle');
  // close()'s own totals come back from the file: the spend per node, the tokens, the active time and the open time.
  const byNode = {};
  for (const r of recs.filter((x) => x.kind === 'cost' && Number.isFinite(x.memberUsd))) byNode[r.nodeId] = (byNode[r.nodeId] ?? 0) + r.memberUsd;
  assert.deepEqual(host.memberUsdByNode, byNode);
  assert.ok(Object.keys(byNode).length > 0);
  const ends = recs.filter((x) => x.kind === 'turn_end');
  assert.equal(host.activeMs, ends.reduce((a, r) => a + r.durationMs, 0));
  const tok = { in: 0, out: 0, cr: 0, cw: 0 };
  for (const t of [...ends.map((r) => r.hostUsage), ...recs.filter((x) => x.kind === 'member_done').map((r) => r.tokens)]) for (const k of Object.keys(tok)) tok[k] += t?.[k] || 0;
  assert.deepEqual(host.tokens, tok);
  assert.ok(tok.in > 0);
  assert.equal(host.openedAt, Date.parse(recs[0].ts));
  assert.ok(host.openCut, 'the held cut of the paused turn is back');
  const priced = ends.filter((r) => Number.isFinite(r.cumulativeUsd));
  assert.ok(priced.length && priced.length < ends.length, 'the fixture ends on a cut turn (no cumulative)');
  assert.equal(host.lastCumulativeUsd, priced.at(-1).cumulativeUsd, 'v3: a cut turn_end never resets the restored cumulative');
  assert.deepEqual(host.openCut, snap.openCut);
});

test('v2 — an engine switch books the held cut as an estimate before the restart, opens a new epoch with no host id, writes the new mode', async () => {
  const { port, snap } = await firstRun({ turns: 2, pauseLast: true });
  assert.ok(snap.openCut);
  const { p2, host } = second(port, snap, { engine: 'codex' });
  const kinds = p2.records.map((r) => r.kind);
  assert.deepEqual(kinds, ['cost', 'restart', 'mode']);
  assert.deepEqual([p2.records[0].cut, p2.records[0].costSource, p2.records[0].executionId], [true, 'estimate', 'x:n_a:2']);
  assert.deepEqual([p2.records[1].reason, p2.records[1].engine, p2.records[1].fromSessionId], ['engine-switch', 'codex', snap.hostSessionId]);
  assert.deepEqual([host.hostEpoch, host.hostSessionId, host.lastCumulativeUsd, host.openCut], [snap.hostEpoch + 1, null, 0, null]);
  assert.deepEqual(p2.seeded, [], 'a new epoch has nothing to seed');
  assert.equal(p2.records[2].engine, 'codex');
});

test('v2 — the gate says separate now: the resumed session records it and its members run plain', async () => {
  const { port, snap } = await firstRun({ turns: 1 });
  const sep = decisions('separate', { reason: 'the Labs flag sessionGroups is off' });
  const { p2, hosts } = second(port, { ...snap, status: 'paused' }, { decisions: sep });
  assert.deepEqual(p2.records.map((r) => r.kind), ['resume', 'mode', 'degrade']);
  assert.equal(hosts.hostFor('n_a'), null);
  assert.equal(hosts.modeOf('n_a'), 'separate');
});

test('v2 — a lost trace is opened again; the snapshot alone restores the host (C28: either can lose its last write)', async () => {
  const port = fakePort();
  const snap = { sid: SID_V2, mode: 'subagents', engine: 'claude', hostEpoch: 1, hostSessionId: 'mock-host-5', turns: 2, dispatches: 2, rotations: 0, restarts: 0,
    attempts: { 'x:n_a:1': 2 }, lastCumulativeUsd: 0.3, epochOpeningUsd: 0, status: 'paused' };
  const { p2, host } = second(port, snap);
  assert.deepEqual(p2.records.map((r) => r.kind), ['open', 'mode', 'resume']);
  assert.deepEqual([host.hostSessionId, host.attempts.get('x:n_a:1'), host.turns], ['mock-host-5', 2, 2]);
  assert.deepEqual(p2.seeded, [['mock-host-5', 0.3]]);
  const deg = second(fakePort(), { ...snap, mode: 'separate', degradeReason: 'the main agent did not dispatch' });
  assert.deepEqual(deg.p2.records.map((r) => r.kind), ['open', 'mode', 'resume', 'degrade'], 'the lost trace said it was degraded: say it again (C30)');
  assert.deepEqual([deg.p2.summary.mode, deg.p2.summary.modeReason, deg.host.mode], ['separate', 'the main agent did not dispatch', 'separate']);
});

test('v2 — a pending rotation (a member-level cap) survives the pause: the first resumed dispatch rotates first', async () => {
  const { port, snap } = await firstRun({ turns: 1 });
  assert.equal(snap.pendingRotate, null);
  const { p2, host } = second(port, { ...snap, pendingRotate: 'cap', status: 'paused' });
  await host.run(mockMember('x:n_b:1'), member('n_b'));
  const rot = p2.records.find((r) => r.kind === 'rotate');
  assert.equal(rot.reason, 'cap');
  assert.equal(p2.records.indexOf(rot) < p2.records.findIndex((r) => r.kind === 'turn_start'), true);
});

test('v2 — C19: a resumed run resolves its sessions again (the gate\'s line is audited twice) and keeps its summaries on the row', { timeout: 120000 }, async () => {
  const { orch, id } = await pauseMidTurn({ workflowId: 'wf_sess_resume', nodeId: 'n_impl' });
  const o2 = resumeOf(orch, id);
  assert.equal((await o2.resume()).status, 'done');
  const audit = (await readPipeline(o2.projectDir, id)).auditMarkdown;
  assert.equal(audit.split(`session ${SID}: sub-agents on Claude (3 steps: Plan, Implementation, Review Implementation; main agent the first step's model)`).length - 1, 2, audit);
  const k = await pauseMidTurn({ workflowId: 'wf_sess_resume', nodeId: 'n_review' });
  process.env.WORCA_SESSIONS_DISABLE = '1';
  const before = readPipelineStateById(k.id).sessionHosts[SID];
  const o3 = resumeOf(k.orch, k.id);
  assert.equal((await o3.resume()).status, 'done');
  assert.deepEqual(o3.getState().sessionHosts[SID], before, 'a kill-switch resume keeps the history it does not extend');
});

// ── v3: a snapshot older than the trace after a crash (it is taken when an execution completes) ──
async function liveRun(turns, behave = null) {
  const port = fakePort();
  const hosts = createSessionHosts({ specs: [spec()], decisions: decisions(), port, transport: runMockSession });
  const host = hosts.hosts.get(SID_V2);
  const snaps = [];
  for (let i = 1; i <= turns; i += 1) {
    mockT.behave = behave;
    await host.run(mockMember(`x:n_a:${i}`), member('n_a', i)).catch(() => {});
    mockT.behave = null;
    snaps.push(hosts.snapshot()[SID_V2]);
  }
  await host.trace.flush();
  return { port, host, hosts, snaps };
}

test('v3 — C9: a held cut the trace already carried is not held again after a crash (the snapshot predates the carry)', async () => {
  const { port, snaps } = await liveRun(2, ({ turn }) => (turn === 1 ? 'host-error-after-member' : null));
  const before = readTraceSync(tracePath(port.pipelineDir, SID_V2)).records.filter((r) => r.kind === 'cost' && r.carriedBy);
  assert.equal(before.length, 1, 'turn 2 carried turn 1\'s cut');
  assert.ok(snaps[0].openCut, 'the first snapshot still holds it');
  const { p2, host } = second(port, { ...snaps[0], status: 'running' });
  assert.equal(host.openCut, null, 'the carried part is gone');
  await host.run(mockMember('x:n_a:3'), member('n_a', 3));
  assert.equal(p2.records.filter((r) => r.kind === 'cost' && r.carriedBy).length, 0, 'never carried twice');
});

test('v3 — C28: a crash right after a rotate (its next epoch lost) restores the NEW epoch: no old host id, cumulative 0, a rotation used', async () => {
  const { port, host, snaps } = await liveRun(1);
  const S = { ...snaps[0], pendingRotate: 'cap', lastContextTokens: 9000, epochDispatches: 1, status: 'running' };
  assert.ok(S.hostSessionId && S.lastCumulativeUsd > 0);
  host._rotate('cap');                                           // the rotate record lands; the crash takes the rest
  await host.trace.flush();
  const rot = readTraceSync(tracePath(port.pipelineDir, SID_V2)).records.find((r) => r.kind === 'rotate');
  const { p2, host: h2 } = second(port, S);
  assert.deepEqual(h2.epochChecks, [rot.epochCheck], 'the rotate\'s epoch check comes back for close');
  assert.equal(h2.hostResolvedModel, null, 'a new epoch has no main-agent model yet');
  assert.deepEqual([h2.hostEpoch, h2.hostSessionId, h2.lastCumulativeUsd, h2.epochDispatches, h2.lastContextTokens, h2.rotations, h2.pendingRotate],
    [2, null, 0, 0, 0, 1, null]);
  assert.deepEqual(p2.seeded, [], 'a new epoch has nothing to seed');
  await h2.run(mockMember('x:n_b:1'), member('n_b'));
  assert.equal(p2.records.filter((r) => r.kind === 'rotate').length, 0, 'the pending rotation was the one the trace holds');
  assert.equal(p2.records.find((r) => r.kind === 'turn_start').resume, false, 'a fresh host, never the rotated-away one');
});

test('v3 — C30: a runtime degrade only the trace holds survives the crash (the snapshot predates it)', async () => {
  const { port, snaps } = await liveRun(3, () => 'no-dispatch');
  const recs = readTraceSync(tracePath(port.pipelineDir, SID_V2)).records;
  assert.equal(recs.filter((r) => r.kind === 'degrade').length, 1);
  const plain = [];
  const p2 = fakePort({ pipelineDir: port.pipelineDir });
  const hosts = createSessionHosts({ specs: [spec()], decisions: decisions(), port: p2, transport: runMockSession, plainRun: async (o) => { plain.push(o); return { text: 'P', exitCode: 0 }; },
    restore: { [SID_V2]: { ...snaps[0], status: 'running' } } });
  assert.equal(snaps[0].mode, 'subagents');
  const h = hosts.hosts.get(SID_V2);
  assert.deepEqual([h.mode, h.degradeReason], ['separate', 'the main agent did not dispatch']);
  assert.equal((await h.run(mockMember('x:n_a:4'), member('n_a', 4))).text, 'P');
  assert.equal(plain.length, 1);
  assert.equal(p2.records.filter((r) => r.kind === 'degrade').length, 0, 'not degraded a second time');
  // The gate's own degrade (a resume whose gate said separate: mode + degrade, no dispatch after them) is not a runtime one.
  const one = await liveRun(1);
  const sep = second(one.port, { ...one.snaps[0], status: 'paused' }, { decisions: decisions('separate', { reason: 'the Labs flag sessionGroups is off' }) });
  await sep.host.trace.flush();
  assert.deepEqual(sep.p2.records.map((r) => r.kind), ['resume', 'mode', 'degrade']);
  const again = second(one.port, { ...one.snaps[0], status: 'paused' });
  assert.equal(again.host.mode, 'subagents', 'the flag is back on: the gate decides again');
});

test('v3 — a lost trace and a gate that now says separate write the mode once', async () => {
  const snap = { sid: SID_V2, mode: 'subagents', engine: 'claude', hostEpoch: 1, hostSessionId: 'mock-host-5', turns: 1, dispatches: 1, rotations: 0, restarts: 0, attempts: {}, lastCumulativeUsd: 0.1, status: 'paused' };
  const { p2 } = second(fakePort(), snap, { decisions: decisions('separate', { reason: 'the Labs flag sessionGroups is off' }) });
  assert.deepEqual(p2.records.map((r) => r.kind), ['open', 'mode', 'degrade', 'resume']);
});

test('v3 — the crash seam: the host seeds with the trace\'s last turn_end and its turn, and adopts the figure the harness seeded', async () => {
  const { port, snaps } = await liveRun(2);
  const recs = readTraceSync(tracePath(port.pipelineDir, SID_V2)).records;
  const lastEnd = recs.filter((r) => r.kind === 'turn_end').at(-1);
  const calls = [];
  const { host } = second(port, { ...snaps[1], status: 'running' }, { seedBaseline: (id, usd, o) => { calls.push([id, usd, o]); return 0.77; } });
  assert.deepEqual(calls, [[snaps[1].hostSessionId, lastEnd.cumulativeUsd, { sid: SID_V2, afterTurn: Number(lastEnd.turnId.split(':').at(-1)) }]]);
  assert.deepEqual([host.lastCumulativeUsd, host.epochOpeningUsd], [0.77, 0.77]);
});

test('v3 — the crash seam, harness side: a row whose own booked turn is newer than the trace\'s last turn_end seeds the baseline', () => {
  const o = createOrchestrator({ projectDir: gitDir('sessseed'), claude: { mock: true } });
  const row = (key, turn, usd, costSource = 'harness', sid = SID, host = 'H1') => ({ key, sessionCosts: { [host]: usd }, session: { sid, hostSessionId: host, turnId: `t:${sid}:${turn}`, costSource } });
  o.state.steps = [row('x:n_a:1', 2, 0.25), row('x:n_b:1', 3, 0.5)];
  assert.equal(o.seedSessionBaseline('H1', 0.25, { sid: SID, afterTurn: 2 }), 0.5, 'turn 3 was booked, its turn_end never landed');
  assert.equal(o._sessionBaseline('H1'), 0.5);
  assert.equal(o.seedSessionBaseline('H1', 0.2, { sid: SID, afterTurn: 3 }), 0.2, 'M-1: the trace\'s figure stands, even below the row max');
  o.state.steps = [row('x:n_a:1', 2, 0.25), row('x:n_b:1', 3, 0.5, null)];
  assert.equal(o.seedSessionBaseline('H1', 0.25, { sid: SID, afterTurn: 2 }), 0.25, 'a row stamped at bind only (no booking) says nothing');
  o.state.steps = [row('x:n_a:1', 2, 0.25), row('x:n_b:1', 3, 0.5, 'harness', 's_bbbbbbbb')];
  assert.equal(o.seedSessionBaseline('H1', 0.25, { sid: SID, afterTurn: 2 }), 0.25, 'another session');
  o.state.steps = [row('x:n_a:1', 2, 0.25), row('x:n_b:1', 3, 0.5, 'harness', SID, 'H0')];
  assert.equal(o.seedSessionBaseline('H1', 0.25, { sid: SID, afterTurn: 2 }), 0.25, 'another host (an earlier epoch)');
  o.state.steps = [row('x:n_a:1', 4, 0.6), row('x:n_b:1', 3, 0.5)];
  assert.equal(o.seedSessionBaseline('H1', 0.25, { sid: SID, afterTurn: 2 }), 0.6, 'the newest booked turn wins, not the first row');
  assert.equal(o.seedSessionBaseline('H1', 0.25), 0.25, 'no turn given: the trace\'s figure');
  assert.equal(o.seedSessionBaseline('H1', 0.25, { sid: SID }), 0.25, 'a session without the trace\'s turn: the trace\'s figure');
  o._sessionBaselines = new Map();
  assert.equal(o.seedSessionBaseline('H1', NaN, { sid: SID, afterTurn: 2 }), undefined, 'a non-finite figure seeds nothing');
  assert.equal(o._sessionBaseline('H1'), 0.6, 'so the baseline falls back to the rows\' max');
});

test('v3 — an engine switch prices the held cut on the engine it was spent on (claude → copilot books a Claude estimate)', async () => {
  const { port, snap } = await firstRun({ turns: 2, pauseLast: true });
  const { p2 } = second(port, snap, { engine: 'copilot' });
  assert.equal(p2.booked[0].cutEngine, 'claude');
  const o = createOrchestrator({ projectDir: gitDir('sesscutengine'), claude: { mock: true, engine: 'copilot' } });
  o.state.steps = [{ key: 'x:n_a:2', status: 'paused' }];
  const b = o._bookSessionTurn({ stepKey: 'x:n_a:2', cutEstimateUsd: 0.05, cutEngine: 'claude' });
  assert.deepEqual([b.memberUsd, b.costSource], [0.05, 'estimate']);
  assert.deepEqual([o._bookSessionTurn({ stepKey: 'x:n_a:2', cutEstimateUsd: 0.05 }).costSource, o._bookSessionTurn({ stepKey: 'x:n_a:2', cutEstimateUsd: 0.05, cutEngine: 'copilot' }).memberUsd],
    ['none', null], 'C24: a cut on an engine without cost stays blank');
});

test('v3 — an engine switch resets what the old engine earned: the degrade, the watchdog streak and a pending rotation (the new gate decides)', async () => {
  const { port, snap } = await firstRun({ turns: 1 });
  const S = { ...snap, mode: 'separate', degradeReason: 'the main agent did not dispatch', consecutiveWatchdog: 2, pendingRotate: 'cap', status: 'paused' };
  const { host } = second(port, S, { engine: 'codex' });
  assert.deepEqual([host.mode, host.degradeReason, host.consecutiveWatchdog, host.pendingRotate], ['subagents', null, 0, null]);
  const sep = second(port, S, { engine: 'codex', decisions: decisions('separate', { reason: 'Codex has no sub-agents here' }) });
  assert.deepEqual([sep.host.mode, sep.host.degradeReason], ['separate', 'Codex has no sub-agents here']);
});

/** wf_sess_resume with a priced main agent, so a held cut is a real figure (the mock's default model has no price). */
async function writePricedWorkflow(id) {
  const t = structuredClone(SEED_TEMPLATES.find((x) => x.id === 'wf_quick-fix'));
  for (const n of ['n_plan', 'n_impl', 'n_review']) t.nodes.find((x) => x.id === n).config.session = SID;
  t.sessions = { [SID]: { hostModel: 'claude-haiku-4-5' } };
  await writeGraphWorkflow({ ...t, id, name: id });
}
/** Every dollar the session's trace booked (member shares, carried shares, estimates and the main agent's overhead). */
const tracedUsd = (records) => records.filter((r) => r.kind === 'cost').reduce((a, r) => a + (r.memberUsd ?? 0) + (r.hostOverheadUsd ?? 0), 0);
const spentUsd = () => [...mockT.spent.values()].reduce((a, x) => a + x, 0);

test('a resume that pauses again in its re-preflight keeps every session snapshot; the next resume continues the trace and carries the cut', { timeout: 180000 }, async () => {
  await writePricedWorkflow('wf_sess_repause');
  const { orch, id } = await pauseMidTurn({ workflowId: 'wf_sess_repause', nodeId: 'n_impl' });
  const hostsBefore = readPipelineForResume(id).resumePoint.sessionHosts;
  const cut = hostsBefore[SID].openCut;
  assert.ok(cut?.cutUsd > 0, 'the paused turn holds a priced cut');
  const o2 = createOrchestrator({ projectDir: orch.projectDir, workflowId: 'wf_sess_repause', auto: true, claude: { mock: true }, resume: readPipelineForResume(id) });
  o2._preflightMediaTools = async () => { throw new Error('ffmpeg is not installed'); };   // removed while the run sat paused
  assert.equal((await o2.resume()).status, 'paused');
  assert.deepEqual(readPipelineForResume(id).resumePoint.sessionHosts, hostsBefore, 'the re-pause keeps every snapshot, the held cut too');
  const o3 = createOrchestrator({ projectDir: orch.projectDir, workflowId: 'wf_sess_repause', auto: true, claude: { mock: true }, resume: readPipelineForResume(id) });
  assert.equal((await o3.resume()).status, 'done');
  const { records } = await readTrace(tracePath(o3.getState().pipelineDir, SID));
  assert.equal(records.filter((r) => r.kind === 'open').length, 1, 'the trace is continued, never opened again');
  const turns = records.filter((r) => r.kind === 'turn_start').map((r) => r.turnId);
  assert.equal(new Set(turns).size, turns.length, 'turn ids stay unique (C31)');
  assert.equal(records.filter((r) => r.kind === 'cost' && r.turnId === cut.turnId && r.carriedBy).length, 1, 'the cut is carried, once (C9)');
  assert.ok(Math.abs(tracedUsd(records) - spentUsd()) < 1e-9, `every dollar spent is booked once: ${tracedUsd(records)} vs ${spentUsd()}`);
});

test('v4 — C36 + C9: a kill-switch resume that pauses keeps the held cut in its resume point, and a later run with sessions carries it once', { timeout: 180000 }, async () => {
  await writePricedWorkflow('wf_sess_kill_cut');
  const { orch, id } = await pauseMidTurn({ workflowId: 'wf_sess_kill_cut', nodeId: 'n_impl' });
  const S = readPipelineForResume(id).resumePoint.sessionHosts[SID];
  assert.ok(S.openCut?.cutUsd > 0, 'the paused turn holds a priced cut');
  process.env.WORCA_SESSIONS_DISABLE = '1';
  const o2 = createOrchestrator({ projectDir: orch.projectDir, workflowId: 'wf_sess_kill_cut', auto: true, claude: { mock: true }, resume: readPipelineForResume(id) });
  const booked = [];
  const book = o2._bookSessionTurn.bind(o2);
  o2._bookSessionTurn = (b) => { booked.push(b); return book(b); };
  let paused = false;
  execT.runClaude = async (opts) => { if (!paused) { paused = true; queueMicrotask(() => o2.pause()); } return runClaude(opts); };
  assert.equal((await o2.resume()).status, 'paused');
  execT.runClaude = null;
  assert.deepEqual(booked, [], 'a paused run books nothing: a later run with sessions resumes the host whose cumulative holds the cut');
  assert.deepEqual(readPipelineForResume(id).resumePoint.sessionHosts[SID], S, 'the snapshot rides on with the held cut');
  delete process.env.WORCA_SESSIONS_DISABLE;
  const o3 = createOrchestrator({ projectDir: orch.projectDir, workflowId: 'wf_sess_kill_cut', auto: true, claude: { mock: true }, resume: readPipelineForResume(id) });
  assert.equal((await o3.resume()).status, 'done');
  const { records } = await readTrace(tracePath(o3.getState().pipelineDir, SID));
  assert.equal(records.filter((r) => r.kind === 'open').length, 1, 'the trace is continued, never opened again');
  assert.ok(records.some((r) => r.kind === 'resume'));
  const turns = records.filter((r) => r.kind === 'turn_start').map((r) => r.turnId);
  assert.equal(new Set(turns).size, turns.length, 'turn ids stay unique (C31)');
  assert.equal(records.filter((r) => r.kind === 'cost' && r.turnId === S.openCut.turnId && r.carriedBy).length, 1, 'the next resumed turn carries the cut, once (C9)');
  assert.ok(Math.abs(tracedUsd(records) - spentUsd()) < 1e-9, `every dollar spent is booked once: ${tracedUsd(records)} vs ${spentUsd()}`);
});

test('C36 + C9 — a kill-switch resume that ends books the held cut once, as an estimate on its own row: every dollar spent is booked once', { timeout: 180000 }, async () => {
  await writePricedWorkflow('wf_sess_kill_end');
  const { orch, id } = await pauseMidTurn({ workflowId: 'wf_sess_kill_end', nodeId: 'n_impl' });
  const rp = readPipelineForResume(id);
  const S = rp.resumePoint.sessionHosts[SID];
  assert.ok(S.openCut?.cutUsd > 0, 'the paused turn holds a priced cut');
  const before = rp.steps.find((x) => x.key === 'x:n_impl:1').costUsd || 0;
  process.env.WORCA_SESSIONS_DISABLE = '1';
  const o2 = createOrchestrator({ projectDir: orch.projectDir, workflowId: 'wf_sess_kill_end', auto: true, claude: { mock: true }, resume: rp });
  const booked = [];
  const book = o2._bookSessionTurn.bind(o2);
  o2._bookSessionTurn = (b) => { booked.push(b); return book(b); };
  assert.equal((await o2.resume()).status, 'done');
  assert.deepEqual(booked.map((b) => [b.stepKey, b.turnId, b.cutEstimateUsd, b.cutEngine]), [['x:n_impl:1', S.openCut.turnId, S.openCut.cutUsd, 'claude']],
    'no host will carry it: booked once, as an estimate, on its own row');
  assert.ok((o2.getState().steps.find((x) => x.key === 'x:n_impl:1').costUsd || 0) >= before + S.openCut.cutUsd - 1e-9, 'on the cut member\'s row');
  const { records } = await readTrace(tracePath(o2.getState().pipelineDir, SID));
  const estimates = booked.reduce((a, b) => a + b.cutEstimateUsd, 0);
  assert.ok(Math.abs(tracedUsd(records) + estimates - spentUsd()) < 1e-9, `every dollar spent is booked once: ${tracedUsd(records)} + ${estimates} vs ${spentUsd()}`);
});

// ── v4: the crash seam's other half — the rows run ahead of the trace, so the snapshot rides with every booking ──
/** Drop the trace from the first record `cut` matches: the appends a crash lost after the rows were persisted. */
function loseTraceFrom(path, cut) {
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const i = lines.findIndex((l) => cut(JSON.parse(l)));
  assert.ok(i > 0, 'the record to lose is in the trace');
  writeFileSync(path, lines.slice(0, i).join('\n') + '\n');
}

test('v4 — the crash seam (C9): the snapshot rides with every booking, so a cut the rows already carried is never held again after a crash', async () => {
  const saved = [];
  const port = fakePort({ saveSnapshot: (sid, snap) => saved.push({ sid, snap, booked: port.booked.length }) });
  const hosts = createSessionHosts({ specs: [spec()], decisions: decisions(), port, transport: runMockSession });
  const host = hosts.hosts.get(SID_V2);
  mockT.behave = ({ turn }) => (turn === 1 ? 'host-error-after-member' : null);   // C12: accepted, its spend held as a cut
  await host.run(mockMember('x:n_a:1'), member('n_a', 1));
  mockT.behave = null;
  assert.equal(host.openCut.turnId, 't:s_aaaaaaaa:1');
  await host.run(mockMember('x:n_b:1'), member('n_b', 1));                         // turn 2's Δ carries it
  await host.trace.flush();
  const at = saved.at(-1);
  assert.deepEqual([at.sid, at.booked, at.snap.openCut, at.snap.turns, at.snap.lastCumulativeUsd], [SID_V2, 1, null, 2, host.lastCumulativeUsd],
    'handed over after turn 2\'s booking (turn 1 had no result to book), the cut no longer held');
  // The crash: the rows (and the snapshot with them) are persisted, turn 2's turn_end, carry, cost and reconcile are lost.
  loseTraceFrom(tracePath(port.pipelineDir, SID_V2), (r) => r.kind === 'turn_end' && r.turnId === 't:s_aaaaaaaa:2');
  const { p2, host: h2 } = second(port, { ...at.snap, status: 'running' });
  assert.equal(h2.openCut, null, 'not held again');
  await h2.run(mockMember('x:n_b:1'), member('n_b', 1));
  assert.equal(p2.booked.filter((b) => b.carried).length, 0, 'never carried twice');
});

test('v4 — the crash seam (C9): a cut booked as an estimate (a rotate) is never booked again after a crash that lost the rotate', async () => {
  const saved = [];
  const port = fakePort({ saveSnapshot: (sid, snap) => saved.push({ snap, booked: port.booked.length }) });
  const limits = { rotateDispatches: 1 };
  const hosts = createSessionHosts({ specs: [spec()], decisions: decisions(), port, transport: runMockSession, limits });
  const host = hosts.hosts.get(SID_V2);
  mockT.behave = ({ turn }) => (turn === 1 ? 'host-error-after-member' : null);
  await host.run(mockMember('x:n_a:1'), member('n_a', 1));
  mockT.behave = null;
  await host.run(mockMember('x:n_b:1'), member('n_b', 1));                         // rotates first: the cut is booked as an estimate
  await host.trace.flush();
  const i = port.booked.findIndex((b) => Number.isFinite(b.cutEstimateUsd));
  const at = saved.filter((x) => x.booked === i).at(-1);                          // the last one before that booking
  assert.ok(i >= 0 && at, 'the snapshot was handed over before the estimate was booked');
  assert.deepEqual([at.snap.openCut, at.snap.hostEpoch], [null, 1]);
  loseTraceFrom(tracePath(port.pipelineDir, SID_V2), (r) => r.kind === 'cost' && r.cut);   // the estimate's cost and the rotate lost
  const p2 = fakePort({ pipelineDir: port.pipelineDir });
  const h2 = createSessionHosts({ specs: [spec()], decisions: decisions(), port: p2, transport: runMockSession, limits, restore: { [SID_V2]: { ...at.snap, status: 'running' } } }).hosts.get(SID_V2);
  assert.equal(h2.openCut, null);
  await h2.run(mockMember('x:n_b:1'), member('n_b', 1));
  assert.equal(p2.booked.filter((b) => Number.isFinite(b.cutEstimateUsd)).length, 0, 'the estimate is booked once');
});

test('C30 + C9 — a runtime degrade hands over a snapshot that already says separate before it books the held cut: a crash that lost the degrade never books the cut twice', async () => {
  const saved = [];
  const port = fakePort({ saveSnapshot: (sid, snap) => saved.push({ snap, booked: port.booked.length }) });
  const limits = { degradeAfter: 1 };
  const priced = spec(['n_a', 'n_b'], { hostModel: 'claude-haiku-4-5' });                // a priced main agent: the cut is a real figure
  const host = createSessionHosts({ specs: [priced], decisions: decisions(), port, transport: runMockSession, limits }).hosts.get(SID_V2);
  await host.run(mockMember('x:n_a:1'), member('n_a', 1));
  mockT.behave = ({ turn }) => (turn === 2 ? 'two-dispatch' : null);                    // killed by the watchdog: its spend is held as a cut
  await host.run(mockMember('x:n_b:1'), member('n_b', 1)).catch(() => {});
  mockT.behave = null;
  await host.trace.flush();
  assert.equal(host.mode, 'separate', 'the watchdog degraded the session');
  const i = port.booked.findIndex((b) => Number.isFinite(b.cutEstimateUsd));
  const at = saved.filter((x) => x.booked === i).at(-1);                          // the last one before the estimate was booked
  assert.ok(i >= 0 && port.booked[i].cutEstimateUsd > 0 && at, 'the degrade booked the held cut, and handed a snapshot over first');
  assert.deepEqual([at.snap.mode, at.snap.degradeReason, at.snap.openCut], ['separate', 'the main agent did not dispatch', null],
    'the rows that hold the estimate persist with a snapshot that says the session degraded');
  const recs = readTraceSync(tracePath(port.pipelineDir, SID_V2)).records;
  assert.ok(recs.findIndex((r) => r.kind === 'cost' && r.cut) < recs.findIndex((r) => r.kind === 'degrade'), 'the trace still books the cut before it says degrade');
  loseTraceFrom(tracePath(port.pipelineDir, SID_V2), (r) => r.kind === 'cost' && r.cut);   // the crash: the estimate's cost and the degrade lost
  const plain = [];
  const p2 = fakePort({ pipelineDir: port.pipelineDir });
  const h2 = createSessionHosts({ specs: [priced], decisions: decisions(), port: p2, transport: runMockSession, limits,
    plainRun: async (o) => { plain.push(o); return { text: 'P', exitCode: 0 }; }, restore: { [SID_V2]: { ...at.snap, status: 'running' } } }).hosts.get(SID_V2);
  assert.deepEqual([h2.mode, h2.degradeReason, h2.openCut], ['separate', 'the main agent did not dispatch', null], 'restored degraded, the cut not held again');
  assert.equal((await h2.run(mockMember('x:n_b:1'), member('n_b', 1))).text, 'P');
  assert.equal(plain.length, 1, 'the retry runs plain, never on the host whose cumulative holds the cut');
  assert.equal(p2.booked.length, 0, 'nothing booked twice');
});

test('v4 — the crash seam, harness side: a session\'s snapshot joins a resume point that carries sessionHosts, nothing else', () => {
  const o = createOrchestrator({ projectDir: gitDir('sesssnap'), claude: { mock: true } });
  const port = o._sessionPort();
  o.state.resumePoint = null;
  port.saveSnapshot(SID, { hostEpoch: 2 });
  assert.equal(o.state.resumePoint, null, 'no point, nothing to join');
  o.state.resumePoint = { snapshot: { s: 1 } };
  port.saveSnapshot(SID, { hostEpoch: 2 });
  assert.deepEqual(o.state.resumePoint, { snapshot: { s: 1 } }, 'an ungrouped point keeps its shape');
  o.state.resumePoint = { snapshot: { s: 1 }, sessionHosts: { [SID]: { hostEpoch: 1 }, s_bbbbbbbb: { hostEpoch: 5 } } };
  port.saveSnapshot(SID, { hostEpoch: 2 });
  assert.deepEqual(o.state.resumePoint, { snapshot: { s: 1 }, sessionHosts: { [SID]: { hostEpoch: 2 }, s_bbbbbbbb: { hostEpoch: 5 } } });
});

test('v4 — an engine switch on a lost trace writes the new run\'s mode once (the reopened trace\'s open wrote it)', async () => {
  const snap = { sid: SID_V2, mode: 'subagents', engine: 'claude', hostEpoch: 1, hostSessionId: 'mock-host-5', turns: 1, dispatches: 1, rotations: 0, restarts: 0, attempts: {}, lastCumulativeUsd: 0.1, status: 'paused' };
  const { p2 } = second(fakePort(), snap, { engine: 'codex', decisions: decisions('separate', { reason: 'Codex has no sub-agents' }) });
  assert.deepEqual(p2.records.map((r) => r.kind), ['open', 'mode', 'degrade', 'restart']);
});
