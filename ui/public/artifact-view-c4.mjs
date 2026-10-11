// ui/public/artifact-view-c4.mjs — the C4 artifact viewer, layered on artifact-view-media.mjs
// the same way that file layers on artifact-view.mjs: one more viewer kind and one more renderer,
// the layers below untouched. A `.c4` / `.likec4` artifact (or a `.c4.json` export) opens in
// <worca-c4> inside the shared viewer modal, with the info rail and the JPEG button; the modal's
// own Full screen button gives it the whole screen.
//
// Re-exports the media layer's whole surface, so app.js switches by changing one import path.
import { viewerKindFor as mediaViewerKindFor, renderArtifact as renderMediaArtifact } from './artifact-view-media.mjs';

export {
  escapeHtml, artifactsByNodeCycle, renderText, renderJson, renderDiff, renderMarkdown,
  BULK_KIND_THRESHOLD, groupArtifactsByKind, rawArtifactUrl, renderImage, renderPdf, renderHtml, renderBinary,
} from './artifact-view-media.mjs';

const C4_EXT = /\.(c4|likec4)$/i;
const C4_JSON = /\.c4\.json$/i;

/** 'c4' for a LikeC4 source or export, else the media layer's answer, unchanged. Pure. */
export function viewerKindFor(kind, relPath = '') {
  const p = String(relPath);
  if (C4_EXT.test(p) || C4_JSON.test(p) || kind === 'c4') return 'c4';
  return mediaViewerKindFor(kind, relPath);
}

let viewerReady = null;
/** Load the component and its layout engine once, on first use: the vendored dagre is a classic
 *  script that sets window.dagre, so it is injected rather than imported. A dagre that fails to
 *  load still leaves a working viewer — element views fall back to rows. */
export function ensureC4Viewer(doc = document) {
  if (viewerReady) return viewerReady;
  const dagre = doc.defaultView && doc.defaultView.dagre ? Promise.resolve() : new Promise((resolve) => {
    const s = doc.createElement('script');
    s.src = '/c4/dagre.min.js';
    s.onload = () => resolve();
    s.onerror = () => resolve();
    doc.head.appendChild(s);
  });
  viewerReady = Promise.all([dagre, import('./c4/c4-view.mjs')]).then(() => undefined);
  return viewerReady;
}

/** Mount <worca-c4> and load the source. The modal's CSS sizes it (.artifact-view.kind-c4). */
export async function renderC4(text, relPath, mount, { view = null } = {}) {
  for (const c of [...mount.classList]) if (c.startsWith('kind-')) mount.classList.remove(c);
  mount.classList.add('artifact-view', 'kind-c4');
  mount.textContent = 'Loading the C4 viewer…';
  await ensureC4Viewer(mount.ownerDocument);
  const el = mount.ownerDocument.createElement('worca-c4');
  el.setAttribute('info', '');
  el.setAttribute('toolbar', '');
  el.setAttribute('aria-label', `C4 diagram: ${String(relPath).split('/').pop()}`);
  if (view) el.setAttribute('view', view);
  mount.replaceChildren(el);
  el.load(String(text ?? ''));
  return el;
}

export async function renderArtifact(artifact, mount, deps = {}) {
  if (viewerKindFor(artifact.kind, artifact.relPath) === 'c4') return renderC4(artifact.text || '', artifact.relPath, mount, deps);
  return renderMediaArtifact(artifact, mount, deps);
}
