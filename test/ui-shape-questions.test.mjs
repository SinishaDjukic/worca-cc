// test/ui-shape-questions.test.mjs — a shaping run's Clarify step card (spec §3.3, D3; shaper-cards D4, D13): the head,
// Answer and Use defaults, both posting through ctx.submit with their own failure line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { decorateShapingQuestions } from '../ui/public/shape/questions.mjs';
import { SEND_FAILED } from '../ui/public/shape/step-card.mjs';
import { defaultAnswers } from '../ui/public/shape/plan-text.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const flush = () => new Promise((r) => setTimeout(r, 0));

const PQ = { id: 'q1', kind: 'questions', questions: [
  { id: 'a', question: 'Where?', options: ['Chat', 'Runs'], recommended: 'Runs' },
  { id: 'b', question: 'Who?', options: ['Admins', 'Everyone'] },
] };
const COLLECTED = { answers: [{ id: 'a', question: 'Where?', choice: 'Chat' }, { id: 'b', question: 'Who?', choice: '' }] };

function clarifyPanel() {
  const panel = doc.createElement('div');
  panel.className = 'qpanel';
  panel.innerHTML = '<div class="qpanel-head"><b>t</b></div><div class="qpanel-body"></div><div class="qpanel-foot"><button class="btn btn-primary" data-qpanel-submit type="button"><span class="icon"></span>Submit</button></div>';
  return panel;
}

function decorate(submit, collect = () => COLLECTED) {
  const host = doc.createElement('div');
  const panel = clarifyPanel();
  host.appendChild(panel);
  const calls = [];
  const hostClicks = [];
  host.addEventListener('click', () => hostClicks.push(1));
  decorateShapingQuestions(panel, PQ, { doc, title: 'A few questions before the plan', chip: 'Clarify', collect,
    submit: (p) => { calls.push(p); return submit(p); } });
  return { panel, calls, hostClicks, $: (s) => panel.querySelector(s) };
}

test('the head reads the title and the Clarify chip; the submit reads "Answer" with its icon; Use defaults sits before it', () => {
  const { $, panel } = decorate(async () => true);
  assert.equal($('.qpanel-head').nextElementSibling, $('.ask-mcard-head'));
  assert.equal($('.ask-mcard-title').textContent, 'A few questions before the plan');
  assert.equal($('.ask-mcard-kind').textContent, 'Clarify');
  const go = $('[data-qpanel-submit]');
  assert.equal(go.textContent, 'Answer');
  assert.ok(go.querySelector('.icon'));
  const defaults = $('.clarify-defaults');
  assert.equal(defaults.textContent, 'Use defaults');
  assert.equal(defaults.type, 'button');
  assert.ok(!defaults.classList.contains('btn-primary'));
  assert.equal(defaults.nextElementSibling, go);
  assert.equal(panel.querySelectorAll('.btn-primary').length, 1);
});

test('Answer posts ctx.collect()\'s payload through ctx.submit; a refused collect posts nothing; no host delegate sees the click', async () => {
  const f = decorate(async () => true);
  f.$('[data-qpanel-submit]').click();
  await flush();
  assert.deepEqual(f.calls, [COLLECTED]);
  assert.equal(f.hostClicks.length, 0);
  const refused = decorate(async () => true, () => null);
  refused.$('[data-qpanel-submit]').click();
  await flush();
  assert.deepEqual(refused.calls, []);
});

test('Use defaults posts defaultAnswers(pq); success shows no error', async () => {
  const { $, calls, hostClicks } = decorate(async () => true);
  $('.clarify-defaults').click();
  await flush();
  assert.deepEqual(calls, [defaultAnswers(PQ)]);
  assert.equal(calls[0].answers[0].choice, 'Runs');
  assert.equal($('.plan-err').hidden, true);
  assert.equal(hostClicks.length, 0);
});

test('a failing Use defaults shows .plan-err: SEND_FAILED for false or a rejection, "Not sent: …" for a reason; cleared on retry', async () => {
  const replies = [false, true];
  const f = decorate(async () => replies.shift());
  const err = f.$('.plan-err[role=alert]');
  assert.ok(err);
  assert.equal(err.hidden, true);
  assert.equal(err.nextElementSibling, f.$('.qpanel-foot'));
  f.$('.clarify-defaults').click();
  await flush();
  assert.equal(err.hidden, false);
  assert.equal(err.textContent, SEND_FAILED);
  f.$('.clarify-defaults').click();
  await flush();
  assert.equal(err.hidden, true);

  const r = decorate(() => Promise.reject(new Error('net')));
  r.$('.clarify-defaults').click();
  await flush();
  assert.equal(r.$('.plan-err').hidden, false);

  const why = decorate(async () => 'this question is no longer pending');
  why.$('[data-qpanel-submit]').click();
  await flush();
  assert.equal(why.$('.plan-err').textContent, 'Not sent: this question is no longer pending');
});

test('no foot or no submit: nothing changes and nothing throws', () => {
  const bare = doc.createElement('div');
  assert.doesNotThrow(() => decorateShapingQuestions(bare, PQ, { doc, collect: () => null, submit: async () => true }));
  assert.equal(bare.children.length, 0);
  const noGo = doc.createElement('div');
  noGo.innerHTML = '<div class="qpanel-foot"><button class="btn">Cancel</button></div>';
  assert.doesNotThrow(() => decorateShapingQuestions(noGo, PQ, { doc, collect: () => null, submit: async () => true }));
  assert.equal(noGo.querySelector('.clarify-defaults'), null);
});
