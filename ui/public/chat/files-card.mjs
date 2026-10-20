// ui/public/chat/files-card.mjs — the chat files card (type 'files', minted by turn.mjs from a show_files result):
// image tiles in a grid, every other file as a row with its kind and size; each file has Download and, for a copy
// with a known original, Show in folder. Any tile or row opens the artifact
// viewer (artifacts/viewer.mjs) on the card's files: ←/→, click-to-zoom, Full screen, Download. Display only — no
// Apply/Decline. The bytes come from GET /api/ask/threads/:id/attachments/:attId: no path ever reaches the browser.
import { registerChatCard } from './extensions.mjs';
import { registerFileRenderer, fileRendererFor, filePreviewOf } from './file-renderers.mjs';
import { langForPath } from '../syntax-highlight.mjs';
import { formatBytes } from '../artifacts/common.mjs';

export const FILES_CARD_TYPE = 'files';

export function attachmentUrl(threadId, attId) {
  return `/api/ask/threads/${encodeURIComponent(threadId)}/attachments/${encodeURIComponent(attId)}`;
}

/** Card items → the viewer's list. relPath is `<attId>/<name>`: the viewer titles a file by its base name, and the
 *  urls below read the attachment id back out of the first segment (the viewer's info view and tooltip show the full
 *  relPath, id included — accepted). previewKind pins the kind the server sniffed. */
export function filesForViewer(items) {
  return items.map((it) => ({ relPath: `${it.attId}/${it.name}`, bytes: it.bytes, previewKind: filePreviewOf(it) }));
}

/** The viewer's urls contract ({text, raw, download}) over the attachment route. */
export function fileViewerUrls(threadId) {
  const at = (rel) => attachmentUrl(threadId, String(rel).split('/')[0]);
  return { raw: at, download: at, text: (rel) => `${at(rel)}?as=text` };
}

const make = (doc, tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

/** The run artifacts browser's glyphs (artifacts/browser.mjs): the same icon buttons on a card's files. */
const GLYPH = {
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 19h14"/>',
  folder: '<path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4.6l2 2.5H19a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
};
function glyph(doc, body) {
  const s = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = body;                                       // repo-shipped glyphs only
  return s;
}

/** A file's icon buttons: Show in folder (a show_files copy with a `source`, once ctx.revealInfo says this worca can
 *  open a folder here) and Download. Show in folder starts hidden, so a hosted worca never shows it. */
function fileActions(doc, item, href, ctx, tid) {
  const box = make(doc, 'span', 'ask-filescard-acts');
  if (item.source === true && tid && typeof ctx.revealFile === 'function' && typeof ctx.revealInfo === 'function') {
    const fb = make(doc, 'button', 'btn btn-sm btn-quiet btn-icon ask-filescard-ib ask-filescard-reveal');
    fb.type = 'button';
    fb.hidden = true;
    fb.appendChild(glyph(doc, GLYPH.folder));
    fb.addEventListener('click', (e) => { e.stopPropagation(); ctx.revealFile({ threadId: tid, attId: item.attId, name: item.name }); });
    Promise.resolve(ctx.revealInfo()).then((info) => {
      if (!info || !info.label) return;
      fb.title = `Show in ${info.label}`;
      fb.setAttribute('aria-label', `Show ${item.name} in ${info.label}`);
      fb.hidden = false;
    }, () => {});
    box.appendChild(fb);
  }
  if (href) {
    const dl = make(doc, 'a', 'btn btn-sm btn-quiet btn-icon ask-filescard-ib ask-filescard-dl');
    dl.href = href;
    dl.setAttribute('download', item.name);
    dl.title = 'Download';
    dl.setAttribute('aria-label', `Download ${item.name}`);
    dl.appendChild(glyph(doc, GLYPH.download));
    dl.addEventListener('click', (e) => e.stopPropagation());
    box.appendChild(dl);
  }
  return box;
}

/** An image tile: <img> only — an SVG drawn this way never runs a script. width/height reserve the aspect. */
function imageThumb(item, ctx) {
  const img = make(ctx.doc, 'img', 'ask-filescard-img');
  img.src = ctx.url(item);
  img.alt = item.name;
  img.loading = 'lazy';
  img.decoding = 'async';
  if (item.width && item.height) { img.width = item.width; img.height = item.height; }
  return img;
}

export function registerBuiltinFileRenderers() {
  registerFileRenderer('image', { label: 'Image', preview: 'image', thumb: imageThumb });
  registerFileRenderer('svg', { label: 'SVG', preview: 'image', thumb: imageThumb });
  registerFileRenderer('pdf', { label: 'PDF', preview: 'pdf' });
  registerFileRenderer('video', { label: 'Video', preview: 'video' });
  registerFileRenderer('audio', { label: 'Audio', preview: 'audio' });
  registerFileRenderer('markdown', { label: 'Markdown', preview: 'markdown' });
  registerFileRenderer('json', { label: 'JSON', preview: 'json' });
  registerFileRenderer('diff', { label: 'Diff', preview: 'diff' });
  registerFileRenderer('csv', { label: 'Table', preview: 'csv' });
  registerFileRenderer('html', { label: 'HTML source', preview: 'code' });            // highlighted source, never a frame
  registerFileRenderer('text', { label: 'Text', preview: (item) => (langForPath(item.name) ? 'code' : 'text') });
}

function fileRow(doc, item, r, href, onOpen, ctx, tid) {
  const row = make(doc, 'div', 'ask-filescard-file');
  const name = make(doc, 'button', 'ask-filescard-name', item.name);
  name.type = 'button';
  name.title = `Open ${item.name}`;
  name.addEventListener('click', onOpen);
  const meta = make(doc, 'span', 'ask-filescard-meta', `${r.label} · ${formatBytes(item.bytes)}`);
  row.append(name, meta);
  const acts = fileActions(doc, item, href, ctx, tid);
  if (acts.childElementCount) row.appendChild(acts);
  return row;
}

/** build(block, ctx) for registerChatCard. */
export function buildFilesCard(block, ctx) {
  const doc = ctx.doc;
  const card = (block && block.card) || {};
  const items = (Array.isArray(card.items) ? card.items : []).filter((it) => it && typeof it.attId === 'string' && typeof it.name === 'string');
  const tid = typeof ctx.threadId === 'function' ? ctx.threadId() : null;
  const url = (item) => (tid ? attachmentUrl(tid, item.attId) : '');
  const title = card.caption || card.title || (items.length === 1 ? items[0].name : `${items.length} files`);
  const root = make(doc, 'div', 'ask-card ask-mcard ask-filescard');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', title);
  const head = make(doc, 'div', 'ask-mcard-head');
  head.append(make(doc, 'span', 'ask-mcard-title', title), make(doc, 'span', 'ask-mcard-kind', 'Files'));
  root.appendChild(head);
  const open = (index) => { if (tid && typeof ctx.openFiles === 'function') ctx.openFiles({ threadId: tid, items, index }); };
  const grid = make(doc, 'div', 'ask-filescard-grid');
  const list = make(doc, 'div', 'ask-filescard-list');
  items.forEach((item, index) => {
    const r = fileRendererFor(item);
    let tile = null;
    if (r.thumb && tid) { try { tile = r.thumb(item, { doc, url }); } catch { tile = null; } }
    if (tile) {
      const b = make(doc, 'button', 'ask-filescard-thumb');
      b.type = 'button';
      b.title = item.name;
      b.setAttribute('aria-label', `Open ${item.name}`);
      b.appendChild(tile);
      b.addEventListener('click', () => open(index));
      // The tile and its icon buttons are siblings: a button never sits inside another button.
      const cell = make(doc, 'div', 'ask-filescard-tile');
      cell.appendChild(b);
      const acts = fileActions(doc, item, url(item), ctx, tid);
      if (acts.childElementCount) cell.appendChild(acts);
      grid.appendChild(cell);
    } else {
      list.appendChild(fileRow(doc, item, r, url(item), () => open(index), ctx, tid));
    }
  });
  if (grid.childElementCount === 1) grid.classList.add('is-single');
  if (grid.childElementCount) root.appendChild(grid);
  if (list.childElementCount) root.appendChild(list);
  const skipped = Array.isArray(card.skipped) ? card.skipped : [];
  if (skipped.length) {
    root.appendChild(make(doc, 'p', 'ask-filescard-skipped',
      `Not shown: ${skipped.map((s) => `${s.name || 'a file'} (${s.reason || 'refused'})`).join('; ')}`));
  }
  return { el: root };
}

/** Register the built-in renderers and the card. app.js calls it above createAskPanel, beside registerChatActionCards. */
export function registerFilesCard() {
  registerBuiltinFileRenderers();
  registerChatCard(FILES_CARD_TYPE, buildFilesCard);
}
