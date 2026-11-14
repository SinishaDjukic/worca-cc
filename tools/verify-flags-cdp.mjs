#!/usr/bin/env node
// tools/verify-flags-cdp.mjs — headless-Chrome proof of live feature flags (docs/feature-flags.md, D6):
// flip the demo flag through window.__np.flags.set in tab A and watch tab B's note appear and
// disappear through the `flags` WebSocket frame, with no reload. NOT part of `npm test`.
// Run: node tools/verify-flags-cdp.mjs   (or: npm run verify:flags)
//
// -- CI COVERAGE -------------------------------------------------------------
// .github/workflows/ci.yml job `cdp` runs this on every push and pull request.
// What stays CDP-only: two real tabs on one server, real CSS (the #flag-gates
// sheet against computed display), and the no-page-error gate. The DOM shapes
// are pinned in test/ui-flags.test.mjs.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
const CHROME = process.env.CHROME_BIN || CHROME_PATHS.find((p) => existsSync(p)) || CHROME_PATHS[0];
const SANDBOX = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0
  ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
if (!existsSync(CHROME)) { console.error(`no Chrome at ${CHROME} - set CHROME_BIN`); process.exit(1); }
const PORT = Number(process.env.CDP_PORT || 9343);
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
home = await mkdtemp(path.join(tmpdir(), 'worca-flags-home-'));
const REAL_ENV = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
process.env.WORCA_HOME = home;
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.WORCA_MOCK = '1';
delete process.env.WORCA_FLAGS;
// The WebSocketServer is attached to the MODULE's `server` (a bare
// http.createServer(app) answers the /ws upgrade with 404 and no frame arrives).
const { server } = await import(new URL('../ui/server.mjs', import.meta.url).href);
srv = server;
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
log(`server on ${base}`);

// ---- Chrome, with the REAL home back for its caches
profile = await mkdtemp(path.join(tmpdir(), 'worca-flags-profile-'));
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

const shown = (p) => p.evalJs(`(() => { const n = document.getElementById('flags-demo-note'); return !!n && getComputedStyle(n).display !== 'none'; })()`);
const until = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(50); } return false; };

// ---- --stillhet: the opt-in and opt-out walk (docs/rail/gate.md; Expert, one tab). The ask switch is read per request, so the
// walk flips WORCA_STILLHET_ASK in this process. Seeds: onboarding seen and one project.
async function stillhetWalk() {
  const { settingsFile } = await import(new URL('../src/core/settings.mjs', import.meta.url).href);
  const { mkdir, writeFile, readFile } = await import('node:fs/promises');
  await mkdir(path.dirname(settingsFile()), { recursive: true });
  await writeFile(settingsFile(), JSON.stringify({ onboarding: { welcomeSeen: true }, uiLevel: 'expert' }));
  const projDir = path.join(home, 'proj'); await mkdir(projDir, { recursive: true });
  const j = (u, o) => fetch(`${base}${u}`, o).then((r) => r.json());
  await j('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'proj', path: projDir }) });
  const snapshot = async () => JSON.stringify({ projects: (await j('/api/projects')).projects.map((x) => `${x.name} ${x.path}`), settings: Object.fromEntries(Object.entries(await j('/api/settings')).filter(([k]) => !['flags', 'onboarding'].includes(k))) });
  const before = await snapshot();
  const stored = async () => JSON.parse(await readFile(settingsFile(), 'utf8'));
  const flagRail = async () => (await j('/api/flags')).flags.find((f) => f.key === 'rail');
  const waitLoad = async (pg) => { await sleep(300); await until(() => pg.evalJs(`document.readyState === 'complete' && !!window.__np`).catch(() => false), 15000); await sleep(1500); };
  const open = async (hash) => {
    const pg = await openPage(`${base}/#${hash}`);
    await pg.send('Page.addScriptToEvaluateOnNewDocument', { source: `sessionStorage.setItem('walk.loads', String((+sessionStorage.getItem('walk.loads') || 0) + 1))` });
    await pg.send('Page.reload'); await waitLoad(pg); return pg;
  };
  const loads = (pg) => pg.evalJs(`+sessionStorage.getItem('walk.loads') || 0`);
  const strip = (pg) => pg.evalJs(`!!document.querySelector('[data-stillhet="invitation"]')`);
  const sw = (pg) => pg.evalJs(`!!document.querySelector('[data-stillhet="design-switch"]')`);
  const click = (pg, sel) => pg.evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);

  delete process.env.WORCA_STILLHET_ASK;
  let pg = await open('chat/new');
  check('hidden by default: no question, no switch, no Labs rail row', !(await strip(pg)) && !(await sw(pg)));
  pg.evalJs(`location.hash = '#settings/experimental'`); await sleep(1500);
  check('hidden by default: Labs has no rail row', !(await pg.evalJs(`!!document.getElementById('flag-row-rail')`)));

  process.env.WORCA_STILLHET_ASK = '1';
  pg = await open('chat/new');
  check('with the override the question shows once, as a strip under the top bar', (await strip(pg)) && await pg.evalJs(`document.getElementById('topnav').nextElementSibling?.id === 'rail-strip'`));
  check('the focus is on No thanks', await pg.evalJs(`document.activeElement?.matches('[data-confirm="no"]') === true`));
  check('the switch shows after Activity', await sw(pg));
  await pg.evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(500);
  check('Esc takes it back and stores nothing', !(await strip(pg)) && (await stored()).onboarding?.stillhetAsked !== true);
  await pg.send('Page.reload'); await waitLoad(pg);
  check('Esc asks again after a reload', await strip(pg));
  await click(pg, '[data-stillhet="invitation"] [data-confirm="no"]'); await sleep(1000);
  check('No thanks closes it and stores the answer', !(await strip(pg)) && (await stored()).onboarding?.stillhetAsked === true);
  await pg.send('Page.reload'); await waitLoad(pg);
  check('No thanks is never asked again', !(await strip(pg)));
  await j('/api/onboarding', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stillhetAsked: false }) });
  await pg.send('Page.reload'); await waitLoad(pg);
  const n0 = await loads(pg);
  await click(pg, '[data-stillhet="invitation"] [data-confirm="yes"]');
  await until(async () => (await loads(pg)) > n0, 8000); await waitLoad(pg);
  check('Try Stillhet turns rail on with exactly 1 navigation', (await flagRail()).on === true && (await loads(pg)) === n0 + 1, `loads ${n0} → ${await loads(pg)}`);
  check('turning it on stored the flag and the answer', (await stored()).flags?.rail === true && (await stored()).onboarding?.stillhetAsked === true);
  const n1 = await loads(pg);
  await click(pg, '[data-design-switch]');
  await until(async () => (await loads(pg)) > n1, 8000); await waitLoad(pg);
  check('the switch turns it off with exactly 1 navigation, changing only flags.rail', (await flagRail()).on === false && (await loads(pg)) === n1 + 1 && (await stored()).flags?.rail === undefined);
  const n2 = await loads(pg);
  await pg.evalJs(`location.hash = '#settings/experimental'`); await sleep(1500);
  await click(pg, '[data-flag-switch="rail"]');
  await until(async () => (await loads(pg)) > n2, 8000); await waitLoad(pg);
  check('Labs turns it on with exactly 1 navigation', (await flagRail()).on === true && (await loads(pg)) === n2 + 1, `loads ${n2} → ${await loads(pg)}`);
  const n3 = await loads(pg);
  await click(pg, '[data-flag-switch="rail"]');
  await until(async () => (await loads(pg)) > n3, 8000); await waitLoad(pg);
  check('Labs turns it off with exactly 1 navigation', (await flagRail()).on === false && (await loads(pg)) === n3 + 1);
  pg.evalJs(`location.hash = '#chat/new'`); await sleep(1500);
  const n4 = await loads(pg);
  await pg.evalJs(`(() => { const t = document.querySelector('textarea'); if (t) { t.value = 'draft that must survive'; t.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
  await click(pg, '[data-design-switch]'); await sleep(2500);
  check('typed text: the switch change gives 0 navigations and a Toast', (await loads(pg)) === n4 && await pg.evalJs(`!![...document.querySelectorAll('.toast')].find((t) => /Stillhet is (on|off)/.test(t.textContent))`));
  await pg.evalJs(`(() => { const t = document.querySelector('textarea'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await until(async () => (await loads(pg)) > n4, 8000);
  check('the reload follows once the text is gone', (await loads(pg)) === n4 + 1);
  await j('/api/flags', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rail: false }) });
  const after = await snapshot();
  check('projects and every other setting are identical before and after', before === after, before === after ? '' : (() => { const a = JSON.parse(before), b = JSON.parse(after); const keys = [...new Set([...Object.keys(a.settings), ...Object.keys(b.settings)])].filter((k) => JSON.stringify(a.settings[k]) !== JSON.stringify(b.settings[k])); return `changed: ${keys.join(', ') || 'projects'}`; })());
  check('no page errors', pg.pageErrors.length === 0, pg.pageErrors.join(' | '));
  log(failed ? `${failed} check(s) failed` : 'all checks passed');
  await shutdown(failed ? 1 : 0);
}
if (process.argv.includes('--stillhet')) await stillhetWalk();

const A = await openPage(`${base}/#settings/experimental`);
const B = await openPage(`${base}/#settings/experimental`);
// Both tabs booted and their sockets said hello (the flags frame only reaches an open socket).
await until(async () => (await A.evalJs('!!window.__np && !!window.__np.flags')) && (await B.evalJs('!!window.__np && !!window.__np.flags')), 15000);
await sleep(500);
check('first paint: the note is hidden in both tabs (flag off, no flash)', !(await shown(A)) && !(await shown(B)));
await A.evalJs(`window.__np.flags.set('flagsDemo', true)`);
check('on in tab A shows the note in tab B within a second, no reload', await until(() => shown(B), 1000));
check('tab B\'s chip links to the row', await B.evalJs(`document.querySelector('#flags-demo-note a.flag-chip')?.getAttribute('href') === '#settings/experimental/flagsDemo'`));
await A.evalJs(`window.__np.flags.set('flagsDemo', false)`);
check('off in tab A hides it again in tab B', await until(async () => !(await shown(B)), 1000));
check('no page errors', A.pageErrors.length + B.pageErrors.length === 0, [...A.pageErrors, ...B.pageErrors].join(' | '));
log(failed ? `${failed} check(s) failed` : 'all checks passed');
await shutdown(failed ? 1 : 0);
