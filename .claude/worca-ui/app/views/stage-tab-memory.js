/**
 * Resolves which iteration tab to show for a given stage.
 *
 * @param {Map<string, number>} tabMap - Per-stage user selections (stageKey → iterationNumber)
 * @param {string} stageKey - The stage identifier
 * @param {{ number: number }[]} iterations - The stage's iterations array
 * @returns {number|null} The iteration number to show, or null if no iterations
 */
export function resolveIterationTab(tabMap, stageKey, iterations) {
  if (!iterations || iterations.length === 0) return null;
  const userChoice = tabMap?.get(stageKey);
  return userChoice ?? iterations[iterations.length - 1].number;
}
