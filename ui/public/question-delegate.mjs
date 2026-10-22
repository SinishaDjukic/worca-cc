// ui/public/question-delegate.mjs — the one click delegate for a run's inline question (Known bug 7): the chat run
// card and the group page bind it on their question host; the run page keeps app.js onRdDelegatedClick. Workflow
// panels and the plan / outline bodies bind their own buttons, so they are skipped here.
import { askRendererFor, askKindOf } from './ask/registry.mjs';

export const Q_BUTTONS = '.qpanel [data-qpanel-submit], .qpanel .gate-continue, .qpanel .gate-another, .qpanel .recovery-retry, .qpanel .recovery-pause, .qpanel .recovery-abort';
export const DECISIONS = Object.freeze({ 'gate-continue': 'continue', 'gate-another': 'another', 'recovery-retry': 'retry', 'recovery-pause': 'pause', 'recovery-abort': 'abort' });

/** The answer a button sends: a decision for gate / recovery buttons, else the renderer's collected form (null when it refused). */
export function questionPayload(btn, pq) {
  const cls = Object.keys(DECISIONS).find((c) => btn.classList.contains(c));
  if (cls) return { decision: DECISIONS[cls] };
  const renderer = askRendererFor(askKindOf(pq)) || askRendererFor('clarify');
  return renderer ? renderer.collect(btn.closest('.qpanel')) : null;
}

/** Bind on `host`. `question()` returns the open question or null; `send(payload, pq, btn)` posts it. Returns a disposer. */
export function delegateQuestion(host, { question, send }) {
  const onClick = (e) => {
    const b = e.target.closest && e.target.closest(Q_BUTTONS);
    if (!b || !host.contains(b) || b.disabled || b.closest('.qpanel-workflow')) return;
    const pq = question();
    if (!pq) return;
    const payload = questionPayload(b, pq);
    if (payload == null) return;                     // the renderer refused and marked its own fields
    send(payload, pq, b);
  };
  host.addEventListener('click', onClick);
  return () => host.removeEventListener('click', onClick);
}
