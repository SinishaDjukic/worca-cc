#!/usr/bin/env node
// tools/verify-workspace-map-cdp.mjs — headless-Chrome proof of the workspace page's Map tab
// (workspace interconnection map spec D17): the deep link paints coverage, graph and table from a
// REAL stored map; the graph's real geometry puts providers left of consumers; kind colours and
// node fills resolve from the theme tokens in light AND dark; at 420 px the graph scrolls inside
// its card; Enter on a focused pair filters the table; Reject, Add edge and Regenerate go through
// the real routes into the real store and hand the keyboard back (Chrome drops the focus of a busy
// button). NOT part of `npm test`: it needs Chrome and a live server.
// Run: node tools/verify-workspace-map-cdp.mjs   (or: npm run verify:workspace-map) with the real
// HOME: the script isolates WORCA_HOME / HOME / USERPROFILE for the server itself.
// WM_SHOTS=<dir> also writes light.png, dark.png and narrow.png there for a human look.
//
// -- CI COVERAGE -------------------------------------------------------------
// .github/workflows/ci.yml job `cdp` runs this script. What stays CDP-only is what jsdom cannot
// produce: layout boxes, computed SVG paint from CSS custom properties, overflow at a real width,
// a key event from the input pipeline, and the no-page-error gate over the real module graph
// (/src/shared/workspace-map/* served by the /src/shared mount). The DOM shapes are pinned in
// test/workspace-map-view.test.mjs and test/ui-workspace-map-tab.test.mjs.
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// macOS and Linux locations only, like every other tools/verify-*-cdp.mjs proof: on Windows set
// CHROME_BIN (e.g. %ProgramFiles%\Google\Chrome\Application\chrome.exe).
const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
const CHROME = process.env.CHROME_BIN || CHROME_PATHS.find((p) => existsSync(p)) || CHROME_PATHS[0];
const SANDBOX = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0
  ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
if (!existsSync(CHROME)) { console.error(`no Chrome at ${CHROME} - set CHROME_BIN`); process.exit(1); }
const PORT = Number(process.env.CDP_PORT || 9342);   // 9333–9338 and 9341 belong to the other proofs
const SHOTS = process.env.WM_SHOTS || '';
const T0 = Date.now();
const log = (m) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}\n`);

let chrome = null; let srv = null; let home = null; let reposRoot = null; let profile = null; let failed = 0;
async function shutdown(code) {
  try { if (chrome) chrome.kill('SIGKILL'); } catch {}
  try { if (srv) await new Promise((r) => srv.close(r)); } catch {}
  for (const dir of [home, reposRoot, profile]) {
    try { if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  }
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection']) {
  process.on(sig, (e) => { if (e && e.stack) console.error(e.stack); shutdown(1); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- three one-commit git repos + the app server (env BEFORE the import) -----------------
home = await mkdtemp(path.join(tmpdir(), 'worca-wsmap-home-'));
const REAL_ENV = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
process.env.WORCA_HOME = home;
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.WORCA_MOCK = '1';
reposRoot = await mkdtemp(path.join(tmpdir(), 'worca-wsmap-repos-'));
const repoPaths = {};
for (const name of ['billing-api', 'shared-lib', 'web']) {
  const dir = path.join(reposRoot, name);
  await mkdir(dir, { recursive: true });
  for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'proof@worca.local'], ['config', 'user.name', 'proof']]) {
    execFileSync('git', a, { cwd: dir });
  }
  await writeFile(path.join(dir, 'README.md'), `# ${name}\n`);
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  repoPaths[name] = dir;
}
const { app } = await import(new URL('../ui/server.mjs', import.meta.url).href);
srv = http.createServer(app);
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
// The Map tab is Advanced (docs/ui-levels.md); pin Expert like the other proofs.
{ const r = await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uiLevel: 'expert' }) });
  if (!r.ok) throw new Error(`could not pin the interface mode: HTTP ${r.status}`); }
const api = async (p, opt) => {
  const r = await fetch(base + p, opt);
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; }
};

// ---- seed: a workspace and a stored map (P5 store + P1 ids / order) ------------------------
// saveWorkspaceScanResult renders the description from the map and the stored overrides itself.
const { createWorkspace, saveWorkspaceScanResult } = await import(new URL('../src/core/workspaces.mjs', import.meta.url).href);
const { edgeId } = await import(new URL('../src/shared/workspace-map/ids.mjs', import.meta.url).href);
const { changeOrder } = await import(new URL('../src/shared/workspace-map/order.mjs', import.meta.url).href);
const ws = await createWorkspace({ name: 'Map proof', projectPaths: Object.values(repoPaths) });
const K = Object.fromEntries(ws.projectPaths.map((p, i) => [path.basename(p), ws.projectKeys[i]]));
const cov = (level) => ({ level, files: 1, scannedFiles: 1, truncated: false, factsStatic: 3, factsLlm: 0, unresolved: 0, rejected: 0, surveyed: 'skipped', usageStatus: 'investigated', graph: null });
const edge = (from, to, kind, norm, display, confidence, evFrom, evTo) => ({
  id: edgeId(K[from], K[to], kind, norm), from: K[from], to: K[to], kind, norm, display, label: null, detail: '',
  confidence, sources: ['static'], evidence: { from: evFrom, to: evTo },
});
const EDGES = [
  edge('web', 'billing-api', 'http', 'http:GET /invoices/{}', 'GET /invoices/{id}', 'exact',
    [{ file: 'src/api.ts', line: 12, match: "fetch('/invoices/'" }], [{ file: 'src/routes.ts', line: 4, match: "router.get('/invoices/:id'" }]),
  edge('billing-api', 'shared-lib', 'pkg', 'pkg:npm:shared-lib', 'shared-lib', 'exact',
    [{ file: 'package.json', line: 7, match: '"shared-lib"' }], [{ file: 'package.json', line: 2, match: '"name": "shared-lib"' }]),
  edge('web', 'shared-lib', 'pkg', 'pkg:npm:shared-lib', 'shared-lib', 'heuristic',
    [{ file: 'package.json', line: 9, match: '"shared-lib"' }], []),
];
const ID_WEB_LIB = EDGES[2].id;
const keys = Object.values(K).sort();
const { order, cycles } = changeOrder(keys, EDGES);
const MAP = {
  version: 1, workspace: { name: 'Map proof' }, scannedAt: new Date().toISOString(), runId: 'proof',
  members: ['billing-api', 'shared-lib', 'web'].map((n) => ({ key: K[n], name: n, role: null, roleSource: null, aliases: [], stack: ['node'], coverage: cov(n === 'web' ? 'partial' : 'rich') })),
  edges: EDGES, order, cycles, graph: { mode: 'none', file: null, nodes: 0, bridges: 0 },
  stats: { edges: 3, byKind: { http: 1, pkg: 2 }, byConfidence: { exact: 2, heuristic: 1 }, candidates: 0, candidatesConfirmed: 0, factsRejected: 0 }, errors: [],
};
const SYNTH = { version: 1, overview: 'Proof overview.', roles: {}, coordination: [], orderNotes: '' };
await saveWorkspaceScanResult(ws.id, { map: MAP, synthesis: SYNTH });
log(`server ${base} · workspace ${ws.id}`);

// ---- chrome + cdp -----------------------------------------------------------------------------
profile = await mkdtemp(path.join(tmpdir(), 'worca-wsmap-profile-'));
// Chrome gets the REAL home (REAL_ENV): on macOS a Chrome with a fresh HOME never answers
// Page.navigate. --use-mock-keychain keeps it off the login keychain whatever HOME is.
chrome = spawn(CHROME, ['--headless=new', ...SANDBOX, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1280,900', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--use-mock-keychain',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'],
{ stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...REAL_ENV } });
const chromeErr = [];
chrome.stderr.on('data', (d) => { chromeErr.push(String(d)); if (chromeErr.length > 40) chromeErr.shift(); });
let chromeExit = null;
chrome.on('exit', (code, signal) => { chromeExit = { code, signal }; });
let wsUrl = null;
const targetDeadline = Date.now() + 60_000;
while (!wsUrl && Date.now() < targetDeadline && !chromeExit) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(200);
  } catch { await sleep(250); }
}
if (!wsUrl) {
  console.error(chromeExit ? `no devtools target: chrome exited (code ${chromeExit.code}, signal ${chromeExit.signal})` : 'no devtools target after 60s');
  if (chromeErr.length) console.error(chromeErr.join('').trim().split('\n').slice(-15).join('\n'));
  await shutdown(1);
}
const sock = new WebSocket(wsUrl);
await new Promise((res, rej) => { sock.onopen = res; sock.onerror = rej; });
let msgId = 0; const pending = new Map(); const listeners = [];
sock.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id != null) { const p = pending.get(m.id); pending.delete(m.id); if (p) (m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result)); return; }
  for (const l of [...listeners]) l(m);
};
function cdp(method, params = {}, ms = 15000) {
  const id = ++msgId;
  return new Promise((res, rej) => {
    const to = setTimeout(() => { pending.delete(id); rej(new Error(`CDP TIMEOUT ${method}`)); }, ms);
    pending.set(id, { res: (v) => { clearTimeout(to); res(v); }, rej: (er) => { clearTimeout(to); rej(er); } });
    sock.send(JSON.stringify({ id, method, params }));
  });
}
const waitEvent = (name, ms = 15000) => new Promise((res, rej) => {
  const to = setTimeout(() => { off(); rej(new Error(`timeout ${name}`)); }, ms);
  const l = (m) => { if (m.method === name) { clearTimeout(to); off(); res(m.params); } };
  const off = () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
  listeners.push(l);
});
const errors = [];
listeners.push((m) => {
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push((m.params.args || []).map((a) => a.value || a.description).join(' '));
});
await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Log.enable');

async function ev(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`EVAL: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}\n${expr}`);
  return r.result.value;
}
const kick = () => cdp('Page.captureScreenshot', { format: 'jpeg', quality: 1, clip: { x: 0, y: 0, width: 16, height: 16, scale: 1 } }, 15000).catch(() => null);
async function settle(tag = '') {
  await ev('window.__rafHit=0;requestAnimationFrame(()=>{window.__rafHit=1;});0');
  for (let i = 0; i < 10; i += 1) { if (await ev('window.__rafHit')) return; await kick(); }
  throw new Error(`no animation frame after 10 forced frames (${tag})`);
}
function check(n, what, ok, detail) {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} (${n}) ${what}${ok ? '' : `\n      ${JSON.stringify(detail)}`}`);
}
async function go(hash, { first = false } = {}) {
  if (first) await cdp('Page.navigate', { url: `${base}/#${hash}` });
  else { await ev(`location.hash=${JSON.stringify(hash)};0`); await cdp('Page.reload', {}); }
  await waitEvent('Page.loadEventFired');
  for (let i = 0; i < 80; i += 1) { if (await ev('!!(window.__np && window.__np.getRun)')) break; await sleep(100); }
  await settle(`load ${hash}`);
}
async function until(expr, tag, tries = 100) {
  for (let i = 0; i < tries; i += 1) {
    if (await ev(`(()=>{try{return !!(${expr});}catch(e){return false;}})()`)) return true;
    await kick(); await sleep(120);
  }
  throw new Error(`timeout waiting for ${tag}`);
}
// until() as a verdict: false instead of a throw, so one check can fail without ending the proof.
async function holds(expr, tries = 40) {
  try { return await until(expr, 'a check', tries); } catch { return false; }
}
const activeDesc = () => ev(`(()=>{const a=document.activeElement;return a?a.tagName+'.'+String(a.className):'none';})()`);
async function shot(name) {
  if (!SHOTS) return;
  await mkdir(SHOTS, { recursive: true });
  const { data } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
}
const SEC = `#ws-detail .pd-sec[data-sec="map"]`;
const J = JSON.stringify;
// Token colours resolved by the browser, next to what the map painted with them.
const paints = () => ev(`(()=>{const s=document.querySelector('${SEC}');const probe=document.createElement('div');
  probe.style.color='var(--blue)';probe.style.backgroundColor='var(--surface)';probe.style.borderTopColor='var(--ink-3)';probe.style.borderTopStyle='solid';
  document.body.appendChild(probe);const cs=getComputedStyle(probe);const want={blue:cs.color,surface:cs.backgroundColor,ink3:cs.borderTopColor};probe.remove();
  const line=s.querySelector('.wm-pair.wm-k-http .wm-line');const arrow=s.querySelector('marker#wm-arrow-http path');const rect=s.querySelector('.wm-node rect');
  return {want,stroke:getComputedStyle(line).stroke,arrow:getComputedStyle(arrow).fill,fill:getComputedStyle(rect).fill};})()`);

try {
  // ---- (1) the deep link paints the stored map -------------------------------------------
  await go(`workspaces/${ws.id}/map`, { first: true });
  await until(`document.querySelector('${SEC} svg.wm-graph')`, 'map painted');
  const m1 = await ev(`(()=>{const s=document.querySelector('${SEC}');return {
    tab:document.querySelector('#ws-detail .pd-tab.active').dataset.sec,chips:s.querySelectorAll('.wm-chip').length,
    nodes:s.querySelectorAll('.wm-node').length,pairs:s.querySelectorAll('.wm-pair').length,rows:s.querySelectorAll('.wm-row').length,
    meta:s.querySelector('.wm-meta').textContent,regen:!!s.querySelector('.wm-regen'),
    label:s.querySelector('svg.wm-graph').getAttribute('aria-label')};})()`);
  check('1', 'the deep link opens the Map pill and paints 3 chips, 3 nodes, 3 pairs and 3 rows from the stored map; no Regenerate for a generated description',
    m1.tab === 'map' && m1.chips === 3 && m1.nodes === 3 && m1.pairs === 3 && m1.rows === 3 && m1.regen === false
    && /^3 projects · 3 edges/.test(m1.meta) && m1.label === 'Workspace map: 3 projects, 3 connections', m1);

  // ---- (2) real geometry: providers left of consumers --------------------------------------
  const g2 = await ev(`(()=>{const s=document.querySelector('${SEC}');const K=${J(K)};
    const box=(k)=>{const r=s.querySelector('.wm-node[data-value="'+k+'"] rect').getBoundingClientRect();return [r.left,r.right];};
    return {lib:box(K['shared-lib']),bill:box(K['billing-api']),web:box(K.web)};})()`);
  check('2', 'laid out in the browser: shared-lib, then billing-api, then web, left to right, no overlap',
    g2.lib[1] <= g2.bill[0] && g2.bill[1] <= g2.web[0], g2);

  // ---- (3) theme tokens paint the SVG in light and dark ----------------------------------
  const prevTheme = await ev(`document.documentElement.dataset.theme||''`);
  await ev(`document.documentElement.dataset.theme='light';0`); await settle('light');
  const light = await paints();
  await shot('light');
  await ev(`document.documentElement.dataset.theme='dark';0`); await settle('dark');
  const dark = await paints();
  await shot('dark');
  await ev(`(()=>{const t=${J(prevTheme)};if(t)document.documentElement.dataset.theme=t;else delete document.documentElement.dataset.theme;return 1;})()`);
  await settle('theme restored');
  check('3', 'the http pair strokes and its arrow fill with --blue, node boxes fill with --surface, and the fill follows the theme',
    light.stroke === light.want.blue && light.arrow === light.want.blue && light.fill === light.want.surface
    && dark.stroke === dark.want.blue && dark.fill === dark.want.surface && dark.fill !== light.fill, { light, dark });

  // ---- (4) a narrow screen scrolls the graph inside its card -------------------------------
  await cdp('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 1, mobile: false });
  await settle('narrow');
  const n4 = await ev(`(()=>{const s=document.querySelector('${SEC}');const sc=s.querySelector('.wm-graph-scroll');const card=s.querySelector('.wm-graph-card').getBoundingClientRect();
    return {client:sc.clientWidth,scroll:sc.scrollWidth,svg:Number(sc.querySelector('svg').getAttribute('width')),card:card.right,sec:s.getBoundingClientRect().right};})()`);
  // The shot captures the viewport: bring the graph card into it (at 420 px it sits below the fold).
  if (SHOTS) { await ev(`document.querySelector('${SEC} .wm-graph-card').scrollIntoView({block:'center'});0`); await settle('narrow shot'); }
  await shot('narrow');
  await cdp('Emulation.clearDeviceMetricsOverride');
  await settle('wide');
  check('4', 'at 420 px the scroller is narrower than the drawing and scrolls it; the card stays inside its section',
    n4.client < n4.svg && n4.scroll >= n4.svg && n4.card <= n4.sec + 1, n4);

  // ---- (5) Enter on a focused pair filters the table ----------------------------------------
  const pairSel = `${SEC} .wm-pair[data-from="${K.web}"][data-to="${K['billing-api']}"]`;
  const focused = await ev(`(()=>{const p=document.querySelector('${pairSel}');p.focus();return document.activeElement===p;})()`);
  for (const type of ['keyDown', 'keyUp']) await cdp('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await until(`document.querySelectorAll('${SEC} .wm-row').length === 1`, 'pair filter');
  const f5 = await ev(`(()=>({row:document.querySelector('${SEC} .wm-row').dataset.edge,
    focus:document.activeElement===document.querySelector('${pairSel}'),chip:!!document.querySelector('${SEC} .wm-pair-chip')}))()`);
  check('5', 'a pair takes keyboard focus; Enter filters the table to its one edge, keeps the focus on it and shows the pair chip',
    focused === true && f5.row === EDGES[0].id && f5.focus === true && f5.chip === true, { focused, ...f5 });
  await ev(`document.querySelector('${SEC} .wm-filters button[data-filter="all"]').click();0`);
  await until(`document.querySelectorAll('${SEC} .wm-row').length === 3`, 'filters cleared');

  // ---- (6) Reject through the real route; the keyboard stays on the row ------------------------
  // Each press below focuses its button first, as a keyboard user would. Chrome drops the focus of a
  // button that turns disabled (the busy guard), so only the tab's hand-back puts the keyboard back.
  await ev(`(()=>{const b=document.querySelector('${SEC} .wm-row[data-edge="${ID_WEB_LIB}"] .wm-reject');b.focus();b.click();return 1;})()`);
  await until(`document.querySelector('${SEC} .wm-row[data-edge="${ID_WEB_LIB}"] .wm-state').textContent === 'rejected'`, 'rejected row');
  const focus6 = await holds(`document.activeElement === document.querySelector('${SEC} .wm-row[data-edge="${ID_WEB_LIB}"] .wm-clear')`);
  const stored6 = (await api(`/api/workspaces/${ws.id}/map`)).body;
  const r6 = await ev(`(()=>{const s=document.querySelector('${SEC}');const probe=document.createElement('div');probe.style.color='var(--ink-3)';document.body.appendChild(probe);
    const ink3=getComputedStyle(probe).color;probe.remove();const td=s.querySelector('.wm-row[data-edge="${ID_WEB_LIB}"] td');
    return {pairs:s.querySelectorAll('.wm-pair').length,grey:getComputedStyle(td).color===ink3,
      drawn:!!s.querySelector('.wm-pair[data-from="${K.web}"][data-to="${K['shared-lib']}"]')};})()`);
  check('6', 'Reject stores a rejected override; the row stays, greyed, the pair leaves the graph, and the keyboard lands on the row: on Clear',
    stored6.overrides && stored6.overrides.edges && stored6.overrides.edges[ID_WEB_LIB] && stored6.overrides.edges[ID_WEB_LIB].state === 'rejected'
    && r6.pairs === 2 && r6.grey === true && r6.drawn === false && focus6 === true,
    { override: stored6.overrides && stored6.overrides.edges, ...r6, focus6, active: await activeDesc() });

  // ---- (7) Add a manual edge through the real route; the keyboard stays on Add edge -----------
  await ev(`(()=>{const f=document.querySelector('${SEC} .wm-add-form');f.querySelector('[name="wm-from"]').value=${J(K.web)};
    f.querySelector('[name="wm-to"]').value=${J(K['shared-lib'])};f.querySelector('[name="wm-kind"]').value='other';
    f.querySelector('[name="wm-display"]').value='S3 uploads bucket';const b=f.querySelector('.wm-add');b.focus();b.click();return 1;})()`);
  await until(`document.querySelectorAll('${SEC} .wm-row.is-manual').length === 1`, 'manual row');
  const focus7 = await holds(`document.activeElement === document.querySelector('${SEC} .wm-add-form .wm-add')`);
  const stored7 = (await api(`/api/workspaces/${ws.id}/map`)).body;
  const r7 = await ev(`(()=>{const s=document.querySelector('${SEC}');const p=s.querySelector('.wm-pair[data-from="${K.web}"][data-to="${K['shared-lib']}"]');
    return {dashed:!!p&&p.classList.contains('is-dashed'),display:s.querySelector('.wm-add-form [name="wm-display"]').value};})()`);
  const manual = (stored7.overrides && stored7.overrides.manual) || [];
  check('7', 'Add edge stores a manual edge, clears the form, draws the pair dashed, and gives the keyboard back to Add edge',
    manual.length === 1 && manual[0].display === 'S3 uploads bucket' && manual[0].kind === 'other' && r7.dashed === true && r7.display === '' && focus7 === true,
    { manual, ...r7, focus7, active: await activeDesc() });

  // ---- (8) Regenerate after a hand edit -----------------------------------------------------
  const patch = await api(`/api/workspaces/${ws.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: J({ description: '# Workspace: Map proof\nhand edit\n' }) });
  if (patch.status !== 200) throw new Error(`PATCH description -> ${patch.status} ${J(patch.body)}`);
  await go(`workspaces/${ws.id}/map`);
  await until(`document.querySelector('${SEC} .wm-regen')`, 'Regenerate offered');
  await ev(`(()=>{const b=document.querySelector('${SEC} .wm-regen');b.focus();b.click();return 1;})()`);
  await until(`!document.querySelector('${SEC} .wm-regen')`, 'Regenerate done');
  const focus8 = await holds(`document.activeElement === document.querySelector('${SEC}')`);
  const w8 = ((await api('/api/workspaces')).body.workspaces || []).find((w) => w.id === ws.id) || {};
  check('8', 'a hand-edited description offers Regenerate; it re-renders from the map with the overrides, hides the button, and the keyboard lands on the tab panel',
    w8.descriptionOrigin === 'generated' && !/hand edit/.test(w8.description || '') && /\(manual\)/.test(w8.description || '') && focus8 === true,
    { origin: w8.descriptionOrigin, description: (w8.description || '').slice(0, 400), focus8, active: await activeDesc() });

  check('console', 'no page errors or exceptions', errors.length === 0, errors.slice(0, 5));
} catch (e) {
  failed += 1;
  console.log(`FAIL (fatal) ${e && e.stack ? e.stack : e}`);
}
if (SHOTS) console.log(`screenshots: ${SHOTS}`);
console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`} — ${((Date.now() - T0) / 1000).toFixed(1)}s`);
await shutdown(failed === 0 ? 0 : 1);
