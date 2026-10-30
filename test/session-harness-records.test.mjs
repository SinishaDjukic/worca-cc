// test/session-harness-records.test.mjs — what the harness does with a session's records: mirror, announce, persist.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineStateById, readPipeline } from '../src/core/artifacts.mjs';
import { costEvidence } from '../src/core/run-report.mjs';

useTempHome(after);
const SID = 's_aaaaaaaa';
function unit() {
  const o = createOrchestrator({ projectDir: join(tmpdir(), 'worca-sess-records'), claude: { mock: true } });
  o._persist = async () => {};
  const audits = []; o._sessionAudit = (l) => audits.push(l);
  const events = []; o.on('sessionHost', (e) => events.push(e));
  for (const k of ['x:n_a:1', 'x:n_b:1']) o.state.steps.push({ key: k, executionId: k, nodeId: k.split(':')[1], costUsd: 0 });
  return { o, audits, events };
}
const summary = { sid: SID, label: 'One session', engine: 'claude', mode: 'subagents', transport: 'turns', hostEpoch: 1, hostSessionId: 'H1', turns: 1, dispatches: 1, rotations: 0, restarts: 0, members: ['n_a', 'n_b'] };
const rec = (kind, f) => ({ v: 1, ts: '2026-10-28T10:00:00.000Z', seq: 1, kind, runId: 'p', sid: SID, hostEpoch: 1, hostSessionId: 'H1', ...f });

test('records mirror into state.sessionHosts and the sessionHost event; audits come from sessionAuditLine, reconcile once', () => {
  const { o, audits, events } = unit();
  o._onSessionRecord(SID, rec('open', { engine: 'claude', mode: 'subagents', transport: 'turns', members: ['n_a', 'n_b'], label: 'One session' }), summary);
  for (const t of ['t:1', 't:2']) o._onSessionRecord(SID, rec('reconcile', { turnId: t, ok: false, checks: [{ method: 'estimate', harnessUsd: 0.5, otherUsd: 0.7, tolerance: 0.075, ok: false }] }), summary);
  assert.deepEqual(o.state.sessionHosts[SID], summary);
  assert.deepEqual(events.map((e) => e.transition), ['open', 'reconcile', 'reconcile']);
  assert.equal(audits.length, 2, 'open + the first mismatch only');
});

test('C43 — member_bound persists, so a pause during the first turn keeps the host id', () => {
  const { o } = unit();
  let persisted = 0; o._persist = async () => { persisted += 1; };
  o._onSessionRecord(SID, rec('member_bound', { turnId: 't:1', dispatchId: 'd', memberAgentId: 'T1' }), summary);
  assert.equal(persisted, 1);
});

test('the row reference is stamped; the member sub-agent row carries memberOf and NO cost (C8)', () => {
  const { o } = unit();
  o.state.subAgents.push({ id: 'T1', stepKey: 'x:n_a:1', status: 'finished', tokens: 5700, costUsd: 0.5 });   // v5: a cost to drop, or the assert below is vacuous
  o._stampSessionRow('x:n_a:1', { sid: SID, hostEpoch: 1, hostSessionId: 'H1', turnId: 't:1', dispatchId: 'd:x:n_a:1:a1', attempt: 1, memberAgentId: 'T1', memberTranscriptId: 'ag-1', costSource: 'harness' });
  assert.deepEqual(o.state.steps[0].session, { sid: SID, hostEpoch: 1, hostSessionId: 'H1', turnId: 't:1', dispatchId: 'd:x:n_a:1:a1', attempt: 1, memberAgentId: 'T1', memberTranscriptId: 'ag-1', costSource: 'harness' });
  assert.equal(o.state.subAgents[0].memberOf, SID);
  assert.equal(o.state.subAgents[0].costUsd, undefined);
  assert.equal(o.state.subAgents[0].tokens, undefined);
  assert.equal('sessionHosts' in unit().o.getState(), false, 'an ungrouped run state is unchanged (C6)');
});

test('C39 — a queued member says so, and stops saying so', () => {
  const { o } = unit();
  o._onSessionQueue('x:n_b:1', true);
  assert.equal(o.state.steps[1].queued, true);
  o._onSessionQueue('x:n_b:1', false);
  assert.equal('queued' in o.state.steps[1], false);
});

test('log lines carry the session attr', () => {
  const { o } = unit();
  const lines = []; o.on('log', (e) => lines.push(e));
  o._log('session', 'info', 'handed Review to its sub-agent (turn 5)', { nodeId: 'n_b', session: SID });
  assert.equal(lines.at(-1).session, SID);
  assert.equal(lines.at(-1).source, 'session');
});

test('minor 14 — step.session and outcome.sessionHosts round-trip through the DB row', async () => {
  const o = createOrchestrator({ projectDir: gitDir('sess-rt'), prompt: 'demo', auto: true, claude: { mock: true } });
  assert.equal((await o.run()).status, 'done');                         // a plain run: its rows exist in the DB
  const st = o.getState();
  assert.equal('sessionHosts' in readPipelineStateById(st.id), false, 'v2: an ungrouped row has no sessionHosts (C6)');
  const step = st.steps.find((s) => s.executionId && s.status === 'done');
  o._stampSessionRow(step.key, { sid: SID, hostEpoch: 1, hostSessionId: 'H1', turnId: 't:1', dispatchId: 'd', attempt: 1, memberAgentId: 'T1', memberTranscriptId: 'ag-1', costSource: 'harness' });
  o.state.sessionHosts = { [SID]: summary };
  // v2: a row whose only exec_meta is its session ref still writes it (the hasMeta clause).
  o.state.steps.push({ key: 'x:n_only:1', executionId: 'x:n_only:1', nodeId: 'n_only', status: 'done', costUsd: 0,
    session: { sid: SID, hostEpoch: 1, hostSessionId: 'H1', turnId: 't:2', dispatchId: 'd2', attempt: 1, memberAgentId: null, memberTranscriptId: null, costSource: null } });
  o._persist = Object.getPrototypeOf(o)._persist.bind(o);
  await o._persist();
  const saved = readPipelineStateById(st.id);
  assert.deepEqual(saved.steps.find((s) => s.key === step.key).session, o.state.steps.find((s) => s.key === step.key).session);
  assert.deepEqual(saved.sessionHosts[SID], summary);
  assert.deepEqual(saved.steps.find((s) => s.key === 'x:n_only:1').session, o.state.steps.at(-1).session);
  assert.equal(saved.steps.filter((s) => s.session).length, 2, 'no other row gains a session ref');
  // v4: the audit path itself, on this real row (every other test stubs _sessionAudit).
  await o._sessionAudit('Session s_aaaaaaaa: closed.');
  assert.match((await readPipeline(o.projectDir, st.id)).auditMarkdown, /Session s_aaaaaaaa: closed\./);
});

test('C8 — run reports count investigators once and never the member dispatch', async () => {
  const subAgents = [{ id: 'T1', subagentType: 'worca-x-n_a-1-a1', costUsd: 0.5, tokens: 5700 }, { id: 'I1', subagentType: 'worca-investigator', costUsd: 0.03, tokens: 300 }];
  const r = costEvidence({ row: { id: 'p_none' }, steps: [], subAgents, workflow: null });   // the report always passes its row (costCapOverride reads row.id)
  assert.deepEqual(r.subAgentTotals, { count: 1, tokens: 300, costUsd: 0.03 });
});

// ── v2: the Interfaces sentences the master's tests leave open ──

test('v2 — a null record (append could not write) is skipped: no state, no event, no audit, no persist', () => {
  const { o, audits, events } = unit();
  let persisted = 0; o._persist = async () => { persisted += 1; };
  o._onSessionRecord(SID, null, summary);
  assert.deepEqual([('sessionHosts' in o.state), events.length, audits.length, persisted], [false, 0, 0, 0]);
});

test('v2 — exactly the persist kinds persist; the event carries the record\'s ids; each session gets its own first mismatch', () => {
  const { o, audits, events } = unit();
  let persisted = []; o._persist = async () => { persisted.push(1); };
  const kinds = { open: 1, mode: 0, degrade: 1, turn_start: 0, dispatch: 0, member_bound: 1, member_done: 0, turn_end: 1, cost: 0, reconcile: 0,
    watchdog: 0, rotate: 1, restart: 1, resume: 0, pause: 1, verdict: 0, close: 1 };
  for (const [kind, want] of Object.entries(kinds)) {
    persisted = [];
    o._onSessionRecord(SID, rec(kind, { turnId: 't:9', ok: true }), summary);
    assert.equal(persisted.length, want, kind);
  }
  const ev = events.find((e) => e.transition === 'member_bound');
  assert.deepEqual([ev.sid, ev.hostSessionId, ev.hostEpoch, ev.engine, ev.mode, ev.transport, ev.turnId], [SID, 'H1', 1, 'claude', 'subagents', 'turns', 't:9']);
  audits.length = 0;
  const bad = { turnId: 't:1', ok: false, checks: [{ method: 'hook', harnessUsd: 0.5, otherUsd: 0.6, tolerance: 0.01, ok: false }] };
  o._onSessionRecord(SID, rec('reconcile', bad), summary);
  o._onSessionRecord('s_bbbbbbbb', { ...rec('reconcile', bad), sid: 's_bbbbbbbb' }, { ...summary, sid: 's_bbbbbbbb' });
  o._onSessionRecord('s_bbbbbbbb', { ...rec('reconcile', bad), sid: 's_bbbbbbbb' }, { ...summary, sid: 's_bbbbbbbb' });
  assert.equal(audits.length, 2, 'once per session, not once per run');
  assert.deepEqual(Object.keys(o.state.sessionHosts), [SID, 's_bbbbbbbb']);
});

test('v2 — _sessionAudit appends to the pipeline\'s audit; with no pipeline it is a no-op', async () => {
  const o = createOrchestrator({ projectDir: join(tmpdir(), 'worca-sess-records2'), claude: { mock: true } });
  assert.doesNotThrow(() => o._sessionAudit('Session s_aaaaaaaa: closed.'));
});

test('v2 — a partial ref fills the rest with null; an unknown step is a no-op; the stamp is announced and persisted', () => {
  const { o } = unit();
  const states = []; o.on('state', (s) => states.push(s));
  let persisted = 0; o._persist = async () => { persisted += 1; };
  o._stampSessionRow('x:n_a:1', { sid: SID, hostEpoch: 1, hostSessionId: 'H1', turnId: 't:1', dispatchId: 'd', attempt: 1, memberAgentId: 'T9' });
  assert.deepEqual(o.state.steps[0].session, { sid: SID, hostEpoch: 1, hostSessionId: 'H1', turnId: 't:1', dispatchId: 'd', attempt: 1, memberAgentId: 'T9', memberTranscriptId: null, costSource: null });
  assert.deepEqual([states.length, persisted], [1, 1]);
  assert.equal(states[0].steps[0].session.turnId, 't:1');
  o._stampSessionRow('x:n_zz:1', { sid: SID });
  o._stampSessionRow('x:n_b:1', null);
  assert.deepEqual([states.length, persisted, 'session' in o.state.steps[1]], [1, 1, false]);
});

test('v2 — the member\'s spawn event keeps memberOf on its sub-agent record; an investigator\'s has none', () => {
  const { o } = unit();
  const attr = { stepKey: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a' };
  o._onAgentEvent('implementer', { type: 'subagent', event: 'spawn', toolUseId: 'T1', subagentType: 'worca-x-n_a-1-a1', label: 'Impl', memberOf: SID }, attr);
  o._onAgentEvent('implementer', { type: 'subagent', event: 'spawn', toolUseId: 'I1', subagentType: 'worca-investigator', label: 'look' }, attr);
  assert.equal(o.state.subAgents.find((s) => s.id === 'T1').memberOf, SID);
  assert.equal('memberOf' in o.state.subAgents.find((s) => s.id === 'I1'), false);
  o._onAgentEvent('implementer', { type: 'subagent', event: 'finish', toolUseId: 'T1' }, attr);
  assert.equal(o.state.subAgents.find((s) => s.id === 'T1').tokens, undefined, 'the synthetic finish (Task 40) carries no tokens');
});

test('v2 — queued on an unknown step is a no-op; each change is announced', () => {
  const { o } = unit();
  const states = []; o.on('state', (s) => states.push(s));
  o._onSessionQueue('x:n_zz:1', true);
  assert.equal(states.length, 0);
  o._onSessionQueue('x:n_a:1', true);
  assert.deepEqual([states.length, states[0].steps[0].queued], [1, true]);
  o._onSessionQueue('x:n_a:1', false);
  assert.deepEqual([states.length, 'queued' in states[1].steps[0]], [2, false], 'v4: clearing it is announced too');
});

test('v2 — the log copies a string session attr only', () => {
  const { o } = unit();
  const lines = []; o.on('log', (e) => lines.push(e));
  o._log('session', 'info', 'x', { nodeId: 'n_b' });
  o._log('session', 'info', 'y', { session: 7 });
  assert.deepEqual(lines.map((l) => 'session' in l), [false, false]);
});

test('v2 — the session port routes its records to these methods (Task 42 wiring)', () => {
  const { o, events } = unit();
  const port = o._sessionPort();
  port.onRecord(SID, rec('open', { mode: 'subagents' }), summary);
  port.stampRow('x:n_a:1', { sid: SID, turnId: 't:1' });
  port.onQueue('x:n_b:1', true);
  assert.deepEqual([events.length, o.state.steps[0].session.turnId, o.state.steps[1].queued], [1, 't:1', true]);
});

test('v2 — costEvidence: a member record by memberOf alone is skipped too; investigators keep their totals', () => {
  const r = costEvidence({ row: { id: 'p_none' }, steps: [], workflow: null, subAgents: [
    { subagentType: 'general-purpose', costUsd: 0.2, tokens: 100, memberOf: SID }, { subagentType: 'general-purpose', costUsd: 0.1, tokens: 50 }] });
  assert.deepEqual(r.subAgentTotals, { count: 1, tokens: 50, costUsd: 0.1 });
});
