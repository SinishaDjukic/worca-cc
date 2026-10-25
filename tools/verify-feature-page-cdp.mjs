#!/usr/bin/env node
// tools/verify-feature-page-cdp.mjs — headless-Chrome proof of Shaper's feature views (D16, D17): a 3-slice
// feature is ONE open row in the Runs list (members "1 · …", no row of its own for slice 2's run, the row links to
// #feature/ID), and #feature/ID renders the full-width page (one segmented bar and no stage bar, "merge first", the rare
// actions in ⋯ with Approve each unchecked, the halted line in amber), and both views pass the one-button-style audit
// (tools/button-audit.mjs) in light and dark. The unified page head (docs/design-system.md Navigation): the top bar's
// breadcrumb and up link, the title row and one tab strip on the group page, a saved member run and a live mock run, at
// 1440, 700 and 375px, light and dark. NOT part of `npm test`: it needs Chrome. Screenshots land in a temp dir; their
// paths are printed.
// Run: node tools/verify-feature-page-cdp.mjs   (or: npm run verify:feature-page)
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { auditButtons, auditType, BUTTON_SPEC, TYPE_SPEC } from './button-audit.mjs';
import { auditGroupPageLayout } from './runs-layout-audit.mjs';

const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
const CHROME = process.env.CHROME_BIN || CHROME_PATHS.find((p) => existsSync(p)) || CHROME_PATHS[0];
const SANDBOX = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0
  ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
if (!existsSync(CHROME)) { console.error(`no Chrome at ${CHROME} - set CHROME_BIN`); process.exit(1); }
const PORT = Number(process.env.CDP_PORT || 9336);
const T0 = Date.now();
const log = (m) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}\n`);

let chrome = null; let srv = null; let home = null; let proj = null; let profile = null; let failed = 0;
async function shutdown(code) {
  try { if (chrome) chrome.kill('SIGKILL'); } catch {}
  try { if (srv) await new Promise((r) => srv.close(r)); } catch {}
  for (const d of [home, proj, profile]) { try { if (d) await rm(d, { recursive: true, force: true }); } catch {} }
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection']) {
  process.on(sig, (e) => { if (e && e.stack) console.error(e.stack); shutdown(1); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (ok, what) => { if (ok) log(`ok   ${what}`); else { failed += 1; log(`FAIL ${what}`); } };

// ---- a sandboxed HOME (settings live there) and WORCA_HOME (the DB), the flag on, then the server in process.
home = await mkdtemp(path.join(tmpdir(), 'worca-fp-home-'));
process.env.HOME = home; process.env.USERPROFILE = home;
process.env.WORCA_HOME = path.join(home, '.worca-cc');
process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
process.env.WORCA_MOCK = '1';
process.env.WORCA_FLAGS = 'shapeFirst';
proj = await mkdtemp(path.join(tmpdir(), 'worca-fp-proj-'));
for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'proof@worca.local'], ['config', 'user.name', 'proof']]) execFileSync('git', a, { cwd: proj });
await writeFile(path.join(proj, 'README.md'), '# feature page proof\n');
execFileSync('git', ['add', '-A'], { cwd: proj });
execFileSync('git', ['commit', '-qm', 'init'], { cwd: proj });
const { server, runs: liveRuns } = await import(new URL('../ui/server.mjs', import.meta.url).href);
const { getDb } = await import(new URL('../src/core/db.mjs', import.meta.url).href);
const { projectKey } = await import(new URL('../src/core/store.mjs', import.meta.url).href);
const { writeStoreMeta } = await import(new URL('../src/core/artifacts.mjs', import.meta.url).href);
const { createSliceFeature } = await import(new URL('../src/core/shape/features.mjs', import.meta.url).href);
srv = server;
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
{ const r = await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uiLevel: 'expert' }) });
  if (!r.ok) throw new Error(`could not pin the interface mode: HTTP ${r.status}`); }

// ---- the feature: slice 1 done, slice 2's ticket fired to a paused run, slice 3 waiting.
const key = projectKey(proj);
writeStoreMeta(key, 'project', { key, name: 'Proof', path: proj });
const now = new Date().toISOString();
const pipeline = (id, status, title, branch) => getDb().prepare(`INSERT INTO pipelines (id, project_key, target, title, status, phase,
  cycle, started_at, updated_at, total_cost_usd, total_active_ms, branch) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run(id, key, 'project', title, status, status, 0, now, now, 0, 0, JSON.stringify(branch));
const sl = (n, title) => ({ id: `s${n}`, title, goal: `Goal ${n}`, inScope: [], outOfScope: [], acceptance: [`ok ${n}`], dependsOn: [], estimate: 'M' });
const TITLES = ['Store tags', 'Run tags', 'Cost report'];
pipeline('fp000001', 'done', 'Run tags and cost allocation · 1/3: Store tags', { source: 'main', feature: 'feat/fp1' });
getDb().prepare("UPDATE pipelines SET pr_url = 'https://github.com/o/r/pull/1', pr_state = 'OPEN' WHERE id = 'fp000001'").run();
const f = createSliceFeature({ pipelineId: 'fp000001', projectDir: proj, title: 'Run tags and cost allocation',
  outline: { why: 'proof', slices: TITLES.map((t, i) => sl(i + 1, t)) }, perspectives: ['product'], workflowId: 'wf_shape' });
pipeline('fp000002', 'paused', 'Run tags and cost allocation · 2/3: Run tags', { source: 'feat/fp1', feature: 'feat/fp2' });
const t2 = getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = 2').get(f.id).ticket_id;
getDb().prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = 'fp000002' WHERE id = ?").run(t2);
log(`server ${base} · feature ${f.id}`);

// ---- chrome + cdp
profile = await mkdtemp(path.join(tmpdir(), 'worca-fp-profile-'));
chrome = spawn(CHROME, ['--headless=new', ...SANDBOX, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1280,900', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--use-mock-keychain', 'about:blank'],
{ stdio: ['ignore', 'pipe', 'pipe'] });
let wsUrl = null;
const deadline = Date.now() + 60_000;
while (!wsUrl && Date.now() < deadline) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(200);
  } catch { await sleep(250); }
}
if (!wsUrl) { console.error('no devtools target after 60s'); await shutdown(1); }
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id != null) { const p = pending.get(m.id); pending.delete(m.id); if (p) (m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result)); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
};
function cdp(method, params = {}, ms = 15000) {
  const id = ++msgId;
  return new Promise((res, rej) => {
    const to = setTimeout(() => { pending.delete(id); rej(new Error(`CDP TIMEOUT ${method}`)); }, ms);
    pending.set(id, { res: (v) => { clearTimeout(to); res(v); }, rej: (er) => { clearTimeout(to); rej(er); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`EVAL: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}\n${expr}`);
  return r.result.value;
}
async function waitFor(expr, what, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await ev(expr)) return true; await sleep(150); }
  throw new Error(`timed out waiting for ${what}`);
}
// The one-button-style audit (runs-redesign spec §5.2) in light, then dark; the page's own theme is put back after.
const BUTTON_AUDIT = `(${auditButtons})(document.body, ${JSON.stringify(BUTTON_SPEC)}, null)`;
// D23: every visible text on the type scale (docs/design-system.md › Type).
const TYPE_AUDIT = `(${auditType})(document.body, ${JSON.stringify(TYPE_SPEC)}, null)`;
async function auditButtonsBoth(where) {
  const before = await ev('document.documentElement.dataset.theme || ""');
  for (const theme of ['light', 'dark']) {
    await ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)};0`);
    const bad = await ev(BUTTON_AUDIT);
    check(bad.length === 0, `${where}, ${theme}: every button is .btn in 3 sizes x 4 variants${bad.length ? ` — ${JSON.stringify(bad.slice(0, 12))}` : ''}`);
    const offType = await ev(TYPE_AUDIT);
    check(offType.length === 0, `${where}, ${theme}: every text is on the type scale${offType.length ? ` — ${JSON.stringify(offType.slice(0, 12))}` : ''}`);
  }
  await ev(`document.documentElement.dataset.theme=${JSON.stringify(before)};0`);
}
async function shot(name) {
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  const file = path.join(tmpdir(), `worca-feature-page-${name}-${Date.now()}.png`);
  await writeFile(file, Buffer.from(data, 'base64'));
  return file;
}
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

// ---- the Runs list
await cdp('Page.navigate', { url: `${base}/#runs` });
await waitFor("document.querySelectorAll('#runs-list .runs-item[data-level=\"top\"][data-row-key^=\"chain:\"]').length === 1", 'the feature row');
const runs = await ev(`(() => {
  const host = document.getElementById('runs-list');
  const row = host.querySelector('.runs-item[data-level="top"][data-row-key^="chain:"]');
  const link = row.querySelector(':scope > a.runs-row');
  return {
    chains: host.querySelectorAll('.runs-item[data-level="top"][data-row-key^="chain:"]').length,
    title: link.textContent,
    href: link.getAttribute('href'),
    open: row.querySelector(':scope > .runs-row-tail .runs-expand').getAttribute('aria-expanded') === 'true',
    members: [...row.querySelectorAll(':scope > .runs-members > .runs-item > a.runs-row > .runs-row-title')].map((a) => a.textContent),
    ownRow: [...host.querySelectorAll('.runs-item[data-level="top"]')].filter((r) => !r.dataset.rowKey.startsWith('chain:') && /2\\/3/.test(r.textContent)).length,
  };
})()`);
check(runs.chains === 1, 'one feature row');
check(runs.title.includes('Run tags and cost allocation'), `the row names the feature (${runs.title.slice(0, 80)})`);
check(runs.href === `#feature/${f.id}`, `the row links to the feature page (${runs.href})`);
check(runs.open, 'the row is open by default');
check(JSON.stringify(runs.members) === JSON.stringify(['1 · Store tags', '2 · Run tags', '3 · Cost report']), `members ${JSON.stringify(runs.members)}`);
check(runs.ownRow === 0, 'no separate row for slice 2\'s run');
await auditButtonsBoth('the Runs list');
const runsShot = await shot('runs');

// ---- run 3 (D1-D6): the group page opens in the Runs pane beside the list, and a member run opens beside it too.
await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await ev(`localStorage.removeItem('worca-cc.runs.last');0`);   // the bare list: no remembered page reopens over it
await cdp('Page.navigate', { url: `${base}/?w=1440#runs` });
await waitFor("!!document.querySelector('#runs-list .runs-item[data-level=\"top\"][data-row-key^=\"chain:\"] > a.runs-row')", 'the feature row at 1440');
await ev(`document.querySelector('#runs-list .runs-item[data-level="top"][data-row-key^="chain:"] > a.runs-row').click();0`);
await waitFor("!!document.querySelector('#runs-pane[data-kind=\"group\"] #group-detail .gpage .run-members.is-table')", 'the group page in the pane');
// The trail lives in the top bar (docs/design-system.md Navigation): it ends at the parent; the page is the h1.
const TRAIL = `[...document.querySelectorAll('#topnav-crumbs:not([hidden]) .nav-trail a')].map((c) => c.textContent)`;
const inPane = await ev(`(() => {
  const row = document.querySelector('#runs-list .runs-item[data-level="top"][data-row-key^="chain:"] > a.runs-row');
  const pane = document.getElementById('runs-pane').getBoundingClientRect();
  return { listW: document.getElementById('runs-list-pane').offsetWidth, selected: row.classList.contains('selected'),
    current: row.getAttribute('aria-current'), kind: document.getElementById('runs-pane').dataset.kind,
    crumbs: ${TRAIL},
    h1Top: Math.round(document.querySelector('#group-detail .ph .rd-page-title').getBoundingClientRect().top - pane.top) };
})()`);
check(inPane.listW > 0 && inPane.selected && inPane.current === 'true', `PASS group page in the pane: the list stays and the feature row is .selected (${JSON.stringify(inPane)})`);
check(inPane.kind === 'group', `PASS group page in the pane: #runs-pane[data-kind="group"] (${inPane.kind})`);
check(JSON.stringify(inPane.crumbs) === JSON.stringify(['Runs']), `PASS group page in the pane: the top bar trail reads Runs (${JSON.stringify(inPane.crumbs)})`);
// Member 2 (the paused slice) from the group page's runs table: its run page opens beside the list.
await ev(`[...document.querySelectorAll('#group-detail .run-member-title')].find((a) => /Run tags$/.test(a.textContent)).click();0`);
await waitFor("!!document.querySelector('#runs-pane[data-kind=\"hist\"] #hist-detail .ph .rd-page-title')", 'member 2\'s run page');
await waitFor("document.querySelectorAll('#topnav-crumbs:not([hidden]) .nav-trail a').length === 2", 'the run page trail');
const member = await ev(`(() => {
  const row = document.querySelector('#runs-list .runs-item[data-level="top"][data-row-key^="chain:"] > a.runs-row');
  const pane = document.getElementById('runs-pane').getBoundingClientRect();
  return { open: row.classList.contains('member-open'), selected: row.classList.contains('selected'), current: row.getAttribute('aria-current'),
    crumbs: ${TRAIL},
    chip: document.querySelector('#hist-detail .rd-title-row .kind-chip').textContent,
    h1Top: Math.round(document.querySelector('#hist-detail .ph .rd-page-title').getBoundingClientRect().top - pane.top) };
})()`);
check(member.open && !member.selected && member.current === 'location', `PASS group page in the pane: a member open turns its group row member-open (${JSON.stringify(member)})`);
check(JSON.stringify(member.crumbs) === JSON.stringify(['Runs', 'Run tags and cost allocation']) && member.chip === 'Run 2 of 3',
  `PASS group page in the pane: the run page's trail reads Runs › the feature (the run is the h1), chip "Run 2 of 3" (${JSON.stringify(member.crumbs)}, ${member.chip})`);
check(Math.abs(inPane.h1Top - member.h1Top) <= 1,
  `PASS group page in the pane: the group page's head sits where the run page's does (h1 at ${inPane.h1Top} vs ${member.h1Top}px in the pane)`);
// A phone: the row tap slides the group page in, full screen; the top bar's up link is the way back; the list is inert.
await cdp('Emulation.setDeviceMetricsOverride', { width: 375, height: 800, deviceScaleFactor: 1, mobile: true });
await ev(`localStorage.removeItem('worca-cc.runs.last');0`);
await cdp('Page.navigate', { url: `${base}/?w=375#runs` });
await waitFor("!!document.querySelector('#runs-list .runs-item[data-level=\"top\"][data-row-key^=\"chain:\"] > a.runs-row')", 'the feature row at 375');
await ev(`document.querySelector('#runs-list .runs-item[data-level="top"][data-row-key^="chain:"] > a.runs-row').click();0`);
await waitFor("!!document.querySelector('#runs-pane[data-kind=\"group\"] #group-detail .gpage')", 'the group page at 375');
await sleep(600);   // the slide
const phone = await ev(`(() => { const up = document.querySelector('#topnav-crumbs .nav-up'); const p = document.getElementById('runs-pane').getBoundingClientRect();
  return { up: !!up && up.offsetWidth > 0, text: up ? up.textContent : '', chevron: !!(up && up.querySelector('svg')),
    trail: getComputedStyle(document.querySelector('#topnav-crumbs .nav-trail')).display, back: !!document.querySelector('.gpage-back'),
    inert: document.getElementById('runs-list-pane').hasAttribute('inert'), paneLeft: Math.round(p.left), paneW: Math.round(p.width) }; })()`);
check(phone.up && phone.text === 'Runs' && phone.chevron && phone.trail === 'none' && !phone.back && phone.inert && phone.paneLeft === 0,
  `PASS group page in the pane at 375px: full screen with the ‹ Runs up link in the top bar, the list inert (${JSON.stringify(phone)})`);
await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

// ---- the feature page: the group page's model block owns the head, status and members; its Overview tab holds Shaper's
// head-less view (log, ⋯, Ship card). The bundle merge (D12): one status line, at most one member list. Run 3 (D1): the
// page renders in the Runs pane (#group-detail), so "the page" is the pane, not a section of its own.
await cdp('Page.navigate', { url: `${base}/#feature/${f.id}/overview` });
const OV = '#runs-pane #group-detail .gpage-panel[data-tab="overview"] .shape-feature';
await waitFor(`!!document.querySelector('${OV}')`, 'the feature page');
// Run 1, run 4 (D17, D18): a pointer user gets no ring on the header ⋯ after the page opens; a real Tab brings the 2px ring back.
const HDR_MORE = '#runs-pane #group-detail .gpage-bar .gpage-more';
await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
await ev(`document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));0`);
const ringOpen = await ev(`(() => { const m = document.querySelector('${HDR_MORE}');
  return m && { mode: document.documentElement.dataset.input, outline: getComputedStyle(m).outlineStyle }; })()`);
check(!!ringOpen && ringOpen.mode === 'pointer' && ringOpen.outline === 'none', `no ring on load: the header ⋯ (${JSON.stringify(ringOpen)})`);
for (const type of ['keyDown', 'keyUp']) await cdp('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
const ringKey = await ev(`(() => { const m = document.querySelector('${HDR_MORE}'); m.focus(); const cs = getComputedStyle(m);
  return { mode: document.documentElement.dataset.input, style: cs.outlineStyle, width: cs.outlineWidth }; })()`);
check(ringKey.mode === 'keyboard' && ringKey.style === 'solid' && ringKey.width === '2px', `no ring on load: the header ⋯ shows a 2px solid ring after a key press (${JSON.stringify(ringKey)})`);
await ev(`document.activeElement && document.activeElement.blur && document.activeElement.blur(); document.documentElement.dataset.input = 'pointer'; 0`);
const page = await ev(`(() => {
  const el = document.querySelector('${OV}');
  const main = document.querySelector('#runs-pane');
  return {
    statusLines: main.querySelectorAll('.run-status-word').length,
    memberLists: main.querySelectorAll('ol.run-members').length,
    dupes: el.querySelectorAll('.shape-feature-head, .shape-feature-status, .shape-feature-runs, ol.chat-rc-members').length,
    replanButton: !!el.querySelector('[data-act="feature-replan"]'), more: !!el.querySelector('.shape-feature-more'),
    order: !!el.querySelector('.shape-feature-order'),
    ship: (document.querySelector('#runs-pane #group-detail .gpage-ship') || {}).textContent || '',
    width: el.getBoundingClientRect().width, mainWidth: main.getBoundingClientRect().width,
  };
})()`);
check(page.statusLines === 1, `one status line on the page (${page.statusLines})`);
check(page.memberLists <= 1, `at most one member list (${page.memberLists})`);
check(page.dupes === 0, 'the Shaper view draws no head, status, runs fold or member list');
check(page.replanButton && !page.more, 'halted: Re-plan the rest as a button, and the Overview draws no ⋯ of its own');
check(!page.order && page.ship.length > 0, `the Overview has no "Merge in order" line; the Runs tab keeps its .gpage-ship line (${JSON.stringify(page.ship)})`);
await ev(`document.querySelector('${HDR_MORE}').click();0`);
await waitFor("!!document.querySelector('.wfv-menu .wfv-menu-item')", 'the header ⋯ menu');
const hdrMenu = await ev(`[...document.querySelectorAll('.wfv-menu .wfv-menu-item')].map((b) => b.textContent)`);
check(['Re-plan the rest', 'Cancel the rest'].every((l) => hdrMenu.includes(l)), `the header ⋯ holds ${JSON.stringify(hdrMenu)}`);
check(page.width > 0.8 * page.mainWidth, `full width (${Math.round(page.width)} of ${Math.round(page.mainWidth)})`);
const pageShot = await shot('page');
// A second ⋯ click closes the menu (toggleMenu); a document-level Escape would not reach the menu's own keydown.
await ev(`document.querySelector('${HDR_MORE}').click(), !document.querySelector('.wfv-menu')`);
await auditButtonsBoth('the feature page');

// ---- the group page (runs redesign slice 4, D21): title row, status card, tabs and Runs table share their edges,
// and every row's Open ends at one x, at 290, 375 and 1440 in light and dark (QA 8: no row cells overlap at 290).
const LAYOUT_AUDIT = `(${auditGroupPageLayout})(document.querySelector('.gpage'), null, document)`;
for (const width of [290, 375, 1440]) {
  await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
  await cdp('Page.navigate', { url: `${base}/?w=${width}#feature/${f.id}` });
  await waitFor("!!document.querySelector('#runs-pane #group-detail .gpage .run-members.is-table')", `the group page at ${width}`);
  for (const theme of ['light', 'dark']) {
    await ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)};0`);
    const bad = await ev(LAYOUT_AUDIT);
    check(bad.length === 0, `the group page at ${width}px, ${theme}: one column, Open buttons aligned${bad.length ? ` — ${JSON.stringify(bad)}` : ''}`);
  }
  await auditButtonsBoth(`the group page at ${width}px`);
}
// ---- the unified page head (docs/design-system.md Navigation) on the group page, a saved member run and a live run.
const metrics = (width) => cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
const open = async (width, hash, ready, what) => {
  await metrics(width);
  await ev(`localStorage.removeItem('worca-cc.runs.last');0`);
  await cdp('Page.navigate', { url: `${base}/?w=${width}&n=${Date.now()}#${hash}` });
  await waitFor(ready, what);
  await sleep(600);   // the slide, and the late repaints
};
const OLD_WAYS = '.rd-back, .hd-back, .gpage-back, .rd-to-run, .hd-to-run, .rd-crumbs';
const noOldWays = async (where) => {
  const n = await ev(`document.querySelectorAll(${JSON.stringify(OLD_WAYS)}).length`);
  check(n === 0, `${where}: no Back, "‹ Run" or in-page breadcrumb element at all (${n})`);
};
// A live mock run, held at its clarify question: a live page waiting for an answer.
const started = await (await fetch(`${base}/api/run`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ projectDir: proj, prompt: 'add a flag', workflowId: 'wf_default', mock: true }) })).json();
const liveId = started.runId;
for (let i = 0; i < 400 && !(liveRuns.get(liveId) || {}).pendingQuestion; i += 1) await sleep(100);
check(!!(liveRuns.get(liveId) || {}).pendingQuestion, `a live mock run waits at its clarify question (${liveId})`);
const LIVE_READY = "!!document.querySelector('#run-detail .ph .rd-page-title') && !!document.querySelector('#run-detail .ph-tabs [role=\"tab\"]')";
const SAVED = `history/${key}/fp000002`;
const SAVED_READY = "!!document.querySelector('#hist-detail .ph .rd-page-title') && !!document.querySelector('#hist-detail .ph-tabs [role=\"tab\"]')";

// 1440px
await open(1440, `running/${liveId}`, LIVE_READY, 'the live run page at 1440');
await noOldWays('the live run at 1440px');
const live = await ev(`(() => ({ title: getComputedStyle(document.getElementById('topnav-title')).display,
  h1: getComputedStyle(document.querySelector('#run-detail .ph .rd-page-title')).fontSize,
  first: document.querySelector('#run-detail .ph-tabs [role="tab"]').dataset.sec,
  badge: (document.querySelector('#run-detail .rd-tab[data-sec="overview"] .rd-tab-badge') || {}).textContent || '' }))()`);
check(live.title === 'none', `the top bar title gives way to the trail (#topnav-title display ${live.title})`);
check(live.h1 === '22px', `the page h1 is 22px (${live.h1})`);
check(live.first === 'overview', `Summary leads the strip (${live.first})`);
check(live.badge === '?', `a run waiting for an answer marks Summary with ? (${JSON.stringify(live.badge)})`);
await ev(`document.querySelector('#run-detail .rd-tab[data-sec="diff"]').click();0`);
await waitFor(`location.hash === ${JSON.stringify(`#running/${liveId}/diff`)}`, 'the Diff tab address');
check(true, `a Diff tab click gives #running/${liveId}/diff`);
await ev(`document.querySelector('#run-detail .rd-tab[data-sec="overview"]').click();0`);
await waitFor(`location.hash === ${JSON.stringify(`#running/${liveId}`)}`, 'the Summary address');
const qShown = await ev(`(() => { const q = document.querySelector('#run-detail .rd-questions'); return !!q && !q.hidden && q.getBoundingClientRect().height > 0; })()`);
check(qShown, 'Summary shows the waiting question');
// The Details header moved into Summary: never a card inside the card, and nothing the card already says drawn again
// (no second status word, step, project, start, time or plain cost; no branch where Where the work is names it).
const movedHead = async (where, screen) => {
  const m = await ev(`(() => { const h = document.querySelector('${screen} .rd-sheet > :is(.rd-header,.hd-header)');
    if (!h) return null;
    const cs = getComputedStyle(h);
    const shown = (e) => !!e && e.getClientRects().length > 0;
    const route = shown(document.querySelector('${screen} .rd-route .rd-route-copy'));
    return { border: cs.borderLeftWidth + ' ' + cs.borderRightWidth + ' ' + cs.borderBottomWidth, radius: cs.borderTopLeftRadius, bg: cs.backgroundColor,
      repeats: [...h.querySelectorAll('.hd-status-word, .rd-project, .rd-clock, .rd-step, .hd-day, .hd-clock, .rd-dur, .hd-dur, :is(.rd-cost,.hd-cost):not(.cost-bd-btn,.cost-unknown)')].filter(shown).map((e) => e.textContent),
      branch: route && [...h.querySelectorAll('.rd-branch-copy, .hd-branch-copy')].some(shown) }; })()`);
  check(!!m && m.border === '0px 0px 0px' && m.radius === '0px' && m.bg === 'rgba(0, 0, 0, 0)' && m.repeats.length === 0 && !m.branch,
    `${where}: the moved Details header draws no box and repeats no status, project, time, cost or branch (${JSON.stringify(m)})`);
};
await movedHead('the live run at 1440px', '#run-detail');
const liveShot = await shot('nav-live-1440-light');
await open(1440, SAVED, SAVED_READY, 'the member run page at 1440');
await noOldWays('the member run at 1440px');
await movedHead('the paused saved run at 1440px', '#hist-detail');
// Crumb colours in both themes: the first crumb is --ink, a later one --ink-2 (tokens only).
for (const theme of ['light', 'dark']) {
  await ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)};0`);
  const c = await ev(`(() => { const probe = (v) => { const s = document.createElement('span'); s.style.color = 'var(' + v + ')'; document.body.append(s);
      const c = getComputedStyle(s).color; s.remove(); return c; };
    const a = [...document.querySelectorAll('#topnav-crumbs .nav-trail a')];
    return { first: getComputedStyle(a[0]).color, later: getComputedStyle(a[a.length - 1]).color, ink: probe('--ink'), ink2: probe('--ink-2'), n: a.length }; })()`);
  check(c.n === 2 && c.first === c.ink && c.later === c.ink2, `${theme}: the first crumb is --ink, a later one --ink-2 (${JSON.stringify(c)})`);
  await shot(`nav-run-1440-${theme}`).then((f) => log(`screenshot ${f}`));
}
await ev(`document.documentElement.dataset.theme='light';0`);
await open(1440, `history/${key}/fp000001`, SAVED_READY, 'member 1 (it has a PR) at 1440');
const pr = await ev(`(() => { const head = document.querySelector('#hist-detail .hd-glance .rd-sheet-head');
  const shown = (e) => !!e && !e.hidden && e.getBoundingClientRect().width > 0;
  const row1 = [...document.querySelectorAll('#hist-detail .hd-row1 > :is(.hist-merge,.hd-pr,.hd-publish,.hd-pr-link,.hd-push)')].filter((e) => !e.hidden);
  const glance = [...head.querySelectorAll('button, a')].filter(shown).map((e) => e.textContent.trim());
  return { slot: shown(head.querySelector('.rd-pr-slot')) || glance.length > 0, glance, row1: row1.map((e) => [e.className.split(' ').find((c) => c.startsWith('h')), e.textContent.trim()]) }; })()`);
// The PR comes from the PR host (enrichPipelinesPr): a sandbox with none shows no PR control on either header. Every
// control the hidden Details header would offer must have its counterpart on Summary.
const missing = pr.row1.filter(([, label]) => !pr.glance.some((g) => label && g.includes(label)));
for (const [cls, label] of pr.row1) log(`Details control .${cls} "${label}": Summary counterpart ${missing.some(([c]) => c === cls) ? 'MISSING (record as a deviation)' : 'found'}`);
check(missing.length === 0, `every Details header PR control has its Summary counterpart (Details ${JSON.stringify(pr.row1)}, Summary ${JSON.stringify(pr.glance)}${pr.slot ? '' : ', no PR host in this sandbox'})`);
await open(1440, `${SAVED}/workflow`, "!!document.querySelector('#hist-detail .hd-sec[data-sec=\"workflow\"]:not([hidden]) .run-flow')", 'the saved Workflow tab');
const flowW = await ev(`document.querySelector('#hist-detail .hd-sec[data-sec="workflow"] .run-flow').getBoundingClientRect().width`);
check(flowW > 0, `the saved Workflow tab paints its graph (${Math.round(flowW)}px wide)`);
await open(1440, `feature/${f.id}`, "!!document.querySelector('#group-detail .gpage > .ph .gpage-title')", 'the feature page at 1440');
await noOldWays('the feature page at 1440px');
const edges1440 = await ev(`Math.round(document.querySelector('#group-detail .gpage-title').getBoundingClientRect().left - document.querySelector('#group-detail .gpage-card').getBoundingClientRect().left)`);
check(Math.abs(edges1440) <= 1, `the feature page's h1 starts at the status card's left edge at 1440 (${edges1440}px)`);
// The kind chip sits beside the title, as on the run pages, not pushed to the far right.
const fchip = await ev(`(() => { const r = document.querySelector('#group-detail .rd-title-row'); const h = r.querySelector('.gpage-title').getBoundingClientRect();
  const c = r.querySelector('.kind-chip').getBoundingClientRect(); return { gap: Math.round(c.left - h.right), sameLine: c.top < h.bottom }; })()`);
check(fchip.sameLine && fchip.gap >= 0 && fchip.gap <= 16, `the feature page's chip sits beside its h1 at 1440 (${JSON.stringify(fchip)})`);
const featureShot = await shot('nav-feature-1440-light');

// 700px (between the top bar's 760px and the content's 640px breakpoints)
await open(700, `running/${liveId}`, LIVE_READY, 'the live run page at 700');
const mid = await ev(`(() => { const up = document.querySelector('#topnav-crumbs .nav-up'); const row = document.querySelector('#run-detail .ph-row');
  const h1 = row.querySelector('.rd-page-title'); const acts = row.querySelector('.ph-actions'); const after = document.querySelector('#run-detail .rd-after');
  return { up: !!up && up.offsetWidth > 0, sameLine: h1.offsetTop === acts.offsetTop, after: !!after && !after.hidden && after.offsetWidth > 0 }; })()`);
check(mid.up && mid.sameLine && mid.after, `at 700px: the up link, the h1 and the actions on one line, Run after shown (${JSON.stringify(mid)})`);
// The saved member run: Run after inside the page's edge and ⋯ on its line (no clipped or wrapped control).
await open(700, SAVED, SAVED_READY, 'the member run at 700');
const mid2 = await ev(`(() => { const row = document.querySelector('#hist-detail .ph-row'); const after = row.querySelector('.hd-after'); const more = row.querySelector('.hd-bar-more');
  const r = row.getBoundingClientRect(); const a = after.getBoundingClientRect(); const m = more.getBoundingClientRect();
  return { after: !after.hidden && a.width > 0, inside: m.right <= r.right + 1 && a.right <= r.right + 1, oneLine: Math.abs(a.top - m.top) < 8,
    sameLine: row.querySelector('.rd-page-title').offsetTop === row.querySelector('.ph-actions').offsetTop }; })()`);
check(mid2.after && mid2.inside && mid2.oneLine && mid2.sameLine, `at 700px the member run's actions fit on the h1's line, Run after and ⋯ together (${JSON.stringify(mid2)})`);

// 375px
const strip = async (where, sel) => {
  const s = await ev(`(() => { const list = document.querySelector(${JSON.stringify(sel)} + ' .ph-tabs > [role="tablist"]'); const on = list.querySelector('[aria-selected="true"]');
    const a = list.getBoundingClientRect(); const b = on.getBoundingClientRect(); const d = document.scrollingElement;
    return { overflow: getComputedStyle(list).overflowX, inside: b.left >= a.left - 1 && b.right <= a.right + 1, sw: d.scrollWidth, cw: d.clientWidth, on: on.dataset.sec,
      a: [Math.round(a.left), Math.round(a.right)], b: [Math.round(b.left), Math.round(b.right)], sl: list.scrollLeft, lw: list.scrollWidth }; })()`);
  check(s.overflow === 'auto' && s.inside && s.sw === s.cw, `${where} at 375px: the strip scrolls inside itself, the selected tab in view, no page scroll sideways (${JSON.stringify(s)})`);
};
await open(375, `running/${liveId}/qa`, LIVE_READY, 'the live run on Q&A at 375');
await noOldWays('the live run at 375px');
await strip('the live run', '#run-detail');
await open(375, `${SAVED}/qa`, SAVED_READY, 'the member run on Q&A at 375');
await noOldWays('the member run at 375px');
await strip('the member run', '#hist-detail');
await open(375, SAVED, SAVED_READY, 'the member run at 375');
// The h1 wraps in full (no clamp), the chip goes under it, and Run after folds into ⋯.
const phoneHead = await ev(`(() => { const row = document.querySelector('#hist-detail .rd-title-row'); const h = row.querySelector('.rd-page-title');
  const c = row.querySelector('.kind-chip').getBoundingClientRect(); const after = document.querySelector('#hist-detail .hd-after');
  const s = getComputedStyle(h);
  return { wraps: s.display !== '-webkit-box' && s.webkitLineClamp === 'none' && s.overflow === 'visible', lines: Math.round(h.clientHeight / parseFloat(s.lineHeight)), chipUnder: c.top >= h.getBoundingClientRect().bottom - 1, afterFolded: !after || after.offsetWidth === 0 }; })()`);
check(phoneHead.wraps && phoneHead.chipUnder && phoneHead.afterFolded, `the member run's head at 375px: the h1 unclamped, the chip under it, Run after in ⋯ (${JSON.stringify(phoneHead)})`);
const runPhoneShot = await shot('nav-run-375-light');
await open(375, `feature/${f.id}`, "!!document.querySelector('#group-detail .gpage > .ph .gpage-title')", 'the feature page at 375');
await noOldWays('the feature page at 375px');
const edges375 = await ev(`Math.round(document.querySelector('#group-detail .gpage-title').getBoundingClientRect().left - document.querySelector('#group-detail .gpage-card').getBoundingClientRect().left)`);
check(Math.abs(edges375) <= 1, `the feature page's h1 starts at the status card's left edge at 375 (${edges375}px)`);
// Going up keeps the list: its scroll, and focus on the row the run was opened from.
await open(375, 'runs', `!!document.querySelector('#runs-list .runs-row[data-run-id=${JSON.stringify(liveId)}]')`, 'the Runs list at 375');
// #runs-list is the scroller (overflow-y:auto); its padding makes it overflow so a 300px scroll can hold.
await ev(`document.getElementById('runs-list').style.paddingBottom = '2000px'; document.getElementById('runs-list').scrollTop = 300; 0`);
const top0 = await ev(`document.getElementById('runs-list').scrollTop`);
check(top0 === 300, `the list scrolls before the run is opened (scrollTop ${top0})`);
await ev(`document.querySelector('#runs-list .runs-row[data-run-id=${JSON.stringify(liveId)}]').click();0`);
await waitFor(LIVE_READY, 'the live run opened from its row');
await sleep(600);
await ev(`document.querySelector('#topnav-crumbs .nav-up').click();0`);
await waitFor("location.hash === '#runs'", 'back on the list');
await sleep(800);
const upKept = await ev(`(() => ({ top: document.getElementById('runs-list').scrollTop, row: (document.activeElement && document.activeElement.dataset.runId) || '' }))()`);
check(upKept.top === 300 && upKept.row === liveId, `going up keeps the list's scroll (${top0} -> ${upKept.top}) and focus on the row it was opened from (${upKept.row})`);
for (const width of [290, 375, 1440]) {
  await open(width, `feature/${f.id}`, "!!document.querySelector('#runs-pane #group-detail .gpage .run-members.is-table')", `the group page head at ${width}`);
  const bad = await ev(LAYOUT_AUDIT);
  check(bad.length === 0, `the group page with its head at ${width}px: one column${bad.length ? ` — ${JSON.stringify(bad)}` : ''}`);
}
await fetch(`${base}/api/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId: liveId }) }).catch(() => {});

await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
console.log(`screenshots:\n  ${runsShot}\n  ${pageShot}\n  ${liveShot}\n  ${featureShot}\n  ${runPhoneShot}`);
console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed');
await shutdown(failed ? 1 : 0);
