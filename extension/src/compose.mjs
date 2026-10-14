// extension/src/compose.mjs — one sidebar message's POST body. Pure (test/extension-compose.test.mjs).
import { pageAttachments, captureMarkdown, utf8Base64 } from './page-context.mjs';
import { ATTACH_MAX_FILES } from '../../ui/public/attach-files.mjs';

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

/** A stored composer pick (D12) the catalog still offers — pickModel's case-insensitive id match and effort check —
 *  → {model: entry.id, effort}, else null (never a fallback: the caller picks the default then). */
export function validPick(catalog, p) {
  if (!p || typeof p.model !== 'string' || typeof p.effort !== 'string') return null;
  const models = catalog && Array.isArray(catalog.models) ? catalog.models : [];
  const entry = models.find((m) => String(m.id).toLowerCase() === p.model.toLowerCase());
  const efforts = entry && Array.isArray(entry.efforts) && entry.efforts.length ? entry.efforts : ((catalog && catalog.efforts) || []);
  return entry && efforts.includes(p.effort) ? { model: entry.id, effort: p.effort } : null;
}

export function scopeContext(scope, timeZone) {
  const base = timeZone ? { timeZone } : {};
  if (!scope || !scope.pinned) return { ...base, pinned: false };
  return scope.workspaceId ? { ...base, pinned: true, workspaceId: scope.workspaceId } : { ...base, pinned: true, projectKey: scope.projectKey };
}

/** files: [{name, dataBase64, capture?:meta}] in chip order (user files and screenshots); pick: {model,effort}|null
 *  (the composer's model picker, D12) — else pickModel(catalog, thread) as before. */
export function buildMessageBody({ text, quote = null, ctx = null, withText = false, catalog, scope, timeZone = null, thread = null, files = [], pick = null, action = null }) {
  const p = pick && pick.model && pick.effort ? pick : pickModel(catalog, thread);
  if (!p) throw new Error('No Ask model is available in Worca. Set one up in Worca under Settings → Models.');
  const caps = files.filter((f) => f.capture).map((f) => ({ name: f.name, meta: f.capture }));
  const attachments = [
    ...files.map((f) => ({ name: f.name, dataBase64: f.dataBase64 })),
    ...pageAttachments(ctx, { withText, quote, action }),
    ...(caps.length ? [{ name: 'page-capture.md', dataBase64: utf8Base64(captureMarkdown(caps, { action })) }] : []),
  ];
  if (attachments.length > ATTACH_MAX_FILES) throw new Error(`A message carries at most ${ATTACH_MAX_FILES} attachments, the page context included. Remove a file.`);
  return {
    text: String(text ?? '').trim(),                       // the user's own words ONLY (M1)
    model: p.model,
    effort: p.effort,
    context: scopeContext(scope, timeZone),
    attachments,
  };
}

/** How many of the 8 slots the page context will use for the next message (reserved before a user file is accepted). */
export function reservedSlots({ tab, withText, quote, hasCapture }) {
  const page = tab && tab.url ? 1 : 0;
  return page + (page && withText && tab.readable ? 1 : 0) + (quote ? 1 : 0) + (hasCapture ? 1 : 0);
}
