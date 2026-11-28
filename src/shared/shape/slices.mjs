// src/shared/shape/slices.mjs — Plan in slices (spec §3.8, D13–D15): the outline the Planner writes, its deterministic
// check, the outline card's edits and the prompt text. Browser-safe: the card imports it too.
import { isTestable } from './shape.mjs';
import { CRITERION_ID_RE } from '../review/coverage.mjs';
import { roleKey, roleNames, CARE_LABELS, CONFIRM_ROLES } from './feature-record.mjs';

export const OUTLINE_FILE = 'slices.json';
/** D19: a later slice's Planner writes this (in the run's pipeline dir) when the slice cannot be built as outlined. */
export const OUTLINE_CHANGE_FILE = 'outline-change.md';
export const OUTLINE_ROUNDS_MAX = 3;
export const OUTLINE_EDITS_MAX = 20;
export const SLICES_PREFERRED = Object.freeze({ min: 2, max: 5 });
export const SLICES_HARD_MAX = 8;
export const ACCEPTANCE_MAX = 6;
export const WHY_MIN_WORDS = 4;            // "a why of at least one sentence"
const OUTLINE_SLICES_CAP = 12;             // what normalizeOutline keeps; `count` fails anything over 8
const ESTIMATES = new Set(['small', 'medium', 'large']);
const RANK = { small: 1, medium: 2, large: 3 };
// "only a layer": the whole title/goal is a layer name, optionally followed by layer/part/side/work/changes.
const LAYER_RE = /^(?:the\s+)?(?:back-?end|front-?end|apis?|ui|tests?|testing|docs?|documentation|database|db|schema|server|client|infra(?:structure)?)(?:\s+(?:layer|part|side|work|changes?))?[.!]?$/i;

export const SLICE_IDS = Object.freeze(['count', 'acceptance', 'notLayered', 'notTiny', 'order']);
export const SLICE_LABELS = Object.freeze({
  count: 'Two to five slices (six to eight need a reason)',
  acceptance: 'Every slice has 1–6 testable acceptance checks',
  notLayered: 'Slices are behaviours, not layers',
  notTiny: 'No two small slices side by side',
  order: 'Each slice depends only on earlier slices',
});

// Shaper small runs (A3): the rule set a caller picks with `{ smallRuns: true }`. This module never reads the flag.
export const SMALL_RUNS_MAX = 20;
export const BUILDS_ON_MAX = 12;
export const RUN_REQUIREMENTS_MAX = Object.freeze({ lean: 3, balanced: 3, thorough: 2 });
export const SMALL_RUNS_OUTLINE_CAP = 24;  // what normalizeOutline keeps with smallRuns; `runs` fails anything over 20
const ROLE_MAX = 60;
export const SMALL_RUN_IDS = Object.freeze(['runs', 'acceptance', 'notLayered', 'buildsOnEarlier', 'buildsOnMax',
  'requirementsPerRun', 'ownership', 'coverage', 'confirmRole']);
export const SMALL_RUN_LABELS = Object.freeze({
  runs: 'Two to 20 slices',
  acceptance: SLICE_LABELS.acceptance,
  notLayered: SLICE_LABELS.notLayered,
  buildsOnEarlier: 'Each slice builds on earlier slices only',
  buildsOnMax: 'Each slice builds on at most 12 slices',
  requirementsPerRun: 'Every slice owns 1 to 3 requirements (at most 2 under Thorough)',
  ownership: 'No requirement is owned twice',
  coverage: 'Every requirement is owned by a slice or confirmed by a person',
  confirmRole: 'Every confirmation names an allowed role',
});
const careOf = (care) => (Object.hasOwn(RUN_REQUIREMENTS_MAX, care) ? care : 'balanced');
/** The runs a Care position takes for `requirements`: ceil over its per-run cap (an unknown position uses Balanced's),
 *  or null without a positive integer count. The one place the formula lives: careEstimates and the Start card share it. */
export const careRunCount = (requirements, position) => (Number.isInteger(requirements) && requirements > 0
  ? Math.ceil(requirements / RUN_REQUIREMENTS_MAX[careOf(position)]) : null);

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strList = (v, max = 12, len = 300) => (Array.isArray(v) ? v : []).map((s) => str(s, len)).filter(Boolean).slice(0, max);
const uniq = (xs) => [...new Set(xs)];
const words = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;

/** The agreed requirements an outline carries (bounded: they are copied into every slice ticket). */
const AGREED_MAX = 64;
const AGREED_TEXT_MAX = 300;
const LEFT_OUT_REASON_MAX = 200;
export const REQUIREMENTS_ROW_LABEL = 'Every agreed requirement is in one slice or left out with a reason';
export const LEFT_OUT_REMOVED = 'Removed from the outline';
export const LEFT_OUT_NOT_PLACED = 'Not placed in a slice when the outline was approved';

function agreedList(raw) {
  const out = [];
  const seen = new Set();
  for (const a of Array.isArray(raw) ? raw : []) {
    const id = typeof a?.id === 'string' ? a.id.trim() : '';
    if (!CRITERION_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    // One line under its criterion in the brief: its line breaks collapse to spaces.
    const example = typeof a.example === 'string' ? a.example.replace(/\s+/g, ' ').trim().slice(0, AGREED_TEXT_MAX) : '';
    out.push({ id, text: typeof a.text === 'string' ? a.text.trim().slice(0, AGREED_TEXT_MAX) : '', ...(example ? { example } : {}) });
    if (out.length >= AGREED_MAX) break;
  }
  return out;
}

/** Each agreed id once: slices take theirs (the first slice wins), then the raw leftOut, then every id still unplaced
 *  with an empty reason. Mutates the normalised slices it is given. With `smallRuns` a slice dedupes only its own ids
 *  (so the check sees a double owner), confirmed ids are taken too, and `confirmed` is returned alongside. */
function placeRequirements(slices, rawSlices, rawLeftOut, agreed, { smallRuns = false, rawConfirmed } = {}) {
  const known = new Set(agreed.map((a) => a.id));
  const taken = new Set();
  slices.forEach((s, i) => {
    s.requirements = uniq(strList(rawSlices[i]?.requirements, AGREED_MAX, 40)).filter((id) => known.has(id) && (smallRuns || !taken.has(id)));
    for (const id of s.requirements) taken.add(id);
  });
  const confirmed = [];
  if (smallRuns) {
    const seen = new Set();
    for (const e of Array.isArray(rawConfirmed) ? rawConfirmed : []) {
      const id = typeof e?.id === 'string' ? e.id.trim() : '';
      if (!known.has(id) || seen.has(id)) continue;
      seen.add(id);
      confirmed.push({ id, role: str(e.role, ROLE_MAX) });
    }
    for (const e of confirmed) taken.add(e.id);
  }
  const leftOut = [];
  for (const e of Array.isArray(rawLeftOut) ? rawLeftOut : []) {
    const id = typeof e?.id === 'string' ? e.id.trim() : '';
    if (!known.has(id) || taken.has(id)) continue;
    taken.add(id);
    leftOut.push({ id, reason: str(e.reason, LEFT_OUT_REASON_MAX) });
  }
  for (const a of agreed) if (!taken.has(a.id)) leftOut.push({ id: a.id, reason: '' });
  return smallRuns ? { leftOut, confirmed } : leftOut;
}

/** The Planner's slices.json, tolerantly: untitled slices dropped, ids made unique, lists trimmed. With an agreed list
 *  (`opts.agreed`, else the outline's own `agreed`) the outline also carries `agreed`, `leftOut` and each slice's
 *  `requirements`, every agreed id exactly once; without one it has none of these keys.
 *  @returns {{ok:true, outline:{why:string, slices:Array, agreed?:Array, leftOut?:Array}}|{ok:false, error:string}} */
export function normalizeOutline(raw, opts = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.slices)) {
    return { ok: false, error: 'the outline has no "slices" array' };
  }
  const smallRuns = opts?.smallRuns === true;
  const seen = new Set();
  const slices = [];
  const kept = [];
  for (const s of raw.slices) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) continue;
    const title = str(s.title, 120);
    if (!title) continue;
    const base = str(s.id, 40).replace(/[^A-Za-z0-9_-]/g, '') || `s${slices.length + 1}`;
    let id = base;
    for (let n = 2; seen.has(id); n++) id = `${base}-${n}`;
    seen.add(id);
    slices.push({
      id, title, goal: str(s.goal, 400),
      inScope: strList(s.inScope), outOfScope: strList(s.outOfScope), acceptance: strList(s.acceptance),
      dependsOn: strList(s.dependsOn, smallRuns ? SMALL_RUNS_OUTLINE_CAP : 12, 40),
      estimate: ESTIMATES.has(s.estimate) ? s.estimate : null,
    });
    kept.push(s);
    if (slices.length >= (smallRuns ? SMALL_RUNS_OUTLINE_CAP : OUTLINE_SLICES_CAP)) break;
  }
  if (!slices.length) return { ok: false, error: 'the outline has no slice with a title' };
  const agreed = agreedList(opts?.agreed ?? raw.agreed);
  if (!agreed.length) return { ok: true, outline: { why: str(raw.why, 600), slices } };
  if (!smallRuns) {
    const leftOut = placeRequirements(slices, kept, raw.leftOut, agreed);
    return { ok: true, outline: { why: str(raw.why, 600), slices, agreed, leftOut } };
  }
  const { leftOut, confirmed } = placeRequirements(slices, kept, raw.leftOut, agreed, { smallRuns, rawConfirmed: raw.confirmed });
  return { ok: true, outline: { why: str(raw.why, 600), slices, agreed, leftOut, ...(confirmed.length ? { confirmed } : {}) } };
}

/** `acceptance` as [pass, detail]: shared by dev's rules and the small-runs rules. */
function acceptanceCheck(slices) {
  const acc = slices.find((s) => !s.acceptance.length || s.acceptance.length > ACCEPTANCE_MAX || s.acceptance.some((a) => !isTestable(a)));
  const accWhy = !acc ? '' : !acc.acceptance.length ? `"${acc.title}" has no acceptance check`
    : acc.acceptance.length > ACCEPTANCE_MAX ? `"${acc.title}" has ${acc.acceptance.length} acceptance checks (at most ${ACCEPTANCE_MAX})`
      : `"${acc.acceptance.find((a) => !isTestable(a))}" has no measurable condition`;
  return [!acc, accWhy];
}

/** `notLayered` as [pass, detail]. */
function layerCheck(slices) {
  const layered = slices.find((s) => LAYER_RE.test(s.title) || (s.goal && LAYER_RE.test(s.goal)));
  return [!layered, layered ? `"${layered.title}" is a layer, not a behaviour` : ''];
}

/** The rows stating the fixed rule (every requirement owned by exactly one slice or confirmed by a person): never
 *  waivable, passing or failing (owner direction, 2026-11-20). The Split step's gate (B4, `splitApprovable`) reads it. */
const NOT_WAIVABLE = new Set(['ownership', 'coverage', 'confirmRole']);

/** The small-runs rules (A3), in SMALL_RUN_IDS order; the four requirement rows only with an agreed list. Ownership is
 *  counted from each slice's own `requirements`, never trusting that normalisation removed duplicates. */
function checkSmallRuns(outline, care) {
  const slices = Array.isArray(outline?.slices) ? outline.slices : [];
  const n = slices.length;
  const items = [];
  const add = (id, pass, detail) => items.push({ id, label: SMALL_RUN_LABELS[id], pass, detail: pass ? '' : detail,
    waivable: !NOT_WAIVABLE.has(id) });
  // B4 (D11): the non-waivable rows list one failure per failing requirement id; `detail` is their joined text.
  const addEach = (id, failures) => items.push({ id, label: SMALL_RUN_LABELS[id], pass: !failures.length,
    detail: failures.map((f) => f.text).join('; '), waivable: false, failures });

  add('runs', n >= 2 && n <= SMALL_RUNS_MAX,
    n < 2 ? 'One slice is no slicing: choose Don\'t slice' : `${n} slices: never more than ${SMALL_RUNS_MAX}`);
  add('acceptance', ...acceptanceCheck(slices));
  add('notLayered', ...layerCheck(slices));

  const pos = new Map(slices.map((s, i) => [s.id, i]));
  let bad = null;
  outer: for (const [i, s] of slices.entries()) {
    for (const d of s.dependsOn) {
      const j = pos.get(d);
      if (j === undefined || j >= i) { bad = { s, d, known: j !== undefined }; break outer; }
    }
  }
  add('buildsOnEarlier', !bad, !bad ? '' : bad.known ? `${bad.s.id} builds on ${bad.d}, which is not an earlier slice`
    : `${bad.s.id} builds on "${bad.d}", which is not in the outline`);
  const wide = slices.find((s) => s.dependsOn.length > BUILDS_ON_MAX);
  add('buildsOnMax', !wide, wide ? `${wide.id} builds on ${wide.dependsOn.length} slices (at most ${BUILDS_ON_MAX})` : '');

  if (outline?.agreed?.length) {
    const c = careOf(care);
    const cap = RUN_REQUIREMENTS_MAX[c];
    const owned = (s) => (Array.isArray(s.requirements) ? s.requirements : []);
    const off = slices.find((s) => owned(s).length < 1 || owned(s).length > cap);
    add('requirementsPerRun', !off, !off ? '' : !owned(off).length ? `${off.id} owns no requirement`
      : `${off.id} owns ${owned(off).length} requirements (1 to ${cap} under ${CARE_LABELS[c]})`);

    const agreedIds = outline.agreed.map((a) => a.id);
    const known = new Set(agreedIds);
    const owners = new Map();
    for (const s of slices) for (const id of owned(s)) owners.set(id, [...(owners.get(id) || []), s.id]);
    const confirmed = new Map();
    for (const e of Array.isArray(outline.confirmed) ? outline.confirmed : []) {
      if (known.has(e?.id) && !confirmed.has(e.id)) confirmed.set(e.id, typeof e.role === 'string' ? e.role.trim() : '');
    }
    const twice = agreedIds.filter((id) => (owners.get(id)?.length || 0) + (confirmed.has(id) ? 1 : 0) > 1);
    const join = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0]);
    addEach('ownership', twice.map((id) => ({ id, text: `${id} is owned by ${join(owners.get(id) || [])}`
      + (confirmed.has(id) ? ` and confirmed by ${confirmed.get(id)}` : '') })));
    const uncovered = agreedIds.filter((id) => !owners.has(id) && !confirmed.has(id));
    addEach('coverage', uncovered.map((id) => ({ id, text: `${id} is not owned by a slice or confirmed by a person` })));
    const wrong = [...confirmed].filter(([, role]) => roleKey(role) === null);
    addEach('confirmRole', wrong.map(([id, role]) => ({ id, text: `${id}: "${role}" cannot confirm a requirement. Pick ${roleNames()}.` })));
  }

  return { ok: items.every((i) => i.pass), items, passed: items.filter((i) => i.pass).length, total: items.length };
}

/** The outline check (spec §3.8), in the checkShape result shape so the card reuses the check row.
 *  Dev's items are all waivable; with `smallRuns`, ownership, coverage and confirmRole carry `waivable: false` and
 *  `failures` (one per failing id), and the server refuses an approve that fails them (B4). */
export function checkSlices(outline, opts = {}) {
  if (opts?.smallRuns === true) return checkSmallRuns(outline, opts.care);
  const slices = Array.isArray(outline?.slices) ? outline.slices : [];
  const n = slices.length;
  const items = [];
  const add = (id, pass, detail) => items.push({ id, label: SLICE_LABELS[id], pass, detail: pass ? '' : detail, waivable: true });

  const reason = words(outline?.why) >= WHY_MIN_WORDS;
  add('count', (n >= SLICES_PREFERRED.min && n <= SLICES_PREFERRED.max) || (n > SLICES_PREFERRED.max && n <= SLICES_HARD_MAX && reason),
    n < SLICES_PREFERRED.min ? 'One slice is no slicing: choose Don\'t slice'
      : n > SLICES_HARD_MAX ? `${n} slices: never more than ${SLICES_HARD_MAX}`
        : `${n} slices need a reason of at least one sentence in "why"`);

  add('acceptance', ...acceptanceCheck(slices));
  add('notLayered', ...layerCheck(slices));

  let tiny = -1;
  for (let i = 0; i + 1 < n; i++) if (slices[i].estimate === 'small' && slices[i + 1].estimate === 'small') { tiny = i; break; }
  add('notTiny', tiny < 0, tiny >= 0 ? `Slices ${tiny + 1} and ${tiny + 2} are both small: merge them` : '');

  const pos = new Map(slices.map((s, i) => [s.id, i]));
  let bad = null;
  outer: for (const [i, s] of slices.entries()) {
    for (const d of s.dependsOn) {
      const j = pos.get(d);
      if (j === undefined || j >= i) { bad = { s, d, known: j !== undefined }; break outer; }
    }
  }
  add('order', !bad, !bad ? '' : bad.known ? `${bad.s.id} depends on ${bad.d}, which is not an earlier slice`
    : `${bad.s.id} depends on "${bad.d}", which is not in the outline`);

  if (outline?.agreed?.length) {
    const unplaced = (Array.isArray(outline.leftOut) ? outline.leftOut : []).filter((e) => !e.reason).map((e) => e.id);
    items.push({ id: 'requirements', label: REQUIREMENTS_ROW_LABEL, pass: !unplaced.length,
      detail: unplaced.length ? `${unplaced.join(', ')} ${unplaced.length === 1 ? 'is' : 'are'} in no slice` : '', waivable: true });
  }

  return { ok: items.every((i) => i.pass), items, passed: items.filter((i) => i.pass).length, total: items.length };
}

/** The card's edit list: `[{op:'merge'|'remove', id}]`. With `confirm` (small runs, B4 D13) also
 *  `{op:'confirm', id, role}`: "Ask the role to confirm" on a confirmRole row. */
export function normalizeEdits(raw, { confirm = false } = {}) {
  if (raw === undefined || raw === null) return { ok: true, edits: [] };
  if (!Array.isArray(raw) || raw.length > OUTLINE_EDITS_MAX) return { ok: false, error: `edits must be a list of at most ${OUTLINE_EDITS_MAX}` };
  const edits = [];
  for (const e of raw) {
    if (confirm && e?.op === 'confirm') {
      if (typeof e.id !== 'string' || !e.id || typeof e.role !== 'string' || !e.role.trim()) return { ok: false, error: 'a confirm edit is {op:"confirm", id, role}' };
      edits.push({ op: 'confirm', id: e.id, role: e.role.trim().slice(0, ROLE_MAX) });
      continue;
    }
    if (!e || (e.op !== 'merge' && e.op !== 'remove') || typeof e.id !== 'string' || !e.id) return { ok: false, error: 'each edit is {op:"merge"|"remove", id}' };
    edits.push({ op: e.op, id: e.id });
  }
  return { ok: true, edits };
}

function mergeTwo(a, b) {
  const estimate = a.estimate === 'small' && b.estimate === 'small' ? 'medium'
    : (RANK[a.estimate] || 0) >= (RANK[b.estimate] || 0) ? (a.estimate || b.estimate) : b.estimate;
  return {
    id: a.id, title: `${a.title} + ${b.title}`.slice(0, 120), goal: [a.goal, b.goal].filter(Boolean).join(' ').slice(0, 400),
    inScope: uniq([...a.inScope, ...b.inScope]), outOfScope: uniq([...a.outOfScope, ...b.outOfScope]),
    acceptance: uniq([...a.acceptance, ...b.acceptance]),
    dependsOn: uniq([...a.dependsOn, ...b.dependsOn]).filter((d) => d !== a.id && d !== b.id),
    estimate,
    ...(a.requirements || b.requirements ? { requirements: uniq([...(a.requirements || []), ...(b.requirements || [])]) } : {}),
  };
}

/** Merge with next / Remove, in order. Pure: the card previews with it and the engine re-applies it (L4).
 *  @returns {{ok:true, outline, merges:number, removals:number}|{ok:false, error:string}} */
export function applyOutlineEdits(outline, edits = []) {
  let slices = outline.slices.map((s) => ({ ...s, dependsOn: [...s.dependsOn] }));
  const leftOut = outline.agreed?.length ? (outline.leftOut || []).map((e) => ({ ...e })) : null;
  let confirmed = Array.isArray(outline.confirmed) ? outline.confirmed.map((c) => ({ ...c })) : null;
  let merges = 0;
  let removals = 0;
  for (const e of edits) {
    if (e.op === 'confirm') {
      // D13: only re-names the role of an id that already has a confirmed entry; coverage and ownership clear through
      // Ask for changes.
      const at = confirmed ? confirmed.findIndex((c) => c.id === e.id) : -1;
      if (at < 0) return { ok: false, error: `${e.id} has no confirmation to change` };
      if (roleKey(e.role) === null) return { ok: false, error: `"${e.role}" cannot confirm a requirement. Pick ${roleNames()}.` };
      confirmed = confirmed.map((c, k) => (k === at ? { ...c, role: CONFIRM_ROLES.find((r) => r.key === roleKey(e.role)).label } : c));
      continue;
    }
    const i = slices.findIndex((s) => s.id === e.id);
    if (i < 0) return { ok: false, error: `there is no slice "${e.id}"` };
    if (e.op === 'merge') {
      if (i + 1 >= slices.length) return { ok: false, error: `"${slices[i].title}" is the last slice: there is nothing after it to merge` };
      const gone = slices[i + 1].id;
      slices.splice(i, 2, mergeTwo(slices[i], slices[i + 1]));
      slices = slices.map((s) => ({ ...s, dependsOn: uniq(s.dependsOn.map((d) => (d === gone ? e.id : d))).filter((d) => d !== s.id) }));
      merges += 1;
    } else {
      if (slices.length <= 1) return { ok: false, error: 'the last slice cannot be removed: choose Don\'t slice' };
      const gone = slices[i].id;
      if (leftOut) for (const id of slices[i].requirements || []) leftOut.push({ id, reason: LEFT_OUT_REMOVED });
      slices.splice(i, 1);
      slices = slices.map((s) => ({ ...s, dependsOn: s.dependsOn.filter((d) => d !== gone) }));
      removals += 1;
    }
  }
  return { ok: true, outline: { ...outline, slices, ...(leftOut ? { leftOut } : {}), ...(confirmed ? { confirmed } : {}) }, merges, removals };
}

/** Small runs: the Planner's parsed outline file with each `kept` requirement ({id, role key}) confirmed by its kept role,
 *  once: it leaves every slice and leftOut, whatever the Planner wrote. Other ids are untouched; a malformed file is
 *  returned as is. Pure. */
export function keepConfirmed(raw, kept) {
  const roles = new Map((Array.isArray(kept) ? kept : []).map((k) => [k.id, roleLabelOf(k.role)]));
  if (!roles.size || !raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.slices)) return raw;
  const isKept = (id) => typeof id === 'string' && roles.has(id.trim());
  const without = (list) => list.filter((e) => !isKept(e && typeof e === 'object' ? e.id : e));
  return { ...raw,
    slices: raw.slices.map((s) => (s && Array.isArray(s.requirements) ? { ...s, requirements: without(s.requirements) } : s)),
    ...(Array.isArray(raw.leftOut) ? { leftOut: without(raw.leftOut) } : {}),
    confirmed: [...without(Array.isArray(raw.confirmed) ? raw.confirmed : []), ...[...roles].map(([id, role]) => ({ id, role }))] };
}

/** The approved outline's left-out ids, each with a reason: an id no slice placed is left out as not placed. Identity
 *  without an agreed list. */
export function settleLeftOut(outline) {
  if (!outline?.agreed?.length) return outline;
  return { ...outline, leftOut: (outline.leftOut || []).map((e) => (e.reason ? e : { ...e, reason: LEFT_OUT_NOT_PLACED })) };
}

/** The agreed ids one slice satisfies (`slice` is a ticket's shape.slice: {index, outline}). */
export const sliceRequirementIds = (slice) => slice?.outline?.slices?.[slice.index - 1]?.requirements || [];

const satisfies = (ids) => `Satisfies: ${ids.join(', ')}`;

const bullet = (xs) => xs.map((x) => `  - ${x}`).join('\n');

/** The outline as Markdown, for prompts and briefs. `current` (1-based) marks one slice. */
export function outlineMarkdown(outline, { current = 0 } = {}) {
  return outline.slices.map((s, i) => [
    `${i + 1}. **${s.title}**${current === i + 1 ? ' ← this slice' : ''}${s.estimate ? ` (${s.estimate})` : ''}`,
    s.goal ? `   Goal: ${s.goal}` : '',
    s.acceptance.length ? `   Acceptance:\n${bullet(s.acceptance)}` : '',
    s.outOfScope.length ? `   Out of scope:\n${bullet(s.outOfScope)}` : '',
    s.requirements?.length ? `   ${satisfies(s.requirements)}` : '',
  ].filter(Boolean).join('\n')).join('\n');
}

/** The Planner's slicing block (L2). '' is never returned here: the caller decides whether slicing is offered. */
export function slicingBlock({ file, size = null, requirements = false, smallRuns = false, care = 'balanced' }) {
  const perRun = RUN_REQUIREMENTS_MAX[careOf(care)];
  return '## Plan in slices\n\n'
    + 'Before you write any plan, decide whether this task should be cut into slices: sequential pull requests, each '
    + 'built, reviewed and shipped on its own. Cut it only when the task is large: it changes 3 or more subsystems, or '
    + 'the request asks for slices.' + (size === 'large' ? ' This task was judged large.' : '')
    + ' Otherwise write the plan as usual: one slice means no slicing, and that is a good answer.\n\n'
    + 'If you cut it:\n'
    + `1. Write the outline as JSON to: ${file}\n`
    + '   {"why": "…", "slices": [{"id": "s1", "title": "…", "goal": "…", "inScope": ["…"], "outOfScope": ["…"], '
    + (requirements
      ? '"acceptance": ["…"], "dependsOn": [], "estimate": "small|medium|large", "requirements": ["R-po-1"]}], '
        + '"leftOut": [{"id": "R-ops-1", "reason": "…"}]'
        + (smallRuns ? ', "confirmed": [{"id": "R-sec-1", "role": "Security"}]' : '') + '}\n'
      : '"acceptance": ["…"], "dependsOn": [], "estimate": "small|medium|large"}]}\n')
    + '2. STOP immediately: do not write the plan. You will be resumed with the person\'s decision.\n\n'
    + 'Rules:\n'
    + '- Slice only where a reviewer would want a separate pull request.\n'
    + '- Slice by behaviour, never by layer. "The API", "the UI" and "the tests" are not slices.\n'
    + '- Every slice leaves the product working and shippable on its own (behind the feature flag while the feature '
    + 'is half-built) and has at least one acceptance check it can pass alone.\n'
    + (smallRuns ? `- Prefer small slices: at most ${SMALL_RUNS_MAX}; each owns 1 to ${perRun} agreed requirements.\n`
      : '- Prefer 2–3 slices. More than 5 needs a written reason in "why"; never more than 8.\n')
    + '- No slice that only adds tests, docs, refactoring or setup, unless a later slice names it in "dependsOn" and '
    + 'it is at least medium-sized.\n'
    + '- Give each slice 1–6 acceptance checks, each one testable: name the command, value, file or behaviour that '
    + 'shows it.\n'
    + (smallRuns ? `- "dependsOn" names only earlier slices, at most ${BUILDS_ON_MAX}.\n` : '- "dependsOn" names only earlier slices.\n')
    + (requirements ? '- Cut the slices by the agreed requirements in your requirements input: put every R-id in exactly '
      + (smallRuns ? `one slice, or in confirmed with one of: ${roleNames()}.\n` : 'one slice, or in leftOut with a reason.\n') : '')
    + '\n';
}

/** The outline card's Fix text (plan-text.mjs's fixFeedback names the plan, not the outline). */
export function outlineFixFeedback(item) {
  return `The outline check fails "${item.label}"${item.detail ? `: ${item.detail}` : ''}. Rewrite the outline so this check passes.`;
}

/** The outline card's one Fix all (D32); a single failure reads as outlineFixFeedback, so it posts what Fix posted. */
export function outlineFixAllFeedback(items) {
  const bad = (Array.isArray(items) ? items : []).filter((it) => it && !it.pass);
  if (bad.length === 1) return outlineFixFeedback(bad[0]);
  return `The outline check fails ${bad.length} checks:\n${bad.map((it) => `- "${it.label}"${it.detail ? `: ${it.detail}` : ''}`).join('\n')}\n`
    + 'Rewrite the outline so these checks pass.';
}

/** Small runs B4 (D12): every failing (rule, id) of a `waivable: false` row of the outline plus the edits under `rules`,
 *  the one gate the server (split-step.mjs splitApprovable) and the card (step-card.mjs splitRefused) share.
 *  `error` when the edits do not apply. */
export function splitBlockers(outline, edits = [], rules = {}) {
  const applied = applyOutlineEdits(outline, edits || []);
  if (!applied.ok) return { ok: false, failing: [], error: applied.error };
  const check = checkSlices(settleLeftOut(applied.outline), rules || {});
  const failing = check.items.filter((i) => i.waivable === false && !i.pass)
    .flatMap((i) => (i.failures || []).map((f) => ({ rule: i.id, id: f.id, text: f.text })));
  return { ok: !failing.length, failing };
}

/** Small runs B4 (D9, D14): open objections as the Planner's revise feedback, one line each ({ label, ids?, fix }). */
export function objectionFeedback(open) {
  return 'The roles challenged the split. Address each objection in the outline:\n'
    + (open || []).map((o) => `- ${o.label}${o.ids?.length ? ` (${o.ids.join(', ')})` : ''}: ${o.fix}`).join('\n');
}

export function outlineFeedbackBlock(feedback) {
  return '## Changes asked for the outline\n\n'
    + 'The outline you wrote is still in the outline file. Edit it to address these changes, keep what they do not '
    + `touch, and STOP again; do not write the plan yet.\n\n${String(feedback).trim()}\n\n`;
}

// Neutral wording: the note also reaches later Planner executions (a Refine revise, a resume), and `decided:'flat'`
// can come from the Planner itself (no outline after a revise), not only from Don't slice.
export const FLAT_NOTE = '## Do not slice\n\nThis task is planned as one, without slices. Write the complete plan '
  + 'to your plan output as usual. Do not write an outline.\n\n';

/** Planner and Refine of slice k (L6). `earlier`: [{index, title, summary, files:string[], more:number}]. */
export function sliceScopeBlock({ index, total, outline, earlier = [], refiner = false, outlineChangeFile = null, notes = [] }) {
  const s = outline.slices[index - 1] || { title: `slice ${index}` };
  const done = earlier.length
    ? '\nWhat the earlier slices changed (they are merged into the code you see, or on its base branch):\n'
      + earlier.map((e) => `- Slice ${e.index}, ${e.title}: ${e.summary || 'no review summary'}`
        + (e.files.length ? `\n  Files: ${e.files.map((f) => `\`${f}\``).join(', ')}${e.more ? ` (+${e.more} more)` : ''}` : '')).join('\n') + '\n'
    : '';
  // Shaper s5 (D12): what the chat added to this run ("Add to the feature"); the Planner plans it in.
  const asked = !refiner && notes.some((n) => n.kind === 'plan')
    ? '\nChanges asked in the chat for this run (plan them in; if one changes the split, say so in the outline-change file):\n'
      + notes.filter((n) => n.kind === 'plan').map((n) => `- ${n.text}`).join('\n') + '\n'
    : '';
  const change = !refiner && outlineChangeFile
    ? `\nIf slice ${index} cannot be built as the outline describes (a prerequisite an earlier slice did not deliver, a split `
      + `that no longer fits the code), write why to: ${outlineChangeFile}\n`
      + 'Make the first line the reason in one sentence, with no heading. Then give the detail in a few short paragraphs, '
      + 'with file names in backticks and a list when it names several files.\n'
      + 'Then plan what can be built. Write that file only in that case: when it exists, a person reviews your plan before '
      + 'anything is built.\n'
    : '';
  return `## This is slice ${index} of ${total}\n\n`
    + 'The approved outline:\n\n' + outlineMarkdown(outline, { current: index }) + '\n\n'
    + (refiner
      ? `Judge the plan for slice ${index} only ("${s.title}"). Later slices are out of scope: do not flag their work as missing.\n`
      : `Write the plan for slice ${index} only ("${s.title}"). Later slices are out of scope: do not plan them.\n`)
    + done + asked + change + '\n';
}

/** The slice's agreed criteria: the Satisfies line, then one criterion line per id (what the slice run checks). */
function satisfiesBlock(ids, agreed = [], { testsFirst = false } = {}) {
  const byId = new Map((agreed || []).map((a) => [a.id, a]));
  // Small runs C2 (D11): an agreed example prints under its criterion; a Care plan without a Test writer adds one line.
  const line = (id) => {
    const a = byId.get(id);
    const item = `- **${id}** ${a?.text || ''}`.trimEnd();
    return a?.example ? `${item}\n  Example: ${a.example}` : item;
  };
  const lean = testsFirst === true && ids.some((id) => byId.get(id)?.example) ? 'Write the tests for these examples first, then the code.\n' : '';
  return `${satisfies(ids)}\n${ids.map(line).join('\n')}\n${lean}\n`;
}

/** The task of a slice run (k ≥ 2, or a restarted slice): what its Clarify, Planner and title start from. */
export function sliceBrief({ featureTitle, outline, index, testsFirst = false }) {
  const s = outline.slices[index - 1];
  return `# ${featureTitle}: slice ${index} of ${outline.slices.length} — ${s.title}\n\n`
    + (s.goal ? `${s.goal}\n\n` : '')
    + (s.inScope.length ? `In scope:\n${s.inScope.map((x) => `- ${x}`).join('\n')}\n\n` : '')
    + (s.acceptance.length ? `Acceptance:\n${s.acceptance.map((x) => `- ${x}`).join('\n')}\n\n` : '')
    + (s.requirements?.length ? satisfiesBlock(s.requirements, outline.agreed, { testsFirst }) : '')
    + (s.outOfScope.length ? `Out of scope:\n${s.outOfScope.map((x) => `- ${x}`).join('\n')}\n\n` : '')
    + `This is one slice of an approved outline:\n\n${outlineMarkdown(outline, { current: index })}\n`;
}

/** A list item that names a requirement (coverage.mjs ITEM_RE), so the brief's own list stays the only one. */
const REQ_ITEM_RE = /^(\s*-\s+)(?:\*\*(R-[a-z]{1,8}-\d+)\*\*|\[[ xX]\]\s+(R-[a-z]{1,8}-\d+))/gm;
const flat = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
const roleLabelOf = (role) => CONFIRM_ROLES.find((r) => r.key === roleKey(role))?.label || String(role);

/** The carried requirements as the run's own list: an id line each, its example under it, and who confirms which. */
function carriedBlock({ agreed, confirmed = [] }) {
  const lines = agreed.map((a) => `- **${a.id}** ${flat(a.text)}`.trimEnd() + (a.example ? `\n  Example: ${flat(a.example)}` : '')).join('\n');
  const kept = confirmed.map((c) => `${c.id} (${roleLabelOf(c.role)})`).join(', ');
  return `## Agreed requirements\n\n${lines}\n\n`
    + (kept ? `A person confirms ${kept}: if you slice, keep each one in "confirmed" with that role.\n\n` : '');
}

/** Re-plan the rest (L9): the done slices and what is left. `carried` (small runs: features.mjs carriedRequirements):
 *  the requirements no finished run owns become the run's agreed list, and the done slices are `carried.done` (a
 *  small-runs feature can finish out of order); without it the brief is dev's. */
export function replanBrief({ featureTitle, outline, doneCount, carried = null }) {
  if (carried) {
    const isDone = (i) => carried.done.includes(i + 1);
    const done = outline.slices.map((s, i) => (isDone(i) ? `${i + 1}. ${flat(s.title)}` : null)).filter(Boolean).join('\n') || '(none)';
    const rest = { ...outline, slices: outline.slices.filter((_, i) => !isDone(i)) };
    return `# ${flat(featureTitle)}: re-plan the rest\n\n`
      + `These slices are done and merged into the base this run starts from:\n${done}\n\n`
      + carriedBlock(carried)
      + `Plan what is left, in slices if it is still large. The earlier outline for the rest was:\n\n${outlineMarkdown(rest).replace(REQ_ITEM_RE, '$1$2$3')}\n`;
  }
  const done = outline.slices.slice(0, doneCount).map((s, i) => `${i + 1}. ${s.title}`).join('\n') || '(none)';
  const rest = { ...outline, slices: outline.slices.slice(doneCount) };
  return `# ${featureTitle}: re-plan the rest\n\n`
    + `These slices are done and merged into the base this run starts from:\n${done}\n\n`
    + `Plan what is left, in slices if it is still large. The earlier outline for the rest was:\n\n${outlineMarkdown(rest)}\n`;
}

/** D25: insert one feature's entry at the top of `## Unreleased` (created after the first `# ` heading, else at the
 *  top). A text whose Unreleased section already has this feature's heading comes back unchanged (a retried ship). */
export function changelogWithFeature(text, { title, slices }) {
  const firstSentence = (s) => String(s || '').split(/(?<=[.!?])\s/)[0].trim();
  const entry = `### ${title}\n\n${slices.map((s) => `- ${s.title}${s.summary ? `: ${firstSentence(s.summary)}` : ''}`).join('\n')}\n`;
  let src = String(text || '');
  if (src && !src.endsWith('\n')) src += '\n';           // a last line without a newline still matches the regexes below
  const m = /^## Unreleased[^\n]*\n/m.exec(src);
  if (m) {
    const rest = src.slice(m.index + m[0].length);
    const section = rest.slice(0, (/^## /m.exec(rest) || { index: rest.length }).index);
    if (section.split('\n').includes(`### ${title}`)) return String(text || '');
    return `${src.slice(0, m.index + m[0].length)}\n${entry}${rest.replace(/^\n?/, '\n')}`;
  }
  const h1 = /^# [^\n]*\n/m.exec(src);
  const at = h1 ? h1.index + h1[0].length : 0;
  const head = src.slice(0, at) || '# Changelog\n';
  return `${head}\n## Unreleased\n\n${entry}${src.slice(at) ? `\n${src.slice(at).replace(/^\n+/, '')}` : ''}`;
}
