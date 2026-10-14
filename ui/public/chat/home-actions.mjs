// ui/public/chat/home-actions.mjs — the Chat home's quick actions (worca Chat P6): eight intent tiles and More, in the
// mockup's order. A tile only ARMS the composer (deps.setIntent: the intent chip and its placeholder); nothing is sent
// until the user sends. Track a run / Explain a diff also open a run picker (Live / Finished) whose pick prefills a
// mention of that run. Every action is a real Ask Worca capability (src/core/ask/tools.mjs):
//   run propose_run · shape propose_run (Shape it first) · workflow propose_workflow · schedule preview_schedule + propose_run · track list_runs + track_run
//   diff get_run + get_run_diff · script save_script + test_script · clone propose_clone_project · away set_away_now
//   metrics get_team_metrics · model list_models + propose_model_change · workspace propose_workspace_change
//   remember remember · tasks list_task_sources + find_tasks
import { toggleMenu } from '../workflows/menu.mjs';
import { levelShows } from '../ui-level.mjs';
import { INTENTS } from './intent.mjs';
import { homeIcon } from './home-icons.mjs';

export const TILE_INTENTS = Object.freeze(['run', 'shape', 'workflow', 'schedule', 'track', 'diff', 'script', 'clone']);
export const MORE_INTENTS = Object.freeze(['away', 'metrics', 'model', 'workspace', 'remember', 'tasks']);
/** The interface mode each action belongs to: the level of the page or surface that owns the feature
 *  (app.js VIEW_MIN_LEVEL / SETTINGS_TAB_MIN_LEVEL, docs/ui-levels.md). */
export const ACTION_LEVEL = Object.freeze({
  run: 'simple', shape: 'simple', workflow: 'simple', schedule: 'advanced', track: 'simple', diff: 'advanced', script: 'simple', clone: 'simple',
  away: 'simple', metrics: 'expert', model: 'expert', workspace: 'advanced', remember: 'advanced', tasks: 'advanced', more: 'simple',
});
/** Actions a server-side switch can take away: action → key of the flags the home loads (deps.flags). */
export const ACTION_FLAG = Object.freeze({ script: 'scripts', tasks: 'tasks', shape: 'shapeFirst' });
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

  function tile(id, label, icon, help, badge) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'chat-home-act';
    b.dataset.minLevel = ACTION_LEVEL[id] || 'simple';
    b.appendChild(homeIcon(doc, icon, 20));
    const l = doc.createElement('span');
    l.className = 'chat-home-act-l';
    l.textContent = label;
    b.appendChild(l);
    if (help) { const s = doc.createElement('span'); s.className = 'chat-home-act-help'; s.textContent = help; b.appendChild(s); }
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

  for (const id of TILE_INTENTS) {
    const b = tile(id, INTENTS[id].label, INTENTS[id].icon, INTENTS[id].help, INTENTS[id].badge);
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
  const more = tile('more', 'More', 'more');
  more.dataset.action = 'more';
  more.classList.add('is-more');
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  more.addEventListener('click', () => {
    const level = typeof deps.level === 'function' ? deps.level() : 'expert';
    const items = moreItems({ level, flags }).map((id) => ({ label: INTENTS[id].label, onSelect: () => arm(id) }));
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
  }
  setFlags({});
  return {
    el,
    setFlags,
    closeMenu,
    destroy() { closeMenu(); el.remove(); },
  };
}
