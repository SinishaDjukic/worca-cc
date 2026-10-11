#!/usr/bin/env node
// tools/verify-spec-builder-cdp.mjs — headless-Chrome proof of Spec Builder (docs/spec-builder.md): the flag
// turned on through the real PATCH /api/flags, the source button, the wizard, Generate (a real mock Ask turn
// whose propose_spec card the parent mints), "Use this spec" (the Markdown pane, Auto) and a real mock run whose
// Auto proposal honours the spec's worca: block (plan-complete-detailed, no clarify / planner stage).
// NOT part of `npm test`: it needs Chrome and a live server.
// Run: node tools/verify-spec-builder-cdp.mjs   (or: npm run verify:spec-builder)
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
const PORT = Number(process.env.CDP_PORT || 9339);
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

// ---- a one-commit git project + the app server (env BEFORE the import). The module's exported `server`,
// not http.createServer(app): the Ask card and the run's question arrive over /ws.
home = await mkdtemp(path.join(tmpdir(), 'worca-sb-home-'));
// settings.json (the stored flags) lives under HOME/USERPROFILE, not WORCA_HOME: sandbox both, so the PATCH
// below writes the proof's own settings. Chrome gets the real home back (REAL_ENV).
const REAL_ENV = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
process.env.WORCA_HOME = home;
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.WORCA_MOCK = '1';
delete process.env.WORCA_FLAGS;            // an env flag is locked: the PATCH must be the one turning it on
proj = await mkdtemp(path.join(tmpdir(), 'worca-sb-proj-'));
for (const a of [['init', '-q'], ['config', 'user.email', 'proof@worca.local'], ['config', 'user.name', 'proof']]) {
  execFileSync('git', a, { cwd: proj });
}
await writeFile(path.join(proj, 'README.md'), '# spec builder proof\n');
execFileSync('git', ['add', '-A'], { cwd: proj });
execFileSync('git', ['commit', '-qm', 'init'], { cwd: proj });
const { server, runs } = await import(new URL('../ui/server.mjs', import.meta.url).href);
srv = server;
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
{ const r = await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uiLevel: 'expert' }) });
  if (!r.ok) throw new Error(`could not pin the interface mode: HTTP ${r.status}`); }
const { addProject } = await import(new URL('../src/core/projects.mjs', import.meta.url).href);
await addProject({ name: 'sbproof', path: proj });
log(`server ${base} · project ${proj}`);

// ---- chrome + cdp
profile = await mkdtemp(path.join(tmpdir(), 'worca-sb-profile-'));
chrome = spawn(CHROME, ['--headless=new', ...SANDBOX, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1280,900', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--use-mock-keychain',
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
async function until(expr, tag, tries = 100) {
  for (let i = 0; i < tries; i += 1) {
    if (await ev(`(()=>{try{return !!(${expr});}catch(e){return false;}})()`)) return true;
    await kick(); await sleep(120);
  }
  throw new Error(`timeout waiting for ${tag}`);
}
const click = (sel) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)throw new Error('no '+${JSON.stringify(sel)});b.click();return 1;})()`);

try {
  // ---- (1) the flag, through the real API ------------------------------------
  const patched = await fetch(`${base}/api/flags`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ specBuilder: true }) });
  const flagRow = ((await patched.json()).flags || []).find((f) => f.key === 'specBuilder');
  check('1', 'PATCH /api/flags turns specBuilder on', patched.status === 200 && flagRow && flagRow.on === true, { status: patched.status, flagRow });

  // ---- (2) the source button --------------------------------------------------
  await cdp('Page.navigate', { url: `${base}/#new` });
  await waitEvent('Page.loadEventFired');
  await settle('load #new');
  await until(`document.querySelector('#projectSelect') && [...document.querySelector('#projectSelect').options].some(o=>o.value===${JSON.stringify(proj)})`, 'the project option');
  await ev(`(()=>{const s=document.querySelector('#projectSelect');s.value=${JSON.stringify(proj)};s.dispatchEvent(new Event('change'));return 1;})()`);
  await until(`document.querySelector('#source-seg button[data-spec-builder]')`, 'the Spec Builder button');
  const btn = await ev(`(()=>{const b=document.querySelector('#source-seg button[data-spec-builder]');return {prev:b.previousElementSibling.dataset.src,chip:b.nextElementSibling&&b.nextElementSibling.textContent,shown:b.offsetParent!==null};})()`);
  check('2', 'the Spec Builder button sits after Markdown with its Beta chip, and shows', btn.prev === 'markdown' && btn.chip === 'Beta' && btn.shown, btn);

  // ---- (3) the wizard and Generate --------------------------------------------
  await click('#source-seg button[data-spec-builder]');
  await until(`document.querySelector('[data-sb-goal]')`, 'the wizard');
  await ev(`(()=>{const g=document.querySelector('[data-sb-goal]');g.value='Add a dark mode toggle';g.dispatchEvent(new Event('input'));return 1;})()`);
  for (let i = 0; i < 3; i += 1) { await click('[data-sb-next]'); await settle('next'); }
  await until(`document.querySelector('[data-sb-summary]')`, 'the estimate');
  const summary = await ev(`document.querySelector('[data-sb-summary]').textContent`);
  check('3', 'the Estimate step shows a priced summary', /Rough estimate|past runs/.test(summary), summary);
  await click('[data-sb-generate]');
  await until(`/Drafting in Ask Worca/.test(document.querySelector('#plugin-source-pane').textContent)`, 'the drafting state');

  // ---- (4) the spec card, then Use this spec ----------------------------------
  await until(`document.querySelector('[data-ask-spec-use]')`, 'the spec card', 200);
  await click('[data-ask-spec-use]');
  await until(`document.querySelector('#promptMarkdown').value.startsWith('---\\nworca:')`, 'the Markdown pane filled');
  await until(`document.querySelector('#workflowSelect').value === 'wf_auto'`, 'Auto picked');
  const form = await ev(`({md:document.querySelector('#source-seg button[data-src="markdown"]').classList.contains('on'),wf:document.querySelector('#workflowSelect').value})`);
  check('4', 'Use this spec fills the Markdown pane with the worca: spec, Markdown on, workflow Auto', form.md && form.wf === 'wf_auto', form);

  // ---- (5) Start, and the Auto proposal ---------------------------------------
  const before = new Set(runs.keys());
  await click('#start-btn');
  let q = null;
  for (let i = 0; i < 200 && !q; i += 1) {
    const entry = [...runs.values()].find((r) => !before.has(r.id) && r.pendingQuestion && r.pendingQuestion.kind === 'workflow');
    if (entry) q = entry.pendingQuestion.workflow;
    else { await kick(); await sleep(150); }
  }
  if (!q) throw new Error('no Auto proposal on the new run');
  const agents = (q.order || []).map((id) => q.nodes[id] && q.nodes[id].key);
  check('5', 'the run\'s Auto proposal is plan-complete-detailed with no clarify / planner stage',
    q.taskKind === 'plan-complete-detailed' && !agents.some((a) => a === 'clarify' || a === 'planner'), { taskKind: q.taskKind, agents });

  check('console', 'no page errors or exceptions', errors.length === 0, errors.slice(0, 5));
} catch (e) {
  failed += 1;
  console.log(`FAIL (fatal) ${e && e.stack ? e.stack : e}`);
}
for (const r of runs.values()) { try { r.orch?.stop?.(); } catch { /* reap */ } }
console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`} — ${((Date.now() - T0) / 1000).toFixed(1)}s`);
await shutdown(failed === 0 ? 0 : 1);
