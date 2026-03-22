export function sortByStartDesc(runs) {
  return [...runs].sort((a, b) => {
    const ta = a.started_at || '';
    const tb = b.started_at || '';
    if (!ta && !tb) return 0;
    if (!ta) return 1;
    if (!tb) return -1;
    return tb.localeCompare(ta);
  });
}
