// src/core/workflow-tests/routes.mjs — HTTP for workflow tests (plans/workflow-tests-part2-plan.md Task 9). Every route
// is behind the workflowTests flag, and so is the `workflow-tests-changed` frame (D33).
import { requireFlag, flagEnabled } from '../flags.mjs';
import { actorOf } from '../identity.mjs';
import { loadScriptRegistry } from '../script-registry.mjs';
import * as store from './store.mjs';
import * as service from './service.mjs';
import { createTestRunner } from './runner.mjs';
import { readTryOutcome, checkTry } from './result.mjs';
import { useFingerprint, useGraph } from './uses.mjs';
import { testTargetOf } from './try-body.mjs';
import { loadAgentRegistry } from '../agent-registry.mjs';

const STATUS = Object.freeze({ BAD_REQUEST: 400, NOT_VERSIONABLE: 400, NOT_FOUND: 404, BUSY: 409, NOT_TESTABLE: 422 });
const W = '/api/workflows/:id/tests';
/** Every route, in registration order: the flag-off test walks it, so no route can skip the gate unnoticed. */
export const WORKFLOW_TEST_ROUTES = Object.freeze([
  ['GET', W], ['POST', `${W}/examples`], ['POST', `${W}/examples/from-run`], ['POST', `${W}/examples/from-runs`],
  ['GET', `${W}/examples/:ex`], ['PUT', `${W}/examples/:ex`], ['DELETE', `${W}/examples/:ex`],
  ['POST', `${W}/examples/:ex/files`], ['DELETE', `${W}/examples/:ex/files/:name`], ['POST', `${W}/examples/:ex/try-once`],
  ['GET', `${W}/plan`], ['POST', `${W}/runs`], ['GET', `${W}/runs/:run`], ['POST', `${W}/runs/:run/stop`],
  ['POST', `${W}/runs/:run/continue`], ['GET', `${W}/runs/:run/compare`], ['GET', `${W}/runs/:run/examples/:ex`],
  ['GET', `${W}/runs/:run/tries/:try/result`], ['GET', '/api/workflow-tests/past-run/:pipelineId'],
].map(([method, path]) => Object.freeze({ method, path })));

const num = (v, what) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw store.testError(`${what} must be a whole number`, 'BAD_REQUEST');
  return n;
};
const usdOf = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

/**
 * @param {import('express').Express} app
 * @param {{broadcast?: Function, deps: {startRun: Function, liveRun: Function, stopRun: Function, answer: Function, mockMode?: Function,
 *   connectorsPreview?: Function}}} opts `liveRun(runKey)` → { orch, status, launch, pipelineId, pauseReason, pauseDetail } | null;
 *   `connectorsPreview()` → { copies: [{ name, untested }], fileServers: string[] } (untested = no stand-in on a pretend try)
 */
export function registerWorkflowTestRoutes(app, { broadcast = () => {}, deps = {} } = {}) {
  const gate = requireFlag('workflowTests');
  const scriptName = (key) => { try { return (loadScriptRegistry()[key] || {}).displayName || key; } catch { return key; } };
  const runner = createTestRunner({
    ...deps,
    outcomeOf: (pipelineId, o) => readTryOutcome(pipelineId, o),
    judge: (example, outcome) => checkTry(example, outcome, { scriptName }),
    fingerprintOf: (workflowId, use) => useFingerprint(workflowId, use),
    // Review M9 (D20): a saved version on either side may need a project, even when the draft does not.
    targetOf: async (workflowId, use) => {
      const g = await useGraph(workflowId, use);
      return g ? testTargetOf(g, loadAgentRegistry()) : { testable: true, reason: null };
    },
    notify: (frame) => {
      if (!flagEnabled('workflowTests')) return;   // D33: silent while the flag is off
      broadcast(frame.finished ? { ...frame, title: service.finishedText(frame.workflowId, frame.testRunId) } : frame);
    },
  });
  // No recovery here (review M4): this runs at every import of server.mjs. bootMaintenance calls recoverInterruptedTestRuns().

  const handle = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) {
      res.status(STATUS[e && e.code] || 500).json({ error: e && e.message ? e.message : String(e), ...(e && Array.isArray(e.errors) ? { errors: e.errors } : {}) });
    }
  };
  const route = (method, path, fn) => app[method.toLowerCase()](path, gate, handle(fn));
  const wid = (req) => String(req.params.id || '');
  const by = (req) => actorOf(req) || null;
  const testable = (req) => {
    const t = service.testTarget(wid(req));
    if (!t.testable) throw store.testError(service.NOT_TESTABLE_TEXT, 'NOT_TESTABLE');
  };
  const example = (req) => {
    const ex = store.readExample(wid(req), num(req.params.ex, 'example'));
    if (!ex) throw store.testError(`no example ${req.params.ex}`, 'NOT_FOUND');
    return ex;
  };

  route('GET', W, async (req, res) => res.json(await service.testsOverview(wid(req))));
  route('POST', `${W}/examples`, async (req, res) => {
    service.workflowRowOf(wid(req));
    res.status(201).json({ example: store.createExample(wid(req), req.body || {}, { by: by(req) }) });
  });
  route('POST', `${W}/examples/from-run`, async (req, res) => {
    service.workflowRowOf(wid(req));
    const b = req.body || {};
    res.status(201).json(await service.exampleFromRun(wid(req), { pipelineId: String(b.pipelineId || ''), name: b.name,
      keepRequest: b.keepRequest !== false, keepAnswers: b.keepAnswers !== false, verdict: b.verdict ?? null,
      note: typeof b.note === 'string' ? b.note : null }, { by: by(req) }));
  });
  route('POST', `${W}/examples/from-runs`, async (req, res) => {
    service.workflowRowOf(wid(req));
    const ids = Array.isArray(req.body && req.body.pipelineIds) ? req.body.pipelineIds.map(String).slice(0, 20) : [];
    if (!ids.length) throw store.testError('pick at least one run', 'BAD_REQUEST');
    res.status(201).json(await service.examplesFromRuns(wid(req), ids, { by: by(req) }));
  });
  route('GET', `${W}/examples/:ex`, async (req, res) => res.json({ example: example(req) }));
  // A deleted workflow's examples stay in the store (deleteWorkflow does not cascade): they are not edited.
  route('PUT', `${W}/examples/:ex`, async (req, res) => {
    service.workflowRowOf(wid(req));
    res.json({ example: store.updateExample(wid(req), num(req.params.ex, 'example'), req.body || {}) });
  });
  route('DELETE', `${W}/examples/:ex`, async (req, res) => {
    service.workflowRowOf(wid(req));
    store.deleteExample(wid(req), num(req.params.ex, 'example'));
    res.json({ ok: true });
  });
  route('POST', `${W}/examples/:ex/files`, async (req, res) => {
    service.workflowRowOf(wid(req));
    const b = req.body || {};
    if (typeof b.dataBase64 !== 'string' || !b.dataBase64) throw store.testError('the file is empty', 'BAD_REQUEST');
    res.json({ example: store.putExampleFile(wid(req), num(req.params.ex, 'example'), { name: b.name, data: Buffer.from(b.dataBase64, 'base64') }) });
  });
  route('DELETE', `${W}/examples/:ex/files/:name`, async (req, res) => {
    service.workflowRowOf(wid(req));
    res.json({ example: store.deleteExampleFile(wid(req), num(req.params.ex, 'example'), String(req.params.name)) });
  });
  route('POST', `${W}/examples/:ex/try-once`, async (req, res) => {
    testable(req);
    const ex = example(req);
    res.status(201).json({ run: await runner.start({ workflowId: wid(req), kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1, reuseB: false,
      connectors: 'pretend', by: by(req) }) });   // D35: Try it once now always pretends
  });
  route('GET', `${W}/plan`, async (req, res) => {
    const q = req.query || {};
    const ids = String(q.examples || '').split(',').filter(Boolean).map((x) => num(x, 'example'));
    const tries = q.tries ? num(q.tries, 'tries') : 3;
    // M8: no estimate for a test the start would refuse (runner.start's own limit and sentence).
    if (tries > store.MAX_TRIES) throw store.testError(`tries must be 1 to ${store.MAX_TRIES}`, 'BAD_REQUEST');
    res.json(await service.testPlan(wid(req), { a: q.a ? store.parseUse(String(q.a)) : null, b: store.parseUse(String(q.b || 'draft')) || 'draft',
      exampleIds: ids, tries, connectors: q.connectors === 'real' ? 'real' : 'pretend' },
    { mock: !!(deps.mockMode && deps.mockMode()), connectorsPreview: deps.connectorsPreview || null }));
  });
  route('POST', `${W}/runs`, async (req, res) => {
    testable(req);
    const b = req.body || {};
    const a = store.parseUse(b.a);
    const bb = store.parseUse(b.b);
    if (!a || !bb) throw store.testError('pick the two versions to compare', 'BAD_REQUEST');
    res.status(201).json({ run: await runner.start({ workflowId: wid(req), kind: 'compare', a, b: bb,
      exampleIds: Array.isArray(b.exampleIds) ? b.exampleIds.map((x) => num(x, 'example')) : [], tries: Number(b.tries), reuseA: b.reuseA !== false, reuseB: b.reuseB === true,
      quickCheck: b.quickCheck === true, capUsd: usdOf(b.capUsd), connectors: b.connectors === undefined ? 'pretend' : b.connectors, by: by(req) }) });
  });
  route('GET', `${W}/runs/:run`, async (req, res) => res.json(service.progressOf(wid(req), num(req.params.run, 'test'), { costOf: runner.costOf })));
  route('POST', `${W}/runs/:run/stop`, async (req, res) => {
    const run = service.runOf(wid(req), num(req.params.run, 'test'));
    res.json({ run: await runner.stop(run.id) });
  });
  route('POST', `${W}/runs/:run/continue`, async (req, res) => {
    testable(req);   // D20, as the start routes: the workflow may have changed to need a project, or be gone
    const run = service.runOf(wid(req), num(req.params.run, 'test'));
    res.json({ run: await runner.continueRun(run.id, { capUsd: usdOf(req.body && req.body.capUsd) }) });
  });
  route('GET', `${W}/runs/:run/compare`, async (req, res) => res.json(await service.compareOf(wid(req), num(req.params.run, 'test'))));
  route('GET', `${W}/runs/:run/examples/:ex`, async (req, res) =>
    res.json(await service.sideBySide(wid(req), num(req.params.run, 'test'), num(req.params.ex, 'example'))));
  route('GET', `${W}/runs/:run/tries/:try/result`, async (req, res) =>
    res.json(await service.tryResult(wid(req), num(req.params.run, 'test'), num(req.params.try, 'try'))));
  route('GET', '/api/workflow-tests/past-run/:pipelineId', async (req, res) => res.json(await service.pastRunSummary(String(req.params.pipelineId || ''))));
  return { runner };
}
