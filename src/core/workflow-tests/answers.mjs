// src/core/workflow-tests/answers.mjs
// Nobody watches a test try (plans/workflow-tests-part2-plan.md D24). Every question gets the example's answer, or the
// example's "If Worca asks something else" rule: Worca picks a sensible answer (the --yes answer), or the try counts as
// failed. A question the example had no answer for is "help": it fails the Basic "Finishes without needing help from
// someone". Gates are the workflow's own stops and continue; a recovery prompt or a plan approval needs a person, so the
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

/**
 * How a try answers one question.
 * @param {{kind: string, questions?: Array, recovery?: {message?: string}, title?: string}} q the harness's `question` payload
 * @param {{answers?: Array<{question: string, answer: string}>, otherwise?: 'pick'|'fail'}} example
 */
export function planAnswer(q, { answers = [], otherwise = 'pick' } = {}) {
  const kind = q && q.kind;
  if (kind === 'questions' || kind === 'clarify') {
    const out = [];
    const help = [];
    for (const item of Array.isArray(q.questions) ? q.questions : []) {
      const canned = findAnswer(item.question, answers);
      let choice = null;
      if (canned != null) {
        const opt = (Array.isArray(item.options) ? item.options : []).find((o) => typeof o === 'string' && normQuestion(o) === normQuestion(canned));
        choice = opt ?? (item.allowFreeText !== false ? canned : null);
      }
      if (choice == null) {
        help.push({ question: String(item.question || '') });
        if (otherwise === 'fail') return { kind: 'fail', reason: `Worca asked ${quote(item.question)}, and this example has no answer for it.`, help };
        choice = autoChoice(item);
      }
      out.push({ id: item.id, choice });
    }
    return { kind: 'answer', payload: { answers: out }, help };
  }
  if (kind === 'gate') return { kind: 'answer', payload: { decision: 'continue' }, help: [] };
  if (kind === 'recovery') {
    const first = q.recovery && q.recovery.message ? String(q.recovery.message).split('\n')[0].slice(0, 200) : '';
    return { kind: 'fail', reason: `The try hit a problem it could not get past${first ? `: ${first}` : '.'}`, help: [{ question: 'How to go on after a problem' }] };
  }
  if (kind === PLAN_ASK_KIND) return { kind: 'fail', reason: 'Worca asked a person to approve a plan.', help: [{ question: 'Approve the plan' }] };
  if (kind === 'form') {
    const help = [{ question: String(q.title || 'Fill in a form') }];
    if (otherwise === 'fail') return { kind: 'fail', reason: `Worca asked to fill in ${quote(q.title || 'a form')}, and this example has no answers for forms.`, help };
    return { kind: 'answer', payload: autoAnswerPayload(q), help };
  }
  return { kind: 'answer', payload: autoAnswerPayload(q), help: [] };
}

/** U-T2: what `onFail` gets with a failure of the answerer itself. */
const WORCA = Object.freeze({ worca: true });

/**
 * Answer every question `orch` asks during one try. `answer(id, payload)` returns false when the run no longer waits on
 * that question. `onHelp` fires per question the example had no answer for; `onFail` fires when the try must stop, with
 * `{ worca: true }` when the answerer itself failed (U-T2: a Worca problem, never counted against the workflow).
 * `question` is emitted BEFORE the harness installs pendingQuestion (run-harness.mjs _ask), so the answer goes out on
 * the next turn (`defer` = setImmediate), the pattern of test/orchestrator-questions.test.mjs:173.
 * @returns {() => void} detach
 */
export function attachAnswerer(orch, example, { answer, onHelp = () => {}, onFail = () => {}, defer = setImmediate } = {}) {
  const handler = (q) => {
    let plan;
    try { plan = planAnswer(q, example || {}); } catch (err) { onFail(`Worca could not answer a question: ${err && err.message ? err.message : err}`, WORCA); return; }
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
