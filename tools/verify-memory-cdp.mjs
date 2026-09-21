#!/usr/bin/env node
// tools/verify-memory-cdp.mjs — headless-Chrome proof of the Settings → Memory tab and the
// project page's Memory tab (agent-memory-design.md §10, §15): the health badge + the host hint, the
// file list, the deep link, edit + Save (a real PUT into a real store), Delete through the app's own
// confirm modal, the History panel + Restore, a REAL defragment run through the wrapper (the stamp,
// the live control, the History memory chips) and the picker's Memory scope row. NOT part of
// `npm test`: it needs Chrome and a live server, and it drives a real mock pipeline end to end.
// Run: node tools/verify-memory-cdp.mjs   (or: npm run verify:memory)
//
// -- CI COVERAGE -------------------------------------------------------------
// .github/workflows/ci.yml job `cdp` runs this script on every push and every pull request. What
// remains CDP-only is every behaviour jsdom cannot produce: a real fetch against a real store, the
// app's own confirm modal, hashchange routing across three views, a real run end to end, and the
// no-page-error gate. The DOM shapes themselves are pinned in test/memory-view.test.mjs,
// test/ui-memory-view.test.mjs and test/ui-projects-view.test.mjs.
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Chrome is overridable so this proof also runs on a Linux CI runner: CHROME_BIN
// picks the binary, and headless Chrome refuses to start as root (containers)
// without --no-sandbox, which CHROME_NO_SANDBOX=1 forces.
const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
const CHROME = process.env.CHROME_BIN || CHROME_PATHS.find((p) => existsSync(p)) || CHROME_PATHS[0];
const SANDBOX = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0
  ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
if (!existsSync(CHROME)) { console.error(`no Chrome at ${CHROME} - set CHROME_BIN`); process.exit(1); }
const PORT = Number(process.env.CDP_PORT || 9335);
const T0 = Date.now();
const log = (m) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}\n`);

let chrome = null; let srv = null; let home = null; let proj = null; let profile = null; let failed = 0;
async function shutdown(code) {
  try { if (chrome) chrome.kill('SIGKILL'); } catch {}            // kill Chrome on EVERY exit path
  try { if (srv) await new Promise((r) => srv.close(r)); } catch {}
  try { if (home) await rm(home, { recursive: true, force: true }); } catch {}
  try { if (proj) await rm(proj, { recursive: true, force: true }); } catch {}
  try { if (profile) await rm(profile, { recursive: true, force: true }); } catch {}
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection']) {
  process.on(sig, (e) => { if (e && e.stack) console.error(e.stack); shutdown(1); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- a one-commit git project + the app server (the house pattern: env BEFORE
// the import). `app` + http.createServer — NOT the exported `server` — because no
// WebSocket frame is read here; every refresh this proof asserts is driven by a
// route change or a poll (verify-composer-cdp.mjs boots the same way).
home = await mkdtemp(path.join(tmpdir(), 'worca-mem-home-'));
// settings.json lives under defaultRoot() = HOME/USERPROFILE (src/core/settings.mjs), which
// WORCA_HOME does NOT cover: without these lines the proof reads the developer's real
// ~/.worca-cc/settings.json, so their memory caps and defrag thresholds would decide check 1's
// health badge. Chrome needs the real home (macOS caches, crashpad): it gets REAL_ENV back below.
const REAL_ENV = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
process.env.WORCA_HOME = home;
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.WORCA_MOCK = '1';
proj = await mkdtemp(path.join(tmpdir(), 'worca-mem-proj-'));
for (const a of [['init', '-q'], ['config', 'user.email', 'proof@worca.local'], ['config', 'user.name', 'proof']]) {
  execFileSync('git', a, { cwd: proj });
}
await writeFile(path.join(proj, 'README.md'), '# memory proof\n');
execFileSync('git', ['add', '-A'], { cwd: proj });
execFileSync('git', ['commit', '-qm', 'init'], { cwd: proj });
const { app, runs } = await import(new URL('../ui/server.mjs', import.meta.url).href);
srv = http.createServer(app);
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
// These proofs measure the full UI, so pin the interface mode to Expert (docs/ui-levels.md) —
// a fresh WORCA_HOME would otherwise serve Simple and hide what they measure.
{ const r = await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uiLevel: 'expert' }) });
  if (!r.ok) throw new Error(`could not pin the interface mode: HTTP ${r.status}`); }
log(`server ${base} · project ${proj}`);
const api = async (p, opt) => {
  const r = await fetch(base + p, opt);
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; }
};

// ---- seed: the project + three global files + one project file, straight into the store.
// AFTER the server import, so db.mjs has migrated the temp home this proof owns.
const { writeMemory, readMemory, memoryRoot, GLOBAL_SCOPE, projectScope } = await import(new URL('../src/core/memory-store.mjs', import.meta.url).href);
const { addProject } = await import(new URL('../src/core/projects.mjs', import.meta.url).href);
const project = (await addProject({ name: 'memproof', path: proj })).find((p) => p.name === 'memproof');
const NOW = '2026-09-09T10:00:00.000Z';
await writeMemory(memoryRoot(), GLOBAL_SCOPE, 'testing', '---\nname: testing\ndescription: How the suite runs\npaths: test/**\n---\nnpm ci before npm test.\n', { source: 'user', now: NOW });
await writeMemory(memoryRoot(), GLOBAL_SCOPE, 'style', 'Terse commit subjects.\n', { source: 'user', now: NOW });
await writeMemory(memoryRoot(), GLOBAL_SCOPE, 'traps', 'grep -P does not exist on macOS.\n', { source: 'user', now: NOW });
await writeMemory(memoryRoot(), projectScope(project.key), 'conventions', 'kebab-case file names.\n', { source: 'user', now: NOW });
log(`seeded 3 global + 1 project file · project ${project.key}`);

// ---- chrome + cdp
profile = await mkdtemp(path.join(tmpdir(), 'worca-mem-profile-'));
chrome = spawn(CHROME, ['--headless=new', ...SANDBOX, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1280,900', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'],
{ stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...REAL_ENV } });
// Keep Chrome's last stderr lines: when no DevTools target ever appears, its own
// words (a sandbox refusal, a profile lock, a crash) are the diagnosis.
const chromeErr = [];
chrome.stderr.on('data', (d) => { chromeErr.push(String(d)); if (chromeErr.length > 40) chromeErr.shift(); });
let chromeExit = null;
chrome.on('exit', (code, signal) => { chromeExit = { code, signal }; });
let wsUrl = null;
// Deadline-based, not iteration-based: a cold CI runner can take well over the
// old ~15s (60 × 250ms) to bring the first page target up, and that budget was
// the difference between a green and a red proofs job on the same commit.
const targetDeadline = Date.now() + 60_000;
while (!wsUrl && Date.now() < targetDeadline && !chromeExit) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(200);
  } catch { await sleep(250); }
}
if (!wsUrl) {
  console.error(chromeExit
    ? `no devtools target: chrome exited (code ${chromeExit.code}, signal ${chromeExit.signal})`
    : 'no devtools target after 60s');
  if (chromeErr.length) console.error(chromeErr.join('').trim().split('\n').slice(-15).join('\n'));
  await shutdown(1);
}
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map(); const listeners = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id != null) { const p = pending.get(m.id); pending.delete(m.id); if (p) (m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result)); return; }
  for (const l of [...listeners]) l(m);
};
function cdp(method, params = {}, ms = 15000) {
  const id = ++msgId;
  return new Promise((res, rej) => {
    const to = setTimeout(() => { pending.delete(id); rej(new Error(`CDP TIMEOUT ${method}`)); }, ms);
    pending.set(id, { res: (v) => { clearTimeout(to); res(v); }, rej: (er) => { clearTimeout(to); rej(er); } });
    ws.send(JSON.stringify({ id, method, params }));
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
// Headless Chrome does not tick rAF on its own: arm a marker and force frames.
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

// ---- page helpers ----------------------------------------------------------
async function go(hash, { first = false } = {}) {
  if (first) await cdp('Page.navigate', { url: `${base}/#${hash}` });
  else { await ev(`location.hash=${JSON.stringify(hash)};0`); await cdp('Page.reload', {}); }
  await waitEvent('Page.loadEventFired');
  for (let i = 0; i < 80; i += 1) { if (await ev('!!(window.__np && window.__np.getRun)')) break; await sleep(100); }
  await settle(`load ${hash}`);
}
/** Wait until `expr` is truthy, forcing frames (the app paints from rAF). */
async function until(expr, tag, tries = 100) {
  for (let i = 0; i < tries; i += 1) {
    if (await ev(`(()=>{try{return !!(${expr});}catch(e){return false;}})()`)) return true;
    await kick(); await sleep(120);
  }
  throw new Error(`timeout waiting for ${tag}`);
}

const PANE = '.settings-pane[data-tab="memory"]:not(.hidden)';
const EDITED = '---\nname: testing\ndescription: Suite rules (edited)\npaths: test/**\n---\nnpm ci before npm test.\nRun one file at a time.\n';

try {
  // ---- (1) the tab, the badge, the seeded rows and the fallback host ---------
  // No localStorage hack: with one registered project globalDefragHost() falls back to it (B32),
  // so the button is enabled and the hint NAMES the host in visible text.
  await go('settings/memory', { first: true });
  await until(`document.querySelector('${PANE} .mem-health .badge')`, 'memory pane painted');
  const head = await ev(`(()=>{const p=document.querySelector('${PANE}');const b=p.querySelector('.mem-health .badge');return {
    badge:b.textContent,cls:b.className,rows:[...p.querySelectorAll('.mem-row')].map(r=>r.dataset.name),
    hooks:[...p.querySelectorAll('.mem-row-hook')].map(r=>r.textContent),
    h1:p.querySelector('.topbar h1').textContent,hint:(p.querySelector('.mem-host-hint')||{}).textContent||null,
    defragText:p.querySelector('.mem-defrag').textContent,defragDisabled:p.querySelector('.mem-defrag').disabled,
    runEl:!!p.querySelector('.mem-run'),tab:document.querySelector('#settings-tabs button[data-tab="memory"]').classList.contains('on')};})()`);
  check('1', 'the Memory tab is selected and titled, the scope is Healthy, the three seeded files are listed, and Defragment is enabled with a hint naming the fallback host',
    head.tab === true && head.h1 === 'Memory' && head.badge === 'Healthy' && /\bgreen\b/.test(head.cls)
    && head.rows.join(',') === 'style,testing,traps' && head.hooks.join('|') === 'Terse commit subjects.|How the suite runs|grep -P does not exist on macOS.'
    && head.defragDisabled === false && head.runEl === false
    && head.defragText === 'Defragment' && head.hint === 'Runs on memproof — pick another project on the New pipeline page.', head);

  // ---- (2) the deep link opens the file, read-locked on its name -------------
  await go('settings/memory/testing');
  await until(`document.querySelector('${PANE} .mem-editor')`, 'editor open');
  const ed = await ev(`(()=>{const p=document.querySelector('${PANE}');return {name:p.querySelector('.mem-name').value,ro:p.querySelector('.mem-name').readOnly,
    text:p.querySelector('.mem-text').value,help:!!p.querySelector('.mem-name-help'),
    on:p.querySelector('.mem-row[data-name="testing"]').classList.contains('on'),
    counts:[...p.querySelectorAll('.mem-snap-count')].map(s=>s.textContent),
    ids:[...p.querySelectorAll('.mem-snap')].map(s=>s.dataset.id)};})()`);
  check('2', 'the deep link opens testing.md read-locked on its name (no New-file help), with the stored frontmatter in the textarea and its row selected',
    ed.name === 'testing' && ed.ro === true && ed.help === false && ed.on === true
    && ed.text.startsWith('---\nname: testing\n') && ed.text.includes('source: user'), { ...ed, text: ed.text.slice(0, 60) });
  check('2b', 'the History panel lists the seeds\' snapshots newest first, each counting its files',
    ed.ids.length === 2 && ed.ids[0] > ed.ids[1] && ed.counts.join('|') === '2 files|1 file', { ids: ed.ids, counts: ed.counts });

  // ---- (3) edit + Save -> a real PUT, a repainted hook ----------------------
  await ev(`(()=>{const ta=document.querySelector('${PANE} .mem-text');ta.value=${JSON.stringify(EDITED)};return 1;})()`);
  await ev(`document.querySelector('${PANE} .mem-save').click();0`);
  await until(`document.querySelector('${PANE} .mem-row[data-name="testing"] .mem-row-hook').textContent === 'Suite rules (edited)'`, 'saved hook repainted');
  const stored = await readMemory(memoryRoot(), GLOBAL_SCOPE, 'testing');
  check('3', 'Save PUT the text: the store holds the new body with source user, and the list hook repainted',
    !!stored && stored.meta.description === 'Suite rules (edited)' && stored.meta.source === 'user'
    && stored.body.includes('Run one file at a time.'), stored && stored.meta);

  // ---- (4) Delete through the app's own confirm modal -----------------------
  await ev(`document.querySelector('${PANE} .mem-delete').click();0`);
  await until(`!document.getElementById('confirm-modal').classList.contains('hidden')`, 'confirm modal');
  const copy = await ev(`document.getElementById('confirm-message').textContent`);
  await ev(`document.getElementById('confirm-ok').click();0`);
  await until(`!document.querySelector('${PANE} .mem-row[data-name="testing"]')`, 'row removed');
  // AWAITED before the check: an un-awaited async helper inside `&&` is a truthy Promise, and the
  // route-back half of this check could then never fail.
  const hashIsList = (await ev('location.hash')) === '#settings/memory';
  const goneFromStore = (await readMemory(memoryRoot(), GLOBAL_SCOPE, 'testing')) === null;
  check('4', 'Delete asks first (naming the file), then removes it from the store and the list and routes back to the scope',
    /Delete “testing\.md”\?/.test(copy) && goneFromStore && hashIsList, { copy, hashIsList, goneFromStore });

  // ---- (5) Restore the NEWEST snapshot that still holds testing.md ----------
  const snaps = (await api('/api/memory/global/history')).body.snapshots;
  const snap = [...snaps].reverse().find((s) => (s.files || []).includes('testing.md'));
  if (!snap) throw new Error(`no snapshot holds testing.md: ${JSON.stringify(snaps)}`);
  await ev(`document.querySelector('${PANE} .mem-snap[data-id="${snap.id}"] .mem-restore').click();0`);
  await until(`!document.getElementById('confirm-modal').classList.contains('hidden')`, 'restore confirm');
  await ev(`document.getElementById('confirm-ok').click();0`);
  await until(`document.querySelector('${PANE} .mem-row[data-name="testing"]')`, 'testing.md back');
  const rows5 = await ev(`[...document.querySelectorAll('${PANE} .mem-row')].map(r=>r.dataset.name)`);
  check('5', 'Restore replaces the scope with that snapshot: testing.md is back in the store next to style and traps',
    !!(await readMemory(memoryRoot(), GLOBAL_SCOPE, 'testing')) && rows5.join(',') === 'style,testing,traps', { snap: snap.id, rows5 });

  // ---- (6a) a REAL defragment run through the wrapper -----------------------
  const r = await api('/api/memory/global/defragment', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectKey: project.key, mock: true }) });
  if (r.status !== 200) throw new Error(`POST /api/memory/global/defragment -> ${r.status} ${JSON.stringify(r.body)}`);
  const entry = runs.get(r.body.runId);
  for (let i = 0; i < 300 && (!entry || !['done', 'error', 'stopped'].includes(String(entry.status))); i += 1) await sleep(200);
  // entry.status mirrors the `state` frame and reads 'done' BEFORE _buildResults()/_stampDefrag()
  // have run — so the STAMP, not the entry, is what says the run finished its memory work.
  let rep = null;
  for (let i = 0; i < 150; i += 1) {
    rep = (await api('/api/memory/global')).body;
    if (rep && rep.health && rep.health.lastDefragRunId) break;
    await sleep(200);
  }
  check('6a', 'the wrapper started one run (200 { runId }) that defragmented the global scope: the stamp names its pipeline, the write counter is reset and no defrag is live any more',
    typeof r.body.runId === 'string' && entry && entry.status === 'done' && rep.health.lastDefragRunId === entry.pipelineId
    && rep.health.writesSinceDefrag === 0 && rep.defragRunId === null,
    { status: r.status, runId: r.body.runId, pipelineId: entry && entry.pipelineId, health: rep && rep.health, defragRunId: rep && rep.defragRunId });

  // ---- (6b) the live control, rendered deterministically inside the page -----
  const live = await ev(`(async()=>{const m=await import('/memory-view.mjs');const rep=await (await fetch('/api/memory/global')).json();
    const el=m.renderHealthCard({...rep,defragRunId:'proof-run'},{doc:document});const b=el.querySelector('.mem-defrag');
    return {runId:b.dataset.runId,disabled:b.disabled,text:b.textContent,run:!!el.querySelector('.mem-run'),hint:!!el.querySelector('.mem-host-hint')};})()`);
  check('6b', 'while a defragment run is live the SAME button opens it: data-run-id, enabled, "Defragmenting… open the run", and no second control',
    live.runId === 'proof-run' && live.disabled === false && live.text === 'Defragmenting… open the run' && live.run === false && live.hint === false, live);

  // ---- (6c) and the real card is back to an enabled Defragment --------------
  await go('settings/memory');
  await until(`document.querySelector('${PANE} .mem-health .badge')`, 'memory pane repainted');
  const after6 = await ev(`(()=>{const p=document.querySelector('${PANE}');const b=p.querySelector('.mem-defrag');return {
    disabled:b.disabled,runId:b.dataset.runId||null,text:b.textContent,run:!!p.querySelector('.mem-run'),
    rows:[...p.querySelectorAll('.mem-row')].map(x=>x.dataset.name)};})()`);
  check('6c', 'after the run the button is an enabled Defragment again, and the merged scope lost the file the mock emptied',
    after6.disabled === false && after6.runId === null && after6.text === 'Defragment' && after6.run === false
    && after6.rows.join(',') === 'style,traps', after6);

  // ---- (7) the project page's Memory tab + its deep link -------------------
  await go(`projects/${project.key}/memory/conventions`);
  await until(`document.querySelector('#proj-detail .pd-sec-memory .mem-editor')`, 'project page open on the file');
  const pr = await ev(`(()=>{const d=document.querySelector('#proj-detail');return {
    open:document.getElementById('proj-shell').classList.contains('detail-open'),
    title:d.querySelector('.pd-title').textContent.trim(),
    tab:d.querySelector('.pd-tab.active').dataset.sec,
    name:d.querySelector('.mem-name').value,rows:[...d.querySelectorAll('.mem-row')].map(r=>r.dataset.name),
    hint:!!d.querySelector('.mem-host-hint'),defragDisabled:d.querySelector('.mem-defrag').disabled,
    expander:!!document.querySelector('#projects-list .proj-mem-head')};})()`);
  check('7', 'the project page is open on its Memory tab with conventions.md in the editor, lists only that scope, its Defragment needs no host project, and the list has no expander',
    pr.open === true && pr.title === 'memproof' && pr.tab === 'memory' && pr.name === 'conventions' && pr.rows.join(',') === 'conventions'
    && pr.defragDisabled === false && pr.hint === false && pr.expander === false, pr);

  // ---- (7b) the pills are hash-first ------------------------------------------
  await ev(`document.getElementById('pd-tab-overview').click();0`);
  await until(`location.hash === '#projects/${project.key}'`, 'the Overview route');
  const ov = await ev(`(()=>{const d=document.querySelector('#proj-detail');return {
    tab:d.querySelector('.pd-tab.active').dataset.sec,
    path:d.querySelector('.pd-ov-card-path .pd-ov-value').textContent,
    memoryHidden:d.querySelector('.pd-sec[data-sec="memory"]').hidden};})()`);
  check('7b', 'clicking Overview routes to #projects/<key>, lights its pill, hides the Memory section and shows the project path',
    ov.tab === 'overview' && ov.path === project.path && ov.memoryHidden === true, ov);

  // ---- (8) the picker's Memory scope row ------------------------------------
  await go('new');
  await until(`document.getElementById('workflowSelect') && [...document.getElementById('workflowSelect').options].some(o=>o.value==='wf_memory_defrag')`, 'picker lists the defrag workflow');
  const pick = await ev(`(()=>{const sel=document.getElementById('workflowSelect');const row=document.getElementById('memory-scope-row');
    const before=row.hidden;sel.value='wf_memory_defrag';sel.dispatchEvent(new Event('change'));return {before,after:row.hidden};})()`);
  await until(`document.getElementById('memory-scope-row').hidden === false`, 'scope row shown');
  const pick2 = await ev(`(()=>{const sel=document.getElementById('workflowSelect');sel.value='wf_default';sel.dispatchEvent(new Event('change'));
    return document.getElementById('memory-scope-row').hidden;})()`);
  await until(`document.getElementById('memory-scope-row').hidden === true`, 'scope row hidden again');
  check('8', 'the Memory scope row is hidden for Default, shown for Memory defragment, and hidden again',
    pick.before === true && pick.after === false && pick2 === true, { pick, pick2 });

  // ---- (9) the History memory chips are live links ---------------------------
  const hist = await api('/api/history');
  const rec = (hist.body.pipelines || []).find((p) => p.id === entry.pipelineId);
  if (!rec) throw new Error(`pipeline ${entry.pipelineId} is not in /api/history`);
  await go(`history/${rec.projectKey}/${rec.id}`);
  // Overview is a LAZY tab body and this run has results, so the detail opens on Diff
  // (initDetailTabs' `initial`): click the pill, whose id the tab engine mints as `hd-tab-<key>`.
  await until(`document.getElementById('hd-tab-overview')`, 'the History detail tab bar');
  await ev(`document.getElementById('hd-tab-overview').click();0`);
  await until(`document.querySelector('#hist-detail .hd-ov-mem .hd-mem-chip')`, 'the memory-changes block');
  const chips = await ev(`[...document.querySelectorAll('#hist-detail .hd-ov-mem .hd-mem-chip')].map(c=>c.tagName+' '+c.textContent)`);
  await ev(`(()=>{const c=[...document.querySelectorAll('#hist-detail .hd-ov-mem button.hd-mem-chip')].find(x=>x.textContent.indexOf('~ global/')===0);
    if(!c)throw new Error('no modified global chip');c.click();return 1;})()`);
  await until(`location.hash.indexOf('#settings/memory/') === 0`, 'the chip routed to the file');
  await until(`document.querySelector('${PANE} .mem-editor')`, 'the chip opened the editor');
  const hash9 = await ev('location.hash');
  const name9 = await ev(`document.querySelector('${PANE} .mem-name').value`);
  check('9', 'the History run records its memory changes as chips — the modified one is a BUTTON that opens the file in Settings → Memory, the deleted one an inert span',
    chips.some((c) => c.indexOf('BUTTON ~ global/') === 0) && chips.some((c) => c.indexOf('SPAN ') === 0)
    && hash9 === '#settings/memory/style' && name9 === 'style', { chips, hash9, name9 });

  check('console', 'no page errors or exceptions', errors.length === 0, errors.slice(0, 5));
} catch (e) {
  failed += 1;
  console.log(`FAIL (fatal) ${e && e.stack ? e.stack : e}`);
}
console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`} — ${((Date.now() - T0) / 1000).toFixed(1)}s`);
await shutdown(failed === 0 ? 0 : 1);
