#!/usr/bin/env node
// tools/verify-requirements-cdp.mjs — headless-Chrome proof of the Requirements page (plans/requirements-design.md §6).
// Checks: with the `requirements` flag off there is no nav row; flipping it on shows the row without a reload;
// the new-feature form renders; creating a feature in mock mode shows round 1's question card; answering it
// (Skip, use recommended) fills the spec with R-po-1, finishes the interview (the header's "Interview done ·
// N rounds" chip and its Decide / Ready badge); the answered rounds stay on the page in the Earlier rounds card
// with their answer and a Change; the Ready panel shows the server's six checks with Start enabled exactly when
// the feature is Ready; the Export menu opens and Escape closes it; the Decide card, the start-before-Ready
// dialog (focus on the reason, Escape returns it; its button is disabled until a reason is typed), Confirm the N
// left leading to the Ready to build card; Start in Worca on that card gives one run row linking to #running/<id>
// and the API's starts[0].runId (the mock run is then stopped); the feature page has no context panel and its
// menu's Your notes for Worca opens the project's brief page with the notes (A7 D12); the product brief flow
// (Create, the code moved on, New feature knows the brief, Look closer, Add this to the brief); no page errors.
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
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
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
  try { (await import(new URL('../src/core/db.mjs', import.meta.url).href))._resetForTests(); } catch {}
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
// A start needs a git repository with one commit (the run's worktree base).
const git = (...a) => execFileSync('git', a, { cwd: projDir, stdio: 'ignore' });
git('init'); git('config', 'user.name', 'proof'); git('config', 'user.email', 'proof@example.invalid');
git('commit', '--allow-empty', '-m', 'init');
await (await import(new URL('../src/core/projects.mjs', import.meta.url).href)).addProject({ name: 'shop', path: projDir });
// The WebSocketServer is attached to the MODULE's `server` (a bare
// http.createServer(app) answers the /ws upgrade with 404 and no frame arrives).
const { server, runs } = await import(new URL('../ui/server.mjs', import.meta.url).href);
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
check('the New feature page names the interview model ("Worca interviews with …")',
  await until(() => A.evalJs(`(document.querySelector('.req-new .req-new-cost')?.textContent || '').startsWith('Worca interviews with')`), 4000));
const filled = await A.evalJs(`(() => { const sel = document.getElementById('req-new-target');
  const opt = [...sel.options].find((o) => o.text === 'shop'); if (!opt) return false; sel.value = opt.value;
  document.getElementById('req-new-title').value = 'Cancel an order';
  document.getElementById('req-new-desc').value = 'Customers cancel before it ships';
  [...document.querySelectorAll('.req-new .btn-go')].at(-1).click(); return true; })()`);
check("the target select offers the 'shop' project", filled);
if (!filled) await shutdown(1);
check('round 1 asks (mock): the question card shows', await until(() => A.evalJs(`!!document.querySelector('#requirements-host .qpanel .qopt')`)));
await A.evalJs(`document.querySelector('#requirements-host .req-skip').click()`);
check('after answering, the spec has R-po-1 and the header says the interview is done',
  await until(() => A.evalJs(`(() => { const head = document.querySelector('#requirements-host .req-head');
    return !!document.querySelector('[data-criterion="R-po-1"]') && !!head
      && [...head.querySelectorAll('.chip')].some((c) => /^Interview done · \\d+ rounds?$/.test(c.textContent))
      && ['Decide', 'Ready'].includes(head.querySelector('.badge')?.textContent); })()`)));
check('the answered rounds stay on the page in Earlier rounds, with the answer given and a Change',
  await A.evalJs(`(() => { const r = [...document.querySelectorAll('#requirements-host .req-rounds .req-round')];
    return r.length === 2 && /→ Customers/.test(r[0].querySelector('.req-round-answer').textContent)
      && [...r[0].querySelectorAll('button')].some((b) => b.textContent === 'Change'); })()`));
check("the Ready panel shows the server's six checks; Start is enabled exactly when the feature is Ready",
  await A.evalJs(`(async () => { const seq = /feature\\/(\\d+)/.exec(location.hash)[1];
    const f = (await (await fetch('/api/requirements/' + seq)).json()).feature;
    const p = document.querySelector('#requirements-host .req-ready');
    if (!p) return false;
    const labels = [...p.querySelectorAll('.req-check-label')].map((x) => x.textContent);
    return labels.length === 6 && labels.join('|') === f.readiness.checks.map((c) => c.label).join('|')
      && (f.state === 'ready' ? !p.querySelector('[data-ui="start"]') && !!document.querySelector('#requirements-host .req-build [data-ui="start-go"]')
        : p.querySelector('[data-ui="start"]').disabled === !f.readiness.ok)
      && p.querySelector('code').textContent === f.readiness.passed + ' of 6'; })()`));
check('the Export menu opens on its button and Escape closes it',
  await A.evalJs(`(() => { const t = [...document.querySelectorAll('#requirements-host .req-head button')].find((b) => b.textContent === 'Export ▾');
    const m = t.parentElement.querySelector('[role="menu"]');
    t.click(); const opened = !m.hidden && getComputedStyle(m).display !== 'none';
    m.querySelector('[role="menuitem"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return opened && m.hidden && getComputedStyle(m).display === 'none' && document.activeElement === t; })()`));
// Task 8: the mock leaves an assumption open, so the feature is in Decide: the Decide card, the start-before-Ready
// dialog (real focus handling), then Confirm the N left turns it Ready and the Ready to build card shows.
check('Decide: the card lists the open assumptions, each with a Confirm / Reject group',
  await until(() => A.evalJs(`(() => { const c = document.querySelector('#requirements-host .req-left .req-decide');
    return !!c && c.querySelectorAll('[data-decide] [role="group"] button[aria-pressed]').length >= 2
      && !!c.querySelector('[data-ui="confirm-all"]'); })()`)));
check("Start before it's Ready… opens the dialog on the reason; Escape closes it and the focus goes back",
  await A.evalJs(`(async () => { const b = document.querySelector('#requirements-host [data-ui="start-anyway"]');
    if (!b) return false; b.focus(); b.click();
    const d = document.querySelector('.req-dialog[role="dialog"]');
    if (!d || d.getAttribute('aria-modal') !== 'true' || document.activeElement !== d.querySelector('textarea')) return false;
    if (getComputedStyle(d.closest('.viewer-modal')).position !== 'fixed') return false;
    d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return !document.querySelector('.req-dialog') && document.activeElement === document.querySelector('#requirements-host [data-ui="start-anyway"]'); })()`));
check('the dialog Start button is disabled while the reason is empty and enabled once text is typed',
  await A.evalJs(`(() => { document.querySelector('#requirements-host [data-ui="start-anyway"]').click();
    const d = document.querySelector('.req-dialog'); if (!d) return false;
    const go = d.querySelector('.btn-primary'); const ta = d.querySelector('textarea');
    const empty = go.disabled === true;
    ta.value = 'Needed now'; ta.dispatchEvent(new Event('input', { bubbles: true }));
    const typed = go.disabled === false;
    d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return empty && typed && !document.querySelector('.req-dialog'); })()`));
await A.evalJs(`document.querySelector('#requirements-host [data-ui="confirm-all"]').click()`);
check('Confirm the N left: the feature is Ready and the Ready to build card offers Start in Worca',
  await until(() => A.evalJs(`(() => { const c = document.querySelector('#requirements-host .req-left .req-build');
    return !!c && document.querySelector('#requirements-host .req-head .badge')?.textContent === 'Ready'
      && !c.querySelector('[data-ui="start-go"]').disabled; })()`)));
const seqNo = await A.evalJs(`location.hash.split('/').pop()`);
await A.evalJs(`document.querySelector('#requirements-host .req-build [data-ui="start-go"]').click()`);
check('Start in Worca: one run row links to #running/<id> and the API has starts[0].runId',
  await until(() => A.evalJs(`(async () => { const rows = [...document.querySelectorAll('#requirements-host .req-runs a.req-run-row')];
    if (rows.length !== 1 || !rows[0].getAttribute('href').startsWith('#running/')) return false;
    const f = (await (await fetch('/api/requirements/${seqNo}')).json()).feature;
    return !!f.starts?.[0]?.runId && rows[0].getAttribute('href') === '#running/' + f.starts[0].runId; })()`), 15000));
// A7 D12: the notes panel left the feature page; the menu's Your notes for Worca opens the brief page.
check('the feature page has no context panel; Your notes for Worca (the menu) opens the brief page with the notes',
  await A.evalJs(`(() => { if (document.querySelector('#requirements-host .req-context')) return false;
    document.querySelector('#requirements-host [data-ui="menu-more"]').click();
    const item = document.querySelector('#requirements-host [data-ui="mi-notes"]');
    if (!item || item.textContent !== 'Your notes for Worca') return false;
    item.click(); return true; })()`)
  && await until(() => A.evalJs(`location.hash.startsWith('#requirements/brief/project/')
    && !!document.querySelector('#requirements-host [data-req-brief] [data-ui="notes-body"]')`)));
// ---- A7: the product brief, end to end in mock mode (no model; the brief is canned).
const briefHash = await A.evalJs(`location.hash.startsWith('#requirements/brief/project/') ? location.hash : null`);
await A.evalJs(`location.hash = '#requirements'`);
check('the list header says "Product brief: none yet · Create" for the project',
  await until(() => A.evalJs(`(() => { const g = [...document.querySelectorAll('#requirements-host .req-group')].find((x) => x.querySelector('h2')?.textContent === 'Project · shop');
    const h = g?.querySelector('.req-group-brief'); return !!h && h.textContent === 'Product brief: none yet · Create' && !!h.querySelector('a'); })()`)));
await A.evalJs(`document.querySelector('#requirements-host .req-group-brief a').click()`);
check('the brief page (none yet) shows Give Worca a head start and Create the brief',
  await until(() => A.evalJs(`(() => { const c = document.querySelector('#requirements-host .req-brief-start');
    return location.hash.startsWith('#requirements/brief/project/') && !!c
      && c.querySelector('h3')?.textContent === 'Give Worca a head start'
      && c.querySelector('[data-ui="brief-create"]')?.textContent === 'Create the brief'; })()`)));
await A.evalJs(`document.querySelector('#requirements-host [data-ui="brief-create"]').click()`);
check('Create in mock mode: the made brief page shows its four sections and "Made from"',
  await until(() => A.evalJs(`(() => { const h = document.querySelector('#requirements-host');
    const keys = [...h.querySelectorAll('.req-brief-card [data-section]')].map((x) => x.getAttribute('data-section'));
    return keys.length === 4 && /Made from/.test(h.textContent); })()`), 15000));
// A commit to the test repo: the brief page then says the code moved on. The server remembers a repository
// check for MEMO_MS (brief-job.mjs), so wait that out, then reopen the page so it is read again.
const { MEMO_MS } = await import(new URL('../src/core/requirements/brief-job.mjs', import.meta.url).href);
await sleep(MEMO_MS + 1000);
writeFileSync(path.join(projDir, 'README.md'), 'orders\n');
git('add', 'README.md'); git('commit', '-m', 'moved on');
await A.evalJs(`location.hash = '#requirements'`);
await sleep(300);
await A.evalJs(`location.hash = ${JSON.stringify(briefHash)}`);
check('after a commit: "The code moved on since this brief" shows with a Refresh',
  await until(() => A.evalJs(`(() => { const n = document.querySelector('#requirements-host .req-brief-stale');
    return !!n && /The code moved on since this brief/.test(n.textContent) && !!n.querySelector('[data-brief-go]'); })()`), 15000));
await A.evalJs(`location.hash = '#requirements/new'`);
const picked = await until(() => A.evalJs(`(() => { const sel = document.getElementById('req-new-target'); if (!sel) return false;
  const opt = [...sel.options].find((o) => o.text === 'shop'); if (!opt) return false; sel.value = opt.value;
  sel.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`));
check('New feature for that project shows "Worca knows shop from its product brief" and cents per round',
  picked && await until(() => A.evalJs(`(() => { const l = document.querySelector('.req-new .req-brief-line');
    return !!l && /^Worca knows shop from its product brief/.test(l.textContent)
      && /cents per round/.test(document.querySelector('.req-new .req-new-cost')?.textContent || ''); })()`)));
await A.evalJs(`(() => { document.getElementById('req-new-title').value = 'Orders report';
  document.getElementById('req-new-desc').value = 'A report of orders per day';
  [...document.querySelectorAll('.req-new .btn-go')].at(-1).click(); })()`);
check('a feature created there shows "What Worca knows" with Look closer',
  await until(() => A.evalJs(`(() => { const c = document.querySelector('#requirements-host .req-knows');
    return !!c && c.querySelector('h3')?.textContent === 'What Worca knows' && !!c.querySelector('[data-ui="look-closer"]'); })()`), 15000));
await A.evalJs(`document.querySelector('#requirements-host [data-ui="look-closer"]').click()`);
check('Look closer (mock) shows the look with Add this to the brief',
  await until(() => A.evalJs(`!!document.querySelector('#requirements-host .req-knows [data-ui="brief-add"]')`), 15000));
await A.evalJs(`document.querySelector('#requirements-host [data-ui="brief-add"]').click()`);
await until(() => A.evalJs(`!document.querySelector('#requirements-host [data-ui="brief-add"]')`));
await A.evalJs(`location.hash = ${JSON.stringify(briefHash)}`);
check('Add this to the brief: the brief page lists the added area and "Used by 1 feature"',
  await until(() => A.evalJs(`(() => { const t = document.querySelector('#requirements-host').textContent;
    return /Orders: Orders report/.test(t) && /Orders · checkout and order history/.test(t) && /Used by 1 feature/.test(t); })()`), 15000));
// ---- The header menus have their panel (upstream's .menu box), and at phone width (390 px) every page fits and
// every menu opens inside the screen.
const featureHash = `#requirements/feature/${seqNo}`;
const MENUS = { [featureHash]: ['menu-export', 'menu-more'], [briefHash]: ['brief-export', 'brief-more'] };
/** Open one header menu, measure its list (inside [0, clientWidth], a background that is not transparent), close it. */
const menuBox = (ui) => A.evalJs(`(() => { const t = document.querySelector('#requirements-host [data-ui="${ui}"]'); if (!t) return null;
  t.click(); const m = t.parentElement.querySelector('[role="menu"]'); if (!m || m.hidden) return null;
  const r = m.getBoundingClientRect(); const bg = getComputedStyle(m).backgroundColor; const w = document.documentElement.clientWidth;
  t.click(); return { left: Math.round(r.left), right: Math.round(r.right), w, bg }; })()`);
const menuOk = (b) => !!b && b.left >= 0 && b.right <= b.w && b.bg !== 'rgba(0, 0, 0, 0)' && b.bg !== 'transparent';
const goTo = async (hash, ready) => { await A.evalJs(`location.hash = ${JSON.stringify(hash)}`); return until(() => A.evalJs(ready)); };
const READY = { [featureHash]: `!!document.querySelector('#requirements-host [data-ui="menu-more"]')`,
  [briefHash]: `!!document.querySelector('#requirements-host [data-ui="brief-more"]')`,
  '#requirements': `!!document.querySelector('#requirements-host .req-row')`, '#requirements/new': `!!document.getElementById('req-new-title')` };
await goTo(featureHash, READY[featureHash]);
const wide = await menuBox('menu-export');
check('desktop: the Export menu has its panel (a background, not transparent)', menuOk(wide), JSON.stringify(wide));
await A.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
for (const hash of ['#requirements', '#requirements/new', featureHash, briefHash]) {
  const shown = await goTo(hash, READY[hash]);
  await sleep(200);
  const fit = await A.evalJs(`document.documentElement.scrollWidth === document.documentElement.clientWidth`);
  check(`390 px: ${hash.replace(/\/\d+$/, '/<n>').replace(/brief\/.*/, 'brief/<project>')} fits the screen (no sideways scroll)`, shown && fit);
  for (const ui of MENUS[hash] || []) {
    const b = await menuBox(ui);
    check(`390 px: ${ui} opens inside the screen with its panel`, menuOk(b), JSON.stringify(b));
  }
}
await A.send('Emulation.clearDeviceMetricsOverride');
// The mock Auto run parks on its workflow question: stop it so the server closes and the temp dir can go.
for (const r of runs.values()) { try { r.orch?.stop?.(); } catch {} }
const settled = new Set(['done', 'stopped', 'error', 'paused', 'interrupted']);
await until(async () => [...runs.values()].every((r) => settled.has(String(r.status || ''))), 30000);
await sleep(1000);
check('no page errors', A.pageErrors.length === 0, A.pageErrors.join(' | '));
log(failed ? `${failed} check(s) failed` : 'all checks passed');
await shutdown(failed ? 1 : 0);
