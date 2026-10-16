// ui/public/shape/questions.mjs — a shaping run's Clarify ask (spec §3.3, D3): Answer and draft, Skip, draft with defaults.
import { defaultAnswers } from './plan-text.mjs';
import { SEND_FAILED } from './plan-body.mjs';

export function decorateShapingQuestions(panel, pq, ctx) {
  const foot = panel.querySelector('.qpanel-foot');
  const submit = foot && foot.querySelector('.btn-go');
  if (!foot || !submit) return;
  const label = [...submit.childNodes].find((n) => n.nodeType === 3);
  if (label) label.textContent = 'Answer and draft';
  const skip = ctx.doc.createElement('button');
  skip.type = 'button';
  skip.className = 'btn clarify-defaults';
  skip.textContent = 'Skip, draft with defaults';
  // Skip bypasses the Chat card's controls.answer, so its qErr never shows (F33): own alert line.
  const err = ctx.doc.createElement('div');
  err.className = 'clarify-defaults-err';
  err.setAttribute('role', 'alert');
  err.hidden = true;
  err.textContent = SEND_FAILED;
  skip.addEventListener('click', () => {
    err.hidden = true;
    Promise.resolve(ctx.submit(defaultAnswers(pq)))
      .then((ok) => { if (ok === false) err.hidden = false; }, () => { err.hidden = false; });
  });
  foot.insertBefore(skip, submit);
  foot.before(err);
}
