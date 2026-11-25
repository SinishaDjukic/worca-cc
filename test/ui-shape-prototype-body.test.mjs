// test/ui-shape-prototype-body.test.mjs — Shaper small runs C1 (ui/public/shape/prototype-body.mjs): the Prototype step's
// moments on the one card: head, primary and foot ⋯ per Care, the live line, the remark field, the proposed change
// (the id, text and example once each), the working moment and the failed question with Worca's pick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderPrototypeBody, prototypeDetail, NO_MATCH, NO_MATCH_PLAIN, REMARK_PLACEHOLDER, REMARK_PLACEHOLDER_SHORT } from '../ui/public/shape/prototype-body.mjs';
import { prototypeTitle } from '../ui/public/shape/step-card.mjs';
import { prototypeView } from '../src/shared/shape/prototype.mjs';

const dom = new JSDOM('<!doctype html><body></body>');
const doc = dom.window.document;
const flush = () => new Promise((r) => setTimeout(r, 0));
const REQS = [{ id: 'R-ux-1', text: 'The template editor shows a preview' }, { id: 'R-ux-2', text: 'The preview shows light mode' }];
const SCREENS = [{ section: 'editor', name: 'Template editor', ids: ['R-ux-1'], pieces: [{ tag: 'h1', text: 'Editor' }] }];
const OFFER = { build: { primary: 'build', menu: 'skip', review: false }, lean: { primary: 'skip', menu: 'build', review: false } };
const pq = (prototype) => ({ id: 'proto-1', kind: 'prototype', prototype });

function setup(prototype, { register, submit, readOnly } = {}) {
  const panel = doc.createElement('div');
  panel.className = 'qpanel';
  doc.body.replaceChildren(panel);
  const calls = { submit: [] };
  const deps = { doc, register, readOnly, title: prototypeTitle(prototype), chip: 'Prototype', confirm: async () => true,
    submit: async (p) => { calls.submit.push(p); return submit ? submit(p) : true; } };
  const body = renderPrototypeBody(panel, pq(prototype), deps);
  return { panel, calls, body, $: (s) => panel.querySelector(s), $$: (s) => [...panel.querySelectorAll(s)] };
}
function menu($) {
  const more = $('.plan-more');
  if (!more) return null;
  more.click();
  const items = [...doc.querySelectorAll('.wfv-menu .wfv-menu-item')];
  const labels = items.map((b) => b.textContent);
  more.click();   // closes it again
  return labels;
}
const primaries = ($$) => $$('.btn-primary').map((b) => b.textContent);
const count = (text, needle) => text.split(needle).length - 1;

test('each moment: head, at most one primary, the foot ⋯ per Care, the actor only in the head', () => {
  const offered = (offer) => setup({ moment: 'offered', offer, requirements: REQS, screenIds: ['R-ux-1', 'R-ux-2'] });
  const b = offered(OFFER.build);
  assert.equal(b.$('.ask-mcard-title').textContent, 'Prototype the screens first?');
  assert.deepEqual(primaries(b.$$), ['Build prototype']);
  assert.deepEqual(menu(b.$), ['Skip the prototype', 'Stop']);
  assert.deepEqual(b.$$('.srows .plan-check-id').map((n) => n.textContent), ['R-ux-1', 'R-ux-2']);
  const l = offered(OFFER.lean);
  assert.deepEqual(primaries(l.$$), ['Skip the prototype']);
  assert.deepEqual(menu(l.$), ['Build prototype', 'Stop']);
  const plain = setup({ moment: 'offered', offer: OFFER.build, requirements: REQS }, { register: 'plain' });
  assert.deepEqual(plain.$$('.plan-check-id').map((n) => n.textContent), ['', ''], 'plain wording names no id');
  const built = setup({ moment: 'built', offer: OFFER.build, screens: SCREENS, costUsd: 2.8, designId: 'd_1', findings: [] });
  assert.equal(built.$('.ask-mcard-title').textContent, 'Your turn: look, remark, confirm');
  assert.deepEqual(primaries(built.$$), ['Confirm prototype']);
  assert.deepEqual(menu(built.$), ['Stop']);
  assert.equal(built.$('.proto-open').getAttribute('href'), '#design/d_1');
  assert.deepEqual([...built.$('.proto-open').classList], ['btn', 'btn-sm', 'btn-quiet', 'proto-open'], 'Open prototype wears the quiet button, not the browser link');
  assert.equal(built.$('.proto-well').getAttribute('aria-label'), 'Prototype preview: 1 screen');
  const remark = setup({ moment: 'remark', remark: { text: 'x', id: 'R-ux-2', proposed: { text: 'Dark preview', example: 'a dark page', was: 'Light preview' } } });
  assert.deepEqual(primaries(remark.$$), ['Change requirement']);
  assert.deepEqual(menu(remark.$), ['Keep the requirement', 'Stop']);
  const failed = setup({ moment: 'failed', findings: [{ role: 'design', text: '1 of 2 screens built: Email preferences page failed', objection: false }] });
  assert.equal(failed.$('.plan-more'), null, 'no foot ⋯ on the stop question');
  assert.ok(failed.$('.chat-q .qopt[data-value="build"][data-preset="1"]'), 'Build again is preset');
  assert.match(failed.panel.textContent, /1 of 2 screens built: Email preferences page failed/);
  assert.ok(failed.$('.srows .chat-q'), 'the question sits inside .srows');
  for (const s of [b, built, remark]) assert.doesNotMatch(s.$('.proto-body').textContent, /Design's agents|Design and Product/);
});

test('the live line names the state word and the detail; the plan-err line stays empty', () => {
  const b = setup({ moment: 'offered', offer: OFFER.build, requirements: REQS, screenIds: ['R-ux-1', 'R-ux-2'] });
  assert.equal(b.$('.proto-live').getAttribute('aria-live'), 'polite');
  assert.equal(b.$('.proto-live').textContent, 'Needs you · 2 screen requirements');
  assert.equal(b.$('.plan-err').hidden, true);
  const r = setup({ state: 'reviewing', reviewRounds: 2, screens: SCREENS });
  assert.equal(r.$('.proto-live').textContent, 'Running · Round 2 of 3');
  assert.equal(prototypeDetail({ moment: 'built', screens: SCREENS, costUsd: 2.8 }), 'Prototype built · 1 screen · $2.80');
  // A saved reviewing record at round 2 keeps its round through the card's view (not "Round 1 of 3").
  const saved = { v: 1, state: 'reviewing', screenIds: ['R-ux-1'], designId: 'd_1', buildId: 'b_1', round: 1, screens: SCREENS,
    costUsd: 1, findings: [], reviewRounds: 2, remarks: 0, rebuilt: false, at: '2026-11-21T10:00:00.000Z' };
  assert.equal(prototypeView(saved).reviewRounds, 2);
  assert.equal(prototypeDetail(prototypeView(saved)), 'Round 2 of 3');
});

test('the remark placeholder: short at 480px or less, long on a change to wide, long without matchMedia; destroy stops listening', () => {
  const win = dom.window;
  const listeners = new Set();
  const mq = { matches: true, addEventListener: (t, fn) => { if (t === 'change') listeners.add(fn); },
    removeEventListener: (t, fn) => { if (t === 'change') listeners.delete(fn); } };
  const queries = [];
  win.matchMedia = (q) => { queries.push(q); return mq; };
  try {
    const s = setup({ moment: 'built', offer: OFFER.build, screens: SCREENS, costUsd: 1, findings: [] });
    const field = s.$('.proto-remark-field');
    assert.deepEqual(queries, ['(max-width:480px)']);
    assert.equal(field.placeholder, 'A remark?');
    assert.equal(REMARK_PLACEHOLDER_SHORT, 'A remark?');
    mq.matches = false;
    for (const fn of listeners) fn({ matches: false });
    assert.equal(field.placeholder, REMARK_PLACEHOLDER);
    s.body.destroy();
    assert.equal(listeners.size, 0, 'destroy removes the listener');
  } finally { delete win.matchMedia; }
});

test('the remark field: Send disabled while blank, Enter sends; no match refills, focuses and describes it', async () => {
  const s = setup({ moment: 'built', offer: OFFER.build, screens: SCREENS, costUsd: 1, findings: [] });
  const field = s.$('.proto-remark-field');
  const go = s.$('.proto-remark-send');
  assert.equal(field.placeholder, 'A remark? e.g. Preview should show dark mode');
  assert.ok(field.classList.contains('input') && field.classList.contains('input-sm'), 'the design system field (R-fit-1)');
  assert.equal(field.maxLength, 1000);
  assert.equal(go.disabled, true);
  assert.equal(go.dataset.locked, '1');
  field.value = '  ';
  field.dispatchEvent(new dom.window.Event('input'));
  assert.equal(go.disabled, true);
  field.value = 'calmer please';
  field.dispatchEvent(new dom.window.Event('input'));
  assert.equal(go.disabled, false);
  assert.equal(go.dataset.locked, undefined, 'a failed post\'s busy restore re-enables Send while the field holds text');
  field.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter' }));
  await flush();
  assert.deepEqual(s.calls.submit, [{ decision: 'remark', remark: 'calmer please' }]);
  const n = setup({ moment: 'built', offer: OFFER.build, screens: SCREENS, findings: [], remarkError: 'no-match', remarkText: 'make it calmer' });
  await flush();
  const f = n.$('.proto-remark-field');
  assert.equal(f.value, 'make it calmer');
  assert.equal(doc.activeElement, f);
  const err = n.$('.plan-err');
  assert.equal(f.getAttribute('aria-describedby'), err.id);
  assert.equal(err.textContent, NO_MATCH);
  const p = setup({ moment: 'built', offer: OFFER.build, screens: SCREENS, findings: [], remarkError: 'no-match', remarkText: 'x' }, { register: 'plain' });
  assert.equal(p.$('.plan-err').textContent, NO_MATCH_PLAIN);
});

test('R-ux-9: the proposed change shows the id, the new text and the Example once each, and does not quote the remark', () => {
  const s = setup({ moment: 'remark', remark: { text: 'R-ux-2 should show dark mode', id: 'R-ux-2',
    proposed: { text: 'The preview follows dark mode', example: 'a dark page shows a dark preview', was: 'The preview shows light mode' } } });
  const text = s.panel.textContent;
  assert.equal(count(text, 'R-ux-2'), 1);
  assert.equal(count(text, 'The preview follows dark mode'), 1);
  assert.equal(count(text, 'Example: a dark page shows a dark preview'), 1);
  assert.equal(count(text, 'should show dark mode'), 0, 'no remark quote');
  assert.match(s.$('.proto-was').textContent, /^Was: The preview shows light mode$/);
  assert.deepEqual(primaries(s.$$), ['Change requirement']);
  assert.doesNotMatch(text, /updated/);
});

test('the matching moment quotes the remark once, has no button and is busy; Thorough findings fold in the built state', () => {
  const m = setup({ state: 'matching', remark: { text: 'calmer please' } });
  assert.equal(count(m.panel.textContent, 'calmer please'), 1);
  assert.equal(m.$$('button').length, 0);
  assert.equal(m.$('.proto-body').getAttribute('aria-busy'), 'true');
  const t = setup({ moment: 'built', offer: { primary: 'build', menu: 'skip', review: true }, screens: SCREENS, costUsd: 1,
    findings: [{ role: 'design', text: 'Spacing is tight', objection: true }, { role: 'product', text: 'Fine', objection: false }] });
  assert.equal(t.$('.plan-check-line .plan-fold-text').textContent, 'Design and Product reviewed it');
  assert.equal(t.$$('.plan-checks:not(.proto-rows) .plan-check-row').filter((r) => /Spacing|Fine/.test(r.textContent)).length, 2);
});

test('answers post through the step sender: build, confirm, change, the failed question', async () => {
  const b = setup({ moment: 'offered', offer: OFFER.build, requirements: REQS });
  b.$('.proto-go').click();
  const c = setup({ moment: 'built', offer: OFFER.build, screens: SCREENS, findings: [] });
  c.$('.proto-confirm').click();
  const r = setup({ moment: 'remark', remark: { id: 'R-ux-1', text: 'x', proposed: { text: 'a', example: 'b', was: 'c' } } });
  r.$('.proto-change').click();
  const f = setup({ moment: 'failed', findings: [] });
  f.$('[data-qpanel-submit]').click();
  await flush();
  assert.deepEqual([b, c, r, f].map((s) => s.calls.submit[0]), [{ decision: 'build' }, { decision: 'confirm' }, { decision: 'change' }, { decision: 'build' }]);
});

test('the run side panel (readOnly): every moment draws its rows and live line but no button, field or ⋯', () => {
  const moments = [
    { moment: 'offered', offer: OFFER.build, requirements: REQS },
    { moment: 'built', offer: { primary: 'build', menu: 'skip', review: true }, screens: SCREENS, designId: 'd_1',
      findings: [{ role: 'design', text: 'Spacing is tight', objection: true }] },
    { moment: 'built', offer: OFFER.build, screens: SCREENS, findings: [], remarkError: true, remarkText: 'x' },
    { moment: 'remark', remark: { id: 'R-ux-1', text: 'x', proposed: { text: 'a', example: 'b', was: 'c' } } },
    { moment: 'failed', findings: [{ text: "Design's lead planned no screen" }] },
  ];
  for (const p of moments) {
    const s = setup(p, { readOnly: true });
    // The findings fold's own disclosure toggle stays: it answers nothing.
    const controls = s.$$('button, input, textarea').filter((b) => !b.classList.contains('plan-fold'));
    assert.equal(controls.length, 0, `${p.moment}: ${controls.map((b) => b.textContent || b.className).join(' | ')}`);
    assert.equal(s.$('.plan-actions'), null, `${p.moment}: no foot`);
    assert.ok(s.$('.ask-mcard-title').textContent, `${p.moment}: the head stays`);
    assert.match(s.$('.proto-live').textContent, /^Needs you/);
  }
  const off = setup(moments[0], { readOnly: true });
  assert.deepEqual(off.$$('.plan-check-id').map((n) => n.textContent), ['R-ux-1', 'R-ux-2'], 'the rows stay');
  const built = setup(moments[1], { readOnly: true });
  assert.ok(built.$('.proto-well'), 'the preview stays');
  assert.equal(built.$('.proto-open').getAttribute('href'), '#design/d_1', 'Open prototype is a link, not a step button');
  const failed = setup(moments[4], { readOnly: true });
  assert.equal(count(failed.panel.textContent, "Design's lead planned no screen"), 1);
});
