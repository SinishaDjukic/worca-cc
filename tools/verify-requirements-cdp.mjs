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
// Feature chat (A3: the toggle and the right column, Help me answer, a draft in the question card, Accept, a stale card
// and Ask again, Answering… and Stop, the dark theme, the 390 px sheet with Back keeping the draft, Clear chat, Submit
// sending the draft); export to a tracker (A6: jira-source linked in mock mode; the Export menu's items, the setup, the
// preview and its dark theme, Create with the chip, the History card and Created SHOP-123, Export again with the comment
// preview, Export anyway, the 390 px sheet with its phone title, Back, Show all, 44 px targets and the page inert until the
// view is left, Tab kept inside a dialog, AA text in light and dark, the states of a tracker that cannot be reached, Start
// with Report back writing back to the ticket; `--only=a6` runs it alone); no page errors.
// NOT part of `npm test`. REQ_SHOTS=<dir> also writes the Feature chat and export screens there (a3-*.png, a6-*.png) for a
// human look.
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
import { fileURLToPath } from 'node:url';

const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'];
const CHROME = process.env.CHROME_BIN || CHROME_PATHS.find((p) => existsSync(p)) || CHROME_PATHS[0];
const SANDBOX = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0
  ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
// --only=a6: the boot, the flag and the A6 section (export to a tracker) alone, then the page-error gate.
const ONLY_A6 = process.argv.includes('--only=a6');
const SHOTS = process.env.REQ_SHOTS || '';
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
if (!ONLY_A6) {   // --only=a6 skips to the A6 section
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
  // The mock leaves an assumption open, so the feature is in Decide: the Decide card, the start-before-Ready
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
  // ---- A3: Feature chat (boards 22–25), in mock mode. A mock reply drafts the first option of the first question that is not the
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
  check('A3: a new feature waits for round 1\'s answers; Feature chat is closed and each question offers Help me answer',
    await until(() => A.evalJs(`document.querySelectorAll('#requirements-host .qpanel .req-help-ask').length === 2
      && document.querySelector('[data-ui="helper-toggle"]')?.getAttribute('aria-pressed') === 'false' && !document.querySelector('.req-help')`), 15000));
  await A.evalJs(`document.querySelector('[data-ui="helper-toggle"]').click()`);
  check('A3 board 22: Feature chat takes the right column (420 px); the spec moves under the question card; the first-open text and its three questions',
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
  const panelColor = () => A.evalJs(`getComputedStyle(document.querySelector('#requirements-host .req-help')).backgroundColor`);
  await until(async () => (await panelColor()) !== 'rgba(0, 0, 0, 0)');
  await until(() => A.evalJs(`document.getAnimations().length === 0`));
  const lightC = await helpColors();
  const lightLow = await lowContrast(A3_TEXT);
  const lightPanel = await panelColor();
  await A.evalJs(`document.documentElement.dataset.theme = 'dark'`);
  await until(async () => (await panelColor()) !== lightPanel);
  await until(() => A.evalJs(`document.getAnimations().length === 0`));   // the colours have finished changing
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
  await until(() => A.evalJs(`window.innerWidth === 390 && getComputedStyle(document.querySelector('#requirements-host .req-help')).position === 'fixed'`));
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
  check('A3 board 25: at 390 px Feature chat is a full-screen sheet over the page with "Back to FEAT-n" and no Close; no sideways scroll',
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
  // The composer is on screen: Send (and the composer around it) sits inside the 390 x 844 viewport, not below it.
  const sendAt = await A.evalJs(`(() => { const b = document.querySelector('#requirements-host .req-help [data-ui="helper-send"]');
    const c = document.querySelector('#requirements-host .req-help .req-help-composer'); if (!b || !c) return null;
    const r = b.getBoundingClientRect(); const k = c.getBoundingClientRect();
    return { send: [r.top, r.bottom, r.left, r.right].map(Math.round), composerBottom: Math.round(k.bottom), w: document.documentElement.clientWidth, hh: window.innerHeight }; })()`);
  check('A3 board 25: at 390 x 844 the composer and its Send are inside the screen (the log scrolls inside the sheet)',
    !!sendAt && sendAt.send[0] >= 0 && sendAt.send[1] <= sendAt.hh && sendAt.send[2] >= 0 && sendAt.send[3] <= sendAt.w && sendAt.composerBottom <= sendAt.hh, JSON.stringify(sendAt));
  // Tab from the sheet's last control and Shift+Tab from its first never land on the page underneath (it is inert while the sheet is open).
  const tabKey = async (shift) => {
    const base = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: shift ? 8 : 0 };
    await A.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    await A.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    await sleep(100);
    return A.evalJs(`(() => { const a = document.activeElement; const p = document.querySelector('#requirements-host .req-help');
      return { inSheet: !!p && p.contains(a), outside: !!a && a !== document.body && !!p && !p.contains(a), el: a ? (a.getAttribute('data-ui') || a.className || a.tagName) : null }; })()`);
  };
  await A.evalJs(`document.querySelector('[data-ui="helper-in"]').focus()`);
  const tabOut = [await tabKey(false), await tabKey(false), await tabKey(false)];
  await A.evalJs(`document.querySelector('[data-ui="helper-back"]').focus()`);
  const tabBack = [await tabKey(true), await tabKey(true)];
  log(`note A3 390 px: Tab from the composer ${JSON.stringify(tabOut)}; Shift+Tab from Back ${JSON.stringify(tabBack)}`);
  const inertNow = await A.evalJs(`(() => { const p = document.querySelector('#requirements-host .req-help');
    return { sheetInert: !!p.closest('[inert]'), pageInert: !!document.querySelector('#requirements-host .req-head')?.closest('[inert]') }; })()`);
  check('A3 board 25 a11y: Tab and Shift+Tab from the ends of the open sheet never land on the page underneath, which is inert; the sheet is not',
    [...tabOut, ...tabBack].every((t) => !t.outside) && tabOut.at(-1).inSheet && tabBack.at(-1).inSheet && inertNow.pageInert && !inertNow.sheetInert, JSON.stringify({ tabOut, tabBack, inertNow }));
  await A.evalJs(`document.querySelector('[data-ui="helper-back"]').click()`);
  check('A3 D2: Back returns to the feature; the drafted answer is still in the question card; Help me answer is a 44 px line',
    await until(() => A.evalJs(`(() => { const b = document.querySelector('#requirements-host .qpanel .qblock'); if (document.querySelector('.req-help') || !b) return false;
      const chip = b.querySelector('.req-help-drafted-row');
      return !!chip && !chip.hidden && Math.round(b.querySelector('.req-help-ask').getBoundingClientRect().height) >= 44; })()`)));
  check('A3 board 25 a11y: after Back the page is live again (the feature, the app bar) and the focus is back on the opener (not lost)',
    await A.evalJs(`(() => { const live = (e) => !!e && !e.closest('[inert]'); return live(document.querySelector('#requirements-host .req-head')) && live(document.querySelector('.mbar-menu') || document.body) && document.activeElement !== document.body; })()`));
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
}
// A target is its hit area (board 20, style.css): the control's own box, grown by an absolutely placed ::after whose negative
// insets reach past the padding box. Shared by the A6 section (the files section keeps its own copy).
const HIT_FN = `const hit = (b) => { const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); const a = getComputedStyle(b, '::after');
  let hh = r.height; let ww = r.width;
  if (a.content !== 'none' && a.position === 'absolute' && cs.position !== 'static') {
    const px = (v) => parseFloat(v) || 0;
    hh = Math.max(hh, r.height - px(cs.borderTopWidth) - px(cs.borderBottomWidth) - px(a.top) - px(a.bottom));
    ww = Math.max(ww, r.width - px(cs.borderLeftWidth) - px(cs.borderRightWidth) - px(a.left) - px(a.right));
  }
  return { hh, ww }; };`;

// ---- A6: export to a tracker (boards 26–31), in mock mode: jira-source linked with one connection; the shim's canned export
// answers (SHOP — Shop web, Story, tickets SHOP-123, 124, …, doneStatus Done). This server runs in this process, so a Ready
// feature is made straight in the store, and a tracker that cannot be reached is the shim's answer swapped for one op
// (setMockSourceResponses; `{}` puts the canned answers back without restarting the ticket numbers). Runs alone with --only=a6.
{
  const store = await import(new URL('../src/core/requirements/store.mjs', import.meta.url).href);
  const { emptySpec } = await import(new URL('../src/core/requirements/spec.mjs', import.meta.url).href);
  const { linkPlugin } = await import(new URL('../src/core/plugin-store.mjs', import.meta.url).href);
  const { createProfile, readPluginState } = await import(new URL('../src/core/plugin-config.mjs', import.meta.url).href);
  const { retryWriteback } = await import(new URL('../src/core/sources.mjs', import.meta.url).href);
  const { setMockSourceResponses } = await import(new URL('../src/core/plugin-shim.mjs', import.meta.url).href);
  const { getDb } = await import(new URL('../src/core/db.mjs', import.meta.url).href);
  /** REQ_SHOTS=<dir>: a screenshot of the viewport for a human look (nothing is written without it). */
  const shot = async (name) => {
    if (!SHOTS) return;
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
  /** The text in `sels` below WCAG AA against what is drawn under it (4.5:1; 3:1 for large text): [text, ratio, ink, ground].
   *  A colour is read back through a canvas, so any CSS colour syntax works; a disabled control and hidden text are skipped.
   *  Selectors that reach no visible text are a failure too (a renamed class never passes unseen). */
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
  /** lowContrast in the light and the dark theme; the page's theme is put back after. */
  const contrastBoth = async (sels, darkShot = null) => {
    const was = await A.evalJs(`document.documentElement.dataset.theme || ''`);
    await setTheme('light');
    const light = await lowContrast(sels);
    await setTheme('dark');
    const dark = await lowContrast(sels);
    if (darkShot) await shot(darkShot);
    await setTheme(was);
    return { light, dark };
  };
  /** Tab (or Shift+Tab) as the keyboard sends it; where the focus is after: inside the open dialog or not. */
  const tabKey = async (shift) => {
    const k = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: shift ? 8 : 0 };
    await A.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k });
    await A.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });   // answered once the page has handled the key
    return A.evalJs(`(() => { const a = document.activeElement; const d = document.querySelector('.req-dlg-wrap [role="dialog"]');
      return { inDlg: !!d && !!a && d.contains(a), el: a ? (a.getAttribute('data-ui') || a.id || a.tagName) : null }; })()`);
  };
  /** From the dialog's title (where it puts the focus): Shift+Tab, then `n` Tabs round the dialog. Every stop is inside it. */
  const tabWalk = async (n) => {
    await A.evalJs(`document.querySelector('.req-dlg-wrap [role="dialog"] h2').focus()`);
    const back = await tabKey(true);
    const fwd = [];
    for (let i = 0; i < n; i += 1) fwd.push(await tabKey(false));
    return { back, fwd, out: [back, ...fwd].filter((t) => !t.inDlg).map((t) => t.el) };
  };
  const unreachable = () => { const e = new Error('401 Unauthorized'); e.kind = 'auth'; throw e; };

  // The first-visit Welcome dialog (upstream onboarding) may still sit over the page: Skip it, so the screens and the inert
  // checks see the page itself.
  await A.evalJs(`fetch('/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ welcomeSeen: true }) })
    .then(() => { document.querySelector('#welcome-modal:not(.hidden) .ob-skip')?.click(); })`);
  await linkPlugin('jira-source', fileURLToPath(new URL('../plugins/jira-source', import.meta.url)));
  createProfile('jira-source', 'acme', 'acme.atlassian.net (Cloud)');
  const projKey = (await (await fetch(`${base}/api/projects`)).json()).projects.find((p) => p.name === 'shop').key;
  const spec = { ...emptySpec(), goal: { text: 'Customers cancel an order themselves until it leaves the warehouse.', measure: 'a third fewer support calls' },
    actors: ['Customer', 'Support agent'], flow: ['Open the order.', 'Cancel it.'], rules: ['A refund goes back the way the order was paid.'],
    criteria: [{ id: 'R-po-1', text: 'A customer can cancel a paid order that has not shipped.' }],
    assumptions: [{ id: 'A-1', text: 'Invoices can be cancelled the same way.', status: 'confirmed' }] };
  const f6 = store.createFeature({ scopeType: 'project', scopeKey: projKey, title: 'Cancel an order before it ships', description: 'Before it ships' });
  store.appendTurn(f6.seq, { kind: 'round', payload: { questions: [], done: true } });
  store.updateFeature(f6.seq, { status: 'done', criteriaSeq: 1, assumptionSeq: 1, spec });
  const f6Hash = `#requirements/feature/${f6.seq}`;
  const DLG = `document.querySelector('.req-dlg-wrap [role="dialog"]')`;
  const openExportMenu = () => A.evalJs(`(() => { document.querySelector('#requirements-host [data-ui="menu-export"]').click();
    document.querySelector('#requirements-host [data-ui="mi-export"]').click(); })()`);
  const inertNow = () => A.evalJs(`[...document.body.children].filter((el) => el.hasAttribute('inert')).length`);
  const othersInert = () => A.evalJs(`[...document.body.children].filter((el) => !el.classList.contains('req-dlg-wrap')).every((el) => el.hasAttribute('inert'))`);
  const inertBefore = await inertNow();
  await A.evalJs(`location.hash = ${JSON.stringify(f6Hash)}`);
  check('A6 D1: Export ▾ ends with a separator, Export to Jira… and Export setup…',
    await until(() => A.evalJs(`(() => { const t = document.querySelector('#requirements-host [data-ui="menu-export"]'); if (!t) return false;
      const items = [...t.parentElement.querySelectorAll('[role="menuitem"], [role="separator"]')].map((x) => (x.getAttribute('role') === 'separator' ? '—' : x.textContent));
      return items.join('|') === 'Save to specs/|Copy Markdown|Download .md|—|Export to Jira…|Export setup…'; })()`), 15000));
  await openExportMenu();
  check('A6 board 26: the first export opens Set up export for shop; the selects load SHOP — Shop web, Story and the priorities',
    await until(() => A.evalJs(`(() => { const d = ${DLG}; if (!d) return false; const sel = (u) => d.querySelector('[data-ui="' + u + '"]');
      return d.querySelector('h2')?.textContent === 'Set up export for shop' && sel('setup-project')?.selectedOptions[0]?.textContent === 'SHOP — Shop web'
        && sel('setup-type')?.selectedOptions[0]?.textContent === 'Story' && sel('setup-prio')?.options.length === 5 && !sel('setup-save').disabled; })()`), 15000));
  check('A6 D20: an export dialog on a desktop makes every other child of <body> inert', await othersInert());
  await shot('a6-board26-setup');
  await A.evalJs(`document.querySelector('[data-ui="setup-save"]').click()`);
  check('A6 board 27: Save and continue opens the preview: its title, the labels with the fixed one, the description and its footer',
    await until(() => A.evalJs(`(() => { const d = ${DLG}; const desc = d && d.querySelector('.req-export-desc'); if (!desc) return false;
      // 1400 px wide: the desktop title, no phone line under it (board 31's title is for 900 px and narrower)
      return d.querySelector('h2').innerText.trim() === 'Export FEAT-${f6.seq} to Jira'
        && getComputedStyle(d.querySelector('.req-export-sub')).display === 'none' && desc.querySelector('h4')?.textContent === 'Goal'
        && (desc.querySelector('.req-export-sig')?.textContent || '').startsWith('From Worca FEAT-${f6.seq} · exported ')
        && [...d.querySelectorAll('.req-export-lab')].map((x) => x.textContent).join('|') === 'worca|worca-FEAT-${f6.seq}'
        && d.querySelector('[data-ui="export-go"]').textContent === 'Create in Jira' && !d.querySelector('[data-ui="export-go"]').disabled; })()`), 15000));
  await shot('a6-board27-preview');
  // D20: Tab and Shift+Tab go round the open dialog and never reach the page behind (inert at every width)
  const walkDesk = await tabWalk(14);
  check('A6 D20: on a desktop Tab and Shift+Tab stay inside the open preview (Shift+Tab from the title wraps to Create in Jira)',
    walkDesk.out.length === 0 && walkDesk.back.el === 'export-go', JSON.stringify({ back: walkDesk.back, fwd: walkDesk.fwd.map((t) => t.el) }));
  // Board 30: the dark theme is the tokens alone: the card, its ink and the description box change; nothing turns transparent.
  const colors = () => A.evalJs(`(() => { const d = ${DLG}; const desc = d.querySelector('.req-export-desc');
    return { card: getComputedStyle(d).backgroundColor, ink: getComputedStyle(d).color, desc: getComputedStyle(desc).backgroundColor }; })()`);
  const themeWas = await A.evalJs(`document.documentElement.dataset.theme || ''`);
  await setTheme('light');
  const lightC = await colors();
  await setTheme('dark');
  const darkC = await colors();
  await shot('a6-board30-preview-dark');
  await setTheme(themeWas);
  check('A6 board 30: the preview in the dark theme comes from the tokens: card, ink and description box change, none transparent',
    lightC.card !== darkC.card && lightC.ink !== darkC.ink && lightC.desc !== darkC.desc
      && ![lightC.card, darkC.card, lightC.desc, darkC.desc].includes('rgba(0, 0, 0, 0)'), JSON.stringify({ lightC, darkC }));
  const previewAA = await contrastBoth(['.req-dlg-wrap .req-export']);
  check('A6 board 30: the text of the preview is AA in light and dark', previewAA.light.length === 0 && previewAA.dark.length === 0, JSON.stringify(previewAA));
  await A.evalJs(`document.querySelector('[data-ui="export-go"]').click()`);
  check('A6 boards 28, 29: Create in Jira: the dialog closes; the chip SHOP-123 opens the ticket in a new tab; "Created SHOP-123"; History records it',
    await until(() => A.evalJs(`(() => { if (${DLG}) return false; const chip = document.querySelector('#requirements-host [data-ui="export-chip"]');
      return !!chip && chip.textContent === 'SHOP-123' && chip.getAttribute('href') === 'https://mock.test/browse/SHOP-123' && chip.target === '_blank'
        && document.querySelector('#requirements-host .req-export-done')?.textContent === 'Created SHOP-123'
        && /^Exported to Jira as SHOP-123 · /.test(document.querySelector('#requirements-host .req-history li span')?.textContent || ''); })()`), 15000));
  check('A6: the page behind is not inert once the dialog is closed', (await inertNow()) === inertBefore);
  await A.evalJs(`window.scrollTo(0, 0)`);
  await shot('a6-board28-created');
  const pageSels = ['#requirements-host .req-export-chip', '#requirements-host .req-export-done', '#requirements-host .req-history'];
  const pageAA = await contrastBoth(pageSels, 'a6-board30-page-dark');
  check('A6: the ticket chip, "Created SHOP-123" and the History card are AA in light and dark', pageAA.light.length === 0 && pageAA.dark.length === 0, JSON.stringify(pageAA));
  await A.evalJs(`fetch('/api/requirements/${f6.seq}/criteria', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'An order with some items shipped can cancel only the items not yet picked up.' }) })`);
  await until(() => A.evalJs(`!!document.querySelector('#requirements-host [data-criterion="R-po-2"]')`), 10000);
  await openExportMenu();
  check('A6 board 28: Export again: three choices with Update first; what changed lists Added R-po-2',
    await until(() => A.evalJs(`(() => { const d = ${DLG}; if (!d || d.querySelector('h2').textContent !== 'Export FEAT-${f6.seq} again') return false;
      return d.querySelector('[data-ui="again-update"]')?.checked === true && !d.querySelector('[data-ui="again-comment"]').disabled
        && [...d.querySelectorAll('.req-export-change')].some((p) => p.textContent.startsWith('Added R-po-2 ')); })()`), 15000));
  await shot('a6-board28-again');
  const againAA = await contrastBoth(['.req-dlg-wrap .req-export']);
  check('A6 board 28: the text of Export again is AA in light and dark', againAA.light.length === 0 && againAA.dark.length === 0, JSON.stringify(againAA));
  await A.evalJs(`(() => { document.querySelector('[data-ui="again-comment"]').click(); document.querySelector('[data-ui="again-continue"]').click(); })()`);
  check('A6 board 28: the comment is shown before it is sent',
    await until(() => A.evalJs(`(() => { const d = ${DLG}; const box = d && d.querySelector('[aria-label="Comment preview"]'); if (!box || !box.querySelector('p')) return false;
      return d.querySelector('h2').textContent === 'Comment on SHOP-123' && box.querySelector('p').textContent.startsWith('Updated in Worca since the last export (')
        && [...box.querySelectorAll('p')].some((p) => p.textContent.startsWith('Added R-po-2 ')); })()`), 15000));
  await shot('a6-board28-comment');
  await A.evalJs(`document.querySelector('[data-ui="comment-add"]').click()`);
  check('A6: Add comment: the dialog closes, "Commented on SHOP-123", the History card leads with it',
    await until(() => A.evalJs(`!${DLG} && document.querySelector('#requirements-host .req-export-done')?.textContent === 'Commented on SHOP-123'
      && (document.querySelector('#requirements-host .req-history li span')?.textContent || '').startsWith('Commented on SHOP-123 in Jira · ')`), 15000));
  // Export anyway (D5), then the same preview at 390 px (board 31)
  const half = store.createFeature({ scopeType: 'project', scopeKey: projKey, title: 'Cancel part of an order', description: 'Some items only' });
  store.updateFeature(half.seq, { status: 'done', spec: { ...spec, openQuestions: ['Who pays the return shipping?'] } });
  const halfHash = `#requirements/feature/${half.seq}`;
  await A.evalJs(`location.hash = ${JSON.stringify(halfHash)}`);
  await until(() => A.evalJs(`document.querySelector('#requirements-host [data-req-feature]')?.getAttribute('data-req-feature') === '${half.seq}'`), 15000);
  await openExportMenu();
  check('A6 board 27: a feature that is not Ready asks first, the focus in the reason; Export anyway waits for one',
    await until(() => A.evalJs(`(() => { const d = ${DLG}; return !!d && d.querySelector('h2').textContent === 'Export FEAT-${half.seq} before it’s Ready?'
      && document.activeElement === d.querySelector('[data-ui="export-reason"]') && d.querySelector('[data-ui="export-anyway"]').disabled; })()`), 10000));
  await shot('a6-board27-not-ready');
  await A.evalJs(`(() => { const a = document.querySelector('[data-ui="export-reason"]'); a.value = 'The team estimates in Jira tomorrow.';
    a.dispatchEvent(new Event('input')); document.querySelector('[data-ui="export-anyway"]').click(); })()`);
  check("A6 D5: Export anyway: the preview's description starts with the reason",
    await until(() => A.evalJs(`(${DLG}?.querySelector('.req-export-desc p')?.textContent || '') === 'Exported before Ready: The team estimates in Jira tomorrow.'`), 15000));
  await shot('a6-board27-export-anyway');
  await A.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  // the 900 px rule has taken over: the wrap is the sheet's and the dialog is fixed to the viewport
  await until(() => A.evalJs(`(() => { const d = ${DLG}; return window.innerWidth === 390 && !!d && d.parentElement.classList.contains('req-dlg-sheet')
    && getComputedStyle(d).position === 'fixed' && Math.round(d.getBoundingClientRect().width) === document.documentElement.clientWidth; })()`), 5000);
  const sheet = await A.evalJs(`(() => { const d = ${DLG}; const r = d.getBoundingClientRect();
    const back = d.querySelector('[data-ui="export-back"]'); const more = d.querySelector('[data-ui="export-more"]');
    const sub = d.querySelector('.req-export-sub');
    const others = [...document.body.children].filter((el) => !el.classList.contains('req-dlg-wrap'));
    return { fixed: getComputedStyle(d).position === 'fixed', left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width),
      vw: document.documentElement.clientWidth, height: Math.round(r.height), vh: window.innerHeight,
      back: back && getComputedStyle(back).display !== 'none' ? back.getAttribute('aria-label') : null,
      title: d.querySelector('h2').innerText.trim(), sub: sub && getComputedStyle(sub).display !== 'none' ? sub.innerText.trim() : null,
      more: !!more && getComputedStyle(more).display !== 'none', folded: d.querySelector('.req-export-desc').getBoundingClientRect().height <= 182,
      inert: others.every((el) => el.hasAttribute('inert')), noScroll: document.documentElement.scrollWidth === document.documentElement.clientWidth }; })()`);
  check('A6 board 31: at 390 px a full-screen sheet (the viewport, not its content) with ← FEAT-n and Show all; the page behind is inert',
    sheet.fixed && sheet.left === 0 && sheet.top === 0 && sheet.width === sheet.vw && sheet.height === sheet.vh && sheet.back === `Back to FEAT-${half.seq}`
      && sheet.more && sheet.folded && sheet.inert && sheet.noScroll, JSON.stringify(sheet));
  check('A6 board 31: the phone title reads "Export to Jira" over "FEAT-n · <title>"',
    sheet.title === 'Export to Jira' && sheet.sub === `FEAT-${half.seq} · Cancel part of an order`, JSON.stringify({ title: sheet.title, sub: sheet.sub }));
  // 390 x 844: the sheet's buttons (Cancel, Create in Jira) are on the screen as it opens, and nothing covers them
  const sheetBtns = await A.evalJs(`(() => { const d = ${DLG}; const vw = document.documentElement.clientWidth; const vh = window.innerHeight;
    return ['export-cancel', 'export-go'].map((u) => { const b = d.querySelector('[data-ui="' + u + '"]'); const r = b.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { u, box: [r.left, r.top, r.right, r.bottom].map(Math.round), inside: r.left >= 0 && r.top >= 0 && r.right <= vw && r.bottom <= vh,
        onTop: !!top && b.contains(top) }; }); })()`);
  check('A6 board 31: at 390 x 844 the sheet fits the screen with Cancel and Create in Jira visible at the bottom',
    sheetBtns.every((b) => b.inside && b.onTop), JSON.stringify(sheetBtns));
  const small = await A.evalJs(`(() => { const d = ${DLG}; ${HIT_FN}
    return [...d.querySelectorAll('.btn, .req-export-x, .req-export-back')].filter((b) => b.offsetParent !== null)
      .map((b) => [b, hit(b)]).filter(([b, s]) => s.hh < 44 || (b.classList.contains('req-export-x') && s.ww < 44))
      .map(([b, s]) => (b.getAttribute('data-ui') || b.className) + ':' + Math.round(s.hh) + 'x' + Math.round(s.ww)); })()`);
  check('A6 D20: every button of the sheet is a 44 px target (the label remove buttons 44 px wide too)', small.length === 0, JSON.stringify(small));
  await shot('a6-board31-phone-sheet');
  const walkPhone = await tabWalk(16);
  check('A6 D20: on the 390 px sheet Tab and Shift+Tab stay inside it (Shift+Tab from the title wraps to Create in Jira)',
    walkPhone.out.length === 0 && walkPhone.back.el === 'export-go', JSON.stringify({ back: walkPhone.back, fwd: walkPhone.fwd.map((t) => t.el) }));
  await A.evalJs(`document.querySelector('[data-ui="export-more"]').click()`);
  check('A6 board 31: Show all unfolds the description',
    await A.evalJs(`!${DLG}.querySelector('.req-export-desc').classList.contains('folded') && ${DLG}.querySelector('[data-ui="export-more"]').hidden`));
  await shot('a6-board31-phone-show-all');
  const phoneAA = await contrastBoth(['.req-dlg-wrap .req-export'], 'a6-board31-phone-dark');
  check('A6 board 31: the text of the sheet is AA in light and dark', phoneAA.light.length === 0 && phoneAA.dark.length === 0, JSON.stringify(phoneAA));
  await A.evalJs(`location.hash = '#runs'`);
  check('A6 D20: leaving the Requirements view closes the sheet and puts the page back (nothing left inert)',
    await until(async () => !(await A.evalJs(`!!${DLG}`)) && (await inertNow()) === inertBefore, 8000));
  // 390 px, the other export controls: the header's ticket chip, and a state's own button in a sheet (Export again's Try
  // again, a .btn-sm) beside the sheet's Back, Cancel and Continue
  await A.evalJs(`location.hash = ${JSON.stringify(f6Hash)}`);
  await until(() => A.evalJs(`!!document.querySelector('#requirements-host [data-ui="export-chip"]')`), 15000);
  const chipHit = await A.evalJs(`(() => { ${HIT_FN} return Math.round(hit(document.querySelector('#requirements-host [data-ui="export-chip"]')).hh); })()`);
  setMockSourceResponses({ ticketState: unreachable });
  await openExportMenu();
  await until(() => A.evalJs(`!!${DLG}?.querySelector('[data-ui="again-retry"]')`), 15000);
  const stateHits = await A.evalJs(`(() => { const d = ${DLG}; ${HIT_FN}
    return [...d.querySelectorAll('.btn, .req-export-back')].filter((b) => b.offsetParent !== null)
      .map((b) => [b.getAttribute('data-ui') || b.className, Math.round(hit(b).hh)]); })()`);
  setMockSourceResponses({});
  check("A6 D20: at 390 px the ticket chip and a state's Try again (with Back, Cancel and Continue) are 44 px targets",
    chipHit >= 44 && stateHits.every(([, hh]) => hh >= 44) && stateHits.some(([u]) => u === 'again-retry'), JSON.stringify({ chipHit, stateHits }));
  await A.evalJs(`document.querySelector('[data-ui="again-cancel"]').click()`);
  await until(() => A.evalJs(`!${DLG}`), 5000);
  await A.send('Emulation.clearDeviceMetricsOverride');
  await until(() => A.evalJs(`window.innerWidth > 900`), 5000);   // the desktop layout again

  // Board 29 (1): Jira cannot be reached when the ticket is sent: the sentence, the note, Try again; nothing recorded.
  await A.evalJs(`location.hash = ${JSON.stringify(halfHash)}`);
  await until(() => A.evalJs(`document.querySelector('#requirements-host [data-req-feature]')?.getAttribute('data-req-feature') === '${half.seq}'`), 15000);
  await openExportMenu();
  await until(() => A.evalJs(`!!${DLG}?.querySelector('[data-ui="export-reason"]')`), 10000);
  await A.evalJs(`(() => { const a = document.querySelector('[data-ui="export-reason"]'); a.value = 'The team estimates in Jira tomorrow.';
    a.dispatchEvent(new Event('input')); document.querySelector('[data-ui="export-anyway"]').click(); })()`);
  await until(() => A.evalJs(`(() => { const g = ${DLG}?.querySelector('[data-ui="export-go"]'); return !!g && !g.disabled && g.textContent === 'Create in Jira'; })()`), 15000);
  setMockSourceResponses({ createTicket: unreachable });
  await A.evalJs(`document.querySelector('[data-ui="export-go"]').click()`);
  const NOTE = 'Nothing was recorded. The preview stays open, so you can try again once the connection is fixed on the Marketplace page (Installed › Jira).';
  check('A6 board 29 (1): Jira cannot be reached: "Worca could not reach Jira: the API token was refused.", the note and Try again; the preview stays open, no ticket',
    await until(() => A.evalJs(`(() => { const d = ${DLG}; if (!d) return false; const go = d.querySelector('[data-ui="export-go"]');
      return d.querySelector('.req-export-alert')?.textContent === 'Worca could not reach Jira: the API token was refused.'
        && d.querySelector('.req-export-alert-hint')?.textContent === ${JSON.stringify(NOTE)} && !d.querySelector('.req-export-alert-hint').hidden
        && go.textContent === 'Try again' && !go.disabled && !!d.querySelector('.req-export-desc h4')
        && !document.querySelector('#requirements-host [data-ui="export-chip"]'); })()`), 15000));
  // Board 29 (1): the alert, then Cancel and Try again, then the note under them.
  const notePos = await A.evalJs(`(() => { const d = ${DLG}; const n = d.querySelector('.req-export-alert-hint').getBoundingClientRect();
    const b = d.querySelector('.req-export-foot .req-dlg-btns').getBoundingClientRect(); const a = d.querySelector('.req-export-alert').getBoundingClientRect();
    return { alertBottom: Math.round(a.bottom), buttonsTop: Math.round(b.top), buttonsBottom: Math.round(b.bottom), noteTop: Math.round(n.top) }; })()`);
  check('A6 board 29 (1): the alert sits above Cancel and Try again, and "Nothing was recorded…" under them',
    notePos.alertBottom <= notePos.buttonsTop && notePos.noteTop >= notePos.buttonsBottom, JSON.stringify(notePos));
  const rules = await A.evalJs(`(() => { const d = ${DLG}; const foot = d.querySelector('.req-export-foot');
    return { foot: getComputedStyle(foot).borderTopWidth, buttons: getComputedStyle(foot.querySelector('.req-dlg-btns')).borderTopWidth }; })()`);
  check('A6: on a desktop one rule sits above the preview footer (its own), none above its buttons', rules.foot === '1px' && rules.buttons === '0px', JSON.stringify(rules));
  await A.evalJs(`document.querySelector('.req-dlg-wrap .req-export-alert').scrollIntoView({ block: 'center' })`);
  await shot('a6-board29-unreachable');
  const stateAA = await contrastBoth(['.req-dlg-wrap .req-export'], 'a6-board29-unreachable-dark');
  check('A6 board 29: the failure state is AA in light and dark', stateAA.light.length === 0 && stateAA.dark.length === 0, JSON.stringify(stateAA));
  setMockSourceResponses({});
  // Try again right away, the connection fixed: a refused token means Jira made no ticket, so there is nothing to wait for
  // (the search grace of D10 is for a create whose outcome is unknown) and the ticket is made.
  await A.evalJs(`document.querySelector('[data-ui="export-go"]').click()`);
  let retryState = null;
  check('A6 board 29 (1): Try again right after a refused token makes the ticket (no "still checking" wait): Created SHOP-124',
    await until(async () => {
      retryState = await A.evalJs(`(() => { const d = ${DLG}; return d ? { open: true, alert: d.querySelector('.req-export-alert')?.textContent || '' }
        : { open: false, done: document.querySelector('#requirements-host .req-export-done')?.textContent || '' }; })()`);
      return !retryState.open && retryState.done === 'Created SHOP-124';
    }, 15000), JSON.stringify(retryState));
  if (await A.evalJs(`!!${DLG}`)) await A.evalJs(`document.querySelector('[data-ui="export-cancel"]').click()`);
  await until(() => A.evalJs(`!${DLG}`), 5000);

  // Board 29 (1) on a preview that LOADS (Update asks Jira for the ticket's state first): the sentence and Try again, without
  // "The preview stays open…" (no preview is shown yet).
  await A.evalJs(`location.hash = ${JSON.stringify(f6Hash)}`);
  await until(() => A.evalJs(`document.querySelector('#requirements-host [data-req-feature]')?.getAttribute('data-req-feature') === '${f6.seq}'`), 15000);
  await openExportMenu();
  await until(() => A.evalJs(`${DLG}?.querySelector('[data-ui="again-update"]')?.checked === true && !${DLG}.querySelector('[data-ui="again-continue"]').disabled`), 15000);
  setMockSourceResponses({ ticketState: unreachable });
  await A.evalJs(`document.querySelector('[data-ui="again-continue"]').click()`);
  let loadFail = null;
  check('A6 board 29 (1): a preview that cannot load (502) says why with Try again: no note about a preview it does not show, no empty Fields or description',
    await until(async () => {
      loadFail = await A.evalJs(`(() => { const d = ${DLG}; if (!d || !d.querySelector('.req-export-preview') && !d.classList.contains('req-export-preview')) return null;
        const go = d.querySelector('[data-ui="export-go"]'); const hint = d.querySelector('.req-export-alert-hint'); const grid = d.querySelector('.req-export-grid');
        return { alert: d.querySelector('.req-export-alert')?.textContent || '', note: hint && !hint.hidden ? hint.textContent : null,
          go: go.textContent, goDisabled: go.disabled, gridShown: getComputedStyle(grid).display !== 'none' && grid.getBoundingClientRect().height > 0 }; })()`);
      return !!loadFail && loadFail.alert === 'Worca could not reach Jira: the API token was refused.' && loadFail.go === 'Try again' && !loadFail.goDisabled
        && loadFail.note === null && loadFail.gridShown === false;
    }, 15000), JSON.stringify(loadFail));
  await shot('a6-board29-preview-load-failed');
  setMockSourceResponses({});
  await A.evalJs(`document.querySelector('[data-ui="export-go"]').click()`);
  check('A6 board 29 (1): Try again once Jira answers loads the preview (Update SHOP-123) with its Fields and description',
    await until(() => A.evalJs(`(() => { const d = ${DLG}; const go = d && d.querySelector('[data-ui="export-go"]');
      return !!go && go.textContent === 'Update SHOP-123' && !go.disabled && !!d.querySelector('.req-export-desc h4') && !d.querySelector('.req-export-alert').textContent
        && getComputedStyle(d.querySelector('.req-export-grid')).display === 'grid'; })()`), 15000));
  await A.evalJs(`document.querySelector('[data-ui="export-cancel"]').click()`);
  await until(() => A.evalJs(`!${DLG}`), 5000);

  // Start with Report back (D15): the run's pipeline row names the ticket; write-back reports to it (the mock records it)
  check('A6 D15: Ready to build shows Report back to SHOP-123, on, naming the status the connection moves it to',
    await until(() => A.evalJs(`(() => { const sw = document.querySelector('#requirements-host [data-ui="report-card"]'); if (!sw) return false;
      return sw.checked && sw.closest('label').textContent === 'Report back to SHOP-123'
        && /moves the ticket to Done/.test(document.getElementById(sw.getAttribute('aria-describedby')).textContent); })()`), 15000));
  await A.evalJs(`document.querySelector('#requirements-host .req-report').scrollIntoView({ block: 'center' })`);
  await shot('a6-board29-report-back');
  const reportAA = await contrastBoth(['#requirements-host .req-report']);
  check('A6 board 29 (6): the Report back row is AA in light and dark', reportAA.light.length === 0 && reportAA.dark.length === 0, JSON.stringify(reportAA));
  await A.evalJs(`document.querySelector('#requirements-host [data-ui="start-go"]').click()`);
  let started = null;
  check("A6 D15: Start with Report back: the run's pipeline row names the ticket (source_type plugin, its connection, writeBack yes)",
    await until(async () => {
      const v = await A.evalJs(`fetch('/api/requirements/${f6.seq}').then((r) => r.json())`);
      const runId = v.feature.starts && v.feature.starts[0] && v.feature.starts[0].runId;
      const pid = runId && runs.get(runId)?.orch?.pipeline?.id;
      if (!pid) return false;
      started = { runId, pid };
      const row = getDb().prepare('SELECT source_type, source_ref FROM pipelines WHERE id = ?').get(pid);
      const ref = row && row.source_ref ? JSON.parse(row.source_ref) : {};
      return row.source_type === 'plugin' && ref.taskId === 'SHOP-123' && ref.profile === 'acme' && ref.inputs?.writeBack === 'yes';
    }, 20000));
  if (started) {
    runs.get(started.runId)?.orch?.stop?.();
    await until(() => ['stopped', 'done', 'error', 'paused', 'interrupted'].includes(String(runs.get(started.runId)?.status || '')), 30000);
    const wb = await retryWriteback(started.pid);
    const last = JSON.parse(readPluginState('jira-source', 'acme').lastReport || '{}');
    check('A6 D15: the run reports back to SHOP-123 through the existing write-back', wb.ok === true && last.id === 'SHOP-123', JSON.stringify({ wb, last }));
  }
  for (const r of runs.values()) { try { r.orch?.stop?.(); } catch {} }
}
await sleep(1000);
check('no page errors', A.pageErrors.length === 0, A.pageErrors.join(' | '));
log(failed ? `${failed} check(s) failed` : 'all checks passed');
await shutdown(failed ? 1 : 0);
