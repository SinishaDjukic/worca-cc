// ui/public/prompt-check/grader.mjs — the browser side of the prompt check (docs/prompt-check.md). One grader per
// surface: it runs the free skip rules on every keystroke, sends at most one POST /api/prompt-check/grade after
// PROMPT_CHECK_DEBOUNCE_MS of quiet, aborts it when typing resumes, drops a stale reply, and keeps the
// requirement-so-far window (lost on reload). Pure: fetch and timers are injected for tests.
import { PROMPT_CHECK_WINDOW } from '../../../src/shared/prompt-check/assessment.mjs';
import { PROMPT_CHECK_DEBOUNCE_MS, deterministicAssessment, skipReason, textHash } from '../../../src/shared/prompt-check/filter.mjs';

const BARE_TIMERS = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) };
const URL_GRADE = '/api/prompt-check/grade';
const DROPPED_SOURCES = new Set(['superseded', 'off']);

/**
 * @param {{surface:{kind:string,id:string}, enabled:()=>boolean, fetchImpl?:Function, timers?:{setTimeout:Function, clearTimeout:Function},
 *          onResult:(r:object)=>void, forceTask?:boolean}} o
 */
export function createPromptGrader({ surface, enabled, fetchImpl = (...a) => fetch(...a), timers = BARE_TIMERS, onResult, forceTask = false }) {
  let timer = null;
  let ctl = null;
  let seq = 0;
  let latestId = null;
  let generation = 0;            // bumped by sent(): a reply from before Send is never applied
  let currentText = '';
  let last = null;               // {hash, text} of the last check whose reply was applied on this surface
  let lastAssessment = null;
  let lastAssessedHash = null;   // textHash of the text lastAssessment was graded for
  let windowTexts = [];
  let disposed = false;

  const emit = (r) => { try { onResult?.(r); } catch { /* a view bug never breaks the grader */ } };

  function cancel() {
    if (timer !== null) { timers.clearTimeout(timer); timer = null; }
    if (ctl) { ctl.abort(); ctl = null; }
  }

  // Only an accepted reply promotes the sent text to `last`: an aborted, failed or dropped check leaves the previous
  // one, so the next small edit is still checked.
  function apply(reply, requestId, gen, sentText) {
    if (!reply || typeof reply !== 'object') return;
    if (requestId !== latestId || gen !== generation || DROPPED_SOURCES.has(reply.source)) return;
    if (reply.requestId !== requestId || reply.textHash !== textHash(currentText)) return;
    last = sentText;
    if (reply.source === 'skipped') { lastAssessment = null; lastAssessedHash = null; emit({ skip: reply.skip }); return; }
    lastAssessment = reply.assessment || null;
    lastAssessedHash = sentText.hash;
    if (lastAssessment?.continuesRequirement === false) windowTexts = [];
    emit(reply);
  }

  function check(text) {
    timer = null;
    const requestId = `${surface.kind}-${++seq}`;
    latestId = requestId;
    const gen = generation;
    const mine = new AbortController();
    ctl = mine;
    const sentText = { hash: textHash(text), text };
    const body = { requestId, surface, text, window: [...windowTexts], forceTask };
    let sentReq;
    try {
      sentReq = Promise.resolve(fetchImpl(URL_GRADE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: mine.signal }));
    } catch (err) { sentReq = Promise.reject(err); }
    sentReq
      .then((r) => r.json())
      .then((reply) => apply(reply, requestId, gen, sentText))
      .catch(() => {})
      .finally(() => { if (ctl === mine) ctl = null; });
  }

  return {
    input(text, { answering = false } = {}) {
      currentText = String(text ?? '');
      cancel();
      if (disposed || !enabled()) return;
      const skip = skipReason(currentText, { answering, last, forceTask });
      if (skip) { emit({ skip }); return; }
      const t = currentText;
      timer = timers.setTimeout(() => check(t), PROMPT_CHECK_DEBOUNCE_MS);
    },
    sent(text) {
      cancel();
      generation++;
      const t = String(text ?? '');
      // A message sent before its grade arrived is judged by the free rules, so it still joins the window.
      const isTask = lastAssessment && lastAssessedHash === textHash(t)
        ? lastAssessment.isTask
        : !skipReason(t, { forceTask }) && deterministicAssessment(t, { forceTask }).isTask;
      if (isTask) windowTexts = [...windowTexts, t].slice(-(PROMPT_CHECK_WINDOW - 1));
      lastAssessment = null;
      lastAssessedHash = null;
      last = null;
    },
    resetWindow(baseText = '') {
      windowTexts = baseText ? [String(baseText)] : [];
    },
    cancel,
    dispose() {
      cancel();
      disposed = true;
    },
    state() {
      return { window: [...windowTexts], last, lastAssessment, pending: timer !== null, inFlight: ctl !== null };
    },
  };
}
