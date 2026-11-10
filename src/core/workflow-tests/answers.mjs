// src/core/workflow-tests/answers.mjs
// Nobody watches a test try (plans/workflow-tests-part2-plan.md D24). Every question gets the example's answer, or the
// example's "If Worca asks something else" rule: Worca picks a sensible answer (the --yes answer), or the try counts as
// failed. A question the example had no answer for is "help" (it fails the Basic "Finishes without needing help from
// someone") only when the rule is "counts as failed". Where the person chose "Worca picks", no person was needed: the
// pick is listed in `asked` (how: 'picked'|'unusable') but is not help (2026-11-10, supersedes D24). Gates are the workflow's own stops and continue; a recovery prompt or a plan approval needs a person, so the
// try stops.
import { autoAnswerPayload, autoChoice } from '../run-harness.mjs';
import { PLAN_ASK_KIND } from '../shape/run.mjs';

export const TRY_ANSWERED_BY = 'workflow-test';

/** NFKC, lower case, no punctuation or symbols, single spaces. */
export function normQuestion(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** The example's answer to this question, matched on normalised text, or null. */
export function findAnswer(question, answers) {
  const want = normQuestion(question);
  if (!want) return null;
  const hit = (Array.isArray(answers) ? answers : []).find((a) => a && normQuestion(a.question) === want);
  return hit ? hit.answer : null;
}

const quote = (s) => `"${String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)}"`;

/** U-T12 (F23): a question or answer as the try's verdict keeps it. Long text stays whole (board 47); only a runaway
 *  one is cut, so one question cannot fill the verdict. */
const ASKED_TEXT_MAX = 2000;
const askedText = (s) => { const t = String(s ?? '').trim(); return t.length > ASKED_TEXT_MAX ? `${t.slice(0, ASKED_TEXT_MAX)}…` : t; };
const asked = (question, answer, how) => ({ question: askedText(question), answer: answer == null ? null : askedText(answer), how });
/** A form's picked values in one line: "tag: v1, notes: First cut". */
const formValuesText = (values) => Object.entries(values && typeof values === 'object' ? values : {})
  .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ');

/**
 * How a try answers one question. U-T12 (F23): `asked` lists what the workflow asked the person, in order, as
 * `{ question, answer, how: 'example'|'picked'|'unusable'|'none' }`: its questions and its forms. A gate (a loop's own stop), a
 * recovery prompt (Worca hit a problem) and a plan approval are Worca's own stops, not the workflow asking: none listed.
 * @param {{kind: string, questions?: Array, recovery?: {message?: string}, title?: string}} q the harness's `question` payload
 * @param {{answers?: Array<{question: string, answer: string}>, otherwise?: 'pick'|'fail'}} example
 */
export function planAnswer(q, { answers = [], otherwise = 'pick' } = {}) {
  const kind = q && q.kind;
  if (kind === 'questions' || kind === 'clarify') {
    const out = [];
    const help = [];
    const list = [];
    for (const item of Array.isArray(q.questions) ? q.questions : []) {
      const canned = findAnswer(item.question, answers);
      let choice = null;
      const unusable = canned != null;   // the example has an answer; it may still match no option
      if (canned != null) {
        const opt = (Array.isArray(item.options) ? item.options : []).find((o) => typeof o === 'string' && normQuestion(o) === normQuestion(canned));
        choice = opt ?? (item.allowFreeText !== false ? canned : null);
      }
      if (choice == null) {
        if (otherwise === 'fail') {
          help.push({ question: String(item.question || '') });
          list.push(asked(item.question, null, unusable ? 'unusable' : 'none'));   // the try stops here: the questions after it are never answered
          return { kind: 'fail', reason: `Worca asked ${quote(item.question)}, and this example has no answer for it.`, help, asked: list };
        }
        choice = autoChoice(item);
        list.push(asked(item.question, choice, unusable ? 'unusable' : 'picked'));   // Worca picks: listed, not help
      } else list.push(asked(item.question, canned, 'example'));   // the example's own words
      out.push({ id: item.id, choice });
    }
    return { kind: 'answer', payload: { answers: out }, help, asked: list };
  }
  if (kind === 'gate') return { kind: 'answer', payload: { decision: 'continue' }, help: [], asked: [] };
  if (kind === 'recovery') {
    const first = q.recovery && q.recovery.message ? String(q.recovery.message).split('\n')[0].slice(0, 200) : '';
    return { kind: 'fail', reason: `The try hit a problem it could not get past${first ? `: ${first}` : '.'}`, help: [{ question: 'How to go on after a problem' }],
      asked: [] };
  }
  if (kind === PLAN_ASK_KIND) return { kind: 'fail', reason: 'Worca asked a person to approve a plan.', help: [{ question: 'Approve the plan' }], asked: [] };
  if (kind === 'form') {
    const title = String(q.title || 'Fill in a form');
    if (otherwise === 'fail') {
      const help = [{ question: title }];
      return { kind: 'fail', reason: `Worca asked to fill in ${quote(q.title || 'a form')}, and this example has no answers for forms.`, help,
        asked: [asked(title, null, 'none')] };
    }
    const payload = autoAnswerPayload(q);
    return { kind: 'answer', payload, help: [], asked: [asked(title, formValuesText(payload.values), 'picked')] };
  }
  return { kind: 'answer', payload: autoAnswerPayload(q), help: [], asked: [] };
}

/** U-T2: what `onFail` gets with a failure of the answerer itself. */
const WORCA = Object.freeze({ worca: true });

/**
 * Answer every question `orch` asks during one try. `answer(id, payload)` returns false when the run no longer waits on
 * that question. `onHelp` fires per question the example had no answer for; `onFail` fires when the try must stop, with
 * `{ worca: true }` when the answerer itself failed (U-T2: a Worca problem, never counted against the workflow).
 * U-T11 (F5): a gate is a review loop that ran out of rounds; it still answers continue, and `onLoopLimit({ nodeId, rounds })`
 * says how many times the checker sent the work back (a hold stands in for delivery `deliveryNo`, so `deliveryNo - 1` were made).
 * U-T12 (F23): `onAsked({ question, answer, how })` fires per question the workflow asked (planAnswer's `asked`), in order.
 * `question` is emitted BEFORE the harness installs pendingQuestion (run-harness.mjs _ask), so the answer goes out on
 * the next turn (`defer` = setImmediate), the pattern of test/orchestrator-questions.test.mjs:173.
 * @returns {() => void} detach
 */
export function attachAnswerer(orch, example, { answer, onHelp = () => {}, onFail = () => {}, onLoopLimit = () => {}, onAsked = () => {}, defer = setImmediate } = {}) {
  const handler = (q) => {
    let plan;
    try { plan = planAnswer(q, example || {}); } catch (err) { onFail(`Worca could not answer a question: ${err && err.message ? err.message : err}`, WORCA); return; }
    if (q && q.kind === 'gate') {
      const n = Number(q.deliveryNo);
      try { onLoopLimit({ nodeId: q.nodeId ?? null, rounds: Number.isFinite(n) && n > 1 ? n - 1 : 0 }); } catch { /* a note, never a reason to stop the try */ }
    }
    // U-T12: listed before a fail, so the question that failed the try is in the list.
    for (const a of plan.asked || []) { try { onAsked(a); } catch { /* a note, never a reason to stop the try */ } }
    for (const h of plan.help) onHelp({ kind: q.kind, question: h.question });
    if (plan.kind === 'fail') { onFail(plan.reason); return; }
    defer(() => {
      let ok = false;
      try { ok = answer(q.id, plan.payload) !== false; } catch (err) { onFail(`Worca's answer was refused: ${err && err.message ? err.message : err}`, WORCA); return; }
      if (!ok) onFail("Worca's answer was not taken: the run no longer waited for it.", WORCA);
    });
  };
  orch.on('question', handler);
  return () => orch.off('question', handler);
}
