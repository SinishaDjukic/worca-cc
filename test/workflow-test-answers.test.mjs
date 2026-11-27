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
  assert.deepEqual(p, { kind: 'answer', payload: { answers: [{ id: 'q1', choice: 'PDF and CSV, in one ZIP file.' }] }, help: [],
    asked: [{ question: 'which file formats should the export have', answer: 'PDF and CSV, in one ZIP file.', how: 'example' }] });
});

test('an answer equal to an option picks the option; free text only where it is allowed', () => {
  const q = { kind: 'clarify', questions: [{ id: 'q2', question: 'Who is allowed to export?', options: ['Everyone', 'finance admins.'], allowFreeText: false }] };
  assert.deepEqual(planAnswer(q, example).payload.answers, [{ id: 'q2', choice: 'finance admins.' }]);
  const noFree = { kind: 'questions', questions: [{ id: 'q3', question: 'Which file formats should the export have?', options: ['PDF', 'CSV'], allowFreeText: false, recommended: 'CSV' }] };
  assert.deepEqual(planAnswer(noFree, example), {
    kind: 'answer', payload: { answers: [{ id: 'q3', choice: 'CSV' }] }, help: [],
    asked: [{ question: 'Which file formats should the export have?', answer: 'CSV', how: 'unusable' }],
  });
});

test('nothing matches: Worca picks a sensible answer and the person chose that, so it is no help; or the try counts as failed', () => {
  const q = { kind: 'questions', questions: [{ id: 'q9', question: 'Which screens come first?', options: ['Settings', 'Home'] }] };
  assert.deepEqual(planAnswer(q, example), { kind: 'answer', payload: { answers: [{ id: 'q9', choice: 'Settings' }] }, help: [],
    asked: [{ question: 'Which screens come first?', answer: 'Settings', how: 'picked' }] });
  assert.deepEqual(planAnswer(q, { ...example, otherwise: 'fail' }), {
    kind: 'fail', reason: 'Worca asked "Which screens come first?", and this example has no answer for it.', help: [{ question: 'Which screens come first?' }],
    asked: [{ question: 'Which screens come first?', answer: null, how: 'none' }],
  });
});

test('gates continue; a recovery prompt or a plan approval stops the try; a form follows the rule', () => {
  assert.deepEqual(planAnswer({ kind: 'gate', id: 'g' }, example), { kind: 'answer', payload: { decision: 'continue' }, help: [], asked: [] });
  const rec = planAnswer({ kind: 'recovery', recovery: { message: 'claude exited 1\nstack…' } }, example);
  assert.deepEqual([rec.kind, rec.reason, rec.help], ['fail', 'The try hit a problem it could not get past: claude exited 1', [{ question: 'How to go on after a problem' }]]);
  assert.equal(planAnswer({ kind: 'plan' }, example).reason, 'Worca asked a person to approve a plan.');
  const form = { kind: 'form', form: 'release', title: 'Release details', autoValues: { tag: 'v1' } };
  const picked = planAnswer(form, example);
  assert.deepEqual([picked.kind, picked.payload.values, picked.help], ['answer', { tag: 'v1' }, []]);
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

test('a gate still answers continue, and tells onLoopLimit which loop ran out and how many times the checker sent it back', async () => {
  const orch = new EventEmitter(); const sent = []; const limits = []; const fails = [];
  attachAnswerer(orch, example, { answer: (id, p) => { sent.push([id, p]); return true; }, onLoopLimit: (l) => limits.push(l), onFail: (r) => fails.push(r) });
  // The hold stands in for delivery deliveryNo; deliveryNo - 1 send-backs were already made.
  orch.emit('question', { id: 'gate-w1-3', kind: 'gate', nodeId: 'n_check', wireId: 'w1', deliveryNo: 3, holdNo: 1 });
  await tick();
  assert.deepEqual(sent, [['gate-w1-3', { decision: 'continue' }]]);
  assert.deepEqual(limits, [{ nodeId: 'n_check', rounds: 2 }]);
  orch.emit('question', { id: 'q', kind: 'questions', questions: [{ id: 'q1', question: 'Who?', options: ['A'] }] });
  await tick();
  assert.equal(limits.length, 1, 'only a gate is a loop limit');
  assert.deepEqual(fails, []);
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

// U-T12 (F23, board 47): what Worca asked in a try, in the order asked, with how it was answered.
test('U-T12: every question the workflow asked is listed in order, with the example\'s answer, Worca\'s pick, or none', () => {
  const long = `Should the brief also cover what happens when one flatmate moves out halfway through the month?${' And then?'.repeat(20)}`;
  const q = { kind: 'clarify', questions: [
    { id: 'q1', question: 'Who is allowed to export?', options: [] },
    { id: 'q2', question: long, options: ['Yes, add a short section on moving out.', 'No'] },
  ] };
  assert.deepEqual(planAnswer(q, example).asked, [
    { question: 'Who is allowed to export?', answer: 'Finance admins', how: 'example' },
    { question: long, answer: 'Yes, add a short section on moving out.', how: 'picked' },
  ], 'the example\'s own words, Worca\'s pick, and a long question whole');
  const strict = { kind: 'questions', questions: [
    { id: 'q1', question: 'Who is allowed to export?', options: [] },
    { id: 'q2', question: 'Who pays for the app?', options: ['Us'] },
    { id: 'q3', question: 'Never reached?', options: ['A'] },
  ] };
  assert.deepEqual(planAnswer(strict, { ...example, otherwise: 'fail' }).asked, [
    { question: 'Who is allowed to export?', answer: 'Finance admins', how: 'example' },
    { question: 'Who pays for the app?', answer: null, how: 'none' },
  ], 'the try stops at the question it had no answer for');
});

test('U-T12: a form is the workflow asking too; a gate, a recovery prompt and a plan approval are not questions to list', () => {
  const form = { kind: 'form', form: 'release', title: 'Release details', autoValues: { tag: 'v1', notes: 'First cut' } };
  assert.deepEqual(planAnswer(form, example).asked, [{ question: 'Release details', answer: 'tag: v1, notes: First cut', how: 'picked' }]);
  assert.deepEqual(planAnswer(form, { ...example, otherwise: 'fail' }).asked, [{ question: 'Release details', answer: null, how: 'none' }]);
  assert.deepEqual(planAnswer({ kind: 'gate', id: 'g', nodeId: 'n', deliveryNo: 3 }, example).asked, []);
  assert.deepEqual(planAnswer({ kind: 'recovery', recovery: { message: 'boom' } }, example).asked, []);
  assert.deepEqual(planAnswer({ kind: 'plan' }, example).asked, []);
  assert.deepEqual(planAnswer({ kind: 'cost-cap', id: 'cost-cap-run' }, example).asked, []);
});

test('U-T12: attachAnswerer reports each asked question through onAsked, in order, before a fail; never a gate', async () => {
  const orch = new EventEmitter(); const asked = []; const order = [];
  attachAnswerer(orch, { ...example, otherwise: 'fail' }, { answer: () => true, onAsked: (a) => { asked.push(a); order.push('asked'); },
    onFail: () => order.push('fail') });
  orch.emit('question', { id: 'a1', kind: 'questions', questions: [{ id: 'q1', question: 'Who is allowed to export?', options: [] }] });
  orch.emit('question', { id: 'gate-w1-2', kind: 'gate', nodeId: 'n', deliveryNo: 2 });
  orch.emit('question', { id: 'a2', kind: 'questions', questions: [{ id: 'q1', question: 'Who pays for the app?', options: ['Us'] }] });
  await tick();
  assert.deepEqual(asked, [
    { question: 'Who is allowed to export?', answer: 'Finance admins', how: 'example' },
    { question: 'Who pays for the app?', answer: null, how: 'none' },
  ]);
  assert.deepEqual(order, ['asked', 'asked', 'fail'], 'the failing question is listed before the try stops');
  const quiet = new EventEmitter(); const fails = [];
  attachAnswerer(quiet, example, { answer: () => true, onAsked: () => { throw new Error('a note'); }, onFail: (r) => fails.push(r) });
  quiet.emit('question', { id: 'a3', kind: 'questions', questions: [{ id: 'q1', question: 'Who is allowed to export?', options: [] }] });
  await tick();
  assert.deepEqual(fails, [], 'a failing note never stops the try');
});

test('D24 (2026-11-10): an unusable example answer under "the try counts as failed" is still help and says so; an empty form is picked with no values', () => {
  const noFree = { kind: 'questions', questions: [{ id: 'q3', question: 'Which file formats should the export have?', options: ['PDF', 'CSV'], allowFreeText: false }] };
  const f = planAnswer(noFree, { ...example, otherwise: 'fail' });
  assert.deepEqual([f.kind, f.help.length, f.asked], ['fail', 1, [{ question: 'Which file formats should the export have?', answer: null, how: 'unusable' }]]);
  // The example has an answer, so the reason must not say it has none.
  assert.equal(f.reason, 'Worca asked "Which file formats should the export have?", and this example\'s answer could not be used for it.');
  const empty = planAnswer({ kind: 'form', form: 'x', title: 'Nothing to fill', autoValues: {} }, example);
  assert.deepEqual([empty.asked, empty.help], [[{ question: 'Nothing to fill', answer: '', how: 'picked' }], []]);
});
