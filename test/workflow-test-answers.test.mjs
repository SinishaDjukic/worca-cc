// test/workflow-test-answers.test.mjs — D24: every question a try meets gets the example's answer, or its rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { planAnswer, findAnswer, normQuestion, attachAnswerer } from '../src/core/workflow-tests/answers.mjs';

const example = {
  answers: [
    { question: 'Which file formats should the export have?', answer: 'PDF and CSV, in one ZIP file.' },
    { question: 'Who is allowed to export?', answer: 'Finance admins' },
  ],
  otherwise: 'pick',
};
const tick = () => new Promise((r) => setImmediate(r));

test('questions match whatever the case, spacing and punctuation', () => {
  assert.equal(normQuestion('  Who IS allowed, to export?? '), 'who is allowed to export');
  assert.equal(findAnswer('who is allowed to export', example.answers), 'Finance admins');
  assert.equal(findAnswer('Who may export?', example.answers), null);
  const p = planAnswer({ kind: 'questions', questions: [{ id: 'q1', question: 'which file formats should the export have', options: [], allowFreeText: true }] }, example);
  assert.deepEqual(p, { kind: 'answer', payload: { answers: [{ id: 'q1', choice: 'PDF and CSV, in one ZIP file.' }] }, help: [] });
});

test('an answer equal to an option picks the option; free text only where it is allowed', () => {
  const q = { kind: 'clarify', questions: [{ id: 'q2', question: 'Who is allowed to export?', options: ['Everyone', 'finance admins.'], allowFreeText: false }] };
  assert.deepEqual(planAnswer(q, example).payload.answers, [{ id: 'q2', choice: 'finance admins.' }]);
  const noFree = { kind: 'questions', questions: [{ id: 'q3', question: 'Which file formats should the export have?', options: ['PDF', 'CSV'], allowFreeText: false, recommended: 'CSV' }] };
  assert.deepEqual(planAnswer(noFree, example), {
    kind: 'answer', payload: { answers: [{ id: 'q3', choice: 'CSV' }] }, help: [{ question: 'Which file formats should the export have?' }],
  });
});

test('nothing matches: Worca picks a sensible answer and it counts as help, or the try counts as failed', () => {
  const q = { kind: 'questions', questions: [{ id: 'q9', question: 'Which screens come first?', options: ['Settings', 'Home'] }] };
  assert.deepEqual(planAnswer(q, example), { kind: 'answer', payload: { answers: [{ id: 'q9', choice: 'Settings' }] }, help: [{ question: 'Which screens come first?' }] });
  assert.deepEqual(planAnswer(q, { ...example, otherwise: 'fail' }), {
    kind: 'fail', reason: 'Worca asked "Which screens come first?", and this example has no answer for it.', help: [{ question: 'Which screens come first?' }],
  });
});

test('gates continue; a recovery prompt or a plan approval stops the try; a form follows the rule', () => {
  assert.deepEqual(planAnswer({ kind: 'gate', id: 'g' }, example), { kind: 'answer', payload: { decision: 'continue' }, help: [] });
  const rec = planAnswer({ kind: 'recovery', recovery: { message: 'claude exited 1\nstack…' } }, example);
  assert.deepEqual([rec.kind, rec.reason, rec.help], ['fail', 'The try hit a problem it could not get past: claude exited 1', [{ question: 'How to go on after a problem' }]]);
  assert.equal(planAnswer({ kind: 'plan' }, example).reason, 'Worca asked a person to approve a plan.');
  const form = { kind: 'form', form: 'release', title: 'Release details', autoValues: { tag: 'v1' } };
  const picked = planAnswer(form, example);
  assert.deepEqual([picked.kind, picked.payload.values, picked.help], ['answer', { tag: 'v1' }, [{ question: 'Release details' }]]);
  assert.equal(planAnswer(form, { ...example, otherwise: 'fail' }).reason, 'Worca asked to fill in "Release details", and this example has no answers for forms.');
});

test('attachAnswerer answers on the next turn, reports help, fails once, and detaches', async () => {
  const orch = new EventEmitter();
  const sent = []; const help = []; const fails = [];
  const detach = attachAnswerer(orch, example, {
    answer: (id, p) => { sent.push([id, p]); return true; }, onHelp: (h) => help.push(h), onFail: (r) => fails.push(r),
  });
  orch.emit('question', { id: 'a1', kind: 'questions', questions: [{ id: 'q1', question: 'Who is allowed to export?', options: [] }] });
  assert.equal(sent.length, 0, 'not in the same turn: the harness installs pendingQuestion after the emit');
  await tick();
  assert.deepEqual(sent, [['a1', { answers: [{ id: 'q1', choice: 'Finance admins' }] }]]);
  orch.emit('question', { id: 'r1', kind: 'recovery', recovery: { message: 'boom' } });
  assert.deepEqual(fails, ['The try hit a problem it could not get past: boom']);
  assert.deepEqual(help, [{ kind: 'recovery', question: 'How to go on after a problem' }]);
  detach();
  orch.emit('question', { id: 'g2', kind: 'gate' });
  await tick();
  assert.equal(sent.length, 1, 'detached');
});

test('an answer the run did not take, or refused, fails the try', async () => {
  const orch = new EventEmitter(); const fails = [];
  attachAnswerer(orch, example, { answer: () => false, onFail: (r) => fails.push(r) });
  orch.emit('question', { id: 'g1', kind: 'gate' });
  await tick();
  const thrower = new EventEmitter();
  attachAnswerer(thrower, example, { answer: () => { throw new Error('invalid answer'); }, onFail: (r) => fails.push(r) });
  thrower.emit('question', { id: 'g2', kind: 'gate' });
  await tick();
  assert.deepEqual(fails, ["Worca's answer was not taken: the run no longer waited for it.", "Worca's answer was refused: invalid answer"]);
});

test('U-T2: the answerer\'s own failures say { worca: true }; the workflow\'s own stops do not', async () => {
  const seen = [];
  const onFail = (r, o) => seen.push([r, o]);
  const refused = new EventEmitter();
  attachAnswerer(refused, example, { answer: () => { throw new Error('invalid answer'); }, onFail });
  refused.emit('question', { id: 'g1', kind: 'gate' });
  await tick();
  const untaken = new EventEmitter();
  attachAnswerer(untaken, example, { answer: () => false, onFail });
  untaken.emit('question', { id: 'g2', kind: 'gate' });
  await tick();
  const broken = new EventEmitter();
  attachAnswerer(broken, example, { answer: () => true, onFail });
  broken.emit('question', { id: 'q3', kind: 'questions', get questions() { throw new Error('bad payload'); } });
  const plan = new EventEmitter();
  attachAnswerer(plan, example, { answer: () => true, onFail });
  plan.emit('question', { id: 'r4', kind: 'recovery', recovery: { message: 'boom' } });
  assert.deepEqual(seen, [
    ["Worca's answer was refused: invalid answer", { worca: true }],
    ["Worca's answer was not taken: the run no longer waited for it.", { worca: true }],
    ['Worca could not answer a question: bad payload', { worca: true }],
    ['The try hit a problem it could not get past: boom', undefined],
  ]);
});
