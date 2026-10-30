// test/marketplace-projects-popover.test.mjs — "Projects you work on" (plans/ticket-updates-design.md board 3, §10 C/D, §11).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { settle, deferred } from './helpers/marketplace-sheet-harness.mjs';
import { openProjectsPopover } from '../ui/public/marketplace/projects-popover.mjs';

const trackDom = useDomRelease(afterEach);
const SIX = [['SHOP', 'Shop'], ['CRM', 'Customer portal'], ['OPS', 'Operations'], ['SUP', 'Support desk'], ['MKT', 'Marketing site'],
  ['DATA', 'Data platform']].map(([value, name]) => ({ value, label: `${name} (${value})`, name }));

function mount({ picked = ['SHOP'], loader = async () => SIX } = {}) {
  const { window } = trackDom(new JSDOM('<!doctype html><body><button id="add" type="button">Add projects…</button><p id="away">x</p>'
    + '<button id="next" type="button">next</button></body>', { url: 'http://localhost/' }));
  const doc = window.document;
  const set = new Set(picked);
  const toggles = [];
  let closed = 0;
  const anchor = doc.getElementById('add');
  const pop = openProjectsPopover({ doc, anchor, profileLabel: 'Acme', tracker: 'Jira', isPicked: (v) => set.has(v), pickedCount: () => set.size,
    loadProjects: loader, onToggle: (p, on) => { toggles.push([p.value, on]); if (on) set.add(p.value); else set.delete(p.value); },
    onClose: () => { closed += 1; } });
  const $ = (s) => doc.querySelector(s);
  const rows = () => [...doc.querySelectorAll('.mk-tu-prow')];
  const row = (v) => rows().find((r) => r.dataset.value === v);
  const q = () => $('.mk-tu-search');
  const key = (el, k) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const type = (text) => { q().value = text; q().dispatchEvent(new window.Event('input', { bubbles: true })); };
  return { window, doc, pop, anchor, toggles, closed: () => closed, $, rows, row, q, key, type };
}

test('board 3: a dialog with the search, the multi-select listbox "Jira projects" of checkbox rows, the footer and Done', async () => {
  const m = mount();
  await settle();
  const dlg = m.$('.mk-tu-projpop');
  assert.deepEqual([dlg.getAttribute('role'), dlg.getAttribute('aria-label')], ['dialog', 'Projects you work on']);
  assert.equal(m.doc.activeElement, m.q(), 'the focus is in the search box');
  // S12: the search box carries the combobox the active row hangs on, as group-picker.mjs's search
  assert.deepEqual(['role', 'aria-expanded', 'aria-autocomplete', 'aria-controls'].map((a) => m.q().getAttribute(a)),
    ['combobox', 'true', 'list', m.$('.mk-tu-plist').id]);
  assert.equal(m.anchor.getAttribute('aria-expanded'), 'true', 'Add projects… says its popover is open');
  assert.equal(m.q().placeholder, 'Find a project by key or name');
  assert.equal(m.doc.querySelector(`label[for="${m.q().id}"]`).textContent, 'Find a project');
  const list = m.$('.mk-tu-plist');
  assert.deepEqual([list.getAttribute('role'), list.getAttribute('aria-multiselectable'), list.getAttribute('aria-label')], ['listbox', 'true', 'Jira projects']);
  assert.deepEqual(m.rows().map((r) => [r.getAttribute('role'), r.querySelector('.mk-tu-key').textContent, r.querySelector('.mk-tu-pname').textContent]),
    SIX.map((p) => ['option', p.value, p.name]));
  assert.deepEqual(m.rows().map((r) => [r.getAttribute('aria-selected'), r.querySelector('input[type="checkbox"]').checked]),
    [['true', true], ...Array(5).fill(['false', false])]);
  assert.equal(m.$('.mk-tu-pcount').textContent, '1 picked · 6 projects on Acme');
  assert.equal(m.$('.mk-tu-done').textContent, 'Done');
});

test('toggles apply at once and the popover stays open; None picked; the search finds by key or name', async () => {
  const m = mount();
  await settle();
  m.row('CRM').querySelector('input').click();
  assert.deepEqual(m.toggles, [['CRM', true]]);
  assert.equal(m.row('CRM').getAttribute('aria-selected'), 'true');
  assert.equal(m.$('.mk-tu-pcount').textContent, '2 picked · 6 projects on Acme');
  m.row('SHOP').querySelector('input').click();
  m.row('CRM').querySelector('input').click();
  assert.equal(m.$('.mk-tu-pcount').textContent, 'None picked · 6 projects on Acme');
  assert.ok(m.$('.mk-tu-projpop'), 'still open');
  m.type('cust');
  assert.deepEqual(m.rows().map((r) => r.dataset.value), ['CRM']);
  m.type('ops');
  assert.deepEqual(m.rows().map((r) => r.dataset.value), ['OPS']);
  m.type('zzz');
  assert.deepEqual([m.rows().length, m.$('.mk-tu-live').textContent], [0, 'No project matches.']);
});

test('keyboard (§11): ↑ ↓ move the active row; Enter on the search toggles it; Esc closes and focuses Add projects…', async () => {
  const m = mount();
  await settle();
  m.key(m.q(), 'ArrowDown');
  assert.equal(m.doc.getElementById(m.q().getAttribute('aria-activedescendant')).dataset.value, 'SHOP');
  m.key(m.q(), 'ArrowDown');
  assert.equal(m.doc.getElementById(m.q().getAttribute('aria-activedescendant')).dataset.value, 'CRM');
  assert.equal(m.key(m.q(), 'Enter'), false);
  assert.deepEqual(m.toggles, [['CRM', true]]);
  m.row('OPS').querySelector('input').focus();
  m.key(m.row('OPS').querySelector('input'), 'ArrowDown');
  assert.equal(m.doc.activeElement, m.row('SUP').querySelector('input'), '↓ on a row moves to the next row');
  assert.equal(m.key(m.doc.activeElement, 'Escape'), false);
  assert.deepEqual([m.$('.mk-tu-projpop'), m.doc.activeElement, m.closed()], [null, m.anchor, 1]);
});

test("C: \"Getting Acme's projects…\" while they load; D: A6's sentence and Try again", async () => {
  const slow = deferred();
  let n = 0;
  const m = mount({ loader: () => { n += 1; if (n === 1) return slow.p; if (n === 2) return Promise.reject(new Error('Worca could not reach Jira: the API token was refused.')); return Promise.resolve(SIX); } });
  assert.deepEqual([m.$('.mk-tu-live').textContent, m.$('.mk-tu-live').getAttribute('aria-live'), m.$('.mk-tu-pcount').textContent],
    ["Getting Acme's projects…", 'polite', '']);
  slow.resolve(Promise.reject(new Error('Worca could not reach Jira: the API token was refused.')));
  await settle();
  assert.deepEqual([m.$('.mk-tu-live').textContent, m.$('.mk-tu-retry').hidden], ['Worca could not reach Jira: the API token was refused.', false]);
  m.$('.mk-tu-retry').click();
  await settle();
  assert.equal(m.$('.mk-tu-live').textContent, 'Worca could not reach Jira: the API token was refused.');
  m.$('.mk-tu-retry').click();
  await settle();
  assert.deepEqual([m.rows().length, m.$('.mk-tu-live').textContent, m.$('.mk-tu-retry').hidden], [6, '', true]);
});

test('Done and a press outside close it and focus Add projects…', async () => {
  let m = mount();
  await settle();
  m.$('.mk-tu-done').click();
  assert.deepEqual([m.$('.mk-tu-projpop'), m.doc.activeElement, m.closed()], [null, m.anchor, 1]);
  m = mount();
  await settle();
  m.doc.getElementById('away').dispatchEvent(new m.window.MouseEvent('pointerdown', { bubbles: true }));
  assert.deepEqual([m.$('.mk-tu-projpop'), m.doc.activeElement, m.closed()], [null, m.anchor, 1]);
  assert.equal(m.anchor.getAttribute('aria-expanded'), 'false');
});

test('Tab out of the popover and Add projects… closes it and leaves the focus where it went', async () => {
  const m = mount();
  await settle();
  m.row('OPS').querySelector('input').focus();
  assert.ok(m.$('.mk-tu-projpop'), 'focus inside: still open');
  m.anchor.focus();
  assert.ok(m.$('.mk-tu-projpop'), 'focus on Add projects…: still open');
  m.q().focus();
  const next = m.doc.getElementById('next');
  next.focus();
  assert.deepEqual([m.$('.mk-tu-projpop'), m.doc.activeElement, m.closed(), m.anchor.getAttribute('aria-expanded')], [null, next, 1, 'false']);
});
