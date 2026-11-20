// ui/public/run-outcome.mjs — the caveat a finished run carries next to "Done".
// A run whose review/refine loop hit its cap with blocking issues still open was forced on
// (E2), and a run that went quiet without reaching End did not finish its graph (2.3). Both
// are `done`, and neither is a plain success, so every surface that says "Done" says which.

/** Total open blocking issues across the loops that were forced on. */
export function openIssueCount(st) {
  const list = Array.isArray(st?.openIssues) ? st.openIssues : [];
  return list.reduce((n, o) => n + (Number(o?.count) || 0), 0);
}

/**
 * The short caveat for a done run, or null for a clean finish.
 * Reads either a run state (`openIssues` array, `endReached`) or a History entry
 * (`openIssueCount` number, `endReached`).
 * @returns {{text: string, title: string} | null}
 */
export function outcomeNote(st) {
  if (!st || st.status !== 'done') return null;
  const n = Number.isFinite(st.openIssueCount) ? st.openIssueCount : openIssueCount(st);
  if (n > 0) {
    return {
      text: `${n} open issue${n === 1 ? '' : 's'}`,
      title: 'A review loop ran out of cycles with blocking issues still open, and the run continued past them',
    };
  }
  if (st.endReached === false) {
    return { text: 'End not reached', title: 'The run went quiet before its End card fired — part of the graph did not run' };
  }
  return null;
}
