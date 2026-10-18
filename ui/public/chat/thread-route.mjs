// ui/public/chat/thread-route.mjs — Shaper s5 (D8): a reply in a thread that follows a run goes to
// POST /api/ask/threads/:id/reply first: it answers the open step, or becomes a changes / Route card; 'chat' (and any
// failure) falls through to the normal Ask turn. Registered after the direction add-on, so an armed "→ run" chip wins.
import { registerComposerAddon } from './extensions.mjs';
import { shapeFirstOn } from './shape-gate.mjs';

export const THREAD_ROUTE_ADDON_ID = 'thread-route';

export function createThreadRouteAddon() {
  return {
    id: THREAD_ROUTE_ADDON_ID,
    mount(_lead, ctx) {
      const gateOn = () => (typeof ctx.shapeOn === 'function' ? ctx.shapeOn() : shapeFirstOn(ctx.doc));
      return {
        update() {},
        async beforeSend(text) {
          const body = String(text == null ? '' : text).trim();
          const t = typeof ctx.thread === 'function' ? ctx.thread() : null;
          const tid = typeof ctx.threadId === 'function' ? ctx.threadId() : null;
          if (!body || !tid || !(t && Array.isArray(t.runLinks) && t.runLinks.length) || !gateOn()) return false;
          try {
            const res = await ctx.fetch(`/api/ask/threads/${encodeURIComponent(tid)}/reply`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: body }) });
            if (!res || !res.ok) return false;
            const j = await res.json();
            return !!j && j.action !== 'chat';     // true: taken, the composer clears the input
          } catch { return false; }
        },
        destroy() {},
      };
    },
  };
}

export function registerThreadRouteAddon() {
  const addon = createThreadRouteAddon();
  registerComposerAddon(addon);
  return addon;
}
