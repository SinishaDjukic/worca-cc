// ui/public/workflows/library.mjs
// The Workflows view's Library card (composer-mockup.html library.js): Agents · Scripts · Workflows,
// a filter, All / Built-in / Yours (Workflows: domain chips), domain groups, rows that drag onto the
// canvas (HTML5 DnD, application/x-worca — BRIEF.md), an inline detail with every action the old
// Agents and Scripts pages had, and New agent / New script. Pure DOM over the data app.js hands in
// (setData); every action is a callback. Every string from user data goes through textContent.
import { safeAgentIcon, SCRIPT_GLYPH, thumbnailFor } from '../graph/view.mjs';
import { classifyLoops } from '../../../src/shared/graph/loops.mjs';
import { DND_TYPE, FLOW_CARDS } from './shell.mjs';

export const TABS = Object.freeze(['agents', 'scripts', 'workflows']);
const TAB_LABEL = { agents: 'Agents', scripts: 'Scripts', workflows: 'Workflows' };
const NOUN = { agents: 'agents', scripts: 'scripts', workflows: 'workflows' };
const FLOW_DESC = {
  task: 'The pipeline entry: the prompt and its attached files.',
  end: 'The pipeline sink. A token arriving here completes the run.',
  and: 'Fires when ALL of its inputs are fresh. Payloads discarded — pure sequencing.',
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

/**
 * @param {object} o
 * @param {Document} o.doc
 * @param {HTMLElement} o.host  aside#wfv-library
 * @param {object} o.actions  {addToCanvas(entry), openWorkflow(id), deleteWorkflow(wf), deleteArchived(wf),
 *   exportWorkflow(wf), newAgent(), newScript(), viewAgent(key), editAgent(key), deleteAgent(agent),
 *   duplicateAgent(agent), openScript(key), deleteScript(script), duplicateScript(script), portsFn(node)}
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
  const st = {
    tab: 'agents', query: '', filterOpen: false, chip: 'all', domain: 'all', open: false,
    collapsed: new Set(), expanded: new Set(), flash: '',
    data: { agents: [], scripts: [], workflows: [], archived: [], placedKinds: [], openId: '', newIds: new Set(), runtimes: null, loadError: '', retry: null },
  };

  // ── derived lists ──────────────────────────────────────────────────────────
  const q = () => st.query.trim().toLowerCase();
  const matches = (...fields) => { const s = q(); return !s || fields.some((f) => String(f || '').toLowerCase().includes(s)); };
  const origin = (x) => (x.origin === 'user' ? 'yours' : 'builtin');
  const chipOk = (x) => st.chip === 'all' || origin(x) === st.chip;
  function agentRows() {
    return st.data.agents.filter((a) => a && chipOk(a) && matches(a.displayName, a.key, portLineOf(a)));
  }
  function scriptRows() {
    return st.data.scripts.filter((s) => s && chipOk(s) && matches(s.displayName, s.key, s.runtime, s.origin, portLineOf(s)));
  }
  function workflowRows() {
    return st.data.workflows.filter((w) => w && (st.domain === 'all' || (w.domain || 'general') === st.domain) && matches(w.name, w.id, w.domain));
  }
  const flowRows = () => (st.chip === 'yours' ? [] : FLOW_CARDS.filter((f) => matches(f.label, f.kind, FLOW_PORT_LINE[f.kind])));

  // ── chrome ─────────────────────────────────────────────────────────────────
  function header() {
    const head = h('div', 'wfl-head');
    head.appendChild(h('h2', 'wfl-title', 'Library'));
    const filterBtn = h('button', 'wfv-icon-btn wfl-filter-btn');
    filterBtn.type = 'button';
    filterBtn.id = 'wfl-filter-btn';
    filterBtn.title = 'Filter';
    filterBtn.setAttribute('aria-label', 'Filter');
    filterBtn.setAttribute('aria-pressed', st.filterOpen ? 'true' : 'false');
    filterBtn.appendChild(svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'));
    filterBtn.addEventListener('click', () => { st.filterOpen = !st.filterOpen; if (!st.filterOpen) st.query = ''; render(st.filterOpen ? 'wfl-filter' : 'wfl-filter-btn'); });
    const close = h('button', 'wfv-icon-btn wfl-close');
    close.type = 'button';
    close.id = 'wfl-close';
    close.title = 'Close';
    close.setAttribute('aria-label', 'Close library');
    close.appendChild(svg('<path d="M6 6l12 12M18 6L6 18"/>'));
    close.addEventListener('click', () => act('closeLibrary'));
    head.append(filterBtn, close);
    return head;
  }
  function filterBox() {
    const box = h('div', 'wfl-search');
    box.hidden = !st.filterOpen;
    const input = h('input', 'wfl-filter-input');
    input.id = 'wfl-filter';
    input.type = 'search';
    input.placeholder = `Filter ${NOUN[st.tab]}…`;
    input.setAttribute('aria-label', `Filter ${NOUN[st.tab]}`);
    input.value = st.query;
    // Typing repaints the rows only: the input stays, so the caret and an IME composition survive.
    input.addEventListener('input', () => { st.query = input.value; repaintRows(); });
    input.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      if (st.query) { st.query = ''; render('wfl-filter'); } else { st.filterOpen = false; render('wfl-filter-btn'); }
    });
    box.appendChild(input);
    return box;
  }
  function tabs() {
    const seg = h('div', 'wfl-seg');
    seg.setAttribute('role', 'tablist');
    seg.setAttribute('aria-label', 'Library');
    // The count is the registry (not the pinned flow cards, not the filter).
    const counts = { agents: st.data.agents.length, scripts: st.data.scripts.length, workflows: st.data.workflows.length };
    for (const t of TABS) {
      const b = h('button', 'wfl-tab');
      b.type = 'button';
      b.id = `wfl-tab-${t}`;
      b.dataset.tab = t;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', st.tab === t ? 'true' : 'false');
      b.tabIndex = st.tab === t ? 0 : -1;
      b.append(doc.createTextNode(TAB_LABEL[t]), h('span', 'wfl-n mono', String(counts[t])));
      b.addEventListener('click', () => { open(t); });
      b.addEventListener('keydown', (ev) => {
        if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
        ev.preventDefault();
        const i = TABS.indexOf(st.tab) + (ev.key === 'ArrowRight' ? 1 : -1);
        open(TABS[(i + TABS.length) % TABS.length], `wfl-tab-${TABS[(i + TABS.length) % TABS.length]}`);
      });
      seg.appendChild(b);
    }
    return seg;
  }
  function tools() {
    const row = h('div', 'wfl-tools');
    const chip = (key, text, pressed, onClick) => {
      const c = h('button', 'wfl-chip', text);
      c.type = 'button';
      c.dataset.chip = key;
      c.dataset.focusKey = `chip:${key}`;            // a repaint returns focus here, never to <body> (where the canvas takes Delete)
      c.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      c.addEventListener('click', onClick);
      return c;
    };
    if (st.tab === 'workflows') {
      const ds = new Map();
      for (const w of st.data.workflows) { const d = w.domain || 'general'; ds.set(d, (ds.get(d) || 0) + 1); }
      const order = [...ds.keys()].sort((a, b) => (a === 'shared') - (b === 'shared') || (a === 'general') - (b === 'general') || a.localeCompare(b));
      row.appendChild(chip('all', `All ${st.data.workflows.length}`, st.domain === 'all', () => { st.domain = 'all'; render(); }));
      for (const d of order) row.appendChild(chip(d, `${d} ${ds.get(d)}`, st.domain === d, () => { st.domain = d; render(); }));
      return row;
    }
    for (const [k, t] of [['all', 'All'], ['builtin', 'Built-in'], ['yours', 'Yours']]) {
      row.appendChild(chip(k, t, st.chip === k, () => { st.chip = k; render(); }));
    }
    const nb = h('button', 'wfv-btn wfl-new', st.tab === 'agents' ? '+ New agent' : '+ New script');
    nb.type = 'button';
    nb.id = st.tab === 'agents' ? 'wfl-new-agent' : 'wfl-new-script';
    nb.addEventListener('click', () => act(st.tab === 'agents' ? 'newAgent' : 'newScript'));
    row.appendChild(nb);
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
      const b = h('button', `wfv-btn${primary ? ' wfv-btn-primary' : ''}${label === 'Delete' ? ' wfl-danger' : ''}`, label);
      b.type = 'button';
      if (base) b.dataset.focusKey = `${base}:${label}`;
      b.addEventListener('click', fn);
      if (i === 0 && primary) b.dataset.primary = '1';
      row.appendChild(b);
    });
    return row;
  }
  function itemRow({ id, kind, key, name, sub, chips = [], fam, glyph, viewBox, draggable, detail }) {
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
    main.append(tile(fam, glyph, viewBox), txt);
    const toggle = () => { if (st.expanded.has(id)) st.expanded.delete(id); else st.expanded.add(id); render(id); };
    main.addEventListener('click', toggle);
    main.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); } });
    row.appendChild(main);
    if (draggable) {
      const add = h('button', 'wfv-icon-btn wfl-add');
      add.type = 'button';
      add.title = 'Add to canvas';
      add.setAttribute('aria-label', `Add ${name} to canvas`);
      add.dataset.focusKey = `${id}:add`;
      add.appendChild(svg('<path d="M12 6v12M6 12h12"/>'));
      add.addEventListener('click', () => act('addToCanvas', key ? { kind, key } : { kind }));
      row.appendChild(add);
    }
    item.appendChild(row);
    if (open) item.appendChild(detail());
    return item;
  }

  const pluginOf = (x) => (typeof x.origin === 'string' && x.origin.startsWith('plugin:') ? x.origin : '');
  function agentItem(a) {
    // Workspace-only agents run only inside a workspace scan: the palette never offered them and the run
    // assembler refuses them (WORKSPACE_ONLY_AGENT) — listed, never placed.
    const wsOnly = a.scope === 'workspace-only';
    const placeable = a.placeable !== false && !wsOnly;
    const user = a.origin === 'user';
    const chips = [];
    if (user) chips.push({ text: 'user' });
    if (pluginOf(a)) chips.push({ text: pluginOf(a), mono: true });
    if (wsOnly) chips.push({ text: 'workspace only' });
    else if (!placeable) chips.push({ text: 'not placeable' });
    const id = `agent:${a.key}`;
    return itemRow({ id, kind: 'agent', key: a.key, name: a.displayName || a.key, sub: portLineOf(a), chips,
      fam: a.color || 'blue', glyph: safeAgentIcon(a) || '', viewBox: '0 0 24 24', draggable: placeable,
      detail: () => {
        const d = h('div', 'wfl-detail');
        d.appendChild(h('p', 'wfl-desc', `${a.key} · ${a.runnerType || 'producer'} — ${a.description || a.portSummary || ''}`));
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
  function scriptItem(s) {
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
      sub: s.ports === 'config' ? 'in/out (per card)' : portLineOf(s), chips,
      fam: s.color || 'amber', glyph: safeAgentIcon(s) || SCRIPT_GLYPH, viewBox: '0 0 24 24', draggable: placeable,
      detail: () => {
        const d = h('div', 'wfl-detail');
        d.appendChild(h('p', 'wfl-desc', s.description || ''));
        if (s.ports === 'config') d.appendChild(h('div', 'wfl-k', 'ports per card'));
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
  function flowItem(f) {
    const placed = new Set(st.data.placedKinds || []);
    const single = (f.kind === 'task' || f.kind === 'end') && placed.has(f.kind);
    const id = `flow:${f.kind}`;
    const item = itemRow({ id, kind: f.kind, key: null, name: f.label, sub: FLOW_PORT_LINE[f.kind] || '',
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
  function group(id, label, items, { pinned = false } = {}) {
    const g = h('section', 'wfl-group');
    g.dataset.group = id;
    const collapsed = st.collapsed.has(id) && !q();
    const head = h('button', 'wfl-gh');
    head.type = 'button';
    head.dataset.focusKey = `group:${id}`;
    head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    head.appendChild(svg('<path d="M6 9l6 6 6-6"/>'));
    head.append(h('span', 'wfl-gl', label), h('span', 'wfl-gn mono', String(items.length)));
    if (pinned) head.appendChild(h('span', 'wfl-qchip', 'pinned'));
    head.addEventListener('click', () => { if (st.collapsed.has(id)) st.collapsed.delete(id); else st.collapsed.add(id); render(`group:${id}`); });
    g.appendChild(head);
    if (!collapsed) for (const it of items) g.appendChild(it);
    return g;
  }

  function workflowItem(w) {
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
    main.append(thumb, txt);
    if (v2) {
      main.addEventListener('click', () => act('openWorkflow', w.id));
      main.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); act('openWorkflow', w.id); } });
    }
    item.appendChild(main);
    const tail = h('span', 'wfl-wf-actions');
    if (v2) {
      const ex = h('button', 'wfv-icon-btn wfl-export');
      ex.type = 'button';
      ex.title = 'Export as a JSON file, a Claude Code skill or a Worca plugin';
      ex.setAttribute('aria-label', `Export "${w.name || w.id}"`);
      ex.appendChild(svg('<path d="M12 4v11M7 9l5-5 5 5M5 20h14"/>'));
      ex.addEventListener('click', () => act('exportWorkflow', w));
      tail.appendChild(ex);
    }
    if (!RESERVED.has(w.id)) {
      const del = h('button', 'wfv-icon-btn wfl-del');
      del.type = 'button';
      del.title = 'Delete pipeline';
      del.setAttribute('aria-label', `Delete "${w.name || w.id}"`);
      del.appendChild(svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'));
      del.addEventListener('click', () => act('deleteWorkflow', w));
      tail.appendChild(del);
    }
    item.appendChild(tail);
    return item;
  }

  // ── render ─────────────────────────────────────────────────────────────────
  function listBody() {
    const list = h('div', 'wfl-list');
    let visible = 0;
    const empty = () => list.appendChild(h('p', 'wfl-empty', q() ? `No ${NOUN[st.tab]} match “${st.query.trim()}”` : `No ${NOUN[st.tab]}`));
    if (st.data.loadError) {
      const err = h('p', 'wfl-empty', st.data.loadError);
      if (typeof st.data.retry === 'function') {
        const b = h('button', 'wfv-btn', 'Retry');
        b.type = 'button';
        b.addEventListener('click', () => st.data.retry());
        err.appendChild(b);
      }
      list.appendChild(err);
    }
    if (st.tab === 'agents') {
      const rows = agentRows();
      for (const g of domainGroups(rows)) list.appendChild(group(g.id, g.label, g.items.map(agentItem)));
      visible = rows.length;
      const flows = flowRows();
      if (flows.length) list.appendChild(group('flow', 'Flow', flows.map(flowItem), { pinned: true }));
      if (!rows.length && !flows.length) empty();
    } else if (st.tab === 'scripts') {
      const rows = scriptRows();
      for (const g of domainGroups(rows)) list.appendChild(group(g.id, g.label, g.items.map(scriptItem)));
      visible = rows.length;
      if (!rows.length) empty();
    } else {
      const rows = workflowRows();
      visible = rows.length;
      for (const w of rows) list.appendChild(workflowItem(w));
      if (!rows.length) empty();
      const arch = st.data.archived || [];
      if (arch.length) {
        const g = h('section', 'wfl-group wfl-archived');
        g.appendChild(h('div', 'wfl-gh', `Archived (${arch.length})`));
        for (const w of arch) {
          const c = h('button', 'wfl-chip', `${w.name || w.id} ×`);
          c.type = 'button';
          c.title = 'Delete permanently';
          c.addEventListener('click', () => act('deleteArchived', w));
          g.appendChild(c);
        }
        list.appendChild(g);
      }
    }
    return { list, visible };
  }

  function repaintRows() {
    const oldList = host.querySelector('.wfl-list');
    const oldFoot = host.querySelector('.wfl-foot');
    if (!oldList || !oldFoot) { render('wfl-filter'); return; }
    const { list, visible } = listBody();
    oldList.replaceWith(list);
    oldFoot.textContent = `${visible} ${NOUN[st.tab]}`;
  }

  /** Full repaint; focus returns to the element that had it (by id or data-focus-key). */
  function render(focusKey = null) {
    const active = doc.activeElement && host.contains(doc.activeElement) ? doc.activeElement : null;
    const want = focusKey || (active && (active.id || active.dataset.focusKey)) || null;
    const prevList = host.querySelector('.wfl-list');
    const keepTop = prevList && host.dataset.tab === st.tab ? prevList.scrollTop : 0;   // a data refresh never scrolls the list away
    host.dataset.tab = st.tab;
    host.dataset.open = st.open ? 'true' : 'false';
    const { list, visible } = listBody();
    const foot = h('div', 'wfl-foot', `${visible} ${NOUN[st.tab]}`);
    host.replaceChildren(header(), filterBox(), tabs(), tools(), list, foot);
    if (keepTop) list.scrollTop = keepTop;
    if (want) {
      // Never build a selector from a key: `#agent:planner` is an INVALID selector (Chrome throws a SyntaxError
      // after the repaint, focus falls to <body>, and the canvas then takes Delete/arrows). jsdom accepts it.
      const byId = doc.getElementById(want);
      const keyed = (k) => [...host.querySelectorAll('[data-focus-key]')].find((n) => n.dataset.focusKey === k);
      let el = (byId && host.contains(byId) ? byId : null) || keyed(want);
      // The control is gone (a placed Task / End loses its "+" and its Add to canvas, an opener's row was deleted):
      // its row (the key up to its last ':'), else the open tab — never <body>.
      for (let k = want; !el && k.lastIndexOf(':') > 0;) { k = k.slice(0, k.lastIndexOf(':')); el = keyed(k); }
      if (!el) el = doc.getElementById(`wfl-tab-${st.tab}`);
      if (el && el.focus) el.focus();
    }
  }

  function open(tab, focusKey = null) {
    if (TABS.includes(tab) && tab !== st.tab) { st.tab = tab; st.query = ''; st.chip = 'all'; st.domain = 'all'; }
    render(focusKey);
  }

  let flashT = 0;
  return {
    render,
    open,
    setData(patch) { st.data = { ...st.data, ...patch }; render(); },
    setOpen(v) { st.open = Boolean(v); host.dataset.open = st.open ? 'true' : 'false'; host.hidden = false; },
    isOpen: () => st.open,
    tab: () => st.tab,
    /** After a save / duplicate / import: show the row (tab, no filter, expanded) and wash it for 1.6 s. */
    highlight(kind, key) {
      const tab = kind === 'workflow' ? 'workflows' : kind === 'script' ? 'scripts' : 'agents';
      st.tab = tab; st.query = ''; st.chip = 'all'; st.domain = 'all'; st.filterOpen = false;
      st.collapsed.clear();                           // a folded group would hide the row being shown
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
    destroy() { win.clearTimeout(flashT); host.replaceChildren(); },
  };
}
