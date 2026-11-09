// src/core/design/thumb.mjs
// Design P6 (L6.1, L6.6 to L6.8): the Library's thumbnails. Lazy (L6.7): `GET /api/design` hands every row to
// `ensure`, which renders a finished design whose `dist/` is newer than its `thumb.png`. The render is the standalone
// page through `staticDoc` with no nonce, so no model-written JS runs (`script-src 'none'`), shot at 16:10 of the
// canvas width in the render queue's back. When its turn comes it draws only the round it was queued for, still
// finished and held by no restore or hand-off. With no Chrome nothing is drawn and the tile shows the kind's icon. The
// picture lands in `<design>/thumb.png` by a copy and a rename, checked again in the rename's tick, and never
// recreates a folder a delete took meanwhile.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromeNoSandbox, screenshotArgs } from '../../../assets/deck-preview/chrome.mjs';
import { assembleDesign } from './assemble.mjs';
import { readExportPlan } from './export.mjs';
import { designWorkDir, distDir, thumbFile } from './paths.mjs';
import { designChrome, RENDER_TIMEOUTS, renderQueue, runChrome, staticDoc } from './render.mjs';
import { getDesign } from './store.mjs';

/** After a failed render the same dist waits this long before another try. */
const FAIL_WAIT_MS = 600_000;
/** A lookup that found no Chrome is trusted this long, so installing one heals without a restart. */
const NO_CHROME_WAIT_MS = 60_000;
/** The width when a plan has none; a valid plan always has one (`validatePlan`). */
const DEFAULT_WIDTH = 1440;

const messageOf = (err) => (err && typeof err.message === 'string' ? err.message : String(err));

/** The stat of `file` when it is a regular file, else null. Never throws (a bad design id is null too). */
function fileStat(file) {
  try {
    const s = statSync(file(), { throwIfNoEntry: false });
    return s?.isFile() ? s : null;
  } catch {
    return null;
  }
}

/** `dist/index.html`'s mtime, or null when there is none to draw. */
function distStamp(id) {
  return fileStat(() => join(distDir(id), 'index.html'))?.mtimeMs ?? null;
}

/**
 * The window a thumbnail is shot at (L6.8): the canvas width at 16:10, cropped from the top left by the tile.
 * @param {{ canvas?: { w?: number } } | null} plan
 * @returns {{ width: number, height: number }}
 */
export function thumbViewport(plan) {
  const w = plan?.canvas?.w;
  const width = Number.isInteger(w) && w > 0 ? w : DEFAULT_WIDTH;
  return { width, height: Math.round((width * 10) / 16) };
}

/**
 * The thumbnail's URL, versioned by its mtime so the browser may cache it for good, or null when there is none.
 * @param {string} id
 * @returns {string | null}
 */
export function thumbUrl(id) {
  const s = fileStat(() => thumbFile(id));
  return s ? `/api/design/${id}/thumb?v=${Math.floor(s.mtimeMs)}` : null;
}

/**
 * Whether `dist/index.html` exists and `thumb.png` is missing or older. Never throws.
 * @param {string} id
 * @returns {boolean}
 */
export function needsThumb(id) {
  const dist = distStamp(id);
  if (dist === null) return false;
  const thumb = fileStat(() => thumbFile(id));
  return !thumb || thumb.mtimeMs < dist;
}

/**
 * The thumbnail maker. `ensure(design)` returns at once and never throws. It renders only a `done` design that
 * `needsThumb`, not already rendering, outside a failure's ten-minute wait for the same dist, and only when a Chrome is
 * found (a miss is remembered for a minute). The render waits in the queue, so its turn checks again that the design is
 * still `done` with the same `dist/` and that `held(id)` is false (a restore or a hand-off rewriting work/), and
 * else ends quietly: the next `ensure` decides. The same check runs again after Chrome, right before the rename. A
 * success sends `{type:'design-thumb', designId, thumb, ts}` through
 * `notify`; a failure keeps the old picture and warns once.
 * @param {{ chrome?: () => string | null, queue?: { run: (fn: () => unknown, opts?: { front?: boolean }) => Promise<any> },
 *   run?: typeof runChrome, notify?: (frame: object) => void, now?: () => number, held?: (id: string) => boolean }} [opts]
 * @returns {{ ensure: (design: { id: string, status: string, kind: string }) => void }}
 */
export function createThumbs({
  chrome = designChrome, queue = renderQueue, run = runChrome, notify = () => {}, now = Date.now, held = () => false,
} = {}) {
  const inFlight = new Set();
  const failedAt = new Map(); // design id -> { at, dist }: the failure's time and the dist mtime it failed on
  let noChromeAt = null;

  /** Whether `id` is still the finished round whose dist is stamped `stamp`, held by no restore or hand-off. */
  const current = (id, stamp) => getDesign(id)?.status === 'done' && distStamp(id) === stamp && !held(id);

  /** One render, in the queue, of the dist stamped `stamp`. Throws on a failure; a design deleted, changed or held
   *  meanwhile ends it quietly. The checks and the reads of work/ share one tick, and so do the checks after the copy
   *  and the rename: a restore that rebuilt dist/ while Chrome ran never gets the old round's picture. */
  async function render(id, stamp, bin) {
    if (!current(id, stamp)) return;
    const design = getDesign(id);
    const plan = readExportPlan(design);
    const html = staticDoc(assembleDesign({ workDir: designWorkDir(id), plan, mode: 'standalone' }).html);
    const tmp = mkdtempSync(join(tmpdir(), 'worca-design-thumb-'));
    try {
      const htmlPath = join(tmp, 'index.html');
      const pngPath = join(tmp, 'thumb.png');
      writeFileSync(htmlPath, html);
      const args = screenshotArgs({ htmlPath, pngPath, ...thumbViewport(plan), noSandbox: chromeNoSandbox() });
      const r = await run(bin, args, { outFile: pngPath, timeoutMs: RENDER_TIMEOUTS.thumbMs });
      if (!r?.ok) throw new Error(r?.reason || 'no picture');
      // Never a mkdir: a design deleted meanwhile answers ENOENT here, and its folder stays gone.
      const part = `${thumbFile(id)}.tmp-${randomBytes(4).toString('hex')}`;
      try {
        await copyFile(pngPath, part);
        if (!current(id, stamp)) { rmSync(part, { force: true }); return; }
        renameSync(part, thumbFile(id));
      } catch (e) {
        try { rmSync(part, { force: true }); } catch { /* the folder may be gone */ }
        if (e?.code === 'ENOENT') return;
        throw e;
      }
      failedAt.delete(id);
      const thumb = thumbUrl(id);
      if (thumb) notify({ type: 'design-thumb', designId: id, thumb, ts: Date.now() });
    } finally {
      // Windows: Chrome may hold the file briefly.
      try { rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* the OS cleans tmp */ }
    }
  }

  function ensure(design) {
    try {
      const id = design?.id;
      if (design?.status !== 'done' || !needsThumb(id) || inFlight.has(id)) return;
      const dist = distStamp(id);
      const failed = failedAt.get(id);
      if (failed && failed.dist === dist && now() - failed.at < FAIL_WAIT_MS) return;
      if (noChromeAt !== null && now() - noChromeAt < NO_CHROME_WAIT_MS) return;
      const bin = chrome();
      if (!bin) {
        noChromeAt = now();
        return;
      }
      noChromeAt = null;
      inFlight.add(id);
      let job;
      try { job = queue.run(() => render(id, dist, bin)); } catch (e) { job = Promise.reject(e); }
      Promise.resolve(job)
        .catch((e) => {
          failedAt.set(id, { at: now(), dist });
          console.warn(`[worca-design] thumbnail of ${id} failed: ${messageOf(e)}`);
        })
        .finally(() => inFlight.delete(id));
    } catch (e) {
      console.warn(`[worca-design] thumbnail check failed: ${messageOf(e)}`);
    }
  }

  return { ensure };
}
