// ui/public/run-rerun.mjs — Rerun (docs/runs.md): the ⋯ menu gate, the prefill the New run form opens with, the notes
// under it and the "Rerun of …" link. Pure: app.js owns the fetches and the DOM.

import { RERUN_ENDED, RERUN_NOT_ENDED } from '../../src/shared/run-rerun.mjs';

/** The menu item's state: `offered` is false without a saved record; `reason` is the tooltip, `hint` the visible text. */
export function rerunGate({ status, live, hasRecord }) {
  if (!hasRecord) return { offered: false, disabled: true, reason: '', hint: '' };
  if (!live && RERUN_ENDED.has(status)) return { offered: true, disabled: false, reason: '', hint: '' };
  const resume = status === 'interrupted' || status === 'paused' ? ' Use Resume to continue it.' : '';
  return { offered: true, disabled: true, reason: RERUN_NOT_ENDED + resume, hint: 'after it ends' };
}

/**
 * The prefill `openNewPipeline` takes, from GET /api/pipelines/:id/rerun (plus `runId` and `label`) and the files the
 * client fetched (`[{ name, dataBase64 }]`; a file without bytes was not attached). The settings themselves are applied
 * by applyAskPrefill from `rerun.setup`.
 */
export function rerunPrefill(payload, files) {
  const attached = (files || []).filter((f) => f && typeof f.dataBase64 === 'string').map((f) => ({ name: f.name, dataBase64: f.dataBase64 }));
  const have = new Set(attached.map((f) => f.name));
  const missing = (payload.extras || []).map((e) => e.name).filter((n) => !have.has(n));
  const t = payload.target || {};
  const s = payload.setup;
  // No recorded setup: the workflow and guardrail set the run recorded elsewhere, when they still work (the server judged).
  const rec = !s && payload.recovered && typeof payload.recovered === 'object' ? payload.recovered : {};
  return {
    prompt: payload.prompt,
    title: payload.title || '',
    target: t.kind === 'workspace' ? 'workspace' : t.kind === 'none' ? 'none' : 'project',
    ...(t.kind === 'workspace' && t.workspaceId ? { workspaceId: t.workspaceId } : {}),
    ...(t.kind === 'project' && t.projectDir ? { projectDir: t.projectDir } : {}),
    ...(s && s.engine ? { engine: s.engine } : {}),
    ...((s || rec).workflowId ? { workflowId: (s || rec).workflowId } : {}),
    ...((s || rec).guardrailsId ? { guardrailsId: (s || rec).guardrailsId } : {}),
    ...(s && s.sourceBranch ? { sourceBranch: s.sourceBranch } : {}),
    ...(s && s.sourceBranchByKey ? { sourceBranchByKey: s.sourceBranchByKey } : {}),
    ...(s && s.sameAsSource !== undefined ? { sameAsSource: s.sameAsSource } : {}),
    ...(s && Array.isArray(s.tags) ? { tags: s.tags } : {}),
    extras: attached,
    rerun: { runId: payload.runId, label: payload.label, setup: s || null, broken: payload.broken || [], missing, extrasLost: !!payload.extrasLost,
      restored: [...(rec.workflowId ? ['workflow'] : []), ...(rec.guardrailsId ? ['guardrail set'] : [])], lost: s ? [] : [...(payload.lost || [])] },
  };
}

/** The notice lines under the form's preset row. `restored`: what a setup-less run still gave back ('workflow',
 *  'guardrail set'); `lost`: what it recorded but no longer exists (`workflow "Name"`). */
export function rerunNotes({ missing, extrasLost, setupMissing, restored = [], lost = [] }) {
  const out = [];
  if (missing && missing.length) out.push(`Not attached (no longer available or too large): ${missing.join(', ')}`);
  if (extrasLost) out.push('Files attached to the earlier run were removed when it was archived');
  if (setupMissing) {
    out.push(restored.length
      ? `Settings of the earlier run were not recorded; its ${restored.join(' and ')} ${restored.length > 1 ? 'were' : 'was'} restored, other settings are defaults.`
      : 'Settings of the earlier run were not recorded; defaults used.');
  }
  if (lost.length) out.push(`No longer available, defaults used instead: ${lost.join(', ')}`);
  return out;
}

/** The run page's "Rerun of …" row from `state.rerunOf` ({ id, key, title, exists }); null when the run is no rerun. */
export function rerunLinkModel(rerunOf) {
  if (!rerunOf) return null;
  if (!rerunOf.exists) return { text: 'Copied from a run that no longer exists', href: null };
  return { text: `Rerun of ${rerunOf.title || rerunOf.id}`, href: `#history/${rerunOf.key}/${rerunOf.id}` };
}
