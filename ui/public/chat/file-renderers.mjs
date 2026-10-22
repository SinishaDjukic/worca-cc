// ui/public/chat/file-renderers.mjs — the chat files card's renderer registry: one entry per file kind, keyed by the
// kind src/core/ask/show-files.mjs SHOW_FILE_KINDS sniffs. Pure: no DOM, no imports (like ask/registry.mjs).
// An entry says which viewer preview opens the file (artifacts/preview.mjs renders it) and, optionally, how to draw
// its inline tile. 'html' is deliberately NOT a preview kind here: no renderer can frame a file the chat shows.

/** The artifact viewer preview kinds a file may open as (artifacts/common.mjs previewKindFor's answers minus html/c4). */
export const FILE_PREVIEW_KINDS = Object.freeze(new Set(['markdown', 'json', 'diff', 'text', 'code', 'csv', 'image', 'pdf', 'audio', 'video', 'none']));

const RENDERERS = new Map();

/** The fallback: a download chip, and the viewer's "No preview for this file type" + Download. */
export const FALLBACK_FILE_RENDERER = Object.freeze({ kind: '', label: 'File', preview: () => 'none', thumb: null, match: () => true });

/**
 * Register (or replace) the renderer for one file kind. Junk is ignored, like registerAskRenderer.
 * @param {string} kind
 * @param {{ preview: string | ((item:object) => string), label?: string, thumb?: (item:object, ctx:{doc:Document, url:(item:object)=>string}) => Element|null,
 *           match?: (item:object) => boolean }} r
 */
export function registerFileRenderer(kind, r) {
  if (typeof kind !== 'string' || kind === '' || !r) return;
  const preview = typeof r.preview === 'function' ? r.preview
    : FILE_PREVIEW_KINDS.has(r.preview) ? () => r.preview : null;
  if (!preview) return;
  RENDERERS.set(kind, Object.freeze({
    kind,
    label: typeof r.label === 'string' && r.label ? r.label : kind,
    preview,
    thumb: typeof r.thumb === 'function' ? r.thumb : null,
    match: typeof r.match === 'function' ? r.match : (item) => !!item && item.kind === kind,
  }));
}

/** The renderer for one card item: its own kind's when that matches, else the first whose match() accepts it, else the fallback. */
export function fileRendererFor(item) {
  const own = item ? RENDERERS.get(item.kind) : null;
  if (own && own.match(item)) return own;
  for (const r of RENDERERS.values()) if (r !== own && r.match(item)) return r;
  return FALLBACK_FILE_RENDERER;
}

/** The viewer preview kind for an item: whatever its renderer answers, clamped to FILE_PREVIEW_KINDS ('none' otherwise). */
export function filePreviewOf(item) {
  let p = 'none';
  try { p = fileRendererFor(item).preview(item); } catch { p = 'none'; }
  return FILE_PREVIEW_KINDS.has(p) ? p : 'none';
}

/** Tests only. */
export function _resetFileRenderers() { RENDERERS.clear(); }
