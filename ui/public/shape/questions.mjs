// ui/public/shape/questions.mjs — a shaping run's Clarify step card (spec §3.3, D3; shaper-cards D4, D13): the head,
// Answer, and Use defaults (every question's recommended option). Both buttons post through ctx.submit themselves.
import { defaultAnswers } from './plan-text.mjs';
import { stepHead, stepSender } from './step-card.mjs';

/** ctx: { doc, title, chip, collect(): payload|null, submit(payload): Promise<true|string|false> } */
export function decorateShapingQuestions(panel, pq, ctx) {
  const foot = panel.querySelector('.qpanel-foot');
  const answer = foot && foot.querySelector('[data-qpanel-submit]');
  if (!foot || !answer) return;
  const head = panel.querySelector('.qpanel-head');
  const top = stepHead(ctx.doc, ctx.title, ctx.chip);
  if (head) head.after(top); else panel.prepend(top);
  const label = [...answer.childNodes].find((n) => n.nodeType === 3);
  if (label) label.textContent = 'Answer';
  const err = ctx.doc.createElement('div');
  err.className = 'plan-err'; err.setAttribute('role', 'alert'); err.hidden = true;
  const send = stepSender(ctx, err);
  // Own handler: no host delegate sees this click (the feature page has none; the chat card and run page would double-post).
  answer.addEventListener('click', (e) => { e.stopPropagation(); const p = ctx.collect(); if (p) send(p); });
  const defaults = ctx.doc.createElement('button');
  defaults.type = 'button';
  defaults.className = 'btn clarify-defaults';
  defaults.textContent = 'Use defaults';
  defaults.addEventListener('click', (e) => { e.stopPropagation(); send(defaultAnswers(pq)); });
  foot.insertBefore(defaults, answer);
  foot.before(err);
}
