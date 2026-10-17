// harness.mjs — the recording kit for browser-based demo takes (web UIs, and terminal replays rendered in a page).
//
// Your take script imports Playwright itself (see find-playwright.mjs) and passes `chromium` in:
//
//   import { chromium } from '<path printed by find-playwright.mjs>';
//   import { openTake } from './harness.mjs';
//   const take = await openTake({ chromium, base: 'http://localhost:4392', out: '/abs/takes', title: ['Pinpoint', 'Act on exactly the text you mean'] });
//   const { page, caption, card, select, click, hover, type, key, wait, zoom } = take;
//   ... scenes ...
//   await zoom('.status-pill', { why: 'the run is waiting for you', hold: 1800 });   // eased zoom on a small detail
//   const file = await take.close({ as: 'pinpoint-cycle1' });   // video-takes/pinpoint-cycle1.webm (+ .zooms.json)
//
// What it gives every take: a visible cursor that follows real mouse moves, a caption pill, full-screen title cards
// (the opening one is up from the very first paint, so no blank frames lead the video), real input with a scripted
// fallback for fragile selections, route-level interception for answers mock mode cannot give, and eased zooms on small
// details. A zoom is a CSS transform on <body>, so the page re-renders sharp at the zoomed size (no pixel upscaling);
// the caption pill, title card and cursor live on <html>, outside the transform, and stay their size. Every zoom is
// logged to <take>.zooms.json, which the contact-sheets step uses to show the reviewer a frame from each hold.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Inject the cursor, caption pill and card overlay into every page of the context. */
function overlayScript({ titleCard, theme }) {
  const dark = theme === 'dark';
  return `(() => {
    const TITLE = ${JSON.stringify(titleCard || null)};
    const boot = () => {
      if (document.getElementById('__pv_cursor')) return;
      const c = document.createElement('div');
      c.id = '__pv_cursor';
      c.style.cssText = 'position:fixed;z-index:2147483647;left:-40px;top:-40px;width:18px;height:18px;margin:-3px 0 0 -3px;pointer-events:none;'
        + 'background:url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><path d="M2 1l13 7-6 1.5L6.5 16z" fill="${dark ? '#fff' : '#111'}" stroke="${dark ? '#111' : '#fff'}" stroke-width="1.4" stroke-linejoin="round"/></svg>') + '") no-repeat;';
      document.documentElement.appendChild(c);
      addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
      const cap = document.createElement('div');
      cap.id = '__pv_cap';
      cap.style.cssText = 'position:fixed;z-index:2147483646;left:50%;bottom:28px;transform:translateX(-50%);padding:10px 18px;border-radius:999px;'
        + 'background:rgba(17,17,19,.86);color:#fff;font:500 15px/1.3 system-ui,-apple-system,sans-serif;letter-spacing:.01em;'
        + 'box-shadow:0 8px 30px rgba(0,0,0,.25);opacity:0;transition:opacity .3s;pointer-events:none;white-space:nowrap;';
      document.documentElement.appendChild(cap);
      const card = document.createElement('div');
      card.id = '__pv_card';
      card.style.cssText = 'position:fixed;inset:0;z-index:2147483645;display:none;place-items:center;text-align:center;'
        + 'background:${dark ? '#151517' : '#fafaf9'};font-family:system-ui,-apple-system,sans-serif;';
      document.documentElement.appendChild(card);
      const esc = (s) => String(s || '').replace(/[&<>]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[x]);
      window.__pvCaption = (t) => { cap.textContent = t || ''; cap.style.opacity = t ? '1' : '0'; };
      window.__pvCard = (title, sub) => {
        if (!title) { card.style.display = 'none'; return; }
        card.innerHTML = '<div><div style="font:600 44px/1.1 system-ui,-apple-system,sans-serif;letter-spacing:-.02em;color:${dark ? '#ededef' : '#19191b'}">' + esc(title)
          + '</div><div style="margin-top:14px;font:400 18px/1.5 system-ui,-apple-system,sans-serif;color:${dark ? '#b2b2b8' : '#5c5c63'}">' + esc(sub) + '</div></div>';
        card.style.display = 'grid';
      };
      if (TITLE && !sessionStorage.getItem('__pv_title_shown')) window.__pvCard(TITLE[0], TITLE[1]);
    };
    if (document.documentElement) boot(); else addEventListener('DOMContentLoaded', boot);
    addEventListener('DOMContentLoaded', boot);
  })();`;
}

/**
 * Start a headless browser: `executablePath` when given, else the system Google Chrome (Playwright's `chrome` channel
 * finds it on macOS, Windows and Linux), else Playwright's own chromium. `kind` says which one started.
 * @returns {Promise<{browser: object, kind: 'custom'|'chrome'|'chromium'}>}
 */
export async function launchBrowser(chromium, { executablePath } = {}) {
  // --use-mock-keychain: a scratch HOME must never reach the real macOS keychain (it prompts the user); other OSes ignore it.
  const opts = { headless: true, args: ['--use-mock-keychain', '--hide-scrollbars'] };
  if (executablePath) return { browser: await chromium.launch({ ...opts, executablePath }), kind: 'custom' };
  try {
    return { browser: await chromium.launch({ ...opts, channel: 'chrome' }), kind: 'chrome' };
  } catch (chromeErr) {
    try {
      return { browser: await chromium.launch(opts), kind: 'chromium' };
    } catch (err) {
      throw new Error(`no browser: Google Chrome did not start (${String(chromeErr.message).split('\n')[0]}) and neither did Playwright's chromium (${String(err.message).split('\n')[0]})`);
    }
  }
}

/**
 * Open a recorded browser context.
 * @param {object} o
 * @param {object} o.chromium            Playwright's chromium (the take script imports it)
 * @param {string} o.out                 directory for the .webm
 * @param {string} [o.base]              the demo instance's origin
 * @param {[string,string]} [o.title]    opening title card [title, subtitle]; shown from the first paint
 * @param {number} [o.width=1920] @param {number} [o.height=1080]
 * @param {'light'|'dark'} [o.theme='light']
 * @param {string} [o.executablePath]    a browser binary; default: the system Google Chrome (any OS), else Playwright's chromium
 * @param {(page) => Promise<void>} [o.warmUp]  runs in an UNRECORDED context first (dismiss onboarding, reset state)
 */
export async function openTake({ chromium, out, base = '', title = null, width = 1920, height = 1080, theme = 'light', executablePath, warmUp }) {
  const { browser } = await launchBrowser(chromium, { executablePath });
  if (warmUp) {
    const warm = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
    try { await warmUp(await warm.newPage()); } finally { await warm.close(); }
  }
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: theme, recordVideo: { dir: out, size: { width, height } } });
  await ctx.addInitScript(overlayScript({ titleCard: title, theme }));
  const page = await ctx.newPage();
  const t0 = Date.now();                       // the recording starts with the page; zoom times are seconds from here
  const zooms = [];
  let zoomed = null;                           // { s, dx, dy, cx, cy, ms, log } while zoomed in
  let mx = width / 2, my = height / 2;

  const caption = (t) => page.evaluate((x) => window.__pvCaption && window.__pvCaption(x), t || '');
  let titleDone = !title;
  const card = async (t, s) => {
    titleDone = true;
    await page.evaluate(([a, b]) => { sessionStorage.setItem('__pv_title_shown', '1'); window.__pvCard && window.__pvCard(a, b); }, [t || '', s || '']);
  };
  async function moveTo(x, y, steps = 18) { await page.mouse.move(x, y, { steps }); mx = x; my = y; }

  /** Box of the nth occurrence of `needle` in the text of elements matching `sel` (null when absent). */
  function textBox(sel, needle, nth = 0) {
    return page.evaluate(([s, n, k]) => {
      let seen = 0;
      for (const root of document.querySelectorAll(s)) {
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
        const full = nodes.map((x) => x.data).join('');
        for (let i = full.indexOf(n); i > -1; i = full.indexOf(n, i + 1)) {
          if (seen++ !== k) continue;
          let pos = 0; const r = document.createRange(); let set = false;
          for (const x of nodes) {
            const L = x.data.length;
            if (!set && i < pos + L) { r.setStart(x, i - pos); set = true; }
            if (set && i + n.length <= pos + L) { r.setEnd(x, i + n.length - pos); break; }
            pos += L;
          }
          const rs = [...r.getClientRects()];
          if (!rs.length) return null;
          const a = rs[0], b = rs[rs.length - 1];
          return { x1: a.left + 1, y1: a.top + a.height / 2, x2: b.right - 1, y2: b.top + b.height / 2 };
        }
      }
      return null;
    }, [sel, needle, nth]);
  }
  function scriptedSelect(sel, needle, nth) {
    return page.evaluate(([s, n, k]) => {
      let seen = 0;
      for (const root of document.querySelectorAll(s)) {
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
        const full = nodes.map((x) => x.data).join('');
        for (let i = full.indexOf(n); i > -1; i = full.indexOf(n, i + 1)) {
          if (seen++ !== k) continue;
          let pos = 0; const r = document.createRange(); let set = false;
          for (const x of nodes) { const L = x.data.length; if (!set && i < pos + L) { r.setStart(x, i - pos); set = true; } if (set && i + n.length <= pos + L) { r.setEnd(x, i + n.length - pos); break; } pos += L; }
          const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r);
          document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
          return true;
        }
      }
      return false;
    }, [sel, needle, nth]);
  }

  /** Viewport rect of a zoom target: a selector, { text, within? } (the first occurrence of the text), or a rect. */
  async function rectOf(target) {
    if (target && typeof target === 'object' && 'width' in target) return { x: target.x, y: target.y, width: target.width, height: target.height };
    if (target && typeof target === 'object' && target.text) {
      const b = await textBox(target.within || 'body', target.text, target.nth || 0);
      if (!b) throw new Error(`zoom: text "${target.text}" not found`);
      return { x: b.x1 - 4, y: b.y1 - 14, width: b.x2 - b.x1 + 8, height: b.y2 - b.y1 + 28 };
    }
    const el = page.locator(String(target)).first();
    await el.waitFor({ state: 'visible', timeout: 15000 });
    return el.boundingBox();
  }
  const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);   // matches cubic-bezier(.65,0,.35,1) closely
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  /** Glide the real mouse (and so the cursor overlay) from where it is to (x, y) over `ms`, eased like the zoom. */
  async function glide(x, y, ms) {
    const fx = mx, fy = my, n = Math.max(2, Math.round(ms / 25));
    for (let i = 1; i <= n; i++) { const p = ease(i / n); await page.mouse.move(fx + (x - fx) * p, fy + (y - fy) * p); await sleep(ms / n); }
    mx = x; my = y;
  }
  /** Where viewport point (x, y) lands under the zoom z (o + d + s·(p − o)), kept inside the viewport. */
  const mapIn = (z, x, y) => [clamp(z.cx + z.dx + z.s * (x - z.cx), 4, width - 4), clamp(z.cy + z.dy + z.s * (y - z.cy), 4, height - 4)];
  const mapOut = (z, x, y) => [clamp(z.cx + (x - z.cx - z.dx) / z.s, 4, width - 4), clamp(z.cy + (y - z.cy - z.dy) / z.s, 4, height - 4)];

  async function zoomOut({ ms } = {}) {
    if (!zoomed) return;
    const z = zoomed; zoomed = null;
    const dur = ms ?? z.ms;
    const [ox, oy] = mapOut(z, mx, my);
    await Promise.all([
      page.evaluate((d) => { document.body.style.transition = `transform ${d}ms cubic-bezier(.65,0,.35,1)`; document.body.style.transform = ''; }, dur),
      glide(ox, oy, dur),
    ]);
    await sleep(60);
    await page.evaluate(() => {
      const b = document.body;
      b.style.transition = ''; b.style.transformOrigin = '';
      document.documentElement.style.overflow = b.dataset.pvOverflow || '';
      delete b.dataset.pvOverflow;
    });
    z.log.end = Math.round((Date.now() - t0) / 100) / 10;
  }

  /**
   * Ease in on a small detail and stay zoomed (clicks and hovers keep working on the zoomed page) until zoomOut().
   * Scale defaults to what fits the target with `pad` px around it, between minScale and maxScale. The zoomed page
   * always covers the frame: near an edge the target sits off-centre rather than showing empty space.
   */
  async function zoomTo(target, { scale, pad = 56, ms = 650, minScale = 1.4, maxScale = 2.5, why = '' } = {}) {
    if (zoomed) await zoomOut();
    const r = await rectOf(target);
    const s = scale || clamp(Math.min(width / (r.width + 2 * pad), height / (r.height + 2 * pad)), minScale, maxScale);
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const dx = clamp(width / 2 - cx, (width - cx) * (1 - s), cx * (s - 1));
    const dy = clamp(height / 2 - cy, (height - cy) * (1 - s), cy * (s - 1));
    const log = { kind: 'live', at: Math.round((Date.now() - t0) / 100) / 10, ms, scale: Math.round(s * 100) / 100,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, why };
    zooms.push(log);
    zoomed = { s, dx, dy, cx, cy, ms, log };
    const [tx, ty] = mapIn(zoomed, mx, my);
    await Promise.all([
      page.evaluate(({ s, dx, dy, cx, cy, ms }) => {
        const b = document.body, br = b.getBoundingClientRect();
        b.dataset.pvOverflow = document.documentElement.style.overflow || '';
        document.documentElement.style.overflow = 'hidden';         // the scaled body must not grow scrollbars
        b.style.transformOrigin = `${cx - br.left}px ${cy - br.top}px`;
        b.style.transition = `transform ${ms}ms cubic-bezier(.65,0,.35,1)`;
        void b.offsetWidth;
        b.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
      }, { s, dx, dy, cx, cy, ms }),
      glide(tx, ty, ms),
    ]);
    await sleep(80);
  }

  return {
    page, ctx, browser, caption, card, moveTo, textBox, zoomTo, zoomOut,
    /** zoomTo, hold, zoomOut: the usual zoom moment. `hold` 1500–2500 ms is enough to read a label. */
    async zoom(target, { hold = 1800, ...o } = {}) { await zoomTo(target, o); await sleep(hold); await zoomOut(); },
    /** Whether the opening title card is still waiting to be dismissed (card('') or any card() call clears it). */
    titlePending: () => !titleDone,
    wait: sleep,
    /** Scroll the first element under `sel` holding `needle` to the middle of the viewport (never sideways). */
    async reveal(sel, needle = '') {
      await page.evaluate(([s, n]) => {
        const el = [...document.querySelectorAll(s)].find((e) => e.textContent.includes(n));
        el?.scrollIntoView({ block: 'center', inline: 'nearest' });
      }, [sel, needle]);
      await sleep(300);
    },
    /**
     * Drag-select `needle` with the real mouse. `expect` is a selector that must appear afterwards (the UI's reaction);
     * when it does not, the selection is made by script and the same pointerup fired, so the take never stalls.
     */
    async select(sel, needle, { nth = 0, expect = null, settle = 500 } = {}) {
      const b = await textBox(sel, needle, nth);
      if (!b) throw new Error(`select: "${needle}" not found under ${sel}`);
      await moveTo(b.x1 - 2, b.y1);
      await page.mouse.down();
      await page.mouse.move(b.x2 + 1, b.y2, { steps: 22 });
      mx = b.x2; my = b.y2;
      await page.mouse.up();
      await sleep(settle);
      if (expect && !(await page.$(expect))) {
        await scriptedSelect(sel, needle, nth);
        await sleep(settle);
        if (!(await page.$(expect))) throw new Error(`select: "${expect}" never appeared after selecting "${needle}"`);
      }
    },
    /** Move to the element and click it with the real mouse. */
    async click(sel, { pause = 180, steps = 16 } = {}) {
      const el = page.locator(sel).first();
      await el.waitFor({ state: 'visible', timeout: 15000 });
      const bb = await el.boundingBox();
      await moveTo(bb.x + bb.width / 2, bb.y + bb.height / 2, steps);
      await sleep(pause);
      await page.mouse.down(); await page.mouse.up();
    },
    async hover(sel, { steps = 12 } = {}) {
      const el = page.locator(sel).first();
      await el.waitFor({ state: 'visible', timeout: 15000 });
      const bb = await el.boundingBox();
      await moveTo(bb.x + bb.width / 2, bb.y + bb.height / 2, steps);
    },
    type: (text, delay = 34) => page.keyboard.type(text, { delay }),
    key: (k) => page.keyboard.press(k),
    /**
     * Answer `urlGlob` with scripted content instead of the real service (mock mode can't give it). `respond` gets the
     * parsed JSON body and returns {status?, contentType?, body}. List every use in storyboard.md as scripted.
     */
    async intercept(urlGlob, respond, { delay = 600 } = {}) {
      await page.route(urlGlob, async (route) => {
        let body = null;
        try { body = JSON.parse(route.request().postData() || 'null'); } catch { body = route.request().postData(); }
        const r = await respond(body, route.request());
        await sleep(delay);
        await route.fulfill({ status: r.status || 200, contentType: r.contentType || 'application/json', body: typeof r.body === 'string' ? r.body : JSON.stringify(r.body) });
      });
    },
    /**
     * Finish the take: closes the context (which writes the video) and returns the .webm path. With `as`, the file is
     * renamed to `<as>.webm` in the same folder. The zoom log goes next to it as `<name>.zooms.json`.
     */
    async close({ as } = {}) {
      if (zoomed) await zoomOut();
      const video = page.video();
      await ctx.close();
      await browser.close();
      if (!video) return null;
      const { rename, writeFile } = await import('node:fs/promises');
      const { dirname, join, basename, extname } = await import('node:path');
      let file = await video.path();
      if (as) { const to = join(dirname(file), `${as}.webm`); await rename(file, to); file = to; }
      if (zooms.length) await writeFile(join(dirname(file), `${basename(file, extname(file))}.zooms.json`), JSON.stringify({ version: 1, zooms }, null, 2) + '\n');
      return file;
    },
  };
}

/**
 * Terminal replay: render a recorded CLI session in a page (terminal.html) and play it with real typing speed.
 * `session` = { title?, prompt?, cols?, rows?, theme?, steps: [{ cmd, output, pauseAfter? } | { caption } | { card: [t, s] }
 *   | { zoom: '<text in the output>', hold?, why? }] } — a zoom step eases in on the first occurrence of that text.
 * Capture each step's real output first with capture.mjs; never invent output.
 */
export async function playTerminal(take, session, { typeDelay = 45 } = {}) {
  const { page } = take;
  const { pathToFileURL } = await import('node:url');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  await page.goto(pathToFileURL(join(here, 'terminal.html')).href);
  await page.evaluate((s) => window.__term.init(s), { title: session.title || '', prompt: session.prompt || '$ ', cols: session.cols || 100, rows: session.rows || 28, theme: session.theme || 'dark' });
  // The opening title card is drawn on every new document until dismissed: hold it, then reveal the terminal.
  if (take.titlePending()) { await sleep(session.titleHold ?? 2600); await take.card(''); }
  for (const step of session.steps) {
    if (step.card) { await take.card(step.card[0], step.card[1]); await sleep(step.hold ?? 2600); await take.card(''); continue; }
    if (step.caption !== undefined) { await take.caption(step.caption); continue; }
    if (step.zoom) { await take.zoom({ text: step.zoom, within: '#out' }, { hold: step.hold ?? 1800, why: step.why || '' }); continue; }
    for (const ch of step.cmd) { await page.evaluate((c) => window.__term.typeChar(c), ch); await sleep(typeDelay + Math.random() * 25); }
    await sleep(350);
    await page.evaluate((o) => window.__term.run(o), step.output || '');
    await sleep(step.pauseAfter ?? 1800);
  }
}
