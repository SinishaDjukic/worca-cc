// test/ui-perspective-chips.test.mjs — the run card's proposed perspectives (flag proposedPerspectives) in the builders:
// buildPerspectiveChips (ui/public/shape/chips.mjs), shapeCardExtras (ui/public/shape/proposal.mjs) and the plan
// approval card's chips (ui/public/shape/plan-body.mjs). Flag off, every DOM and body is today's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildPerspectiveChips } from '../ui/public/shape/chips.mjs';
import { shapeCardExtras } from '../ui/public/shape/proposal.mjs';
import { renderPlanBody } from '../ui/public/shape/plan-body.mjs';
import { PERSPECTIVES, COMPLIANCE, DEFAULT_PERSPECTIVES, perspectiveByKey } from '../src/shared/shape/perspectives.mjs';
import { SIGNALS, KIND_START } from '../src/shared/prompt-check/perspectives.mjs';

/** A fresh window per test, closed after it. */
function win(t) {
  const w = new JSDOM('<!doctype html><body></body>').window;
  t.after(() => w.close());
  return w.document;
}
/** The chip DOM as data: key, on, title, aria-description, pressed; and the "+ N more" text. */
const dom = (el) => ({
  chips: [...el.querySelectorAll('.shape-chip')].map((b) => [b.dataset.perspective, b.classList.contains('on'), b.title,
    b.getAttribute('aria-description'), b.getAttribute('aria-pressed')]),
  more: el.querySelector('.shape-chip-more')?.textContent ?? null,
});
const chip = (el, key) => el.querySelector(`.shape-chip[data-perspective="${key}"]`);
const today = (keys, offered = PERSPECTIVES.filter((p) => p.key !== 'fit')) => ({
  chips: offered.filter((p) => keys.includes(p.key)).map((p) => [p.key, true, p.help, null, 'true']),
  more: `+ ${offered.length - keys.length} more`,
});
const SEC = SIGNALS.find((s) => s.key === 'security').reason;

test('with the defaults the chips DOM is today\'s: keys, on classes, help titles, no aria-description', (t) => {
  const d = win(t);
  const c = buildPerspectiveChips(d, { picked: ['qa'], hidden: ['fit'], collapsed: true });
  assert.deepEqual(dom(c.el), today(['product', 'qa']));
  assert.equal(typeof c.propose, 'function');
  c.el.querySelector('.shape-chip-more').click();
  assert.equal(c.el.querySelectorAll('.shape-chip').length, 8);
  assert.equal(chip(c.el, 'compliance'), null);
  assert.equal(c.el.querySelectorAll('[aria-description]').length, 0);
});

test('flag off, shaped card: chips and body() are today\'s', (t) => {
  const d = win(t);
  const ui = shapeCardExtras(d, { shape: { perspectives: ['product', 'qa'] } });
  assert.deepEqual(dom(ui.chipsEl), today(['product', 'qa']));
  assert.deepEqual(ui.body(), { workflowId: 'wf_shape', shape: { perspectives: ['product', 'qa'] } });
  assert.equal(ui.proposeFrom, undefined);
});

test('flag off, nudged card: the same; a plain card has no extras', (t) => {
  const d = win(t);
  const ui = shapeCardExtras(d, { nudge: { size: 'small', perspectives: ['architect'] } });
  assert.deepEqual(dom(ui.chipsEl), today(['product', 'architect']));
  assert.deepEqual(ui.body(), { workflowId: 'wf_shape', shape: { perspectives: ['product', 'architect'], size: 'small' } });
  assert.equal(shapeCardExtras(d, { brief: 'x' }), null);
});

test('flag on, plain card: DEFAULT_PERSPECTIVES on, body() is { perspectives } with no workflowId', (t) => {
  const d = win(t);
  const ui = shapeCardExtras(d, { brief: 'x' }, { proposedPerspectives: true });
  assert.equal(ui.plain, true);
  assert.deepEqual(dom(ui.chipsEl).chips.filter((c) => c[1]).map((c) => c[0]), DEFAULT_PERSPECTIVES);
  assert.deepEqual(ui.body(), { perspectives: [...DEFAULT_PERSPECTIVES] });
  assert.equal('workflowId' in ui.body(), false);
});

test('flag on: Compliance sits under "+ N more", and N counts it', (t) => {
  const d = win(t);
  const ui = shapeCardExtras(d, { brief: 'x' }, { proposedPerspectives: true });
  assert.equal(chip(ui.chipsEl, 'compliance'), null);
  assert.equal(ui.chipsEl.querySelector('.shape-chip-more').textContent, '+ 6 more');   // 9 offered + Compliance − 3 on − fit
  ui.chipsEl.querySelector('.shape-chip-more').click();
  assert.equal(chip(ui.chipsEl, 'compliance').title, COMPLIANCE.help);
});

test('Space on Compliance sets aria-pressed="true", and focus stays on the Compliance chip', (t) => {
  const d = win(t);
  const ui = shapeCardExtras(d, { brief: 'x' }, { proposedPerspectives: true });
  d.body.appendChild(ui.el);
  ui.chipsEl.querySelector('.shape-chip-more').click();
  const b = chip(ui.chipsEl, 'compliance');
  b.focus();
  b.dispatchEvent(new d.defaultView.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  b.click();   // a button's Space activation is a click
  assert.equal(chip(ui.chipsEl, 'compliance').getAttribute('aria-pressed'), 'true');
  assert.equal(d.activeElement, chip(ui.chipsEl, 'compliance'));
  assert.deepEqual(ui.body().perspectives, [...DEFAULT_PERSPECTIVES, 'compliance']);
});

test('propose sets the selection; a proposed chip\'s title and aria-description are its reason, others keep help', (t) => {
  const d = win(t);
  const c = buildPerspectiveChips(d, { picked: DEFAULT_PERSPECTIVES, hidden: ['fit'], extra: [COMPLIANCE] });
  c.propose(['product', 'qa', 'security'], { product: 'p-why', qa: 'q-why', security: SEC });
  assert.deepEqual(c.value(), ['product', 'qa', 'security']);
  assert.equal(chip(c.el, 'security').title, SEC);
  assert.equal(chip(c.el, 'security').getAttribute('aria-description'), SEC);
  c.el.querySelector('.shape-chip-more').click();
  assert.equal(chip(c.el, 'ux').title, perspectiveByKey('ux').help);
  assert.equal(chip(c.el, 'ux').getAttribute('aria-description'), null);
});

test('a proposal that turns a chip off moves it under "+ N more"', (t) => {
  const d = win(t);
  const c = buildPerspectiveChips(d, { picked: DEFAULT_PERSPECTIVES, hidden: ['fit'], extra: [COMPLIANCE] });
  assert.ok(chip(c.el, 'architect'));
  c.propose(['product', 'qa', 'ux'], {});
  assert.equal(chip(c.el, 'architect'), null);
  assert.equal(c.el.querySelector('.shape-chip-more').textContent, '+ 6 more');
});

test('a toggle before propose latches the selection but the reasons still apply on the same el; "+ N more" sets no latch', (t) => {
  const d = win(t);
  const c = buildPerspectiveChips(d, { picked: DEFAULT_PERSPECTIVES, hidden: ['fit'], extra: [COMPLIANCE] });
  const el = c.el;
  chip(el, 'qa').click();
  const kept = c.value();
  c.propose(['product', 'security', 'ux'], { security: SEC });
  assert.deepEqual(c.value(), kept);
  assert.equal(c.el, el);
  el.querySelector('.shape-chip-more').click();
  assert.equal(chip(el, 'security').title, SEC);

  const e = buildPerspectiveChips(d, { picked: DEFAULT_PERSPECTIVES, hidden: ['fit'], extra: [COMPLIANCE] });
  e.el.querySelector('.shape-chip-more').click();
  e.propose(['product', 'security'], {});
  assert.deepEqual(e.value(), ['product', 'security']);
});

test('a propose repaint keeps focus on the same key; a focused chip moved under "+ N more" sends focus there, else to the first chip', (t) => {
  const d = win(t);
  const c = buildPerspectiveChips(d, { picked: DEFAULT_PERSPECTIVES, hidden: ['fit'], extra: [COMPLIANCE] });
  d.body.appendChild(c.el);
  chip(c.el, 'qa').focus();
  c.propose(['product', 'qa', 'security'], {});
  assert.equal(d.activeElement, chip(c.el, 'qa'));
  c.propose(['product', 'security'], {});
  assert.equal(d.activeElement, c.el.querySelector('.shape-chip-more'));

  const all = buildPerspectiveChips(d, { picked: DEFAULT_PERSPECTIVES, hidden: ['fit'], extra: [COMPLIANCE] });
  d.body.appendChild(all.el);
  all.el.querySelector('.shape-chip-more').focus();
  all.propose(PERSPECTIVES.filter((p) => p.key !== 'fit').map((p) => p.key).concat('compliance'), {});
  assert.equal(all.el.querySelector('.shape-chip-more'), null, 'every chip is on: no "+ N more"');
  assert.equal(d.activeElement, all.el.querySelector('.shape-chip:not([disabled])'), 'the first chip that takes focus');
});

test('a model reason with markup shows as literal title text and creates no element', (t) => {
  const d = win(t);
  const c = buildPerspectiveChips(d, { picked: DEFAULT_PERSPECTIVES, hidden: ['fit'] });
  const evil = '<img src=x onerror="alert(1)">';
  c.propose(['product', 'qa'], { qa: evil });
  assert.equal(chip(c.el, 'qa').title, evil);
  assert.equal(chip(c.el, 'qa').getAttribute('aria-description'), evil);
  assert.equal(c.el.querySelector('img'), null);
});

test('body() after a proposal carries perspectiveProposal { proposed, kind } and no reason or text', (t) => {
  const d = win(t);
  const plain = shapeCardExtras(d, { brief: 'x' }, { proposedPerspectives: true });
  plain.proposeFrom({ kind: 'bug', perspectives: [] }, 'The password reset fails.');
  assert.deepEqual(plain.body(), { perspectives: ['product', 'architect', 'qa', 'security'],
    perspectiveProposal: { proposed: ['product', 'qa', 'architect', 'security'], kind: 'bug' } });
  const shaped = shapeCardExtras(d, { shape: { perspectives: ['product', 'ux'] } }, { proposedPerspectives: true });
  shaped.proposeFrom({ kind: 'idea', perspectives: [] }, 'zebra idea');
  const b = shaped.body();
  assert.deepEqual(b.shape.perspectives, KIND_START.idea);
  assert.deepEqual(b.perspectiveProposal, { proposed: [...KIND_START.idea], kind: 'idea' });
  assert.doesNotMatch(JSON.stringify(b), /zebra|reason/);
  assert.deepEqual(Object.keys(shaped.body(false)).sort(), ['perspectiveProposal', 'perspectives']);
});

test('Product stays disabled with data-locked after propose', (t) => {
  const d = win(t);
  const c = buildPerspectiveChips(d, { picked: DEFAULT_PERSPECTIVES, hidden: ['fit'], extra: [COMPLIANCE] });
  c.propose(['qa', 'security'], { product: 'why' });
  const p = chip(c.el, 'product');
  assert.equal(p.disabled, true);
  assert.equal(p.dataset.locked, '1');
  assert.ok(c.value().includes('product'));
});

test('the plan approval card keeps a run\'s Compliance in its chips and value; without it the DOM is today\'s', (t) => {
  const d = win(t);
  const render = (perspectives) => {
    const panel = d.createElement('div');
    const sent = [];
    renderPlanBody(panel, { id: 'q1', kind: 'plan', nodeId: 'plan', executionId: 'e1',
      plan: { port: 'plan', file: '/x/p-v2.md', round: 2, revisable: true, nodeId: 'plan', check: { ok: true, passed: 1, total: 1, items: [] }, perspectives } },
    { doc: d, run: {}, extras: true, title: 'Approve', chip: 'Plan', fetchPlan: async () => ({ name: 'p.md', text: '' }),
      markdown: { ensure: async () => true, render: () => ({ kind: 'md', frag: d.createDocumentFragment() }) },
      submit: async (p) => { sent.push(p); return true; }, openFull() {}, openInNewRun() {}, savePlan: async () => ({ status: 200, body: {} }), confirm: async () => true });
    return { panel, sent };
  };
  const withC = render(['product', 'qa', 'compliance']);
  assert.equal(withC.panel.querySelector('.plan-persp-names').textContent, 'Product · QA · Compliance');
  const c = withC.panel.querySelector('.shape-chip[data-perspective="compliance"]');
  assert.equal(c.classList.contains('on'), true);
  withC.panel.querySelector('.shape-chip[data-perspective="architect"]').click();
  withC.panel.querySelector('.plan-update').click();
  assert.deepEqual(withC.sent[0].perspectives, ['product', 'architect', 'qa', 'compliance']);

  const without = render(['product', 'qa']);
  assert.equal(without.panel.querySelector('.shape-chip[data-perspective="compliance"]'), null);
  assert.deepEqual(dom(without.panel.querySelector('.shape-chips')).chips,
    PERSPECTIVES.filter((p) => p.key !== 'fit').map((p) => [p.key, ['product', 'qa'].includes(p.key), p.help, null, String(['product', 'qa'].includes(p.key))]));
});
