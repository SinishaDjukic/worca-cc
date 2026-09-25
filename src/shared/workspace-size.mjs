// src/shared/workspace-size.mjs
// How big a workspace may get, and what its size changes. ONE source for the server (the
// create cap, the scan description's length budget) and the browser (Create workspace's size
// note and its Scan gate). Import-free: served to the browser as-is under /src/shared.

/** The most member projects one workspace holds (D22): creating (and first-scanning) more is refused. */
export const WORKSPACE_MAX_PROJECTS = 40;

/** Create workspace warns above these member counts (D24): a bit big, then big. */
export const WORKSPACE_BIG_OVER = 10;
export const WORKSPACE_VERY_BIG_OVER = 20;

/**
 * The size level of a member count: 'ok' (up to 10), 'big' (11–20), 'very-big' (21–40),
 * 'over' (41+, refused).
 * @param {number} count distinct member projects
 * @returns {'ok'|'big'|'very-big'|'over'}
 */
export function workspaceSizeLevel(count) {
  const n = Number(count) || 0;
  if (n > WORKSPACE_MAX_PROJECTS) return 'over';
  if (n > WORKSPACE_VERY_BIG_OVER) return 'very-big';
  if (n > WORKSPACE_BIG_OVER) return 'big';
  return 'ok';
}

/** The scan description's soft line ceiling by member count (D23): more projects carry more
 *  interconnections, so the ceiling grows past 5 and past 20 members. The last tier also covers
 *  a workspace created before the cap (a re-scan never re-checks it). */
export const SCAN_DESCRIPTION_BUDGETS = Object.freeze([
  Object.freeze({ upTo: 5, lines: 300 }),
  Object.freeze({ upTo: 20, lines: 500 }),
  Object.freeze({ upTo: Infinity, lines: 800 }),
]);

/**
 * @param {number} count distinct member projects
 * @returns {number} the upper guideline, in lines, the scanner scales its description to
 */
export function scanDescriptionBudget(count) {
  const n = Number(count) || 0;
  return SCAN_DESCRIPTION_BUDGETS.find((t) => n <= t.upTo).lines;
}
