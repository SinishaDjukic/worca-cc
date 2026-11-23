// test/requirements-attach-cards.test.mjs — the attached-feature chips under the composer, in jsdom.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><body></body>');
after(() => window.close());
const { renderAttachedCards, pullLabel } = await import('../ui/public/requirements-attach/cards.mjs');

const item = (over = {}) => ({ seq: 4, id: 'FEAT-4', title: 'Cancel order', status: 'ok', criteriaCount: 3, ...over });
const mount = (items, opts = {}) => {
  const c = window.document.createElement('div');
  renderAttachedCards(c, items, { onRemove: () => {}, flagOn: () => true, ...opts });
  return c;
};

test('a card shows title, ID and criteria count in an .ask-chip', () => {
  const c = mount([item()]);
  const card = c.querySelector('.ask-chip');
  assert.ok(card);
  assert.match(card.textContent, /Cancel order/);
  assert.match(card.textContent, /FEAT-4/);
  assert.match(card.textContent, /3 criteria/);
});

test('criteria count is omitted when null and singular for 1', () => {
  assert.doesNotMatch(mount([item({ criteriaCount: null })]).textContent, /criteri/);
  assert.match(mount([item({ criteriaCount: 1 })]).textContent, /1 criterion\b/);
});

test('the remove button is labelled, svg-only, and calls onRemove(seq) once', () => {
  const calls = [];
  const c = mount([item()], { onRemove: (s) => calls.push(s) });
  const btn = c.querySelector('button');
  assert.equal(btn.getAttribute('aria-label'), 'Remove FEAT-4');
  assert.ok(btn.querySelector('svg'));
  assert.equal(btn.textContent.trim(), '');
  btn.click();
  assert.deepEqual(calls, [4]);
});

test('status lines follow the plan', () => {
  const line = (status) => mount([item({ status })]).querySelector('.ask-chip-status')?.textContent ?? '';
  assert.equal(line('ok'), '');
  assert.match(line('archived'), /^Archived — remove to send\/run$/);
  assert.match(line('missing'), /^Deleted — remove to send\/run$/);
  assert.match(line('wrong_scope'), /^Not in this project — remove to send\/run$/);
  assert.equal(line('not_ready'), 'Not Ready yet');
});

test('flag off: every card says Requirements unavailable', () => {
  const c = mount([item(), item({ seq: 5, id: 'FEAT-5' })], { flagOn: () => false });
  const lines = [...c.querySelectorAll('.ask-chip-status')].map((e) => e.textContent);
  assert.deepEqual(lines, ['Requirements unavailable', 'Requirements unavailable']);
});

test('re-render replaces children and does not mutate items', () => {
  const items = Object.freeze([Object.freeze(item())]);
  const c = mount(items);
  renderAttachedCards(c, items, { onRemove: () => {}, flagOn: () => true });
  assert.equal(c.querySelectorAll('.ask-chip').length, 1);
  renderAttachedCards(c, [], { onRemove: () => {}, flagOn: () => true });
  assert.equal(c.children.length, 0);
});

test('pullLabel', () => {
  assert.equal(pullLabel(0), 'Pull from Requirements');
  assert.equal(pullLabel(1), '1 feature');
  assert.equal(pullLabel(3), '3 features');
});
