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
 * Slice 6 (D6): the runs a stop on `run` holds up: every run that builds on it directly or through others (the reverse
 * `buildsOn` closure, walked through every link whatever its state) whose state is neither `done` nor `canceled`. The
 * run itself is never listed; a cycle ends through `seen`. Ascending.
 * @returns {number[]}
 */
export function holdsUpOf(run, slices = new Map()) {
  if (!Number.isInteger(run)) return [];
  const seen = new Set([run]);
  const stack = [run];
  const out = [];
  while (stack.length) {
    for (const d of neededByOf(stack.pop(), slices)) {
      if (seen.has(d)) continue;
      seen.add(d);
      stack.push(d);
      const st = slices.get(d).state;
      if (st !== 'done' && st !== 'canceled') out.push(d);
    }
  }
  return out.sort((a, b) => a - b);
}

/** Slice 6 (D7): a stop line's word for an ask with no stop reason, by its kind (step-card.mjs `stepChip`). */
export const STOP_KIND_WORDS = Object.freeze({
  plan: 'plan approval', outline: 'runs approval', clarify: 'questions', questions: 'questions', gate: 'gate',
  recovery: 'recovery', care: 'start', prototype: 'prototype',
});

/**
 * Slice 6 (D7): one stop line's text: `Run N · WORD` for an open stop, `Run N failed` for a failed run, plus
 * ` · holds up a, b` when `holdsUp` is non-empty.
 * @param {{index: number, kind?: string|null, reason?: string|null, failed?: boolean, holdsUp?: number[]}} entry
 * @returns {string}
 */
export function stopLineText(entry) {
  const e = isObj(entry) ? entry : {};
  const word = e.reason ? (e.reason === 'objection' ? 'gate' : 'plan approval')
    : (Object.hasOwn(STOP_KIND_WORDS, e.kind) ? STOP_KIND_WORDS[e.kind] : 'waiting for you');
  const head = e.failed ? `Run ${e.index} failed` : `Run ${e.index} · ${word}`;
  const held = Array.isArray(e.holdsUp) && e.holdsUp.length ? ` · holds up ${e.holdsUp.join(', ')}` : '';
  return head + held;
}

/**
 * D5: one run's word and mark, first match wins: done; a held stop answer (`after run N`); a held resume (`after run
 * N`, slice 8); an open stop or ask
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
  // Slice 8 (d8-1): a paused run whose Resume is held behind another run of its feature.
  if (isObj(slice.heldResume) && Number.isInteger(slice.heldResume.after)) return { word: `after run ${slice.heldResume.after}`, mark: 'after' };
  // Slice 16 (D4): a paused run whose held resume was refused at its turn says why; the caller keeps dev's dot.
  if (state === 'paused' && isObj(slice.resumeRefused)) {
    const why = resumeWhy(slice.resumeRefused);
    if (why) return { word: why.charAt(0).toLowerCase() + why.slice(1), mark: null };
  }
  if (openAsk(slice) || (isObj(snap) && snap.pendingQuestion)) return { word: 'waiting for you', mark: 'ask' };
  if (FAILED.has(state)) return { word: 'failed', mark: 'failed' };
  if (NOT_STARTED.has(state)) {
    const named = namedWaits(slice, slices);
    // Slice 16 (H5): a run that can never start names the reduced list plus the run that can never finish, with its
    // cause; never next.
    if (slice.cannotStart) {
      const bad = isObj(slice.cannotStart) && Number.isInteger(slice.cannotStart.run) ? slice.cannotStart.run : null;
      const reason = bad != null && slice.cannotStart.reason ? ` (${slice.cannotStart.reason})` : '';
      const list = [...new Set(bad == null ? named : [...named, bad])].sort((a, b) => a - b);
      if (!list.length) return { word: 'cannot start', mark: 'faint' };
      const parts = list.map((d) => d + (d === bad ? reason : causeOf(slices.get(d))));
      return { word: `cannot start · ${waitsForRunWord(parts.join(', '))}`, mark: 'faint' };
    }
    if (named.length) return { word: waitsForRunWord(named.map((d) => d + causeOf(slices.get(d))).join(', ')), mark: 'faint' };
    if (slice.nextTurn === true) return { word: slice.kind === 'change' ? 'next · small change run' : 'next', mark: 'ring' };
    return { word: '', mark: 'ring' };
  }
  if (LIVE.has(state)) return { word: runShortWord(snap) || null, mark: 'live' };
  return { word: null, mark: null };
}

/**
 * Slice 8 (d8-5): a paused run's Resume label, the one home of its text: `Resume after run N` when its Resume would wait
 * for run N (the view's `resumeAfter`), else `Resume`.
 * @param {unknown} after
 * @returns {string}
 */
export function resumeLabel(after, { heldAfter } = {}) {
  if (Number.isInteger(heldAfter)) return 'Waiting for its turn';
  return Number.isInteger(after) ? `Resume after run ${after}` : 'Resume';
}

/** Slice 16 (D1): the word a run held for its turn reads on the group line. */
export const HELD_TURN_WORD = 'waiting for its turn';

const COST_ERRORS = new Set(['total cost limit reached', 'pipeline cost limit reached']);

/**
 * Slice 16 (D3): why a resume did not go on, derived from the reply of POST /api/resume (or a stored `resumeRefused`
 * record): `saving` and `turn` for a held reply, `clash` for TAKE_IN_REFUSED, `cost` for a budget refusal, else null.
 * @param {unknown} body
 * @returns {'saving'|'turn'|'clash'|'cost'|null}
 */
export function resumeCauseOf(body) {
  if (!isObj(body)) return null;
  if (body.held === true) return body.saving === true ? 'saving' : 'turn';
  if (body.code === 'TAKE_IN_REFUSED') return 'clash';
  if (body.budget || body.needsOverride || COST_ERRORS.has(body.error)) return 'cost';
  return null;
}

/**
 * Slice 16 (D3): the one text of a resume that did not go on, by its cause. '' for a non-object or a reply with
 * nothing to say.
 * @param {unknown} body
 * @returns {string}
 */
export function resumeWhy(body) {
  if (!isObj(body)) return '';
  const cause = resumeCauseOf(body);
  if (cause === 'saving') return `Run ${body.after} is still saving its work`;
  if (cause === 'turn') return `Run ${body.after} holds the turn`;
  if (cause === 'cost') return 'Not resumed: the cost limit is reached';
  if (typeof body.error === 'string' && body.error) return `Not resumed: ${body.error}`;
  return '';
}

/**
 * Slice 16 (D5): the toast of a press that did not go on, or null when there is nothing to say (the run went on, or a
 * `needsOverride` reply the cost confirm handles).
 * @param {unknown} body
 * @param {number} status
 * @returns {{tone: 'info'|'err', title: string, detail: string}|null}
 */
export function resumeNote(body, status) {
  if (!isObj(body) || body.needsOverride) return null;
  const cause = resumeCauseOf(body);
  if (cause === 'turn') return { tone: 'info', title: 'Waiting for its turn', detail: resumeWhy(body) };
  if (cause === 'saving') return { tone: 'info', title: 'Waiting', detail: resumeWhy(body) };
  if (Number.isInteger(status) && status >= 200 && status < 300) return null;
  const detail = resumeWhy(body);
  return detail ? { tone: 'err', title: 'Could not resume the run', detail } : null;
}

/** Slice 16 (D1): the "More ways to resume" note of a run held for its turn. */
export const heldResumeNote = (after) => `Waiting for its turn after run ${after}`;

/** Slice 16 (D9): the disabled reason of a held run's Resume. */
export const heldResumeTitle = (after) => `Goes on after run ${after}`;

/**
 * Slice 16 (D1): the `heldResume.after` of the view slice whose `pipelineId` is the member a Resume acts on. Null for
 * malformed input, an empty id, no match or a non-integer value. Mirrors resumeAfterOf.
 * @param {unknown} slices
 * @param {unknown} pipelineId
 * @returns {number|null}
 */
export function heldAfterOf(slices, pipelineId) {
  if (!Array.isArray(slices) || !pipelineId) return null;
  const s = slices.find((x) => isObj(x) && x.pipelineId === pipelineId);
  return s && isObj(s.heldResume) && Number.isInteger(s.heldResume.after) ? s.heldResume.after : null;
}

/**
 * Slice 11 (d11-3): the `resumeAfter` of the view slice whose `pipelineId` is the member a footer's Resume acts on, for
 * `resumeLabel`. Null for malformed input, an empty id, no match or a non-integer value. Pure; never throws.
 * @param {unknown} slices
 * @param {unknown} pipelineId
 * @returns {number|null}
 */
export function resumeAfterOf(slices, pipelineId) {
  if (!Array.isArray(slices) || !pipelineId) return null;
  const s = slices.find((x) => isObj(x) && x.pipelineId === pipelineId);
  return s && Number.isInteger(s.resumeAfter) ? s.resumeAfter : null;
}

/**
 * Slice 5 (D1): a feature's members as runStatus input, for the sidebar, the feature page and the run page. The
 * `position → slice` Map is built once from the members that carry a `slice` (an integer `position`); a member without a
 * `slice` object gives null. Pure; never reads a flag.
 * @param {Array<{position?: number, slice?: object, snap?: object|null}>} members
 * @returns {(member: object) => ({word: string|null, mark: string|null} | null)}
 */
export function memberStatusOf(members = []) {
  const slices = new Map();
  for (const mb of Array.isArray(members) ? members : []) {
    if (isObj(mb) && isObj(mb.slice) && Number.isInteger(mb.position)) slices.set(mb.position, mb.slice);
  }
  return (mb) => (isObj(mb) && isObj(mb.slice) ? runStatus({ slice: mb.slice, slices, snap: mb.snap || null }) : null);
}
