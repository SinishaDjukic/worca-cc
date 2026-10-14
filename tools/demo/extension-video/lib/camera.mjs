// tools/demo/extension-video/lib/camera.mjs — the virtual camera, applied in post. The script records keyframes
// ({t: page epoch seconds, rect: stage CSS px, ms}) while it plays; the encoder turns them into one ffmpeg `crop`
// command per frame while the camera moves (sendcmd), then scales the crop down to the output size. The page is
// screencast at 2× device pixels, so a 1.45× zoom is still sharper than 1:1. Live input coordinates never change.
// easeInOut and hudCapX are also run in the page (lib/stage.mjs serialises them), so keep them self-contained.

export const MOVE_MS = 650;

/** Cubic ease-in-out on [0,1]; clamped outside. */
export function easeInOut(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

const lerpRect = (a, b, e) => ({ x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e,
  width: a.width + (b.width - a.width) * e, height: a.height + (b.height - a.height) * e });

/** The crop (stage CSS px, the frame's aspect, inside the frame) that shows `target`: centred on it at a fixed `zoom`,
 *  or, without one, the smallest crop holding target + `pad`, zoomed at most `maxZoom`. No target → the full frame. */
export function fitRect(target, { frame, zoom = 0, pad = 24, maxZoom = 2 }) {
  const aspect = frame.width / frame.height;
  if (!target) return { x: 0, y: 0, width: frame.width, height: frame.height };
  let width = zoom > 0 ? frame.width / zoom
    : Math.max(target.width + 2 * pad, (target.height + 2 * pad) * aspect, frame.width / maxZoom);
  width = Math.min(width, frame.width);
  const height = width / aspect;
  const cx = target.x + target.width / 2; const cy = target.y + target.height / 2;
  const clamp = (v, max) => Math.min(Math.max(v, 0), max);
  return { x: clamp(cx - width / 2, frame.width - width), y: clamp(cy - height / 2, frame.height - height), width, height };
}

/** The box around several element boxes (Playwright boundingBox results); null ones are skipped. */
export function unionBox(...boxes) {
  const b = boxes.filter(Boolean);
  if (!b.length) return null;
  const x = Math.min(...b.map((r) => r.x)); const y = Math.min(...b.map((r) => r.y));
  return { x, y, width: Math.max(...b.map((r) => r.x + r.width)) - x, height: Math.max(...b.map((r) => r.y + r.height)) - y };
}

/** The camera at time `t` (s): each key starts an eased move, from wherever the camera is then, to its rect. */
export function rectAt(keys, t, initial) {
  let seg = null;
  const at = (s, time) => lerpRect(s.from, s.to, easeInOut(s.ms > 0 ? ((time - s.t) * 1000) / s.ms : 1));
  for (const k of keys) {
    if (k.t > t) break;
    seg = { t: k.t, from: seg ? at(seg, k.t) : initial, to: k.rect, ms: k.ms };
  }
  return seg ? at(seg, t) : initial;
}

/** A CSS-px rect → an even-aligned, even-sized crop in device pixels, inside the frame, at the frame's aspect. */
export function deviceCrop(rect, { scale = 1, frame }) {
  const W = Math.round(frame.width * scale); const H = Math.round(frame.height * scale);
  const even = (v) => 2 * Math.round(v / 2);
  const w = Math.min(even(rect.width * scale), W);
  const h = Math.min(even((w * frame.height) / frame.width), H);
  const x = Math.min(Math.max(even(rect.x * scale), 0), W - w);
  const y = Math.min(Math.max(even(rect.y * scale), 0), H - h);
  return { x, y, w, h };
}

/** ffmpeg sendcmd text for the `crop` filter: one line per output frame whose crop changed. Each line parks x/y at 0
 *  first, so no intermediate state (new w with the old x) ever falls outside the frame. Times are from `t0`. */
export function sendcmdScript(keys, { t0, durationS, fps = 30, frame, scale = 1 }) {
  const full = { x: 0, y: 0, width: frame.width, height: frame.height };
  const out = [];
  let last = deviceCrop(full, { scale, frame });
  const n = Math.ceil(durationS * fps);
  for (let i = 0; i <= n; i++) {
    const c = deviceCrop(rectAt(keys, t0 + i / fps, full), { scale, frame });
    if (c.x === last.x && c.y === last.y && c.w === last.w && c.h === last.h) continue;
    out.push(`${(i / fps).toFixed(4)} crop x 0, crop y 0, crop w ${c.w}, crop h ${c.h}, crop x ${c.x}, crop y ${c.y};`);
    last = c;
  }
  return out.length ? `${out.join('\n')}\n` : '';
}

/** The -vf piece after `fps=`: the sendcmd-driven crop (it starts as the whole frame), then the downscale. */
export function cameraFilter(cmdFile, { width, height }) {
  if (cmdFile.includes("'")) throw new Error(`the camera command file's path cannot hold a quote: ${cmdFile}`);
  return `sendcmd=f='${cmdFile}',crop=w=iw:h=ih:x=0:y=0,scale=${width}:${height}:flags=lanczos`;
}

/** Where (output px) the bottom caption centres: on the page column left of the sidebar as the camera shows it. */
export function hudCapX(rect, sidebarLeft, viewWidth, min = 400) {
  if (sidebarLeft == null) return viewWidth / 2;
  const left = ((sidebarLeft - rect.x) * viewWidth) / rect.width;
  if (left >= viewWidth) return viewWidth / 2;
  return Math.max(min, left / 2);
}

/** The script's camera: `to(target, opts)` frames an element box (or null for the whole stage) and records the key.
 *  Disabled (the WebM fallback) it only remembers nothing and moves nothing. */
export function createCamera(stage, { frame, enabled = true }) {
  const keys = [];
  return {
    keys,
    async to(target, { ms = MOVE_MS, ...fit } = {}) {
      if (!enabled) return;
      const rect = fitRect(target, { frame, ...fit });
      const t = await stage.camera(rect, ms);
      keys.push({ t: t / 1000, rect, ms });
    },
    full(opts) { return this.to(null, opts); },
  };
}
