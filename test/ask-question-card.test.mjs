import test from 'node:test';
import assert from 'node:assert/strict';
import { validateQuestion, checkQuestionAnswer, questionEventPrompt } from '../src/core/ask/question-card.mjs';
import { createAskTools } from '../src/core/ask/tools.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';

test('validateQuestion: choice and text shapes; junk never throws', () => {
  const c = validateQuestion({ answer: 'choice', question: 'Which?', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
  assert.equal(c.ok, true);
  assert.deepEqual(c.card, { type: 'question', answer: 'choice', question: 'Which?', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
  assert.equal(validateQuestion({ answer: 'text', question: 'Why?' }).card.answer, 'text');
  for (const junk of [null, 7, '', [], {}, { answer: 'choice', question: 'x', options: [{ id: 'a', label: 'A' }] },
    { answer: 'choice', question: 'x', options: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] },
    { answer: 'text', question: 'x', options: [] }, { answer: 'choice', question: 'a\nb', options: [] },
    { answer: 'choice', question: 'x', options: [{ id: 'constructor', label: { toString: 1 } }, { id: 'b', label: 'B' }] }]) {
    assert.equal(validateQuestion(junk).ok, false, JSON.stringify(junk));
  }
  assert.equal(validateQuestion({ answer: 'choice', question: 'x', options: Array.from({ length: 26 }, (_, i) => ({ id: `o${i}`, label: `L${i}` })) }).ok, false);
});

test('checkQuestionAnswer + event prompt', () => {
  const { card } = validateQuestion({ answer: 'choice', question: 'Which?', options: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }] });
  assert.deepEqual(checkQuestionAnswer(card, { choice: 'b' }), { ok: true, patch: { choice: 'b' }, answerText: 'Beta' });
  assert.equal(checkQuestionAnswer(card, { choice: 'constructor' }).ok, false);
  const t = validateQuestion({ answer: 'text', question: 'Why?' }).card;
  assert.equal(checkQuestionAnswer(t, { text: '   ' }).ok, false);
  assert.equal(checkQuestionAnswer(t, { text: 'x'.repeat(2001) }).ok, false);
  assert.match(questionEventPrompt({ cardId: 'card_0000abcd', card, answerText: 'Beta', choice: 'b' }), /^\[worca event\] question card card_0000abcd answered: option "b"/);
});

test('ask_question is listed only with deps.chatQuestions (other chats keep their exact list)', () => {
  const base = { limits: ASK_LIMITS };
  assert.equal(createAskTools(base).list().some((d) => d.name === 'ask_question'), false);
  const on = createAskTools({ ...base, chatQuestions: { validate: (i) => validateQuestion(i) } });
  const names = on.list().map((d) => d.name);
  assert.equal(names[names.length - 1], 'ask_question', 'appended at the end');
});
