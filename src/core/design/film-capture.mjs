// src/core/design/film-capture.mjs
// The child's side of a video's MP4 export (film-mp4-cli.mjs runs it; film-mp4.mjs is the server's side). It mixes
// the sound, then hands the capture page to the promo kit's exporter: headless Chromes seek the film frame by frame
// and ffmpeg encodes what they shoot. It imports the kit and Node only: nothing of the server's.
//
// The capture page runs the film's own scripts, which a model wrote, so every Chrome that opens it is held to that one
// page (test/design-film-mp4-real.test.mjs tries each way out):
// - it resolves no host (`NO_DNS`, the rule render.mjs gives every Chrome of the server), IP literals included;
// - it is started without the flag that lets a file:// page read other files;
// - every request it makes is paused, and all but the first load of the capture page itself is refused
//   (`guardCapture`): no other file, no other page, no second load. A page that tries to leave ends the render.
// The page's own CSP (render.mjs `captureDoc`) says the same from the inside.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exportFilm } from '../../../assets/promo-kit/tools/export.mjs';

/** Every host name, and every IP literal, maps to nothing. */
const NO_DNS = '--host-resolver-rules=MAP * ~NOTFOUND';

/** How the promo kit's `launch()` starts a Chrome for the capture page. */
export const CAPTURE_CHROME = Object.freeze({ fileAccess: false, args: Object.freeze([NO_DNS]) });

function abortError() {
  const e = new Error('the video was stopped');
  e.name = 'AbortError';
  return e;
}

/**
 * Holds `browser` (the promo kit's `launch()`) to the capture page at `htmlPath`: every request of its page is paused
 * (CDP `Fetch`), the first document load of that file goes on (whatever its query), and everything else is refused,
 * a navigation as much as a fetch. A page that tries to leave (a navigation of its own frame, a reload included) is
 * no film any more: a navigation started while it loads stops its parser for good, with no load event to wait for. So
 * the browser is closed there and then, and the answer's `left` says why whatever ran in it failed. Call it before
 * the page is opened.
 * @param {{ on: Function, page: Function, close: Function, sessionId: string }} browser
 * @param {string} htmlPath
 * @returns {Promise<{ left: boolean }>} `left` turns true when the page tried to leave
 */
export async function guardCapture(browser, htmlPath) {
  const own = pathToFileURL(resolve(htmlPath)).href;
  const state = { left: false };
  let frame = null;   // the page's own frame, known from its first load
  browser.on((m) => {
    if (m.method !== 'Fetch.requestPaused' || m.sessionId !== browser.sessionId) return;
    const { requestId, request, resourceType, frameId } = m.params;
    const first = frame === null && resourceType === 'Document' && String(request?.url ?? '').split(/[?#]/)[0] === own;
    if (first) {
      frame = frameId;
      browser.page('Fetch.continueRequest', { requestId }).catch(() => { /* the page went first */ });
      return;
    }
    // `Aborted` is a navigation called off: Chrome keeps the page (any other reason puts its error page there).
    browser.page('Fetch.failRequest', { requestId, errorReason: 'Aborted' }).catch(() => { /* the page went first */ });
    if (resourceType === 'Document' && frameId === frame && !state.left) {
      state.left = true;
      Promise.resolve(browser.close()).catch(() => { /* already closing */ });
    }
  });
  await browser.page('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  return state;
}

/** One ffmpeg run to its end. An aborted `signal` kills it and rejects with an `AbortError`. */
function runFfmpeg(ffmpeg, args, signal) {
  return new Promise((res, rej) => {
    if (signal?.aborted) { rej(abortError()); return; }
    const p = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    const onAbort = () => { try { p.kill('SIGKILL'); } catch { /* gone */ } };
    signal?.addEventListener('abort', onAbort, { once: true });
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    p.on('error', (e) => { signal?.removeEventListener('abort', onAbort); rej(e); });
    p.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) rej(abortError());
      else if (code === 0) res();
      else rej(new Error(`ffmpeg could not mix the sound: ${err.trim().split('\n').at(-1) || `exit ${code}`}`));
    });
  });
}

/**
 * Renders one job (film-mp4.mjs `prepareFilmJob` wrote it): the sound's mix first, then every frame of the capture
 * page into `job.out`, with the mix as its sound. A video that does not hold every frame is a failure, and so is a
 * film that tries to leave its page.
 * @param {{ html: string, out: string, audio: string|null, mix: string[]|null, workers?: number, scale: number, crf: number, preset: string, quality: number }} job
 *   `workers` is how many Chromes shoot at once (the kit's own count when left out)
 * @param {{ chrome: string, ffmpeg: string, signal?: AbortSignal|null,
 *   onProgress?: ((p: { done: number, total: number }) => void)|null }} opts
 * @returns {Promise<{ frames: number, seconds: number, bytes: number, violations: string[] }>}
 */
export async function renderFilmJob(job, { chrome, ffmpeg, signal = null, onProgress = null } = {}) {
  if (job.mix) await runFfmpeg(ffmpeg, job.mix, signal);
  const guards = [];
  let made;
  try {
    made = await exportFilm({
      html: job.html, out: job.out, audio: job.audio, scale: job.scale, crf: job.crf, preset: job.preset, quality: job.quality,
      chrome, ffmpeg, workers: job.workers, signal, onProgress,
      chromeOptions: { fileAccess: CAPTURE_CHROME.fileAccess, args: [...CAPTURE_CHROME.args] },
      onBrowser: async (browser) => { guards.push(await guardCapture(browser, job.html)); },
    });
  } catch (e) {
    // The guard closed that browser, so what failed names a closed socket: the reason is the page's own.
    if (!signal?.aborted && guards.some((g) => g.left)) throw new Error('the film tried to open another page');
    throw e;
  }
  if (made.frames !== made.expectedFrames) throw new Error(`the video holds ${made.frames} of its ${made.expectedFrames} frames`);
  return { frames: made.frames, seconds: made.duration, bytes: made.bytes, violations: made.violations ?? [] };
}
