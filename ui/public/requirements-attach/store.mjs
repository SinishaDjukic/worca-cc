// Attached-feature list for one composer (New run or Chat). Pure state:
// immutable snapshots, a hard cap, and sessionStorage persistence. No DOM.

export const MAX_ATTACHED = 10;

const EMPTY_SCOPE = Object.freeze({ pinned: false, projectKey: null, workspaceId: null, label: '' });

const isItem = (v) => v !== null && typeof v === 'object' && Number.isInteger(v.seq);

const cloneItems = (items) => items.map((i) => ({ ...i }));
const cloneScope = (s) => ({ ...s });

function restore(storage, key) {
  const empty = { items: [], scope: cloneScope(EMPTY_SCOPE) };
  let raw;
  try {
    raw = storage?.getItem(key);
  } catch {
    return empty;
  }
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) return empty;
    const seen = new Set();
    const items = [];
    for (const it of parsed.items) {
      if (!isItem(it) || seen.has(it.seq)) continue;
      seen.add(it.seq);
      items.push({ ...it });
    }
    const scope =
      parsed.scope && typeof parsed.scope === 'object'
        ? { ...EMPTY_SCOPE, ...parsed.scope }
        : cloneScope(EMPTY_SCOPE);
    return { items: items.slice(0, MAX_ATTACHED), scope };
  } catch {
    return empty;
  }
}

export function createAttachStore({ storage, key }) {
  let state = restore(storage, key);
  const subscribers = new Set();

  const snapshot = () => ({ items: cloneItems(state.items), scope: cloneScope(state.scope) });

  function commit(next) {
    state = next;
    try {
      storage?.setItem(key, JSON.stringify(state));
    } catch {
      // Persistence is best-effort (quota, private mode); in-memory state stays authoritative.
    }
    for (const fn of [...subscribers]) fn(snapshot());
  }

  return {
    get: snapshot,

    add(incoming) {
      const have = new Set(state.items.map((i) => i.seq));
      const fresh = [];
      for (const it of incoming ?? []) {
        if (!isItem(it) || have.has(it.seq)) continue;
        have.add(it.seq);
        fresh.push({ ...it });
      }
      if (state.items.length + fresh.length > MAX_ATTACHED) return { ok: false, reason: 'limit' };
      if (fresh.length) commit({ ...state, items: [...state.items, ...fresh] });
      return { ok: true };
    },

    remove(seq) {
      if (!state.items.some((i) => i.seq === seq)) return;
      commit({ ...state, items: state.items.filter((i) => i.seq !== seq) });
    },

    clear() {
      commit({ ...state, items: [] });
    },

    setStatuses(map) {
      const patch = map ?? {};
      commit({
        ...state,
        items: state.items.map((it) => {
          const p = patch[it.seq];
          if (p === undefined || p === null) return { ...it };
          return typeof p === 'string' ? { ...it, status: p } : { ...it, ...p };
        }),
      });
    },

    setScope(scope) {
      commit({ ...state, scope: { ...EMPTY_SCOPE, ...scope } });
    },

    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}
