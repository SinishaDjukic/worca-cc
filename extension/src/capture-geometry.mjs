// extension/src/capture-geometry.mjs — the area capture's geometry. Pure (test/extension-capture-geometry.test.mjs).
export const MIN_SIDE = 4;          // CSS px: a smaller drag is a click, not a capture
export const MAX_OUT_SIDE = 2048;   // D6: the PNG's longest side

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v) => (Number.isFinite(v) ? v : 0);

/** Two drag points → a rectangle inside the viewport (CSS px), whatever the drag direction. */
export function normalizeRect(a, b, viewport) {
  const W = num(viewport && viewport.width); const H = num(viewport && viewport.height);
  const x1 = clamp(Math.min(num(a.x), num(b.x)), 0, W); const x2 = clamp(Math.max(num(a.x), num(b.x)), 0, W);
  const y1 = clamp(Math.min(num(a.y), num(b.y)), 0, H); const y2 = clamp(Math.max(num(a.y), num(b.y)), 0, H);
  return { x: Math.round(x1), y: Math.round(y1), width: Math.round(x2 - x1), height: Math.round(y2 - y1) };
}

/**
 * The source rectangle in captured-image pixels and the output size, or null for a too-small/invalid capture.
 * Scale = image width / viewport CSS width (== devicePixelRatio at 100 % zoom, and right under zoom too, D5);
 * falls back to viewport.dpr when the viewport width is unknown.
 * @param {{rect:{x,y,width,height}, viewport:{width,height,dpr?}, image:{width,height}, maxSide?:number}} o
 */
export function cropPlan({ rect, viewport, image, maxSide = MAX_OUT_SIDE }) {
  if (!rect || !image || !(image.width > 0) || !(image.height > 0)) return null;
  if (!(rect.width >= MIN_SIDE) || !(rect.height >= MIN_SIDE)) return null;
  const dpr = Number.isFinite(viewport && viewport.dpr) && viewport.dpr > 0 ? viewport.dpr : 1;
  const kx = viewport && viewport.width > 0 ? image.width / viewport.width : dpr;
  const ky = viewport && viewport.height > 0 ? image.height / viewport.height : dpr;
  const sx = clamp(Math.round(rect.x * kx), 0, image.width - 1);
  const sy = clamp(Math.round(rect.y * ky), 0, image.height - 1);
  const sw = clamp(Math.round(rect.width * kx), 1, image.width - sx);
  const sh = clamp(Math.round(rect.height * ky), 1, image.height - sy);
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  return { sx, sy, sw, sh, dw: Math.max(1, Math.round(sw * k)), dh: Math.max(1, Math.round(sh * k)) };
}
