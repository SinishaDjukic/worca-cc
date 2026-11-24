#!/usr/bin/env node
// tools/verify-run-stops-cdp.mjs — headless-Chrome proof of Shaper small runs C3 (When a run stops): a marked 10-run
// feature with real-length titles, seeded data only on the mock engine. Run 8 waits on a stop question (an objection at
// its exhausted code review), run 9 builds (independent), run 10 builds on run 8. At 375px in light and dark it captures
// the Chat feature card (the question, the answered fold after a held answer, the run rows with `waits for run 8`), the
// Chat run side panel `#chat/new/run/{pid}/overview` (stop open, then held) and the run page `#running/{runId}` (stop
// open): 12 PNGs, plus the prototype's `#run-stops` beside each theme, and a JSON log. It measures every card run row
// (one 32px line, a long title ellipsised), each mark's centre against its text, 1 primary on the card, 0 card buttons
// and 1 findings list in the panel, no horizontal overflow.
// NOT part of `npm test`: it needs Chrome. A hard 30-minute cap inside: past it the script exits non-zero.
// Run: H=$(mktemp -d); env -u FORCE_COLOR HOME=$H VERIFY_PORT=4939 SHOTS_DIR=… node --disable-warning=ExperimentalWarning tools/verify-run-stops-cdp.mjs
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CAP_MS = 30 * 60 * 1000;
const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
const CHROME = process.env.CHROME_BIN || CHROME_PATHS.find((p) => existsSync(p)) || CHROME_PATHS[0];
const SANDBOX = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0 ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
if (!existsSync(CHROME)) { console.error(`no Chrome at ${CHROME} - set CHROME_BIN`); process.exit(1); }
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROTOTYPE = path.join(ROOT, 'plans/shaper-refresh/prototype.html');
const WIDTH = 375;
const THEMES = ['light', 'dark'];
const T0 = Date.now();
const log = (m) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}\n`);

let chrome = null; let srv = null; let home = null; let proj = null; let profile = null; let failed = 0;
const results = { startedAt: new Date(T0).toISOString(), width: WIDTH, lists: [], shots: [], checks: [] };
async function shutdown(code) {
  try { if (chrome) chrome.kill('SIGKILL'); } catch {}
  try { if (srv) await new Promise((r) => srv.close(r)); } catch {}
  for (const d of [home, proj, profile]) { try { if (d) await rm(d, { recursive: true, force: true }); } catch {} }
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection']) {
  process.on(sig, (e) => { if (e && e.stack) console.error(e.stack); shutdown(1); });
}
// The hard cap: a proof that hangs never holds the run past 30 minutes.
setTimeout(() => { log(`FAIL the 30-minute cap was reached after ${((Date.now() - T0) / 60000).toFixed(1)} min`); shutdown(2); }, CAP_MS);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (ok, what) => { results.checks.push({ ok: !!ok, what }); if (ok) log(`ok   ${what}`); else { failed += 1; log(`FAIL ${what}`); } };

// ---- a sandboxed HOME and WORCA_HOME, the mock engine, the flag on, then the server in process (VERIFY_PORT, else a
// free port: never the inherited one, which is the host app's).
home = await mkdtemp(path.join(tmpdir(), 'worca-c3-home-'));
process.env.HOME = home; process.env.USERPROFILE = home;
process.env.WORCA_HOME = path.join(home, '.worca-cc');
process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
process.env.WORCA_MOCK = '1';
process.env.WORCA_FLAGS = 'shaperSmallRuns';
const SHOTS = process.env.SHOTS_DIR || await mkdtemp(path.join(tmpdir(), 'worca-c3-shots-'));
await mkdir(SHOTS, { recursive: true });
proj = await mkdtemp(path.join(tmpdir(), 'worca-c3-proj-'));
for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'proof@worca.local'], ['config', 'user.name', 'proof']]) execFileSync('git', a, { cwd: proj });
await writeFile(path.join(proj, 'README.md'), '# run stops proof\n');
execFileSync('git', ['add', '-A'], { cwd: proj });
execFileSync('git', ['commit', '-qm', 'init'], { cwd: proj });
const imp = (rel) => import(new URL(rel, import.meta.url).href);
const { server, runs } = await imp('../ui/server.mjs');
const { getDb } = await imp('../src/core/db.mjs');
const { projectKey } = await imp('../src/core/store.mjs');
const { writeStoreMeta } = await imp('../src/core/artifacts.mjs');
const { createSliceFeature, recordShapePlan } = await imp('../src/core/shape/features.mjs');
const askStore = await imp('../src/core/ask/store.mjs');
const { resolveGraph } = await imp('../src/core/workflows.mjs');
const { loadAgentRegistry } = await imp('../src/core/agent-registry.mjs');
const { buildGraphManifest } = await imp('../src/shared/graph/manifest.mjs');
const { careRunPlan } = await imp('../src/shared/shape/feature-record.mjs');
const { runRolesOf } = await imp('../src/shared/shape/requirements.mjs');
const { careRunGraph } = await imp('../src/core/shape/care-run.mjs');
const { normalizeOutline } = await imp('../src/shared/shape/slices.mjs');
const { gateStop } = await imp('../src/shared/shape/run-stops.mjs');
srv = server;
await new Promise((r, rej) => { srv.once('error', (err) => rej(new Error(`cannot listen on VERIFY_PORT ${process.env.VERIFY_PORT}: ${err.message}`))); srv.listen(Number(process.env.VERIFY_PORT || 0), '127.0.0.1', r); });
const base = `http://127.0.0.1:${srv.address().port}`;
const post = (url, body) => fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) });
{ const r = await post('/api/settings', { uiLevel: 'expert' }); if (!r.ok) throw new Error(`could not pin the interface mode: HTTP ${r.status}`); }

// ---- the feature: 10 runs with real-length titles; 1..7 done, 8 stopped, 9 building, 10 builds on 8. Care: Balanced.
const key = projectKey(proj);
writeStoreMeta(key, 'project', { key, name: 'Proof', path: proj });
const now = new Date().toISOString();
const pipeline = (id, status, title, stats = null) => getDb().prepare(`INSERT INTO pipelines (id, project_key, target, title, status, phase,
  cycle, started_at, updated_at, total_cost_usd, total_active_ms, branch, shape_stats) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run(id, key, 'project', title, status, status, 0, now, now, 0, 0, JSON.stringify({ source: 'main', feature: `feat/${id}` }), stats ? JSON.stringify(stats) : null);
const TITLES = ['Store saved charts in the project database', 'List saved charts on the project overview page',
  'Rename and delete a saved chart from its menu', 'Share a saved chart with a read-only link for members',
  'Refuse chart links to visitors who are not members', 'Export a saved chart as a PNG and a CSV file',
  'Keep chart filters in the address bar for bookmarks', 'Check every chart type renders with an empty dataset',
  'Show the chart list as a compact table on narrow screens', 'Add keyboard shortcuts to move between saved charts'];
const AGREED = TITLES.map((t, i) => ({ id: `R-po-${i + 1}`, text: t }));
const outline = normalizeOutline({ why: 'proof', leftOut: [], slices: TITLES.map((title, i) => ({ id: `s${i + 1}`, title, goal: `Goal ${i + 1}`, inScope: [],
  outOfScope: [], acceptance: [`ok ${i + 1}`], dependsOn: i === 9 ? ['s8'] : [], estimate: 'medium', requirements: [`R-po-${i + 1}`] })) },
{ agreed: AGREED }).outline;
const care = { position: 'balanced', chosenBy: 'person', worcaPick: 'balanced' };
pipeline('ab000001', 'done', 'Charts', { smallRuns: true, care: { ...care, reason: 'Worca picks Balanced', facts: { touches: [], requirements: 10, subsystems: [], screens: false, size: null }, at: now } });
const f = createSliceFeature({ pipelineId: 'ab000001', projectDir: proj, title: 'Charts', outline, perspectives: ['product', 'architect', 'security'],
  workflowId: 'wf_shape', smallRuns: true, care });
const fireAs = (idx, pid, status) => {
  pipeline(pid, status, `Run ${idx} · ${TITLES[idx - 1]}`);
  const t = getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = ?').get(f.id, idx).ticket_id;
  getDb().prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = ? WHERE id = ?").run(pid, t);
  getDb().prepare('UPDATE shape_feature_slices SET pipeline_id = ? WHERE feature_id = ? AND idx = ?').run(pid, f.id, idx);
};
for (let i = 2; i <= 7; i++) fireAs(i, `ab00000${i}`, 'done');
fireAs(8, 'ab000008', 'running');
fireAs(9, 'ab000009', 'running');

// Runs 8 and 9, held live through the server's runs map: their Care plan and graph; run 8 waits on its stop question.
const careRun = careRunPlan('balanced', { runRoles: runRolesOf(['R-po-8']) });
const reg = loadAgentRegistry();
const resolved = await resolveGraph(proj, 'wf_shape_slice_req', reg, undefined, { transform: (t) => careRunGraph(t, careRun) });
const stepper = { ...buildGraphManifest(resolved.template, resolved.agentsByKey, { overlays: { nodes: resolved.nodes, wires: resolved.wires } }), careRun };
const step = (nodeId, status = 'done') => ({ key: `x:${nodeId}:1`, executionId: `x:${nodeId}:1`, nodeId, ordinal: 1, cycle: 1, status,
  startedAt: now, activeMs: 1000, costUsd: 0 });
const { EventEmitter } = await import('node:events');
const ISSUES = [{ severity: 'major', title: 'A chart link opens for a visitor who is not a member', detail: 'GET /c/:id skips the member check' }];
const STOP = gateStop({ run: 8, issues: ISSUES, fixCycles: 3, nodeId: 'n_review' });
const PQ = { id: 'gate-w9-3', kind: 'gate', wireId: 'w9', nodeId: 'n_review', executionId: 'x:n_review:3', deliveryNo: 3, issues: ISSUES, stop: STOP };
const answered = [];
function liveRun(idx, pid, at, pendingQuestion) {
  const orch = new EventEmitter();
  const done = ['n_task', 'n_clarify', 'n_plan', 'n_roles', 'n_refine', 'n_tests', 'n_impl', 'n_review'];
  orch.state = { id: pid, status: 'running', title: `Run ${idx} · ${TITLES[idx - 1]}`, projectDir: proj, stepper,
    steps: [...done.slice(0, done.indexOf(at)).map((id) => step(id)), step(at, pendingQuestion ? 'done' : 'start')],
    active: pendingQuestion ? [] : [{ nodeId: at, executionId: `x:${at}:1` }], tokens: {}, wireDeliveries: {}, warnings: [], endReached: false,
    shaping: { approved: { file: 'plan.md' } } };
  orch.getState = () => orch.state;
  orch.runShape = { slice: { feature: f.id, index: idx } };
  orch.answer = (id, payload) => { answered.push({ idx, id, payload }); return true; };
  for (const m of ['pause', 'stop']) orch[m] = () => true;
  const id = `run-${pid}`;
  runs.set(id, { id, kind: 'run', pipelineId: pid, status: 'running', events: [], pendingQuestion, projectDir: proj, startedAt: Date.now(), orch,
    title: orch.state.title, tags: [] });
  return id;
}
const RUN_ID = liveRun(8, 'ab000008', 'n_review', PQ);
liveRun(9, 'ab000009', 'n_impl', null);

// The Chat thread whose card is the feature's one card.
const thread = askStore.createThread({ title: 'Charts' });
const cardId = askStore.newAskId('card');
askStore.appendMessage(thread.id, { role: 'user', text: 'Plan charts in small runs' });
askStore.appendMessage(thread.id, { role: 'assistant', status: 'done', text: 'Here is the feature:',
  blocks: [{ kind: 'card', id: cardId, state: 'tracked', card: { type: 'progress', pipelineId: 'ab000001', runId: 'run-ab000001', projectKey: key, title: 'Charts', status: 'done' } }] });
askStore.linkRun(thread.id, { runId: 'run-ab000001', cardId, pipelineId: 'ab000001', status: 'done' });
recordShapePlan({ threadId: thread.id, cardId, title: 'Charts' });
log(`server ${base} · feature ${f.id} · thread ${thread.id}`);

// ---- chrome + cdp
profile = await mkdtemp(path.join(tmpdir(), 'worca-c3-profile-'));
chrome = spawn(CHROME, ['--headless=new', ...SANDBOX, '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  `--window-size=${WIDTH},900`, '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--use-mock-keychain', 'about:blank'],
{ stdio: ['ignore', 'pipe', 'pipe'] });
let wsUrl = null;
const deadline = Date.now() + 60_000;
let cdpPort = null;
while (!wsUrl && Date.now() < deadline) {
  try {
    cdpPort ||= Number(readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]) || null;
    if (!cdpPort) { await sleep(200); continue; }
    const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
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
async function waitFor(expr, what, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await ev(expr)) return true; await sleep(150); }
  log(`FAIL timed out waiting for ${what}`); failed += 1; results.checks.push({ ok: false, what: `waiting for ${what}` });
  return false;
}
async function shot(name) {
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  const file = path.join(SHOTS, `c3-stops-${name}.png`);
  await writeFile(file, Buffer.from(data, 'base64'));
  results.shots.push(file);
  return file;
}
async function open(url) {
  await cdp('Page.navigate', { url });
  await sleep(600);
}
const setTheme = (theme) => ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)};0`);
/** Closes the first-visit dialogs (the welcome and the level dialog open a moment after load) for up to 3 s. */
async function skipWelcome() {
  const end = Date.now() + 3000;
  while (Date.now() < end) {
    const n = await ev(`(() => { let n = 0; for (const b of document.querySelectorAll('button')) {
      if (!b.offsetParent || !/^(skip|got it)$/i.test(b.textContent.trim()) || !b.closest('dialog, [role=dialog], .viewer-modal, .modal, #welcome-modal')) continue;
      b.click(); n += 1; } return n; })()`);
    await sleep(n ? 300 : 250);
  }
}
const reveal = (sel) => ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.offsetParent); if (el) el.scrollIntoView({ block: 'center' }); return !!el; })()`);

/** The in-page measurement of one list: rows, mark and first-text-line centres, title lines, overflow. */
const MEASURE = (rootSel, rowSel, markSel, textSel) => `(() => {
  const roots = [...document.querySelectorAll(${JSON.stringify(rootSel)})].filter((r) => r.offsetParent);
  const root = roots[0];
  if (!root) return { found: false };
  const firstLine = (el) => {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      if (!t.textContent.trim()) continue;
      const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, Math.min(1, t.textContent.length));
      const b = r.getClientRects()[0]; if (b) return b;
    }
    return el.getBoundingClientRect();
  };
  const lines = (el) => { const lh = parseFloat(getComputedStyle(el).lineHeight) || 20; return Math.round(el.getBoundingClientRect().height / lh); };
  const rows = [...root.querySelectorAll(${JSON.stringify(rowSel)})].filter((r) => r.offsetParent).map((row) => {
    const mark = row.querySelector(${JSON.stringify(markSel)});
    const text = row.querySelector(${JSON.stringify(textSel)});
    const rb = row.getBoundingClientRect();
    const tops = [...row.children].filter((c) => c.getBoundingClientRect().height > 0).map((c) => c.getBoundingClientRect().top);
    const mb = mark ? mark.getBoundingClientRect() : null; const tb = text ? firstLine(text) : null;
    const state = row.querySelector('.run-member-state');
    return { text: (text && text.textContent || '').trim(), state: state ? state.textContent : null, mark: mark ? [mark.className, Math.round(mb.height)] : null, height: Math.round(rb.height * 10) / 10,
      markX: mb ? mb.left + mb.width / 2 : null, markY: mb ? mb.top + mb.height / 2 : null, textY: tb ? tb.top + tb.height / 2 : null,
      textLines: text ? lines(text) : 0, oneLine: !tops.length || Math.max(...tops) - Math.min(...tops) <= 8 };
  });
  const xs = rows.map((r) => r.markX).filter((x) => x != null);
  return { found: true, rows, spreadX: xs.length ? Math.max(...xs) - Math.min(...xs) : 0,
    maxDy: Math.max(0, ...rows.filter((r) => r.markY != null && r.textY != null).map((r) => Math.abs(r.markY - r.textY))),
    overflow: root.scrollWidth > root.clientWidth || document.documentElement.scrollWidth > document.documentElement.clientWidth };
})()`;
function judge(list, theme, m) {
  results.lists.push({ list, theme, ...m });
  const where = `${list}, ${theme}, ${WIDTH}px`;
  if (!m.found) { check(false, `${where}: the list is on screen`); return; }
  const off = m.rows.filter((r) => !r.oneLine || r.textLines > 1 || Math.abs(r.height - 32) > 0.5);
  check(m.rows.length > 0 && off.length === 0, `${where}: every run row is one 32px line, its long title on one line (${m.rows.length} rows${off.length ? `; off: ${JSON.stringify(off.map((r) => [r.text, r.height, r.textLines]))}` : ''})`);
  check(m.maxDy <= 1, `${where}: each mark's y-centre is within 1px of its text (max ${m.maxDy.toFixed(2)}px)`);
  check(m.spreadX <= 1, `${where}: the marks share one x-centre within 1px (spread ${m.spreadX.toFixed(2)}px)`);
  check(!m.overflow, `${where}: no horizontal overflow`);
}
const CARD_ROWS = ['.chat-rc-members', '.run-member', '.status-dot', '.run-member-title'];
const CARD_Q = '.chat-rc .ask-mcard-head.step-head';
const PANEL = '[data-chat-panel] .crp-host > .rd';
/** The stop card's primaries and the panel's buttons and findings lists, visible ones only. */
const COUNTS = (rootSel) => `(() => {
  const root = [...document.querySelectorAll(${JSON.stringify(rootSel)})].find((r) => r.offsetParent);
  if (!root) return null;
  const vis = (els) => [...els].filter((b) => b.offsetParent && !b.closest('[hidden], .hidden'));
  const q = root.querySelector('.qpanel');
  return { primaries: vis(root.querySelectorAll('.qpanel .btn-primary')).map((b) => b.textContent), qButtons: q ? vis(q.querySelectorAll('button')).length : 0,
    options: vis(root.querySelectorAll('.qopt')).length, findings: vis(root.querySelectorAll('.qpanel .issues, .qpanel .plan-checks')).length,
    receipt: [...root.querySelectorAll('.qpanel .chat-rc-log-run, .qpanel .chat-rc-log-text')].map((n) => n.textContent).join(' | ') || null,
    stopHead: vis(root.querySelectorAll('.qpanel .step-head, .qpanel .chat-rc-receipt')).length,
    barAnswer: !!root.querySelector('[data-model-action="answer"]'),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
})()`;

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: false });
const PROTO = pathToFileURL(PROTOTYPE).href;
for (const theme of THEMES) {
  runs.get(RUN_ID).heldStop = null;
  // 1. The feature card in Chat: the stop's question (one primary naming the pick) and the run rows.
  await open(`${base}/?t=${theme}#chat/${thread.id}`);
  await skipWelcome();
  await setTheme(theme);
  if (await waitFor(`!!document.querySelector(${JSON.stringify(`${CARD_Q}`)}) && !!document.querySelector('.chat-rc-members .run-member')`, `the stop question on the feature card (${theme})`)) {
    await skipWelcome(); await reveal('.chat-rc .qopt');
    const c = await ev(COUNTS('.chat-rc'));
    check(c && c.primaries.length === 1 && c.primaries[0] === 'Run another cycle', `card, ${theme}: one primary naming the pick (${JSON.stringify(c && c.primaries)})`);
    check(c && c.options === 2, `card, ${theme}: two option rows`);
    check(c && !c.barAnswer, `card, ${theme}: the card foot has no Answer beside the stop's own primary`);
    check(c && !c.overflow, `card, ${theme}: no horizontal overflow`);
    await shot(`app-card-question-${theme}`);
    await reveal('.chat-rc-members');
    const words = await ev("[...document.querySelectorAll('.chat-rc-members .run-member .run-member-state')].map((n) => n.textContent)");
    check(words.includes('waiting for you') && words.includes('waits for run 8'), `card rows, ${theme}: waiting for you and waits for run 8 (${JSON.stringify(words)})`);
    judge('card run rows (stop open)', theme, await ev(MEASURE(...CARD_ROWS)));
    await shot(`app-card-waiting-row-${theme}`);
  }

  // 2. The side panel and the run page with the stop open: findings only, no question, no buttons, no bar answer.
  await open(`${base}/?p=${theme}#chat/new/run/ab000008/overview`);
  await skipWelcome(); await setTheme(theme);
  if (await waitFor("!!document.querySelector('[data-chat-panel] .qpanel .issues')", `the side panel's findings (${theme})`)) {
    await skipWelcome(); await reveal('[data-chat-panel] .qpanel');
    const p = await ev(COUNTS(PANEL));
    check(p && p.qButtons === 0 && p.options === 0 && p.findings === 1 && !p.barAnswer, `side panel, ${theme}: 0 card buttons, 1 findings list, no bar answer (${JSON.stringify(p)})`);
    const objects = await ev("[...document.querySelectorAll('[data-chat-panel] .run-agents .plan-check-row')].filter((r) => /objects/.test(r.textContent)).length");
    check(objects >= 1, `side panel, ${theme}: the stopped reviewer reads objects`);
  }
  await shot(`app-side-panel-open-${theme}`);
  await open(`${base}/?r=${theme}#running/${RUN_ID}`);
  await skipWelcome(); await setTheme(theme);
  if (await waitFor("!!document.querySelector('#run-detail .qpanel .issues')", `the run page's findings (${theme})`)) {
    await skipWelcome(); await reveal('#run-detail .qpanel');
    const r = await ev(COUNTS('#run-detail'));
    check(r && r.qButtons === 0 && r.options === 0 && r.findings === 1 && !r.overflow, `run page, ${theme}: 0 card buttons, 1 findings list, no overflow (${JSON.stringify(r)})`);
  }
  await shot(`app-run-page-open-${theme}`);

  // 3. A held answer (run 9 is going): the card draws the answered line, run 8's row reads `after run 9`, the panel no control.
  const res = await post('/api/answer', { runId: RUN_ID, id: PQ.id, payload: { decision: 'another' } });
  const body = await res.json();
  check(res.ok && body.held === true, `answer, ${theme}: held while run 9 builds (${JSON.stringify(body)})`);
  check(answered.length === 0, `answer, ${theme}: not delivered while run 9 is going`);
  await open(`${base}/?h=${theme}#chat/${thread.id}`);
  await skipWelcome(); await setTheme(theme);
  if (await waitFor("!!document.querySelector('.chat-rc .qpanel .chat-rc-log-row')", `the answered fold (${theme})`)) {
    await skipWelcome(); await reveal('.chat-rc .qpanel .chat-rc-log-row');
    const c = await ev(COUNTS('.chat-rc'));
    check(c && c.receipt === 'Run 8 | another cycle · decided by you' && c.options === 0, `card, ${theme}: the one answered line (${JSON.stringify(c && c.receipt)})`);
    check(c && c.stopHead === 0 && !c.barAnswer, `card, ${theme}: the held stop has no head, no box and no Answer in the foot (${JSON.stringify(c)})`);
    const words = await ev("[...document.querySelectorAll('.chat-rc-members .run-member .run-member-state')].map((n) => n.textContent)");
    check(words.includes('after run 9'), `card rows, ${theme}: after run 9 (${JSON.stringify(words)})`);
    judge('card run rows (held)', theme, await ev(MEASURE(...CARD_ROWS)));
  }
  await shot(`app-card-answered-${theme}`);
  await open(`${base}/?q=${theme}#chat/new/run/ab000008/overview`);
  await skipWelcome(); await setTheme(theme);
  if (await waitFor("!!document.querySelector('[data-chat-panel] .qpanel')", `the side panel, held (${theme})`)) {
    await sleep(800);
    const p = await ev(COUNTS(PANEL));
    check(p && p.qButtons === 0 && p.options === 0 && !p.barAnswer, `side panel held, ${theme}: no control (${JSON.stringify(p)})`);
  }
  await shot(`app-side-panel-held-${theme}`);
  await open(`${PROTO}#run-stops`); await setTheme(theme); await sleep(300);
  await shot(`prototype-run-stops-${theme}`);
}
check(errors.length === 0, `no page errors${errors.length ? ` — ${errors.slice(0, 3).join(' | ')}` : ''}`);
results.minutes = Math.round((Date.now() - T0) / 600) / 100;
results.failed = failed;
const logFile = path.join(SHOTS, 'c3-stops-measure.json');
await writeFile(logFile, JSON.stringify(results, null, 2) + '\n');
log(`${results.shots.length} PNGs and ${logFile} in ${results.minutes} min; ${failed ? `${failed} FAILED` : 'all passed'}`);
await shutdown(failed ? 1 : 0);
