// ui/public/chat/home-actions.mjs — the Chat home's quick actions (worca Chat P6): six intent tiles, one pinned workflow,
// Add project and More, in the mockup's order. An intent tile only ARMS the composer (deps.setIntent: the intent chip and
// its placeholder); nothing is sent until the user sends. Add project opens the Add project dialog (deps.addProject). Track a run / Explain a diff also open a run picker (Live / Finished) whose pick prefills a
// mention of that run. Every action is a real Ask Worca capability (src/core/ask/tools.mjs):
//   run propose_run · pinned workflow propose_run (workflowId); Shaper pin propose_run (shape) · workflow propose_workflow · schedule preview_schedule + propose_run · track list_runs + track_run
//   diff get_run + get_run_diff · script draft_script (+ save_script / test_script) · project the Add project dialog (New · Folder · Clone from URL; chat: propose_project_change / propose_clone_project) · away set_away_now
//   metrics get_team_metrics · model list_models + propose_model_change · workspace propose_workspace_change
//   remember remember · tasks list_task_sources + find_tasks
import { toggleMenu } from '../workflows/menu.mjs';
import { levelShows } from '../ui-level.mjs';
import { INTENTS } from './intent.mjs';
import { homeIcon } from './home-icons.mjs';
import { DEFAULT_HOME_PINS, visiblePins, splitPins, unpinWorkflow } from '../../../src/shared/home-pins.mjs';

// Shaper is no longer a built-in tile: it is the default PIN (src/shared/home-pins.mjs).
export const TILE_INTENTS = Object.freeze(['run', 'workflow', 'schedule', 'track', 'diff', 'script']);
/** Tiles that do something other than arm an intent: Add project opens the dialog on New (deps.addProject). */
export const TILE_ACTIONS = Object.freeze(['project']);
export const PROJECT_TILE = Object.freeze({ label: 'Add project', icon: 'project' });
export const MORE_INTENTS = Object.freeze(['away', 'metrics', 'model', 'workspace', 'remember', 'tasks']);
/** The interface mode each action belongs to: the level of the page or surface that owns the feature
 *  (app.js VIEW_MIN_LEVEL / SETTINGS_TAB_MIN_LEVEL, docs/ui-levels.md). */
export const ACTION_LEVEL = Object.freeze({
  run: 'simple', shape: 'simple', workflow: 'simple', schedule: 'advanced', track: 'simple', diff: 'advanced', script: 'simple', project: 'simple',
  away: 'simple', metrics: 'expert', model: 'expert', workspace: 'advanced', remember: 'advanced', tasks: 'advanced', more: 'simple',
});
/** Actions a server-side switch can take away: action → key of the flags the home loads (deps.flags). */
export const ACTION_FLAG = Object.freeze({ script: 'scripts', tasks: 'tasks', shape: 'shapeFirst' });
/** Actions that need git: their tiles carry data-needs-git, hidden while git is missing (git-gate.mjs). */
export const ACTION_NEEDS_GIT = Object.freeze(['diff']);
/** Before the flags load: script tools on (the setting's default), task sources unknown = none, Shape it first off
 *  until a hello turns it on. */
export const DEFAULT_FLAGS = Object.freeze({ scripts: true, tasks: false, shapeFirst: false });
export const PICKER_MAX = 8;
const PICKERS = Object.freeze({
  track: Object.freeze({ header: 'Live', empty: 'Nothing running', list: 'live' }),
  diff: Object.freeze({ header: 'Finished', empty: 'No finished runs', list: 'finished' }),
});

export function actionAvailable(id, flags = {}) {
  const key = ACTION_FLAG[id];
  if (!key) return true;
  return { ...DEFAULT_FLAGS, ...(flags || {}) }[key] === true;
}
export function moreItems({ level = 'expert', flags = {} } = {}) {
  return MORE_INTENTS.filter((id) => levelShows(level, ACTION_LEVEL[id]) && actionAvailable(id, flags));
}
/** The prefill a picked run leaves in the composer: “<title>” (#<pipeline or run id>). */
export function runMention(r) {
  const title = String((r && r.title) || '').trim() || 'Run';
  const id = (r && (r.pipelineId || r.runId)) || '';
  return id ? `“${title}” (#${id})` : `“${title}”`;
}

export function createQuickActions({ doc, deps, getRuns = () => ({ live: [], finished: [] }) }) {
  const el = doc.createElement('div');
  el.className = 'chat-home-actions';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Quick actions');
  const tiles = new Map();
  let flags = { ...DEFAULT_FLAGS };
  let menu = null;
  let pins = [...DEFAULT_HOME_PINS];
  let workflows = null;           // GET /api/workflows rows; null = not loaded (only Shaper can show)
  let pinEls = [];

  function tile(id, label, icon, badge) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-lg chat-home-act';
    b.dataset.minLevel = ACTION_LEVEL[id] || 'simple';
    if (ACTION_NEEDS_GIT.includes(id)) b.dataset.needsGit = '';
    b.appendChild(homeIcon(doc, icon, 20));
    const l = doc.createElement('span');
    l.className = 'chat-home-act-l';
    l.textContent = label;
    b.appendChild(l);
    if (badge) { const s = doc.createElement('span'); s.className = 'chat-home-act-badge'; s.textContent = badge; b.appendChild(s); }
    return b;
  }
  /** Arm intent `id`; an intent that cannot go out empty (Step away) also leaves its text in the composer. */
  function arm(id) {
    deps.setIntent(id);
    if (INTENTS[id].prefill) deps.prefill(INTENTS[id].prefill);
  }
  function openPicker(id, anchor) {
    const p = PICKERS[id];
    const runs = getRuns() || {};
    const list = Array.isArray(runs[p.list]) ? runs[p.list].filter(Boolean).slice(0, PICKER_MAX) : [];
    const items = [{ header: p.header }];
    if (!list.length) items.push({ label: p.empty, disabled: true });
    for (const r of list) items.push({ label: String(r.title || 'Run'), hint: String(r.project || ''), onSelect: () => deps.prefill(runMention(r)) });
    menu = toggleMenu({ doc, anchor, items, label: INTENTS[id].label });
  }

  function current() { return splitPins(visiblePins({ pins, workflows, flags })); }

  function armPin(p) {
    if (p.shaper) { arm('shape'); return; }
    deps.setIntent('run', { workflow: { id: p.id, name: p.name } });
  }
  /** Opens, never toggles, when this tile's menu is already up: in Chromium on Windows and Linux, Shift+F10 and the
   *  ContextMenu key fire a keydown AND a contextmenu event, and a toggle would close the menu the keydown opened. */
  function openPinMenu(p, b) {
    if (menu && menu.anchor === b && menu.el.isConnected) return;
    menu = toggleMenu({ doc, anchor: b, label: 'Pinned workflow', items: [{ label: 'Unpin', onSelect: () => void unpin(p.id) }] });
  }
  /** Unpin at once (the next pin moves in), then save; a failed save restores the list. Focus is handled by
   *  renderPins: menu.mjs has just handed it back to the tile being removed. */
  async function unpin(id) {
    const before = pins;
    pins = unpinWorkflow(pins, id);
    renderPins();
    let saved = null;
    try { saved = typeof deps.savePins === 'function' ? await deps.savePins(pins) : null; } catch { saved = null; }
    if (!Array.isArray(saved)) { pins = before; renderPins(); }
  }
  function pinTile(p) {
    const b = p.shaper
      ? tile('shape', INTENTS.shape.label, INTENTS.shape.icon, INTENTS.shape.badge)
      : tile('pin', p.name, 'workflow');
    if (p.shaper) b.dataset.intent = 'shape';
    b.dataset.pin = p.id;
    b.dataset.minLevel = 'simple';
    b.classList.add('is-pin');
    b.title = p.name;
    b.setAttribute('aria-haspopup', 'menu');   // its context menu; menu.mjs sets aria-expanded on the anchor
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', () => armPin(p));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); openPinMenu(p, b); });
    b.addEventListener('keydown', (e) => {
      if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); openPinMenu(p, b); }
    });
    return b;
  }
  /** Rebuild the pin tiles (pins, workflows or flags changed). A pin menu is closed first, never orphaned; closeMenu
   *  hands a focus inside it back to its tile. A focus on a pin tile then survives the rebuild: the same pin if it is
   *  still inline, else the pin that took the slot, else More — never body (unpin, a failed save, a flag push). */
  function renderPins() {
    if (menu && pinEls.includes(menu.anchor)) closeMenu();
    const focused = pinEls.find((b) => b === doc.activeElement) || null;
    const focusId = focused ? focused.dataset.pin : null;
    for (const b of pinEls) b.remove();
    pinEls = current().inline.map(pinTile);
    // Priority order: New run, then the pins, then the other built-ins (the tail is what overflows into More first).
    const after = tiles.get('run');
    for (const b of pinEls) el.insertBefore(b, after ? after.nextSibling : more);
    if (focused) (pinEls.find((b) => b.dataset.pin === focusId) || pinEls[0] || more).focus({ preventScroll: true });
    fit();
  }

  /** One row, never wrapped (priority+): while the row overflows, the last visible built-in tile (never New run, a
   *  pin or More) moves into More. A narrow home (the 2-column phone grid, ≤ 640px) shows every tile as before. */
  const overflowIds = [];
  function fit() {
    overflowIds.length = 0;
    for (const b of tiles.values()) delete b.dataset.overflow;
    if (!el.isConnected || !el.clientWidth || el.clientWidth <= 640) return;
    const order = [...TILE_INTENTS.filter((id) => id !== 'run'), ...TILE_ACTIONS].reverse();
    for (const id of order) {
      if (el.scrollWidth <= el.clientWidth) break;
      const b = tiles.get(id);
      if (!b || b.hidden || !b.offsetParent) continue;
      b.dataset.overflow = '';
      overflowIds.unshift(id);
    }
  }

  for (const id of TILE_INTENTS) {
    const b = tile(id, INTENTS[id].label, INTENTS[id].icon, INTENTS[id].badge);
    b.dataset.intent = id;
    if (PICKERS[id]) {
      b.setAttribute('aria-haspopup', 'menu');
      b.setAttribute('aria-expanded', 'false');
      // No focus move: the picker takes focus next, and a focus jump to the composer would close it.
      b.addEventListener('click', () => { deps.setIntent(id, { focus: false }); openPicker(id, b); });
    } else {
      b.addEventListener('click', () => arm(id));
    }
    tiles.set(id, b);
    el.appendChild(b);
  }
  for (const id of TILE_ACTIONS) {
    const b = tile(id, PROJECT_TILE.label, PROJECT_TILE.icon);
    b.dataset.action = id;
    b.addEventListener('click', () => { if (deps.addProject) deps.addProject(); });
    tiles.set(id, b);
    el.appendChild(b);
  }
  const more = tile('more', 'More', 'more');
  more.dataset.action = 'more';
  more.classList.add('is-more');
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  more.addEventListener('click', () => {
    const level = typeof deps.level === 'function' ? deps.level() : 'expert';
    const items = [
      // Tiles that did not fit the row come first, in row order; a picker tile keeps its picker.
      ...overflowIds.map((id) => (TILE_ACTIONS.includes(id)
        ? { label: PROJECT_TILE.label, onSelect: () => { if (deps.addProject) deps.addProject(); } }
        : { label: INTENTS[id].label, onSelect: () => (PICKERS[id] ? (deps.setIntent(id, { focus: false }), openPicker(id, more)) : arm(id)) })),
      ...moreItems({ level, flags }).map((id) => ({ label: INTENTS[id].label, onSelect: () => arm(id) })),
    ];
    const { overflow } = current();
    if (overflow.length) {
      items.push({ header: 'Pinned' });
      for (const p of overflow) items.push({ label: p.name, onSelect: () => armPin(p) });
    }
    menu = toggleMenu({ doc, anchor: more, items, label: 'More actions' });
  });
  el.appendChild(more);

  /** Close the picker or More menu THIS row opened (never someone else's menu). A focus inside it goes back to its
   *  tile — never to <body>: a scroll of the home closes the menu under the user's keyboard. */
  function closeMenu() {
    const m = menu;
    menu = null;
    if (!m || !m.el.isConnected) return;
    const had = m.el.contains(doc.activeElement);
    m.close();
    if (had && m.anchor.isConnected) m.anchor.focus({ preventScroll: true });
  }
  // A picker with no runs holds only a disabled row, so the focus stays on its tile and the menu's own Escape
  // (menu.mjs listens on the menu) never sees the key: the row closes it.
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !menu || !menu.el.isConnected) return;
    e.preventDefault();
    e.stopPropagation();
    closeMenu();
  });
  function setFlags(next) {
    flags = { ...DEFAULT_FLAGS, ...(next || {}) };
    for (const [id, b] of tiles) b.hidden = !actionAvailable(id, flags);
    renderPins();
  }
  /** The person's pins and the workflow list (Chat home visit). Either may be omitted to keep what is known. */
  function setPins(next = {}) {
    if (Array.isArray(next.pins)) pins = [...next.pins];
    if (Array.isArray(next.workflows)) workflows = next.workflows;
    renderPins();
  }
  setFlags({});
  // Re-fit when the row's width changes (window, pane, sidebar); a browser without ResizeObserver keeps the row as is.
  const view = doc.defaultView;
  const ro = view && typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(() => fit()) : null;
  if (ro) ro.observe(el);
  return {
    el,
    setFlags,
    setPins,
    closeMenu,
    fit,
    destroy() { closeMenu(); if (ro) ro.disconnect(); el.remove(); },
  };
}
