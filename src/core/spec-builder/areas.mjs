// src/core/spec-builder/areas.mjs — the wizard's "Areas" suggestions (plans/spec-builder D10): tracked paths
// scored by the goal's words. Paths only — the server never sends file contents to the browser.
const STOP = new Set(['the', 'and', 'for', 'with', 'add', 'make', 'new', 'from', 'into', 'that', 'this', 'when', 'use']);
export const MAX_AREAS = 12;

export function goalTokens(q) {
  return [...new Set(String(q || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t)))];
}

/** Up to MAX_AREAS paths: by token hits (desc), then path (asc). No tokens: the top-level directories. */
export function suggestAreas(files, q) {
  const tokens = goalTokens(q);
  if (!tokens.length) return [...new Set(files.filter((f) => f.includes('/')).map((f) => `${f.split('/')[0]}/`))].sort().slice(0, MAX_AREAS);
  return files
    .map((f) => ({ f, score: tokens.reduce((n, t) => n + (f.toLowerCase().includes(t) ? 1 : 0), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (a.f < b.f ? -1 : a.f > b.f ? 1 : 0))
    .slice(0, MAX_AREAS)
    .map((x) => x.f);
}
