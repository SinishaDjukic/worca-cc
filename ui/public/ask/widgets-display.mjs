// ui/public/ask/widgets-display.mjs
// The DISPLAY half of the ask widget catalog v1 (ask-forms design §6.1). These
// widgets add nothing to the answer and are skipped by gate 3. Every agent string
// reaches the DOM through textContent; markdown is the one exception and it goes
// through ctx.markdown — the app's existing marked + DOMPurify pipeline, injected
// by the host — never through innerHTML.
import { resolvePath } from '../../../src/shared/forms/paths.mjs';
import { h, icon, ICON_INFO, fmtBytes, extOf, toneOf, own, fileRefAt, fileRefOfBind, noFileTile, servable } from './dom.mjs';
import { cellFor, colsOf, galleryPicker } from './widgets-input.mjs';

/** The value an item's `bind` points at, or undefined. */
function bound(item, ctx) {
  return item.bind ? resolvePath(item.bind, { data: ctx.data }) : undefined;
}

/** A display widget's optional caption row, drawn like a field label. */
function labelled(ctx, item, body) {
  if (!item.label) return body;
  const wrap = h(ctx.doc, 'div', 'af-fld af-display');
  wrap.append(h(ctx.doc, 'div', 'af-label', item.label), body);
  return wrap;
}

/** The "Open" affordance a servable file widget carries (and the PDF fallback, W14). */
function openLink(ctx, entry) {
  const a = h(ctx.doc, 'a', 'af-open', 'Open');
  a.setAttribute('href', ctx.fileUrl(entry.index));
  a.setAttribute('target', '_blank');
  a.setAttribute('rel', 'noopener noreferrer');
  return a;
}

/**
 * W5 — the ONE text seam. The widget never fetches: it asks the host for the
 * file's text and paints on resolve, unless the form was disposed meanwhile.
 * `fill(text)` is the widget's own inline painter, so a file-bound widget and an
 * inline one draw identically.
 */
function fillFromFile(ctx, entry, fill) {
  if (!ctx.loadText) return;
  ctx.loadText(entry.index).then((text) => {
    if (ctx.isDisposed()) return;
    fill(String(text == null ? '' : text));
  }).catch(() => { /* a missing preview is not a failed answer */ });
}

/** Minimal RFC-4180 CSV -> rows of objects, for a `table` bound to a .csv file. */
function csvRows(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l !== '');
  if (!lines.length) return { head: [], rows: [] };
  const split = (line) => {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };
  const head = split(lines[0]);
  const rows = lines.slice(1).map((l) => {
    const cells = split(l);
    const row = {};
    head.forEach((k, i) => { row[k] = cells[i]; });
    return row;
  });
  return { head, rows };
}

function markdownWidget(item, ctx) {
  const ref = fileRefOfBind(item, ctx);
  const entry = ref && servable(ctx, ref.entry) ? ref.entry : null;
  if (ref && !entry) return labelled(ctx, item, noFileTile(ctx, ref.rel));
  const box = h(ctx.doc, 'div', 'af-md');
  if (!entry) {                                  // inline markdown, the common case
    ctx.trackMarkdown(box, String(bound(item, ctx) ?? ''));
    return labelled(ctx, item, box);
  }
  const host = h(ctx.doc, 'div', 'af-md-host');
  const bar = h(ctx.doc, 'div', 'af-file-bar');
  bar.append(h(ctx.doc, 'span', 'af-file-name', entry.name), openLink(ctx, entry));
  host.append(bar, box);                          // the body stays empty until the text lands
  fillFromFile(ctx, entry, (text) => ctx.trackMarkdown(box, text));
  return labelled(ctx, item, host);
}

function codeLike(item, ctx, diff) {
  const ref = fileRefOfBind(item, ctx);
  const entry = ref && servable(ctx, ref.entry) ? ref.entry : null;
  if (ref && !entry) return labelled(ctx, item, noFileTile(ctx, ref.rel));
  const host = h(ctx.doc, 'div', 'af-code-host');
  const paint = (text) => {
    const box = textBox(ctx, text, { name: item.name || (entry && entry.name), lang: diff ? '' : item.lang, diff });
    if (entry) box.querySelector('.af-code-bar').appendChild(openLink(ctx, entry));
    host.replaceChildren(box);
  };
  paint(entry ? '' : bound(item, ctx));
  if (entry) fillFromFile(ctx, entry, paint);
  return labelled(ctx, item, host);
}

function codeWidget(item, ctx) { return codeLike(item, ctx, false); }
function diffWidget(item, ctx) { return codeLike(item, ctx, true); }

function tableWidget(item, ctx) {
  const ref = fileRefOfBind(item, ctx);
  const entry = ref && servable(ctx, ref.entry) ? ref.entry : null;
  if (ref && !entry) return labelled(ctx, item, noFileTile(ctx, ref.rel));
  const wrap = h(ctx.doc, 'div', 'af-tbl-wrap');
  const paint = (rows, cols) => {
    const table = h(ctx.doc, 'table', 'af-tbl');
    const thead = ctx.doc.createElement('thead');
    const hr = ctx.doc.createElement('tr');
    for (const c of cols) hr.appendChild(h(ctx.doc, 'th', c.align === 'right' ? 'af-r' : '', c.label || c.key));
    thead.appendChild(hr);
    const tbody = ctx.doc.createElement('tbody');
    for (const r of rows) {
      const tr = ctx.doc.createElement('tr');
      for (const c of cols) tr.appendChild(cellFor(ctx, c, r));
      tbody.appendChild(tr);
    }
    table.append(thead, tbody);
    wrap.replaceChildren(table);
  };
  const declared = colsOf(item);
  if (entry) {
    paint([], declared);
    fillFromFile(ctx, entry, (text) => {
      const { head, rows } = csvRows(text);
      paint(rows, declared.length ? declared : head.map((k) => ({ key: k, label: k })));
    });
  } else {
    const rows = bound(item, ctx);
    paint(Array.isArray(rows) ? rows : [], declared);
  }
  return labelled(ctx, item, wrap);
}

function jsonWidget(item, ctx) {
  const ref = fileRefOfBind(item, ctx);
  const entry = ref && servable(ctx, ref.entry) ? ref.entry : null;
  if (ref && !entry) return labelled(ctx, item, noFileTile(ctx, ref.rel));
  const box = h(ctx.doc, 'div', 'af-json');
  const paint = (value) => box.replaceChildren(jsonNode(ctx, null, value));
  if (entry) {
    paint(null);
    fillFromFile(ctx, entry, (text) => {
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      paint(parsed);
    });
  } else {
    paint(bound(item, ctx));
  }
  return labelled(ctx, item, box);
}

function calloutWidget(item, ctx) {
  const tone = toneOf(item.tone) || 'info';
  const box = h(ctx.doc, 'div', `af-callout af-${tone}`);
  box.appendChild(icon(ctx.doc, ICON_INFO, 16));
  const body = h(ctx.doc, 'div', 'af-callout-body');
  if (item.title) body.appendChild(h(ctx.doc, 'b', '', item.title));
  body.appendChild(ctx.doc.createTextNode(String(bound(item, ctx) ?? item.text ?? '')));
  box.appendChild(body);
  return box;
}

function jsonNode(ctx, key, v) {
  const k = key == null ? null : h(ctx.doc, 'span', 'af-j-k', `${key}: `);
  if (v && typeof v === 'object') {
    const arr = Array.isArray(v);
    const keys = Object.keys(v);
    const d = ctx.doc.createElement('details');
    d.open = true;
    const sum = ctx.doc.createElement('summary');
    if (k) sum.appendChild(k);
    sum.appendChild(h(ctx.doc, 'span', 'af-j-c', arr ? `[${keys.length}]` : `{${keys.length}}`));
    d.appendChild(sum);
    for (const kk of keys) d.appendChild(jsonNode(ctx, arr ? null : kk, v[kk]));
    return d;
  }
  const leaf = h(ctx.doc, 'div', 'af-j-leaf');
  if (k) leaf.appendChild(k);
  leaf.appendChild(h(ctx.doc, 'span', typeof v === 'string' ? 'af-j-s' : 'af-j-n', JSON.stringify(v)));
  return leaf;
}

/**
 * The shared code / diff chrome: a bar, then one `.af-ln` span per source line.
 * `diff: true` classes +/- / @@ lines and counts them into the bar.
 */
export function textBox(ctx, text, { name = '', lang = '', diff = false } = {}) {
  const src = String(text == null ? '' : text);
  const wrap = h(ctx.doc, 'div', 'af-code');
  const bar = h(ctx.doc, 'div', 'af-code-bar');
  bar.appendChild(h(ctx.doc, 'span', 'af-code-name', name || (diff ? 'changes' : 'snippet')));
  const lines = src === '' ? [] : src.split('\n');
  if (diff) {
    let add = 0; let del = 0;
    for (const l of lines) { if (l[0] === '+') add += 1; else if (l[0] === '-') del += 1; }
    bar.append(h(ctx.doc, 'span', 'af-add', `+${add}`), h(ctx.doc, 'span', 'af-del', `−${del}`));
  } else if (lang) {
    bar.appendChild(h(ctx.doc, 'span', 'af-code-lang', lang));
  }
  const pre = ctx.doc.createElement('pre');
  const code = ctx.doc.createElement('code');
  if (!diff && lang) code.className = `language-${String(lang).replace(/[^A-Za-z0-9_+-]/g, '')}`;
  if (diff) {
    lines.forEach((l) => {
      const cls = l[0] === '+' ? 'af-ln af-add' : l[0] === '-' ? 'af-ln af-del'
        : l.slice(0, 2) === '@@' ? 'af-ln af-hunk' : 'af-ln';
      code.appendChild(h(ctx.doc, 'span', cls, l));
    });
  } else {
    code.textContent = src;                       // byte-exact, so hljs can round-trip it
  }
  pre.appendChild(code);
  wrap.append(bar, pre);
  if (!diff && lang && ctx.highlight) { try { void ctx.highlight(wrap); } catch { /* cosmetic */ } }
  return wrap;
}

function fileListWidget(item, ctx) {
  const rows = bound(item, ctx);
  const fileKey = item.fileKey || 'file';
  const noteKey = item.noteKey || 'note';
  const ul = h(ctx.doc, 'ul', 'af-files');
  for (const r of Array.isArray(rows) ? rows : []) {
    // X16: a row widget reads its own declared `fileKey` — no fileRefs lookup needed.
    const rel = own(r, fileKey);
    const entry = ctx.fileFor(rel);
    const li = ctx.doc.createElement('li');
    // X14: no snapshot -> the row IS the .af-nofile tile (badge + name, no size).
    if (!entry) li.className = 'af-nofile';
    li.appendChild(h(ctx.doc, 'span', 'af-file-badge', extOf(entry ? entry.name : rel)));
    li.appendChild(h(ctx.doc, 'span', 'af-file-name', String(rel == null ? '' : rel)));
    const note = own(r, noteKey);
    if (note != null && note !== '') li.appendChild(h(ctx.doc, 'span', 'af-file-note', String(note)));
    if (entry) li.appendChild(h(ctx.doc, 'span', 'af-file-size', fmtBytes(entry.bytes)));
    ul.appendChild(li);
  }
  return labelled(ctx, item, ul);
}

function imageWidget(item, ctx) {
  const ref = fileRefOfBind(item, ctx);                  // X16: declared as type:'file'?
  const entry = ref && servable(ctx, ref.entry) ? ref.entry : null;
  if (!entry) return labelled(ctx, item, noFileTile(ctx, ref ? ref.rel : item.bind));   // X14
  const fig = h(ctx.doc, 'figure', 'af-img');
  const img = ctx.doc.createElement('img');                      // SVG included
  img.setAttribute('src', ctx.fileUrl(entry.index));
  img.setAttribute('alt', String(item.caption || (entry && entry.name) || ''));
  img.setAttribute('loading', 'lazy');
  fig.appendChild(img);
  const cap = h(ctx.doc, 'figcaption', '');
  cap.textContent = `${item.caption ? `${item.caption} — ` : ''}${entry.name} · ${fmtBytes(entry.bytes)}`;
  cap.appendChild(openLink(ctx, entry));
  fig.appendChild(cap);
  return labelled(ctx, item, fig);
}

function compareWidget(item, ctx) {
  const beforeRef = fileRefAt(item.before, ctx);         // X16: by DECLARED path
  const afterRef = fileRefAt(item.after, ctx);
  const before = beforeRef && beforeRef.entry;
  const after = afterRef && afterRef.entry;
  const beforeLabel = String(item.beforeLabel || 'Before');
  const afterLabel = String(item.afterLabel || 'After');
  // X14: either half missing makes the swipe meaningless — one tile per side.
  if (!servable(ctx, before) || !servable(ctx, after)) {
    const box = h(ctx.doc, 'div', 'af-cmp');
    box.append(noFileTile(ctx, beforeRef ? beforeRef.rel : item.before),
      noFileTile(ctx, afterRef ? afterRef.rel : item.after));
    return labelled(ctx, item, box);
  }
  const view = h(ctx.doc, 'div', 'af-cmp-view');
  const baseImg = ctx.doc.createElement('img');
  baseImg.setAttribute('src', ctx.fileUrl(after.index));
  baseImg.setAttribute('alt', afterLabel);
  const top = ctx.doc.createElement('img');
  top.className = 'af-cmp-top';
  top.setAttribute('src', ctx.fileUrl(before.index));
  top.setAttribute('alt', beforeLabel);
  const line = h(ctx.doc, 'div', 'af-cmp-line');
  view.append(baseImg, top, line,
    h(ctx.doc, 'span', 'af-cmp-tag af-l', beforeLabel),
    h(ctx.doc, 'span', 'af-cmp-tag af-r', afterLabel));
  const set = (p) => {
    top.style.clipPath = `inset(0 ${100 - p}% 0 0)`;
    line.style.left = `${p}%`;
  };
  const r = ctx.doc.createElement('input');
  r.type = 'range';
  r.className = 'af-cmp-range';
  r.setAttribute('min', '0');
  r.setAttribute('max', '100');
  r.setAttribute('step', '1');
  r.value = '50';
  r.id = ctx.idFor(`cmp-${item.before || ''}`);
  r.setAttribute('aria-label', `Swipe between ${beforeLabel} and ${afterLabel}`);
  r.addEventListener('input', () => set(Number(r.value)));
  set(50);
  const box = h(ctx.doc, 'div', 'af-cmp');
  box.append(view, r);
  return labelled(ctx, item, box);
}

function mediaWidget(item, ctx) {
  const ref = fileRefOfBind(item, ctx);                  // X16
  const entry = ref && servable(ctx, ref.entry) ? ref.entry : null;
  if (!entry) return labelled(ctx, item, noFileTile(ctx, ref ? ref.rel : item.bind));   // X14
  const audio = String(entry.mime || '').startsWith('audio/');
  const el = ctx.doc.createElement(audio ? 'audio' : 'video');
  el.className = 'af-media';
  el.setAttribute('controls', '');
  el.setAttribute('preload', 'metadata');           // never autoplay
  el.setAttribute('src', ctx.fileUrl(entry.index));
  el.setAttribute('aria-label', entry.name);
  return labelled(ctx, item, el);
}

/**
 * W14 — the browser's own PDF viewer in a host-owned frame. The frame carries NO
 * `sandbox` attribute on purpose: Chromium refuses to run its PDF plugin inside a
 * sandboxed frame, and the bytes are type-verified server side (%PDF- sniff,
 * allowlist, nosniff, Content-Disposition: inline) on a loopback-guarded route.
 * The "Open" link is permanent, so a browser that will not embed a PDF still has
 * a way through. To fall back to link-only: drop the `frame` from the append.
 */
function pdfWidget(item, ctx) {
  const ref = fileRefOfBind(item, ctx);                  // X16
  const entry = ref && servable(ctx, ref.entry) ? ref.entry : null;
  if (!entry) return labelled(ctx, item, noFileTile(ctx, ref ? ref.rel : item.bind, 'PDF'));   // X14: no frame
  const box = h(ctx.doc, 'div', 'af-pdf');
  const bar = h(ctx.doc, 'div', 'af-pdf-bar');
  bar.append(h(ctx.doc, 'span', 'af-file-badge', 'PDF'),
    h(ctx.doc, 'span', 'af-file-name', entry.name),
    h(ctx.doc, 'span', 'af-file-size', fmtBytes(entry.bytes)),
    openLink(ctx, entry));
  const frame = ctx.doc.createElement('iframe');
  frame.className = 'af-pdf-frame';
  frame.dataset.afPdf = 'frame';
  frame.setAttribute('title', `PDF preview: ${entry.name}`);
  frame.setAttribute('loading', 'lazy');
  frame.setAttribute('src', ctx.fileUrl(entry.index));
  box.append(bar, frame);
  return labelled(ctx, item, box);
}

export const DISPLAY_WIDGETS_TABLE = Object.freeze({
  markdown: markdownWidget,
  callout: calloutWidget,
  table: tableWidget,
  json: jsonWidget,
  code: codeWidget,
  diff: diffWidget,
  'file-list': fileListWidget,
  image: imageWidget,
  gallery: galleryPicker,       // the SAME function; `item.field` makes it an input
  compare: compareWidget,
  media: mediaWidget,
  pdf: pdfWidget,
});
