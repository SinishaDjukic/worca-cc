// ui/public/artifacts/browser.mjs — a run's artifacts as a folder browser (Chat P5): the Workflows Library's folder
// look (library.mjs `.wfl-folder/.wfl-fold/.wfl-item`) under its own `afb-` classes. One folder per step (its node
// label; artifacts no step claims sit in "Run", last), "Cycle N" subfolders when a step ran more than once (the latest
// open), and a closed folder for a burst of one kind (more than BULK_KIND_THRESHOLD files — a deck audit's
// screenshots). Folders open in place and keep their state across live updates; the header's search lists every
// match flat with a "where" caption. Pure DOM over the list the caller hands in; opening and downloading are
// callbacks. Every string from data goes through textContent.
import { groupArtifactsByKind, BULK_KIND_THRESHOLD } from '../artifact-view-c4.mjs';
import { relOf, baseName, displayPath, isAbsolutePath, formatBytes, midTruncate, previewKindFor } from './common.mjs';

const RUN = '__run__';
const GLYPH = {
  folder: '<path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4.6l2 2.5H19a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 19h14"/>',
};
/** One glyph per preview family. */
const FAMILY_GLYPH = {
  doc: '<path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4M9.5 12h6M9.5 15h6M9.5 18h4"/>',
  code: '<path d="M9 8l-4 4 4 4M15 8l4 4-4 4"/>',
  data: '<path d="M8 4c-2 0-2 2-2 4s-1 4-2 4c1 0 2 2 2 4s0 4 2 4M16 4c2 0 2 2 2 4s1 4 2 4c-1 0-2 2-2 4s0 4-2 4"/>',
  diff: '<path d="M12 4v8M8 8h8M8 18h8"/>',
  image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20 16l-5-5-7 8"/>',
  media: '<path d="M7 5v14l11-7z"/>',
  web: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.5 2.5 2.5 13.5 0 16M12 4c-2.5 2.5-2.5 13.5 0 16"/>',
  table: '<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M4 10h16M4 14.5h16M10 5v14"/>',
  file: '<path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4"/>',
};
const FAMILY = {
  markdown: 'doc', text: 'doc', pdf: 'doc', code: 'code', json: 'data', c4: 'data', diff: 'diff', image: 'image',
  audio: 'media', video: 'media', html: 'web', csv: 'table', none: 'file',
};

/** The icon family of a row: doc | code | data | diff | image | media | web | table | file. */
export function iconFamilyFor(kind, relPath) {
  return FAMILY[previewKindFor(kind, relPath)] || 'file';
}

/** `home`: the key a folder's contents are keyed under when it is not its own — a step that ran once keys its files
 *  and burst folders as its `Cycle N` would, so a second cycle arriving moves them under keys they already had (an
 *  opened burst folder stays open, a focused row keeps the focus). */
function folder(key, label, kind, { nodeId = null, cycle = null, count = 0, open = true, inCycle = false } = {}) {
  return { key, label, kind, nodeId, cycle, count, files: [], folders: [], defaultOpen: open, inCycle, home: null };
}

/** A folder's files by kind; a kind with more than `threshold` files becomes a closed subfolder of its own. */
function fill(f, files, threshold) {
  for (const g of groupArtifactsByKind(files, { threshold })) {
    if (!g.collapsed) { f.files.push(...g.items); continue; }
    const sub = folder(`${f.home || f.key}/k:${g.kind}`, g.kind || 'files', 'bulk',
      { nodeId: f.nodeId, cycle: f.cycle, count: g.items.length, open: false, inCycle: f.inCycle });
    sub.files.push(...g.items);
    f.folders.push(sub);
  }
}

/**
 * The folder tree for one list: step folders in `order` (only ids that have files), then any other step by first
 * appearance, then "Run" (no node). A step with more than one cycle holds "Cycle N" subfolders (the latest open).
 * @returns {Array<{key, label, kind:'step'|'cycle'|'bulk', nodeId, cycle, count, files, folders, defaultOpen, inCycle}>}
 */
// P3: a run without a project lists its work/ files flat in one Files folder; each row names its sub-folder.
const WORK_FOLDER_KEY = 'n:__work__';
const workWhere = (a) => { const p = relOf(a).replace(/^work\//, ''); const i = p.lastIndexOf('/'); return i > 0 ? p.slice(0, i + 1) : null; };

export function artifactTree(list, { order = [], nodeLabel = (id) => String(id), threshold = BULK_KIND_THRESHOLD } = {}) {
  const byNode = new Map();
  const work = [];
  for (const a of Array.isArray(list) ? list : []) {
    if (!relOf(a)) continue;
    if (a.kind === 'work') { work.push(a); continue; }
    const nid = a.nodeId == null || a.nodeId === '' ? RUN : String(a.nodeId);
    const cyc = Number.isInteger(a.cycle) ? a.cycle : 0;
    if (!byNode.has(nid)) byNode.set(nid, new Map());
    const byCyc = byNode.get(nid);
    if (!byCyc.has(cyc)) byCyc.set(cyc, []);
    byCyc.get(cyc).push(a);
  }
  const ids = [];
  for (const id of Array.isArray(order) ? order : []) {
    const k = String(id);
    if (k !== RUN && byNode.has(k) && !ids.includes(k)) ids.push(k);
  }
  for (const k of byNode.keys()) if (k !== RUN && !ids.includes(k)) ids.push(k);
  if (byNode.has(RUN)) ids.push(RUN);
  const filesFolder = work.length ? (() => { const f = folder(WORK_FOLDER_KEY, 'Files', 'step', { count: work.length }); f.files.push(...work); return [f]; })() : [];
  return [...filesFolder, ...ids.map((nid) => {
    const byCyc = byNode.get(nid);
    const cycles = [...byCyc.keys()].sort((x, y) => x - y);
    const count = cycles.reduce((n, c) => n + byCyc.get(c).length, 0);
    const nodeId = nid === RUN ? null : nid;
    let label = 'Run';
    if (nodeId) { try { label = String(nodeLabel(nodeId) || nodeId); } catch { label = nodeId; } }
    const step = folder(`n:${nid}`, label, 'step', { nodeId, cycle: cycles.length === 1 ? cycles[0] : null, count });
    if (cycles.length === 1) {
      step.home = `${step.key}/c${cycles[0]}`;
      fill(step, byCyc.get(cycles[0]), threshold);
      return step;
    }
    const latest = cycles[cycles.length - 1];
    for (const c of cycles) {
      const sub = folder(`${step.key}/c${c}`, `Cycle ${c}`, 'cycle',
        { nodeId, cycle: c, count: byCyc.get(c).length, open: c === latest, inCycle: true });
      fill(sub, byCyc.get(c), threshold);
      step.folders.push(sub);
    }
    return step;
  })];
}

/** Extra trailing folders ({id, label, artifacts}) — files from somewhere other than a step. */
export function sourceFolders(sources, threshold = BULK_KIND_THRESHOLD) {
  return (Array.isArray(sources) ? sources : [])
    .filter((s) => s && s.id != null && Array.isArray(s.artifacts) && s.artifacts.some((a) => relOf(a)))
    .map((s) => {
      const files = s.artifacts.filter((a) => relOf(a));
      const f = folder(`s:${s.id}`, String(s.label || s.id), 'source', { count: files.length });
      fill(f, files, threshold);
      return f;
    });
}

/** Every file in tree order — a folder's own files, then its subfolders — closed folders included. */
export function treeFiles(tree) {
  const out = [];
  const walk = (f) => { out.push(...f.files); f.folders.forEach(walk); };
  (Array.isArray(tree) ? tree : []).forEach(walk);
  return out;
}

const signatureOf = (tree) => JSON.stringify(tree.map(function enc(f) {
  return [f.key, f.label, f.count, f.files.map((a) => [relOf(a), a.kind, a.bytes, a.cycle]), f.folders.map((x) => enc(x))];
}));

/**
 * @param {object} o
 * @param {Document} o.doc
 * @param {HTMLElement} o.host
 * @param {Array<object>} o.artifacts   rows {kind, relPath|path, bytes?, nodeId?, cycle?} (the caller filters what is not browsable)
 * @param {(nodeId:string) => string} [o.nodeLabel]
 * @param {(artifact:object, siblings:object[]) => void} [o.onOpen]
 * @param {Array<{id:string, label:string, artifacts:object[]}>} [o.sources]
 * @param {(() => string[]) | string[]} [o.order]   step folder order (node ids)
 * @param {(artifact:object) => void} [o.onDownload]   the row's Download button (absent → no button)
 * @param {string} [o.emptyText]
 * @returns {{update(artifacts:object[]):void, destroy():void}}
 */
export function createArtifactBrowser({
  doc, host, artifacts = [], nodeLabel = (id) => String(id), onOpen = () => {}, sources = null,
  order = null, onDownload = null, emptyText = 'No artifacts',
}) {
  const win = doc.defaultView || globalThis;
  const h = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const svg = (body) => {
    const s = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = body;                                       // repo-shipped glyphs only
    return s;
  };
  const clean = (x) => (Array.isArray(x) ? x.filter((a) => a && relOf(a)) : []);
  const st = { list: clean(artifacts), query: '', searchOpen: false, open: new Map(), sig: '', byKey: new Map(), where: new Map(), flat: [] };
  const orderOf = () => (typeof order === 'function' ? order() : order) || [];
  const treeOf = () => [...artifactTree(st.list, { order: orderOf(), nodeLabel }), ...sourceFolders(sources)];
  /** A folder the reader toggled keeps their choice; a `Cycle N` that stopped being the latest stays open while it
   *  holds a folder they opened; anything else follows its default. */
  const isOpen = (f) => {
    if (st.open.has(f.key)) return st.open.get(f.key);
    if (f.kind === 'cycle') for (const [k, v] of st.open) if (v && k.startsWith(`${f.key}/`)) return true;
    return f.defaultOpen;
  };
  const q = () => st.query.trim().toLowerCase();

  // ── header (built once: the search box's slide and the caret survive every repaint) ──
  const root = h('div', 'afb');
  const head = h('div', 'afb-head');
  const title = h('span', 'afb-title');
  const sbox = h('div', 'afb-sbox');
  const searchBtn = h('button', 'btn btn-sm btn-quiet btn-icon afb-ib afb-sbtn');
  searchBtn.type = 'button';
  searchBtn.title = 'Search';
  searchBtn.setAttribute('aria-label', 'Search artifacts');
  searchBtn.dataset.focusKey = 'search-btn';
  searchBtn.appendChild(svg(GLYPH.search));
  const input = h('input', 'afb-filter');
  input.type = 'search';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = 'Search artifacts…';
  input.setAttribute('aria-label', 'Search artifacts');
  input.dataset.focusKey = 'search';
  sbox.append(searchBtn, input);
  head.append(title, sbox);
  let list = h('div', 'afb-list');
  root.append(head, list);
  host.replaceChildren(root);

  function syncHead() {
    head.classList.toggle('is-searching', st.searchOpen);
    searchBtn.setAttribute('aria-expanded', st.searchOpen ? 'true' : 'false');
    input.toggleAttribute('inert', !st.searchOpen);            // the folded field takes no focus and no Tab stop
    input.tabIndex = st.searchOpen ? 0 : -1;
    if (input.value !== st.query) input.value = st.query;
  }
  function closeSearch(focusEl) {
    const had = Boolean(st.query);
    st.query = '';
    st.searchOpen = false;
    syncHead();
    if (had) paint();
    if (focusEl) focusEl.focus();
  }
  searchBtn.addEventListener('click', () => {
    if (!st.searchOpen) { st.searchOpen = true; syncHead(); input.focus(); return; }
    if (st.query) { input.focus(); return; }
    closeSearch(searchBtn);
  });
  input.addEventListener('input', () => { st.query = input.value; paint(); });
  // Escape in the field is the field's: a WINDOW capture listener runs before the run pages' document capture
  // handlers (Escape there sends the detail back to its list) and stops it there. First Escape clears, the next folds.
  const onSearchKey = (ev) => {
    // A screen swap can drop the browser while the field has the focus, and no blur fires for a removed node.
    if (!input.isConnected) { win.removeEventListener('keydown', onSearchKey, true); return; }
    if (ev.key !== 'Escape' || doc.activeElement !== input) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (st.query) { st.query = ''; input.value = ''; paint(); } else closeSearch(searchBtn);
  };
  input.addEventListener('focus', () => win.addEventListener('keydown', onSearchKey, true));
  input.addEventListener('blur', () => win.removeEventListener('keydown', onSearchKey, true));

  // ── rows ───────────────────────────────────────────────────────────────────
  let navAt = -Infinity;
  function folderRow(f) {
    const b = h('button', `afb-folder is-${f.kind}`);
    b.type = 'button';
    b.dataset.folder = f.key;
    b.dataset.focusKey = `d:${f.key}`;
    b.setAttribute('aria-expanded', isOpen(f) ? 'true' : 'false');
    const chev = svg(GLYPH.chevron);
    chev.classList.add('afb-chev');
    b.append(chev, svg(GLYPH.folder), h('span', 'afb-fname', f.label), h('span', 'afb-fn mono', String(f.count)));
    b.addEventListener('click', () => { navAt = Date.now(); setOpen(f.key, !isOpen(f)); });
    return b;
  }
  function fileRow(a, f, where) {
    const rel = relOf(a);
    const name = baseName(rel) || a.kind || 'artifact';
    const key = `f:${f.home || f.key}|${rel}`;
    const item = h('div', 'afb-file');
    item.dataset.rel = rel;
    const main = h('button', 'afb-main');
    main.type = 'button';
    main.dataset.focusKey = key;
    main.title = displayPath(rel);
    const fam = iconFamilyFor(a.kind, rel);
    const ic = h('span', `afb-ic is-${fam}`);
    ic.appendChild(svg(FAMILY_GLYPH[fam] || FAMILY_GLYPH.file));
    const txt = h('span', 'afb-txt');
    const l1 = h('span', 'afb-l1');
    // The extension is its own span: a narrow row cuts the stem with an ellipsis and keeps `.md` in sight.
    const shownName = midTruncate(name);
    const dot = shownName.lastIndexOf('.');
    const ext = dot > 0 && shownName.length - dot <= 10 ? shownName.slice(dot) : '';
    const nm = h('span', 'afb-name');
    nm.setAttribute('aria-hidden', 'true');     // the two spans read as "plan .md": a screen reader gets the whole name
    nm.appendChild(h('span', 'afb-stem', ext ? shownName.slice(0, -ext.length) : shownName));
    if (ext) nm.appendChild(h('span', 'afb-ext', ext));
    l1.append(h('span', 'sr-only', name), nm);
    if (!where && !f.inCycle && Number.isInteger(a.cycle) && a.cycle >= 2) l1.appendChild(h('span', 'afb-cyc mono', `cycle ${a.cycle}`));
    txt.appendChild(l1);
    if (where) txt.appendChild(h('span', 'afb-where', where));
    main.append(ic, txt);
    if (a.bytes != null) main.appendChild(h('span', 'afb-size mono', formatBytes(a.bytes)));
    main.addEventListener('click', () => { navAt = Date.now(); onOpen(a, st.flat.slice()); });
    item.appendChild(main);
    if (typeof onDownload === 'function') {
      const dl = h('button', 'btn btn-sm btn-quiet btn-icon afb-dl');
      dl.type = 'button';
      dl.title = 'Download';
      dl.setAttribute('aria-label', `Download ${name}`);
      dl.dataset.focusKey = `${key}#dl`;
      dl.appendChild(svg(GLYPH.download));
      dl.addEventListener('click', (e) => { if (!(e.detail > 1)) onDownload(a); });
      item.appendChild(dl);
    }
    return item;
  }

  function folders(next, tree) {
    if (!tree.length) { next.appendChild(h('p', 'afb-empty', emptyText)); return; }
    const walk = (f, parent) => {
      parent.appendChild(folderRow(f));
      if (!isOpen(f)) return;
      const fold = h('div', 'afb-fold');
      fold.dataset.fold = f.key;
      fold.setAttribute('role', 'group');
      fold.setAttribute('aria-label', f.label);
      for (const a of f.files) fold.appendChild(fileRow(a, f, f.key === WORK_FOLDER_KEY ? workWhere(a) : null));
      f.folders.forEach((sub) => walk(sub, fold));
      parent.appendChild(fold);
    };
    tree.forEach((f) => walk(f, next));
  }
  function results(next, tree) {
    const s = q();
    const matches = (a) => {
      const rel = relOf(a);
      return [baseName(rel), isAbsolutePath(rel) ? '' : rel, a.kind].some((x) => String(x || '').toLowerCase().includes(s));
    };
    const hits = [];
    const walk = (f, path) => {
      const here = [...path, f.kind === 'cycle' ? `cycle ${f.cycle}` : f.label];
      for (const a of f.files) if (matches(a)) hits.push({ a, f, where: here.join(' · ') });
      f.folders.forEach((sub) => walk(sub, here));
    };
    tree.forEach((f) => walk(f, []));
    st.flat = hits.map((x) => x.a);
    for (const x of hits) next.appendChild(fileRow(x.a, x.f, x.where));
    if (!hits.length) next.appendChild(h('p', 'afb-empty', `No artifacts match “${st.query.trim()}”`));
  }

  const keyed = (k) => [...root.querySelectorAll('[data-focus-key]')].find((n) => n.dataset.focusKey === k) || null;
  /** Focus back where it was after a repaint; a control that went hands it to its folder, then the folder above —
   *  never <body>. Keys are never built into a selector (a Windows path holds `:` and `\`). */
  function restore(want) {
    let el = keyed(want) || (want.endsWith('#dl') ? keyed(want.slice(0, -3)) : null);
    // A row the repaint moved (the 6th file of a kind made a burst folder) is looked for where its file sits now — in
    // its own step: one path can sit in two steps, or in two cycles of one, and another step's copy is not this row.
    const bar = want.startsWith('f:') ? want.indexOf('|') : -1;
    const was = bar > 0 ? want.slice(2, bar) : '';
    const step = was.split('/')[0];
    const places = bar > 0 ? st.where.get(want.slice(bar + 1).replace(/#dl$/, '')) || [] : [];
    const moved = places.find((m) => m.row.slice(2, m.row.indexOf('|')) === was)
      || places.find((m) => m.folder === step || m.folder.startsWith(`${step}/`)) || null;
    if (!el && moved) el = keyed(moved.row);
    let k = moved ? moved.folder : want.startsWith('f:') ? want.slice(2).split('|')[0] : want.startsWith('d:') ? want.slice(2) : '';
    while (!el && k) {
      el = keyed(`d:${k}`);
      k = k.includes('/') ? k.slice(0, k.lastIndexOf('/')) : '';
    }
    if (!el) el = list.querySelector('.afb-folder, .afb-main') || searchBtn;
    // preventScroll: a live repaint must not scroll the page back to a row the reader scrolled away from.
    if (el && doc.activeElement !== el && typeof el.focus === 'function') el.focus({ preventScroll: true });
  }

  /** Repaint the list (never the header); focus and scroll come back. */
  function paint(focusKey = null, tree = treeOf()) {
    const active = doc.activeElement && root.contains(doc.activeElement) ? doc.activeElement : null;
    const want = focusKey || (active && active.dataset && active.dataset.focusKey) || null;
    const keepTop = list.scrollTop;
    st.sig = signatureOf(tree);
    st.byKey = new Map();
    st.where = new Map();                      // rel -> every place it sits: [{row: its focus key, folder: the folder that holds it}]
    const index = (f) => {
      st.byKey.set(f.key, f);
      for (const a of f.files) {
        const rel = relOf(a);
        if (!st.where.has(rel)) st.where.set(rel, []);
        st.where.get(rel).push({ row: `f:${f.home || f.key}|${rel}`, folder: f.key });
      }
      f.folders.forEach(index);
    };
    tree.forEach(index);
    const all = treeFiles(tree);
    title.textContent = `${all.length} ${all.length === 1 ? 'file' : 'files'}`;
    const next = h('div', 'afb-list');
    if (q()) results(next, tree);
    else { st.flat = all; folders(next, tree); }
    list.replaceWith(next);
    list = next;
    if (keepTop) list.scrollTop = keepTop;
    if (want) restore(want);
  }
  function setOpen(key, to) {
    const f = st.byKey.get(key);
    if (!f || isOpen(f) === to) return;
    st.open.set(key, to);
    paint(`d:${key}`);
  }

  // ── keyboard (one delegated listener; the list element is replaced on every repaint) ──
  const onKey = (ev) => {
    if (!list.contains(ev.target)) return;
    if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;   // Alt+← is Back; the rest are the browser's too
    const items = [...list.querySelectorAll('.afb-folder, .afb-main')];
    const t = ev.target.closest ? ev.target.closest('.afb-folder, .afb-main, .afb-dl') : null;
    const cur = t && t.classList.contains('afb-dl') ? t.parentElement.querySelector('.afb-main') : t;
    const at = cur ? items.indexOf(cur) : -1;
    const isFolder = Boolean(cur && cur.classList.contains('afb-folder'));
    const go = (i) => {
      const el = items[Math.max(0, Math.min(items.length - 1, i))];
      if (!el) return;
      ev.preventDefault();
      el.focus();
    };
    if (ev.key === 'ArrowDown') go(at + 1);
    else if (ev.key === 'ArrowUp') go(at < 0 ? 0 : at - 1);
    else if (ev.key === 'Home') go(0);
    else if (ev.key === 'End') go(items.length - 1);
    else if (ev.key === 'ArrowRight' && isFolder) {
      ev.preventDefault();
      if (cur.getAttribute('aria-expanded') !== 'true') setOpen(cur.dataset.folder, true); else go(at + 1);
    } else if (ev.key === 'ArrowLeft' && cur) {
      ev.preventDefault();
      if (isFolder && cur.getAttribute('aria-expanded') === 'true') { setOpen(cur.dataset.folder, false); return; }
      const fold = cur.closest('.afb-fold');
      const parent = fold ? keyed(`d:${fold.dataset.fold}`) : null;
      if (parent) parent.focus();
    }
  };
  root.addEventListener('keydown', onKey);

  /** A folder or a row repaints the list on one click, so a double click's second press lands on whatever now sits
   *  under the pointer (it would fold the folder straight back). Swallow it; keyboard activation (detail 0) stays. */
  const swallowSecondPress = (ev) => {
    if (!(ev.detail > 1) || Date.now() - navAt > 500) return;
    if (ev.target && ev.target.closest && ev.target.closest('input')) return;
    ev.preventDefault();
    ev.stopPropagation();
  };
  host.addEventListener('mousedown', swallowSecondPress, true);
  host.addEventListener('click', swallowSecondPress, true);

  syncHead();
  paint();

  return {
    /** A new list (a live frame, the next page). An unchanged tree does not repaint. */
    update(next) {
      st.list = clean(next);
      const tree = treeOf();
      if (signatureOf(tree) === st.sig) return;
      paint(null, tree);
    },
    destroy() {
      host.removeEventListener('mousedown', swallowSecondPress, true);
      host.removeEventListener('click', swallowSecondPress, true);
      win.removeEventListener('keydown', onSearchKey, true);
      root.removeEventListener('keydown', onKey);
      host.replaceChildren();
    },
  };
}
