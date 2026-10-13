// extension/src/compose.mjs — one sidebar message's POST body. Pure (test/extension-compose.test.mjs).
import { pageAttachments } from './page-context.mjs';

/** The thread's own model/effort when the catalog still offers them (as the Ask panel adopts them, ask-panel.mjs:1785),
 *  else the default of the thread's engine (a Codex-locked chat refuses a Claude model: validateModelEffort D12),
 *  else the catalog's default, else the first model with its first effort (`default` may be null). */
export function pickModel(catalog, thread = null) {
  const models = catalog && Array.isArray(catalog.models) ? catalog.models : [];
  if (thread && typeof thread.model === 'string' && typeof thread.effort === 'string') {
    const entry = models.find((m) => String(m.id).toLowerCase() === thread.model.toLowerCase());   // validateModelEffort is case-insensitive (models.mjs:178)
    const efforts = entry && Array.isArray(entry.efforts) && entry.efforts.length ? entry.efforts : (catalog.efforts || []);
    if (entry && efforts.includes(thread.effort)) return { model: entry.id, effort: thread.effort };
  }
  const byEngine = thread && thread.engine && catalog && catalog.defaults ? catalog.defaults[thread.engine] : null;
  if (byEngine && byEngine.model && byEngine.effort) return { model: byEngine.model, effort: byEngine.effort };
  if (catalog && catalog.default && catalog.default.model && catalog.default.effort) return { model: catalog.default.model, effort: catalog.default.effort };
  const m = models.find((x) => !x.hidden && !x.needsSignIn) || models[0] || null;   // never a hidden / signed-out row first (v7)
  if (!m) return null;
  const efforts = Array.isArray(m.efforts) && m.efforts.length ? m.efforts : (Array.isArray(catalog.efforts) ? catalog.efforts : []);
  return efforts[0] ? { model: m.id, effort: efforts[0] } : null;
}

export function scopeContext(scope, timeZone) {
  const base = timeZone ? { timeZone } : {};
  if (!scope || !scope.pinned) return { ...base, pinned: false };
  return scope.workspaceId ? { ...base, pinned: true, workspaceId: scope.workspaceId } : { ...base, pinned: true, projectKey: scope.projectKey };
}

export function buildMessageBody({ text, quote = null, ctx = null, withText = false, catalog, scope, timeZone = null, thread = null }) {
  const pick = pickModel(catalog, thread);
  if (!pick) throw new Error('No Ask model is available in Worca. Set one up in Worca under Settings → Models.');
  return {
    text: String(text ?? '').trim(),                       // the user's own words ONLY (M1)
    model: pick.model,
    effort: pick.effort,
    context: scopeContext(scope, timeZone),
    attachments: pageAttachments(ctx, { withText, quote }),
  };
}
