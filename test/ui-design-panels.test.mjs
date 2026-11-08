// The Design stage's Agents popover and dot tip (ui/public/design/agents-panel.mjs) and the chat's Plan list
// (ui/public/design/plan-list.mjs): markup per the mock (canvas/build.mjs popover, tip, planCard, stoppedRows,
// FAIL_CARD), every frame string as text, rows kept across paints, Stop per agent, and the M8/M12 Retry rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createAgentsPanel, createDotTip } from '../ui/public/design/agents-panel.mjs';
import { createPlanList } from '../ui/public/design/plan-list.mjs';

const tick = () => new Promise((resolve) => setImmediate(resolve));

function dom() {
  const d = new JSDOM('<!doctype html><html><body><div class="dz-wrap"></div></body></html>', { url: 'http://localhost/' });
  return { win: d.window, doc: d.window.document, host: d.window.document.querySelector('.dz-wrap') };
}

function rigPanel() {
  const { win, doc, host } = dom();
  const scrolled = [];
  win.Element.prototype.scrollIntoView = function scrollIntoView(o) { scrolled.push([this, o]); };
  const stops = []; const closed = [];
  let stop = () => Promise.resolve();
  const panel = createAgentsPanel({
    doc, host,
    onStopAgent: (id) => { stops.push(id); return stop(id); },
    onClose: () => closed.push(true),
  });
  return { panel, el: panel.el, win, doc, host, stops, closed, scrolled, setStop: (fn) => { stop = fn; }, tick };
}

function rigTip() {
  const { doc, host } = dom();
  const tip = createDotTip({ doc, host });
  return { tip, el: tip.el };
}

function rigList() {
  const { doc } = dom();
  const retries = []; const details = [];
  const list = createPlanList({ doc, onRetry: (id) => retries.push(id), onDetails: (id) => details.push(id) });
  doc.body.appendChild(list.el);
  return { list, retries, details };
}

const ROWS = { running: 2, rows: [
  { agentId: 'a', name: 'Hero', crew: '--teal-ink', status: 'Writing', statusClass: '', action: 'Writing index.html', cost: '≥$0.31', costTitle: '', gone: false, canStop: true },
  { agentId: 'l', name: 'Lead', crew: '--ink', status: 'Writing', statusClass: '', action: 'Writing plan.json', cost: '$0.10', costTitle: '', gone: false, canStop: false },
  { agentId: 'f', name: 'Price', crew: '--ink-3', status: 'Failed', statusClass: 'is-fail', action: '<b>Boom</b>', cost: '', costTitle: 'cost unknown', gone: true, canStop: false }] };

test('the popover: head with Agents and the running count; rows in order; stop on builders only; finished rows still listed', () => {
  const { panel, el } = rigPanel(); panel.open(); panel.paint(ROWS);
  assert.deepEqual([el.getAttribute('role'), el.getAttribute('aria-label')], ['dialog', 'Agents']);
  assert.equal(el.querySelector('.dz-pop-head b').textContent, 'Agents');
  assert.equal(el.querySelector('.dz-pop-head .dz-meta').textContent, '2 running');
  const rows = [...el.querySelectorAll('.dz-arow')];
  assert.deepEqual(rows.map((r) => [r.querySelector('.dz-aname').textContent, r.querySelector('.dz-astat').textContent, r.querySelector('.dz-aact').textContent, r.querySelector('.dz-acost').textContent]), [
    ['Hero', 'Writing', 'Writing index.html', '≥$0.31'], ['Lead', 'Writing', 'Writing plan.json', '$0.10'], ['Price', 'Failed', '<b>Boom</b>', '']]);
  assert.equal(rows[0].querySelector('.dz-adot').style.background, 'var(--teal-ink)');
  assert.deepEqual(rows.map((r) => r.querySelector('button')?.getAttribute('aria-label') ?? null), ['Stop Hero', null, null]);
  assert.ok(rows[2].classList.contains('is-gone'));
  assert.ok(rows[2].querySelector('.dz-astat').classList.contains('is-fail'));
  assert.equal(el.querySelector('.dz-arow b'), null, 'text stays text');
  assert.equal(rows[2].querySelector('.dz-acost').title, 'cost unknown');
});
test('opening on an agent marks its row and scrolls it into view; rows are kept across paints', () => {
  const { panel, el, scrolled } = rigPanel(); panel.open('l'); panel.paint(ROWS);
  const row = el.querySelector('.dz-arow.is-picked');
  assert.equal(row.querySelector('.dz-aname').textContent, 'Lead');
  assert.equal(scrolled.length, 1);
  panel.paint(ROWS);
  assert.equal(el.querySelector('.dz-arow.is-picked'), row);
  assert.equal(scrolled.length, 1, 'scrolled once per open, not on every paint');
  panel.paint({ ...ROWS, rows: [...ROWS.rows].reverse() });
  assert.deepEqual([...el.querySelectorAll('.dz-aname')].map((n) => n.textContent), ['Price', 'Lead', 'Hero'], 'rows follow the model order');
  assert.equal(el.querySelector('.dz-arow.is-picked'), row);
});
test('stop one posts through the callback, disables while pending, and a refusal shows in its row', async () => {
  const { panel, el, win, stops, setStop, tick } = rigPanel(); panel.open(); panel.paint(ROWS);
  const b = el.querySelector('[aria-label="Stop Hero"]');
  b.click(); assert.equal(b.disabled, true);
  b.dispatchEvent(new win.Event('click'));
  await tick();
  assert.deepEqual(stops, ['a']);
  setStop(() => Promise.reject(new Error('gone')));
  el.querySelector('[aria-label="Stop Hero"]').click(); await tick();
  const st = el.querySelector('.dz-arow .dz-astat');
  assert.deepEqual([st.textContent, st.title, st.classList.contains('is-fail')], ['Could not stop', 'gone', true]);
  panel.paint(ROWS);
  assert.equal(st.textContent, 'Could not stop', 'a repaint with the same status keeps the refusal');
  panel.paint({ ...ROWS, rows: [{ ...ROWS.rows[0], status: 'Stopped', canStop: false }, ...ROWS.rows.slice(1)] });
  assert.deepEqual([st.textContent, st.hasAttribute('title'), st.classList.contains('is-fail')], ['Stopped', false, false]);
});
test('Esc and × close it; closed, it is hidden and paints nothing costly', () => {
  const { panel, el, win, host, closed } = rigPanel(); panel.open(); panel.paint(ROWS);
  const outer = [];
  host.addEventListener('keydown', (e) => outer.push(e.key));
  el.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.deepEqual([panel.isOpen(), el.hidden, closed.length], [false, true, 1]);
  assert.deepEqual(outer, [], 'the Esc that closes the popover goes no further');
  panel.paint({ running: 0, rows: [] });
  assert.equal(el.querySelectorAll('.dz-arow').length, 3, 'closed, a paint touches no row');
  panel.open();
  assert.deepEqual([el.querySelectorAll('.dz-arow').length, el.querySelector('.dz-meta').textContent], [0, '0 running'], 'open paints the model kept while closed');
  el.querySelector('.dz-pop-head button').click();
  assert.equal(panel.isOpen(), false);
  assert.equal(closed.length, 2);
});
test('the dot tip: dot, name, action, as text', () => {
  const { tip, el } = rigTip();
  tip.show({ crew: '--teal-ink', name: 'Hero', action: '<i>x</i>' });
  assert.equal(el.querySelector('.dz-tip-dot').style.getPropertyValue('--dot'), 'var(--teal-ink)');
  assert.deepEqual([el.querySelector('b').textContent, el.querySelector('span').textContent, el.hidden], ['Hero', '<i>x</i>', false]);
  tip.hide(); assert.equal(el.hidden, true);
  tip.show({ crew: 'red;background:url(x)', name: 'Hero', action: '' });
  assert.equal(el.querySelector('.dz-tip-dot').style.getPropertyValue('--dot'), '', 'only a token name becomes a colour');
});
const PLAN = { count: 28, noun: 'sections', canRetry: false, stopped: [], failed: [], rows: [
  { key: 'nav', name: 'Nav', n: null, state: 'done', who: [] },
  { key: 'hero', name: 'Hero', n: 5, state: 'active', who: [{ agentId: 'a', crew: '--teal-ink' }, { agentId: 'b', crew: '--lime-ink' }] },
  { key: 'wait', name: 'Pricing', n: 3, state: 'waiting', who: [{ agentId: 'c', crew: '--pink-ink' }] },
  { key: 'bad', name: 'Quotes', n: null, state: 'failed', who: [] }, { key: 'off', name: 'FAQ', n: null, state: 'stopped', who: [] }, { key: 'foot', name: 'Footer', n: null, state: 'planned', who: [] }] };
test('Plan list: hidden with nothing planned; header `28 sections`; band rows with a count and one dot per real agent', () => {
  const { list } = rigList();
  list.paint({ count: 0, noun: 'sections', rows: [], stopped: [], failed: [], canRetry: false });
  assert.equal(list.el.hidden, true);
  list.paint(PLAN);
  assert.equal(list.el.hidden, false);
  assert.ok(list.el.querySelector('.ask-card.dz-plan'));
  assert.deepEqual([list.el.querySelector('.dz-plan-head b').textContent, list.el.querySelector('.dz-plan-head .dz-meta').textContent], ['Plan', '28 sections']);
  const rows = [...list.el.querySelectorAll('.dz-plan-row')];
  assert.deepEqual(rows.map((r) => [r.querySelector('.dz-plan-name').textContent, r.querySelector('.dz-plan-n').textContent, r.querySelectorAll('.dz-who-dot').length]), [
    ['Nav', '', 0], ['Hero', '5', 2], ['Pricing', '3', 1], ['Quotes', '', 0], ['FAQ', '', 0], ['Footer', '', 0]]);
  assert.deepEqual(rows.map((r) => r.className.replace('dz-plan-row', '').trim()), ['is-done', 'is-active', 'is-active is-waiting', 'is-failed', 'is-stopped', '']);
  assert.equal(rows[1].querySelector('.dz-who-dot').style.background, 'var(--teal-ink)');
});
test('Plan list keeps row elements as frames arrive', () => {
  const { list } = rigList(); list.paint(PLAN);
  const row = list.el.querySelector('.dz-plan-row');
  list.paint({ ...PLAN, count: 29 });
  assert.equal(list.el.querySelector('.dz-plan-row'), row);
  list.paint({ ...PLAN, rows: [...PLAN.rows].reverse() });
  assert.deepEqual([...list.el.querySelectorAll('.dz-plan-name')].map((n) => n.textContent), ['Footer', 'FAQ', 'Quotes', 'Pricing', 'Hero', 'Nav']);
  assert.equal(list.el.querySelector('.dz-plan-row:last-child'), row);
});
test('M12: a stopped section keeps a Retry row once Retry can work', () => {
  const { list, retries } = rigList();
  list.paint({ ...PLAN, stopped: [{ id: 'faq', name: 'FAQ' }], canRetry: false });
  assert.equal(list.el.querySelector('.dz-retry-row'), null);
  list.paint({ ...PLAN, stopped: [{ id: 'faq', name: 'FAQ' }], canRetry: true });
  const row = list.el.querySelector('.dz-retry-row');
  assert.equal(row.querySelector('span').textContent, 'FAQ stopped');
  const b = row.querySelector('button');
  assert.deepEqual([b.textContent, b.getAttribute('aria-label'), b.className], ['Retry', 'Retry FAQ', 'btn btn-sm']);
  b.click();
  assert.deepEqual(retries, ['faq']);
});
test('M8: a failed section gets its card, Retry waits until nothing else runs, Details opens the agent, no raw error', () => {
  const { list, retries, details } = rigList();
  list.paint({ ...PLAN, failed: [{ id: 'quotes', name: 'Quotes', agentId: 'q' }], canRetry: false });
  const card = list.el.querySelector('.dz-fail');
  assert.ok(card.querySelector(':scope > .chat-rc-qbody > .qpanel[data-kind="recovery"]'), 'the repo\'s red recovery head needs this structure');
  assert.ok(card.matches('section.chat-rc-q.chat-q'));
  assert.equal(card.querySelector('.chat-rc-q-head').textContent, 'Quotes failed');
  assert.equal(card.querySelector('.qpanel').dataset.kind, 'recovery');
  assert.equal(card.querySelector('.gate-intro').textContent, 'The Quotes builder stopped before it finished.');
  const [retry, more] = card.querySelectorAll('.qpanel-foot button');
  assert.deepEqual([retry.textContent, retry.disabled, retry.title, more.textContent], ['Retry', true, 'Available once the others finish', 'Details']);
  more.click(); assert.deepEqual(details, ['q']);
  list.paint({ ...PLAN, failed: [{ id: 'quotes', name: 'Quotes', agentId: 'q' }], canRetry: true });
  list.el.querySelector('.dz-fail .btn-primary').click();
  assert.deepEqual(retries, ['quotes']);
  list.paint({ ...PLAN, stopped: [{ id: 'faq', name: 'FAQ' }], failed: [{ id: 'quotes', name: 'Quotes', agentId: null }], canRetry: true });
  assert.deepEqual([...list.el.children].map((n) => n.classList[n.classList.length - 1]), ['dz-plan', 'dz-retry-row', 'dz-fail'], 'card, then retry rows, then failed cards');
  assert.deepEqual([...list.el.querySelectorAll('.dz-fail .qpanel-foot button')].map((n) => n.textContent), ['Retry'], 'no agent, no Details');
  list.paint(PLAN);
  assert.equal(list.el.querySelector('.dz-fail'), null);
});

// Review fix cycle 2 (M6): one post per press, and a refusal the person can see.
test('a Retry posts once while its call is out; a refusal reads "Could not retry" with the server\'s word, until the next press', async () => {
  const { win, doc } = dom();
  const calls = []; const out = [];
  const list = createPlanList({ doc, onRetry: (id) => { calls.push(id); return new Promise((resolve, reject) => out.push({ resolve, reject })); } });
  doc.body.appendChild(list.el);
  const M = { ...PLAN, stopped: [{ id: 'faq', name: 'FAQ' }], failed: [{ id: 'quotes', name: 'Quotes', agentId: 'q' }], canRetry: true };
  list.paint(M);
  const b = list.el.querySelector('.dz-retry-row button');
  const small = list.el.querySelector('.dz-retry-row small');
  b.click(); b.dispatchEvent(new win.Event('click'));   // jsdom's click() skips a disabled button; a dispatched one does not
  assert.deepEqual(calls, ['faq']);
  assert.equal(b.disabled, true);
  list.paint(M);
  assert.equal(b.disabled, true, 'a paint keeps it disabled while the call is out');
  out[0].reject(Object.assign(new Error('Over the total limit'), { status: 403 })); await tick();
  assert.deepEqual([b.disabled, small.textContent, small.className, small.title], [false, 'Could not retry', 'dz-retry-err', 'Over the total limit']);
  assert.equal(list.el.querySelector('.dz-retry-row span').textContent, 'FAQ Could not retry');
  list.paint(M);
  assert.equal(small.textContent, 'Could not retry', 'kept through paints');
  b.click();
  assert.deepEqual([calls, small.textContent, small.title, b.disabled], [['faq', 'faq'], 'stopped', '', true], 'a new press clears it');
  out[1].resolve({ ok: true }); await tick();
  assert.deepEqual([b.disabled, small.textContent], [false, 'stopped']);

  const r = list.el.querySelector('.dz-fail .btn-primary');
  const note = list.el.querySelector('.dz-fail .dz-retry-err');
  assert.equal(note.hidden, true);
  r.click(); r.dispatchEvent(new win.Event('click'));
  assert.deepEqual([calls.length, r.disabled], [3, true]);
  out[2].reject(new Error('A round is running')); await tick();
  assert.deepEqual([r.disabled, note.hidden, note.textContent, note.title], [false, false, 'Could not retry', 'A round is running']);
  list.paint({ ...M, canRetry: false });
  assert.deepEqual([r.disabled, r.title, note.hidden], [true, 'Available once the others finish', false]);
  list.paint({ ...PLAN, stopped: [{ id: 'faq', name: 'FAQ' }], canRetry: true });
  list.paint(M);
  assert.equal(list.el.querySelector('.dz-fail .dz-retry-err').hidden, true, 'a refusal goes with its card');
});
test('the popover takes the focus on × when it opens, never the unconfirmed Stop, and gives it back when it closes (review M7, cycle 2)', () => {
  const { panel, el, win, doc, host } = rigPanel();
  const dot = doc.createElement('button'); host.appendChild(dot); dot.focus();
  panel.paint(ROWS); panel.open('a');
  assert.equal(doc.activeElement, el.querySelector('.dz-pop-head button'), '× even when the picked agent has a Stop');
  doc.activeElement.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.deepEqual([panel.isOpen(), doc.activeElement], [false, dot], 'Esc closes it, and the dot has the focus again');
  panel.open('l');
  assert.equal(doc.activeElement, el.querySelector('.dz-pop-head button'), 'no Stop for the lead: ×');
  panel.open('a');
  el.querySelector('.dz-pop-head button').click();
  assert.equal(doc.activeElement, dot, '× gives it back too, to where it was before the first open');
  const other = doc.createElement('button'); host.appendChild(other);
  panel.open('a'); other.focus(); panel.paint(ROWS);
  assert.equal(doc.activeElement, other, 'a repaint takes no focus from outside the popover');
  panel.close();
  assert.equal(doc.activeElement, other, 'a focus the person moved elsewhere stays there');
});
test('a repaint that drops, moves or disables the focused Stop keeps the focus in the popover, so Esc still closes it (review cycle 2)', async () => {
  const { panel, el, win, doc, setStop, tick } = rigPanel();
  const x = el.querySelector('.dz-pop-head button');
  const two = { running: 2, rows: [ROWS.rows[0], { ...ROWS.rows[0], agentId: 'q', name: 'Faq' }] };
  panel.paint(two); panel.open('a');
  const faq = el.querySelector('[aria-label="Stop Faq"]'); faq.focus();
  panel.paint({ ...two, rows: [two.rows[1], { ...two.rows[0], status: 'Done', canStop: false }] });
  assert.deepEqual([...el.querySelectorAll('.dz-aname')].map((n) => n.textContent), ['Faq', 'Hero'], 'the row moved');
  assert.equal(doc.activeElement, faq, 'a moved row keeps its focused Stop');
  panel.paint({ ...two, rows: [{ ...two.rows[1], status: 'Done', canStop: false }, two.rows[0]] });
  assert.equal(el.querySelector('[aria-label="Stop Faq"]'), null);
  assert.equal(doc.activeElement, x, 'its agent finished: ×, not <body>');
  panel.paint(two); el.querySelector('[aria-label="Stop Hero"]').focus();
  panel.paint({ running: 1, rows: [two.rows[1]] });
  assert.equal(doc.activeElement, x, 'a row that goes takes no focus with it');
  let release; setStop(() => new Promise((resolve) => { release = resolve; }));
  panel.paint(two);
  const stop = el.querySelector('[aria-label="Stop Faq"]'); stop.focus(); stop.click();
  assert.deepEqual([stop.disabled, doc.activeElement === x], [true, true], 'a pressed Stop is disabled, which Chrome blurs: × at once');
  panel.paint({ ...two, rows: [two.rows[0], { ...two.rows[1], status: 'Stopped', canStop: false }] });
  release(); await tick();
  assert.equal(doc.activeElement, x, 'pressed, then stopped: ×');
  doc.activeElement.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(panel.isOpen(), false, 'and Esc closes it');
});
