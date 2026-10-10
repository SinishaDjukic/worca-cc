// ui/public/workflows/shell.mjs
// The Workflows view's chrome around the composer engine (graph/composer.mjs): the top bar
// (Back · Workflows ▾ · name · chip | Library · Save), the bottom-right Auto-layout + zoom % menu,
// the black "+" menu, the Library drop target, and the selection toolbar whose "More" popover hosts
// the full inspector. Pure DOM + injected callbacks: app.js owns routing, data and the server.
// Strings and behaviour: composer-mockup.html canvas.js (buildChrome 2363–2448, toolbar 2141–2322).
import { toggleMenu, closeMenus } from './menu.mjs';
import { modelGroups } from '../../../src/shared/connections.mjs';
import { DEFAULT_MAX_CYCLES, LIMITS } from '../../../src/shared/graph/constants.mjs';
import { resolveOrOutType } from '../../../src/shared/graph/ports.mjs';
import { carriesFiles } from '../attach-files.mjs';

export const DND_TYPE = 'application/x-worca';
export const FLOW_CARDS = Object.freeze([
  Object.freeze({ kind: 'task', label: 'Task' }), Object.freeze({ kind: 'end', label: 'End' }),
  Object.freeze({ kind: 'and', label: 'AND' }), Object.freeze({ kind: 'or', label: 'OR' }),
  Object.freeze({ kind: 'combine', label: 'Combine' }),
]);
const SINGLETONS = new Set(['task', 'end']);
const ZOOM_STEP = 1.2;

/** A Library/DnD payload {kind:'agent'|'script'|flow, key?} → the composer's spawn() entry. */
export function toSpawnEntry(p) {
  if (!p || typeof p !== 'object') return null;
  if (p.kind === 'agent') return p.key ? { key: String(p.key) } : null;
  if (p.kind === 'script') return p.key ? { kind: 'script', key: String(p.key) } : null;
  return FLOW_CARDS.some((f) => f.kind === p.kind) ? { kind: p.kind } : null;
}

const ICONS = {
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  minus: '<path d="M6 12h12"/>',
  plus: '<path d="M12 6v12M6 12h12"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
};

/**
 * @param {object} o
 * @param {Document} o.doc
 * @param {object} o.els  {root, stage, canvas, back, wfMenu, name, importFile, libToggle, add, autolayout, zoom, zoomLabel, overlay, inspector}
 * @param {object} o.composer  the createComposer() instance
 * @param {object} o.actions  {back, newCanvas, openLibrary(tab), toggleLibrary, importFile(file), exportCurrent, newAgent, newScript, afterRender?}
 */
export function createWorkflowsShell({ doc, els, composer, actions }) {
  const h = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const icon = (name) => { const s = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = ICONS[name]; return s; };
  const act = (name, ...args) => { const fn = actions && actions[name]; return typeof fn === 'function' ? fn(...args) : undefined; };
  const offs = [];
  const on = (el, type, fn, opts) => { if (!el) return; el.addEventListener(type, fn, opts); offs.push(() => el.removeEventListener(type, fn, opts)); };

  // ── top bar ──────────────────────────────────────────────────────────────
  on(els.back, 'click', () => act('back'));
  on(els.wfMenu, 'click', () => {
    const saved = Boolean(composer.template().id);
    // Export reads the SAVED row by id: with unsaved changes it would hand out the old graph under the new name.
    const unsaved = saved && composer.isDirty();
    const exportTip = !saved ? 'Save the pipeline first' : unsaved ? 'Save your changes first' : '';
    toggleMenu({ doc, anchor: els.wfMenu, label: 'Workflows', items: [
      { label: 'New canvas', onSelect: () => act('newCanvas') },
      { label: 'Open…', onSelect: () => act('openLibrary', 'workflows') },
      { sep: true },
      { label: 'Import…', onSelect: () => { if (els.importFile) { els.importFile.value = ''; els.importFile.click(); } } },
      { label: 'Export…', disabled: !saved || unsaved, title: exportTip, onSelect: () => act('exportCurrent') },
    ] });
  });
  on(els.importFile, 'change', () => { const f = els.importFile.files && els.importFile.files[0]; if (f) act('importFile', f); });
  on(els.name, 'input', () => composer.setName(els.name.value));
  on(els.name, 'keydown', (ev) => { if (ev.key === 'Enter' || ev.key === 'Escape') { ev.preventDefault(); els.name.blur(); } });
  on(els.libToggle, 'click', () => act('toggleLibrary'));
  /** The Library's open state, painted by app.js after every toggle. */
  function paintLibToggle(open) { if (els.libToggle) els.libToggle.setAttribute('aria-pressed', open ? 'true' : 'false'); }

  // ── bottom-right: Auto-layout (the engine binds the layout itself) + zoom ───
  on(els.autolayout, 'click', () => composer.fit());     // after the engine's own click handler: lay out, then fit
  on(els.zoom, 'click', () => {
    toggleMenu({ doc, anchor: els.zoom, align: 'end', side: 'top', label: 'Zoom', items: [
      { label: 'Zoom in', onSelect: () => composer.zoomStep(ZOOM_STEP) },
      { label: 'Zoom out', onSelect: () => composer.zoomStep(1 / ZOOM_STEP) },
      { label: 'Fit graph to view', onSelect: () => composer.fit() },
    ] });
  });
  const paintZoom = (z) => { if (els.zoomLabel) els.zoomLabel.textContent = `${Math.round(z * 100)}%`; };

  // ── "+" (opens upward) ─────────────────────────────────────────────────────
  function spawnFlow(kind) {
    const node = composer.spawn({ kind });
    if (node) composer.view.centerOn(node.id);
  }
  on(els.add, 'click', () => {
    const placed = new Set(composer.placedKinds());
    toggleMenu({ doc, anchor: els.add, side: 'top', label: 'Add', items: [
      { header: 'Flow' },
      ...FLOW_CARDS.map((f) => {
        const done = SINGLETONS.has(f.kind) && placed.has(f.kind);
        return { label: f.label, hint: done ? '1 placed' : '', disabled: done, onSelect: () => spawnFlow(f.kind) };
      }),
      { sep: true },
      { label: 'Agent…', onSelect: () => act('openLibrary', 'agents') },
      { label: 'Script…', onSelect: () => act('openLibrary', 'scripts') },
      { sep: true },
      { label: 'New agent…', onSelect: () => act('newAgent') },
      { label: 'New script…', onSelect: () => act('newScript') },
    ] });
  });

  // ── Library drop target (HTML5 DnD, BRIEF.md) ───────────────────────────────
  const carries = (ev) => Boolean(ev.dataTransfer && [...(ev.dataTransfer.types || [])].includes(DND_TYPE));
  on(els.canvas, 'dragover', (ev) => {
    if (!carries(ev)) return;
    ev.preventDefault();
    try { ev.dataTransfer.dropEffect = 'copy'; } catch { /* read-only in some engines */ }
    els.canvas.classList.add('is-drop');
  });
  on(els.canvas, 'dragleave', (ev) => { if (!ev.relatedTarget || !els.canvas.contains(ev.relatedTarget)) els.canvas.classList.remove('is-drop'); });
  on(els.canvas, 'drop', (ev) => {
    els.canvas.classList.remove('is-drop');
    if (!carries(ev)) return;
    ev.preventDefault();
    let payload = null;
    try { payload = JSON.parse(ev.dataTransfer.getData(DND_TYPE)); } catch { payload = null; }
    const entry = toSpawnEntry(payload);
    if (!entry) return;
    // Only what the Library offers: a raw payload (another window, a stale tab) naming a workspace-only,
    // unplaceable or unknown key places nothing — the palette maps hold exactly the placeable ones.
    if (entry.key && !Object.hasOwn(entry.kind === 'script' ? composer.getScripts() : composer.getAgents(), entry.key)) return;
    if (entry.kind && SINGLETONS.has(entry.kind)) {
      const there = composer.template().nodes.find((n) => n.kind === entry.kind);
      if (there) { composer.select({ kind: 'node', id: there.id }); composer.view.centerOn(there.id); return; }
    }
    composer.spawnAtClient(entry, ev.clientX, ev.clientY);
  });
  // A FILE dragged over the view, anywhere but the chat dock (which attaches it, chat-dock.mjs), must never reach the
  // browser's default: Chrome opens a dropped file in this tab and the unsaved canvas is gone. Claim the drop and refuse
  // it (dropEffect 'none'). A drag a target already took (the dock; the canvas's own Library drop) is that target's.
  for (const type of ['dragover', 'drop']) {
    on(els.root, type, (ev) => {
      if (ev.defaultPrevented || !carriesFiles(ev.dataTransfer)) return;
      ev.preventDefault();
      if (type === 'dragover') { try { ev.dataTransfer.dropEffect = 'none'; } catch { /* read-only in some engines */ } }
    });
  }

  // ── selection toolbar + More popover ─────────────────────────────────────────
  let tb = null;            // the toolbar element (rebuilt when its signature changes)
  let tbSig = '';
  let pop = null;           // the More popover (hosts els.inspector, the composer's insBody)
  const nodeOf = (id) => composer.template().nodes.find((n) => n.id === id) || null;
  const wireOf = (id) => composer.template().wires.find((w) => w.id === id) || null;
  const setCfg = (id, label, patch) => composer.commit(label, () => {
    const n = nodeOf(id);
    if (!n) return;
    n.config = { ...(n.config || {}) };
    for (const [k, v] of Object.entries(patch)) { if (v == null) delete n.config[k]; else n.config[k] = v; }
  });
  const btn = (key, text, { pressed = null, disabled = false, title = '', iconName = '', menu = false } = {}) => {
    const b = h('button', `wfv-tbb${iconName && !text ? ' wfv-tbi' : ''}`);
    b.type = 'button';
    b.dataset.tb = key;
    if (iconName) b.appendChild(icon(iconName));
    if (text) b.appendChild(doc.createTextNode(text));
    if (pressed != null) b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    if (disabled) b.setAttribute('aria-disabled', 'true');
    if (title) { b.title = title; b.setAttribute('aria-label', title); }
    if (menu) { b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false'); b.appendChild(icon('chev')); }
    return b;
  };
  const sep = () => h('span', 'wfv-tb-sep');
  const stepper = (key, label, value, { min, max = Infinity, onChange }) => {
    const wrap = h('span', 'wfv-step');
    wrap.appendChild(h('span', 'k', label));
    const minus = btn(`${key}-`, '', { iconName: 'minus', title: `Fewer ${label.toLowerCase()}` });
    const out = h('output', '', String(value));
    const plus = btn(`${key}+`, '', { iconName: 'plus', title: `More ${label.toLowerCase()}` });
    if (value <= min) minus.setAttribute('aria-disabled', 'true');
    if (value >= max) plus.setAttribute('aria-disabled', 'true');
    minus.addEventListener('click', () => { if (value > min) onChange(value - 1); });
    plus.addEventListener('click', () => { if (value < max) onChange(value + 1); });
    wrap.append(minus, out, plus);
    return wrap;
  };

  function modelMenu(anchor, node) {
    const { models } = composer.models();
    const offered = models.filter((m) => m && (!m.hidden || m.id === node.config.model));
    const groups = modelGroups(offered);
    const items = [{ label: 'inherit', checked: !node.config.model, onSelect: () => setCfg(node.id, 'model', { model: null }) }];
    for (const g of groups) {
      items.push({ sep: true });
      if (groups.length > 1 || g.label) items.push({ header: g.label });
      for (const m of g.models) {
        items.push({ label: m.label || m.id, checked: node.config.model === m.id, onSelect: () => {
          const eff = Array.isArray(m.efforts) && m.efforts.length ? m.efforts : null;
          // Picking a model clears an effort that model does not offer (FIXES A7).
          setCfg(node.id, 'model', { model: m.id, ...(eff && node.config.effort && !eff.includes(node.config.effort) ? { effort: null } : {}) });
        } });
      }
    }
    toggleMenu({ doc, anchor, label: 'Model', items });
  }
  function effortMenu(anchor, node) {
    const { models, efforts } = composer.models();
    const m = node.config.model ? models.find((x) => x.id === node.config.model) : null;
    const list = m && Array.isArray(m.efforts) && m.efforts.length ? m.efforts : efforts;
    toggleMenu({ doc, anchor, label: 'Effort', items: [
      { label: 'default', checked: !node.config.effort, onSelect: () => setCfg(node.id, 'effort', { effort: null }) },
      { sep: true },
      ...list.map((e) => ({ label: e, checked: node.config.effort === e, onSelect: () => setCfg(node.id, 'effort', { effort: e }) })),
    ] });
  }

  function agentTools(node, meta) {
    const { models } = composer.models();
    const m = node.config.model ? models.find((x) => x.id === node.config.model) : null;
    const model = btn('model', '', { menu: true });
    model.prepend(h('span', 'k', 'Model'), doc.createTextNode(` ${node.config.model ? ((m && m.label) || node.config.model) : 'inherit'}`));
    model.addEventListener('click', () => modelMenu(model, node));
    const effort = btn('effort', '', { menu: true });
    effort.prepend(h('span', 'k', 'Effort'), doc.createTextNode(` ${node.config.effort || 'default'}`));
    effort.addEventListener('click', () => effortMenu(effort, node));
    const kids = [model, effort, sep()];
    if (meta && meta.fanOut) {
      const b = btn('fanOut', 'Research fan-out', { pressed: node.config.fanOut === true });
      b.addEventListener('click', () => setCfg(node.id, 'fanOut', { fanOut: node.config.fanOut === true ? null : true }));
      kids.push(b);
    }
    if (meta && meta.asksQuestions) {
      const locked = Boolean(meta.questionsLocked);
      const dflt = Boolean(meta.questionsDefault);
      const on = locked ? dflt : (typeof node.config.askQuestions === 'boolean' ? node.config.askQuestions : dflt);
      const b = btn('askQuestions', 'Ask questions', { pressed: on, disabled: locked,
        title: locked ? (dflt ? 'Always on for this agent' : 'Always off for this agent') : '' });
      // Store only a deviation from the agent's default (mockup:2306).
      if (!locked) b.addEventListener('click', () => setCfg(node.id, 'askQuestions', { askQuestions: !on === dflt ? null : !on }));
      kids.push(b);
    }
    const aw = btn('awaitAll', 'Await all inputs', { pressed: node.config.awaitAll === true });
    aw.addEventListener('click', () => setCfg(node.id, 'awaitAll', { awaitAll: node.config.awaitAll === true ? null : true }));
    kids.push(aw);
    return kids;
  }

  function flowTools(node) {
    const kids = [];
    if (node.kind === 'and' || node.kind === 'or' || node.kind === 'combine') {
      const n = Number.isInteger(node.config.arity) ? node.config.arity : 2;
      kids.push(stepper('arity', 'Input count', n, { min: 2, max: 8, onChange: (v) => setCfg(node.id, 'arity', { arity: v }) }));
      if (node.kind === 'or') {
        const t = resolveOrOutType(composer.template(), (x) => composer.view.ports(x), node.id, new Set());
        kids.push(h('span', 'wfv-tb-mono', t ? `forwards: ${t}` : 'unresolved'));
      }
      kids.push(sep());
    } else if (node.kind === 'task') {
      const b = btn('planStoreSeed', 'Seed the plan store', { pressed: node.config.planStoreSeed === true, title: 'treat an attached plan as the run’s plan' });
      b.addEventListener('click', () => setCfg(node.id, 'planStoreSeed', { planStoreSeed: node.config.planStoreSeed === true ? null : true }));
      kids.push(b, sep());
    }
    return kids;
  }

  function wireTools(wire) {
    const loop = composer.view.isLoopWire(wire.id);
    const kids = [h('span', 'k', loop ? 'Loop wire' : 'Wire'), h('span', 'wfv-tb-mono', `${wire.from.port} → ${wire.to.port}`)];
    if (loop) {
      const n = Number.isInteger(wire.config && wire.config.maxCycles) ? wire.config.maxCycles : DEFAULT_MAX_CYCLES;
      kids.push(sep(), stepper('cycles', 'Max cycles', n, { min: 1, max: LIMITS.maxCycles, onChange: (v) => composer.commit('maxCycles', () => {
        const w = wireOf(wire.id);
        if (w) w.config = { ...(w.config || {}), maxCycles: v };
      }) }));
    }
    const del = btn('delete', 'Delete wire', { iconName: 'trash' });
    del.addEventListener('click', () => composer.deleteSelection());
    kids.push(sep(), del);
    return kids;
  }

  function closePopover() {
    if (!pop) return;
    pop.remove();
    pop = null;
    const trigger = tb && tb.querySelector('[data-tb="more"], [data-tb="params"]');   // an agent's More, a script's Params
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }
  function openPopover(anchorBtn) {
    if (pop) { closePopover(); return; }
    pop = h('div', 'wfv-pop');
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Settings');
    pop.appendChild(els.inspector);           // the composer keeps painting it on every commit
    els.overlay.appendChild(pop);
    anchorBtn.setAttribute('aria-expanded', 'true');
    placePopover();
    const first = pop.querySelector('input, select, textarea, button');
    if (first) first.focus();
  }
  /** Mockup positionPop: the popover keeps to the band between the top bars (y 60) and the chat dock (stage
   *  height − 80) — under the toolbar when it fits, else above it, else on the roomier side, shortened (it scrolls). */
  function placePopover() {
    if (!pop || !tb) return;
    const W = els.stage ? els.stage.clientWidth : 0;
    const H = els.stage ? els.stage.clientHeight : 0;
    const left = Math.max(8, Math.min((parseFloat(tb.style.left) || 0) + (tb.offsetWidth || 0) - 300, Math.max(8, W - 308)));
    pop.style.left = `${left}px`;
    const tbTop = parseFloat(tb.style.top) || 0;
    let y = tbTop + (tb.offsetHeight || 28) + 6;
    if (H) {
      const top = 60;
      const bottom = H - 80;
      pop.style.maxHeight = `${Math.max(160, Math.min(520, bottom - top))}px`;
      const ph = pop.offsetHeight || 0;
      const below = bottom - y;
      const above = tbTop - 6 - top;
      if (ph > below) {
        if (ph <= above) y = tbTop - 6 - ph;
        else {
          const up = above > below;
          const fit = up ? above : below;            // never a floor past the room: it would cover its own toolbar
          pop.style.maxHeight = `${fit}px`;
          y = up ? Math.max(top, tbTop - 6 - fit) : Math.max(top, Math.min(y, bottom - fit));
        }
      }
    }
    pop.style.top = `${y}px`;
  }
  on(els.overlay, 'keydown', (ev) => {
    // A command/code param's editor (the inspector's paramEditorHook) owns its Escape: it arms the next Tab to leave the
    // field, the one way past a textarea whose Tab indents. Closing here would leave every control after it unreachable.
    if (ev.key === 'Escape' && ev.target && ev.target.closest && ev.target.closest('.code-editor')) return;
    if (ev.key === 'Escape' && pop) { ev.preventDefault(); ev.stopPropagation(); const trigger = tb && tb.querySelector('[data-tb="more"], [data-tb="params"]'); closePopover(); if (trigger) trigger.focus(); }
  });

  function placeToolbar() {
    if (!tb) return;
    const a = composer.selectionAnchor();
    if (!a) return;
    const W = els.stage ? els.stage.clientWidth : 0;
    const w = tb.offsetWidth || 0;
    tb.style.left = `${Math.max(8, Math.min(a.x - w / 2, Math.max(8, W - w - 8)))}px`;
    tb.style.top = `${a.y + (a.kind === 'wire' ? 16 : 10)}px`;
    placePopover();
  }

  function paintToolbar() {
    const sel = composer.selection();
    const node = sel && sel.kind === 'node' ? nodeOf(sel.id) : null;
    const wire = sel && sel.kind === 'wire' ? wireOf(sel.id) : null;
    if (!node && !wire) {
      if (tb) { tb.remove(); tb = null; tbSig = ''; }
      closePopover();
      return;
    }
    const sig = JSON.stringify([sel, node ? node.config : wire.config, node && node.key, composer.view.isLoopWire(wire ? wire.id : '')]);
    if (tb && sig === tbSig) { placeToolbar(); return; }
    const keepPop = Boolean(pop) && tbSig && JSON.parse(tbSig)[0].id === sel.id;
    tbSig = sig;
    const next = h('div', 'wfv-tb');
    next.setAttribute('role', 'toolbar');
    next.setAttribute('aria-label', node ? 'Node settings' : 'Wire settings');
    let kids;
    if (wire) kids = wireTools(wire);
    else {
      const meta = composer.metaOf(node);
      kids = node.kind === 'agent' ? agentTools(node, meta)
        : node.kind === 'script' ? [h('span', 'wfv-tb-mono', (meta && meta.runtime) || 'script'), (() => {
          const p = btn('params', 'Params', { menu: false });
          p.addEventListener('click', () => openPopover(p));
          return p;
        })(), sep()]
          : flowTools(node);
      const del = btn('delete', 'Delete', { iconName: 'trash' });
      del.addEventListener('click', () => composer.deleteSelection());
      kids.push(del);
      if (node.kind === 'agent') {
        const more = btn('more', '', { iconName: 'more', title: 'More' });
        more.setAttribute('aria-expanded', 'false');
        more.addEventListener('click', () => openPopover(more));
        kids.push(more);
      }
    }
    next.append(...kids);
    // A commit rebuilds the toolbar under the control that holds the focus (Await all, a stepper, a Model / Effort pick
    // whose menu handed the focus back to its trigger): put it on the same control of the new toolbar, else on the
    // selected card — never <body>, where the canvas takes Delete and the arrows.
    const had = tb && tb.contains(doc.activeElement) ? (doc.activeElement.dataset.tb || '') : null;
    if (tb) tb.replaceWith(next); else els.overlay.appendChild(next);
    tb = next;
    if (had !== null) {
      const same = had ? [...next.querySelectorAll('[data-tb]')].find((b) => b.dataset.tb === had) : null;
      const to = same || (node ? composer.view.nodeEl(node.id) : next.querySelector('[data-tb]'));
      if (to) to.focus({ preventScroll: true });
    }
    if (!keepPop) closePopover();
    else { const m = tb.querySelector('[data-tb="more"], [data-tb="params"]'); if (m) m.setAttribute('aria-expanded', 'true'); }
    placeToolbar();
  }

  // The engine has ONE slot per hook: the shell owns them and fans out to app.js.
  composer.hooks.onSelect = () => { closeMenus(); paintToolbar(); };
  composer.hooks.onRender = () => { paintToolbar(); act('afterRender'); };
  composer.hooks.onTransform = () => placeToolbar();
  composer.hooks.onZoom = (z) => paintZoom(z);
  paintZoom(composer.view.getTransform().z);

  return {
    paintToolbar,
    paintLibToggle,
    closePopovers() { closeMenus(); closePopover(); },
    destroy() {
      closeMenus();
      closePopover();
      for (const off of offs.splice(0)) off();
      if (tb) tb.remove();
    },
  };
}
