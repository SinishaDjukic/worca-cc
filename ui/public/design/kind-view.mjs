// The stage of a deck or a video (M9, L5, L7.23): the mockup's geometry (`canvas/src/engine.js` `_layoutView` and
// `_tileGeom`) as pure numbers. While a round builds, every slide or scene is a 1920×1080 tile on one board; once the
// frame holds the run doc, a deck is one fitted slide beside its rail and a video one fitted frame above its timeline.
// No DOM, no timers: stage-model.mjs reads the layout and the marks from here, kind-chrome.mjs the board message.
//
// A browser module cannot reach src/core, so the kind predicates repeat src/core/design/kinds.mjs over the shared list.

import { DECK_KINDS } from '../../../src/shared/design-names.mjs';

/** Every board kind's canvas (P1's `validatePlan`: exactly 1920×1080). */
export const BOARD_CANVAS = Object.freeze({ w: 1920, h: 1080 });

// `_tileGeom` (engine.js:849): the board's padding and the gap between tiles. A tile narrower than this scrolls instead.
const PAD = 16;
const GAP = 12;
const TILE_MIN_W = 200;
// Board scales are kept to 6 decimals, floored, so a tile never outgrows its track.
const SCALE_STEPS = 1e6;
// `_layoutView` (engine.js:823-836): the deck's board leaves 92 px under it and the video's 86 px above its 128 px
// timeline; their bottom padding is that less the top padding.
const DECK_BOARD_FOOT = 92;
const FILM_BOARD_FOOT = 86;
const TIMELINE_H = 128;
// The fitted run doc: a 1280×720 page scaled into the room left. A deck's rail is 148 px wide, and none below 560 px.
const PAGE_W = 1280;
const PAGE_H = 720;
/** A finished deck's rail width (`_layoutView`, engine.js:824); deck-rail.mjs lays its thumbnails out in it. */
export const RAIL_W = 148;
const RAIL_MIN_STAGE = 560;
const FIT_SIDES = 48;
const DECK_FIT_FOOT = 100;
const DECK_FIT_HUD = 76;
const DECK_FIT_TOP = 16;
const FILM_FIT_FOOT = 96;
const FILM_FIT_HUD = 76;
const FILM_FIT_TOP = 14;
// The board message's tile radius and the well colour behind the tiles: frame data for the build doc, not stage CSS.
const TILE_R = 8;
const BOARD_BG = '#101217';

const NOUNS = Object.freeze({ web: 'section', presentation: 'slide', pitch: 'slide', video: 'scene' });

/** Whether `kind` is a slide deck (`presentation` or `pitch`). */
export function isDeckKind(kind) {
  return DECK_KINDS.includes(kind);
}

/** Whether `kind` builds as a board of 1920×1080 tiles: a deck or a video. */
export function isBoardKind(kind) {
  return isDeckKind(kind) || kind === 'video';
}

/** `n` of a kind's units: `12 slides`' noun, singular only at 1. */
export function unitNoun(kind, n) {
  const noun = Object.hasOwn(NOUNS, kind) ? NOUNS[kind] : NOUNS.web;
  return n === 1 ? noun : `${noun}s`;
}

/**
 * The tile grid for `n` tiles in a `cw` wide board with `availH` of room (the mock's `_tileGeom`): the column count
 * whose tile is widest, the first of equals. A tile under 200 px wide takes the most columns that keep 200 px
 * instead, and the board scrolls (`fits` false). Null with no tile.
 * @param {{n: number, cw: number, availH: number, canvas: {w: number, h: number}}} o
 * @returns {{cols: number, rows: number, s: number, tileW: number, tileH: number, gap: number, pad: number,
 *   fits: boolean}|null}
 */
export function boardLayout({ n, cw, availH, canvas }) {
  if (!Number.isSafeInteger(n) || n < 1) return null;
  const byW = (cols) => (cw - 2 * PAD - GAP * (cols - 1)) / cols;
  let cols = 1;
  let raw = -Infinity;
  for (let c = 1; c <= n; c += 1) {
    const rows = Math.ceil(n / c);
    const w = Math.min(byW(c), ((availH - GAP * (rows - 1)) / rows) * (canvas.w / canvas.h));
    if (w > raw) {
      raw = w;
      cols = c;
    }
  }
  let forced = false;
  if (raw < TILE_MIN_W) {
    cols = 1;
    for (let c = n; c >= 1; c -= 1) {
      if (byW(c) >= TILE_MIN_W) {
        cols = c;
        break;
      }
    }
    raw = byW(cols);
    forced = true;
  }
  const rows = Math.ceil(n / cols);
  const s = Math.floor((raw / canvas.w) * SCALE_STEPS) / SCALE_STEPS;
  const tileW = canvas.w * s;
  const tileH = canvas.h * s;
  const fits = !forced && rows * tileH + GAP * (rows - 1) <= availH + 0.5;
  return { cols, rows, s, tileW, tileH, gap: GAP, pad: PAD, fits };
}

/** A 1280×720 page fitted at the scale given: its height is its width's 9/16, so the rows compare exactly. */
function fitted(s) {
  const w = PAGE_W * s;
  return { w, h: (w * 9) / 16 };
}

/**
 * Where a kind's stage puts the frame and what goes around it (the mock's `_layoutView`). Any doc but the run doc
 * (null before the first `ready` included) is the build doc's board. Every arm returns every key.
 * @param {{kind: string, docMode: string|null, cw: number, ch: number}} o
 * @returns {{board: boolean, frame: {x: number, y: number, w: number, h: number}, availH: number, padB: number,
 *   rail: {x: number, y: number, w: number, h: number}|null, timeline: {x: number, y: number, w: number, h: number}|null,
 *   transport: boolean, hudRaised: boolean}}
 */
export function stageRegions({ kind, docMode, cw, ch }) {
  const film = kind === 'video';
  const timeline = film ? { x: 0, y: ch - TIMELINE_H, w: cw, h: TIMELINE_H } : null;
  const out = {
    board: false, frame: { x: 0, y: 0, w: cw, h: ch }, availH: ch, padB: 0, rail: null, timeline, transport: false,
    hudRaised: film,
  };
  if (!isBoardKind(kind)) return out;
  if (docMode !== 'run') {
    if (!film) return { ...out, board: true, availH: ch - DECK_BOARD_FOOT, padB: DECK_BOARD_FOOT - PAD };
    return {
      ...out, board: true, frame: { x: 0, y: 0, w: cw, h: ch - TIMELINE_H }, availH: ch - TIMELINE_H - FILM_BOARD_FOOT,
      padB: FILM_BOARD_FOOT - PAD,
    };
  }
  if (film) {
    const { w, h } = fitted(Math.min((cw - FIT_SIDES) / PAGE_W, (ch - TIMELINE_H - FILM_FIT_FOOT) / PAGE_H));
    const y = Math.max(FILM_FIT_TOP, (ch - TIMELINE_H - FILM_FIT_HUD - h) / 2);
    return { ...out, frame: { x: (cw - w) / 2, y, w, h }, availH: h, transport: true };
  }
  const railW = cw < RAIL_MIN_STAGE ? 0 : RAIL_W;
  const { w, h } = fitted(Math.min((cw - railW - FIT_SIDES) / PAGE_W, (ch - DECK_FIT_FOOT) / PAGE_H));
  const frame = { x: railW + (cw - railW - w) / 2, y: Math.max(DECK_FIT_TOP, (ch - DECK_FIT_HUD - h) / 2), w, h };
  return { ...out, frame, availH: h, rail: railW > 0 ? { x: 0, y: 0, w: RAIL_W, h: ch } : null };
}

/**
 * The `board {cols, s, gap, pad, padB, r, bg}` message the build doc lays its tiles out by, or null: off board kinds,
 * in the run doc, with no section (the board style's defaults hold until the plan lands) and on a stage not yet measured.
 * @param {{kind: string, docMode: string|null, n: number, cw: number, ch: number}} o
 */
export function boardPost({ kind, docMode, n, cw, ch }) {
  if (!isBoardKind(kind) || docMode === 'run' || !(n > 0) || !(cw > 0) || !(ch > 0)) return null;
  const regions = stageRegions({ kind, docMode, cw, ch });
  const layout = boardLayout({ n, cw: regions.frame.w, availH: regions.availH, canvas: BOARD_CANVAS });
  if (!layout) return null;
  return { cols: layout.cols, s: layout.s, gap: layout.gap, pad: layout.pad, padB: regions.padB, r: TILE_R, bg: BOARD_BG };
}

/**
 * What the deck and video chrome paints from: the round's facts, the regions and the board message.
 * @param {{kind: string, live: boolean, docMode: string|null, sections: {id: string, job: string, status: string,
 *   agentId: string|null, duration?: number|null}[], stageW: number, stageH: number}} o `sections` leaves removed ones out
 */
export function kindChromeView({ kind, live, docMode, sections, stageW, stageH }) {
  return {
    kind, live, docMode, sections,
    regions: stageRegions({ kind, docMode, cw: stageW, ch: stageH }),
    board: boardPost({ kind, docMode, n: sections.length, cw: stageW, ch: stageH }),
  };
}

/** A cursor's label: a video scene writing its script draws the scene's timeline, so it says so. */
export function cursorLabel({ kind, job, part }) {
  return kind === 'video' && part === 'js' ? `${job} · timeline` : job;
}

/**
 * A guide on a tile stops at the tile: the h guide's `[x0, x1]` and the v guide's `[y0, y1]`, from the tile's
 * `[x, y, w, h]`. Null with no tile, so P4's full-page guide applies.
 */
export function guideSpan(clip) {
  if (!Array.isArray(clip) || clip.length !== 4) return null;
  const [x, y, w, h] = clip;
  return { h: [x, x + w], v: [y, y + h] };
}

/** A size tag on a tile reads slide pixels: the rect's size at the board's scale `s`, rounded. */
export function tagSize(rect, s) {
  return [Math.round(rect[2] / s), Math.round(rect[3] / s)];
}
