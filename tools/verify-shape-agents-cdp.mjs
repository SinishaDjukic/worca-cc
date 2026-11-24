#!/usr/bin/env node
// tools/verify-shape-agents-cdp.mjs — headless-Chrome proof of Shaper small runs C2 (Agents per run): a marked Thorough
// feature with 3 runs (done, live in "writing tests", waiting), seeded data only on the mock engine. At 375px in light
// and dark it opens three lists: the feature card's run rows in Chat (`#build`), the side panel's Agents
// (`#chat/new/run/{pid}/overview`) and the run page's Agents (`#running/{runId}`). Per list it measures every one-line
// row (32px), each mark's y-centre against its first text line and the spread of the mark x-centres (both within 1px),
// no horizontal overflow, and "Code review · Requirements" on one line. It captures the prototype's `#build` and
// `#run-panel` (plans/shaper-refresh/prototype.html) at the same theme and width beside each: 12 PNGs and a JSON log.
// NOT part of `npm test`: it needs Chrome. A hard 30-minute cap inside: past it the script exits non-zero.
// Run: H=$(mktemp -d); env -u FORCE_COLOR HOME=$H VERIFY_PORT=4937 SHOTS_DIR=… node --disable-warning=ExperimentalWarning tools/verify-shape-agents-cdp.mjs
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
// free port: never the inherited PORT, which is the host app's).
home = await mkdtemp(path.join(tmpdir(), 'worca-c2-home-'));
process.env.HOME = home; process.env.USERPROFILE = home;
process.env.WORCA_HOME = path.join(home, '.worca-cc');
process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
process.env.WORCA_MOCK = '1';
process.env.WORCA_FLAGS = 'shaperSmallRuns';
const SHOTS = process.env.SHOTS_DIR || await mkdtemp(path.join(tmpdir(), 'worca-c2-shots-'));
await mkdir(SHOTS, { recursive: true });
proj = await mkdtemp(path.join(tmpdir(), 'worca-c2-proj-'));
for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'proof@worca.local'], ['config', 'user.name', 'proof']]) execFileSync('git', a, { cwd: proj });
await writeFile(path.join(proj, 'README.md'), '# agents per run proof\n');
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
srv = server;
await new Promise((r, rej) => { srv.once('error', (err) => rej(new Error(`cannot listen on VERIFY_PORT ${process.env.VERIFY_PORT}: ${err.message}`))); srv.listen(Number(process.env.VERIFY_PORT || 0), '127.0.0.1', r); });
const base = `http://127.0.0.1:${srv.address().port}`;
const post = (url, body) => fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) });
{ const r = await post('/api/settings', { uiLevel: 'expert' }); if (!r.ok) throw new Error(`could not pin the interface mode: HTTP ${r.status}`); }

// ---- the feature: run 1 (the planning run) done, run 2 live in "writing tests", run 3 waiting. Care: Thorough.
const key = projectKey(proj);
writeStoreMeta(key, 'project', { key, name: 'Proof', path: proj });
const now = new Date().toISOString();
const pipeline = (id, status, title, stats = null) => getDb().prepare(`INSERT INTO pipelines (id, project_key, target, title, status, phase,
  cycle, started_at, updated_at, total_cost_usd, total_active_ms, branch, shape_stats) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run(id, key, 'project', title, status, status, 0, now, now, 0, 0, JSON.stringify({ source: 'main', feature: `feat/${id}` }), stats ? JSON.stringify(stats) : null);
const AGREED = [{ id: 'R-po-1', text: 'People save a chart', example: 'Ana saves "Runs by day" and sees it listed.' },
  { id: 'R-arch-1', text: 'Charts live in the project store' }, { id: 'R-sec-1', text: 'Only members read a chart' }, { id: 'R-qa-1', text: 'Every chart type has a test' }];
const OWNED = [['R-po-1'], ['R-arch-1', 'R-sec-1'], ['R-qa-1']];
const TITLES = ['Store charts', 'Chart access', 'Chart tests'];
const outline = normalizeOutline({ why: 'proof', leftOut: [], slices: TITLES.map((title, i) => ({ id: `s${i + 1}`, title, goal: `Goal ${i + 1}`, inScope: [],
  outOfScope: [], acceptance: [`GET /api/charts returns ${i + 1} charts`], dependsOn: i ? [`s${i}`] : [], estimate: 'medium', requirements: OWNED[i] })) },
{ agreed: AGREED }).outline;
const care = { position: 'thorough', chosenBy: 'person', worcaPick: 'thorough' };
pipeline('ab000001', 'done', 'Charts', { smallRuns: true, care: { ...care, reason: 'Worca picks Thorough', facts: { touches: [], requirements: 4, subsystems: [], screens: false, size: null }, at: now } });
const f = createSliceFeature({ pipelineId: 'ab000001', projectDir: proj, title: 'Charts', outline, perspectives: ['product', 'architect', 'security'],
  workflowId: 'wf_shape', smallRuns: true, care });
pipeline('ab000002', 'running', 'Run 2 · Chart access');
const t2 = getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = 2').get(f.id).ticket_id;
getDb().prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = 'ab000002' WHERE id = ?").run(t2);
getDb().prepare('UPDATE shape_feature_slices SET pipeline_id = ? WHERE feature_id = ? AND idx = 2').run('ab000002', f.id);

// Run 2, held live through the server's runs map (mock steps finish in milliseconds): its Care plan, the Care graph's
// manifest, the steps decorFromState reads, and n_tests active.
const careRun = careRunPlan('thorough', { runRoles: runRolesOf(OWNED[1]) });
const reg = loadAgentRegistry();
const resolved = await resolveGraph(proj, 'wf_shape_slice_req', reg, undefined, { transform: (t) => careRunGraph(t, careRun) });
const stepper = { ...buildGraphManifest(resolved.template, resolved.agentsByKey, { overlays: { nodes: resolved.nodes, wires: resolved.wires } }), careRun };
const step = (nodeId, status = 'done') => ({ key: `x:${nodeId}:1`, executionId: `x:${nodeId}:1`, nodeId, ordinal: 1, cycle: 1, status,
  startedAt: now, activeMs: 1000, costUsd: 0 });
const { EventEmitter } = await import('node:events');
const orch = new EventEmitter();
const RUN_ID = 'run-ab000002';
orch.state = { id: 'ab000002', status: 'running', title: 'Run 2 · Chart access', projectDir: proj, stepper,
  steps: [...['n_task', 'n_clarify', 'n_plan', 'n_roles', 'n_refine'].map((id) => step(id)), step('n_tests', 'start')],
  active: [{ nodeId: 'n_tests', executionId: 'x:n_tests:1' }], tokens: {}, wireDeliveries: {}, warnings: [], endReached: false };
orch.getState = () => orch.state;
for (const m of ['answer', 'pause', 'stop']) orch[m] = () => true;
runs.set(RUN_ID, { id: RUN_ID, kind: 'run', pipelineId: 'ab000002', status: 'running', events: [], pendingQuestion: null,
  projectDir: proj, startedAt: Date.now(), orch, title: 'Run 2 · Chart access', tags: [] });

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
profile = await mkdtemp(path.join(tmpdir(), 'worca-c2-profile-'));
chrome = spawn(CHROME, ['--headless=new', ...SANDBOX, '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  `--window-size=${WIDTH},900`, '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--use-mock-keychain', 'about:blank'],
{ stdio: ['ignore', 'pipe', 'pipe'] });
let wsUrl = null;
const deadline = Date.now() + 60_000;
// Chrome picks a free debugging port and writes it to the profile's DevToolsActivePort file.
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
  const file = path.join(SHOTS, `c2-agents-${name}.png`);
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
/** Scrolls the measured list into the middle of the screen before a capture. */
const reveal = (sel) => ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.offsetParent); if (el) el.scrollIntoView({ block: 'center' }); return !!el; })()`);

/** The in-page measurement of one list: rows, mark and first-text-line centres, overflow, the long name on one line. */
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
    // One line: every part of the row starts on one top (dev's narrow card stacks a row's PR and cost under it).
    const tops = [...row.children].filter((c) => c.getBoundingClientRect().height > 0).map((c) => c.getBoundingClientRect().top); const mb = mark ? mark.getBoundingClientRect() : null; const tb = text ? firstLine(text) : null;
    return { text: (text && text.textContent || '').trim(), height: Math.round(rb.height * 10) / 10,
      markX: mb ? mb.left + mb.width / 2 : null, markY: mb ? mb.top + mb.height / 2 : null, textY: tb ? tb.top + tb.height / 2 : null,
      textLines: text ? lines(text) : 0, oneLine: !tops.length || Math.max(...tops) - Math.min(...tops) <= 8, parts: [...row.children].map((c) => [c.className.split(' ')[0], Math.round(c.getBoundingClientRect().height)]) };
  });
  const xs = rows.map((r) => r.markX).filter((x) => x != null);
  const long = rows.find((r) => r.text === 'Code review · Requirements');
  return { found: true, rows, spreadX: xs.length ? Math.max(...xs) - Math.min(...xs) : 0,
    maxDy: Math.max(0, ...rows.filter((r) => r.markY != null && r.textY != null).map((r) => Math.abs(r.markY - r.textY))),
    overflow: root.scrollWidth > root.clientWidth || document.documentElement.scrollWidth > document.documentElement.clientWidth,
    longOneLine: long ? long.textLines === 1 : null };
})()`;
function judge(list, theme, m, { long = true, every = false } = {}) {
  results.lists.push({ list, theme, ...m });
  const where = `${list}, ${theme}, ${WIDTH}px`;
  if (!m.found) { check(false, `${where}: the list is on screen`); return; }
  // `every`: each row must be one 32px line (the card's run rows, as the prototype's #build); else the one-line rows.
  const one = every ? m.rows : m.rows.filter((r) => r.oneLine && r.textLines <= 1);
  const off = one.filter((r) => !r.oneLine || Math.abs(r.height - 32) > 0.5);
  check(one.length > 0 && off.length === 0, `${where}: every one-line row is 32px (${one.length} of ${m.rows.length} rows one-line${off.length ? `; off: ${JSON.stringify(off.map((r) => [r.text, r.height]))}` : ''})`);
  check(m.maxDy <= 1, `${where}: each mark's y-centre is within 1px of its first text line (max ${m.maxDy.toFixed(2)}px)`);
  check(m.spreadX <= 1, `${where}: the marks share one x-centre within 1px (spread ${m.spreadX.toFixed(2)}px)`);
  check(!m.overflow, `${where}: no horizontal overflow`);
  if (long) check(m.longOneLine === true, `${where}: "Code review · Requirements" sits on one line`);
}

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: false });
const AGENTS = ['.run-agents', '.run-agents .plan-check-row', '.plan-check-mark', '.plan-check-label'];
const PROTO = pathToFileURL(PROTOTYPE).href;
for (const theme of THEMES) {
  // 1. The feature card's run rows in Chat (#build).
  await open(`${base}/?t=${theme}#chat/${thread.id}`);
  await skipWelcome();
  await setTheme(theme);
  if (await waitFor("!!document.querySelector('.chat-rc-members .run-member')", `the feature card's run rows (${theme})`)) {
    await skipWelcome(); await reveal('.chat-rc-members');
    const rowsText = await ev("[...document.querySelectorAll('.chat-rc-members .run-member .run-member-state')].map((n) => n.textContent)");
    check(rowsText.includes('done') && rowsText.includes('writing tests'), `card rows, ${theme}: the short words (${JSON.stringify(rowsText)})`);
    judge('card run rows', theme, await ev(MEASURE('.chat-rc-members', '.run-member', '.status-dot', '.run-member-title')), { long: false, every: true });
  }
  await shot(`app-build-${theme}`);
  await open(`${PROTO}#build`); await setTheme(theme); await sleep(300);
  await shot(`prototype-build-${theme}`);

  // 2. The side panel's Agents (Overview).
  await open(`${base}/?p=${theme}#chat/new/run/ab000002/overview`);
  await skipWelcome();
  await setTheme(theme);
  if (await waitFor("!!document.querySelector('.run-agents .plan-check-row')", `the side panel's Agents (${theme})`)) {
    await skipWelcome(); await reveal('.run-agents');
    judge('side panel Agents', theme, await ev(MEASURE(...AGENTS)));
  }
  await shot(`app-side-panel-${theme}`);
  await open(`${PROTO}#run-panel`); await setTheme(theme); await sleep(300);
  await shot(`prototype-run-panel-${theme}`);

  // 3. The run page's Agents.
  await open(`${base}/?r=${theme}#running/${RUN_ID}`);
  await skipWelcome();
  await setTheme(theme);
  if (await waitFor("!!document.querySelector('.run-agents .plan-check-row')", `the run page's Agents (${theme})`)) {
    await skipWelcome(); await reveal('.run-agents');
    const live = await ev("[...document.querySelectorAll('.run-agents .plan-check-row')].filter((r) => r.querySelector('.is-live')).map((r) => r.textContent)");
    check(live.length === 1 && /Test writer/.test(live[0]) && /writing tests/.test(live[0]), `run page, ${theme}: the Test writer is the live row (${JSON.stringify(live)})`);
    judge('run page Agents', theme, await ev(MEASURE(...AGENTS)));
  }
  await shot(`app-run-page-${theme}`);
  await open(`${PROTO}#run-panel`); await setTheme(theme); await sleep(300);
  await shot(`prototype-run-page-${theme}`);
}
check(errors.length === 0, `no page errors${errors.length ? ` — ${errors.slice(0, 3).join(' | ')}` : ''}`);
results.minutes = Math.round((Date.now() - T0) / 600) / 100;
results.failed = failed;
const logFile = path.join(SHOTS, 'c2-agents-measure.json');
await writeFile(logFile, JSON.stringify(results, null, 2) + '\n');
log(`${results.shots.length} PNGs and ${logFile} in ${results.minutes} min; ${failed ? `${failed} FAILED` : 'all passed'}`);
await shutdown(failed ? 1 : 0);
