// test/marketplace-move-select.test.mjs — Ticket updates' move select (plans/ticket-updates-design.md board 4, §10 C/D, §11):
// the combobox and its listbox, the groups and dots, the keyboard, loading and failure.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { settle } from './helpers/marketplace-sheet-harness.mjs';
import { createMoveSelect, targetText } from '../ui/public/marketplace/move-select.mjs';

const trackDom = useDomRelease(afterEach);
const CRM = [{ value: '10001', label: 'Done', category: 'done' }, { value: '10002', label: 'Released', category: 'done' },
  { value: '3', label: 'In Progress', category: 'in_progress' }, { value: '10003', label: 'Waiting for customer', category: 'in_progress' },
  { value: '1', label: 'Open', category: 'todo' }, { value: '10004', label: "Won't Fix", category: 'cancelled' }];
const RELEASED = { kind: 'status', value: '10002', label: 'Released', category: 'done' };

function mount(opts = {}) {
  const { window } = trackDom(new JSDOM('<!doctype html><body><button id="away" type="button">away</button></body>', { url: 'http://localhost/' }));
  const doc = window.document;
  const changes = [];
  let clock = 1000;
  const ms = createMoveSelect({ doc, project: 'CRM', loadStatuses: async () => CRM, onChange: (t) => changes.push(t), now: () => clock, ...opts });
  doc.body.append(ms.el);
  const key = (k) => ms.button.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const list = () => doc.querySelector('[role="listbox"]');
  const options = () => [...doc.querySelectorAll('[role="listbox"] [role="option"]')];
  const titles = () => options().map((o) => o.querySelector('.mk-tu-opt-t').textContent);
  const active = () => doc.getElementById(ms.button.getAttribute('aria-activedescendant'))?.querySelector('.mk-tu-opt-t').textContent ?? null;
  return { window, doc, ms, changes, key, list, options, titles, active, tick: (ms2) => { clock += ms2; } };
}

test('targetText: the words each target shows', () => {
  assert.equal(targetText({ kind: 'none' }), "Don't move");
  assert.equal(targetText({ kind: 'category', value: 'done' }), 'Any Done status');
  assert.equal(targetText(RELEASED), 'Released');
  assert.equal(targetText({ kind: 'typed', value: 'Resolve' }), 'Resolve (as typed)');
  assert.equal(targetText(null), "Don't move");
});

test('board 4: the combobox and the listbox "CRM statuses": the two options, a separator, the groups with their dots; the selected one checked', async () => {
  const m = mount({ value: RELEASED });
  const b = m.ms.button;
  assert.deepEqual([b.tagName, b.type, b.getAttribute('role'), b.getAttribute('aria-haspopup'), b.getAttribute('aria-expanded'), b.textContent],
    ['BUTTON', 'button', 'combobox', 'listbox', 'false', 'Released']);
  assert.equal(m.doc.getElementById(b.getAttribute('aria-labelledby')).textContent, 'CRM: move to');
  assert.equal(b.hasAttribute('aria-controls'), false, 'closed: aria-controls names no missing element');
  b.focus();
  b.click();
  await settle();
  assert.equal(b.getAttribute('aria-expanded'), 'true');
  assert.equal(b.getAttribute('aria-controls'), m.list().id);
  assert.equal(m.list().getAttribute('aria-label'), 'CRM statuses');
  assert.deepEqual(m.titles(), ["Don't move", 'Any Done status', 'Done', 'Released', 'In Progress', 'Waiting for customer', 'Open', "Won't Fix"]);
  assert.equal(m.options()[1].querySelector('.mk-tu-opt-s').textContent, 'One this ticket can reach');
  assert.deepEqual([...m.list().querySelectorAll('[role="presentation"]')].map((n) => n.textContent),
    ['', "Done · CRM's workflow", 'In progress', 'To do', 'Cancelled']);
  // §11 (decided 2026-10-30): a screen reader hears each status's category from its group
  const groups = [...m.list().querySelectorAll('[role="group"]')];
  assert.deepEqual(groups.map((g) => [g.getAttribute('aria-label'), [...g.querySelectorAll('[role="option"]')].map((o) => o.querySelector('.mk-tu-opt-t').textContent)]),
    [["Done · CRM's workflow", ['Done', 'Released']], ['In progress', ['In Progress', 'Waiting for customer']], ['To do', ['Open']], ['Cancelled', ["Won't Fix"]]]);
  assert.ok(groups.every((g) => g.querySelector('.mk-tu-group').getAttribute('aria-hidden') === 'true'));
  assert.deepEqual(m.options().map((o) => o.querySelector('.mk-tu-dot').className.split(' ')[1]),
    ['mk-tu-dot-none', 'mk-tu-dot-category', 'mk-tu-dot-done', 'mk-tu-dot-done', 'mk-tu-dot-in_progress', 'mk-tu-dot-in_progress', 'mk-tu-dot-todo', 'mk-tu-dot-cancelled']);
  assert.ok(m.options().every((o) => o.querySelector('.mk-tu-dot').getAttribute('aria-hidden') === 'true'));
  const sel = m.options().filter((o) => o.getAttribute('aria-selected') === 'true');
  assert.deepEqual(sel.map((o) => o.querySelector('.mk-tu-opt-t').textContent), ['Released']);
  assert.ok(sel[0].querySelector('.mk-tu-opt-check'), 'the selected option has a check');
  assert.equal(m.active(), 'Released', 'the list opens on the selected option');
  assert.equal(m.doc.activeElement, b, 'the focus never moves into the list');
  m.key('Escape');
  assert.equal(b.hasAttribute('aria-controls'), false, 'closed again: aria-controls removed');
});

test('the active option survives the statuses arriving only after the person moved it (the review\'s Must)', async () => {
  let resolve;
  const m = mount({ value: RELEASED, loadStatuses: () => new Promise((r) => { resolve = r; }) });
  m.ms.button.focus();
  m.ms.button.click();
  assert.equal(m.active(), "Don't move", 'before the load the selected status is not listed yet');
  resolve(CRM);
  await settle();
  assert.equal(m.active(), 'Released', 'not moved: the repaint opens on the selected option');
  m.key('Escape');
  m.ms.button.click();   // the statuses are cached now; open again and move before a repaint
  m.key('Home');
  m.key('ArrowDown');
  assert.equal(m.active(), 'Any Done status');
  m.ms.set(RELEASED);   // a repaint while open
  assert.equal(m.active(), 'Any Done status', 'moved: the repaint keeps it');
  m.key('Escape');
  let resolve2;
  const n = mount({ value: RELEASED, loadStatuses: () => new Promise((r) => { resolve2 = r; }) });
  n.ms.button.focus();
  n.ms.button.click();
  n.key('ArrowDown');
  assert.equal(n.active(), 'Any Done status');
  resolve2(CRM);
  await settle();
  assert.equal(n.active(), 'Any Done status', 'moved before the load: kept across it');
});

test('All projects: only the two general options, labelled "All projects: move to"; a carried-over typed value while selected; no load', async () => {
  let loads = 0;
  const m = mount({ general: true, value: { kind: 'typed', value: 'Resolve' }, loadStatuses: async () => { loads += 1; return CRM; } });
  assert.equal(m.ms.button.textContent, 'Resolve (as typed)');
  assert.equal(m.doc.getElementById(m.ms.button.getAttribute('aria-labelledby')).textContent, 'All projects: move to');
  m.ms.button.click();
  await settle();
  assert.equal(m.list().getAttribute('aria-label'), 'All projects: move to');
  assert.deepEqual(m.titles(), ["Don't move", 'Any Done status', 'Resolve (as typed)']);
  assert.equal(m.list().querySelector('[role="presentation"]'), null);
  m.options()[1].click();
  assert.deepEqual(m.changes, [{ kind: 'category', value: 'done' }]);
  m.ms.button.click();
  await settle();
  assert.deepEqual(m.titles(), ["Don't move", 'Any Done status'], 'once another option is picked the typed one is gone');
  assert.equal(loads, 0);
});

test('keyboard (§11): ↓ opens; ↑ ↓ Home End move; type-ahead; Enter picks and keeps focus; Esc closes without change; Space picks', async () => {
  const m = mount();
  m.ms.button.focus();
  m.key('ArrowDown');
  await settle();
  assert.equal(m.active(), "Don't move");
  m.key('ArrowDown');
  assert.equal(m.active(), 'Any Done status');
  m.key('End');
  assert.equal(m.active(), "Won't Fix");
  m.key('Home');
  assert.equal(m.active(), "Don't move");
  m.key('ArrowUp');
  assert.equal(m.active(), "Don't move", 'the top stays the top');
  m.key('w');
  assert.equal(m.active(), 'Waiting for customer', 'type-ahead: the next option starting with the letters');
  m.tick(1000);
  m.key('w');
  assert.equal(m.active(), "Won't Fix", 'the same letter again goes to the next one');
  m.tick(1000);
  m.key('r');
  m.key('e');
  assert.equal(m.active(), 'Released');
  assert.equal(m.key('Enter'), false, 'Enter is used');
  assert.deepEqual([m.ms.isOpen(), m.doc.activeElement, m.changes], [false, m.ms.button, [RELEASED]]);
  assert.equal(m.ms.button.textContent, 'Released');
  m.key('Enter');
  await settle();
  m.key('Home');
  assert.equal(m.key('Escape'), false, 'Esc is used: the sheet underneath does not close');
  assert.deepEqual([m.ms.isOpen(), m.changes.length, m.doc.activeElement], [false, 1, m.ms.button]);
  m.key(' ');
  await settle();
  m.key('Home');
  m.key(' ');
  assert.deepEqual(m.changes.at(-1), { kind: 'none' });
  assert.equal(m.key('Escape'), true, 'closed: Esc is left to the sheet');
});

test("C: the list opens at once with \"Getting CRM's statuses…\"; D: A6's sentence and Try again; a failed load is asked again on the next open", async () => {
  let n = 0;
  let reject;
  const m = mount({ loadStatuses: () => { n += 1; if (n === 1) return new Promise((_, r) => { reject = r; });
    if (n === 2) return Promise.reject(new Error('Worca could not reach Jira: the API token was refused.')); return CRM; } });
  m.ms.button.click();
  const live = () => m.doc.querySelector('.mk-tu-live');
  const retry = () => m.doc.querySelector('.mk-tu-retry');
  assert.deepEqual(m.titles(), ["Don't move", 'Any Done status'], "the two general options at once");
  assert.equal(m.list().querySelector('.mk-tu-sep'), null, 'no separator with nothing under it');
  assert.deepEqual([live().textContent, live().getAttribute('aria-live'), retry().hidden], ["Getting CRM's statuses…", 'polite', true]);
  reject(new Error('Worca could not reach Jira: the API token was refused.'));
  await settle();
  assert.deepEqual([live().textContent, retry().hidden], ['Worca could not reach Jira: the API token was refused.', false]);
  m.options()[1].click();
  assert.deepEqual(m.changes, [{ kind: 'category', value: 'done' }], 'Any Done status still works');
  m.ms.button.click();
  await settle();
  assert.equal(live().textContent, 'Worca could not reach Jira: the API token was refused.', 'the second load failed too');
  retry().click();
  await settle();
  assert.equal(n, 3);
  assert.equal(live().textContent, '');
  assert.equal(m.titles().length, 8, 'Try again loaded the statuses');
});

test('a press outside closes; describe() ties a line to the select; set() repaints; destroy() closes', async () => {
  const m = mount({ value: RELEASED });
  m.ms.button.click();
  await settle();
  m.doc.getElementById('away').dispatchEvent(new m.window.MouseEvent('pointerdown', { bubbles: true }));
  assert.equal(m.ms.isOpen(), false);
  m.ms.describe('gone-1');
  assert.equal(m.ms.button.getAttribute('aria-describedby'), 'gone-1');
  m.ms.describe(null);
  assert.equal(m.ms.button.hasAttribute('aria-describedby'), false);
  m.ms.set({ kind: 'category', value: 'done' });
  assert.deepEqual([m.ms.button.textContent, m.ms.get()], ['Any Done status', { kind: 'category', value: 'done' }]);
  m.ms.open();
  m.ms.destroy();
  assert.deepEqual([m.ms.isOpen(), m.doc.querySelector('.mk-tu-pop')], [false, null]);
});

test('board 1: the closed select shows the target\'s dot before its name (aria-hidden), following every change', async () => {
  const m = mount({ value: RELEASED });
  const dot = () => m.ms.button.querySelector('.mk-tu-dot');
  assert.equal(m.ms.button.firstElementChild, dot(), 'the dot comes first');
  assert.deepEqual([dot().className, dot().getAttribute('aria-hidden'), m.ms.button.textContent], ['mk-tu-dot mk-tu-dot-done', 'true', 'Released']);
  m.ms.button.click();
  await settle();
  m.options().find((o) => o.textContent === 'In Progress').click();
  assert.equal(dot().className, 'mk-tu-dot mk-tu-dot-in_progress', 'a pick repaints it');
  const seen = [];
  for (const t of [{ kind: 'status', value: '1', label: 'Open', category: 'todo' }, { kind: 'status', value: '10004', label: "Won't Fix", category: 'cancelled' },
    { kind: 'category', value: 'done' }, { kind: 'typed', value: 'Resolve' }, { kind: 'none' }]) {
    m.ms.set(t);
    seen.push(dot().className.split(' ')[1]);
  }
  assert.deepEqual(seen, ['mk-tu-dot-todo', 'mk-tu-dot-cancelled', 'mk-tu-dot-category', 'mk-tu-dot-typed', 'mk-tu-dot-none'],
    "grey to do, red cancelled, green Any Done status; Don't move an empty dot");
});

test('the list is placed again once the statuses arrive: never over the select (above it near the bottom), the active option in view', async () => {
  const scrolled = [];
  const m = mount({ value: RELEASED });
  const { window } = m;
  // the select sits near the bottom of a 768 px window; the list is 80 px while loading, 300 px with the statuses
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', {
    configurable: true, get() { return this.classList.contains('mk-tu-movepop') ? (this.querySelectorAll('[role="option"]').length > 2 ? 300 : 80) : 0; } });
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 400, right: 620, top: 700, bottom: 732, width: 220, height: 32 });
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() { scrolled.push([this.textContent, this.closest('.mk-tu-pop')?.style.top]); };
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
  m.ms.button.click();
  const pop = () => m.doc.querySelector('.mk-tu-movepop');
  assert.equal(pop().style.top, '616px', 'while loading: 80 px above the select (700 - 4 - 80)');
  await settle();
  assert.equal(pop().style.top, '396px', 'with the statuses: placed again, 300 px above it (700 - 4 - 300), not left at 616');
  assert.ok(parseFloat(pop().style.top) + 300 <= 700, 'its bottom stays over the select\'s top');
  assert.deepEqual(scrolled.at(-1), ['Released', '396px'], 'the active option is scrolled into view after the last placement');
});
