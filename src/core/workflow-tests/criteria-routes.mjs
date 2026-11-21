// src/core/workflow-tests/criteria-routes.mjs — HTTP for Part 4 (plans/workflow-tests-part4-plan.md). Every route is behind the
// workflowTests flag (D107). Registered by ui/routes/workflows/workflow-tests.mjs after Part 2's routes.
import { requireFlag, flagEnabled } from '../flags.mjs';
import * as store from './store.mjs';
import * as cs from './criteria-store.mjs';
import { trustFor, byCriterionOf, likedFromPipeline, trustReportOf, trustOfExample } from './criteria-read.mjs';
import { findPipelineRowById } from '../artifacts.mjs';
import { pastRunSummary, usablePastRun, workflowRowOf, NOT_TESTABLE_REASONS } from './service.mjs';
import { mainResult } from './result.mjs';
import { suggestCriteria } from './suggest.mjs';
import { mockEnabled } from '../claude-runner.mjs';
import { judgeModelsView } from './judge-models.mjs';
import { budgetStatus as realBudgetStatus, recordTestJudgeCost } from '../cost-budget.mjs';
import { createChecker, LIMIT_TEXT } from './checker.mjs';
import { statusWith, num, handleWith, routeOn, wid, by, exampleOf } from './route-helpers.mjs';

const STATUS = statusWith({ FAILED: 500 });   // the codes Part 2 answers too (route-helpers.mjs, NOT_VERSIONABLE: N4) and Part 4's own
const W = '/api/workflows/:id/tests';
/** Every Part 4 route: the flag-off test walks it (the order here is not the registration order). Later tasks append theirs. */
export const CRITERIA_ROUTES = Object.freeze([
  ['GET', `${W}/judge-models`],
  ['GET', `${W}/trust`],
  ['POST', `${W}/judgements/:j/answer`],
  ['GET', `${W}/runs/:run/criteria`],
  ['POST', `${W}/runs/:run/criteria/check`],
  ['PUT', `${W}/examples/:ex/liked`],
  ['DELETE', `${W}/examples/:ex/liked`],
  ['POST', `${W}/examples/:ex/checker`],
  ['GET', `${W}/examples/:ex/checker/:round`],
  ['POST', `${W}/examples/:ex/checker/:round/answers`],
  ['POST', `${W}/examples/:ex/checker/:round/reword`],
  ['POST', '/api/workflow-tests/suggest-criteria'],
  ['GET', `${W}/examples/:ex/criteria`],
].map(([method, path]) => Object.freeze({ method, path })));

/** Part 2's wrapper (route-helpers.mjs) with Part 4's codes: an error's `errors` list reaches the response. Exported for its unit test. */
export const handle = handleWith(STATUS);

export function registerCriteriaRoutes(app, { runner = null, criteriaJudge = null, deps = {} } = {}) {
  const gate = requireFlag('workflowTests');
  const route = routeOn(app, gate, handle);
  /** A judgement of this workflow, or 404. */
  const judgement = (req) => {
    const j = cs.readJudgement(num(req.params.j, 'answer'));
    if (!j || j.workflowId !== wid(req)) throw store.testError(`no answer ${req.params.j}`, 'NOT_FOUND');
    return j;
  };
  /** Final review M5: a write here sends the workflow's changed frame, as Part 2's runner does (D33: silent while the flag is off;
   *  `testRunId` when the write belongs to one test's try, never `runId`), so the list, the trust report and that test's pages repaint. */
  const changed = (workflowId, testRunId = null) => {
    if (!flagEnabled('workflowTests')) return;
    try { (deps.broadcast || (() => {}))({ type: 'workflow-tests-changed', workflowId, ...(testRunId != null ? { testRunId } : {}) }); } catch { /* a frame only */ }
  };

  // D96: Agree / Disagree (and Right / Wrong) on one verdict; null takes it back.
  route('POST', `${W}/judgements/:j/answer`, async (req, res) => {
    const j = judgement(req);
    const agree = req.body ? req.body.agree : undefined;
    if (agree !== true && agree !== false && agree !== null) throw store.testError('agree must be true, false or null', 'BAD_REQUEST');
    if (j.roundId != null) {   // a Check the checker card goes through its round: same rules, and the round is done the same way
      const r = cs.readRound(j.roundId);
      if (!r) throw store.testError(`no round ${j.roundId}`, 'NOT_FOUND');
      if (agree === null) throw store.testError('an answer on a Check the checker card cannot be taken back', 'BAD_REQUEST');
      await checker.answer(r, j.id, agree, { by: by(req) });
    } else {
      cs.setAnswer(j.id, { agree, by: by(req) });
    }
    const t = j.tryId != null ? store.readTry(j.tryId) : null;
    changed(j.workflowId, t ? t.runId : null);
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
    // Board 59 C: `stoppable` = the check is "Check them on these tries" (its band has "Stop checking"), not a running test's own phase.
    const stoppable = !!(runner && runner.criteriaCheckOf(run.id));
    res.json({ ...byCriterionOf(wid(req), run), checking: stoppable || !!(runner && runner.criteriaPhaseOf(run.id)), stoppable });
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
  // Task 18 (boards 2, 32): how far Worca's checking of each of the example's criteria is trusted, for the editor's rows.
  route('GET', `${W}/examples/:ex/criteria`, async (req, res) => res.json({ trust: trustOfExample(exampleOf(req)) }));
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
    changed(wid(req));
    res.json({ example: store.readExample(wid(req), ex.id) });
  });
  route('DELETE', `${W}/examples/:ex/liked`, async (req, res) => {
    const ex = exampleOf(req);
    cs.deleteLiked(ex.id);
    changed(wid(req));
    res.json({ example: store.readExample(wid(req), ex.id) });
  });
  // D97: Check the checker. The spending limit is refused up front inside checker.start (not for a mock round, which pays nothing).
  const checker = deps.checker || createChecker({ budgetStatus: deps.budgetStatus || realBudgetStatus, changed: (r) => changed(r.workflowId) });
  const roundOf = (req, ex) => {
    const r = cs.readRound(num(req.params.round, 'round'));
    if (!r || r.workflowId !== wid(req) || r.exampleId !== ex.id) throw store.testError(`no round ${req.params.round}`, 'NOT_FOUND');
    return r;
  };
  route('POST', `${W}/examples/:ex/checker`, async (req, res) => {
    const ex = exampleOf(req);
    res.status(201).json({ round: await checker.start({ workflowId: wid(req), exampleId: ex.id, criterionId: String((req.body || {}).criterionId || ''), by: by(req) }) });
  });
  route('GET', `${W}/trust`, async (req, res) => res.json(trustReportOf(wid(req), { checker })));
  route('GET', `${W}/examples/:ex/checker/:round`, async (req, res) => { const ex = exampleOf(req); res.json(checker.view(roundOf(req, ex), { by: by(req) })); });
  route('POST', `${W}/examples/:ex/checker/:round/answers`, async (req, res) => {
    const ex = exampleOf(req);
    const b = req.body || {};
    if (typeof b.right !== 'boolean') throw store.testError('right must be true or false', 'BAD_REQUEST');
    const out = await checker.answer(roundOf(req, ex), num(b.judgementId, 'card'), b.right, { by: by(req) });
    changed(wid(req));   // the last answer makes the round done
    res.json(out);
  });
  route('POST', `${W}/examples/:ex/checker/:round/reword`, async (req, res) => {
    const ex = exampleOf(req);
    const out = await checker.reword(roundOf(req, ex), { by: by(req) });
    if (out.error === 'limit') throw store.testError(LIMIT_TEXT, 'NOT_READY');
    if (out.error) { console.warn(`[workflow-tests] clearer words failed: ${out.detail || out.error}`); throw store.testError('Worca could not suggest clearer words this time. Try again.', 'FAILED'); }   // the detail is logged, never sent
    res.json({ text: out.text });
  });
  // D102, P4-Q10: board 3's suggestions; the model is the suggested checking model (P4-Q3: no example exists yet).
  route('POST', '/api/workflow-tests/suggest-criteria', async (req, res) => {
    const b = req.body || {};
    const workflowId = String(b.workflowId || '');
    const note = typeof b.note === 'string' ? b.note.trim().slice(0, 2000) : '';
    if (!workflowId || note.length < 20) throw store.testError('write at least 20 characters about what a good result has', 'BAD_REQUEST');
    workflowRowOf(workflowId);   // final review M9: never a paid call booked to a workflow that does not exist (404)
    const view = await (deps.judgeModelsView || judgeModelsView)(workflowId);
    if (!view.suggested) throw store.testError('no AI model can check criteria here', 'NOT_READY');
    // M17: only a past run of this workflow that can become its example is read and sent to the model (as from-run checks it).
    let past = null;
    if (b.pipelineId != null && b.pipelineId !== '' && typeof b.pipelineId !== 'string') throw store.testError('pipelineId must be a run id', 'BAD_REQUEST');
    if (b.pipelineId) {
      // Only Worca's own refusals (an error with a code mapped to a status) become a 400; anything else is a real failure and surfaces.
      try { past = await usablePastRun(workflowId, b.pipelineId); } catch (e) {
        if (e && STATUS[e.code]) throw store.testError(e.message || 'this run cannot be used', 'BAD_REQUEST');
        throw e;
      }
    }
    const mock = (deps.mock || (() => mockEnabled({})))();
    // The total spending limit, refused up front (a mock call pays nothing, so it is never refused).
    if (!mock && (deps.budgetStatus || realBudgetStatus)().blocked) throw store.testError(LIMIT_TEXT, 'NOT_READY');
    const m = past ? await mainResult(past.pipelineId) : { text: '' };
    const model = view.suggested.id;
    const existing = Array.isArray(b.existing) ? b.existing.filter((x) => typeof x === 'string').slice(0, 12) : [];
    const book = deps.book || recordTestJudgeCost;
    const out = await suggestCriteria({ note, request: past ? past.request : '', result: m.text || '', existing, model, mock,
      book: (usd, costKind) => book({ workflowId, purpose: 'suggest', model, amountUsd: usd, costKind }) },
    { ...(deps.modelCall ? { modelCall: deps.modelCall } : {}), budget: deps.budgetStatus || realBudgetStatus, mock: () => mock });
    // A failed call is an error, not an empty answer (the cost is already booked); no detail reaches the client.
    if (out.error === 'failed') { console.warn(`[workflow-tests] suggestions failed: ${out.detail || out.error}`); throw store.testError('Worca could not get suggestions this time. Try again.', 'FAILED'); }
    if (out.error === 'limit') throw store.testError(LIMIT_TEXT, 'NOT_READY');
    res.json({ suggestions: out.suggestions });
  });
  return { runner, criteriaJudge, deps };
}
