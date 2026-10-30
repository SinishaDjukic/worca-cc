// test/ui-log-filter-session.test.mjs — one session's lines: the main agent's and its steps'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileLogFilter, logFacets } from '../ui/public/log-filter.mjs';
import { projectLogRecord } from '../ui/public/log-line.mjs';
import { SID as FIX_SID, SESSION_STEPPER, groupedRunningState } from './helpers/session-run-state.mjs';
import { bootApp, helloRun } from './helpers/run-page-boot.mjs';
import { bootDetail, openDetail, settle as settleHd, DETAIL } from './helpers/history-detail-boot.mjs';

const SID = 's_aaaaaaaa';
const lines = [
  { source: 'session', text: 'handed Review to its sub-agent (turn 5)', session: SID, nodeId: 'n_review' },
  { source: 'implementer', text: 'edit', nodeId: 'n_impl' },
  { source: 'planner', text: 'plan', nodeId: 'n_plan' },
];

test('the session axis keeps the main agent lines and the members\' lines', () => {
  const f = compileLogFilter({ session: SID, sessionMembers: ['n_impl', 'n_review'] });
  assert.deepEqual(lines.filter(f).map((l) => l.text), ['handed Review to its sub-agent (turn 5)', 'edit']);
  assert.equal(lines.filter(compileLogFilter({})).length, 3);
  assert.ok(logFacets(lines).sources.includes('session'));
});

test('the chip markup sits beside the execution chip', () => {
  const html = readFileSync(new URL('../ui/public/index.html', import.meta.url), 'utf8');
  assert.match(html, /class="log-f log-f-exec[^"]*"[\s\S]{0,600}?class="log-f log-f-session btn btn-sm" hidden title="Showing one session\. Click to clear"/);
});

// ── v2: the axis's edges, the line's `session` in the browser, the chip on both Logs tabs, the header's drawer ──
test('v2 — the axis: a main-agent line with no step passes; another session\'s and a non-member\'s do not; an empty sid is "all"', () => {
  const more = [...lines, { source: 'session', level: 'warn', text: 'booking failed', session: SID },
    { source: 'session', text: 'other host', session: 's_bbbbbbbb', nodeId: 'n_x' }];
  const f = compileLogFilter({ session: SID, sessionMembers: ['n_impl', 'n_review'] });
  assert.deepEqual(more.filter(f).map((l) => l.text), ['handed Review to its sub-agent (turn 5)', 'edit', 'booking failed']);
  assert.deepEqual(more.filter(compileLogFilter({ session: SID })).map((l) => l.text), ['handed Review to its sub-agent (turn 5)', 'booking failed'],
    'no members: the main agent\'s lines only');
  for (const s of ['', null, undefined]) assert.equal(more.filter(compileLogFilter({ session: s, sessionMembers: ['n_impl'] })).length, more.length, String(s));
  assert.deepEqual(more.filter(compileLogFilter({ session: SID, sessionMembers: ['n_impl', 'n_review'], level: 'warn' })).map((l) => l.text), ['booking failed'],
    'AND with the other axes');
});

test('v2 — the browser keeps a line\'s session: the saved log\'s projection and the live log', async () => {
  assert.equal(projectLogRecord({ source: 'session', text: 't', ts: 1, session: SID, nodeId: 'n_review' }).session, SID);
  assert.equal('session' in projectLogRecord({ source: 'x', text: 't', ts: 1 }), false, 'absent stays absent');
  assert.equal('session' in projectLogRecord({ source: 'x', text: 't', ts: 1, session: 7 }), false);
  const ctx = await bootApp();
  const np = ctx.window.__np;
  const r = np.makeRun({ runId: 'r1', title: 't', projectDir: '/p', status: 'running' });
  np.onLog(r, { source: 'session', level: 'warn', text: 'booking failed', session: SID, ts: 1 });
  np.onLog(r, { source: 'planner', level: 'info', text: 'plan', nodeId: 'n_plan', ts: 2 });
  assert.deepEqual(r.logLines.map((l) => l.session), [SID, undefined]);
});

const T = { session: FIX_SID, sessionMembers: ['n_impl', 'n_review'], label: 'One session · Implementation + Review' };
const LOG = [
  { source: 'planner', level: 'info', text: 'plan written', nodeId: 'n_plan', executionId: 'x:n_plan:1' },
  { source: 'implementer', level: 'info', text: 'edited files', nodeId: 'n_impl', executionId: 'x:n_impl:1' },
  { source: 'session', level: 'info', text: 'handed Review to its sub-agent (turn 5)', session: FIX_SID, nodeId: 'n_review', executionId: 'x:n_review:1' },
  { source: 'reviewer', level: 'info', text: 'reviewing', nodeId: 'n_review', executionId: 'x:n_review:1' },
  { source: 'session', level: 'warn', text: 'booking failed', session: FIX_SID },
];
const SESSION_TEXTS = ['edited files', 'handed Review to its sub-agent (turn 5)', 'reviewing', 'booking failed'];
const shown = (root) => [...root.querySelectorAll('.log-line')].map((n) => n.textContent);
const only = (root, want) => want.every((w) => shown(root).some((t) => t.includes(w))) && !shown(root).some((t) => t.includes('plan written'));

async function liveSessionRun() {
  const ctx = await bootApp();
  const { window } = ctx;
  const st = groupedRunningState();
  helloRun(ctx, { runId: 'r1' });
  ctx.dispatch({ type: 'state', runId: 'r1', id: 'p1', status: 'running', stepper: SESSION_STEPPER, runEngine: 'claude', steps: st.steps, active: st.active, sessionHosts: st.sessionHosts });
  for (const l of LOG) ctx.dispatch({ type: 'log', runId: 'r1', ts: Date.now(), ...l });
  return { ctx, window, np: window.__np, r: window.__np.getRun('r1') };
}

test('v2 — the Logs tab: the chip names the session, reads back, survives a level pick, and clears on a click or a node pick', async () => {
  const { ctx, window, np, r } = await liveSessionRun();
  ctx.go('#running/r1/details/logs');
  await ctx.settle(6);
  const sec = window.document.querySelector('#run-detail .rd-sec-logs');
  const chip = sec.querySelector('.log-f-session');
  assert.equal(chip.hidden, true, 'the chip ships hidden');
  np.applyRunLogFilter(r, { session: FIX_SID, sessionMembers: ['n_impl', 'n_review'] });
  assert.equal(chip.hidden, false);
  assert.equal(chip.querySelector('.lfe-text').textContent, 'Showing one session · Implementation + Review');
  assert.deepEqual([np.readLogFilterFrom(sec).session, np.readLogFilterFrom(sec).sessionMembers], [FIX_SID, ['n_impl', 'n_review']]);
  assert.ok(only(sec, SESSION_TEXTS), 'the main agent\'s lines and the members\', not Plan\'s');
  const level = sec.querySelector('.log-f-level');
  level.value = 'warn';
  level.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(r.logFilter.session, FIX_SID, 'a level pick re-reads the bar: the session stays');
  assert.deepEqual(shown(sec).map((t) => /booking failed/.test(t)), [true]);
  level.value = '';
  level.dispatchEvent(new window.Event('change', { bubbles: true }));
  chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(chip.hidden, true);
  assert.equal(r.logFilter.session, '');
  assert.ok(shown(sec).some((t) => t.includes('plan written')), 'cleared: every line');
  np.applyRunLogFilter(r, { session: FIX_SID, sessionMembers: ['n_impl', 'n_review'] });
  const node = sec.querySelector('.log-f-step');
  node.value = 'n_plan';
  node.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(r.logFilter.session, '', 'a node pick is another scope: it clears the session');
  assert.equal(chip.hidden, true);
  assert.deepEqual(shown(sec).map((t) => /plan written/.test(t)), [true]);
  np.applyRunLogFilter(r, { session: FIX_SID, sessionMembers: ['n_impl', 'n_review'] });
  np.focusLogExecution({ run: r, runId: 'r1' }, 'x:n_impl:1', 'n_impl');
  assert.deepEqual([r.logFilter.session, r.logFilter.execution, chip.hidden], ['', 'x:n_impl:1', true], 'a footer row is one step, not the session');
});

test('v2 — the run page: the tray header opens the drawer on the session; a streamed line joins it; Open in Logs carries the chip', async () => {
  const { ctx, window, r } = await liveSessionRun();
  ctx.go('#running/r1/details/workflow');
  await ctx.settle(6);
  const screen = window.document.querySelector('#run-detail');
  screen.querySelector('.rd-graph .node[data-node-id="n_plan"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));   // the drawer's opener is now the card
  const head = screen.querySelector('.rd-graph .gv-sess-head');
  head.focus();
  head.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const drawer = screen.querySelector('.rd-sec[data-sec="workflow"] .wf-log-drawer');
  assert.equal(drawer.hidden, false);
  assert.equal(drawer.querySelector('.wf-log-title').textContent, T.label);
  assert.deepEqual(r.logDrawer, T);
  assert.ok(only(drawer, SESSION_TEXTS));
  assert.equal(drawer.querySelector('.wf-log-sub'), null, 'the "Inside session" line is a step\'s, not the session\'s');
  assert.equal(screen.querySelector('.rd-graph [aria-current="true"]'), null, 'no card is marked: the drawer shows the session');
  const body = drawer.querySelector('.wf-log-body');
  body.focus();   // the focus leaves the header, or the assert below holds without the opener
  body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(drawer.hidden, true);
  assert.equal(window.document.activeElement, head, 'Esc returns the focus to the tray header, not to the card opened before');
  head.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(drawer.hidden, false, 'the header opens it again');
  ctx.dispatch({ type: 'log', runId: 'r1', ts: Date.now(), source: 'session', level: 'info', text: 'Review returned', session: FIX_SID, nodeId: 'n_review' });
  ctx.dispatch({ type: 'log', runId: 'r1', ts: Date.now(), source: 'planner', level: 'info', text: 'late plan line', nodeId: 'n_plan' });
  await ctx.settle(2);
  assert.ok(shown(drawer).some((t) => t.includes('Review returned')));
  assert.ok(!shown(drawer).some((t) => t.includes('late plan line')));
  drawer.querySelector('.wf-log-full').click();
  await ctx.settle(4);
  assert.ok(screen.querySelector('.rd-tab[data-sec="logs"]').classList.contains('active'));
  assert.deepEqual([r.logFilter.session, r.logFilter.sessionMembers, r.logFilter.node, r.logFilter.execution], [FIX_SID, ['n_impl', 'n_review'], '', '']);
  const chip = screen.querySelector('.rd-sec-logs .log-f-session');
  assert.equal(chip.hidden, false);
  assert.equal(chip.querySelector('.lfe-text').textContent, 'Showing one session · Implementation + Review');
});

test('v2 — History: the tray header opens the saved log filtered to the session; Open in Logs carries the chip', async () => {
  const st = groupedRunningState();
  const steps = st.steps.map((x) => ({ ...x, status: 'done' }));
  const NDJSON = LOG.map((l) => JSON.stringify({ ...l, ts: '2026-10-28T10:00:00Z' })).join('\n');
  const ctx = await bootDetail({
    detail: { ...DETAIL, artifacts: [{ kind: 'live-log', path: 'live-log.ndjson' }], state: { ...DETAIL.state, stepper: st.stepper, steps, active: [], sessionHosts: st.sessionHosts, runEngine: 'claude' } },
    arms: (url) => (url.endsWith('/log') ? Promise.resolve({ ok: true, status: 200, text: async () => NDJSON, json: async () => ({}) }) : null),
  });
  const { window } = ctx;
  window.document.documentElement.dataset.level = 'expert';   // History's drawer follows its Logs tab (Expert)
  await openDetail(ctx, 'details/workflow');
  await settleHd(window, 6);
  window.document.querySelector('#hist-detail .gv-sess-head').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settleHd(window, 4);
  const drawer = window.document.querySelector('#hist-detail .wf-log-drawer');
  assert.equal(drawer.hidden, false);
  assert.equal(drawer.querySelector('.wf-log-title').textContent, T.label);
  assert.ok(only(drawer, SESSION_TEXTS), 'the saved lines kept their session (projectLogRecord)');
  drawer.querySelector('.wf-log-full').click();
  await settleHd(window, 6);
  const sec = window.document.querySelector('#hist-detail .hd-sec[data-sec="logs"]');
  const chip = sec.querySelector('.log-f-session');
  assert.equal(chip.hidden, false);
  assert.equal(chip.querySelector('.lfe-text').textContent, 'Showing one session · Implementation + Review');
  assert.ok(only(sec, SESSION_TEXTS));
  chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(chip.hidden, true);
  assert.ok(shown(sec).some((t) => t.includes('plan written')));
});

// ── v3 (refine review): a rebuilt Logs tab, History's card path, the focus ──
test('v3 — the Logs tab rebuilt after a frame (a re-activated tab): both chips still clear, a node pick still clears the session', async () => {
  const { ctx, window, np, r } = await liveSessionRun();
  ctx.go('#running/r1/details/logs');
  await ctx.settle(6);
  const st = groupedRunningState();
  ctx.go('#running/r1/details/workflow');
  await ctx.settle(4);
  ctx.dispatch({ type: 'state', runId: 'r1', id: 'p1', status: 'running', stepper: SESSION_STEPPER, runEngine: 'claude', steps: st.steps, active: st.active, sessionHosts: st.sessionHosts });
  await ctx.settle(4);
  ctx.go('#running/r1/details/logs');
  await ctx.settle(6);
  const sec = window.document.querySelector('#run-detail .rd-sec-logs');
  np.applyRunLogFilter(r, { session: FIX_SID, sessionMembers: ['n_impl', 'n_review'] });
  const chip = sec.querySelector('.log-f-session');
  assert.equal(chip.hidden, false);
  chip.focus();
  chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual([chip.hidden, r.logFilter.session], [true, ''], 'the rebuilt bar\'s chip clears');
  assert.equal(window.document.activeElement, sec.querySelector('.log-search'), 'the focus moves to the search box, not the page');
  np.applyRunLogFilter(r, { session: FIX_SID, sessionMembers: ['n_impl', 'n_review'] });
  const node = sec.querySelector('.log-f-step');
  node.value = 'n_plan';
  node.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(r.logFilter.session, '', 'a node pick on the rebuilt bar clears the session');
  np.applyRunLogFilter(r, { execution: 'x:n_impl:1', node: 'n_impl' });
  const exec = sec.querySelector('.log-f-exec');
  exec.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual([exec.hidden, r.logFilter.execution], [true, ''], 'the execution chip too (it had the same defect)');
});

test('v3 — History: a card\'s Open in Logs is one step, so it clears the session chip; Esc returns the focus to the header', async () => {
  const st = groupedRunningState();
  const steps = st.steps.map((x) => ({ ...x, status: 'done' }));
  const NDJSON = LOG.map((l) => JSON.stringify({ ...l, ts: '2026-10-28T10:00:00Z' })).join('\n');
  const ctx = await bootDetail({
    detail: { ...DETAIL, artifacts: [{ kind: 'live-log', path: 'live-log.ndjson' }], state: { ...DETAIL.state, stepper: st.stepper, steps, active: [], sessionHosts: st.sessionHosts, runEngine: 'claude' } },
    arms: (url) => (url.endsWith('/log') ? Promise.resolve({ ok: true, status: 200, text: async () => NDJSON, json: async () => ({}) }) : null),
  });
  const { window } = ctx;
  const doc = window.document;
  doc.documentElement.dataset.level = 'expert';
  await openDetail(ctx, 'details/workflow');
  await settleHd(window, 6);
  doc.querySelector('#hist-detail .hd-graph .node[data-node-id="n_plan"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));   // the drawer's opener is now the card (correction 17)
  await settleHd(window, 4);
  const head = doc.querySelector('#hist-detail .gv-sess-head');
  head.focus();
  head.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await settleHd(window, 4);
  const drawer = doc.querySelector('#hist-detail .wf-log-drawer');
  assert.equal(drawer.hidden, false);
  assert.equal(drawer.querySelector('.wf-log-title').textContent, T.label);
  const body = drawer.querySelector('.wf-log-body');
  body.focus();   // the focus leaves the header, or the assert below holds without the opener
  body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(drawer.hidden, true);
  assert.equal(doc.activeElement, head, 'a session target has no card: the focus returns to its header, not to the card opened before');
  head.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settleHd(window, 4);
  drawer.querySelector('.wf-log-full').click();
  await settleHd(window, 6);
  const sec = doc.querySelector('#hist-detail .hd-sec[data-sec="logs"]');
  assert.equal(sec.querySelector('.log-f-session').hidden, false);
  doc.querySelector('#hist-detail .hd-tab[data-sec="workflow"]').click();
  await settleHd(window, 4);
  doc.querySelector('#hist-detail .hd-graph .node[data-node-id="n_plan"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settleHd(window, 4);
  drawer.querySelector('.wf-log-full').click();
  await settleHd(window, 6);
  assert.equal(sec.querySelector('.log-f-session').hidden, true, 'the card\'s step, not the session');
  assert.equal(sec.querySelector('.log-f-step').value, 'n_plan');
  assert.deepEqual(shown(sec).map((t) => /plan written/.test(t)), [true]);
});

test('v4 — History: a card\'s Open in Logs after a footer row\'s clears the execution chip too (one step, every run of it)', async () => {
  const st = groupedRunningState();
  const steps = st.steps.map((x) => ({ ...x, status: 'done' }));
  const NDJSON = LOG.map((l) => JSON.stringify({ ...l, ts: '2026-10-28T10:00:00Z' })).join('\n');
  const ctx = await bootDetail({
    detail: { ...DETAIL, artifacts: [{ kind: 'live-log', path: 'live-log.ndjson' }], state: { ...DETAIL.state, stepper: st.stepper, steps, active: [], sessionHosts: st.sessionHosts, runEngine: 'claude' } },
    arms: (url) => (url.endsWith('/log') ? Promise.resolve({ ok: true, status: 200, text: async () => NDJSON, json: async () => ({}) }) : null),
  });
  const { window } = ctx;
  const doc = window.document;
  doc.documentElement.dataset.level = 'expert';
  await openDetail(ctx, 'details/workflow');
  await settleHd(window, 6);
  doc.querySelector('#hist-detail .hd-graph .node[data-node-id="n_impl"] .xtoggle').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settleHd(window, 2);
  doc.querySelector('#hist-detail .hd-graph .xrow[data-execution-id="x:n_impl:1"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settleHd(window, 4);
  const drawer = doc.querySelector('#hist-detail .wf-log-drawer');
  assert.equal(drawer.hidden, false, 'the footer row opens the drawer on its execution');
  drawer.querySelector('.wf-log-full').click();
  await settleHd(window, 6);
  const sec = doc.querySelector('#hist-detail .hd-sec[data-sec="logs"]');
  assert.equal(sec.querySelector('.log-f-exec').hidden, false, 'a footer row is one execution');
  doc.querySelector('#hist-detail .hd-tab[data-sec="workflow"]').click();
  await settleHd(window, 4);
  doc.querySelector('#hist-detail .hd-graph .node[data-node-id="n_plan"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settleHd(window, 4);
  drawer.querySelector('.wf-log-full').click();
  await settleHd(window, 6);
  assert.equal(sec.querySelector('.log-f-exec').hidden, true, 'the card\'s step, not Implementation\'s run');
  assert.equal(sec.querySelector('.log-f-step').value, 'n_plan');
  assert.deepEqual(shown(sec).map((t) => /plan written/.test(t)), [true]);
});

test('v2 — the chip stays hidden like the execution chip (a .btn would show through `hidden`)', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /^\.log-filters \.log-f-session\[hidden\]\{display:none;\}$/m);
});
