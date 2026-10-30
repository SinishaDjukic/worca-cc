#!/usr/bin/env node
// tools/verify-ticket-updates-cdp.mjs — headless-Chrome proof of Ticket updates (plans/ticket-updates-design.md §12 Browser):
// mock mode (WORCA_MOCK=1), the ticketUpdates flag on, jira-source linked with one profile. Pick projects (a click and the
// keys: the focus stays in the popover's search box, Enter toggles the active row), add a project rule, pick a status, Save,
// reopen; New run's project select (source-pane.mjs's remote select, over POST /api/sources/call) holds only the picked ones;
// a mock write-back carries the move; contrast of the section, the open listbox and the open popover in light and dark;
// 390 px. Screenshots of boards 1, 3, 4 and 6, light and dark, go to TU_SHOTS (else a new temp folder), kept and printed at
// the end. NOT part of `npm test`.
// Run: node tools/verify-ticket-updates-cdp.mjs   (or: npm run verify:ticket-updates; set CHROME_BIN to a Chrome/Chromium
// binary if it is not auto-found, CDP_PORT when 9351 is taken)
//
// -- CI COVERAGE -------------------------------------------------------------
// .github/workflows/ci.yml job `cdp` runs this in its second group, after verify:requirements. What stays CDP-only: the real
// CSS (the 390 px layout, 44 px targets, AA contrast in both themes), the live server's routes in mock mode and the page-error
// gate. The modules' DOM shapes and behaviour are pinned in the jsdom tests of move-select, projects-popover and the section.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'];
const CHROME = process.env.CHROME_BIN || CHROME_PATHS.find((p) => existsSync(p)) || CHROME_PATHS[0];
const SANDBOX = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0 ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
if (!existsSync(CHROME)) { console.error(`no Chrome at ${CHROME} - set CHROME_BIN`); process.exit(1); }
const PORT = Number(process.env.CDP_PORT || 9351);
// The whole proof is bounded: a CDP call that never answers (Chrome gone) ends in a named failure and a cleanup, not a hang.
const WATCHDOG_MS = Number(process.env.TU_WATCHDOG_MS || 10 * 60_000);
const T0 = Date.now();
const log = (m) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}\n`);

let chrome = null; let srv = null; let home = null; let profile = null; let failed = 0; let SHOTS = ''; let closing = false;
const sockets = [];
async function shutdown(code) {
  if (closing) return;
  closing = true;
  for (const s of sockets) { try { s.close(); } catch {} }
  try { if (chrome) chrome.kill('SIGKILL'); } catch {}
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
profile = await mkdtemp(path.join(tmpdir(), 'worca-tu-profile-'));
chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--disable-gpu', '--use-mock-keychain', '--window-size=1400,1000', ...SANDBOX, 'about:blank'],
{ env: { ...process.env, ...REAL_ENV }, stdio: 'ignore' });
// Up to 30 s: a cold Chrome on a busy machine can take more than 10 s to open its endpoint.
let up = false;
for (let i = 0; i < 120 && !up; i += 1) {
  try { up = (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch { /* not listening yet */ }
  if (!up) await sleep(250);
}
if (!up) { log('no CDP endpoint'); await shutdown(1); }
const { WebSocket } = await import('ws');

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
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails?.exception?.description || 'exception');
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
async function openPage(url) {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!r.ok) throw new Error(`could not open a tab: HTTP ${r.status}`);
  return connect((await r.json()).webSocketDebuggerUrl);
}

const A = await openPage(`${base}/#marketplace/installed`);
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(60); } return false; };
const js = (body) => A.evalJs(`(() => { ${body} })()`);
const has = (sel) => js(`return !!document.querySelector(${JSON.stringify(sel)});`);
const click = (sel) => js(`const n = document.querySelector(${JSON.stringify(sel)}); if (!n) return false; n.click(); return true;`);
const textOf = (sel) => js(`return document.querySelector(${JSON.stringify(sel)})?.textContent ?? null;`);
/** Opens jira-source's manage sheet; true once a fresh section (not one left from an earlier opening) shows its rules. */
const openSheet = async () => {
  check('the jira-source row is listed', await until(() => has('button.mk-name[data-name="jira-source"]'), 20000));
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
const openMoveList = async () => {
  await reveal('#mk-sheet .mk-tu-rule[data-project="SHOP"]');
  await click(SHOP_MOVE);
  return until(resolvedShown, 15000);
};
const closeMoveList = () => js(`const b = document.querySelector(${JSON.stringify(SHOP_MOVE)});
  b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); return !document.querySelector('.mk-tu-movepop');`);
const sixRows = () => js(`return document.querySelectorAll('.mk-tu-projpop .mk-tu-prow').length === 6;`);
const openPopover = async () => {
  await reveal('#mk-sheet .mk-tu-add-projects');
  await click('#mk-sheet .mk-tu-add-projects');
  return until(sixRows, 15000);
};
/** A key pressed in the popover's search box (the focus stays there, §11 listbox model). */
const keyInSearch = (key) => js(`const q = document.querySelector('.mk-tu-projpop .mk-tu-search');
  q.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true })); return true;`);

// ---- pick projects (board 3): SHOP with a click on its row, CRM with the keys ----
check('the manage sheet shows Ticket updates', await openSheet());
check('its header names the connection', (await textOf('#mk-sheet .mk-tu-head .mk-meta')) === 'Acme (acme)');
check('the projects popover lists the six projects', await openPopover());
check('the focus is in the popover\'s search box', await js(`return document.activeElement === document.querySelector('.mk-tu-projpop .mk-tu-search');`));
await click('.mk-tu-projpop .mk-tu-prow[data-value="SHOP"]');   // a click toggles the row and makes it the active one
await keyInSearch('ArrowDown');   // CRM, the row after SHOP
await keyInSearch('Enter');
check('SHOP (a click) and CRM (ArrowDown, Enter) are picked', await js(`const sel = (v) => document.querySelector('.mk-tu-projpop .mk-tu-prow[data-value="' + v + '"]')?.getAttribute('aria-selected');
  return sel('SHOP') === 'true' && sel('CRM') === 'true' && sel('OPS') === 'false';`));
check('the focus stayed in the search box', await js(`return document.activeElement === document.querySelector('.mk-tu-projpop .mk-tu-search');`));
check('the footer counts the picks', (await textOf('.mk-tu-pcount')) === '2 picked · 6 projects on Acme', await textOf('.mk-tu-pcount'));
await click('.mk-tu-projpop .mk-tu-done');
check('Done closes the popover', !(await has('.mk-tu-projpop')));
check('two chips, SHOP and CRM', await js(`return [...document.querySelectorAll('#mk-sheet .mk-tu-chip')].map((c) => c.dataset.value).join() === 'SHOP,CRM';`));

// ---- a project rule with one of its statuses (board 4) ----
await click('#mk-sheet .mk-tu-add-rule');
check('the new row has a Project select', await until(() => has('#mk-sheet .mk-tu-project')));
check('its Project select offers only SHOP and CRM', await until(() => js(`const s = document.querySelector('#mk-sheet .mk-tu-project');
  return [...s.options].filter((o) => o.value).map((o) => o.value).join() === 'SHOP,CRM';`)));
// a mouse pick (no key before the change) commits at once; a pick with the keys would wait for Enter or blur
await js(`const s = document.querySelector('#mk-sheet .mk-tu-project'); s.value = 'SHOP'; s.dispatchEvent(new Event('change', { bubbles: true })); return true;`);
check('the row became the SHOP rule', await until(() => has('#mk-sheet .mk-tu-rule[data-project="SHOP"]')));
check("SHOP's statuses load into the listbox", await openMoveList());
await js(`[...document.querySelectorAll('.mk-tu-movepop [role="option"]')].find((o) => o.querySelector('.mk-tu-opt-t')?.textContent === 'Resolved').click(); return true;`);
check('the select shows Resolved', await until(async () => (await textOf(`${SHOP_MOVE} .mk-tu-move-t`)) === 'Resolved'), await textOf(`${SHOP_MOVE} .mk-tu-move-t`));

// ---- contrast, light and dark: the section (boards 1, 2), the open listbox (board 4), the open popover (board 3) ----
await reveal('#mk-sheet .mk-tu', 'start');
aa('the section', await contrastBoth(['#mk-sheet .mk-tu'], 'board1-section'));
check('the move listbox opens with the statuses', await openMoveList());
aa('the open move listbox', await contrastBoth(['.mk-tu-movepop'], 'board4-listbox'));
check('Esc closes the listbox', await closeMoveList());
check('the projects popover opens', await openPopover());
aa('the open projects popover', await contrastBoth(['.mk-tu-projpop'], 'board3-popover'));
await click('.mk-tu-projpop .mk-tu-done');

// ---- 390 px (board 6) ----
await setTheme('light');
await A.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await sleep(400);
const phone = await js(`const row = document.querySelector('#mk-sheet .mk-tu-rule[data-project="SHOP"]'); const sel = row.querySelector('.mk-tu-movewrap');
  const r = row.getBoundingClientRect(); const s = sel.getBoundingClientRect(); const name = row.querySelector('.mk-tu-name').getBoundingClientRect();
  const x = document.querySelector('#mk-sheet .mk-tu-x').getBoundingClientRect();
  const buttons = [...document.querySelectorAll('#mk-sheet .mk-tu .btn, #mk-sheet .mk-tu-move')].filter((b) => b.getClientRects().length);
  return { below: s.top >= name.bottom - 1, wide: s.width >= r.width - 40, tall: buttons.every((b) => b.getBoundingClientRect().height >= 44),
    short: buttons.filter((b) => b.getBoundingClientRect().height < 44).map((b) => b.className + ' ' + Math.round(b.getBoundingClientRect().height)),
    x: Math.round(x.width), scroll: document.documentElement.scrollWidth <= window.innerWidth };`);
check('390 px: the select sits below the name at full width', phone.below && phone.wide, JSON.stringify(phone));
check('390 px: every button and select is 44 px tall; the chip × is 32 px', phone.tall && phone.x === 32, JSON.stringify(phone));
check('390 px: no sideways scroll', phone.scroll);
await reveal('#mk-sheet .mk-tu-rule[data-project="SHOP"]');
aa('390 px: the section', await contrastBoth(['#mk-sheet .mk-tu'], 'board6-phone'));
check('390 px: the listbox opens', await openMoveList());
const optH = await js(`return [...document.querySelectorAll('.mk-tu-movepop [role="option"]')].map((o) => Math.round(o.getBoundingClientRect().height));`);
check('390 px: every listbox option is 44 px tall', optH.length > 0 && optH.every((h) => h >= 44), JSON.stringify(optH));
aa('390 px: the open move listbox', await contrastBoth(['.mk-tu-movepop'], 'board6-phone-listbox'));
check('390 px: Esc closes the listbox', await closeMoveList());
check('390 px: the popover opens', await openPopover());
const rowH = await js(`return [...document.querySelectorAll('.mk-tu-projpop .mk-tu-prow')].map((r) => Math.round(r.getBoundingClientRect().height));`);
check('390 px: every popover row is 44 px tall', rowH.length === 6 && rowH.every((h) => h >= 44), JSON.stringify(rowH));
check('390 px: the popover fits the screen', await js(`const b = document.querySelector('.mk-tu-projpop').getBoundingClientRect(); return b.left >= 0 && b.right <= window.innerWidth;`));
aa('390 px: the open projects popover', await contrastBoth(['.mk-tu-projpop'], 'board6-phone-popover'));
await click('.mk-tu-projpop .mk-tu-done');
await A.send('Emulation.clearDeviceMetricsOverride');
await sleep(300);

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
