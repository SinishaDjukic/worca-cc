// Interface modes (docs/ui-levels.md; docs/rail/logic.md): what a mode shows is one rule, read here, never a page's test.
export const MODES = ['simple', 'advanced', 'expert'];
const rank = (m) => { const i = MODES.indexOf(m); if (i < 0) throw new Error(`levels: unknown mode ${m}`); return i; };

/** Whether a thing that needs `need` shows in `mode`. */
export const atLevel = (mode, need = 'simple') => rank(mode) >= rank(need);

// The run page keeps its four tabs in every mode; inside them these parts have a level (docs/rail/thing-page.md).
export const RUN_PAGE_LEVELS = { logs: 'advanced', graph: 'advanced', agents: 'expert', logFilters: 'expert', actions: 'advanced' };

/** Whether a part of the run page shows in `mode`. A part with no level shows in every mode. */
export const runPartShows = (part, mode) => atLevel(mode, RUN_PAGE_LEVELS[part] || 'simple');

// The person's interface mode and Labs flags, one store for a page and its parts: the profile menu and Labs write it,
// a page reads it and draws again when it changes. Starts as the caller sets it; nothing is saved here.
function createPrefs() {
  let mode = 'expert'; const flags = new Map(); const off = new Set(); const subs = new Set();
  const changed = () => subs.forEach((fn) => fn());
  return {
    mode: () => mode,
    setMode(m) { rank(m); mode = m; changed(); },
    flag: (k) => !!flags.get(k),
    setFlag(k, on) { flags.set(k, !!on); changed(); },
    connected: (p) => !off.has(p),
    setConnected(p, on) { if (on) off.delete(p); else off.add(p); changed(); },
    onChange(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}
export const prefs = createPrefs();
export const shows = (need, mode = prefs.mode()) => !need || atLevel(mode, need);
