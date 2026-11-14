// Fake C-5 frames and C-6 bridge messages for the Design stage model (ui/public/design/stage-model.mjs), each shaped
// exactly as P2 and P3 send it, so the model is never fitted to a shape the server does not emit:
//   envelope   frames.mjs `stamp`: {type, designId, buildId, seq, ts}; here `seq` counts up from 1 per module load
//   stats      build.mjs `_stats`: the 10 keys of `design-build.stats`
//   build      build.mjs `_buildFields`: {status, round, kind, reason, waiting, stats}
//   plan       build.mjs `_planFrame` + `sectionRecord`: {planRev, canvas, sections}; section records carry `id`
//   agent      build.mjs `_agentFields`
//   section    build.mjs `_sectionFrame`: the key is `sectionId`, not `id`
//   delta      frames.mjs `delta`: a splice {at, del, text}, never a top-level `at` or `text`
//   file       frames.mjs `file`: `text` only up to 262144 UTF-8 bytes
//   snapshot   build.mjs snapshot: `seq` is the last one sent, `plan` is never null, drafts are {path, rev, text}
// Every field of an envelope frame can be overridden through `o`.
//
// The model is reached as a namespace and its reducers are looked up when `run` calls them, because later tasks add
// some of them (`reduceBridge`): a named binding of a missing export would fail this file at link time.
import * as M from '../../ui/public/design/stage-model.mjs';

export const DID = 'd_000000000001';
export const BID = 'b_000000000001';
export const A1 = 'a_0000000a';
export const A2 = 'a_0000000b';
export const LEAD = 'a_0000000f';

// P2's draft paths (draft.mjs `classifyDraftPath`): `sections/<id>/index.html|style.css|script.js`, and the two
// top-level stylesheets. Kept here on purpose rather than read through the model's `draftTarget`.
const SECTION_PATH = /^sections\/([a-z][a-z0-9-]{0,31})\/(index\.html|style\.css|script\.js)$/;
const SECTION_PARTS = { 'index.html': 'html', 'style.css': 'css', 'script.js': 'js' };
const GLOBAL_PATHS = new Set(['tokens.css', 'global.css']);
const FILE_TEXT_MAX = 262144;

let seq = 0;
const envelope = (type) => ({ type, designId: DID, buildId: BID, seq: ++seq, ts: 1 });
const capitalise = (id) => id.charAt(0).toUpperCase() + id.slice(1);

/** `{sectionId, part}` of a draft path, or nulls for a path no stage draws. */
function target(path) {
  if (GLOBAL_PATHS.has(path)) return { sectionId: null, part: 'css' };
  const m = SECTION_PATH.exec(String(path));
  return m ? { sectionId: m[1], part: SECTION_PARTS[m[2]] } : { sectionId: null, part: null };
}

export const stats = (o = {}) => ({
  agentsNow: 0, agentsTotal: 1, sectionsDone: 0, sectionsPlanned: 0, failed: 0, layers: 0,
  costUsd: 0, estimatedUsd: 0, costKnown: true, elapsedMs: 0, ...o,
});

/** A partial `o.stats` merges into the full set, as P2 always sends all 10 keys. */
export const build = (status = 'building', o = {}) => ({
  ...envelope('design-build'), status, round: 1, kind: 'first', reason: null, waiting: 0, ...o, stats: stats(o.stats),
});

/** A string becomes P2's planned section record; an object is passed as given. */
export const plan = (sections, o = {}) => ({
  ...envelope('design-plan'),
  planRev: 1,
  canvas: { w: 1440 },
  sections: sections.map((s) => (typeof s === 'string'
    ? { id: s, job: capitalise(s), status: 'planned', estHeight: 600, parts: ['html', 'css'], agentId: null, summary: '' }
    : s)),
  ...o,
});

export const agent = (id, status, o = {}) => ({
  ...envelope('design-agent'),
  agentId: id, role: 'builder', job: 'Hero', sectionId: 'hero', status, engine: 'claude', model: 'mock', tool: null,
  tokens: { in: 0, out: 0, cr: 0, cw: 0 }, costUsd: null, estimatedUsd: 0, costKnown: true, error: null,
  ...o,
});

export const section = (id, status, o = {}) => ({
  ...envelope('design-section'), sectionId: id, status, agentId: null, summary: '', ...o,
});

/** `o.del` is the splice's delete count (an Edit's delete, a Write's clear); it never reaches the top level. */
export const delta = (path, rev, at, text, o = {}) => {
  const { del = 0, ...rest } = o;
  return { ...envelope('design-delta'), agentId: A1, path, ...target(path), rev, splice: { at, del, text }, ...rest };
};

export const file = (path, rev, text, o = {}) => {
  const bytes = Buffer.byteLength(text, 'utf8');
  const frame = { ...envelope('design-file'), path, ...target(path), rev, sha256: '0'.repeat(64), bytes };
  if (bytes <= FILE_TEXT_MAX) frame.text = text;
  return { ...frame, ...o };
};

/** P2 stamps a snapshot with the last `seq` it sent, so it takes no new one. */
export const snapshot = (o = {}) => ({
  type: 'design-snapshot', designId: DID, buildId: BID, seq, ts: 1,
  build: { status: 'building', round: 1, kind: 'first', reason: null, waiting: 0, stats: stats() },
  plan: { planRev: 0, canvas: null, sections: [] },
  sections: [], agents: [], questions: [], drafts: [],
  ...o,
});

/** No `rect` unless `o` gives one: a default rect would move the section and shift its cursor on the next `rects`. */
export const applied = (id, o = {}) => ({
  t: 'applied', id, rev: 1, added: 1, layers: 0, tail: null, marks: [], overflow: false, ...o,
});

/** `list` holds `[id, x, y, w, h]` rows. */
export const rects = (list, o = {}) => ({
  t: 'rects', scrollX: 0, scrollY: 0, vw: 1440, vh: 900, docH: 4000,
  sections: list.map(([id, x, y, w, h]) => ({ id, rect: [x, y, w, h] })),
  ...o,
});

/**
 * Feeds `steps` through the model in order: a step with `.type` is a frame (`reduceFrame`), with `.t` a bridge
 * message (`reduceBridge`), with `.user` a user action (`reduceUser`). Returns the last state and every effect.
 */
export function run(state, steps, now = 0) {
  const effects = [];
  let s = state;
  for (const step of steps) {
    let r;
    if (step.type !== undefined) r = M.reduceFrame(s, step, now);
    else if (step.t !== undefined) r = M.reduceBridge(s, step, now);
    else if (step.user !== undefined) r = M.reduceUser(s, step.user, now);
    else throw new TypeError(`run: a step needs .type, .t or .user: ${JSON.stringify(step)}`);
    s = r.state;
    effects.push(...r.effects);
  }
  return { state: s, effects };
}
