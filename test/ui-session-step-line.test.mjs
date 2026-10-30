// test/ui-session-step-line.test.mjs — a member row says it ran inside a session, and where.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sessionRowLine, sessionRowEl } from '../ui/public/run-sessions-view.mjs';
import { decorFromState } from '../ui/public/graph/run-decor.mjs';
import { mountRunGraph } from '../ui/public/graph/run-hosts.mjs';
import { SID as FIX_SID, SESSION_STEPPER, groupedRunningState } from './helpers/session-run-state.mjs';
import { bootApp, helloRun } from './helpers/run-page-boot.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { bootDetail, openDetail, settle as settleHd, DETAIL } from './helpers/history-detail-boot.mjs';

const SID = 's_aaaaaaaa';
test('the line names the session, the turn and the dispatch; plain rows get nothing', () => {
  const step = { session: { sid: SID, turnId: `t:${SID}:7`, dispatchId: 'd:x:n_review:2:a1', memberAgentId: 'T9' } };
  assert.equal(sessionRowLine(step, { [SID]: { label: 'Build and review' } }), 'Inside session Build and review · turn 7 · dispatch d:x:n_review:2:a1');
  assert.equal(sessionRowLine(step, {}), 'Inside session One session · turn 7 · dispatch d:x:n_review:2:a1');
  assert.equal(sessionRowLine({}, {}), '');
});

// ── v2: the exec row's tooltip, the drawer line on Running and History, and what a plain row keeps ──
const REF = { sid: FIX_SID, hostEpoch: 1, hostSessionId: 'H', turnId: `t:${FIX_SID}:5`, dispatchId: 'd:x:n_review:1:a1', attempt: 1,
  memberAgentId: 'toolu_01ABCDEFGHIJKLMNOP', memberTranscriptId: 'ag-5', costSource: 'harness' };
const LINE = `Inside session Build and review · turn 5 · dispatch d:x:n_review:1:a1`;
const stamped = (st = groupedRunningState()) => ({ ...st, steps: st.steps.map((r) => (r.nodeId === 'n_review' ? { ...r, session: REF } : r)),
  sessionHosts: { [FIX_SID]: { ...st.sessionHosts[FIX_SID], label: 'Build and review' } } });
// Review's second cycle, turn 7: the drawer on a card (no execution) reads the newest row, on a row its own.
const REF2 = { ...REF, turnId: `t:${FIX_SID}:7`, dispatchId: 'd:x:n_review:2:a1', memberAgentId: 'toolu_02ZZZ' };
const cycle2 = (st) => ({ ...st, steps: [...st.steps, { key: 'x:n_review:2', executionId: 'x:n_review:2', nodeId: 'n_review', ordinal: 2, cycle: 2, status: 'done', activeMs: 1000, costUsd: 0.2, session: REF2 }] });
const LINE2 = 'Inside session Build and review · turn 7 · dispatch d:x:n_review:2:a1';
const trackDom = useDomRelease(afterEach);

test('v2 — the line reads only a real stamp: no sid, a turn id without a number and an unknown session', () => {
  assert.equal(sessionRowLine({ session: { turnId: 't:x:1' } }, {}), '', 'a stamp with no sid is no session');
  assert.equal(sessionRowLine({ session: { sid: SID } }, { [SID]: { label: '' } }), 'Inside session One session', 'no turn, no dispatch yet');
  assert.equal(sessionRowLine({ session: { sid: SID, turnId: `t:${SID}:12`, dispatchId: null } }, { s_zzzzzzzz: { label: 'Other' } }), 'Inside session One session · turn 12');
  assert.equal(sessionRowLine(null, null), '');
  assert.equal(sessionRowLine({ session: 'x' }, {}), '', 'a stamp that is not an object');
});

test('v2 — the drawer line: the words, then the sub-agent with a copy button; none for a plain row', () => {
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  const st = stamped();
  const p = sessionRowEl(doc, st.steps[2], st.sessionHosts);
  assert.equal(p.className, 'wf-log-sub');
  assert.equal(p.firstChild.textContent, LINE);
  assert.equal(p.querySelector('code').textContent, 'toolu_01…MNOP', 'a long id is shortened, the button copies it whole');
  const b = p.querySelector('button[data-copy]');
  assert.deepEqual([b.dataset.copy, b.type, b.textContent, b.title], [REF.memberAgentId, 'button', 'Copy id', 'Copy the sub-agent id']);
  assert.equal(b.hasAttribute('aria-label'), false, 'its name is its visible text (WCAG 2.5.3), so the "Copied" flash is heard');
  assert.equal(sessionRowEl(doc, st.steps[0], st.sessionHosts), null);
  const bound = sessionRowEl(doc, { session: { ...REF, memberAgentId: null } }, st.sessionHosts);
  assert.equal(bound.textContent, LINE, 'no sub-agent yet: the line alone');
});

test('v2 — the monitor: a member\'s exec row carries the line as its tooltip; a plain row has no title', () => {
  const st = stamped();
  const decor = decorFromState(st, { live: true, now: 0, sessionVerified: { claude: true } });
  assert.equal(decor.footers.n_review.rows[0].title, LINE);
  assert.equal('title' in decor.footers.n_plan.rows[0], false, 'an ungrouped row keeps its shape');
  assert.equal('title' in decor.footers.n_impl.rows[0], false, 'a member row not (yet) stamped');
  const dom = trackDom(new JSDOM('<!doctype html><body><div class="run-flow-wrap"><div id="h"></div></div></body>'));
  const doc = dom.window.document;
  const m = mountRunGraph(doc.getElementById('h'), { doc, mode: 'monitor', raf: (fn) => { fn(); return 1; } });
  const paint = (d) => m.update('run1', st.stepper, { ...d, detail: true });   // the exec rows are Expert detail
  const expand = (id) => doc.querySelector(`.node[data-node-id="${id}"] .xtoggle`).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  paint(decor);
  expand('n_review');
  const row = doc.querySelector('.xrow[data-execution-id="x:n_review:1"]');
  assert.equal(row.title, LINE);
  paint(decorFromState(groupedRunningState(), { live: true, now: 0, sessionVerified: { claude: true } }));
  const same = doc.querySelector('.xrow[data-execution-id="x:n_review:1"]');
  assert.equal(same, row, 'the row is reused');
  assert.equal(same.hasAttribute('title'), false, 'a repaint without the stamp removes it');
  paint(decor);
  assert.equal(doc.querySelector('.xrow[data-execution-id="x:n_review:1"]').title, LINE, 'a row stamped later gains it');
  expand('n_plan');
  assert.equal(doc.querySelector('.xrow[data-execution-id="x:n_plan:1"]').hasAttribute('title'), false, 'a plain row gets no title attribute');
});

test('v2 — the run page: a member\'s step drawer says where it ran, under its head; a plain step says nothing; a stamp mid-step adds it', async () => {
  const ctx = await bootApp();
  const { window } = ctx;
  const np = window.__np;
  const copied = [];
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async (t) => { copied.push(t); } }, configurable: true });
  const st = stamped();
  helloRun(ctx, { runId: 'r1' });
  const frame = (steps) => ctx.dispatch({ type: 'state', runId: 'r1', id: 'p1', status: 'running', stepper: SESSION_STEPPER, runEngine: 'claude', steps, active: st.active, sessionHosts: st.sessionHosts });
  frame(st.steps);
  ctx.go('#running/r1/details/workflow');
  await ctx.settle(6);
  const screen = window.document.querySelector('#run-detail');
  const host = screen.querySelector('.rd-graph .run-flow');
  const r = np.getRun('r1');
  np.openStepLog(host, { run: r, runId: 'r1' }, 'x:n_review:1', 'n_review');
  const drawer = screen.querySelector('.rd-sec[data-sec="workflow"] .wf-log-drawer');
  const sub = drawer.querySelector('.wf-log-sub');
  assert.ok(sub, 'the line is there');
  assert.equal(sub.firstChild.textContent, LINE);
  assert.equal(drawer.querySelector('.wf-log-head').nextElementSibling, sub, 'under the head');
  assert.ok(sub.nextElementSibling.classList.contains('wf-log-body'), 'above the lines');
  const copy = sub.querySelector('button[data-copy]');
  copy.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await ctx.settle(2);
  assert.deepEqual(copied, [REF.memberAgentId]);
  assert.equal(copy.textContent, 'Copied');
  frame(st.steps);   // the same frame again: the line is kept, not rebuilt (its button keeps the focus)
  await ctx.settle(2);
  assert.equal(drawer.querySelector('.wf-log-sub'), sub);
  frame(cycle2(st).steps);
  await ctx.settle(2);
  assert.equal(drawer.querySelector('.wf-log-sub').firstChild.textContent, LINE, 'a row target keeps its own row when a newer cycle exists');
  np.openStepLog(host, { run: r, runId: 'r1' }, '', 'n_review');
  assert.equal(drawer.querySelector('.wf-log-sub').firstChild.textContent, LINE2, 'a node-wide target reads the newest row');
  np.openStepLog(host, { run: r, runId: 'r1' }, 'x:n_plan:1', 'n_plan');
  assert.equal(drawer.querySelector('.wf-log-sub'), null, 'a step outside a session');
  np.openStepLog(host, { run: r, runId: 'r1' }, 'x:n_impl:1', 'n_impl');
  assert.equal(drawer.querySelector('.wf-log-sub'), null, 'a member not stamped yet');
  frame(st.steps.map((x) => (x.nodeId === 'n_impl' ? { ...x, session: { ...REF, turnId: `t:${FIX_SID}:4`, dispatchId: 'd:x:n_impl:1:a1' } } : x)));
  await ctx.settle(4);
  assert.equal(drawer.querySelector('.wf-log-sub').firstChild.textContent, 'Inside session Build and review · turn 4 · dispatch d:x:n_impl:1:a1', 'the next frame adds it');
});

test('v2 — History: a member card\'s drawer says where it ran (its newest row, cycle 2)', async () => {
  const st = cycle2(stamped());
  const steps = st.steps.map((x) => ({ ...x, status: 'done' }));
  const NDJSON = [{ source: 'reviewer', level: 'info', text: 'reviewing', nodeId: 'n_review', executionId: 'x:n_review:1', ts: '2026-10-28T10:00:00Z' }]
    .map((l) => JSON.stringify(l)).join('\n');
  const ctx = await bootDetail({
    detail: { ...DETAIL, artifacts: [{ kind: 'live-log', path: 'live-log.ndjson' }], state: { ...DETAIL.state, stepper: st.stepper, steps, active: [], sessionHosts: st.sessionHosts, runEngine: 'claude' } },
    arms: (url) => (url.endsWith('/log') ? Promise.resolve({ ok: true, status: 200, text: async () => NDJSON, json: async () => ({}) }) : null),
  });
  const { window } = ctx;
  window.document.documentElement.dataset.level = 'expert';   // History's drawer follows its Logs tab (Expert)
  await openDetail(ctx, 'details/workflow');
  await settleHd(window, 6);
  const card = window.document.querySelector('#hist-detail .hd-graph .node[data-node-id="n_review"]');
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settleHd(window, 4);
  const drawer = window.document.querySelector('#hist-detail .wf-log-drawer');
  assert.equal(drawer.hidden, false);
  assert.equal(drawer.querySelector('.wf-log-sub').firstChild.textContent, LINE2, 'a card opens its node: the newest row');
  window.document.querySelector('#hist-detail .hd-graph .node[data-node-id="n_plan"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settleHd(window, 4);
  assert.equal(drawer.querySelector('.wf-log-sub'), null, 'a step outside a session');
  // v4 (cycle-2 review): a footer row opens its own execution, so the drawer reads that row, not the node's newest.
  window.document.querySelector('#hist-detail .hd-graph .node[data-node-id="n_review"] .xtoggle').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settleHd(window, 2);
  window.document.querySelector('#hist-detail .hd-graph .xrow[data-execution-id="x:n_review:1"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settleHd(window, 4);
  assert.equal(drawer.querySelector('.wf-log-sub').firstChild.textContent, LINE, 'a footer row: its own row (cycle 1), not the newest');
});
