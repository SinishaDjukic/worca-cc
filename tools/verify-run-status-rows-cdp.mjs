#!/usr/bin/env node
// tools/verify-run-status-rows-cdp.mjs — headless-Chrome proof of Shaper small runs slices 4 and 5: the Chat card's run
// rows, the feature page's Runs tab, the Runs list's member rows and the run page head take each run's word and mark from
// the shared run status (runStatus → markDot). Seeded data only, on the mock engine: the real 16-run feature
// (test/helpers/shape-sixteen-runs.mjs) in five worlds, its live runs put into the server's runs map the way
// tools/verify-run-stops-cdp.mjs does.
//   base    run 2 at a stop, run 3 building: run 7 `waits for run 2 (needs you), 6`, run 12 `waits for run 7, 10`, run 9 `next`.
//   busy    runs 2, 4 and 11 at stops, run 5 failed, run 6 building: run 9 `next`, run 7 `waits for run 2 (needs you), 6`.
//   held    run 4's stop answer held behind run 3: `after run 3` on the dashed ring, and no row reads `next`.
//   change  base with run 13 a change run: `next · small change run` on the ink ring.
//   failed  run 5 failed: the red "!", run 6 `waits for run 5 (failed)`, runs 15 and 16 (cannot start) today's text.
// For each world and theme, at 1280px and deviceScaleFactor 2, it shoots the Chat card and the feature page Runs tab:
// `rows-{world}-{card|page}-{theme}.png`. A JSON log records every row (word, data-mark, dot class, height, wrap,
// word colour). It also checks base-world runs 7 and 12 at 375px in light. The script exits non-zero on any failed
// check: a row that is not one 32px line, a word that wraps, a pulse on a row whose mark is not live, a live word that
// reads working, an open stop or failed word not in its ink token. A canceled run keeps today's row (no mark).
// Slice 5 adds two surfaces. `side`: the Runs list at #runs with the feature group expanded, `rows-{world}-side-{theme}.png`
// and one 360px light shot `rows-busy-side-360-light.png`; every member's word, dot and data-mark equal the card's, the
// live member keeps its .runs-stage strips (Plan, Build, Review, Ready), the ask and failed words take the card's ink,
// the dashed ring's centre sits within 1px of a plain dot's, and at 360px each run number and word stays visible. `run`:
// the run page head (.rd-sheet .run-status) of busy runs 2 (ask), 5 (failed), 6 (live) and held run 4 (after run 3),
// `rows-{world}-run{n}-{theme}.png`; its word and dot equal the card's, and its detail restates no dev state word.
// Slice 6 adds the `stops` surface: the Chat card's open stop list in the busy world, per theme at 1280px and 2x.
// `stops-busy-card-{theme}.png`: 4 lines in run order (runs 2, 4, 5, 11) with their exact texts, run 5's red "!" and its
// Resume, a mounted visible .qpanel per open line whose data-qrun is that run's seeded run id, and no footer Resume. Then
// Approve on run 4's real step card must post run 4's run id to /answer. `stops-refused-{theme}.png`: run 5's Resume is
// refused (run 6 is going) and its line shows the refusal with Resume enabled again. `stops-after-{theme}.png`: busy with
// run 4 re-seeded building lists 3 lines, runs 2, 5 and 11. SURFACE=stops runs only this surface.
// Slice 7 adds the `line` surface: the feature's state line and need count on the Chat card head with its status block
// (`line-{world}-card-{theme}.png`) and on the feature page head (`line-{world}-page-{theme}.png`), per theme at 1280px
// and 2x, in four worlds: busy (run 6 reviewing), next (busy, run 6 not started), two (slice 1's M5b: runs 8 and 10 build)
// and acts (only run 2's stop, Ask before each run on). It checks each exact line, the chip text once per surface, no chip
// in two, the chip height and the card detail's line count. SURFACE=line runs only this surface.
// NOT part of `npm test`: it needs Chrome. A hard 20-minute cap inside.
// Run: H=$(mktemp -d); env -u FORCE_COLOR HOME=$H VERIFY_PORT=4943 SHOTS_DIR=… node --disable-warning=ExperimentalWarning tools/verify-run-status-rows-cdp.mjs
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CAP_MS = 20 * 60 * 1000;
const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
const CHROME = process.env.CHROME_BIN || CHROME_PATHS.find((p) => existsSync(p)) || CHROME_PATHS[0];
const SANDBOX = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0 ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
if (!existsSync(CHROME)) { console.error(`no Chrome at ${CHROME} - set CHROME_BIN`); process.exit(1); }
const THEMES = ['light', 'dark'];
const WORLDS = ['base', 'busy', 'held', 'change', 'failed'].filter((w) => (!process.env.WORLD || w === process.env.WORLD) && process.env.SURFACE !== 'stops' && process.env.SURFACE !== 'line');   // WORLD=held runs one world
const WIDE = 1280;
const NARROW = 375;
const SIDE_NARROW = 360;   // s5: the Runs list's narrow shot
const T0 = Date.now();
const log = (m) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}\n`);

let chrome = null; let srv = null; let home = null; let proj = null; let profile = null; let failed = 0;
const results = { startedAt: new Date(T0).toISOString(), rows: [], shots: [], checks: [] };
async function shutdown(code) {
  try { if (chrome) chrome.kill('SIGKILL'); } catch {}
  try { if (srv) await new Promise((r) => srv.close(r)); } catch {}
  for (const d of [home, proj, profile]) { try { if (d) await rm(d, { recursive: true, force: true }); } catch {} }
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection']) {
  process.on(sig, (e) => { if (e && e.stack) console.error(e.stack); shutdown(1); });
}
setTimeout(() => { log('FAIL the 20-minute cap was reached'); shutdown(2); }, CAP_MS);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (ok, what) => { results.checks.push({ ok: !!ok, what }); if (ok) log(`ok   ${what}`); else { failed += 1; log(`FAIL ${what}`); } };

// ---- a sandboxed HOME and WORCA_HOME, the mock engine, the flag on, then the server in process on VERIFY_PORT (else a
// free port: never the inherited one, which is the host app's). Importing the server does not start the scheduler.
home = await mkdtemp(path.join(tmpdir(), 'worca-s4-home-'));
process.env.HOME = home; process.env.USERPROFILE = home;
process.env.WORCA_HOME = path.join(home, '.worca-cc');
process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
process.env.WORCA_MOCK = '1';
process.env.WORCA_FLAGS = 'shaperSmallRuns';
const SHOTS = process.env.SHOTS_DIR || await mkdtemp(path.join(tmpdir(), 'worca-s4-shots-'));
await mkdir(SHOTS, { recursive: true });
proj = await mkdtemp(path.join(tmpdir(), 'worca-s4-proj-'));
for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'proof@worca.local'], ['config', 'user.name', 'proof']]) execFileSync('git', a, { cwd: proj });
await writeFile(path.join(proj, 'README.md'), '# run status rows proof\n');
execFileSync('git', ['add', '-A'], { cwd: proj });
execFileSync('git', ['commit', '-qm', 'init'], { cwd: proj });
const imp = (rel) => import(new URL(rel, import.meta.url).href);
const { server, runs } = await imp('../ui/server.mjs');
const { projectKey } = await imp('../src/core/store.mjs');
const { writeStoreMeta } = await imp('../src/core/artifacts.mjs');
const { recordShapePlan, setApproveEach } = await imp('../src/core/shape/features.mjs');
const askStore = await imp('../src/core/ask/store.mjs');
const { resolveGraph } = await imp('../src/core/workflows.mjs');
const { loadAgentRegistry } = await imp('../src/core/agent-registry.mjs');
const { buildGraphManifest } = await imp('../src/shared/graph/manifest.mjs');
const { careRunPlan } = await imp('../src/shared/shape/feature-record.mjs');
const { runRolesOf } = await imp('../src/shared/shape/requirements.mjs');
const { careRunGraph } = await imp('../src/core/shape/care-run.mjs');
const { world, SIXTEEN_RUN_STATES } = await imp('../test/helpers/shape-sixteen-runs.mjs');
const { planStop } = await imp('../src/shared/shape/run-stops.mjs');
srv = server;
await new Promise((r, rej) => { srv.once('error', (err) => rej(new Error(`cannot listen on VERIFY_PORT ${process.env.VERIFY_PORT}: ${err.message}`))); srv.listen(Number(process.env.VERIFY_PORT || 0), '127.0.0.1', r); });
const base = `http://127.0.0.1:${srv.address().port}`;
const post = (url, body) => fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) });
{ const r = await post('/api/settings', { uiLevel: 'expert' }); if (!r.ok) throw new Error(`could not pin the interface mode: HTTP ${r.status}`); }
const key = projectKey(proj);
writeStoreMeta(key, 'project', { key, name: 'Proof', path: proj });

// ---- the live runs: a run at a stop (open or held) or building, held in the server's runs map with a Care plan graph,
// so a building run says its phase word (never a generic working).
const careRun = careRunPlan('balanced', { runRoles: runRolesOf(['R-po-1']) });
const resolved = await resolveGraph(proj, 'wf_shape_slice_req', loadAgentRegistry(), undefined, { transform: (t) => careRunGraph(t, careRun) });
const stepper = { ...buildGraphManifest(resolved.template, resolved.agentsByKey, { overlays: { nodes: resolved.nodes, wires: resolved.wires } }), careRun };
const now = new Date().toISOString();
const step = (nodeId, status = 'done') => ({ key: `x:${nodeId}:1`, executionId: `x:${nodeId}:1`, nodeId, ordinal: 1, cycle: 1, status, startedAt: now, activeMs: 1000, costUsd: 0 });
const { EventEmitter } = await import('node:events');
// A stop is the plan approval's real payload (planStop): a requirement stop (an outline change) or a check stop.
const CHECK = { ok: false, passed: 3, total: 8, items: [{ id: 'tests', label: 'Names its tests', pass: false, detail: 'no test is named' }] };
const stopOf = (run, reason) => planStop(reason === 'requirement' ? { run, outlineChange: 'the runner cache needs its own run', node: 'n_refine' } : { run, check: CHECK, node: 'n_refine' });
const ORDER = ['n_task', 'n_clarify', 'n_plan', 'n_roles', 'n_refine', 'n_tests', 'n_impl', 'n_review'];
const liveIds = [];
function liveRun(featureId, run, pid, how) {
  const orch = new EventEmitter();
  const at = how.stop ? 'n_refine' : how.at || 'n_impl';   // slice 7: the line surface seeds busy run 6 at n_review
  const pq = how.stop ? { id: `q${run}`, kind: 'plan', nodeId: 'n_refine', executionId: 'x:n_refine:1',
    plan: { nodeId: 'n_refine', port: 'plan', file: 'plan.md', round: 1, revisable: true, check: CHECK }, stop: stopOf(run, how.stop) } : null;
  orch.state = { id: pid, status: 'running', title: `Run ${run}`, projectDir: proj, stepper,
    steps: [...ORDER.slice(0, ORDER.indexOf(at)).map((id) => step(id)), step(at, pq ? 'done' : 'start')],
    active: pq ? [] : [{ nodeId: at, executionId: `x:${at}:1` }], tokens: {}, wireDeliveries: {}, warnings: [], endReached: false,
    shaping: { approved: { file: 'plan.md' } } };
  orch.getState = () => orch.state;
  orch.runShape = { slice: { feature: featureId, index: run } };
  for (const m of ['answer', 'pause', 'stop']) orch[m] = () => true;
  const id = `run-${pid}`;
  runs.set(id, { id, kind: 'run', pipelineId: pid, status: 'running', events: [], pendingQuestion: pq, projectDir: proj, startedAt: Date.now(), orch,
    title: `Run ${run}`, tags: [], heldStop: how.held ? { id: `q${run}`, after: Number.isInteger(how.after) ? how.after : 2 } : null });
  liveIds.push(id);
}

/** The four worlds: the helper's `{done, states}` plus what the world changes after (a change run, a canceled ticket). */
const SPECS = {
  base: { spec: SIXTEEN_RUN_STATES.base },
  busy: { spec: SIXTEEN_RUN_STATES.busy },
  held: { spec: { done: [1], states: { 2: { stop: 'requirement' }, 3: { pipe: 'running' }, 4: { stop: 'check', held: true, after: 3 } } } },
  change: { spec: SIXTEEN_RUN_STATES.base, then: (fx) => fx.setKind(13, 'change') },
  failed: { spec: { done: [1, 3, 4], states: { 2: { stop: 'requirement' }, 11: { stop: 'check' }, 5: { pipe: 'error' } } }, then: (fx) => fx.cancelTicket(14) },
  // s6 stops: busy with run 4 answered and building, so its stop line is gone.
  'stops-after': { spec: { done: SIXTEEN_RUN_STATES.busy.done, states: { ...SIXTEEN_RUN_STATES.busy.states, 4: { pipe: 'running' } } } },
  // s7 line: busy with run 6 reviewing; busy with run 6 not started; slice 1's M5b; only run 2's stop, Ask before each run.
  'line-busy': { spec: SIXTEEN_RUN_STATES.busy, at: { 6: 'n_review' } },
  'line-next': { spec: { done: SIXTEEN_RUN_STATES.busy.done, states: Object.fromEntries(Object.entries(SIXTEEN_RUN_STATES.busy.states).filter(([r]) => r !== '6')) } },
  'line-two': { spec: { done: [1, 2, 3, 4, 9, 11], states: { 5: { pipe: 'paused' }, 8: { pipe: 'running' }, 10: { pipe: 'running' } } } },
  'line-acts': { spec: { done: [1], states: { 2: { stop: 'requirement' } } }, then: (fx) => setApproveEach(fx.featureId, true) },
};
/** Seeds one world (cancelling the previous world's tickets and live runs) and its Chat thread; returns the routes. */
function seed(name) {
  for (const id of liveIds.splice(0)) runs.delete(id);
  const { spec, then, at = {} } = SPECS[name];
  const fx = world(proj, spec);
  if (then) then(fx);
  for (const [r, how] of Object.entries(spec.states || {})) if (how.stop || (how.pipe || 'running') === 'running') liveRun(fx.featureId, Number(r), fx.pipelineOf(Number(r)), at[r] ? { ...how, at: at[r] } : how);
  const thread = askStore.createThread({ title: `Rows ${name}` });
  const cardId = askStore.newAskId('card');
  askStore.appendMessage(thread.id, { role: 'user', text: 'Plan the merge gate in small runs' });
  askStore.appendMessage(thread.id, { role: 'assistant', status: 'done', text: 'Here is the feature:',
    blocks: [{ kind: 'card', id: cardId, state: 'tracked', card: { type: 'progress', pipelineId: fx.originPipelineId, runId: `run-${fx.originPipelineId}`, projectKey: key, title: 'CI as a trusted merge gate', status: 'done' } }] });
  askStore.linkRun(thread.id, { runId: `run-${fx.originPipelineId}`, cardId, pipelineId: fx.originPipelineId, status: 'done' });
  recordShapePlan({ threadId: thread.id, cardId, title: 'CI as a trusted merge gate' });
  return { card: `#chat/${thread.id}`, pipelineOf: (n) => fx.pipelineOf(n), page: `#feature/${fx.featureId}`, side: '#runs', origin: fx.originPipelineId, featureId: fx.featureId,
    // s5: a started run's page: a live run at #running/ plus its run id, a finished one at #history/ plus key and id.
    run: (n) => (liveIds.includes(`run-${fx.pipelineOf(n)}`) ? `#running/run-${fx.pipelineOf(n)}` : `#history/${key}/${fx.pipelineOf(n)}`) };
}

// ---- chrome + cdp
profile = await mkdtemp(path.join(tmpdir(), 'worca-s4-profile-'));
chrome = spawn(CHROME, ['--headless=new', ...SANDBOX, '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  `--window-size=${WIDE},1400`, '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--use-mock-keychain', 'about:blank'],
{ stdio: ['ignore', 'pipe', 'pipe'] });
let wsUrl = null; let cdpPort = null;
const deadline = Date.now() + 60_000;
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
  check(false, `waiting for ${what}`);
  return false;
}
async function skipWelcome() {
  const end = Date.now() + 3000;
  while (Date.now() < end) {
    const n = await ev(`(() => { let n = 0; for (const b of document.querySelectorAll('button')) {
      if (!b.offsetParent || !/^(skip|got it)$/i.test(b.textContent.trim()) || !b.closest('dialog, [role=dialog], .viewer-modal, .modal, #welcome-modal')) continue;
      b.click(); n += 1; } return n; })()`);
    await sleep(n ? 300 : 250);
  }
}
let turn = 0;
async function go(hash, theme) {
  turn += 1;
  await cdp('Page.navigate', { url: `${base}/?v=${turn}${hash}` });
  await sleep(600);
  await skipWelcome();
  await ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)};0`);
}
const metrics = (width) => cdp('Emulation.setDeviceMetricsOverride', { width, height: 1400, deviceScaleFactor: 2, mobile: false });
/** A 2x shot of the visible element `sel`, clipped to its box inside the viewport (captureBeyondViewport re-lays the
 *  chat column out). The first-visit notice toast is closed first, so it covers no row. */
const MIN_SHOT_PX = 16;   // one line of text: a one-line run head (a failed run) is 19px; a folded box is 0px
async function shotOf(sel, file, block = 'start') {
  await ev("document.querySelector('.toast[data-key=\"role-defaults\"] .toast-x')?.click();0");
  await sleep(300);
  const box = await ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.offsetParent); if (!el) return null;
    el.scrollIntoView({ block: ${JSON.stringify(block)} }); const b = el.getBoundingClientRect();
    return { x: b.left, y: b.top, width: b.width, height: Math.min(b.height, innerHeight - b.top), text: el.innerText.trim().length }; })()`);
  if (!box) { check(false, `${file}: ${sel} is on screen`); return; }
  // A folded or empty box is no evidence: no file is written for it, and the proof fails.
  if (box.height < MIN_SHOT_PX || !box.text) { check(false, `${file}: ${sel} is at least ${MIN_SHOT_PX}px tall and has text (${Math.round(box.height)}px, ${box.text} chars), no shot written`); return; }
  await sleep(200);
  const { data } = await cdp('Page.captureScreenshot', { format: 'png',
    clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: box.width + 16, height: box.height + 16, scale: 1 } });
  const out = path.join(SHOTS, file);
  await writeFile(out, Buffer.from(data, 'base64'));
  results.shots.push(out);
}

/** The painted dot's signature, the same on every surface (all paint through paintStatusDot): its is-… classes (the
 *  pulse included) and its symbol (test/helpers/shape-surfaces.mjs dotSig). */
const SIG_SRC = `(dot) => dot ? [...dot.classList].filter((c) => c.startsWith('is-')).sort().join(' ') + '|' + (dot.dataset.symbol || '') : ''`;
/** Every numbered run row of the list under `rootSel`: run, word, data-mark, dot class and symbol, height, whether the
 *  word wraps, the word colour, and the ink tokens resolved in this theme (rgb). */
const ROWS = (rootSel) => `(() => {
  const SIG = ${SIG_SRC};
  const root = [...document.querySelectorAll(${JSON.stringify(rootSel)})].find((r) => r.offsetParent);
  if (!root) return null;
  const tone = (v) => { const p = document.createElement('span'); p.style.color = v; root.append(p); const c = getComputedStyle(p).color; p.remove(); return c; };
  const ink = { 'amber-ink': tone('var(--amber-ink)'), 'red-ink': tone('var(--red-ink)'), 'ink-2': tone('var(--ink-2)') };
  const rows = [...root.querySelectorAll('.run-member')].filter((li) => li.offsetParent && li.dataset.key !== 'planning').map((li) => {
    const st = li.querySelector('.run-member-state'); const dot = li.querySelector('.status-dot');
    const lh = st ? parseFloat(getComputedStyle(st).lineHeight) || 20 : 20;
    return { run: Number(li.querySelector('.run-member-num')?.textContent || 0), word: st ? st.textContent : null, mark: li.dataset.mark || null,
      dot: dot ? dot.className : '', symbol: dot ? dot.dataset.symbol || null : null, height: Math.round(li.getBoundingClientRect().height * 10) / 10,
      wrap: !!st && (st.getBoundingClientRect().height > lh + 1 || st.scrollWidth > st.clientWidth + 1),
      color: st ? getComputedStyle(st).color : null, second: !!li.querySelector('.run-member-line'), sig: SIG(dot) };
  });
  return { rows, ink };
})()`;
/** The checks one list must pass, for every world. */
function judgeRows(where, m, width) {
  if (!m) { check(false, `${where}: the run rows are on screen`); return null; }
  const at = (n) => m.rows.find((r) => r.run === n) || {};
  const off = m.rows.filter((r) => Math.abs(r.height - 32) > 0.5 || r.wrap || r.second);
  check(m.rows.length === 16 && off.length === 0, `${where}: 16 run rows, each one 32px line, no word wraps (off: ${JSON.stringify(off.map((r) => [r.run, r.word, r.height]))})`);
  const pulse = m.rows.filter((r) => /\bis-pulse\b/.test(r.dot) && r.mark !== 'live');
  check(pulse.length === 0, `${where}: only rows whose data-mark is live carry is-pulse (${JSON.stringify(pulse.map((r) => r.run))})`);
  const live = m.rows.filter((r) => r.mark === 'live');
  check(live.every((r) => r.word && !/^working$/i.test(r.word.trim())), `${where}: a live word is never working (${JSON.stringify(live.map((r) => [r.run, r.word]))})`);
  const sym = m.rows.filter((r) => r.symbol).map((r) => [r.mark, r.symbol]);
  check(sym.every(([mk, s]) => (mk === 'ask' && s === 'question') || (mk === 'failed' && s === 'alert')), `${where}: "?" only on an open stop, "!" only on a failed run (${JSON.stringify(sym)})`);
  for (const r of m.rows.filter((x) => x.mark === 'ask' || x.mark === 'failed')) {
    const want = r.mark === 'ask' ? m.ink['amber-ink'] : m.ink['red-ink'];
    check(r.color === want, `${where}: run ${r.run}'s word "${r.word}" reads ${r.mark === 'ask' ? '--amber-ink' : '--red-ink'} (${r.color} vs ${want})`);
  }
  const plain = m.rows.filter((r) => r.mark && r.mark !== 'ask' && r.mark !== 'failed' && r.color !== m.ink['ink-2']);
  check(plain.length === 0, `${where}: every other word keeps --ink-2 (${JSON.stringify(plain.map((r) => r.run))})`);
  results.rows.push({ where, width, ink: m.ink, rows: m.rows });
  return at;
}
/** The words and marks each world must show. */
const WANT = {
  busy: (at, where) => {
    check(at(9).word === 'next' && /is-ink-ring/.test(at(9).dot), `${where}: run 9 next on the ink ring (${at(9).word}, ${at(9).dot})`);
    check(at(7).word === 'waits for run 2 (needs you), 6' && /is-grey-ring/.test(at(7).dot), `${where}: run 7 waits for run 2 (needs you), 6 (${at(7).word})`);
    check(at(5).word === 'failed' && at(5).symbol === 'alert', `${where}: run 5 failed with the "!"`);
  },
  base: (at, where) => {
    check(at(7).word === 'waits for run 2 (needs you), 6' && /is-grey-ring/.test(at(7).dot), `${where}: run 7 waits for run 2 (needs you), 6 on the grey ring (${at(7).word})`);
    check(at(12).word === 'waits for run 7, 10' && /is-grey-ring/.test(at(12).dot), `${where}: run 12 waits for run 7, 10 (${at(12).word})`);
    check(at(9).word === 'next' && /is-ink-ring/.test(at(9).dot), `${where}: run 9 next on the ink ring (${at(9).word}, ${at(9).dot})`);
    check(at(2).word === 'waiting for you' && at(2).symbol === 'question', `${where}: run 2 waiting for you with the "?"`);
  },
  held: (at, where, rows) => {
    check(at(4).word === 'after run 3' && /is-dashed-ring/.test(at(4).dot) && !at(4).symbol, `${where}: run 4 after run 3 on the dashed ring, no glyph (${at(4).word}, ${at(4).dot})`);
    check(!rows.some((r) => /^next/.test(r.word || '')), `${where}: no row reads next or next · small change run while run 4's answer is held`);
  },
  change: (at, where) => {
    check(at(13).word === 'next · small change run' && /is-ink-ring/.test(at(13).dot), `${where}: run 13 next · small change run on the ink ring (${at(13).word})`);
  },
  failed: (at, where) => {
    check(at(5).word === 'failed' && at(5).symbol === 'alert' && /is-red/.test(at(5).dot), `${where}: run 5 failed with the red "!"`);
    check(at(6).word === 'waits for run 5 (failed)', `${where}: run 6 waits for run 5 (failed) (${at(6).word})`);
    check(at(14).mark === null && !!at(14).word, `${where}: run 14 (its ticket canceled) keeps today's row, no mark (${at(14).word})`);
    for (const n of [15, 16]) check(at(n).mark === 'faint' && /is-grey-ring/.test(at(n).dot) && !!at(n).word, `${where}: run ${n} (cannot start) keeps today's text on the grey ring (${at(n).word})`);
  },
};
const SURFACES = { card: '.chat-rc-members', page: '#group-detail div.gpage-runs',
  // s5: the Runs list's expanded feature group, and the run page head.
  side: '.runs-members.srows', run: '.rd-sheet .run-status' };
/** s5: the dev state words a run page head detail must not restate beside the shared word (plan D8). */
const DEV_STATE = ['needs you', 'paused', 'waiting', 'working', 'failed', 'stopped', 'running'];
const devSegs = (detail) => String(detail || '').split(' · ').map((x) => x.trim()).filter((x) => DEV_STATE.includes(x.toLowerCase()) || /^starts /i.test(x));
/** s5: the feature group's row in the Runs list, and a click on its ⌄ when it is closed. */
const groupSel = (featureId) => `.runs-item[data-row-key=${JSON.stringify(`chain:${featureId}`)}]`;
const EXPAND = (featureId) => `(() => { const it = document.querySelector(${JSON.stringify(groupSel(featureId))}); if (!it) return false;
  const b = it.querySelector(':scope > .runs-row-tail .runs-expand[data-chain-key]'); if (!b) return false;
  if (b.getAttribute('aria-expanded') !== 'true') b.click(); return true; })()`;
/** s5: the 16 member rows of the expanded feature group: run, word (.runs-row-sub), data-mark, dot signature and box, its
 *  strips, the word colour, and whether the run number and the word are visible (not clipped). */
const SIDE_ROWS = (featureId) => `(() => {
  const SIG = ${SIG_SRC};
  const root = document.querySelector(${JSON.stringify(`${groupSel(featureId)} > .runs-members.srows`)});
  if (!root || !root.offsetParent) return null;
  const vw = document.documentElement.clientWidth;
  const rows = [...root.querySelectorAll(':scope > .runs-item[data-level="member"]')].map((it) => {
    const a = it.querySelector(':scope > a.runs-row'); const title = a.querySelector(':scope > .runs-row-title');
    const sub = a.querySelector(':scope > .runs-row-sub'); const dot = it.querySelector(':scope > .runs-pick > .status-dot');
    const run = Number.parseInt(title ? title.textContent : '', 10);
    const num = String(run); const tb = title.getBoundingClientRect();
    const rg = document.createRange(); const tn = [...title.childNodes].find((n) => n.nodeType === 3 && n.textContent.startsWith(num));
    let numSeen = false;
    if (tn) { rg.setStart(tn, 0); rg.setEnd(tn, num.length); const nb = rg.getBoundingClientRect(); numSeen = nb.width > 0 && nb.left >= 0 && nb.right <= Math.min(tb.right, vw) + 0.5; }
    const sb = sub ? sub.getBoundingClientRect() : null;
    const db = dot ? dot.getBoundingClientRect() : null; const ib = it.getBoundingClientRect();
    const stage = a.querySelector(':scope > .runs-stage');
    return { run, word: sub ? sub.textContent : null, mark: it.dataset.mark || null, dot: dot ? dot.className : '', symbol: dot ? dot.dataset.symbol || null : null, sig: SIG(dot),
      color: sub ? getComputedStyle(sub).color : null,
      centre: db ? { x: db.left + db.width / 2 - ib.left, y: db.top + db.height / 2 - (title ? tb.top + tb.height / 2 : ib.top) } : null,
      stage: stage ? [...stage.querySelectorAll('.run-prog-mark')].map((x) => x.textContent.trim()) : null,
      numSeen, subSeen: !!sb && (!sub.textContent || (sb.width > 0 && sb.left >= 0 && sb.right <= vw + 0.5 && sub.scrollWidth <= sub.clientWidth + 1)) };
  }).filter((r) => Number.isInteger(r.run));
  return { rows };
})()`;
/** s5: the run page head: its word, detail and dot signature. A live run waiting at a Shaper plan stop hides its whole
 *  status card while the question card is the page (D30, shape-it.css .rd-glance[data-shaper-wait] > .rd-sheet): its head
 *  is still painted, so it is read there and reported with `wait` (the shot is then the visible question card, #run-detail .rd-questions, which the page moves out of the glance). */
const RUN_HEAD = `(() => {
  const SIG = ${SIG_SRC};
  const all = [...document.querySelectorAll('.rd-sheet .run-status')];
  const shown = all.find((x) => x.offsetParent);
  const folded = all.find((x) => { const g = x.closest('.rd-glance[data-shaper-wait]'); return g && g.offsetParent; });
  const host = shown || folded;
  if (!host) return null;
  const wait = shown ? null : host.closest('.rd-glance').dataset.shaperWait;
  const word = host.querySelector('.run-status-word'); const detail = host.querySelector('.run-status-detail');
  const dot = host.querySelector('.run-status-head .status-dot');
  return { hash: location.hash, word: word ? word.textContent : null, detail: detail && !detail.hidden ? detail.textContent : '', sig: SIG(dot), dot: dot ? dot.className : '', wait };
})()`;
/** s5: the side list must say what the card says, for the same world, theme and run. */
function judgeSide(where, side, card) {
  if (!side) { check(false, `${where}: the feature group's member rows are on screen`); return; }
  const cat = (n) => card.rows.find((r) => r.run === n) || {};
  check(side.rows.length === 16, `${where}: 16 member rows (${side.rows.length})`);
  const diff = side.rows.filter((r) => r.word !== cat(r.run).word || r.sig !== cat(r.run).sig || r.mark !== cat(r.run).mark);
  check(diff.length === 0, `${where}: every member's word, dot and data-mark equal the card's (${JSON.stringify(diff.map((r) => [r.run, r.word, r.sig, r.mark, '≠', cat(r.run).word, cat(r.run).sig, cat(r.run).mark]))})`);
  const live = side.rows.filter((r) => r.mark === 'live');
  check(live.every((r) => r.word && !/^working$/i.test(r.word.trim())), `${where}: a live word is never working (${JSON.stringify(live.map((r) => [r.run, r.word]))})`);
  const staged = live.filter((r) => r.stage);
  check(live.length === 0 || (staged.length > 0 && staged.every((r) => JSON.stringify(r.stage) === JSON.stringify(['Plan', 'Build', 'Review', 'Ready']))),
    `${where}: a live member keeps its .runs-stage strips with the four run-prog-mark marks (${JSON.stringify(live.map((r) => [r.run, r.stage]))})`);
  for (const mk of ['ask', 'failed']) {
    const want = (card.rows.find((r) => r.mark === mk) || {}).color;
    for (const r of side.rows.filter((x) => x.mark === mk)) check(r.color === want, `${where}: run ${r.run}'s runs-row-sub "${r.word}" takes the card's ${mk} ink (${r.color} vs ${want})`);
  }
  // The dashed ring's centre against a plain dot's centre (a done row's green dot) in the same list.
  const plain = side.rows.find((r) => r.mark === 'done' && r.centre && !r.stage);
  for (const r of side.rows.filter((x) => x.mark === 'after' && x.centre)) {
    const dx = plain ? Math.abs(r.centre.x - plain.centre.x) : Infinity; const dy = plain ? Math.abs(r.centre.y - plain.centre.y) : Infinity;
    check(dx <= 1 && dy <= 1, `${where}: run ${r.run}'s dashed ring centre is within 1px of a plain dot's centre (dx ${dx.toFixed?.(2)}, dy ${dy.toFixed?.(2)})`);
  }
  results.rows.push({ where, side: side.rows });
}
/** What a list shows when it never got its 16 marked rows: the hash, its rows, marked rows and words. */
const SEEN = (rootSel) => `(() => { const lis = [...document.querySelectorAll(${JSON.stringify(`${rootSel} .run-member`)})];
  return { hash: location.hash, rows: lis.length, marked: lis.filter((li) => li.dataset.mark).length, words: lis.slice(0, 18).map((li) => li.querySelector('.run-member-state, .run-member-line')?.textContent) }; })()`;
// 16 run rows with their marks painted (a canceled run keeps today's row: no mark), then a moment to settle.
const ready = (rootSel) => `(() => { const lis = [...document.querySelectorAll(${JSON.stringify(`${rootSel} .run-member`)})].filter((li) => li.offsetParent && li.dataset.key !== 'planning');
  return lis.length === 16 && lis.filter((li) => li.dataset.mark).length >= 15; })()`;

/** s5: open the Runs list and expand the feature group; false when its member rows never show. */
async function openSide(routes, theme, where) {
  await go(routes.side, theme);
  // A narrow #runs reopens the last opened item (the feature page) over the list: its Back returns to the list.
  await sleep(400);
  await ev(`(() => { const b = [...document.querySelectorAll('.gpage-back')].find((x) => x.offsetParent); if (b) b.click(); return !!b; })()`);
  if (!await waitFor(EXPAND(routes.featureId), `${where}: the feature group row in the Runs list`)) return false;
  return waitFor(`(() => { const r = (${SIDE_ROWS(routes.featureId)}); return !!r && r.rows.length === 16 && r.rows.filter((x) => x.mark).length >= 15; })()`, `${where}: 16 marked member rows`);
}
/** s5: the run page heads this proof shoots, per world: started runs only (a run not started has no page, plan D11). */
const RUN_SHOTS = { busy: [2, 5, 6], held: [4] };
const cardOf = new Map();   // `${world}|${theme}` → the card's rows at 1280px

await cdp('Page.enable'); await cdp('Runtime.enable');
for (const name of WORLDS) {
  const routes = seed(name);
  { const r = await fetch(`${base}/api/shape/pipelines/${encodeURIComponent(routes.origin)}/card`); const c = r.ok ? await r.json() : null;
    check(!!c && c.smallRuns === true && !!c.feature, `${name}: the planning run's card is the marked one card (HTTP ${r.status}, smallRuns ${c && c.smallRuns}, slices ${c && c.feature ? c.feature.slices.length : 0})`); }
  for (const theme of THEMES) {
    await metrics(WIDE);
    for (const surface of ['card', 'page']) {
      const where = `${name} ${surface}, ${theme}, ${WIDE}px`;
      await go(routes[surface], theme);
      if (!await waitFor(ready(SURFACES[surface]), `${where}: 16 marked run rows`)) { log(`  seen: ${JSON.stringify(await ev(SEEN(SURFACES[surface])))}`); continue; }
      await skipWelcome(); await sleep(500);
      const m = await ev(ROWS(SURFACES[surface]));
      if (surface === 'card' && m) cardOf.set(`${name}|${theme}`, m);
      const at = judgeRows(where, m, WIDE);
      if (at) WANT[name](at, where, m.rows);
      await shotOf(surface === 'card' ? '.chat-rc' : SURFACES.page, `rows-${name}-${surface}-${theme}.png`);
    }
    const card = cardOf.get(`${name}|${theme}`);
    // s5 side: the Runs list member rows.
    { const where = `${name} side, ${theme}, ${WIDE}px`;
      if (!card) check(false, `${where}: the card's rows to compare with`);
      else if (await openSide(routes, theme, where)) {
        await skipWelcome(); await sleep(500);
        judgeSide(where, await ev(SIDE_ROWS(routes.featureId)), card);
        await shotOf(`${groupSel(routes.featureId)}`, `rows-${name}-side-${theme}.png`);
      } else log(`  seen: ${JSON.stringify(await ev(`(() => ({ hash: location.hash, groups: [...document.querySelectorAll('.runs-item[data-row-key^="chain:"]')].map((x) => x.dataset.rowKey) }))()`))}`);
    }
  }
  if (name === 'busy') {
    // s5: the Runs list at 360px in light, before any run page is opened (#runs would reopen it over the list).
    await metrics(SIDE_NARROW);
    const where = `busy side, light, ${SIDE_NARROW}px`;
    if (await openSide(routes, 'light', where)) {
      await skipWelcome(); await sleep(500);
      const side = await ev(SIDE_ROWS(routes.featureId));
      const hid = side ? side.rows.filter((r) => !r.numSeen || !r.subSeen) : [];
      check(!!side && side.rows.length === 16 && hid.length === 0, `${where}: each member's run number and runs-row-sub word stay visible (${JSON.stringify(hid.map((r) => [r.run, r.word, r.numSeen, r.subSeen]))})`);
      results.rows.push({ where, width: SIDE_NARROW, side: side && side.rows });
      await shotOf(`${groupSel(routes.featureId)}`, 'rows-busy-side-360-light.png');
    }
    await metrics(WIDE);
  }
  // s5 run: the run page head of each started run this world shoots, in both themes.
  for (const n of RUN_SHOTS[name] || []) {
    for (const theme of THEMES) {
      const where = `${name} run ${n} page head, ${theme}, ${WIDE}px`;
      const want = (cardOf.get(`${name}|${theme}`)?.rows || []).find((r) => r.run === n);
      if (!want) { check(false, `${where}: the card's row to compare with`); continue; }
      await metrics(WIDE);
      await go(routes.run(n), theme);
      // The head paints dev's word first and the shared one once the groups have loaded: wait for the card's word.
      const end = Date.now() + 20000; let h = null;
      while (Date.now() < end) { h = await ev(RUN_HEAD); if (h && h.word === want.word && h.sig === want.sig) break; await sleep(200); }
      await skipWelcome(); await sleep(400);
      h = await ev(RUN_HEAD);
      if (!h) {
        check(false, `${where}: the .rd-sheet .run-status head is on screen`);
        log(`  seen: ${JSON.stringify(await ev(`(() => ({ hash: location.hash, heads: [...document.querySelectorAll('.rd-sheet .run-status')].map((x) => [x.closest('[id]')?.id, !!x.offsetParent, x.textContent.slice(0, 60)]), views: [...document.querySelectorAll('.view:not(.hidden)')].map((x) => x.id) }))()`))}`);
        continue;
      }
      check(h.word === want.word && h.sig === want.sig, `${where}: the head's word and dot equal the card's (${h.word} ${h.sig} vs ${want.word} ${want.sig}, ${h.hash})`);
      check(!/^working$/i.test(String(h.word).trim()), `${where}: a live word is never working (${h.word})`);
      const dev = devSegs(h.detail);
      check(dev.length === 0, `${where}: the run-status-detail restates no dev state word (needs you, paused, waiting, working, failed, stopped, running, starts …): "${h.detail}"`);
      results.rows.push({ where, head: h, card: { word: want.word, sig: want.sig, mark: want.mark } });
      if (h.wait) log(`  run ${n}: the status card is folded under the Shaper ${h.wait} wait (D30); the head was read from the DOM and the shot is the question card the person sees`);
      await shotOf(h.wait ? '#run-detail .rd-questions' : SURFACES.run, `rows-${name}-run${n}-${theme}.png`, 'center');   // the page's sticky tabs cover a head scrolled to the top
    }
  }
  if (name === 'base') {
    // Runs 7 and 12 at 375px in light: their long waiting words stay on one line.
    await metrics(NARROW);
    for (const surface of ['card', 'page']) {
      const where = `base ${surface}, light, ${NARROW}px`;
      await go(routes[surface], 'light');
      if (!await waitFor(ready(SURFACES[surface]), `${where}: 16 marked run rows`)) continue;
      const m = await ev(ROWS(SURFACES[surface]));
      const rows = m ? m.rows.filter((r) => r.run === 7 || r.run === 12) : [];
      results.rows.push({ where, width: NARROW, ink: m && m.ink, rows });
      check(rows.length === 2 && rows.every((r) => Math.abs(r.height - 32) <= 0.5 && !r.wrap && !r.second), `${where}: runs 7 and 12 stay one 32px line (${JSON.stringify(rows.map((r) => [r.run, r.word, r.height, r.wrap]))})`);
    }
  }
}
// ---- s6 stops: the Chat card's open stop list (busy), a refused Resume, Approve on run 4, and the list after run 4.
const STOPS_ROOT = '.chat-rc ol.chat-rc-stops';
const BUSY_STOP_LINES = ['Run 2 · plan approval · holds up 7, 8, 12, 15, 16', 'Run 4 · plan approval · holds up 5, 6, 7, 12, 16',
  'Run 5 failed · holds up 6, 7, 12, 16', 'Run 11 · plan approval · holds up 13, 14, 15, 16'];
const REFUSED = 'Slice 6 is still going';
/** Every visible stop line: run, text, dot class and symbol, height, its .qpanel (visible, data-qrun), its Resume. */
const STOP_LINES = `(() => {
  const root = [...document.querySelectorAll(${JSON.stringify(STOPS_ROOT)})].find((r) => r.offsetParent);
  if (!root) return null;
  const card = root.closest('.chat-rc');
  const lines = [...root.querySelectorAll('li.chat-rc-stop')].map((li) => {
    const dot = li.querySelector('.chat-rc-stop-line .status-dot'); const q = li.querySelector('.chat-rc-stop-q .qpanel');
    const b = li.querySelector('.chat-rc-stop-resume'); const err = li.querySelector('.chat-rc-stop-err');
    return { run: Number(li.dataset.run), text: li.querySelector('.chat-rc-stop-text')?.textContent || '', dot: dot ? dot.className : '',
      symbol: dot ? dot.dataset.symbol || null : null, height: Math.round(li.getBoundingClientRect().height * 10) / 10,
      qpanel: q ? { visible: !!q.offsetParent && !q.classList.contains('hidden'), qrun: q.dataset.qrun || null } : null,
      resume: b ? { label: b.getAttribute('aria-label'), visible: !!b.offsetParent, disabled: b.disabled } : null,
      err: err && !err.hidden ? err.textContent : '' };
  });
  return { lines, footerResume: !!card.querySelector('.chat-rc-factions [data-act="feature-resume"]') };
})()`;
/** Records each /answer request's body in the page, so the proof reads which run an Approve names. */
const TAP_ANSWERS = `(() => { if (window.__answers) return 0; window.__answers = []; const f = window.fetch;
  window.fetch = (u, o) => { try { if (/[/]answer$/.test(String(u).split('?')[0])) window.__answers.push({ url: String(u), body: o && o.body ? JSON.parse(o.body) : null }); } catch {} return f(u, o); }; return 0; })()`;
async function stopsShot(routes, theme, file, want) {
  await metrics(WIDE);
  await go(routes.card, theme);
  const where = `stops ${file}`;
  if (!await waitFor(`(() => { const m = (${STOP_LINES}); return !!m && m.lines.length === ${want.length}; })()`, `${where}: ${want.length} stop lines`)) {
    log(`  seen: ${JSON.stringify(await ev(STOP_LINES))}`); return null;
  }
  await skipWelcome(); await sleep(500);
  const m = await ev(STOP_LINES);
  check(JSON.stringify(m.lines.map((l) => l.text)) === JSON.stringify(want), `${where}: the lines in run order read ${JSON.stringify(want)} (${JSON.stringify(m.lines.map((l) => l.text))})`);
  check(!m.footerResume, `${where}: the footer has no second Resume (feature-resume)`);
  for (const l of m.lines.filter((x) => x.symbol !== 'alert')) {
    const runId = `run-${routes.pipelineOf(l.run)}`;
    check(!!l.qpanel && l.qpanel.visible && l.qpanel.qrun === runId, `${where}: run ${l.run}'s line holds a mounted, visible .qpanel with data-qrun ${runId} (${JSON.stringify(l.qpanel)})`);
  }
  results.rows.push({ where, theme, stops: m.lines });
  return m;
}
if ((!process.env.WORLD && !process.env.SURFACE) || process.env.SURFACE === 'stops') {
  for (const theme of THEMES) {
    const routes = seed('busy');
    const m = await stopsShot(routes, theme, `stops-busy-card-${theme}.png`, BUSY_STOP_LINES);
    if (m) {
      const five = m.lines.find((l) => l.run === 5) || {};
      check(/\bis-red\b/.test(five.dot) && five.symbol === 'alert' && !!five.resume && five.resume.visible && five.resume.label === 'Resume run 5',
        `stops busy ${theme}: run 5's dot is red with the "!" and its Resume is visible (${five.dot}, ${JSON.stringify(five.resume)})`);
      check(m.lines.filter((l) => l.resume).length === 1, `stops busy ${theme}: one Resume in the list`);
      await shotOf(STOPS_ROOT, `stops-busy-card-${theme}.png`);
      // Run 5's Resume is refused: run 6 is going. The refusal shows on its line and Resume comes back.
      await ev(`document.querySelector(${JSON.stringify(`${STOPS_ROOT} li[data-run="5"] .chat-rc-stop-resume`)}).click();0`);
      if (await waitFor(`(() => { const m = (${STOP_LINES}); const l = m && m.lines.find((x) => x.run === 5); return !!l && l.err.includes(${JSON.stringify(REFUSED)}) && !l.resume.disabled; })()`, `stops refused ${theme}: run 5's line shows "${REFUSED}…" with Resume enabled`)) {
        const l = (await ev(STOP_LINES)).lines.find((x) => x.run === 5);
        check(true, `stops refused ${theme}: "${l.err}"`);
        results.rows.push({ where: `stops refused ${theme}`, line: l });
        await shotOf(STOPS_ROOT, `stops-refused-${theme}.png`);
      }
      // Approve on run 4's real mounted step card: the request must name run 4 (a refusal from the mock is fine).
      await ev(TAP_ANSWERS);
      // A check stop's "Approve as is" is an option (Worca's pick is Re-plan); the foot's submit then reads "Approve as is".
      const LI4 = JSON.stringify(`${STOPS_ROOT} li[data-run="4"]`);
      await ev(`(() => { const o = [...document.querySelector(${LI4}).querySelectorAll('.qpanel .qopt')].find((x) => x.offsetParent && /^Approve/.test(x.textContent.trim()));
        if (o) o.click(); return !!o; })()`);
      await sleep(300);
      const clicked = await ev(`(() => { const li = document.querySelector(${LI4});
        const b = li && [...li.querySelectorAll('.qpanel .qpanel-foot button')].find((x) => x.offsetParent && !x.disabled && /^Approve/.test(x.textContent.trim()));
        if (!b) return null; const t = b.textContent.trim(); b.click(); return t; })()`);
      check(!!clicked, `stops approve ${theme}: run 4's step card has an Approve button (${clicked})`);
      const want4 = `run-${routes.pipelineOf(4)}`;
      if (clicked && await waitFor('(window.__answers || []).length > 0', `stops approve ${theme}: an /answer request`)) {
        const sent = await ev('window.__answers');
        results.rows.push({ where: `stops approve ${theme}`, answers: sent });
        check(sent.length >= 1 && sent.every((a) => a.body && a.body.runId === want4), `stops approve ${theme}: the Approve posts run 4's run id ${want4} (pipeline ${routes.pipelineOf(4)}) (${JSON.stringify(sent.map((a) => a.body && a.body.runId))})`);
      }
    }
    // Run 4 answered and building: three lines remain, runs 2, 5 and 11.
    const after = seed('stops-after');
    const a = await stopsShot(after, theme, `stops-after-${theme}.png`, [BUSY_STOP_LINES[0], BUSY_STOP_LINES[2], BUSY_STOP_LINES[3]]);
    if (a) {
      check(JSON.stringify(a.lines.map((l) => l.run)) === '[2,5,11]', `stops after ${theme}: runs 2, 5 and 11 (${JSON.stringify(a.lines.map((l) => l.run))})`);
      await shotOf(STOPS_ROOT, `stops-after-${theme}.png`);
    }
  }
}

// ---- s7 line: the feature's state line and need count, on the Chat card head and status, and on the feature page head.
const LINE_WORLDS = {
  busy: { line: 'Run 6 reviewing · next: run 9', done: '2 of 16 runs done', chip: '4 need you' },
  next: { line: 'next: run 9', done: '2 of 16 runs done', chip: '4 need you' },
  two: { line: 'Run 8 building, run 10 building · next: run 13', done: '6 of 16 runs done', chip: '' },
  acts: { line: 'Nothing can go on until you act', done: '1 of 16 runs done', chip: '1 needs you' },
};
const CHIP_PX = 18;   // the design system's one chip
/** Each surface's head and status: the state line, the [data-need] chips, the count of "need you" in head and status,
 *  the chip height, and the detail's line count (its height over its computed lineHeight). */
const LINE_SURFACES = {
  card: { root: '.chat-rc', head: '.ask-rc-head', status: '.chat-rc-status', detail: '.chat-rc-status .run-status-detail' },
  page: { root: '#group-detail .gpage', head: '.gpage-head', status: '.gpage-card .run-status', detail: '.gpage-card .run-status-detail' },
};
const LINE_READ = (sf) => `(() => {
  const root = [...document.querySelectorAll(${JSON.stringify(sf.root)})].find((x) => x.offsetParent);
  if (!root) return null;
  const head = root.querySelector(${JSON.stringify(sf.head)}); const status = root.querySelector(${JSON.stringify(sf.status)});
  const detail = root.querySelector(${JSON.stringify(sf.detail)});
  const chips = head ? [...head.querySelectorAll('[data-need]')] : [];
  const lh = detail ? parseFloat(getComputedStyle(detail).lineHeight) || 0 : 0;
  const text = (head ? head.textContent : '') + ' ' + (status ? status.textContent : '');
  return { detail: detail ? detail.textContent : null, chips: chips.map((c) => c.textContent), needs: (text.match(/need(s)? you/g) || []).length,
    chipHeight: chips[0] ? Math.round(chips[0].getBoundingClientRect().height * 10) / 10 : null,
    lineHeight: lh, lines: detail && lh ? Math.round(detail.getBoundingClientRect().height / lh) : null,
    detailWidth: detail ? Math.round(detail.getBoundingClientRect().width) : null };
})()`;
/** A 2x shot of the union of the visible boxes of `sels` (the head and its status block). */
async function shotUnion(rootSel, sels, file) {
  await ev("document.querySelector('.toast[data-key=\"role-defaults\"] .toast-x')?.click();0");
  await sleep(300);
  // The chat column scrolls itself after a paint: scroll, let it settle, then measure again right before the capture.
  const measure = (scroll) => ev(`(() => { const root = [...document.querySelectorAll(${JSON.stringify(rootSel)})].find((x) => x.offsetParent); if (!root) return null;
    const els = ${JSON.stringify(sels)}.map((s) => root.querySelector(s)).filter((x) => x && x.offsetParent); if (!els.length) return null;
    if (${scroll}) {
      // Freeze the scrolling ancestors' own scroll calls (the chat sticks to its end on each repaint), then centre the head.
      for (let a = els[0].parentElement; a; a = a.parentElement) {
        if (a.scrollHeight <= a.clientHeight || a.__frozen) continue;
        const d = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
        Object.defineProperty(a, 'scrollTop', { configurable: true, get() { return d.get.call(this); }, set() {} });
        a.scrollTo = () => {}; a.scrollBy = () => {}; a.__frozen = true;
      }
      els[0].scrollIntoView({ block: 'center' });
    }
    const bs = els.map((e) => e.getBoundingClientRect());
    const x = Math.min(...bs.map((b) => b.left)), y = Math.min(...bs.map((b) => b.top));
    return { x, y, width: Math.max(...bs.map((b) => b.right)) - x, height: Math.min(Math.max(...bs.map((b) => b.bottom)), innerHeight) - y }; })()`);
  await measure(true);
  await sleep(600);
  const box = await measure(false);
  if (!box || box.height < MIN_SHOT_PX) { check(false, `${file}: ${sels.join(' + ')} on screen`); return; }
  const { data } = await cdp('Page.captureScreenshot', { format: 'png',
    clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: box.width + 16, height: box.height + 16, scale: 1 } });
  const out = path.join(SHOTS, file);
  await writeFile(out, Buffer.from(data, 'base64'));
  results.shots.push(out);
}
if ((!process.env.WORLD && !process.env.SURFACE) || process.env.SURFACE === 'line') {
  for (const [name, want] of Object.entries(LINE_WORLDS)) {
    const routes = seed(`line-${name}`);
    for (const theme of THEMES) {
      await metrics(WIDE);
      for (const surface of ['card', 'page']) {
        const sf = LINE_SURFACES[surface];
        const where = `line ${name} ${surface}, ${theme}, ${WIDE}px`;
        const line = surface === 'card' ? `${want.line} · ${want.done}` : want.line;
        await go(routes[surface], theme);
        // The line follows the live snapshots and the feature fetch: wait for its exact text.
        if (!await waitFor(`(() => { const m = (${LINE_READ(sf)}); return !!m && m.detail === ${JSON.stringify(line)}; })()`, `${where}: the line reads "${line}"`)) {
          log(`  seen: ${JSON.stringify(await ev(LINE_READ(sf)))}`); continue;
        }
        await skipWelcome(); await sleep(500);
        const m = await ev(LINE_READ(sf));
        results.rows.push({ where, line: m });
        check(m.detail === line, `${where}: the line reads "${line}" (${m.detail})`);
        if (want.chip) {
          check(JSON.stringify(m.chips) === JSON.stringify([want.chip]) && m.needs === 1, `${where}: the head shows "${want.chip}" once, need you said once (${JSON.stringify(m.chips)}, ${m.needs})`);
          check(Math.abs(m.chipHeight - CHIP_PX) <= 0.5, `${where}: the chip is ${CHIP_PX}px tall (${m.chipHeight})`);
        } else check(m.chips.length === 0 && m.needs === 0, `${where}: no need chip at zero stop lines (${JSON.stringify(m.chips)})`);
        if (surface === 'card') {
          const ok = m.lines === 1;
          if (name === 'busy') check(ok, `${where}: the card detail is 1 line at the card's normal width (${m.lines} lines of ${m.lineHeight}px line-height, ${m.detailWidth}px wide)`);
          else if (!ok) log(`  note ${where}: the card detail takes ${m.lines} lines at ${m.detailWidth}px`);
        }
        await shotUnion(sf.root, [sf.head, sf.status], `line-${name}-${surface}-${theme}.png`);
      }
    }
  }
}

results.errors = errors;
check(errors.length === 0, `no page errors${errors.length ? ` — ${errors.slice(0, 3).join(' | ')}` : ''}`);
results.minutes = Math.round((Date.now() - T0) / 600) / 100;
results.failed = failed;
const logFile = path.join(SHOTS, 'rows-measure.json');
await writeFile(logFile, JSON.stringify(results, null, 2) + '\n');
log(`${results.shots.length} PNGs and ${logFile} in ${results.minutes} min; ${failed ? `${failed} FAILED` : 'all passed'}`);
if (failed) process.exitCode = 1;
await shutdown(failed ? 1 : 0);
