// src/core/workflow-tests/routes.mjs — HTTP for workflow tests (plans/workflow-tests-part2-plan.md Task 9). Every route
// is behind the workflowTests flag, and so is the `workflow-tests-changed` frame (D33).
import { requireFlag, flagEnabled } from '../flags.mjs';
import { actorOf } from '../identity.mjs';
import { loadScriptRegistry } from '../script-registry.mjs';
import * as store from './store.mjs';
import * as service from './service.mjs';
import { createTestRunner } from './runner.mjs';
import { readTryOutcome, checkTry } from './result.mjs';
import { useFingerprint } from './uses.mjs';
import { dirBytes, freeDiskBytes } from './project-copy.mjs';
import { listProjects } from '../projects.mjs';
import { beforeRun } from './before-run.mjs';

const STATUS = Object.freeze({ BAD_REQUEST: 400, NOT_VERSIONABLE: 400, NOT_FOUND: 404, BUSY: 409, NOT_READY: 422, NO_DISK: 422 });
const W = '/api/workflows/:id/tests';
/** Every route, in registration order: the flag-off test walks it, so no route can skip the gate unnoticed. */
export const WORKFLOW_TEST_ROUTES = Object.freeze([
  ['GET', W], ['POST', `${W}/examples`], ['POST', `${W}/examples/from-run`], ['POST', `${W}/examples/from-runs`],
  ['GET', `${W}/examples/:ex`], ['PUT', `${W}/examples/:ex`], ['DELETE', `${W}/examples/:ex`],
  ['POST', `${W}/examples/:ex/files`], ['DELETE', `${W}/examples/:ex/files/:name`], ['POST', `${W}/examples/:ex/try-once`],
  ['GET', `${W}/plan`], ['POST', `${W}/runs`], ['GET', `${W}/runs/:run`], ['POST', `${W}/runs/:run/stop`],
  ['POST', `${W}/runs/:run/continue`], ['GET', `${W}/runs/:run/compare`], ['GET', `${W}/runs/:run/examples/:ex`],
  ['GET', `${W}/runs/:run/tries/:try/result`], ['GET', '/api/workflow-tests/past-run/:pipelineId'],
  ['GET', '/api/workflow-tests/projects'], ['GET', '/api/workflow-tests/projects/:key/branches'],
  ['POST', `${W}/examples/:ex/project/latest`], ['GET', `${W}/runs/:run/tries/:try/changes`],
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
 *   `connectorsPreview(scope)` → { copies: [{ name, untested }], fileServers: string[] } (untested = no stand-in on a pretend try;
 *   scope = { key, name, projectDir } of the one project a test's examples work on, else null)
 */
export function registerWorkflowTestRoutes(app, { broadcast = () => {}, deps = {} } = {}) {
  const gate = requireFlag('workflowTests');
  const scriptName = (key) => { try { return (loadScriptRegistry()[key] || {}).displayName || key; } catch { return key; } };
  const runner = createTestRunner({
    ...deps,
    outcomeOf: (pipelineId, o) => readTryOutcome(pipelineId, o),
    judge: (example, outcome, o = {}) => checkTry(example, outcome, { scriptName, onCommand: o.onCommand, beforeOf: o.beforeOf }),
    // 3b (D75): the command on each project example's start point, before the tries (a test may pass its own).
    beforeRun: deps.beforeRun || ((spec, o) => beforeRun(spec, o)),
    fingerprintOf: (workflowId, use) => useFingerprint(workflowId, use),
    // D62 (replaces D20 and review M9): each example on each version.
    // The runner reads the registry once per start (listProjects) and hands it to both.
    listProjects: () => listProjects(),
    targetOf: (workflowId, use, example, o = {}) => service.targetFor(workflowId, use, example, { projects: o.projects || null }),
    // A test may pass its own (the try-once NO_DISK route's test); the server never does.
    diskCheck: deps.diskCheck || (({ examples, tries, uses, counts = null, projects = null }) =>
      service.diskPlanOf(examples, { tries, sides: uses.length, counts, projects })),
    prepareProject: (example) => service.prepareProject(example),
    cleanupTry: (outcome) => service.cleanupTry(outcome),
    measureDisk: (dir) => dirBytes(dir),
    freeDisk: () => freeDiskBytes(),
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
  // 3a D62 (replaces D20): every saved user workflow can be tested, so the start routes only check that it is one (404, 400);
  // whether each example can be tried is the runner's (targetOf).
  const knownWorkflow = (req) => { service.workflowRowOf(wid(req)); };
  const example = (req) => {
    const ex = store.readExample(wid(req), num(req.params.ex, 'example'));
    if (!ex) throw store.testError(`no example ${req.params.ex}`, 'NOT_FOUND');
    return ex;
  };

  route('GET', W, async (req, res) => res.json(await service.testsOverview(wid(req))));
  route('POST', `${W}/examples`, async (req, res) => {
    service.workflowRowOf(wid(req));
    res.status(201).json({ example: await service.saveExample(wid(req), null, req.body || {}, { by: by(req) }) });
  });
  route('POST', `${W}/examples/from-run`, async (req, res) => {
    service.workflowRowOf(wid(req));
    const b = req.body || {};
    res.status(201).json(await service.exampleFromRun(wid(req), { pipelineId: String(b.pipelineId || ''), name: b.name,
      keepRequest: b.keepRequest !== false, keepAnswers: b.keepAnswers !== false, verdict: b.verdict ?? null,
      note: typeof b.note === 'string' ? b.note : null, setupCmd: typeof b.setupCmd === 'string' ? b.setupCmd : null }, { by: by(req) }));
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
    res.json({ example: await service.saveExample(wid(req), num(req.params.ex, 'example'), req.body || {}) });
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
    knownWorkflow(req);
    const ex = example(req);
    let run;
    try {
      run = await runner.start({ workflowId: wid(req), kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1, reuseB: false,
        connectors: 'pretend', by: by(req) });   // D35: Try it once now always pretends
    } catch (e) {
      // Board 39: the editor shows its own card with the disk row, so the refusal carries the numbers the runner worked out.
      if (!e || e.code !== 'NO_DISK') throw e;
      res.status(422).json({ error: e.message, code: 'NO_DISK', disk: e.disk || null });
      return;
    }
    res.status(201).json({ run });
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
    knownWorkflow(req);
    const b = req.body || {};
    const a = store.parseUse(b.a);
    const bb = store.parseUse(b.b);
    if (!a || !bb) throw store.testError('pick the two versions to compare', 'BAD_REQUEST');
    res.status(201).json({ run: await runner.start({ workflowId: wid(req), kind: 'compare', a, b: bb,
      exampleIds: Array.isArray(b.exampleIds) ? b.exampleIds.map((x) => num(x, 'example')) : [], tries: Number(b.tries), reuseA: b.reuseA !== false, reuseB: b.reuseB === true,
      quickCheck: b.quickCheck === true, capUsd: usdOf(b.capUsd), connectors: b.connectors === undefined ? 'pretend' : b.connectors, by: by(req) }) });
  });
  route('GET', `${W}/runs/:run`, async (req, res) => {
    const p = service.progressOf(wid(req), num(req.params.run, 'test'), { costOf: runner.costOf, phaseOf: runner.phaseOf,
      beforeNowOf: runner.beforeNowOf });
    if (p.project) p.project.disk = await service.progressDisk(wid(req), p.run, { diskOf: runner.diskOf });
    if (p.project && p.project.setupStop) p.project.setupStop.edited = await service.progressEdited(wid(req), p.run);
    res.json(p);
  });
  route('POST', `${W}/runs/:run/stop`, async (req, res) => {
    const run = service.runOf(wid(req), num(req.params.run, 'test'));
    res.json({ run: await runner.stop(run.id) });
  });
  route('POST', `${W}/runs/:run/continue`, async (req, res) => {
    knownWorkflow(req);   // as the start routes: the workflow may be gone
    const run = service.runOf(wid(req), num(req.params.run, 'test'));
    res.json({ run: await runner.continueRun(run.id, { capUsd: usdOf(req.body && req.body.capUsd) }) });
  });
  route('GET', `${W}/runs/:run/compare`, async (req, res) => res.json(await service.compareOf(wid(req), num(req.params.run, 'test'))));
  route('GET', `${W}/runs/:run/examples/:ex`, async (req, res) => {
    const ex = example(req);
    // P9: board 37's "… on GitHub", for the remotes the guarded pushes named (git remote get-url, read only)
    const forgeFor = ex.project ? (names) => service.forgeNamer(ex.project.key, names) : null;
    res.json(await service.sideBySide(wid(req), num(req.params.run, 'test'), ex.id, { forgeFor }));
  });
  route('GET', `${W}/runs/:run/tries/:try/result`, async (req, res) =>
    res.json(await service.tryResult(wid(req), num(req.params.run, 'test'), num(req.params.try, 'try'))));
  route('GET', '/api/workflow-tests/past-run/:pipelineId', async (req, res) => res.json(await service.pastRunSummary(String(req.params.pipelineId || ''))));
  // 3a: the editor's projects and a project's branches (read only), "Start from the latest" (D63), a try's whole diff.
  route('GET', '/api/workflow-tests/projects', async (_req, res) => res.json(await service.projectsForTests()));
  route('GET', '/api/workflow-tests/projects/:key/branches', async (req, res) => res.json(await service.projectBranches(String(req.params.key || ''))));
  route('POST', `${W}/examples/:ex/project/latest`, async (req, res) => {
    service.workflowRowOf(wid(req));
    res.json({ example: await service.startFromLatest(wid(req), num(req.params.ex, 'example')) });
  });
  route('GET', `${W}/runs/:run/tries/:try/changes`, async (req, res) =>
    res.json(await service.tryChanges(wid(req), num(req.params.run, 'test'), num(req.params.try, 'try'))));
  return { runner };
}
