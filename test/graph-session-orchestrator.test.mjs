// test/graph-session-orchestrator.test.mjs — the orchestrator never hides a host failure, and never resumes a host transcript as a plain spawn.
import { test, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { createOrchestrator, verdictSummary } from '../src/core/orchestrator.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { SessionHostError } from '../src/core/engines/session-dispatch.mjs';
import { tracePath, readTrace } from '../src/core/session-trace.mjs';
import { _testing as mockT } from '../src/core/engines/mock-session.mjs';
import { createSessionHosts } from '../src/core/session-host.mjs';
import { fakePort, spec, decisions, gatedTransport, memberOpts, member } from './helpers/session-host-fakes.mjs';

useTempHome(after);
const SID = 's_aaaaaaaa';
const NODE = { id: 'n_impl', kind: 'agent', key: 'implementer' };
function unit() {
  const o = createOrchestrator({ projectDir: join(tmpdir(), 'worca-sess-orch'), claude: { mock: true } });
  o._persist = async () => {};
  o.pipeline = { id: 'p_sess_orch', dir: mkdtempSync(join(tmpdir(), 'worca-sess-orch-p-')) };
  const logs = []; o.on('log', (l) => logs.push(l));
  return Object.assign(o, { logs });
}
before(async () => {
  process.env.WORCA_FLAGS = 'sessionGroups';
  const t = structuredClone(SEED_TEMPLATES.find((s) => s.id === 'wf_quick-fix'));
  for (const id of ['n_impl', 'n_review']) t.nodes.find((n) => n.id === id).config.session = SID;
  await writeGraphWorkflow({ ...t, id: 'wf_sess_orch', name: 'Sess orch' });
});
beforeEach(() => { mockT.resetSessions(); mockT.behave = null; });
after(() => { delete process.env.WORCA_FLAGS; });

test('C29 / critique C-1 — a hosted re-dispatch that fails is rethrown to recovery; no fresh re-run, no audit line', async () => {
  const o = unit();
  let runs = 0;
  o._runners = { producer: async () => { runs += 1; throw new SessionHostError('SESSION_HOST_NO_DISPATCH', 'the main agent answered without dispatching'); } };
  const ctx = { node: NODE, nodeId: 'n_impl', executionId: 'x:n_impl:1', ordinal: 1, resumeSessionId: 'mock-host-1', sessionHost: { mode: 'subagents' }, sessionMode: 'subagents' };
  await assert.rejects(o._runOnce({ key: 'implementer', kind: 'agent' }, ctx), (e) => e.code === 'SESSION_HOST_NO_DISPATCH');
  assert.equal(runs, 1);
  assert.equal(ctx.resumeSessionId, 'mock-host-1', 'kept: the next attempt still gets the cold header');
  assert.equal(o.logs.some((l) => /session resume failed/.test(l.text)), false, 'no fallback warn (and so no "Resume fallback" audit line; Task 47 reads the audit end to end)');
});

test('ungrouped: the resume fallback is unchanged', async () => {
  const o = unit();
  let runs = 0;
  o._runners = { producer: async () => { runs += 1; if (runs === 1) throw new Error('No conversation found with session ID: x'); return { summary: 'ok' }; } };
  const ctx = { node: NODE, nodeId: 'n_impl', executionId: 'x:n_impl:1', ordinal: 1, resumeSessionId: 'S' };
  assert.deepEqual(await o._runOnce({ key: 'implementer', kind: 'agent' }, ctx), { summary: 'ok' });
  assert.equal(runs, 2);
  assert.equal(ctx.resumeSessionId, undefined);
  assert.equal(o.logs.filter((l) => /session resume failed .*re-running the execution fresh/.test(l.text)).length, 1);
});

test('C42 / critique M-13 — a paused member whose session now runs separate starts fresh, cold, never --resume <host>', () => {
  const o = unit();
  o._resumeSessions = new Map([['x:n_impl:1', 'mock-host-1']]);
  o.resumeOpts = { steps: [{ key: 'x:n_impl:1', status: 'paused', sessionId: 'mock-host-1', session: { sid: SID, hostSessionId: 'mock-host-1' } }] };
  o._sessions = { hostFor: () => null, sidOf: () => SID, modeOf: () => 'separate' };
  const r = o._reattachFor('x:n_impl:1', 'n_impl');
  assert.deepEqual(r, { resumeSessionId: undefined, coldRedispatch: true });
  assert.equal(o._resumeSessions.has('x:n_impl:1'), false, 'one-shot: consumed');
  o._resumeSessions = new Map([['x:n_impl:1', 'mock-host-1']]);
  o._sessions = { hostFor: () => ({ mode: 'subagents' }), sidOf: () => SID, modeOf: () => 'subagents' };
  assert.deepEqual(o._reattachFor('x:n_impl:1', 'n_impl'), { resumeSessionId: 'mock-host-1', coldRedispatch: false });
  o._resumeSessions = new Map([['x:n_impl:1', 'mock-host-1']]);
  o._sessions = { hostFor: () => ({ mode: 'shared' }), sidOf: () => SID, modeOf: () => 'shared' };
  assert.deepEqual(o._reattachFor('x:n_impl:1', 'n_impl'), { resumeSessionId: 'mock-host-1', coldRedispatch: false }, 'shared resumes its conversation');
  o._resumeSessions = new Map([['x:n_impl:1', 'mock-host-1']]);
  o._sessions = { hostFor: () => ({ mode: 'separate', keepPlainSession: () => assert.fail('a host id is never a plain session') }), sidOf: () => SID, modeOf: () => 'separate' };
  assert.deepEqual(o._reattachFor('x:n_impl:1', 'n_impl'), { resumeSessionId: undefined, coldRedispatch: true }, 'a runtime degrade');
  o._resumeSessions = new Map([['x:n_impl:1', 'mock-host-1']]);
  o.resumeOpts = { steps: [{ key: 'x:n_impl:1', status: 'paused', sessionId: 'mock-host-1' }] };   // no step.session (an old row): the restore names the host id
  o._sessionRestore = { [SID]: { sid: SID, hostSessionId: 'mock-host-1' } };
  o._sessions = null;                                                   // the kill switch
  assert.deepEqual(o._reattachFor('x:n_impl:1', 'n_impl'), { resumeSessionId: undefined, coldRedispatch: true });
  o._sessionRestore = null;
  o._resumeSessions = new Map([['x:n_plan:1', 'S-plain']]);
  o.resumeOpts = { steps: [{ key: 'x:n_plan:1', status: 'paused', sessionId: 'S-plain' }] };
  o._sessions = null;
  assert.deepEqual(o._reattachFor('x:n_plan:1', 'n_plan'), { resumeSessionId: 'S-plain', coldRedispatch: false }, 'an ungrouped row re-attaches as today');
  assert.deepEqual(o._reattachFor('x:n_plan:1', 'n_plan'), { resumeSessionId: undefined, coldRedispatch: false }, 'nothing to re-attach a second time');
});

test('C42 / C30 — a degraded member\'s own plain session is its own: re-attached, and its host may resume it', () => {
  const o = unit();
  const kept = [];
  o._resumeSessions = new Map([['x:n_impl:1', 'P-own']]);
  o.resumeOpts = { steps: [{ key: 'x:n_impl:1', status: 'paused', sessionId: 'P-own', session: { sid: SID, hostSessionId: 'mock-host-1' } }] };
  o._sessionRestore = { [SID]: { sid: SID, hostSessionId: 'mock-host-1', mode: 'separate' } };
  o._sessions = { hostFor: () => ({ mode: 'separate', keepPlainSession: (id) => kept.push(id) }) };
  assert.deepEqual(o._reattachFor('x:n_impl:1', 'n_impl'), { resumeSessionId: 'P-own', coldRedispatch: false });
  assert.deepEqual(kept, ['P-own']);
  o._resumeSessions = new Map([['x:n_impl:1', 'P-own']]);
  o._sessions = { hostFor: () => ({ mode: 'subagents', keepPlainSession: (id) => kept.push(`live:${id}`) }) };
  assert.deepEqual(o._reattachFor('x:n_impl:1', 'n_impl'), { resumeSessionId: 'P-own', coldRedispatch: false });
  assert.deepEqual(kept, ['P-own'], 'a live host is told nothing');
});

test('the resume point carries the host snapshots only when a session exists', () => {
  const o = unit();
  assert.equal('sessionHosts' in o._buildResumePoint(null), false);
  o._sessions = { snapshot: () => ({ [SID]: { sid: SID, hostEpoch: 1, hostSessionId: 'H1', lastCumulativeUsd: 0.5 } }) };
  assert.deepEqual(o._buildResumePoint(null).sessionHosts, { [SID]: { sid: SID, hostEpoch: 1, hostSessionId: 'H1', lastCumulativeUsd: 0.5 } });
});

test('v2 — _closeSessions closes with the run\'s outcome, then refreshes the last snapshot point _pauseForFailure reuses', async () => {
  const o = unit();
  const closed = [];
  o._sessions = { close: async (x) => { closed.push(x); }, snapshot: () => ({ [SID]: { sid: SID, status: 'paused' } }) };
  o.state.resumePoint = { version: 2, snapshot: null, sessionHosts: { [SID]: { sid: SID, status: 'busy' } } };
  await o._closeSessions('error', new Error('not terminal'));
  assert.deepEqual(closed, ['paused']);
  assert.deepEqual(o.state.resumePoint, { version: 2, snapshot: null, sessionHosts: { [SID]: { sid: SID, status: 'paused' } } });
  o.state.resumePoint = null;
  await o._closeSessions('done');
  assert.deepEqual(closed, ['paused', 'done']);
  assert.equal(o.state.resumePoint, null, 'no point, nothing to refresh');
});

test('C5 — verdictSummary keeps counts only', () => {
  assert.deepEqual(verdictSummary(null), { verdict: 'none', issues: 0 });
  assert.deepEqual(verdictSummary({ issues: [] }), { verdict: 'clean', issues: 0 });
  assert.deepEqual(verdictSummary({ issues: [{ severity: 'minor', title: 'x' }] }), { verdict: 'clean', issues: 1 });
  assert.deepEqual(verdictSummary({ issues: [{ severity: 'minor' }, { severity: 'major' }] }), { verdict: 'blocking', issues: 2 });
  assert.deepEqual(verdictSummary({ issues: [{ severity: 'critical' }] }), { verdict: 'blocking', issues: 1 });
});

test('C5 — a grouped run writes one verdict record per hosted execution, on its latest dispatch', { timeout: 120000 }, async () => {
  const orch = createOrchestrator({ projectDir: gitDir('sessorch'), workflowId: 'wf_sess_orch', prompt: 'demo', auto: true, claude: { mock: true } });
  const routed = new Map();                                              // what the scheduler routed on (scheduler.mjs exec 'done')
  orch.on('exec', (e) => { if (e.status === 'done' && e.verdict) routed.set(e.executionId, e.verdict.hasBlocking ? 'blocking' : 'clean'); });
  assert.equal((await orch.run()).status, 'done');
  const st = orch.getState();
  const { records } = await readTrace(tracePath(st.pipelineDir, SID));
  const verdicts = records.filter((r) => r.kind === 'verdict');
  const hosted = st.steps.filter((s) => s.session?.sid === SID);
  assert.deepEqual(verdicts.map((v) => v.executionId).sort(), hosted.map((s) => s.executionId).sort());
  for (const v of verdicts) {
    const dispatches = records.filter((r) => r.kind === 'dispatch' && r.executionId === v.executionId);
    assert.equal(v.dispatchId, dispatches.at(-1).dispatchId);
    assert.equal(v.verdict, v.nodeId === 'n_review' ? routed.get(v.executionId) : 'none', `${v.executionId}: the routed verdict; the implementer has none`);
  }
  assert.ok(verdicts.some((v) => v.verdict === 'blocking') && verdicts.some((v) => v.verdict === 'clean'), 'the mock review loop: a blocking round, then a clean one');
  assert.equal(records.some((r) => r.kind === 'verdict' && r.nodeId === 'n_plan'), false, 'a non-member writes none');
});

test('v3 — C29 / C30: a member of a degraded session runs plain and keeps the resume fallback; hosted is decided before the attempt', async () => {
  const o = unit();
  let runs = 0;
  o._runners = { producer: async () => { runs += 1; if (runs === 1) throw new Error('No conversation found with session ID: P'); return { summary: 'ok' }; } };
  const ctx = { node: NODE, nodeId: 'n_impl', executionId: 'x:n_impl:1', ordinal: 1, resumeSessionId: 'P', sessionHost: { mode: 'separate', resumesPlain: (id) => id === 'P' }, sessionMode: 'subagents' };
  assert.deepEqual(await o._runOnce({ key: 'implementer', kind: 'agent' }, ctx), { summary: 'ok' });
  assert.equal(runs, 2, 'its own lost session re-runs fresh, as ungrouped');
  assert.equal(ctx.resumeSessionId, undefined);
  assert.equal(o.logs.filter((l) => /session resume failed .*re-running the execution fresh/.test(l.text)).length, 1);
  // A host that degrades DURING the attempt still owned it: no fallback (Review Focus 1 goes through _recover).
  const host = { mode: 'subagents' };
  const p = unit();
  let n = 0;
  p._runners = { producer: async () => { n += 1; host.mode = 'separate'; throw new SessionHostError('SESSION_HOST_NO_DISPATCH', 'no dispatch'); } };
  const c2 = { node: NODE, nodeId: 'n_impl', executionId: 'x:n_impl:1', ordinal: 1, resumeSessionId: 'mock-host-1', sessionHost: host, sessionMode: 'subagents' };
  await assert.rejects(p._runOnce({ key: 'implementer', kind: 'agent' }, c2), (e) => e.code === 'SESSION_HOST_NO_DISPATCH');
  assert.equal(n, 1);
  assert.equal(p.logs.some((l) => /session resume failed/.test(l.text)), false);
  // v4 — after a degrade the plain run is handed the HOST id (C29 keeps it for the cold header); it drops it, so nothing
  // was resumed: a failure of that fresh spawn goes to _recover, never through the fallback (no audit line, the header kept).
  const q = unit();
  let m = 0;
  q._runners = { producer: async () => { m += 1; throw Object.assign(new Error('overloaded'), { errorClass: 'rate_limit' }); } };
  const c3 = { node: NODE, nodeId: 'n_impl', executionId: 'x:n_impl:1', ordinal: 1, resumeSessionId: 'mock-host-1',
    sessionHost: { mode: 'separate', resumesPlain: () => false }, sessionMode: 'separate' };
  await assert.rejects(q._runOnce({ key: 'implementer', kind: 'agent' }, c3), /overloaded/);
  assert.equal(m, 1);
  assert.equal(c3.resumeSessionId, 'mock-host-1');
  assert.equal(q.logs.some((l) => /session resume failed/.test(l.text)), false);
});

test('v4 — C30: resumesPlain is true only for a plain session the degraded host started or was handed', async () => {
  const { createSessionHosts } = await import('../src/core/session-host.mjs');
  const { fakePort, spec, decisions } = await import('./helpers/session-host-fakes.mjs');
  const host = createSessionHosts({ specs: [spec()], decisions: decisions('separate'), port: fakePort() }).hosts.get(SID);
  assert.equal(host.resumesPlain('P'), false);
  host.keepPlainSession('P');
  assert.deepEqual([host.resumesPlain('P'), host.resumesPlain('mock-host-1'), host.resumesPlain(undefined)], [true, false, false]);
});

test('v3 — C42 / C30: a member that only ever ran plain in a degraded session (no step.session) keeps its own session too', () => {
  const o = unit();
  const kept = [];
  o._resumeSessions = new Map([['x:n_review:1', 'P-review']]);
  o.resumeOpts = { steps: [{ key: 'x:n_review:1', status: 'paused', sessionId: 'P-review' }] };
  o._sessionRestore = { [SID]: { sid: SID, hostSessionId: 'mock-host-1', mode: 'separate' } };
  o._sessions = { hostFor: () => ({ mode: 'separate', keepPlainSession: (id) => kept.push(id) }) };
  assert.deepEqual(o._reattachFor('x:n_review:1', 'n_review'), { resumeSessionId: 'P-review', coldRedispatch: false });
  assert.deepEqual(kept, ['P-review'], 'its plain run may resume it, as ungrouped');
  o._resumeSessions = new Map([['x:n_plan:1', 'P-plan']]);
  o._sessions = { hostFor: () => null };
  assert.deepEqual(o._reattachFor('x:n_plan:1', 'n_plan'), { resumeSessionId: 'P-plan', coldRedispatch: false }, 'a non-member: as today');
});

test('v3 — C5: a verdict noted after close writes nothing (close waited for the turn; close stays the last record)', async () => {
  const g = gatedTransport(); const port = fakePort();
  const hosts = createSessionHosts({ specs: [spec()], decisions: decisions(), port, transport: g.transport });
  const host = hosts.hostFor('n_a');
  const run = host.run(memberOpts(), member('n_a'));
  await new Promise((r) => setImmediate(r));
  g.ok(0); await run;
  host.noteVerdict('x:n_a:1', { verdict: 'clean', issues: 0 });
  assert.equal(port.records.filter((r) => r.kind === 'verdict').length, 1, 'before close: written');
  await hosts.close('done');
  host.noteVerdict('x:n_a:1', { verdict: 'blocking', issues: 1 });
  assert.equal(port.records.at(-1).kind, 'close');
  assert.equal(port.records.filter((r) => r.kind === 'verdict').length, 1);
});

test('v3 — C30 / C42: a degraded host resumes only a plain session it was told is its own (keepPlainSession)', async () => {
  const plain = [];
  const hosts = createSessionHosts({ specs: [spec()], decisions: decisions(), port: fakePort(), transport: gatedTransport().transport,
    plainRun: async (o) => { plain.push(o.resumeSessionId); return { text: 'P', exitCode: 0 }; } });
  const host = hosts.hostFor('n_a');
  host._degrade('the main agent did not dispatch');
  host.keepPlainSession('P-own'); host.keepPlainSession(''); host.keepPlainSession(null);
  assert.deepEqual([...host.plainSessions], ['P-own'], 'only a real id is kept');
  await host.run({ ...memberOpts(), resumeSessionId: 'P-own' }, member('n_a'));
  await host.run({ ...memberOpts(), resumeSessionId: 'mock-host-1' }, member('n_a', 2));
  assert.deepEqual(plain, ['P-own', undefined], 'its own session resumes; a host transcript never does (C30)');
});
