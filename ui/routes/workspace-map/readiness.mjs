// ui/routes/workspace-map/readiness.mjs — the workspace page's "Evaluate with AI" / "Set up with AI": the ai-readiness plugin's check
// or setup workflow run over the whole workspace. Started only by a click (or the notice's action), never on its own.
import { READINESS_CHECK_TITLE, READINESS_CHECK_WORKFLOW_ID, READINESS_SETUP_TITLE, READINESS_SETUP_WORKFLOW_ID, isLiveReadinessStatus, workspaceReadinessInfo } from '../../../src/core/repo-readiness/projects.mjs';
import { readWorkspace } from '../../../src/core/workspaces.mjs';
import { liveReadinessEntryFor, reserveReadinessStart } from '../../../src/core/repo-readiness/run-guard.mjs';
import { badRequest, liveOverSet, liveRunEntry, runs, startRunHandler } from '../../server.mjs';

// The run this server drives for a pipeline while it is live, for the page's "run" link; null once it is over.
const liveRunId = (pipelineId) => {
  const e = liveRunEntry(pipelineId);
  return e && e.id && e.pipelineId === pipelineId && isLiveReadinessStatus(e.status) ? e.id : null;
};

export function register(app) {
app.get('/api/workspaces/:id/readiness', async (req, res) => {
  if (!(await readWorkspace(req.params.id))) return res.status(404).json({ error: 'workspace not found' });
  res.json(await workspaceReadinessInfo(req.params.id, { liveRunId }));
});

// POST { kind: 'check' | 'setup' }: 404 when that workflow is not there (or no member has code), 409 while a scan, another
// workspace run, a member's readiness run or a start in flight owns the workspace; else the one run handler.
app.post('/api/workspaces/:id/readiness-run', async (req, res) => {
  const id = req.params.id;
  const ws = await readWorkspace(id);
  if (!ws) return res.status(404).json({ error: 'workspace not found' });
  const kind = req.body && req.body.kind;
  if (kind !== 'check' && kind !== 'setup') return badRequest(res, 'kind must be "check" or "setup"');
  const info = await workspaceReadinessInfo(id, { liveRunId });
  if (!info.available[kind]) return res.status(404).json({ error: `AI readiness ${kind} is not available` });
  // A scan or another run of the set, a readiness run of a member (its row, or only its live entry while the row is not
  // written), or a readiness start in flight on any member (startRunHandler awaits before `runs.set`): 409.
  const entry = info.live ? null : liveReadinessEntryFor(runs, ws.projectPaths);
  const live = info.live || (entry && { runId: entry.id, pipelineId: entry.pipelineId || null });
  const release = liveOverSet(id, ws.projectPaths) || live ? null : reserveReadinessStart(ws.projectPaths);
  if (!release) {
    return res.status(409).json({ error: 'a run is already live for this workspace', ...(live ? { runId: live.runId, pipelineId: live.pipelineId } : {}) });
  }
  try {
    const check = kind === 'check';
    req.body = {
      workspaceId: id, prompt: check ? 'check' : 'set up',
      title: check ? READINESS_CHECK_TITLE : READINESS_SETUP_TITLE,
      workflowId: check ? READINESS_CHECK_WORKFLOW_ID : READINESS_SETUP_WORKFLOW_ID,
      guardrailsId: 'normal',
      ...(req.body.mock === true ? { mock: true } : {}),
    };
    return await startRunHandler(req, res);
  } finally { release(); }
});
}
