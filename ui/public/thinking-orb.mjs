// ui/public/thinking-orb.mjs — the dotted sphere that marks a live Ask turn.
// A factory, not a custom element: the panel hands in doc/win (spec §10.1), so
// the jsdom suites drive it with no globals and no canvas backend. Geometry is
// exported pure — the drawing loop is the only part a browser is needed for.

export const ORB_DOTS = 46;
export const ORB_TILT = 0.38;     // fixed nod, no wobble
export const ORB_SPEED = 0.17;    // turns per second

/** Fibonacci sphere: ORB_DOTS unit vectors, one even latitude band per dot. */
export function orbPoints(n = ORB_DOTS) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) / n) * 2;
    const r = Math.sqrt(Math.max(1 - y * y, 0));
    const th = i * Math.PI * (3 - Math.sqrt(5));
    pts.push([Math.cos(th) * r, y, Math.sin(th) * r]);
  }
  return pts;
}

/**
 * Spin `pts` by `t` seconds about Y, nod by `tilt` about X, and return them
 * sorted back-to-front so the caller can paint straight down the array.
 */
export function orbFrame(pts, t, { speed = ORB_SPEED, tilt = ORB_TILT } = {}) {
  const a = t * speed * Math.PI * 2;
  const ca = Math.cos(a), sa = Math.sin(a);
  const cT = Math.cos(tilt), sT = Math.sin(tilt);
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const x = p[0] * ca + p[2] * sa;
    const z0 = p[2] * ca - p[0] * sa;
    out.push([x, p[1] * cT - z0 * sT, z0 * cT + p[1] * sT]);
  }
  out.sort((m, n) => m[2] - n[2]);
  return out;
}

/**
 * @returns {{el: Element, start: () => void, stop: () => void}} — `el` is a
 * bare inline-block span. It survives being re-parented (the panel moves the
 * one orb into each rebuilt live row) because the phase is `now - t0`, not a
 * frame counter, so a move never rewinds the spin.
 */
export function createThinkingOrb({ doc, win, size = 30, ink = '25,25,27' }) {
  const el = doc.createElement('span');
  el.className = 'ask-orb';
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = `display:inline-block;line-height:0;width:${size}px;height:${size}px`;

  const raf = typeof win.requestAnimationFrame === 'function' ? win.requestAnimationFrame.bind(win) : null;
  const caf = typeof win.cancelAnimationFrame === 'function' ? win.cancelAnimationFrame.bind(win) : null;
  const clock = win.performance && typeof win.performance.now === 'function'
    ? () => win.performance.now()
    : () => Date.now();

  // No rAF means nothing can ever animate, so skip the canvas entirely rather
  // than paint one still frame — that also keeps jsdom's "getContext without
  // the canvas npm package" warning out of every ask-panel suite.
  let ctx = null;
  if (raf) {
    const dpr = Math.min(win.devicePixelRatio || 1, 2);
    const cv = doc.createElement('canvas');
    cv.width = Math.round(size * dpr);
    cv.height = Math.round(size * dpr);
    cv.style.cssText = `width:${size}px;height:${size}px;display:block;pointer-events:none`;
    el.appendChild(cv);
    try { ctx = cv.getContext('2d'); } catch { ctx = null; }
    if (ctx) ctx.scale(dpr, dpr);
    else cv.remove();
  }

  const pts = orbPoints();
  const R = size * 0.40;
  const c = size / 2;
  let reduced = false;
  try { reduced = !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { reduced = false; }
  const speed = ORB_SPEED * (reduced ? 0.3 : 1);
  const t0 = clock();
  let handle = null;

  function draw() {
    handle = raf(draw);
    if (doc.hidden) return;
    ctx.clearRect(0, 0, size, size);
    const frame = orbFrame(pts, (clock() - t0) / 1000, { speed, tilt: ORB_TILT });
    for (let k = 0; k < frame.length; k++) {
      const [x, y, z] = frame[k];
      const d = (z + 1) / 2;                       // 0 back … 1 front
      ctx.beginPath();
      ctx.arc(c + x * R, c - y * R, 0.5 + d * 1.05, 0, 6.2832);
      ctx.fillStyle = `rgba(${ink},${(0.08 + d * 0.82).toFixed(3)})`;
      ctx.fill();
    }
  }

  function start() {
    if (handle != null || !ctx || !raf) return;
    handle = raf(draw);
  }
  function stop() {
    if (handle != null && caf) caf(handle);
    handle = null;
  }

  start();
  return { el, start, stop };
}
