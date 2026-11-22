// src/shared/shape/run-facts.mjs — Shaper small runs D2 (D7, D9, D15): a run's stored facts as words. Pure and
// browser-safe: "Starts from" (the prototype's startsFrom words, without its live `now` / `resumed` suffixes), the
// "Owns" rows of a run's requirements, and the plan version a plan path names. Read by src/core/shape/features.mjs
// (sliceOfPipeline, storedAgentFacts) and src/core/artifacts.mjs (newestPlanPath).

/** A plan path's version: `…-vN.md` is N, any other path 1. */
export function planVersionOf(relPath) {
  return Number(/-v(\d+)\.md$/.exec(String(relPath || ''))?.[1] || 1);
}

/**
 * Where a run starts from, from its stored `branch.source`. `index` is the run's number, `base` the feature base,
 * `runs` the earlier runs' `{ index, feature }` (their `branch.feature`). First match wins: run 1 or the base is the
 * feature branch; an earlier run's branch names that run; any other source is a named branch; a later run with no
 * stored source (an old row) is null.
 * @returns {{ kind: 'feature'|'run'|'branch', run?: number, branch: string|null, text: string } | null}
 */
export function startsFromOf({ index, source, base, runs = [] } = {}) {
  const src = typeof source === 'string' ? source : '';
  if (index === 1 || (src && src === base)) {
    return { kind: 'feature', branch: src || base || null, text: 'the feature branch: nothing is finished yet' };
  }
  if (!src) return null;
  const hit = (Array.isArray(runs) ? runs : []).find((r) => r && r.feature && r.feature === src);
  if (hit) return { kind: 'run', run: hit.index, branch: src, text: `the latest finished run (run ${hit.index})` };
  return { kind: 'branch', branch: src, text: `the branch ${src}` };
}

/** Requirement text is data: one line, whitespace collapsed. */
const oneLine = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

/**
 * A run's Owns rows: one per id, its agreed text on one line, `pass` from the last code review's check by id (null
 * before a review, or for an id the check does not name). Small runs D3 (D4): `shown` (a Map id → the ship ledger's
 * `shown`) adds that id's status `word` and `mark`; an id it does not hold keeps D2's row.
 * @returns {Array<{ id: string, text: string, pass: boolean|null, word?: string, mark?: string }>}
 */
export function ownsOf({ ids, texts = {}, check = null, shown = null } = {}) {
  const items = check && Array.isArray(check.items) ? check.items : [];
  return (Array.isArray(ids) ? ids : []).map((id) => {
    const it = items.find((x) => x && x.id === id);
    const s = shown && shown.get(id);
    return { id, text: oneLine(texts && texts[id]), pass: it ? !!it.pass : null, ...(s ? { word: s.word, mark: s.mark } : {}) };
  });
}
