// A finished deck's slide rail (L7.6): the mockup's rail (`canvas/src/engine.js` `_railRect`, `_renderDeck`) on the
// left of the well. The thumbnails are one extra sandboxed frame of the build doc laid out as a single column, which
// takes no pointer events; the numbers and the buttons are the parent's. A button goes to its slide by the run doc's
// own order (L7.8): a deck that lost a slide (M12) holds fewer slides than the plan, so a slide it does not hold is
// disabled. Jumps and `visible` never touch pins (L7.28). kind-chrome.mjs decides when a rail exists.

import { BOARD_CANVAS, RAIL_W } from './kind-view.mjs';

// `_railRect` (engine.js:1674-1678): 12 px padding in the rail, 8 px between thumbnails, which are at most 72 px
// tall. The 40 px floor is this stage's: past about 20 slides the rail scrolls instead of shrinking them further.
const PAD = 12;
const GAP = 8;
const TILE_MAX_H = 72;
const TILE_MIN_H = 40;
// Scales are kept to 6 decimals, floored, as the board's are.
const SCALE_STEPS = 1e6;
// The thumbnails' corner radius and the rail's ground: frame data for the build doc, not stage CSS.
const THUMB_R = 4;
const RAIL_BG = '#0B0D11';
const STEP_KEYS = Object.freeze({ ArrowUp: -1, ArrowDown: 1 });

/**
 * The rail's thumbnails for `n` slides in a stage `ch` tall: each one's scale and size, the column's left edge in the
 * rail, its top, the gap, and the thumbnail frame's height.
 * @param {{n: number, ch: number}} o
 * @returns {{s: number, tileW: number, tileH: number, x: number, top: number, gap: number, frameH: number}}
 */
export function railTiles({ n, ch }) {
  const count = Number.isSafeInteger(n) && n > 0 ? n : 0;
  const fit = count > 0 ? (ch - 2 * PAD - GAP * (count - 1)) / count : TILE_MAX_H;
  const rawH = Math.max(TILE_MIN_H, Math.min(TILE_MAX_H, Number.isFinite(fit) ? fit : TILE_MAX_H));
  const s = Math.floor((rawH / BOARD_CANVAS.h) * SCALE_STEPS) / SCALE_STEPS;
  const tileW = BOARD_CANVAS.w * s;
  const tileH = BOARD_CANVAS.h * s;
  const frameH = count > 0 ? Math.ceil(count * tileH + (count - 1) * GAP) : 0;
  return { s, tileW, tileH, x: RAIL_W - tileW - PAD, top: PAD, gap: GAP, frameH };
}

/** A slide's index in the deck the run doc holds (`deck-stage` counts every child, skipped ones too), or -1. */
export function deckIndexOf(id, runIds) {
  return Array.isArray(runIds) ? runIds.indexOf(id) : -1;
}

/**
 * The rail, built into `host` (the stage's `.dz-wrap`, the positioned well). `openRailFrame(mount, {onReady})` opens
 * the thumbnail frame in `mount` and returns `{post, destroy}`; `onReady` runs at each of its docs' `ready`.
 * `onGoto(index)` gets the run doc's index of the slide a person picked.
 * @param {{doc: Document, host: HTMLElement, openRailFrame?: Function, onGoto: (index: number) => void}} deps
 * @returns {{setSections: (sections: {id: string, job: string, status: string}[]) => void,
 *   setRunIds: (ids: string[]|null) => void, setVisible: (id: string) => void, layout: (o: {ch: number}) => void,
 *   destroy: () => void}}
 */
export function createDeckRail({ doc, host, openRailFrame, onGoto }) {
  let sections = [];
  let sectionsKey = '';
  let runIds = null;
  let visibleId = null;
  let ch = null;
  let geom = railTiles({ n: 0, ch: 0 });
  let ready = false;
  let postedS = null;
  let destroyed = false;
  let buttons = [];
  // The thumbnail frame's `{post, destroy}`, once `openRailFrame` returned it.
  let frame = null;

  const make = (tag, cls) => {
    const el = doc.createElement(tag);
    el.className = cls;
    return el;
  };
  const rail = make('div', 'dz-rail');
  const scroll = make('div', 'dz-rail-scroll');
  const frameHost = make('div', 'dz-rail-frame-host');
  scroll.append(frameHost);
  rail.append(scroll);
  host.append(rail);

  function postBoard() {
    if (!ready || !frame) return;
    postedS = geom.s;
    frame.post('board', { cols: 1, s: geom.s, gap: GAP, pad: 0, padB: 0, r: THUMB_R, bg: RAIL_BG });
  }

  // The frame host makes its iframe after an async mint, and a retry makes a new one: each doc's `ready` hides the one
  // it is in from the tab order and the accessibility tree, where the parent's buttons stand for it.
  function onReady() {
    if (destroyed) return;
    ready = true;
    const iframe = frameHost.querySelector('iframe');
    if (iframe) {
      iframe.setAttribute('tabindex', '-1');
      iframe.setAttribute('aria-hidden', 'true');
    }
    postBoard();
  }

  frame = typeof openRailFrame === 'function' ? openRailFrame(frameHost, { onReady }) ?? null : null;

  function place() {
    scroll.style.height = `${geom.frameH + 2 * PAD}px`;
    Object.assign(frameHost.style, { left: `${geom.x}px`, top: `${geom.top}px`, width: `${geom.tileW}px`, height: `${geom.frameH}px` });
    buttons.forEach((b, i) => {
      Object.assign(b.style, {
        left: `${geom.x}px`, top: `${geom.top + i * (geom.tileH + GAP)}px`, width: `${geom.tileW}px`, height: `${geom.tileH}px`,
      });
    });
  }

  function paintRunIds() {
    for (const b of buttons) b.disabled = deckIndexOf(b.dataset.id, runIds) < 0;
  }

  function paintVisible() {
    for (const b of buttons) {
      if (b.dataset.id === visibleId) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    }
  }

  function go(b) {
    if (destroyed || b.disabled) return;
    const index = deckIndexOf(b.dataset.id, runIds);
    if (index >= 0) onGoto(index);
  }

  function onClick(e) {
    const b = e.target.closest?.('.dz-rail-tile');
    if (b && rail.contains(b)) go(b);
  }

  // From the button the key came to (the focus may be anywhere), the next slide the deck holds that way.
  function onKey(e) {
    const step = Object.hasOwn(STEP_KEYS, e.key) ? STEP_KEYS[e.key] : 0;
    const from = step ? e.target.closest?.('.dz-rail-tile') : null;
    const at = from ? buttons.indexOf(from) : -1;
    if (at < 0) return;
    for (let i = at + step; i >= 0 && i < buttons.length; i += step) {
      if (buttons[i].disabled) continue;
      e.preventDefault();
      buttons[i].focus();
      go(buttons[i]);
      return;
    }
  }

  rail.addEventListener('click', onClick);
  rail.addEventListener('keydown', onKey);

  return {
    /** One button per slide, in plan order; rebuilt only when the ids, jobs or statuses changed. */
    setSections(next) {
      if (destroyed) return;
      const list = Array.isArray(next) ? next : [];
      const key = JSON.stringify(list.map((s) => [s.id, s.job, s.status]));
      if (key === sectionsKey) return;
      sections = list;
      sectionsKey = key;
      for (const b of buttons) b.remove();
      buttons = sections.map((s, i) => {
        const b = make('button', s.status === 'failed' ? 'dz-rail-tile is-failed' : 'dz-rail-tile');
        b.type = 'button';
        b.dataset.id = s.id;
        b.setAttribute('aria-label', `Slide ${i + 1}: ${s.job}`);
        const num = make('span', 'dz-rail-num');
        num.textContent = String(i + 1);
        b.append(num);
        return b;
      });
      scroll.append(...buttons);
      if (ch !== null) geom = railTiles({ n: buttons.length, ch });
      place();
      paintRunIds();
      paintVisible();
      if (geom.s !== postedS) postBoard();
    },
    /** The run doc's own slide order (its `rects`); a slide not in it is disabled, as is every one before it is known. */
    setRunIds(ids) {
      if (destroyed) return;
      runIds = Array.isArray(ids) ? [...ids] : null;
      paintRunIds();
    },
    /** The slide the run doc shows; an id the plan does not hold changes nothing. */
    setVisible(id) {
      if (destroyed) return;
      const b = buttons.find((x) => x.dataset.id === id);
      if (!b) return;
      visibleId = id;
      paintVisible();
      if (typeof b.scrollIntoView === 'function') b.scrollIntoView({ block: 'nearest' });
    },
    /** The stage's height sizes the thumbnails; a ready frame gets a board whose scale changed. */
    layout({ ch: h }) {
      if (destroyed || !Number.isFinite(h) || h === ch) return;
      ch = h;
      geom = railTiles({ n: buttons.length, ch });
      place();
      if (geom.s !== postedS) postBoard();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      rail.removeEventListener('click', onClick);
      rail.removeEventListener('keydown', onKey);
      rail.remove();
      frame?.destroy();
    },
  };
}
