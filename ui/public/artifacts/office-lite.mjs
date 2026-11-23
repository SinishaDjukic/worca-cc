// ui/public/artifacts/office-lite.mjs — the simplified in-browser Office preview, used only when the server has no converter
// (the PDF probe answered 501) and the caller opted in with deps.loadOfficeLite. The ONLY lazy entry of the office-* family:
// stage.mjs never imports it, app.js loads it with one dynamic import. JSZip (and docx-preview, for .docx only) are
// vendored UMD scripts on same-origin /vendor routes, loaded on demand. It never throws: a refusal is the caller's info
// view (with Download), a stale render never mounts, and every blob: URL a render made is revoked when it is replaced.
import { OFFICE_LITE_LIMITS, officeLiteFormatFor } from '../../../src/shared/artifact-kinds.mjs';
import { baseName, formatBytes } from './common.mjs';
import { NO_PREVIEW, OFFICE_NEEDS_LIBREOFFICE, errorText } from './stage.mjs';
import { downloadArtifact } from './viewer.mjs';
import { OfficeLiteError, fetchCapped, openCappedZip } from './office-zip.mjs';
import { colName, readOds, readXlsx } from './office-sheet.mjs';
import { readOdp, readPptx } from './office-slides.mjs';
import { readOdt } from './office-text.mjs';
import { renderDocx } from './office-docx.mjs';

export const LITE_NOTE = 'Simplified preview — install LibreOffice for full fidelity';
export const LITE_VENDOR = Object.freeze({ jszip: '/vendor/jszip/jszip.min.js', docx: '/vendor/docx-preview/docx-preview.min.js' });

const STALE = Object.freeze({ state: 'stale' });
const info = (reason) => ({ state: 'info', reason });
const libsByWindow = new WeakMap();

/** Load JSZip (and docx-preview) into `win`, one after the other, never in parallel. docx-preview's UMD reads
 *  `globalThis.JSZip` once, when it is evaluated, and a browser never evaluates a cached module again: so the memoised
 *  JSZip is put back on the window around docx-preview's import, and both globals are deleted after capture. Each
 *  library is ONE promise per window, so renders that load at the same time share the load in flight (a second render
 *  never reads a global the first already deleted, nor deletes JSZip while docx-preview evaluates). A rejected promise
 *  is dropped (the next open retries). Any failure → LOAD_FAILED. */
export async function loadOfficeLibs(win, { importer, docx = false } = {}) {
  const load = typeof importer === 'function' ? importer : (u) => import(u);
  let memo = libsByWindow.get(win);
  if (!memo) { memo = {}; libsByWindow.set(win, memo); }
  const once = (key, make) => {
    if (!memo[key]) {
      const p = make();
      memo[key] = p;
      p.catch(() => { if (memo[key] === p) memo[key] = null; });
    }
    return memo[key];
  };
  try {
    const JSZip = await once('zip', async () => {
      try {
        await load(LITE_VENDOR.jszip);
        const Z = win.JSZip;
        if (typeof Z !== 'function' || typeof Z.loadAsync !== 'function') throw new Error('no JSZip');
        return Z;
      } finally {
        delete win.JSZip;
      }
    });
    if (!docx) return { JSZip };
    const d = await once('docx', async () => {
      win.JSZip = JSZip;
      try {
        await load(LITE_VENDOR.docx);
        const lib = win.docx;
        if (!lib || typeof lib.parseAsync !== 'function' || typeof lib.renderDocument !== 'function') throw new Error('no docx-preview');
        return lib;
      } finally {
        delete win.JSZip;
        delete win.docx;
      }
    });
    return { JSZip, docx: d };
  } catch {
    throw new OfficeLiteError('LOAD_FAILED');
  }
}

/** The info text for a refusal. */
export function liteReason(err, limits) {
  switch (err && err.code) {
    case 'TOO_LARGE': return `Too large for the simplified preview (over ${formatBytes(limits.maxBytes)}). Install LibreOffice to preview it.`;
    case 'TOO_MANY': return `Too many parts for the simplified preview (over ${limits.maxEntries.toLocaleString('en-US')}). Install LibreOffice to preview it.`;
    case 'EXPANDS': return `Expands past the simplified preview's limit (${formatBytes(limits.maxTotal)}). Install LibreOffice to preview it.`;
    case 'LOAD_FAILED': return OFFICE_NEEDS_LIBREOFFICE;
    default: return 'Could not read this file. Install LibreOffice to preview it.';
  }
}

/** Blob URLs per stage (D15): {win, urls}. A new render revokes those of every disconnected stage and of its own. */
const blobsByStage = new Map();
const revoke = (win, urls) => { for (const u of urls) { try { win.URL.revokeObjectURL(u); } catch { /* already gone */ } } };
function sweep(stage) {
  for (const [s, rec] of blobsByStage) {
    if (s === stage || !s.isConnected) { revoke(rec.win, rec.urls); blobsByStage.delete(s); }
  }
}

let panelSeq = 0;

function el(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function cutNote(sheet, limits) {
  const rows = `${limits.maxRows.toLocaleString('en-US')} rows`;
  const cols = `${limits.maxCols.toLocaleString('en-US')} columns`;
  if (sheet.cutRows && sheet.cutCols) return `Showing the first ${rows} and ${cols}.`;
  if (sheet.cutRows) return `Showing the first ${rows}.`;
  if (sheet.cutCols) return `Showing the first ${cols}.`;
  return '';
}

function sheetTable(doc, sheet) {
  const width = sheet.rows.reduce((m, r) => Math.max(m, r.length), 0);
  const table = el(doc, 'table', 'olp-table');
  const head = doc.createElement('tr');
  head.append(el(doc, 'th', 'olp-corner'));
  for (let c = 0; c < width; c++) head.append(el(doc, 'th', null, colName(c)));
  const thead = doc.createElement('thead');
  thead.append(head);
  const tbody = doc.createElement('tbody');
  sheet.rows.forEach((row, r) => {
    const tr = doc.createElement('tr');
    tr.append(el(doc, 'th', null, String(r + 1)));
    for (let c = 0; c < width; c++) tr.append(el(doc, 'td', null, row[c] ?? ''));
    tbody.append(tr);
  });
  table.append(thead, tbody);
  return table;
}

function sheetView(doc, model, limits) {
  const frag = doc.createDocumentFragment();
  const id = `olp-sheet-${++panelSeq}`;
  const tabs = el(doc, 'div', 'olp-tabs tabs');
  tabs.setAttribute('role', 'tablist');
  const panel = el(doc, 'div', 'olp-sheet');
  panel.id = id;
  panel.setAttribute('role', 'tabpanel');
  panel.tabIndex = 0;
  const buttons = model.sheets.map((s, i) => {
    const b = el(doc, 'button', 'olp-tab tab', s.name);
    b.type = 'button';
    b.id = `${id}-tab-${i}`;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', id);
    return b;
  });
  const select = (i) => {
    buttons.forEach((b, k) => { b.setAttribute('aria-selected', String(k === i)); b.tabIndex = k === i ? 0 : -1; });
    const sheet = model.sheets[i];
    panel.setAttribute('aria-labelledby', buttons[i].id);
    const note = cutNote(sheet, limits);
    panel.replaceChildren(sheetTable(doc, sheet), ...(note ? [el(doc, 'p', 'olp-cut', note)] : []));
  };
  buttons.forEach((b, i) => {
    b.addEventListener('click', () => select(i));
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const next = (i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length;
      select(next);
      buttons[next].focus();
    });
  });
  tabs.append(...buttons);
  if (buttons.length) select(0);
  else panel.append(el(doc, 'p', 'olp-cut', 'No visible sheets.'));
  frag.append(tabs, panel);
  return frag;
}

function slidesView(doc, model, thumbUrl) {
  const frag = doc.createDocumentFragment();
  if (thumbUrl) {
    const fig = el(doc, 'figure', 'olp-thumb');
    const img = doc.createElement('img');
    img.setAttribute('src', thumbUrl);
    img.setAttribute('alt', 'Embedded thumbnail');
    fig.append(img);
    frag.append(fig);
  }
  const list = el(doc, 'ol', 'olp-slides');
  for (const s of model.slides) {
    const li = el(doc, 'li', 'olp-slide');
    li.append(el(doc, 'h3', 'olp-slide-title', `Slide ${s.n}${s.title ? ` — ${s.title}` : ''}${s.hidden ? ' (hidden)' : ''}`));
    for (const p of s.paragraphs) li.append(el(doc, 'p', null, p));
    list.append(li);
  }
  frag.append(list);
  return frag;
}

function textView(doc, model) {
  const art = el(doc, 'article', 'olp-text');
  let ul = null;
  for (const b of model.blocks) {
    if (b.tag === 'li') {
      if (!ul) { ul = doc.createElement('ul'); art.append(ul); }
      ul.append(el(doc, 'li', null, b.text));
      continue;
    }
    ul = null;
    art.append(el(doc, b.tag === 'h' ? `h${b.level}` : 'p', null, b.text));
  }
  return art;
}

function banner(doc, { name, downloadUrl, fetch: fetchFn }) {
  const box = el(doc, 'div', 'olp-banner');
  box.setAttribute('role', 'note');
  const dl = el(doc, 'button', 'btn btn-sm olp-dl', 'Download');
  dl.type = 'button';
  const err = el(doc, 'p', 'olp-dl-error');
  err.hidden = true;
  dl.addEventListener('click', async () => {
    err.hidden = true;
    const r = await downloadArtifact({ doc, fetch: fetchFn, url: downloadUrl, name: baseName(name) });
    if (!r.ok) { err.textContent = `Download failed: ${r.error}`; err.hidden = false; }
  });
  box.append(el(doc, 'p', 'olp-note', LITE_NOTE), dl, err);
  return box;
}

/**
 * Render an Office file's simplified preview into `stage` (mounted only at the end, with replaceChildren).
 * @returns {Promise<{state:'shown', media:null, preview:'office-lite', format:string} | {state:'info', reason:string}
 *   | {state:'error', message:string} | {state:'stale'}>}  never rejects
 */
export async function renderOfficeLite({ name, stage, url, downloadUrl, fetch: fetchFn, deps = {}, live = () => true, limits = OFFICE_LITE_LIMITS }) {
  const format = officeLiteFormatFor(name);
  if (!format) return info(NO_PREVIEW);
  const doc = stage.ownerDocument;
  const win = doc.defaultView;
  const made = [];
  const stale = () => { revoke(win, made); return STALE; };
  try {
    sweep(stage);
    const libs = await loadOfficeLibs(win, { importer: deps.officeImport, docx: format === 'docx' });
    if (!live()) return stale();
    const bytes = await fetchCapped(fetchFn, url, { maxBytes: limits.maxBytes });
    if (!live()) return stale();
    const zip = await openCappedZip(libs.JSZip, bytes, limits);
    if (!live()) return stale();
    const lower = String(name).toLowerCase();
    let body;
    if (format === 'docx') {
      if (typeof deps.loadMarkdown !== 'function') throw new OfficeLiteError('LOAD_FAILED');
      let createDOMPurify;
      try { createDOMPurify = (await deps.loadMarkdown())?.createDOMPurify; } catch { createDOMPurify = null; }
      if (typeof createDOMPurify !== 'function') throw new OfficeLiteError('LOAD_FAILED');
      if (!live()) return stale();
      const out = await renderDocx({ zip, docx: libs.docx, createDOMPurify, win, limits });
      made.push(...out.blobUrls);
      body = out.node;
    } else if (format === 'sheet') {
      body = sheetView(doc, await (lower.endsWith('.ods') ? readOds : readXlsx)(zip, win.DOMParser, limits), limits);
    } else if (format === 'slides') {
      const model = await (lower.endsWith('.odp') ? readOdp : readPptx)(zip, win.DOMParser, limits);
      let thumbUrl = null;
      if (model.thumbnail) {
        thumbUrl = win.URL.createObjectURL(new win.Blob([model.thumbnail], { type: model.thumbnail.type }));
        made.push(thumbUrl);
      }
      body = slidesView(doc, model, thumbUrl);
    } else {
      body = textView(doc, await readOdt(zip, win.DOMParser, limits));
    }
    if (!live()) return stale();
    const root = el(doc, 'div', 'olp');
    root.dataset.officePath = format;
    root.append(banner(doc, { name, downloadUrl, fetch: fetchFn }), body);
    stage.replaceChildren(root);
    blobsByStage.set(stage, { win, urls: made });
    return { state: 'shown', media: null, preview: 'office-lite', format };
  } catch (err) {
    revoke(win, made);
    if (!live()) return STALE;
    if (err instanceof OfficeLiteError && err.code === 'NOT_FOUND') return { state: 'error', message: errorText({ status: 404 }) };
    return info(liteReason(err instanceof OfficeLiteError ? err : null, limits));
  }
}
