// test/ui-tool-overview.test.mjs — the tool panel's Overview renderer (issue 1064): a quiet list of collapsible
// sections drawn from fake sources. Order, empty hiding, the one empty line, counts, collapse, the Context summary,
// limits, notes, slow and failing sections, late results, live redraws, ticks, keyboard, links and Stop buttons.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createOverview } from '../ui/public/tool-overview.mjs';

const opened = [];
afterEach(() => { for (const o of opened.splice(0)) { try { o.ov.unmount(); } catch { /* already */ } o.win.close(); } });
const tick = (n = 2) => new Promise((r) => { let i = 0; const step = () => (++i >= n ? r() : setTimeout(step, 0)); setTimeout(step, 0); });
const VIEW = { project: 'app-0000aaaa', side: { type: 'chat', id: 'ask_0000aaaa', projectKey: 'app-0000aaaa' } };
const VIEW_B = { project: 'app-0000aaaa', side: { type: 'chat', id: 'ask_0000bbbb', projectKey: 'app-0000aaaa' } };
const rows = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, icon: 'file', text: `row ${i}`, meta: `m${i}`, ...extra }));
function deferred() { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; }

function boot(sectionsFor, { view = VIEW, expand = null } = {}) {
  const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>', { url: 'http://localhost/' });
  const win = dom.window;
  const doc = win.document;
  const host = doc.getElementById('host');
  const ov = createOverview({ doc, win, source: (v) => (typeof sectionsFor === 'function' ? sectionsFor(v) : sectionsFor) });
  ov.mount(host, view, { expand });
  const b = { win, doc, host, ov,
    sec: (id) => host.querySelector(`[data-tov-section="${id}"]`),
    shown: () => [...host.querySelectorAll('.tov-sec')].filter((s) => !s.hidden).map((s) => s.dataset.tovSection),
    texts: (id) => [...host.querySelectorAll(`[data-tov-section="${id}"] .tov-item:not([hidden]) .tov-text`)].map((n) => n.textContent),
    empty: () => host.querySelector('.tov-empty') };
  opened.push(b);
  return b;
}

test('sections in order; an empty section is hidden; the count is in the head', async () => {
  const b = boot([
    { id: 'environment', label: 'Environment', rows: () => rows(2) },
    { id: 'runs', label: 'Runs', rows: () => [] },
    { id: 'artifacts', label: 'Artifacts', rows: () => Promise.resolve(rows(3)) },
  ]);
  assert.deepEqual([...b.host.querySelectorAll('.tov-sec')].map((s) => s.dataset.tovSection), ['environment', 'runs', 'artifacts'], 'slots in order at mount');
  await tick();
  assert.deepEqual(b.shown(), ['environment', 'artifacts']);
  assert.equal(b.sec('environment').querySelector('.tov-count').textContent, '2');
  assert.equal(b.sec('artifacts').querySelector('.tov-count').textContent, '3');
  const head = b.sec('environment').querySelector('h3.tov-label > button.tov-head');
  assert.ok(head && head.querySelector('.tov-chev'), 'the head is a button inside the label, with a chevron');
  assert.equal(b.empty().hidden, true);
});

test('all empty → one quiet line, only after every section settled', async () => {
  const slow = deferred();
  const b = boot([{ id: 'runs', label: 'Runs', rows: () => [] }, { id: 'prs', label: 'Pull requests', rows: () => slow.p }]);
  await tick();
  assert.equal(b.empty().hidden, true, 'a section is still loading: no empty line yet');
  slow.resolve([]);
  await tick();
  assert.equal(b.empty().hidden, false);
  assert.equal(b.empty().textContent, 'Nothing here yet.');
  assert.deepEqual(b.shown(), []);
});

test('collapse toggles aria-expanded and hides the list; the state survives a remount', async () => {
  const sections = [{ id: 'runs', label: 'Runs', rows: () => rows(2) }];
  const b = boot(sections);
  const head = b.sec('runs').querySelector('.tov-head');
  const box = b.doc.getElementById(head.getAttribute('aria-controls'));
  assert.ok(box && box.querySelector('ul.tov-list'), 'aria-controls names the list box');
  assert.equal(head.getAttribute('aria-expanded'), 'true');
  head.click();
  assert.equal(head.getAttribute('aria-expanded'), 'false');
  assert.equal(box.hidden, true);
  b.ov.mount(b.host, VIEW);
  const again = b.sec('runs').querySelector('.tov-head');
  assert.equal(again.getAttribute('aria-expanded'), 'false', 'kept for the panel lifetime');
});

test('context: collapsed by default, the summary text and ring in the head; the body draws only when expanded', async () => {
  let drawn = 0;
  const b = boot([{ id: 'context', label: 'Context', collapsed: true,
    summary: () => ({ text: '12%', meter: { pct: 12, level: 'warn' } }),
    body: (host) => { drawn += 1; host.append(Object.assign(host.ownerDocument.createElement('p'), { className: 'ctx-body', textContent: 'stats' })); } }]);
  const head = b.sec('context').querySelector('.tov-head');
  assert.equal(head.getAttribute('aria-expanded'), 'false');
  assert.equal(b.sec('context').hidden, false);
  assert.equal(head.querySelector('.tov-count').textContent, '12%');
  const arc = head.querySelector('.tov-ring svg .ask-ctx-ring-arc');
  assert.ok(arc, 'the ring');
  assert.equal(arc.getAttribute('stroke-dasharray'), '12 100');
  assert.ok(head.querySelector('.tov-ring svg').classList.contains('is-ctx-warn'));
  assert.equal(drawn, 0, 'collapsed: no body');
  head.click();
  assert.equal(drawn, 1);
  assert.ok(b.sec('context').querySelector('.tov-body .ctx-body'));
  const hidden = boot([{ id: 'context', label: 'Context', collapsed: true, summary: () => null, body: () => {} }]);
  await tick();
  assert.equal(hidden.sec('context').hidden, true, 'a null summary hides the section');
});

test('mount({expand}) and expand(id) open a section and keep it open; focus(id) focuses its head', async () => {
  const sections = [{ id: 'runs', label: 'Runs', rows: () => rows(1) },
    { id: 'context', label: 'Context', collapsed: true, summary: () => ({ text: '5%' }), body: () => {} }];
  const b = boot(sections, { expand: 'context' });
  assert.equal(b.sec('context').querySelector('.tov-head').getAttribute('aria-expanded'), 'true');
  b.sec('context').querySelector('.tov-head').click();
  assert.equal(b.sec('context').querySelector('.tov-head').getAttribute('aria-expanded'), 'false');
  b.ov.expand('context');
  assert.equal(b.sec('context').querySelector('.tov-head').getAttribute('aria-expanded'), 'true');
  b.ov.focus('context');
  assert.equal(b.doc.activeElement, b.sec('context').querySelector('.tov-head'));
  b.ov.focus();
  assert.equal(b.doc.activeElement, b.sec('runs').querySelector('.tov-head'), 'no id: the first head');
  b.ov.mount(b.host, VIEW);
  assert.equal(b.sec('context').querySelector('.tov-head').getAttribute('aria-expanded'), 'true', 'kept open');
  assert.equal(b.ov.viewKey(), 'app-0000aaaa|chat:ask_0000aaaa');
  b.ov.unmount();
  assert.equal(b.ov.viewKey(), null);
});

test('show 5 then Show all N; the note line', async () => {
  const b = boot([{ id: 'artifacts', label: 'Artifacts', limit: 5, rows: () => rows(7, { open: () => {} }), note: () => 'Showing the newest 50 of 73' }]);
  assert.equal(b.texts('artifacts').length, 5);
  const more = b.sec('artifacts').querySelector('button.tov-more');
  assert.equal(more.textContent, 'Show all 7');
  more.click();
  assert.equal(b.texts('artifacts').length, 7);
  assert.equal(b.sec('artifacts').querySelector('.tov-more'), null);
  assert.equal(b.doc.activeElement?.querySelector('.tov-text')?.textContent, 'row 5', 'the focus moves to the first row it showed');
  assert.equal(b.sec('artifacts').querySelector('.tov-note').textContent, 'Showing the newest 50 of 73');
  const quiet = boot([{ id: 'artifacts', label: 'Artifacts', rows: () => rows(1), note: () => null }]);
  assert.equal(quiet.sec('artifacts').querySelector('.tov-note'), null);
});

test('a slow section does not block the others', async () => {
  const never = new Promise(() => {});
  const b = boot([{ id: 'runs', label: 'Runs', rows: () => never }, { id: 'background', label: 'Background', rows: () => rows(1) },
    { id: 'prs', label: 'Pull requests', rows: () => Promise.resolve(rows(2)) }]);
  await tick();
  assert.deepEqual(b.shown(), ['background', 'prs']);
  assert.equal(b.empty().hidden, true);
});

test('a rejected section is hidden; a failed redraw keeps the rows already drawn', async () => {
  let fail = false;
  let redraw = null;
  const b = boot([{ id: 'bad', label: 'Bad', rows: () => Promise.reject(new Error('x')) },
    { id: 'throws', label: 'Throws', rows: () => { throw new Error('y'); } },
    { id: 'runs', label: 'Runs', rows: () => (fail ? Promise.reject(new Error('z')) : rows(2)), subscribe: (fn) => { redraw = fn; return () => {}; } }]);
  await tick();
  assert.deepEqual(b.shown(), ['runs']);
  fail = true;
  redraw();
  await tick();
  assert.deepEqual(b.texts('runs'), ['row 0', 'row 1']);
  assert.equal(b.empty().hidden, true);
});

test('a late result after unmount or a remount is dropped', async () => {
  const first = deferred();
  const second = deferred();
  const calls = [];
  const b = boot((v) => [{ id: 'runs', label: 'Runs', rows: (signal) => { calls.push(signal); return v.side.id === 'ask_0000aaaa' ? first.p : second.p; } }]);
  b.ov.mount(b.host, VIEW_B);
  assert.equal(calls[0].aborted, true, 'the old mount is aborted');
  first.resolve(rows(1, { text: 'old chat' }));
  await tick();
  assert.equal(b.sec('runs').hidden, true, 'the old answer never draws into the new mount');
  second.resolve(rows(1, { text: 'new chat' }));
  await tick();
  assert.deepEqual(b.texts('runs'), ['new chat']);
  const late = deferred();
  const c = boot([{ id: 'runs', label: 'Runs', rows: () => late.p }]);
  c.ov.unmount();
  late.resolve(rows(1));
  await tick();
  assert.equal(c.host.querySelector('.tov-item'), null, 'after unmount nothing draws');
});

test('subscribe redraws one section only; unmount unsubscribes', async () => {
  const reads = { a: 0, b: 0 };
  let redrawA = null;
  let unsubbed = 0;
  let n = 1;
  const b = boot([{ id: 'a', label: 'A', rows: () => { reads.a += 1; return rows(n); }, subscribe: (fn) => { redrawA = fn; return () => { unsubbed += 1; }; } },
    { id: 'b', label: 'B', rows: () => { reads.b += 1; return rows(1); } }]);
  n = 3;
  redrawA();
  await tick();
  assert.deepEqual(reads, { a: 2, b: 1 });
  assert.equal(b.texts('a').length, 3);
  b.ov.unmount();
  assert.equal(unsubbed, 1);
});

test('tick updates the meta in place with the focus kept; it stops on unmount', async () => {
  let t = 0;
  const b = boot([{ id: 'background', label: 'Background', tick: 20, rows: () => [{ key: 'c1', icon: 'terminal', text: 'npm test', meta: `${t}s`, open: () => {} }] }]);
  const row = b.sec('background').querySelector('.tov-row');
  row.focus();
  t = 7;
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(b.sec('background').querySelector('.tov-meta').textContent, '7s');
  assert.equal(b.sec('background').querySelector('.tov-row'), row, 'the same node');
  assert.equal(b.doc.activeElement, row);
  b.ov.unmount();
  const meta = row.querySelector('.tov-meta');
  t = 9;
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(meta.textContent, '7s', 'no tick after unmount');
});

test('keyboard: ArrowDown/ArrowUp walk heads, rows, Stop and Show all; Home/End jump', async () => {
  const b = boot([{ id: 'a', label: 'A', rows: () => [{ key: 'x', icon: 'run', text: 'x', open: () => {}, stop: { label: 'Stop', run: async () => {} } }] },
    { id: 'b', label: 'B', limit: 1, rows: () => rows(2, { open: () => {} }) }]);
  const order = [...b.host.querySelectorAll('.tov-head, .tov-row, .tov-stop, .tov-more')].filter((n) => !n.closest('[hidden]'));
  assert.deepEqual(order.map((n) => n.className.split(' ').find((c) => c.startsWith('tov-'))), ['tov-head', 'tov-row', 'tov-stop', 'tov-head', 'tov-row', 'tov-more']);
  const key = (k) => b.doc.activeElement.dispatchEvent(new b.win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  order[0].focus();
  key('ArrowDown');
  assert.equal(b.doc.activeElement, order[1]);
  key('ArrowDown'); key('ArrowDown');
  assert.equal(b.doc.activeElement, order[3]);
  key('ArrowUp');
  assert.equal(b.doc.activeElement, order[2]);
  key('End');
  assert.equal(b.doc.activeElement, order[5]);
  key('Home');
  assert.equal(b.doc.activeElement, order[0]);
  order[3].click();   // collapse B: its rows leave the walk
  order[0].focus();
  key('End');
  assert.equal(b.doc.activeElement, order[3], 'a collapsed list is skipped');
});

test('href rows are external links; open rows are buttons; a stop button is a sibling and calls run', async () => {
  let opened = 0;
  let stopped = 0;
  const b = boot([{ id: 'prs', label: 'Pull requests', rows: () => [{ key: 'p', icon: 'pull-request', text: 'o/r#1', href: 'https://github.com/o/r/pull/1', pill: { tone: 'green', text: 'Open' } }] },
    { id: 'background', label: 'Background', rows: () => [{ key: 'c', icon: 'terminal', text: 'npm test', open: () => { opened += 1; }, stop: { label: 'Stop', run: async () => { stopped += 1; } } }] }]);
  const a = b.sec('prs').querySelector('a.tov-row');
  assert.equal(a.getAttribute('href'), 'https://github.com/o/r/pull/1');
  assert.equal(a.getAttribute('target'), '_blank');
  assert.equal(a.getAttribute('rel'), 'noopener noreferrer');
  const pill = a.querySelector('.tov-pill');
  assert.equal(pill.textContent, 'Open');
  assert.ok(pill.classList.contains('tone-green'));
  const row = b.sec('background').querySelector('button.tov-row');
  const stop = b.sec('background').querySelector('button.tov-stop');
  assert.equal(stop.parentElement, row.parentElement, 'a sibling of the row button');
  const bad = boot([{ id: 'prs', label: 'Pull requests', rows: () => [{ key: 'j', text: 'x', href: 'javascript:alert(1)' }, { key: 'd', text: 'y', href: 'data:text/html,hi' }] }]);
  assert.equal(bad.sec('prs').querySelectorAll('a').length, 0, 'only http(s) rows are links');
  assert.equal(bad.sec('prs').querySelectorAll('span.tov-row').length, 2);
  assert.equal(row.contains(stop), false);
  assert.equal(stop.getAttribute('aria-label'), 'Stop npm test');
  stop.click();
  await tick();
  assert.equal(stopped, 1);
  assert.equal(opened, 0, 'Stop never opens the row');
  row.click();
  assert.equal(opened, 1);
});

test('a dot row paints the status dot in the icon place', async () => {
  const b = boot([{ id: 'runs', label: 'Runs', rows: () => [{ key: 'r', icon: 'run', text: 'Fix', dot: { state: 'running', dot: 'blue', pulse: true, word: 'Running' }, open: () => {} }] }]);
  const dot = b.sec('runs').querySelector('.tov-row .status-dot');
  assert.ok(dot && dot.classList.contains('is-blue') && dot.classList.contains('is-pulse'));
});

test('a view with no Overview draws nothing', () => {
  const b = boot(() => null);
  assert.equal(b.host.querySelector('.tov-sec'), null);
  assert.equal(b.empty().hidden, false, 'the quiet line');
});

// ── branches the first rows left unpinned (review M7) ────────────────────────────────────────────────────
const keydown = (b, k) => b.doc.activeElement.dispatchEvent(new b.win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

test('keyboard: static rows (spans) are not stops; ArrowDown and End walk past them', async () => {
  const b = boot([{ id: 'environment', label: 'Environment', rows: () => [
    { key: 'a', text: 'branch main' },
    { key: 'b', text: 'open me', open: () => {} },
    { key: 'c', text: 'dir /x' },
    { key: 'd', text: 'link', href: 'https://example.com/' },
    { key: 'e', text: 'last static' },
  ] }]);
  const spans = [...b.host.querySelectorAll('span.tov-row')];
  assert.equal(spans.length, 3, 'three static rows');
  const open = b.host.querySelector('button.tov-row');
  const link = b.host.querySelector('a.tov-row');
  b.sec('environment').querySelector('.tov-head').focus();
  keydown(b, 'ArrowDown');
  assert.equal(b.doc.activeElement, open, 'the first stop after the head, past the static row');
  keydown(b, 'ArrowDown');
  assert.equal(b.doc.activeElement, link, 'past the second static row');
  keydown(b, 'ArrowDown');
  assert.equal(b.doc.activeElement, link, 'the last stop: no static row after it takes the walk');
  keydown(b, 'ArrowUp');
  assert.equal(b.doc.activeElement, open);
  keydown(b, 'Home');
  assert.equal(b.doc.activeElement, b.sec('environment').querySelector('.tov-head'));
  keydown(b, 'End');
  assert.equal(b.doc.activeElement, link, 'End lands on the last real stop, not the trailing static row');
});

test('Show all is remembered: a live redraw keeps the full list instead of folding back to the limit', async () => {
  let redraw = null;
  const b = boot([{ id: 'artifacts', label: 'Artifacts', limit: 2, rows: () => rows(4, { open: () => {} }), subscribe: (fn) => { redraw = fn; return () => {}; } }]);
  assert.equal(b.texts('artifacts').length, 2);
  b.sec('artifacts').querySelector('button.tov-more').click();
  assert.equal(b.texts('artifacts').length, 4);
  redraw();
  await tick();
  assert.equal(b.texts('artifacts').length, 4, 'still the whole list');
  assert.equal(b.sec('artifacts').querySelector('.tov-more'), null, 'no Show all button again');
  b.ov.mount(b.host, VIEW);
  assert.equal(b.texts('artifacts').length, 4, 'and after a remount');
});

test('Stop is disabled while its call is in flight: a second press posts nothing', async () => {
  const gate = deferred();
  let calls = 0;
  const b = boot([{ id: 'background', label: 'Background', rows: () => [{ key: 'c', icon: 'terminal', text: 'npm test', open: () => {},
    stop: { label: 'Stop', run: () => { calls += 1; return gate.p; } } }] }]);
  const stop = b.sec('background').querySelector('button.tov-stop');
  stop.click();
  assert.equal(stop.disabled, true, 'disabled at once');
  assert.equal(calls, 1);
  stop.dispatchEvent(new b.win.Event('click', { bubbles: true }));   // click() skips a disabled button: send the event itself
  await tick();
  assert.equal(calls, 1, 'one call for two presses');
  gate.resolve();
  await tick();
  assert.equal(stop.disabled, false, 'free again once the call settled');
  stop.click();
  assert.equal(calls, 2, 'a later press goes through');
  gate.resolve();
  const failing = boot([{ id: 'background', label: 'Background', rows: () => [{ key: 'c', icon: 'terminal', text: 'x', open: () => {}, stop: { run: () => Promise.reject(new Error('no')) } }] }]);
  const s2 = failing.sec('background').querySelector('button.tov-stop');
  s2.click();
  await tick();
  assert.equal(s2.disabled, false, 'a failed stop frees the button too');
});

test('a live redraw keeps the focus on the same row (or its Stop); a row that left sends it to the head', async () => {
  let redraw = null;
  let list = [{ key: 'a', icon: 'run', text: 'a', open: () => {}, stop: { run: async () => {} } }, { key: 'b', icon: 'run', text: 'b', open: () => {}, stop: { run: async () => {} } }];
  const b = boot([{ id: 'background', label: 'Background', rows: () => list, subscribe: (fn) => { redraw = fn; return () => {}; } }]);
  const rowOf = (k) => b.sec('background').querySelector(`.tov-item[data-tov-key="${k}"] .tov-row`);
  const stopOf = (k) => b.sec('background').querySelector(`.tov-item[data-tov-key="${k}"] .tov-stop`);
  const old = rowOf('b');
  old.focus();
  redraw();
  await tick();
  assert.notEqual(rowOf('b'), old, 'the nodes were replaced');
  assert.equal(b.doc.activeElement, rowOf('b'), 'the same row again');
  const oldStop = stopOf('a');
  oldStop.focus();
  redraw();
  await tick();
  assert.equal(b.doc.activeElement, stopOf('a'), 'its Stop button, not the row');
  list = [list[0]];
  rowOf('b').focus();
  redraw();
  await tick();
  assert.equal(b.doc.activeElement, b.sec('background').querySelector('.tov-head'), 'the row is gone: the head');
});
