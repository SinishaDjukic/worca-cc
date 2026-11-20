// ui/public/chat/question-card.mjs — freeform chat D5: the `question` card (ask_question). A choice question uses the
// chat ask-card grammar (chat/question.mjs); a text question shows a one-field answer form. Both answer on the existing
// card route: { choice } | { text }.
import { registerChatCard } from './extensions.mjs';
import { buildChatQuestion, buildChatReceipt } from './question.mjs';

export const QUESTION_TYPE = 'question';

export function buildQuestionCard(block, ctx) {
  const doc = ctx.doc;
  const card = (block && block.card) || {};
  if (block.state === 'answered') {
    const picked = card.answer === 'choice' ? ((card.options || []).find((o) => o.id === card.choice) || {}).label || card.choice : card.answerText;
    return { el: buildChatReceipt(doc, `Answered: ${picked || ''}`), dispose: () => {} };
  }
  if (block.state !== 'proposed') return { el: buildChatReceipt(doc, 'Not answered'), dispose: () => {} };
  if (card.answer === 'choice') {
    const { el, destroy } = buildChatQuestion(doc, {
      id: `chat-q-${block.id}`, heading: 'Your turn',
      questions: [{ id: 'q', text: card.question || '', options: (card.options || []).map((o) => ({ value: o.id, label: o.label, sub: o.description || '' })) }],
      submitLabel: () => 'Answer',
      onSubmit: async (picks) => { await ctx.postCard(block, { choice: picks.get('q') }); if (typeof ctx.focusComposer === 'function') ctx.focusComposer(); },
    });
    return { el, dispose: destroy };
  }
  const el = doc.createElement('form');
  el.className = 'chat-rc-q chat-q chat-q-text';
  const head = doc.createElement('h3'); head.className = 'chat-rc-q-head'; head.textContent = card.question || '';
  const input = doc.createElement('textarea'); input.className = 'chat-q-input'; input.maxLength = 2000; input.rows = 3;
  input.placeholder = card.placeholder || 'Your answer'; input.setAttribute('aria-label', card.question || 'Answer');
  const line = doc.createElement('div'); line.className = 'chat-q-err'; line.setAttribute('role', 'status');
  const btn = doc.createElement('button'); btn.type = 'submit'; btn.className = 'btn'; btn.textContent = 'Answer';
  el.append(head, input, line, btn);
  const onSubmit = async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) { line.textContent = 'Type an answer first.'; return; }
    btn.disabled = true;
    try { await ctx.postCard(block, { text }); }
    catch (err) { line.textContent = (err && err.message) || 'Could not send the answer.'; btn.disabled = false; }
  };
  el.addEventListener('submit', onSubmit);
  return { el, dispose: () => el.removeEventListener('submit', onSubmit) };
}

export function registerQuestionCard() { registerChatCard(QUESTION_TYPE, buildQuestionCard); }
