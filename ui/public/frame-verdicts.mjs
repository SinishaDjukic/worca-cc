// ui/public/frame-verdicts.mjs — the Browser tab's memory of sites that refuse frames (issue 1064 §3): the server's
// check (POST /api/tools/frame-check) once per origin, and the refused origins in sessionStorage, so a later chat link to
// one opens in a browser tab of its own inside the click (chat-link-route.mjs `refused`).
const KEY = 'worca-cc.frameRefused';
const MAX = 200;

export function createFrameVerdicts({ fetch, storage = null }) {
  const read = () => {
    try { const a = JSON.parse(storage?.getItem(KEY) || '[]'); return new Set(Array.isArray(a) ? a.filter((x) => typeof x === 'string').slice(-MAX) : []); }
    catch { return new Set(); }
  };
  const refused = read();
  const pending = new Map();
  function remember(origin) {
    refused.delete(origin);
    refused.add(origin);
    while (refused.size > MAX) refused.delete(refused.values().next().value);
    try { storage?.setItem(KEY, JSON.stringify([...refused])); } catch { /* private mode */ }
  }
  return {
    refused: (origin) => refused.has(origin),
    check(url, { threadId = null } = {}) {
      let origin;
      try { origin = new URL(url).origin; } catch { return Promise.resolve({ framable: null }); }
      if (refused.has(origin)) return Promise.resolve({ framable: false, reason: 'cached' });
      if (!pending.has(origin)) {
        pending.set(origin, (async () => {
          try {
            const r = await fetch('/api/tools/frame-check', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url, ...(threadId ? { threadId } : {}) }) });
            const j = r && r.ok ? await r.json() : null;
            if (j && j.framable === false) remember(origin);
            return j && typeof j === 'object' ? j : { framable: null };
          } catch { return { framable: null }; }
          finally { pending.delete(origin); }
        })());
      }
      return pending.get(origin);
    },
  };
}
