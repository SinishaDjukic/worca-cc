// The Design stage's overlay (SPEC section 3, L4.1): one element per cursor and per mark, drawn in the build doc's
// coordinates inside the scaled `.frame-box`, so a mark sits on its element at every zoom and `--k` keeps strokes,
// handles and tags at screen size. Marks live in `.overlay-clip`, clipped to the frame; cursors live in their own
// layer beside it, so they can reach the stage edge when the page is zoomed out. Every string reaches the DOM as
// text, and `--crew` is written only from a cursor's `crew` token name. It reaches the DOM and the timers only through
// its arguments, and does nothing until `paint` or `leave`.
//
// R7's fallback (tools/spikes/design-stage-r7-r20/RESULTS.md): WebKit trails a sandboxed frame's scroll by a 50 ms
// frame, so the marks hide while the scroll moves and come back once it rests. The cursors stay.

import { icon } from '../icons.mjs';
import { guideSpan } from './kind-view.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
// The mock's `_arrow` (engine.js:1584-1591), drawn 16 by 17 by `.dz-cursor > svg` (scale 1.14).
const ARROW = 'M0 0L4.4 14.6L7.2 8.6L13.8 6.2Z';

// Glide (engine.js:1005, in document px): a hop up to 48 px takes 120 ms, else 320 ms plus 1 s per 1800 px, 340-950 ms.
const HOP_PX = 48;
const HOP_MS = 120;
const GLIDE_MIN_MS = 340;
const GLIDE_MAX_MS = 950;
// A trail only past 26 screen px (engine.js:1594-1596); a tag only on a mark wider than 30 screen px (engine.js:1511).
const TRAIL_MIN_PX = 26;
const TAG_MIN_PX = 30;
// Where a cursor enters (a builder 4 screen px in, a lead 6, both 6 px below its place: engine.js:909,1196) and leaves
// (24 screen px past the edge, a row of 24 px chosen by its colour, L4.8).
const ENTER_IN_PX = 4;
const LEAD_IN_PX = 6;
const ENTER_DROP = 6;
const LEAVE_OUT_PX = 24;
const LEAVE_ROW = 24;
const LEAVE_QUICK_MS = 400;
const LEAVE_MS = 500;
const LEAVE_STEP_MS = 100;
// A wheel over a cursor lets the wheels through to the frame for this long.
const PASS_MS = 200;
// R7: the marks come back this long after the scroll's last move; under reduced motion the stage paints every 500 ms,
// so the rest outlasts that beat.
const SCROLL_REST_MS = 200;
const SCROLL_REST_REDUCED_MS = 600;

// Mark kinds, bottom to top. `rect` kinds take `left/top/width/height` from `[x, y, w, h]`. A kind reads the marks'
// `list` when it names one, else its own `name`: a board's tiles (P7) are an edge and an `N job` chip, placed at the
// tile's bottom left (`anchor`), both under P4's own marks. Neither takes a press.
const KINDS = [
  { name: 'tileEdges', list: 'tiles', cls: 'dz-tile-edge', rect: true },
  { name: 'tileChips', list: 'tiles', cls: 'dz-tile-chip', anchor: true },
  { name: 'slotLines', cls: 'dz-slotline' },
  { name: 'plus', cls: 'dz-plus' },
  { name: 'wires', cls: 'dz-wire', rect: true },
  { name: 'meters', cls: 'dz-meter', rect: true },
  { name: 'reds', cls: 'dz-box is-red', rect: true },
  { name: 'oranges', cls: 'dz-box is-orange', rect: true },
  { name: 'boxes', cls: 'dz-box', rect: true, handles: true },
  { name: 'guides' },
  { name: 'failed', cls: 'dz-box is-failed', rect: true, ui: true },
  { name: 'pins', cls: 'dz-box is-pin', rect: true, handles: true },
];
const HANDLES = ['tl', 'tr', 'bl', 'br'];

const num = (n) => (Number.isFinite(n) ? n : 0);
const px = (n) => `${Math.round(num(n) * 100) / 100}px`;
const glideMs = (dist) => (dist <= HOP_PX ? HOP_MS
  : Math.round(Math.min(GLIDE_MAX_MS, Math.max(GLIDE_MIN_MS, 320 + (dist / 1800) * 1000))));
const edgeOf = (layout) => (num(layout.stageW) - num(layout.ox)) / layout.s;
const crewVar = (crew) => `var(${crew})`;
const isRect = (r) => Array.isArray(r) && r.length === 4;
/**
 * A rect mark cut at its tile (engine.js:1640-1650): `inset()` from the mark's own box, negative where the tile is
 * larger, rounded as the tile. Its tag and handles are its children, so they are cut too.
 */
function tileClip([x, y, w, h], [cx, cy, cw, ch]) {
  const top = num(cy) - num(y);
  const right = num(x) + num(w) - num(cx) - num(cw);
  const bottom = num(y) + num(h) - num(cy) - num(ch);
  const left = num(cx) - num(x);
  return `inset(${px(top)} ${px(right)} ${px(bottom)} ${px(left)} round var(--r-md))`;
}

/**
 * @param {{ doc: Document, win: { requestAnimationFrame: Function, cancelAnimationFrame: Function,
 *   setTimeout: Function, clearTimeout: Function }, host: HTMLElement, reduced?: () => boolean,
 *   onCursor?: (agentId: string) => void }} deps  `host` is the `.frame-box`.
 * @returns {{ paint: (p: { cursors: object[], marks: object, layout: object, scroll: {x: number, y: number},
 *   hidden: boolean }) => void, leave: (effect: object, layout: object) => void, destroy: () => void }}
 */
export function createOverlay({ doc, win, host, reduced = () => false, onCursor }) {
  const clip = doc.createElement('div');
  clip.className = 'overlay-clip';
  const marksLayer = doc.createElement('div');
  marksLayer.className = 'overlay-doc is-marks';
  marksLayer.setAttribute('aria-hidden', 'true');
  clip.append(marksLayer);
  const cursorLayer = doc.createElement('div');
  cursorLayer.className = 'overlay-doc is-cursors';
  cursorLayer.setAttribute('aria-hidden', 'true');
  host.append(clip, cursorLayer);

  const live = new Map(); // agentId -> cursor record, in place or entering
  const agentOf = new WeakMap(); // cursor element -> agentId
  const marks = new Map(KINDS.map((k) => [k.name, new Map()])); // kind -> key -> element
  const kindAt = new WeakMap(); // mark element -> its index in KINDS
  const tagOf = new WeakMap(); // mark element -> its tag
  const timers = new Set();
  const frames = new Set();
  let seen = new Map(); // the last paint's cursors by agentId, hidden or not
  let dropped = new Map(); // the cursors the last paint dropped, for a `leave` that comes after it
  let lastLayout = null;
  let lastScroll = null;
  let hidden = false;
  let passTimer = null;
  let restTimer = null;
  let destroyed = false;

  const later = (fn, ms) => {
    const id = win.setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
    return id;
  };
  const cancel = (id) => {
    if (id == null) return;
    win.clearTimeout(id);
    timers.delete(id);
  };
  const nextFrame = (fn) => {
    const id = win.requestAnimationFrame(() => { frames.delete(id); fn(); });
    frames.add(id);
    return id;
  };
  const cancelFrame = (id) => {
    if (id == null) return;
    win.cancelAnimationFrame(id);
    frames.delete(id);
  };

  // A cursor: the arrow, then a label holding the job and, when parked off screen, an arrow icon.
  function makeCursor(id, crew) {
    const el = doc.createElement('div');
    el.className = 'dz-cursor';
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 14 15');
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', ARROW);
    svg.append(path);
    const label = doc.createElement('span');
    label.className = 'dz-cursor-label';
    const text = doc.createTextNode('');
    label.append(text);
    el.append(svg, label);
    agentOf.set(el, id);
    const cur = { id, el, label, text, icon: null, parked: 0, crew: null, x: 0, y: 0, entering: null, tx: 0, ty: 0 };
    setCrew(cur, crew);
    return cur;
  }
  function setCrew(cur, crew) {
    if (crew === cur.crew) return;
    cur.crew = crew;
    cur.el.style.setProperty('--crew', crewVar(crew));
  }
  function setLabel(cur, job, parked) {
    const text = typeof job === 'string' ? job : '';
    if (cur.text.data !== text) cur.text.data = text;
    const way = parked > 0 ? 1 : parked < 0 ? -1 : 0;
    if (way === cur.parked) return;
    cur.icon?.remove();
    cur.icon = way ? icon(doc, way > 0 ? 'arrow-down' : 'arrow-up', 11) : null;
    if (cur.icon) cur.label.append(cur.icon);
    cur.parked = way;
  }
  function place(cur, x, y) {
    cur.x = num(x);
    cur.y = num(y);
    cur.el.style.setProperty('--x', px(cur.x));
    cur.el.style.setProperty('--y', px(cur.y));
  }
  // Glide to (x, y); a cursor already in place leaves a trail on a long move.
  function glide(cur, x, y, trail) {
    const dist = Math.hypot(x - cur.x, y - cur.y);
    if (!(dist > 0)) return;
    const ms = glideMs(dist);
    if (trail && !reduced() && dist * lastLayout.s > TRAIL_MIN_PX) drawTrail(cur, x, y, dist, ms);
    cur.el.style.setProperty('--glide', `${ms}ms`);
    place(cur, x, y);
  }
  function drawTrail(cur, x, y, dist, ms) {
    const t = doc.createElement('div');
    t.className = 'dz-trail';
    const angle = Math.round(Math.atan2(y - cur.y, x - cur.x) * 10000) / 10000;
    t.style.width = px(dist);
    t.style.transform = `translate(${px(cur.x)}, ${px(cur.y)}) rotate(${angle}rad)`;
    t.style.setProperty('--crew', crewVar(cur.crew));
    t.style.setProperty('--glide', `${ms}ms`);
    cursorLayer.insertBefore(t, cur.el);
    later(() => t.remove(), ms);
  }
  function dropCursor(cur) {
    cancelFrame(cur.entering);
    cur.entering = null;
    cur.el.remove();
  }

  function paintCursors(list, layout) {
    const input = new Map();
    for (const c of Array.isArray(list) ? list : []) if (c && typeof c.agentId === 'string') input.set(c.agentId, c);
    const before = seen;
    seen = input;
    dropped = new Map();
    for (const [id, c] of before) if (!input.has(id)) dropped.set(id, c);
    const shown = hidden ? new Map() : input;
    for (const [id, cur] of live) {
      if (shown.has(id)) continue;
      dropCursor(cur);
      live.delete(id);
    }
    for (const [id, c] of shown) {
      const x = num(c.x);
      const y = num(c.y);
      let cur = live.get(id);
      if (!cur) {
        cur = makeCursor(id, c.crew);
        live.set(id, cur);
        cursorLayer.append(cur.el);
        if (!reduced() && !before.has(id)) {
          const inPx = c.role === 'lead' ? LEAD_IN_PX : ENTER_IN_PX;
          place(cur, edgeOf(layout) - inPx / layout.s, y + ENTER_DROP);
          cur.entering = nextFrame(() => {
            cur.entering = null;
            glide(cur, cur.tx, cur.ty, false);
          });
        } else {
          place(cur, x, y);
        }
      }
      setCrew(cur, c.crew);
      setLabel(cur, c.job, c.parked);
      cur.el.classList.toggle('is-waiting', c.waiting === true);
      if (cur.entering != null) {
        cur.tx = x;
        cur.ty = y;
      } else {
        glide(cur, x, y, true);
      }
    }
  }

  // A mark's tag, as text; none when its text is empty or the mark is 30 screen px wide or less.
  function setTag(el, text, show, ui) {
    let tag = tagOf.get(el);
    if (!show || typeof text !== 'string' || !text) {
      tag?.remove();
      tagOf.delete(el);
      return;
    }
    if (!tag) {
      tag = doc.createElement('span');
      tag.className = ui ? 'dz-tag is-ui' : 'dz-tag';
      el.append(tag);
      tagOf.set(el, tag);
    }
    if (tag.textContent !== text) tag.textContent = text;
  }
  // A new mark goes under every mark of a later kind, so the kinds keep their order without moving a live element
  // (a move would restart a guide's sweep).
  function insertMark(el, k) {
    kindAt.set(el, k);
    let before = null;
    for (const child of marksLayer.children) {
      if ((kindAt.get(child) ?? -1) > k) { before = child; break; }
    }
    marksLayer.insertBefore(el, before);
  }
  function classOf(kind, m) {
    if (kind.name === 'guides') return m.kind === 'v' ? 'dz-guide-v' : 'dz-guide-h';
    if (kind.name === 'wires' && m.main === true) return 'dz-wire is-main';
    if (kind.name === 'tileEdges' && m.planned === true) return `${kind.cls} is-planned`;
    if (kind.name === 'tileChips' && m.done === true) return `${kind.cls} is-done`;
    return kind.cls;
  }
  function drawMark(kind, el, m, layout) {
    const s = layout.s;
    if (kind.rect) {
      const [x, y, w, h] = m.rect;
      el.style.left = px(x);
      el.style.top = px(y);
      el.style.width = px(w);
      el.style.height = px(h);
      if (kind.name === 'meters') el.style.position = 'absolute';
      // A box or wireframe on a tile is cut at the tile's rounded edge (p8t1).
      el.style.setProperty('clip-path', isRect(m.clip) ? tileClip(m.rect, m.clip) : '');
      setTag(el, kind.name === 'meters' ? m.text : m.tag, num(w) * s > TAG_MIN_PX, kind.ui === true);
    } else if (kind.anchor) {
      const [x, y, , h] = m.rect;
      el.style.left = px(x);
      el.style.top = px(num(y) + num(h));
      const text = typeof m.label === 'string' ? m.label : '';
      if (el.textContent !== text) el.textContent = text;
    } else if (kind.name === 'plus') {
      el.style.left = px(m.x);
      el.style.top = px(m.y);
    } else if (kind.name === 'slotLines') {
      el.style.top = px(m.y);
      setTag(el, m.tag, true, false);
    } else if (m.kind === 'v') {
      // On a tile the guide stops at the tile's top and bottom.
      const span = guideSpan(m.clip);
      const y0 = span ? Math.max(num(m.y0), span.v[0]) : num(m.y0);
      const y1 = span ? Math.min(num(m.y1), span.v[1]) : num(m.y1);
      el.style.left = px(m.x);
      el.style.top = px(y0);
      el.style.height = px(Math.max(0, y1 - y0));
      el.style.setProperty('--d', `${Math.round(num(m.ms))}ms`);
    } else {
      // On a tile the guide runs the tile's width; otherwise CSS gives it the page's. A guide keeps its tile for life.
      const span = guideSpan(m.clip);
      el.style.top = px(m.y);
      if (span) {
        el.style.left = px(span.h[0]);
        el.style.width = px(span.h[1] - span.h[0]);
      }
      el.style.setProperty('--d', `${Math.round(num(m.ms))}ms`);
      setTag(el, m.tag, true, false);
    }
  }
  function paintMarks(all, layout) {
    KINDS.forEach((kind, k) => {
      const have = marks.get(kind.name);
      const want = new Map();
      const list = all?.[kind.list ?? kind.name];
      for (const m of Array.isArray(list) ? list : []) {
        if (!m || ((kind.rect || kind.anchor) && !isRect(m.rect))) continue;
        want.set(m.key, m);
      }
      for (const [key, el] of have) {
        if (want.has(key)) continue;
        el.remove();
        have.delete(key);
      }
      for (const [key, m] of want) {
        let el = have.get(key);
        if (!el) {
          el = doc.createElement('div');
          el.setAttribute('data-key', key);
          if (kind.handles) {
            for (const corner of HANDLES) {
              const hd = doc.createElement('span');
              hd.className = `dz-h ${corner}`;
              el.append(hd);
            }
          }
          insertMark(el, k);
          have.set(key, el);
        }
        const cls = classOf(kind, m);
        if (el.className !== cls) el.className = cls;
        drawMark(kind, el, m, layout);
      }
    });
  }

  // R7: hide the marks while the scroll moves; each move pushes their return back.
  function scrollMoved() {
    clip.style.visibility = 'hidden';
    cancel(restTimer);
    restTimer = later(() => {
      restTimer = null;
      clip.style.visibility = '';
    }, reduced() ? SCROLL_REST_REDUCED_MS : SCROLL_REST_MS);
  }

  cursorLayer.addEventListener('click', (e) => {
    const el = e.target.closest('.dz-cursor');
    const id = el && !el.classList.contains('is-leaving') ? agentOf.get(el) : null;
    if (id) onCursor?.(id);
  });
  // The layer itself takes no pointer events, so a wheel that reaches it came from a cursor.
  cursorLayer.addEventListener('wheel', () => {
    cursorLayer.classList.add('is-pass');
    cancel(passTimer);
    passTimer = later(() => {
      passTimer = null;
      cursorLayer.classList.remove('is-pass');
    }, PASS_MS);
  }, { passive: true });

  return {
    paint({ cursors, marks: all, layout, scroll, hidden: hide } = {}) {
      if (destroyed) return;
      lastLayout = layout;
      hidden = hide === true;
      const sx = num(scroll?.x);
      const sy = num(scroll?.y);
      const shift = `translate(${px(-sx)}, ${px(-sy)})`;
      marksLayer.style.transform = shift;
      cursorLayer.style.transform = shift;
      if (lastScroll && (lastScroll.x !== sx || lastScroll.y !== sy)) scrollMoved();
      lastScroll = { x: sx, y: sy };
      paintCursors(cursors, layout);
      // Hide cursors keeps the pins and a board's tiles: they label the page, not an agent.
      paintMarks(hidden ? { pins: all?.pins, tiles: all?.tiles } : all, layout);
    },

    // A process ended: its cursor flies past the stage's right edge and removes itself. Under reduced motion, or
    // while cursors are hidden, it is gone at once.
    leave(effect, layout) {
      if (destroyed || !effect || typeof effect.agentId !== 'string') return;
      const id = effect.agentId;
      const cur = live.get(id);
      if (cur) {
        live.delete(id);
        cancelFrame(cur.entering);
        cur.entering = null;
      }
      if (reduced() || hidden) {
        cur?.el.remove();
        return;
      }
      let out = cur;
      if (!out) {
        out = makeCursor(id, effect.crew);
        setLabel(out, dropped.get(id)?.job, 0);
        place(out, num(effect.x), num(effect.y));
        cursorLayer.append(out.el);
      }
      out.el.classList.add('is-leaving');
      const ci = Math.abs(Math.trunc(num(effect.colorIndex)));
      const ms = effect.quick === true ? LEAVE_QUICK_MS : LEAVE_MS + (ci % 3) * LEAVE_STEP_MS;
      const x = edgeOf(layout) + LEAVE_OUT_PX / layout.s;
      const y = num(effect.y) + ((ci % 5) - 2) * LEAVE_ROW;
      nextFrame(() => {
        out.el.style.setProperty('--glide', `${ms}ms`);
        place(out, x, y);
        later(() => out.el.remove(), ms);
      });
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const id of [...timers]) cancel(id);
      for (const id of [...frames]) cancelFrame(id);
      live.clear();
      for (const have of marks.values()) have.clear();
      clip.remove();
      cursorLayer.remove();
    },
  };
}
