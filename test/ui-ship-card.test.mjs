// test/ui-ship-card.test.mjs — Shaper s4: the Ship card, one renderer for the chat card and the group page / Plans tab.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderShipCard, buildShipChatCard, shipSummaryLine, setShipDialogOpener } from '../ui/public/shape/ship-card.mjs';

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

test('ready (one ship flow): Ready to ship + Create PR opens the shared dialog; no Stacked PRs / One PR buttons', async () => {
  const stale = [];
  setShipDialogOpener((id) => { stale.push(id); });
  const opened = [];
  setShipDialogOpener((id, o) => { opened.push(id); assert.ok(o.opener && o.card); });   // a second app boot replaces the first opener
  const { el, posts } = chat({ id: 'card_00000001', state: 'proposed', card: READY });
  assert.equal(el.querySelector('.ask-mcard-kind').textContent, 'Ship');
  assert.equal(el.querySelector('.ask-mcard-title').textContent, 'Charts');
  assert.deepEqual(buttons(el).map((b) => b.textContent), ['Not now', 'Create PR']);
  assert.ok(el.querySelector('[data-act="ship-create"]').classList.contains('btn-primary'));
  assert.ok(el.querySelector('[data-act="ship-not-now"]').classList.contains('ask-card-not-now'));
  assert.equal(el.querySelector('.ask-shipcard-stats').textContent, '3 runs · 12 files · +840 −120', 'the kind chip says Ship: the line is the facts');
  assert.equal(el.querySelector('.ask-shipcard-why').textContent, 'This feature adds 840 lines: one PR is easier to review.');
  assert.equal(el.querySelectorAll('.release-row').length, 0, 'the release row lives in the dialog');
  assert.equal(buttons(el).filter((b) => /Stacked PRs|One PR/.test(b.textContent)).length, 0);
  assert.equal(el.dataset.shipFeature, 'feat_1');
  const btn = el.querySelector('[data-act="ship-create"]');
  btn.click();
  assert.deepEqual([btn.disabled, btn.getAttribute('aria-busy')], [true, 'true'], 'busy while the dialog loads');
  btn.click();                                             // a double click opens one dialog
  await tick();
  assert.deepEqual([opened, stale], [['feat_1'], []]);
  assert.deepEqual([btn.disabled, btn.hasAttribute('aria-busy')], [false, false]);
  assert.deepEqual(posts, [], 'nothing is posted from the card');
  setShipDialogOpener(null);
});

test('ready: no dialog opener says where to create the PR; a failed open shows its error and enables Create PR again', async () => {
  setShipDialogOpener(null);
  const { el } = chat({ id: 'card_00000001', state: 'proposed', card: READY });
  const btn = el.querySelector('[data-act="ship-create"]');
  btn.click();
  assert.equal(el.querySelector('.ask-card-err').textContent, 'Open the feature page to create its PR');
  setShipDialogOpener(async () => { throw new Error('HTTP 500'); });
  btn.click(); await tick(); await tick();
  assert.equal(el.querySelector('.ask-card-err').textContent, 'HTTP 500');
  assert.equal(btn.disabled, false);
  setShipDialogOpener(null);
});

test('Not now posts not-now', async () => {
  const { el, posts } = chat({ id: 'card_00000001', state: 'proposed', card: READY });
  el.querySelector('[data-act="ship-not-now"]').click(); await tick();
  assert.deepEqual(posts, [{ verb: 'not-now' }]);
});

test('applied: the Shipped chip, As one PR, View PR, the closed drafts and the release line', () => {
  const { el } = chat({ id: 'card_00000001', state: 'applied',
    card: { ...READY, result: { mode: 'one', prUrl: 'https://github.com/o/r/pull/9', closed: 3, release: { version: 'v1.12.0', url: null, error: null } } } });
  assert.equal(el.querySelector('.ask-mcard-kind').textContent, 'Shipped');
  assert.match(el.querySelector('.ask-shipcard-done').textContent, /^As one PR · View PR$/);
  assert.equal(el.querySelector('.ask-shipcard-pr').href, 'https://github.com/o/r/pull/9');
  assert.equal(el.querySelector('.ask-shipcard-closed').textContent, 'Closed 3 drafts');
  assert.equal(el.querySelector('.ask-shipcard-rel').textContent, 'Release v1.12.0 · draft after merge');
  assert.equal(el.querySelectorAll('button').length, 0);
  const made = chat({ id: 'c', state: 'applied', card: { ...READY, result: { mode: 'stacked', prUrl: null, closed: 0,
    release: { version: 'v1.12.0', url: 'https://github.com/o/r/releases/tag/v1.12.0', error: null } } } }).el;
  assert.equal(made.querySelector('.ask-shipcard-done').textContent, 'As stacked PRs', 'the kind chip says Shipped: the line says how');
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
  const ready = renderShipCard(docOf(), { phase: 'ready', featureId: 'feat_1', title: 'Charts', runs: 3, suggested: 'stacked', added: 2000 }, {});
  assert.deepEqual(buttons(ready).map((b) => b.textContent), ['Create PR']);
});

test('shipSummaryLine leaves out unknown counts', () => {
  assert.equal(shipSummaryLine({ runs: 1 }), '1 run');
  assert.equal(shipSummaryLine({ runs: 2, files: 1, added: 5, deleted: null }), '2 runs · 1 file · +5 −0');
});

test('s5: Ask for changes shows in ready and applied, never in waiting or declined; the chat card posts the feature ref', async () => {
  const onAskChanges = async () => {};
  for (const phase of ['ready', 'applied']) assert.ok(renderShipCard(docOf(), { phase, title: 'Charts', result: { mode: 'one' } }, { onAskChanges }).querySelector('.ask-changes'), phase);
  for (const phase of ['waiting', 'declined']) assert.equal(renderShipCard(docOf(), { phase, title: 'Charts' }, { onAskChanges }).querySelector('.ask-changes'), null, phase);
  assert.equal(renderShipCard(docOf(), { phase: 'ready', title: 'Charts' }, {}).querySelector('.ask-changes'), null, 'no handler: no field');
  const doc = docOf(); const sent = [];
  const block = { kind: 'card', id: 'card_1', state: 'applied', card: { ...READY, result: { mode: 'one' } } };
  const ctx = { doc, postCard: async () => ({}), postChanges: async (ref, t) => { sent.push([ref, t]); } };
  const { el } = buildShipChatCard(block, ctx);
  const input = el.querySelector('.ask-changes-input');
  input.value = 'one more'; input.dispatchEvent(new doc.defaultView.Event('input'));
  el.querySelector('.ask-changes-send').click(); await tick();
  assert.deepEqual(sent, [[{ featureId: 'feat_1' }, 'one more']]);
});

// ── Shaper requirements s3 (3.B): the acceptance ledger on the ready and applied card ────────────────────────────────
const AGREED = [{ id: 'R-po-1', text: 'Export the report as CSV' }, { id: 'R-sec-2', text: 'Sign every export' }];
const LEDGER = (entries = []) => ({ agreed: AGREED, entries, covered: ['R-po-1'] });
const ledgerCard = (entries, onMark, phase = 'ready') => {
  const doc = docOf();
  const el = renderShipCard(doc, { phase, featureId: 'feat_1', title: 'Charts', runs: 2, acceptance: LEDGER(entries),
    result: phase === 'applied' ? { mode: 'one' } : null }, { onMark });
  doc.body.appendChild(el);
  const $ = (q) => el.querySelector(q);
  const btn = (id, mark) => $(`[data-act="ship-mark-${id}-${mark}"]`);
  const labels = () => [...el.querySelectorAll('.plan-check-row .plan-check-label')].map((x) => x.textContent);
  const marks = () => [...el.querySelectorAll('.plan-check-row .plan-check-mark')].map((x) => x.getAttribute('aria-label'));
  return { doc, el, $, btn, labels, marks };
};
const deferred = () => { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; };

test('ledger: 1 unmarked row keeps Create PR disabled without btn-primary and says "· 1 left"; picking Met saves only its own entry (the server merges per id) and makes it primary', async () => {
  const sent = [];
  const { $, btn, labels, marks, el } = ledgerCard([{ id: 'R-sec-2', mark: 'dropped', reason: 'later' }],
    async (entries) => { sent.push(entries); return { ok: true }; });
  const create = $('[data-act="ship-create"]');
  assert.deepEqual([create.disabled, create.classList.contains('btn-primary')], [true, false]);
  assert.equal($('.ask-shipcard-left').textContent, 'Mark every requirement before you create the PR · 1 left');
  assert.equal($('.plan-check-line .plan-fold-text').textContent, 'Requirements 1/2 · 1 to fix');
  assert.deepEqual(labels(), ['R-po-1 · Export the report as CSV', 'R-sec-2 · Sign every export · later'], 'ready labels carry no state word');
  assert.deepEqual(marks(), ['not marked', 'dropped']);
  assert.equal($('.plan-check-detail').textContent, 'covered by the diff');
  const group = el.querySelector('.seg-sm[role="group"]');
  assert.equal(group.getAttribute('aria-label'), 'R-po-1 mark');
  assert.deepEqual([...group.querySelectorAll('button')].map((b) => [b.textContent, b.getAttribute('aria-pressed')]),
    [['Met', 'false'], ['Not met', 'false'], ['Dropped', 'false']], 'no button pressed while unmarked');
  btn('R-po-1', 'met').focus();
  btn('R-po-1', 'met').click(); await tick();
  assert.deepEqual(sent, [[{ id: 'R-po-1', mark: 'met' }]], 'no stale copy of another row\'s mark');
  assert.deepEqual([create.disabled, create.classList.contains('btn-primary'), $('.ask-shipcard-left').hidden], [false, true, true]);
  assert.equal(btn('R-po-1', 'met').getAttribute('aria-pressed'), 'true');
  assert.equal(el.ownerDocument.activeElement, btn('R-po-1', 'met'), 'focus stays on the picked button');
});

test('ledger: a refused save shows the error, repaints the previous mark and label, and returns the focus to its pressed button', async () => {
  const { $, btn, labels, el } = ledgerCard([{ id: 'R-po-1', mark: 'met' }, { id: 'R-sec-2', mark: 'met' }],
    async () => ({ ok: false, error: 'the feature already shipped' }));
  const create = $('[data-act="ship-create"]');
  btn('R-po-1', 'not-met').click();
  assert.equal(create.disabled, true, 'a picked Not met without its text counts as unmarked');
  const input = el.querySelectorAll('.ask-shipcard-mark input')[0];
  assert.deepEqual([input.hidden, input.placeholder], [false, 'Where it moved']);
  input.value = 'Run 5';
  input.dispatchEvent(new input.ownerDocument.defaultView.KeyboardEvent('keydown', { key: 'Enter' })); await tick();
  assert.equal($('.ask-card-err').textContent, 'the feature already shipped');
  assert.deepEqual([btn('R-po-1', 'met').getAttribute('aria-pressed'), btn('R-po-1', 'not-met').getAttribute('aria-pressed')], ['true', 'false']);
  assert.equal(labels()[0], 'R-po-1 · Export the report as CSV');
  assert.equal(input.hidden, true);
  assert.equal(el.ownerDocument.activeElement, btn('R-po-1', 'met'));
  assert.equal(create.disabled, false, 'every row is still marked');
});

test('ledger: Not met with an empty field saves nothing; Enter with text saves once', async () => {
  const sent = [];
  const { btn, el, labels } = ledgerCard([], async (entries) => { sent.push(entries); return { ok: true }; });
  btn('R-sec-2', 'not-met').click();
  const input = el.querySelectorAll('.ask-shipcard-mark input')[1];
  const key = () => input.dispatchEvent(new input.ownerDocument.defaultView.KeyboardEvent('keydown', { key: 'Enter' }));
  input.value = '   '; key(); input.dispatchEvent(new input.ownerDocument.defaultView.FocusEvent('blur')); await tick();
  assert.deepEqual(sent, []);
  input.value = 'Run 5'; key(); await tick();
  assert.deepEqual(sent, [[{ id: 'R-sec-2', mark: 'not-met', target: 'Run 5' }]]);
  assert.equal(labels()[1], 'R-sec-2 · Sign every export · moved to Run 5');
});

test('ledger: while a save is pending the row is aria-busy and every picker is disabled; Create PR stays disabled after its own click while a row is unmarked', async () => {
  const d = deferred();
  const { $, btn, el } = ledgerCard([], () => d.p);
  btn('R-po-1', 'met').click();
  const wraps = [...el.querySelectorAll('.ask-shipcard-mark')];
  assert.equal(wraps[0].getAttribute('aria-busy'), 'true');
  assert.equal(wraps[1].hasAttribute('aria-busy'), false, 'only the saving row');
  assert.ok([...el.querySelectorAll('.ask-shipcard-mark button')].every((b) => b.disabled));
  d.resolve({ ok: true }); await tick();
  assert.equal(wraps[0].hasAttribute('aria-busy'), false);
  assert.ok([...el.querySelectorAll('.ask-shipcard-mark button')].every((b) => !b.disabled));
  // A dialog opener cannot unlock an unmarked ledger through the click's finally (the old re-enable).
  setShipDialogOpener(async () => { throw new Error('HTTP 500'); });
  const create = $('[data-act="ship-create"]');
  create.disabled = false; create.click(); await tick(); await tick();
  assert.equal(create.disabled, true, 'R-sec-2 is still unmarked');
  setShipDialogOpener(null);
});

test('ledger: the applied card draws no picker and no "left" line, with the full words', () => {
  const { el, labels, marks } = ledgerCard([{ id: 'R-po-1', mark: 'met' }, { id: 'R-sec-2', mark: 'not-met', target: 'Run 5' }], null, 'applied');
  assert.equal(el.querySelector('.ask-shipcard-mark'), null);
  assert.equal(el.querySelector('.ask-shipcard-left'), null);
  assert.equal(el.querySelector('.plan-check-line .plan-fold-text').textContent, 'Requirements 2/2');
  assert.deepEqual(labels(), ['R-po-1 · Export the report as CSV · met', 'R-sec-2 · Sign every export · not met · moved to Run 5']);
  assert.deepEqual(marks(), ['met', 'not met']);
});

test('ledger: no acceptance draws today\'s card (no fold, no pickers, Create PR primary)', () => {
  const { el } = chat({ id: 'card_00000001', state: 'proposed', card: READY });
  assert.equal(el.querySelector('.plan-check-line'), null);
  assert.equal(el.querySelector('.ask-shipcard-mark'), null);
  assert.equal(el.querySelector('.ask-shipcard-left'), null);
  assert.deepEqual([el.querySelector('[data-act="ship-create"]').disabled, el.querySelector('[data-act="ship-create"]').classList.contains('btn-primary')], [false, true]);
});

test('chat card: marks go through saveAcceptance; the server\'s new ledger is taken in place, any other change rebuilds', async () => {
  const doc = docOf(); const saved = [];
  const block = { kind: 'card', id: 'card_1', state: 'proposed', card: { ...READY, acceptance: LEDGER([]) } };
  const ctx = { doc, postCard: async () => ({}), saveAcceptance: async (id, entries) => { saved.push([id, entries]); return { ok: true }; } };
  const { el, handle } = buildShipChatCard(block, ctx);
  doc.body.appendChild(el);
  el.querySelector('[data-act="ship-mark-R-po-1-met"]').click(); await tick();
  assert.deepEqual(saved, [['feat_1', [{ id: 'R-po-1', mark: 'met' }]]]);
  handle.blockChanged({ ...block, card: { ...block.card, acceptance: LEDGER([{ id: 'R-po-1', mark: 'met' }, { id: 'R-sec-2', mark: 'met' }]) } });
  assert.equal(el.querySelector('[data-act="ship-create"]').disabled, false, 'another tab marked the rest');
  assert.throws(() => handle.blockChanged({ ...block, state: 'applied' }));
  assert.equal('handle' in buildShipChatCard({ ...block, card: READY }, ctx), false, 'no ledger, no handle');
});

