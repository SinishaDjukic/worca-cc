// src/core/page-capture.mjs — headless Chrome for the chat's tab tools and the Browser tab's Pick element (issue 1064
// slice 3). ONE capture path for screenshot_tab, read_tab and Pick: a fresh, cookie-less context loads the address,
// every request and every redirect hop passes `allow(url, isTopNavigation)` (src/core/tab-tools.mjs builds it), and the
// answer is a screenshot (the viewport, or clipped to a selector), the page's text and its console errors. Why the
// server and not the panel's iframe: a proxied preview runs in an opaque origin (CSP sandbox) whose pixels and DOM the
// panel cannot read, another site is cross-origin, and the chat tools must work with no Worca page open (a Discord or
// CLI chat). The browser is the system Chrome the promo kit finds (WORCA_CHROME, PATH, the install folders), driven by
// playwright-core; one browser, started on the first capture and closed after a minute idle; one capture at a time.
import { loadFindTools } from './graph/media-preflight.mjs';

const CDP_URL = new URL('../../assets/promo-kit/tools/cdp.mjs', import.meta.url);

export const CAPTURE_LIMITS = Object.freeze({
  timeoutMs: 25_000, networkIdleMs: 1500, settleMs: 300, idleCloseMs: 60_000, queue: 4,
  textChars: 200_000, consoleMax: 50, consoleLineChars: 500, clipPad: 4, minSide: 4, scanElements: 4000,
});
export const NO_CHROME = 'Worca found no Chrome or Chromium on this machine for the screenshot. Install Google Chrome, or set WORCA_CHROME to its path.';

export class CaptureError extends Error {
  constructor(message, code = 'CAPTURE_FAILED') { super(message); this.name = 'CaptureError'; this.code = code; }
}
const firstLine = (e) => String(e?.message || e).split('\n')[0].slice(0, 300);

/** A picked element's clip: its box padded, kept inside the viewport; null when too small to see. */
export function padClip(box, viewport, pad = CAPTURE_LIMITS.clipPad, min = CAPTURE_LIMITS.minSide) {
  if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite)) return null;
  const x = Math.max(0, Math.floor(box.x - pad));
  const y = Math.max(0, Math.floor(box.y - pad));
  const width = Math.min(viewport.width, Math.ceil(box.x + box.width + pad)) - x;
  const height = Math.min(viewport.height, Math.ceil(box.y + box.height + pad)) - y;
  return width >= min && height >= min ? { x, y, width, height } : null;
}

// ── run inside the page (playwright serialises these) ──
/** Whether the page shows anything: visible text, or one element with a visible box in the viewport. */
function paintedInPage(max) {
  if (((document.body && document.body.innerText) || '').trim()) return true;
  const vw = innerWidth; const vh = innerHeight;
  const all = document.querySelectorAll('body *');
  for (let i = 0; i < all.length && i < max; i += 1) {
    const r = all[i].getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) continue;
    const cs = getComputedStyle(all[i]);
    if (cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0) return true;
  }
  return false;
}
/** The element `sel` names, scrolled into view: its box, or null. A selector the page cannot parse throws. */
function boxInPage(sel) {
  const el = document.querySelector(sel);
  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}
function textInPage(max) { return ((document.body && document.body.innerText) || '').slice(0, max); }

/**
 * The system Chrome under playwright-core: keychain-safe flags and the real HOME. Worca's corporate proxy goes in as raw
 * flags: playwright's own `proxy` option adds `<-loopback>` to the bypass list, which would send the capture's own
 * 127.0.0.1 preview load through the proxy. playwright's signal handlers stay off: its SIGINT handler ends in
 * process.exit(130), which would cut Worca's own shutdown short (playwright still kills Chrome when the process exits).
 */
export async function defaultLaunch({ env = process.env } = {}) {
  const [{ findChrome }, cdp] = await Promise.all([loadFindTools(), import(CDP_URL.href)]);
  const exe = findChrome({ env });
  if (!exe) throw new CaptureError(NO_CHROME, 'NO_CHROME');
  const { chromium } = await import('playwright-core');
  return chromium.launch({ executablePath: exe, headless: true, env: cdp.chromeEnv(env),
    handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
    args: ['--hide-scrollbars', '--mute-audio', '--disable-extensions', '--no-first-run', '--force-color-profile=srgb',
      ...cdp.chromeProxyArgs(env), ...cdp.CHROME_SAFE_ARGS] });
}

/** Whether `req` navigates the page's top frame (a service worker's request has no frame: not top). */
function isTop(page, req) {
  try { return req.isNavigationRequest() && req.frame() === page.mainFrame(); } catch { return false; }
}
/** `allow` answers a boolean or a Promise of one; anything else, and a throw, is a refusal. */
async function allowed(allow, url, top) {
  try { return (await allow(url, top)) === true; } catch { return false; }
}

/**
 * `capture({ url, allow, viewport, shot?, text?, selector?, scale? })` →
 * `{ note, status, title, console, painted, text?, truncated?, png?, width?, height?, missing? }`. `note`: the preview
 * proxy's own page answered (its x-worca-preview-note code) and nothing else was read. `missing`: `selector` named
 * nothing on this load. `width`/`height` are CSS px (the PNG is `scale` times that). Throws CaptureError (NO_CHROME,
 * BUSY, CLOSED, LOAD_FAILED, REFUSED: a redirect hop failed `allow`, CAPTURE_FAILED).
 */
export function createPageCapture({ launch = defaultLaunch, limits = CAPTURE_LIMITS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let browser = null;
  let starting = null;
  let idle = null;
  let chain = Promise.resolve();
  let waiting = 0;
  let closed = false;

  async function getBrowser() {
    if (browser && browser.isConnected()) return browser;
    if (!starting) {
      starting = Promise.resolve().then(() => launch()).then((b) => {
        browser = b;
        b.on?.('disconnected', () => { if (browser === b) browser = null; });
        return b;
      }).finally(() => { starting = null; });
    }
    return starting;
  }
  function armIdle() {
    clearTimer(idle);
    idle = setTimer(() => { const b = browser; browser = null; b?.close().catch(() => {}); }, limits.idleCloseMs);
    idle?.unref?.();
  }

  async function once({ url, allow, viewport, shot = false, text = false, selector = null, scale = 1 }) {
    if (closed) throw new CaptureError('Worca is shutting down.', 'CLOSED');   // queued before close(): never relaunch
    clearTimer(idle);                                                           // the last capture's idle close must not fire mid-capture
    const b = await getBrowser();
    const ctx = await b.newContext({ viewport, deviceScaleFactor: scale, serviceWorkers: 'block', acceptDownloads: false });
    try {
      const page = await ctx.newPage();
      page.setDefaultTimeout(limits.timeoutMs);
      const lines = [];
      const keep = (s) => { if (lines.length < limits.consoleMax) lines.push(String(s).slice(0, limits.consoleLineChars)); };
      page.on('console', (m) => { if (m.type() === 'error') keep(m.text()); });
      page.on('pageerror', (e) => keep(e?.message || e));
      // route() never sees a redirect hop (playwright: "only called for the first url if the response is a redirect"),
      // so every hop is checked here. The hop's request has gone out by then; the capture is refused, so nothing it
      // answered reaches the image or the text.
      const hops = [];
      let escaped = null;
      ctx.on('request', (req) => {
        if (!req.redirectedFrom()) return;
        const u = req.url();
        hops.push(allowed(allow, u, isTop(page, req)).then((ok) => { if (!ok && !escaped) escaped = u; }));
      });
      const checkHops = async () => {
        await Promise.all(hops);
        if (escaped) throw new CaptureError(`the page was redirected to an address this chat may not reach (${escaped.slice(0, 200)}), so nothing was captured`, 'REFUSED');
      };
      await ctx.route('**/*', async (route) => {
        const req = route.request();
        return (await allowed(allow, req.url(), isTop(page, req))) ? route.continue() : route.abort('blockedbyclient');
      });
      await ctx.routeWebSocket(/.*/, async (ws) => { if (await allowed(allow, ws.url(), false)) ws.connectToServer(); else ws.close(); });
      let res = null;
      try { res = await page.goto(url, { waitUntil: 'load', timeout: limits.timeoutMs }); }
      catch (e) { await checkHops(); throw new CaptureError(`the page did not load: ${firstLine(e)}`, 'LOAD_FAILED'); }
      const note = res ? res.headers()['x-worca-preview-note'] || null : null;
      if (note) return { note, status: res.status(), title: '', console: [], painted: false };
      await page.waitForLoadState('networkidle', { timeout: limits.networkIdleMs }).catch(() => {});
      await page.waitForTimeout(limits.settleMs);
      await checkHops();
      const out = { note: null, status: res ? res.status() : 0, title: await page.title().catch(() => ''), console: lines.slice(),
        painted: await page.evaluate(paintedInPage, limits.scanElements) };
      if (text) {
        const t = String(await page.evaluate(textInPage, limits.textChars + 1));
        out.text = t.slice(0, limits.textChars);
        out.truncated = t.length > limits.textChars;
      }
      if (selector) {
        let box;
        try { box = await page.evaluate(boxInPage, selector); } catch { box = null; }
        const clip = box && padClip(box, viewport, limits.clipPad, limits.minSide);
        if (!clip) { await checkHops(); return { ...out, missing: true }; }
        out.png = await page.screenshot({ type: 'png', clip });
        Object.assign(out, { width: clip.width, height: clip.height });
      } else if (shot) {
        out.png = await page.screenshot({ type: 'png' });
        Object.assign(out, { width: viewport.width, height: viewport.height });
      }
      await checkHops();   // a late redirect (a frame navigating during the screenshot) still refuses the capture
      return out;
    } catch (e) {
      if (e instanceof CaptureError) throw e;
      throw new CaptureError(`the capture failed: ${firstLine(e)}`);
    } finally {
      await ctx.close().catch(() => {});
    }
  }

  function capture(o) {
    if (closed) return Promise.reject(new CaptureError('Worca is shutting down.', 'CLOSED'));
    if (waiting >= limits.queue) return Promise.reject(new CaptureError('Worca is busy with other page captures: try again in a moment.', 'BUSY'));
    waiting += 1;
    const run = chain.then(() => once(o)).finally(() => { waiting -= 1; armIdle(); });
    chain = run.catch(() => {});
    return run;
  }
  async function close() {
    closed = true;
    clearTimer(idle);
    const b = browser;
    browser = null;
    await b?.close().catch(() => {});
  }
  return { capture, close };
}
