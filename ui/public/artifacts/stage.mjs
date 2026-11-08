// ui/public/artifacts/stage.mjs — the ONE file preview pipeline (Chat P5's popup and the tool panel's Files tab): which
// preview a file gets, the HEAD probes, the text fetch, NUL / UTF-16 handling, and the render through preview.mjs.
// It never draws chrome: the caller turns {state} into its own info view, error line or decoration.
import { relOf, displayPath, previewKindFor, RAW_PREVIEW_KINDS, TEXT_PREVIEW_MAX_BYTES } from './common.mjs';
import { renderPreview, PINNABLE_PREVIEW_KINDS } from './preview.mjs';

export const NO_PREVIEW = 'No preview for this file type';
export const OFFICE_NEEDS_LIBREOFFICE = 'Install LibreOffice to preview Office files';
/** Text that holds a NUL in its first 8 KB is bytes, not text (git's own test). */
const NUL = String.fromCharCode(0);
/** The office branch's answers that mean "no preview here" (the info view + Download), not "it failed": the raw
 *  route's `?as=pdf` codes (D8). Only the office branch reads them, so a 501 or 422 anywhere else stays an error line. */
const OFFICE_INFO = Object.freeze({ 413: 'Too large to preview', 415: NO_PREVIEW, 422: 'Could not convert this file', 501: OFFICE_NEEDS_LIBREOFFICE });

export async function safeJson(res) {
  try { return await res.json(); } catch { return {}; }
}

/** The words a failed load shows — worca's, never the server's own message (a 500 body can hold an absolute path). */
export function errorText(err) {
  if (!err) return '';
  if (err.status === 404) return 'File not found';
  if (err.status === 413) return 'Too large to preview';
  if (err.status === 415) return NO_PREVIEW;
  return err.status ? `Could not load (HTTP ${err.status})` : 'Could not load';
}

/** HEAD a URL → {ok, status, size}: `size` is its Content-Length on a success that carries one; status 0 = no answer. */
export async function headOf(fetchFn, url) {
  try {
    const r = await fetchFn(url, { method: 'HEAD' });
    const v = r && r.ok && r.headers && typeof r.headers.get === 'function' ? r.headers.get('content-length') : null;
    const n = v == null || v === '' ? NaN : Number(v);
    return { ok: Boolean(r && r.ok), status: (r && r.status) || 0, size: Number.isFinite(n) && n >= 0 ? n : null };
  } catch {
    return { ok: false, status: 0, size: null };
  }
}

/** UTF-16 text with a byte-order mark, read as bytes from the download form → its text; null otherwise. */
export async function utf16Text(fetchFn, url) {
  try {
    const r = await fetchFn(url);
    if (!r || !r.ok || typeof r.arrayBuffer !== 'function') return null;
    const b = new Uint8Array(await r.arrayBuffer());
    const enc = b[0] === 0xff && b[1] === 0xfe ? 'utf-16le' : b[0] === 0xfe && b[1] === 0xff ? 'utf-16be' : '';
    return enc ? new TextDecoder(enc).decode(b.subarray(2)) : null;
  } catch {
    return null;
  }
}

/** The preview a file gets: a pinned kind the viewer knows ('none', 'office' or a PINNABLE kind; anything else 'none'),
 *  else previewKindFor. */
export function previewKindOf(a) {
  const p = a && a.previewKind;
  if (p) return p === 'none' || p === 'office' || PINNABLE_PREVIEW_KINDS.has(p) ? p : 'none';
  return previewKindFor(a && a.kind, relOf(a));
}

const STALE = Object.freeze({ state: 'stale' });
const info = (reason) => ({ state: 'info', reason });
const officeBad = (status) => (OFFICE_INFO[status] ? info(OFFICE_INFO[status]) : { state: 'error', message: errorText({ status }) });

/** No converter on the server: the simplified in-browser preview, loaded on demand (a failed load is today's text). */
async function officeLite({ rel, stage, urls, fetchFn, deps, live }) {
  let mod;
  try {
    mod = await deps.loadOfficeLite();
  } catch {
    return live() ? info(OFFICE_NEEDS_LIBREOFFICE) : STALE;
  }
  if (!live()) return STALE;
  return mod.renderOfficeLite({ name: rel, stage, url: urls.download(rel), downloadUrl: urls.download(rel), fetch: fetchFn, deps, live });
}

/**
 * Load one file and render it into `stage`.
 * @param {object} o
 * @param {{kind?:string|null, relPath?:string, path?:string, previewKind?:string}} o.artifact
 * @param {HTMLElement} o.stage
 * @param {{text(rel):string, raw(rel):string, download(rel):string, pdf?(rel):string}} o.urls  `pdf`: an Office document's
 *   PDF form (the raw route's `?as=pdf`); without it Office files have no preview
 * @param {(url:string, opts?:object) => Promise<Response>} o.fetch
 * @param {{loadMarkdown?:Function, hljsLoader?:object, loadOfficeLite?:() => Promise<object>, officeImport?:(url:string) => Promise<unknown>}} [o.deps]
 *   `loadOfficeLite`: loads the simplified Office preview module; with it an Office file whose PDF probe answers 501 (no converter on the
 *   server) gets the simplified in-browser preview. `officeImport`: how that module imports its vendor scripts (tests)
 * @param {() => boolean} [o.live]   false once the caller moved on: every await re-checks it
 * @param {number|null} [o.size]     bytes, when the caller knows them
 * @param {(n:number) => void} [o.onSize]   a probe found the size the caller did not know
 * @param {{text:string, binary?:boolean}} [o.known]   the text the caller already holds (the Files tab's /api/tools/file)
 * @returns {Promise<{state:'shown', media?:HTMLMediaElement|null, text?:string, preview?:'office-lite', format?:string}
 *   | {state:'info', reason:string} | {state:'error', message:string} | {state:'stale'}>}  `text` is set only for a decoded
 *   text preview (decorations); `preview`/`format` only for the simplified Office preview
 */
export async function loadPreview({ artifact: a, stage, urls, fetch: fetchFn, deps = {}, live = () => true, size = null, onSize = null, known = null }) {
  const rel = relOf(a);
  const shown = displayPath(rel);             // what an alt text, a frame title or a player's label may say
  const kind = previewKindOf(a);
  const pin = a.previewKind && a.previewKind !== 'office' ? a.previewKind : null;
  if (kind === 'none') return info(NO_PREVIEW);
  if (kind === 'office') {
    if (typeof urls.pdf !== 'function') return info(NO_PREVIEW);
    const url = urls.pdf(rel);
    const probe = await headOf(fetchFn, url);       // converts on the server; the frame's GET reads its cache
    if (!live()) return STALE;
    if (!probe.ok) {
      return probe.status === 501 && typeof deps.loadOfficeLite === 'function'
        ? officeLite({ rel, stage, urls, fetchFn, deps, live })
        : officeBad(probe.status);
    }
    await renderPreview({ kind: null, relPath: shown, url, previewKind: 'pdf' }, stage, deps);
    return { state: 'shown', media: null };
  }
  if (RAW_PREVIEW_KINDS.has(kind)) {
    const url = urls.raw(rel);
    const probe = await headOf(fetchFn, url);
    if (!live()) return STALE;
    if (probe.size != null && size == null && typeof onSize === 'function') onSize(probe.size);
    if (!probe.ok) return probe.status === 413 || probe.status === 415 ? info(errorText(probe)) : { state: 'error', message: errorText(probe) };
    await renderPreview({ kind: a.kind || null, relPath: shown, url, previewKind: pin }, stage, deps);
    return { state: 'shown', media: stage.querySelector('audio, video') };
  }
  let n = size;
  let text;
  if (known && typeof known.text === 'string') {
    if (known.binary) {
      // A server that sniffed bytes (a NUL) may still hold UTF-16 text: only its byte-order mark can say.
      const wide = n != null && n <= TEXT_PREVIEW_MAX_BYTES ? await utf16Text(fetchFn, urls.download(rel)) : null;
      if (!live()) return STALE;
      if (wide == null) return info(NO_PREVIEW);
      await renderPreview({ kind: a.kind || null, relPath: shown, text: wide, previewKind: pin }, stage, deps);
      return { state: 'shown' };
    }
    text = known.text;
  } else {
    // A live row carries no size: the download form (any type, no ceiling) answers a HEAD with it, before the text route
    // pulls the whole file.
    if (n == null) {
      const got = (await headOf(fetchFn, urls.download(rel))).size;
      if (!live()) return STALE;
      if (got != null) { n = got; if (typeof onSize === 'function') onSize(got); }
    }
    if (Number(n) > TEXT_PREVIEW_MAX_BYTES) return info('Too large to preview');
    const res = await fetchFn(urls.text(rel));
    const data = await safeJson(res);
    if (!live()) return STALE;
    if (res.status === 413 || res.status === 415) return info(errorText({ status: res.status }));
    if (!res.ok) return { state: 'error', message: errorText({ status: res.status }) };
    text = typeof data.text === 'string' ? data.text : '';
    // No kind table names every byte format: decoded bytes are not a preview — unless they are UTF-16 text (Windows
    // PowerShell's `>` writes it), whose byte-order mark decodes to two U+FFFD on the UTF-8 text route.
    if (text.slice(0, 8192).includes(NUL)) {
      const wide = text.charCodeAt(0) === 0xfffd && text.charCodeAt(1) === 0xfffd ? await utf16Text(fetchFn, urls.download(rel)) : null;
      if (!live()) return STALE;
      if (wide == null) return info(NO_PREVIEW);
      await renderPreview({ kind: a.kind || null, relPath: shown, text: wide, previewKind: pin }, stage, deps);
      return { state: 'shown' };
    }
  }
  await renderPreview({ kind: a.kind || null, relPath: shown, text, previewKind: pin }, stage, deps);
  return { state: 'shown', text };
}
