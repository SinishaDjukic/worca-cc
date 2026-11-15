// test/stillhet-chat-prompt-check-improve.test.mjs — Improve under Stillhet's composer chip, live kind (jsdom app host;
// test/helpers/stillhet-chat-prompt-check.mjs). A "Needs detail" grade offers Improve; dev's improve view renders the
// library's RewriteSuggestion above the composer (busy, ready, used, failed). Send is never held.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { closeHosts, settle, blurOnDisable } from './helpers/stillhet-chat-live-host.mjs';
import { pcHost, picker, reply, TASK, improves, improveBtn, view, opened, ready, okReply } from './helpers/stillhet-chat-prompt-check.mjs';

afterEach(closeHosts);
const LONGER = `${TASK} It must also export the monthly totals for every team.`;
const act = (s, name) => s.q(`[data-pc-improve] [data-improve-act="${name}"]`);
const btn = (s, label) => [...(view(s)?.querySelectorAll('button') || [])].find((b) => b.textContent.trim() === label);

test('Improve shows only on needs-detail', async () => {
  const s = await pcHost();
  await s.graded(TASK, { grade: 'clear' });
  assert.ok(picker(s));
  assert.equal(improveBtn(s), null);
  await s.type(LONGER); await s.quiet();
  const call = s.grades().at(-1);
  call.answer(reply(call, { grade: 'needs-detail' })); await settle(20);
  assert.ok(improveBtn(s));
  assert.equal(improveBtn(s).textContent.trim(), 'Improve');
});

test('a focused Improve removed by a re-grade to clear leaves the focus on the textarea, never <body> (R-ux-2)', async () => {
  const s = await pcHost();
  blurOnDisable(s.w);
  await s.graded(TASK, { grade: 'needs-detail' });
  improveBtn(s).focus();
  assert.equal(s.d.activeElement, improveBtn(s));
  s.box().value = LONGER;
  s.box().dispatchEvent(new s.w.Event('input', { bubbles: true }));
  improveBtn(s).focus();   // the person is still on Improve when the grade lands
  await s.quiet();
  const call = s.grades().at(-1);
  call.answer(reply(call, { grade: 'clear' })); await settle(20);
  assert.equal(improveBtn(s), null);
  assert.equal(s.d.activeElement, s.box());
});

test('busy: Improve is disabled and the focus moves into the suggestion, above the composer', async () => {
  const s = await pcHost();
  blurOnDisable(s.w);
  await s.graded(TASK, { grade: 'needs-detail' });
  improveBtn(s).focus();
  improveBtn(s).click(); await settle(10);
  assert.equal(improves(s).length, 1);
  assert.equal(improveBtn(s).disabled, true);
  assert.equal(s.d.activeElement, act(s, 'busy'));
  const slot = s.q('[data-pc-improve]');
  assert.equal(slot.nextElementSibling, s.q('[data-composer]'), 'right before the composer');
  assert.ok(picker(s), 'the chip stays');
});

test('ready: sections, amber gaps labelled by perspective and paths not in the repo', async () => {
  const s = await ready({ reply: { sections: [{ id: 'change', text: 'Finance needs the weekly cost.' }], paths: [{ path: 'ui/x.mjs', inRepo: false }, { path: 'ui/y.mjs', inRepo: true }] } });
  const v = view(s);
  assert.ok(v.querySelector('.pd-rewrite.is-ready'));
  assert.match(v.textContent, /Finance needs the weekly cost\./);
  assert.ok(v.querySelectorAll('.pd-gap').length >= 1, 'an unstated section carries its amber gap');
  assert.match(v.querySelector('.pd-gap').textContent, / · decide: /);
  assert.match(v.querySelector('.pd-rewrite-missing').textContent, /ui\/x\.mjs/);
  assert.doesNotMatch(v.querySelector('.pd-rewrite-missing').textContent, /ui\/y\.mjs/);
});

test('the chip stays and Improve is hidden through ready, used and failed (R-ux-4)', async () => {
  const s = await ready();
  assert.ok(picker(s)); assert.equal(improveBtn(s), null, 'ready');
  btn(s, 'Use this').click(); await settle(20);
  assert.ok(view(s).querySelector('.pd-rewrite.is-used'));
  assert.ok(picker(s)); assert.equal(improveBtn(s), null, 'used');
  const f = await opened();
  const call = improves(f).at(-1);
  call.answer({ requestId: call.body.requestId, source: 'failed', error: 'timeout', model: 'Sonnet 5.5' }); await settle(20);
  assert.ok(view(f).querySelector('.pd-rewrite.is-failed'));
  assert.ok(picker(f)); assert.equal(improveBtn(f), null, 'failed');
});

test('Use this writes the rewrite into the draft (R-qa-5)', async () => {
  const s = await ready();
  const call = improves(s).at(-1);
  const text = okReply(call).text;
  btn(s, 'Use this').click(); await settle(20);
  assert.equal(s.box().value, text);
  assert.equal(s.d.activeElement, s.box());
});

test('Undo restores the exact previous draft (R-qa-5)', async () => {
  const s = await ready();
  btn(s, 'Use this').click(); await settle(20);
  assert.notEqual(s.box().value, TASK);
  btn(s, 'Undo').click(); await settle(20);
  assert.equal(s.box().value, TASK);
  assert.equal(view(s), null, 'closed');
});

test('Keep mine closes the suggestion and keeps the draft', async () => {
  const s = await ready();
  btn(s, 'Keep mine').click(); await settle(20);
  assert.equal(view(s), null);
  assert.equal(s.box().value, TASK);
  assert.ok(improveBtn(s), 'Improve is offered again');
});

test('model unavailable shows no Try again (R-qa-6)', async () => {
  const s = await opened();
  const call = improves(s).at(-1);
  call.answer({ requestId: call.body.requestId, source: 'failed', error: 'model unavailable' }); await settle(20);
  assert.match(view(s).textContent, /no model is available/);
  assert.equal(act(s, 'retry'), null);
});

test('a timeout offers Try again, which asks once more (R-qa-6)', async () => {
  const s = await opened();
  const call = improves(s).at(-1);
  call.answer({ requestId: call.body.requestId, source: 'failed', error: 'timeout', model: 'Sonnet 5.5' }); await settle(20);
  assert.match(view(s).textContent, /no answer from Sonnet 5\.5 in 60s/);
  act(s, 'retry').click(); await settle(10);
  assert.equal(improves(s).length, 2);
});

test('a repaint keeps the ready suggestion: the same node, moved back', async () => {
  const s = await ready();
  const node = view(s);
  s.q('[data-menu="cp-mode"]').click(); await settle(10);   // a full paint of the composer
  s.q('[data-menu="cp-mode"]').click(); await settle(10);
  assert.equal(view(s), node);
  assert.ok(btn(s, 'Use this'));
});
