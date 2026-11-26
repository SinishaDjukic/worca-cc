#!/usr/bin/env node
// tools/verify-option-mark-cdp.mjs — headless-Chrome proof of the pick-one option mark (`.qopt::before`), seeded data
// only on the mock engine. In light and dark at 1280px it opens one card of every tile user: the chat question card (a
// marked run's stop on the Chat feature card), the Runs page's Clarify questions (a mock run waiting at Clarify), a
// Requirements question round, the Shaper role rows' conflict card (a plan ask) and the Design sound card. Each card is
// captured as it opens and after a pick: every mark is a 16×16 circle, a picked one is an ink ring with an ink fill
// inside its padding, an unpicked one has no fill, no row changes height and exactly the clicked tile of its group is
// picked. PNGs and a JSON log go to SHOTS_DIR.
// NOT part of `npm test`: it needs Chrome. A hard 30-minute cap inside: past it the script exits non-zero.
// Run: H=$(mktemp -d); env -u FORCE_COLOR HOME=$H VERIFY_PORT=4941 SHOTS_DIR=… node --disable-warning=ExperimentalWarning tools/verify-option-mark-cdp.mjs
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CAP_MS = 30 * 60 * 1000;
const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
const CHROME = process.env.CHROME_BIN || CHROME_PATHS.find((p) => existsSync(p)) || CHROME_PATHS[0];
const SANDBOX = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0 ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
if (!existsSync(CHROME)) { console.error(`no Chrome at ${CHROME} - set CHROME_BIN`); process.exit(1); }
const THEMES = ['light', 'dark'];
const WIDTH = 1280;
const CLEAR = 'rgba(0, 0, 0, 0)';
const T0 = Date.now();
const log = (m) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}\n`);

let chrome = null; let srv = null; let mod = null; let home = null; let proj = null; let profile = null; let failed = 0;
const results = { startedAt: new Date(T0).toISOString(), width: WIDTH, cards: [], shots: [], checks: [] };
const REAL_ENV = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
async function shutdown(code) {
  try { if (chrome) chrome.kill('SIGKILL'); } catch {}
  try { if (mod) { for (const r of mod.runs.values()) r.orch?.stop?.(); mod.designBuilds?.pauseAll(); await mod.designBuilds?.settled(); } } catch {}
  try { if (srv) { srv.closeAllConnections?.(); await Promise.race([new Promise((r) => srv.close(r)), new Promise((r) => setTimeout(r, 1000))]); } } catch {}
  for (const d of [home, proj, profile]) { try { if (d) await rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {} }
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection']) {
  process.on(sig, (e) => { if (e && e.stack) console.error(e.stack); shutdown(1); });
}
// The hard cap: a proof that hangs never holds the run past 30 minutes.
setTimeout(() => { log(`FAIL the 30-minute cap was reached after ${((Date.now() - T0) / 60000).toFixed(1)} min`); shutdown(2); }, CAP_MS);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (ok, what) => { results.checks.push({ ok: !!ok, what }); if (ok) log(`ok   ${what}`); else { failed += 1; log(`FAIL ${what}`); } };

// ---- a sandboxed HOME and WORCA_HOME, the mock engine, the flags on, then the server in process (VERIFY_PORT, else a
// free port: never the inherited one, which is the host app's).
home = await mkdtemp(path.join(tmpdir(), 'worca-mark-home-'));
process.env.HOME = home; process.env.USERPROFILE = home;
process.env.WORCA_HOME = path.join(home, '.worca-cc');
process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
process.env.WORCA_MOCK = '1';
process.env.WORCA_FLAGS = 'shaperSmallRuns,requirements,design';
for (const k of ['WORCA_HOST_PID', 'WORCA_HOST', 'WORCA_AGENT_USER', 'WORCA_AGENT_HOME', 'WORCA_ALLOWED_HOSTS']) delete process.env[k];
const SHOTS = process.env.SHOTS_DIR || await mkdtemp(path.join(tmpdir(), 'worca-mark-shots-'));
await mkdir(SHOTS, { recursive: true });
proj = await mkdtemp(path.join(tmpdir(), 'worca-mark-proj-'));
for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'proof@worca.local'], ['config', 'user.name', 'proof']]) execFileSync('git', a, { cwd: proj });
await writeFile(path.join(proj, 'README.md'), '# option mark proof\n');
execFileSync('git', ['add', '-A'], { cwd: proj });
execFileSync('git', ['commit', '-qm', 'init'], { cwd: proj });
process.chdir(proj);
const imp = (rel) => import(new URL(rel, import.meta.url).href);
mod = await imp('../ui/server.mjs');
const { server, runs } = mod;
const { getDb } = await imp('../src/core/db.mjs');
const { projectKey } = await imp('../src/core/store.mjs');
const { addProject } = await imp('../src/core/projects.mjs');
const { createSliceFeature, recordShapePlan } = await imp('../src/core/shape/features.mjs');
const askStore = await imp('../src/core/ask/store.mjs');
const { resolveGraph } = await imp('../src/core/workflows.mjs');
const { loadAgentRegistry } = await imp('../src/core/agent-registry.mjs');
const { buildGraphManifest } = await imp('../src/shared/graph/manifest.mjs');
const { normalizeOutline } = await imp('../src/shared/shape/slices.mjs');
const { gateStop } = await imp('../src/shared/shape/run-stops.mjs');
srv = server;
await new Promise((r, rej) => { srv.once('error', (err) => rej(new Error(`cannot listen on VERIFY_PORT ${process.env.VERIFY_PORT}: ${err.message}`))); srv.listen(Number(process.env.VERIFY_PORT || 0), '127.0.0.1', r); });
const base = `http://127.0.0.1:${srv.address().port}`;
const post = (url, body) => fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) });
const posted = async (res, what) => { const r = await res; if (!r.ok) throw new Error(`${what}: HTTP ${r.status} ${await r.text()}`); return r.json(); };
await posted(post('/api/settings', { uiLevel: 'expert' }), 'pin the interface mode');
await posted(post('/api/onboarding', { welcomeSeen: true, roleDefaultsNoticeSeen: true }), 'skip onboarding');
await posted(post('/api/worca-level/ack', { what: 'welcome' }), 'acknowledge the worca level welcome');
await addProject({ name: 'Proof', path: proj });
const key = projectKey(proj);
const now = new Date().toISOString();

// 1. The chat question card: a feature of 2 runs whose run 2 waits on a stop, on the card of the thread that started it.
const pipeline = (id, status, title, stats = null) => getDb().prepare(`INSERT INTO pipelines (id, project_key, target, title, status, phase,
  cycle, started_at, updated_at, total_cost_usd, total_active_ms, branch, shape_stats) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run(id, key, 'project', title, status, status, 0, now, now, 0, 0, JSON.stringify({ source: 'main', feature: `feat/${id}` }), stats ? JSON.stringify(stats) : null);
const TITLES = ['Store saved charts', 'Check who may open a chart link'];
const outline = normalizeOutline({ why: 'proof', leftOut: [], slices: TITLES.map((title, i) => ({ id: `s${i + 1}`, title, goal: 'g', inScope: [], outOfScope: [],
  acceptance: ['ok'], dependsOn: i ? ['s1'] : [], estimate: 'medium', requirements: [`R-po-${i + 1}`] })) },
{ agreed: TITLES.map((text, i) => ({ id: `R-po-${i + 1}`, text })) }).outline;
const care = { position: 'balanced', chosenBy: 'person', worcaPick: 'balanced' };
pipeline('ab000001', 'done', 'Charts', { smallRuns: true });
const feature = createSliceFeature({ pipelineId: 'ab000001', projectDir: proj, title: 'Charts', outline, perspectives: ['product'], workflowId: 'wf_shape', smallRuns: true, care });
pipeline('ab000002', 'running', 'Run 2 · Chart access');
const ticket = getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = 2').get(feature.id).ticket_id;
getDb().prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = 'ab000002' WHERE id = ?").run(ticket);
getDb().prepare('UPDATE shape_feature_slices SET pipeline_id = ? WHERE feature_id = ? AND idx = 2').run('ab000002', feature.id);

const reg = loadAgentRegistry();
const resolved = await resolveGraph(proj, 'wf_default', reg);
const stepper = buildGraphManifest(resolved.template, resolved.agentsByKey, { overlays: { nodes: resolved.nodes, wires: resolved.wires } });
const { EventEmitter } = await import('node:events');
/** A run held live in the server's runs map, waiting on `pendingQuestion`. */
function liveRun(pipelineId, title, pendingQuestion, runShape = null) {
  const orch = new EventEmitter();
  orch.state = { id: pipelineId, status: 'running', title, projectDir: proj, stepper, steps: [], active: [], tokens: {}, wireDeliveries: {},
    warnings: [], endReached: false, shaping: {} };
  orch.getState = () => orch.state;
  if (runShape) orch.runShape = runShape;
  for (const m of ['answer', 'pause', 'stop']) orch[m] = () => true;
  const id = `run-${pipelineId}`;
  runs.set(id, { id, kind: 'run', pipelineId, status: 'running', events: [], pendingQuestion, projectDir: proj, startedAt: Date.now(), orch, title, tags: [] });
  return id;
}
const ISSUES = [{ severity: 'major', title: 'A chart link opens for a visitor who is not a member' }];
liveRun('ab000002', 'Run 2 · Chart access', { id: 'gate-w9-3', kind: 'gate', nodeId: 'n_review', executionId: 'x:n_review:3', issues: ISSUES,
  stop: gateStop({ run: 2, issues: ISSUES, fixCycles: 3, nodeId: 'n_review' }) }, { slice: { feature: feature.id, index: 2 } });
const thread = askStore.createThread({ title: 'Charts' });
const cardId = askStore.newAskId('card');
askStore.appendMessage(thread.id, { role: 'user', text: 'Plan charts in small runs' });
askStore.appendMessage(thread.id, { role: 'assistant', status: 'done', text: 'Here is the feature:',
  blocks: [{ kind: 'card', id: cardId, state: 'tracked', card: { type: 'progress', pipelineId: 'ab000001', runId: 'run-ab000001', projectKey: key, title: 'Charts', status: 'done' } }] });
askStore.linkRun(thread.id, { runId: 'run-ab000001', cardId, pipelineId: 'ab000001', status: 'done' });
recordShapePlan({ threadId: thread.id, cardId, title: 'Charts' });

// 2. The Runs page's Clarify questions: a real mock run, which waits at Clarify.
const started = await posted(post('/api/run', { projectDir: proj, prompt: 'Add a saved charts page', workflowId: 'wf_default' }), 'start the mock run');
{ const end = Date.now() + 60_000;
  while (runs.get(started.runId)?.pendingQuestion?.questions === undefined) {
    if (Date.now() > end) throw new Error(`the mock run never reached Clarify (${JSON.stringify(runs.get(started.runId)?.pendingQuestion)})`);
    await sleep(200);
  } }

// 3. A Requirements question round: a new feature, whose first mock round asks two questions.
const req = await posted(post('/api/requirements', { scopeType: 'project', scopeKey: key, title: 'Cancel an order', description: 'Customers cancel before it ships' }), 'start the requirements feature');
{ const end = Date.now() + 60_000;
  while (!(await (await fetch(`${base}/api/requirements/${req.feature.seq}`)).json()).feature?.pending) {
    if (Date.now() > end) throw new Error('the requirements round never asked');
    await sleep(300);
  } }

// 4. The Shaper role rows: a plan ask whose last review round holds a conflict.
const finding = (id) => ({ id, severity: 'major', title: id, section: 'Rollout', fix: `fix ${id}`, status: 'disputed', reason: 'conflict, left to the person' });
const role = (k, label, findings) => ({ key: k, label, skipped: false, checklist: [], findings });
const roleReviews = { rounds: [{ pass: 1, round: 1, plan: 'p', roles: [role('security', 'Security', [finding('security-1-1')]), role('ux', 'UX', [finding('ux-1-1')])],
  conflicts: [{ id: 'conflict-1', findings: ['security-1-1', 'ux-1-1'], roles: ['security', 'ux'], section: 'Rollout',
    question: 'Roll out behind a flag, or to everyone?', options: ['Behind a flag', 'To everyone'] }] }] };
pipeline('ac000001', 'running', 'Saved charts rollout');
const PLAN_RUN = liveRun('ac000001', 'Saved charts rollout', { id: 'plan-n_refine-1', kind: 'plan', nodeId: 'n_refine', executionId: 'x:n_refine:1',
  plan: { nodeId: 'n_refine', port: 'plan', file: 'plan.md', round: 1, revisable: true, check: null, perspectives: ['security', 'ux'], roleReviews } });

// 5. The Design sound card, opened by the video design's gear (no model turn).
const design = await posted(post('/api/design', { kind: 'video', title: 'Kiln' }), 'create the video design');
const sound = await posted(post(`/api/design/${design.design.id}/sound/ask`, {}), 'open the sound card');

const CARDS = [
  { user: 'chat-question', hash: `#chat/${thread.id}`, tiles: '.chat-rc .qpanel .qopt' },
  { user: 'runs-clarify', hash: `#running/${started.runId}`, tiles: '#run-detail .qpanel .qopt' },
  { user: 'requirements-round', hash: `#requirements/feature/${req.feature.seq}`, tiles: '#requirements-host .qpanel .qopt' },
  { user: 'shaper-role-rows', hash: `#running/${PLAN_RUN}`, tiles: '#run-detail .qpanel .plan-decision button.qopt' },
  { user: 'design-sound', hash: `#chat/${design.threadId}`, tiles: `.dsc-card-host[data-design-card="${sound.cardId}"] section.chat-q:not(.is-answered) .qopt` },
];
log(`server ${base} · ${CARDS.length} cards seeded`);

// ---- chrome + cdp (its own HOME: macOS needs the real one for the keychain stub)
profile = await mkdtemp(path.join(tmpdir(), 'worca-mark-profile-'));
chrome = spawn(CHROME, ['--headless=new', ...SANDBOX, '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  `--window-size=${WIDTH},1000`, '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--use-mock-keychain', 'about:blank'],
{ stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...REAL_ENV } });
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
  const file = path.join(SHOTS, `option-mark-${name}.png`);
  await writeFile(file, Buffer.from(data, 'base64'));
  results.shots.push(file);
}
/** Closes a first-visit dialog that still opens, for up to 1.5 s. */
async function skipWelcome() {
  const end = Date.now() + 1500;
  while (Date.now() < end) {
    await ev(`(() => { for (const b of document.querySelectorAll('button')) {
      if (b.offsetParent && /^(skip|got it)$/i.test(b.textContent.trim()) && b.closest('dialog, [role=dialog], .viewer-modal, .modal, #welcome-modal')) b.click(); } })()`);
    await sleep(250);
  }
}
/** The first question's tiles: each row's height and picked state, and its mark as drawn, beside the theme's --ink. */
const MARKS = (sel) => `(() => {
  const first = [...document.querySelectorAll(${JSON.stringify(sel)})].find((t) => t.offsetParent);
  if (!first) return null;
  const probe = document.body.appendChild(document.createElement('i'));
  probe.style.color = 'var(--ink)';
  const ink = getComputedStyle(probe).color;
  probe.remove();
  return [...first.parentElement.querySelectorAll(':scope > .qopt')].map((t) => {
    const b = getComputedStyle(t, '::before');
    return { picked: t.classList.contains('sel'), pressed: t.getAttribute('aria-pressed'), row: Math.round(t.getBoundingClientRect().height * 10) / 10,
      radius: b.borderTopLeftRadius, width: b.width, height: b.height, ring: b.borderTopColor, fill: b.backgroundColor, clip: b.backgroundClip,
      padding: b.paddingTop, mask: b.maskImage, image: b.backgroundImage, ink };
  });
})()`;
function judge(tiles, what) {
  check(tiles.every((m) => m.radius === '50%' && m.width === '16px' && m.height === '16px'), `${what}: every mark is a 16px circle (${JSON.stringify(tiles.map((m) => [m.radius, m.width, m.height]))})`);
  check(tiles.every((m) => m.mask === 'none' && m.image === 'none' && m.clip === 'content-box' && m.padding === '3px'), `${what}: no mask or image; the fill stays inside the 3px padding`);
  for (const m of tiles) {
    if (m.picked) check(m.fill === m.ink && m.ring === m.ink && m.pressed === 'true', `${what}: the picked mark is an ink ring with an ink dot (${m.ring}, ${m.fill}, ink ${m.ink})`);
    else check(m.fill === CLEAR && m.ring !== m.ink && m.pressed === 'false', `${what}: an unpicked mark has no fill (${m.ring}, ${m.fill})`);
  }
}

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 1000, deviceScaleFactor: 2, mobile: false });
let turn = 0;
for (const theme of THEMES) {
  await posted(post('/api/settings', { theme }), `set the ${theme} theme`);
  for (const { user, hash, tiles } of CARDS) {
    const at = `${user}, ${theme}`;
    turn += 1;
    await cdp('Page.navigate', { url: `${base}/?m=${turn}${hash}` });
    await sleep(600);
    await skipWelcome();
    await ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)};0`);
    if (!(await waitFor(`[...document.querySelectorAll(${JSON.stringify(tiles)})].some((t) => t.offsetParent)`, `the tiles (${at})`))) { await shot(`${user}-${theme}-missing`); continue; }
    await skipWelcome();
    await ev(`[...document.querySelectorAll(${JSON.stringify(tiles)})].find((t) => t.offsetParent).parentElement.scrollIntoView({ block: 'center' });0`);
    await sleep(500);
    const before = await ev(MARKS(tiles));
    check(before.length >= 2 && before.filter((m) => m.picked).length <= 1, `${at}: at most one tile picked as it opens`);
    judge(before, `${at}, as it opens`);
    await shot(`${user}-${theme}-unpicked`);
    const target = before.findIndex((m) => !m.picked);
    await ev(`[...[...document.querySelectorAll(${JSON.stringify(tiles)})].find((t) => t.offsetParent).parentElement.querySelectorAll(':scope > .qopt')][${target}].click();0`);
    // The pointer is elsewhere (a script click), so the row shows its picked state, not hover; the transition settles.
    await sleep(500);
    const after = await ev(MARKS(tiles));
    check(after.every((m, i) => m.picked === (i === target)), `${at}: exactly the clicked tile is picked (${JSON.stringify(after.map((m) => m.picked))})`);
    judge(after, `${at}, picked`);
    check(before.every((t, i) => t.row === after[i].row), `${at}: no row changes height (${JSON.stringify([before.map((t) => t.row), after.map((t) => t.row)])})`);
    results.cards.push({ user, theme, before, after });
    await shot(`${user}-${theme}-picked`);
  }
}
check(errors.length === 0, `no page errors${errors.length ? ` — ${errors.slice(0, 3).join(' | ')}` : ''}`);
results.minutes = Math.round((Date.now() - T0) / 600) / 100;
results.failed = failed;
const logFile = path.join(SHOTS, 'option-mark-measure.json');
await writeFile(logFile, JSON.stringify(results, null, 2) + '\n');
log(`${results.shots.length} PNGs and ${logFile} in ${results.minutes} min; ${failed ? `${failed} FAILED` : 'all passed'}`);
await shutdown(failed ? 1 : 0);
