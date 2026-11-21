// ui/public/tool-tabs.mjs — the tool panel's tab model (issue 1064). Pure data: no DOM and no network, so node:test
// drives it directly. A tab is one tool instance `{ id, kind, scope, state, at }`. Its scope is the project, run or
// chat that was in view when it opened; the panel shows the view's project tabs, then the view's run or chat tabs.
// Terminal tabs follow the server's live shells (syncSessions): a shell anyone opens gets a tab in its scope, and a tab
// whose shell ended leaves, unless it is the one on screen (it then offers Enter for a new shell).
import { isNoProjectKey } from '../../src/shared/no-project.mjs';

export const TOOLS_KEY = 'worca-cc.tools';
export const LEGACY_WIDTH_KEY = 'worca-cc.terminal.width';   // the old terminal pane's width seeds the first boot (its open flag never does)
export const MAX_TABS = 64;
export const DEFAULT_WIDTH = 460;
const MAX_ACTIVE = 50;
const MAX_OPEN = 50;
const SCOPE_TYPES = new Set(['project', 'run', 'chat']);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,199}$/;
const OPEN_KEY_RE = /^(project|run|chat):[A-Za-z0-9][A-Za-z0-9_.:@-]{0,199}$/;
const KIND_RE = /^[a-z][a-z0-9-]{0,31}$/;
const TAB_ID_RE = /^tab_[A-Za-z0-9]{1,32}$/;

/** Why the view opens no new tab (its own tabs still show). */
export const BLOCKED = Object.freeze({
  pending: 'This run is starting. Its tools open in a moment.',
  newChat: 'Send the first message: tools open in this chat\'s project folder.',
  newChatNoProject: 'Pick a project and send the first message to use this chat\'s tools.',
  noProject: 'This chat has no project. Pick one in the chat to use its tools.',
});

export const scopeKey = (s) => (s ? `${s.type}:${s.id}` : '');

/** A scope as stored: a known type, a safe id, and a run's lookup keys. null for anything else. */
export function cleanScope(s) {
  if (!s || typeof s !== 'object' || !SCOPE_TYPES.has(s.type) || typeof s.id !== 'string' || !ID_RE.test(s.id)) return null;
  const out = { type: s.type, id: s.id };
  for (const k of ['projectKey', 'workspaceId', 'projectDir']) {
    if (typeof s[k] === 'string' && s[k] && s[k].length <= 4096) out[k] = s[k];
  }
  return out;
}

/**
 * The view for a page context (app.js toolPageContext): the project whose tabs show, the run or chat whose tabs show
 * beside them, and `blocked` (why no new tab opens here). null: a page about none of them (the panel keeps the last view).
 */
export function viewOf(ctx = {}) {
  const ws = typeof ctx.workspaceId === 'string' && ctx.workspaceId ? ctx.workspaceId.replace(/^workspaces\//, '') : '';
  const key = typeof ctx.projectKey === 'string' && ctx.projectKey ? ctx.projectKey : null;
  const group = key && !isNoProjectKey(key) ? key : null;   // a No-project run's key finds the run, but it has no project tabs
  if (ctx.view === 'chat') {
    if (typeof ctx.chatId !== 'string' || !ctx.chatId) {
      return { project: null, side: null, blocked: ctx.chatProjectKey ? BLOCKED.newChat : BLOCKED.newChatNoProject };
    }
    const pk = typeof ctx.chatProjectKey === 'string' && ctx.chatProjectKey ? ctx.chatProjectKey : null;
    const side = cleanScope({ type: 'chat', id: ctx.chatId, projectKey: pk || undefined });
    if (!side) return null;
    if (pk) return { project: pk, side };
    // A design chat with no project: its tools work in the design's own folder (the server's designToolFolder).
    return ctx.chatDesign ? { project: null, side, design: true } : { project: null, side, blocked: BLOCKED.noProject };
  }
  if (ctx.view === 'running' && !ctx.pipelineId && ctx.runId) return { project: ws ? null : group, side: null, blocked: BLOCKED.pending };
  if ((ctx.view === 'running' || ctx.view === 'history-detail') && ctx.pipelineId) {
    const side = cleanScope({ type: 'run', id: ctx.pipelineId, workspaceId: ws || undefined, projectKey: ws ? undefined : (key || undefined),
      projectDir: ws || key ? undefined : ctx.projectDir });
    return side ? { project: ws ? null : group, side } : null;
  }
  if (ctx.view === 'project-detail' && group) return { project: group, side: null };
  return null;
}

export const viewKey = (v) => `${v?.project || ''}|${scopeKey(v?.side)}`;

/**
 * The key a view keeps the panel open or closed under: its run or chat, else its project page. null for a view with no
 * saved state (a new chat before its first message, a run still starting, no view): the panel starts closed there.
 */
export function openKeyOf(v) {
  if (!v) return null;
  if (v.side) return scopeKey(v.side);
  if (v.blocked || !v.project) return null;
  return `project:${v.project}`;
}

export function inView(tab, view) {
  if (!tab || !view) return false;
  if (tab.scope.type === 'project') return !!view.project && tab.scope.id === view.project;
  return !!view.side && scopeKey(tab.scope) === scopeKey(view.side);
}

/** The scope a server shell belongs to (D3): Chat's agent shells and chat shells → their chat; run → its run;
 *  project and branch → the project. */
export function sessionScope(s) {
  if (!s || typeof s !== 'object') return null;
  const by = typeof s.createdBy === 'string' ? s.createdBy : '';
  const pk = typeof s.projectKey === 'string' && s.projectKey ? s.projectKey : undefined;
  if (by.startsWith('ask:') && by !== 'ask:cap' && by.length > 4) return cleanScope({ type: 'chat', id: by.slice(4), projectKey: pk });
  if (typeof s.chatId === 'string' && s.chatId) return cleanScope({ type: 'chat', id: s.chatId, projectKey: pk });
  if (s.scope === 'run' && s.runId) return cleanScope({ type: 'run', id: s.runId });
  if ((s.scope === 'project' || s.scope === 'branch') && pk) return cleanScope({ type: 'project', id: pk });
  return null;
}

/** A run's own scope query (`/api/runs/:id/…?`): one of workspaceId, projectKey, projectDir. */
export function runQuery(scope) {
  const q = new URLSearchParams();
  if (scope.workspaceId) q.set('workspaceId', scope.workspaceId);
  else if (scope.projectKey) q.set('projectKey', scope.projectKey);
  else if (scope.projectDir) q.set('projectDir', scope.projectDir);
  return q.toString();
}

/** The tool routes' query (`/api/tools/*?`) for a scope, plus `extra` (path, member). */
export function scopeQuery(scope, extra = {}) {
  const q = new URLSearchParams({ scope: scope.type });
  if (scope.type === 'project') q.set('projectKey', scope.id);
  else if (scope.type === 'chat') q.set('threadId', scope.id);
  else {
    q.set('runId', scope.id);
    for (const [k, v] of new URLSearchParams(runQuery(scope))) q.set(k, v);
  }
  for (const [k, v] of Object.entries(extra)) if (v != null && v !== '') q.set(k, String(v));
  return q.toString();
}

/** A Files tab's state as the mirror sends it (null: not a project file — an attachment copy, or no path). */
export function targetOfState(s) {
  if (!s || s.att) return null;
  const file = typeof s.file === 'string' && s.file ? s.file : '';
  const path = file || (typeof s.path === 'string' && s.path ? s.path : '');
  if (!path) return null;
  const line = file && Number.isInteger(s.line) ? s.line : null;
  return { path, ...(file ? {} : { dir: true }), ...(line ? { line } : {}), ...(line && Number.isInteger(s.endLine) ? { endLine: s.endLine } : {}),
    ...(typeof s.root === 'string' && s.root ? { root: s.root } : {}), ...(typeof s.member === 'string' && s.member ? { member: s.member } : {}) };
}
/** A mirrored target back as Files tab state. */
export function stateOfTarget(t) {
  if (!t || typeof t.path !== 'string' || !t.path) return {};
  return { ...(t.dir ? { path: t.path, file: undefined } : { file: t.path }),
    line: Number.isInteger(t.line) ? t.line : undefined, endLine: Number.isInteger(t.endLine) ? t.endLine : undefined,
    root: typeof t.root === 'string' ? t.root : undefined, member: typeof t.member === 'string' ? t.member : undefined };
}

const defaultId = () => `tab_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
function readItem(storage, key) { try { return storage ? storage.getItem(key) : null; } catch { return null; } }
function cleanTab(t) {
  if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !TAB_ID_RE.test(t.id) || typeof t.kind !== 'string' || !KIND_RE.test(t.kind)) return null;
  const scope = cleanScope(t.scope);
  if (!scope) return null;
  const state = t.state && typeof t.state === 'object' && !Array.isArray(t.state) ? { ...t.state } : {};
  return { id: t.id, kind: t.kind, scope, state, at: Number.isFinite(t.at) ? t.at : 0 };
}
function load(storage, knownKind) {
  let raw = null;
  try { raw = JSON.parse(readItem(storage, TOOLS_KEY) || 'null'); } catch { raw = null; }
  const tabs = [];
  const seen = new Set();
  for (const t of Array.isArray(raw?.tabs) ? raw.tabs : []) {
    const c = cleanTab(t);
    if (c && knownKind(c.kind) && !seen.has(c.id) && tabs.length < MAX_TABS) { seen.add(c.id); tabs.push(c); }
  }
  const active = {};
  if (raw?.active && typeof raw.active === 'object') {
    for (const [k, v] of Object.entries(raw.active)) if (typeof v === 'string' && seen.has(v)) active[k] = v;
  }
  const open = [];
  for (const k of Array.isArray(raw?.open) ? raw.open : []) if (typeof k === 'string' && OPEN_KEY_RE.test(k) && !open.includes(k)) open.push(k);
  let width = Number(raw?.prefs?.width);
  if (!raw) width = Number(readItem(storage, LEGACY_WIDTH_KEY));   // the first boot with the tool panel: the pane's width
  return { tabs, active, open: open.slice(-MAX_OPEN),
    prefs: { width: Number.isFinite(width) && width > 0 ? width : DEFAULT_WIDTH, max: raw?.prefs?.max === true } };
}

/** The tab model. Every change persists to `storage` (private mode: kept in memory only). */
/** `knownKind(kind)`: false drops a kept or mirrored tab of a kind this Worca no longer has (a turned-off Changes tab) instead of
 *  keeping it as a "not available" note. */
export function createTabModel({ storage = null, newId = defaultId, now = () => Date.now(), onChange = null, knownKind = () => true } = {}) {
  const st = load(storage, knownKind);
  const save = () => {
    const keys = Object.keys(st.active);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ACTIVE))) delete st.active[k];
    try { if (storage) storage.setItem(TOOLS_KEY, JSON.stringify({ v: 1, tabs: st.tabs, active: st.active, open: st.open, prefs: st.prefs })); } catch { /* private mode */ }
    if (typeof onChange === 'function') { try { onChange(); } catch { /* a listener's own trouble */ } }
  };
  const get = (id) => st.tabs.find((t) => t.id === id) || null;
  const freshId = () => { let id = newId(); while (get(id)) id = newId(); return id; };
  const visible = (view) => ({
    project: st.tabs.filter((t) => t.scope.type === 'project' && inView(t, view)),
    side: st.tabs.filter((t) => t.scope.type !== 'project' && inView(t, view)),
  });
  const groupOf = (tab, view) => { const v = visible(view); return tab.scope.type === 'project' ? v.project : v.side; };
  const swap = (a, b) => { const i = st.tabs.indexOf(a); const j = st.tabs.indexOf(b); st.tabs[i] = b; st.tabs[j] = a; };
  /**
   * At the cap, room for a tab in `scope`: the oldest Files/Changes-like tab (not a shell, not a project tab) of another
   * run or chat goes, unless `keep` holds it (the tab on screen, a guest). Run and chat tabs outlive their page, so without
   * this the cap would fill with tabs of runs nobody archives. Answers whether there is room.
   */
  const makeRoom = (scope, keep) => {
    if (st.tabs.length < MAX_TABS) return true;
    const own = scopeKey(scope);
    const victim = st.tabs.filter((t) => t.kind !== 'terminal' && t.scope.type !== 'project' && scopeKey(t.scope) !== own && !keep.has(t.id))
      .sort((a, z) => a.at - z.at)[0];
    if (!victim) return false;
    st.tabs = st.tabs.filter((t) => t !== victim);
    for (const [k, v] of Object.entries(st.active)) if (v === victim.id) delete st.active[k];
    return true;
  };

  return {
    tabs: () => st.tabs.slice(),
    get,
    visible,
    prefs: () => ({ ...st.prefs }),
    setPrefs(p) {
      if (Number.isFinite(p.width) && p.width > 0) st.prefs.width = Math.round(p.width);
      if (typeof p.max === 'boolean') st.prefs.max = p.max;
      save();
    },
    /** Whether the person left the panel open in the view keyed `key` (openKeyOf). */
    isOpenAt: (key) => typeof key === 'string' && st.open.includes(key),
    /** Remembers the panel open (newest last, at most 50) or closed (unlisted) for `key`; anything else is refused. */
    setOpenAt(key, open) {
      if (typeof key !== 'string' || !OPEN_KEY_RE.test(key)) return;
      if (open ? st.open.at(-1) === key : !st.open.includes(key)) return;   // nothing changes: no save
      st.open = st.open.filter((k) => k !== key);
      if (open) st.open.push(key);
      if (st.open.length > MAX_OPEN) st.open.splice(0, st.open.length - MAX_OPEN);
      save();
    },
    /** `keep`: tab ids the cap may not make room from (the panel's tabs on screen). */
    open(kind, scope, state = {}, { keep = new Set() } = {}) {
      const s = cleanScope(scope);
      if (!s || typeof kind !== 'string' || !KIND_RE.test(kind) || !makeRoom(s, keep)) return null;
      const tab = { id: freshId(), kind, scope: s, state: { ...state }, at: now() };
      st.tabs.push(tab);
      save();
      return tab;
    },
    close(id) {
      const n = st.tabs.length;
      st.tabs = st.tabs.filter((t) => t.id !== id);
      if (st.tabs.length === n) return false;
      save();
      return true;
    },
    /** Merges `patch` into the tab's state; an `undefined` value removes that key. */
    update(id, patch = {}) {
      const t = get(id);
      if (!t) return false;
      for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete t.state[k]; else t.state[k] = v; }
      save();
      return true;
    },
    activate(view, id) { if (get(id)) { delete st.active[viewKey(view)]; st.active[viewKey(view)] = id; save(); } },
    /** No tab selected (the panel's Overview): the view's stored entry goes; nothing saves when there was none. */
    deselect(view) {
      const k = viewKey(view);
      if (!Object.prototype.hasOwnProperty.call(st.active, k)) return;
      delete st.active[k];
      save();
    },
    /** The view's active tab: the one it last showed while still in view, else null (no tab selected: the Overview). */
    active(view) {
      const v = visible(view);
      const id = st.active[viewKey(view)];
      return (id && [...v.project, ...v.side].find((t) => t.id === id)) || null;
    },
    newest(kind, view) {
      const v = visible(view);
      return [...v.project, ...v.side].filter((t) => t.kind === kind).sort((a, z) => z.at - a.at)[0] || null;
    },
    /** One place left (-1) or right (+1) inside the tab's own group (never across the divider). */
    move(id, delta, view) {
      const t = get(id);
      if (!t) return false;
      const list = groupOf(t, view);
      const i = list.indexOf(t);
      const other = list[i + delta];
      if (i < 0 || !other) return false;
      swap(t, other);
      save();
      return true;
    },
    /** Drag: put `id` before `beforeId`, both in one group of the view. */
    moveBefore(id, beforeId, view) {
      const t = get(id);
      const b = get(beforeId);
      if (!t || !b || t === b || !inView(t, view) || !inView(b, view) || (t.scope.type === 'project') !== (b.scope.type === 'project')) return false;
      st.tabs.splice(st.tabs.indexOf(t), 1);
      st.tabs.splice(st.tabs.indexOf(b), 0, t);
      save();
      return true;
    },
    moveToProject(id, projectKey) {
      const t = get(id);
      const s = cleanScope({ type: 'project', id: projectKey });
      if (!t || !s || t.scope.type === 'project') return false;
      t.scope = s;
      save();
      return true;
    },
    /** Run and chat tabs another run or chat holds: they keep running, out of view. */
    hidden(view) { return st.tabs.filter((t) => t.scope.type !== 'project' && !inView(t, view)); },
    /** A scope's tabs leave (archived), and its open state; a scope with no id: every tab and state of its type (a chat history clear). */
    closeScope(scope) {
      const key = scopeKey(scope);
      const all = !!scope && scope.id == null;
      const hit = all ? (t) => t.scope.type === scope.type : (t) => scopeKey(t.scope) === key;
      const gone = st.tabs.filter(hit);
      const open = st.open.filter((k) => (all ? !k.startsWith(`${scope.type}:`) : k !== key));
      if (gone.length || open.length !== st.open.length) { st.tabs = st.tabs.filter((t) => !hit(t)); st.open = open; save(); }
      return gone;
    },
    /**
     * Mirrored tabs the assistant opened (open_tab, tool-mirror.mjs pull): each `{ id, kind, url? }` not here yet joins
     * `scope`, marked opened by the assistant. Ids keep the server's (the mirror knows them); the cap makes room as
     * open() does. Answers the tabs it added.
     */
    adopt(scope, list, { keep = new Set() } = {}) {
      const s = cleanScope(scope);
      if (!s) return [];
      const added = [];
      for (const m of Array.isArray(list) ? list : []) {
        if (!m || typeof m.id !== 'string' || !TAB_ID_RE.test(m.id) || get(m.id) || typeof m.kind !== 'string' || !KIND_RE.test(m.kind) || !knownKind(m.kind)) continue;
        if (!makeRoom(s, keep)) break;
        // stateOfTarget's undefined keys are deletes for focusTab; a new tab's state leaves them out
        const state = { openedBy: 'assistant', ...(m.kind === 'browser' && typeof m.url === 'string' && m.url.length <= 2048 ? { url: m.url } : {}),
          ...(m.kind === 'files' ? Object.fromEntries(Object.entries(stateOfTarget(m.target)).filter(([, v]) => v !== undefined)) : {}) };
        const tab = { id: m.id, kind: m.kind, scope: s, state, at: now() };
        st.tabs.push(tab);
        added.push(tab);
      }
      if (added.length) save();
      return added;
    },
    /**
     * D3: one terminal tab per live server shell. A shell with no tab gets one in its scope (oldest first, so tabs keep the
     * order the shells opened in); a tab whose shell is not running leaves, unless `keep` holds it (the tab on screen).
     * A tab with no shell yet (starting) is left alone. Answers whether anything changed.
     */
    syncSessions(sessions, keep = new Set()) {
      const live = new Map();
      for (const s of Array.isArray(sessions) ? sessions : []) if (s && s.status === 'running' && typeof s.id === 'string') live.set(s.id, s);
      let dirty = false;
      const bound = new Set();
      st.tabs = st.tabs.filter((t) => {
        if (t.kind !== 'terminal' || !t.state.sessionId) return true;
        if (live.has(t.state.sessionId)) { bound.add(t.state.sessionId); return true; }
        if (keep.has(t.id)) return true;
        dirty = true;
        return false;
      });
      const fresh = [...live.values()].filter((s) => !bound.has(s.id))
        .sort((a, z) => String(a.createdAt || '').localeCompare(String(z.createdAt || '')));
      for (const s of fresh) {
        const scope = sessionScope(s);
        if (!scope || !makeRoom(scope, keep)) continue;
        st.tabs.push({ id: freshId(), kind: 'terminal', scope, state: { sessionId: s.id }, at: Date.parse(s.createdAt) || now() });
        dirty = true;
      }
      if (dirty) save();
      return dirty;
    },
  };
}
