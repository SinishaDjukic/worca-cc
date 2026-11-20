// test/helpers/held-run.mjs
// A real wf_default graph run (mock Claude, recording runners) that HOLDS one execution until
// released — the window a live model switch lands in (model-switch-live / -mailbox tests).
import { gitDir } from './git-dir.mjs';
import { createOrchestrator } from '../../src/core/orchestrator.mjs';

export function outsOf(ctx) {
  const o = {};
  for (const p of ctx.ports.outputs || []) o[p.id] = { path: ctx.outputs?.[p.id]?.path ?? null, type: p.type };
  return o;
}

/**
 * @param {string} name  gitDir name (unique per test)
 * @param {object} o
 * @param {(ctx:object) => boolean} [o.holdAt]  hold this execution — key it on `ctx.executionId`
 *   (`'x:n_impl:2'` = Implement's 2nd loop cycle): a retry calls the runner again with the SAME id,
 *   so a per-node call count would drift.
 * @param {boolean} [o.rejectReviewOnce]  Review's cycle-1 verdict blocks, so Implement <-> Review runs a 2nd cycle
 * @param {number} [o.rejectReviews]  Review's cycles 1..N block (3 = wf_default's w9 cap: the loop then
 *   waits at its cycle-cap gate; pass `opts: { auto: false }` to keep that question open)
 * @param {object} [o.opts]  extra createOrchestrator options (`resume`, `projectDir`, `auto`)
 * @returns {{orch:object, spawns:object[], held:Promise<object>, release:()=>void, done:Promise<object>}}
 *   `held` rejects if the run settles before the hold (a clear failure instead of a test timeout).
 */
export function heldRun(name, { holdAt = () => false, rejectReviewOnce = false, rejectReviews = rejectReviewOnce ? 1 : 0, opts = {} } = {}) {
  const spawns = [];
  let onHeld; const held = new Promise((r) => { onHeld = r; });
  let open; const gate = new Promise((r) => { open = r; });
  const hold = async (ctx) => {
    spawns.push({ nodeId: ctx.nodeId, executionId: ctx.executionId, resume: ctx.resumeSessionId || null,
      model: ctx.claudeOpts?.model ?? null, effort: ctx.claudeOpts?.effort ?? null,
      subagentModel: ctx.node?.subagentModel || '', subagentEffort: ctx.node?.subagentEffort || '' });
    if (!holdAt(ctx)) return;
    ctx.onEvent?.({ type: 'session', sessionId: `sess-${ctx.executionId}` });
    onHeld(ctx);
    await new Promise((res, rej) => {
      gate.then(res);
      const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
      if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
    });
  };
  const result = (ctx, verdict) => ({ outputs: outsOf(ctx), verdict, summary: '' });
  const runners = {
    clarifier: async (ctx) => { await hold(ctx); return result(ctx, null); },
    producer: async (ctx) => { await hold(ctx); return result(ctx, null); },
    verifier: async (ctx) => {
      await hold(ctx);
      const reject = ctx.nodeId === 'n_review' && ctx.ordinal <= rejectReviews;
      return result(ctx, reject ? { issues: [{ severity: 'critical', title: 'fix it' }], summary: '' } : { issues: [], summary: '' });
    },
  };
  // A resume reads its prompt from the saved run (model-switch-resume.test.mjs passes none either).
  const orch = createOrchestrator({ projectDir: opts.projectDir || gitDir(name), workflowId: 'wf_default',
    ...(opts.resume ? {} : { prompt: 'demo' }), auto: true, claude: { mock: true }, runners, ...opts });
  const done = opts.resume ? orch.resume() : orch.run();
  const heldOrSettled = Promise.race([held, done.then((r) => {
    throw new Error(`the run settled before the hold: ${JSON.stringify(r)}`);
  })]);
  heldOrSettled.catch(() => {});   // a caller that never awaits `held` (a run with no hold) stays quiet
  return { orch, spawns, held: heldOrSettled, release: () => open(), done };
}
