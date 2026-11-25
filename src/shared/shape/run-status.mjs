// src/shared/shape/run-status.mjs — Shaper small runs, slice 3 (R-po-1, R-po-3): the one status phrase of a marked
// feature's run, read by every surface that words a run row (s4, s5). Pure and browser-safe: it reads only the slice
// payload featureView and the Runs list members carry (`state`, `kind`, `stop`, `waitsFor`, `cannotStart`, `nextTurn`,
// `buildsOn`: features.mjs stopWords), the feature's other slices and, for a live run, its snapshot. It owns no turn
// rule: `next` comes only from the server's `nextTurn`.
import { runShortWord } from './run-agents.mjs';
import { waitsForRunWord } from './run-stops.mjs';

/** The closed set of marks a run row shows: s4 maps them to the status dot classes. */
export const RUN_MARKS = Object.freeze(['done', 'live', 'ask', 'after', 'ring', 'faint', 'failed']);

const LIVE = new Set(['running', 'starting', 'shaping']);
const NOT_STARTED = new Set(['planned', 'held']);
const FAILED = new Set(['error', 'failed']);
const ASKING = new Set(['approval', 'questions']);

const isObj = (x) => !!x && typeof x === 'object';
const heldStop = (s) => isObj(s.stop) && !!s.stop.held;
const openAsk = (s) => (isObj(s.stop) && !s.stop.held) || (!heldStop(s) && ASKING.has(s.state));

/** D4: what a named run adds inside the waiting word. A held answer, paused or stopped run adds nothing. */
const causeOf = (s) => (!isObj(s) ? '' : openAsk(s) ? ' (needs you)' : FAILED.has(s.state) ? ' (failed)' : '');

/**
 * D3: the runs a not-started run names, from its `waitsFor`: a run is left out when another run in the list builds on
 * it, directly or through others (the `buildsOn` closure over `slices`, a Map run → slice). A run with no `buildsOn`
 * implies nothing, so the list names more, never fewer; runs on a cycle (a malformed outline) are all kept. Ascending.
 * @returns {number[]}
 */
export function namedWaits(slice, slices = new Map()) {
  const waits = isObj(slice) && Array.isArray(slice.waitsFor) ? slice.waitsFor : [];
  const memo = new Map();
  const ancestors = (run) => {
    if (memo.has(run)) return memo.get(run);
    const seen = new Set();
    const stack = [run];
    while (stack.length) {
      const s = slices.get(stack.pop());
      for (const d of isObj(s) && Array.isArray(s.buildsOn) ? s.buildsOn : []) if (!seen.has(d)) { seen.add(d); stack.push(d); }
    }
    memo.set(run, seen);
    return seen;
  };
  const implied = (d) => waits.some((e) => e !== d && ancestors(e).has(d) && !ancestors(d).has(e));
  return waits.filter((d) => !implied(d)).sort((a, b) => a - b);
}

/**
 * Slice 11 (R-po-6): the runs that directly build on `run` (their `buildsOn` lists it), over the same Map run → slice
 * namedWaits takes. Finished dependants count too; the run itself never does. Ascending.
 * @returns {number[]}
 */
export function neededByOf(run, slices = new Map()) {
  if (!Number.isInteger(run)) return [];
  const out = [];
  for (const [k, s] of slices) if (k !== run && isObj(s) && Array.isArray(s.buildsOn) && s.buildsOn.includes(run)) out.push(k);
  return out.sort((a, b) => a - b);
}

/**
 * D5: one run's word and mark, first match wins: done; a held stop answer (`after run N`); an open stop or ask
 * (`waiting for you`); failed; not started (cannot start, `waits for run …`, `next`, or no word); live (today's phase
 * word). `word` null means "the caller keeps dev's text", '' means "deliberately no word".
 * @param {{slice?: object, slices?: Map<number, object>, snap?: object|null}} input
 * @returns {{word: string|null, mark: string|null}}
 */
export function runStatus({ slice, slices = new Map(), snap = null } = {}) {
  if (!isObj(slice)) return { word: null, mark: null };
  const state = slice.state;
  if (state === 'done') return { word: 'done', mark: 'done' };
  if (heldStop(slice)) {
    const after = slice.stop.after;
    return { word: Number.isInteger(after) ? `after run ${after}` : slice.nextTurn === true ? 'next' : '', mark: 'after' };
  }
  if (openAsk(slice) || (isObj(snap) && snap.pendingQuestion)) return { word: 'waiting for you', mark: 'ask' };
  if (FAILED.has(state)) return { word: 'failed', mark: 'failed' };
  if (NOT_STARTED.has(state)) {
    // Direction dd181c89f: a run that can never start keeps dev's text (no word of its own yet), never next.
    if (slice.cannotStart) return { word: null, mark: 'faint' };
    const named = namedWaits(slice, slices);
    if (named.length) return { word: waitsForRunWord(named.map((d) => d + causeOf(slices.get(d))).join(', ')), mark: 'faint' };
    if (slice.nextTurn === true) return { word: slice.kind === 'change' ? 'next · small change run' : 'next', mark: 'ring' };
    return { word: '', mark: 'ring' };
  }
  if (LIVE.has(state)) return { word: runShortWord(snap) || null, mark: 'live' };
  return { word: null, mark: null };
}
