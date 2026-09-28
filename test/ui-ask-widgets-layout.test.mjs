// test/ui-ask-widgets-layout.test.mjs — the layout containers (ask-forms §6.1)
// and the versioning path (§10): requires -> fallback -> nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderAskForm } from '../ui/public/ask/form-renderer.mjs';

const win = new JSDOM('<!doctype html><body></body>').window;
const doc = win.document;
const click = (n) => n.dispatchEvent(new win.Event('click', { bubbles: true }));
const key = (n, k) => n.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true }));

const askOf = (layout, properties = {}, required = []) => ({
  id: 'q:1', askId: 'q_1', kind: 'form', form: 'f', version: 1, title: 'T', surface: 'any',
  data: { msg: 'body' }, files: [], fileRefs: [], layout,
  answerSchema: { type: 'object', required, properties },
});
const mount = (ask, opts = {}) => renderAskForm(ask, { doc, ...opts });

test('group: a titled section that still collects its children', () => {
  const f = mount(askOf(
    [{ widget: 'group', title: 'Details', children: [
      { widget: 'text', field: 'who', label: 'Reviewer' },
      { widget: 'markdown', bind: 'data.msg' },
    ] }],
    { who: { type: 'string' } }, ['who'],
  ));
  const grp = f.el.querySelector('.af-grp');
  assert.equal(grp.querySelector('.af-grp-title').textContent, 'Details');
  assert.ok(grp.querySelector('.af-md'));
  const input = grp.querySelector('input[type="text"]');
  input.value = 'dp';
  input.dispatchEvent(new win.Event('input'));
  assert.equal(f.snapshot().who, 'dp');
  assert.deepEqual(f.progress(), { done: 1, total: 1 }, 'a nested required field is counted');
});

test('columns: one child per column, the count rides on --af-cols', () => {
  const f = mount(askOf([{ widget: 'columns', columns: [
    [{ widget: 'callout', text: 'left' }],
    [{ widget: 'callout', text: 'right' }],
  ] }]));
  const cols = f.el.querySelector('.af-cols');
  assert.equal(cols.style.getPropertyValue('--af-cols'), '2');
  assert.equal(cols.children.length, 2);
  assert.match(cols.children[0].textContent, /left/);
  assert.match(cols.children[1].textContent, /right/);
});

test('tabs: a real tablist, one visible panel, arrow keys and Home/End move it', () => {
  const f = mount(askOf([{ widget: 'tabs', tabs: [
    { label: 'One', children: [{ widget: 'callout', text: 'first' }] },
    { label: 'Two', children: [{ widget: 'text', field: 'n', label: 'Name' }] },
    { label: 'Three', children: [{ widget: 'callout', text: 'third' }] },
  ] }], { n: { type: 'string' } }));
  const bar = f.el.querySelector('[role="tablist"]');
  const tabs = [...bar.querySelectorAll('[role="tab"]')];
  const panes = [...f.el.querySelectorAll('[role="tabpanel"]')];
  assert.equal(tabs.length, 3);
  assert.deepEqual(tabs.map((t) => t.getAttribute('aria-selected')), ['true', 'false', 'false']);
  assert.deepEqual(panes.map((p) => p.hidden), [false, true, true]);
  assert.equal(tabs[0].getAttribute('aria-controls'), panes[0].id);
  assert.deepEqual(tabs.map((t) => t.tabIndex), [0, -1, -1], 'roving tabindex');

  click(tabs[1]);
  assert.deepEqual(panes.map((p) => p.hidden), [true, false, true]);
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true');

  key(tabs[1], 'ArrowRight');
  assert.equal(tabs[2].getAttribute('aria-selected'), 'true');
  key(tabs[2], 'ArrowRight');
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true', 'it wraps');
  key(tabs[0], 'End');
  assert.equal(tabs[2].getAttribute('aria-selected'), 'true');
  key(tabs[2], 'Home');
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
});

test('a field inside a hidden tab is still collected (tabs are chrome, not `when`)', () => {
  const f = mount(askOf([{ widget: 'tabs', tabs: [
    { label: 'One', children: [{ widget: 'callout', text: 'first' }] },
    { label: 'Two', children: [{ widget: 'text', field: 'n', label: 'Name' }] },
  ] }], { n: { type: 'string', minLength: 2 } }, ['n']));
  assert.deepEqual(f.progress(), { done: 0, total: 1 });
  f.setValue('n', 'dp');
  assert.deepEqual(f.collect(), { values: { n: 'dp' }, errors: [] });
});

test('requires/fallback: an unmet item draws its fallback; with none it draws nothing', () => {
  const layout = [
    { widget: 'compare', before: 'data.a', after: 'data.b', requires: { askCatalog: 99 },
      fallback: { widget: 'callout', text: 'two images' } },
    { widget: 'not-a-widget', label: 'nope' },
  ];
  const f = mount(askOf(layout));
  assert.equal(f.el.querySelectorAll('.af-callout').length, 1);
  assert.match(f.el.textContent, /two images/);
  assert.equal(f.el.children.length, 1, 'the unknown widget with no fallback drew nothing at all');
  assert.doesNotMatch(f.el.textContent, /not-a-widget|nope/, 'and no host prose about it');
});
