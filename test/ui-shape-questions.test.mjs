// test/ui-shape-questions.test.mjs — a shaping run's Clarify ask (spec §3.3, D3): Answer and draft, and
// Skip, draft with defaults with its own failure line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { decorateShapingQuestions } from '../ui/public/shape/questions.mjs';
import { SEND_FAILED } from '../ui/public/shape/plan-body.mjs';
import { defaultAnswers } from '../ui/public/shape/plan-text.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const flush = () => new Promise((r) => setTimeout(r, 0));

const PQ = { id: 'q1', kind: 'questions', questions: [
  { id: 'a', question: 'Where?', options: ['Chat', 'Runs'], recommended: 'Runs' },
  { id: 'b', question: 'Who?', options: ['Admins', 'Everyone'] },
] };

function clarifyPanel() {
  const panel = doc.createElement('div');
  panel.className = 'qpanel';
  panel.innerHTML = '<div class="qpanel-body"></div><div class="qpanel-foot"><button class="btn btn-go" type="button"><span class="icon"></span>Submit</button></div>';
  return panel;
}

function decorate(submit) {
  const panel = clarifyPanel();
  const calls = [];
  decorateShapingQuestions(panel, PQ, { doc, submit: (p) => { calls.push(p); return submit(p); } });
  return { panel, calls, $: (s) => panel.querySelector(s) };
}

test('the submit reads "Answer and draft", keeps its icon, and Skip sits before it without .btn-go', () => {
  const { $, panel } = decorate(async () => true);
  const go = $('.btn-go');
  assert.equal(go.textContent, 'Answer and draft');
  assert.ok(go.querySelector('.icon'));
  const skip = $('.clarify-defaults');
  assert.equal(skip.textContent, 'Skip, draft with defaults');
  assert.equal(skip.type, 'button');
  assert.ok(!skip.classList.contains('btn-go'));
  assert.equal(skip.nextElementSibling, go);
  assert.equal(panel.querySelectorAll('.btn-go').length, 1);
});

test('Skip posts defaultAnswers(pq); success shows no error', async () => {
  const { $, calls } = decorate(async () => true);
  $('.clarify-defaults').click();
  await flush();
  assert.deepEqual(calls, [defaultAnswers(PQ)]);
  assert.equal(calls[0].answers[0].choice, 'Runs');
  assert.equal($('.clarify-defaults-err').hidden, true);
});

test('Skip shows its own alert when submit resolves false or rejects, and clears it on retry', async () => {
  const replies = [false, true];
  const f = decorate(async () => replies.shift());
  const err = f.$('.clarify-defaults-err[role=alert]');
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
  assert.equal(r.$('.clarify-defaults-err').hidden, false);
});

test('no foot or no submit: nothing changes and nothing throws', () => {
  const bare = doc.createElement('div');
  assert.doesNotThrow(() => decorateShapingQuestions(bare, PQ, { doc, submit: async () => true }));
  assert.equal(bare.children.length, 0);
  const noGo = doc.createElement('div');
  noGo.innerHTML = '<div class="qpanel-foot"><button class="btn">Cancel</button></div>';
  assert.doesNotThrow(() => decorateShapingQuestions(noGo, PQ, { doc, submit: async () => true }));
  assert.equal(noGo.querySelector('.clarify-defaults'), null);
});
