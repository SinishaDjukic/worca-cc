// ui/public/shape/gap-question.mjs — Shaper small runs slice 8 (D13): the Verifier's gap question. One question per open
// gap (buildChatQuestion, a fix run preset), three answers each: Add a fix run, Ship with the gap (a reason field, as the
// Ship card's) or Change the requirement (a textarea holding the current text). One "Send answers" posts every answer
// at once; it stays disabled until each gap has its answer and the text that answer needs. A refusal is said once,
// under the gap it names. Pure: DOM only through `doc`. The stop's words are src/shared/shape/verifier.mjs's.
// Slice 10 (D12): the gaps Away mode already answered read as `.meta` lines above the questions (no answers of their
// own), and a gap held for the person says why under its title.
import { buildChatQuestion } from '../chat/question.mjs';
import { ANSWERED_BY_WORDS } from '../../../src/shared/shape/verifier.mjs';
import { CONFIRM_REASON_MAX } from '../../../src/shared/shape/ship-ledger.mjs';
import { CHANGE_TEXT_MAX } from '../../../src/shared/shape/req-change.mjs';
import { errLine } from './step-card.mjs';

const SEND_FAILED = 'Answer not sent';
const REASON_HINT = 'Why it can ship as is';
const TEXT_HINT = 'The requirement as it should read';
const blank = (v) => !String(v || '').trim();

/**
 * `stop` = verifyStop's (form 'gaps'); `submit(payload)` resolves true, or the refusal (a string) / false.
 * → HTMLElement (the question; its panel is `.qpanel[data-kind=gaps]`), with `setErrors(errors)` for a 422's
 * `[{path: 'answers.R-po-2', message}]`.
 */
export function buildGapQuestion(doc, stop, { submit, busy = false } = {}) {
  const h = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const gaps = Array.isArray(stop.gaps) ? stop.gaps : [];
  const answers = Array.isArray(stop.answers) ? stop.answers : [];
  const sendOpt = (Array.isArray(stop.options) ? stop.options : [])[0] || { label: 'Send answers' };
  let picks = new Map(gaps.map((g) => [g.id, stop.pick]));
  let sending = !!busy;

  const q = buildChatQuestion(doc, {
    id: 'stop-gaps', heading: stop.head, head: false, numbers: false, foot: false,
    questions: gaps.map((g) => ({ id: g.id, text: g.id, why: g.why, options: answers.map((a) => ({ value: a.value, label: a.label, sub: a.sub })) })),
    preset: new Map(gaps.map((g) => [g.id, stop.pick])),
    submitLabel: () => sendOpt.label,
    onSubmit: () => {},
    onPick: (m) => { picks = m; paint(); },
  });
  const panel = q.el.querySelector('.qpanel');
  panel.dataset.kind = 'gaps';
  const decided = Array.isArray(stop.decided) ? stop.decided : [];
  panel.prepend(...decided.map((a) => h('div', 'qwhy meta', `${a.id} → fix · ${ANSWERED_BY_WORDS.away}`)));

  /** A field types: a letter in it is never an answer's key (buildChatQuestion's panel keys). */
  const typing = (el) => { el.addEventListener('keydown', (e) => e.stopPropagation()); el.addEventListener('input', paint); return el; };
  const rows = gaps.map((g) => {
    const block = [...panel.querySelectorAll('.qblock')].find((b) => b.dataset.q === g.id);
    if (typeof g.hold === 'string' && g.hold) block.querySelector('.qtext')?.appendChild(h('span', 'qwhy', `Held for you: ${g.hold}`));
    const reason = typing(h('input', 'input input-sm'));
    reason.type = 'text'; reason.maxLength = CONFIRM_REASON_MAX; reason.placeholder = REASON_HINT;
    reason.setAttribute('aria-label', `${g.id}: ${REASON_HINT.toLowerCase()}`);
    const text = typing(h('textarea', 'textarea'));
    text.maxLength = CHANGE_TEXT_MAX; text.rows = 2; text.value = typeof g.text === 'string' ? g.text : ''; text.placeholder = TEXT_HINT;
    text.setAttribute('aria-label', `${g.id}: ${TEXT_HINT.toLowerCase()}`);
    const err = errLine(doc);
    block.append(reason, text, err);
    return { g, block, reason, text, err };
  });
  const foot = h('div', 'qpanel-foot plan-actions');
  const footErr = errLine(doc);
  const go = h('button', 'btn btn-primary', sendOpt.label);
  go.type = 'button';
  go.dataset.qpanelSubmit = '';
  foot.appendChild(go);
  panel.append(footErr, foot);

  const say = (el, msg) => { el.textContent = msg; el.hidden = !msg; };
  const clearErrors = () => { for (const r of rows) say(r.err, ''); say(footErr, ''); };
  /** The refusal under the gap it names (its id), else above the button. */
  function show(msg, id = null) {
    const row = rows.find((r) => r.g.id === id) || rows.find((r) => msg.startsWith(r.g.id)) || rows.find((r) => msg.includes(r.g.id));
    say(row ? row.err : footErr, msg);
  }
  const complete = () => rows.every(({ g, reason, text }) => {
    const v = picks.get(g.id);
    return v === 'fix' || (v === 'ship' && !blank(reason.value)) || (v === 'change' && !blank(text.value));
  });
  function paint() {
    for (const r of rows) {
      const v = picks.get(r.g.id);
      r.reason.hidden = v !== 'ship';
      r.text.hidden = v !== 'change';
      r.reason.disabled = sending; r.text.disabled = sending;
    }
    for (const t of panel.querySelectorAll('.qopt')) t.disabled = sending;
    go.disabled = sending || !complete();
  }
  const payload = () => ({ decision: 'answer', answers: rows.map(({ g, reason, text }) => {
    const v = picks.get(g.id);
    if (v === 'ship') return { id: g.id, answer: 'ship', reason: reason.value.replace(/\s+/g, ' ').trim() };
    if (v === 'change') return { id: g.id, answer: 'change', text: text.value.replace(/\s+/g, ' ').trim() };
    return { id: g.id, answer: 'fix' };
  }) });
  go.addEventListener('click', (e) => {
    e.stopPropagation();
    if (sending || !complete()) return;
    clearErrors();
    sending = true;
    paint();
    new Promise((res) => { res(submit(payload())); })
      .then((out) => {
        if (out === true) return;                          // the card waits for its answered state
        sending = false;
        // A 422 has already marked its gap (setErrors); anything else is said here.
        const marked = rows.some((r) => !r.err.hidden) || !footErr.hidden;
        if (typeof out === 'string' && out) show(`Not sent: ${out}`);
        else if (!marked) show(SEND_FAILED);
        paint();
      }, (err) => { sending = false; show((err && err.message) || SEND_FAILED); paint(); });
  });

  paint();
  q.el.setErrors = (errors) => {
    for (const e of Array.isArray(errors) ? errors : []) {
      const id = e && typeof e.path === 'string' && e.path.startsWith('answers.') ? e.path.slice('answers.'.length) : null;
      if (e && e.message) show(`Not sent: ${e.message}`, id);
    }
  };
  return q.el;
}
