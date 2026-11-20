// ui/routes/runs/model-switch.mjs — feature "runs" (docs/runs.md): the "Models" panel of a running or paused run.
import { actorOf } from '../../../src/core/identity.mjs';
import { describeModelSwitch, switchRunModels, ModelSwitchError } from '../../../src/core/model-switch.mjs';
import { SETTLED_RUN, broadcast, emitChanged, projectDirForKey, runs } from '../../server.mjs';

/** A model-switch failure → the shared envelope (ModelSwitchError carries code + status). */
function modelSwitchReply(res, err) {
  if (err instanceof ModelSwitchError) return res.status(err.status).json({ error: err.message, code: err.code });
  return res.status(500).json({ error: err && err.message ? err.message : String(err) });
}

/** The in-process entry still driving `pipelineId` (not settled), or null. */
function modelSwitchEntry(pipelineId) {
  return [...runs.values()].find((e) => e.pipelineId === pipelineId && !SETTLED_RUN.has(String(e.status || ''))) || null;
}

export function register(app) {

// A running or paused run's stages, their models and the run project's catalog (the "Models" panel).
// A run THIS process drives is described from its orchestrator (the scheduler knows what is executing);
// anything else from the store.
app.get('/api/pipelines/:id/models', async (req, res) => {
  try {
    const orch = modelSwitchEntry(req.params.id)?.orch;
    const live = orch?.state?.status === 'running' && typeof orch.modelSwitchSnapshot === 'function'
      ? orch.modelSwitchSnapshot() : null;
    res.json(await describeModelSwitch(req.params.id, { projectDirFor: projectDirForKey, live }));
  } catch (err) { modelSwitchReply(res, err); }
});

// Switch the models of a run's remaining stages (this run only — model-switch.mjs). A run this process
// drives switches in memory (its orchestrator gates pausing / starting runs itself); a paused run is a
// store edit; a run another process drives gets the request through its run-control mailbox.
app.post('/api/pipelines/:id/models', async (req, res) => {
  const pipelineId = req.params.id;
  const changes = req.body?.changes;
  const by = actorOf(req);
  try {
    // A pause still unwinding owns its row until done(paused): let it finish (stopPausedPipelineOnce's rule).
    const parked = [...runs.values()].find((e) => e.pipelineId === pipelineId && e.status === 'paused') || null;
    if (parked && !parked.settled && parked.launch) await parked.launch.catch(() => {});
    const entry = modelSwitchEntry(pipelineId);
    if (entry) {
      if (typeof entry.orch?.switchModels !== 'function') {
        return res.status(409).json({ error: 'this run cannot switch models while it runs', code: 'ENGINE_RETIRED' });
      }
      // Its own 'state' emit reaches the tabs through wireRun; the history list needs the nudge.
      const out = await entry.orch.switchModels(changes, { by });
      if (out.changed.length) emitChanged('pipelines-changed', 'updated');
      return res.json(out);
    }
    const out = await switchRunModels(pipelineId, { changes, by, projectDirFor: projectDirForKey });
    if (out.mode === 'running') {
      if (out.ok) {
        if (out.changed.length) emitChanged('pipelines-changed', 'updated');
        return res.json(out);
      }
      if (out.outcome === 'not-applied') {
        return res.status(409).json({ error: `the run is "${out.runStatus}" now — nothing was switched`, code: 'NOT_RUNNING' });
      }
      return res.status(202).json(out);   // sent; the owner has not answered in time
    }
    if (out.changed.length) {
      // The parked entry's harness re-adopts the edited row (new token, new manifest): a reconnect
      // snapshots it, and its later writes (the Away switch) still reach the row. Only an adopted state
      // is broadcast: a harness that refused (not this pause's lineage) still holds the pre-switch one.
      if (typeof parked?.orch?.adoptPausedStoreEdit === 'function' && parked.orch.adoptPausedStoreEdit()) {
        broadcast({ runId: parked.id, type: 'state', ...parked.orch.getState() });
      }
      emitChanged('pipelines-changed', 'updated');
    }
    res.json(out);
  } catch (err) {
    modelSwitchReply(res, err);
  }
});
}
