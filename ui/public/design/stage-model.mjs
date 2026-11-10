// The Design stage model (SPEC C-5, C-6, U3): pure reducers that turn C-5 frames, C-6 bridge messages and the
// person's actions into the stage's state plus a list of effects, which stage.mjs runs against the DOM. One cursor is
// one agent on stage, and nothing moves or appears without a fact behind it. No DOM, no timers, no randomness, and
// no reducer changes the state it is given: each copies what it changes and returns the same state when nothing does.
//
// P2's status lists (src/core/design/store.mjs) are copied here, since a browser module cannot reach src/core.

import { BOARD_CANVAS, boardLayout, stageRegions, kindChromeView, cursorLabel, tagSize } from './kind-view.mjs';

/** Agent statuses with a cursor on the stage: P2's AGENT_STATUSES less TERMINAL_AGENT_STATUSES. */
export const ON_STAGE = Object.freeze(['starting', 'thinking', 'writing', 'reading', 'waiting', 'retrying']);
/** Build statuses with agents at work: P2's OPEN_BUILD_STATUSES less `paused`. */
export const LIVE_BUILD = Object.freeze(['planning', 'building', 'integrating']);
/** Build statuses that end a round: P2's BUILD_STATUSES less OPEN_BUILD_STATUSES. */
export const END_BUILD = Object.freeze(['done', 'stopped', 'error', 'interrupted']);
// A build still open, so a snapshot is worth asking for; and the statuses a Continue picks a build up from.
const OPEN_BUILD = Object.freeze([...LIVE_BUILD, 'paused']);
const HALTED_BUILD = Object.freeze([...END_BUILD, 'paused']);

/**
 * Builder colours, in the order of the mock's crew (engine.js `CREW`), as worca hue tokens. Violet is Labs-only, so
 * `--stage-coral` takes its slot; `--stage-lemon` and `--stage-sky` name the mock's two hues worca has no family for
 * (L4.3). Overlay colours come only from here, never from a frame.
 */
export const CREW_TOKENS = Object.freeze([
  '--blue-ink', '--teal-ink', '--lime-ink', '--pink-ink', '--indigo-ink', '--stage-lemon',
  '--stage-coral', '--cocoa-ink', '--green-ink', '--stage-sky', '--peach-ink', '--slate-ink',
]);
/** The lead's colour; the lead holds no crew colour (`colorIndex` null). */
export const LEAD_TOKEN = '--ink';

/**
 * What one plan section is called on each kind of stage, and which stage controls a kind has (M9). A `board` kind
 * builds as a grid of 1920×1080 tiles at scale 1 (kind-view.mjs), with no camera and no viewport switch.
 */
export const KIND_NOUN = Object.freeze({ web: 'section', presentation: 'slide', pitch: 'slide', video: 'scene' });
export const KIND_STAGE = Object.freeze({
  web: Object.freeze({ viewport: true, camera: true, board: false }),
  presentation: Object.freeze({ viewport: false, camera: false, board: true }),
  pitch: Object.freeze({ viewport: false, camera: false, board: true }),
  video: Object.freeze({ viewport: false, camera: false, board: true }),
});

/**
 * The camera (M11, the mock's `_frameCrew`, L4.22): the scale never drops below 0.45 unless fit-width does (L4.25); a
 * move eases at most 400 ms; the crew stays above the 96 px HUD band with 14 px of room each side; zooming back in
 * needs a 6% gain and a move a 20 screen px shift; a ctrl or meta wheel zooms by `exp(-dy * .01)` (L4.21).
 */
export const CAMERA_MIN = 0.45;
export const CAMERA_EASE_MS = 400;
export const CAMERA_HUD_BAND = 96;
export const CAMERA_PAD = 14;
export const CAMERA_ZOOM_BACK = 1.06;
export const CAMERA_MIN_SHIFT = 20;
export const ZOOM_RATE = 0.01;
/** Page widths the stage's viewport switch offers; desktop is the plan's canvas width (L4.9). */
export const VIEWPORTS = Object.freeze({ desktop: null, tablet: 820, phone: 390 });

// A page this wide or wider fills the stage; a narrower one (tablet, phone) sits framed with 40 px each side and 24 px
// on top. The mock caps fit-width at 9. Scales this close count as the same.
const WIDE_PAGE = 1100;
const FIT_MAX = 9;
const NARROW_SIDES = 80;
const NARROW_TOP = 24;
const FIT_SLOP = 0.001;
const SCALE_SLOP = 0.002;
// The lead room above the crew: 35% of the free height, at most 150 page px.
const LEAD_ROOM = 0.35;
const LEAD_ROOM_MAX = 150;
// How long scroll messages after a camera move (its ease plus this), a resize or a new build doc are the camera's own;
// a scroll of at most 2 px is noise.
const CAMERA_SETTLE_MS = 200;
const RESIZE_SETTLE_MS = 600;
const SCROLL_SLOP = 2;
// Parked cursors (the mock's `_drawCursorsPage`): more than 4 below spread out; above, once the page is scrolled past
// 4 px, they stack 24 px apart in 3 rows, 8 px under the top edge; every cursor stays 2 px inside the stage's left and
// 60 px inside its right.
const PARK_SPREAD_MIN = 4;
const PARK_SCROLLED = 4;
const PARK_SPREAD_X = 30;
const PARK_SPREAD_PAD = 120;
const PARK_TOP = 8;
const PARK_ROW = 24;
const PARK_LEFT = 2;
const PARK_RIGHT = 60;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// L4.9: the desktop page is the plan's canvas width, else this. L4.7: the lead's home is the canvas centre at this y.
const PAGE_W_FALLBACK = 1280;
const LEAD_HOME_Y = 360;

// What a reading agent reads: a Read names a file, a Grep or Glob a folder (`sections/hero`), so only the section
// prefix of P2's work-relative `tool.path` counts. Any other tool (Bash …) reads nothing a stage can show.
const READ_TOOLS = Object.freeze(['Read', 'Grep', 'Glob']);
const READ_SECTION = /^sections[\\/]([a-z][a-z0-9-]{0,31})(?:[\\/]|$)/;
// Guides (the mock's `_guideFor`): from a new element at least this wide, pairs this far apart, each living its `ms`
// plus a fade; a pair is added only while at most this many are live, so 6 never become 7.
const GUIDE_MIN_W = 60;
const GUIDE_GAP_MS = 500;
const GUIDE_FADE_MS = 500;
const GUIDE_LIVE_MAX = 4;
// P2's drawn files (draft.mjs `classifyDraftPath`): a section's three parts and the two global stylesheets.
const DRAFT_SECTION = /^sections\/([a-z][a-z0-9-]{0,31})\/(index\.html|style\.css|script\.js)$/;
const DRAFT_PARTS = Object.freeze({ 'index.html': 'html', 'style.css': 'css', 'script.js': 'js' });
const DRAFT_GLOBALS = Object.freeze({ 'tokens.css': 'tokens', 'global.css': 'global' });

const isObject = (v) => typeof v === 'object' && v !== null;
const unchanged = (state) => ({ state, effects: [] });
/** `map[key]` when it is the map's own entry, else null: a section id such as `constructor` is a valid one. */
const own = (map, key) => (typeof key === 'string' && Object.hasOwn(map, key) ? map[key] : null);
/** A rect is `[x, y, w, h]` in document coordinates, four finite numbers (P3's `docRect`). */
const isRect = (r) => Array.isArray(r) && r.length === 4 && r.every(Number.isFinite);
const moveRect = ([x, y, w, h], dx, dy) => [x + dx, y + dy, w, h];
const sizeTag = (tag, [, , w, h]) => `${tag} ${Math.round(w)}×${Math.round(h)}`;
const tagOf = (tag) => (typeof tag === 'string' && tag ? tag : 'el');

/**
 * Which drawn file a draft path is: `{sectionId, part}` for a section's `index.html`, `style.css` or `script.js`,
 * `{sectionId: null, part: 'css', file}` for `tokens.css` and `global.css`, else null. A `\` reads as `/`.
 * @param {unknown} path
 * @returns {{sectionId: string|null, part: 'html'|'css'|'js', file?: 'tokens'|'global'}|null}
 */
export function draftTarget(path) {
  if (typeof path !== 'string') return null;
  const p = path.replace(/\\/g, '/');
  if (Object.hasOwn(DRAFT_GLOBALS, p)) return { sectionId: null, part: 'css', file: DRAFT_GLOBALS[p] };
  const m = DRAFT_SECTION.exec(p);
  return m ? { sectionId: m[1], part: DRAFT_PARTS[m[2]] } : null;
}

/** Everything a round owns: a new `buildId` starts again from these. */
function freshRound() {
  return {
    buildId: null, round: 0, buildKind: null, status: null, reason: null, waiting: 0, stats: null, minSeq: null,
    planRev: 0, sectionOrder: [], sections: {}, agents: {}, agentOrder: [], nextColor: 0,
    drafts: {}, docMode: null, nextMode: null, frameIds: [], wantPick: false, resyncing: false, stopping: false,
    scroll: { x: 0, y: 0, vw: 0, vh: 0, docH: 0 }, layers: 0, guides: [], lastGuideAt: -Infinity, pins: [],
    // What the frame measured: each section's rect, the sections that overflow, and the media an apply added.
    rects: {}, overflow: {}, wires: {}, leadHomeY: null,
  };
}

/** @param {{designId: string, kind: string, canvas: object|null, reduced?: boolean}} o */
export function initialStage({ designId, kind, canvas, reduced = false }) {
  return {
    designId, kind, canvas: canvas ?? null, reduced: Boolean(reduced),
    // The doc the frame shows, from its last `ready`: a new round forgets `docMode`, never this (p8t1).
    frameMode: null,
    ...freshRound(),
    view: { stageW: 0, stageH: 0, viewport: 'desktop' },
    camera: { on: true, scale: null, y: null, key: '', pendingUntil: 0, doneFramed: false, force: false },
  };
}

// The camera after a new round or a Continue: it follows the crew again from a fresh frame (the mock's `retry`).
const reopenCamera = (camera) => ({ ...camera, on: true, key: '', y: null, doneFramed: false });

const isOnStage = (a) => ON_STAGE.includes(a.status);
const onStage = (state) => state.agentOrder.map((id) => state.agents[id]).filter(isOnStage);
/** An agent's colour token: the lead's, else its crew colour. */
export const crewOf = (a) => (a.role === 'lead' ? LEAD_TOKEN : CREW_TOKENS[(a.colorIndex ?? 0) % CREW_TOKENS.length]);

function pageWidth(state) {
  const w = state.canvas?.w;
  return Number.isFinite(w) && w > 0 ? w : PAGE_W_FALLBACK;
}

/** The lead's home: the canvas centre at `y` 360, or at the y stored as the build began to integrate. */
function homeOf(state) {
  return { x: pageWidth(state) * 0.5, y: state.leadHomeY ?? LEAD_HOME_Y };
}

/** Where a cursor stands on a section it has no tail in: just inside the section's top left (the mock's `_nextLayer`). */
const slotStart = ([x, y, w]) => ({ x: x + Math.min(10, w * 0.1), y: y + 3 });

/**
 * Where an agent's cursor is now, only from facts. A builder: right of its tail, else its section's slot, else the
 * lead's home. A lead: the slot of the plan section it reads, else its home. A builder never follows a read.
 */
function positionOf(state, a) {
  if (a.role === 'lead') {
    const read = own(state.rects, a.reading);
    return read ? slotStart(read) : homeOf(state);
  }
  if (a.pos) return { x: a.pos.x, y: a.pos.y };
  const r = own(state.rects, a.sectionId);
  return r ? slotStart(r) : homeOf(state);
}

/**
 * The integrating lead's home y, stored once a lead is on stage while the build integrates, whichever of the two
 * came second, from the scroll then (the mock's `_startIntegrate`: 30% down the view; 360 before the frame measured
 * one), so a later scroll does not move it. It goes when either ends.
 */
function withLeadHome(s) {
  const integrating = s.status === 'integrating' && onStage(s).some((a) => a.role === 'lead');
  if (!integrating) return s.leadHomeY == null ? s : { ...s, leadHomeY: null };
  if (s.leadHomeY != null) return s;
  const { y, vh } = s.scroll;
  return { ...s, leadHomeY: vh > 0 ? y + vh * 0.3 : LEAD_HOME_Y };
}

/**
 * The plan section an agent's frame reads, or null: only while its status is `reading` (P2 can send `thinking` with
 * the Read tool for 500 ms after the read), with Read, Grep or Glob, under `sections/<id>` of a section the plan holds.
 */
function readingOf(state, f) {
  const tool = isObject(f.tool) ? f.tool : null;
  if (f.status !== 'reading' || !tool || !READ_TOOLS.includes(tool.name) || typeof tool.path !== 'string') return null;
  const m = READ_SECTION.exec(tool.path);
  return m && state.sectionOrder.includes(m[1]) ? m[1] : null;
}

function leaveOf(state, a, quick) {
  const { x, y } = positionOf(state, a);
  return { type: 'leave', agentId: a.id, crew: crewOf(a), colorIndex: a.colorIndex, x, y, quick };
}

/** The status the HUD, the slot lines and the camera read: `planning` with a builder on stage is `building` (L4.35). */
export function effectiveStatus(state) {
  if (state.status === 'planning' && onStage(state).some((a) => a.role === 'builder')) return 'building';
  return state.status;
}

/**
 * One C-5 frame. Frames of another design, a stale build's frames (any but `design-build` carrying another
 * `buildId`) and, after a snapshot, frames of this build at or below its `seq` return the same state and no effect.
 * @returns {{state: object, effects: object[]}}
 */
export function reduceFrame(state, frame, now = 0) {
  if (!isObject(frame) || frame.designId !== state.designId) return unchanged(state);
  if (frame.type !== 'design-build' && frame.buildId != null && frame.buildId !== state.buildId) return unchanged(state);
  // P2 stamps a snapshot with the last seq it sent, so one asked for again with nothing sent between repeats `minSeq`.
  if (state.minSeq != null && frame.type !== 'design-snapshot' && frame.buildId === state.buildId
    && typeof frame.seq === 'number' && frame.seq <= state.minSeq) return unchanged(state);
  switch (frame.type) {
    case 'design-build': return onBuild(state, frame);
    case 'design-plan': return onPlan(state, frame);
    case 'design-section': return onSection(state, frame);
    case 'design-agent': return onAgent(state, frame);
    case 'design-delta': return onDelta(state, frame);
    case 'design-file': return onFile(state, frame);
    case 'design-snapshot': return onSnapshot(state, frame);
    // P5 emits it (`src/` does not yet): the design went back to a saved version, so the run doc and the details reload.
    case 'design-restored': return { state, effects: [{ type: 'load', mode: 'run' }, { type: 'refresh' }] };
    default: return unchanged(state);
  }
}

const bridge = (t, fields) => ({ type: 'bridge', t, fields });

/**
 * A draft of an `html` or `css` file: its text and rev (P2 `draft.mjs`), what it draws from `draftTarget`, its
 * length and whether its text is final (a `design-file`, or its agent left).
 */
function textDraft(target, rev, text, final) {
  const d = { rev, text, sectionId: target.sectionId, part: target.part };
  if (target.file) d.file = target.file;
  return { ...d, bytes: text.length, final };
}

/** A JS draft keeps only its length for the meter, never its text. */
const jsDraft = (target, rev, bytes, final) => ({ rev, sectionId: target.sectionId, part: 'js', bytes, final });

/** CSS goes to the bridge as `css {file, rev, text, final}` (P3 drops a rev at or below the last for a file). */
const cssEffect = (d) => bridge('css', { file: d.file ?? d.sectionId, rev: d.rev, text: d.text, final: d.final });

/** What an `html` draft's new text feeds (the reveal paces it), and a `css` one's goes straight to the bridge. */
function textEffect(key, d) {
  if (d.part === 'css') return cssEffect(d);
  return { type: 'feed', key, sectionId: d.sectionId, text: d.text, final: d.final };
}

/** The paths of a section's `html` drafts. */
function htmlKeys(state, sectionId) {
  if (typeof sectionId !== 'string') return [];
  return Object.keys(state.drafts).filter((k) => state.drafts[k]?.part === 'html' && state.drafts[k].sectionId === sectionId);
}

/**
 * A rev gap (a lost delta, a Continue's jump with no base file, a page opened mid-build): drafts are held until a
 * snapshot, which one `subscribe` asks for (L4.33).
 */
function gap(state) {
  return { state: { ...state, resyncing: true }, effects: [{ type: 'subscribe', buildId: state.buildId }] };
}

/**
 * `design-delta` is a splice `{at, del, text}` (P2 `frames.mjs`): `text.slice(0, at) + text + text.slice(at + del)`,
 * so an Edit is a delete then an insert and a Write over a draft clears it first. Its `rev` must be the draft's next
 * (a missing draft is at 0), and the splice must stay inside the draft, else it is a gap. While a snapshot is awaited
 * every delta is dropped. An `html` draft feeds its whole text, a `css` one goes to the bridge, and a JS draft keeps
 * only its length, `len - del + text.length` (P2 counts the splice in string units).
 */
function onDelta(state, f) {
  const target = draftTarget(f.path);
  const sp = isObject(f.splice) ? f.splice : null;
  if (!target || !sp || typeof sp.text !== 'string' || !Number.isSafeInteger(f.rev)
    || !Number.isSafeInteger(sp.at) || sp.at < 0) return unchanged(state);
  if (state.resyncing) return unchanged(state);
  const prev = own(state.drafts, f.path);
  const del = Number.isSafeInteger(sp.del) && sp.del > 0 ? sp.del : 0;
  const js = target.part === 'js';
  const text = typeof prev?.text === 'string' ? prev.text : '';
  const len = js ? prev?.bytes ?? 0 : text.length;
  if (f.rev !== (prev?.rev ?? 0) + 1 || sp.at > len || sp.at + del > len) return gap(state);
  const draft = js
    ? jsDraft(target, f.rev, len - del + sp.text.length, false)
    : textDraft(target, f.rev, text.slice(0, sp.at) + sp.text + text.slice(sp.at + del), false);
  return { state: { ...state, drafts: { ...state.drafts, [f.path]: draft } }, effects: js ? [] : [textEffect(f.path, draft)] };
}

/**
 * `design-file` is the file's whole text, final. One at or below the draft's rev is a fetch that lost the race and is
 * ignored. With `text` (P2 sends it up to 262144 bytes) it sets the rev, so P2's Continue landing a base file at
 * `Date.now() + 1` before any splice (`draft.mjs` `landFirst`) is followed by its deltas with no gap. Without `text`
 * it sets no rev, so the next delta is a gap a snapshot heals (snapshot drafts carry the whole text), and asks for the
 * file with `fetchFile`.
 */
function onFile(state, f) {
  const target = draftTarget(f.path);
  if (!target || !Number.isSafeInteger(f.rev)) return unchanged(state);
  const prev = own(state.drafts, f.path);
  if (prev && f.rev <= prev.rev) return unchanged(state);
  if (typeof f.text !== 'string') {
    const fetch = {
      type: 'fetchFile', path: f.path, sectionId: target.sectionId, part: target.part, rev: f.rev,
      bytes: f.bytes ?? null, seq: f.seq ?? null, buildId: f.buildId ?? state.buildId,
    };
    return { state, effects: [fetch] };
  }
  const js = target.part === 'js';
  const draft = js ? jsDraft(target, f.rev, f.text.length, true) : textDraft(target, f.rev, f.text, true);
  return { state: { ...state, drafts: { ...state.drafts, [f.path]: draft } }, effects: js ? [] : [textEffect(f.path, draft)] };
}

/** `hello` carries exactly the doc's mode, the stage's kind and the canvas. */
const helloEffect = (state, mode) => bridge('hello', { mode, kind: state.kind, canvas: state.canvas ? { ...state.canvas } : null });

/** `plan`: the sections as `{id}`, plus `estHeight` only on a stage with a camera (M9: decks and video have none). */
function planEffect(state) {
  const est = Boolean(own(KIND_STAGE, state.kind)?.camera);
  return bridge('plan', {
    sections: state.sectionOrder.map((id) => {
      const h = own(state.sections, id)?.estHeight;
      return est && Number.isFinite(h) ? { id, estHeight: h } : { id };
    }),
  });
}

/** The CSS drafts with text, `tokens` then `global`, then each planned section's in plan order. */
function cssEffects(state) {
  const css = Object.values(state.drafts).filter((d) => d?.part === 'css' && typeof d.text === 'string');
  return [
    ...['tokens', 'global'].flatMap((file) => css.filter((d) => d.file === file)),
    ...state.sectionOrder.flatMap((id) => css.filter((d) => !d.file && d.sectionId === id)),
  ].map(cssEffect);
}

/**
 * A `flush` per `html` draft of a planned section that is not `done` (a done one is in the build doc already), or that
 * is in `settle`: a section whose agent left through a snapshot, so its last text may never have reached the doc.
 */
function flushEffects(state, settle = null) {
  const out = [];
  for (const id of state.sectionOrder) {
    if (own(state.sections, id)?.status === 'done' && !settle?.has(id)) continue;
    for (const key of htmlKeys(state, id)) {
      const d = state.drafts[key];
      if (typeof d.text === 'string') out.push({ type: 'flush', key, sectionId: id, text: d.text, final: d.final });
    }
  }
  return out;
}

/**
 * The record of an agent from a `design-agent` frame or a snapshot's agent, keeping what the stage learnt of it
 * (`pos`, `box`); the lead holds no colour.
 */
function agentRecord(state, f, prev, colorIndex) {
  const role = f.role === 'lead' ? 'lead' : 'builder';
  return {
    id: f.agentId, role, job: f.job ?? '', sectionId: f.sectionId ?? null, status: f.status,
    colorIndex: role === 'lead' ? null : colorIndex,
    tool: f.tool ?? null, costUsd: f.costUsd ?? null, estimatedUsd: f.estimatedUsd ?? null,
    costKnown: f.costKnown !== false, error: f.error ?? null,
    pos: prev?.pos ?? null, box: prev?.box ?? null, reading: readingOf(state, f),
  };
}

/**
 * `design-snapshot` (P2's answer to `subscribe`): the truth of this build at `seq`, so frames at or below it are
 * dropped from now on. It rebuilds the plan (`planRev` 0 is none), the sections, the agents and the drafts, ignores
 * `questions`, and keeps the camera, the view, the layer count and the pins. Each known agent keeps its colour, its
 * position and its box; new builders on stage take free colours in snapshot order; an agent on stage that the
 * snapshot does not hold on stage leaves, and its section's text settles. A draft is final when no agent on stage holds
 * its section. `build` applies as a `design-build` would. Then, in `ready`'s order, the build doc gets the plan (or a
 * reload when it lacks an id), the CSS drafts, and a `flush` per unfinished section or section a leaver held.
 */
function onSnapshot(state, f) {
  if (typeof f.buildId !== 'string' || f.buildId !== state.buildId) return unchanged(state);
  const p = isObject(f.plan) ? f.plan : {};
  const planRev = Number.isSafeInteger(p.planRev) && p.planRev > 0 ? p.planRev : 0;
  const top = new Map();
  for (const rec of Array.isArray(f.sections) ? f.sections : []) {
    if (isObject(rec) && typeof rec.id === 'string' && rec.id && !top.has(rec.id)) top.set(rec.id, rec);
  }
  const sections = {};
  const sectionOrder = [];
  for (const rec of planRev > 0 && Array.isArray(p.sections) ? p.sections : []) {
    if (!isObject(rec) || typeof rec.id !== 'string' || !rec.id || Object.hasOwn(sections, rec.id)) continue;
    sections[rec.id] = { ...own(state.sections, rec.id), ...rec, ...top.get(rec.id) };
    sectionOrder.push(rec.id);
  }
  const canvas = isObject(p.canvas) ? { ...p.canvas } : state.canvas;
  const planned = { ...state, planRev, sectionOrder, sections, canvas };

  const recs = [];
  for (const rec of Array.isArray(f.agents) ? f.agents : []) {
    if (!isObject(rec) || typeof rec.agentId !== 'string' || !rec.agentId || typeof rec.status !== 'string') continue;
    if (!recs.some((r) => r.agentId === rec.agentId)) recs.push(rec);
  }
  const agents = {};
  for (const rec of recs) {
    const prev = own(state.agents, rec.agentId);
    agents[rec.agentId] = agentRecord(planned, rec, prev, prev?.colorIndex ?? null);
  }
  // Builders on stage before keep their colours first; the others take a free one when theirs is none or held.
  const wasOn = new Set(onStage(state).map((a) => a.id));
  const builders = recs.map((r) => agents[r.agentId]).filter((a) => a.role === 'builder' && isOnStage(a));
  let { nextColor } = state;
  const held = new Set();
  for (const a of [...builders.filter((b) => wasOn.has(b.id)), ...builders.filter((b) => !wasOn.has(b.id))]) {
    let c = a.colorIndex;
    if (c === null || held.has(c)) ({ colorIndex: c, nextColor } = pickColor(nextColor, held));
    held.add(c);
    agents[a.id] = { ...a, colorIndex: c };
  }
  const effects = [];
  // The sections of agents that leave here: their text settles, as an agent's own end settles it.
  const settled = new Set();
  for (const a of onStage(state)) {
    const next = Object.hasOwn(agents, a.id) ? agents[a.id] : null;
    if (next && isOnStage(next)) continue;
    effects.push(leaveOf(state, a, next?.status === 'stopped' && state.stopping));
    if (a.sectionId != null) settled.add(a.sectionId);
  }
  const agentOrder = [
    ...state.agentOrder.filter((id) => Object.hasOwn(agents, id)),
    ...recs.map((r) => r.agentId).filter((id) => !state.agentOrder.includes(id)),
  ];

  // A draft is final once no agent on stage holds its section (an on-stage lead, with no section, holds the global
  // stylesheets): a stopped or failed section's text is all there is, and must not stay ghosted as if still written.
  const holding = new Set(Object.values(agents).filter(isOnStage).map((a) => a.sectionId));
  const drafts = {};
  for (const d of Array.isArray(f.drafts) ? f.drafts : []) {
    const target = isObject(d) ? draftTarget(d.path) : null;
    if (!target || typeof d.text !== 'string' || !Number.isSafeInteger(d.rev) || Object.hasOwn(drafts, d.path)) continue;
    const final = !holding.has(target.sectionId);
    drafts[d.path] = target.part === 'js' ? jsDraft(target, d.rev, d.text.length, final) : textDraft(target, d.rev, d.text, final);
  }

  let s = {
    ...planned, minSeq: typeof f.seq === 'number' ? f.seq : state.minSeq,
    agents, agentOrder, nextColor, drafts, resyncing: false,
  };
  if (isObject(f.build)) {
    const b = onBuild(s, { ...f.build, buildId: f.buildId });
    s = b.state;
    effects.push(...b.effects);
  } else {
    s = withLeadHome(s);
  }
  if (s.docMode === 'build' && s.planRev > 0) {
    effects.push(s.sectionOrder.some((id) => !s.frameIds.includes(id)) ? { type: 'load', mode: 'build' } : planEffect(s));
  }
  // A leaver's draft the snapshot flushes below settles with its text; one it no longer holds settles what was shown.
  for (const id of settled) {
    for (const key of htmlKeys(state, id)) {
      if (!Object.hasOwn(s.drafts, key) || !s.sectionOrder.includes(id)) effects.push({ type: 'finalize', key });
    }
  }
  effects.push(...cssEffects(s), ...flushEffects(s, settled));
  return { state: s, effects };
}

function onBuild(state, f) {
  const { buildId, status } = f;
  if (typeof buildId !== 'string' || !buildId || typeof status !== 'string') return unchanged(state);
  const effects = [];
  let s;
  let wasLive;
  if (buildId !== state.buildId) {
    // A new build: whoever is still on stage leaves, and the round starts again. P2 sends a build's first
    // `design-build` before anything else of it, so this is where its frames start to count.
    for (const a of onStage(state)) effects.push(leaveOf(state, a, false));
    const mode = status === 'done' ? 'run' : 'build';
    s = {
      ...state, ...freshRound(), buildId, nextMode: mode, camera: reopenCamera(state.camera),
    };
    effects.push({ type: 'load', mode });
    // A build first seen once it ended has nothing left to stream.
    if (OPEN_BUILD.includes(status)) effects.push({ type: 'subscribe', buildId });
    wasLive = false;
  } else {
    s = state;
    wasLive = LIVE_BUILD.includes(state.status);
    // A round that ends `done` shows its run doc, once per entry, so a Retry that ends `done` again reloads it;
    // `stopped`, `paused`, `error` and `interrupted` keep the build doc.
    if (status === 'done' && state.status !== 'done') effects.push({ type: 'load', mode: 'run' });
    if (LIVE_BUILD.includes(status) && HALTED_BUILD.includes(state.status)) {
      // A Continue keeps the buildId: the camera follows again, and a run doc on screen or on its way goes back to
      // the build doc.
      s = { ...s, camera: reopenCamera(s.camera) };
      if (s.docMode === 'run' || s.nextMode === 'run') {
        effects.push({ type: 'load', mode: 'build' });
        s.nextMode = 'build';
      }
    }
  }
  s = {
    ...s,
    status,
    round: f.round ?? s.round,
    buildKind: f.kind ?? s.buildKind,
    reason: f.reason ?? null,
    waiting: f.waiting ?? 0,
    stats: f.stats ?? s.stats,
  };
  if (END_BUILD.includes(status) || status === 'paused') {
    // A safety net for agent frames that never came (P2 normally ends each agent first): every agent still on
    // stage takes the build's word and leaves, settling its section's text; a pause spares the agents waiting on an
    // answer (M12).
    const word = status === 'error' || status === 'paused' ? 'stopped' : status;
    let agents = null;
    const left = [];
    for (const a of onStage(s)) {
      if (status === 'paused' && a.status === 'waiting') continue;
      effects.push(leaveOf(s, a, status === 'stopped'));
      agents ??= { ...s.agents };
      agents[a.id] = { ...a, status: word };
      left.push(a);
    }
    if (agents) s.agents = agents;
    for (const a of left) s = settleDrafts(s, a.sectionId, effects);
    s.stopping = false;
  } else if (LIVE_BUILD.includes(status) && !wasLive) {
    // Only a build going live again clears a Stop: P2 also sends `design-build` frames that are still `building`
    // while it stops the agents one by one (`_endAgent`, a cost booking), and those must keep the quick exits.
    s.stopping = false;
  }
  return { state: withLeadHome(s), effects };
}

function onPlan(state, f) {
  if (!Array.isArray(f.sections)) return unchanged(state);
  const sections = {};
  const sectionOrder = [];
  for (const rec of f.sections) {
    if (!isObject(rec) || typeof rec.id !== 'string' || !rec.id || Object.hasOwn(sections, rec.id)) continue;
    // Every field the frame sends is kept, unread ones included (`band`), over what the stage learnt of the section.
    sections[rec.id] = { ...state.sections[rec.id], ...rec };
    sectionOrder.push(rec.id);
  }
  const s = { ...state, planRev: f.planRev ?? state.planRev, sectionOrder, sections };
  if (isObject(f.canvas)) s.canvas = { ...f.canvas };
  // The build doc holds a slot per id it was told at `ready` (`frameIds`): a new id reloads it, so the section lands
  // in its place (L4.20), and the same ids go to it as `plan`. With no doc ready yet, `ready` sends the plan.
  const effects = [];
  if (s.docMode === 'build' && sectionOrder.some((id) => !s.frameIds.includes(id))) effects.push({ type: 'load', mode: 'build' });
  else if (s.docMode !== null) effects.push(planEffect(s));
  return { state: s, effects };
}

/**
 * `design-section` names its section `sectionId`, where plan records say `id`. One for an id the plan does not hold
 * is ignored. A `removed` section drops its pending reveal.
 */
function onSection(state, f) {
  const id = f.sectionId;
  if (typeof id !== 'string' || !id || typeof f.status !== 'string' || !state.sectionOrder.includes(id)) return unchanged(state);
  const next = { ...state.sections[id], id, status: f.status, agentId: f.agentId ?? null, summary: f.summary ?? '' };
  const effects = f.status === 'removed' ? htmlKeys(state, id).map((key) => ({ type: 'drop', key })) : [];
  return { state: { ...state, sections: { ...state.sections, [id]: next } }, effects };
}

/** An agent that left settles its section's text: a `finalize` per `html` draft, each now final. */
function settleDrafts(s, sectionId, effects) {
  const keys = htmlKeys(s, sectionId);
  if (!keys.length) return s;
  const drafts = { ...s.drafts };
  for (const key of keys) {
    drafts[key] = { ...drafts[key], final: true };
    effects.push({ type: 'finalize', key });
  }
  return { ...s, drafts };
}

/** Colours held by builders on stage, other than `exceptId`'s. */
function heldColors(state, exceptId) {
  const held = new Set();
  for (const a of onStage(state)) if (a.role === 'builder' && a.id !== exceptId) held.add(a.colorIndex);
  return held;
}

/** The next colour no builder on stage holds, from `from` on; with all of them held, the next one anyway. */
function pickColor(from, held) {
  const n = CREW_TOKENS.length;
  for (let i = 0; i < n; i += 1) {
    const c = (from + i) % n;
    if (!held.has(c)) return { colorIndex: c, nextColor: (c + 1) % n };
  }
  return { colorIndex: from % n, nextColor: (from + 1) % n };
}

function onAgent(state, f) {
  const id = f.agentId;
  if (typeof id !== 'string' || !id || typeof f.status !== 'string') return unchanged(state);
  const prev = Object.hasOwn(state.agents, id) ? state.agents[id] : null;
  const wasOn = prev !== null && isOnStage(prev);
  const isOn = ON_STAGE.includes(f.status);
  const role = f.role === 'lead' ? 'lead' : 'builder';
  let colorIndex = role === 'lead' ? null : prev?.colorIndex ?? null;
  let { nextColor } = state;
  if (role === 'builder' && isOn && (!wasOn || colorIndex === null)) {
    // A builder coming on stage keeps its colour for the round while no one on stage holds it (P2 L2.1: the same
    // row comes back for a rework, a retry or an answer); otherwise it takes the next free one (the mock's _nextColor).
    const held = heldColors(state, id);
    if (colorIndex === null || held.has(colorIndex)) ({ colorIndex, nextColor } = pickColor(nextColor, held));
  }
  const agent = agentRecord(state, f, prev, colorIndex);
  const effects = [];
  // A process that ended leaves once, from where its cursor was; quickly only after the person's own whole-round
  // Stop (L4.34), since P2 ends every agent with its own frame before the build's. Its section's text settles.
  if (wasOn && !isOn) effects.push(leaveOf(state, prev, f.status === 'stopped' && state.stopping));
  let s = {
    ...state,
    agents: { ...state.agents, [id]: agent },
    agentOrder: prev ? state.agentOrder : [...state.agentOrder, id],
    nextColor,
  };
  if (wasOn && !isOn) s = settleDrafts(s, prev.sectionId, effects);
  return { state: withLeadHome(s), effects };
}

/**
 * One C-6 message from the frame, as frame-host.mjs's `validFrameMessage` passed it: `ready` names the doc now on
 * screen, `rects` and `applied` carry what the frame measured, in document coordinates, and `picked` an element the
 * person pinned. Any other message returns the same state and no effect.
 * @returns {{state: object, effects: object[]}}
 */
export function reduceBridge(state, msg, now = 0) {
  if (!isObject(msg)) return unchanged(state);
  switch (msg.t) {
    case 'ready': return onReady(state, msg, now);
    case 'rects': return onRects(state, msg, now);
    case 'applied': return onApplied(state, msg, now);
    case 'picked': return onPicked(state, msg);
    default: return unchanged(state);
  }
}

/**
 * `ready`: the doc on screen is now `mode`'s (`docMode`), and a `load` of that mode has landed (`nextMode`). A new
 * frame starts at scroll 0, so in a build doc the camera forgets its target and frames again, and scroll messages for
 * 600 ms are the new doc's own. A run doc keeps the target, so a change round can be scrolled back to it (L4.32).
 * P3's order follows: a build doc gets `hello`, the plan (its ids are now `frameIds`), the CSS drafts and a `flush`
 * per unfinished section; a run doc gets `hello`, the change round's `scroll`, and `pick` when it was asked for.
 */
function onReady(state, m, now) {
  const { mode } = m;
  if (mode !== 'build' && mode !== 'run') return unchanged(state);
  const s = { ...state, docMode: mode, frameMode: mode, nextMode: state.nextMode === mode ? null : state.nextMode };
  const effects = [helloEffect(s, mode)];
  if (mode === 'build') {
    s.camera = { ...state.camera, pendingUntil: now + RESIZE_SETTLE_MS, key: '', y: null };
    s.scroll = { ...state.scroll, x: 0, y: 0 };
    s.frameIds = s.planRev > 0 ? [...s.sectionOrder] : [];
    if (s.planRev > 0) effects.push(planEffect(s));
    effects.push(...cssEffects(s), ...flushEffects(s));
  } else {
    if (s.buildKind === 'change' && s.camera.y != null) effects.push(bridge('scroll', { y: s.camera.y, behavior: 'auto' }));
    if (s.wantPick) effects.push(bridge('pick', { on: true }));
  }
  return { state: s, effects };
}

/**
 * Whether a `rects` scroll is the person's (Review Focus 5): over a build doc, after the camera's own move, an iframe
 * resize or a new doc settled, by more than 2 px, while the document kept its height (a taller one is scroll
 * anchoring). The mock stops on any wheel (`engine.js:1329`).
 */
function personScrolled(state, scroll, now) {
  const { camera } = state;
  return (camera.on || camera.y != null) && state.docMode !== 'run' && now > camera.pendingUntil
    && Math.abs(scroll.y - state.scroll.y) > SCROLL_SLOP && scroll.docH === state.scroll.docH;
}

const SCROLL_KEYS = Object.freeze([['x', 'scrollX'], ['y', 'scrollY'], ['vw', 'vw'], ['vh', 'vh'], ['docH', 'docH']]);
const sameRect = (a, b) => a.every((v, i) => v === b[i]);

/**
 * `rects`: the scroll, and every section's rect, replacing the known ones. A section that moved takes along what
 * stands on it, by exactly its delta: its agents' tail and box, its wires and its pins. A builder with no tail keeps
 * no position: `selectCursors` reads its section's rect each time. A scroll of the person's stops the camera and
 * forgets its target.
 */
function onRects(state, m, now) {
  const scroll = {};
  for (const [key, from] of SCROLL_KEYS) scroll[key] = Number.isFinite(m[from]) ? m[from] : state.scroll[key];
  const rects = {};
  for (const r of Array.isArray(m.sections) ? m.sections : []) {
    if (isObject(r) && typeof r.id === 'string' && r.id && isRect(r.rect) && !Object.hasOwn(rects, r.id)) rects[r.id] = [...r.rect];
  }
  const ids = Object.keys(rects);
  const known = Object.keys(state.rects);
  const same = SCROLL_KEYS.every(([key]) => scroll[key] === state.scroll[key]) && ids.length === known.length
    && ids.every((id, i) => id === known[i] && sameRect(rects[id], state.rects[id]));
  if (same) return unchanged(state);
  const moved = new Map();
  for (const id of ids) {
    const old = own(state.rects, id);
    if (old && (old[0] !== rects[id][0] || old[1] !== rects[id][1])) moved.set(id, [rects[id][0] - old[0], rects[id][1] - old[1]]);
  }
  const s = { ...state, scroll, rects };
  if (personScrolled(state, scroll, now)) s.camera = { ...state.camera, on: false, y: null };
  if (!moved.size) return { state: s, effects: [] };
  s.agents = { ...state.agents };
  for (const a of Object.values(state.agents)) {
    const d = moved.get(a.sectionId);
    if (!d || (!a.pos && !a.box)) continue;
    s.agents[a.id] = {
      ...a,
      pos: a.pos && { x: a.pos.x + d[0], y: a.pos.y + d[1] },
      box: a.box && { ...a.box, rect: moveRect(a.box.rect, ...d) },
    };
  }
  s.wires = { ...state.wires };
  for (const [id, d] of moved) {
    const list = own(state.wires, id);
    if (list) s.wires[id] = list.map((w) => ({ ...w, rect: moveRect(w.rect, ...d) }));
  }
  s.pins = state.pins.map((p) => {
    const d = moved.get(p.id);
    return d ? { ...p, rect: moveRect(p.rect, ...d) } : p;
  });
  return { state: s, effects: [] };
}

/**
 * `applied`: the doc-wide layer count (P3 L3.15: the latest, never summed), the section's rect with no shift (what
 * stands on it comes fresh with this message) and whether it overflows. Then its agent on stage (M5: one per
 * section) moves right of the tail, takes its box (`tail.box`, else the newest element mark, else the tail), its
 * wires (media marks) and maybe a guide pair. With no agent on stage (a reveal catching up) only the first three change.
 */
function onApplied(state, m, now) {
  const id = m.id;
  if (typeof id !== 'string' || !id) return unchanged(state);
  const s = { ...state };
  if (Number.isSafeInteger(m.layers) && m.layers >= 0) s.layers = m.layers;
  if (isRect(m.rect)) s.rects = { ...state.rects, [id]: [...m.rect] };
  if (typeof m.overflow === 'boolean' && m.overflow !== Boolean(own(state.overflow, id))) {
    s.overflow = { ...state.overflow };
    if (m.overflow) s.overflow[id] = true;
    else delete s.overflow[id];
  }
  const a = onStage(state).find((x) => x.sectionId === id);
  if (!a) return { state: s, effects: [] };
  // P3's marks are the newest elements this apply added, oldest first, at most 24.
  const marks = Array.isArray(m.marks) ? m.marks.filter((k) => isObject(k) && isRect(k.rect)) : [];
  const tail = isObject(m.tail) && isRect(m.tail.rect) ? m.tail : null;
  const lastEl = marks.findLast((k) => k.kind === 'el');
  let { box } = a;
  if (tail && isRect(tail.box)) box = { rect: [...tail.box], tag: tagOf(tail.tag) };
  else if (lastEl) box = { rect: [...lastEl.rect], tag: tagOf(lastEl.tag) };
  else if (tail) box = { rect: [...tail.rect], tag: tagOf(tail.tag) };
  const pos = tail ? { x: tail.rect[0] + tail.rect[2] + 2, y: tail.rect[1] + tail.rect[3] / 2 } : a.pos;
  s.agents = { ...state.agents, [a.id]: { ...a, pos, box } };
  const media = marks.filter((k) => k.kind === 'media').map((k) => ({ rect: [...k.rect], tag: tagOf(k.tag) }));
  s.wires = { ...state.wires };
  if (media.length) s.wires[id] = media;
  else delete s.wires[id];
  return { state: addGuides(s, a, marks, now), effects: [] };
}

const liveGuides = (guides, now) => guides.filter((g) => now - g.at < g.ms + GUIDE_FADE_MS);

/**
 * A guide pair from the first new element at least 60 wide (the mock's `_guideFor`): a red edge down its left side
 * and a blue line along its top carrying the job. Pairs are 500 ms apart at least, and one is added only while at most
 * 4 are live after pruning (the mock's `>= 6` check would let a 7th in). None under reduced motion. On a board both
 * carry `clip`, their section's tile as known then, so they stop at the tile.
 */
function addGuides(s, a, marks, now) {
  if (s.reduced || now - s.lastGuideAt < GUIDE_GAP_MS) return s;
  const el = marks.find((k) => k.kind === 'el' && k.rect[2] >= GUIDE_MIN_W);
  if (!el) return s;
  const live = liveGuides(s.guides, now);
  if (live.length > GUIDE_LIVE_MAX) return live.length === s.guides.length ? s : { ...s, guides: live };
  const [x, y, , h] = el.rect;
  const tile = own(KIND_STAGE, s.kind)?.board ? own(s.rects, a.sectionId) : null;
  const clip = () => (tile ? { clip: [...tile] } : {});
  return {
    ...s,
    lastGuideAt: now,
    guides: [
      ...live,
      { key: `v:${a.id}:${now}`, kind: 'v', color: 'red', x, y0: y - 240, y1: y + h + 460, ms: 1100, at: now, ...clip() },
      { key: `h:${a.id}:${now}`, kind: 'h', color: 'blue', y, ms: 900, tag: a.job, at: now, ...clip() },
    ],
  };
}

/**
 * `picked`: one pin per section id and element path, the message less `t`, whether or not the plan holds the
 * section; a new pick of the same pair replaces it. The chat gets it as a `picked` effect.
 */
function onPicked(state, m) {
  if (typeof m.id !== 'string' || !m.id || typeof m.path !== 'string' || !isRect(m.rect)) return unchanged(state);
  const pin = { id: m.id, path: m.path, tag: tagOf(m.tag), text: m.text ?? '', html: m.html ?? '', rect: [...m.rect] };
  const i = state.pins.findIndex((p) => p.id === pin.id && p.path === pin.path);
  const pins = i === -1 ? [...state.pins, pin] : state.pins.map((p, j) => (j === i ? pin : p));
  return { state: { ...state, pins }, effects: [{ type: 'picked', pin: { ...pin, rect: [...pin.rect] } }] };
}

/** The guides still alive at `now`, each living its `ms` plus a 500 ms fade; the same state when none ended. */
export function pruneGuides(state, now) {
  const guides = liveGuides(state.guides, now);
  return guides.length === state.guides.length ? state : { ...state, guides };
}

/**
 * One action of the person's. `{type:'stopping', on}`: the person's own whole-round Stop is on its way (on), or
 * was refused (off); agents it ends leave quickly. `{type:'resize', stageW, stageH}`: the stage's size.
 * `{type:'viewport', name}`: a page width of `VIEWPORTS`. `{type:'follow'}`: the camera follows the crew again.
 * `{type:'zoom', dy, stageY}`: a ctrl or meta wheel, about the pointer's stage `y` (L4.21).
 * `{type:'pick', on}`: the person wants to pin elements; only a run doc takes `pick`, now or at its `ready`.
 * `{type:'unpin', id, path}`: a pin goes. `{type:'rejoin'}`: the socket said hello again, so an open build asks for a
 * snapshot and holds its drafts until it lands.
 * @returns {{state: object, effects: object[]}}
 */
export function reduceUser(state, action, now = 0) {
  if (!isObject(action)) return unchanged(state);
  switch (action.type) {
    case 'stopping': {
      const on = Boolean(action.on);
      return on === state.stopping ? unchanged(state) : { state: { ...state, stopping: on }, effects: [] };
    }
    case 'resize': return onResize(state, action, now);
    case 'viewport': return onViewport(state, action);
    case 'follow':
      // The mock's `follow`: only a camera the person stopped comes back, and it frames at once against the real scroll.
      if (state.camera.on) return unchanged(state);
      return { state: { ...state, camera: { ...state.camera, on: true, key: '', y: null } }, effects: [] };
    case 'zoom': return onZoom(state, action);
    case 'pick': {
      const on = Boolean(action.on);
      if (on === state.wantPick) return unchanged(state);
      return { state: { ...state, wantPick: on }, effects: state.docMode === 'run' ? [bridge('pick', { on })] : [] };
    }
    case 'unpin': {
      const pins = state.pins.filter((p) => p.id !== action.id || p.path !== action.path);
      return pins.length === state.pins.length ? unchanged(state) : { state: { ...state, pins }, effects: [] };
    }
    case 'rejoin':
      if (!state.buildId || !OPEN_BUILD.includes(state.status)) return unchanged(state);
      return { state: { ...state, resyncing: true }, effects: [{ type: 'subscribe', buildId: state.buildId }] };
    default: return unchanged(state);
  }
}

/**
 * A new stage size reframes and, from a scale at fit, re-fits (the mock's `_layoutView`): the next `cameraStep` frames
 * with `force`, and scroll messages for 600 ms are the iframe's resize, not the person. The same size changes nothing.
 */
function onResize(state, a, now) {
  const { stageW, stageH } = a;
  if (!Number.isFinite(stageW) || !Number.isFinite(stageH) || stageW < 0 || stageH < 0) return unchanged(state);
  if (stageW === state.view.stageW && stageH === state.view.stageH) return unchanged(state);
  const { camera } = state;
  const atFit = camera.scale != null && camera.scale >= selectLayout(state).fit - FIT_SLOP;
  return {
    state: {
      ...state,
      view: { ...state.view, stageW, stageH },
      camera: { ...camera, pendingUntil: now + RESIZE_SETTLE_MS, key: '', force: true, scale: atFit ? null : camera.scale },
    },
    effects: [],
  };
}

/** A new page width re-fits and reframes; the same one, an unknown one or a stage with no viewport switch changes nothing. */
function onViewport(state, a) {
  const { name } = a;
  if (!own(KIND_STAGE, state.kind)?.viewport || typeof name !== 'string' || !Object.hasOwn(VIEWPORTS, name)
    || name === state.view.viewport) return unchanged(state);
  return {
    state: { ...state, view: { ...state.view, viewport: name }, camera: { ...state.camera, scale: null, key: '' } },
    effects: [],
  };
}

/**
 * A zoom (the mock's `_onWheel`), on a wide page only: the scale times `exp(-dy * .01)`, at least 0.45 and at most fit
 * (fit wins, L4.25), keeping the page point under the pointer still. It is instant and stops the camera (M11).
 */
function onZoom(state, a) {
  const { dy, stageY } = a;
  if (!own(KIND_STAGE, state.kind)?.camera || !Number.isFinite(dy) || !Number.isFinite(stageY)) return unchanged(state);
  const { s, fit, pageW, stageH } = selectLayout(state);
  if (pageW < WIDE_PAGE || !(s > 0)) return unchanged(state);
  const scale = Math.min(fit, Math.max(CAMERA_MIN, s * Math.exp(-dy * ZOOM_RATE)));
  const py = stageY / s + state.scroll.y;
  const y = clamp(py - stageY / scale, 0, Math.max(0, state.scroll.docH - stageH / scale));
  return {
    state: { ...state, camera: { ...state.camera, on: false, scale, y } },
    effects: [{ type: 'camera', scale, y, ms: 0 }],
  };
}

/**
 * The scale at which the page fills the stage's width: a wide page (>= 1100) fills it all, a narrower one keeps 40 px
 * each side and never grows past 1 (the mock's `_layoutView`).
 */
export function fitWidth(stageW, pageW) {
  return pageW >= WIDE_PAGE ? Math.min(FIT_MAX, stageW / pageW) : Math.min(1, (stageW - NARROW_SIDES) / pageW);
}

/**
 * The camera's frame for a crew (the mock's `_frameCrew`): every given section on screen, above the HUD band, with
 * lead room above. Fit wins over the 0.45 floor (L4.25); unless `force`, a zoom back in under 6% keeps `curS`, so the
 * page does not pump. The sticky nav is not a fact the bridge reports, so it counts as 0 (L4.22). Null with no rect.
 * @param {{sections: {id: string, rect: number[]}[], stageW: number, stageH: number, pageW: number, docH: number,
 *   curS?: number|null, force?: boolean}} o
 * @returns {{scale: number, y: number, fit: number, spanH: number}|null}
 */
export function frameCrew({ sections, stageW, stageH, pageW, docH, curS = null, force = false }) {
  const rs = (Array.isArray(sections) ? sections : []).map((sec) => sec?.rect).filter(isRect);
  if (!rs.length) return null;
  const top = Math.min(...rs.map((r) => r[1]));
  const spanH = Math.max(...rs.map((r) => r[1] + r[3])) - top;
  const fit = fitWidth(stageW, pageW);
  let scale = Math.min(fit, Math.max(CAMERA_MIN, (stageH - CAMERA_HUD_BAND - 2 * CAMERA_PAD) / spanH));
  if (!force && curS != null && scale > curS && scale < curS * CAMERA_ZOOM_BACK) scale = curS;
  const free = Math.max(0, (stageH - CAMERA_HUD_BAND) / scale - spanH);
  const lead = Math.max(CAMERA_PAD / scale, Math.min(free * LEAD_ROOM, LEAD_ROOM_MAX));
  const y = clamp(top - lead, 0, Math.max(0, docH - stageH / scale));
  return { scale, y, fit, spanH };
}

/**
 * Where the page sits in the stage (M11): `.frame-box` is `pageW` wide and `viewH` tall in page px, scaled by `s` and
 * offset by `ox, oy`. `viewH` is `(stageH - 2 * oy) / s`, so the iframe's viewport tracks the scale (R20). The camera's
 * scale is capped at fit; a narrow page is framed, and so is a zoomed-out one.
 *
 * A board kind (L7.23) sits at scale 1 in its region (`stageRegions`): the whole board, or the fitted run doc, which
 * is framed. A video's `stageH` ends above its timeline, so a parked cursor stays above the raised HUD. Until the
 * stage is measured it is the layout below, whose `s` is 0, so nothing is painted.
 * @returns {{s: number, fit: number, ox: number, oy: number, viewH: number, frameW: number, frameH: number,
 *   pageW: number, stageW: number, stageH: number, narrow: boolean, zoomed: boolean, framed: boolean}}
 */
/**
 * The doc a board lays out for: `docMode`, or while a new round has not loaded its own yet (P4 resets `docMode` at a
 * new build), the doc still on screen. Without it a change round's run doc was laid out as a board until the build
 * doc's `ready`, and the slide jumped to the full well for 1 to 4 painted frames (p8t1).
 */
const shownDoc = (state) => state.docMode ?? state.frameMode ?? null;

export function selectLayout(state) {
  const { stageW, stageH, viewport } = state.view;
  if (own(KIND_STAGE, state.kind)?.board && stageW > 0 && stageH > 0) {
    const shown = shownDoc(state);
    const { frame: f, timeline } = stageRegions({ kind: state.kind, docMode: shown, cw: stageW, ch: stageH });
    return {
      s: 1, fit: 1, ox: f.x, oy: f.y, viewH: f.h, frameW: f.w, frameH: f.h, pageW: f.w,
      stageW, stageH: timeline ? timeline.y : stageH,
      narrow: false, zoomed: false, framed: shown === 'run',
    };
  }
  const pageW = own(VIEWPORTS, viewport) ?? pageWidth(state);
  const fit = fitWidth(stageW, pageW);
  const s = Math.min(state.camera.scale ?? fit, fit);
  const narrow = pageW < WIDE_PAGE;
  const oy = narrow ? NARROW_TOP : 0;
  const viewH = (stageH - 2 * oy) / s;
  const zoomed = s < fit - FIT_SLOP;
  return {
    s, fit, ox: Math.max(0, (stageW - pageW * s) / 2), oy, viewH, frameW: pageW * s, frameH: viewH * s,
    pageW, stageW, stageH, narrow, zoomed, framed: narrow || zoomed,
  };
}

/**
 * The crew the camera frames, as section ids with a known rect: each section a builder on stage holds (only a waiting
 * builder's while paused, the mock's `_frameCrew`) and each failed section (L4.24), each list sorted.
 */
function crewOnCamera(state, status) {
  const crew = new Set();
  for (const a of onStage(state)) {
    if (a.role !== 'builder' || (status === 'paused' && a.status !== 'waiting')) continue;
    if (own(state.rects, a.sectionId)) crew.add(a.sectionId);
  }
  const failed = Object.keys(state.sections)
    .filter((id) => state.sections[id]?.status === 'failed' && own(state.rects, id));
  return { crew: [...crew].sort(), failed: failed.sort() };
}

/**
 * The camera, run after every input (M11): on the web stage's build doc it frames the crew whenever the crew changes,
 * and only then (L4.23), emitting `{type:'camera', scale, y, ms}`. A first round done goes back to fit-width at the
 * top, once; a change round done, a halted round and a round the person is stopping keep the scale and target (L4.32). A move that changes the scale
 * by under .002 and shifts the page under 20 screen px is skipped, keeping the new crew key and the old target. It
 * frames nothing until the stage is measured and the frame has reported the page's height. The next call after a
 * `resize` clears its `force`.
 * @returns {{state: object, effects: object[]}}
 */
export function cameraStep(state, now = 0) {
  if (!own(KIND_STAGE, state.kind)?.camera || state.docMode === 'run') return unchanged(state);
  const { camera } = state;
  const { force } = camera;
  const next = (fields, effects = []) => ({ state: { ...state, camera: { ...camera, force: false, ...fields } }, effects });
  const idle = () => (force ? next({}) : unchanged(state));
  const move = (scale, y) => ({ type: 'camera', scale, y, ms: state.reduced ? 0 : CAMERA_EASE_MS });
  if (state.status === 'done') {
    if (camera.doneFramed) return idle();
    if (state.buildKind !== 'first') return next({ doneFramed: true });
    const { fit } = selectLayout(state);
    return next({ doneFramed: true, on: true, scale: null, y: 0, pendingUntil: now + CAMERA_EASE_MS + CAMERA_SETTLE_MS }, [move(fit, 0)]);
  }
  const status = effectiveStatus(state);
  // The person's own whole-round Stop holds the zoom (L4.32): P2 ends each agent with its own `stopped` frame before
  // the build's, and the crew shrinking under those must not move the camera (L4.34).
  if ((status !== 'building' && status !== 'paused') || !camera.on || state.stopping) return idle();
  // Nothing to frame against yet, so the crew's key is not taken: a stage not measured, or a round's page whose height
  // the frame has not reported (a new round starts at `docH` 0, and its `applied` can bring a rect before `rects`).
  const layout = selectLayout(state);
  if (!(layout.s > 0) || !(state.scroll.docH > 0)) return idle();
  const { crew, failed } = crewOnCamera(state, status);
  const key = `${crew.join(',')}|${failed.join(',')}|${status}`;
  if (key === camera.key) return idle();
  const curS = camera.scale ?? layout.fit;
  const f = frameCrew({
    sections: [...crew, ...failed].map((id) => ({ id, rect: state.rects[id] })),
    stageW: layout.stageW, stageH: layout.stageH, pageW: layout.pageW, docH: state.scroll.docH, curS, force,
  });
  if (!f) return next({ key });
  const curY = camera.y ?? state.scroll.y;
  if (!force && Math.abs(f.scale - curS) < SCALE_SLOP && Math.abs(f.y - curY) * f.scale < CAMERA_MIN_SHIFT) return next({ key });
  return next({ key, scale: f.scale, y: f.y, pendingUntil: now + CAMERA_EASE_MS + CAMERA_SETTLE_MS }, [move(f.scale, f.y)]);
}

/**
 * Where each cursor is drawn, in document coordinates (the mock's `_drawCursorsPage`), with the same count in and out.
 * A cursor whose screen `y` (`oy + (y - scrollY) * s`) falls below the HUD band parks on it (`parked: 1`); with more
 * than 4 there, they spread over the frame's width in input order. One above the top edge (`oy + 8`), once the page is
 * scrolled, parks there (`parked: -1`), stacked by colour. Every `x` stays inside the stage.
 * @param {object[]} cursors `selectCursors` rows: `{agentId, x, y, colorIndex, …}`
 * @param {{scrollY: number, s: number, ox: number, oy: number, stageW: number, stageH: number, frameW: number}} view
 * @returns {object[]} each cursor with `x`, `y` and `parked` (-1, 0 or 1)
 */
export function placeCursors(cursors, view) {
  const { scrollY, s, ox, oy, stageW, stageH, frameW } = view;
  const band = stageH - CAMERA_HUD_BAND;
  const screenY = (y) => oy + (y - scrollY) * s;
  const below = cursors.filter((c) => screenY(c.y) > band);
  const spread = below.length > PARK_SPREAD_MIN;
  const minX = (PARK_LEFT - ox) / s;
  const maxX = (stageW - PARK_RIGHT - ox) / s;
  return cursors.map((c) => {
    let { x, y } = c;
    let parked = 0;
    const i = below.indexOf(c);
    if (i !== -1) {
      parked = 1;
      y = scrollY + (band - oy) / s;
      if (spread) x = (PARK_SPREAD_X + ((i + 0.5) * Math.max(0, frameW - PARK_SPREAD_PAD)) / below.length) / s;
    } else if (screenY(c.y) < oy + PARK_TOP && scrollY > PARK_SCROLLED) {
      parked = -1;
      y = scrollY + (PARK_TOP + ((c.colorIndex ?? 0) % 3) * PARK_ROW) / s;
    }
    return { ...c, x: clamp(x, minX, maxX), y, parked };
  });
}

/**
 * One cursor per agent on stage, in the order the agents first appeared, where the facts put it. A video scene's
 * agent writing its script is labelled `<job> · timeline`.
 */
export function selectCursors(state) {
  return onStage(state).map((a) => ({
    agentId: a.id, role: a.role, job: cursorLabel({ kind: state.kind, job: a.job, part: draftTarget(a.tool?.path)?.part }),
    sectionId: a.sectionId, crew: crewOf(a), colorIndex: a.colorIndex,
    waiting: a.status === 'waiting', ...positionOf(state, a),
  }));
}

/** A plan section's job, else its id. */
function jobOf(state, id) {
  const sec = own(state.sections, id);
  return typeof sec?.job === 'string' && sec.job ? sec.job : String(id ?? '');
}

/**
 * A pin's tag, read the same way by its box and the chat's chip (the mock's `_pinLabel`): `Job › "text"`, the first
 * line of the text cut at 22 characters with `…`, or `Job › tag` with no text. The job falls back to the section id.
 */
export function pinLabel(state, pin) {
  const job = jobOf(state, pin?.id);
  const line = typeof pin?.text === 'string' ? pin.text.split('\n')[0].trim() : '';
  if (!line) return `${job} › ${tagOf(pin?.tag)}`;
  return `${job} › "${line.length > 22 ? `${line.slice(0, 22)}…` : line}"`;
}

const area = ([, , w, h]) => w * h;
const meterText = (n) => (n < 1024 ? `js ${n} B` : `js ${(n / 1024).toFixed(1)} KB`);
// A guide's tile goes along only when it has one, so a web guide keeps its exact shape.
const guideMark = (g) => ({
  ...(g.kind === 'v'
    ? { key: g.key, kind: g.kind, color: g.color, x: g.x, y0: g.y0, y1: g.y1, ms: g.ms }
    : { key: g.key, kind: g.kind, color: g.color, y: g.y, ms: g.ms, tag: g.tag }),
  ...(g.clip ? { clip: [...g.clip] } : {}),
});
/** A size tag on a board's tile, in slide px. */
const tileTag = (tag, rect, s) => {
  const [w, h] = tagSize(rect, s);
  return `${tag} ${w}×${h}`;
};

/** Each section's JS length, summed over its JS drafts. */
function jsLengths(state) {
  const by = new Map();
  for (const d of Object.values(state.drafts)) {
    if (d?.part === 'js' && d.sectionId) by.set(d.sectionId, (by.get(d.sectionId) ?? 0) + (d.bytes ?? 0));
  }
  return by;
}

/**
 * Every mark the overlay draws, in document coordinates, each from a fact (SPEC's facts-to-marks table and Contract
 * issue 8), keyed for the overlay to reconcile: the blue box of a writing agent's element, the orange box of a section
 * read, the red box of an overflow, the wireframe of new media, guides, `+` on sections still planned, slot lines while
 * planning, failed sections, the JS meter and pins. A round ended `done` shows only pins; a halted one keeps `+`,
 * failed boxes and pins.
 *
 * A board kind's marks also hold `tiles` (L7.27, L7.32): while its board is up (`selectBoard`), one per section not
 * removed whose rect the frame reported, numbered in plan order as the rail numbers them, through a halted round too,
 * and through a done one until the run doc replaces the build doc. On a board a box and a wireframe carry their tile
 * as `clip`.
 * Its size tags read slide px, and it draws no slot line: a full-width line would cross every tile.
 * @returns {{boxes: object[], oranges: object[], reds: object[], wires: object[], guides: object[], plus: object[],
 *   slotLines: object[], failed: object[], meters: object[], pins: object[],
 *   tiles?: {key: string, rect: number[], label: string, planned: boolean, done: boolean}[]}}
 */
export function selectMarks(state, now = 0) {
  const marks = {
    boxes: [], oranges: [], reds: [], wires: [], guides: [], plus: [], slotLines: [], failed: [], meters: [],
    pins: state.pins.map((p) => ({ key: `${p.id}|${p.path}`, rect: [...p.rect], tag: pinLabel(state, p) })),
  };
  if (own(KIND_STAGE, state.kind)?.board) marks.tiles = [];
  const board = selectBoard(state);
  // Tiles label the build doc's board, a done round's too, until the run doc takes its place (p8t1).
  if (board) {
    planSections(state).forEach(([id, sec], i) => {
      const r = own(state.rects, id);
      if (r) {
        // Two spaces after the number, as engine.js:1653 draws the chip; no-break, so the DOM keeps both.
        marks.tiles.push({
          key: id, rect: [...r], label: `${i + 1}\u00a0\u00a0${jobOf(state, id)}`, planned: sec.status === 'planned', done: sec.status === 'done',
        });
      }
    });
  }
  if (state.status === 'done') return marks;
  const sized = (tag, rect) => (board ? tileTag(tag, rect, board.s) : sizeTag(tag, rect));
  // On a board a box and a wireframe stay inside their tile, as engine.js:1640-1650 clips them: `clip` is the tile.
  const clipTo = (id) => {
    const r = board ? own(state.rects, id) : null;
    return r ? { clip: [...r] } : {};
  };
  const placed = [];
  for (const id of state.sectionOrder) {
    const sec = own(state.sections, id);
    const r = own(state.rects, id);
    if (sec && r) placed.push([id, sec, r]);
  }
  for (const [id, sec, r] of placed) {
    if (sec.status === 'planned') marks.plus.push({ key: id, x: r[0] + Math.min(16, r[2] * 0.2), y: r[1] + Math.min(14, r[3] * 0.5) });
    else if (sec.status === 'failed') marks.failed.push({ key: id, rect: [...r], tag: `${jobOf(state, id)} failed` });
  }
  // `done` returned above, so this is a round stopped, paused, failed or interrupted.
  if (HALTED_BUILD.includes(state.status)) return marks;
  for (const a of onStage(state)) {
    if (a.status === 'writing' && a.box) marks.boxes.push({ key: a.id, rect: [...a.box.rect], tag: sized(a.box.tag, a.box.rect), ...clipTo(a.sectionId) });
    const read = own(state.rects, a.reading);
    if (read) marks.oranges.push({ key: a.id, rect: [...read], tag: jobOf(state, a.reading) });
  }
  for (const id of Object.keys(state.overflow)) {
    const r = own(state.rects, id);
    if (r) marks.reds.push({ key: id, rect: [...r], tag: 'Overflow' });
  }
  for (const [id, list] of Object.entries(state.wires)) {
    if (own(state.sections, id)?.status === 'done') continue;
    const main = list.reduce((best, w, i) => (area(w.rect) > area(list[best].rect) ? i : best), 0);
    list.forEach((w, i) => marks.wires.push({ key: `${id}:${i}`, rect: [...w.rect], tag: i === main ? sized(w.tag, w.rect) : null, main: i === main, ...clipTo(id) }));
  }
  marks.guides = liveGuides(state.guides, now).map(guideMark);
  if (effectiveStatus(state) === 'planning' && !board) {
    for (const [id, sec, r] of placed) if (sec.status !== 'removed') marks.slotLines.push({ key: id, y: r[1], tag: jobOf(state, id) });
  }
  const js = jsLengths(state);
  for (const [id, , r] of placed) if (js.get(id) > 0) marks.meters.push({ key: id, rect: [...r], text: meterText(js.get(id)) });
  return marks;
}

/**
 * A board kind's tile grid while the frame holds the build doc (M9, L7.32): `boardLayout` for the sections not removed
 * in the board's region. Null off board kinds, over the run doc (a restore loads it at any status, and its bridge
 * reports rects too, which no tile may stand on), on a stage not yet measured and with no section.
 * @returns {{cols: number, rows: number, s: number, tileW: number, tileH: number, gap: number, pad: number,
 *   fits: boolean}|null}
 */
export function selectBoard(state) {
  const { stageW, stageH } = state.view;
  const shown = shownDoc(state);
  if (!own(KIND_STAGE, state.kind)?.board || shown === 'run' || !(stageW > 0) || !(stageH > 0)) return null;
  const regions = stageRegions({ kind: state.kind, docMode: shown, cw: stageW, ch: stageH });
  return boardLayout({ n: planSections(state).length, cw: regions.frame.w, availH: regions.availH, canvas: BOARD_CANVAS });
}

/**
 * What the deck and video chrome (kind-chrome.mjs) paints from: `kindChromeView` of the sections not removed, in plan
 * order, live while the round is open (a pause included).
 */
export function selectKindChrome(state) {
  const sections = planSections(state).map(([id, sec]) => ({
    id, job: jobOf(state, id), status: sec.status,
    agentId: typeof sec.agentId === 'string' && sec.agentId ? sec.agentId : null,
    duration: Number.isFinite(sec.duration) ? sec.duration : null,
  }));
  return kindChromeView({
    kind: state.kind, live: OPEN_BUILD.includes(state.status), docMode: state.docMode, sections,
    stageW: state.view.stageW, stageH: state.view.stageH,
  });
}

// The HUD, the Agents popover's rows and the chat's Plan list (SPEC sections 3 and 7, M5, M8, M12, M13): plain objects
// hud.mjs, agents-panel.mjs and plan-list.mjs paint. Every count comes from the frames: HUD `agents` is the cursors
// (M12: running + waiting), never `stats.agentsNow`, and the sections from the plan; `stats` gives only the round's
// cost, its time and `Built by N` (M6).

/** Each agent status's word (P2's AGENT_STATUSES). */
const STATUS_WORDS = Object.freeze({
  starting: 'Starting', thinking: 'Thinking', writing: 'Writing', reading: 'Reading', waiting: 'Waiting',
  retrying: 'Retrying', done: 'Done', stopped: 'Stopped', error: 'Failed', interrupted: 'Interrupted',
});
/** A halted round's word, which also heads its HUD text. */
const HALT_WORDS = Object.freeze({ paused: 'Paused', stopped: 'Stopped', error: 'Failed', interrupted: 'Interrupted' });
/** The HUD's phase per build status, read through `effectiveStatus` (L4.35). */
const HUD_PHASES = Object.freeze({
  planning: 'plan', building: 'build', integrating: 'build', done: 'end',
  paused: 'halt', stopped: 'halt', error: 'halt', interrupted: 'halt',
});
// What a writing or reading agent's tool does: these name the file they touch, a search names none. P2 forwards every
// tool (Bash included); any other shows the status word.
const TOOL_VERBS = Object.freeze({ Write: 'Writing', Edit: 'Editing', Read: 'Reading' });
const SEARCH_TOOLS = Object.freeze(['Grep', 'Glob']);
const ERROR_MAX = 80;
// A finished agent that failed loses its crew colour in the popover.
const FAILED_TOKEN = '--ink-3';
// The build statuses P2's `continue` picks a round up from, besides a `done` round with sections stopped (`partial`).
const RETRY_FROM = Object.freeze(['paused', 'stopped', 'error', 'interrupted']);
const SEP = ' · ';

const usd = (v) => `$${v.toFixed(2)}`;
/** `n noun`, singular only at 1. */
const counted = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;
const baseName = (path) => (typeof path === 'string' ? path.split(/[\\/]/).filter(Boolean).at(-1) ?? '' : '');
const capText = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The word for an agent status, or '' for one P2 does not send. */
export function statusWord(status) {
  return own(STATUS_WORDS, status) ?? '';
}

/**
 * What an agent is doing, in words: a waiting one waits for an answer, a finished one shows its section's summary,
 * a failed one its error (one line, at most 80 characters); a writing or reading one names its tool's file
 * (`Writing index.html`) or searches; anything else is its status word.
 * @param {{status?: string, tool?: {name?: string, path?: string|null}|null, error?: string|null}} agent
 * @param {{summary?: string}|null} [section] the agent's plan section
 */
export function agentAction(agent, section) {
  const status = agent?.status;
  switch (status) {
    case 'waiting': return 'Waiting for your answer';
    case 'done': {
      const summary = typeof section?.summary === 'string' ? section.summary.trim() : '';
      return summary || 'Finished';
    }
    case 'stopped': return 'Stopped';
    case 'interrupted': return 'Interrupted by a restart';
    case 'error': {
      const error = typeof agent.error === 'string' ? agent.error.replace(/\s+/g, ' ').trim() : '';
      return error ? capText(error, ERROR_MAX) : 'Failed';
    }
    default: break;
  }
  const tool = isObject(agent?.tool) ? agent.tool : null;
  if (tool && (status === 'writing' || status === 'reading')) {
    if (SEARCH_TOOLS.includes(tool.name)) return 'Searching';
    const verb = own(TOOL_VERBS, tool.name);
    const file = baseName(tool.path);
    if (verb && file) return `${verb} ${file}`;
  }
  return statusWord(status);
}

/** A round's or an agent's running time: `40s`, `6m 14s`, `1h 2m`. */
export function fmtElapsed(ms) {
  const sec = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

/**
 * An agent's cost (SPEC section 7): blank with `cost unknown` as its title when P2 cannot know it, never $0; `$x.xx`
 * once it is final; `≥$x.xx` from the live estimate until then; blank when a model has no price (`estimatedUsd` null).
 * @returns {{text: string, title: string}}
 */
export function fmtAgentCost(a) {
  if (!a?.costKnown) return { text: '', title: 'cost unknown' };
  if (Number.isFinite(a.costUsd)) return { text: usd(a.costUsd), title: '' };
  if (Number.isFinite(a.estimatedUsd)) return { text: `≥${usd(a.estimatedUsd)}`, title: '' };
  return { text: '', title: '' };
}

/** The HUD's in-place Stop question for `n` agents. */
export function stopWords(n) {
  return n === 1 ? 'Stop 1 agent?' : `Stop ${n} agents?`;
}

/** The plan sections still in the plan (not `removed`), in plan order, as `[id, section]`. */
function planSections(state) {
  const out = [];
  for (const id of state.sectionOrder) {
    const sec = own(state.sections, id);
    if (sec && sec.status !== 'removed') out.push([id, sec]);
  }
  return out;
}

/** The round's cost from `stats`: spent plus the live estimate, or `cost unknown`. */
function roundCost(stats) {
  if (!isObject(stats) || !stats.costKnown) return 'cost unknown';
  const n = (v) => (Number.isFinite(v) ? v : 0);
  return usd(n(stats.costUsd) + n(stats.estimatedUsd));
}

/** Whether P2's `continue` would take the round now (L4.13): a paused or halted round, or one done with sections stopped. */
function canRetry(state) {
  return RETRY_FROM.includes(state.status) || (state.status === 'done' && state.reason === 'partial');
}

/** The HUD's state word and its class: the first that holds of a round ended, halted, failed, waiting or at work. */
function hudWord(state, phase, status, failed, waiting) {
  if (phase === 'end') return [state.buildKind === 'change' ? 'Changed' : 'Built', 'is-ok'];
  if (phase === 'halt') return [HALT_WORDS[status], failed > 0 || status === 'error' ? 'is-fail' : 'is-stop'];
  if (failed > 0) return [`${failed} failed`, 'is-fail'];
  if (waiting > 0) return ['Needs you', 'is-need'];
  if (status === 'planning') return ['Planning', 'is-work'];
  if (status === 'integrating') return ['Integrating', 'is-work'];
  return [state.buildKind === 'change' ? 'Changing' : 'Building', 'is-work'];
}

/**
 * What the HUD shows (SPEC section 3, M12): the phase (`none` with no build), the state word and its class, the text,
 * the cost while the round runs (in the text once it ends or halts), the line's width, the counts, one dot per cursor
 * labelled `job: action`, the Stop question, whether Follow shows (building with the camera off) and whether Resume
 * can work. It has no limit field (M13): a round paused at a worca limit resumes once Settings raise it.
 * @returns {{phase: 'none'|'plan'|'build'|'end'|'halt', word: string, wordClass: string, text: string, cost: string,
 *   pct: string, agents: number, waiting: number, failed: number, stopped: number,
 *   dots: {agentId: string, crew: string, waiting: boolean, label: string}[], stopWord: string, followOff: boolean,
 *   canResume: boolean, buildId: string|null}}
 */
export function selectHud(state) {
  const status = effectiveStatus(state);
  const phase = state.buildId ? own(HUD_PHASES, status) ?? 'none' : 'none';
  const crew = onStage(state);
  const agents = crew.length;
  const waiting = crew.filter((a) => a.status === 'waiting').length;
  const secs = planSections(state);
  const planned = secs.length;
  const done = secs.filter(([, s]) => s.status === 'done').length;
  const failed = secs.filter(([, s]) => s.status === 'failed').length;
  const stopped = secs.filter(([, s]) => s.status === 'stopped').length;
  const dots = crew.map((a) => ({
    agentId: a.id, crew: crewOf(a), waiting: a.status === 'waiting',
    label: `${a.job}: ${agentAction(a, own(state.sections, a.sectionId))}`,
  }));
  const hud = {
    phase, word: '', wordClass: '', text: '', cost: '', pct: `${planned > 0 ? Math.round((100 * done) / planned) : 0}%`,
    agents, waiting, failed, stopped, dots, stopWord: stopWords(agents),
    followOff: status === 'building' && !state.camera.on, canResume: canRetry(state), buildId: state.buildId,
  };
  if (phase === 'none') return hud;
  [hud.word, hud.wordClass] = hudWord(state, phase, status, failed, waiting);
  const cost = roundCost(state.stats);
  const sections = `${done} / ${planned} ${own(KIND_NOUN, state.kind) ?? 'section'}${planned === 1 ? '' : 's'}`;
  const layers = counted(state.layers, 'layer');
  const failedPart = failed > 0 ? [`${failed} failed`] : [];
  if (phase === 'plan') return { ...hud, text: 'Planning…', cost };
  if (phase === 'build') {
    const text = status === 'integrating' ? 'Integrating…'
      : [counted(agents, 'agent'), ...(waiting > 0 ? [`${waiting} waiting`] : []), ...failedPart, sections, layers].join(SEP);
    return { ...hud, text, cost };
  }
  if (phase === 'halt') return { ...hud, text: [hud.word, ...failedPart, sections, layers, cost].join(SEP) };
  const total = Number.isSafeInteger(state.stats?.agentsTotal) && state.stats.agentsTotal > 0 ? state.stats.agentsTotal : 0;
  const by = `${hud.word} by ${counted(total, 'agent')} in ${fmtElapsed(state.stats?.elapsedMs)}`;
  return { ...hud, text: [by, cost, ...(stopped > 0 ? [`${stopped} stopped`] : [])].join(SEP) };
}

const KIND_THING = Object.freeze({ web: 'page', presentation: 'deck', pitch: 'deck', video: 'video' });
const STANDBY_HALT = Object.freeze({ paused: 'Paused before the plan', stopped: 'Stopped before the plan', error: 'The build failed before the plan', interrupted: 'Interrupted before the plan' });

/**
 * What the well shows INSTEAD of the frame while the frame has nothing to show: a design never built, whose round has
 * no plan and no draft yet. `null` once there is something to look at (a plan's slots, a draft, a built page), and the
 * frame shows from then on. `built` is whether the design has a page from an earlier round; `chatBusy` whether the chat
 * is working on a message. `busy` rows carry the orb; `doing` is what the lead does right now, when it says.
 * @param {object} state
 * @param {{built?: boolean, chatBusy?: boolean}} [o]
 * @returns {{busy: boolean, title: string, text: string, doing: string}|null}
 */
export function selectStandby(state, { built = false, chatBusy = false } = {}) {
  if (built || state.status === 'done') return null;
  if (planSections(state).length > 0 || Object.keys(state.drafts).length > 0) return null;
  const thing = own(KIND_THING, state.kind) ?? 'page';
  const noun = own(KIND_NOUN, state.kind) ?? 'section';
  const status = state.buildId ? effectiveStatus(state) : null;
  if (LIVE_BUILD.includes(status)) {
    const lead = onStage(state).find((a) => a.role === 'lead');
    const doing = lead ? agentAction(lead, null) : '';
    return {
      busy: true, title: `Planning the ${thing}`,
      text: `The lead is working out the ${noun}s. They show up here as soon as the plan is ready.`,
      doing: doing && doing !== 'Thinking' && doing !== 'Starting' ? doing : '',
    };
  }
  if (status && own(STANDBY_HALT, status)) return { busy: false, title: STANDBY_HALT[status], text: 'Nothing was built yet.', doing: '' };
  if (chatBusy) return { busy: true, title: 'Reading your request', text: `The ${thing} shows up here once the crew starts.`, doing: '' };
  return { busy: false, title: 'Nothing built yet', text: '', doing: '' };
}

/**
 * The Agents popover's rows: the agents on stage first, then the finished ones, each group in the order the agents
 * first appeared, so a finished agent stays listed. A per-agent Stop shows only on a builder on stage while the build
 * runs: P2 refuses it for a paused build (`routes.mjs:217-219`), and the lead ends with the whole-round Stop.
 * @returns {{running: number, rows: {agentId: string, name: string, crew: string, status: string,
 *   statusClass: string, action: string, cost: string, costTitle: string, gone: boolean, canStop: boolean}[]}}
 */
export function selectAgentRows(state) {
  const all = state.agentOrder.map((id) => own(state.agents, id)).filter(Boolean);
  const live = LIVE_BUILD.includes(state.status);
  const row = (a) => {
    const gone = !isOnStage(a);
    const cost = fmtAgentCost(a);
    return {
      agentId: a.id, name: a.job, crew: gone && a.status === 'error' ? FAILED_TOKEN : crewOf(a),
      status: statusWord(a.status), statusClass: a.status === 'waiting' ? 'is-need' : a.status === 'error' ? 'is-fail' : '',
      action: agentAction(a, own(state.sections, a.sectionId)), cost: cost.text, costTitle: cost.title,
      gone, canStop: !gone && a.role === 'builder' && live,
    };
  };
  const on = all.filter(isOnStage);
  return { running: on.length, rows: [...on, ...all.filter((a) => !isOnStage(a))].map(row) };
}

/** A Plan list row's state: the first of failed, all done, an agent waiting, stopped with no agent, at work, planned. */
function planRowState(statuses, who) {
  if (statuses.includes('failed')) return 'failed';
  if (statuses.every((st) => st === 'done')) return 'done';
  if (who.some((a) => a.status === 'waiting')) return 'waiting';
  if (!who.length && statuses.includes('stopped')) return 'stopped';
  if (who.length || statuses.includes('writing')) return 'active';
  return 'planned';
}

/**
 * The chat's Plan list (M5, M8, M12, L4.12): the sections still planned, counted with the stage's noun; one row per
 * run of adjacent sections sharing a `band` (named by it, with the count of its sections), or per section with none
 * (named by its job, no count), keyed by its first section's id; one dot per builder on stage on the row's sections.
 * Then the stopped sections and the failed ones (with the agent Details opens), and whether Retry can work now.
 * @returns {{count: number, noun: string, rows: {key: string, name: string, n: number|null, state: string,
 *   who: {agentId: string, crew: string}[]}[], stopped: {id: string, name: string}[],
 *   failed: {id: string, name: string, agentId: string|null}[], canRetry: boolean}}
 */
export function selectPlanRows(state) {
  const secs = planSections(state);
  const groups = [];
  for (const [id, sec] of secs) {
    const band = typeof sec.band === 'string' && sec.band ? sec.band : null;
    const last = groups.at(-1);
    if (band && last?.band === band) last.secs.push([id, sec]);
    else groups.push({ key: id, band, secs: [[id, sec]] });
  }
  const builders = onStage(state).filter((a) => a.role === 'builder');
  const rows = groups.map(({ key, band, secs: group }) => {
    const ids = group.map(([id]) => id);
    const who = builders.filter((a) => ids.includes(a.sectionId));
    return {
      key, name: band ?? jobOf(state, key), n: band ? group.length : null,
      state: planRowState(group.map(([, s]) => s.status), who),
      who: who.map((a) => ({ agentId: a.id, crew: crewOf(a) })),
    };
  });
  const count = secs.length;
  return {
    count,
    noun: `${own(KIND_NOUN, state.kind) ?? 'section'}${count === 1 ? '' : 's'}`,
    rows,
    stopped: secs.filter(([, s]) => s.status === 'stopped').map(([id]) => ({ id, name: jobOf(state, id) })),
    failed: secs.filter(([, s]) => s.status === 'failed').map(([id, s]) => ({
      id, name: jobOf(state, id), agentId: typeof s.agentId === 'string' && s.agentId ? s.agentId : null,
    })),
    canRetry: canRetry(state),
  };
}
