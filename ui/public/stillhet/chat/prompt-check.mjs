// ui/public/stillhet/chat/prompt-check.mjs — the prompt check chip's state in Stillhet's composer (docs/prompt-check.md,
// "The chip"; docs/rail/panels.md panel.chat-composer). Dev's own logic, never dev's screen: dev's grader
// (prompt-check/grader.mjs) and Improve view (prompt-check/improve-view.mjs) behind one state the composer draws with the
// library (SentencePicker, Chip, Button). conversation.js loads it with import() the first time the setting is on and the
// draft is not empty. One controller per surface: the composer re-keys it when its chat, its surface kind or forceTask
// changes. A correction picked before the chat has an id is held, and posted with the thread id its first send made.
import { KIND_LABELS, GRADE_LABELS, PROMPT_KINDS } from '../../../../src/shared/prompt-check/assessment.mjs';
import { createPromptGrader } from '../../prompt-check/grader.mjs';
import { createImproveView } from '../../prompt-check/improve-view.mjs';

export { KIND_LABELS, GRADE_LABELS };

const URL_CORRECTION = '/api/prompt-check/kind-correction';
/** Skips that mean "nothing changed enough to check again": the chip keeps its last state (as dev's chip-host.mjs). */
const KEEP_SKIPS = new Set(['same-text', 'small-change']);

/**
 * @param {{doc:Document, surface:{kind:'chat'|'shaper', id:string}, forceTask?:boolean,
 *   held?:{proposedKind:string, chosenKind:string}|null, fetchImpl?:Function, timers?:object,
 *   field:{read:()=>string, write:(text:string)=>void, focus?:()=>void}, project?:Function|string|null,
 *   engine?:Function|string|null, chatModel?:Function|string|null, onChange?:(state:object)=>void}} o
 */
export function createComposerCheck({ doc, surface, forceTask = false, held = null, fetchImpl, timers, field, project = null, engine = null, chatModel = null, onChange = null }) {
  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : (...a) => fetch(...a);
  let visible = false;
  let kind = null;
  let grade = null;
  let proposedKind = null;     // the first kind graded for this draft, before any pick
  let openDecisions = [];      // the last assessment's open questions: hints for Improve
  let pending = held && held.proposedKind && held.chosenKind ? { proposedKind: held.proposedKind, chosenKind: held.chosenKind } : null;
  let disposed = false;
  let lastKey = '';

  const state = () => ({ visible, kind, grade, improve: view.state() });
  // onChange fires only when what the composer draws changed: a kept skip, or a result equal to the last, says nothing
  function emit() {
    if (disposed) return;
    const s = state();
    const key = JSON.stringify(s);
    if (key === lastKey) return;
    lastKey = key;
    try { onChange?.(s); } catch { /* a composer bug never breaks the check */ }
  }

  const view = createImproveView({ doc, surface, field, project, engine, chatModel, fetchImpl: doFetch, onState: () => emit() });

  function hide() {
    visible = false;
    kind = null;
    grade = null;
    view.close();
    emit();
  }

  function onResult(r) {
    if (disposed) return;
    if (r.skip) { if (!KEEP_SKIPS.has(r.skip)) { hide(); grader.forget(); } return; }   // hidden: the same text checks again
    const a = r.assessment;
    if (!a || !a.isTask || !PROMPT_KINDS.includes(a.kind)) { hide(); return; }
    const g = a.grade === 'clear' || a.grade === 'needs-detail' ? a.grade : null;
    if (proposedKind === null) proposedKind = a.kind;
    openDecisions = Array.isArray(a.openDecisions) ? a.openDecisions.filter((d) => typeof d === 'string') : [];
    // a re-grade that leaves Needs detail closes a busy or ready rewrite (a used one keeps its Undo), as dev does
    if (g !== 'needs-detail' && (view.state() === 'busy' || view.state() === 'ready')) view.close();
    kind = a.kind;
    grade = g;
    visible = true;
    emit();
  }

  const grader = createPromptGrader({ surface, enabled: () => !disposed, fetchImpl: doFetch, timers, onResult, forceTask });

  function post(body) {
    try {
      Promise.resolve(doFetch(URL_CORRECTION, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
        .catch(() => { /* a lost correction (a 409 when the check is off) is never shown and never blocks */ });
    } catch { /* same */ }
  }

  return {
    state,
    kinds: () => PROMPT_KINDS.map((id) => ({ id, label: KIND_LABELS[id] })),
    get improveEl() { return view.el; },
    input(text) {
      if (disposed) return;
      const t = String(text ?? '');
      view.fieldEdited(t);
      if (!t.trim()) { proposedKind = null; pending = null; hide(); grader.forget(); }   // a cleared draft takes its held correction with it
      grader.input(t);
    },
    choose(k) {
      if (disposed || !PROMPT_KINDS.includes(k) || k === kind) return;
      const from = proposedKind ?? kind;
      kind = k;   // the grade stays until the re-grade answers: the badge never blinks out
      emit();
      grader.regrade(k);
      if (k === from) { pending = null; return; }
      const correction = { proposedKind: from, chosenKind: k };
      if (surface.id === 'new') pending = correction;
      else post({ surface: surface.kind, threadId: surface.id, ...correction });
    },
    sent(text, { threadId = '' } = {}) {
      if (disposed) return;
      if (pending && typeof threadId === 'string' && threadId) {
        post({ surface: surface.kind, threadId, proposedKind: pending.proposedKind, chosenKind: pending.chosenKind });
        pending = null;
      }
      grader.sent(text);
      proposedKind = null;
      hide();
    },
    openImprove() {
      if (disposed || !kind || grade !== 'needs-detail' || view.state() === 'busy') return;
      view.open(kind, openDecisions);
    },
    pendingCorrection() {
      return pending ? { ...pending } : null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      pending = null;
      grader.dispose();
      view.dispose();
    },
  };
}
