#!/usr/bin/env node
// scripts/verify-artifacts-cdp.mjs — headless-Chrome proof of the run-folder
// artifacts UI (run-folder-artifacts-design.md §7, §10): the History Artifacts tab
// groups a finished mock run's step-folder files per node with cycle captions and
// kind chips, a verdict row opens the JSON viewer, plan-v2.md opens the markdown
// viewer, the plural route answers steps/ rows with `truncated: false`, and the
// page logs no error. Every check is also screenshotted as evidence into
// ARTIFACTS_PROOF_DIR (default .worca-cc-smoke/proof — gitignored).
// NOT part of `npm test`: needs Chrome + a live server. Run: npm run verify:artifacts
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
const CHROME = process.env.CHROME_BIN || CHROME_PATHS.find((p) => existsSync(p)) || CHROME_PATHS[0];
const SANDBOX = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0
  ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
if (!existsSync(CHROME)) { console.error(`no Chrome at ${CHROME} - set CHROME_BIN`); process.exit(1); }
const PORT = Number(process.env.CDP_PORT || 9336);
const PROOF_DIR = path.resolve(process.env.ARTIFACTS_PROOF_DIR || path.join('.worca-cc-smoke', 'proof'));
const T0 = Date.now();
const log = (m) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
function check(n, what, ok, detail) {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} (${n}) ${what}${ok ? '' : `\n      ${JSON.stringify(detail)}`}`);
}

// ---- a one-commit git project + the app server (env BEFORE the import)
home = await mkdtemp(path.join(tmpdir(), 'worca-art-home-'));
process.env.WORCA_HOME = home;
process.env.WORCA_MOCK = '1';
proj = await mkdtemp(path.join(tmpdir(), 'worca-art-proj-'));
for (const a of [['init', '-q'], ['config', 'user.email', 'proof@worca.local'], ['config', 'user.name', 'proof']]) {
  execFileSync('git', a, { cwd: proj });
}
await writeFile(path.join(proj, 'README.md'), '# artifacts proof\n');
execFileSync('git', ['add', '-A'], { cwd: proj });
execFileSync('git', ['commit', '-qm', 'init'], { cwd: proj });
const { server, runs } = await import(new URL('../ui/server.mjs', import.meta.url).href);
srv = server;
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
await mkdir(PROOF_DIR, { recursive: true });
log(`server ${base} · project ${proj} · proof ${PROOF_DIR}`);
const api = async (p, opt) => {
  const r = await fetch(base + p, opt);
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; }
};

// ---- chrome + cdp
profile = await mkdtemp(path.join(tmpdir(), 'worca-art-profile-'));
chrome = spawn(CHROME, ['--headless=new', ...SANDBOX, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1280,900', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'],
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
// Headless Chrome does not tick rAF on its own: force frames with a tiny capture.
const kick = () => cdp('Page.captureScreenshot', { format: 'jpeg', quality: 1, clip: { x: 0, y: 0, width: 16, height: 16, scale: 1 } }, 15000).catch(() => null);
async function until(expr, tag, tries = 100) {
  for (let i = 0; i < tries; i += 1) {
    if (await ev(`(()=>{try{return !!(${expr});}catch(e){return false;}})()`)) return true;
    await kick(); await sleep(120);
  }
  throw new Error(`timeout waiting for ${tag}`);
}
async function go(hash) {
  await cdp('Page.navigate', { url: `${base}/#${hash}` });
  await waitEvent('Page.loadEventFired');
  for (let i = 0; i < 80; i += 1) { if (await ev('!!(window.__np && window.__np.getRun)')) break; await sleep(100); }
}
/** Click through the app's own listeners (the rows are <button>s). */
const clickSel = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.click();return true;})()`);
/** Full-page PNG evidence. */
async function shot(name) {
  await kick();
  const { data } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, 30000);
  const file = path.join(PROOF_DIR, name);
  await writeFile(file, Buffer.from(data, 'base64'));
  log(`screenshot ${file}`);
  return file;
}

try {
  // ---- drive a REAL mock wf_default run to done (answer its clarify question)
  const started = await api('/api/run', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectDir: proj, prompt: 'add a flag', workflowId: 'wf_default', mock: true }) });
  if (started.status !== 200) throw new Error(`POST /api/run -> ${started.status} ${JSON.stringify(started.body)}`);
  const runId = started.body.runId;
  const entry = runs.get(runId);
  for (let i = 0; i < 400 && !entry.pendingQuestion; i += 1) await sleep(100);
  if (!entry.pendingQuestion) throw new Error('the mock run never reached the clarify question');
  const q = entry.pendingQuestion;
  await api('/api/answer', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runId, id: q.id, payload: { answers: (q.questions || []).map((x) => ({ id: x.id, text: 'yes' })) } }) });
  for (let i = 0; i < 900 && !['done', 'error', 'stopped', 'aborted', 'failed', 'paused'].includes(entry.status); i += 1) await sleep(200);
  if (entry.status !== 'done') throw new Error(`the mock run ended ${entry.status}, not done`);
  const pid = entry.pipelineId;
  log(`run ${runId} done · pipeline ${pid}`);

  // ---- (1) the plural route: every row is a steps/ row, nothing under plans/ or reviews/
  const list = await api(`/api/runs/${pid}/artifacts`);
  const rels = (list.body.artifacts || []).map((a) => `${a.kind}:${a.relPath}`).sort();
  const stepRows = rels.filter((r) => r.includes(':steps/'));
  check(1, 'GET /api/runs/:id/artifacts: steps/ rows for clarify, plan ×3, verdict ×4, review ×2; truncated false; no plans/ or reviews/',
    list.status === 200 && list.body.truncated === false
    && stepRows.includes('clarify:steps/n_clarify-c1/clarify.json')
    && stepRows.includes('plan:steps/n_plan-c1/plan.md') && stepRows.includes('plan:steps/n_refine-c1/plan-v2.md') && stepRows.includes('plan:steps/n_refine-c2/plan-v3.md')
    && stepRows.includes('verdict:steps/n_refine-c1/refine-review-cycle1.json') && stepRows.includes('verdict:steps/n_review-c2/impl-review-cycle2.json')
    && stepRows.includes('review:steps/n_review-c1/impl-review-cycle1.md') && stepRows.includes('review:steps/n_review-c2/impl-review-cycle2.md')
    && !rels.some((r) => /:(plans|reviews)\//.test(r)), rels);

  // ---- (2) History → the run → Artifacts tab: groups per node, cycle captions, kind chips
  const hist = await api('/api/history');
  const rec = (hist.body.pipelines || []).find((p) => p.id === pid);
  if (!rec) throw new Error(`pipeline ${pid} is not in /api/history`);
  await go(`history/${rec.projectKey}/${rec.id}`);
  await until(`document.querySelector('#hist-detail .hd-tab[data-sec="artifacts"]')`, 'the Artifacts tab');
  await clickSel('#hist-detail .hd-tab[data-sec="artifacts"]');
  const SEC = '#hist-detail .hd-sec[data-sec="artifacts"]';
  await until(`document.querySelectorAll('${SEC} .artifact-row').length >= 11`, 'the artifact rows');
  const tab = await ev(`(()=>{const s=document.querySelector('${SEC}');
    return {groups:[...s.querySelectorAll('.artifact-group-head')].map((h)=>h.textContent.trim()),
      cycles:[...s.querySelectorAll('.artifact-cycle')].map((c)=>c.textContent.trim()),
      kinds:[...new Set([...s.querySelectorAll('.artifact-kind')].map((k)=>k.textContent.trim()))].sort(),
      names:[...s.querySelectorAll('.artifact-name')].map((n)=>n.textContent.trim()),
      truncated:!!s.querySelector('.artifact-truncated')};})()`);
  await shot('01-artifacts-tab.png');
  check(2, 'the Artifacts tab groups per node, shows cycle 1/cycle 2 captions for Refine and Review, and kind chips clarify/plan/review/verdict',
    tab.groups.length >= 4 && tab.cycles.filter((c) => c === 'cycle 1').length >= 2 && tab.cycles.filter((c) => c === 'cycle 2').length >= 2
    && ['clarify', 'plan', 'review', 'verdict'].every((k) => tab.kinds.includes(k))
    && tab.names.includes('plan-v2.md') && tab.names.includes('refine-review-cycle1.json') && tab.truncated === false, tab);

  // ---- (2b) the group's rows are CUT BY EXECUTION, in step order
  // Each captioned block must hold exactly the files ITS step folder holds
  // (steps/n_refine-c1/… under "cycle 1", steps/n_refine-c2/… under "cycle 2") —
  // grouping by node alone would list all four under one heading.
  const refine = await ev(`(()=>{const g=[...document.querySelectorAll('${SEC} .artifact-group')]
    .find((x)=>/Refine/i.test(x.querySelector('.artifact-group-head').textContent));
    if(!g) return null;
    const out=[];for(const ch of g.children){
      if(ch.classList.contains('artifact-cycle')) out.push('['+ch.textContent.trim()+']');
      else if(ch.classList.contains('artifact-row')) out.push(ch.querySelector('.artifact-name').textContent.trim());}
    return out;})()`);
  check('2b', 'the Refine group cuts its rows per execution: [cycle 1] its two files, then [cycle 2] its two',
    Array.isArray(refine) && refine.join(' ') === '[cycle 1] plan-v2.md refine-review-cycle1.json [cycle 2] plan-v3.md refine-review-cycle2.json',
    refine);

  // ---- (3) a verdict row opens the JSON viewer
  await ev(`(()=>{const r=[...document.querySelectorAll('${SEC} .artifact-row')].find((x)=>x.querySelector('.artifact-name').textContent.trim()==='impl-review-cycle1.json');r.click();return 1;})()`);
  await until(`document.querySelector('#viewer .artifact-view .artifact-json')`, 'the JSON viewer');
  const json = await ev(`(()=>{const v=document.querySelector('#viewer .artifact-view .artifact-json');
    return {title:document.querySelector('#viewer-title').textContent,text:v.textContent.slice(0,200),hidden:document.querySelector('#viewer-card').classList.contains('hidden')};})()`);
  await shot('02-verdict-viewer.png');
  check(3, 'clicking impl-review-cycle1.json opens the pretty-printed JSON viewer',
    !json.hidden && json.title === 'Artifact: impl-review-cycle1.json' && /"issues"/.test(json.text), json);

  // ---- (4) plan-v2.md opens the markdown viewer
  await ev(`document.querySelector('#viewer-close').click();1`);
  await ev(`(()=>{const r=[...document.querySelectorAll('${SEC} .artifact-row')].find((x)=>x.querySelector('.artifact-name').textContent.trim()==='plan-v2.md');r.click();return 1;})()`);
  await until(`document.querySelector('#viewer .artifact-view .artifact-markdown, #viewer .artifact-view .artifact-text')`, 'the markdown viewer');
  const md = await ev(`(()=>{const v=document.querySelector('#viewer .artifact-view');
    return {title:document.querySelector('#viewer-title').textContent,cls:v.firstElementChild&&v.firstElementChild.className,len:v.textContent.length};})()`);
  await shot('03-plan-v2-viewer.png');
  check(4, 'clicking plan-v2.md opens the markdown viewer with content',
    md.title === 'Artifact: plan-v2.md' && (md.cls === 'artifact-markdown' || md.cls === 'artifact-text') && md.len > 20, md);

  check('console', 'no page errors or exceptions', errors.length === 0, errors.slice(0, 5));
} catch (e) {
  failed += 1;
  console.log(`FAIL (fatal) ${e && e.stack ? e.stack : e}`);
}
console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`} — ${((Date.now() - T0) / 1000).toFixed(1)}s · evidence in ${PROOF_DIR}`);
await shutdown(failed === 0 ? 0 : 1);
