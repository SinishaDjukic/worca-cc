// ui/public/tool-mirror.mjs — mirrors the tool panel's chat and project tabs to the server (issue 1064 slice 3), so the
// chat's tab tools see them with no page open, and takes in the tabs the assistant opened (open_tab). One PUT
// /api/tools/tabs per scope whose list changed (debounced, and once at boot); a GET when a chat or project comes into
// view or an ask-tool-tabs frame names the chat on screen. Run tabs are never mirrored: no chat tool reaches them. Only
// what the tools need goes up: id, kind, a Browser tab's address, a Files tab's file;
// never a chat copy. Titles are page text and stay in the browser.
import { scopeKey, scopeQuery, targetOfState } from './tool-tabs.mjs';

const MIRRORED = new Set(['chat', 'project']);
const SEEN_MAX = 64;
export const MIRROR_DEBOUNCE_MS = 400;

/** One tab as the server stores it. */
export function mirrorTab(t) {
  const url = t.kind === 'browser' && typeof t.state?.url === 'string' ? t.state.url : undefined;
  const target = t.kind === 'files' ? targetOfState(t.state) : null;
  return { id: t.id, kind: t.kind, ...(url ? { url } : {}), ...(target ? { target } : {}), at: t.at };
}

export function createTabMirror({ win, fetch, model, debounceMs = MIRROR_DEBOUNCE_MS }) {
  const sent = new Map();   // scope key → { scope, sig } of the last list the server has
  const seen = new Map();   // scope key → Set of assistant tab ids this page took in
  let timer = 0;
  let stopped = false;
  function lists() {
    const out = new Map();
    for (const t of model.tabs()) {
      if (!MIRRORED.has(t.scope.type)) continue;
      if (t.state?.att) continue;   // a chat copy is not a project file (D18)
      const k = scopeKey(t.scope);
      if (!out.has(k)) out.set(k, { scope: { type: t.scope.type, id: t.scope.id }, tabs: [] });
      out.get(k).tabs.push(mirrorTab(t));
    }
    return out;
  }
  async function put(key, scope, tabs) {
    const sig = JSON.stringify(tabs);
    if (sent.get(key)?.sig === sig) return;
    sent.set(key, { scope, sig });
    try {
      const res = await fetch(`/api/tools/tabs?${scopeQuery(scope)}`, { method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tabs, seen: [...(seen.get(key) || [])] }) });
      await res.json().catch(() => null);
      if (!res.ok) sent.delete(key);              // a gone chat, a server that refused: the next change tries again
    } catch { sent.delete(key); }                 // Worca restarting
  }
  function flush() {
    timer = 0;
    if (stopped) return;
    const now = lists();
    for (const [key, v] of now) void put(key, v.scope, v.tabs);
    for (const [key, v] of [...sent]) if (!now.has(key)) void put(key, v.scope, []);   // its last tab closed
  }
  const schedule = () => { if (!timer && !stopped) timer = win.setTimeout(flush, debounceMs); };
  /** Takes in the assistant's new tabs of `scope` (a chat or project in view). Answers the tabs added to the model. */
  async function pull(scope, { keep } = {}) {
    if (!scope || !MIRRORED.has(scope.type) || stopped) return [];
    let data = null;
    try {
      const res = await fetch(`/api/tools/tabs?${scopeQuery(scope)}`);
      data = res.ok ? await res.json() : null;
    } catch { data = null; }
    const fresh = (Array.isArray(data?.tabs) ? data.tabs : []).filter((t) => t && t.delivered === false && !model.get(t.id));
    if (!fresh.length) return [];
    const added = model.adopt(scope, fresh, { keep });
    const key = scopeKey(scope);
    const s = seen.get(key) || new Set();
    for (const t of added) s.add(t.id);
    seen.set(key, new Set([...s].slice(-SEEN_MAX)));
    schedule();                                   // the next PUT tells the server this page has them
    return added;
  }
  return { schedule, pull, flush, stop() { stopped = true; win.clearTimeout(timer); } };
}
