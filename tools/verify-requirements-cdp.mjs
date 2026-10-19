#!/usr/bin/env node
// tools/verify-requirements-cdp.mjs — headless-Chrome proof of the Requirements page (plans/requirements-design.md §6).
// Checks: with the `requirements` flag off there is no nav row; flipping it on shows the row without a reload;
// the new-feature form renders; creating a feature in mock mode shows round 1's question card; answering it
// (Skip, use recommended) fills the spec with R-po-1 and marks the interview done; no page errors.
// NOT part of `npm test`.
// Run: npm run verify:requirements   (set CHROME_BIN to a Chrome/Chromium binary if it is not auto-found,
// e.g. CHROME_BIN="C:/Program Files/Google/Chrome/Application/chrome.exe" on Windows)
//
// -- CI COVERAGE -------------------------------------------------------------
// .github/workflows/ci.yml job `cdp` runs this in the "ask-forms + workspace-map + flags + requirements"
// group on every push and pull request.
// What stays CDP-only: the real end-to-end flow in a real browser (app boot and `hello` frame, the flag
// flipped through window.__np.flags, real CSS deciding the nav row's computed display, the hash route, the
// live server in mock mode) and the no-page-error gate. The view's DOM shapes and behaviour are pinned in
// the jsdom tests test/requirements-view.test.mjs and test/requirements-app.test.mjs.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'];
const CHROME = process.env.CHROME_BIN || CHROME_PATHS.find((p) => existsSync(p)) || CHROME_PATHS[0];
const SANDBOX = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0
  ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
if (!existsSync(CHROME)) { console.error(`no Chrome at ${CHROME} - set CHROME_BIN`); process.exit(1); }
const PORT = Number(process.env.CDP_PORT || 9344);
const T0 = Date.now();
const log = (m) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}\n`);

let chrome = null; let srv = null; let home = null; let profile = null; let failed = 0;
const sockets = [];
async function shutdown(code) {
  for (const s of sockets) { try { s.close(); } catch {} }
  try { if (chrome) chrome.kill('SIGKILL'); } catch {}
  try { if (srv) { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); } } catch {}
  for (const dir of [home, profile]) { try { if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 3 }); } catch {} }
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection']) {
  process.on(sig, (e) => { if (e && e.stack) console.error(e.stack); shutdown(1); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, ok, detail = '') => {
  if (ok) log(`ok   ${name}`);
  else { failed += 1; log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`); }
};

// ---- an isolated home + the app server (env BEFORE the import, the house pattern). settings.json
// lives under HOME and this proof PATCHes flags, so HOME is sandboxed too: the developer's real
// settings are never rewritten. Chrome keeps the real profile env.
home = await mkdtemp(path.join(tmpdir(), 'worca-req-home-'));
const REAL_ENV = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
process.env.WORCA_HOME = home;
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.WORCA_MOCK = '1';
delete process.env.WORCA_FLAGS;
const projDir = path.join(home, 'shop');
await mkdir(projDir, { recursive: true });
await (await import(new URL('../src/core/projects.mjs', import.meta.url).href)).addProject({ name: 'shop', path: projDir });
// The WebSocketServer is attached to the MODULE's `server` (a bare
// http.createServer(app) answers the /ws upgrade with 404 and no frame arrives).
const { server } = await import(new URL('../ui/server.mjs', import.meta.url).href);
srv = server;
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
log(`server on ${base}`);

// ---- Chrome, with the REAL home back for its caches
profile = await mkdtemp(path.join(tmpdir(), 'worca-req-profile-'));
chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--disable-gpu', '--use-mock-keychain', '--window-size=1400,1000', ...SANDBOX, 'about:blank'],
{ env: { ...process.env, ...REAL_ENV }, stdio: 'ignore' });

// Up to 30 s: a cold Chrome on a busy CI runner can take more than 10 s to open its endpoint.
let up = false;
for (let i = 0; i < 120 && !up; i += 1) {
  try { up = (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch { /* not listening yet */ }
  if (!up) await sleep(250);
}
if (!up) { log('no CDP endpoint'); await shutdown(1); }

const { WebSocket } = await import('ws');

/** One CDP session on one page target: { send, evalJs, pageErrors }. */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  sockets.push(ws);
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  let msgId = 0;
  const pending = new Map();
  const pageErrors = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      pageErrors.push(m.params.exceptionDetails?.exception?.description || 'exception');
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
  await send('Runtime.enable');
  await send('Page.enable');
  for (let t0 = Date.now(); Date.now() - t0 < 15000;) {
    if (await evalJs(`document.readyState === 'complete' && location.href !== 'about:blank'`).catch(() => false)) break;
    await sleep(100);
  }
  return { send, evalJs, pageErrors };
}

/** A new tab on `url`, through the DevTools HTTP endpoint (PUT is required since Chrome 111). */
async function openPage(url) {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!r.ok) throw new Error(`could not open a tab: HTTP ${r.status}`);
  const { webSocketDebuggerUrl } = await r.json();
  return connect(webSocketDebuggerUrl);
}

const A = await openPage(`${base}/#chat`);
const navShown = () => A.evalJs(`(() => { const b = document.querySelector('.nav button[data-nav="requirements"]'); return !!b && getComputedStyle(b).display !== 'none'; })()`);
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(100); } return false; };
const booted = await until(async () => A.evalJs('!!window.__np && !!window.__np.flags'), 15000);
check('the app booted (window.__np.flags exists)', booted);
if (!booted) await shutdown(1);
// Not vacuous: the nav row must exist in the DOM (so "hidden" is a real computed style) and the server must
// report the flag registered and off before "no row" counts; then give the hello frame a moment to land.
const navExists = () => A.evalJs(`!!document.querySelector('.nav button[data-nav="requirements"]')`);
const flagOff = () => A.evalJs(`fetch('/api/flags').then((r) => r.json()).then((d) => (d.flags || []).some((f) => f.key === 'requirements' && f.on === false))`);
check('flag off (precondition): the nav row exists in the DOM and the server reports the flag off',
  await until(async () => (await navExists()) && (await flagOff()), 8000));
await sleep(500);
check('flag off: no Requirements row', !(await navShown()));
await A.evalJs(`window.__np.flags.set('requirements', true)`);
check('flag on: the row appears without a reload', await until(navShown, 2000));
await A.evalJs(`location.hash = '#requirements/new'`);
check('the new-feature form renders', await until(() => A.evalJs(`!!document.getElementById('req-new-title')`)));
const filled = await A.evalJs(`(() => { const sel = document.getElementById('req-new-target');
  const opt = [...sel.options].find((o) => o.text === 'shop'); if (!opt) return false; sel.value = opt.value;
  document.getElementById('req-new-title').value = 'Cancel an order';
  document.getElementById('req-new-desc').value = 'Customers cancel before it ships';
  [...document.querySelectorAll('.req-new .btn-go')].at(-1).click(); return true; })()`);
check("the target select offers the 'shop' project", filled);
if (!filled) await shutdown(1);
check('round 1 asks (mock): the question card shows', await until(() => A.evalJs(`!!document.querySelector('#requirements-host .qpanel .qopt')`)));
await A.evalJs(`document.querySelector('#requirements-host .req-skip').click()`);
check('after answering, the spec has R-po-1 and the interview is done',
  await until(() => A.evalJs(`!!document.querySelector('[data-criterion="R-po-1"]') && /Interview done/.test(document.querySelector('#requirements-host .req-head').textContent)`)));
check('no page errors', A.pageErrors.length === 0, A.pageErrors.join(' | '));
log(failed ? `${failed} check(s) failed` : 'all checks passed');
await shutdown(failed ? 1 : 0);
