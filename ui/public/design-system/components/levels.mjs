// Interface modes (docs/ui-levels.md; docs/rail/logic.md): what a mode shows is one rule, read here, never a page's test.
export const MODES = ['simple', 'advanced', 'expert'];
const rank = (m) => { const i = MODES.indexOf(m); if (i < 0) throw new Error(`levels: unknown mode ${m}`); return i; };

/** Whether a thing that needs `need` shows in `mode`. */
export const atLevel = (mode, need = 'simple') => rank(mode) >= rank(need);

// The run page keeps its four tabs in every mode; inside them these parts have a level (docs/rail/thing-page.md).
export const RUN_PAGE_LEVELS = { logs: 'advanced', graph: 'advanced', agents: 'expert', logFilters: 'expert' };

/** Whether a part of the run page shows in `mode`. A part with no level shows in every mode. */
export const runPartShows = (part, mode) => atLevel(mode, RUN_PAGE_LEVELS[part] || 'simple');
