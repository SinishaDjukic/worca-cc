// test/ui-ship-card.test.mjs — Shaper s4: the Ship card, one renderer for the chat card and the group page / Plans tab.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderShipCard, buildShipChatCard, shipSummaryLine } from '../ui/public/shape/ship-card.mjs';

const doms = [];
afterEach(() => { for (const d of doms.splice(0)) d.window.close(); });
const docOf = () => { const d = new JSDOM('<!doctype html><body></body>'); doms.push(d); return d.window.document; };
const tick = () => new Promise((r) => setTimeout(r, 0));
const READY = { type: 'ship', featureId: 'feat_1', title: 'Charts', runs: 3, files: 12, added: 840, deleted: 120, suggested: 'one',
  release: { version: 'v1.12.0', from: 'tag', lastTag: 'v1.11.0', packageVersion: null } };
const chat = (block, post = async () => ({})) => {
  const doc = docOf(); const posts = []; const said = [];
  const ctx = { doc, postCard: async (b, body) => { posts.push(body); return post(b, body); }, announce: (t) => said.push(t) };
  const { el } = buildShipChatCard(block, ctx);
  doc.body.appendChild(el);
  return { el, posts, said };
};
const buttons = (el) => [...el.querySelectorAll('.ask-mcard-actions button')];

test('ready: the suggested mode is the primary, the summary names runs, files and lines; one click posts the verb', async () => {
  const { el, posts } = chat({ id: 'card_00000001', state: 'proposed', card: READY });
  assert.equal(el.querySelector('.ask-mcard-kind').textContent, 'Ship');
  assert.equal(el.querySelector('.ask-mcard-title').textContent, 'Charts');
  assert.deepEqual(buttons(el).map((b) => b.textContent), ['Not now', 'Stacked PRs', 'One PR']);
  assert.ok(el.querySelector('[data-act="ship-one"]').classList.contains('btn-primary'));
  assert.equal(el.querySelector('[data-act="ship-stacked"]').className, 'btn btn-sm');
  assert.ok(el.querySelector('[data-act="ship-not-now"]').classList.contains('ask-card-not-now'));
  assert.equal(el.querySelector('.ask-shipcard-stats').textContent, '3 runs · 12 files · +840 −120');
  assert.equal(el.querySelector('.ask-shipcard-why').textContent, 'This feature adds 840 lines: one PR is easier to review.');
  assert.equal(el.querySelectorAll('.release-row').length, 1);
  assert.equal(el.querySelectorAll('input[type="radio"]').length, 0);
  el.querySelector('[data-act="ship-one"]').click(); await tick();
  assert.deepEqual(posts, [{ verb: 'ship-one' }]);
});

test('ready: with the release expanded the click posts the version; after a resolved ship every button stays disabled', async () => {
  const { el, posts, said } = chat({ id: 'card_00000001', state: 'proposed', card: READY });
  el.querySelector('.release-row-add').click();
  assert.equal(el.querySelector('.release-row-text').textContent + el.querySelector('.release-row-edit').textContent,
    'Release v1.12.0 · draft after merge · Edit');
  el.querySelector('[data-act="ship-stacked"]').click(); await tick();
  assert.deepEqual(posts, [{ verb: 'ship-stacked', release: { version: 'v1.12.0' } }]);
  assert.deepEqual(buttons(el).map((b) => b.disabled), [true, true, true]);
  assert.deepEqual(said, ['Shipped Charts as stacked PRs']);
});

test('a 409 shows the error line, unlocks the buttons and keeps the typed version', async () => {
  const refused = Object.assign(new Error('x'), { status: 409, body: { error: 'this feature was already shipped as one PR' } });
  const { el } = chat({ id: 'card_00000001', state: 'proposed', card: { ...READY, release: null } }, async () => { throw refused; });
  el.querySelector('.release-row-add').click();
  el.querySelector('.release-row-input').value = 'v3.1.0';
  el.querySelector('[data-act="ship-one"]').click(); await tick();
  assert.equal(el.querySelector('.ask-card-err').textContent, 'this feature was already shipped as one PR');
  assert.deepEqual(buttons(el).map((b) => b.disabled), [false, false, false]);
  assert.equal(el.querySelector('[data-act="ship-one"]').textContent, 'One PR');
  assert.equal(el.querySelector('.release-row-text').textContent, 'Release v3.1.0 · draft after merge · ');
});

test('an invalid typed version posts nothing', async () => {
  const { el, posts } = chat({ id: 'card_00000001', state: 'proposed', card: { ...READY, release: null } });
  el.querySelector('.release-row-add').click();
  el.querySelector('.release-row-input').value = 'soon';
  el.querySelector('[data-act="ship-one"]').click(); await tick();
  assert.deepEqual(posts, []);
  assert.equal(el.querySelector('.release-row-err').textContent, 'Use a version like v1.12.0');
});

test('Not now posts not-now', async () => {
  const { el, posts } = chat({ id: 'card_00000001', state: 'proposed', card: READY });
  el.querySelector('[data-act="ship-not-now"]').click(); await tick();
  assert.deepEqual(posts, [{ verb: 'not-now' }]);
});

test('applied: Shipped as one PR, View PR, the closed drafts and the release line', () => {
  const { el } = chat({ id: 'card_00000001', state: 'applied',
    card: { ...READY, result: { mode: 'one', prUrl: 'https://github.com/o/r/pull/9', closed: 3, release: { version: 'v1.12.0', url: null, error: null } } } });
  assert.equal(el.querySelector('.ask-mcard-kind').textContent, 'Shipped');
  assert.match(el.querySelector('.ask-shipcard-done').textContent, /^Shipped as one PR · View PR$/);
  assert.equal(el.querySelector('.ask-shipcard-pr').href, 'https://github.com/o/r/pull/9');
  assert.equal(el.querySelector('.ask-shipcard-closed').textContent, 'Closed 3 drafts');
  assert.equal(el.querySelector('.ask-shipcard-rel').textContent, 'Release v1.12.0 · draft after merge');
  assert.equal(el.querySelectorAll('button').length, 0);
  const made = chat({ id: 'c', state: 'applied', card: { ...READY, result: { mode: 'stacked', prUrl: null, closed: 0,
    release: { version: 'v1.12.0', url: 'https://github.com/o/r/releases/tag/v1.12.0', error: null } } } }).el;
  assert.equal(made.querySelector('.ask-shipcard-done').textContent, 'Shipped as stacked PRs');
  assert.equal(made.querySelector('.ask-shipcard-closed'), null);
  assert.equal(made.querySelector('.ask-shipcard-rel').textContent, 'Draft release v1.12.0 · open it');
  const failed = chat({ id: 'c', state: 'applied', card: { ...READY, result: { mode: 'one', prUrl: null, closed: 0,
    release: { version: 'v1.12.0', url: null, error: 'tag exists' } } } }).el;
  assert.equal(failed.querySelector('.ask-shipcard-rel').textContent, 'Draft release v1.12.0 failed: tag exists');
});

test('declined: the stub', () => {
  const { el } = chat({ id: 'card_00000001', state: 'declined', card: READY });
  assert.equal(el.textContent, 'Not shipped yet · ship it from the feature page');
  assert.equal(el.querySelectorAll('button').length, 0);
});

test('waiting (group page): the line and no buttons; no onNotNow → no Not now', () => {
  const el = renderShipCard(docOf(), { phase: 'waiting', runs: 3 }, {});
  assert.equal(el.textContent, 'Ship card comes when all 3 runs are done, here and in the chat.');
  assert.equal(el.querySelectorAll('button').length, 0);
  const ready = renderShipCard(docOf(), { phase: 'ready', title: 'Charts', runs: 3, suggested: 'stacked', added: 2000 }, { onShip: async () => {} });
  assert.deepEqual(buttons(ready).map((b) => b.textContent), ['Stacked PRs', 'One PR']);
  assert.ok(ready.querySelector('[data-act="ship-stacked"]').classList.contains('btn-primary'));
});

test('shipSummaryLine leaves out unknown counts', () => {
  assert.equal(shipSummaryLine({ runs: 1 }), '1 run');
  assert.equal(shipSummaryLine({ runs: 2, files: 1, added: 5, deleted: null }), '2 runs · 1 file · +5 −0');
});

test('s5: Ask for changes shows in ready and applied, never in waiting or declined; the chat card posts the feature ref', async () => {
  const onAskChanges = async () => {};
  for (const phase of ['ready', 'applied']) assert.ok(renderShipCard(docOf(), { phase, title: 'Charts', result: { mode: 'one' } }, { onShip: async () => {}, onAskChanges }).querySelector('.ask-changes'), phase);
  for (const phase of ['waiting', 'declined']) assert.equal(renderShipCard(docOf(), { phase, title: 'Charts' }, { onAskChanges }).querySelector('.ask-changes'), null, phase);
  assert.equal(renderShipCard(docOf(), { phase: 'ready', title: 'Charts' }, { onShip: async () => {} }).querySelector('.ask-changes'), null, 'no handler: no field');
  const doc = docOf(); const sent = [];
  const block = { kind: 'card', id: 'card_1', state: 'applied', card: { ...READY, result: { mode: 'one' } } };
  const ctx = { doc, postCard: async () => ({}), postChanges: async (ref, t) => { sent.push([ref, t]); } };
  assert.equal(buildShipChatCard(block, ctx).el.querySelector('.ask-changes'), null, 'gate off: no field');
  doc.documentElement.dataset.flags = 'shapeFirst';
  const { el } = buildShipChatCard(block, ctx);
  const input = el.querySelector('.ask-changes-input');
  input.value = 'one more'; input.dispatchEvent(new doc.defaultView.Event('input'));
  el.querySelector('.ask-changes-send').click(); await tick();
  assert.deepEqual(sent, [[{ featureId: 'feat_1' }, 'one more']]);
});
