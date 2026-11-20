// src/core/workflow-tests/criteria-routes.mjs — HTTP for Part 4 (plans/workflow-tests-part4-plan.md). Every route is behind the
// workflowTests flag (D107). Registered by ui/routes/workflows/workflow-tests.mjs after Part 2's routes.
import { requireFlag } from '../flags.mjs';
import { actorOf } from '../identity.mjs';
import * as store from './store.mjs';
import * as cs from './criteria-store.mjs';
import { trustFor, byCriterionOf, likedFromPipeline } from './criteria-read.mjs';
import { findPipelineRowById } from '../artifacts.mjs';
import { pastRunSummary, NOT_TESTABLE_REASONS } from './service.mjs';
import { judgeModelsView } from './judge-models.mjs';
import { budgetStatus as realBudgetStatus } from '../cost-budget.mjs';
import { createChecker, LIMIT_TEXT } from './checker.mjs';

const STATUS = Object.freeze({ BAD_REQUEST: 400, NOT_FOUND: 404, BUSY: 409, NOT_READY: 422 });
const W = '/api/workflows/:id/tests';
/** Every Part 4 route, in registration order: the flag-off test walks it. Later tasks append theirs. */
export const CRITERIA_ROUTES = Object.freeze([
  ['GET', `${W}/judge-models`],
  ['POST', `${W}/judgements/:j/answer`],
  ['GET', `${W}/runs/:run/criteria`],
  ['POST', `${W}/runs/:run/criteria/check`],
  ['PUT', `${W}/examples/:ex/liked`],
  ['DELETE', `${W}/examples/:ex/liked`],
].map(([method, path]) => Object.freeze({ method, path })));

const num = (v, what) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw store.testError(`${what} must be a whole number`, 'BAD_REQUEST');
  return n;
};

/** The same wrapper as Part 2's (routes.mjs), a deliberate copy: an error's `errors` list reaches the response. Exported for its unit test. */
export const handle = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    res.status(STATUS[e && e.code] || 500).json({ error: e && e.message ? e.message : String(e), ...(e && Array.isArray(e.errors) ? { errors: e.errors } : {}) });
  }
};

export function registerCriteriaRoutes(app, { runner = null, criteriaJudge = null, deps = {} } = {}) {
  const gate = requireFlag('workflowTests');
  const route = (method, path, fn) => app[method.toLowerCase()](path, gate, handle(fn));
  const wid = (req) => String(req.params.id || '');
  const by = (req) => actorOf(req) || null;
  /** A judgement of this workflow, or 404. */
  const judgement = (req) => {
    const j = cs.readJudgement(num(req.params.j, 'answer'));
    if (!j || j.workflowId !== wid(req)) throw store.testError(`no answer ${req.params.j}`, 'NOT_FOUND');
    return j;
  };
  /** The route's example (`:ex`) of this workflow, or 404. Defined here, in 4a, because Task 18 (4a) uses it as well as Tasks 12–15 (4b). */
  const exampleOf = (req) => {
    const ex = store.readExample(wid(req), num(req.params.ex, 'example'));
    if (!ex) throw store.testError(`no example ${req.params.ex}`, 'NOT_FOUND');
    return ex;
  };

  // D96: Agree / Disagree (and Right / Wrong) on one verdict; null takes it back.
  route('POST', `${W}/judgements/:j/answer`, async (req, res) => {
    const j = judgement(req);
    const agree = req.body ? req.body.agree : undefined;
    if (agree !== true && agree !== false && agree !== null) throw store.testError('agree must be true, false or null', 'BAD_REQUEST');
    if (j.roundId != null) {   // a Check the checker card is answered through its round, and only when the round is ready
      const r = cs.readRound(j.roundId);
      if (!r || (r.status !== 'ready' && r.status !== 'done')) throw store.testError('Worca is not done with this round', 'BUSY');
    }
    cs.setAnswer(j.id, { agree, by: by(req) });
    res.json({ answer: cs.answerOf(j.id, by(req)), trust: j.purpose === 'pair' ? null : trustFor(j.workflowId, j.fp, j.model) });
  });
  // D87, D105: the Claude models that can check criteria, and the suggested one.
  route('GET', `${W}/judge-models`, async (req, res) => res.json(await judgeModelsView(wid(req))));
  const runOf = (req) => {
    const run = store.readTestRun(num(req.params.run, 'test'));
    if (!run || run.workflowId !== wid(req)) throw store.testError(`no test ${req.params.run}`, 'NOT_FOUND');
    return run;
  };
  route('GET', `${W}/runs/:run/criteria`, async (req, res) => {
    const run = runOf(req);
    res.json({ ...byCriterionOf(wid(req), run), checking: !!(runner && (runner.criteriaCheckOf(run.id) || runner.criteriaPhaseOf(run.id))) });
  });
  // P4-Q15: "Check them on these tries": the criteria an older test's tries miss, in the background; the page polls the read above.
  // The runner holds it (I15): BUSY beside a test of the workflow or another check, and its checks stop at the test's own cap.
  route('POST', `${W}/runs/:run/criteria/check`, async (req, res) => {
    const run = runOf(req);
    if (!runner) throw store.testError('this Worca cannot check criteria', 'BAD_REQUEST');
    if (run.capUsd !== null && store.spentOfRun(run.id) >= run.capUsd) {
      throw store.testError('This test reached its cost limit, so Worca checks nothing more on it. Test again to check your criteria.', 'BAD_REQUEST');
    }
    // The total spending limit: refused up front, as the chat's refusal words it, so no 'limit' judgement is booked for nothing.
    if ((deps.budgetStatus || realBudgetStatus)().blocked) {
      throw store.testError(LIMIT_TEXT, 'NOT_READY');
    }
    void runner.checkCriteriaLater(run);   // throws BUSY synchronously; never rejects afterwards (it logs)
    res.status(202).json({ checking: true });
  });
  // D101: the result you liked: an uploaded file, a try's result, or a run's result; DELETE takes it back.
  route('PUT', `${W}/examples/:ex/liked`, async (req, res) => {
    const ex = exampleOf(req);
    const b = req.body || {};
    if (typeof b.dataBase64 === 'string' && b.dataBase64) {
      cs.putLiked(ex.id, { kind: 'text', name: b.name, data: Buffer.from(b.dataBase64, 'base64') });
    } else {
      let pipelineId = typeof b.pipelineId === 'string' ? b.pipelineId : null;
      if (b.tryId != null) { const t = store.readTry(num(b.tryId, 'try')); pipelineId = t && t.workflowId === wid(req) && t.exampleId === ex.id ? t.pipelineId : null; }
      const row = pipelineId ? findPipelineRowById(pipelineId) : null;
      if (!row) throw store.testError('pick a file, a try or a run to keep as the result you liked', 'BAD_REQUEST');
      // A run of another workflow is never kept (same words as from-run); a try was checked above.
      if (b.tryId == null) {
        const past = await pastRunSummary(row.id);   // 404 for a run that is archived or deleted
        if (past.workflowId !== wid(req)) throw store.testError('this run is of another workflow', 'BAD_REQUEST');
        // A hidden try is picked as a try (its example is checked there); an unfinished run has no result yet.
        if (past.reason === 'test-try') throw store.testError('A test try cannot become a result you liked; pick it as a try instead.', 'BAD_REQUEST');
        if (past.reason === 'not-finished') throw store.testError(NOT_TESTABLE_REASONS['not-finished'], 'BAD_REQUEST');
      }
      await likedFromPipeline(ex, row.id, { at: row.started_at });
    }
    res.json({ example: store.readExample(wid(req), ex.id) });
  });
  route('DELETE', `${W}/examples/:ex/liked`, async (req, res) => {
    const ex = exampleOf(req);
    cs.deleteLiked(ex.id);
    res.json({ example: store.readExample(wid(req), ex.id) });
  });
  // D97: Check the checker. The spending limit is refused up front inside checker.start (not for a mock round, which pays nothing).
  const checker = deps.checker || createChecker({ budgetStatus: deps.budgetStatus || realBudgetStatus });
  const roundOf = (req, ex) => {
    const r = cs.readRound(num(req.params.round, 'round'));
    if (!r || r.workflowId !== wid(req) || r.exampleId !== ex.id) throw store.testError(`no round ${req.params.round}`, 'NOT_FOUND');
    return r;
  };
  route('POST', `${W}/examples/:ex/checker`, async (req, res) => {
    const ex = exampleOf(req);
    res.status(201).json({ round: await checker.start({ workflowId: wid(req), exampleId: ex.id, criterionId: String((req.body || {}).criterionId || ''), by: by(req) }) });
  });
  route('GET', `${W}/examples/:ex/checker/:round`, async (req, res) => { const ex = exampleOf(req); res.json(checker.view(roundOf(req, ex), { by: by(req) })); });
  route('POST', `${W}/examples/:ex/checker/:round/answers`, async (req, res) => {
    const ex = exampleOf(req);
    const b = req.body || {};
    if (typeof b.right !== 'boolean') throw store.testError('right must be true or false', 'BAD_REQUEST');
    res.json(await checker.answer(roundOf(req, ex), num(b.judgementId, 'card'), b.right, { by: by(req) }));
  });
  void exampleOf;   // defined here for Task 18 (4a) and Tasks 12-15 (4b), which use it
  return { runner, criteriaJudge, deps };
}
