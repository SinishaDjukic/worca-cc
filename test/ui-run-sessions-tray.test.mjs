// test/ui-run-sessions-tray.test.mjs — the monitor tray is live and opens the session's log.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { mountRunGraph } from '../ui/public/graph/run-hosts.mjs';
import { decorFromState } from '../ui/public/graph/run-decor.mjs';
import { SID, SESSION_STEPPER, groupedRunningState } from './helpers/session-run-state.mjs';
import { bootApp, helloRun } from './helpers/run-page-boot.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { bootDetail, openDetail, settle as settleHd, DETAIL } from './helpers/history-detail-boot.mjs';

test('a header click calls onSessionClick with the sid; the aria label carries the status', async () => {
  const dom = new JSDOM('<!doctype html><body><div id="h" style="width:800px;height:400px"></div></body>');
  const doc = dom.window.document;
  const clicks = [];
  const STATE = (await import('./helpers/session-run-state.mjs')).groupedRunningState();   // a manifest with one session, Review active, turn 5
  const host = mountRunGraph(doc.getElementById('h'), { doc, mode: 'monitor', onSessionClick: (sid) => clicks.push(sid), sessionVerified: { claude: true }, sessionsOn: true });
  host.update('run1', STATE.stepper, decorFromState(STATE, { live: true, now: 0, sessionVerified: { claude: true } }));   // update(runId, stepper, decor), run-hosts.mjs:309
  const head = doc.querySelector('.gv-sess-head');
  assert.equal(head.getAttribute('role'), 'group');
  assert.match(head.getAttribute('aria-label'), /^One session: Implementation, Review\. running Review, turn 5$/);
  head.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(clicks, ['s_aaaaaaaa']);
});

// ── v2: keyboard, hosts without the callback, the view options, and the app's wiring ──
const OPEN = { claude: true };
const trackDom = useDomRelease(afterEach);
function mount(opts = {}, state = groupedRunningState(), decorOpts = {}) {
  const dom = trackDom(new JSDOM('<!doctype html><body><div class="run-flow-wrap"><div id="h"></div></div></body>'));
  const doc = dom.window.document;
  const m = mountRunGraph(doc.getElementById('h'), { doc, mode: 'monitor', raf: (fn) => { fn(); return 1; }, ...opts });
  const decor = decorFromState(state, { live: true, now: 0, sessionVerified: OPEN, ...decorOpts });
  return { dom, doc, m, decor, update: (d = decor) => m.update('run1', state.stepper, d) };
}

test('v2 — the header is a tab stop that opens its session on Enter and Space; the host shows the pointer', () => {
  const clicks = [];
  const t = mount({ onSessionClick: (sid) => clicks.push(sid) });
  t.update();
  const head = t.doc.querySelector('.gv-sess-head');
  assert.equal(head.getAttribute('tabindex'), '0');
  assert.ok(t.doc.getElementById('h').classList.contains('gv-sess-links'));
  for (const key of ['Enter', ' ', 'a']) head.dispatchEvent(new t.dom.window.KeyboardEvent('keydown', { key, bubbles: true }));
  assert.deepEqual(clicks, [SID, SID], 'Enter and Space, nothing else');
  t.m.destroy();
  assert.equal(t.doc.getElementById('h').classList.contains('gv-sess-links'), false, 'destroy releases the class');
});

test('v2 — a host without the callback, a card host with one, and a run without a session take no session click', () => {
  const t = mount({});
  t.update();
  const head = t.doc.querySelector('.gv-sess-head');
  assert.equal(head.hasAttribute('tabindex'), false);
  assert.equal(t.doc.getElementById('h').classList.contains('gv-sess-links'), false);
  head.dispatchEvent(new t.dom.window.MouseEvent('click', { bubbles: true }));   // nothing to call, nothing thrown
  const clicks = [];
  const card = mount({ mode: 'card', onSessionClick: (sid) => clicks.push(sid) });
  card.update();
  const cardHead = card.doc.querySelector('.gv-sess-head');
  assert.deepEqual([cardHead.hasAttribute('tabindex'), card.doc.getElementById('h').classList.contains('gv-sess-links')], [false, false], 'a card host is not a monitor');
  cardHead.dispatchEvent(new card.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.deepEqual(clicks, []);
  const st = groupedRunningState();
  const plainStepper = { ...st.stepper, graph: { ...st.stepper.graph, nodes: st.stepper.graph.nodes.map((n) => ({ ...n, config: {} })) } };
  const plain = mount({ onSessionClick: () => {} }, { ...st, stepper: plainStepper, sessionHosts: undefined });
  plain.update();
  assert.equal(plain.doc.getElementById('h').classList.contains('gv-sess-links'), false, 'no tray, no pointer class');
});

test('v2 — before a decor speaks for a session, the tray follows the run\'s engine and the host\'s Labs flag', () => {
  const t = mount({ sessionVerified: OPEN, sessionsOn: true });
  t.update({ ...t.decor, sessions: {}, run: { runEngine: 'cursor' } });
  assert.equal(t.doc.querySelector('.gv-sess-head .st').textContent, 'One session · Cursor: separate sessions', 'the view was built with the run\'s engine');
  const off = mount({ sessionVerified: OPEN, sessionsOn: false });
  off.update({ ...off.decor, sessions: {} });
  assert.equal(off.doc.querySelector('.gv-sess-head .st').textContent, 'One session · Claude: separate sessions', 'sessionsOn reaches the view');
  const on = mount({ sessionVerified: OPEN, sessionsOn: true });
  on.update({ ...on.decor, sessions: {} });
  assert.equal(on.doc.querySelector('.gv-sess-head .st').textContent, 'One session · Claude · 2 sub-agents', 'and so does sessionVerified');
});

test('v2 — the run page: state frames carry sessionHosts, the monitor wires the header, openSessionLog picks the member', async () => {
  const { window } = await bootApp();
  const np = window.__np;
  const st = groupedRunningState();
  const r = np.makeRun({ runId: 'r1', title: 't', projectDir: '/p', status: 'running' });
  np.onState(r, { status: 'running', stepper: SESSION_STEPPER, runEngine: 'claude', steps: st.steps, active: st.active, sessionHosts: st.sessionHosts });
  assert.deepEqual(r.sessionHosts, st.sessionHosts, 'the live run keeps the summaries (the decor and the Sessions tab read them)');
  const host = window.document.createElement('div'); host.className = 'run-flow';
  const wrap = window.document.createElement('div'); wrap.className = 'run-flow-wrap'; wrap.appendChild(host);
  window.document.body.appendChild(wrap);
  const decor = np.runDecorFor(r, 'monitor');
  np.paintGraphFor(host, r.stepper, decor, []);
  assert.ok(host.classList.contains('gv-sess-links'), 'paintGraphFor passes onSessionClick');
  host.querySelector('.gv-sess-head').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));   // never throws
  // Task 60: the header opens the whole session, whichever member runs now (it used to pick one member's log).
  const T = { session: SID, sessionMembers: ['n_impl', 'n_review'], label: 'One session · Implementation + Review' };
  assert.deepEqual(np.openSessionLog(host, decor, SID), T, 'the member running now: the whole session');
  const queued = { ...decor, run: { ...decor.run, steps: [...st.steps, { key: 'x:n_impl:2', executionId: 'x:n_impl:2', nodeId: 'n_impl', ordinal: 2, status: 'running', queued: true }] } };
  assert.deepEqual(np.openSessionLog(host, queued, SID), T, 'a member queued: the whole session');
  // A fix loop: Implementation cycle 2 failed after Review cycle 1; nothing runs now.
  const loop = { ...decor, run: { ...decor.run, steps: [...st.steps.slice(0, 2), { ...st.steps[2], status: 'done' }, { key: 'x:n_impl:2', executionId: 'x:n_impl:2', nodeId: 'n_impl', ordinal: 2, status: 'error' }] },
    sessions: { [SID]: { ...decor.sessions[SID], current: null } } };
  assert.deepEqual(np.openSessionLog(host, loop, SID), T, 'nothing running: the whole session');
  const early = { ...loop, sessions: { [SID]: { ...decor.sessions[SID], current: { nodeId: 'n_review', label: 'Review' } } }, run: { ...loop.run, steps: st.steps.slice(0, 2) } };
  assert.deepEqual(np.openSessionLog(host, early, SID), T, 'a member active before its first row: the whole session');
  const none = { ...loop, run: { ...loop.run, steps: [st.steps[0]] } };
  assert.equal(np.openSessionLog(host, none, SID), null, 'a session that never ran opens nothing');
  assert.equal(np.openSessionLog(host, decor, 's_zzzzzzzz'), null);
});

// ── v3: a header with nothing to open is inert; Space never scrolls; a ×N member; the click opens the drawer ──
test('v3 — a session whose members never ran is no tab stop and takes no click; Space is kept from the page', () => {
  const clicks = [];
  const st = groupedRunningState();
  const t = mount({ onSessionClick: (sid) => clicks.push(sid) }, { ...st, steps: [st.steps[0]], active: [{ nodeId: 'n_plan', executionId: 'x:n_plan:1' }] });
  t.update();
  const head = t.doc.querySelector('.gv-sess-head');
  assert.equal(head.hasAttribute('tabindex'), false, 'nothing ran: nothing to open (linkCards keeps such a card inert)');
  assert.ok(t.doc.getElementById('h').classList.contains('gv-sess-links'), 'the host still has a tray');
  head.dispatchEvent(new t.dom.window.MouseEvent('click', { bubbles: true }));
  head.dispatchEvent(new t.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.deepEqual(clicks, []);
  t.update(decorFromState(groupedRunningState(), { live: true, now: 0, sessionVerified: OPEN }));   // the members ran
  assert.equal(head.getAttribute('tabindex'), '0', 'the same header becomes a tab stop');
  const space = new t.dom.window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  head.dispatchEvent(space);
  assert.deepEqual([clicks, space.defaultPrevented], [[SID], true], 'Space opens it and does not scroll the page');
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /^\.gv-sess-links \.gv-sess-head\[tabindex="0"\]\{cursor:pointer;\}$/m, 'v5: the pointer only on a header that is a tab stop');
  assert.doesNotMatch(css, /\.gv-sess-links \.gv-sess-head\{[^}]*cursor/, 'v5: an inert header keeps the default cursor');
});

test('v3 — the run page: a header click opens the drawer on the whole session (Task 60), a ×N member\'s slices included', async () => {
  const ctx = await bootApp();
  const { window } = ctx;
  const np = window.__np;
  const st = groupedRunningState();
  helloRun(ctx, { runId: 'r1' });
  ctx.dispatch({ type: 'state', runId: 'r1', id: 'p1', status: 'running', stepper: SESSION_STEPPER, runEngine: 'claude', steps: st.steps, active: st.active, sessionHosts: st.sessionHosts });
  ctx.dispatch({ type: 'log', runId: 'r1', source: 'reviewer', level: 'info', text: 'reviewing', nodeId: 'n_review', executionId: 'x:n_review:1', ts: Date.now() });
  ctx.go('#running/r1/details/workflow');
  await ctx.settle(6);
  const screen = window.document.querySelector('#run-detail');
  const r = np.getRun('r1');
  screen.querySelector('.rd-graph .gv-sess-head').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const drawer = screen.querySelector('.rd-sec[data-sec="workflow"] .wf-log-drawer');
  assert.equal(drawer.hidden, false, 'the wiring reaches openSessionLog (a throw inside a listener only prints in jsdom)');
  assert.equal(drawer.querySelector('.wf-log-title').textContent, 'One session · Implementation + Review');
  const T = { session: SID, sessionMembers: ['n_impl', 'n_review'], label: 'One session · Implementation + Review' };
  assert.deepEqual(r.logDrawer, T);
  const slice = { key: 'x:n_review:1:t2', executionId: 'x:n_review:1:t2', nodeId: 'n_review', kind: 'task', parentExecutionId: 'x:n_review:1', status: 'start', activeMs: 0 };
  ctx.dispatch({ type: 'state', runId: 'r1', id: 'p1', status: 'running', stepper: SESSION_STEPPER, runEngine: 'claude', steps: [...st.steps, slice], active: st.active, sessionHosts: st.sessionHosts });
  await ctx.settle(4);
  screen.querySelector('.rd-graph .gv-sess-head').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(r.logDrawer, T, 'a ×N member: the same session filter (its slices carry its node id)');
  ctx.dispatch({ type: 'log', runId: 'r1', ts: Date.now(), source: 'reviewer', level: 'info', text: 'slice t2 line', nodeId: 'n_review', executionId: 'x:n_review:1:t2' });
  await ctx.settle(2);
  assert.ok([...drawer.querySelectorAll('.log-line')].some((n) => n.textContent.includes('slice t2 line')), 'a slice\'s own line is in the session\'s log');
});

// ── v4: History links a header only where it can open a log ──
test('v4 — History: the tray header is a tab stop only when the run saved a log (its cards are inert without one)', async () => {
  const st = groupedRunningState();
  const steps = st.steps.map((r) => ({ ...r, status: 'done' }));
  for (const [artifacts, tab, links] of [[[], null, false], [[{ kind: 'live-log', path: 'live-log.ndjson' }], '0', true]]) {
    const ctx = await bootDetail({ detail: { ...DETAIL, artifacts, state: { ...DETAIL.state, stepper: st.stepper, steps, active: [], sessionHosts: st.sessionHosts, runEngine: 'claude' } } });
    await openDetail(ctx, 'details/workflow');
    await settleHd(ctx.window, 6);
    const head = ctx.window.document.querySelector('#hist-detail .gv-sess-head');
    assert.ok(head, 'the tray painted');
    assert.equal(head.getAttribute('tabindex'), tab, artifacts.length ? 'a saved log: the header opens it' : 'no saved log: nothing to open');
    assert.equal(!!head.closest('.gv-sess-links'), links);
    ctx.window.close();
  }
});
