// test/ui-run-sessions-view.test.mjs — one card per session: who ran, what each step cost, and whether it adds up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderSessionCard, sessionsTabVisible, sessionsBadge, outsideRows, renderOutsideCard, paintSessions, paintSessionsTab, membersUsdOf, _resetSessionsCache } from '../ui/public/run-sessions-view.mjs';
import { decorFromState } from '../ui/public/graph/run-decor.mjs';
import { SESSION_STEPPER, groupedRunningState } from './helpers/session-run-state.mjs';
import { bootApp, helloRun } from './helpers/run-page-boot.mjs';
import { bootDetail, openDetail, settle, DETAIL, ROW, ok } from './helpers/history-detail-boot.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const SID = 's_aaaaaaaa';
const S = { sid: SID, label: 'Build and review', mode: 'subagents', transport: 'turns', engine: 'claude', hostModel: 'claude-haiku-4-5', hostSessionId: 'b1f0c2', hostEpoch: 1, integrity: { torn: 0, invalid: 0, seqGaps: 0 },
  status: 'closed', turns: 2, turnRows: [
    { turnId: `t:${SID}:1`, dispatchId: 'd:x:n_impl:1:a1', executionId: 'x:n_impl:1', nodeId: 'n_impl', attempt: 1, memberAgentId: 'T1', startedAt: '2026-10-28T10:42:01.000Z',
      durationMs: 241000, tokens: { in: 5000, out: 700, cr: 120000, cw: 0 }, memberUsd: 1.70, hostOverheadUsd: 0.03, costSource: 'harness', verdict: 'none', issues: 0, reconcileOk: true, memberTranscriptId: 'ag-1', carriedUsd: 0 },
    { turnId: `t:${SID}:2`, dispatchId: 'd:x:n_review:1:a1', executionId: 'x:n_review:1', nodeId: 'n_review', attempt: 1, memberAgentId: 'T2', startedAt: '2026-10-28T10:46:02.000Z',
      durationMs: 131000, tokens: { in: 3000, out: 400, cr: 0, cw: 0 }, memberUsd: 0.65, hostOverheadUsd: 0.03, costSource: 'harness', verdict: 'blocking', issues: 2, reconcileOk: false, memberTranscriptId: 'ag-2', carriedUsd: 0 }],
  dispatches: 2, rotations: 0, restarts: 0, costUsd: 2.41, hostOverheadUsd: 0.06, history: [],
  reconcile: { ok: false, mismatches: [{ turnId: `t:${SID}:2`, method: 'estimate', harnessUsd: 0.65, otherUsd: 0.9 }] } };
const labelOf = (id) => ({ n_impl: 'Implementation', n_review: 'Review' })[id];

test('header, copy button, stacked bar and per-turn table', () => {
  const el = renderSessionCard(S, { doc, labelOf, engineCost: true });
  assert.match(el.querySelector('.rs-head').textContent, /Build and review/);
  assert.match(el.querySelector('.rs-head').textContent, /Sub-agents · turns · Claude · main agent claude-haiku-4-5/);
  assert.equal(el.querySelector('[data-copy]').dataset.copy, 'b1f0c2');
  const segs = [...el.querySelectorAll('.rs-bar > span')].map((s) => s.getAttribute('title'));
  assert.deepEqual(segs, ['Implementation $1.70 (71%)', 'Review $0.65 (27%)', 'Hand-offs $0.06 (2%)']);
  const cells = [...el.querySelectorAll('.rs-turns tbody tr')[1].children].map((c) => c.textContent.trim());
  const hhmm = new Date('2026-10-28T10:46:02.000Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });   // local time, as the table shows it
  assert.deepEqual(cells.slice(0, 9), ['2', 'Review', '1', hhmm, '2m 11s', '3.0k / 400 / 0', '$0.68', 'harness', 'blocking · 2 issues']);
  assert.ok(el.querySelector('[data-log-exec="x:n_review:1"]'));
  assert.ok(el.querySelector('[data-subagent="T2"]'));
  assert.ok(el.querySelector('[data-transcript="ag-2"]'), 'from the dollar to the sub-agent\'s own transcript (C7)');
});

test('the reconcile badge shows both figures; unknown cost is a dash, never $0.00', () => {
  const el = renderSessionCard(S, { doc, labelOf, engineCost: true });
  assert.equal(el.querySelector('.rs-reconcile').textContent.trim(), `⚠ t:${SID}:2: harness $0.65 vs estimate $0.90`);
  const none = { ...S, costUsd: null, hostOverheadUsd: null, turnRows: S.turnRows.map((t) => ({ ...t, memberUsd: null, hostOverheadUsd: null, costSource: 'none' })), reconcile: { ok: true, mismatches: [] } };
  const el2 = renderSessionCard(none, { doc, labelOf, engineCost: false });
  assert.equal([...el2.querySelectorAll('.rs-turns tbody tr')[0].children][6].textContent.trim(), '—');
  assert.doesNotMatch(el2.textContent, /\$0\.00/);
  assert.equal(el2.querySelector('.rs-reconcile').textContent.trim(), 'no cost from this engine · tokens only', 'nothing was compared: the mock\'s words, not "✓ reconciled"');
  // Task 66 v5: One conversation's turns list no tokens: the card does not say "tokens only".
  assert.equal(renderSessionCard({ ...none, mode: 'shared' }, { doc, labelOf, engineCost: false }).querySelector('.rs-reconcile').textContent.trim(), 'no cost from this engine');
  assert.equal(renderSessionCard({ ...S, reconcile: { ok: true, mismatches: [] } }, { doc, labelOf, engineCost: true, live: false }).querySelector('.rs-reconcile').textContent.trim(), '✓ reconciled');
});

test('tab visibility', () => {
  assert.equal(sessionsTabVisible({ sessionHosts: { [SID]: {} } }), true);
  assert.equal(sessionsTabVisible({ steps: [] }), false);
});

// ── v2: the rest of the card, the steps outside every session, the loader and the run page ──

test('v2 — the card: separate and shared heads, no host yet, the bar only with a cost, history, skipped lines, an epoch check', () => {
  const sep = renderSessionCard({ ...S, mode: 'separate', modeReason: 'the Labs flag sessionGroups is off', hostSessionId: null, costUsd: 2.41 }, { doc, labelOf, engineCost: true });
  assert.equal(sep.querySelector('.rs-meta').textContent, 'Separate sessions · Claude', 'no transport, no main agent');
  assert.equal(sep.querySelector('[data-copy]'), null, 'no host session, nothing to copy');
  assert.equal(sep.querySelector('.rs-why').textContent, 'Its steps ran as separate sessions: the One session Labs flag is off.', 'the flag key is not copy (never "group")');
  assert.match(renderSessionCard({ ...S, mode: 'shared' }, { doc, labelOf }).querySelector('.rs-head').textContent, /One conversation · turns · Claude/);
  // Task 66: a turn of one conversation is all its step's: its cost tooltip names no hand-off (the overhead is a booked 0).
  const one = { ...S, mode: 'shared', hostOverheadUsd: 0, turnRows: S.turnRows.map((r) => ({ ...r, hostOverheadUsd: 0 })) };
  assert.deepEqual([...renderSessionCard(one, { doc, labelOf }).querySelectorAll('.rs-turns tbody tr')].map((tr) => tr.children[6].title), ['step $1.70', 'step $0.65']);
  assert.equal(renderSessionCard(one, { doc, labelOf }).querySelector('.rs-hand'), null, 'no hand-off segment');
  // v3: no host and no hand-off in its words either: the conversation's id, and what reconciles.
  const oneCard = renderSessionCard({ ...one, hostSessionId: 'b1f0c2d3-0000-4000-8000-00000000abcd', reconcile: { ok: true, mismatches: [] } }, { doc, labelOf, engineCost: true, live: false });
  assert.match(oneCard.querySelector('.rs-meta').textContent, /^One conversation.*conversation b1f0c2d3…abcd/);
  assert.doesNotMatch(oneCard.querySelector('.rs-meta').textContent, /host/);
  assert.equal(oneCard.querySelector('.rs-copy').title, 'Copy the conversation id');
  assert.equal(oneCard.querySelector('.rs-ok').title, 'The steps add up to the harness total.');
  const subCard = renderSessionCard({ ...S, hostSessionId: 'b1f0c2d3-0000-4000-8000-00000000abcd', reconcile: { ok: true, mismatches: [] } }, { doc, labelOf, engineCost: true, live: false });
  assert.deepEqual([subCard.querySelector('.rs-copy').title, subCard.querySelector('.rs-ok').title], ['Copy the host session id', 'The steps and the hand-offs add up to the harness total.']);
  assert.match(subCard.querySelector('.rs-meta').textContent, /host session b1f0c2d3…abcd/);
  assert.equal(renderSessionCard(S, { doc, labelOf }).querySelector('.rs-turns tbody tr').children[6].title, 'step $1.70 + hand-off $0.03', 'sub-agents keep theirs');
  assert.equal(renderSessionCard(S, { doc, labelOf, engineCost: false }).querySelector('.rs-bar'), null, 'an engine without cost draws no bar');
  assert.equal(renderSessionCard({ ...S, costUsd: 0, hostOverheadUsd: 0 }, { doc, labelOf }).querySelector('.rs-bar'), null, 'nor does a $0 session');
  const bar = renderSessionCard(S, { doc, labelOf }).querySelector('.rs-bar');
  assert.equal(bar.getAttribute('aria-label'), 'Cost split: Implementation $1.70, Review $0.65, Hand-offs $0.06');
  assert.ok(bar.querySelector('.rs-hand'), 'the hand-offs are their own (hatched) segment');
  const more = renderSessionCard({ ...S, hostEpoch: 2, hostSessionId: 'b1f0c2d3-0000-4000-8000-00000000abcd',
    history: [{ kind: 'rotate', ts: null, reason: 'dispatches' }, { kind: 'resume', ts: null, reason: 'pause' }],
    integrity: { torn: 1, invalid: 1, seqGaps: 1 },
    reconcile: { ok: false, mismatches: [{ turnId: null, method: 'epoch', harnessUsd: 1.2, otherUsd: 1.2004 }] },
    turnRows: [{ ...S.turnRows[0], carriedUsd: 0.12, watchdog: { code: 'SESSION_HOST_STRAY_TOOL', level: 'warn' } }] }, { doc, labelOf, engineCost: true });
  assert.match(more.querySelector('.rs-meta').textContent, /host session b1f0c2d3…abcd \(epoch 2\)/);
  assert.equal(more.querySelector('[data-copy]').dataset.copy, 'b1f0c2d3-0000-4000-8000-00000000abcd', 'the button copies the whole id');
  assert.deepEqual([...more.querySelectorAll('.rs-history li')].map((li) => li.textContent), ['rotated to a fresh host (dispatches)', 'resumed after pause']);
  assert.equal(more.querySelector('.rs-integrity').textContent, 'In this session\'s trace, 2 lines could not be read and are not shown; its numbering has 1 gap.');
  assert.equal(renderSessionCard({ ...S, integrity: { torn: 0, invalid: 0, seqGaps: 2 } }, { doc, labelOf }).querySelector('.rs-integrity').textContent, 'In this session\'s trace, its numbering has 2 gaps.');
  assert.equal(renderSessionCard({ ...S, integrity: { torn: 0, invalid: 0, seqGaps: 0, unreadable: true } }, { doc, labelOf }).querySelector('.rs-integrity').textContent, 'This session\'s trace could not be read.');
  assert.equal(more.querySelector('.rs-reconcile').textContent.trim(), '⚠ host epoch: harness $1.2000 vs booked $1.2004');
  const cells = [...more.querySelectorAll('.rs-turns tbody tr')[0].children];
  assert.match(cells[6].title, /^step \$1\.70 \+ hand-off \$0\.03; it also carried \$0\.12 of a cut turn/);
  assert.equal(cells[8].title, 'watchdog: SESSION_HOST_STRAY_TOOL');
  assert.equal(more.querySelector('[data-log-exec]').dataset.nodeId, 'n_impl');
  assert.equal(more.querySelector('[data-subagent]').dataset.minLevel, 'expert', 'the Agents tab is expert');
  assert.deepEqual([...more.querySelectorAll('.rs-links button')].map((b) => [b.textContent, b.getAttribute('aria-label')]),
    [['Log', 'Log of Implementation, turn 1'], ['Sub-agent', 'Sub-agent of Implementation, turn 1'], ['Copy transcript id', 'Copy the transcript id of Implementation, turn 1']]);
  assert.equal(more.querySelector('[data-log-exec]').dataset.minLevel, 'advanced', 'Running\'s Logs tab');
  assert.equal(renderSessionCard(S, { doc, labelOf, logLevel: null }).querySelector('[data-log-exec]'), null, 'no log, no Log button');
  assert.equal(renderSessionCard(S, { doc, labelOf, logLevel: 'expert' }).querySelector('[data-log-exec]').dataset.minLevel, 'expert', 'History\'s Logs tab');
  const busy = { ...S, status: 'busy' };
  assert.match(renderSessionCard(busy, { doc, labelOf, runStatus: 'running', live: true }).querySelector('.rs-state').textContent, /^Running$/);
  assert.match(renderSessionCard(busy, { doc, labelOf, runStatus: 'interrupted', live: false }).querySelector('.rs-state').textContent, /^Interrupted$/, 'the server stopped mid-turn: no close record');
  assert.ok(renderSessionCard(busy, { doc, labelOf, runStatus: 'interrupted', live: false }).querySelector('.status-dot.is-red'));
  assert.match(renderSessionCard({ ...S, status: 'done' }, { doc, labelOf, runStatus: 'interrupted', live: false }).querySelector('.rs-state').textContent, /^Done$/, 'a closed session keeps its own end');
  const inflight = renderSessionCard({ ...S, turnRows: [{ ...S.turnRows[0], costSource: null, memberUsd: null, hostOverheadUsd: null, verdict: null, tokens: null, durationMs: null }] }, { doc, labelOf });
  assert.deepEqual([...inflight.querySelectorAll('.rs-turns tbody tr')[0].children].slice(4, 9).map((c) => c.textContent), ['—', '—', '—', '—', '—'], 'a turn still running');
});

test('v2 — badge and visibility: summaries, a manifest session, neither, nothing', () => {
  assert.equal(sessionsBadge({ sessionHosts: { [SID]: {} } }), '1');
  assert.equal(sessionsBadge({ stepper: SESSION_STEPPER }), '1', 'a run whose session has not written a record yet');
  assert.equal(sessionsBadge({ stepper: SESSION_STEPPER, sessionHosts: { [SID]: {}, s_bbbbbbbb: {} } }), '2');
  assert.equal(sessionsBadge({ steps: [] }), null);
  assert.equal(sessionsTabVisible(undefined), false);
  assert.equal(sessionsTabVisible({ stepper: SESSION_STEPPER }), true);
});

test('v2 — outside sessions: a plain step, a separate member, slices, a member still waiting for its host, flows and scripts', () => {
  const stepper = { ...SESSION_STEPPER, graph: { ...SESSION_STEPPER.graph, nodes: [...SESSION_STEPPER.graph.nodes,
    { id: 'n_or', kind: 'or', x: 0, y: 0, label: 'OR', config: {}, ports: { inputs: [], outputs: [] } },
    { id: 'n_sh', kind: 'script', key: 'sh', x: 0, y: 0, label: 'Lint', config: {}, ports: { inputs: [], outputs: [] } }] } };
  const row = (nodeId, status, over = {}) => ({ executionId: `x:${nodeId}:1`, key: `x:${nodeId}:1`, nodeId, ordinal: 1, status, activeMs: 30000, costUsd: 0.2, ...over });
  const state = { stepper, steps: [row('n_plan', 'done'), row('n_or', 'done'), row('n_sh', 'done'),
    row('n_impl', 'done', { executionId: 'x:n_impl:1:t1', kind: 'task', parentExecutionId: 'x:n_impl:1' }),
    row('n_impl', 'done', { executionId: 'x:n_impl:1:t2', kind: 'task', parentExecutionId: 'x:n_impl:1' }),
    row('n_review', 'running', { queued: true })] };
  const hosted = { sessions: [{ sid: SID, mode: 'subagents', modeReason: 'ok' }] };
  assert.deepEqual(outsideRows({ ...state, steps: [row('n_review', 'stopped')], sessionHosts: { [SID]: { mode: 'subagents' } } }, { sessions: [] }).map((o) => o.nodeId), [],
    'queued when the run stopped: never started (the live summary, before the report has it)');
  assert.deepEqual(outsideRows(state, hosted).map((o) => [o.nodeId, o.run, o.sessions, o.why]),
    [['n_plan', 'cycle 1', 1, null], ['n_impl', 'cycle 1 · tasks', 2, 'tasks run on their own in v1']], 'a queued member is not outside its session');
  const separate = { sessions: [{ sid: SID, mode: 'separate', modeReason: 'the Labs flag sessionGroups is off' }] };
  const done = { ...state, steps: [...state.steps.slice(0, 3), row('n_review', 'done')] };
  assert.deepEqual(outsideRows(done, separate).map((o) => [o.nodeId, o.why]), [['n_plan', null], ['n_review', 'the One session Labs flag is off']]);
  assert.deepEqual(outsideRows({ ...done, steps: [row('n_review', 'done', { session: { sid: SID } })] }, hosted), [], 'a row stamped with its session ran inside');
  const card = renderOutsideCard(outsideRows(state, hosted), { doc, labelOf: (id) => ({ n_plan: 'Plan', n_impl: 'Implementation' })[id], engineCost: true });
  assert.ok(card.classList.contains('rs-out'), 'the dashed card');
  assert.match(card.querySelector('.rs-head').textContent, /Outside sessions.*with the reason\. A session's steps count in its card's total\.\$0\.20.*3 sessions/,
    'v5: the slices\' $0.40 is in their session\'s card (its tray figure): the total is only what no card above counts');
  assert.deepEqual([...card.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent)),
    [['Plan', 'cycle 1', '1', '30s', '$0.20', 'not in a session'], ['Implementation', 'cycle 1 · tasks', '2', '1m 0s', '$0.40', 'tasks run on their own in v1']]);
  assert.deepEqual([...card.querySelectorAll('tbody tr')].map((tr) => tr.children[4].title), ['', 'Counted in the total of One session']);
  assert.doesNotMatch(renderOutsideCard(outsideRows(state, hosted), { doc, labelOf, engineCost: false }).textContent, /\$/);
});

test('v2 — the loader: one fetch per run when finished, a refetch when live and stale; an empty report still lists the steps outside', async () => {
  _resetSessionsCache();
  const sec = doc.createElement('div');
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return { ok: true, json: async () => ({ sessions: [S] }) }; };
  const first = paintSessionsTab(sec, { runId: 'abcd1234', state: null, labelOf, fetchImpl });
  assert.equal(sec.textContent, 'Loading the sessions…');
  await first;
  assert.deepEqual(calls, ['/api/runs/abcd1234/sessions']);
  assert.equal(sec.querySelectorAll('.rs-card').length, 1);
  const card = sec.querySelector('.rs-card');
  await paintSessionsTab(sec, { runId: 'abcd1234', labelOf, fetchImpl });
  assert.equal(calls.length, 1, 'a finished run is fetched once');
  assert.equal(sec.querySelector('.rs-card'), card, 'the same report is not rebuilt (a frame between mousedown and click)');
  const st = { stepper: SESSION_STEPPER, steps: [{ executionId: 'x:n_plan:1', nodeId: 'n_plan', status: 'done', activeMs: 1000, costUsd: 0.1 }] };
  await paintSessionsTab(sec, { runId: 'abcd1234', state: st, labelOf, fetchImpl });
  assert.notEqual(sec.querySelector('.rs-card'), card, 'new ledger rows repaint');
  const again = sec.querySelector('.rs-card');
  await paintSessionsTab(sec, { runId: 'abcd1234', state: st, labelOf, fetchImpl });
  assert.equal(sec.querySelector('.rs-card'), again);
  await paintSessionsTab(sec, { runId: 'live0001', live: true, labelOf, fetchImpl });
  await paintSessionsTab(sec, { runId: 'live0001', live: true, labelOf, fetchImpl });
  assert.equal(calls.length, 2, 'live: not again within the TTL');
  assert.equal(await paintSessionsTab(sec, { runId: '', fetchImpl }), null);
  // A state frame with the same rows (a new array, as onState makes) rebuilds nothing; a changed row does.
  const st1 = { stepper: SESSION_STEPPER, status: 'running', steps: [{ executionId: 'x:n_plan:1', nodeId: 'n_plan', status: 'running', activeMs: 0 }] };
  await paintSessionsTab(sec, { runId: 'abcd1234', state: st1, labelOf, fetchImpl });
  const kept = sec.querySelector('.rs-card');
  await paintSessionsTab(sec, { runId: 'abcd1234', state: { ...st1, steps: st1.steps.map((x) => ({ ...x })) }, labelOf, fetchImpl });
  assert.equal(sec.querySelector('.rs-card'), kept);
  await paintSessionsTab(sec, { runId: 'abcd1234', state: { ...st1, steps: [{ ...st1.steps[0], status: 'done' }] }, labelOf, fetchImpl });
  assert.notEqual(sec.querySelector('.rs-card'), kept);
  const empty = doc.createElement('div');
  paintSessions(empty, { sessions: [] }, { live: true, state: { stepper: SESSION_STEPPER, steps: [{ executionId: 'x:n_plan:1', nodeId: 'n_plan', ordinal: 1, status: 'done', activeMs: 1000, costUsd: 0.1 }] } });
  assert.equal(empty.querySelector('.empty-line').textContent, 'No session has started in this run yet.');
  assert.ok(empty.querySelector('.rs-out'));
  paintSessions(empty, { sessions: [] }, { live: false, state: null });
  assert.equal(empty.querySelector('.empty-line').textContent, 'No session of this run left a trace.', 'a finished run (the kill switch)');
});

test('v2 — the loader: a failure is shown and asked again; the run ending during a live fetch fetches once more; a trailing look after a skipped live call', async () => {
  _resetSessionsCache();
  const sec = doc.createElement('div');
  doc.body.appendChild(sec);
  let n = 0;
  const broken = async () => { n += 1; return { ok: false, json: async () => null }; };
  await paintSessionsTab(sec, { runId: 'fail0001', fetchImpl: broken });
  assert.equal(sec.textContent, 'The sessions could not be loaded. Open the tab again to retry.');
  await paintSessionsTab(sec, { runId: 'fail0001', fetchImpl: broken });
  assert.equal(n, 2, 'a failure is not cached');
  let release;
  const urls = [];
  const slow = (url) => { urls.push(url); return urls.length === 1 ? new Promise((r) => { release = () => r({ ok: true, json: async () => ({ sessions: [{ ...S, status: 'busy' }] }) }); }) : Promise.resolve({ ok: true, json: async () => ({ sessions: [{ ...S, status: 'done' }] }) }); };
  const liveCall = paintSessionsTab(sec, { runId: 'end00001', live: true, labelOf, fetchImpl: slow });
  const endCall = paintSessionsTab(sec, { runId: 'end00001', live: false, labelOf, fetchImpl: slow });
  while (!release) await new Promise((r) => setImmediate(r));   // the fetch starts a tick later
  release();
  await liveCall; await endCall;
  assert.equal(urls.length, 2, 'the report from before the close is not the last word');
  assert.match(sec.querySelector('.rs-state').textContent, /^Done$/);
  const ticks = [];
  const counting = async () => { ticks.push(Date.now()); return { ok: true, json: async () => ({ sessions: [S] }) }; };
  await paintSessionsTab(sec, { runId: 'trail001', live: true, labelOf, fetchImpl: counting });
  await paintSessionsTab(sec, { runId: 'trail001', live: true, labelOf, fetchImpl: counting });
  assert.equal(ticks.length, 1);
  await new Promise((r) => setTimeout(r, 2200));
  assert.equal(ticks.length, 2, 'one trailing fetch after the skipped call');
  sec.remove();
});

test('v2 — the run page: a Sessions tab before Agents once the manifest has a session, filled from the API', async () => {
  _resetSessionsCache();   // the module (and its cache) is the one app.js imports
  const st = groupedRunningState();
  const ctx = await bootApp({ fetchHandler: (url) => (url === '/api/runs/feed5678/sessions'
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ sessions: [{ ...S, label: 'One session' }] }) }) : null) });
  helloRun(ctx, { runId: 'r1' });
  ctx.go('running/r1/details/logs');
  await ctx.settle();
  const tabs = () => [...ctx.window.document.querySelectorAll('#run-detail .rd-tab')].map((b) => b.dataset.sec);
  assert.equal(tabs().includes('sessions'), false, 'no manifest yet, no tab');
  ctx.dispatch({ type: 'state', runId: 'r1', id: 'feed5678', status: 'running', runEngine: 'claude', stepper: st.stepper, steps: st.steps, active: st.active, sessionHosts: st.sessionHosts });
  await ctx.settle();
  assert.deepEqual(tabs().slice(-2), ['sessions', 'agents'], 'the manifest arriving rebuilds the tabs');
  assert.equal(ctx.window.document.querySelector('#run-detail .rd-tab[data-sec="sessions"] .rd-tab-badge').textContent, '1');
  ctx.window.document.querySelector('#run-detail .rd-tab[data-sec="sessions"]').click();
  await ctx.settle(6);
  assert.ok(ctx.calls.some((c) => c.url === '/api/runs/feed5678/sessions'), 'by the pipeline id');
  const card = ctx.window.document.querySelector('#run-detail .rd-sec[data-sec="sessions"] .rs-card');
  assert.ok(card, 'the card painted');
  assert.match(card.querySelector('.rs-head').textContent, /One session/);
  card.querySelector('[data-subagent]').click();
  await ctx.settle();
  assert.ok(ctx.window.document.querySelector('#run-detail .rd-tab[data-sec="agents"]').classList.contains('active'), 'Sub-agent opens the Agents tab');
  assert.match(ctx.window.location.hash, /\/agents$/, 'and the address follows');
});

test('v2 — History: the same tab, from the saved state, fetched by the row id', async () => {
  _resetSessionsCache();
  const st = groupedRunningState();
  const seen = [];
  const ctx = await bootDetail({ detail: { ...DETAIL, state: { ...DETAIL.state, stepper: st.stepper, steps: st.steps, sessionHosts: st.sessionHosts, runEngine: 'claude' } },
    arms: (url) => { if (url.endsWith(`/api/runs/${ROW.id}/sessions`)) { seen.push(url); return ok({ sessions: [S] }); } return null; } });
  await openDetail(ctx, 'details/sessions');
  await settle(ctx.window, 6);
  const doc2 = ctx.window.document;
  assert.deepEqual([...doc2.querySelectorAll('#hist-detail .hd-tab')].map((b) => b.dataset.sec).slice(-2), ['sessions', 'agents']);
  assert.equal(seen.length, 1);
  assert.ok(doc2.querySelector('#hist-detail .hd-sec[data-sec="sessions"] .rs-card'), 'the card painted');
  assert.ok(doc2.querySelector('#hist-detail .hd-sec[data-sec="sessions"] .rs-out'), 'and the steps outside it (Plan)');
});

test('History: a failed load is asked again when the tab is opened again', async () => {
  _resetSessionsCache();
  const st = groupedRunningState();
  let seen = 0;
  let up = false;
  const ctx = await bootDetail({ detail: { ...DETAIL, state: { ...DETAIL.state, stepper: st.stepper, steps: st.steps, sessionHosts: st.sessionHosts, runEngine: 'claude' } },
    arms: (url) => {
      if (!url.endsWith(`/api/runs/${ROW.id}/sessions`)) return null;
      seen += 1;
      return up ? ok({ sessions: [S] }) : Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
    } });
  await openDetail(ctx, 'details/sessions');
  await settle(ctx.window, 6);
  const doc2 = ctx.window.document;
  const sec = doc2.querySelector('#hist-detail .hd-sec[data-sec="sessions"]');
  assert.equal(sec.textContent, 'The sessions could not be loaded. Open the tab again to retry.');
  const before = seen;
  up = true;
  doc2.querySelector('#hist-detail .hd-tab:not([data-sec="sessions"])').click();
  doc2.querySelector('#hist-detail .hd-tab[data-sec="sessions"]').click();
  await settle(ctx.window, 6);
  assert.equal(seen - before, 1, 'the copy promises a retry: reopening the tab asks again');
  assert.ok(sec.querySelector('.rs-card'), 'and the report painted');
});

// ── v3: the review's rows (a live refetch of the same report, the trailing look, the reconcile words, unknown figures) ──
test('v3 — live: the same report fetched again rebuilds nothing; a sessionHost count drives the refetch', async () => {
  _resetSessionsCache();
  const sec = doc.createElement('div');
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return { ok: true, json: async () => ({ sessions: [{ ...S, status: 'busy' }] }) }; };
  await paintSessionsTab(sec, { runId: 'live0002', live: true, labelOf, fetchImpl });
  const card = sec.querySelector('.rs-card');
  await new Promise((r) => setTimeout(r, 2100));
  await paintSessionsTab(sec, { runId: 'live0002', live: true, labelOf, fetchImpl });
  assert.equal(calls.length, 2, 'past the TTL a live run asks again');
  assert.equal(sec.querySelector('.rs-card'), card, 'an identical report (a new object) keeps the cards: focus and clicks survive');
  _resetSessionsCache();
  const seqCalls = [];
  const counted = async (url) => { seqCalls.push(url); return { ok: true, json: async () => ({ sessions: [S] }) }; };
  await paintSessionsTab(sec, { runId: 'seq00001', live: true, seq: 3, labelOf, fetchImpl: counted });
  await new Promise((r) => setTimeout(r, 2100));
  await paintSessionsTab(sec, { runId: 'seq00001', live: true, seq: 3, labelOf, fetchImpl: counted });
  assert.equal(seqCalls.length, 1, 'no trace record since the last fetch: no fetch (token frames)');
  await paintSessionsTab(sec, { runId: 'seq00001', live: true, seq: 4, labelOf, fetchImpl: counted });
  assert.equal(seqCalls.length, 2, 'a sessionHost frame since: fetch');
});

test('v3 — the trailing look paints with the newest call (the run ended meanwhile); one fetch at a time', async () => {
  _resetSessionsCache();
  const sec = doc.createElement('div');
  doc.body.appendChild(sec);
  const ticks = [];
  const counting = async () => { ticks.push(Date.now()); return { ok: true, json: async () => ({ sessions: [] }) }; };
  await paintSessionsTab(sec, { runId: 'trail002', live: true, labelOf, fetchImpl: counting });
  await paintSessionsTab(sec, { runId: 'trail002', live: true, labelOf, fetchImpl: counting });   // skipped: arms the trailing look
  await paintSessionsTab(sec, { runId: 'trail002', live: false, labelOf, fetchImpl: counting });  // the done frame
  assert.equal(ticks.length, 2);
  await new Promise((r) => setTimeout(r, 2200));
  assert.equal(ticks.length, 2, 'the trailing look sees a finished run: nothing more to ask');
  assert.equal(sec.textContent, 'No session of this run left a trace.', 'never painted as live again');
  _resetSessionsCache();
  const urls = [];
  const gates = [];
  const slow = (url) => { urls.push(url); return new Promise((r) => { gates.push(() => r({ ok: true, json: async () => ({ sessions: [S] }) })); }); };
  const a = paintSessionsTab(sec, { runId: 'race0001', live: true, labelOf, fetchImpl: slow });
  const b = paintSessionsTab(sec, { runId: 'race0001', live: false, labelOf, fetchImpl: slow });   // chained after the live one
  while (gates.length < 1) await new Promise((r) => setImmediate(r));
  gates[0]();
  while (gates.length < 2) await new Promise((r) => setImmediate(r));                             // the chained fetch is out
  const c = paintSessionsTab(sec, { runId: 'race0001', live: false, labelOf, fetchImpl: slow });
  await new Promise((r) => setImmediate(r));
  assert.equal(urls.length, 2, 'the first fetch settling does not free the slot the chained one holds');
  gates[1]();
  await Promise.all([a, b, c]);
  sec.remove();
});

test('v3 — the reconcile words (the mock\'s three), history with no reason, members with no turn, the run\'s engine', () => {
  const okRec = { ok: true, mismatches: [] };
  const word = (s, o = {}) => { const r = renderSessionCard(s, { doc, labelOf, engineCost: true, live: false, ...o }).querySelector('.rs-reconcile'); return r.textContent.trim(); };
  assert.equal(word({ ...S, status: 'busy', reconcile: okRec }, { live: true }), 'reconciles after each turn');
  assert.equal(word({ ...S, status: 'idle', reconcile: okRec }, { live: true }), 'reconciles after each turn');
  assert.equal(word({ ...S, status: 'done', reconcile: okRec }, { live: true }), '✓ reconciled', 'closed');
  assert.equal(word({ ...S, reconcile: { ok: null, mismatches: [] }, integrity: { torn: 0, invalid: 0, seqGaps: 0, unreadable: true } }), '', 'nothing was checked');
  assert.equal(word({ ...S, mode: 'separate', turns: 0, turnRows: [], reconcile: okRec }), '', 'a separate session with no host turn');
  const lost = renderSessionCard({ ...S, status: 'done', reconcile: { ok: false, mismatches: [] } }, { doc, labelOf, engineCost: true, live: false });
  assert.deepEqual([lost.querySelectorAll('.rs-ok').length, lost.querySelectorAll('.rs-bad').length], [0, 1],
    'the close says not reconciled and its failed check was lost (correction 54): never "✓ reconciled"');
  assert.equal(lost.querySelector('.rs-reconcile').textContent.trim(), '⚠ not reconciled', 'the CLI\'s words for the same report');
  assert.equal(word({ ...S, status: 'done', reconcile: undefined }), '', 'no check in the report: no tick');
  const h = renderSessionCard({ ...S, history: [{ kind: 'degrade', reason: null }, { kind: 'resume', reason: null }, { kind: 'pause', reason: 'pause' }, { kind: 'degrade', reason: 'the Labs flag sessionGroups is off' }] }, { doc, labelOf });
  assert.deepEqual([...h.querySelectorAll('.rs-history li')].map((li) => li.textContent), ['runs as separate sessions', 'resumed', 'paused', 'runs as separate sessions — the One session Labs flag is off']);
  const three = renderSessionCard({ ...S, members: ['n_impl', 'n_review', 'n_docs'] }, { doc, labelOf: (id) => ({ n_impl: 'Implementation', n_review: 'Review', n_docs: 'Docs' })[id] });
  assert.doesNotMatch(three.querySelector('.rs-legend').textContent, /Docs/, 'a member with no turn yet is no $0.00 share');
  assert.equal(three.querySelectorAll('.rs-bar > span').length, 3);
  const booking = renderSessionCard({ ...S, turnRows: [S.turnRows[0], { ...S.turnRows[1], memberUsd: null, hostOverheadUsd: null, costSource: null }] }, { doc, labelOf });
  assert.doesNotMatch(booking.querySelector('.rs-legend').textContent, /Review/, 'a turn with no cost record yet is no $0.00 share');
  assert.doesNotMatch(booking.querySelector('.rs-bar').getAttribute('aria-label'), /\$0\.00/);
  const torn = renderSessionCard({ ...S, engine: null }, { doc, labelOf, runEngine: 'codex' });
  assert.match(torn.querySelector('.rs-meta').textContent, /Sub-agents · turns · Codex · main agent/, 'the open line was torn: the run\'s engine');
  assert.doesNotMatch(renderSessionCard({ ...S, engine: null }, { doc, labelOf }).querySelector('.rs-meta').textContent, /Claude/, 'no engine made up');
});

test('v3 — outside sessions: a running step shows dashes, never $0.00 or 0s; the bar keeps every share visible', async () => {
  const row = (nodeId, status, over = {}) => ({ executionId: `x:${nodeId}:1`, key: `x:${nodeId}:1`, nodeId, ordinal: 1, status, activeMs: 0, ...over });
  const running = outsideRows({ stepper: SESSION_STEPPER, steps: [row('n_plan', 'start')] }, { sessions: [] });
  const card = renderOutsideCard(running, { doc, labelOf: () => 'Plan', engineCost: true });
  assert.deepEqual([...card.querySelector('tbody tr').children].map((c) => c.textContent), ['Plan', 'cycle 1', '1', '—', '—', 'not in a session']);
  assert.equal(card.querySelector('.rs-total-v').textContent, '—', 'no figure known yet');
  const mixed = outsideRows({ stepper: SESSION_STEPPER, steps: [row('n_plan', 'done', { activeMs: 30000, costUsd: 0.2 })] }, { sessions: [] });
  assert.equal(renderOutsideCard(mixed, { doc, labelOf: () => 'Plan' }).querySelector('.rs-total-v').textContent, '$0.20');
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.rs-bar>\.rs-seg,\.rs-legend i\.rs-seg\{box-shadow:inset 0 0 0 1px var\(--ink-2\);\}/, 'a neutral share next to the track is 1.2:1 without its edge');
  assert.match(css, /\.rs-hand\{background:repeating-linear-gradient\(135deg,var\(--slate-ink\) 0 2px,transparent 2px 4px\);box-shadow:inset 0 0 0 1px var\(--slate-ink\);\}/, 'v4: the hatch is --slate-ink (--slate is 2.8:1 on the track)');
  assert.match(css, /\.rs-bar>\.rs-hand\{min-width:3px;\}/, 'v4: a small hand-off share is never a sub-pixel sliver');
});

test('v3 — the run page counts sessionHost frames (the tab refetches on them)', async () => {
  const ctx = await bootApp();
  helloRun(ctx, { runId: 'r1' });
  ctx.dispatch({ type: 'sessionHost', runId: 'r1', sid: SID, transition: 'turn_end' });
  ctx.dispatch({ type: 'sessionHost', runId: 'r1', sid: SID, transition: 'cost' });
  assert.equal(ctx.window.__np.getRun('r1').sessionSeq, 2);
});

test('v4 — the Running tab asks again only after a sessionHost frame, from the first one on (no polling before it)', async () => {
  _resetSessionsCache();
  const st = groupedRunningState();
  const ctx = await bootApp({ fetchHandler: (url) => (url === '/api/runs/feed5678/sessions'
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ sessions: [{ ...S, status: 'busy' }] }) }) : null) });
  helloRun(ctx, { runId: 'r1' });
  const frame = { type: 'state', runId: 'r1', id: 'feed5678', status: 'running', runEngine: 'claude', stepper: st.stepper, steps: st.steps, active: st.active, sessionHosts: st.sessionHosts };
  ctx.go('running/r1/details/logs');
  await ctx.settle();
  ctx.dispatch(frame);
  await ctx.settle();
  ctx.window.document.querySelector('#run-detail .rd-tab[data-sec="sessions"]').click();
  await ctx.settle(6);
  const fetches = () => ctx.calls.filter((c) => c.url === '/api/runs/feed5678/sessions').length;
  assert.equal(fetches(), 1, 'the tab opened');
  await new Promise((r) => setTimeout(r, 2100));
  ctx.dispatch(frame);                                         // a state frame past the TTL, no trace record since
  await ctx.settle(6);
  assert.equal(fetches(), 1, 'nothing new in the trace: no fetch');
  ctx.dispatch({ type: 'sessionHost', runId: 'r1', sid: SID, transition: 'turn_end' });
  await ctx.settle(6);
  assert.equal(fetches(), 2, 'the first trace record: one fetch');
});

test('v4 — a sessionHost frame that joins a fetch already out is looked at again after it', async () => {
  _resetSessionsCache();
  const sec = doc.createElement('div');
  doc.body.appendChild(sec);
  const urls = [];
  const gates = [];
  const slow = (url) => { urls.push(url); return new Promise((r) => { gates.push(() => r({ ok: true, json: async () => ({ sessions: [S] }) })); }); };
  const a = paintSessionsTab(sec, { runId: 'join0001', live: true, labelOf, seq: 1, fetchImpl: slow });   // the fetch for frame 1
  const b = paintSessionsTab(sec, { runId: 'join0001', live: true, labelOf, seq: 2, fetchImpl: slow });   // frame 2 arrives while it is out
  while (gates.length < 1) await new Promise((r) => setImmediate(r));
  gates[0]();
  await Promise.all([a, b]);
  assert.equal(urls.length, 1, 'one fetch out at a time');
  await new Promise((r) => setTimeout(r, 2050));
  for (let i = 0; i < 50 && urls.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(urls.length, 2, 'the record behind frame 2 may postdate that fetch: asked once more');
  gates[1]();
  sec.remove();
});

test('v4 — the card\'s cost is the tray\'s (its members\' rows); a session that ran no turn says nothing about reconciling', () => {
  const okRec = { ok: true, mismatches: [] };
  const st = groupedRunningState();
  const rows = (a, b) => [{ ...st.steps[0] }, { ...st.steps[1], status: 'done', costUsd: a }, { ...st.steps[2], status: 'done', costUsd: b }];
  const sep = { ...S, mode: 'separate', modeReason: 'the Labs flag sessionGroups is off', hostSessionId: null, turns: 0, turnRows: [], costUsd: null, hostOverheadUsd: null,
    status: 'closed', history: [{ kind: 'degrade', reason: 'the Labs flag sessionGroups is off' }], reconcile: okRec };
  const flagOff = { ...st, status: 'done', steps: rows(0.5, 0.5), active: [], sessionHosts: { [SID]: { ...st.sessionHosts[SID], mode: 'separate', modeReason: sep.modeReason, turns: 0, costUsd: null } } };
  const sec = doc.createElement('div');
  paintSessions(sec, { sessions: [sep] }, { labelOf, engine: 'claude', state: flagOff, live: false });
  const tray = decorFromState(flagOff, { live: false, now: 0, sessionVerified: { claude: true } }).sessions[SID];
  assert.equal(sec.querySelector('.rs-card .rs-total-v').textContent, tray.cost, 'flag off: the tray\'s $1.00, not "unknown"');
  assert.equal(tray.cost, '$1.00');
  assert.equal(sec.querySelector('.rs-card .rs-history'), null, 'its one degrade is the why line, not repeated as history');
  const degraded = { ...st, status: 'done', steps: rows(1.20, 0.72), active: [], sessionHosts: { [SID]: { ...st.sessionHosts[SID], mode: 'separate', costUsd: 0.12 } } };
  assert.equal(membersUsdOf(degraded, S), 1.92);
  const dsec = doc.createElement('div');
  paintSessions(dsec, { sessions: [{ ...S, costUsd: 0.12, hostOverheadUsd: 0.02 }] }, { labelOf, engine: 'claude', state: degraded, live: false });
  const card = dsec.querySelector('.rs-card');
  assert.equal(card.querySelector('.rs-total-v').textContent, decorFromState(degraded, { live: false, now: 0, sessionVerified: { claude: true } }).sessions[SID].cost);
  assert.match(card.querySelector('.rs-total-s').textContent, /incl\. \$1\.80 outside the host$/, 'the part the trace never saw (the plain runs after a degrade)');
  assert.equal(renderSessionCard(S, { doc, labelOf, membersUsd: 2.41 }).querySelector('.rs-total-s').textContent, '2 turns · 6m 12s', 'all inside the host: no outside part');
  assert.equal(membersUsdOf({ ...st, steps: st.steps.map((r) => ({ ...r, costUsd: undefined })) }, S), null, 'no row has a figure: the trace\'s sum stands in');
  const word = (s, o = {}) => renderSessionCard(s, { doc, labelOf, engineCost: true, live: false, ...o }).querySelector('.rs-reconcile').textContent.trim();
  assert.equal(word({ ...S, status: 'error', turns: 0, turnRows: [], reconcile: okRec }), '', 'a host that never ran a turn: nothing was compared');
  assert.equal(word({ ...S, status: 'cold', turns: 0, turnRows: [], reconcile: okRec }, { live: true }), 'reconciles after each turn', 'live, before its first turn');
});


// ── v5: the review's rows (cents are no spend; a pause the run was stopped from; the tray's done on a live card; the page's
// totals add up; an unknown hand-off; a turn being booked) ──
test('v5 — a hosted session\'s per-card cents are no spend outside the host; a pause the run was stopped from reads Stopped', () => {
  const st = groupedRunningState();
  const r = (nodeId, ord) => ({ key: `x:${nodeId}:${ord}`, executionId: `x:${nodeId}:${ord}`, nodeId, ordinal: ord, cycle: ord, status: 'done', activeMs: 60000, costUsd: 0.126 });
  const state = { ...st, status: 'done', active: [], steps: [{ ...st.steps[0] }, r('n_impl', 1), r('n_review', 1), r('n_impl', 2), r('n_review', 2)],
    sessionHosts: { [SID]: { ...st.sessionHosts[SID], status: 'done', turns: 4, costUsd: 0.504 } } };
  const sec = doc.createElement('div');
  paintSessions(sec, { sessions: [{ ...S, status: 'done', turns: 4, costUsd: 0.504, hostOverheadUsd: 0.104, reconcile: { ok: true, mismatches: [] } }] }, { labelOf, engine: 'claude', state, live: false });
  const tray = decorFromState(state, { live: false, now: 0, sessionVerified: { claude: true } }).sessions[SID];
  assert.equal(sec.querySelector('.rs-card .rs-total-v').textContent, tray.cost, 'the tray\'s figure ($0.52: each card to the cent)');
  assert.doesNotMatch(sec.querySelector('.rs-card .rs-total-s').textContent, /outside the host/, 'every member ran inside the host: rows of $0.126 are $0.504 booked, not $0.52');
  const word = (s, o) => renderSessionCard(s, { doc, labelOf, ...o }).querySelector('.rs-state').textContent;
  assert.equal(word({ ...S, status: 'paused' }, { live: false, runStatus: 'stopped' }), 'Stopped', 'paused, then stopped from the pause (no close is written): the run\'s end');
  assert.equal(word({ ...S, status: 'paused' }, { live: false, runStatus: 'paused' }), 'Paused');
  assert.equal(renderSessionCard({ ...S, turns: 0, turnRows: [] }, { doc, labelOf, membersUsd: 1, outsideUsd: 1 }).querySelector('.rs-total-s').textContent.includes('outside'), false,
    'no host turn: nothing to be outside of');
});

test('v5 — live: a session whose members are done for good reads Done like its tray; waiting reads between turns; the tray state repaints', async () => {
  const st = groupedRunningState();
  const done = { ...st, active: [], steps: [{ ...st.steps[0] }, { ...st.steps[1] }, { ...st.steps[2], status: 'done' }, { ...st.steps[0], key: 'x:n_docs:1', executionId: 'x:n_docs:1', nodeId: 'n_docs', status: 'running' }],
    sessionHosts: { [SID]: { ...st.sessionHosts[SID], status: 'idle' } } };
  const report = { sessions: [{ ...S, status: 'idle', reconcile: { ok: true, mismatches: [] } }] };
  const sec = doc.createElement('div');
  paintSessions(sec, report, { labelOf, engine: 'claude', state: done, live: true });
  assert.deepEqual([sec.querySelector('.rs-state').textContent, sec.querySelector('.rs-reconcile').textContent], ['Done', '✓ reconciled'],
    'every member done, no loop back: the tray says Done, so does the card (the host stays open until the run ends)');
  paintSessions(sec, report, { labelOf, engine: 'claude', state: done, live: true, trays: { [SID]: { status: 'waiting', durMs: 0 } } });
  assert.deepEqual([sec.querySelector('.rs-state').textContent, sec.querySelector('.rs-reconcile').textContent], ['Between turns', 'reconciles after each turn']);
  _resetSessionsCache();
  const tab = doc.createElement('div');
  doc.body.appendChild(tab);
  const fetchImpl = async () => ({ ok: true, json: async () => report });
  await paintSessionsTab(tab, { runId: 'tray0001', state: done, live: true, labelOf, seq: 1, trays: { [SID]: { status: 'waiting', durMs: 0 } }, fetchImpl });
  assert.equal(tab.querySelector('.rs-state').textContent, 'Between turns');
  await paintSessionsTab(tab, { runId: 'tray0001', state: done, live: true, labelOf, seq: 1, trays: { [SID]: { status: 'done', durMs: 0 } }, fetchImpl });
  assert.equal(tab.querySelector('.rs-state').textContent, 'Done', 'the same rows, the tray now done (a gate answered): the card repaints');
  tab.remove();
  const cold = doc.createElement('div');
  paintSessions(cold, { sessions: [{ ...S, status: 'cold', turns: 0, turnRows: [], reconcile: { ok: true, mismatches: [] } }] }, { labelOf, engine: 'claude', state: done, live: true });
  assert.deepEqual([cold.querySelector('.rs-state').textContent, cold.querySelector('.rs-reconcile').textContent], ['Done', ''], 'done without a host turn: nothing was compared');
});

test('v5 — the Running page passes its own trays: a gate answered with the same rows repaints the card', async () => {
  _resetSessionsCache();
  const st = groupedRunningState();
  const report = { sessions: [{ ...S, status: 'idle', reconcile: { ok: true, mismatches: [] } }] };
  const ctx = await bootApp({ fetchHandler: (url) => (url === '/api/runs/feed5678/sessions' ? Promise.resolve({ ok: true, status: 200, json: async () => report }) : null) });
  helloRun(ctx, { runId: 'r1' });
  const frame = (over) => ({ type: 'state', runId: 'r1', id: 'feed5678', status: 'running', runEngine: 'claude', stepper: st.stepper, active: [],
    steps: [st.steps[0], st.steps[1], { ...st.steps[2], status: 'done' }], sessionHosts: { [SID]: { ...st.sessionHosts[SID], status: 'idle' } }, ...over });
  ctx.go('running/r1/details/logs');
  await ctx.settle();
  ctx.dispatch(frame({ gate: { wireId: 'w2', fromNode: 'n_review', toNode: 'n_impl', askId: 'gate-w2-1' } }));
  await ctx.settle();
  ctx.window.document.querySelector('#run-detail .rd-tab[data-sec="sessions"]').click();
  await ctx.settle(6);
  const word = () => ctx.window.document.querySelector('#run-detail .rd-sec[data-sec="sessions"] .rs-state').textContent;
  assert.equal(word(), 'Between turns', 'a gate holds on Review for a person: the tray waits, so does the card');
  ctx.dispatch(frame({ gate: null }));
  await ctx.settle(6);
  assert.equal(word(), 'Done', 'answered, nothing comes back, the rows the same: the card follows its tray');
});

test('v5 — the page\'s totals add up: a session member outside its host counts in its session\'s card; times are the tray\'s', () => {
  const st = groupedRunningState();
  const flagOff = { ...st, status: 'done', active: [], steps: [{ ...st.steps[0] }, { ...st.steps[1] }, { ...st.steps[2], status: 'done' }],
    sessionHosts: { [SID]: { ...st.sessionHosts[SID], mode: 'separate', modeReason: 'the Labs flag sessionGroups is off', turns: 0, costUsd: null, status: 'closed' } } };
  const sep = { ...S, mode: 'separate', modeReason: 'the Labs flag sessionGroups is off', hostSessionId: null, turns: 0, turnRows: [], costUsd: null, hostOverheadUsd: null, status: 'closed',
    history: [], reconcile: { ok: true, mismatches: [] } };
  const sec = doc.createElement('div');
  paintSessions(sec, { sessions: [sep] }, { labelOf: (id) => ({ n_plan: 'Plan', n_impl: 'Implementation', n_review: 'Review' })[id], engine: 'claude', state: flagOff, live: false });
  const [card, out] = sec.querySelectorAll('.rs-card');
  assert.deepEqual([card.querySelector('.rs-total-v').textContent, card.querySelector('.rs-total-s').textContent], ['$1.00', '0 turns · 2m 0s'], 'the tray\'s cost and time');
  assert.deepEqual([out.querySelector('.rs-total-v').textContent, out.querySelector('.rs-total-s').textContent], ['$0.50', '3 sessions'],
    'only Plan\'s $0.50: the members\' $1.00 is in the card above ($1.50 on a $1.50 run, not $2.50)');
  assert.deepEqual([...out.querySelectorAll('tbody tr')].map((tr) => tr.children[4].title), ['', 'Counted in the total of One session', 'Counted in the total of One session']);
  const all = renderOutsideCard([{ nodeId: 'n_impl', run: 'cycle 1', sessions: 1, ms: 1000, usd: 0.5, why: 'x', sid: SID, label: 'One session' }], { doc, labelOf });
  assert.equal(all.querySelector('.rs-total-v').textContent, '$0.00', 'every row counted above: nothing more, a known zero');
});

test('v5 — an unknown hand-off is unknown in the turn\'s title; a turn being booked shows nothing outside the host; a degraded session keeps its degrade', () => {
  const card = renderSessionCard({ ...S, turnRows: [{ ...S.turnRows[0], memberUsd: 0.2, hostOverheadUsd: null, costSource: 'estimate' }] }, { doc, labelOf });
  assert.equal(card.querySelector('.rs-turns tbody tr').children[6].title, 'step $0.20 + hand-off unknown', 'a cut booked as an estimate: never $0.00 (the CLI says unknown)');
  const st = groupedRunningState();
  const rows = [{ ...st.steps[0] }, { ...st.steps[1], costUsd: 0.12 }, { ...st.steps[2], status: 'done', costUsd: 0.5 }];
  const at = (host) => {
    const sec = doc.createElement('div');
    paintSessions(sec, { sessions: [{ ...S, costUsd: 0.12 }] }, { labelOf, engine: 'claude', state: { ...st, active: [], steps: rows, sessionHosts: { [SID]: { ...st.sessionHosts[SID], ...host } } }, live: true });
    return sec.querySelector('.rs-total-s').textContent;
  };
  assert.doesNotMatch(at({ status: 'busy', costUsd: 0.12 }), /outside/, 'the rows are booked before the turn\'s trace records: the turn is still busy');
  assert.doesNotMatch(at({ status: 'idle', costUsd: 0.62 }), /outside/, 'then the live summary has the turn (the fetched report may not yet)');
  assert.match(at({ status: 'idle', costUsd: 0.32 }), /incl\. \$0\.30 outside the host$/);
  // Task 66 v3: One conversation has no host: what ran outside it ran outside the conversation.
  const one = doc.createElement('div');
  paintSessions(one, { sessions: [{ ...S, mode: 'shared', costUsd: 0.12 }] }, { labelOf, engine: 'claude',
    state: { ...st, active: [], steps: rows, sessionHosts: { [SID]: { ...st.sessionHosts[SID], mode: 'shared', status: 'idle', costUsd: 0.32 } } }, live: true });
  assert.match(one.querySelector('.rs-total-s').textContent, /incl\. \$0\.30 outside the conversation$/);
  const deg = renderSessionCard({ ...S, mode: 'separate', modeReason: 'the main agent did not dispatch', history: [{ kind: 'degrade', reason: 'the main agent did not dispatch' }] }, { doc, labelOf });
  assert.equal(deg.querySelectorAll('.rs-history li').length, 1, 'a session that degraded after its turns: its degrade is news, not the why line repeated');
  const never = renderSessionCard({ ...S, mode: 'separate', modeReason: 'the Labs flag is off', hostSessionId: null, turns: 0, turnRows: [],
    history: [{ kind: 'degrade', reason: 'the Labs flag is off' }, { kind: 'pause', reason: 'pause' }, { kind: 'resume', reason: 'pause' }, { kind: 'restart', reason: 'engine-switch' }] }, { doc, labelOf });
  assert.deepEqual([...never.querySelectorAll('.rs-history li')].map((li) => li.textContent.replace(/^\d\d:\d\d · /, '')), ['paused'],
    'a session that never had a host: no resume or restart (every restore writes one for it), as the CLI');
});
