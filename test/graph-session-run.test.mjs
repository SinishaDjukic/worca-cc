// test/graph-session-run.test.mjs — a whole run with one session, offline: the seam, rows, events, trace, kill switch.
import { test, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { tracePath, readTrace } from '../src/core/session-trace.mjs';
import { runAgentExecution, memberInfo, _testing as execT } from '../src/core/graph/executor.mjs';
import { _testing as mockT } from '../src/core/engines/mock-session.mjs';
import { skillSetFixture } from './helpers/skill-sets.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';

useTempHome(after);
const SID = 's_aaaaaaaa';
before(async () => {
  process.env.WORCA_FLAGS = 'sessionGroups';
  const t = structuredClone(SEED_TEMPLATES.find((s) => s.id === 'wf_quick-fix'));
  for (const id of ['n_impl', 'n_review']) t.nodes.find((n) => n.id === id).config.session = SID;
  await writeGraphWorkflow({ ...t, id: 'wf_sess_run', name: 'Sess run' });
});
beforeEach(() => { mockT.resetSessions(); mockT.behave = null; delete process.env.WORCA_SESSIONS_DISABLE; });
after(() => { delete process.env.WORCA_FLAGS; });

test('a grouped quick-fix run completes; members carry the session; the non-member does not', { timeout: 120000 }, async () => {
  const execs = [];
  const orch = createOrchestrator({ projectDir: gitDir('sessrun'), workflowId: 'wf_sess_run', prompt: 'demo', auto: true, claude: { mock: true } });
  orch.on('exec', (e) => execs.push(e));
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  const st = orch.getState();
  const members = st.steps.filter((s) => s.nodeId === 'n_impl' || s.nodeId === 'n_review');
  assert.ok(members.length >= 2);
  for (const s of members) {
    assert.equal(s.session.sid, SID);
    assert.match(s.sessionId, /^mock-host-/);
    assert.equal(s.sessionId, s.session.hostSessionId);
  }
  assert.equal(st.steps.find((s) => s.nodeId === 'n_plan').session, undefined);
  assert.ok(execs.filter((e) => e.nodeId === 'n_review').every((e) => e.sid === SID));
  assert.equal(execs.find((e) => e.nodeId === 'n_plan').sid, undefined);
  assert.equal(st.sessionHosts[SID].dispatches, members.length);
  assert.equal(st.sessionHosts[SID].status, 'done');
  const { records } = await readTrace(tracePath(st.pipelineDir, SID));
  assert.equal(records.at(-1).kind, 'close');
});

test('C36 — the kill switch is a hard bypass: no host, no trace, no sid, ungrouped state shape', { timeout: 120000 }, async () => {
  process.env.WORCA_SESSIONS_DISABLE = '1';
  const execs = [];
  const orch = createOrchestrator({ projectDir: gitDir('sesskill'), workflowId: 'wf_sess_run', prompt: 'demo', auto: true, claude: { mock: true } });
  orch.on('exec', (e) => execs.push(e));
  assert.equal((await orch.run()).status, 'done');
  const st = orch.getState();
  assert.equal('sessionHosts' in st, false);
  assert.ok(st.steps.every((s) => s.session === undefined));
  assert.ok(execs.every((e) => e.sid === undefined));
  assert.equal(existsSync(join(st.pipelineDir, 'sessions')), false);
});

test('M-4 — a managed --plugin-dir refusal inside a host drops the skills and retries, exactly as ungrouped', { timeout: 120000 }, async () => {
  mockT.behave = ({ hostOpts }) => (hostOpts.pluginDirs?.length ? 'sideload-refused' : null);
  const { dir } = await skillSetFixture();                                 // a project whose run mounts one set plugin (test/skills-pipeline-sideload.test.mjs)
  const orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_sess_run', prompt: 'demo', auto: true, claude: { mock: true } });
  assert.equal((await orch.run()).status, 'done');
  assert.deepEqual(orch.skillLayer.pluginDirs, [], 'onSkillSideloadRefused ran');
  const impl = mockT.seen.filter((s) => s.agentType.startsWith('worca-x-n_impl-1-'));
  assert.deepEqual(impl.map((s) => Boolean(s.pluginDirs?.length)), [true, false], 'the retry went out without --plugin-dir');
});

test('the seam: with ctx.sessionHost the executor hands its runOpts to the host and never calls runClaude', async () => {
  let called = null; execT.runClaude = () => { throw new Error('runClaude must not run'); };
  try {
    const host = { mode: 'subagents', run: async (opts, member) => { called = { opts, member }; return { text: 'R', exitCode: 0 }; } };
    const { agentCtx } = await import('./helpers/graph-run.mjs');
    const ctx = { ...(await agentCtx('planner')), sessionHost: host, sessionMode: 'subagents' };
    const out = await runAgentExecution(ctx);
    assert.equal(out.summary, 'R');
    assert.equal(called.member.executionId, ctx.executionId);
    assert.match(called.member.label, / · cycle \d+$/);
    assert.equal(typeof called.opts.prompt, 'string');
    // v2 — memberInfo(full): every field, C26 reads model and effort (null when the node pins none).
    assert.deepEqual(called.member, { nodeId: 'n_planner', executionId: 'x:n_planner:1', ordinal: 1, label: 'Plan · cycle 1', model: null, effort: null, fanOut: true });
    const base = await agentCtx('implementer');
    const pinned = { ...base, node: { ...base.node, fanOut: false }, ordinal: 2, claudeOpts: { mock: true, model: 'claude-sonnet-4-6', effort: 'high' }, sessionHost: host, sessionMode: 'subagents' };
    await runAgentExecution(pinned);
    assert.deepEqual([called.member.ordinal, called.member.label, called.member.model, called.member.effort, called.member.fanOut], [2, 'Implementation · cycle 2', 'claude-sonnet-4-6', 'high', false]);
    assert.equal(called.opts.model, 'claude-sonnet-4-6', 'the runOpts reach the host unchanged');
  } finally { execT.runClaude = null; }
});

test('v2 — C27: with the Labs flag off a session still has a host object and a short trace; its members run plain', { timeout: 120000 }, async () => {
  process.env.WORCA_FLAGS = '';
  const execs = [];
  try {
    const orch = createOrchestrator({ projectDir: gitDir('sessoff'), workflowId: 'wf_sess_run', prompt: 'demo', auto: true, claude: { mock: true } });
    orch.on('exec', (e) => execs.push(e));
    assert.equal((await orch.run()).status, 'done');
    const st = orch.getState();
    const { records } = await readTrace(tracePath(st.pipelineDir, SID));
    assert.deepEqual(records.map((r) => r.kind), ['open', 'mode', 'degrade', 'close']);
    assert.equal(st.sessionHosts[SID].status, 'done');
    assert.ok(st.steps.every((s) => s.session === undefined));
    assert.equal(mockT.seen.length, 0, 'no host turn');
    const rev = execs.filter((e) => e.nodeId === 'n_review');
    assert.ok(rev.length && rev.every((e) => e.sid === SID && e.sessionMode === 'separate'));
  } finally { process.env.WORCA_FLAGS = 'sessionGroups'; }
});

test('v2 — exec events name the live mode; a ×N slice runs outside the session and names none (D2)', { timeout: 180000 }, async () => {
  const t = structuredClone(SEED_TEMPLATES.find((s) => s.id === 'wf_no-clarify'));
  for (const id of ['n_decompose', 'n_impl', 'n_review']) t.nodes.find((n) => n.id === id).config.session = SID;
  await writeGraphWorkflow({ ...t, id: 'wf_sess_slices', name: 'Sess slices' });
  const execs = [];
  const orch = createOrchestrator({ projectDir: gitDir('sessslices'), workflowId: 'wf_sess_slices', prompt: 'demo', auto: true, claude: { mock: true } });
  orch.on('exec', (e) => execs.push(e));
  assert.equal((await orch.run()).status, 'done');
  const slices = execs.filter((e) => e.kind === 'task');
  assert.ok(slices.length > 0, 'the implementer fanned out');
  assert.ok(slices.every((e) => e.sid === undefined && e.sessionMode === undefined));
  const members = execs.filter((e) => e.kind !== 'task' && ['n_decompose', 'n_review'].includes(e.nodeId));
  assert.ok(members.length && members.every((e) => e.sid === SID && e.sessionMode === 'subagents'));
  const st = orch.getState();
  const sliceIds = new Set(slices.map((e) => e.executionId));
  const sliceRows = st.steps.filter((s) => sliceIds.has(s.executionId));
  assert.ok(sliceRows.length > 0 && sliceRows.every((s) => s.session === undefined), 'no slice row ran in the host');
  assert.ok(mockT.seen.every((x) => ![...sliceIds].some((id) => x.agentType === `worca-${id.replace(/[^A-Za-z0-9_-]+/g, '-')}-a1`)));
});

test('v2 — _sessionOutcome: the run\'s own end, for close()', () => {
  const o = createOrchestrator({ projectDir: gitDir('sessout'), claude: { mock: true } });
  assert.equal(o._sessionOutcome('done'), 'done');
  assert.equal(o._sessionOutcome('paused'), 'paused');
  assert.equal(o._sessionOutcome('error', new Error('x')), 'paused', 'a non-terminal failure ends the run paused (_pauseForFailure)');
  assert.equal(o._sessionOutcome(undefined, new Error('thrown')), 'paused');
  const term = Object.assign(new Error('t'), {});
  term[Symbol.for('worca.failure.terminal')] = true;
  assert.equal(o._sessionOutcome('error', term), 'error');
  o._graphError = term;
  assert.equal(o._sessionOutcome('error'), 'error', 'the recorded graph error counts');
  o.pauseRequested = true;
  assert.equal(o._sessionOutcome('done'), 'paused', 'D17: a pause on a straggler');
  assert.equal(o._sessionOutcome('error', term), 'paused', 'a requested pause wins over a failure');
  o.abort.abort();
  assert.equal(o._sessionOutcome('paused'), 'stopped', 'Stop wins');
});

test('v2 — C30: a session degraded by repeated no-dispatch turns runs its retry plain, through the executor\'s runner', { timeout: 180000 }, async () => {
  mockT.behave = ({ agentType }) => (agentType.startsWith('worca-x-n_impl-1-') ? 'no-dispatch' : null);
  const plain = [];
  const execs = [];
  execT.runClaude = async (opts) => { plain.push(opts); return runClaude(opts); };
  try {
    const orch = createOrchestrator({ projectDir: gitDir('sessdeg'), workflowId: 'wf_sess_run', prompt: 'demo', auto: true, claude: { mock: true } });
    orch.on('exec', (e) => execs.push(e));
    assert.equal((await orch.run()).status, 'done');
    const st = orch.getState();
    const { records } = await readTrace(tracePath(st.pipelineDir, SID));
    const deg = records.filter((r) => r.kind === 'degrade');
    assert.deepEqual(deg.map((r) => [r.from, r.to, r.reason]), [['subagents', 'separate', 'the main agent did not dispatch']]);
    assert.ok(plain.some((o) => /MOCK_ROLE: implementer/.test(o.prompt)), 'the retry ran plain, through executor._testing.runClaude');
    assert.equal(st.sessionHosts[SID].mode, 'separate');
    // v3 — the exec events name the LIVE mode (modeOf): Implementation started in the session, Review ran after the degrade.
    assert.equal(execs.find((e) => e.nodeId === 'n_impl').sessionMode, 'subagents');
    const rev = execs.filter((e) => e.nodeId === 'n_review');
    assert.ok(rev.length && rev.every((e) => e.sid === SID && e.sessionMode === 'separate'), JSON.stringify(rev.map((e) => e.sessionMode)));
  } finally { execT.runClaude = null; }
});

test('v3 — memberInfo\'s fallbacks: the node key, then the node id, then "Agent"; cycle 1; ids from the node', () => {
  assert.deepEqual(memberInfo({ executionId: 'x:n_k:1', node: { id: 'n_k', key: 'k' } }),
    { nodeId: 'n_k', executionId: 'x:n_k:1', ordinal: 1, label: 'k · cycle 1', model: null, effort: null, fanOut: false });
  assert.deepEqual(memberInfo({ executionId: 'x:n_k:2', nodeId: 'n_z', ordinal: 2 }),
    { nodeId: 'n_z', executionId: 'x:n_k:2', ordinal: 2, label: 'n_z · cycle 2', model: null, effort: null, fanOut: false });
  assert.deepEqual(memberInfo(null), { nodeId: null, executionId: undefined, ordinal: 1, label: 'Agent · cycle 1', model: null, effort: null, fanOut: false });
});

test('v4 — a failure that pauses the run while a member\'s host turn is in flight: the turn is cut at once and held, as a pause cuts an ungrouped step', { timeout: 120000 }, async () => {
  mockT.behave = ({ agentType }) => (agentType.startsWith('worca-x-n_impl-1-') ? 'hang' : null);
  const orch = createOrchestrator({ projectDir: gitDir('sessfailcut'), workflowId: 'wf_sess_run', prompt: 'demo', auto: true, claude: { mock: true } });
  // A non-terminal failure while the member works: an ask the night fallback refuses aborts the scheduler (_schedulerAsk).
  mockT.onMemberStart = ({ agentType }) => { if (agentType.startsWith('worca-x-n_impl-1-')) queueMicrotask(() => orch._scheduler?.abort()); };
  let timer;
  let res;
  try {
    res = await Promise.race([orch.run(), new Promise((r) => { timer = setTimeout(() => r({ status: 'still running' }), 10000); })]);
    if (res.status === 'still running') orch.stop();
  } finally { clearTimeout(timer); mockT.onMemberStart = null; }
  assert.equal(res.status, 'paused', 'the run pauses at once, as the ungrouped run does');
  const st = orch.getState();
  // The failure's own reason, as ungrouped; a plain AbortError would re-pause the run with the detail 'aborted'.
  assert.deepEqual([st.pauseReason, st.pauseDetail], ['error', 'a graph execution failed']);
  assert.equal(st.steps.find((s) => s.key === 'x:n_impl:1').status, 'paused', 'the cut member is resumable');
  const { records } = await readTrace(tracePath(st.pipelineDir, SID));
  const hung = records.find((r) => r.kind === 'dispatch' && r.executionId === 'x:n_impl:1');
  assert.equal(records.find((r) => r.kind === 'turn_end' && r.turnId === hung.turnId).exit, 'aborted');
  assert.deepEqual([records.at(-1).kind, records.at(-1).turnId], ['pause', hung.turnId], 'its cut is held for the resumed turn (C9)');
  assert.equal(orch._sessions.hosts.get(SID).openCut.turnId, hung.turnId, 'the closed host keeps it for the snapshot');
});

test('v4 — no session: no host object, no new ctx key, no resume-point key (the ungrouped shape)', { timeout: 120000 }, async () => {
  await writeGraphWorkflow({ ...structuredClone(SEED_TEMPLATES.find((s) => s.id === 'wf_quick-fix')), id: 'wf_sess_none', name: 'Sess none' });
  const orch = createOrchestrator({ projectDir: gitDir('sessnone'), workflowId: 'wf_sess_none', prompt: 'demo', auto: true, claude: { mock: true } });
  const ctxs = [];
  const points = [];
  const execCtx = orch._execCtx.bind(orch);
  orch._execCtx = (...a) => { const c = execCtx(...a); ctxs.push(c); return c; };
  const build = orch._buildResumePoint.bind(orch);
  orch._buildResumePoint = (...a) => { const p = build(...a); points.push(p); return p; };
  assert.equal((await orch.run()).status, 'done');
  assert.equal(orch._sessions, null);
  assert.ok(ctxs.length > 0 && points.length > 0);
  assert.ok(ctxs.every((c) => !('sessionHost' in c) && !('sessionMode' in c) && !('coldRedispatch' in c)));
  assert.ok(points.every((p) => !('sessionHosts' in p)));
});
