#!/usr/bin/env node
// tools/verify-run-status-rows-cdp.mjs — headless-Chrome proof of Shaper small runs slice 4: the Chat card's run rows and
// the feature page's Runs tab take each run's word and mark from the shared run status (runStatus → markDot). Seeded data
// only, on the mock engine: the real 16-run feature (test/helpers/shape-sixteen-runs.mjs) in four worlds, its live runs
// put into the server's runs map the way tools/verify-run-stops-cdp.mjs does.
//   base    run 2 at a stop, run 3 building: run 7 `waits for run 2 (needs you), 6`, run 12 `waits for run 7, 10`, run 9 `next`.
//   held    run 4's stop answer held behind run 3: `after run 3` on the dashed ring, and no row reads `next`.
//   change  base with run 13 a change run: `next · small change run` on the ink ring.
//   failed  run 5 failed: the red "!", run 6 `waits for run 5 (failed)`, runs 15 and 16 (cannot start) today's text.
// For each world and theme, at 1280px and deviceScaleFactor 2, it shoots the Chat card and the feature page Runs tab:
// 16 PNGs `rows-{world}-{card|page}-{theme}.png`. A JSON log records every row (word, data-mark, dot class, height, wrap,
// word colour). It also checks base-world runs 7 and 12 at 375px in light. The script exits non-zero on any failed
// check: a row that is not one 32px line, a word that wraps, a pulse on a row whose mark is not live, a live word that
// reads working, an open stop or failed word not in its ink token. A canceled run keeps today's row (no mark).
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
const WORLDS = ['base', 'held', 'change', 'failed'].filter((w) => !process.env.WORLD || w === process.env.WORLD);   // WORLD=held runs one world
const WIDE = 1280;
const NARROW = 375;
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
const { recordShapePlan } = await imp('../src/core/shape/features.mjs');
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
  const at = how.stop ? 'n_refine' : 'n_impl';
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
  held: { spec: { done: [1], states: { 2: { stop: 'requirement' }, 3: { pipe: 'running' }, 4: { stop: 'check', held: true, after: 3 } } } },
  change: { spec: SIXTEEN_RUN_STATES.base, then: (fx) => fx.setKind(13, 'change') },
  failed: { spec: { done: [1, 3, 4], states: { 2: { stop: 'requirement' }, 11: { stop: 'check' }, 5: { pipe: 'error' } } }, then: (fx) => fx.cancelTicket(14) },
};
/** Seeds one world (cancelling the previous world's tickets and live runs) and its Chat thread; returns the routes. */
function seed(name) {
  for (const id of liveIds.splice(0)) runs.delete(id);
  const { spec, then } = SPECS[name];
  const fx = world(proj, spec);
  if (then) then(fx);
  for (const [r, how] of Object.entries(spec.states || {})) if (how.stop || (how.pipe || 'running') === 'running') liveRun(fx.featureId, Number(r), fx.pipelineOf(Number(r)), how);
  const thread = askStore.createThread({ title: `Rows ${name}` });
  const cardId = askStore.newAskId('card');
  askStore.appendMessage(thread.id, { role: 'user', text: 'Plan the merge gate in small runs' });
  askStore.appendMessage(thread.id, { role: 'assistant', status: 'done', text: 'Here is the feature:',
    blocks: [{ kind: 'card', id: cardId, state: 'tracked', card: { type: 'progress', pipelineId: fx.originPipelineId, runId: `run-${fx.originPipelineId}`, projectKey: key, title: 'CI as a trusted merge gate', status: 'done' } }] });
  askStore.linkRun(thread.id, { runId: `run-${fx.originPipelineId}`, cardId, pipelineId: fx.originPipelineId, status: 'done' });
  recordShapePlan({ threadId: thread.id, cardId, title: 'CI as a trusted merge gate' });
  return { card: `#chat/${thread.id}`, page: `#feature/${fx.featureId}`, origin: fx.originPipelineId };
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
async function shotOf(sel, file) {
  await ev("document.querySelector('.toast[data-key=\"role-defaults\"] .toast-x')?.click();0");
  await sleep(300);
  const box = await ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.offsetParent); if (!el) return null;
    el.scrollIntoView({ block: 'start' }); const b = el.getBoundingClientRect();
    return { x: b.left, y: b.top, width: b.width, height: Math.min(b.height, innerHeight - b.top) }; })()`);
  if (!box) { check(false, `${file}: ${sel} is on screen`); return; }
  await sleep(200);
  const { data } = await cdp('Page.captureScreenshot', { format: 'png',
    clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: box.width + 16, height: box.height + 16, scale: 1 } });
  const out = path.join(SHOTS, file);
  await writeFile(out, Buffer.from(data, 'base64'));
  results.shots.push(out);
}

/** Every numbered run row of the list under `rootSel`: run, word, data-mark, dot class and symbol, height, whether the
 *  word wraps, the word colour, and the ink tokens resolved in this theme (rgb). */
const ROWS = (rootSel) => `(() => {
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
      color: st ? getComputedStyle(st).color : null, second: !!li.querySelector('.run-member-line') };
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
const SURFACES = { card: '.chat-rc-members', page: '#group-detail div.gpage-runs' };
/** What a list shows when it never got its 16 marked rows: the hash, its rows, marked rows and words. */
const SEEN = (rootSel) => `(() => { const lis = [...document.querySelectorAll(${JSON.stringify(`${rootSel} .run-member`)})];
  return { hash: location.hash, rows: lis.length, marked: lis.filter((li) => li.dataset.mark).length, words: lis.slice(0, 18).map((li) => li.querySelector('.run-member-state, .run-member-line')?.textContent) }; })()`;
// 16 run rows with their marks painted (a canceled run keeps today's row: no mark), then a moment to settle.
const ready = (rootSel) => `(() => { const lis = [...document.querySelectorAll(${JSON.stringify(`${rootSel} .run-member`)})].filter((li) => li.offsetParent && li.dataset.key !== 'planning');
  return lis.length === 16 && lis.filter((li) => li.dataset.mark).length >= 15; })()`;

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
      const at = judgeRows(where, m, WIDE);
      if (at) WANT[name](at, where, m.rows);
      await shotOf(surface === 'card' ? '.chat-rc' : SURFACES.page, `rows-${name}-${surface}-${theme}.png`);
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
results.errors = errors;
check(errors.length === 0, `no page errors${errors.length ? ` — ${errors.slice(0, 3).join(' | ')}` : ''}`);
results.minutes = Math.round((Date.now() - T0) / 600) / 100;
results.failed = failed;
const logFile = path.join(SHOTS, 'rows-measure.json');
await writeFile(logFile, JSON.stringify(results, null, 2) + '\n');
log(`${results.shots.length} PNGs and ${logFile} in ${results.minutes} min; ${failed ? `${failed} FAILED` : 'all passed'}`);
if (failed) process.exitCode = 1;
await shutdown(failed ? 1 : 0);
