// test/helpers/run-settled.mjs — wait for a run started through the server to settle (entry.settled), answering every
// question it parks on as auto mode would (the api-run-no-project pattern). wf_default parks at its clarify gate whatever
// humanInLoop says (run-harness.mjs: the switch only changes an Auto run), so a test that only waits never ends.
// Used by test/workflow-test-project-key.test.mjs and test/api-workflow-test-project-try.test.mjs.

/**
 * @param {{runs: Map<string, object>, answerRun: (runId: string, id: string, payload: object) => unknown}} server
 *   the server's `runs` map and `_testing.answerRun`
 * @returns {(runId: string, ms?: number) => Promise<object>} resolves the settled run entry; throws after `ms`
 */
export function runSettled({ runs, answerRun }) {
  const answered = new Set();
  return async function settled(runId, ms = 200000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const e = runs.get(runId);
      if (e && e.settled) return e;
      const pq = e && e.pendingQuestion;
      if (pq && !answered.has(pq.id)) {
        answered.add(pq.id);
        const payload = (pq.kind === 'clarify' || pq.kind === 'questions')
          ? { answers: (pq.questions || []).map((q) => ({ id: q.id, choice: (q.options || []).find((o) => o && o.trim()) || 'auto' })) }
          : { decision: 'continue' };
        answerRun(runId, pq.id, payload);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    const e = runs.get(runId);
    throw new Error(`run ${runId} never settled: status=${e?.status} question=${e?.pendingQuestion?.id || null}`);
  };
}
