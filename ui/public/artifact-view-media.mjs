// ui/public/artifact-view-media.mjs — byte-kind artifact viewers, layered on top
// of artifact-view.mjs.
//
// artifact-view.mjs owns the TEXT kinds (markdown/json/diff/text, the per-execution
// grouping, the never-decode-as-text 'binary' notice). Everything byte-shaped — the
// image/pdf/html/binary viewers and the raw-bytes URL helper — lives here, so the
// two layers change independently.
//
// The module deliberately re-exports upstream's whole surface, so a consumer
// switches by changing ONE import path and nothing else:
//
//     -import { artifactsByNodeStep, viewerKindFor, renderArtifact } from './artifact-view.mjs';
//     +import { artifactsByNodeStep, viewerKindFor, renderArtifact } from './artifact-view-media.mjs';
//
// Dispatch is a strict widening: the four byte kinds are handled here and every
// other kind is delegated to upstream's renderArtifact unchanged, so upstream's
// own tests describe upstream's behaviour exactly as before.
import {
  viewerKindFor as upstreamViewerKindFor,
  renderArtifact as renderUpstreamArtifact,
} from './artifact-view.mjs';
import { RAW_KINDS, BULK_ARTIFACT_THRESHOLD, viewerKindFor as kindForPath } from '../../src/shared/artifact-kinds.mjs';

// Upstream's surface, re-exported verbatim so this module is a drop-in.
export {
  artifactsByNodeStep, DIFF_MAX_ROWS,
  renderText, renderJson, renderDiff, renderMarkdown,
} from './artifact-view.mjs';

/** Re-exported under the name the UI uses. The value lives in the shared
 *  artifact-kind table so the live log, the persisted log and this list cannot
 *  disagree about what counts as a burst. */
export const BULK_KIND_THRESHOLD = BULK_ARTIFACT_THRESHOLD;

/**
 * Group one bucket's artifacts by kind, in first-appearance order, flagging the
 * kinds bulky enough to collapse. Members keep their arrival order. Pure —
 * it sits here rather than in artifact-view.mjs because that file is kept
 * byte-identical to upstream (see the header).
 * @param {Array<{kind?:string}>} [artifacts]
 * @param {{threshold?:number}} [opts]
 * @returns {Array<{kind:string, collapsed:boolean, items:Array}>}
 */
export function groupArtifactsByKind(artifacts = [], { threshold = BULK_KIND_THRESHOLD } = {}) {
  const byKind = new Map();
  for (const a of artifacts || []) {
    const kind = (a && a.kind) || '';
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(a);
  }
  return [...byKind].map(([kind, items]) => ({ kind, collapsed: items.length > threshold, items }));
}

/** Keep the mount's `artifact-view` + `kind-<view>` classes in sync so the CSS
 *  that keys on them (`.artifact-view.kind-image img`, `.zoomed`) matches, and a
 *  re-render into the same host never leaves a stale kind behind. Stamping here
 *  rather than upstream is what keeps artifact-view.mjs byte-identical. */
function stampKind(mount, view) {
  for (const c of [...mount.classList]) if (c.startsWith('kind-')) mount.classList.remove(c);
  mount.classList.remove('zoomed');
  mount.classList.add('artifact-view', `kind-${view}`);
}

/** The raw-bytes route for one artifact, each path segment encoded. */
export function rawArtifactUrl(base, rel) {
  return `${base}/artifact-raw/` + String(rel || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

/** <img> against the raw route; click toggles natural size. */
export function renderImage(url, relPath, mount) {
  const img = mount.ownerDocument.createElement('img');
  img.src = url;
  img.alt = relPath;
  img.loading = 'lazy';
  img.addEventListener('click', () => mount.classList.toggle('zoomed'));
  mount.replaceChildren(img);
  return img;
}

/** <embed type="application/pdf"> — the browser's own PDF viewer. */
export function renderPdf(url, mount) {
  const embed = mount.ownerDocument.createElement('embed');
  embed.type = 'application/pdf';
  embed.src = url;
  mount.replaceChildren(embed);
  return embed;
}

/**
 * Scriptable markup, framed. sandbox="allow-scripts" and NEVER allow-same-origin:
 * the two together let the framed page reach its own frame element and remove the
 * sandbox attribute, defeating it entirely. allow-scripts alone is required
 * because a deck without scripts has no <deck-stage>, no navigation, no reveals.
 */
export function renderHtml(url, relPath, mount) {
  const frame = mount.ownerDocument.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');      // NEVER add allow-same-origin
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('loading', 'lazy');
  frame.title = relPath;
  frame.src = url;
  mount.replaceChildren(frame);
  return frame;
}

/** No preview attempt — a download link only. */
export function renderBinary(url, relPath, mount) {
  const doc = mount.ownerDocument;
  const p = doc.createElement('p');
  p.textContent = 'No preview for this file type. ';
  const a = doc.createElement('a');
  a.href = url;
  a.setAttribute('download', String(relPath).split('/').pop() || 'artifact');
  a.textContent = 'Download';
  p.appendChild(a);
  mount.replaceChildren(p);
  return p;
}

/**
 * Widened kind decision: a byte kind when the extension says so (one shared
 * table, so viewer / raw route / Ask attachment typing cannot drift), otherwise
 * upstream's answer, unchanged — including its `kind` fallback for extensionless
 * paths. Upstream's own unit test still describes upstream's behaviour exactly.
 * @returns {'image'|'pdf'|'html'|'binary'|'markdown'|'diff'|'json'|'text'}
 */
export function viewerKindFor(kind, relPath = '') {
  const byExt = kindForPath(relPath);
  if (RAW_KINDS.has(byExt)) return byExt;
  return upstreamViewerKindFor(kind, relPath);
}

/**
 * Render one artifact into `mount`. Byte kinds are handled here; everything else
 * is delegated to upstream's renderArtifact with its own signature untouched.
 *
 * `text` carries the decoded body for the text kinds; `url` is the raw-bytes
 * route (rawArtifactUrl(base, rel)) and is what the byte kinds frame/embed/link.
 * A byte kind called without a url degrades to the download stub rather than
 * emitting src="".
 *
 * @param {{kind:string, relPath:string, text?:string, url?:string}} artifact
 * @param {Element} mount
 * @param {{loadMarkdown?:Function}} [deps]
 */
export async function renderArtifact(artifact, mount, deps = {}) {
  const { kind, relPath, url = '' } = artifact;
  const view = viewerKindFor(kind, relPath);
  stampKind(mount, view);
  if (RAW_KINDS.has(view)) {
    if (!url) return renderBinary('', relPath, mount);
    if (view === 'image') return renderImage(url, relPath, mount);
    if (view === 'pdf') return renderPdf(url, mount);
    if (view === 'html') return renderHtml(url, relPath, mount);
    return renderBinary(url, relPath, mount);
  }
  return renderUpstreamArtifact(artifact, mount, deps);
}
