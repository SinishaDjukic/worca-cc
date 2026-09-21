#!/usr/bin/env node
// tools/verify-scripts-cdp.mjs — headless-Chrome proof of the Scripts page and its
// test bench (scripts-workbench-design.md §5, §12): the rail entry and the list, the
// no-prose rule, creating a node script from the page, running it in the bench (a
// streamed line, the output tab, the rendered markdown), saving a case, Run all
// against a real expectation, and the `[hidden]` rule — in BOTH themes. NOT part of
// `npm test`: it needs Chrome and a live server, and it runs a real child process.
// Run: node tools/verify-scripts-cdp.mjs   (or: npm run verify:scripts)
//
// -- CI COVERAGE -------------------------------------------------------------
// .github/workflows/ci.yml job `cdp` runs this on every push and pull request (Task 13
// adds it to that job's run line). What
// stays CDP-only is everything jsdom cannot produce: real fetches against a real
// store, a real child process through the real runner, the WS bench family end to
// end, computed styles (so `[hidden]` vs an author `display` is visible), both
// themes, and the no-page-error gate. The DOM shapes are pinned in
// test/ui-scripts-view.test.mjs, test/ui-script-detail.test.mjs and
// test/ui-script-bench.test.mjs.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
const CHROME = process.env.CHROME_BIN || CHROME_PATHS.find((p) => existsSync(p)) || CHROME_PATHS[0];
const SANDBOX = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0
  ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
if (!existsSync(CHROME)) { console.error(`no Chrome at ${CHROME} - set CHROME_BIN`); process.exit(1); }
const PORT = Number(process.env.CDP_PORT || 9338);
const T0 = Date.now();
const log = (m) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}\n`);

let chrome = null; let srv = null; let home = null; let proj = null; let profile = null; let failed = 0;
async function shutdown(code) {
  try { if (chrome) chrome.kill('SIGKILL'); } catch {}            // kill Chrome on EVERY exit path
  try { if (srv) await new Promise((r) => srv.close(r)); } catch {}
  for (const dir of [home, proj, profile]) { try { if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 3 }); } catch {} }
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection']) {
  process.on(sig, (e) => { if (e && e.stack) console.error(e.stack); shutdown(1); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- an isolated home + a one-commit project + the app server (env BEFORE the
// import, the house pattern). Chrome needs the REAL home for its caches, so it
// gets REAL_ENV back below.
home = await mkdtemp(path.join(tmpdir(), 'worca-scripts-home-'));
const REAL_ENV = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
process.env.WORCA_HOME = home;
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.WORCA_MOCK = '1';       // nothing here spawns claude; the bench ignores mock (W13)
proj = await mkdtemp(path.join(tmpdir(), 'worca-scripts-proj-'));
for (const a of [['init', '-q'], ['config', 'user.email', 'proof@worca.local'], ['config', 'user.name', 'proof']]) {
  execFileSync('git', a, { cwd: proj });
}
await writeFile(path.join(proj, 'README.md'), '# scripts proof\n');
execFileSync('git', ['add', '-A'], { cwd: proj });
execFileSync('git', ['commit', '-qm', 'init'], { cwd: proj });
// The bench streams over /ws (checks 4-7) and the WebSocketServer is attached to the
// MODULE's `server` (ui/server.mjs) — a bare http.createServer(app) answers the /ws
// upgrade with 404 and no frame ever arrives. verify-theme-cdp.mjs boots the same way;
// verify-memory/composer use `app` only because they read no WS frame.
const { server } = await import(new URL('../ui/server.mjs', import.meta.url).href);
srv = server;
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
// Scripts is an EXPERT view (docs/ui-levels.md) and a fresh WORCA_HOME serves Simple, which
// hides the rail entry and bounces the route — pin the mode the way verify-theme-cdp.mjs does.
{ const r = await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uiLevel: 'expert' }) });
  if (!r.ok) throw new Error(`could not pin the interface mode: HTTP ${r.status}`); }
// AFTER the server import, so db.mjs has migrated the temp home this proof owns.
const { addProject } = await import(new URL('../src/core/projects.mjs', import.meta.url).href);
const store = await import(new URL('../src/core/script-store.mjs', import.meta.url).href);
await addProject({ name: 'scriptproof', path: proj });
log(`server ${base} · project ${proj}`);

const KEY = 'proofScript';                         // = keyFromName('Proof script'): the wizard derives it, the proof types the NAME
// What the page's inference must read off this program: inputs.plan (optional — the proof also runs it
// UNBOUND, so the read is guarded), outputs.out (md: no JSON near the write) and params.limit (?? 3 → number).
// Checks 3–5 assert on the three quoted strings; keep them.
const SOURCE = [
  'export default async function ({ inputs, outputs, params, ctx, log }) {',
  "  const fs = await import('node:fs');",
  "  const plan = inputs.plan ? fs.readFileSync(inputs.plan.path, 'utf8') : '';",
  "  console.log('streamed from the proof');",
  "  log('info', 'the harness log channel');",
  "  fs.writeFileSync(outputs.out.path, '# proof\\n\\nit ran in the bench (' + plan.length + ' chars of plan, limit ' + Number(params.limit ?? 3) + ')\\n');",
  "  return { summary: 'ran in the bench' };",
  '}',
  '',
].join('\n');

// ---- chrome + cdp ----------------------------------------------------------
profile = await mkdtemp(path.join(tmpdir(), 'worca-scripts-profile-'));
chrome = spawn(CHROME, ['--headless=new', ...SANDBOX, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1440,960', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
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
function cdp(method, params = {}, ms = 20000) {
  const id = ++msgId;
  return new Promise((res, rej) => {
    const to = setTimeout(() => { pending.delete(id); rej(new Error(`CDP TIMEOUT ${method}`)); }, ms);
    pending.set(id, { res: (v) => { clearTimeout(to); res(v); }, rej: (er) => { clearTimeout(to); rej(er); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const waitEvent = (name, ms = 20000) => new Promise((res, rej) => {
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
const kick = () => cdp('Page.captureScreenshot', { format: 'jpeg', quality: 1, clip: { x: 0, y: 0, width: 16, height: 16, scale: 1 } }, 20000).catch(() => null);
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
  for (let i = 0; i < 80; i += 1) { if (await ev('!!(window.__scripts && window.__scripts.ctl)')) break; await sleep(100); }
  await settle(`load ${hash}`);
}
async function until(expr, tag, tries = 150) {
  for (let i = 0; i < tries; i += 1) {
    if (await ev(`(()=>{try{return !!(${expr});}catch(e){return false;}})()`)) return true;
    await kick(); await sleep(120);
  }
  throw new Error(`timeout waiting for ${tag}`);
}
const VIEW = '[data-view="scripts"]:not(.hidden)';
// Every field write goes through the event the page listens to, never .value alone.
const setField = (name, value, evName = 'input') => ev(
  `(()=>{const n=document.querySelector('${VIEW} [data-field="${name}"]');if(!n)throw new Error('no field ${name}');`
  + `n.value=${JSON.stringify(value)};n.dispatchEvent(new Event(${JSON.stringify(evName)},{bubbles:true}));return 1;})()`);
const clickIn = (sel) => ev(`(()=>{const n=document.querySelector('${VIEW} ${sel}');if(!n)throw new Error('no ${sel}');n.click();return 1;})()`);
const setTheme = async (attr) => { await ev(`document.documentElement.dataset.theme=${JSON.stringify(attr)};0`); await settle(`theme ${attr}`); };

try {
  // ---- (1) the rail entry and the list --------------------------------------
  await go('scripts', { first: true });
  await until(`document.querySelector('${VIEW} .script-card')`, 'the list painted');
  const list = await ev(`(()=>{const rail=[...document.querySelectorAll('.nav button[data-nav]')].map(b=>b.dataset.nav);
    return {after:rail[rail.indexOf('agents')+1],active:document.querySelector('.nav button[data-nav="scripts"]').classList.contains('active'),
      keys:[...document.querySelectorAll('${VIEW} .script-card')].map(c=>c.dataset.scriptKey),
      title:document.querySelector('${VIEW} h1').textContent};})()`);
  check('1', 'Scripts sits directly under Agents in the rail and the page lists the three built-ins',
    list.after === 'scripts' && list.active === true && list.title === 'Scripts'
    && ['shell', 'js', 'gitDiff'].every((k) => list.keys.includes(k)), list);

  // ---- (2) the no-prose rule, in the LIVE app -------------------------------
  const prose = await ev(`(()=>{const v=document.querySelector('[data-view="scripts"]');
    return {p:[...v.querySelectorAll('p')].filter(n=>!n.closest('.bench-out-body')).length,msg:document.getElementById('scripts-msg').tagName};})()`);
  check('2', 'the Scripts page carries no explanatory prose: zero <p> in the view, and the message line is a div',
    prose.p === 0 && prose.msg === 'DIV', prose);

  // ---- (3) the wizard (script-wizard plan): pick node, name it, type a program, watch the rows appear, Save
  await go('scripts/new');
  await until(`document.querySelector('${VIEW} .wz-step-1 .rt[data-runtime="node"]')`, 'the runtime step');
  await clickIn('.rt[data-runtime="node"]');
  await clickIn('.wz-continue');
  await until(`location.hash === '#scripts/new/node' && document.querySelector('${VIEW} .wz-step-2 [data-field="meta:displayName"]')`, 'step 2');
  await setField('meta:displayName', 'Proof script');
  await until(`document.querySelector('${VIEW} [data-field="meta:key"]').value === '${KEY}'`, 'the derived key');
  await setField('script:source', SOURCE);        // the code editor's textarea: its input event is the live-inference hook (150 ms debounce)
  await until(`document.querySelector('${VIEW} .wz-prow[data-side="inputs"][data-id="plan"]') && document.querySelector('${VIEW} .wz-prow[data-side="outputs"][data-id="out"]')`
    + ` && (document.querySelector('${VIEW} [data-field="iface:param:limit:default"]')||{}).value === '3'`, 'the interface read from the code');
  await until(`document.querySelector('${VIEW} .script-test-mount .bench[data-unsaved="true"] [data-field="in:plan:bound"]')`, 'the bench mounted for the draft');
  // W10 for a key that is NOT on disk yet: Test runs the draft through the real bench BEFORE any Save.
  await clickIn('.bench-run');
  await until(`document.querySelector('${VIEW} .bench-status-text').textContent === 'clean'`, 'the draft ran clean', 300);
  const draftRun = await ev(`(()=>{const b=document.querySelector('${VIEW} .bench');return {
    chip:b.querySelector('.bench-draft').hidden ? '' : b.querySelector('.bench-draft').textContent,
    dot:b.querySelector('.bench-dot').dataset.status,
    fired:[...b.querySelectorAll('.bench-fired-chip')].map(x=>x.textContent),
    logText:b.querySelector('.bench-pane[data-rpane="log"] .bench-log').textContent};})()`);
  const userDir = store.userScriptsDir();
  const draftFiles = existsSync(userDir) ? (await readdir(userDir)).filter((f) => f === `${KEY}.mjs` || f.startsWith('.bench-')) : [];
  check('3a', 'an UNSAVED draft of a key not on disk runs through the real bench: the result wears `unsaved draft`, the out port fired, and nothing is on disk under the key',
    draftRun.chip === 'unsaved draft' && draftRun.dot === 'clean' && draftRun.fired.includes('out')
    && draftRun.logText.includes('streamed from the proof') && draftFiles.length === 0, { ...draftRun, logText: draftRun.logText.slice(0, 120), draftFiles });
  await clickIn('.script-save');
  await until(`location.hash === '#scripts/${KEY}'`, 'the save routed to the saved script');
  const saved = await store.readScript(KEY);
  const onDisk = path.basename(saved ? saved.sourcePath || '' : '');
  check('3', 'the page created a node script on the user layer: the meta, the .mjs the store named, and the port it was given',
    !!saved && saved.meta.runtime === 'node' && saved.meta.displayName === 'Proof script'
    && onDisk === `${KEY}.mjs` && saved.source.includes('streamed from the proof')
    && (saved.meta.outputs || []).some((o) => o.id === 'out' && o.type === 'md'),
    { onDisk, outputs: saved && saved.meta.outputs, dir: store.userScriptsDir() });

  // ---- (4) run it in the bench ---------------------------------------------
  await go(`scripts/${KEY}/test`);
  await until(`document.querySelector('${VIEW} .bench .bench-run')`, 'the Test tab mounted');
  await clickIn('.bench-run');
  await until(`document.querySelector('${VIEW} .bench-status-text').textContent === 'clean'`, 'the bench finished clean', 300);
  const ran = await ev(`(()=>{const b=document.querySelector('${VIEW} .bench');return {
    status:b.querySelector('.bench-status-text').textContent,
    dot:b.querySelector('.bench-dot').dataset.status,
    exit:(b.querySelector('.bench-exit')||{}).textContent||'',
    logText:b.querySelector('.bench-pane[data-rpane="log"] .bench-log').textContent,
    tabs:[...b.querySelectorAll('.bench-tabs button')].map(x=>x.dataset.rtab),
    fired:[...b.querySelectorAll('.bench-fired-chip')].map(x=>x.textContent)};})()`);
  check('4', 'the bench ran the real program: a streamed line reached the Log pane, the out port fired, and the status is clean',
    ran.status === 'clean' && ran.dot === 'clean' && ran.exit === 'exit 0'
    && ran.logText.includes('streamed from the proof') && ran.tabs.includes('out') && ran.fired.includes('out'),
    { ...ran, logText: ran.logText.slice(0, 120) });

  // ---- (5) the output tab renders what the script wrote ---------------------
  await clickIn('.bench-tabs button[data-rtab="out"]');
  await until(`document.querySelector('${VIEW} .bench-pane[data-rpane="out"]:not([hidden])')`, 'the out pane');
  const out = await ev(`(()=>{const p=document.querySelector('${VIEW} .bench-pane[data-rpane="out"]');return {
    text:p.textContent,md:!!p.querySelector('.artifact-markdown'),raw:p.querySelector('.bench-raw').textContent};})()`);
  check('5', 'the md output renders through the app`s markdown pipeline, with a Raw toggle beside it',
    out.text.includes('it ran in the bench') && out.md === true && out.raw === 'Raw', out);

  // ---- (6) author the expectation and save a case, ALL through the page ------
  // `Use result` copies the verdict and the fired ports off the run that just
  // finished — the loop the spec describes: run once, keep what it did.
  await clickIn('.bench-expect-from-result');
  await until(`document.querySelector('${VIEW} [data-field="expect:fired:out"]')`, 'the expect chips');
  const expectRow = await ev(`(()=>{const b=document.querySelector('${VIEW} .bench');return {
    verdict:b.querySelector('[data-field="expect:verdict"]').value,
    fired:[...b.querySelectorAll('.bench-expect-chip input')].filter(c=>c.checked).map(c=>c.dataset.field),
    summary:b.querySelector('[data-field="expect:summaryIncludes"]').value};})()`);
  await setField('bench:caseName', 'first run');
  await clickIn('.bench-save-case');
  await until(`[...document.querySelectorAll('${VIEW} .bench-case-row .bench-case-name')].some(n=>n.textContent==='first run')`, 'the case row');
  const casesFile = path.join(store.userScriptsDir(), `${KEY}.tests.json`);
  const cases = JSON.parse(await readFile(casesFile, 'utf8'));
  check('6', 'Use result + Save as case wrote <key>.tests.json beside the script, expectation included',
    expectRow.verdict === 'clean' && expectRow.fired.join(',') === 'expect:fired:out' && expectRow.summary === ''
    && cases.version === 1 && cases.cases.length === 1 && cases.cases[0].name === 'first run'
    && cases.cases[0].id === 'first-run' && cases.cases[0].cwd.kind === 'scratch'
    && cases.cases[0].expect && cases.cases[0].expect.verdict === 'clean'
    && (cases.cases[0].expect.fired || []).join(',') === 'out', { expectRow, cases });

  // ---- (7) Run all against the expectation the page just authored -----------
  await clickIn('.bench-run-all');
  await until(`/passed 1/.test(document.querySelector('${VIEW} .bench-status-text').textContent)`, 'Run all finished', 300);
  const all = await ev(`(()=>{const b=document.querySelector('${VIEW} .bench');return {
    status:b.querySelector('.bench-status-text').textContent,
    dots:[...b.querySelectorAll('.bench-case-row .script-dot')].map(d=>d.dataset.state),
    dotPx:[...b.querySelectorAll('.bench-case-row .script-dot')].map(d=>{const c=getComputedStyle(d);return c.width+' '+c.backgroundColor;}),
    expect:(b.querySelector('.bench-expect-state')||{}).textContent||''};})()`);
  // PIXELS, not only the data attribute: the dot once rendered 0x0 and transparent
  // (its rule was scoped to the list card) while `dataset.state` read `pass`.
  const painted = (s) => /^8px rgba?\(/.test(s) && !/,\s*0\)$/.test(s);
  check('7', 'Run all passes the saved case: the aggregate counts it, its dot is green AND really painted, and the expect line agrees',
    all.status === 'passed 1 · failed 0 · unchecked 0' && all.dots.join(',') === 'pass' && all.dotPx.every(painted)
    && all.expect === 'expect pass', all);

  // ---- (7b) rename and delete the case, both through the page ---------------
  await ev(`(()=>{const r=document.querySelector('${VIEW} .bench-case-row[data-case-id="first-run"]');
    r.querySelector('.bench-case-rename').click();
    const box=r.querySelector('.bench-case-rename-input');box.value='renamed run';
    box.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return 1;})()`);
  await until(`[...document.querySelectorAll('${VIEW} .bench-case-name')].some(n=>n.textContent==='renamed run')`, 'the rename landed');
  const renamed = JSON.parse(await readFile(casesFile, 'utf8'));
  await clickIn('.bench-case-row[data-case-id="first-run"] .bench-case-delete');
  await until(`!document.getElementById('confirm-modal').classList.contains('hidden')`, 'the delete confirm');
  const copy = await ev(`document.getElementById('confirm-message').textContent`);
  await ev(`document.getElementById('confirm-ok').click();0`);
  await until(`!document.querySelector('${VIEW} .bench-case-row')`, 'the case row went');
  // The store REMOVES <key>.tests.json with its last case (script-store.mjs writeCases), it does not leave `cases: []`.
  const fileGone = !existsSync(casesFile);
  check('7b', 'Rename keeps the id and rewrites the file; Delete asks by name through the app`s own confirm modal and the emptied file is removed',
    renamed.cases.length === 1 && renamed.cases[0].id === 'first-run' && renamed.cases[0].name === 'renamed run'
    && copy === 'Delete case "renamed run"?' && fileGone === true,
    { renamed: renamed.cases, copy, fileGone });

  // ---- (8) `[hidden]` really means not displayed -----------------------------
  // jsdom reports the ATTRIBUTE; only a computed style catches an author
  // `display` rule winning over it (the .btn{display:inline-flex} trap).
  const hidden = await ev(`(()=>{const d=(sel)=>{const n=document.querySelector('${VIEW} '+sel);
      return n?{present:true,attr:n.hidden,display:getComputedStyle(n).display}:{present:false};};
    return {adv:d('.wz-adv-body'),dirty:d('.script-dirty'),file:d('.bench-port input[type="file"].bench-file')};})()`);
  check('8', 'every [hidden] control on the page is really not displayed (computed style, not the attribute)',
    ['adv', 'dirty', 'file'].every((k) => hidden[k].present && hidden[k].attr === true && hidden[k].display === 'none'), hidden);

  // ---- (9) the dark theme ----------------------------------------------------
  const readShell = () => ev(`(()=>{const v=document.querySelector('[data-view="scripts"]');const b=v.querySelector('.bench');
    return {p:[...v.querySelectorAll('p')].filter(n=>!n.closest('.bench-out-body')).length,colBg:getComputedStyle(v.querySelector('.bench-col')).backgroundColor,
      ink:getComputedStyle(v.querySelector('.bench-status-text')).color,
      dot:getComputedStyle(b.querySelector('.bench-dot')).backgroundColor,
      expectBg:getComputedStyle(b.querySelector('.bench-expect-head .ins-select')).backgroundColor,
      paneDisplay:getComputedStyle(v.querySelector('.wz-adv-body')).display,
      editorInk:getComputedStyle(document.querySelector('.code-editor .code-editor-hl')||v).color};})()`);
  await setTheme('light');
  const light = await readShell();
  await setTheme('dark');
  const dark = await readShell();
  const opaque = (c) => /^rgba?\(/.test(c) && !/,\s*0\)$/.test(c);
  check('9', 'the page holds up in both themes: the panel, the ink and the Expect row`s field move with the theme, the status dot stays coloured, the hidden pane stays hidden and no prose appears',
    light.p === 0 && dark.p === 0 && light.colBg !== dark.colBg && light.ink !== dark.ink
    && light.expectBg !== dark.expectBg && opaque(light.expectBg) && opaque(dark.expectBg)
    && opaque(light.dot) && opaque(dark.dot)
    && light.paneDisplay === 'none' && dark.paneDisplay === 'none',
    { light, dark });
  await setTheme('light');

  check('console', 'no page errors or exceptions', errors.length === 0, errors.slice(0, 5));
} catch (e) {
  failed += 1;
  console.log(`FAIL (fatal) ${e && e.stack ? e.stack : e}`);
}
console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`} — ${((Date.now() - T0) / 1000).toFixed(1)}s`);
await shutdown(failed === 0 ? 0 : 1);
