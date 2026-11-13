// ui/routes/workflows/workflow-tests.mjs — feature "workflows": workflow tests (plans/workflow-tests-part2-plan.md).
// Flag workflowTests. A try is a no-project run started through the run handler (invokeStartRun's workflowTest), hidden
// from every list (D21); the runner answers its questions itself. The routes live in src/core/workflow-tests/routes.mjs.
import path from 'node:path';
import { readMcpStore } from '../../../src/core/mcp/store.mjs';
import { readMcpFile, normalizeServerName } from '../../../src/core/run-context.mjs';
import { getProjectsRoot } from '../../../src/core/settings.mjs';
import { NO_PROJECT_KEY } from '../../../src/core/store.mjs';
import { TRY_ANSWERED_BY } from '../../../src/core/workflow-tests/answers.mjs';
import { pretendCopies } from '../../../src/core/workflow-tests/connectors.mjs';
import { registerWorkflowTestRoutes } from '../../../src/core/workflow-tests/routes.mjs';
import { NO_PROJECT_NAME } from '../../../src/shared/no-project.mjs';
import { broadcast, invokeStartRun, mcpRunPreview, resolvePending, runs, serverMockMode, stopRun } from '../../server.mjs';

export const workflowTestDeps = {
  startRun: (body, opts) => invokeStartRun(body, null, opts),
  // pauseReason/pauseDetail (set on 'done', wireRun): the runner tells a drain, a cost cap or a step error apart by them.
  liveRun: (runKey) => {
    const e = runs.get(runKey);
    return e ? { orch: e.orch, status: String(e.status || ''), launch: e.launch || null, pipelineId: e.pipelineId || null,
      pauseReason: e.pauseReason ?? null, pauseDetail: e.pauseDetail ?? null } : null;
  },
  stopRun: (runKey) => Promise.resolve().then(() => stopRun(runKey, TRY_ANSWERED_BY)).catch(() => {}),
  answer: (runKey, id, payload) => {
    const e = runs.get(runKey);
    if (!e || !e.orch) return false;
    const ok = e.orch.answer(id, payload, TRY_ANSWERED_BY);   // answerRun cannot say whether it was taken
    if (ok) resolvePending(e, { id, reason: 'answered' });
    return ok;
  },
  mockMode: (...a) => serverMockMode(...a),
  // D35, board 30 (3a: board 34): what a try would load, for the Test a version dialog's notes. A registry copy is
  // `untested` when a pretend try gives it no stand-in (pretendCopies: a current, passing Test with tools). Without a
  // project: the registry's no-project scope, and the servers of the projects root's `.mcp.json` (the root layer a run
  // without a project merges) are the file servers. On one project: that project's scope and the `.mcp.json` of its
  // folder (read only).
  connectorsPreview: async (scope = null) => {
    const target = scope && scope.key ? { kind: 'project', key: scope.key, name: scope.name || scope.key, rank: 0 }
      : { kind: 'project', key: NO_PROJECT_KEY, name: NO_PROJECT_NAME, rank: 0 };
    const [{ result }, mcpStore] = await Promise.all([mcpRunPreview(target), readMcpStore()]);
    const standIns = new Set(pretendCopies(result.copies, (mcpStore && mcpStore.tests) || {}).map((c) => c.name));
    const root = scope && scope.projectDir ? scope.projectDir : getProjectsRoot();
    const file = root ? (await readMcpFile(path.join(root, '.mcp.json'))).servers : null;
    return {
      copies: result.copies.map((c) => ({ name: c.name, untested: !standIns.has(c.name) })),
      fileServers: [...new Set(Object.keys(file || {}).map(normalizeServerName))].sort(),
    };
  },
};

export function register(app) {
  registerWorkflowTestRoutes(app, { broadcast, deps: workflowTestDeps });
}
