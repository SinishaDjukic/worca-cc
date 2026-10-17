// ui/public/chat/files-card.mjs — the chat files card (type 'files', minted by turn.mjs from a show_files result):
// image tiles in a grid, every other file as a row with its kind, size and Download. Any tile or row opens the artifact
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

function fileRow(doc, item, r, href, onOpen) {
  const row = make(doc, 'div', 'ask-filescard-file');
  const name = make(doc, 'button', 'ask-filescard-name', item.name);
  name.type = 'button';
  name.title = `Open ${item.name}`;
  name.addEventListener('click', onOpen);
  const meta = make(doc, 'span', 'ask-filescard-meta', `${r.label} · ${formatBytes(item.bytes)}`);
  row.append(name, meta);
  if (href) {
    const dl = make(doc, 'a', 'ask-filescard-dl', 'Download');
    dl.href = href;
    dl.setAttribute('download', item.name);
    row.appendChild(dl);
  }
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
      grid.appendChild(b);
    } else {
      list.appendChild(fileRow(doc, item, r, url(item), () => open(index)));
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
