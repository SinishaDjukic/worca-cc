// src/core/ask/question-card.mjs — the `question` card (freeform chat D5): a bounded choice or a text answer the model
// asks for with ask_question. Validated in the MCP child (what the model sees) and again in the parent (which alone
// mints the card); answered on the cards route; continued by a `[worca event] question card …` turn. Pure.
export const QUESTION_LIMITS = Object.freeze({ question: 300, options: 25, optionId: 40, optionLabel: 100, optionDescription: 100, placeholder: 100, answerText: 2000 });
const OPTION_ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const L = QUESTION_LIMITS;
const oneLine = (v, max) => typeof v === 'string' && v.trim() !== '' && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);

/** input → {ok:true, card} | {ok:false, errors:[...]}. Never throws on junk. */
export function validateQuestion(input) {
  const errors = [];
  const i = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const answer = i.answer === 'text' ? 'text' : i.answer === 'choice' ? 'choice' : null;
  if (!answer) errors.push('answer must be "choice" or "text"');
  if (!oneLine(i.question, L.question)) errors.push(`question must be one line of 1–${L.question} characters`);
  const options = [];
  if (answer === 'choice') {
    const raw = Array.isArray(i.options) ? i.options : [];
    if (raw.length < 2 || raw.length > L.options) errors.push(`options must hold 2–${L.options} entries`);
    const seen = new Set();
    for (const o of raw.slice(0, L.options)) {
      const ok = o && typeof o === 'object' && typeof o.id === 'string' && OPTION_ID_RE.test(o.id) && !seen.has(o.id)
        && oneLine(o.label, L.optionLabel) && (o.description === undefined || oneLine(o.description, L.optionDescription));
      if (!ok) { errors.push('every option needs a unique id (a-z, 0-9, _ or -; ≤ 40) and a one-line label (≤ 100)'); break; }
      seen.add(o.id);
      options.push({ id: o.id, label: o.label.trim(), ...(o.description ? { description: o.description.trim() } : {}) });
    }
  } else if (answer === 'text' && i.options !== undefined) {
    errors.push('a text question takes no options');
  }
  if (i.placeholder !== undefined && !oneLine(i.placeholder, L.placeholder)) errors.push(`placeholder must be one line (≤ ${L.placeholder})`);
  if (errors.length) return { ok: false, errors };
  return { ok: true, card: { type: 'question', answer, question: i.question.trim(), ...(answer === 'choice' ? { options } : {}),
    ...(i.placeholder ? { placeholder: i.placeholder.trim() } : {}) } };
}

/** A route body against a stored question card → {ok:true, patch, answerText} | {ok:false, error}. */
export function checkQuestionAnswer(card, body) {
  const b = body && typeof body === 'object' ? body : {};
  if (card.answer === 'choice') {
    const opt = (card.options || []).find((o) => typeof b.choice === 'string' && o.id === b.choice);
    if (!opt) return { ok: false, error: 'choice must be one of the card\'s options' };
    return { ok: true, patch: { choice: opt.id }, answerText: opt.label };
  }
  const t = typeof b.text === 'string' ? b.text.trim() : '';
  if (!t || t.length > L.answerText) return { ok: false, error: `text must be 1–${L.answerText} characters` };
  return { ok: true, patch: { answerText: t }, answerText: t };
}

/** The event turn's text (the mock matches its start: keep the prefix stable). */
export function questionEventPrompt({ cardId, card, answerText, choice = null }) {
  const what = card.answer === 'choice' ? `option "${choice}" (${JSON.stringify(answerText)})` : `text ${JSON.stringify(answerText)}`;
  return `[worca event] question card ${cardId} answered: ${what}. The question was ${JSON.stringify(card.question)}. Continue from the answer.`;
}

export function questionNoticeText({ card, answerText }) {
  return `Answered: ${String(answerText).slice(0, 120)}${card.answer === 'text' && answerText.length > 120 ? '…' : ''}`;
}
