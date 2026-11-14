#!/usr/bin/env node
// tools/verify-ticket-updates-cdp.mjs — headless-Chrome proof of Ticket updates (plans/ticket-updates-design.md §12 Browser):
// mock mode (WORCA_MOCK=1), the ticketUpdates flag on, jira-source linked with one profile. Pick projects (a click and the
// keys: the focus stays in the popover's search box, Enter toggles the active row), add a project rule, pick a status, Save,
// reopen; New run's project select (source-pane.mjs's remote select, over POST /api/sources/call) holds only the picked ones;
// a mock write-back carries the move; contrast of the section, the open listbox and the open popover in light and dark;
// 390 px. After every open of the move listbox and the projects popover (desktop and 390 px) the popup must not cover its
// button and must stay inside the viewport. Screenshots of boards 1, 3, 4 and 6, light and dark, go to TU_SHOTS (else a new temp folder), kept and printed at
// the end. NOT part of `npm test`.
// Run: node tools/verify-ticket-updates-cdp.mjs   (or: npm run verify:ticket-updates; set CHROME_BIN to a Chrome/Chromium
// binary if it is not auto-found; CDP_PORT pins Chrome's debugging port, else a free one is taken)
//
// -- CI COVERAGE -------------------------------------------------------------
// .github/workflows/ci.yml job `cdp` runs this in its second group, after verify:requirements. What stays CDP-only: the real
// CSS (the 390 px layout, 44 px targets, AA contrast in both themes), the live server's routes in mock mode and the page-error
// gate. The modules' DOM shapes and behaviour are pinned in the jsdom tests of move-select, projects-popover and the section.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'];
const CHROME = process.env.CHROME_BIN || CHROME_PATHS.find((p) => existsSync(p)) || CHROME_PATHS[0];
const SANDBOX = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0 ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
if (!existsSync(CHROME)) { console.error(`no Chrome at ${CHROME} - set CHROME_BIN`); process.exit(1); }
// A free port unless CDP_PORT pins one: a fixed default (it was 9351) can be held by another Chrome on the machine, and the
// proof then waits on an endpoint that never answers (the "no CDP endpoint" flake).
const freePort = () => new Promise((r, j) => { const s = createServer(); s.once('error', j);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });
let PORT = Number(process.env.CDP_PORT || 0);
// The whole proof is bounded: a CDP call that never answers (Chrome gone) ends in a named failure and a cleanup, not a hang.
// 6 min: the clock starts before the server's imports, which a loaded machine has stretched to nearly 3 min on its own
// (a run takes ~35 s on an idle one), Chrome's launch may wait up to 3 x 60 s and the page's load up to 120 s.
const WATCHDOG_MS = Number(process.env.TU_WATCHDOG_MS || 6 * 60_000);
const T0 = Date.now();
const log = (m) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}\n`);

let chrome = null; let srv = null; let home = null; let profile = null; let failed = 0; let SHOTS = ''; let closing = false;
const sockets = [];
/** Ends a Chrome and the processes it started. On Windows a kill of the browser process alone left it (and its renderers)
 *  running, so every run leaked a headless Chrome and the next runs slowed down: taskkill /T /F ends the whole tree. */
function killChrome(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  if (process.platform === 'win32') {
    try { spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', timeout: 20_000, windowsHide: true }); } catch {}
  }
  try { proc.kill('SIGKILL'); } catch {}
}
async function shutdown(code) {
  if (closing) return;
  closing = true;
  for (const s of sockets) { try { s.close(); } catch {} }
  killChrome(chrome);
  try { if (srv) { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); } } catch {}
  // The open SQLite file would block removing the temp home on Windows (verify-requirements-cdp.mjs does the same)
  try { (await import(new URL('../src/core/db.mjs', import.meta.url).href))._resetForTests(); } catch {}
  for (const dir of [home, profile]) { try { if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {} }
  if (SHOTS) log(`screenshots: ${SHOTS}`);
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection']) {
  process.on(sig, (e) => { if (e && e.stack) console.error(e.stack); shutdown(1); });
}
setTimeout(() => { log(`FAIL the proof did not finish within ${WATCHDOG_MS / 1000} s`); shutdown(1); }, WATCHDOG_MS).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, ok, detail = '') => {
  if (ok) log(`ok   ${name}`);
  else { failed += 1; log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`); }
};

// Screenshots for a human look against the approved canvas: always written, never removed by shutdown
SHOTS = process.env.TU_SHOTS || await mkdtemp(path.join(tmpdir(), 'worca-tu-shots-'));

// ---- an isolated home + the app server (env BEFORE the import, the house pattern) ----
home = await mkdtemp(path.join(tmpdir(), 'worca-tu-home-'));
const REAL_ENV = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
process.env.WORCA_HOME = home;
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.WORCA_MOCK = '1';
process.env.WORCA_FLAGS = 'ticketUpdates';
const mod = (p) => import(new URL(p, import.meta.url).href);
const { linkPlugin } = await mod('../src/core/plugin-store.mjs');
const { createProfile, writePluginConfig, readTicketUpdates, readPluginState } = await mod('../src/core/plugin-config.mjs');
const { setUiLevel } = await mod('../src/core/settings.mjs');
const { createPipeline } = await mod('../src/core/artifacts.mjs');
const { retryWriteback } = await mod('../src/core/sources.mjs');
const { getDb } = await mod('../src/core/db.mjs');
await setUiLevel('advanced');   // the Marketplace page is Advanced
await linkPlugin('jira-source', fileURLToPath(new URL('../plugins/jira-source', import.meta.url)));
createProfile('jira-source', 'acme', 'Acme');
writePluginConfig('jira-source', [{ key: 'baseUrl', type: 'text' }, { key: 'token', type: 'text', secret: true }],
  { baseUrl: 'https://acme.atlassian.net', token: 'tok-proof' }, 'acme');
const { server } = await mod('../ui/server.mjs');
srv = server;
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
log(`server on ${base}`);

// ---- Chrome, with the REAL home back for its caches ----
// Up to 3 launches, each waiting up to 60 s for its endpoint (a cold Chrome on a busy CI runner can take well over 10 s).
// A Chrome that exits before its endpoint answers is launched again on a fresh port and profile; its last stderr lines
// are printed when every launch failed, so the failure names its cause.
let up = false;
const chromeErr = [];
for (let attempt = 1; attempt <= 3 && !up; attempt += 1) {
  if (chrome) { killChrome(chrome); chrome = null; }
  if (profile) { try { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {} }
  if (!process.env.CDP_PORT) PORT = await freePort();
  profile = await mkdtemp(path.join(tmpdir(), 'worca-tu-profile-'));
  const proc = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--disable-gpu', '--use-mock-keychain', '--no-first-run', '--no-default-browser-check',
    '--window-size=1400,1000', ...SANDBOX, 'about:blank'],
  { env: { ...process.env, ...REAL_ENV }, stdio: ['ignore', 'ignore', 'pipe'] });
  chrome = proc;
  let exited = null;
  proc.on('exit', (code, signal) => { exited = { code, signal }; });
  proc.stderr.on('data', (d) => { chromeErr.push(String(d)); if (chromeErr.length > 40) chromeErr.shift(); });
  const deadline = Date.now() + 60_000;
  while (!up && !exited && Date.now() < deadline) {
    try { up = (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch { /* not listening yet */ }
    if (!up) await sleep(250);
  }
  if (!up) log(`launch ${attempt}: no CDP endpoint on ${PORT}${exited ? ` (Chrome exited: code ${exited.code}, signal ${exited.signal})` : ' after 60 s'}`);
}
if (!up) {
  log('no CDP endpoint');
  if (chromeErr.length) process.stderr.write(`${chromeErr.join('').trim().split('\n').slice(-15).join('\n')}\n`);
  await shutdown(1);
}
log(`Chrome's endpoint on ${PORT}`);
const { WebSocket } = await import('ws');

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  sockets.push(ws);
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  let msgId = 0;
  const pending = new Map();
  const pageErrors = [];
  // The page's plugin and marketplace requests, from the Network domain (enabled below, before the app's modules load): which are
  // in flight, when the last one started or ended, and whether a marketplaces refresh has answered. openSheet waits on these.
  const net = { inflight: new Map(), changedAt: Date.now(), refreshed: false };
  const watched = (url) => /\/api\/(plugins|marketplaces)\b/.test(url || '');
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails?.exception?.description || 'exception');
    if (m.method === 'Network.requestWillBeSent' && watched(m.params.request?.url)) {
      net.inflight.set(m.params.requestId, m.params.request.url);
      net.changedAt = Date.now();
    }
    if ((m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') && net.inflight.has(m.params.requestId)) {
      if (net.inflight.get(m.params.requestId).includes('/api/marketplaces/refresh')) net.refreshed = true;
      net.inflight.delete(m.params.requestId);
      net.changedAt = Date.now();
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = (msgId += 1);
    pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result.value;
  };
  await send('Network.enable');   // first: the app's requests start once its modules load, well after this
  await send('Runtime.enable');
  await send('Page.enable');
  // Up to 120 s for the page's load: a cold headless Chrome on a busy machine has taken over 60 s to load the app's modules
  // (the server answered in milliseconds). A page that never loads is a named failure here, not a missing row later.
  let loaded = false;
  for (let t0 = Date.now(); !loaded && Date.now() - t0 < 120_000;) {
    loaded = await evalJs(`document.readyState === 'complete' && location.href !== 'about:blank'`).catch(() => false);
    if (!loaded) await sleep(100);
  }
  check('the page loaded', loaded);
  log('page loaded');
  return { send, evalJs, pageErrors, net };
}
async function openPage(url) {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!r.ok) throw new Error(`could not open a tab: HTTP ${r.status}`);
  return connect((await r.json()).webSocketDebuggerUrl);
}

const A = await openPage(`${base}/#marketplace/installed`);
/** Polls `fn` until it answers truthy or `ms` pass. A probe that throws (an element read mid re-render) counts as not yet,
 *  so a slow render is waited out instead of ending the proof with a TypeError. */
const until = async (fn, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await Promise.resolve().then(fn).catch(() => false)) return true; await sleep(60); }
  return false;
};
const js = (body) => A.evalJs(`(() => { ${body} })()`);
const has = (sel) => js(`return !!document.querySelector(${JSON.stringify(sel)});`);
/** Clicks `sel`; a missing element is a named failure (not a silent no-op the next check trips over). */
const click = async (sel) => {
  const ok = await js(`const n = document.querySelector(${JSON.stringify(sel)}); if (!n) return false; n.click(); return true;`);
  if (!ok) check(`click: ${sel} is on the page`, false);
  return ok;
};
const textOf = (sel) => js(`return document.querySelector(${JSON.stringify(sel)})?.textContent ?? null;`);
/** Opens jira-source's manage sheet; true once a fresh section (not one left from an earlier opening) shows its rules. */
const openSheet = async () => {
  // 60 s: the first open is the page's cold load (the installed list's fetch included), which a busy machine stretches past 20 s
  const listed = await until(() => has('button.mk-name[data-name="jira-source"]'), 60000);
  check('the jira-source row is listed', listed, listed ? '' : JSON.stringify(await js(`return { at: location.href,
    rows: [...document.querySelectorAll('.mk-name')].map((n) => n.dataset.name || n.textContent.trim()),
    text: (document.querySelector('main') || document.body).innerText.replace(/\\s+/g, ' ').slice(0, 300) };`).catch((e) => String(e))));
  // Entering #marketplace starts a background refresh of the marketplaces (the Installed header's Refresh is aria-busy until it
  // answers). Its answer repaints the sheet's head, which can move the projects popover's button and close the popover mid-pick:
  // on a fast runner it landed ~0.3 s after the page loaded, between the picks and the footer check. Wait it out first.
  // "Not busy" alone is not enough: the refresh may not have started yet, and a trailing load can start another. So wait for
  // the refresh's answer, then until no plugin or marketplace request is in flight, none started or ended for 0.8 s and nothing
  // shows busy (the Network domain's view: resource timing is no use here, the page's modules fill its buffer first).
  await until(() => A.net.refreshed, 30000);
  await until(async () => A.net.inflight.size === 0 && Date.now() - A.net.changedAt >= 800
    && !(await has('.mk-refresh[aria-busy="true"]')), 30000);
  await js(`for (const s of document.querySelectorAll('.mk-tu')) s.dataset.stale = '1'; return true;`);
  await click('button.mk-name[data-name="jira-source"]');
  return until(() => js(`const host = document.getElementById('mk-sheet-host'); const s = document.querySelector('#mk-sheet .mk-tu:not([data-stale])');
    return !!host && !host.classList.contains('hidden') && !!s && !s.hidden && !!s.querySelector('.mk-tu-rules');`), 15000);
};
/** Scrolls the sheet so `sel` is in view (before a popup opens: a placed popup does not follow a scroll). */
const reveal = (sel, block = 'center') => js(`const n = document.querySelector(${JSON.stringify(sel)}); if (!n) return false;
  n.scrollIntoView({ block: ${JSON.stringify(block)} }); return true;`);
/** A screenshot of the viewport into SHOTS. */
const shot = async (name) => {
  await mkdir(SHOTS, { recursive: true });
  const { data } = await A.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
};
/** The theme the page shows ('' = the system's), once its colours have finished changing. */
const setTheme = async (t) => {
  await A.evalJs(`(() => { const r = document.documentElement; if (${JSON.stringify(t)}) r.dataset.theme = ${JSON.stringify(t)}; else delete r.dataset.theme; })()`);
  await sleep(150);
  await until(() => A.evalJs(`document.getAnimations().length === 0`), 3000);
};
/** verify-requirements-cdp.mjs's lowContrast: the text in `sels` below WCAG AA against what is drawn under it (4.5:1; 3:1 for
 *  large text): [text, ratio, ink, ground]. Translucent layers are composited; disabled controls and hidden text are skipped.
 *  Selectors that reach no visible text are a failure too (a renamed class, or a list that did not open, never passes unseen). */
const lowContrast = (sels) => A.evalJs(`(() => {
  const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
  const ground = (el) => { const layers = [];
    for (let n = el; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 1) break; }
    let g = [255, 255, 255, 1]; for (const l of layers.reverse()) g = over(l, g); return g; };
  const lum = (c) => { const v = c.slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const out = [];
  let seen = 0;
  for (const root of document.querySelectorAll(${JSON.stringify(sels.join(', '))})) {
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (![...el.childNodes].some((t) => t.nodeType === 3 && t.textContent.trim())) continue;
      if (!el.getClientRects().length || el.closest('[hidden], [aria-hidden="true"], button:disabled')) continue;
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden') continue;
      seen += 1;
      const bg = ground(el); const ink = over(rgba(cs.color), bg);
      const [a, b] = [lum(ink), lum(bg)]; const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const px = parseFloat(cs.fontSize); const large = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5)) out.push([el.textContent.trim().slice(0, 40), Math.round(ratio * 100) / 100, cs.color, 'rgb(' + bg.slice(0, 3).map(Math.round).join(', ') + ')']);
    }
  }
  if (!seen) out.push(['no visible text matched', ${JSON.stringify(sels.join(', '))}]);
  return out; })()`);
/** lowContrast in light and dark, a screenshot of each as `<board>-light` / `<board>-dark`; the theme is put back after. */
const contrastBoth = async (sels, board) => {
  const was = await A.evalJs(`document.documentElement.dataset.theme || ''`);
  await setTheme('light');
  const light = await lowContrast(sels);
  await shot(`${board}-light`);
  await setTheme('dark');
  const dark = await lowContrast(sels);
  await shot(`${board}-dark`);
  await setTheme(was);
  return { light, dark };
};
const aa = (name, r) => {
  check(`light: ${name} is AA`, r.light.length === 0, JSON.stringify(r.light));
  check(`dark: ${name} is AA`, r.dark.length === 0, JSON.stringify(r.dark));
};
const SHOP_MOVE = '#mk-sheet .mk-tu-rule[data-project="SHOP"] .mk-tu-move';
const resolvedShown = () => js(`return [...document.querySelectorAll('.mk-tu-movepop [role="option"] .mk-tu-opt-t')].some((o) => o.textContent === 'Resolved');`);
/** An open popup never covers its button and stays inside the viewport (the Task 18 review: the move list slid up over its
 *  select). Two named checks; a missing popup or button fails both with its selector. */
const geometry = async (where, popSel, btnSel) => {
  const g = await js(`const p = document.querySelector(${JSON.stringify(popSel)}); const b = document.querySelector(${JSON.stringify(btnSel)});
    if (!p || !b) return { missing: !p ? ${JSON.stringify(popSel)} : ${JSON.stringify(btnSel)} };
    const pr = p.getBoundingClientRect(); const br = b.getBoundingClientRect(); const r = (x) => Math.round(x);
    return { pop: [r(pr.top), r(pr.bottom)], btn: [r(br.top), r(br.bottom)], vh: innerHeight,
      clear: pr.top >= br.bottom - 1 || pr.bottom <= br.top + 1, inside: pr.bottom <= innerHeight + 1 && pr.top >= -1 };`);
  check(`${where}: it does not cover its button`, !g.missing && g.clear, JSON.stringify(g));
  check(`${where}: it stays inside the viewport`, !g.missing && g.inside, JSON.stringify(g));
};
const openMoveList = async (where) => {
  await reveal('#mk-sheet .mk-tu-rule[data-project="SHOP"]');
  if (!(await click(SHOP_MOVE))) return false;
  const shown = await until(resolvedShown, 15000);
  if (shown) await geometry(`${where}: the move listbox`, '.mk-tu-movepop', SHOP_MOVE);
  return shown;
};
/** Esc on the SHOP select: true once the list is gone, else why not. */
const closeMoveList = () => js(`const b = document.querySelector(${JSON.stringify(SHOP_MOVE)}); if (!b) return 'no SHOP move select';
  b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  return !document.querySelector('.mk-tu-movepop') || 'the listbox is still open';`);
const sixRows = () => js(`return document.querySelectorAll('.mk-tu-projpop .mk-tu-prow').length === 6;`);
const openPopover = async (where) => {
  await reveal('#mk-sheet .mk-tu-add-projects');
  if (!(await click('#mk-sheet .mk-tu-add-projects'))) return false;
  const shown = await until(sixRows, 15000);
  if (shown) await geometry(`${where}: the projects popover`, '.mk-tu-projpop', '#mk-sheet .mk-tu-add-projects');
  return shown;
};
/** A key pressed in the popover's search box (the focus stays there, §11 listbox model); false when the box is gone. */
const keyInSearch = async (key) => {
  const ok = await js(`const q = document.querySelector('.mk-tu-projpop .mk-tu-search'); if (!q) return false;
    q.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true })); return true;`);
  if (!ok) check(`${key} in the popover's search box: the box is on the page`, false);
  return ok;
};

// ---- pick projects (board 3): SHOP with a click on its row, CRM with the keys ----
check('the manage sheet shows Ticket updates', await openSheet());
check('its header names the connection', (await textOf('#mk-sheet .mk-tu-head .mk-meta')) === 'Acme (acme)');
check('the projects popover lists the six projects', await openPopover('desktop, picking'));
check('the focus is in the popover\'s search box', await js(`return document.activeElement === document.querySelector('.mk-tu-projpop .mk-tu-search');`));
await click('.mk-tu-projpop .mk-tu-prow[data-value="SHOP"]');   // a click toggles the row and makes it the active one
await keyInSearch('ArrowDown');   // CRM, the row after SHOP
await keyInSearch('Enter');
check('SHOP (a click) and CRM (ArrowDown, Enter) are picked', await js(`const sel = (v) => document.querySelector('.mk-tu-projpop .mk-tu-prow[data-value="' + v + '"]')?.getAttribute('aria-selected');
  return sel('SHOP') === 'true' && sel('CRM') === 'true' && sel('OPS') === 'false';`));
check('the focus stayed in the search box', await js(`return document.activeElement === document.querySelector('.mk-tu-projpop .mk-tu-search');`));
check('the footer counts the picks', (await textOf('.mk-tu-pcount')) === '2 picked · 6 projects on Acme', await textOf('.mk-tu-pcount'));
await click('.mk-tu-projpop .mk-tu-done');
check('Done closes the popover', await until(async () => !(await has('.mk-tu-projpop'))));
check('two chips, SHOP and CRM', await until(() => js(`return [...document.querySelectorAll('#mk-sheet .mk-tu-chip')].map((c) => c.dataset.value).join() === 'SHOP,CRM';`)));

// ---- a project rule with one of its statuses (board 4) ----
// The button is waited for (enabled) before the click, and the click is made again if no row came of it: the section can still
// be settling from the popover's Done when the first click lands (the flake: no Project select, then a null `.options`).
check('Add a project rule is on the page and enabled', await until(() => js(`const b = document.querySelector('#mk-sheet .mk-tu-add-rule');
  return !!b && !b.disabled && b.getClientRects().length > 0;`)));
let addedRow = false;
for (let i = 0; i < 3 && !addedRow; i += 1) {
  if (!(await has('#mk-sheet .mk-tu-project'))) await click('#mk-sheet .mk-tu-add-rule');
  addedRow = await until(() => has('#mk-sheet .mk-tu-project'), 5000);
}
check('the new row has a Project select', addedRow);
const projectChoices = () => js(`const s = document.querySelector('#mk-sheet .mk-tu-project');
  return s ? [...s.options].filter((o) => o.value).map((o) => o.value).join() : null;`);
check('its Project select offers only SHOP and CRM', await until(async () => (await projectChoices()) === 'SHOP,CRM'), String(await projectChoices()));
// a mouse pick (no key before the change) commits at once; a pick with the keys would wait for Enter or blur
check('the Project select takes SHOP', await js(`const s = document.querySelector('#mk-sheet .mk-tu-project'); if (!s) return false;
  s.value = 'SHOP'; s.dispatchEvent(new Event('change', { bubbles: true })); return true;`));
check('the row became the SHOP rule', await until(() => has('#mk-sheet .mk-tu-rule[data-project="SHOP"]')));
check("SHOP's statuses load into the listbox", await openMoveList('desktop, picking'));
check('the listbox has a Resolved option to click', await js(`const o = [...document.querySelectorAll('.mk-tu-movepop [role="option"]')]
  .find((n) => n.querySelector('.mk-tu-opt-t')?.textContent === 'Resolved'); if (!o) return false; o.click(); return true;`));
check('the select shows Resolved', await until(async () => (await textOf(`${SHOP_MOVE} .mk-tu-move-t`)) === 'Resolved'), await textOf(`${SHOP_MOVE} .mk-tu-move-t`));

// ---- contrast, light and dark: the section (boards 1, 2), the open listbox (board 4), the open popover (board 3) ----
await reveal('#mk-sheet .mk-tu', 'start');
aa('the section', await contrastBoth(['#mk-sheet .mk-tu'], 'board1-section'));
check('the move listbox opens with the statuses', await openMoveList('desktop'));
aa('the open move listbox', await contrastBoth(['.mk-tu-movepop'], 'board4-listbox'));
let closed = await closeMoveList();
check('Esc closes the listbox', closed === true, closed);
check('the projects popover opens', await openPopover('desktop'));
aa('the open projects popover', await contrastBoth(['.mk-tu-projpop'], 'board3-popover'));
await click('.mk-tu-projpop .mk-tu-done');

// ---- 390 px (board 6) ----
await setTheme('light');
await A.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
check('390 px: the page took the phone width', await until(() => js(`return window.innerWidth === 390;`)));
const phone = await js(`const row = document.querySelector('#mk-sheet .mk-tu-rule[data-project="SHOP"]'); const sel = row?.querySelector('.mk-tu-movewrap');
  const nameEl = row?.querySelector('.mk-tu-name'); const xEl = document.querySelector('#mk-sheet .mk-tu-x');
  const missing = [[row, 'the SHOP rule'], [sel, 'its .mk-tu-movewrap'], [nameEl, 'its .mk-tu-name'], [xEl, 'a chip ×']].filter(([n]) => !n).map(([, w]) => w);
  if (missing.length) return { missing };
  const r = row.getBoundingClientRect(); const s = sel.getBoundingClientRect(); const name = nameEl.getBoundingClientRect();
  const x = xEl.getBoundingClientRect();
  const buttons = [...document.querySelectorAll('#mk-sheet .mk-tu .btn, #mk-sheet .mk-tu-move')].filter((b) => b.getClientRects().length);
  return { below: s.top >= name.bottom - 1, wide: s.width >= r.width - 40, tall: buttons.every((b) => b.getBoundingClientRect().height >= 44),
    short: buttons.filter((b) => b.getBoundingClientRect().height < 44).map((b) => b.className + ' ' + Math.round(b.getBoundingClientRect().height)),
    x: Math.round(x.width), scroll: document.documentElement.scrollWidth <= window.innerWidth };`);
check('390 px: the select sits below the name at full width', phone.below && phone.wide, JSON.stringify(phone));
check('390 px: every button and select is 44 px tall; the chip × is 32 px', phone.tall && phone.x === 32, JSON.stringify(phone));
check('390 px: no sideways scroll', phone.scroll, JSON.stringify(phone));
await reveal('#mk-sheet .mk-tu-rule[data-project="SHOP"]');
aa('390 px: the section', await contrastBoth(['#mk-sheet .mk-tu'], 'board6-phone'));
check('390 px: the listbox opens', await openMoveList('390 px'));
const optH = await js(`return [...document.querySelectorAll('.mk-tu-movepop [role="option"]')].map((o) => Math.round(o.getBoundingClientRect().height));`);
check('390 px: every listbox option is 44 px tall', optH.length > 0 && optH.every((h) => h >= 44), JSON.stringify(optH));
aa('390 px: the open move listbox', await contrastBoth(['.mk-tu-movepop'], 'board6-phone-listbox'));
closed = await closeMoveList();
check('390 px: Esc closes the listbox', closed === true, closed);
check('390 px: the popover opens', await openPopover('390 px'));
const rowH = await js(`return [...document.querySelectorAll('.mk-tu-projpop .mk-tu-prow')].map((r) => Math.round(r.getBoundingClientRect().height));`);
check('390 px: every popover row is 44 px tall', rowH.length === 6 && rowH.every((h) => h >= 44), JSON.stringify(rowH));
check('390 px: the popover fits the screen', await js(`const p = document.querySelector('.mk-tu-projpop'); if (!p) return false;
  const b = p.getBoundingClientRect(); return b.left >= 0 && b.right <= window.innerWidth;`));
aa('390 px: the open projects popover', await contrastBoth(['.mk-tu-projpop'], 'board6-phone-popover'));
await click('.mk-tu-projpop .mk-tu-done');
await A.send('Emulation.clearDeviceMetricsOverride');
check('the page is back at desktop width', await until(() => js(`return window.innerWidth > 390;`)));

// ---- Save, then reopen ----
await click('#mk-sheet [data-act="save"]');
check('Save closes the sheet', await until(() => js(`return document.getElementById('mk-sheet-host')?.classList.contains('hidden') === true;`), 15000));
const rec = readTicketUpdates('jira-source', 'acme', 'jira');
check('the record holds SHOP and CRM and the SHOP rule', !!rec && rec.projects.map((p) => p.value).join() === 'SHOP,CRM'
  && rec.rules.some((r) => r.project === 'SHOP' && r.target.kind === 'status' && r.target.value === '10012'), JSON.stringify(rec));
check('reopened: the sheet shows the saved rule', await openSheet()
  && (await until(async () => (await textOf(`${SHOP_MOVE} .mk-tu-move-t`)) === 'Resolved')));
check('reopened: the chips are SHOP and CRM', await js(`return [...document.querySelectorAll('#mk-sheet .mk-tu:not([data-stale]) .mk-tu-chip')].map((c) => c.dataset.value).join() === 'SHOP,CRM';`));
check('the old setting reads "Moved to Ticket updates."', await until(() => has('#mk-sheet .field[data-field="transitionOnComplete"] .mk-tu-moved')));

// ---- New run's project select (§12): source-pane.mjs's own remote select over the real route; a mock write-back ----
const listed = await A.evalJs(`(async () => {
  const { renderSourcePane } = await import('/source-pane.mjs');
  const call = (op, args) => fetch('/api/sources/call', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ plugin: 'jira-source', sourceId: 'jira', op, profile: 'acme', args }) }).then((r) => r.json()).then((j) => j.result);
  const pane = renderSourcePane({ plugin: 'jira-source', sourceId: 'jira', displayName: 'Jira',
    inputs: [{ key: 'project', type: 'remote-select', label: 'Project', optionsFrom: 'listProjects' }] }, { call, doc: document });
  document.body.append(pane);
  const s = pane.querySelector('select.sp-remote');
  if (!s) { pane.remove(); return 'no select.sp-remote in the source pane'; }
  s.dispatchEvent(new FocusEvent('focus'));   // the select loads on its first focus (a headless page may not take real focus)
  await s._load;
  const values = [...s.options].map((o) => o.value).join();
  pane.remove();
  return values; })()`);
check("New run's project select lists only SHOP and CRM", listed === 'SHOP,CRM', listed);
const projectDir = path.join(home, 'shop');
await mkdir(projectDir, { recursive: true });
const p = await createPipeline(projectDir, { promptText: '# Ship it', sourceType: 'plugin', title: 'Ship it',
  sourceMeta: { plugin: 'jira-source', sourceId: 'jira', profile: 'acme', taskId: 'SHOP-7', project: 'SHOP', inputs: { writeBack: 'yes' }, url: null, title: 'Ship it' } });
getDb().prepare("UPDATE pipelines SET status = 'done' WHERE id = ?").run(p.id);
const out = await retryWriteback(p.id);
const last = JSON.parse(readPluginState('jira-source', 'acme').lastReport || '{}');
check('a finished run reports with the SHOP rule\'s move', JSON.stringify(last.move) === JSON.stringify({ status: '10012', name: 'Resolved' }), JSON.stringify(last.move));
check('and hears what happened', out.note === 'Moved to Resolved.', JSON.stringify(out));

check('no page errors', A.pageErrors.length === 0, A.pageErrors.join(' | '));
log(failed ? `${failed} check(s) failed` : 'all checks passed');
await shutdown(failed ? 1 : 0);
