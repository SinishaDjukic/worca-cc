// test/log-drawer.test.mjs — ui/public/log-drawer.mjs: the step log drawer under the workflow
// graph. Open and retarget, × and Esc close with focus returned, Open in Logs, the height clamp,
// its persistence (and a throwing storage), keyboard resize on the handle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createLogDrawer, clampHeight, HEIGHT_KEY, MIN_H } from '../ui/public/log-drawer.mjs';

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, map: m };
}
const throwingStorage = () => ({ getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); } });

function setup({ storage = memStorage(), innerHeight = 1000 } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><body><button id="card">Planner</button></body>');
  const doc = dom.window.document;
  const calls = { close: 0, full: 0 };
  const d = createLogDrawer({
    doc, win: { innerHeight }, storage,
    onClose: () => { calls.close += 1; }, onOpenInLogs: () => { calls.full += 1; },
  });
  doc.body.appendChild(d.el);
  const key = (target, k) => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true }));
  return { dom, doc, d, calls, storage, key };
}

test('clampHeight: between 120px and 70% of the viewport; junk is null', () => {
  assert.equal(clampHeight(50, 1000), MIN_H);
  assert.equal(clampHeight(300, 1000), 300);
  assert.equal(clampHeight(900, 1000), 700);
  assert.equal(clampHeight(200, 100), MIN_H, 'a tiny viewport still allows the minimum');
  for (const v of [null, undefined, '', 'abc', 0, -5]) assert.equal(clampHeight(v, 1000), null, String(v));
});

test('starts hidden; open shows the label and the live mark; a second open retargets in place', () => {
  const { d } = setup();
  assert.equal(d.isOpen(), false);
  assert.equal(d.el.hidden, true);
  d.open({ label: 'Planner', isLive: true });
  assert.equal(d.isOpen(), true);
  assert.equal(d.el.querySelector('.wf-log-title').textContent, 'Planner');
  assert.equal(d.el.querySelector('.wf-log-live').hidden, false);
  d.open({ label: 'Reviewer', isLive: false });
  assert.equal(d.el.querySelector('.wf-log-title').textContent, 'Reviewer');
  assert.equal(d.el.querySelector('.wf-log-live').hidden, true);
  assert.ok(d.body.classList.contains('log'), 'the body is a log pane, so the shared line styles apply');
});

test('× closes, calls onClose once and returns focus to the opener', () => {
  const { doc, d, calls } = setup();
  const card = doc.getElementById('card');
  d.open({ label: 'Planner', opener: card });
  d.el.querySelector('.wf-log-close').click();
  assert.equal(d.isOpen(), false);
  assert.equal(calls.close, 1);
  assert.equal(doc.activeElement, card);
  d.close();
  assert.equal(calls.close, 1, 'closing a closed drawer does nothing');
});

test('Esc inside the drawer closes it; Esc elsewhere does not', () => {
  const { doc, d, key, calls } = setup();
  d.open({ label: 'Planner' });
  key(doc.body, 'Escape');
  assert.equal(d.isOpen(), true);
  key(d.body, 'Escape');
  assert.equal(d.isOpen(), false);
  assert.equal(calls.close, 1);
});

test('Open in Logs calls its handler and leaves the drawer to the caller', () => {
  const { d, calls } = setup();
  d.open({ label: 'Planner' });
  d.el.querySelector('.wf-log-full').click();
  assert.equal(calls.full, 1);
});

test('height: none stored uses the CSS default; a stored one is applied clamped; setHeight persists on request', () => {
  const a = setup();
  assert.equal(a.d.el.style.getPropertyValue('--wf-log-h'), '');
  const b = setup({ storage: memStorage({ [HEIGHT_KEY]: '5000' }) });
  assert.equal(b.d.el.style.getPropertyValue('--wf-log-h'), '700px');
  b.d.setHeight(260);
  assert.equal(b.storage.map.get(HEIGHT_KEY), '5000', 'a drag in progress does not write');
  b.d.setHeight(260, { persist: true });
  assert.equal(b.storage.map.get(HEIGHT_KEY), '260');
});

test('the handle is a keyboard separator: ArrowUp grows, ArrowDown shrinks, and the result is kept', () => {
  const { d, key, storage } = setup({ storage: memStorage({ [HEIGHT_KEY]: '300' }) });
  d.open({ label: 'Planner' });
  const handle = d.el.querySelector('.wf-log-resize');
  assert.equal(handle.getAttribute('role'), 'separator');
  key(handle, 'ArrowUp');
  assert.equal(d.el.style.getPropertyValue('--wf-log-h'), '324px');
  key(handle, 'ArrowDown');
  key(handle, 'ArrowDown');
  assert.equal(d.el.style.getPropertyValue('--wf-log-h'), '276px');
  assert.equal(storage.map.get(HEIGHT_KEY), '276');
});

test('a throwing storage never breaks the drawer', () => {
  const { d, key } = setup({ storage: throwingStorage() });
  assert.doesNotThrow(() => d.open({ label: 'Planner' }));
  assert.doesNotThrow(() => key(d.el.querySelector('.wf-log-resize'), 'ArrowUp'));
  assert.doesNotThrow(() => d.close());
});

test('a tools node sits in the head before Open in Logs', () => {
  const { document } = new JSDOM('<!DOCTYPE html><body></body>').window;
  const tools = document.createElement('span');
  tools.className = 'log-view-seg';
  const d = createLogDrawer({ doc: document, tools });
  const head = d.el.querySelector('.wf-log-head');
  assert.equal(tools.parentNode, head);
  assert.equal(tools.nextElementSibling, head.querySelector('.wf-log-full'));
  assert.equal(createLogDrawer({ doc: document }).el.querySelectorAll('.log-view-seg').length, 0, 'no tools: head as today');
});

test('narrow drawer with the Summaries / Raw switch: the title takes its own row, the controls stay on one', () => {
  // At 375px the switch, Open in Logs and × fill the head and squeezed the title to 0px (web UI review, cycle 1).
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const block = [...css.matchAll(/@media \(max-width:480px\)\{([^@]*?)\n\}/g)].find((m) => m[1].includes('.wf-log-head'));
  assert.ok(block, 'a max-width:480px block for the drawer head');
  const head = ':root[data-flags~="commandSummaries"] .wf-log-head:has(> .log-view-seg)';
  assert.ok(block[1].includes(`${head}{flex-wrap:wrap;`), 'the head wraps only while the switch shows');
  assert.ok(block[1].includes(`${head} .wf-log-spacer{flex-basis:100%;`), 'the spacer breaks the row after the title');
  assert.ok(block[1].includes(`${head} .wf-log-title{max-width:calc(100% - 40px);}`), 'a long title ellipsizes and leaves room for the live chip');
  assert.ok(block[1].includes(`${head} .log-view-seg{margin-left:auto;}`), 'the controls row is right-aligned');
  // The History drawer is 311px wide at 375px (head content 283px): 10px padding left × alone on a third row (cycle 2).
  assert.ok(block[1].includes(`${head} .log-view-seg button{padding:0 7px;}`), 'a tighter switch keeps × on the controls row');
  assert.ok(css.includes(`${head} :is(.wf-log-full,.wf-log-close){flex:none;}`), '× and Open in Logs never shrink; the title ellipsizes');
});

test('narrow Logs bar with the Summaries / Raw switch: the bar wraps instead of crushing the selects and search', () => {
  // At 375px the nowrap bar cut the four selects and search to 14px and pushed copy out of the bar (web UI review, cycle 2).
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  // At 481px the selects were still 33px: the bar wraps at every width, which changes nothing while it fits.
  const bar = ':root[data-flags~="commandSummaries"] .log-filters:has(> .log-view-seg)';
  assert.ok(css.includes(`${bar}{flex-wrap:wrap;row-gap:6px;}`), 'the bar wraps only while the switch shows');
  assert.ok(css.includes(`${bar} select.log-f{flex:0 0 auto;}`), 'the selects keep their content width');
  assert.ok(css.includes(`${bar} .log-search{flex-basis:80px;}`), 'search shares the switch row with copy');
});
