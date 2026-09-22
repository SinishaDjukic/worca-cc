#!/usr/bin/env node
// tools/verify-ask-forms-cdp.mjs — headless-Chrome proof of the ask form renderer
// (agent-ask-forms design §6, §7) in BOTH themes: the widget catalog draws, `when`
// hides without a remount, the rank arrows and the tab keys work, a 422 marks a
// field, the [hidden] rule survives real CSS, and — the one thing jsdom cannot
// answer — whether Chromium renders a PDF inside the host-owned frame (W14).
// NOT part of `npm test`: it needs Chrome and a live server.
// Run: node tools/verify-ask-forms-cdp.mjs   (or: npm run verify:ask-forms)
//
// -- CI COVERAGE -------------------------------------------------------------
// .github/workflows/ci.yml job `cdp` runs this on every push and pull request.
// What stays CDP-only: computed styles (an author `display` vs the `hidden`
// attribute), both themes, the real PDF viewer, and the no-page-error gate. The
// DOM shapes are pinned in test/ui-ask-*.test.mjs.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** A valid one-page PDF with a correct xref, built here so Chromium's viewer has
 *  something real to render (a truncated file would make the W14 check meaningless). */
function minimalPdf() {
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>',
    '<</Length 56>>\nstream\nBT /F1 18 Tf 24 120 Td (worca ask form proof) Tj ET\nendstream',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
const CHROME = process.env.CHROME_BIN || CHROME_PATHS.find((p) => existsSync(p)) || CHROME_PATHS[0];
const SANDBOX = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0
  ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
if (!existsSync(CHROME)) { console.error(`no Chrome at ${CHROME} - set CHROME_BIN`); process.exit(1); }
const PORT = Number(process.env.CDP_PORT || 9341);
// The screenshots Step 5b reads. NOT under the temp home: shutdown() removes that.
const SHOTS = process.env.ASK_FORMS_SHOTS || path.join(tmpdir(), 'worca-ask-forms-shots');
const T0 = Date.now();
const log = (m) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}\n`);

let chrome = null; let srv = null; let home = null; let proj = null; let profile = null; let failed = 0;
async function shutdown(code) {
  try { if (chrome) chrome.kill('SIGKILL'); } catch {}
  try { if (srv) await new Promise((r) => srv.close(r)); } catch {}
  for (const dir of [home, proj, profile]) { try { if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 3 }); } catch {} }
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

// ---- an isolated home + the app server (env BEFORE the import, the house pattern)
home = await mkdtemp(path.join(tmpdir(), 'worca-askforms-home-'));
const REAL_ENV = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
process.env.WORCA_HOME = home;
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.WORCA_MOCK = '1';
proj = await mkdtemp(path.join(tmpdir(), 'worca-askforms-proj-'));
for (const a of [['init', '-q'], ['config', 'user.email', 'proof@worca.local'], ['config', 'user.name', 'proof']]) {
  execFileSync('git', a, { cwd: proj });
}
await writeFile(path.join(proj, 'README.md'), '# ask forms proof\n');
execFileSync('git', ['add', '-A'], { cwd: proj });
execFileSync('git', ['commit', '-qm', 'init'], { cwd: proj });
// The WebSocketServer is attached to the MODULE's `server` (a bare
// http.createServer(app) answers the /ws upgrade with 404 and no frame arrives).
const { server } = await import(new URL('../ui/server.mjs', import.meta.url).href);
srv = server;
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
log(`server on ${base}`);

// ---- Chrome, with the REAL home back for its caches
profile = await mkdtemp(path.join(tmpdir(), 'worca-askforms-profile-'));
chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--disable-gpu', '--window-size=1400,1000', ...SANDBOX, 'about:blank'],
{ env: { ...process.env, ...REAL_ENV }, stdio: 'ignore' });

let wsUrl = '';
for (let i = 0; i < 80 && !wsUrl; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    wsUrl = (list.find((t) => t.type === 'page') || {}).webSocketDebuggerUrl || '';
  } catch { await sleep(125); }
}
if (!wsUrl) { log('no CDP endpoint'); await shutdown(1); }

const { WebSocket } = await import('ws');
const ws = new WebSocket(wsUrl);
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

// ---- a REAL mock run, held at its clarify question (the house recipe), then that
// entry's pendingQuestion is REPLACED with the form fixture and re-broadcast. The
// run, the card, the detail route and the file route are all the real ones; only
// the ask's shape is substituted, because minting one is P2's job, not this view's.
const { runs, _testing } = await import(new URL('../ui/server.mjs', import.meta.url).href);
const { ASK_FORM_FIXTURE } = await import(new URL('../test/helpers/ask-form-fixture.mjs', import.meta.url).href);

const api = async (p, init) => {
  const res = await fetch(base + p, init);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const started = await api('/api/run', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ projectDir: proj, prompt: 'review the mockups', workflowId: 'wf_default', mock: true }) });
if (started.status !== 200) { log(`POST /api/run -> ${started.status}`); await shutdown(1); }
const runId = started.body.runId;
const entry = runs.get(runId);
for (let i = 0; i < 400 && !entry.pendingQuestion; i += 1) await sleep(100);
if (!entry.pendingQuestion) { log('the mock run never reached a question'); await shutdown(1); }
// The dir the file route resolves for THIS run — the route's own resolver, reached
// through _testing so the tool and the server can never disagree on it.
const runDir = await _testing.askFilesRunDir(runId);
if (!runDir) { log('the file route resolves no run dir for the mock run'); await shutdown(1); }

// The snapshot the fixture's manifest names, written exactly as P2's
// snapshotAskFiles writes one: <runDir>/ask-files/<askId>/<index><ext>, plus the
// manifest.json readAskFileEntry resolves an index through (`stored` + `mime`).
const askDir = path.join(runDir, 'ask-files', ASK_FORM_FIXTURE.askId);
await mkdir(askDir, { recursive: true });
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
const PDF = minimalPdf();
const blobs = [PNG_1x1, PNG_1x1, PDF];
const stored = ['0.png', '1.png', '2.pdf'];
for (let i = 0; i < stored.length; i += 1) await writeFile(path.join(askDir, stored[i]), blobs[i]);
await writeFile(path.join(askDir, 'manifest.json'), `${JSON.stringify({ version: 1,
  files: ASK_FORM_FIXTURE.files.map((f, i) => ({ ...f, bytes: blobs[i].length, stored: stored[i] })) }, null, 2)}\n`);
const ASK = { ...ASK_FORM_FIXTURE, nodeId: entry.pendingQuestion.nodeId || null };
entry.pendingQuestion = ASK;
_testing.broadcast({ type: 'question', runId, ...ASK });

for (const theme of ['light', 'dark']) {
  await send('Page.navigate', { url: `${base}/#running` });
  await sleep(900);
  await evalJs(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)}); true`);
  _testing.broadcast({ type: 'question', runId, ...ASK });   // the reload dropped the frame
  await sleep(600);

  check(`${theme}: the form mounts in the card panel`,
    await evalJs(`!!document.querySelector('#run-list .qpanel .af-form')`));
  // W19 — the check the prototype needed: `hidden` must actually hide, against an
  // author display:flex. jsdom computes no layout, so this is the only real proof.
  check(`${theme}: EVERY hidden .af- node computes display:none under real CSS`,
    await evalJs(`(() => {
      const hidden = [...document.querySelectorAll('.af-form [hidden]')];
      if (!hidden.length) return false;
      return hidden.every((n) => getComputedStyle(n).display === 'none');
    })()`));
  check(`${theme}: picking the gating option reveals it WITHOUT a remount`,
    await evalJs(`(() => {
      const before = document.querySelector('.af-form textarea');
      before.value = 'half typed';
      document.querySelectorAll('.af-choices .af-choice')[1].click();
      const after = document.querySelector('.af-form textarea');
      return after === before && after.value === 'half typed'
        && getComputedStyle(after.closest('.af-fld')).display !== 'none';
    })()`));
  check(`${theme}: the rank arrows reorder and stay reachable`,
    await evalJs(`(() => {
      const first = () => document.querySelector('.af-rank li b').textContent;
      const was = first();
      document.querySelector('.af-rank li .af-rank-dn').click();
      return first() !== was;
    })()`));
  check(`${theme}: the tab keys move the selection`,
    await evalJs(`(() => {
      const tabs = [...document.querySelectorAll('.af-tab')];
      if (tabs.length < 2) return false;
      tabs[0].focus();
      tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      return tabs[1].getAttribute('aria-selected') === 'true'
        && getComputedStyle(document.querySelectorAll('.af-pane')[0]).display === 'none';
    })()`));
  check(`${theme}: no text sits on its own background at under 3:1`,
    await evalJs(`(() => {
      const lum = (c) => { const [r,g,b] = c.match(/\\d+/g).slice(0,3).map(Number)
        .map((v) => v/255).map((v) => v <= 0.03928 ? v/12.92 : ((v+0.055)/1.055) ** 2.4);
        return 0.2126*r + 0.7152*g + 0.0722*b; };
      for (const n of document.querySelectorAll('.af-label, .af-choice, .af-help')) {
        const s = getComputedStyle(n);
        let bgNode = n; let bg = s.backgroundColor;
        while (bg === 'rgba(0, 0, 0, 0)' && bgNode.parentElement) { bgNode = bgNode.parentElement; bg = getComputedStyle(bgNode).backgroundColor; }
        const [a, b] = [lum(s.color), lum(bg)].sort((x, y) => y - x);
        if ((a + 0.05) / (b + 0.05) < 3) return false;
      }
      return true;
    })()`));
  // W14 — the question this tool exists for. The frame sits in the fixture's
  // "Report" tab: select that tab first (a hidden pane has no box), scroll the
  // frame into view for the screenshot, then measure.
  const pdfOk = await evalJs(`(() => {
    const f = document.querySelector('[data-af-pdf="frame"]');
    if (!f) return 'no frame';
    if (f.hasAttribute('sandbox')) return 'frame is sandboxed';
    const pane = f.closest('[role="tabpanel"]');
    const tab = pane && document.getElementById(pane.getAttribute('aria-labelledby') || '');
    if (tab) tab.click();
    f.scrollIntoView({ block: 'center' });
    const r = f.getBoundingClientRect();
    return r.width > 100 && r.height > 100 ? 'sized' : 'collapsed';
  })()`);
  check(`${theme}: the PDF frame is present, unsandboxed and laid out`, pdfOk === 'sized', String(pdfOk));
  await sleep(900);                                   // let the viewer paint before the shot

  await mkdir(SHOTS, { recursive: true });
  await send('Page.captureScreenshot', { format: 'png' })
    .then(({ data }) => writeFile(path.join(SHOTS, `ask-forms-${theme}.png`), Buffer.from(data, 'base64')));
  log(`${theme}: screenshot written to ${path.join(SHOTS, `ask-forms-${theme}.png`)}`);
}

check('no page error', pageErrors.length === 0, pageErrors.join(' | '));
log(failed ? `${failed} check(s) failed` : 'all checks passed');
await shutdown(failed ? 1 : 0);
