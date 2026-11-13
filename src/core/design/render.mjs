// src/core/design/render.mjs
// Rendering a Design with Chrome on the server (P6, L6.1): thumbnails and the deck PDF. No model-written JS ever runs
// here. Every doc handed to Chrome goes through `staticDoc`, which strips every script, handler and navigation, then
// puts the CSP meta first: thumbnails run with `script-src 'none'`, and the PDF runs only worca's own kit under a
// random nonce. The one exception is `captureDoc`, a video's capture page for the MP4 export (film-mp4.mjs): a film's
// frames are what its scenes' scripts draw, so they run, in a Chrome of its own that is held to that one page. `runChrome` is the async counterpart of `assets/deck-preview/chrome.mjs`'s `screenshot`, which uses
// `spawnSync` and would block the server; it reuses only that module's pure parts.
import { spawn } from 'node:child_process';
import { existsSync, rmSync, statSync } from 'node:fs';
import { findChrome } from '../../../assets/deck-preview/chrome.mjs';
import { signalTree } from '../engines/spawn.mjs';
import { escapeActive } from './html-scan.mjs';
import { previewCsp, safeInlineScript, stripBuildDoc } from './preview-doc.mjs';

/** A CSP nonce-source value (base64 or base64url): anything else could break out of the `nonce` attribute. */
const NONCE_RE = /^[A-Za-z0-9+/_-]+={0,2}$/;
/**
 * A leading doctype, after HTML whitespace only (tab, LF, FF, CR, space). JS `\s` also matches NBSP and U+2028, and
 * those make the browser ignore the doctype, so a CSP meta put after it would land in `<body>`, where it is ignored.
 */
const LEADING_DOCTYPE = /^[\t\n\f\r ]*<!doctype[^>]*>/i;

/** A `<link` opener left after the strip pass, as a browser reads one: HTML whitespace, `/`, `>` or the end next. */
const LINK_OPEN = /<(?=link(?:[\t\n\f\r />]|$))/gi;
/** Every Chrome the server runs resolves no host name: a page it renders cannot look one up (DNS carries data out). */
const NO_DNS = '--host-resolver-rules=MAP * ~NOTFOUND';

/** How long one Chrome may take before it is killed. */
export const RENDER_TIMEOUTS = Object.freeze({ thumbMs: 30000, pdfMs: 180000 });

/**
 * The Chrome Design renders with, or null. `WORCA_CHROME=none` means no Chrome (L6.19): on macOS `findChrome` always
 * tries `/Applications`, so neither an unset `WORCA_CHROME` nor a stripped `PATH` hides it.
 * @param {Record<string, string | undefined>} [env]
 * @returns {string | null}
 */
export function designChrome(env = process.env) {
  return env.WORCA_CHROME === 'none' ? null : findChrome({ env });
}

/**
 * The render CSP: P3's build directive list (`previewCsp`) without `sandbox`, so `file://` stays one origin and the
 * kit can run. With no nonce no script runs at all (`script-src 'none'`).
 * @param {{ nonce?: string | null }} [opts] `nonce` admits the one nonced kit script
 * @returns {string}
 */
export function renderCsp({ nonce = null } = {}) {
  if (nonce !== null && (typeof nonce !== 'string' || !NONCE_RE.test(nonce))) throw new TypeError('renderCsp: the nonce must be base64');
  return previewCsp({ mode: 'build', base: null, nonce: nonce ?? '' })
    .split('; ')
    .filter((d) => !d.startsWith('sandbox'))
    .map((d) => (nonce === null && d.startsWith('script-src') ? "script-src 'none'" : d))
    .join('; ');
}

/**
 * A doc that Chrome may open on the server (L6.1, L6.20). In this order:
 * 1. `escapeActive(stripBuildDoc(html, {dropLinks: true}))`, with NO nonce: `stripBuildDoc` keeps a script whose nonce
 *    equals the one it is given, so a model-written `<script nonce="none">` would survive. It drops every script,
 *    frame, object and `noscript`, the tag of `base`, `meta[http-equiv]` and every `link` (a preconnect, prefetch or
 *    preload connects where no CSP directive reaches; a stylesheet link, even a `data:` one, was blocked by the CSP),
 *    and rebuilds handler and `javascript:` tags; `escapeActive`, and the same for `<link`, turn any opener left over
 *    into text. All read the whole doc: P1's `stripActive` drops everything past 8 MiB, and a standalone deck inlines
 *    its images.
 * 2. Right after a leading doctype (`LEADING_DOCTYPE`), or at byte 0: `<meta charset="utf-8">` (the kit can push the
 *    shell's own charset past the 1024-byte sniff window), the CSP meta, and with `kitScript` the kit as one nonced
 *    script. Never at the first `<head>` (L6.2): a shell comment holding `<head>` would swallow it and leave no CSP.
 *    With `extraCss`, a `<style>` holding it comes right after the CSP meta (`style-src` keeps `'unsafe-inline'`).
 * @param {string} html
 * @param {{ nonce?: string | null, kitScript?: string | null, extraCss?: string }} [opts] `kitScript` (worca's own
 *   kit, never model text) needs `nonce`; `extraCss` is worca's own style too (`thumbStillCss`), never model text
 * @returns {string}
 * @throws {RangeError} from `stripBuildDoc`, when the doc nests elements too deep
 * @throws {TypeError} when `nonce` is not base64, or `kitScript` comes without a nonce
 */
export function staticDoc(html, { nonce = null, kitScript = null, extraCss = '' } = {}) {
  if (kitScript !== null && nonce === null) throw new TypeError('staticDoc: a kit script needs a nonce');
  const csp = renderCsp({ nonce });
  const doc = escapeActive(stripBuildDoc(html, { dropLinks: true })).replace(LINK_OPEN, () => '&lt;');
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">`
    + (extraCss ? `<style>${extraCss}</style>` : '')
    + (kitScript === null ? '' : `<script nonce="${nonce}">${safeInlineScript(kitScript)}</script>`);
  const at = LEADING_DOCTYPE.exec(doc)?.[0].length ?? 0;
  return doc.slice(0, at) + head + doc.slice(at);
}

/**
 * The capture CSP: P3's run directive list (`previewCsp`) with no base and without `sandbox`. The page's own inline
 * scripts and styles run; everything else comes from `data:` or `blob:` or not at all, and nothing connects.
 * @returns {string}
 */
export function captureCsp() {
  return previewCsp({ mode: 'run', base: null, nonce: '' }).split('; ').filter((d) => !d.startsWith('sandbox')).join('; ');
}

/**
 * A video's capture page: `html` (the standalone film) as it is, with `<meta charset>` and the capture CSP right
 * after a leading doctype (or at byte 0, as `staticDoc` places its own), and `script` as the last script of the page.
 * Nothing is stripped: this is the one doc whose own scripts run in a Chrome on the server. What holds the page is
 * around it, not in it: the CSP here, and the Chrome film-mp4-cli.mjs starts (no host resolves, no file is read, and
 * every request but the page's own is refused).
 * @param {string} html
 * @param {{ script: string }} opts worca's own script (the exporter's handle), never model text
 * @returns {string}
 */
export function captureDoc(html, { script }) {
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${captureCsp()}">`;
  const at = LEADING_DOCTYPE.exec(html)?.[0].length ?? 0;
  return `${html.slice(0, at)}${head}${html.slice(at)}\n<script>${safeInlineScript(script)}</script>`;
}

/** Every Chrome still running, with the `kill` it was started with: killed when the host exits. */
const liveChildren = new Map();
process.on('exit', () => {
  for (const [child, kill] of liveChildren) { try { kill(child, 'SIGKILL'); } catch { /* gone */ } }
});

/** Whether `file` holds something. Never throws. */
function wroteFile(file) {
  try { return existsSync(file) && statSync(file).size > 0; } catch { return false; }
}

/**
 * Runs one Chrome to one output file. Never rejects. Success is judged by the FILE, not the exit: the file is removed
 * first, so a non-empty file afterwards is this run's, even when Chrome had to be killed at the timeout (macOS Chrome
 * can write its output and never exit). An abort always answers `aborted`. The child leads its own process group on
 * POSIX, so `kill` (`signalTree`) reaches whatever it started. Chrome gets `NO_DNS` before `args`.
 * @param {string} chrome the binary
 * @param {string[]} args `pdfArgs` or `screenshotArgs`
 * @param {{ outFile: string, timeoutMs: number, signal?: AbortSignal | null, spawnImpl?: typeof spawn,
 *   kill?: typeof signalTree }} opts
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export function runChrome(chrome, args, { outFile, timeoutMs, signal = null, spawnImpl = spawn, kill = signalTree } = {}) {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve({ ok: false, reason: 'aborted' }); return; }
    let child;
    try {
      rmSync(outFile, { force: true });
      child = spawnImpl(chrome, [NO_DNS, ...args], { stdio: 'ignore', detached: process.platform !== 'win32', windowsHide: true });
    } catch (e) {
      resolve({ ok: false, reason: e.message });
      return;
    }
    liveChildren.set(child, kill);
    let settled = false;
    let timer = null;
    const finish = (why, { killIt = false, detail = '' } = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (killIt) { try { kill(child, 'SIGKILL'); } catch { /* best effort */ } }
      if (why === 'aborted') resolve({ ok: false, reason: 'aborted' });
      else if (wroteFile(outFile)) resolve({ ok: true });
      else resolve({ ok: false, reason: why === 'close' ? `no output (exit ${detail})` : detail });
    };
    const onAbort = () => finish('aborted', { killIt: true });
    // The child leaves the live set only once it is really gone: a killed one stays until its `close`.
    child.on('close', (code, sig) => { liveChildren.delete(child); finish('close', { detail: String(code ?? sig) }); });
    child.on('error', (e) => { liveChildren.delete(child); finish('error', { detail: e.message }); });
    timer = setTimeout(() => finish('timeout', { killIt: true, detail: 'timed out' }), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * A queue running at most `concurrency` renders at once. `run(fn)` calls `fn` at once (in the same tick) when a slot
 * is free, else queues it at the back, or at the front with `front` (a render a person is waiting on). It settles with
 * `fn`'s result.
 * @param {{ concurrency?: number }} [opts]
 * @returns {{ run: <T>(fn: () => T | Promise<T>, opts?: { front?: boolean }) => Promise<T> }}
 */
export function createRenderQueue({ concurrency = 1 } = {}) {
  const waiting = [];
  let active = 0;
  const start = (job) => {
    active += 1;
    let result;
    try { result = Promise.resolve(job.fn()); } catch (e) { result = Promise.reject(e); }
    result.then(job.resolve, job.reject).finally(() => {
      active -= 1;
      const next = waiting.shift();
      if (next) start(next);
    });
  };
  return {
    run(fn, { front = false } = {}) {
      return new Promise((resolve, reject) => {
        const job = { fn, resolve, reject };
        if (active < concurrency) start(job);
        else if (front) waiting.unshift(job);
        else waiting.push(job);
      });
    },
  };
}

/** The server's one render queue: one Chrome at a time. */
export const renderQueue = createRenderQueue();
