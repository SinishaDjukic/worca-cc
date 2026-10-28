// ui/public/chat/home.mjs — the Chat home (worca Chat P6; CONTRACT §8): what the Chat page shows while the open chat
// has no messages. The hero ("What should worca do?" on the flat page) wraps P1's hero slot — the composer lives
// there and P1 re-parents it; this module only animates the move (home-flip.mjs) — followed by the quick actions
// (home-actions.mjs), the tabs Needs you · Running · Recent chats · Plans (gated) · Workflows (home-lists.mjs; run tiles
// home-run-tile.mjs) and the "More you can do" promos. It works only while it is on screen: a VISIT starts when the
// Chat section shows with chat-page[data-view="home"] and ends when either changes; leaving destroys every tile and
// its graph mount. Data comes from deps (app.js); findFollowingThread is the one fetch of its own.
import { createQuickActions } from './home-actions.mjs';
import {
  createHomeTabs, buildChatsList, buildPlansList, buildWorkflowsGrid, defaultTab, emptyState, runWorkflowText,
  HOME_TABS, HOME_TAB_EMPTY, HOME_TAB_KEY, RECENT_CHATS_MAX, WORKFLOWS_MAX,
} from './home-lists.mjs';
import { createRunTile } from './home-run-tile.mjs';
import { createHeroFlip } from './home-flip.mjs';
import { createHomePresets } from './home-presets.mjs';
import { INTENTS } from './intent.mjs';
import { featureHeadline } from '../shape/feature-view.mjs';

export const RUNS_TICK_MS = 1000;        // elapsed time and states move between frames: re-read once a second
export const RUNS_COALESCE_MS = 250;     // update() after a run frame: one re-read per burst
export const FOLLOW_SCAN_MAX = 8;        // chat snapshots findFollowingThread may read per click
export const RUN_TILES_MAX = 6;          // run tiles per tab (each owns a graph mount); the rest: "N more" → Runs
/** Boot: how long the default tab waits for the run models (app.js `ready`: the socket's hello + History answered)
 *  before an empty Needs you / Running counts as an answer. */
export const RUNS_WAIT_MS = 4000;
/** The built-in workflow's name (src/core/graph/builtin-workflows.mjs MEMORY_DEFRAG_WORKFLOW_NAME). */
export const MEMORY_DEFRAG_NAME = 'Memory defragment';

/** "More you can do": real features only. `min` = the interface mode of the feature's own page. */
export const PROMOS = Object.freeze([
  Object.freeze({ id: 'workflows', title: 'Workflows', text: 'Describe a pipeline, get the graph', button: 'Build workflow', intent: 'workflow', min: 'simple',
    prefill: () => 'Build a workflow that plans, implements, runs the tests and reviews' }),
  Object.freeze({ id: 'away', title: 'Away mode', text: 'Let runs keep going while you’re out', button: 'Step away', intent: 'away', min: 'simple',
    prefill: () => INTENTS.away.prefill }),     // an empty composer never sends: Step away arrives with its text
  Object.freeze({ id: 'schedules', title: 'Schedules', text: 'Tidy project memory every night', button: 'Schedule a run', intent: 'schedule', min: 'advanced',
    prefill: (project) => (project ? `Run ${MEMORY_DEFRAG_NAME} on ${project} every night at 02:00` : `Run ${MEMORY_DEFRAG_NAME} every night at 02:00`) }),
]);

/** The run ref chatDeps.openRunPanel / threadForRun take: only the ids the snapshot really has. */
export function runRef(snap) {
  const ref = {};
  for (const k of ['runId', 'pipelineId', 'projectKey', 'workspaceId']) if (snap && snap[k]) ref[k] = snap[k];
  return ref;
}
/** The Q&A tab key of the page the run opens on: the live run page says 'qa' (RD_TABS), History 'clarify' (HD_TABS). */
export function answerTab(snap) {
  return snap && snap.source === 'live' ? 'qa' : 'clarify';
}

/** The chat that follows a run: GET /api/ask/threads, then the snapshots (their runLinks) of the chats that link a
 *  run — those whose followed run waits on you or is live first — reading at most `max`. null when none matches. */
export async function findFollowingThread(fetchFn, ref, { max = FOLLOW_SCAN_MAX } = {}) {
  const runId = ref && ref.runId;
  const pipelineId = ref && ref.pipelineId;
  if (!runId && !pipelineId) return null;
  let threads = [];
  try {
    const res = await fetchFn('/api/ask/threads?limit=50');
    if (!res || !res.ok) return null;
    const body = await res.json();
    threads = Array.isArray(body && body.threads) ? body.threads : [];
  } catch { return null; }
  const rank = (t) => (t.waiting ? 2 : t.tracking ? 1 : 0);
  const candidates = threads
    .filter((t) => t && typeof t.id === 'string' && Number(t.runLinks) > 0)
    .sort((a, b) => rank(b) - rank(a))          // stable: newest-updated first within a rank (the list's own order)
    .slice(0, Math.max(0, max));
  for (const t of candidates) {
    try {
      const res = await fetchFn(`/api/ask/threads/${encodeURIComponent(t.id)}`);
      if (!res || !res.ok) continue;
      const body = await res.json();
      const links = Array.isArray(body && body.runLinks) ? body.runLinks : [];
      if (links.some((l) => l && ((runId && l.runId === runId) || (pipelineId && l.pipelineId === pipelineId)))) return t.id;
    } catch { /* the next chat */ }
  }
  return null;
}

const EMPTY_RUNS = Object.freeze({ needs: [], running: [], finished: [], project: '', ready: true });
function normRuns(r) {
  const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
  return { needs: arr(r && r.needs), running: arr(r && r.running), finished: arr(r && r.finished), project: r && typeof r.project === 'string' ? r.project : '',
    ready: !(r && r.ready === false) };    // false = not known yet (boot): no run models before the socket's hello
}
const validThreads = (list) => (Array.isArray(list) ? list.filter((t) => t && typeof t.id === 'string') : []);
const validWorkflows = (list) => (Array.isArray(list) ? list.filter((w) => w && typeof w.id === 'string') : []);

/**
 * @param {{ doc: Document, host: HTMLElement, heroSlot?: HTMLElement|null, deps: object, runsWaitMs?: number,
 *   timers?: { setInterval, clearInterval, setTimeout, clearTimeout } }} o
 * @returns {{ update(data?): void, armFlip(): boolean, destroy(): void }}
 */
export function createChatHome({ doc, host, heroSlot = null, deps, runsWaitMs = RUNS_WAIT_MS, timers = null }) {
  const win = doc.defaultView || globalThis;
  // The visit's clock (tick, coalesce, boot wait). app.js passes unref'd timers: under node:test a jsdom window's own
  // interval keeps the test process alive for ever (app.js _timerTick has the same guard).
  const clock = timers && typeof timers.setInterval === 'function' ? timers : win;
  const page = host.closest('[data-chat-page]');
  const section = host.closest('section[data-view="chat"]');
  const h = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const st = {
    visiting: false, visit: 0, tab: null, chosen: false, runs: EMPTY_RUNS, threads: null, workflows: null, portsFn: null, plans: null, plansOpen: new Set(), presets: null,
    tiles: new Map(), tilesTab: null, panelSig: '', tick: null, pending: null, routing: false, runsWait: null, runsWaited: false,
  };

  // ---- the hero, around P1's slot -------------------------------------------------------------------------
  const title = h('h1', 'chat-home-title', 'What should worca do?');
  host.insertBefore(title, heroSlot && heroSlot.parentNode === host ? heroSlot : host.firstChild);

  const actions = createQuickActions({ doc, deps, getRuns: pickRuns });
  const tabs = createHomeTabs({ doc, onSelect: (t) => selectTab(t, { user: true }) });
  const promos = buildPromos();
  const body = h('div', 'chat-home-body');
  // Settings › Presets is Advanced (docs/ui-levels.md): Simple's "N more…" opens New run's picker, which lists all.
  const presetsUi = createHomePresets({
    doc, onUse: (id) => { if (typeof deps.usePreset === 'function') deps.usePreset(id); },
    onMore: () => deps.navigate((typeof deps.level === 'function' ? deps.level() : 'expert') === 'simple' ? '#new' : '#settings/presets'),
  });
  body.append(actions.el, presetsUi.el, tabs.el, promos);
  host.appendChild(body);
  const flip = createHeroFlip({ doc, win, page, parts: () => [title, actions.el, presetsUi.el, tabs.el, promos] });
  // The More menu and the run pickers are position:fixed: a scroll of the home (its own scroll box) would leave them
  // floating away from their tile.
  const onHomeScroll = () => actions.closeMenu();
  host.addEventListener('scroll', onHomeScroll, { passive: true });

  function buildPromos() {
    const sec = h('section', 'chat-home-promos');
    const hd = h('h2', 'section-title chat-home-promos-h', 'More you can do');
    hd.id = 'chat-home-promos-h';
    sec.setAttribute('aria-labelledby', hd.id);
    const row = h('div', 'chat-home-promo-row');
    for (const p of PROMOS) {
      const card = h('div', 'chat-home-promo');
      card.dataset.promo = p.id;
      card.dataset.minLevel = p.min;
      const b = h('button', 'btn btn-sm chat-home-promo-b', p.button);
      b.type = 'button';
      b.addEventListener('click', () => {
        deps.setIntent(p.intent);
        const text = p.prefill(st.runs.project);
        if (text) deps.prefill(text);
        revealComposer();
      });
      card.append(h('span', 'chat-home-promo-t', p.title), h('span', 'chat-home-promo-d', p.text), b);
      row.appendChild(card);
    }
    sec.append(hd, row);
    return sec;
  }
  function allWorkflowsLink() {
    const b = h('button', 'chat-home-more-link', 'All workflows');
    b.type = 'button';
    b.addEventListener('click', () => deps.navigate('#workflows'));
    return b;
  }
  function runWorkflow(w) {
    deps.setIntent('run');
    deps.prefill(runWorkflowText(w.name || w.id, st.runs.project));
    revealComposer();
  }
  /** The promos and the workflow cards sit below the fold on a phone, and the prefill's focus never scrolls
   *  (preventScroll): bring the composer they just filled back into the home's own scroll box (P1's
   *  .chat-home{overflow-y:auto}), 16px under its top. */
  function revealComposer() {
    if (!heroSlot || !host.contains(heroSlot)) return;
    const hr = host.getBoundingClientRect();
    const sr = heroSlot.getBoundingClientRect();
    if (sr.top < hr.top || sr.bottom > hr.bottom) host.scrollTop += sr.top - hr.top - 16;
  }
  /** The run pickers' lists (Track a run: live runs; Explain a diff: finished ones). */
  function pickRuns() {
    if (st.visiting) pullRuns();
    return { live: [...st.runs.needs, ...st.runs.running].filter((s) => s.source === 'live' && s.live), finished: st.runs.finished };
  }

  // ---- session pick ------------------------------------------------------------------------------------------
  function readTab() {
    try {
      const v = win.sessionStorage.getItem(HOME_TAB_KEY);
      return HOME_TABS.includes(v) ? v : null;
    } catch { return null; }
  }
  function writeTab(t) { try { win.sessionStorage.setItem(HOME_TAB_KEY, t); } catch { /* storage off: the pick lasts this visit */ } }

  // ---- the panel -----------------------------------------------------------------------------------------------
  function clearTiles() {
    for (const tile of st.tiles.values()) { tile.destroy(); tile.el.remove(); }
    st.tiles.clear();
    st.tilesTab = null;
  }
  function busy() {
    clearTiles();
    st.panelSig = '';
    tabs.panel.replaceChildren();
    tabs.panel.setAttribute('aria-busy', 'true');
  }
  function renderPanel() {
    const t = st.tab;
    if (!t) { busy(); return; }
    if (t === 'needs' || t === 'running') { renderRuns(t); return; }
    clearTiles();
    if (t === 'chats') {
      if (st.threads == null) { busy(); return; }
      const sig = `chats|${st.threads.map((x) => [x.id, x.updatedAt, x.title, x.inFlight ? 1 : 0, x.waiting ? 1 : 0, x.tracking ? 1 : 0].join(':')).join(',')}`;
      if (sig === st.panelSig) return;
      st.panelSig = sig;
      tabs.panel.removeAttribute('aria-busy');
      tabs.panel.replaceChildren(st.threads.length
        ? buildChatsList(doc, st.threads, { onOpen: (id) => deps.openThread(id) })
        : emptyState(doc, HOME_TAB_EMPTY.chats));
      return;
    }
    if (t === 'plans') {
      if (st.plans == null) { busy(); return; }
      // The feature part is its headline, so a halt (status and done unchanged) still changes the signature.
      const sig = `plans|${st.plans.map((p) => [p.threadId, p.cardId, p.state, p.title, p.feature ? `${p.feature.id}:${featureHeadline(p.feature)}` : ''].join(':')).join(',')}`;
      if (sig === st.panelSig) return;
      st.panelSig = sig;
      tabs.panel.removeAttribute('aria-busy');
      tabs.panel.replaceChildren(st.plans.length
        ? buildPlansList(doc, st.plans, { onOpen: (id) => deps.openThread(id), mountFeature: deps.mountFeature, open: st.plansOpen })
        : emptyState(doc, HOME_TAB_EMPTY.plans));
      return;
    }
    if (st.workflows == null) { busy(); return; }
    const list = st.workflows.slice(0, WORKFLOWS_MAX);
    const sig = `wf|${st.runs.project}|${st.portsFn ? 1 : 0}|${st.workflows.length}|${list.map((w) => `${w.id}:${w.updatedAt || ''}`).join(',')}`;
    if (sig === st.panelSig) return;
    st.panelSig = sig;
    tabs.panel.removeAttribute('aria-busy');
    if (!list.length) { tabs.panel.replaceChildren(emptyState(doc, HOME_TAB_EMPTY.workflows)); return; }
    const nodes = [buildWorkflowsGrid(doc, list, st.portsFn, { onRun: runWorkflow })];
    if (st.workflows.length > WORKFLOWS_MAX) nodes.push(allWorkflowsLink());
    tabs.panel.replaceChildren(...nodes);
  }
  function renderRuns(t) {
    const items = t === 'needs' ? st.runs.needs : st.runs.running;
    if (st.tilesTab !== t) { clearTiles(); st.panelSig = ''; }
    st.tilesTab = t;
    tabs.panel.removeAttribute('aria-busy');
    if (!items.length) {
      clearTiles();
      st.tilesTab = t;
      const sig = `empty|${t}`;
      if (st.panelSig !== sig) { st.panelSig = sig; tabs.panel.replaceChildren(emptyState(doc, HOME_TAB_EMPTY[t])); }
      return;
    }
    let grid = tabs.panel.querySelector(':scope > .chat-home-runs');
    if (!grid || st.panelSig !== `runs|${t}`) {
      grid = h('div', 'chat-home-runs');
      tabs.panel.replaceChildren(grid);
      st.panelSig = `runs|${t}`;
    }
    reconcile(grid, items.slice(0, RUN_TILES_MAX));
    syncMoreRuns(items.length - RUN_TILES_MAX);
  }
  /** "N more" under a capped run grid: the rest are on the Runs page. */
  function syncMoreRuns(extra) {
    let link = tabs.panel.querySelector(':scope > .chat-home-more-link');
    if (extra <= 0) { if (link) link.remove(); return; }
    if (!link) {
      link = h('button', 'chat-home-more-link');
      link.type = 'button';
      link.addEventListener('click', () => deps.navigate('#runs'));
      tabs.panel.appendChild(link);
    }
    const text = `${extra} more`;
    if (link.textContent !== text) link.textContent = text;
  }
  /** Keyed, in-place: an existing tile repaints (its graph mount kept), a new one is built, a gone one destroyed. */
  function reconcile(grid, items) {
    const keep = new Set();
    const fresh = [];
    let prev = null;
    for (const s of items) {
      const key = String(s.key || s.runId || s.pipelineId || '');
      if (!key || keep.has(key)) continue;
      keep.add(key);
      let tile = st.tiles.get(key);
      if (tile) tile.update(s);
      else {
        tile = createRunTile({ doc, snap: s, onOpen: (cur) => route(cur, 'workflow', key), onAnswer: (cur) => route(cur, answerTab(cur), key, { follow: true }) });
        st.tiles.set(key, tile);
        fresh.push(tile);
      }
      const want = prev ? prev.el.nextSibling : grid.firstChild;
      if (want !== tile.el) grid.insertBefore(tile.el, want);
      prev = tile;
    }
    for (const [key, tile] of st.tiles) {
      if (keep.has(key)) continue;
      tile.destroy();
      tile.el.remove();
      st.tiles.delete(key);
    }
    for (const tile of fresh) tile.fit();     // built detached at 0×0: frame the graph now that it has a box
  }

  /** Answer (`follow`): the chat that follows the run when there is one, else the run itself on `tab`. The title: the
   *  run itself on its Workflow tab, no lookup — a run proposed from a chat is always followed by it, so a lookup there
   *  would make the run's graph unreachable from its tile (and cost a list + up to FOLLOW_SCAN_MAX snapshots). */
  async function route(snap, tab, key, { follow = false } = {}) {
    if (st.routing === st.visit) return;         // one route per visit at a time (a double click, a slow lookup)
    const token = st.visit;
    st.routing = token;
    const tile = st.tiles.get(key);
    if (tile) tile.setBusy(true);
    try {
      const ref = runRef(snap);
      let threadId = null;
      if (follow) {
        try { threadId = typeof deps.threadForRun === 'function' ? await deps.threadForRun(ref) : null; } catch { threadId = null; }
      }
      if (token !== st.visit) return;            // the home was left during the lookup (another chat, another page): no late jump
      if (threadId) deps.openThread(threadId);
      else deps.openRunPanel(ref, { tab });
    } finally {
      if (st.routing === token) st.routing = false;
      if (tile) tile.setBusy(false);
    }
  }

  // ---- data ------------------------------------------------------------------------------------------------------
  function maybeChoose() {
    if (st.chosen) return;
    const counts = { needs: st.runs.needs.length, running: st.runs.running.length, chats: st.threads ? st.threads.length : null };
    // Boot: until the runs are known (or runsWaitMs passed) only a run that already needs you decides — the chat list
    // answering first must not settle the visit on Recent chats while a waiting run is still on its way.
    const t = st.runs.ready || st.runsWaited ? defaultTab(counts) : (counts.needs > 0 ? 'needs' : null);
    if (!t) return;
    st.chosen = true;
    st.tab = t;
    tabs.select(t);
  }
  function applyRuns(r) {
    st.runs = r;
    tabs.setNeeds(r.needs.length);
    maybeChoose();
    if (st.chosen) renderPanel(); else busy();
  }
  function pullRuns() {
    let got = EMPTY_RUNS;
    try { got = normRuns(deps.runs()); } catch { got = EMPTY_RUNS; }
    applyRuns(got);
  }
  function selectTab(t, { user = false } = {}) {
    if (!HOME_TABS.includes(t)) return;
    if (user) writeTab(t);
    st.chosen = true;
    st.tab = t;
    tabs.select(t);
    renderPanel();
  }
  async function loadThreads(token) {
    let list = [];
    try { list = validThreads(await deps.threads()); } catch { list = []; }
    if (token !== st.visit) return;
    st.threads = list.slice(0, RECENT_CHATS_MAX);
    maybeChoose();
    if (st.chosen) renderPanel();
  }
  async function loadWorkflows(token) {
    let got = null;
    try { got = await deps.workflows(); } catch { got = null; }
    if (token !== st.visit) return;
    st.workflows = validWorkflows(got && got.list);
    st.portsFn = got && typeof got.portsFn === 'function' ? got.portsFn : null;
    actions.setPins({ workflows: st.workflows });
    if (st.tab === 'workflows') renderPanel();
  }
  // The person's pinned workflows (src/shared/home-pins.mjs), fresh per visit; the row shows the visible ones.
  async function loadPins(token) {
    let got = null;
    try { got = typeof deps.pins === 'function' ? await deps.pins() : null; } catch { got = null; }
    if (token !== st.visit) return;
    if (Array.isArray(got)) actions.setPins({ pins: got });   // null = keep the row's default (Shaper)
  }
  async function loadPlans(token) {
    let list = [];
    try { list = typeof deps.plans === 'function' ? await deps.plans() : []; } catch { list = []; }
    if (token !== st.visit) return;
    st.plans = Array.isArray(list) ? list.slice(0, 30) : [];
    if (st.tab === 'plans') renderPanel();
  }
  // Run presets (#712 slice 2): the viewer's presets as chips, fresh per visit.
  function paintPresets() { presetsUi.render({ presets: st.presets?.presets || [], target: st.presets?.target || null, workflowNames: st.presets?.workflowNames ?? null }); }
  async function loadPresets(token) {
    let got = null;
    try { got = typeof deps.presets === 'function' ? await deps.presets() : null; } catch { got = null; }
    if (token !== st.visit) return;
    st.presets = got && Array.isArray(got.presets) ? got : { presets: [], target: null };
    paintPresets();
  }
  async function loadFlags(token) {
    let got = null;
    try { got = typeof deps.flags === 'function' ? await deps.flags() : null; } catch { got = null; }
    if (token !== st.visit || !got) return;
    actions.setFlags(got);
  }

  // ---- visits ----------------------------------------------------------------------------------------------------
  function visible() {
    if (page && page.dataset.view !== 'home') return false;
    if (section && (section.hidden || section.classList.contains('hidden'))) return false;
    return true;
  }
  function visit() {
    st.visiting = true;
    const token = ++st.visit;
    st.threads = null;
    st.workflows = null;
    st.plans = null;
    st.presets = null;
    st.panelSig = '';
    const stored = readTab();
    st.chosen = !!stored;
    st.runsWaited = false;
    st.runsWait = clock.setTimeout(() => {
      st.runsWait = null;
      st.runsWaited = true;
      if (!st.visiting || st.chosen) return;
      maybeChoose();
      if (st.chosen) renderPanel();
    }, runsWaitMs);
    st.tab = stored;
    tabs.select(stored);
    pullRuns();                                 // the switches keep their last known values until loadFlags answers
    void loadThreads(token);
    void loadWorkflows(token);
    void loadPins(token);
    void loadPresets(token);
    void loadFlags(token);
    void loadPlans(token);
    st.tick = clock.setInterval(() => { if (!visible()) { leave(); return; } pullRuns(); }, RUNS_TICK_MS);
  }
  function leave() {
    st.visiting = false;
    st.visit += 1;
    if (st.tick != null) { clock.clearInterval(st.tick); st.tick = null; }
    if (st.pending != null) { clock.clearTimeout(st.pending); st.pending = null; }
    if (st.runsWait != null) { clock.clearTimeout(st.runsWait); st.runsWait = null; }
    clearTiles();
    st.panelSig = '';
    tabs.panel.replaceChildren();
    actions.closeMenu();
  }
  function sync() {
    const v = visible();
    if (v && !st.visiting) visit();
    else if (!v && st.visiting) leave();
  }
  const mo = typeof win.MutationObserver === 'function' ? new win.MutationObserver(sync) : null;
  if (mo && page) mo.observe(page, { attributes: true, attributeFilter: ['data-view'] });
  if (mo && section) mo.observe(section, { attributes: true, attributeFilter: ['class', 'hidden'] });
  sync();

  /** update(): something about the runs changed (a run frame) — re-read them, coalesced. update(data): apply now. */
  function update(data) {
    if (data && typeof data === 'object') {
      if (data.flags) actions.setFlags(data.flags);
      if (!st.visiting) return;                 // a hidden home mounts nothing; the next visit re-reads everything
      if (Array.isArray(data.threads)) st.threads = validThreads(data.threads).slice(0, RECENT_CHATS_MAX);
      if (data.workflows && Array.isArray(data.workflows.list)) {
        st.workflows = validWorkflows(data.workflows.list);
        st.portsFn = typeof data.workflows.portsFn === 'function' ? data.workflows.portsFn : null;
        actions.setPins({ workflows: st.workflows });
      }
      if (data.runs) applyRuns(normRuns(data.runs));
      else { maybeChoose(); if (st.chosen) renderPanel(); }
      return;
    }
    if (!st.visiting || st.pending != null) return;
    st.pending = clock.setTimeout(() => { st.pending = null; if (st.visiting) pullRuns(); }, RUNS_COALESCE_MS);
  }

  return {
    update,
    /** A shape-feature / schedules-changed frame: re-read the Plans tab's rows. */
    refreshPlans() { if (st.visiting) void loadPlans(st.visit); },
    /** The intent add-on's transformSend (every Ask send): a send from the home arms the hero → dock glide. */
    armFlip() { return !!page && page.dataset.view === 'home' && flip.arm(); },
    destroy() {
      if (mo) mo.disconnect();
      host.removeEventListener('scroll', onHomeScroll);
      leave();
      flip.destroy();
      actions.destroy();
      tabs.destroy();
      title.remove();
      body.remove();
    },
  };
}
