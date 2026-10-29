// src/core/workflow-tests/try-body.mjs
// THE seam for what a try runs on (plans/workflow-tests-part2-plan.md D20). Part 2 tries a workflow without a project,
// in the run's own private work folder. Part 3a adds the project branch: the try runs in Worca's copy of the example's
// project (D42).
import { graphNeedsRepo } from '../workflows.mjs';

/** 3a (D62, replaces D20): every workflow can be tested; whether it needs a project decides what its examples need. */
export function testTargetOf(graph, registry) {
  return { testable: true, reason: null, needsProject: graphNeedsRepo(graph, registry) };
}

/**
 * 3a (D62): whether one example can be tried on a version. `state` is its project's state now (service.projectStateOf),
 * null for an example without a project.
 * @returns {{ready: boolean, reason: null|'pick-project'|'missing'|'folder'|'not-registered'}}
 */
export function exampleReadiness({ needsProject, example, state }) {
  if (!example || !example.project) return needsProject ? { ready: false, reason: 'pick-project' } : { ready: true, reason: null };
  return state === 'ok' ? { ready: true, reason: null } : { ready: false, reason: state || 'not-registered' };
}

/** A fixed title (smart naming never runs for a try, correction 6). */
export function tryTitle(example, tryNo) {
  return `Test: ${example.name} · try ${tryNo}`;
}

/**
 * The /api/run body of one try, startRunHandler's shape. The files ride base64 as `extras`, as the New run form sends
 * them. The draft or the version (`use`) travels in-process through invokeStartRun's workflowTest, never in this body.
 * 3a (D42): a try of an example with a project runs in Worca's copy of that project, from the example's start commit.
 * @param {{name: string, request: string}} example
 * @param {Array<{name: string, data: Buffer}>} files
 * @param {{workflowId: string, tryNo: number, mock?: boolean, quick?: boolean, project?: {copyDir: string, startCommit: string}|null}} opts
 *   quick = the free quick check (a mock run)
 */
export function tryRunBody(example, files, { workflowId, tryNo, mock = false, quick = false, project = null }) {
  return {
    ...(project ? { projectDir: project.copyDir, sourceBranch: project.startCommit } : { noProject: true }),
    workflowId,
    prompt: example.request,
    title: quick ? `Quick check: ${example.name}` : tryTitle(example, tryNo),
    extras: (files || []).map((f) => ({ name: f.name, dataBase64: Buffer.from(f.data).toString('base64') })),
    ...(mock || quick ? { mock: true } : {}),
  };
}
