// test/ui-shape-proposal.test.mjs — the run card's Shape it first parts (spec §3.2): chips on a shaped card,
// the nudge (open decisions, both choices with estimates) on a nudged one.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { shapeCardExtras, shapeWhatHappens, shapeAdvancedSummary } from '../ui/public/shape/proposal.mjs';
import { SHAPE_ATTENTION } from '../ui/public/shape/plan-text.mjs';
import { _resetAnswerer } from '../ui/public/answerer.mjs';
import { resolveShapeRequest } from '../src/core/shape/run.mjs';
import { SHAPE_REQ_WORKFLOW_IDS } from '../src/core/graph/builtin-workflows.mjs';

const doc = () => new JSDOM('<!doctype html><body></body>').window.document;
const est = (planningUsd, buildUsd, minutes) => ({ costUsd: planningUsd + buildUsd, planningUsd, buildUsd, minutes, samples: 4 });
const nudge = (over = {}) => ({
  reason: 'decisions', size: 'large', openDecisions: ['Storage engine', 'Auth model'], perspectives: ['architect'],
  estimates: { asIs: est(0.5, 1, 12), shaped: est(1.25, 1, 9) }, asIsAuto: false, ...over,
});
const texts = (el, sel) => [...el.querySelectorAll(sel)].map((e) => e.textContent);

test('no shape and no nudge → null', () => {
  assert.equal(shapeCardExtras(doc(), {}), null);
  assert.equal(shapeCardExtras(doc(), null), null);
  assert.equal(shapeCardExtras(doc(), { title: 'Fix it', workflowId: 'wf_default' }), null);
});

test('a shaped card has chips but no choices; body() reflects a chip toggle', () => {
  const ui = shapeCardExtras(doc(), { shape: { perspectives: ['product', 'qa'] } });
  assert.equal(ui.el.querySelector('.shape-choices'), null);
  assert.ok(ui.el.querySelector('.shape-facts'));
  assert.ok(ui.el.querySelector('.shape-chips'));
  assert.deepEqual(ui.body(), { workflowId: 'wf_shape', shape: { perspectives: ['product', 'qa'] } });
  ui.el.querySelector('.shape-chip[data-perspective="qa"]').click();
  assert.deepEqual(ui.body(), { workflowId: 'wf_shape', shape: { perspectives: ['product'] } });
  ui.el.querySelector('.shape-chip-more').click();
  ui.el.querySelector('.shape-chip[data-perspective="ux"]').click();
  assert.deepEqual(ui.body(), { workflowId: 'wf_shape', shape: { perspectives: ['product', 'ux'] } });
});

test('a nudged card body() carries the nudge perspectives and size', () => {
  const ui = shapeCardExtras(doc(), { nudge: nudge() });
  assert.deepEqual(ui.body(), { workflowId: 'wf_shape', shape: { perspectives: ['product', 'architect'], size: 'large' } });
});

test('a shaped card body() sends the slices and size of card.shape', () => {
  const ui = shapeCardExtras(doc(), { shape: { perspectives: ['product', 'qa'], slices: 'off', size: 'medium' } });
  assert.deepEqual(ui.body(), { workflowId: 'wf_shape', shape: { perspectives: ['product', 'qa'], slices: 'off', size: 'medium' } });
});

test('shapeWhatHappens: the questions and the approval; slices only when suggested', () => {
  assert.equal(shapeWhatHappens({ perspectives: ['product'] }), 'Up to 3 questions, then a plan you approve.');
  assert.equal(shapeWhatHappens({ likelySlices: 3 }), 'Up to 3 questions, then a plan you approve. Likely 3 slices, one PR each.');
  assert.equal(shapeWhatHappens({ likelySlices: 1 }), 'Up to 3 questions, then a plan you approve.');
  assert.equal(shapeWhatHappens(null), 'Up to 3 questions, then a plan you approve.');
});

test('shapeAdvancedSummary', () => {
  assert.equal(shapeAdvancedSummary({ engine: 'Claude', guardrails: 'Normal', agents: 7 }),
    'Advanced · Claude · Normal guardrails · 7 agents on workflow defaults');
  assert.equal(shapeAdvancedSummary({ engine: 'Claude', guardrails: 'Normal', agents: 7, overrides: 2 }),
    'Advanced · Claude · Normal guardrails · 7 agents, 2 changed from workflow defaults');
  assert.equal(shapeAdvancedSummary({ engine: 'Codex', guardrails: 'Strict' }), 'Advanced · Codex · Strict guardrails');
  assert.equal(shapeAdvancedSummary(), 'Advanced');
});

// Requirements first: one facts line and the sentence "You lead as … supported by …".
const realFetch = globalThis.fetch;
let puts;
let profile;
function stubAnswerer({ lead = null, fail = false, putFails = false } = {}) {
  puts = [];
  profile = { lead };
  globalThis.fetch = async (url, init = {}) => {
    if (url !== '/api/answerer') throw new Error(`unexpected ${url}`);
    if (init.method === 'PUT') {
      puts.push(JSON.parse(init.body));
      if (putFails) return { ok: false, status: 500, json: async () => ({ error: { message: 'disk full' } }) };
      return { ok: true, status: 200, json: async () => JSON.parse(init.body) };
    }
    return fail ? { ok: false, status: 500, json: async () => null } : { ok: true, status: 200, json: async () => profile };
  };
}
beforeEach(() => { _resetAnswerer(); });
afterEach(() => { globalThis.fetch = realFetch; });
const tick = () => new Promise((r) => setTimeout(r, 0));
const flagDoc = (flags = '') => {
  const win = new JSDOM(`<!doctype html><html data-flags="${flags}"><body></body></html>`).window;
  return win.document;
};
const keyOn = (el, key) => { const e = new el.ownerDocument.defaultView.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }); el.dispatchEvent(e); return e; };
const menuItems = (d) => [...d.querySelectorAll('.wfv-menu [role^="menuitem"]')];
async function reqCard(over = {}, { lead = 'architect', flags } = {}) {
  stubAnswerer({ lead });
  const d = flagDoc(flags);
  const ui = shapeCardExtras(d, { nudge: nudge({ perspectives: ['architect', 'qa', 'security'], ...over }) });
  d.body.appendChild(ui.el);
  await tick();
  return { d, ui, triggers: () => [...ui.el.querySelectorAll('.spick-b')] };
}

test('large: one facts line, the sentence with two pickers, no choices and no chips row', async () => {
  const { ui, triggers } = await reqCard();
  assert.equal(ui.requirements, true);
  assert.deepEqual(texts(ui.el, '.shape-facts'), ['Large task · ≈ $2 · ~9 min']);
  assert.equal(ui.el.querySelector('.shape-choice'), null);
  assert.equal(ui.el.querySelector('.shape-chips'), null);
  assert.equal(ui.el.querySelector('.shape-nudge-list'), null);
  assert.deepEqual(triggers().map((b) => b.textContent), ['Engineering', 'QA and Security']);
  assert.equal(ui.el.querySelector('.shape-lead-line').textContent, 'You lead as Engineering, supported by QA and Security.');
  assert.equal(ui.blocked(), false);
});

test('no estimate → "no estimate yet"; a nudge without a size reads "This task"', async () => {
  const a = await reqCard({ estimates: null });
  assert.deepEqual(texts(a.ui.el, '.shape-facts'), ['Large task · no estimate yet']);
  const b = await reqCard({ size: null, estimates: { asIs: null, shaped: est(30, 1, 84) } });
  assert.deepEqual(texts(b.ui.el, '.shape-facts'), ['This task · ≈ $31 · ~84 min']);
  assert.equal(b.ui.requirements, false);
});

test('first time (no saved lead, or the profile fetch fails): "pick a role", nothing checked, blocked until a pick', async () => {
  for (const setup of [{ lead: null }, { fail: true }]) {
    stubAnswerer(setup);
    _resetAnswerer();
    const d = flagDoc();
    const ui = shapeCardExtras(d, { nudge: nudge() });
    d.body.appendChild(ui.el);
    assert.equal(ui.blocked(), true, 'blocked before the profile loads');
    assert.equal(ui.el.querySelector('.spick-b'), null, 'the sentence paints after the profile');
    await tick();
    const [lead] = [...ui.el.querySelectorAll('.spick-b')];
    assert.equal(lead.textContent, 'pick a role');
    assert.equal(ui.blocked(), true);
    lead.click();
    assert.equal(menuItems(d).filter((i) => i.getAttribute('aria-checked') === 'true').length, 0);
    menuItems(d)[2].click();
    assert.equal(ui.blocked(), false);
    assert.equal(lead.textContent, 'Design');
  }
});

test('the lead menu: six labelled radios, the saved lead says "you, last time", keys move, Escape returns focus', async () => {
  const { d, triggers } = await reqCard({}, { lead: 'qa' });
  const [lead] = triggers();
  lead.click();
  const items = menuItems(d);
  assert.deepEqual(items.map((i) => i.getAttribute('role')), Array(6).fill('menuitemradio'));
  assert.deepEqual(items.map((i) => i.querySelector('.wfv-menu-l').textContent), ['Product', 'Engineering', 'Design', 'QA', 'Security', 'DevOps']);
  assert.deepEqual(items.map((i) => i.getAttribute('aria-checked')), ['false', 'false', 'false', 'true', 'false', 'false']);
  assert.deepEqual(items.map((i) => i.querySelector('.wfv-menu-hint')?.textContent ?? null), [null, null, null, 'you, last time', null, null]);
  assert.equal(d.activeElement, items[0]);
  keyOn(items[0], 'ArrowDown');
  assert.equal(d.activeElement, items[1]);
  keyOn(items[1], 'End');
  assert.equal(d.activeElement, items[5]);
  keyOn(items[5], 'Home');
  assert.equal(d.activeElement, items[0]);
  keyOn(items[0], 'Escape');
  assert.equal(d.querySelector('.wfv-menu'), null);
  assert.equal(d.activeElement, lead);
  assert.equal(puts.length, 0, 'moving through a menu saves nothing');
});

test('the supporters menu: switch rows without Product or the lead; a toggle keeps it open; emptied reads "no one else"', async () => {
  const { d, ui, triggers } = await reqCard();
  const [, supp] = triggers();
  supp.click();
  const rows = menuItems(d);
  assert.deepEqual(rows.map((r) => r.getAttribute('role')), Array(rows.length).fill('menuitemcheckbox'));
  assert.deepEqual(rows.map((r) => r.querySelector('b').textContent), ['QA', 'Design', 'Security', 'DevOps', 'Release', "Devil's advocate"]);
  assert.equal(rows.some((r) => /Product|Engineering/.test(r.textContent)), false);
  assert.deepEqual(rows.map((r) => r.getAttribute('aria-checked')), ['true', 'false', 'true', 'false', 'false', 'false']);
  rows[0].click();
  rows[2].click();
  assert.ok(d.querySelector('.wfv-menu'), 'the menu stays open');
  assert.equal(supp.textContent, 'no one else');
  assert.deepEqual(ui.body().shape.perspectives, ['product', 'architect']);
  rows[1].click();
  assert.equal(supp.textContent, 'Design');
  assert.equal(puts.length, 0);
});

test('body(): lead, the size, and the perspectives product + lead + supporters in list order', async () => {
  const { ui, triggers } = await reqCard();
  assert.deepEqual(ui.body(), { workflowId: 'wf_shape', shape: { lead: 'architect', perspectives: ['product', 'architect', 'qa', 'security'], size: 'large' } });
  triggers()[0].click();
  menuItems(triggers()[0].ownerDocument)[0].click();                       // lead → Product
  assert.deepEqual(ui.body().shape, { lead: 'product', perspectives: ['product', 'architect', 'qa', 'security'], size: 'large' });
});

test('commit(): saves a lead that differs from the profile once; the same lead saves nothing; a failed save raises the error toast', async () => {
  const { d, ui, triggers } = await reqCard();
  ui.commit();
  await tick();
  assert.equal(puts.length, 0, 'the saved lead is the picked one');
  triggers()[0].click();
  menuItems(d)[3].click();                                                // QA
  assert.equal(puts.length, 0, 'a pick alone does not save');
  ui.commit();
  await tick();
  assert.deepEqual(puts, [{ lead: 'qa' }]);
  ui.commit();
  await tick();
  assert.equal(puts.length, 1, 'now the profile holds it');
  const f = await reqCard({}, { lead: null });
  stubAnswerer({ lead: null, putFails: true });
  f.triggers()[0].click();
  menuItems(f.d)[1].click();
  f.ui.commit();
  await tick(); await tick();
  assert.match(f.d.querySelector('.toast.err .tt')?.textContent ?? '', /Could not save your lead role\. It is used for this run only\./);
});

test('commit() twice before the save settles sends one PUT; after it settles the same lead sends none, another lead one', async () => {
  const { d, ui, triggers } = await reqCard();
  triggers()[0].click();
  menuItems(d)[3].click();                                                // QA
  ui.commit();
  ui.commit();
  assert.equal(puts.length, 1, 'a double click on Shape sends one PUT');
  await tick();
  ui.commit();
  await tick();
  assert.equal(puts.length, 1, 'the saved lead is not sent again');
  triggers()[0].click();
  menuItems(d)[2].click();                                                // Design
  ui.commit();
  await tick();
  assert.deepEqual(puts, [{ lead: 'qa' }, { lead: 'ux' }]);
});

test('the lead menu: ArrowUp wraps from the first item to the last and moves up; Enter and Space on a trigger are left to native activation, which opens the menu on the first item', async () => {
  const { d, triggers } = await reqCard();
  const [lead] = triggers();
  assert.equal(lead.tagName, 'BUTTON');
  assert.equal(lead.hasAttribute('aria-disabled'), false);
  for (const key of ['Enter', ' ']) assert.equal(keyOn(lead, key).defaultPrevented, false, `${JSON.stringify(key)} reaches the native button`);
  lead.click();
  const items = menuItems(d);
  assert.equal(d.activeElement, items[0]);
  keyOn(items[0], 'ArrowUp');
  assert.equal(d.activeElement, items[5], 'wraps to the last');
  keyOn(items[5], 'ArrowUp');
  assert.equal(d.activeElement, items[4]);
  lead.click();
  assert.equal(d.querySelector('.wfv-menu'), null, 'a second activation closes it');
});

test('the supporters menu: Escape after a toggle closes it and returns focus to the supporters trigger', async () => {
  const { d, triggers } = await reqCard();
  const [, supp] = triggers();
  supp.click();
  const rows = menuItems(d);
  rows[0].click();
  assert.ok(d.querySelector('.wfv-menu'));
  keyOn(rows[0], 'Escape');
  assert.equal(d.querySelector('.wfv-menu'), null);
  assert.equal(d.activeElement, supp);
});

test('shape-lead-change fires when the sentence paints and when the lead is picked', async () => {
  stubAnswerer({ lead: null });
  const d = flagDoc();
  const ui = shapeCardExtras(d, { nudge: nudge() });
  let n = 0;
  ui.el.addEventListener('shape-lead-change', () => { n += 1; });
  await tick();
  assert.equal(n, 1);
  ui.el.querySelector('.spick-b').click();
  menuItems(d)[1].click();
  assert.equal(n, 2);
});

test('small: the facts line and today\'s chips; no sentence; today\'s body', async () => {
  stubAnswerer({ lead: 'qa' });
  const d = flagDoc();
  const ui = shapeCardExtras(d, { nudge: nudge({ size: 'small', openDecisions: ['a', 'b'] }) });
  await tick();
  assert.equal(ui.requirements, false);
  assert.deepEqual(texts(ui.el, '.shape-facts'), ['Small task · ≈ $2 · ~9 min']);
  assert.ok(ui.el.querySelector('.shape-chips'));
  assert.equal(ui.el.querySelector('.spick-b'), null);
  assert.equal(ui.el.querySelector('.shape-choice'), null);
  assert.equal(ui.blocked(), false);
  assert.deepEqual(ui.body(), { workflowId: 'wf_shape', shape: { perspectives: ['product', 'architect'], size: 'small' } });
});

// Literal, captured before the direct-card change: with the flag off this card must never change, byte for byte.
const GOLDEN_DIRECT_CARD = `<div class="shape-card"><div class="shape-chips" role="group" aria-label="Perspectives"><button type="button" class="shape-chip on" data-perspective="product" title="Problem, goal, users, success criteria, out of scope." aria-pressed="true" disabled="" data-locked="1">Product</button><button type="button" class="shape-chip on" data-perspective="qa" title="Acceptance criteria as testable checks, a test plan with file names." aria-pressed="true">QA</button><button type="button" class="shape-chip on" data-perspective="security" title="Trust boundaries, inputs, secrets, permissions, abuse cases." aria-pressed="true">Security</button><button type="button" class="shape-chip-more">+ 5 more</button></div></div>`;

// A direct Shaper card (card.shape): the same card as a nudged one when the run will use the
// requirements workflow, the small rule otherwise. It has no estimates.
async function directCard(shape, { lead = 'architect', flags } = {}) {
  stubAnswerer({ lead });
  const d = flagDoc(flags);
  const ui = shapeCardExtras(d, { shape });
  d.body.appendChild(ui.el);
  await tick();
  return { d, ui };
}

test('direct card, large: the requirements layout', async () => {
  const { ui } = await directCard({ perspectives: ['qa', 'security'], size: 'large' });
  assert.equal(ui.requirements, true);
  assert.deepEqual(texts(ui.el, '.shape-facts'), ['Large task · no estimate yet']);
  assert.equal(ui.el.querySelector('.shape-lead-line').textContent, 'You lead as Engineering, supported by QA and Security.');
  assert.equal(ui.el.querySelector('.shape-chips'), null);
  assert.equal(ui.chipsEl, undefined);
});

test('direct card body: the picks, slices and size', async () => {
  const large = await directCard({ perspectives: ['qa', 'security'], slices: 'off', size: 'large' });
  assert.deepEqual(large.ui.body(), { workflowId: 'wf_shape', shape: { lead: 'architect', perspectives: ['product', 'architect', 'qa', 'security'], slices: 'off', size: 'large' } });
  const medium = await directCard({ perspectives: ['qa'], size: 'medium' });
  assert.equal(medium.ui.requirements, true);
  assert.deepEqual(medium.ui.body().shape, { lead: 'architect', perspectives: ['product', 'architect', 'qa'], size: 'medium' });
  const fit = await directCard({ perspectives: ['fit', 'qa'], size: 'large' });
  assert.ok(fit.ui.body().shape.perspectives.includes('fit'), 'a pick of fit stays in the body');
});

test('direct card, small: the facts line and chipsEl; no lead in the body', async () => {
  const { ui } = await directCard({ perspectives: ['qa'], size: 'small' }, { lead: 'qa' });
  assert.equal(ui.requirements, false);
  assert.deepEqual(texts(ui.el, '.shape-facts'), ['Small task · no estimate yet']);
  assert.ok(ui.chipsEl.matches('.shape-chips'));
  assert.equal(ui.el.querySelector('.spick-b'), null);
  assert.equal(ui.blocked(), false);
  assert.deepEqual(ui.body(), { workflowId: 'wf_shape', shape: { perspectives: ['product', 'qa'], size: 'small' } });
});

test('direct card, no size: "This task", the same as small', async () => {
  const { ui } = await directCard({ perspectives: ['qa'] }, { lead: 'qa' });
  assert.equal(ui.requirements, false);
  assert.deepEqual(texts(ui.el, '.shape-facts'), ['This task · no estimate yet']);
  assert.ok(ui.chipsEl.matches('.shape-chips'));
  assert.deepEqual(ui.body(), { workflowId: 'wf_shape', shape: { perspectives: ['product', 'qa'] } });
});

test('card and run agree for every size', async () => {
  for (const size of [undefined, 'small', 'medium', 'large']) {
    for (const perspectives of [['qa'], ['ux', 'qa']]) {
      const { ui } = await directCard({ perspectives, ...(size ? { size } : {}) });
      const res = resolveShapeRequest(ui.body());
      assert.equal(res.ok, true, res.error);
      assert.equal(SHAPE_REQ_WORKFLOW_IDS.includes(res.workflowId), ui.requirements, `${size} ${perspectives}`);
      assert.match(res.workflowId, perspectives.includes('ux') ? /^wf_shape_ux/ : /^wf_shape(_req)?$/);
    }
  }
});
