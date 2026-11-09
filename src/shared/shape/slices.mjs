// src/shared/shape/slices.mjs — Plan in slices (spec §3.8, D13–D15): the outline the Planner writes, its deterministic
// check, the outline card's edits and the prompt text. Browser-safe: the card imports it too.
import { isTestable } from './shape.mjs';
import { CRITERION_ID_RE } from '../review/coverage.mjs';

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
    out.push({ id, text: typeof a.text === 'string' ? a.text.trim().slice(0, AGREED_TEXT_MAX) : '' });
    if (out.length >= AGREED_MAX) break;
  }
  return out;
}

/** Each agreed id once: slices take theirs (the first slice wins), then the raw leftOut, then every id still unplaced
 *  with an empty reason. Mutates the normalised slices it is given. */
function placeRequirements(slices, rawSlices, rawLeftOut, agreed) {
  const known = new Set(agreed.map((a) => a.id));
  const taken = new Set();
  slices.forEach((s, i) => {
    s.requirements = uniq(strList(rawSlices[i]?.requirements, AGREED_MAX, 40)).filter((id) => known.has(id) && !taken.has(id));
    for (const id of s.requirements) taken.add(id);
  });
  const leftOut = [];
  for (const e of Array.isArray(rawLeftOut) ? rawLeftOut : []) {
    const id = typeof e?.id === 'string' ? e.id.trim() : '';
    if (!known.has(id) || taken.has(id)) continue;
    taken.add(id);
    leftOut.push({ id, reason: str(e.reason, LEFT_OUT_REASON_MAX) });
  }
  for (const a of agreed) if (!taken.has(a.id)) leftOut.push({ id: a.id, reason: '' });
  return leftOut;
}

/** The Planner's slices.json, tolerantly: untitled slices dropped, ids made unique, lists trimmed. With an agreed list
 *  (`opts.agreed`, else the outline's own `agreed`) the outline also carries `agreed`, `leftOut` and each slice's
 *  `requirements`, every agreed id exactly once; without one it has none of these keys.
 *  @returns {{ok:true, outline:{why:string, slices:Array, agreed?:Array, leftOut?:Array}}|{ok:false, error:string}} */
export function normalizeOutline(raw, opts = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.slices)) {
    return { ok: false, error: 'the outline has no "slices" array' };
  }
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
      dependsOn: strList(s.dependsOn, 12, 40),
      estimate: ESTIMATES.has(s.estimate) ? s.estimate : null,
    });
    kept.push(s);
    if (slices.length >= OUTLINE_SLICES_CAP) break;
  }
  if (!slices.length) return { ok: false, error: 'the outline has no slice with a title' };
  const agreed = agreedList(opts?.agreed ?? raw.agreed);
  if (!agreed.length) return { ok: true, outline: { why: str(raw.why, 600), slices } };
  const leftOut = placeRequirements(slices, kept, raw.leftOut, agreed);
  return { ok: true, outline: { why: str(raw.why, 600), slices, agreed, leftOut } };
}

/** The outline check (spec §3.8), in the checkShape result shape so the card reuses the check row.
 *  A failing item never blocks approval (every item is waivable). */
export function checkSlices(outline) {
  const slices = Array.isArray(outline?.slices) ? outline.slices : [];
  const n = slices.length;
  const items = [];
  const add = (id, pass, detail) => items.push({ id, label: SLICE_LABELS[id], pass, detail: pass ? '' : detail, waivable: true });

  const reason = words(outline?.why) >= WHY_MIN_WORDS;
  add('count', (n >= SLICES_PREFERRED.min && n <= SLICES_PREFERRED.max) || (n > SLICES_PREFERRED.max && n <= SLICES_HARD_MAX && reason),
    n < SLICES_PREFERRED.min ? 'One slice is no slicing: choose Don\'t slice'
      : n > SLICES_HARD_MAX ? `${n} slices: never more than ${SLICES_HARD_MAX}`
        : `${n} slices need a reason of at least one sentence in "why"`);

  const acc = slices.find((s) => !s.acceptance.length || s.acceptance.length > ACCEPTANCE_MAX || s.acceptance.some((a) => !isTestable(a)));
  const accWhy = !acc ? '' : !acc.acceptance.length ? `"${acc.title}" has no acceptance check`
    : acc.acceptance.length > ACCEPTANCE_MAX ? `"${acc.title}" has ${acc.acceptance.length} acceptance checks (at most ${ACCEPTANCE_MAX})`
      : `"${acc.acceptance.find((a) => !isTestable(a))}" has no measurable condition`;
  add('acceptance', !acc, accWhy);

  const layered = slices.find((s) => LAYER_RE.test(s.title) || (s.goal && LAYER_RE.test(s.goal)));
  add('notLayered', !layered, layered ? `"${layered.title}" is a layer, not a behaviour` : '');

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

/** The card's edit list: `[{op:'merge'|'remove', id}]`. */
export function normalizeEdits(raw) {
  if (raw === undefined || raw === null) return { ok: true, edits: [] };
  if (!Array.isArray(raw) || raw.length > OUTLINE_EDITS_MAX) return { ok: false, error: `edits must be a list of at most ${OUTLINE_EDITS_MAX}` };
  const edits = [];
  for (const e of raw) {
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
  let merges = 0;
  let removals = 0;
  for (const e of edits) {
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
  return { ok: true, outline: { ...outline, slices, ...(leftOut ? { leftOut } : {}) }, merges, removals };
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
export function slicingBlock({ file, size = null, requirements = false }) {
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
        + '"leftOut": [{"id": "R-ops-1", "reason": "…"}]}\n'
      : '"acceptance": ["…"], "dependsOn": [], "estimate": "small|medium|large"}]}\n')
    + '2. STOP immediately: do not write the plan. You will be resumed with the person\'s decision.\n\n'
    + 'Rules:\n'
    + '- Slice only where a reviewer would want a separate pull request.\n'
    + '- Slice by behaviour, never by layer. "The API", "the UI" and "the tests" are not slices.\n'
    + '- Every slice leaves the product working and shippable on its own (behind the feature flag while the feature '
    + 'is half-built) and has at least one acceptance check it can pass alone.\n'
    + '- Prefer 2–3 slices. More than 5 needs a written reason in "why"; never more than 8.\n'
    + '- No slice that only adds tests, docs, refactoring or setup, unless a later slice names it in "dependsOn" and '
    + 'it is at least medium-sized.\n'
    + '- Give each slice 1–6 acceptance checks, each one testable: name the command, value, file or behaviour that '
    + 'shows it.\n'
    + '- "dependsOn" names only earlier slices.\n'
    + (requirements ? '- Cut the slices by the agreed requirements in your requirements input: put every R-id in exactly '
      + 'one slice, or in leftOut with a reason.\n' : '')
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

export function outlineFeedbackBlock(feedback) {
  return '## Changes asked for the outline\n\n'
    + 'The person reviewing your outline asked for these changes. Rewrite the outline file and STOP again; do not '
    + `write the plan yet.\n\n${String(feedback).trim()}\n\n`;
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
      + `that no longer fits the code), write why, in a few sentences, to: ${outlineChangeFile}\n`
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
function satisfiesBlock(ids, agreed = []) {
  const text = new Map((agreed || []).map((a) => [a.id, a.text]));
  return `${satisfies(ids)}\n${ids.map((id) => `- **${id}** ${text.get(id) || ''}`.trimEnd()).join('\n')}\n\n`;
}

/** The task of a slice run (k ≥ 2, or a restarted slice): what its Clarify, Planner and title start from. */
export function sliceBrief({ featureTitle, outline, index }) {
  const s = outline.slices[index - 1];
  return `# ${featureTitle}: slice ${index} of ${outline.slices.length} — ${s.title}\n\n`
    + (s.goal ? `${s.goal}\n\n` : '')
    + (s.inScope.length ? `In scope:\n${s.inScope.map((x) => `- ${x}`).join('\n')}\n\n` : '')
    + (s.acceptance.length ? `Acceptance:\n${s.acceptance.map((x) => `- ${x}`).join('\n')}\n\n` : '')
    + (s.requirements?.length ? satisfiesBlock(s.requirements, outline.agreed) : '')
    + (s.outOfScope.length ? `Out of scope:\n${s.outOfScope.map((x) => `- ${x}`).join('\n')}\n\n` : '')
    + `This is one slice of an approved outline:\n\n${outlineMarkdown(outline, { current: index })}\n`;
}

/** Re-plan the rest (L9): the done slices and what is left. */
export function replanBrief({ featureTitle, outline, doneCount }) {
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
