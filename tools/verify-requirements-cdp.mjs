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
// (Create, the code moved on, New feature knows the brief, Look closer, Add this to the brief); files (New feature with
// two files, Reading 2 files…, the Files card, an edit, the ⋯ menu, Ask (Asking…) and Replace, a source tag, a file
// added after the interview offered as Decide's Ask about <file>, Remove, the Ready row's chips, Start sends the files,
// the brief's Documents card; at 390 px the Files card fits, its ⋯ menu holds the pencil's entry, 44 px targets);
// Ask Worca (A3: the toggle and the right column, Help me answer, a draft in the question card, Accept, a stale card
// and Ask again, Answering… and Stop, the dark theme, the 390 px sheet with Back keeping the draft, Clear chat, Submit
// sending the draft); no page errors.
// NOT part of `npm test`. REQ_SHOTS=<dir> also writes the Ask Worca screens there (a3-*.png) for a human look.
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
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
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
const SHOTS = process.env.REQ_SHOTS || '';
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
// A8: a mock read waits READ_MS, so "Reading N files…" can be seen; a step that checks a state while it lasts holds the
// reads for HOLD_MS instead, and a wait for a held read to end allows AFTER_HOLD_MS.
const READ_MS = 1500;
const HOLD_MS = 6000;
const AFTER_HOLD_MS = HOLD_MS + 14_000;
process.env.WORCA_MOCK_READ_MS = String(READ_MS);
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
// The brief page's GET waits for its git probes up to STALENESS_TIMEOUT_MS (they then read as "slow", not as an
// answer), and a Create press up to BRIEF_PRESS_PROBE_MS: a wait for a brief page is longer than the server's own bound,
// so a busy machine (the mock run just started a worktree) is not a failed check.
const { MEMO_MS, STALENESS_TIMEOUT_MS, BRIEF_PRESS_PROBE_MS } = await import(new URL('../src/core/requirements/brief-job.mjs', import.meta.url).href);
const BRIEF_WAIT_MS = STALENESS_TIMEOUT_MS + 10_000;
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
  [...document.querySelectorAll('.req-new .btn-primary')].at(-1).click(); return true; })()`);
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
  await A.evalJs(`(() => { const t = [...document.querySelectorAll('#requirements-host .req-head button')].find((b) => b.textContent === 'Export');
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
    && !!document.querySelector('#requirements-host [data-req-brief] [data-ui="notes-body"]')`), BRIEF_WAIT_MS));
// ---- A7: the product brief, end to end in mock mode (no model; the brief is canned).
const briefHash = await A.evalJs(`location.hash.startsWith('#requirements/brief/project/') ? location.hash : null`);
await A.evalJs(`location.hash = '#requirements'`);
check('the list header says "Product brief: none yet · Create" for the project',
  await until(() => A.evalJs(`(() => { const g = [...document.querySelectorAll('#requirements-host .req-group')].find((x) => x.querySelector('h2')?.textContent === 'Project · shop');
    const h = g?.querySelector('.req-group-brief'); return !!h && h.textContent === 'Product brief: none yet · Create' && !!h.querySelector('a'); })()`)));
await A.evalJs(`document.querySelector('#requirements-host .req-group-brief a').click()`);
// The card paints once the page's GET answers, which waits for git (BRIEF_WAIT_MS above): on a loaded machine the
// default 8 s wait ran out before the server's own 10 s probe did (seen on a loaded machine).
check('the brief page (none yet) shows Give Worca a head start and Create the brief',
  await until(() => A.evalJs(`(() => { const c = document.querySelector('#requirements-host .req-brief-start');
    return location.hash.startsWith('#requirements/brief/project/') && !!c
      && c.querySelector('h3')?.textContent === 'Give Worca a head start'
      && c.querySelector('[data-ui="brief-create"]')?.textContent === 'Create the brief'; })()`), BRIEF_WAIT_MS));
await A.evalJs(`document.querySelector('#requirements-host [data-ui="brief-create"]').click()`);
check('Create in mock mode: the made brief page shows its four sections and "Made from"',
  await until(() => A.evalJs(`(() => { const h = document.querySelector('#requirements-host');
    const keys = [...h.querySelectorAll('.req-brief-card [data-section]')].map((x) => x.getAttribute('data-section'));
    return keys.length === 4 && /Made from/.test(h.textContent); })()`), BRIEF_PRESS_PROBE_MS + 10_000));
// A commit to the test repo: the brief page then says the code moved on. The server remembers a repository
// check for MEMO_MS (brief-job.mjs), so wait that out, then reopen the page so it is read again.
await sleep(MEMO_MS + 1000);
writeFileSync(path.join(projDir, 'README.md'), 'orders\n');
git('add', 'README.md'); git('commit', '-m', 'moved on');
await A.evalJs(`location.hash = '#requirements'`);
await sleep(300);
await A.evalJs(`location.hash = ${JSON.stringify(briefHash)}`);
check('after a commit: "The code moved on since this brief" shows with a Refresh',
  await until(() => A.evalJs(`(() => { const n = document.querySelector('#requirements-host .req-brief-stale');
    return !!n && /The code moved on since this brief/.test(n.textContent) && !!n.querySelector('[data-brief-go]'); })()`), BRIEF_WAIT_MS));
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
  [...document.querySelectorAll('.req-new .btn-primary')].at(-1).click(); })()`);
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
    return /Orders: Orders report/.test(t) && /Orders · checkout and order history/.test(t) && /Used by 1 feature/.test(t); })()`), BRIEF_WAIT_MS));
// ---- A8: files, end to end in mock mode (each mock read waits WORCA_MOCK_READ_MS). The server runs in this process
// and reads the variable at each read, so a step that must see a state (Reading…, Asking…) holds it for HOLD_MS: well
// past a normal paint. A page slower than that fails the check; it never passes without having seen the state.
const holdReads = (on) => { process.env.WORCA_MOCK_READ_MS = String(on ? HOLD_MS : READ_MS); };
const dropFiles = (sel, files) => A.evalJs(`(() => { const dt = new DataTransfer();
  for (const [n, body, type] of ${JSON.stringify(files)}) dt.items.add(new File([body], n, { type }));
  document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); return true; })()`);
const pickFiles = (sel, files) => A.evalJs(`(() => { const dt = new DataTransfer();
  for (const [n, body, type] of ${JSON.stringify(files)}) dt.items.add(new File([body], n, { type }));
  const i = document.querySelector(${JSON.stringify(sel)}); i.files = dt.files; i.dispatchEvent(new Event('change')); return true; })()`);
const featureApi = (seq) => A.evalJs(`fetch('/api/requirements/${seq}').then((r) => r.json()).then((d) => d.feature)`);
await A.evalJs(`location.hash = '#requirements/new'`);
await until(() => A.evalJs(`!!document.querySelector('.req-new-files .req-drop')`));
await A.evalJs(`(() => { const sel = document.getElementById('req-new-target'); sel.value = [...sel.options].find((o) => o.text === 'shop').value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('req-new-title').value = 'Refund to store credit';
  document.getElementById('req-new-desc').value = 'Customers ask for store credit instead of a card refund'; })()`);
await dropFiles('.req-new-files .req-drop', [['refund-policy.md', '# Refund policy\nRefunds in 14 days.\n', 'text/markdown'], ['tickets.pdf', '%PDF-1.7\n%mock\n', 'application/pdf']]);
check('New feature with two files: two chips and the privacy note naming the model',
  await until(() => A.evalJs(`document.querySelectorAll('.req-new-chip').length === 2
    && /^Worca sends each file to .+ to read it\\./.test(document.querySelector('.req-new-files .req-files-privacy')?.textContent || '')`)));
holdReads(true);
await A.evalJs(`[...document.querySelectorAll('.req-new .btn-primary')].at(-1).click()`);
check('the feature page says "Reading 2 files…" and the Files card shows each file as Reading…',
  await until(() => A.evalJs(`(() => { const rows = [...document.querySelectorAll('#requirements-host .req-files .req-file')];
    return /Reading 2 files…/.test(document.querySelector('#requirements-host .req-reading')?.textContent || '')
      && rows.length === 2 && rows.every((r) => r.querySelector('.badge.blue')?.textContent === 'Reading…'
        && /^Worca is reading it/.test(r.querySelector('.req-file-state')?.textContent || '')); })()`), HOLD_MS));
holdReads(false);
check('then round 1 shows', await until(() => A.evalJs(`!!document.querySelector('#requirements-host .qpanel .qopt')`), AFTER_HOLD_MS));
const filesSeq = await A.evalJs(`location.hash.split('/').pop()`);
const filesHash = `#requirements/feature/${filesSeq}`;
const fileIds = await A.evalJs(`[...document.querySelectorAll('#requirements-host .req-files .req-file')].map((r) => r.getAttribute('data-file'))`);
check('the Files card lists both files, read, each with What Worca took from it',
  await until(() => A.evalJs(`(() => { const rows = [...document.querySelectorAll('#requirements-host .req-files .req-file')];
    return rows.length === 2 && rows.every((r) => /What Worca took from it/.test(r.textContent) && !r.querySelector('.badge.blue')); })()`)));
check('a source tag: the spec card names the first file',
  await until(() => A.evalJs(`[...document.querySelectorAll('#requirements-host .req-spec .req-src-tag')].some((t) => t.textContent.endsWith('refund-policy.md'))`)));
const [firstId, secondId] = fileIds;
await A.evalJs(`document.querySelector('[data-ui="file-edit-${firstId}"]').click()`);
await until(() => A.evalJs(`!!document.querySelector('[data-ui="file-edit-text-${firstId}"]')`));
await A.evalJs(`(() => { const ta = document.querySelector('[data-ui="file-edit-text-${firstId}"]'); ta.value = 'Refunds in 14 days; store credit on request.';
  ta.dispatchEvent(new Event('input')); document.querySelector('[data-ui="file-save-${firstId}"]').click(); })()`);
check('a summary edit shows "· edited by you"',
  await until(() => A.evalJs(`/edited by you/.test(document.querySelector('[data-file="${firstId}"] .req-file-cap')?.textContent || '')`)));
check("a read file's ⋯ menu: Open, Edit what Worca took from it, Ask about this file…, Replace with a newer version…, Read again, Remove",
  await A.evalJs(`(() => { document.querySelector('[data-ui="file-more-${firstId}"]').click();
    const m = document.querySelector('[data-menu="file-${firstId}"] [role="menu"]');
    const items = m && !m.hidden ? [...m.querySelectorAll('[role="menuitem"]')].map((x) => x.textContent) : [];
    document.querySelector('[data-ui="file-more-${firstId}"]').click();
    return items.join('|') === 'Open|Edit what Worca took from it|Ask about this file…|Replace with a newer version…|Read again|Remove'; })()`));
await A.evalJs(`document.querySelector('[data-ui="file-more-${firstId}"]').click(); document.querySelector('[data-ui="fmi-ask-${firstId}"]').click()`);
await until(() => A.evalJs(`!!document.querySelector('[data-ui="file-ask-text-${firstId}"]')`));
holdReads(true);
await A.evalJs(`(() => { const i = document.querySelector('[data-ui="file-ask-text-${firstId}"]'); i.value = 'What about store credit?';
  i.dispatchEvent(new Event('input')); document.querySelector('[data-ui="file-ask-go-${firstId}"]').click(); })()`);
check('while Worca answers, the file says Asking… and what it is looking for',
  await until(() => A.evalJs(`(() => { const r = document.querySelector('[data-file="${firstId}"]');
    return [...r.querySelectorAll('.badge.blue')].some((b) => b.textContent === 'Asking…')
      && r.querySelector('.req-file-asking')?.textContent === 'Worca is looking for: “What about store credit?”…'; })()`), HOLD_MS));
holdReads(false);
check('Ask about this file: "Added to what Worca took from it · Q: …"',
  await until(() => A.evalJs(`/Added to what Worca took from it · Q: What about store credit\\?/.test(document.querySelector('#requirements-host').textContent)`), AFTER_HOLD_MS));
await pickFiles(`[data-menu="file-${secondId}"] input[type="file"]`, [['tickets-v2.pdf', '%PDF-1.7\n%v2\n', 'application/pdf']]);
check('Replace opens its dialog for the file',
  await until(() => A.evalJs(`document.querySelector('.req-dialog h2')?.textContent === 'Replace tickets.pdf'`)));
await A.evalJs(`document.querySelector('[data-ui="replace-go"]').click()`);
check('after Replace the file is read again under its new name',
  await until(() => A.evalJs(`[...document.querySelectorAll('#requirements-host .req-file-name')].some((a) => a.textContent === 'tickets-v2.pdf')
    && !document.querySelector('#requirements-host .req-files .badge.blue')`), 10000));
await A.evalJs(`document.querySelector('#requirements-host .req-skip').click()`);
await until(() => A.evalJs(`!!document.querySelector('#requirements-host [data-ui="confirm-all"], #requirements-host .req-build')`), 15000);
// A file added after the interview finished is asked about in one follow-up round. Worca starts it itself when the read
// ends, unless it cannot (here: the feature is archived while the file is read); restored, Decide offers Ask about <file>.
holdReads(true);
const faqId = await A.evalJs(`(async () => {
  const up = await fetch('/api/requirements/${filesSeq}/attachments', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attachments: [{ name: 'faq.txt', dataBase64: btoa('Store credit never expires.\\n') }] }) });
  const f = (await up.json()).feature;
  await fetch('/api/requirements/${filesSeq}/archive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  return up.status === 202 && f ? (f.attachments.find((a) => a.name === 'faq.txt') || {}).id || null : null; })()`);
holdReads(false);
const faqRead = await until(async () => ((await featureApi(filesSeq)).attachments || []).some((a) => a.id === faqId && a.status === 'done'), AFTER_HOLD_MS);
await A.evalJs(`fetch('/api/requirements/${filesSeq}/archive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restore: true }) })`);
check('a file added after the interview, which Worca could not ask about itself: Decide offers "Ask about faq.txt"',
  !!faqId && faqRead && await until(() => A.evalJs(`document.querySelector('#requirements-host .req-decide [data-ui="follow-up"]')?.textContent === 'Ask about faq.txt'`), 10000));
await A.evalJs(`document.querySelector('#requirements-host .req-decide [data-ui="follow-up"]')?.click()`);
check('Ask about faq.txt runs the follow-up round: nothing is left to ask about',
  await until(async () => { const f = await featureApi(filesSeq); return (f.unaskedFiles || []).length === 0 && ['done', 'your_turn'].includes(f.status); }, 15000));
if (await until(() => A.evalJs(`!!document.querySelector('#requirements-host .qpanel .qopt')`), 2000)) await A.evalJs(`document.querySelector('#requirements-host .req-skip').click()`);
await until(() => A.evalJs(`!!document.querySelector('#requirements-host [data-ui="confirm-all"], #requirements-host .req-build')`), 15000);
// Remove (the ⋯ menu's last entry) asks first: the proof answers yes.
await A.evalJs(`(() => { window.__confirm = window.confirm; window.confirm = () => true;
  document.querySelector('[data-ui="file-more-${faqId}"]').click(); document.querySelector('[data-ui="fmi-remove-${faqId}"]').click(); })()`);
check('Remove deletes the file: the card and the API list the two others',
  await until(async () => (await A.evalJs(`!document.querySelector('[data-file="${faqId}"]') && document.querySelectorAll('#requirements-host .req-files .req-file').length === 2`))
    && ((await featureApi(filesSeq)).attachments || []).length === 2));
await A.evalJs(`window.confirm = window.__confirm`);
await A.evalJs(`document.querySelector('#requirements-host [data-ui="confirm-all"]')?.click()`);
check('Ready to build shows Files for the run', await until(() => A.evalJs(`!!document.querySelector('#requirements-host .req-build .req-build-files')`), 15000));
await A.evalJs(`document.querySelector('[data-ui="fpick-${firstId}"]').click()`);
check('a chip flips the file\'s switch (aria-pressed and the API agree)',
  await until(() => A.evalJs(`(async () => document.querySelector('[data-ui="fpick-${firstId}"]')?.getAttribute('aria-pressed') === 'true'
    && (await (await fetch('/api/requirements/${filesSeq}')).json()).feature.attachments.find((a) => a.id === '${firstId}').sendWithRun === true)()`)));
await A.evalJs(`document.querySelector('#requirements-host .req-build [data-ui="start-go"]').click()`);
const filesRunId = await (async () => { let id = null; await until(async () => { id = (await featureApi(filesSeq)).starts?.[0]?.runId || null; return !!id; }, 15000); return id; })();
// The start stages the files in the OS temp dir (orchestrator-extras-<runId>); the run's pipeline copies them into its own
// extras folder, and the staged folder is removed then.
const pipelineExtras = () => { const dir = filesRunId && runs.get(filesRunId)?.orch?.pipeline?.dir; return dir ? path.join(dir, 'extras') : null; };
const extrasNow = () => { const x = pipelineExtras(); try { return x ? readdirSync(x).sort() : []; } catch { return []; } };
check('Start sends the switched-on file: the run\'s extras hold exactly it, under its name',
  await until(() => extrasNow().length > 0, 15000) && JSON.stringify(extrasNow()) === JSON.stringify(['refund-policy.md']),
  JSON.stringify(extrasNow()));
check('the staged copies are removed once the run has its own',
  await until(() => !existsSync(path.join(tmpdir(), `orchestrator-extras-${filesRunId}`)), 15000));
check('the start records the file it sent',
  await until(async () => { const s = (await featureApi(filesSeq)).starts?.[0]; return (s?.files || []).map((x) => x.name).join('|') === 'refund-policy.md'; }));
await A.evalJs(`location.hash = ${JSON.stringify(briefHash)}`);
await until(() => A.evalJs(`!!document.querySelector('#requirements-host .req-docs')`), BRIEF_WAIT_MS);
await pickFiles('#requirements-host .req-docs input[type="file"]', [['tone.md', 'Tone: friendly and short.\n', 'text/markdown']]);
check("the brief's Documents card lists the document, read, with Send with every run, and the header says 1 document",
  await until(() => A.evalJs(`(() => { const r = document.querySelector('#requirements-host .req-docs .req-file');
    return !!r && /What Worca took from it/.test(r.textContent) && !!r.querySelector('[aria-label="Send tone.md with every run"]')
      && [...document.querySelectorAll('#requirements-host .chip')].some((c) => c.textContent === '1 document'); })()`), 10000));
// ---- A3: Ask Worca (boards 22–25), in mock mode. A mock reply drafts the first option of the first question that is not the
// recommended one ("Support agents") and proposes the criterion "[mock] A criterion Worca suggests."; WORCA_MOCK_HELPER_MS holds a
// reply so Answering… and Stop can be seen. A mock proposal is always an add (stale only once its text is a criterion), so the stale card is made by
// storing one reword proposal straight into the store (this process serves the page) and then editing that criterion by hand.
/** REQ_SHOTS=<dir>: a screenshot of the viewport for a human look (nothing is written without it). */
const shot = async (name) => {
  if (!SHOTS) return;
  await mkdir(SHOTS, { recursive: true });
  const { data } = await A.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
};
/** The text in `sels` below WCAG AA against what is drawn under it (4.5:1; 3:1 for large text): [text, ratio, ink, ground].
 *  A colour is read back through a canvas, so any CSS colour syntax works; a disabled control and hidden text are skipped. */
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
  for (const root of document.querySelectorAll(${JSON.stringify(sels.join(', '))})) {
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (![...el.childNodes].some((t) => t.nodeType === 3 && t.textContent.trim())) continue;
      if (!el.getClientRects().length || el.closest('[hidden], [aria-hidden="true"], button:disabled')) continue;
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden') continue;
      const bg = ground(el); const ink = over(rgba(cs.color), bg);
      const [a, b] = [lum(ink), lum(bg)]; const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const px = parseFloat(cs.fontSize); const large = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5)) out.push([el.textContent.trim().slice(0, 40), Math.round(ratio * 100) / 100, cs.color, 'rgb(' + bg.slice(0, 3).map(Math.round).join(', ') + ')']);
    }
  }
  return out; })()`);
const A3_TEXT = ['#requirements-host .req-help', '#requirements-host .req-help-drafted-row', '#requirements-host .req-help-ask', '#requirements-host .req-help-toggle'];
const helpSeq = await A.evalJs(`(async () => {
  const key = ((await (await fetch('/api/projects')).json()).projects || []).find((p) => p.name === 'shop').key;
  const r = await fetch('/api/requirements', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scopeType: 'project', scopeKey: key, title: 'Cancel with Worca', description: 'Customers cancel before it ships' }) });
  return (await r.json()).feature.seq; })()`);
// The first-visit Welcome dialog (upstream onboarding) still sits over the page: Skip it, so the screens and the sheet's checks
// see the page itself.
await A.evalJs(`fetch('/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ welcomeSeen: true }) })
  .then(() => { document.querySelector('#welcome-modal:not(.hidden) .ob-skip')?.click(); })`);
await A.evalJs(`location.hash = '#requirements/feature/${helpSeq}'`);
check('A3: a new feature waits for round 1\'s answers; Ask Worca is closed and each question offers Help me answer',
  await until(() => A.evalJs(`document.querySelectorAll('#requirements-host .qpanel .req-help-ask').length === 2
    && document.querySelector('[data-ui="helper-toggle"]')?.getAttribute('aria-pressed') === 'false' && !document.querySelector('.req-help')`), 15000));
await A.evalJs(`document.querySelector('[data-ui="helper-toggle"]').click()`);
check('A3 board 22: Ask Worca takes the right column (420 px); the spec moves under the question card; the first-open text and its three questions',
  await until(() => A.evalJs(`(() => { const p = document.querySelector('#requirements-host aside.req-help'); if (!p) return false;
    return Math.abs(p.getBoundingClientRect().width - 420) <= 1 && !document.querySelector('#requirements-host .req-right')
      && !!document.querySelector('#requirements-host .req-left > .req-moved .req-spec') && document.querySelectorAll('.req-help-starter').length === 3; })()`)));
await shot('a3-board22-first-open');
await A.evalJs(`document.querySelector('#requirements-host .qpanel .req-help-ask').click()`);
check('A3 D1: Help me answer puts the question and its cap in the composer and sends nothing',
  await until(() => A.evalJs(`(() => { const ta = document.querySelector('[data-ui="helper-in"]');
    return !!ta && ta.value === 'Who may do this?' && document.activeElement === ta
      && document.querySelector('.req-help-composer .req-help-cap')?.textContent === 'Help me answer · question 1'
      && !document.querySelector('.req-help-msg-po'); })()`)));
await A.evalJs(`document.querySelector('[data-ui="helper-send"]').click()`);
check('A3 D6: the reply drafts an answer into the question card, marked drafted by Worca with its why; the bubble keeps the cap',
  await until(() => A.evalJs(`(() => { const b = document.querySelector('#requirements-host .qpanel .qblock');
    const on = [...b.querySelectorAll('.qopt')].find((o) => o.getAttribute('aria-pressed') === 'true');
    const chip = b.querySelector('.req-help-drafted-row');
    return on?.querySelector('.qopt-txt')?.textContent === 'Support agents' && !!chip && !chip.hidden
      && (chip.querySelector('.req-help-draft-why')?.textContent || '').startsWith("Worca's draft: [mock]")
      && document.querySelector('.req-help-msg-po .req-help-cap')?.textContent === 'Help me answer · question 1'; })()`), 10000));
// Where the drafted chip sits on a desktop (board 22): under the options row of its question, not beside it.
const chipAt = await A.evalJs(`(() => { const b = document.querySelector('#requirements-host .qpanel .qblock');
  const o = b.querySelector('.qopts').getBoundingClientRect(); const c = b.querySelector('.req-help-drafted').getBoundingClientRect();
  const q = b.getBoundingClientRect();
  return { underOptions: Math.round(c.top) >= Math.round(o.bottom), indent: Math.round(c.left - q.left), optionsLeft: Math.round(o.left - q.left),
    w: Math.round(c.width), h: Math.round(c.height) }; })()`);
log(`note A3 desktop: the drafted chip ${JSON.stringify(chipAt)}`);
check('A3 desktop: the drafted chip sits under its options row', chipAt.underOptions, JSON.stringify(chipAt));
await shot('a3-board22-draft-and-proposal');
await A.evalJs(`document.querySelector('.req-help [data-ui^="prop-accept-"]').click()`);
check("A3 D10: Accept puts the proposed criterion in the spec as the product owner's edit; the card says so with the id it got",
  await until(() => A.evalJs(`(() => { const c = document.querySelector('.req-help-card.is-accepted'); const id = c?.querySelector('.req-help-id')?.textContent;
    return !!id && /Accepted · now in the spec as your edit/.test(c.textContent)
      && (document.querySelector('#requirements-host .req-spec [data-criterion="' + id + '"]')?.textContent || '').includes('[mock] A criterion Worca suggests.'); })()`), 10000));
{
  const store = await import(new URL('../src/core/requirements/store.mjs', import.meta.url).href);
  const { normalizeHelperReply } = await import(new URL('../src/core/requirements/helper.mjs', import.meta.url).href);
  // and an add that stays open: the 390 px sheet then has an Accept and a Reject to measure
  const { proposals } = normalizeHelperReply({ text: 'I suggest rewording R-po-1.', proposals: [{ target: 'criterion', change: 'reword', id: 'R-po-1',
    value: 'A customer can cancel until the parcel is picked up.', reason: 'The tickets ask for it.' },
  { target: 'criterion', change: 'add', id: null, value: 'A customer sees why a cancel was refused.', reason: 'Support gets these questions.' }] },
  { spec: store.getFeature(helpSeq).spec });
  store.insertHelperMessage({ featureSeq: helpSeq, role: 'worca', text: 'I suggest rewording R-po-1.', proposals });
}
await A.evalJs(`fetch('/api/requirements/${helpSeq}/criteria/R-po-1', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: 'A customer can cancel an unpaid order.' }) })`);
check('A3 D9: after a hand edit the card says the spec changed (role=alert) and offers Reject and Ask again, no Accept',
  await until(() => A.evalJs(`(() => { const c = document.querySelector('.req-help-card.is-stale'); if (!c) return false;
    return c.querySelector('[role="alert"]')?.textContent === 'The spec changed since Worca proposed this.'
      && [...c.querySelectorAll('.btn')].map((b) => b.textContent).join('|') === 'Reject|Ask again'; })()`), 10000));
await A.evalJs(`document.querySelector('.req-help-card.is-accepted').scrollIntoView({ block: 'start' })`);
await shot('a3-board24-accepted-and-stale');
await A.evalJs(`document.querySelector('.req-help-card.is-stale [data-ui^="prop-ask-again-"]').click()`);
check('A3 D10: Ask again sends "Propose this again for the current spec." with its cap; the stale card keeps only its alert',
  await until(() => A.evalJs(`(() => { const c = document.querySelector('.req-help-card.is-stale');
    return [...document.querySelectorAll('.req-help-msg-po .req-help-cap')].some((x) => x.textContent === 'Ask again · Acceptance criteria')
      && [...document.querySelectorAll('.req-help-msg-po')].some((m) => m.textContent.endsWith('Propose this again for the current spec.'))
      && !!c && !c.querySelector('.btn'); })()`), 10000));
await until(() => A.evalJs(`!document.querySelector('.req-help-waiting')`), 10000);
process.env.WORCA_MOCK_HELPER_MS = String(AFTER_HOLD_MS);   // held longer than the check below waits, so Stop always finds it answering
await A.evalJs(`(() => { const ta = document.querySelector('[data-ui="helper-in"]'); ta.value = 'What edge cases am I missing?';
  ta.dispatchEvent(new Event('input')); document.querySelector('[data-ui="helper-send"]').click(); })()`);
check('A3 card 8: Answering… with Stop while Worca answers; Send waits',
  await until(() => A.evalJs(`(() => { const s = document.querySelector('.req-help-waiting [role="status"]');
    return !!s && s.querySelector('.badge.blue')?.textContent === 'Answering…' && document.querySelector('[data-ui="helper-send"]').disabled; })()`), HOLD_MS));
await shot('a3-card8-answering');
await A.evalJs(`document.querySelector('[data-ui="helper-stop"]').click()`);
delete process.env.WORCA_MOCK_HELPER_MS;
check('A3 D12: Stop: the message stays; "You stopped this reply." with Try again',
  await until(() => A.evalJs(`(() => { const s = document.querySelector('.req-help-stopped');
    return !!s && s.textContent.startsWith('You stopped this reply.') && !!s.querySelector('[data-ui="helper-retry"]')
      && [...document.querySelectorAll('.req-help-msg-po')].some((m) => m.textContent === 'What edge cases am I missing?'); })()`), 10000));
// Board 23: the dark theme is the tokens alone: the panel, its ink and the draft chip change; nothing turns transparent; the text of
// the new elements (the panel with a proposed, an accepted and a stale card, the stopped line; the draft chip; Help me answer) is AA.
const helpColors = () => A.evalJs(`(() => { const p = document.querySelector('#requirements-host .req-help'); const chip = document.querySelector('#requirements-host .req-help-drafted');
  return { panel: getComputedStyle(p).backgroundColor, ink: getComputedStyle(p).color, chip: chip ? getComputedStyle(chip).borderTopColor : null }; })()`);
const themeWas = await A.evalJs(`document.documentElement.dataset.theme || ''`);
await A.evalJs(`document.documentElement.dataset.theme = 'light'`);
await sleep(200);
const lightC = await helpColors();
const lightLow = await lowContrast(A3_TEXT);
await A.evalJs(`document.documentElement.dataset.theme = 'dark'`);
await sleep(200);
const darkC = await helpColors();
const darkLow = await lowContrast(A3_TEXT);
await A.evalJs(`document.querySelector('.req-help-card.is-accepted').scrollIntoView({ block: 'start' })`);
await shot('a3-board23-dark-cards');
await A.evalJs(`document.querySelector('#requirements-host .req-help-log').scrollTop = 1e6`);
await shot('a3-board23-dark-stopped');
await A.evalJs(`document.documentElement.dataset.theme = ${JSON.stringify(themeWas)}`);
check('A3 board 23: dark theme from the tokens: panel, ink and draft chip all change, none transparent',
  !!lightC.chip && lightC.panel !== darkC.panel && lightC.ink !== darkC.ink && lightC.chip !== darkC.chip
    && ![lightC.panel, darkC.panel].includes('rgba(0, 0, 0, 0)'), JSON.stringify({ lightC, darkC }));
check('A3: the text of the chat, the draft chip and Help me answer is AA in light and dark', lightLow.length === 0 && darkLow.length === 0,
  JSON.stringify({ light: lightLow, dark: darkLow }));
// Board 25: at 390 px the panel is a full-screen sheet with Back; Back keeps the drafts in the question card.
await A.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await sleep(300);
const sheetNow = () => A.evalJs(`(() => { const p = document.querySelector('#requirements-host .req-help'); if (!p) return null;
  const r = p.getBoundingClientRect(); const back = p.querySelector('[data-ui="helper-back"]'); const close = p.querySelector('[data-ui="helper-close"]');
  const w = document.documentElement.clientWidth; const hh = window.innerHeight;
  const notOn = [[2, 2], [w - 2, 2], [w / 2, hh / 2], [2, hh - 2], [w - 2, hh - 2]].filter(([x, y]) => !p.contains(document.elementFromPoint(x, y)))
    .map(([x, y]) => { const e = document.elementFromPoint(x, y); return [Math.round(x), Math.round(y), e ? e.className || e.tagName : null]; });
  return { position: getComputedStyle(p).position, box: [r.left, r.top, r.width, r.height].map(Math.round), w, hh, notOn,
    back: getComputedStyle(back).display !== 'none' ? back.getAttribute('aria-label') : null, close: getComputedStyle(close).display,
    scrollW: document.documentElement.scrollWidth }; })()`);
const sheetOk = (s) => !!s && s.position === 'fixed' && s.box.join() === [0, 0, s.w, s.hh].join() && !s.notOn.length
  && s.back === `Back to FEAT-${helpSeq}` && s.close === 'none' && s.scrollW === s.w;
let sheet = null;
check('A3 board 25: at 390 px Ask Worca is a full-screen sheet over the page with "Back to FEAT-n" and no Close; no sideways scroll',
  await until(async () => sheetOk(sheet = await sheetNow())), JSON.stringify(sheet));
// A target is its hit area (style.css: a .btn-sm grows by an absolutely placed ::after, inset -9px 0): 44 px tall; an icon
// button 44 px wide too (the Files card's rule below).
const helpTargets = () => A.evalJs(`(() => {
  const hit = (b) => { const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); const a = getComputedStyle(b, '::after');
    let hh = r.height; let ww = r.width;
    if (a.content !== 'none' && a.position === 'absolute' && cs.position !== 'static') {
      const px = (v) => parseFloat(v) || 0;
      hh = Math.max(hh, r.height - px(cs.borderTopWidth) - px(cs.borderBottomWidth) - px(a.top) - px(a.bottom));
      ww = Math.max(ww, r.width - px(cs.borderLeftWidth) - px(cs.borderRightWidth) - px(a.left) - px(a.right));
    }
    return { hh: Math.round(hh), ww: Math.round(ww) }; };
  return [...document.querySelectorAll('#requirements-host .req-help .btn, #requirements-host .req-help .req-ico')].filter((b) => b.offsetParent !== null)
    .map((b) => ({ ui: b.getAttribute('data-ui') || b.textContent, ico: b.classList.contains('req-ico'), ...hit(b) })); })()`);
const sheetTargets = await helpTargets();
log(`note A3 390 px: the sheet's targets (hit height x width) ${sheetTargets.map((t) => `${t.ui}:${t.hh}x${t.ww}`).join(' ')}`);
const smallHelp = sheetTargets.filter((t) => t.hh < 44 || (t.ico && t.ww < 44));
check('A3 D18: every control of the sheet is a 44 px target (Back, ⋯, Reject, Accept, Try again, Send)',
  smallHelp.length === 0 && ['helper-back', 'helper-more', 'helper-send', 'helper-retry'].every((u) => sheetTargets.some((t) => t.ui === u))
    && sheetTargets.some((t) => /^prop-accept-/.test(t.ui)) && sheetTargets.some((t) => /^prop-reject-/.test(t.ui)), JSON.stringify(smallHelp));
await A.evalJs(`document.querySelector('#requirements-host .req-help-log').scrollTop = 1e6`);
await shot('a3-board25-sheet');
// Not a requirement (no focus trap in the design): where Tab goes from the sheet's last control, and Shift+Tab from its first.
const tabKey = async (shift) => {
  const base = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: shift ? 8 : 0 };
  await A.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  await A.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(100);
  return A.evalJs(`(() => { const a = document.activeElement; const p = document.querySelector('#requirements-host .req-help');
    return { inSheet: !!p && p.contains(a), el: a ? (a.getAttribute('data-ui') || a.className || a.tagName) : null }; })()`);
};
await A.evalJs(`document.querySelector('[data-ui="helper-in"]').focus()`);
const tabOut = [await tabKey(false), await tabKey(false)];
await A.evalJs(`document.querySelector('[data-ui="helper-back"]').focus()`);
const tabBack = await tabKey(true);
log(`note A3 390 px: Tab from the composer ${JSON.stringify(tabOut)}; Shift+Tab from Back ${JSON.stringify(tabBack)}`);
await A.evalJs(`document.querySelector('[data-ui="helper-back"]').click()`);
check('A3 D2: Back returns to the feature; the drafted answer is still in the question card; Help me answer is a 44 px line',
  await until(() => A.evalJs(`(() => { const b = document.querySelector('#requirements-host .qpanel .qblock'); if (document.querySelector('.req-help') || !b) return false;
    const chip = b.querySelector('.req-help-drafted-row');
    return !!chip && !chip.hidden && Math.round(b.querySelector('.req-help-ask').getBoundingClientRect().height) >= 44; })()`)));
// Where Help me answer sits at 390 px (board 25): its own line under the question text.
const askAt = await A.evalJs(`(() => { const b = document.querySelector('#requirements-host .qpanel .qblock');
  const t = b.querySelector('.qtext').getBoundingClientRect(); const a = b.querySelector('.req-help-ask').getBoundingClientRect();
  return { underQuestion: Math.round(a.top) >= Math.round(t.bottom), left: Math.round(a.left - b.getBoundingClientRect().left),
    h: Math.round(a.height), w: Math.round(a.width) }; })()`);
log(`note A3 390 px: Help me answer ${JSON.stringify(askAt)}`);
check('A3 390 px: Help me answer is its own line under the question', askAt.underQuestion, JSON.stringify(askAt));
await A.evalJs(`document.querySelector('#requirements-host .qpanel .qblock').scrollIntoView({ block: 'start' })`);
await shot('a3-board25-question-card');
await A.send('Emulation.clearDeviceMetricsOverride');
await A.evalJs(`document.querySelector('[data-ui="helper-toggle"]').click()`);
await until(() => A.evalJs(`!!document.querySelector('[data-ui="helper-more"]')`));
await A.evalJs(`(() => { window.__confirmA3 = window.confirm; window.confirm = () => true;
  document.querySelector('[data-ui="helper-more"]').click(); document.querySelector('[data-ui="helper-clear"]').click(); })()`);
check('A3 D14: Clear chat empties the chat (the first-open text again); the accepted criterion stays in the spec',
  await until(() => A.evalJs(`!!document.querySelector('.req-help-empty')
    && [...document.querySelectorAll('#requirements-host .req-spec [data-criterion]')].some((c) => c.textContent.includes('[mock] A criterion Worca suggests.'))`), 10000));
await A.evalJs(`window.confirm = window.__confirmA3`);
await A.evalJs(`[...document.querySelectorAll('#requirements-host .qpanel .btn-primary')].find((b) => b.textContent === 'Submit').click()`);
check('A3 D6: Submit sends the drafted answer like any answer',
  await until(async () => { const d = await A.evalJs(`fetch('/api/requirements/${helpSeq}').then((r) => r.json())`);
    const a = (d.turns || []).filter((t) => t.kind === 'answers').at(-1);
    return !!a && (a.payload.answers.find((x) => x.id === 'who') || {}).answer === 'Support agents'; }, 15000));
// ---- The header menus have their panel (upstream's .menu box), and at phone width (390 px) every page fits and
// every menu opens inside the screen.
const featureHash = `#requirements/feature/${seqNo}`;
const MENUS = { [featureHash]: ['menu-export', 'menu-more'], [filesHash]: ['menu-export', 'menu-more'], [briefHash]: ['brief-export', 'brief-more'] };
/** Open one header menu, measure its list (inside [0, clientWidth], a background that is not transparent), close it. */
const menuBox = (ui) => A.evalJs(`(() => { const t = document.querySelector('#requirements-host [data-ui="${ui}"]'); if (!t) return null;
  t.click(); const m = t.parentElement.querySelector('[role="menu"]'); if (!m || m.hidden) return null;
  const r = m.getBoundingClientRect(); const bg = getComputedStyle(m).backgroundColor; const w = document.documentElement.clientWidth;
  t.click(); return { left: Math.round(r.left), right: Math.round(r.right), w, bg }; })()`);
const menuOk = (b) => !!b && b.left >= 0 && b.right <= b.w && b.bg !== 'rgba(0, 0, 0, 0)' && b.bg !== 'transparent';
const goTo = async (hash, ready) => { await A.evalJs(`location.hash = ${JSON.stringify(hash)}`); return until(() => A.evalJs(ready), BRIEF_WAIT_MS); };
const READY = { [featureHash]: `!!document.querySelector('#requirements-host [data-ui="menu-more"]')`,
  [filesHash]: `!!document.querySelector('#requirements-host .req-files')`,
  [briefHash]: `!!document.querySelector('#requirements-host [data-ui="brief-more"]')`,
  '#requirements': `!!document.querySelector('#requirements-host .req-row')`, '#requirements/new': `!!document.getElementById('req-new-title')` };
await goTo(featureHash, READY[featureHash]);
const wide = await menuBox('menu-export');
check('desktop: the Export menu has its panel (a background, not transparent)', menuOk(wide), JSON.stringify(wide));
await A.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
for (const hash of ['#requirements', '#requirements/new', featureHash, filesHash, briefHash]) {
  const shown = await goTo(hash, READY[hash]);
  await sleep(200);
  const fit = await A.evalJs(`document.documentElement.scrollWidth === document.documentElement.clientWidth`);
  const page = `${hash.replace(/\/\d+$/, '/<n>').replace(/brief\/.*/, 'brief/<project>')}${hash === filesHash ? ' (with files)' : ''}`;
  check(`390 px: ${page} fits the screen (no sideways scroll)`, shown && fit);
  for (const ui of MENUS[hash] || []) {
    const b = await menuBox(ui);
    check(`390 px: ${ui} opens inside the screen with its panel`, menuOk(b), JSON.stringify(b));
  }
  if (hash === filesHash) {
    // A target is its hit area (board 20, style.css): the control's own box, grown by an absolutely placed ::after whose
    // negative insets reach past the padding box (a 28px button: 26 + 2 × 9). An icon button must be 44 px wide too.
    const small = await A.evalJs(`(() => { const card = document.querySelector('#requirements-host .req-files');
      const hit = (b) => { const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); const a = getComputedStyle(b, '::after');
        let hh = r.height; let ww = r.width;
        if (a.content !== 'none' && a.position === 'absolute' && cs.position !== 'static') {
          const px = (v) => parseFloat(v) || 0;
          hh = Math.max(hh, r.height - px(cs.borderTopWidth) - px(cs.borderBottomWidth) - px(a.top) - px(a.bottom));
          ww = Math.max(ww, r.width - px(cs.borderLeftWidth) - px(cs.borderRightWidth) - px(a.left) - px(a.right));
        }
        return { hh, ww }; };
      return [...card.querySelectorAll('.btn, .req-ico, .switch-row, .link-btn, .req-file-name')].filter((b) => b.offsetParent !== null)
        .map((b) => [b, hit(b)]).filter(([b, s]) => s.hh < 44 || (b.classList.contains('req-ico') && s.ww < 44))
        .map(([b, s]) => (b.getAttribute('data-ui') || b.className) + ':' + Math.round(s.hh) + 'x' + Math.round(s.ww)); })()`);
    check('390 px: the pencil is in the ⋯ menu, not on the row; the Files card\'s targets are 44 px',
      await A.evalJs(`(() => { const card = document.querySelector('#requirements-host .req-files');
        const pencil = card.querySelector('.req-file-pencil');
        const menuHas = !!card.querySelector('[data-ui^="fmi-edit-"]');
        return (!pencil || getComputedStyle(pencil).display === 'none') && menuHas; })()`) && small.length === 0, JSON.stringify(small));
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
