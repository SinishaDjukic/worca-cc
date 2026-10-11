// ui/public/dot-orb.mjs — the worca orb as a sphere of dots on a <canvas>, drawn here (no library). The design board
// is the "Thinking orb" artifact (claude.ai/artifact/Rx5K3rk9xtjAzCHeUrPXSp). It is still at rest and moves only
// while a turn runs: thinking (two bright points wander over it), a tool call (a bright patch sweeps across), writing
// (it spins faster under a rolling wave). Phases ease into each other.
// A factory, not module state: the caller hands in doc/win, so the jsdom suites drive it with no canvas backend
// (no requestAnimationFrame there = no getContext call, only data-phase). thinking-orb.mjs stays the Ask panel's.

const TAU = Math.PI * 2;
const TILT = 0.36;                 // seen a little from above

// spin rad/s · base brightness · twins (two wandering points) · spot (sweeping patch) · wave (rolling band)
export const ORB_PHASES = Object.freeze({
  rest: Object.freeze({ spin: 0, base: 0.82, twins: 0, spot: 0, wave: 0 }),
  think: Object.freeze({ spin: 0.55, base: 0.42, twins: 1, spot: 0, wave: 0 }),
  tool: Object.freeze({ spin: 0.8, base: 0.36, twins: 0, spot: 1, wave: 0 }),
  write: Object.freeze({ spin: 1.6, base: 0.92, twins: 0, spot: 0, wave: 1 }),
});
const KEYS = Object.keys(ORB_PHASES.rest);

/** Evenly spread points on a unit sphere (golden-angle spiral), flat [x, y, z, …]. */
const spheres = new Map();
export function orbSphere(n) {
  let a = spheres.get(n);
  if (a) return a;
  a = new Float32Array(n * 3);
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) / n) * 2, r = Math.sqrt(1 - y * y), t = g * i;
    a[i * 3] = Math.cos(t) * r; a[i * 3 + 1] = y; a[i * 3 + 2] = Math.sin(t) * r;
  }
  spheres.set(n, a);
  return a;
}

const unit = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };

/**
 * @param {{doc: Document, win: Window}} o
 * @returns {{create: (size?: number, cls?: string) => HTMLCanvasElement, set: (el: HTMLCanvasElement, phase: string) => void,
 *   phase: (el: HTMLCanvasElement) => string, destroy: () => void}}
 * — one shared animation loop for every orb it made, running only while one is live or settling: a finished turn eases
 * to a stop, draws its last frame and goes idle. Orbs out of sight skip the easing and snap to rest.
 */
export function createDotOrbs({ doc, win }) {
  const raf = typeof win.requestAnimationFrame === 'function' ? win.requestAnimationFrame.bind(win) : null;
  const caf = typeof win.cancelAnimationFrame === 'function' ? win.cancelAnimationFrame.bind(win) : null;
  const reduced = () => { try { return Boolean(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; } };
  const all = new Set();
  const state = new WeakMap();      // canvas → its orb
  let handle = null;
  let last = 0;

  function init(el) {
    const size = Number(el.dataset.s) || 22;
    const o = { el, ctx: null, size, px: 0, n: Math.round(Math.max(110, Math.min(460, size * 4.8))),
      rot: 0.6, t: Math.random() * 20, phase: 'rest', cur: { ...ORB_PHASES.rest }, color: '', colored: false, drawn: false, idle: true, gone: 0 };
    // No animation frames = nothing could ever move: skip the canvas backend entirely (jsdom has none).
    if (raf) {
      const dpr = Math.min(3, Math.max(1, win.devicePixelRatio || 1));
      el.width = Math.round(size * dpr); el.height = Math.round(size * dpr);
      o.px = el.width;
      try { o.ctx = el.getContext('2d'); } catch { o.ctx = null; }
    }
    state.set(el, o);
    return o;
  }
  function paintColor(o) {
    try { o.color = (win.getComputedStyle && win.getComputedStyle(o.el).color) || ''; } catch { o.color = ''; }
    if (!o.color) o.color = '#18181b';
  }

  function draw(o) {
    if (!o.ctx) return;
    o.drawn = true;
    const { ctx, px, cur, t } = o, c = px / 2, R = px * 0.46;
    const P = orbSphere(o.n), cr = Math.cos(o.rot), sr = Math.sin(o.rot), ct = Math.cos(TILT), st = Math.sin(TILT);
    const dot = R * Math.sqrt((4 * Math.PI) / o.n) * 0.27;
    // highlight centres live in view space so they stay on the visible face
    const h1 = unit(0.55 * Math.sin(t * 0.9), 0.45 * Math.cos(t * 1.3), 0.8);
    const h2 = unit(-0.5 * Math.sin(t * 0.7 + 1), 0.5 * Math.sin(t * 1.1 + 2), 0.75);
    const sx = 0.72 * Math.sin(t * 1.15), sy = 0.3 * Math.sin(t * 0.55 + 1);
    const sp = [sx, sy, Math.sqrt(Math.max(0, 1 - sx * sx - sy * sy))];
    const TW = Math.cos(0.2), SP = Math.cos(0.62);
    ctx.clearRect(0, 0, px, px);
    ctx.fillStyle = o.color || '#18181b';
    for (let i = 0; i < o.n; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      const x1 = x * cr + z * sr, z1 = -x * sr + z * cr;
      const y2 = y * ct - z1 * st, z2 = y * st + z1 * ct;
      if (z2 < -0.12) continue;                    // the far side stays hidden
      const d = (z2 + 1) / 2;                      // 0 = rim, 1 = facing us
      let a = cur.base * (0.16 + 0.84 * d * d), s = 0.5 + 0.5 * d;
      if (cur.wave > 0.001) a *= 1 - cur.wave * 0.42 * (0.5 + 0.5 * Math.sin(y2 * 6.5 - t * 4.6));
      let b = 0;
      if (cur.twins > 0.001) {
        const k1 = (x1 * h1[0] + y2 * h1[1] + z2 * h1[2] - TW) / (1 - TW), k2 = (x1 * h2[0] + y2 * h2[1] + z2 * h2[2] - TW) / (1 - TW);
        b = Math.max(b, cur.twins * Math.max(0, k1, k2));
      }
      if (cur.spot > 0.001) {
        const k = (x1 * sp[0] + y2 * sp[1] + z2 * sp[2] - SP) / (1 - SP);
        if (k > 0) b = Math.max(b, cur.spot * k * k * (3 - 2 * k));
      }
      if (b > 0) { b = Math.min(1, b); a += (1 - a) * b; s *= 1 + 0.75 * b; }
      ctx.globalAlpha = Math.min(1, a);
      ctx.beginPath(); ctx.arc(c + x1 * R, c - y2 * R, dot * s, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    handle = null;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
    last = now;
    let busy = false;
    for (const o of all) {
      if (o.idle) continue;
      // A rebuilt thread may re-attach an orb a frame later: give a detached one a moment before dropping it.
      if (!o.el.isConnected) { if (o.gone++ > 120) all.delete(o); else busy = true; continue; }
      o.gone = 0;
      const tg = ORB_PHASES[o.phase];
      if (!o.el.offsetParent) {                    // out of sight (the dock collapsed): no drawing, rest snaps
        if (o.phase === 'rest') { o.cur = { ...tg }; o.idle = true; draw(o); } else busy = true;
        continue;
      }
      const k = 1 - Math.exp(-dt * 4.5);
      let settling = false;
      for (const key of KEYS) { const v = o.cur[key] + (tg[key] - o.cur[key]) * k; if (Math.abs(v - tg[key]) > 0.004) settling = true; o.cur[key] = v; }
      o.rot += o.cur.spin * dt; o.t += dt;
      if (o.phase === 'rest' && !settling) { o.cur = { ...tg }; o.idle = true; } else busy = true;
      draw(o);
    }
    if (busy && raf && !reduced()) handle = raf(frame); else last = 0;
  }
  const kick = () => { if (handle == null && raf && !reduced()) { last = 0; handle = raf(frame); } };

  function set(el, phase) {
    if (!el) return;
    const o = state.get(el) || init(el);
    all.add(o);
    // A detached canvas has no computed colour yet: read it the first time it is in the page (recolor() does it after).
    if (!o.colored && el.isConnected) { paintColor(o); o.colored = true; o.drawn = false; }
    const was = o.phase;
    o.phase = ORB_PHASES[phase] ? phase : 'rest';
    el.dataset.phase = o.phase;
    el.classList.toggle('is-live', o.phase !== 'rest');
    if (!o.ctx) return;
    if (reduced()) { if (was !== o.phase || !o.drawn) { o.cur = { ...ORB_PHASES[o.phase] }; o.t = 2.2; o.idle = true; draw(o); } return; }
    if (o.phase === 'rest' && o.idle) { if (!o.drawn) draw(o); return; }   // a past turn: one still frame, kept
    o.idle = false; draw(o); kick();
  }

  // a theme switch recolours every orb (app.js applyTheme dispatches worca:theme; the OS flips system mode)
  function recolor() { for (const o of all) { if (o.el.isConnected) { paintColor(o); draw(o); } else o.colored = false; } }
  doc.addEventListener('worca:theme', recolor);
  let dark = null;
  try { dark = win.matchMedia ? win.matchMedia('(prefers-color-scheme: dark)') : null; } catch { dark = null; }
  if (dark && dark.addEventListener) dark.addEventListener('change', recolor);

  return {
    create(size = 22, cls = '') {
      for (const o of all) if (o.idle && !o.el.isConnected) all.delete(o);   // a cleared chat's orbs; set() adds one back
      const el = doc.createElement('canvas');
      el.className = `dot-orb${cls ? ` ${cls}` : ''}`;
      el.dataset.s = String(size);
      el.width = size; el.height = size;
      el.style.width = `${size}px`; el.style.height = `${size}px`;
      el.setAttribute('aria-hidden', 'true');
      el.dataset.phase = 'rest';                  // the caller set()s it once it is in the page (its colour comes from there)
      return el;
    },
    set,
    phase: (el) => { const o = el && state.get(el); return o ? o.phase : 'rest'; },
    destroy() {
      if (handle != null && caf) caf(handle);
      handle = null;
      all.clear();
      doc.removeEventListener('worca:theme', recolor);
      if (dark && dark.removeEventListener) dark.removeEventListener('change', recolor);
    },
  };
}
