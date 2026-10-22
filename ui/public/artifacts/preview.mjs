// ui/public/artifacts/preview.mjs — the popup viewer's renderers (Chat P5): the existing chain (artifact-view-c4 →
// -media → base) for markdown, json, diff, text, image, pdf, html, c4, audio and video, widened with syntax-highlighted
// code and json (the vendored hljs through hljs-loader, inside syntax-highlight.mjs's input caps) and csv/tsv as a table
// when small. Untrusted text reaches the DOM only as textContent or as rowsFromHtml-validated hljs spans.
import { renderArtifact as renderChain, renderText } from '../artifact-view-c4.mjs';
import { langForPath, rowsFromHtml, MAX_HIGHLIGHT_INPUT_BYTES, MAX_HIGHLIGHT_INPUT_ROWS } from '../syntax-highlight.mjs';
import { previewKindFor, parseDelimited, CSV_MAX_BYTES } from './common.mjs';

const encoder = new TextEncoder();

/** The mount's `artifact-view kind-<view>` classes (the media layer's stampKind, for the kinds this layer renders). */
function stamp(mount, view) {
  for (const c of [...mount.classList]) if (c.startsWith('kind-')) mount.classList.remove(c);
  mount.classList.remove('zoomed');
  mount.classList.add('artifact-view', `kind-${view}`);
}

/** Swap a <pre>'s text for hljs spans when the source is inside the caps, the loader has the grammar, and the output
 *  parses back to exactly one row per line. Anything else leaves the plain text. → whether it highlighted. */
export async function highlightPre(pre, text, lang, loader) {
  if (!pre || !lang || !loader || typeof loader.forLanguage !== 'function') return false;
  const src = String(text ?? '');
  const lines = src.split('\n');
  if (lines.length > MAX_HIGHLIGHT_INPUT_ROWS || encoder.encode(src).byteLength > MAX_HIGHLIGHT_INPUT_BYTES) return false;
  let rows = null;
  try {
    const bound = await loader.forLanguage(lang);
    if (!bound || typeof bound.highlight !== 'function') return false;
    rows = rowsFromHtml(bound.highlight(src, lang));
  } catch { return false; }
  if (!rows || rows.length !== lines.length) return false;
  pre.innerHTML = rows.join('\n');        // rowsFromHtml admits hljs class spans and escaped text, nothing else
  // Like the diff view: spans that do not spell the source exactly are dropped for the plain text.
  if (pre.textContent !== src) { pre.textContent = src; return false; }
  pre.classList.add('is-highlighted');
  return true;
}

/** csv/tsv as a table (first row = header) when it is small and well formed; otherwise the plain text. */
export function renderCsv(text, relPath, mount) {
  const src = String(text ?? '');
  const sep = /\.tsv$/i.test(String(relPath)) ? '\t' : ',';
  const rows = encoder.encode(src).byteLength <= CSV_MAX_BYTES ? parseDelimited(src, sep) : null;
  if (!rows || !rows.length) { stamp(mount, 'text'); return renderText(src, mount); }
  const doc = mount.ownerDocument;
  const wrap = doc.createElement('div');
  wrap.className = 'apv-table-wrap';
  const table = doc.createElement('table');
  table.className = 'apv-csv';
  const thead = doc.createElement('thead');
  const head = doc.createElement('tr');
  for (const cell of rows[0]) {
    const th = doc.createElement('th');
    th.scope = 'col';
    th.textContent = cell;
    head.appendChild(th);
  }
  thead.appendChild(head);
  const tbody = doc.createElement('tbody');
  for (const r of rows.slice(1)) {
    const tr = doc.createElement('tr');
    for (const cell of r) {
      const td = doc.createElement('td');
      td.textContent = cell;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  wrap.appendChild(table);
  mount.replaceChildren(wrap);
  return table;
}

/** A pinned view's extension for the chain (artifact-view-c4 → -media → base), which picks its renderer from the
 *  name. No 'html' entry. */
const PIN_EXT = Object.freeze({ markdown: '.md', json: '.json', diff: '.diff', text: '.txt', image: '.png', pdf: '.pdf', audio: '.mp3', video: '.mp4' });
/** The views a caller may pin: PIN_EXT's plus the two this layer renders itself. Anything else (html, c4, junk) pins
 *  'text', so a pinned file can never be framed, whatever its name. */
export const PINNABLE_PREVIEW_KINDS = Object.freeze(new Set([...Object.keys(PIN_EXT), 'csv', 'code']));

/**
 * Render one artifact into `mount`.
 * @param {{kind?:string|null, relPath:string, text?:string, url?:string, previewKind?:string|null}} artifact  `text` for the
 *   text kinds, `url` (the raw route) for image/pdf/html/audio/video; `previewKind` pins the view (PINNABLE_PREVIEW_KINDS)
 * @param {Element} mount
 * @param {{loadMarkdown?:Function, hljsLoader?:{forLanguage:Function}}} [deps]
 */
export async function renderPreview(artifact, mount, deps = {}) {
  const { kind = null, relPath = '', text = '', previewKind = null } = artifact || {};
  const natural = previewKindFor(kind, relPath);
  const pinned = previewKind ? (PINNABLE_PREVIEW_KINDS.has(previewKind) ? previewKind : 'text') : null;
  const view = pinned || natural;
  if (view === 'csv') { stamp(mount, 'csv'); return renderCsv(text, relPath, mount); }
  if (view === 'code') {
    stamp(mount, 'code');
    const pre = renderText(text, mount);
    pre.classList.add('apv-code');
    await highlightPre(pre, text, langForPath(relPath), deps.hljsLoader);
    return pre;
  }
  // The chat files card pins the kind the server sniffed; when the name disagrees (a JSON body in out.txt) the chain
  // gets a path whose extension names the pinned view, so it cannot pick another renderer. The chain never fetches by
  // relPath (the viewer fetched text already; raw bytes use artifact.url), so the suffix changes nothing else.
  let chainArtifact = artifact;
  if (pinned && view !== natural) {
    if (!PIN_EXT[view]) { stamp(mount, 'text'); return renderText(text, mount); }
    chainArtifact = { ...artifact, relPath: `${relPath}${PIN_EXT[view]}` };
  }
  const out = await renderChain(chainArtifact, mount, deps);
  if (view === 'json' && out && out.tagName === 'PRE') {
    out.classList.add('apv-code');
    await highlightPre(out, out.textContent, 'json', deps.hljsLoader);
  }
  return out;
}
