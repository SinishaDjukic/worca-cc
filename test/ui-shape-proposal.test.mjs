// test/ui-shape-proposal.test.mjs — the run card's Shape it first parts (spec §3.2): chips on a shaped card,
// the nudge (open decisions, both choices with estimates) on a nudged one.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { shapeCardExtras, shapeWhatHappens, shapeAdvancedSummary } from '../ui/public/shape/proposal.mjs';
// A namespace read, so a missing new export (sentShapeRole) fails only its own tests.
import * as PROPOSAL from '../ui/public/shape/proposal.mjs';
import { INTENT_LEADS } from '../src/shared/intent-leads.mjs';
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
  return { d, ui, triggers: () => [...ui.el.querySelectorAll('.shape-lead-pick')] };
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
    assert.equal(ui.el.querySelector('.shape-lead-pick'), null, 'the sentence paints after the profile');
    await tick();
    const [lead] = [...ui.el.querySelectorAll('.shape-lead-pick')];
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
  ui.el.querySelector('.shape-lead-pick').click();
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
  assert.equal(ui.el.querySelector('.shape-lead-pick'), null);
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
  assert.equal(ui.el.querySelector('.shape-lead-pick'), null);
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

// ── Shaper small runs B2: the Start step's body (renderCareStart) ──
import { renderCareStart } from '../ui/public/shape/proposal.mjs';
import { questionFocusTarget } from '../ui/public/shape/step-card.mjs';
import { careGivesUp, careGivesUpSentence, careFactsOf, worcaCarePick } from '../src/shared/shape/feature-record.mjs';
import { careEstimates } from '../src/core/shape/estimate.mjs';
import { RUN_REQUIREMENTS_MAX } from '../src/shared/shape/slices.mjs';
// A namespace read, so a missing new export (careRunCount) fails only its own tests.
import * as SLICES from '../src/shared/shape/slices.mjs';

const careEst = (costUsd) => ({ costUsd, minutes: 10, perRun: costUsd });
const CARE_PQ = (over = {}) => ({ id: 'care-1', kind: 'care', care: {
  size: 'large', facts: { touches: ['payments'], requirements: 16, subsystems: [], screens: false, size: 'large' },
  pick: { position: 'thorough', reason: 'Worca picks Thorough: it touches payments' },
  positions: { lean: { description: 'Lean does', estimate: careEst(18) }, balanced: { description: 'Balanced does', estimate: careEst(18) }, thorough: { description: 'Thorough does', estimate: careEst(24) } },
  estimateCap: 'Lean and Balanced differ in fix cycles and models, which recorded step costs do not show yet',
  history: { lean: { enough: true, features: 6, line: 'Lean · 2.1 changes after ship per feature · ≈ $36 each · 6 features' },
    balanced: { enough: false, features: 1, line: 'Balanced: not enough history yet' }, thorough: { enough: false, features: 0, line: 'Thorough: not enough history yet' } },
  names: { everyday: 'Sonnet', strong: 'Opus', second: 'GPT' }, modelsLine: null, ...over } });
/** The body inside a `.qpanel` in a fresh document, as the run card hosts it. */
function careBody(pq = CARE_PQ(), deps = {}, { flags } = {}) {
  const d = flagDoc(flags);
  const panel = d.createElement('div'); panel.className = 'qpanel';
  d.body.appendChild(panel);
  const posted = [];
  const r = renderCareStart(d, pq, { title: 'Your turn: how much care?', chip: 'Start', submit: (p) => { posted.push(p); return true; }, ...deps });
  r.render(panel);
  return { d, panel, r, posted, row: (k) => panel.querySelector(`.rd-kv-row[data-fact="${k}"]`) };
}
const seg = (panel) => [...panel.querySelector('.care-start > .rd-kv .seg').children];
const click = (b) => b.dispatchEvent(new b.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const settle = () => new Promise((r) => setTimeout(r, 0));

test('B2 renderCareStart: one .seg with 3 buttons, the pick pressed with data-preset, under the chip Start', () => {
  const { panel, row } = careBody();
  assert.equal(panel.querySelectorAll('.seg').length, 1);
  const bs = seg(panel);
  assert.deepEqual(bs.map((b) => b.textContent), ['Lean', 'Balanced', 'Thorough']);
  assert.deepEqual(bs.map((b) => b.getAttribute('aria-pressed')), ['false', 'false', 'true']);
  assert.equal(bs[2].dataset.preset, '1');
  assert.equal(panel.querySelector('.ask-mcard-kind').textContent, 'Start');
  const segEl = panel.querySelector('.seg');
  assert.equal(segEl.getAttribute('aria-labelledby'), row('care').querySelector('.rd-kv-k').id);
  assert.equal(row('care').querySelector('.rd-kv-k').textContent, 'Care');
  assert.equal(row('size').querySelector('.rd-kv-v').textContent, 'Large · about 16 requirements');
  assert.equal(row('care').querySelector('.cap').textContent, 'Worca picks Thorough: it touches payments');
  assert.equal(row('gives').hidden, true, 'at the pick: no Gives up row');
  assert.equal(row('models').hidden, true, 'no modelsLine: no Models row');
  assert.equal(row('does').querySelector('.rd-kv-v').textContent, 'Thorough does');
});

test('B2 renderCareStart: below the pick one Gives up sentence with "Recorded as your choice", the rest in a closed "All N differences" fold; back at the pick none', () => {
  const { panel, row } = careBody();
  const bs = seg(panel);
  click(bs[0]);
  const line = row('gives').querySelector('.care-gives');
  assert.equal(line.firstChild.textContent, careGivesUpSentence('lean', 'thorough'));
  assert.equal(line.querySelector('.cap').textContent.trim(), 'Recorded as your choice', 'the cap sits on the same line');
  assert.equal(row('gives').querySelectorAll('.cap').length, 1);
  const b = row('gives').querySelector('.plan-fold');
  assert.equal(b.querySelector('.plan-fold-text').textContent, 'All 8 differences');
  assert.equal(b.getAttribute('aria-expanded'), 'false');
  const rows = row('gives').querySelector('.plan-checks');
  assert.equal(rows.hidden, true, 'the fold is closed by default');
  click(b);
  assert.equal(rows.hidden, false);
  assert.deepEqual([...rows.children].map((x) => x.textContent), careGivesUp('lean', 'thorough', { everyday: 'Sonnet', strong: 'Opus', second: 'GPT' }));
  click(bs[1]);
  assert.equal(row('gives').querySelector('.plan-fold-text').textContent, 'All 7 differences');
  assert.equal(row('gives').querySelector('.plan-checks').hidden, false, 'the fold stays as the person left it');
  click(bs[0]);
  assert.equal(bs[2].dataset.preset, undefined, 'data-preset removed below the pick');
  assert.equal(row('does').querySelector('.rd-kv-v').textContent, 'Lean does');
  assert.equal(panel.querySelector('.care-fold .plan-fold-text').textContent, 'What Lean does');
  assert.equal(row('estimate').querySelector('b').textContent, 'Lean ≈ $18');
  click(bs[2]);
  assert.equal(row('gives').hidden, true);
  assert.equal(bs[2].dataset.preset, '1');
});

test('B2 renderCareStart: the fold lists the 8 table rows and ends with the "In every position" cap', () => {
  const { panel } = careBody();
  const b = panel.querySelector('.care-fold');
  assert.equal(b.getAttribute('aria-expanded'), 'false');
  click(b);
  assert.equal(b.getAttribute('aria-expanded'), 'true');
  const body = panel.querySelector('.care-fold-body');
  assert.equal(body.querySelectorAll('.rd-kv-row:not([hidden])').length, 8);
  assert.match(body.lastElementChild.textContent, /^In every position: every requirement is owned by one run or confirmed by a person/);
  assert.equal(body.lastElementChild.className, 'cap');
});

test('B2 renderCareStart: estimates, the cap, History; null and thin cells read "not enough history yet", all-null rows collapse', () => {
  const { row } = careBody();
  const e = row('estimate').querySelector('.rd-kv-v').textContent;
  assert.match(e, /^Lean ≈ \$18 · Balanced ≈ \$18 · Thorough ≈ \$24/);
  assert.match(e, /the whole build, from recorded step costs/);
  assert.match(e, /Lean and Balanced differ/);
  const h = [...row('history').querySelectorAll('.rd-kv-v > div > div')].map((x) => x.textContent);
  assert.deepEqual(h, ['Lean · 2.1 changes after ship per feature · ≈ $36 each · 6 features', 'Balanced: not enough history yet', 'Thorough: not enough history yet']);
  const thin = careBody(CARE_PQ({ size: null, positions: { lean: { description: 'l', estimate: null }, balanced: { description: 'b', estimate: careEst(3) }, thorough: { description: 't', estimate: null } },
    estimateCap: null, history: {} }));
  assert.equal(thin.row('size').querySelector('.rd-kv-v').textContent, 'Size not known yet');
  assert.match(thin.row('estimate').textContent, /Lean: not enough history yet · Balanced ≈ \$3\.00 · Thorough: not enough history yet/);
  assert.match(thin.row('estimate').textContent, /one run, from recorded step costs/);
  assert.equal(thin.row('history').querySelector('.rd-kv-v').textContent, 'Quality figures per position: not enough history yet');
  const none = careBody(CARE_PQ({ positions: { lean: { description: 'l', estimate: null }, balanced: { description: 'b', estimate: null }, thorough: { description: 't', estimate: null } } }));
  assert.equal(none.row('estimate').querySelector('.rd-kv-v').textContent, 'not enough history yet');
});

test('B2 renderCareStart: the models line shows only with modelsLine', () => {
  const { row } = careBody(CARE_PQ({ modelsLine: "Models: your project's picks are kept for 3 agents" }));
  assert.equal(row('models').hidden, false);
  assert.equal(row('models').querySelector('.rd-kv-v').textContent, "your project's picks are kept for 3 agents");
});

test('B2 renderCareStart: exactly one btn-primary "Start requirements" in .plan-actions; questionFocusTarget returns it; it posts the position', async () => {
  const { d, panel, posted } = careBody();
  const prim = panel.querySelectorAll('.btn-primary');
  assert.equal(prim.length, 1);
  assert.equal(prim[0].textContent, 'Start requirements');
  assert.ok(prim[0].closest('.plan-actions'));
  assert.equal(questionFocusTarget(d.body), prim[0]);
  click(seg(panel)[1]);
  click(prim[0]);
  await settle();
  assert.deepEqual(posted, [{ care: { position: 'balanced' } }]);
});

test('B2 renderCareStart: a 422 shows in .plan-err role=alert, keeps the selection, and returns focus to the button', async () => {
  let r = null;
  const deps = { submit: () => { r.setErrors([{ field: 'care', message: 'Care must be Lean, Balanced or Thorough.' }]); return false; } };
  const body = careBody(CARE_PQ(), deps);
  r = body.r;
  const { d, panel } = body;
  // Chromium blurs a focused button when it is disabled (focus-after-disable): blur first, then set.
  const proto = d.defaultView.HTMLButtonElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'disabled');
  Object.defineProperty(proto, 'disabled', { configurable: true, get: desc.get, set(v) { if (v) this.blur(); desc.set.call(this, v); } });
  click(seg(panel)[0]);
  const go = panel.querySelector('.btn-primary');
  go.focus();
  click(go);
  assert.equal(go.disabled, true, 'sending: the button is disabled');
  await settle(); await settle();
  const err = panel.querySelector('.plan-err');
  assert.equal(err.getAttribute('role'), 'alert');
  assert.equal(err.hidden, false);
  assert.equal(err.textContent, 'Care must be Lean, Balanced or Thorough.');
  assert.ok(err.closest('.rd-kv-row[data-fact="care"]'), 'under the dial');
  assert.equal(seg(panel)[0].getAttribute('aria-pressed'), 'true', 'the selection is kept');
  assert.equal(go.disabled, false);
  assert.equal(d.activeElement, go);
  assert.deepEqual(r.collect(), { care: { position: 'lean' } });
});

// Small runs B3 (D21, D22): the flag adds Compliance to the chips and the lead menu; the lead is asked once, then kept.
test('small runs flag: off, the chips and the lead menu list 0 Compliance; on, 1 each', async () => {
  for (const [flags, n] of [['', 0], ['shaperSmallRuns', 1]]) {
    stubAnswerer({ lead: 'architect' });
    _resetAnswerer();
    const d = flagDoc(flags);
    const small = shapeCardExtras(d, { nudge: nudge({ size: 'small', perspectives: ['architect'] }) });
    d.body.appendChild(small.el);
    const more = small.el.querySelector('.shape-chip-more');
    if (more) more.click();
    assert.equal([...small.el.querySelectorAll('.shape-chip')].filter((c) => c.dataset.perspective === 'compliance').length, n, `chips, flags "${flags}"`);
    const { d: d2, triggers } = await reqCard({}, { flags });
    triggers()[0].click();
    assert.equal(menuItems(d2).filter((i) => i.querySelector('.wfv-menu-l').textContent === 'Compliance').length, n, `lead menu, flags "${flags}"`);
  }
});

test('small runs flag: a first pick is saved once (1 PUT); the next card shows the saved lead, sends nothing and never blocks', async () => {
  const first = await reqCard({}, { lead: null, flags: 'shaperSmallRuns' });
  const [lead] = first.triggers();
  assert.equal(lead.textContent, 'pick a role');
  assert.equal(first.ui.blocked(), false, 'under the flag a missing role never blocks');
  lead.click();
  menuItems(first.d).find((i) => i.querySelector('.wfv-menu-l').textContent === 'Compliance').click();
  assert.equal(first.ui.blocked(), false);
  first.ui.commit();
  await tick();
  assert.deepEqual(puts, [{ lead: 'compliance' }]);
  const next = await reqCard({}, { lead: 'compliance', flags: 'shaperSmallRuns' });
  assert.equal(next.triggers()[0].textContent, 'Compliance');
  assert.equal(next.ui.blocked(), false);
  next.ui.commit();
  await tick();
  assert.deepEqual(puts, [], 'the next card sends 0 PUTs');
  assert.equal(next.ui.body().shape.lead, 'compliance', 'the body sends the lead the card shows');
});

// ── Shaper ask screens, slice 2: the card reads the sent role (flag shaperSmallRuns) ──
const SHAPE_LEAD = INTENT_LEADS.shape;
const sentText = (role, body = 'Add export') => (role ? `${SHAPE_LEAD}\n\nAsking as: ${role}.\n\n${body}` : `${SHAPE_LEAD}\n\n${body}`);
const userRow = (text, blocks = []) => ({ role: 'user', text, blocks });
const answerRow = (blocks = [], text = 'ok') => ({ role: 'assistant', text, blocks });
const cardBlock = (id) => ({ kind: 'card', id, state: 'proposed' });
const noticeRow = (over = {}) => ({ role: 'user', text: '[worca event] the person acted on a card',
  blocks: [{ kind: 'notice', synthetic: true, text: 'Done', ...over }] });
const sentRoleOf = (rows, id) => {
  assert.equal(typeof PROPOSAL.sentShapeRole, 'function', 'proposal.mjs exports sentShapeRole');
  return PROPOSAL.sentShapeRole(rows, id);
};

test('R-arch-13 sentShapeRole: the role of the user message the card answers', () => {
  const rows = [userRow(sentText('compliance')), answerRow([cardBlock('card_1')])];
  assert.equal(sentRoleOf(rows, 'card_1'), 'compliance');
  assert.equal(sentRoleOf([userRow(`${SHAPE_LEAD}\n\nAsking as: qa.`), answerRow([cardBlock('card_1')])], 'card_1'), 'qa', 'the lead and the role line alone');
  assert.equal(sentRoleOf([userRow(sentText('architect')), answerRow([], 'thinking'), answerRow([cardBlock('card_1')])], 'card_1'), 'architect',
    'the nearest earlier user row, past an assistant row');
});

test('R-arch-13 sentShapeRole: null with no role line, an ordinary message, a missing card or no user row', () => {
  const answered = (text) => [userRow(text), answerRow([cardBlock('card_1')])];
  assert.equal(sentRoleOf(answered(sentText(null)), 'card_1'), null, 'no role paragraph');
  assert.equal(sentRoleOf(answered('Asking as: compliance.\n\nAdd export'), 'card_1'), null, 'not a Shaper message');
  assert.equal(sentRoleOf(answered('Add export'), 'card_1'), null, 'an ordinary message');
  assert.equal(sentRoleOf(answered(sentText('admin')), 'card_1'), null, 'not a lead key');
  assert.equal(sentRoleOf(answered(sentText('compliance')), 'card_9'), null, 'a block id that is not there');
  assert.equal(sentRoleOf([answerRow([cardBlock('card_1')]), userRow(sentText('compliance'))], 'card_1'), null, 'only a LATER user row');
  assert.equal(sentRoleOf([], 'card_1'), null);
});

test('R-arch-13 sentShapeRole: a synthetic notice row is skipped; a card in a later turn reads its own turn\'s message', () => {
  for (const notice of [noticeRow(), noticeRow({ quiet: true })]) {
    const rows = [userRow(sentText('compliance')), answerRow(), notice, answerRow([cardBlock('card_1')])];
    assert.equal(sentRoleOf(rows, 'card_1'), 'compliance');
  }
  const later = [userRow(sentText('compliance')), answerRow([cardBlock('card_1')]), userRow('and a second one'), answerRow([cardBlock('card_2')])];
  assert.equal(sentRoleOf(later, 'card_2'), null, 'the later message carries no role');
  assert.equal(sentRoleOf(later, 'card_1'), 'compliance');
  const turns = [userRow(sentText('compliance')), answerRow([cardBlock('card_1')]), userRow(sentText('qa')), answerRow([cardBlock('card_2')])];
  assert.equal(sentRoleOf(turns, 'card_2'), 'qa');
});

/** A card under the flag, built with `sentRole` through its own fetch. `calls` records that fetch AND the page's. */
function flagCard({ sentRole = null, lead = null, card = null, flags = 'shaperSmallRuns' } = {}) {
  _resetAnswerer();
  stubAnswerer({ lead });
  const stub = globalThis.fetch;
  const calls = [];
  const spy = (url, init = {}) => { calls.push(`${init.method || 'GET'} ${url}`); return stub(url, init); };
  globalThis.fetch = spy;
  const d = flagDoc(flags);
  const ui = shapeCardExtras(d, card || { nudge: nudge({ perspectives: ['architect', 'qa', 'security'] }) }, { fetch: spy, sentRole });
  d.body.appendChild(ui.el);
  return { d, ui, calls };
}
const factRows = (ui) => [...ui.el.querySelectorAll('.rd-kv-row')];
const factKey = (r) => r.querySelector('.rd-kv-k').textContent;
const factValue = (r) => r.querySelector('.rd-kv-v');
const menuLabel = (i) => (i.querySelector('.wfv-menu-l') || i.querySelector('b')).textContent;
const sorted = (a) => [...a].sort();

test('R-qa-7: a message sent as Compliance renders "Compliance" as the first fact, no role sentence, and "Supported by" is the only control', async () => {
  const { ui, calls } = flagCard({ sentRole: 'compliance' });
  await tick();
  assert.equal(ui.requirements, true);
  assert.deepEqual(texts(ui.el, '.shape-facts'), ['Large task · ≈ $2 · ~9 min'], 'the facts line stays');
  assert.equal(ui.el.querySelectorAll('.shape-lead-line').length, 0);
  assert.doesNotMatch(ui.el.textContent, /You lead as|pick a role/);
  assert.ok(ui.el.querySelector('dl.rd-kv.shape-lead-facts'), 'the app\'s fact rows');
  const rows = factRows(ui);
  assert.deepEqual(rows.map(factKey), ['Your role', 'Supported by']);
  assert.deepEqual(rows.map((r) => r.hidden), [false, false]);
  assert.equal(factValue(rows[0]).textContent, 'Compliance');
  assert.equal(factValue(rows[0]).querySelector('button'), null, 'the sent role is plain text');
  assert.ok(rows[0].querySelector('.rd-kv-v[title="Sent with your message"], .rd-kv-v [title="Sent with your message"]'));
  const pickers = [...ui.el.querySelectorAll('.shape-lead-pick')];
  assert.equal(pickers.length, 1, 'one control');
  assert.equal(pickers[0].dataset.menu, 'shape-supporters');
  assert.ok(rows[1].contains(pickers[0]));
  assert.equal(pickers[0].textContent, 'Engineering, QA and Security');
  assert.equal(rows[0].querySelector('.rd-kv-k').id, ui.labelId);
  assert.ok(ui.labelId);
  assert.equal(ui.blocked(), false);
  assert.deepEqual(calls, [], 'R-arch-9: a card with a sent role reads no profile');
});

test('R-qa-8: the sent role leads the run even with the profile cleared; no /api/answerer read at all and nothing written back', async () => {
  const { ui, calls } = flagCard({ sentRole: 'compliance', lead: null });
  assert.equal(ui.blocked(), false, 'at once');
  assert.equal(ui.body().shape.lead, 'compliance', 'at once: nothing is awaited');
  await tick();
  const body = ui.body();
  assert.equal(body.workflowId, 'wf_shape');
  assert.equal(body.shape.lead, 'compliance');
  assert.equal(body.shape.size, 'large');
  assert.deepEqual(sorted(body.shape.perspectives), sorted(['product', 'compliance', 'architect', 'qa', 'security']));
  const res = resolveShapeRequest(body, { smallRuns: true });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.shape.lead, 'compliance');
  ui.commit();
  await tick();
  assert.deepEqual(calls, [], 'a sent role is never read or written back');
  assert.deepEqual(puts, []);
});

test('R-arch-5: the sent role wins over the profile for the card\'s whole life, on a direct card too', async () => {
  const { ui, calls } = flagCard({ sentRole: 'compliance', lead: 'qa', card: { shape: { perspectives: ['qa'], size: 'medium' } } });
  await tick();
  assert.equal(factValue(factRows(ui)[0]).textContent, 'Compliance');
  assert.equal(ui.body().shape.lead, 'compliance');
  assert.deepEqual(sorted(ui.body().shape.perspectives), sorted(['product', 'compliance', 'qa']));
  assert.deepEqual(calls, []);
});

test('under the flag the sent role is never offered as a supporter, and is listed once in the body', async () => {
  for (const [role, label, perspectives] of [['compliance', 'Compliance', ['compliance', 'qa']], ['architect', 'Engineering', ['architect', 'qa']]]) {
    const { d, ui } = flagCard({ sentRole: role, card: { nudge: nudge({ perspectives }) } });
    await tick();
    const supp = ui.el.querySelector('.shape-lead-pick[data-menu="shape-supporters"]');
    assert.ok(supp, 'the supporters picker');
    assert.equal(supp.textContent, 'QA', `${label} is not named as its own supporter`);
    supp.click();
    const names = menuItems(d).map(menuLabel);
    assert.ok(names.includes('QA'));
    assert.equal(names.includes(label), false, `${label} is not offered`);
    assert.deepEqual(sorted(ui.body().shape.perspectives), sorted(['product', role, 'qa']));
    menuItems(d).find((i) => menuLabel(i) === 'QA').click();
    assert.equal(supp.textContent, 'no one else');
    assert.deepEqual(sorted(ui.body().shape.perspectives), sorted(['product', role]));
  }
});

test('R-qa-9: no role sent, no saved lead: the picker is the first fact row, nothing blocks and the body names no lead', async () => {
  const { ui, calls } = flagCard({ lead: null });
  assert.equal(ui.blocked(), false, 'enabled before the profile lands');
  const early = factRows(ui);
  assert.deepEqual(early.map(factKey), ['Your role', 'Supported by'], 'the rows paint at once');
  assert.equal(factValue(early[0]).querySelector('.shape-lead-pick')?.textContent, 'pick a role');
  await tick();
  const rows = factRows(ui);
  assert.deepEqual(rows.map((r) => r.hidden), [false, false]);
  const lead = factValue(rows[0]).querySelector('.shape-lead-pick');
  assert.equal(lead.dataset.menu, 'shape-lead');
  assert.equal(lead.textContent, 'pick a role');
  assert.ok(factValue(rows[1]).querySelector('.shape-lead-pick[data-menu="shape-supporters"]'));
  assert.equal(ui.el.querySelectorAll('.shape-lead-line').length, 0);
  assert.equal(ui.el.querySelectorAll('.shape-lead-pick').length, 2);
  assert.equal(ui.blocked(), false);
  assert.equal('lead' in ui.body().shape, false);
  assert.deepEqual(sorted(ui.body().shape.perspectives), sorted(['product', 'architect', 'qa', 'security']));
  ui.commit();
  await tick();
  assert.deepEqual(puts, [], 'no pick: nothing saved');
  assert.deepEqual(calls, ['GET /api/answerer'], 'R-arch-9: read once, at build');
});

test('no role sent: the saved lead presets the picker ("you, last time") and the body sends the lead the card shows', async () => {
  const { d, ui, calls } = flagCard({ lead: 'architect' });
  await tick();
  const lead = factValue(factRows(ui)[0]).querySelector('.shape-lead-pick');
  assert.equal(lead.textContent, 'Engineering');
  _resetAnswerer(); stubAnswerer({ lead: null });
  assert.equal(ui.body().shape.lead, 'architect', 'the profile cleared after the build: the run still leads as the shown role');
  assert.deepEqual(sorted(ui.body().shape.perspectives), sorted(['product', 'architect', 'qa', 'security']), 'the shown lead is listed once, not as a supporter');
  ui.commit();
  await tick();
  assert.deepEqual(puts, []);
  const supp = ui.el.querySelector('.shape-lead-pick[data-menu="shape-supporters"]');
  assert.equal(supp.textContent, 'QA and Security', 'the shown lead is not its own supporter');
  supp.click();
  assert.equal(menuItems(d).map(menuLabel).includes('Engineering'), false);
  supp.click();
  lead.click();
  const hinted = menuItems(d).filter((i) => i.querySelector('.wfv-menu-hint'));
  assert.deepEqual(hinted.map((i) => [menuLabel(i), i.querySelector('.wfv-menu-hint').textContent]), [['Engineering', 'you, last time']]);
  assert.deepEqual(calls, ['GET /api/answerer']);
});

test('no role sent: a QA pick on the card leads the body, is saved by commit() with 1 PUT, and repaints the gate', async () => {
  const { d, ui, calls } = flagCard({ lead: 'architect' });
  let changes = 0;
  ui.el.addEventListener('shape-lead-change', () => { changes += 1; });
  await tick();
  const before = changes;
  const lead = factValue(factRows(ui)[0]).querySelector('.shape-lead-pick');
  lead.click();
  menuItems(d).find((i) => menuLabel(i) === 'QA').click();
  assert.equal(changes, before + 1, 'shape-lead-change on a pick');
  assert.equal(lead.textContent, 'QA');
  assert.equal(ui.blocked(), false);
  assert.equal(ui.body().shape.lead, 'qa');
  assert.deepEqual(sorted(ui.body().shape.perspectives), sorted(['product', 'qa', 'architect', 'security']));
  assert.deepEqual(puts, [], 'a pick alone does not save');
  ui.commit();
  await tick();
  assert.deepEqual(puts, [{ lead: 'qa' }]);
  assert.deepEqual(calls, ['GET /api/answerer', 'PUT /api/answerer'], 'R-arch-8: commit reads nothing');
});

test('R-arch-1: flag off, a sent role is ignored: the sentence, the block and the body are today\'s', async () => {
  const { ui } = flagCard({ sentRole: 'compliance', lead: null, flags: '' });
  assert.equal(ui.blocked(), true);
  await tick();
  assert.equal(ui.el.querySelector('.shape-lead-facts'), null);
  assert.equal(ui.el.querySelector('.shape-lead-line').textContent, 'You lead as pick a role, supported by Engineering, QA and Security.');
  assert.equal(ui.blocked(), true);
  const saved = flagCard({ sentRole: 'compliance', lead: 'architect', flags: '' });
  await tick();
  assert.equal(saved.ui.body().shape.lead, 'architect');
  assert.deepEqual(saved.calls, ['GET /api/answerer']);
});

test('flag on, a small card: a sent role changes nothing (chips, no picker, no lead)', async () => {
  const { ui } = flagCard({ sentRole: 'compliance', card: { nudge: nudge({ size: 'small', perspectives: ['architect'] }) } });
  await tick();
  assert.equal(ui.requirements, false);
  assert.ok(ui.el.querySelector('.shape-chips'));
  assert.equal(ui.el.querySelector('.shape-lead-pick'), null);
  assert.equal(ui.el.querySelector('.rd-kv'), null);
  assert.equal(ui.blocked(), false);
  assert.equal('lead' in ui.body().shape, false);
});

// ── Ask screens slice 9 (R-po-5, R-ux-6): under shaperSmallRuns the Start card's Size row adds the number of runs at
// Worca's pick, the one place the screens show that number; the pick reason then leaves the requirement count to it.
const FLAG = { flags: 'shaperSmallRuns' };
/** The Start ask for `requirements` at Worca's pick `position`. */
const pickPQ = (position, requirements, { size = 'large', reason = `Worca picks ${position}`, subsystems = [] } = {}) => CARE_PQ({
  size, facts: { touches: [], requirements, subsystems, screens: false, size }, pick: { position, reason } });
/** The Start ask as the real facts and the real pick build it for a prompt of a Shaper size. */
const realPQ = (prompt, size) => {
  const facts = careFactsOf({ prompt, size });
  return CARE_PQ({ size: facts.size, facts, pick: worcaCarePick(facts) });
};
const sizeText = (body) => body.row('size').querySelector('.rd-kv-v').textContent;
const reasonText = (body) => body.row('care').querySelector('.cap').textContent;
/** The runs careEstimates multiplies by at a position: with a per-run figure of 1 minute, the minutes are the runs. */
const estimateRuns = (requirements, position) => careEstimates({ requirements, perRun: { costUsd: 1, minutes: 1 } })[position].minutes;

test('slice 9 renderCareStart: flag on, the Size row adds the run count at Worca\'s pick', () => {
  for (const [position, requirements, size, want, runs] of [
    ['thorough', 16, 'large', 'Large · about 16 requirements · about 8 runs', 8],
    ['thorough', 20, 'large', 'Large · about 20 requirements · about 10 runs', 10],
    ['balanced', 16, 'large', 'Large · about 16 requirements · about 6 runs', 6],
    ['thorough', 3, 'small', 'Small · about 3 requirements · about 2 runs', 2],
  ]) {
    const pq = pickPQ(position, requirements, { size });
    const sent = structuredClone(pq);
    const calls = [];
    globalThis.fetch = async (url) => { calls.push(url); throw new Error(`unexpected ${url}`); };
    const body = careBody(pq, {}, FLAG);
    assert.equal(sizeText(body), want, `${requirements} at ${position}`);
    assert.equal(runs, Math.ceil(requirements / RUN_REQUIREMENTS_MAX[position]), 'ceil over the per-run cap');
    assert.equal(runs, estimateRuns(requirements, position), 'the number careEstimates computes at the pick');
    assert.equal(SLICES.careRunCount(requirements, position), runs, 'the one shared formula');
    assert.deepEqual(calls, [], 'the card asks for nothing');
    assert.deepEqual(pq, sent, 'the ask body is not changed');
  }
});

test('slice 9 R-po-5 example: a Large Start card reads its 16 requirements and the runs of Worca\'s own pick', () => {
  for (const [prompt, position, want] of [
    ['Add card payments to checkout', 'thorough', 'Large · about 16 requirements · about 8 runs'],
    ['Export the list as a file', 'balanced', 'Large · about 16 requirements · about 6 runs'],
  ]) {
    const pq = realPQ(prompt, 'large');
    assert.equal(pq.care.pick.position, position, 'fixture: Worca\'s pick');
    const body = careBody(pq, {}, FLAG);
    assert.equal(sizeText(body), want, position);
    assert.ok(want.endsWith(`about ${estimateRuns(pq.care.facts.requirements, position)} runs`), 'as careEstimates counts');
  }
});

test('slice 9 renderCareStart: one run reads "· one run"; no size or no count adds nothing', () => {
  for (const position of ['lean', 'balanced']) {
    const body = careBody(pickPQ(position, 3, { size: 'small' }), {}, FLAG);
    assert.equal(sizeText(body), 'Small · about 3 requirements · one run', position);
  }
  const unknown = careBody(CARE_PQ({ size: null }), {}, FLAG);
  assert.equal(sizeText(unknown), 'Size not known yet');
  for (const requirements of [undefined, null, 0]) {
    const body = careBody(pickPQ('balanced', requirements), {}, FLAG);
    assert.doesNotMatch(sizeText(body), /\bruns?\b/, `no count (${requirements}): no runs part`);
  }
});

test('slice 9 renderCareStart: the reason drops the requirement count, so it shows once', () => {
  for (const [facts, original, flagOnReason] of [
    [{ requirements: 16, subsystems: [] },
      'Worca picks Balanced: it touches nothing sensitive, about 16 requirements',
      'Worca picks Balanced: it touches nothing sensitive'],
    [{ requirements: 3, subsystems: ['server'] },
      'Worca picks Lean: about 3 requirements in one part (the server), no screen',
      'Worca picks Lean: in one part (the server), no screen'],
    [{ requirements: 3, subsystems: [] },
      'Worca picks Lean: about 3 requirements, nothing sensitive, no screen',
      'Worca picks Lean: nothing sensitive, no screen'],
  ]) {
    const size = facts.requirements === 16 ? 'large' : 'small';
    const pick = worcaCarePick({ touches: [], screens: false, size, ...facts });
    assert.equal(pick.reason, original, 'fixture: the reason Worca really writes');
    const pq = CARE_PQ({ size, facts: { touches: [], screens: false, size, ...facts }, pick });
    const on = careBody(pq, {}, FLAG);
    assert.equal(reasonText(on), flagOnReason);
    const count = new RegExp(`about ${facts.requirements} requirements`, 'g');
    assert.equal((on.panel.textContent.match(count) || []).length, 1, `${original}: "about N requirements" shows once`);
    assert.equal(pq.care.pick.reason, original, 'the recorded reason is not changed');
    assert.equal(reasonText(careBody(pq)), original, 'flag off: the reason as today');
  }
});

test('slice 9 renderCareStart: the run count stays at Worca\'s pick and shows once', () => {
  const body = careBody(CARE_PQ(), {}, FLAG);
  const want = 'Large · about 16 requirements · about 8 runs';
  // Value by value: joined as one string, the next row's label would swallow the word boundary after "runs".
  const factCounts = () => [...body.panel.querySelectorAll('.care-start > .rd-kv .rd-kv-v')]
    .flatMap((v) => v.textContent.match(/about \d+ runs\b|· one run\b/g) || []);
  assert.equal(sizeText(body), want);
  assert.deepEqual(factCounts(), ['about 8 runs']);
  for (const [i, name] of [[0, 'Lean'], [1, 'Balanced'], [2, 'Thorough']]) {
    click(seg(body.panel)[i]);
    assert.equal(seg(body.panel)[i].getAttribute('aria-pressed'), 'true', `${name} selected`);
    assert.equal(sizeText(body), want, `${name} selected: the Size row is unchanged`);
    assert.deepEqual(factCounts(), ['about 8 runs'], `${name} selected: one run count`);
  }
});

test('slice 9 renderCareStart: flag off, the Size row is today\'s and names no run', () => {
  for (const [position, requirements, size, want] of [
    ['thorough', 16, 'large', 'Large · about 16 requirements'],
    ['balanced', 3, 'small', 'Small · about 3 requirements'],
    ['lean', 3, 'small', 'Small · about 3 requirements'],
    ['balanced', null, null, 'Size not known yet'],
  ]) {
    const body = careBody(pickPQ(position, requirements, { size }));
    assert.equal(sizeText(body), want, `${position} ${size}`);
    assert.doesNotMatch(sizeText(body), /\bruns?\b/);
  }
});
