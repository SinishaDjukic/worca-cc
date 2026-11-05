// ui/public/tool-kinds.mjs — the tool panel's kinds (issue 1064). A kind is a registration: the panel, the header icon
// strip, the + page and the shortcuts read the registry, so slice 2's Browser (and any later kind) is one register()
// call in app.js. A registry is an instance (createToolRegistry), never module state: app.js re-boots in jsdom tests.

/** The header strip's slots, in order. A slot whose kind is not registered yet shows disabled ("coming soon"). */
export const ICON_SLOTS = Object.freeze([
  Object.freeze({ kind: 'terminal', label: 'Terminal', icon: 'terminal' }),
  Object.freeze({ kind: 'browser', label: 'Browser', icon: 'globe' }),
  Object.freeze({ kind: 'files', label: 'Files', icon: 'folder' }),
  Object.freeze({ kind: 'changes', label: 'Changes', icon: 'diff' }),
]);

const KIND_RE = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * A kind definition:
 *   kind, label, icon (icons.mjs name), order (lower first),
 *   shortcut?: { code, key?, ctrl?, shift?, alt?, label }  — the chord the panel matches (capture phase), its hint text,
 *   unavailable?(view) → null | reason                     — beyond the view's own `blocked`,
 *   title(tab) → string                                    — the tab's text (the panel numbers duplicates "… 2"),
 *   mount(tab, host, api) → void | Promise                 — draw the tab into `host` (emptied by the panel),
 *   unmount?(tab), close?(tab) → Promise<boolean> (false keeps the tab), focus?(tab),
 *   strip?: true                                           — a kind outside ICON_SLOTS that wants a header icon.
 */
export function createToolRegistry() {
  const kinds = new Map();
  return {
    register(def) {
      if (!def || typeof def.kind !== 'string' || !KIND_RE.test(def.kind)) throw new Error('tool kind: a lowercase kind name is required');
      if (typeof def.mount !== 'function' || typeof def.title !== 'function') throw new Error(`tool kind ${def.kind}: mount and title are required`);
      const entry = Object.freeze({ order: 100, label: def.kind, icon: 'none', ...def });
      kinds.set(def.kind, entry);
      return () => { if (kinds.get(def.kind) === entry) kinds.delete(def.kind); };
    },
    get: (kind) => kinds.get(kind) || null,
    list: () => [...kinds.values()].sort((a, z) => a.order - z.order || a.kind.localeCompare(z.kind)),
    /** The kind whose shortcut this keydown is: Ctrl, Shift and Alt must match exactly; Cmd never does. */
    matchShortcut(e) {
      if (!e || e.metaKey) return null;
      for (const k of kinds.values()) {
        const s = k.shortcut;
        if (!s) continue;
        if (!!e.ctrlKey !== !!s.ctrl || !!e.shiftKey !== !!s.shift || !!e.altKey !== !!s.alt) continue;
        if (e.code === s.code || (s.key && e.key === s.key)) return k;
      }
      return null;
    },
  };
}
