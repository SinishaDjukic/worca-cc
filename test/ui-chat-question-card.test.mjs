// test/ui-chat-question-card.test.mjs — freeform chat D5: the browser renders the `question` card (ask_question).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { QUESTION_TYPE, buildQuestionCard, registerQuestionCard } from '../ui/public/chat/question-card.mjs';
import { chatCardBuilder, _resetChatExtensions } from '../ui/public/chat/extensions.mjs';

const doms = [];
afterEach(() => { for (const d of doms.splice(0)) d.window.close(); _resetChatExtensions(); });
const tick = () => new Promise((r) => setTimeout(r, 0));
const CHOICE = { kind: 'card', id: 'card_0000000a', state: 'proposed', card: { type: 'question', answer: 'choice', question: 'Which branch?',
  options: [{ id: 'a', label: 'main' }, { id: 'b', label: 'dev', description: 'the integration branch' }] } };
const TEXT = { kind: 'card', id: 'card_0000000b', state: 'proposed', card: { type: 'question', answer: 'text', question: 'What should it focus on?', placeholder: 'one sentence' } };
function ctxOf({ post = async () => ({}) } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  doms.push(dom);
  const posts = []; let focused = 0;
  const ctx = { doc: dom.window.document, win: dom.window, threadId: () => 'ask_00000001',
    postCard: async (block, body) => { posts.push([block.id, body]); return post(block, body); },
    focusComposer: () => { focused += 1; } };
  return { ctx, posts, focused: () => focused, win: dom.window };
}

test('a choice question: the options as tiles; a pick + Answer posts { choice } and gives the composer the focus', async () => {
  const { ctx, posts, focused } = ctxOf();
  const { el } = buildQuestionCard(CHOICE, ctx);
  assert.ok(el.matches('section.chat-rc-q.chat-q'));
  assert.equal(el.querySelector('.qtext-t').textContent, 'Which branch?');
  const opts = [...el.querySelectorAll('.qopt')];
  assert.deepEqual(opts.map((o) => [o.dataset.value, o.querySelector('.chat-q-opt-label').textContent, o.querySelector('.chat-q-opt-sub')?.textContent ?? null]),
    [['a', 'main', null], ['b', 'dev', 'the integration branch']]);
  const go = el.querySelector('[data-qpanel-submit]');
  assert.deepEqual([go.textContent, go.disabled], ['Answer', true]);
  opts[1].click(); go.click(); await tick();
  assert.deepEqual([posts, focused()], [[['card_0000000a', { choice: 'b' }]], 1]);
});

test('a text question: an empty submit shows the hint and posts nothing; a typed answer posts { text }; a refusal re-enables', async () => {
  const { ctx, posts, win } = ctxOf();
  const { el } = buildQuestionCard(TEXT, ctx);
  ctx.doc.body.appendChild(el);
  assert.equal(el.querySelector('.chat-rc-q-head').textContent, 'What should it focus on?');
  assert.equal(el.querySelector('textarea').placeholder, 'one sentence');
  el.dispatchEvent(new win.Event('submit', { cancelable: true }));
  await tick();
  assert.deepEqual([posts, el.querySelector('.chat-q-err').textContent], [[], 'Type an answer first.']);
  el.querySelector('textarea').value = '  the login page  ';
  el.dispatchEvent(new win.Event('submit', { cancelable: true }));
  await tick();
  assert.deepEqual(posts, [['card_0000000b', { text: 'the login page' }]]);
  const r = ctxOf({ post: async () => { throw Object.assign(new Error('card is answered'), { status: 409 }); } });
  const refused = buildQuestionCard(TEXT, r.ctx).el;
  refused.querySelector('textarea').value = 'x';
  refused.dispatchEvent(new r.win.Event('submit', { cancelable: true }));
  await tick(); await tick();
  assert.deepEqual([refused.querySelector('.chat-q-err').textContent, refused.querySelector('button').disabled], ['card is answered', false]);
});

test('answered reads "Answered: …" (the option label, or the text); any other state reads Not answered', () => {
  const { ctx } = ctxOf();
  assert.equal(buildQuestionCard({ ...CHOICE, state: 'answered', card: { ...CHOICE.card, choice: 'b' } }, ctx).el.querySelector('.chat-rc-receipt').textContent, 'Answered: dev');
  assert.equal(buildQuestionCard({ ...TEXT, state: 'answered', card: { ...TEXT.card, answerText: 'the login page' } }, ctx).el.querySelector('.chat-rc-receipt').textContent, 'Answered: the login page');
  assert.equal(buildQuestionCard({ ...TEXT, state: 'closed' }, ctx).el.querySelector('.chat-rc-receipt').textContent, 'Not answered');
});

test('registered as question', () => {
  registerQuestionCard();
  assert.equal(QUESTION_TYPE, 'question');
  assert.equal(chatCardBuilder('question'), buildQuestionCard);
});

test('app.js registers the question card before the chat mounts (D5 Open in worca parity)', () => {
  const src = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
  assert.ok(src.includes("import { registerQuestionCard } from './chat/question-card.mjs';"));
  const at = src.indexOf('\nregisterQuestionCard();');
  assert.ok(at > 0 && at < src.indexOf('\naskPanel = createAskPanel({'), 'registered before createAskPanel runs');
});
