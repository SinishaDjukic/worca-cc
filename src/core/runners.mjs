// src/core/runners.mjs
// Runner registry: maps an agent's runnerType -> a function the dispatcher calls.
//
// There are exactly two runner types (CONTRACT):
//   - producer : generates artifacts/code (Plan, Refine, Implement, Manual Tests
//                Checklist). Always returns status "ok"; may carry a review.
//   - verifier : emits a protocol.mjs review verdict (Review, Manual web UI
//                testing). status is "blocked" iff the review has blocking
//                (critical/major) issues; eligible as a loopSource.
//
// Each runner receives the orchestrator's node ctx (see Orchestrator._nodeCtx):
//   { projectDir, pipelineDir, taskPrompt, toolInstruction, agentPrompts,
//     checkpointRef, signal, onEvent, claudeOpts:{model,effort,mock,...},
//     node:{nodeId,key,runnerType,loopSource,...}, nodeId, stepIndex, cycle,
//     ...per-call fields the dispatcher threads in (planPath, planFilePath,
//        reviewMdPath, reviewJsonPath, outPlanPath, inPlanPath, baseName,
//        answers, reviewPath, mode) }
//
// New agents pick an existing runnerType and need NO engine code; a genuinely new
// behavior = add one branch (or one runner) here.

import {
  runPlannerPlan,
  runRefiner,
  runDecomposer,
  runImplementer,
  runReviewer,
  runPlanReviewer,
  runWorkspaceReviewer,
  runManualTestsChecklist,
  runManualWebUiTesting,
  runGenericProducer,
  runGenericVerifier,
} from './phases.mjs';
import { hasBlocking, blockingIssues } from './protocol.mjs';

/** Normalize a protocol review into the RunnerResult verdict fields. */
function verdict(review) {
  return {
    status: hasBlocking(review) ? 'blocked' : 'ok',
    issues: blockingIssues(review),
    review,
    summary: review?.summary || '',
  };
}

/**
 * producer — generates artifacts/code. Dispatches on the canonical agent key.
 * Always status "ok" (producers do not gate); the refiner additionally surfaces
 * its review so a workflow MAY hang a loop off it, but default routing does not.
 * @param {object} ctx node ctx from the orchestrator
 * @returns {Promise<{status:'ok', summary?:string, planPath?:string, outPlanPath?:string, review?:object}>}
 */
async function producer(ctx) {
  const key = ctx?.node?.key;
  switch (key) {
    case 'planner': {
      const { planPath } = await runPlannerPlan(ctx, {
        answers: ctx.answers || [],
        planFilePath: ctx.planFilePath,
        baseName: ctx.baseName,
        reviewPath: ctx.reviewPath,
      });
      return { status: 'ok', planPath, summary: 'Plan written.' };
    }
    case 'refiner': {
      const { outPlanPath, review } = await runRefiner(ctx, {
        inPlanPath: ctx.inPlanPath,
        outPlanPath: ctx.outPlanPath,
        cycle: ctx.cycle,
        reviewJsonPath: ctx.reviewJsonPath,
      });
      // A producer never blocks; expose the review (+ issues) for loop wiring.
      return { status: 'ok', outPlanPath, review, issues: blockingIssues(review), summary: review?.summary || '' };
    }
    case 'decomposer': {
      const { decompositionPath, decomposition } = await runDecomposer(ctx, {
        planPath: ctx.planPath,
        decompositionPath: ctx.decompositionPath,
      });
      return { status: 'ok', decompositionPath, decomposition, summary: 'Plan decomposed.' };
    }
    case 'implementer': {
      const { summary } = await runImplementer(ctx, {
        planPath: ctx.planPath,
        reviewPath: ctx.reviewPath,
        taskPath: ctx.node?.taskPath,
        siblings: ctx.node?.siblings,
        mode: ctx.mode || 'implement',
      });
      return { status: 'ok', summary };
    }
    case 'manualTestsChecklist': {
      const { checklistPath, summary } = await runManualTestsChecklist(ctx, {
        planPath: ctx.planPath,
        checklistPath: ctx.checklistPath,
      });
      return { status: 'ok', checklistPath, summary };
    }
    default: {
      // Generic branch: a metadata-declared agent runs with ZERO core edits.
      const { summary } = await runGenericProducer(ctx);
      return { status: 'ok', summary };
    }
  }
}

/**
 * verifier — emits a protocol review verdict. status "blocked" iff the review has
 * blocking issues. Eligible as a loopSource.
 * @param {object} ctx node ctx from the orchestrator
 * @returns {Promise<{status:'ok'|'blocked', issues:Array, review:object, summary:string}>}
 */
async function verifier(ctx) {
  const key = ctx?.node?.key;
  switch (key) {
    case 'reviewer': {
      const { review } = await runReviewer(ctx, {
        planPath: ctx.planPath,
        reviewMdPath: ctx.reviewMdPath,
        reviewJsonPath: ctx.reviewJsonPath,
        cycle: ctx.cycle,
      });
      // CONV-5: thread the review markdown path so a loop rewind runs the implementer in `fix` mode.
      return { ...verdict(review), reviewMdPath: ctx.reviewMdPath };
    }
    case 'planReviewer': {
      const { review } = await runPlanReviewer(ctx, {
        planPath: ctx.planPath,
        reviewMdPath: ctx.reviewMdPath,
        reviewJsonPath: ctx.reviewJsonPath,
        cycle: ctx.cycle,
      });
      // Thread the review md path so a loop rewind to the planner reads the review.
      return { ...verdict(review), reviewMdPath: ctx.reviewMdPath };
    }
    case 'workspaceReviewer': {
      const { review } = await runWorkspaceReviewer(ctx, {
        planPath: ctx.planPath,
        reviewMdPath: ctx.reviewMdPath,
        reviewJsonPath: ctx.reviewJsonPath,
        cycle: ctx.cycle,
      });
      // CONV-5: thread the review markdown path so a loop rewind runs the implementer in `fix` mode.
      return { ...verdict(review), reviewMdPath: ctx.reviewMdPath };
    }
    case 'manualWebUiTesting': {
      const { review } = await runManualWebUiTesting(ctx, {
        checklistPath: ctx.checklistPath,
        reviewMdPath: ctx.reviewMdPath,
        reviewJsonPath: ctx.reviewJsonPath,
        cycle: ctx.cycle,
      });
      // CONV-5: thread the review markdown path (web-UI loop source → implementer fix mode).
      return { ...verdict(review), reviewMdPath: ctx.reviewMdPath };
    }
    default: {
      // Generic branch: a metadata-declared verifier emits the standard protocol
      // verdict; thread the md path so a loop rewind reads the review (CONV-5).
      const { review, reviewMdPath } = await runGenericVerifier(ctx);
      return { ...verdict(review), reviewMdPath };
    }
  }
}

/** The runner registry: runnerType -> async (ctx) => RunnerResult. */
export const runners = { producer, verifier };
