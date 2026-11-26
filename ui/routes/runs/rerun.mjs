// ui/routes/runs/rerun.mjs — feature "runs" (docs/runs.md): Rerun. Two read-only routes give the New run form one
// consistent snapshot of an ended run (its task, target, settings, attached files and what no longer works), and
// rerunOfGuard re-validates the source when the form is started. Nothing here writes a row.
import { findPipelineRowById, listArtifacts, resolveIndexedArtifactFileForRow } from '../../../src/core/artifacts.mjs';
import { presetRefusals } from '../../../src/core/run-presets-check.mjs';
import { readRunSetup } from '../../../src/core/run-presets-store.mjs';
import { assertRunnableWorkflow } from '../../../src/core/workflows.mjs';
import { readGuardrailSet } from '../../../src/core/guardrail-store.mjs';
import { isNoProjectKey } from '../../../src/core/store.mjs';
import { RERUN_ENDED, RERUN_NOT_ENDED, RERUN_TEST_TRY } from '../../../src/shared/run-rerun.mjs';
import { badRequest, bareWorkspaceKey, isLiveRun, presetCheckCtx, presetScopeOf, projectDirForKey } from '../../server.mjs';


/** POST /api/run: a `rerunOf` must name a run that has a row and has ended. A deleted or archived source is accepted. */
export function rerunOfGuard(req, res, next) {
  const id = req.body && req.body.rerunOf;
  if (id === undefined) return next();
  if (id === null || id === '') { delete req.body.rerunOf; return next(); }   // "not a rerun", as an absent field
  const row = typeof id === 'string' ? findPipelineRowById(id) : null;
  if (!row) return res.status(400).json({ error: 'rerun-source-not-found', message: 'The run this was copied from is gone; start it as a new run.' });
  if (row.is_test === 1) return res.status(409).json({ error: 'rerun-test-try', message: RERUN_TEST_TRY });   // workflow tests: never a run of its own
  // As the read routes: a source still going cannot be rerun. A deleted one has ended for good and is accepted.
  if (!row.deleted_at && (!RERUN_ENDED.has(row.status) || isLiveRun(row.id))) return res.status(409).json({ error: 'run-not-ended', message: RERUN_NOT_ENDED });
  req.body.rerunOf = row.id;
  next();
}

/** The source row, or null after answering 404 (unknown or deleted) / 409 (not ended, or still live in this server). */
function endedRowOf(req, res) {
  const row = findPipelineRowById(req.params.id);
  if (!row || row.deleted_at) { res.status(404).json({ error: 'run not found' }); return null; }
  if (row.is_test === 1) { res.status(409).json({ error: 'rerun-test-try', message: RERUN_TEST_TRY }); return null; }   // workflow tests
  if (!RERUN_ENDED.has(row.status) || isLiveRun(row.id)) { res.status(409).json({ error: 'run-not-ended', message: RERUN_NOT_ENDED }); return null; }
  return row;
}

/** The attached files: the names kept at the start (they survive Archive), else the `extra` artifact rows. */
async function extrasOf(row) {
  let names = null;
  if (typeof row.extras_names === 'string') {
    try { const v = JSON.parse(row.extras_names); if (Array.isArray(v)) names = v.filter((n) => typeof n === 'string' && n); } catch { names = null; }
  }
  if (!names) {
    names = (await listArtifacts(row.id)).filter((a) => a.kind === 'extra' && a.relPath.startsWith('extras/')).map((a) => a.relPath.slice('extras/'.length));
  }
  const extras = await Promise.all(names.map(async (name) => ({ name, available: !!(await resolveIndexedArtifactFileForRow(row, `extras/${name}`)) })));
  return { extras, extrasLost: !names.length && row.extras_names == null && !!row.archived_at };
}

/** What stops `setup` from starting on `target` ({ projectDir } | { workspaceId }), in the preset check's shape. */
async function brokenFor(setup, scope, target) {
  const refusals = await presetRefusals(setup || {}, await presetCheckCtx(scope, target, setup || {}, { probeEngine: false }));
  // No recorded setup: only the target itself is judged, not the defaults a start would fall back to.
  return setup ? refusals : refusals.filter((b) => b.item === scope.kind);
}

/**
 * A run with no recorded setup (a No-project run started before Rerun, a run from before v62) still recorded its
 * workflow (`stepper.template`) and guardrail set (`guardrails_id`): those two, when they can still be used, and the
 * names of the ones that cannot. Everything else stays the form's defaults.
 */
export async function recoveredSetupOf(row) {
  const recovered = {};
  const lost = [];
  let template = null;
  try { template = JSON.parse(row.stepper || 'null')?.template || null; } catch { template = null; }
  if (template && typeof template.id === 'string' && template.id) {
    try { await assertRunnableWorkflow(template.id); recovered.workflowId = template.id; }
    catch { lost.push(`workflow "${template.name || template.id}"`); }
  }
  if (typeof row.guardrails_id === 'string' && row.guardrails_id) {
    if (await readGuardrailSet(row.guardrails_id).catch(() => null)) recovered.guardrailsId = row.guardrails_id;
    else lost.push(`guardrails "${row.guardrails_id}"`);
  }
  return { recovered, lost };
}

export function register(app) {

app.get('/api/pipelines/:id/rerun', async (req, res) => {
  try {
    const row = endedRowOf(req, res);
    if (!row) return;
    const { setup, target: t } = readRunSetup(row.id);
    const fallback = setup ? {} : await recoveredSetupOf(row);
    if (isNoProjectKey(t.ref)) {
      // A run started on "No project": its target is none, judged without any project or workspace.
      const broken = await brokenFor(setup, { kind: 'global', ref: null }, { projectDir: '' });
      return res.json({ prompt: row.prompt ?? '', title: row.title ?? null, target: { kind: 'none', ref: null, projectDir: null, workspaceId: null }, setup, ...fallback, broken, ...(await extrasOf(row)) });
    }
    const workspaceId = t.kind === 'workspace' ? (bareWorkspaceKey(row) || t.ref) : null;
    const dir = t.kind === 'project' ? await projectDirForKey(t.ref) : null;
    const target = t.kind === 'workspace' ? { kind: 'workspace', ref: t.ref, projectDir: null, workspaceId }
      : { kind: 'project', ref: t.ref, projectDir: dir, workspaceId: null };
    const broken = await brokenFor(setup, { kind: t.kind, ref: workspaceId || t.ref }, workspaceId ? { workspaceId } : { projectDir: dir || '' });
    res.json({ prompt: row.prompt ?? '', title: row.title ?? null, target, setup, ...fallback, broken, ...(await extrasOf(row)) });
  } catch (err) {
    console.error('[rerun] read', err);
    res.status(500).json({ error: 'could not check the earlier run' });
  }
});

// The form's target changed: the same check against the new { projectDir } | { workspaceId }, like the preset check.
app.post('/api/pipelines/:id/rerun/check', async (req, res) => {
  try {
    const row = endedRowOf(req, res);
    if (!row) return;
    const body = req.body || {};
    const workspaceId = typeof body.workspaceId === 'string' && body.workspaceId ? body.workspaceId : null;
    const noProject = body.noProject === true;   // the form's "No project" target
    const scope = await presetScopeOf(workspaceId ? { kind: 'workspace', workspaceId } : noProject ? { kind: 'global' } : { kind: 'project', projectDir: body.projectDir });
    if (!scope) return badRequest(res, 'target names a project or workspace worca does not know');
    // targetOnly: the form holds none of the earlier run's picks, so they are not judged (as for a run with no recorded setup).
    res.json({ broken: await brokenFor(body.targetOnly === true ? null : readRunSetup(row.id).setup, scope, workspaceId ? { workspaceId } : { projectDir: noProject ? '' : body.projectDir }) });
  } catch (err) {
    console.error('[rerun] check', err);
    res.status(500).json({ error: 'could not check the earlier run' });
  }
});
}
