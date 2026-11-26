// src/core/workflow-tests/start.mjs — workflow tests: what ui/server.mjs's run start and boot do for a test try
// (plans/workflow-tests-part2-plan.md D20–D23, D27; plans/workflow-tests-part3a-plan.md D42, D43, D55, D61). The residual
// server keeps one call per seam: the start route reads the try, refuses a bad one and spreads its run options; boot
// maintenance calls the two recoveries below. The words a try is refused with live in src/shared/workflow-tests/project-text.mjs.
import { PROJECT_KEY_RE, testCopyKeyOf } from '../store.mjs';
import { sweepStaleStagingDirs } from './try-spawn.mjs';
import { CONNECTOR_MODES, recoverInterruptedTestRuns, readTestRun, spentOfRun } from './store.mjs';
import { createCriteriaJudge } from './criteria-runner.mjs';
import { sweepTestCopies } from './project-copy.mjs';
import { recoverRounds } from './criteria-store.mjs';
import { sweepBeforeRuns } from './before-run.mjs';
import { SETUP_TIMEOUT_MS } from './shell-step.mjs';

export { TRY_NEVER_SHIPS_TEXT, TRY_NEEDS_GIT_TEXT, TEST_TRY_PAUSE_TEXT, TEST_TRY_RESUME_TEXT } from '../../shared/workflow-tests/project-text.mjs';

/**
 * The test try a start carries: set in-process by the test runner through invokeStartRun only, never from HTTP.
 * { use: 'draft' | n, connectors?: 'pretend' | 'real', project?: { key, setupCmd? }, onOrch?(orch, { runKey }) }.
 */
export function workflowTestOf(req) {
  return req._workflowTest && typeof req._workflowTest === 'object' ? req._workflowTest : null;
}

/** 3a (D42): a project try runs in Worca's copy of the project it names (project.key), never in a person's folder; the copy
 *  is never a registered project, so the key travels in-process with it. */
const tryProjectOf = (workflowTest) => (workflowTest && workflowTest.project && typeof workflowTest.project === 'object' ? workflowTest.project : null);

/** Why the start route refuses this try (400), or null. Null for a run that is not a try. */
export function tryStartRefusal(workflowTest, body) {
  if (!workflowTest) return null;
  const tryProject = tryProjectOf(workflowTest);
  if (!(body.noProject === true
    || (tryProject && typeof tryProject.key === 'string' && PROJECT_KEY_RE.test(tryProject.key)
      && typeof body.projectDir === 'string' && testCopyKeyOf(body.projectDir) === tryProject.key))) {
    return "a test try runs without a project, or in Worca's copy of one";
  }
  if (body.sameAsSource === true || body.scheduledFor != null || body.repeat != null || body.after != null || body.workspaceId) {
    return 'a test try starts now, on a branch of its own';
  }
  if (tryProject && tryProject.setupCmd != null && (typeof tryProject.setupCmd !== 'string' || /[\r\n]/.test(tryProject.setupCmd))) {
    return 'a test try names its setup command on one line';
  }
  if (!(workflowTest.use === 'draft' || (Number.isInteger(workflowTest.use) && workflowTest.use > 0))) {
    return 'a test try names the draft or a version number';
  }
  if (workflowTest.connectors !== undefined && !CONNECTOR_MODES.includes(workflowTest.connectors)) {
    return 'a test try names its connectors: pretend or real';
  }
  return null;
}

/**
 * The orchestrator options of a try, spread last into the run's options ({} for a run that is not a try).
 * D19/D21/D23: the version under test, the row's mark, no memory, and the fixed title (no smart naming spend); D35: pretend
 * connectors unless real is named. 3a (D21, D43, D55), `project`: a project try keeps its checkout for its checks and runs
 * its setup before any step. Its key is the real project's: projectKey() answers it for the copy (D52).
 */
export function tryRunOptions(workflowTest, { project = false } = {}) {
  if (!workflowTest) return {};
  const tryProject = tryProjectOf(workflowTest);
  return {
    workflowUse: workflowTest.use, workflowTest: true, noMemory: true, titleLocked: true,
    testConnectors: workflowTest.connectors === 'real' ? 'real' : 'pretend',
    ...(project ? { keepCheckout: true,
      ...(tryProject && tryProject.setupCmd ? { trySetup: { cmd: tryProject.setupCmd, timeoutMs: SETUP_TIMEOUT_MS } } : {}) } : {}),
  };
}

/** Correction 7: the runner holds the orchestrator before orch.run() can ask anything. A throw reaches the start route,
 *  which then unregisters the run. */
export function holdTryOrch(workflowTest, orch, runKey) {
  if (workflowTest && typeof workflowTest.onOrch === 'function') workflowTest.onOrch(orch, { runKey });
}

/**
 * Boot, before boot maintenance's first await (it is not awaited before listen), so synchronous. Never throws.
 * D27, review M4: a test this restart cut short is stopped; its tries keep their cost and their runs lose their resume
 * points. 3b, Task 5 (security review M2): Claude staging folders a killed Worca left in the OS temp folder (they may hold a
 * Pretend try's carried sign-in helpers); only folders older than a day, as another Worca may share the folder.
 * M18: a Check the checker round a restart left `making` is failed too, so the page stops polling it.
 * Part 4 (Task 21 fix round 2): each stopped test records the criteria its finished tries never had checked ('failed'), so they
 * read 'unchecked', never 'new' (criteria-runner.mjs leaveUnchecked; synchronous store work); 'cap' for one at its own cost limit.
 * @returns {{runs: number, rounds: number, stagingDirs: number}} what was stopped and removed (0 when a sweep failed)
 */
export function recoverTestsAtBoot({ tmpDir } = {}) {
  const out = { runs: 0, rounds: 0, stagingDirs: 0 };
  let runIds = [];
  try {
    ({ runs: out.runs, runIds } = recoverInterruptedTestRuns());
    if (out.runs) console.log(`[worca-ui] workflow tests: ${out.runs} interrupted test(s) stopped`);
  } catch (err) {
    console.error(`[worca-ui] workflow tests sweep failed: ${err && err.message ? err.message : err}`);
  }
  const judge = runIds.length ? createCriteriaJudge() : null;
  for (const id of runIds) {
    try {
      const run = readTestRun(id);
      // Fix round 3 (M7): a test that had reached its own cost limit says so ('cap'); any other one a restart cut short is 'failed'.
      if (run) judge.leaveUnchecked(run, { error: run.capUsd !== null && spentOfRun(run.id) >= run.capUsd ? 'cap' : 'failed' });
    } catch (err) {
      console.error(`[worca-ui] workflow tests: could not record the unchecked criteria of test ${id}: ${err && err.message ? err.message : err}`);
    }
  }
  try {
    out.rounds = recoverRounds();
    if (out.rounds) console.log(`[worca-ui] workflow tests: ${out.rounds} unfinished check-the-checker round(s) stopped`);
  } catch (err) {
    console.error(`[worca-ui] check-the-checker round recovery failed: ${err && err.message ? err.message : err}`);
  }
  try {
    out.stagingDirs = sweepStaleStagingDirs({ dir: tmpDir }).length;
    if (out.stagingDirs) console.log(`[worca-ui] removed ${out.stagingDirs} leftover Claude staging folder(s)`);
  } catch (err) {
    console.error(`[worca-ui] Claude staging folder sweep failed: ${err && err.message ? err.message : err}`);
  }
  return out;
}

/**
 * Boot, after the run-root sweep (3a D61): every copy of a project prunes the worktrees that sweep removed and loses its
 * leftover try branches. Then 3b (D75): before runs a restart left (their owner process is gone), and kept results older
 * than a week. Nothing tries at boot. Never rejects.
 * @returns {Promise<{copies: number, branches: number, beforeRuns: {runs: number, kept: number}|null}|null>} null when the
 *   copy sweep failed; `beforeRuns` is null when the before-run sweep failed
 */
export async function sweepTestCopiesAtBoot(log) {
  let out = null;
  try {
    out = await sweepTestCopies({ log });
  } catch (err) {
    console.error(`[worca-ui] workflow tests copy sweep failed: ${err && err.message ? err.message : err}`);
  }
  let beforeRuns = null;
  try {
    beforeRuns = await sweepBeforeRuns({ log });
  } catch (err) {
    console.error(`[worca-ui] workflow tests before-run sweep failed: ${err && err.message ? err.message : err}`);
  }
  return out ? { ...out, beforeRuns } : null;
}
