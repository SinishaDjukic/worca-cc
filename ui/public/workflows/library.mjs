// ui/public/workflows/library.mjs
// The Workflows view's Library card (composer-mockup.html library.js). A segmented selector switches Agents · Scripts ·
// Workflows (with their registry counts). Agents and Scripts split into their domainGroups() folders (one group lists
// its rows straight away; `shared` rows sit in every domain) and Agents ends with the pinned Flow folder; Workflows
// splits by domain and ends with Archived. A folder row opens in place (several can be open). All / Built-in / Yours
// narrow Agents and Scripts; the header's search button grows a field over the title, and a query lists every match in
// the selected section as one flat list. Rows drag onto the canvas (HTML5 DnD, application/x-worca — BRIEF.md) and open
// an inline detail with every action the old Agents and Scripts pages had. Pure DOM over the data app.js hands in
// (setData); every action is a callback. Every string from user data goes through textContent.
import { safeAgentIcon, SCRIPT_GLYPH, thumbnailFor } from '../graph/view.mjs';
import { classifyLoops } from '../../../src/shared/graph/loops.mjs';
import { DND_TYPE, FLOW_CARDS } from './shell.mjs';
import { toggleMenu } from './menu.mjs';
import { iconSvg } from '../icons.mjs';

/** The sections, in the selector's order. */
export const TOPS = Object.freeze(['agents', 'scripts', 'workflows']);
/** The pinned subfolders: Agents › Flow, Workflows › Archived. A domain matches `^[a-z][a-z0-9-]{0,31}$` (agent-meta,
 *  script-meta and workflows.mjs DOMAIN_RE), so a leading `_` never names one. */
export const FLOW = '_flow';
export const ARCHIVED = '_archived';
const TOP_LABEL = { agents: 'Agents', scripts: 'Scripts', workflows: 'Workflows' };
const NOUN = { agents: 'agents', scripts: 'scripts', workflows: 'workflows' };
const KIND_TOP = { agent: 'agents', script: 'scripts', workflow: 'workflows' };
const PINNED_KINDS = new Set(['flow', 'archived']);
const FOLDER_GLYPH = '<path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4.6l2 2.5H19a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/>';
const SEARCH_GLYPH = '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>';
const TRASH_GLYPH = '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>';
const FLOW_DESC = {
  task: 'The pipeline entry: the prompt and its attached files.',
  end: 'The pipeline sink. A token arriving here completes the run.',
  and: 'Fires when ALL of its inputs are fresh. Payloads discarded (pure sequencing).',
  or: 'Fires on ANY fresh input and forwards the freshest payload.',
  combine: 'Joins its md inputs into one document, in port order.',
};
const FLOW_PORT_LINE = { task: 'source · out task', end: 'in result · terminal', and: 'in in1..inN · out out', or: 'in in1..inN · out out', combine: 'in in1, in2 · out out' };
const RESERVED = new Set(['wf_default', 'wf_memory_defrag']);
const FLOW_ICON = {
  task: '<path d="M5.2 3.4h9.6v13.2H5.2z"/><path d="M7.6 7.2h4.8M7.6 10h4.8M7.6 12.8h3"/>',
  end: '<path d="M5.6 3.4v13.2"/><path d="M5.6 4.2h8.6l-2.4 3.4 2.4 3.4H5.6z"/>',
  and: '<path d="M3.4 6h3.2M3.4 14h3.2"/><path d="M6.6 4.2h3.2a5.8 5.8 0 010 11.6H6.6z"/><path d="M15.6 10h1.8"/>',
  or: '<path d="M3.4 5.5h3.6l4.4 4.5h5.4M3.4 14.5h3.6l4.4-4.5"/><path d="M14.6 7.8l2.2 2.2-2.2 2.2"/>',
  combine: '<path d="M3.4 5.5h4.2l4.4 4.5h4.6M3.4 14.5h4.2l4.4-4.5"/><path d="M14.4 7.8l2.2 2.2-2.2 2.2"/>',
};

/** The port line (row line 2): META port ids only — the synthesized await gate is never listed. */
export function portLineOf(entry) {
  const ids = (ports) => (Array.isArray(ports) ? ports : []).filter((p) => p && !p.synthetic && p.id !== 'await').map((p) => p.id);
  const reads = ids(entry && entry.inputs);
  const writes = ids(entry && entry.outputs);
  return [reads.length ? `in ${reads.join(', ')}` : '', writes.length ? `out ${writes.join(', ')}` : ''].filter(Boolean).join(' · ');
}

const byOrder = (a, b) => ((typeof a.order === 'number' ? a.order : 99) - (typeof b.order === 'number' ? b.order : 99)) || String(a.key).localeCompare(String(b.key));

/** Domain groups: every non-shared, non-general domain in first-seen order, then `general`; `shared`
 *  entries are folded into every domain group (FACTS-composer "Palette"). */
export function domainGroups(list) {
  const items = list.map((x) => ({ ...x, domain: x.domain || 'general' }));
  const shared = items.filter((x) => x.domain === 'shared');
  const domains = [];
  for (const x of items) if (x.domain !== 'shared' && x.domain !== 'general' && !domains.includes(x.domain)) domains.push(x.domain);
  domains.push('general');
  return domains.map((d) => ({ id: d, label: d, items: [...shared, ...items.filter((x) => x.domain === d)].sort(byOrder) }))
    .filter((g) => g.items.length);
}

/** Workflow domains in the old domain chips' order: by name, then `general`, then `shared`. */
export function workflowDomains(list) {
  const ds = [...new Set((Array.isArray(list) ? list : []).filter(Boolean).map((w) => w.domain || 'general'))];
  return ds.sort((a, b) => (a === 'shared') - (b === 'shared') || (a === 'general') - (b === 'general') || a.localeCompare(b));
}

/**
 * @param {object} o
 * @param {Document} o.doc
 * @param {HTMLElement} o.host  aside#wfv-library
 * @param {object} o.actions  {addToCanvas(entry), openWorkflow(id), deleteWorkflow(wf), deleteArchived(wf),
 *   exportWorkflow(wf), newAgent(), newScript(), viewAgent(key), editAgent(key), deleteAgent(agent),
 *   duplicateAgent(agent), openScript(key), deleteScript(script), duplicateScript(script), portsFn(node), closeLibrary(),
 *   isPinned(id), togglePin(wf)}  — the last two: the Chat home pins (src/shared/home-pins.mjs) from the row ⋯ menu
 */
export function createLibrary({ doc, host, actions }) {
  const win = doc.defaultView || globalThis;
  const h = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const act = (name, ...args) => { const fn = actions && actions[name]; return typeof fn === 'function' ? fn(...args) : undefined; };
  const svg = (body, viewBox = '0 0 24 24') => {
    const s = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', viewBox); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = body;                                 // repo-shipped glyphs or safeAgentIcon output only
    return s;
  };
  // svg(body) wraps a glyph body; the shared icons come whole, so they are parsed once.
  const sharedIcon = (name) => { const t = doc.createElement('template'); t.innerHTML = iconSvg(name, 16); return t.content.firstElementChild; };
  // `top`: the selected section. `folders`: the open folders ("agents/coding"), kept across section switches.
  const st = {
    top: 'agents', query: '', searchOpen: false, chip: 'all', open: false,
    folders: new Set(), expanded: new Set(), flash: '',
    data: { agents: [], scripts: [], workflows: [], archived: [], placedKinds: [], openId: '', newIds: new Set(), runtimes: null, loadError: '', retry: null },
  };

  // ── derived lists ──────────────────────────────────────────────────────────
  const q = () => st.query.trim().toLowerCase();
  const matches = (...fields) => { const s = q(); return !s || fields.some((f) => String(f || '').toLowerCase().includes(s)); };
  const origin = (x) => (x.origin === 'user' ? 'yours' : 'builtin');
  // All / Built-in / Yours narrow Agents and Scripts only: Workflows shows no chips.
  const hasChips = () => st.top === 'agents' || st.top === 'scripts';
  const chipOk = (x) => !hasChips() || st.chip === 'all' || origin(x) === st.chip;
  const HIT = {
    agent: (a) => matches(a.displayName, a.key, portLineOf(a)),
    script: (s) => matches(s.displayName, s.key, s.runtime, s.origin, portLineOf(s)),
    flow: (f) => matches(f.label, f.kind, FLOW_PORT_LINE[f.kind]),
    workflow: (w) => matches(w.name, w.id, w.domain),
    archived: (w) => matches(w.name, w.id, w.domain),
  };
  const rowId = (kind, x) => (kind === 'flow' ? `flow:${x.kind}` : kind === 'workflow' || kind === 'archived' ? `${kind}:${x.id}` : `${kind}:${x.key}`);
  // A built-in or plugin agent / script the canvas cannot take (placeable:false, a workspace-only agent) is not listed —
  // not in a folder, a count or a search: it could only be looked at. The user's own stay: their sheet is where
  // "Placeable on a canvas" is switched back on.
  const listed = (x) => x.origin === 'user' || (x.placeable !== false && x.scope !== 'workspace-only');
  const dataOf = (name) => (Array.isArray(st.data[name]) ? st.data[name] : []).filter((x) => x && (name === 'agents' || name === 'scripts' ? listed(x) : true));

  /** A top folder's domain subfolders, read from the whole registry (a chip never reshapes the tree); [] when it holds
   *  one group or none — its rows then sit in the top folder itself. */
  function domainsOf(top) {
    const ds = top === 'workflows' ? workflowDomains(dataOf('workflows')) : domainGroups(dataOf(top)).map((g) => g.id);
    return ds.length > 1 ? ds : [];
  }
  /** A top folder's groups in folder order; `at` is the folder listing `items` (the top folder itself, or one of its
   *  subfolders). `chipped: false` ignores All / Built-in / Yours — where a row LIVES (highlight, folderOf). */
  function groupsOf(top, chipped = true) {
    const ds = domainsOf(top);
    if (top === 'workflows') {
      const wfs = dataOf('workflows');
      const out = ds.length ? ds.map((d) => ({ at: [top, d], kind: 'workflow', items: wfs.filter((w) => (w.domain || 'general') === d) }))
        : [{ at: [top], kind: 'workflow', items: wfs }];
      const arch = dataOf('archived');
      if (arch.length) out.push({ at: [top, ARCHIVED], kind: 'archived', items: arch });
      return out;
    }
    const kind = top === 'agents' ? 'agent' : 'script';
    const groups = domainGroups(dataOf(top).filter((x) => !chipped || chipOk(x)));
    const out = ds.length ? ds.map((d) => ({ at: [top, d], kind, items: (groups.find((g) => g.id === d) || { items: [] }).items }))
      : [{ at: [top], kind, items: groups.flatMap((g) => g.items) }];
    // The flow cards are built-ins: Yours hides them.
    if (top === 'agents') out.push({ at: [top, FLOW], kind: 'flow', items: !chipped || chipOk({ origin: 'builtin' }) ? FLOW_CARDS : [] });
    return out;
  }
  /** Every row in a section, in folder order, with the folder listing it. A row two folders list (a `shared` agent
   *  sits in every domain) comes once, at the first. */
  function rowsUnder(top, chipped = true) {
    const out = [];
    const seen = new Set();
    for (const g of groupsOf(top, chipped)) {
      for (const x of g.items) {
        const id = rowId(g.kind, x);
        if (!seen.has(id)) { seen.add(id); out.push({ kind: g.kind, x, at: g.at }); }
      }
    }
    return out;
  }
  /** The folder holding a row: [top, domain] or [top] (one group — or not listed yet). */
  function folderOf(kind, key) {
    const top = KIND_TOP[kind];
    if (!top) return [];
    const hit = rowsUnder(top, false).find((r) => r.kind === kind && (kind === 'workflow' ? r.x.id : r.x.key) === key);
    return hit ? [...hit.at] : [top];
  }
  const folderLabel = (path) => (path.length === 1 ? TOP_LABEL[path[0]] : path[1] === FLOW ? 'Flow' : path[1] === ARCHIVED ? 'Archived' : path[1]);
  /** A search result's tag: the subfolder holding it ("coding", "Flow"); none for a row sitting in the section itself. */
  const whereTag = (txt, at) => { if (at && at.length > 1) txt.appendChild(h('span', 'wfl-where', folderLabel(at))); };

  // ── navigation ─────────────────────────────────────────────────────────────
  let navAt = -Infinity;
  /** Select a section. A new one starts on All; an open search and its query stay — they search this section now. */
  function select(top, focusKey = null) {
    if (!TOPS.includes(top)) return;
    if (top !== st.top) { st.top = top; st.chip = 'all'; }
    navAt = Date.now();
    render(focusKey);
  }
  /** A folder row opens in place and folds back on its next click; focus stays on it. */
  function toggleFolder(key) {
    if (st.folders.has(key)) st.folders.delete(key); else st.folders.add(key);
    navAt = Date.now();
    render(`folder:${key}`);
  }
  /** A folder row and a tab repaint the list on one click, so a double-click's second press lands on whatever row now
   *  sits under the pointer (it would fold the folder straight back, open a workflow, or move focus to <body>, where the
   *  canvas takes Delete). Swallow it; keyboard activation (detail 0) and the search field's word select stay. */
  const swallowSecondPress = (ev) => {
    if (!(ev.detail > 1) || Date.now() - navAt > 500) return;
    if (ev.target && ev.target.closest && ev.target.closest('input')) return;
    ev.preventDefault();
    ev.stopPropagation();
  };
  host.addEventListener('mousedown', swallowSecondPress, true);
  host.addEventListener('click', swallowSecondPress, true);

  // ── header ─────────────────────────────────────────────────────────────────
  // Built once and kept across repaints, so the search box's slide (CSS, .is-searching) runs and typing never loses
  // the field. Folded: "Library  🔍 ✕". Open: "🔍 Search agents…  ✕" — the box's left edge slides over the title.
  const head = h('div', 'wfl-head');
  const title = h('h2', 'section-title wfl-title', 'Library');
  const sbox = h('div', 'wfl-sbox');
  const searchBtn = h('button', 'btn btn-quiet btn-icon wfl-filter-btn');
  searchBtn.type = 'button';
  searchBtn.id = 'wfl-filter-btn';
  searchBtn.title = 'Search';
  searchBtn.setAttribute('aria-label', 'Search');
  searchBtn.setAttribute('aria-controls', 'wfl-filter');
  searchBtn.appendChild(svg(SEARCH_GLYPH));
  const input = h('input', 'wfl-filter-input');
  input.id = 'wfl-filter';
  input.type = 'search';
  input.autocomplete = 'off';
  input.spellcheck = false;
  sbox.append(searchBtn, input);
  const closeBtn = h('button', 'btn btn-quiet btn-icon wfl-close');
  closeBtn.type = 'button';
  closeBtn.id = 'wfl-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.appendChild(sharedIcon('x'));
  head.append(title, sbox, closeBtn);
  function syncHead() {
    head.classList.toggle('is-searching', st.searchOpen);
    searchBtn.setAttribute('aria-expanded', st.searchOpen ? 'true' : 'false');
    input.toggleAttribute('inert', !st.searchOpen);          // the folded field takes no focus and no Tab stop
    const what = NOUN[st.top];
    input.placeholder = `Search ${what}…`;
    input.setAttribute('aria-label', `Search ${what}`);
    if (input.value !== st.query) input.value = st.query;
    closeBtn.title = st.searchOpen ? 'Close search' : 'Close';
    closeBtn.setAttribute('aria-label', st.searchOpen ? 'Close search' : 'Close library');
  }
  /** Fold the search and drop its query; `focusEl` takes the focus (the field goes inert — never leave it on <body>). */
  function closeSearch(focusEl) {
    const had = Boolean(st.query);
    st.query = '';
    st.searchOpen = false;
    syncHead();
    if (had) repaintRows();
    if (focusEl) focusEl.focus();
  }
  searchBtn.addEventListener('click', () => {
    if (!st.searchOpen) { st.searchOpen = true; syncHead(); input.focus(); return; }
    if (st.query) { input.focus(); return; }                 // a field with text stays open
    closeSearch(searchBtn);
  });
  // ✕ closes an open search first; on a folded one it closes the Library.
  closeBtn.addEventListener('click', () => { if (st.searchOpen) closeSearch(closeBtn); else act('closeLibrary'); });
  // Typing repaints the rows only: the input stays, so the caret and an IME composition survive.
  input.addEventListener('input', () => { st.query = input.value; repaintRows(); });
  input.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    if (st.query) { st.query = ''; input.value = ''; repaintRows(); } else closeSearch(searchBtn);
  });

  // ── selector, chips ────────────────────────────────────────────────────────
  /** Agents · Scripts · Workflows (registry counts) and, at the right, the section's "+" — Workflows keeps its slot. */
  function bar() {
    const row = h('div', 'wfl-bar');
    const seg = h('div', 'wfl-seg tabs');
    seg.setAttribute('role', 'tablist');
    seg.setAttribute('aria-label', 'Library sections');
    for (const t of TOPS) {
      const b = h('button', 'wfl-tab tab');
      b.type = 'button';
      b.id = `wfl-tab-${t}`;
      b.dataset.tab = t;                                  // the tour and the proofs find a section by it
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', st.top === t ? 'true' : 'false');
      b.tabIndex = st.top === t ? 0 : -1;
      b.append(h('span', 'wfl-tname', TOP_LABEL[t]), h('span', 'wfl-n mono', String(dataOf(t).length)));
      b.addEventListener('click', () => select(t, b.id));
      b.addEventListener('keydown', (ev) => {
        const step = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        ev.preventDefault();
        const next = TOPS[(TOPS.indexOf(st.top) + step + TOPS.length) % TOPS.length];
        select(next, `wfl-tab-${next}`);
      });
      seg.appendChild(b);
    }
    row.appendChild(seg);
    if (hasChips()) {
      const agents = st.top === 'agents';
      const nb = h('button', 'btn btn-quiet btn-icon wfl-new');
      nb.type = 'button';
      nb.id = agents ? 'wfl-new-agent' : 'wfl-new-script';
      nb.title = agents ? 'New agent' : 'New script';
      nb.setAttribute('aria-label', nb.title);
      nb.appendChild(sharedIcon('plus'));
      nb.addEventListener('click', () => act(agents ? 'newAgent' : 'newScript'));
      row.appendChild(nb);
    } else {
      const slot = h('span', 'wfl-new is-slot');
      slot.setAttribute('aria-hidden', 'true');
      row.appendChild(slot);
    }
    return row;
  }
  function chipRow() {
    const row = h('div', 'wfl-tools');
    for (const [k, t] of [['all', 'All'], ['builtin', 'Built-in'], ['yours', 'Yours']]) {
      const c = h('button', 'filter-chip', t);
      c.type = 'button';
      c.dataset.chip = k;
      c.dataset.focusKey = `chip:${k}`;            // a repaint returns focus here, never to <body> (where the canvas takes Delete)
      c.setAttribute('aria-pressed', st.chip === k ? 'true' : 'false');
      c.addEventListener('click', () => { st.chip = k; render(); });
      row.appendChild(c);
    }
    return row;
  }

  // ── folders ────────────────────────────────────────────────────────────────
  function folderRow(path, count) {
    const key = path.join('/');
    const row = h('button', 'wfl-folder row-btn');
    row.type = 'button';
    row.dataset.folder = key;
    row.dataset.focusKey = `folder:${key}`;
    row.setAttribute('aria-expanded', st.folders.has(key) ? 'true' : 'false');
    const chev = sharedIcon('chevron');
    chev.classList.add('wfl-chev');
    row.append(chev, svg(FOLDER_GLYPH), h('span', 'wfl-fname', folderLabel(path)), h('span', 'wfl-fn mono', String(count)));
    row.addEventListener('click', () => toggleFolder(key));
    return row;
  }

  // ── rows ───────────────────────────────────────────────────────────────────
  function tile(fam, glyph, viewBox) {
    const t = h('span', `wfl-ic h-${fam}`);
    t.appendChild(svg(glyph, viewBox));
    return t;
  }
  function portChips(list, { dir, script = false }) {
    const wrap = h('div', 'wfl-ports');
    for (const p of (Array.isArray(list) ? list : [])) {
      if (!p || p.synthetic || p.id === 'await') continue;
      let text = `${p.id} · ${p.type}`;
      if (p.loop) text += ' · loop';
      if (p.expands) text += ' · ⤫N';
      if (dir === 'out' && (p.when === 'blocking' || p.when === 'clean')) {
        text += script ? (p.when === 'blocking' ? ' · on fail' : ' · on pass') : ` · on ${p.when}`;
      }
      const c = h('span', `wfl-pchip${p.required === false ? ' is-opt' : ''}${p.loop ? ' is-loop' : ''}`, text);
      wrap.appendChild(c);
    }
    if (!wrap.childNodes.length) wrap.appendChild(h('span', 'wfl-none', '—'));
    return wrap;
  }
  /** `base` is the row's focus key: each action gets `<base>:<label>` so a repaint returns focus to it. */
  function actionsRow(list, base = '') {
    const row = h('div', 'wfl-actions');
    list.forEach(([label, fn, primary], i) => {
      const b = h('button', `btn btn-sm${primary ? ' btn-primary' : ''}${label === 'Delete' ? ' btn-danger wfl-danger' : ''}`, label);
      b.type = 'button';
      if (base) b.dataset.focusKey = `${base}:${label}`;
      b.addEventListener('click', fn);
      if (i === 0 && primary) b.dataset.primary = '1';
      row.appendChild(b);
    });
    return row;
  }
  /** `at`: the folder path a search result lives in (tagged under its port line); null in a folder listing. */
  function itemRow({ id, kind, key, name, sub, chips = [], fam, glyph, viewBox, draggable, detail, at = null }) {
    const item = h('div', `wfl-item${st.flash === id ? ' is-flash' : ''}`);
    item.dataset.item = id;
    const row = h('div', 'wfl-row');
    row.setAttribute('draggable', draggable ? 'true' : 'false');
    if (draggable) {
      row.addEventListener('dragstart', (ev) => {
        const payload = key ? { kind, key } : { kind };
        ev.dataTransfer.effectAllowed = 'copy';
        ev.dataTransfer.setData(DND_TYPE, JSON.stringify(payload));
        ev.dataTransfer.setData('text/plain', name);
        item.classList.add('is-dragging');
      });
      row.addEventListener('dragend', () => item.classList.remove('is-dragging'));
    }
    const open = st.expanded.has(id);
    const main = h('div', 'wfl-main');
    main.setAttribute('role', 'button');
    main.tabIndex = 0;
    main.dataset.focusKey = id;
    main.setAttribute('aria-expanded', open ? 'true' : 'false');
    const txt = h('span', 'wfl-txt');
    const l1 = h('span', 'wfl-l1');
    l1.appendChild(h('span', 'wfl-name', name));
    for (const c of chips) l1.appendChild(h('span', `wfl-qchip${c.mono ? ' mono' : ''}`, c.text));
    txt.append(l1, h('span', 'wfl-l2 mono', sub));
    whereTag(txt, at);
    main.append(tile(fam, glyph, viewBox), txt);
    const toggle = () => { if (st.expanded.has(id)) st.expanded.delete(id); else st.expanded.add(id); render(id); };
    main.addEventListener('click', toggle);
    main.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); } });
    row.appendChild(main);
    if (draggable) {
      const add = h('button', 'btn btn-sm btn-quiet btn-icon wfl-add');
      add.type = 'button';
      add.title = 'Add to canvas';
      add.setAttribute('aria-label', `Add ${name} to canvas`);
      add.dataset.focusKey = `${id}:add`;
      add.appendChild(sharedIcon('plus'));
      add.addEventListener('click', () => act('addToCanvas', key ? { kind, key } : { kind }));
      row.appendChild(add);
    }
    item.appendChild(row);
    if (open) item.appendChild(detail());
    return item;
  }

  const pluginOf = (x) => (typeof x.origin === 'string' && x.origin.startsWith('plugin:') ? x.origin : '');
  function agentItem(a, at = null) {
    // Workspace-only agents run only inside a workspace scan: the palette never offered them and the run
    // assembler refuses them (WORKSPACE_ONLY_AGENT). Only the user's own get here (dataOf) — listed, never placed.
    const wsOnly = a.scope === 'workspace-only';
    const placeable = a.placeable !== false && !wsOnly;
    const user = a.origin === 'user';
    const chips = [];
    if (user) chips.push({ text: 'user' });
    if (pluginOf(a)) chips.push({ text: pluginOf(a), mono: true });
    if (wsOnly) chips.push({ text: 'workspace only' });
    else if (!placeable) chips.push({ text: 'not placeable' });
    const id = `agent:${a.key}`;
    return itemRow({ id, kind: 'agent', key: a.key, name: a.displayName || a.key, sub: portLineOf(a), chips, at,
      fam: a.color || 'blue', glyph: safeAgentIcon(a) || '', viewBox: '0 0 24 24', draggable: placeable,
      detail: () => {
        const d = h('div', 'wfl-detail');
        d.appendChild(h('p', 'wfl-desc', `${a.key} · ${a.runnerType || 'producer'}: ${a.description || a.portSummary || ''}`));
        d.append(h('div', 'wfl-k', 'Inputs'), portChips(a.inputs, { dir: 'in' }), h('div', 'wfl-k', 'Outputs'), portChips(a.outputs, { dir: 'out' }));
        const caps = h('div', 'wfl-caps');
        if (a.fanOut) caps.appendChild(h('span', 'wfl-qchip', 'Research fan-out'));
        if (a.asksQuestions) caps.appendChild(h('span', 'wfl-qchip', 'Asks questions'));
        if (caps.childNodes.length) d.appendChild(caps);
        const list = [];
        if (placeable) list.push(['Add to canvas', () => act('addToCanvas', { kind: 'agent', key: a.key }), true]);
        if (user) list.push(['Edit', () => act('editAgent', a.key)], ['Delete', () => act('deleteAgent', a)]);
        else list.push(['View', () => act('viewAgent', a.key)], ['Duplicate', () => act('duplicateAgent', a)]);
        d.appendChild(actionsRow(list, id));
        return d;
      } });
  }
  function scriptItem(s, at = null) {
    const user = s.origin === 'user';
    const placeable = s.placeable !== false;
    const chips = [{ text: s.runtime || 'script', mono: true }];
    if (user) chips.push({ text: 'user' });
    if (pluginOf(s)) chips.push({ text: pluginOf(s), mono: true });
    const cases = Number(s.caseCount) || 0;                         // the old Scripts list's chips (scripts-view.mjs:91–104)
    if (cases > 0) chips.push({ text: `${cases} case${cases === 1 ? '' : 's'}` });
    const probe = st.data.runtimes && st.data.runtimes[s.runtime];
    if (s.runtime === 'python' && probe && probe.ok === false) chips.push({ text: 'python not found' });   // a notice, never a block
    const id = `script:${s.key}`;
    return itemRow({ id, kind: 'script', key: s.key, name: s.displayName || s.key,
      sub: s.ports === 'config' ? 'in/out (per card)' : portLineOf(s), chips, at,
      fam: s.color || 'amber', glyph: safeAgentIcon(s) || SCRIPT_GLYPH, viewBox: '0 0 24 24', draggable: placeable,
      detail: () => {
        const d = h('div', 'wfl-detail');
        d.appendChild(h('p', 'wfl-desc', s.description || ''));
        if (s.ports === 'config') d.appendChild(h('div', 'wfl-k', 'Ports per card'));
        else d.append(h('div', 'wfl-k', 'Inputs'), portChips(s.inputs, { dir: 'in', script: true }), h('div', 'wfl-k', 'Outputs'), portChips(s.outputs, { dir: 'out', script: true }));
        const params = Array.isArray(s.params) ? s.params : [];
        if (params.length) {
          d.appendChild(h('div', 'wfl-k', 'Params'));
          for (const p of params) {
            const r = h('div', 'wfl-param');
            r.append(h('span', '', p.label || p.id), h('span', 'mono', `${p.id} · ${p.type}${p.default !== undefined ? ` = ${JSON.stringify(p.default)}` : ''}`));
            d.appendChild(r);
          }
        }
        d.appendChild(h('div', 'wfl-meta mono', `runtime ${s.runtime || 'node'} · timeout ${Math.round((Number(s.timeoutMs) || 600000) / 1000)} s`));
        const list = [];
        if (placeable) list.push(['Add to canvas', () => act('addToCanvas', { kind: 'script', key: s.key }), true]);
        list.push([user ? 'Edit' : 'Open', () => act('openScript', s.key)], ['Duplicate', () => act('duplicateScript', s)]);
        if (user) list.push(['Delete', () => act('deleteScript', s)]);
        d.appendChild(actionsRow(list, id));
        return d;
      } });
  }
  function flowItem(f, at = null) {
    const placed = new Set(st.data.placedKinds || []);
    const single = (f.kind === 'task' || f.kind === 'end') && placed.has(f.kind);
    const id = `flow:${f.kind}`;
    const item = itemRow({ id, kind: f.kind, key: null, name: f.label, sub: FLOW_PORT_LINE[f.kind] || '', at,
      chips: single ? [{ text: '1 placed' }] : [], fam: 'flow', glyph: FLOW_ICON[f.kind], viewBox: '0 0 20 20', draggable: !single,
      detail: () => {
        const d = h('div', 'wfl-detail');
        d.appendChild(h('p', 'wfl-desc', FLOW_DESC[f.kind] || ''));
        if (!single) d.appendChild(actionsRow([['Add to canvas', () => act('addToCanvas', { kind: f.kind }), true]], id));
        return d;
      } });
    if (single) item.classList.add('is-placed');
    return item;
  }
  function workflowItem(w, at = null) {
    const v2 = w.version === 2;
    const item = h('div', `wfl-item wfl-wf${st.flash === `workflow:${w.id}` ? ' is-flash' : ''}${v2 ? '' : ' is-legacy'}`);
    item.dataset.id = w.id;
    item.dataset.item = `workflow:${w.id}`;
    const main = h('div', 'wfl-main');
    main.dataset.focusKey = `workflow:${w.id}`;
    if (v2) { main.setAttribute('role', 'button'); main.tabIndex = 0; main.title = `Open "${w.name || w.id}"`; }
    const thumb = h('span', 'wfl-tb');
    // thumbnailFor is numbers-only markup (no names, no ids) — safe for innerHTML.
    if (v2) thumb.innerHTML = thumbnailFor(w, (n) => act('portsFn', n), { width: 120, height: 44 });
    else thumb.textContent = 'v1';
    const txt = h('span', 'wfl-txt');
    const l1 = h('span', 'wfl-l1');
    l1.appendChild(h('span', 'wfl-name', w.name || w.id));
    const steps = (Array.isArray(w.nodes) ? w.nodes : []).filter((n) => n && (n.kind === 'agent' || n.kind === 'script')).length;
    let loops = 0;
    try { loops = v2 ? classifyLoops(w, (n) => act('portsFn', n)).loopWireIds.size : 0; } catch { loops = 0; }
    txt.append(l1, h('span', 'wfl-l2 mono', v2 ? `${steps} step${steps === 1 ? '' : 's'} · ${loops} loop${loops === 1 ? '' : 's'}` : 'legacy'));
    const l3 = h('span', 'wfl-l3');
    if (typeof w.origin === 'string' && w.origin.startsWith('plugin:')) l3.appendChild(h('span', 'wfl-qchip', w.origin));
    if (w.origin === 'auto') l3.appendChild(h('span', 'wfl-qchip', 'Auto'));
    if (st.data.newIds && st.data.newIds.has(w.id)) l3.appendChild(h('span', 'wfl-qchip is-new', 'NEW'));
    if (st.data.openId === w.id) l3.appendChild(h('span', 'wfl-qchip is-open', 'Open'));
    if (l3.childNodes.length) txt.appendChild(l3);
    whereTag(txt, at);
    main.append(thumb, txt);
    if (v2) {
      main.addEventListener('click', () => act('openWorkflow', w.id));
      main.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); act('openWorkflow', w.id); } });
    }
    item.appendChild(main);
    const tail = h('span', 'wfl-wf-actions');
    if (v2) {
      const ex = h('button', 'btn btn-sm btn-quiet btn-icon wfl-export');
      ex.type = 'button';
      ex.title = 'Export as a JSON file, a Claude Code skill or a Worca plugin';
      ex.setAttribute('aria-label', `Export "${w.name || w.id}"`);
      ex.appendChild(svg('<path d="M12 4v11M7 9l5-5 5 5M5 20h14"/>'));
      ex.addEventListener('click', () => act('exportWorkflow', w));
      tail.appendChild(ex);
    }
    if (!RESERVED.has(w.id)) {
      const del = h('button', 'btn btn-sm btn-quiet btn-icon wfl-del');
      del.type = 'button';
      del.title = 'Delete pipeline';
      del.setAttribute('aria-label', `Delete "${w.name || w.id}"`);
      del.appendChild(svg(TRASH_GLYPH));
      del.addEventListener('click', () => act('deleteWorkflow', w));
      tail.appendChild(del);
    }
    if (!w.archivedAt) {
      const more = h('button', 'btn btn-sm btn-quiet btn-icon wfl-more');
      more.type = 'button';
      more.title = 'More';
      more.setAttribute('aria-label', `More for "${w.name || w.id}"`);
      more.setAttribute('aria-haspopup', 'menu');
      more.dataset.focusKey = `workflow:${w.id}:more`;
      more.appendChild(sharedIcon('more'));
      more.addEventListener('click', () => {
        const pinned = act('isPinned', w.id) === true;
        toggleMenu({ doc, anchor: more, align: 'end', label: `More for ${w.name || w.id}`, items: [
          { label: pinned ? 'Unpin from Chat home' : 'Pin to Chat home', onSelect: () => act('togglePin', w) },
          ...(act('versionsEnabled', w) === true ? [{ label: 'Versions…', onSelect: () => act('openVersions', w.id) }] : []),
        ] });
      });
      tail.appendChild(more);
    }
    item.appendChild(tail);
    return item;
  }
  /** An archived workflow (Workflows › Archived): its name and id, deleted for good from its own button (app.js asks first).
   *  Never `.wfl-wf` — the tour's fallback "any workflow row" must not ring it. */
  function archivedItem(w, at = null) {
    const item = h('div', 'wfl-item wfl-arch');
    item.dataset.item = `archived:${w.id}`;
    const main = h('div', 'wfl-main');
    const txt = h('span', 'wfl-txt');
    const l1 = h('span', 'wfl-l1');
    l1.appendChild(h('span', 'wfl-name', w.name || w.id));
    txt.append(l1, h('span', 'wfl-l2 mono', w.id));
    whereTag(txt, at);
    main.appendChild(txt);
    item.appendChild(main);
    const tail = h('span', 'wfl-wf-actions');
    const del = h('button', 'btn btn-sm btn-quiet btn-icon wfl-del');
    del.type = 'button';
    del.title = 'Delete permanently';
    del.setAttribute('aria-label', `Delete "${w.name || w.id}" permanently`);
    del.dataset.focusKey = `archived:${w.id}:del`;
    del.appendChild(svg(TRASH_GLYPH));
    del.addEventListener('click', () => act('deleteArchived', w));
    tail.appendChild(del);
    item.appendChild(tail);
    return item;
  }
  function rowEl(kind, x, at = null) {
    if (kind === 'agent') return agentItem(x, at);
    if (kind === 'script') return scriptItem(x, at);
    if (kind === 'flow') return flowItem(x, at);
    if (kind === 'workflow') return workflowItem(x, at);
    return archivedItem(x, at);
  }

  // ── render ─────────────────────────────────────────────────────────────────
  function listBody() {
    const top = st.top;
    const list = h('div', 'wfl-list');
    if (st.data.loadError) {
      const err = h('p', 'wfl-empty', st.data.loadError);
      if (typeof st.data.retry === 'function') {
        const b = h('button', 'btn btn-sm', 'Retry');
        b.type = 'button';
        b.addEventListener('click', () => st.data.retry());
        err.appendChild(b);
      }
      list.appendChild(err);
    }
    if (q()) {
      // A query lists every match in the section as one flat list, each row tagged with the subfolder holding it.
      const hits = rowsUnder(top).filter((r) => HIT[r.kind](r.x));
      for (const r of hits) list.appendChild(rowEl(r.kind, r.x, r.at));
      if (!hits.length) list.appendChild(h('p', 'wfl-empty', `No ${NOUN[top]} match “${st.query.trim()}”`));
      return { list, count: hits.length };
    }
    for (const g of groupsOf(top)) {
      if (g.at.length === 1) { for (const x of g.items) list.appendChild(rowEl(g.kind, x)); continue; }
      if (!g.items.length) continue;                     // a chip left it nothing to show
      const key = g.at.join('/');
      list.appendChild(folderRow(g.at, g.items.length));
      if (!st.folders.has(key)) continue;
      const fold = h('div', 'wfl-fold');
      fold.dataset.fold = key;
      fold.setAttribute('role', 'group');
      fold.setAttribute('aria-label', folderLabel(g.at));
      for (const x of g.items) fold.appendChild(rowEl(g.kind, x));
      list.appendChild(fold);
    }
    if (!list.querySelector('.wfl-item, .wfl-folder')) list.appendChild(h('p', 'wfl-empty', `No ${NOUN[top]}`));
    // The section's own rows: never the pinned flow cards or the archived workflows.
    return { list, count: rowsUnder(top).filter((r) => !PINNED_KINDS.has(r.kind)).length };
  }

  function repaintRows() {
    const oldList = host.querySelector('.wfl-list');
    const oldFoot = host.querySelector('.wfl-foot');
    if (!oldList || !oldFoot) { render(); return; }
    const { list, count } = listBody();
    oldList.replaceWith(list);
    oldFoot.textContent = `${count} ${NOUN[st.top]}`;
  }

  /** Full repaint below the header; focus returns to the element that had it (by id or data-focus-key). */
  function render(focusKey = null) {
    const active = doc.activeElement && host.contains(doc.activeElement) ? doc.activeElement : null;
    let want = focusKey || (active && (active.id || active.dataset.focusKey)) || null;
    if (want === 'wfl-filter' && !st.searchOpen) want = 'wfl-filter-btn';   // a closed (inert) field hands focus to its button
    const prevList = host.querySelector('.wfl-list');
    const keepTop = prevList && host.dataset.tab === st.top ? prevList.scrollTop : 0;   // a refresh or a fold never scrolls the list away
    host.dataset.tab = st.top;
    host.dataset.open = st.open ? 'true' : 'false';
    syncHead();
    const { list, count } = listBody();
    const foot = h('div', 'wfl-foot', `${count} ${NOUN[st.top]}`);
    const chips = hasChips() ? [chipRow()] : [];
    if (host.firstChild !== head) host.replaceChildren(head);
    while (head.nextSibling) head.nextSibling.remove();
    host.append(bar(), ...chips, list, foot);
    if (keepTop) list.scrollTop = keepTop;
    if (want) {
      // Never build a selector from a key: `#agent:planner` is an INVALID selector (Chrome throws a SyntaxError
      // after the repaint, focus falls to <body>, and the canvas then takes Delete/arrows). jsdom accepts it.
      const own = (id) => { const n = doc.getElementById(id); return n && host.contains(n) ? n : null; };
      const keyed = (k) => [...host.querySelectorAll('[data-focus-key]')].find((n) => n.dataset.focusKey === k);
      let el = own(want) || keyed(want);
      // The control is gone (a placed Task / End loses its "+" and its Add to canvas, an opener's row was deleted or its
      // folder went): its row (the key up to its last ':'), else the selected tab — never <body>.
      for (let k = want; !el && k.lastIndexOf(':') > 0;) { k = k.slice(0, k.lastIndexOf(':')); el = keyed(k); }
      if (!el) el = own(`wfl-tab-${st.top}`);
      if (el && el.focus && doc.activeElement !== el) el.focus();
    }
  }

  /** A section (the shell menu's Open… / Agent… / Script…, #workflows/agents|scripts). The selected one stays put, open
   *  folders and all: a sheet closing back to its tab address must not repaint the opener's row away (focus would fall
   *  to <body>, where the canvas takes Delete). */
  function open(tab, focusKey = null) {
    if (TOPS.includes(tab) && st.top !== tab) { st.top = tab; st.chip = 'all'; }
    render(focusKey);
  }

  let flashT = 0;
  return {
    render,
    open,
    /** [top] or [top, domain | FLOW | ARCHIVED]: selects the section and opens the folder; the query clears so it shows. */
    openFolder(path, focusKey = null) {
      const [top, sub] = (Array.isArray(path) ? path : []).filter((s) => typeof s === 'string');
      if (!TOPS.includes(top)) return;
      if (top !== st.top) { st.top = top; st.chip = 'all'; }
      if (sub) st.folders.add(`${top}/${sub}`);
      st.query = '';
      render(focusKey);
    },
    folderOf,
    setData(patch) { st.data = { ...st.data, ...patch }; render(); },
    setOpen(v) { st.open = Boolean(v); host.dataset.open = st.open ? 'true' : 'false'; host.hidden = false; },
    isOpen: () => st.open,
    /** The selected section. */
    tab: () => st.top,
    /** After a save / duplicate / import: show the row (its section, its folder open, no search, no chip, expanded)
     *  and wash it for 1.6 s. */
    highlight(kind, key) {
      st.chip = 'all'; st.query = ''; st.searchOpen = false;
      const at = folderOf(kind, key);
      if (at.length) st.top = at[0];
      if (at.length > 1) st.folders.add(at.join('/'));
      const id = `${kind}:${key}`;
      if (kind !== 'workflow') st.expanded.add(id);
      st.flash = id;
      render();
      const item = [...host.querySelectorAll('.wfl-item')].find((n) => n.dataset.item === id);
      const reduced = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
      try { if (item && item.scrollIntoView) item.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' }); } catch { /* jsdom */ }
      win.clearTimeout(flashT);
      flashT = win.setTimeout(() => { st.flash = ''; const n = [...host.querySelectorAll('.wfl-item')].find((x) => x.dataset.item === id); if (n) n.classList.remove('is-flash'); }, 1600);
    },
    destroy() {
      win.clearTimeout(flashT);
      host.removeEventListener('mousedown', swallowSecondPress, true);
      host.removeEventListener('click', swallowSecondPress, true);
      host.replaceChildren();
    },
  };
}
