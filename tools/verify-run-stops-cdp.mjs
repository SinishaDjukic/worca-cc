#!/usr/bin/env node
// tools/verify-run-stops-cdp.mjs — headless-Chrome proof of Shaper small runs C3 (When a run stops): a marked 10-run
// feature with real-length titles, seeded data only on the mock engine. Run 8 waits on a stop question (an objection at
// its exhausted code review), run 9 builds (independent), run 10 builds on run 8. At 375px in light and dark it captures
// the Chat feature card (the question, the answered fold after a held answer, the run rows with `waits for run 8`), the
// Chat run side panel `#chat/new/run/{pid}/overview` (stop open, then held) and the run page `#running/{runId}` (stop
// open): 12 PNGs, plus the prototype's `#run-stops` beside each theme, and a JSON log. It measures every card run row
// (one 32px line, a long title ellipsised), each mark's centre against its text, 1 primary on the card, 0 card buttons
// and 1 findings list in the panel, no horizontal overflow.
// Then, at 1280px in both themes and at 375px in light (PAGE_CELLS): the run page of a stopped run (the stop's head, one
// link to where it is answered, no control; a feature a Chat thread started and one it did not), the feature page with a
// stop (one visible head, one primary, no Re-plan in the bar or the ⋯), one word per run on the Runs list, the feature
// page and the Chat card (one-line 32px rows), and a finished feature (Create N PRs blocked with its reason, then open
// after the mark; the Decisions Show as a quiet button; "1 dropped" in a role's summary).
// Then the outline-change stop (NOTE_CELLS: the page cells and a 1920px desktop): run 8 waits on the Planner's note, once as written and once
// three times as long, on the feature card in Chat, the feature page, the run page and the side panel, and with the flag
// off on the run page's and the panel's findings. It captures each folded and opened, and checks a question of at most
// two lines at the card's normal width (three with a 120-character title), no inner scrollbar, nothing wider than the card, and a pick kept across
// opening and closing. SECTION=stops, SECTION=pages or SECTION=note runs one part.
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
const { gateStop, planStop } = await imp('../src/shared/shape/run-stops.mjs');
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

// ---- two more features for the page checks, neither started by a Chat thread: "Exports" (run 1 done, run 2 on a
// failed plan check, run 3 waiting) and "Alerts" (both runs done, two requirements a person confirms, one already dropped).
function feature2({ title, id, texts, confirmed = {}, acceptance = [] }) {
  pipeline(id, 'done', title, { smallRuns: true });
  const ids = texts.map((_, i) => `R-po-${i + 1}`);
  const agreed = [...ids.map((x, i) => ({ id: x, text: texts[i] })), ...Object.keys(confirmed).map((x) => ({ id: x, text: `${x} is signed off` }))];
  const ol = normalizeOutline({ why: 'proof', leftOut: [], confirmed: Object.entries(confirmed).map(([x, role]) => ({ id: x, role })),
    slices: ids.map((x, i) => ({ id: `s${i + 1}`, title: texts[i], goal: 'g', inScope: [], outOfScope: [], acceptance: ['ok'], dependsOn: i ? [`s${i}`] : [], estimate: 'medium', requirements: [x] })) },
  { agreed, smallRuns: true }).outline;
  if (acceptance.length) ol.acceptance = acceptance;
  getDb().prepare('INSERT INTO pipeline_events (pipeline_id, ts, text) VALUES (?, ?, ?)').run(id, now, 'Slice outline **approve** (round 1)');
  return createSliceFeature({ pipelineId: id, projectDir: proj, title, outline: ol, perspectives: ['product', 'compliance'], workflowId: 'wf_shape', smallRuns: true, care,
    requirementKinds: Object.fromEntries(Object.entries(confirmed).map(([x, role]) => [x, { kind: 'confirmed', role }])) });
}
const fireOf = (feat, idx, pid, status, title) => {
  pipeline(pid, status, `Run ${idx} · ${title}`);
  const t = getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = ?').get(feat.id, idx).ticket_id;
  getDb().prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = ? WHERE id = ?").run(pid, t);
  getDb().prepare('UPDATE shape_feature_slices SET pipeline_id = ? WHERE feature_id = ? AND idx = ?').run(pid, feat.id, idx);
};
const EXPORTS = ['Export a project as a CSV file', 'Export a project as a PDF report', 'Export a project on a schedule'];   // run 3 waits: the ⋯ has a rest to cancel
const fx = feature2({ title: 'Exports', id: 'ac000001', texts: EXPORTS });
fireOf(fx, 2, 'ac000002', 'running', EXPORTS[1]);
const CHECK = { ok: false, passed: 3, total: 8, items: [{ id: 'tests', label: 'Names its tests', pass: false, detail: 'no test is named' }] };
const PQ2 = { id: 'plan-n_refine-1', kind: 'plan', nodeId: 'n_refine', executionId: 'x:n_refine:1', plan: { nodeId: 'n_refine', port: 'plan', file: 'plan.md', round: 1, revisable: true, check: CHECK },
  stop: planStop({ run: 2, check: CHECK, node: 'n_refine' }) };
const RUN2_ID = liveRun(2, 'ac000002', 'n_refine', PQ2);
{ const e = runs.get(RUN2_ID); e.orch.runShape = { slice: { feature: fx.id, index: 2 } }; e.title = e.orch.state.title = `Run 2 · ${EXPORTS[1]}`; e.orch.state.shaping = {}; }
const ALERTS = ['Send an alert when a run fails', 'Send one alert a day at most'];
const fa = feature2({ title: 'Alerts', id: 'ad000001', texts: ALERTS, confirmed: { 'R-comp-1': 'compliance', 'R-comp-2': 'compliance' },
  acceptance: [{ id: 'R-comp-2', mark: 'dropped', reason: 'Not needed this year', role: 'compliance', by: 'proof', at: now }] });
fireOf(fa, 2, 'ad000002', 'done', ALERTS[1]);
// The Verifier's clean check of the head it ships: with the flag on, a finished feature is ready to ship only then.
execFileSync('git', ['branch', 'feat/ad000002'], { cwd: proj });
{ const o = JSON.parse(getDb().prepare('SELECT outline FROM shape_features WHERE id = ?').get(fa.id).outline);
  o.verify = { checks: [{ round: 1, state: 'clean', head: { index: 2, pipelineId: 'ad000002' }, headSha: execFileSync('git', ['rev-parse', 'feat/ad000002'], { cwd: proj, encoding: 'utf8' }).trim(), result: { held: [], gaps: [] } }] };
  getDb().prepare('UPDATE shape_features SET outline = ? WHERE id = ?').run(JSON.stringify(o), fa.id); }

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: false });
const PROTO = pathToFileURL(PROTOTYPE).href;
const SECTION = process.env.SECTION || 'all';
for (const theme of SECTION === 'pages' || SECTION === 'note' ? [] : THEMES) {
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
// ---- the pages: the run page and the feature page of a stopped run, one word per run, and a finished feature.
const PAGE_CELLS = [[1280, 'light'], [1280, 'dark'], [375, 'light']];
const visText = (sel) => `[...document.querySelectorAll(${JSON.stringify(sel)})].filter((n) => n.offsetParent && !n.closest('[hidden], .hidden')).map((n) => n.textContent.trim())`;
const noOverflow = () => ev('document.documentElement.scrollWidth <= document.documentElement.clientWidth');
const STOP_PAGE = `(() => { const q = document.querySelector('#run-detail .qpanel'); if (!q) return null;
  const vis = (els) => [...els].filter((b) => b.offsetParent && !b.closest('[hidden], .hidden'));
  return { heads: vis(q.querySelectorAll('.ask-mcard-title, .qpanel-head b')).map((n) => n.textContent), line: vis(q.querySelectorAll('.stop-home')).map((n) => n.textContent),
    links: vis(q.querySelectorAll('a.rd-fact-link')).map((a) => a.getAttribute('href')), controls: vis(q.querySelectorAll('button, .qopt, input, textarea')).length,
    findings: vis(q.querySelectorAll('.issues, .plan-checks')).length,
    clipped: [...q.querySelectorAll('*')].filter((n) => n.offsetParent && n.getBoundingClientRect().right > q.getBoundingClientRect().right + 1).length }; })()`;
const FEATURE_PAGE = `(() => { const gp = document.querySelector('#group-detail .gpage'); if (!gp) return null;
  const vis = (els) => [...els].filter((b) => b.offsetParent && !b.closest('[hidden], .hidden'));
  const q = gp.querySelector('.gpage-question');
  return { heads: vis(q.querySelectorAll('.ask-mcard-title, .qpanel-head')).map((n) => n.textContent.trim()), primaries: vis(gp.querySelectorAll('.btn-primary')).map((b) => b.textContent.trim()),
    bar: vis(gp.querySelectorAll('.gpage-actions button')).map((b) => b.textContent.trim()), banner: /Plan ready for your approval/.test(vis([gp]).map((n) => n.innerText).join('')) }; })()`;
const resetMark = () => { const row = getDb().prepare('SELECT outline FROM shape_features WHERE id = ?').get(fa.id); const o = JSON.parse(row.outline);
  o.acceptance = (o.acceptance || []).filter((e) => e.id !== 'R-comp-1'); getDb().prepare('UPDATE shape_features SET outline = ? WHERE id = ?').run(JSON.stringify(o), fa.id); };
runs.get(RUN_ID).heldStop = null;
let turn = 0;
for (const [width, theme] of SECTION === 'stops' || SECTION === 'note' ? [] : PAGE_CELLS) {
  const at = `${width}px, ${theme}`;
  const name = (n) => `page-${n}-${width}-${theme}`;
  await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
  const go = async (hash) => { turn += 1; await open(`${base}/?pg=${turn}${hash}`); await skipWelcome(); await setTheme(theme); };

  // 1. The run page of a stopped run: the head, one line with one link, no control; with a thread and without.
  for (const [runId, stop, href, findings, n] of [[RUN_ID, STOP, `#chat/${thread.id}`, '.issues', 'run-thread'], [RUN2_ID, PQ2.stop, `#feature/${fx.id}`, '.plan-checks', 'run-no-thread']]) {
    await go(`#running/${runId}`);
    if (await waitFor(`!!document.querySelector('#run-detail .qpanel .stop-home a') && !!document.querySelector('#run-detail .qpanel ${findings}')`, `the stopped run's page (${n}, ${at})`)) {
      await reveal('#run-detail .qpanel');
      const s = await ev(STOP_PAGE);
      check(JSON.stringify(s.heads) === JSON.stringify([stop.head]), `run page ${n}, ${at}: the stop's head is its one head (${JSON.stringify(s.heads)})`);
      check(s.links.length === 1 && s.links[0] === href && s.line.length === 1, `run page ${n}, ${at}: one line with one link to ${href} (${JSON.stringify(s)})`);
      check(s.controls === 0 && s.findings === 1, `run page ${n}, ${at}: no control, one findings list`);
      check(s.clipped === 0, `run page ${n}, ${at}: nothing runs past the card (${s.clipped})`);
      check(await noOverflow(), `run page ${n}, ${at}: no horizontal overflow`);
      await shot(name(n));
    }
  }

  // 2. The feature page with a stop: one visible head, one primary, no banner, no Re-plan beside it.
  await go(`#feature/${fx.id}`);
  if (await waitFor("!!document.querySelector('#group-detail .gpage-question[data-stop] .qopt')", `the stop on the feature page (${at})`)) {
    const p = await ev(FEATURE_PAGE);
    check(JSON.stringify(p.heads) === JSON.stringify([PQ2.stop.head]), `feature page stop, ${at}: one visible head, the stop's (${JSON.stringify(p.heads)})`);
    check(JSON.stringify(p.primaries) === '["Re-plan"]', `feature page stop, ${at}: one primary (${JSON.stringify(p.primaries)})`);
    check(!p.banner, `feature page stop, ${at}: no Plan ready for your approval`);
    check(p.bar.length === 0, `feature page stop, ${at}: the bar offers no Re-plan (${JSON.stringify(p.bar)})`);
    check(await noOverflow(), `feature page stop, ${at}: no horizontal overflow`);
    await shot(name('feature-stop'));
    await ev("document.querySelector('#group-detail .gpage-more').click();0");
    const MENU = "[...document.querySelectorAll('[role^=menuitem]')].filter((n) => n.getClientRects().length).map((n) => n.textContent.trim())";   // a fixed popover has no offsetParent
    if (await waitFor(`${MENU}.includes('Cancel the rest')`, `the page's ⋯ (${at})`)) {
      const items = await ev(MENU);
      check(items.includes('Cancel the rest') && !items.some((x) => /^Re-plan/.test(x)), `feature page stop, ${at}: no Re-plan in the ⋯ (${JSON.stringify(items)})`);
    }
  }

  // 3. One word per run on the Runs list, the feature page's Runs tab and the Chat card; one-line rows.
  await go(`#feature/${f.id}`);
  let onPage = [];
  if (await waitFor("document.querySelectorAll('#group-detail .gpage-runs .run-member-state').length === 10 && [...document.querySelectorAll('#group-detail .gpage-runs .run-member-state')].some((n) => n.textContent === 'waiting for you')", `the feature page's run words (${at})`)) {
    onPage = await ev(visText('#group-detail .gpage-runs .run-member-state'));
    await reveal('#group-detail .gpage-runs');
    const m = await ev(MEASURE('#group-detail .gpage-runs', '.run-member', '.status-dot', '.run-member-title'));
    const off = m.rows.filter((r) => r.textLines > 1 || Math.abs(r.height - 32) > 0.5);
    check(m.rows.length === 10 && off.length === 0, `feature page rows, ${at}: ten one-line 32px rows (off: ${JSON.stringify(off.map((r) => [r.text, r.height, r.textLines]))})`);
    check(m.maxDy <= 1 && m.spreadX <= 1 && !m.overflow, `feature page rows, ${at}: marks aligned, no overflow (${m.maxDy.toFixed(2)}, ${m.spreadX.toFixed(2)}, ${m.overflow})`);
    await shot(name('feature-rows'));
  }
  await go(`#chat/${thread.id}`);
  let onCard = [];
  if (await waitFor("document.querySelectorAll('.chat-rc-members .run-member-state').length === 10", `the card's run words (${at})`)) onCard = await ev(visText('.chat-rc-members .run-member-state'));
  await go('#runs');
  let onList = [];
  const LIST = `.runs-item[data-row-key="chain:${f.id}"]`;
  if (await waitFor(`!!document.querySelector('${LIST}')`, `the feature's group row (${at})`)) {
    if (!(await ev(`!!document.querySelector('${LIST} > .runs-members .runs-item')`))) await ev(`document.querySelector('${LIST} .runs-toggle, ${LIST} [aria-expanded]')?.click();0`);
    if (await waitFor(`document.querySelectorAll('${LIST} > .runs-members > .runs-item[data-level="member"]').length === 10`, `the group's member rows (${at})`)) {
      onList = await ev(`[...document.querySelectorAll('${LIST} > .runs-members > .runs-item[data-level="member"] > a.runs-row > .runs-row-sub')].map((n) => n.textContent.trim())`);
      await shot(name('runs-list'));
    }
  }
  check(onPage.length === 10 && JSON.stringify(onPage) === JSON.stringify(onCard) && JSON.stringify(onPage) === JSON.stringify(onList),
    `one word per run, ${at}: the Runs list, the feature page and the card agree (${JSON.stringify([onPage, onCard, onList])})`);
  for (const w of ['done', 'waiting for you', 'waits for run 8']) check(onPage.includes(w), `one word per run, ${at}: ${w}`);

  // 4. A finished feature: Create N PRs, blocked with its reason on the page, then open after the mark.
  resetMark();
  await go(`#feature/${fa.id}`);
  const CTA = '#group-detail .gpage-card .rd-pr-slot [data-rd-cta]';
  const ctaOf = () => ev(`(() => { const b = document.querySelector(${JSON.stringify(CTA)}); return b && { text: b.textContent.trim(), disabled: !!b.disabled, primary: b.classList.contains('btn-primary') }; })()`);
  const REASON = 'Waiting for Compliance to confirm R-comp-1';
  if (await waitFor(`!!document.querySelector(${JSON.stringify(CTA)}) && document.querySelector(${JSON.stringify(CTA)}).disabled`, `the blocked Create 2 PRs (${at})`)) {
    const c = await ctaOf();
    check(c.text === 'Create 2 PRs' && c.disabled && !c.primary, `finished feature, ${at}: Create 2 PRs, disabled (${JSON.stringify(c)})`);
    check((await ev(visText('#group-detail .gpage-card .run-status'))).join(' ').includes(REASON), `finished feature, ${at}: the reason is on the page`);
    check(await noOverflow(), `finished feature, ${at}: no horizontal overflow`);
    await shot(name('ship-blocked'));
    const r = await post(`/api/shape/features/${fa.id}/confirm`, { id: 'R-comp-1', mark: 'met' });
    check(r.ok, `finished feature, ${at}: the mark is saved (${r.status})`);
    if (await waitFor(`document.querySelector(${JSON.stringify(CTA)}) && !document.querySelector(${JSON.stringify(CTA)}).disabled`, `Create 2 PRs after the mark (${at})`)) {
      const d = await ctaOf();
      check(d.text === 'Create 2 PRs' && d.primary, `finished feature, ${at}: enabled and primary after the mark (${JSON.stringify(d)})`);
    }
  }
  await go(`#feature/${fa.id}/requirements`);
  if (await waitFor("!!document.querySelector('.gpage-requirements [data-role=compliance]')", `the Requirements tab (${at})`)) {
    const t = await ev("document.querySelector('.gpage-requirements .shape-role-fold-head[data-role=compliance] .plan-fold-text').textContent");
    check(t === '2 · 1 met · 1 dropped', `Requirements, ${at}: the dropped one is decided, not open (${t})`);
    await shot(name('requirements'));
  }
  await go(`#feature/${fa.id}/decisions`);
  if (await waitFor("!!document.querySelector('.gpage-decisions .chat-rc-log-show')", `the Decisions tab's Show (${at})`)) {
    const s = await ev("(() => { const b = document.querySelector('.gpage-decisions .chat-rc-log-show'); const c = getComputedStyle(b); return { line: c.textDecorationLine, bg: c.backgroundColor, cls: b.className }; })()");
    check(s.line === 'none' && s.bg === 'rgba(0, 0, 0, 0)' && /\bbtn-quiet\b/.test(s.cls), `Decisions, ${at}: Show is a quiet button, no underline, transparent (${JSON.stringify(s)})`);
    await shot(name('decisions'));
  }
}
// ---- the outline-change stop: run 8 waits on the Planner's note instead of its objection.
const NOTE_HEAD = '## Slice 10: A prerequisite is not in this tree';
const NOTE_BODY = [
  "Slice 9 (Run order drawing component) is not in this run's branch. Its commit `78897b71d` was built from slice 7 (`2f159b244`), not slice 8, and it exists only on `feat/run-9-run-order-drawing-component`.",
  '',
  "Slice 10 places that component, so it cannot be built until the component is in the tree. The plan's Step 0 brings `78897b71d` in with `git cherry-pick --no-commit`. A trial `git merge-tree` shows conflicts in 4 files only:",
  '',
  '- `docs/design-system.md`',
  '- `test/ui-design-language.test.mjs`',
  '- `test/verify-run-status-rows-cdp.test.mjs`',
  '- `tools/verify-run-status-rows-cdp.mjs`',
].join('\n');
const LONG_NAME = 'feat/run-9-run-order-drawing-component-with-a-branch-name-that-never-fits-one-narrow-row-9c41d7e2b5a8';
const NOTE = `${NOTE_HEAD}\n\n${NOTE_BODY}`;
const LONG_NOTE = `${NOTE_HEAD}\n\n${NOTE_BODY}\n- \`${LONG_NAME}\`\n- \`ui/public/app.js\` also changes, so its conflict is resolved by hand after the pick\n\n`
  + `The same name in running text: ${LONG_NAME.replace(/[-/]/g, '')}\n\n${NOTE_BODY}\n\n${NOTE_BODY}`;
const TITLE_120 = 'The run order drawing component from slice nine is not in this tree, so slice ten cannot place it on the group page yet.'.padEnd(120, '.').slice(0, 120);
const outlinePq = (id, outlineChange) => ({ id, kind: 'plan', nodeId: 'n_plan', executionId: 'x:n_plan:1',
  plan: { nodeId: 'n_plan', port: 'plan', file: 'plan.md', round: 1, revisable: true, outlineChange, smallRuns: true },
  stop: planStop({ run: 8, outlineChange, node: 'n_plan' }) });
// The page cells, plus a wide desktop where the question card has room for two columns.
const NOTE_CELLS = [...PAGE_CELLS, [1920, 'light']];
// [name, hash, the drawn question panel, flag on]. With the flag off the run page and the panel draw the findings only.
const NOTE_SURFACES = [
  ['card', `#chat/${thread.id}`, '.chat-rc .qpanel', true],
  ['feature-page', `#feature/${f.id}`, '#group-detail .gpage-question .qpanel', true],
  ['run-page', `#running/${RUN_ID}`, '#run-detail .qpanel', true],
  ['side-panel', '#chat/new/run/ab000008/overview', '[data-chat-panel] .qpanel', true],
  ['run-page-finding', `#running/${RUN_ID}`, '#run-detail .qpanel', false],
  ['side-panel-finding', '#chat/new/run/ab000008/overview', '[data-chat-panel] .qpanel', false],
];
/** The drawn note: the question's lines, boxes that scroll, anything wider than the card, the fold and the pick. */
const NOTE_STATE = (sel) => `(() => {
  const q = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.offsetParent);
  const note = q && q.querySelector('.note-body');
  if (!note) return null;
  const text = q.querySelector('.qtext-t');
  const name = (n) => n.tagName.toLowerCase() + '.' + [...n.classList].join('.');
  const all = [q, ...q.querySelectorAll('*')].filter((n) => n.getClientRects().length);
  const opts = q.querySelector('.qopts'); const toggle = note.querySelector('.note-toggle');
  const style = getComputedStyle(note);
  return {
    question: text ? text.textContent : null,
    lines: text ? Math.round(text.getBoundingClientRect().height / parseFloat(getComputedStyle(text).lineHeight)) : 0,
    // the clamped paragraph is clipped by its line clamp on purpose (overflow hidden, so it draws no scrollbar)
    tall: all.filter((n) => !n.classList.contains('is-clamped') && n.clientHeight > 0 && n.scrollHeight > n.clientHeight + 1).map((n) => name(n) + ' ' + n.scrollHeight + '/' + n.clientHeight),
    wide: q.scrollWidth > q.clientWidth || document.documentElement.scrollWidth > document.documentElement.clientWidth,
    past: all.filter((n) => !n.closest('.note-mid-head') && n.getBoundingClientRect().right > q.getBoundingClientRect().right + 1).map(name),
    toggle: toggle ? toggle.textContent : null,
    rows: [...note.querySelectorAll('li.note-row')].filter((n) => n.offsetParent).length,
    height: Math.round(note.getBoundingClientRect().height),
    cut: [...note.querySelectorAll('.note-mid')].filter((m) => m.offsetParent && m.firstChild.scrollWidth > m.firstChild.clientWidth).map((m) => m.title),
    weight: style.fontWeight, ink2: style.color,
    under: opts ? { gap: Math.round(opts.getBoundingClientRect().top - note.getBoundingClientRect().bottom),
      width: Math.round(note.getBoundingClientRect().width - opts.getBoundingClientRect().width) } : null,
    picked: [...q.querySelectorAll('.qopt.sel')].map((t) => t.dataset.value),
    primary: [...q.querySelectorAll('.btn-primary')].map((b) => b.textContent),
  };
})()`;
const judgeNote = (s, what) => {
  results.lists.push({ note: what, ...s });
  check(s.tall.length === 0, `${what}: no box in the card scrolls or is cut in height (${JSON.stringify(s.tall)})`);
  check(!s.wide && s.past.length === 0, `${what}: nothing is wider than the card (${JSON.stringify(s.past)})`);
  check(s.weight === '400', `${what}: the note is normal weight (${s.weight})`);
};
if (SECTION === 'all' || SECTION === 'note') {
  for (const [width, theme] of NOTE_CELLS) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1800, deviceScaleFactor: 1, mobile: false });
    for (const [surface, hash, sel, flagOnHere] of NOTE_SURFACES) {
      for (const [length, text] of [['note', NOTE], ['long', LONG_NOTE], ...(flagOnHere && width >= 1280 ? [['title-120', `${TITLE_120}\n\n${NOTE_BODY}`]] : [])]) {
        const at = `${surface}, ${length}, ${width}px, ${theme}`;
        process.env.WORCA_FLAGS = flagOnHere ? 'shaperSmallRuns' : '-shaperSmallRuns';
        const run = runs.get(RUN_ID);
        run.heldStop = null;
        run.pendingQuestion = outlinePq(`plan-outline-${length}`, text);
        turn += 1;
        await open(`${base}/?n=${turn}${hash}`); await skipWelcome(); await setTheme(theme);
        if (!(await waitFor(`[...document.querySelectorAll(${JSON.stringify(`${sel} .note-body`)})].some((x) => x.offsetParent)`, `the note (${at})`))) { await shot(`note-missing-${surface}-${length}-${width}-${theme}`); continue; }
        await skipWelcome(); await reveal(`${sel} .note-body`); await sleep(300);
        const folded = await ev(NOTE_STATE(sel));
        judgeNote(folded, `${at}, folded`);
        if (folded.question !== null) {
          // The card's normal width (the side panel is narrower). A 120-character title measures three lines there: the
          // card's question is --fs-section text, larger than the 120-character limit was sized for.
          if (width >= 1280 && surface !== 'side-panel') {
            const cap = length === 'title-120' ? 3 : 2;
            check(folded.lines <= cap, `${at}: the question takes at most ${cap} lines (${folded.lines})`);
          }
          check(folded.under && folded.under.gap >= 0 && folded.under.gap <= 24 && Math.abs(folded.under.width) <= 40, `${at}: the options sit directly under the note (${JSON.stringify(folded.under)})`);
        } else check(surface.endsWith('-finding'), `${at}: only a finding has no question`);
        if (length === 'title-120') { await shot(`note-${surface}-${length}-${width}-${theme}`); continue; }
        await shot(`note-${surface}-${length}-${width}-${theme}-folded`);
        if (length === 'note') { check(folded.toggle === null || folded.toggle === 'Show the full note', `${at}: folded (${folded.toggle})`); if (folded.toggle === null) continue; }
        else check(folded.toggle === 'Show the full note' && folded.rows === 5, `${at}: four rows and "+N more", with the control (${folded.toggle}, ${folded.rows} rows)`);
        if (width === 375 && length === 'long') check(folded.height < 900, `${at}: the folded note stays short (${folded.height}px)`);
        const other = folded.question !== null;
        if (other) await ev(`[...document.querySelectorAll(${JSON.stringify(`${sel} .qopt`)})].find((t) => t.offsetParent && t.dataset.value === 'change').click();0`);
        const press = () => ev(`[...document.querySelectorAll(${JSON.stringify(`${sel} .note-toggle`)})].find((t) => t.offsetParent).click();0`);
        await press(); await sleep(200);
        const opened = await ev(NOTE_STATE(sel));
        judgeNote(opened, `${at}, opened`);
        check(opened.toggle === 'Show less' && opened.height > folded.height && opened.rows > folded.rows, `${at}: opens in place (${folded.height}px to ${opened.height}px)`);
        if (width === 375 && length === 'long') check(opened.cut.includes(LONG_NAME), `${at}: the long name loses its middle on one line (${JSON.stringify(opened.cut)})`);
        await shot(`note-${surface}-${length}-${width}-${theme}-opened`);
        await press(); await sleep(200);
        const closed = await ev(NOTE_STATE(sel));
        check(closed.toggle === 'Show the full note' && closed.height === folded.height, `${at}: closes again`);
        if (other) check([opened, closed].every((x) => JSON.stringify(x.picked) === '["change"]' && JSON.stringify(x.primary) === '["Change it"]'),
          `${at}: the pick is kept across opening and closing (${JSON.stringify([opened.picked, closed.picked, closed.primary])})`);
      }
    }
  }
  process.env.WORCA_FLAGS = 'shaperSmallRuns';
}
check(errors.length === 0, `no page errors${errors.length ? ` — ${errors.slice(0, 3).join(' | ')}` : ''}`);
results.minutes = Math.round((Date.now() - T0) / 600) / 100;
results.failed = failed;
const logFile = path.join(SHOTS, 'c3-stops-measure.json');
await writeFile(logFile, JSON.stringify(results, null, 2) + '\n');
log(`${results.shots.length} PNGs and ${logFile} in ${results.minutes} min; ${failed ? `${failed} FAILED` : 'all passed'}`);
await shutdown(failed ? 1 : 0);
