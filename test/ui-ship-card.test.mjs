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


// ---- Feature D1: the small-runs Ship (m.smallRuns, featureView's ship.smallRuns) ----
const SR_ROW = (state, at = null, mark = state === 'confirmed' ? 'met' : null, reason = null) => ({ id: 'R-comp-4', text: 'The data stays in the EU', role: 'compliance',
  roleLabel: 'Compliance', state, mark, reason, at });
const SR = (over = {}) => ({
  confirmed: [SR_ROW('waiting')],
  owned: [{ id: 'R-po-1', text: 'People see it', run: 1, status: 'holds' }, { id: 'R-po-2', text: 'People pin it', run: 2, status: 'gap-accepted' }],
  waiting: ['R-comp-4'], blocked: true, reason: 'Waiting for Compliance to confirm R-comp-4', met: { met: 1, total: 3 },
  care: { choice: "Balanced · Worca's pick", outcome: null, line: "Care: Balanced · Worca's pick" },
  base: 'dev',
  order: [{ index: 1, pipelineId: 'p1', title: 'Pin charts', pr: null, onto: null }, { index: 3, pipelineId: 'p3', title: 'Share', pr: null, onto: null },
    { index: 2, pipelineId: 'p2', title: 'Search', pr: null, onto: null }],
  ...over,
});
const READY_SR = SR({ confirmed: [SR_ROW('confirmed', '2026-11-22T16:55:00.000Z')], waiting: [], blocked: false, reason: null, met: { met: 2, total: 3 } });
const DONE_SR = SR({ ...READY_SR, order: [
  { index: 1, pipelineId: 'p1', title: 'Pin charts', pr: { number: 11, url: 'https://x/pull/11' }, onto: null },
  { index: 3, pipelineId: 'p3', title: 'Share', pr: { number: 12, url: 'https://x/pull/12' }, onto: 11 },
  { index: 2, pipelineId: 'p2', title: 'Search', pr: { number: 13, url: 'https://x/pull/13' }, onto: null }] });
let srFeature = 0;
const srCard = (sr, { phase = 'ready', onConfirm = async () => ({ ok: true }), countShown = false, titleShown = false, featureId = `feat_sr${++srFeature}` } = {}) => {
  const doc = docOf();
  const el = renderShipCard(doc, { phase, featureId, title: 'Charts', runs: 3, smallRuns: sr, result: phase === 'applied' ? { mode: 'stacked' } : null },
    { onConfirm, countShown, titleShown });
  doc.body.appendChild(el);
  return { el, doc };
};
const markBtn = (el, mk = 'met') => el.querySelector(`[data-act="ship-mark-R-comp-4-${mk}"]`);
const reasonIn = (el) => el.querySelector('[data-act="ship-mark-R-comp-4-text"]');
/** Chromium blurs a button it disables (jsdom does not): blur first, then set (rule focus-after-disable). */
const blurOnDisable = (doc) => {
  const proto = doc.defaultView.HTMLButtonElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'disabled');
  Object.defineProperty(proto, 'disabled', { configurable: true, get() { return desc.get.call(this); }, set(v) { if (v) this.blur(); desc.set.call(this, v); } });
};

test('D1 blocked: the reason names the role and id once, a Met / Not met / Dropped picker per confirmed row, Create 3 PRs disabled and described by it', () => {
  const { el } = srCard(SR());
  assert.ok(el.classList.contains('is-small-runs'));
  const why = el.querySelector('.ask-shipcard-why');
  assert.equal(why.textContent, 'Waiting for Compliance to confirm R-comp-4');
  assert.deepEqual([...why.querySelectorAll('.ask-shipcard-id')].map((x) => x.textContent), ['R-comp-4'], 'the id is one unbreakable span (375px)');
  assert.equal(el.querySelector('.ask-shipcard-stats').textContent, 'Your turn: mark what only a person can');
  assert.equal((el.querySelector('.ask-mcard-body').textContent.match(/waiting for compliance/gi) || []).length, 1);
  const seg = markBtn(el).closest('.seg.seg-sm');
  assert.equal(seg.getAttribute('aria-label'), 'Mark R-comp-4 as Compliance: The data stays in the EU');
  assert.deepEqual([...seg.querySelectorAll('button')].map((b) => [b.textContent, b.getAttribute('aria-pressed'), b.className]),
    [['Met', 'false', ''], ['Not met', 'false', ''], ['Dropped', 'false', '']], 'quiet: no primary, nothing pressed');
  assert.equal(reasonIn(el), null);
  const row = seg.closest('.ask-shipcard-mark').previousElementSibling;
  assert.equal(row.querySelector('.plan-check-id').textContent, 'R-comp-4');
  assert.equal(row.querySelector('.plan-check-detail').textContent, 'confirmed by a person · Compliance');
  assert.ok(row.closest('.srows'));
  const fold = el.querySelector('.plan-check-line');
  assert.equal(fold.textContent.replace('›', ''), "2 checked by the runs' reviews and the Verifier");
  assert.deepEqual([...el.querySelectorAll('.ask-shipcard-owned .plan-check-detail')].map((d) => d.textContent), ['run 1 · holds', 'run 2 · gap accepted']);
  const care = el.querySelectorAll('.rd-kv-row[data-fact="care"]');
  assert.equal(care.length, 1);
  assert.equal(care[0].querySelector('.rd-kv-v').textContent, "Balanced · Worca's pick");
  const create = el.querySelector('[data-act="ship-create"]');
  assert.equal(create.textContent, 'Create 3 PRs');
  assert.deepEqual([create.disabled, create.classList.contains('btn-primary'), create.getAttribute('aria-describedby')], [true, false, why.id]);
  assert.ok(why.id);
  assert.equal(el.querySelectorAll('.btn-primary').length, 0);
});

test('D1 ready: one primary (Create 3 PRs), no Answer, a Met row reads "confirmed by Compliance · time" with Met pressed, no reason', () => {
  const { el } = srCard(READY_SR);
  assert.equal(el.querySelector('.ask-shipcard-stats').textContent, 'Ready to ship');
  assert.equal(el.querySelector('.ask-mcard-title').textContent, 'Charts', 'the feature page has no title of its own above the card');
  const chat = srCard(READY_SR, { titleShown: true }).el;
  assert.deepEqual([chat.querySelector('.ask-mcard-title'), chat.querySelector('.ask-mcard-kind').textContent], [null, 'Ship'],
    "titleShown: the Chat card's head names the feature, the Ship card only its step");
  assert.equal((chat.textContent.match(/Charts/g) || []).length, 0);
  assert.equal(el.querySelectorAll('.btn-primary').length, 1);
  assert.equal(el.querySelector('.btn-primary').dataset.act, 'ship-create');
  assert.equal(el.querySelector('[data-act="ship-create"]').disabled, false);
  assert.equal(markBtn(el).getAttribute('aria-pressed'), 'true', 'a mark can change until Ship is done');
  assert.equal(el.querySelector('.ask-shipcard-why'), null);
  assert.match(el.querySelector('.ask-shipcard-confirmed .plan-check-detail').textContent, /^confirmed by Compliance · \d\d:\d\d$/);
  assert.equal([...el.querySelectorAll('button')].filter((x) => /answer/i.test(x.textContent)).length, 0);
});

test('D1 Not met with a reason: the row reads "Marked Not met by you", the reason on its own line, Ship open', () => {
  const sr = SR({ confirmed: [SR_ROW('confirmed', '2026-11-22T16:55:00.000Z', 'not-met', 'Legal has not signed')], waiting: [], blocked: false, reason: null,
    met: { met: 1, total: 3 }, unmet: [{ id: 'R-comp-4', text: 'The data stays in the EU', mark: 'not-met', reason: 'Legal has not signed' }] });
  const { el } = srCard(sr);
  assert.match(el.querySelector('.ask-shipcard-confirmed .plan-check-detail').textContent, /^Marked Not met by you · \d\d:\d\d$/);
  assert.equal(el.querySelector('.ask-shipcard-reason').textContent, 'Legal has not signed');
  assert.equal(markBtn(el, 'not-met').getAttribute('aria-pressed'), 'true');
  assert.equal(el.querySelector('.ask-shipcard-confirmed .plan-check-mark').getAttribute('aria-label'), 'not met');
  assert.equal(el.querySelector('[data-act="ship-create"]').classList.contains('btn-primary'), true);
  // Blocked without a reason: the reason line asks for one, and the field is open.
  const bare = srCard(SR({ confirmed: [SR_ROW('needs-reason', null, 'dropped')], waiting: [], blocked: true, reason: 'Give a reason for each one not met or dropped' }));
  assert.equal(bare.el.querySelector('.ask-shipcard-why').textContent, 'Give a reason for each one not met or dropped');
  assert.ok(reasonIn(bare.el));
  assert.equal(bare.el.querySelector('[data-act="ship-create"]').disabled, true);
});

test('D1 marking Met: a double click sends one mark; success keeps the focus on Met, also after a blur on disable', async () => {
  let calls = 0; let release;
  const { el, doc } = srCard(SR(), { onConfirm: (id, mk) => { calls++; assert.deepEqual([id, mk], ['R-comp-4', 'met']); return new Promise((r) => { release = r; }); } });
  blurOnDisable(doc);
  const b = markBtn(el);
  b.focus();
  b.click(); b.click(); markBtn(el).click();
  assert.equal(calls, 1);
  assert.deepEqual([markBtn(el).disabled, markBtn(el).closest('.ask-shipcard-mark').getAttribute('aria-busy')], [true, 'true'], "that row's picker is busy");
  release({ ok: true, smallRuns: READY_SR });
  await tick(); await tick();
  assert.equal(doc.activeElement, markBtn(el));
  assert.equal(markBtn(el).getAttribute('aria-pressed'), 'true');
  assert.equal(el.querySelector('[data-act="ship-create"]').classList.contains('btn-primary'), true);
  assert.equal(el.querySelector('.ask-shipcard-why'), null);
});

test('D1 marking Not met: the reason field opens; Enter sends the mark with the collapsed reason; an empty one sends nothing', async () => {
  const sent = [];
  const after = SR({ confirmed: [SR_ROW('confirmed', '2026-11-22T16:55:00.000Z', 'not-met', 'Legal has not signed')], waiting: [], blocked: false, reason: null });
  const { el, doc } = srCard(SR(), { onConfirm: async (...a) => { sent.push(a); return { ok: true, smallRuns: after }; } });
  markBtn(el, 'not-met').click();
  const input = reasonIn(el);
  assert.equal(doc.activeElement, input);
  assert.deepEqual([input.placeholder, input.maxLength], ['Why it is not met', 300]);
  input.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.deepEqual(sent, [], 'no reason, nothing sent');
  input.value = '  Legal has\n not signed ';
  input.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await tick(); await tick();
  assert.deepEqual(sent, [['R-comp-4', 'not-met', 'Legal has not signed']]);
  assert.equal(reasonIn(el), null);
  assert.equal(el.querySelector('.ask-shipcard-reason').textContent, 'Legal has not signed');
  assert.equal(doc.activeElement, markBtn(el, 'not-met'));
});

test('D1 a half-typed reason survives a rebuild of the card (a page repaint)', () => {
  const first = srCard(SR(), { featureId: 'feat_keep' });
  markBtn(first.el, 'dropped').click();
  const input = reasonIn(first.el);
  input.value = 'Out of';
  input.dispatchEvent(new first.doc.defaultView.Event('input'));
  const again = srCard(SR(), { featureId: 'feat_keep' });
  assert.equal(reasonIn(again.el).value, 'Out of');
  assert.equal(markBtn(again.el, 'dropped').getAttribute('aria-pressed'), 'true');
});

test('D1 a repaint that removes the focused reason field saves nothing (Chromium blurs the removed node first)', async () => {
  const sent = [];
  const { el, doc } = srCard(SR(), { featureId: 'feat_blur', onConfirm: async (...a) => { sent.push(a); return { ok: true }; } });
  markBtn(el, 'dropped').click();
  const input = reasonIn(el);
  input.value = 'half a reas';
  input.dispatchEvent(new doc.defaultView.Event('input'));
  // Chromium's order on replaceChildren: blur on the still-connected node, then the removal.
  input.dispatchEvent(new doc.defaultView.FocusEvent('blur'));
  doc.body.replaceChildren();
  await tick(); await tick();
  assert.deepEqual(sent, [], 'the half-typed reason is not saved');
  const again = srCard(SR(), { featureId: 'feat_blur' });
  assert.equal(reasonIn(again.el).value, 'half a reas', 'the draft is still there');
});

test('D1 a real blur on the reason field still saves it', async () => {
  const sent = [];
  const { el, doc } = srCard(SR(), { onConfirm: async (...a) => { sent.push(a); return { ok: true }; } });
  markBtn(el, 'dropped').click();
  const input = reasonIn(el);
  input.value = 'Out of scope';
  input.dispatchEvent(new doc.defaultView.FocusEvent('blur'));
  await tick(); await tick();
  assert.deepEqual(sent, [['R-comp-4', 'dropped', 'Out of scope']]);
});

test('D1 mark failed: the picker stays, the error line shows the message and focus returns to Met', async () => {
  const { el, doc } = srCard(SR(), { onConfirm: async () => ({ ok: false, error: 'R-comp-4 is owned by run 2: its run and the Verifier check it' }) });
  markBtn(el).focus();
  markBtn(el).click();
  await tick(); await tick();
  assert.equal(el.querySelector('.ask-card-err').textContent, 'R-comp-4 is owned by run 2: its run and the Verifier check it');
  assert.equal(markBtn(el).disabled, false);
  assert.equal(markBtn(el).getAttribute('aria-pressed'), 'false');
  assert.equal(doc.activeElement, markBtn(el));
});

test('D1 Create N PRs opens the shared dialog; a partly failed ship keeps the button and shows the error naming the run', async () => {
  setShipDialogOpener(async () => { throw new Error("could not mark slice 3's PR ready: boom"); });
  const { el } = srCard(READY_SR);
  const c = el.querySelector('[data-act="ship-create"]');
  c.click(); await tick(); await tick();
  assert.equal(el.querySelector('.ask-card-err').textContent, "could not mark slice 3's PR ready: boom");
  assert.deepEqual([c.isConnected, c.disabled, c.classList.contains('btn-primary')], [true, false, true]);
  setShipDialogOpener(null);
});

test('D1 done: N PRs open, no step head, the Care row once above one .srows row per PR in finish order', () => {
  const { el } = srCard(DONE_SR, { phase: 'applied' });
  assert.equal(el.querySelector('.ask-shipcard-done').textContent, '3 PRs open');
  assert.equal(el.querySelector('.ask-shipcard-stats').textContent, 'a PR per run, stacked in the order runs finished');
  assert.doesNotMatch(el.textContent, /Your turn/);
  const care = el.querySelectorAll('.rd-kv-row[data-fact="care"]');
  assert.equal(care.length, 1);
  const rows = [...el.querySelectorAll('.ask-shipcard-prs .plan-check-row')];
  assert.ok(care[0].compareDocumentPosition(rows[0]) & 4, 'Care above the PR rows');
  assert.deepEqual(rows.map((r) => [r.querySelector('.plan-check-id').textContent, r.querySelector('.plan-check-label').textContent,
    r.querySelector('.plan-check-detail').textContent]), [['#11', 'run 1 · Pin charts', 'into dev'], ['#12', 'run 3 · Share', 'onto #11'], ['#13', 'run 2 · Search', 'into dev']]);
  for (const n of ['#11', '#12', '#13']) assert.equal([...el.querySelectorAll('.plan-check-id')].filter((x) => x.textContent === n).length, 1);
  const view = el.querySelector('[data-act="ship-view-prs"]');
  assert.deepEqual([view.textContent, view.className], ['View PRs', 'btn btn-sm btn-quiet']);
  assert.equal(el.querySelectorAll('a[href]').length, 0, 'no raw links');
});

// ---- Slice 4 (D11): `along` says the server listed the PRs along the real branches ----
test('small-runs done card with `along`: the stats line reads "stacked along the real branches" above the same rows', () => {
  const read = (sr) => {
    const { el } = srCard(sr, { phase: 'applied' });
    return { done: el.querySelector('.ask-shipcard-done').textContent, stats: [...el.querySelectorAll('.ask-shipcard-stats')].map((x) => x.textContent),
      rows: [...el.querySelectorAll('.ask-shipcard-prs .plan-check-row')].map((r) => r.textContent) };
  };
  const plain = read(DONE_SR);
  const along = read({ ...DONE_SR, along: true });
  assert.deepEqual(along.stats, ['stacked along the real branches']);
  assert.deepEqual([along.done, along.rows], [plain.done, plain.rows]);
  assert.equal(along.rows.length, 3);
});

// ---- Small runs D3 (D5): the rows read the server's one `shown` status when it is there ----
const SHOWN = (owner, word, mark, role = null, text = `${owner} · ${word}`) => ({ owner, role, word, text, mark });
test('small-runs rows with shown: owned note shown.text, a marked confirmed note keeps D1\'s text, a waiting one still reads `confirmed by a person · Compliance`; without shown D1\'s notes stay', () => {
  const waiting = SR({ confirmed: [{ ...SR_ROW('waiting'), shown: SHOWN('confirmed by a person', 'Compliance', 'wait', 'Compliance', 'confirmed by a person · Compliance') }],
    owned: [{ id: 'R-po-1', text: 'People see it', run: 1, status: 'holds', shown: SHOWN('run 1', 'met', 'check') },
      { id: 'R-po-2', text: 'People pin it', run: 2, status: 'holds', shown: SHOWN('run 2', 'being built', 'live') }] });
  const { el } = srCard(waiting);
  const owned = [...el.querySelectorAll('.ask-shipcard-owned .plan-check-row')];
  assert.deepEqual(owned.map((r) => r.querySelector('.plan-check-detail').textContent), ['run 1 · met', 'run 2 · being built']);
  assert.deepEqual(owned.map((r) => r.querySelector('.plan-check-mark').getAttribute('aria-label')), ['met', 'being built']);
  assert.ok(owned[1].querySelector('.plan-check-mark').classList.contains('is-live'), 'the mark is shown.mark');
  assert.equal(owned[1].title, 'R-po-2 · People pin it · run 2 · being built');
  assert.equal(el.querySelector('.ask-shipcard-confirmed .plan-check-detail').textContent, 'confirmed by a person · Compliance');
  const at = '2026-11-22T16:55:00.000Z';
  const marked = SR({ ...READY_SR, confirmed: [{ ...SR_ROW('confirmed', at), shown: SHOWN('confirmed by a person', 'confirmed by Compliance', 'check', 'Compliance', 'confirmed by Compliance') }] });
  const d = new Date(at);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  assert.equal(srCard(marked).el.querySelector('.ask-shipcard-confirmed .plan-check-detail').textContent, `confirmed by Compliance · ${time}`);
  const notMet = SR({ ...READY_SR, confirmed: [{ ...SR_ROW('confirmed', at, 'not-met', 'no copy'),
    shown: SHOWN('confirmed by a person', 'Marked Not met by you', 'x', 'Compliance', 'Marked Not met by you · no copy') }] });
  assert.equal(srCard(notMet).el.querySelector('.ask-shipcard-confirmed .plan-check-detail').textContent, `Marked Not met by you · ${time}`);
  const done = SR({ ...DONE_SR, confirmed: notMet.confirmed, unmet: [{ id: 'R-comp-4', text: 'The data stays in the EU', mark: 'not-met', reason: 'no copy' }] });
  assert.equal(srCard(done, { phase: 'applied' }).el.querySelector('.ask-shipcard-unmet .plan-check-detail').textContent, 'Marked Not met by you · no copy',
    'an applied unmet row reads its confirmed entry\'s shown.text');
  const bare = srCard(SR()).el;
  assert.deepEqual([...bare.querySelectorAll('.ask-shipcard-owned .plan-check-detail')].map((x) => x.textContent), ['run 1 · holds', 'run 2 · gap accepted'], 'no shown: D1');
});

test('D1 done: "1 PR open"; the Not met / Dropped rows under the PRs; countShown leaves the count to the host state line', () => {
  const one = SR({ ...DONE_SR, order: DONE_SR.order.slice(0, 1), unmet: [{ id: 'R-comp-4', text: 'The data stays in the EU', mark: 'dropped', reason: 'Out of scope' },
    { id: 'R-sec-1', text: 'Owners only', mark: 'not-met', reason: 'Legal has not signed' }] });
  const { el } = srCard(one, { phase: 'applied' });
  assert.equal(el.querySelector('.ask-shipcard-done').textContent, '1 PR open');
  const unmet = el.querySelector('.ask-shipcard-unmet');
  assert.ok(unmet.classList.contains('srows'));
  assert.ok(el.querySelector('.ask-shipcard-prs').compareDocumentPosition(unmet) & 4, 'under the PR rows');
  assert.deepEqual([...unmet.querySelectorAll('.plan-check-row')].map((r) => [r.querySelector('.plan-check-id').textContent,
    r.querySelector('.plan-check-label').textContent, r.querySelector('.plan-check-detail').textContent, r.querySelector('.plan-check-mark').getAttribute('aria-label')]),
  [['R-comp-4', 'The data stays in the EU', 'Dropped · Out of scope', 'dropped'], ['R-sec-1', 'Owners only', 'Not met · Legal has not signed', 'not met']]);
  assert.equal(srCard(DONE_SR, { phase: 'applied' }).el.querySelector('.ask-shipcard-unmet'), null, 'no rows when every requirement is met');
  const shown = srCard(DONE_SR, { phase: 'applied', countShown: true }).el;
  assert.equal(shown.querySelector('.ask-shipcard-done'), null);
  assert.doesNotMatch(shown.textContent, /PRs open/);
});
