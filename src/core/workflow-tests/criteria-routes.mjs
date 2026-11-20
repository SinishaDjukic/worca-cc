// src/core/workflow-tests/criteria-routes.mjs — HTTP for Part 4 (plans/workflow-tests-part4-plan.md). Every route is behind the
// workflowTests flag (D107). Registered by ui/routes/workflows/workflow-tests.mjs after Part 2's routes.
import { requireFlag } from '../flags.mjs';
import { actorOf } from '../identity.mjs';
import * as store from './store.mjs';
import * as cs from './criteria-store.mjs';
import { trustFor } from './criteria-read.mjs';
import { judgeModelsView } from './judge-models.mjs';

const STATUS = Object.freeze({ BAD_REQUEST: 400, NOT_FOUND: 404, BUSY: 409, NOT_READY: 422 });
const W = '/api/workflows/:id/tests';
/** Every Part 4 route, in registration order: the flag-off test walks it. Later tasks append theirs. */
export const CRITERIA_ROUTES = Object.freeze([
  ['POST', `${W}/judgements/:j/answer`],
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
    cs.setAnswer(j.id, { agree, by: by(req) });
    res.json({ answer: cs.answerOf(j.id, by(req)), trust: j.purpose === 'pair' ? null : trustFor(j.workflowId, j.fp, j.model) });
  });
  // D87, D105: the Claude models that can check criteria, and the suggested one.
  route('GET', `${W}/judge-models`, async (req, res) => res.json(await judgeModelsView(wid(req))));
  void exampleOf;   // defined here for Task 18 (4a) and Tasks 12-15 (4b), which use it
  return { runner, criteriaJudge, deps };
}
