#!/usr/bin/env node
// tools/verify-req-change-cdp.mjs — headless-Chrome proof of Shaper small runs C4 (Changes mid-build): marked 4-run
// features, seeded data only on the mock engine, the changes applied through the server's one change path
// (`reqChanges.apply`). At 375px in light and dark it captures the Chat feature card for a requirement stop with a
// proposal (`app-req-change-stop`), the notice for a not-started, a running and a finished owner, the chat card
// (`req-change`), and the run page and the side panel once each: 7 app PNGs per theme, plus the prototype's
// `#req-change` and `#spec-changed`, and a JSON log. It checks the exact strings, one `this change` mark per fold, every
// fold row at least 32px with its mark on its first text line and all marks on one x-centre, no clipped id, no
// overflow, no question or primary on the running card, and no notice, fold or card button on the run page and panel.
// Two deliberate differences from the prototype (owner decision d3140f52a): the fold is a `.srows` list with a left
// mark column instead of a `this change` chip, and the Finished row says `the finished run` instead of `run 7`. A
// non-owner asker re-plans at once instead of waiting for the change run (plan, Out of scope).
// NOT part of `npm test`: it needs Chrome. A hard 30-minute cap inside: past it the script exits non-zero.
// Run: H=$(mktemp -d); env -u FORCE_COLOR HOME=$H VERIFY_PORT=4943 SHOTS_DIR=… node --disable-warning=ExperimentalWarning tools/verify-req-change-cdp.mjs
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
const results = { startedAt: new Date(T0).toISOString(), width: WIDTH, verdict: null, lists: [], shots: [], checks: [],
  notes: ['The fold is a .srows list with a left mark column, not the prototype\'s "this change" chip (owner decision d3140f52a).',
    'The Finished row says "the finished run", not the prototype\'s "run 7": no run number repeats on a card.',
    'A non-owner asker re-plans at once; the prototype\'s "run 5 waits for it" is a follow-up (plan, Out of scope).'] };
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
home = await mkdtemp(path.join(tmpdir(), 'worca-c4-home-'));
process.env.HOME = home; process.env.USERPROFILE = home;
process.env.WORCA_HOME = path.join(home, '.worca-cc');
process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
process.env.WORCA_MOCK = '1';
process.env.WORCA_FLAGS = 'shaperSmallRuns';
const SHOTS = process.env.SHOTS_DIR || await mkdtemp(path.join(tmpdir(), 'worca-c4-shots-'));
await mkdir(SHOTS, { recursive: true });
const logFile = path.join(SHOTS, 'c4-req-change-measure.json');
// The verdict line is written first: a run cut short still leaves a log that says so.
await writeFile(logFile, JSON.stringify({ ...results, verdict: 'incomplete' }, null, 2) + '\n');
proj = await mkdtemp(path.join(tmpdir(), 'worca-c4-proj-'));
for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'proof@worca.local'], ['config', 'user.name', 'proof']]) execFileSync('git', a, { cwd: proj });
await writeFile(path.join(proj, 'README.md'), '# requirement change proof\n');
execFileSync('git', ['add', '-A'], { cwd: proj });
execFileSync('git', ['commit', '-qm', 'init'], { cwd: proj });
const imp = (rel) => import(new URL(rel, import.meta.url).href);
const { server, runs, reqChanges } = await imp('../ui/server.mjs');
const { getDb } = await imp('../src/core/db.mjs');
const { projectKey } = await imp('../src/core/store.mjs');
const { writeStoreMeta } = await imp('../src/core/artifacts.mjs');
const { createSliceFeature, recordShapePlan } = await imp('../src/core/shape/features.mjs');
const askStore = await imp('../src/core/ask/store.mjs');
const { normalizeOutline } = await imp('../src/shared/shape/slices.mjs');
const { planStop } = await imp('../src/shared/shape/run-stops.mjs');
srv = server;
await new Promise((r, rej) => { srv.once('error', (err) => rej(new Error(`cannot listen on VERIFY_PORT ${process.env.VERIFY_PORT}: ${err.message}`))); srv.listen(Number(process.env.VERIFY_PORT || 0), '127.0.0.1', r); });
const base = `http://127.0.0.1:${srv.address().port}`;
const post = (url, body) => fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) });
{ const r = await post('/api/settings', { uiLevel: 'expert' }); if (!r.ok) throw new Error(`could not pin the interface mode: HTTP ${r.status}`); }

// ---- the features: 4 runs each, one agreed requirement per run. Care: Balanced.
const key = projectKey(proj);
writeStoreMeta(key, 'project', { key, name: 'Proof', path: proj });
const now = new Date().toISOString();
const pipeline = (id, status, title, stats = null) => getDb().prepare(`INSERT INTO pipelines (id, project_key, target, title, status, phase,
  cycle, started_at, updated_at, total_cost_usd, total_active_ms, branch, shape_stats) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run(id, key, 'project', title, status, status, 0, now, now, 0, 0, JSON.stringify({ source: 'main', feature: `feat/${id}` }), stats ? JSON.stringify(stats) : null);
const TITLES = ['Send a reset email from the sign-in page', 'Retry a reset email the provider refused',
  'Expire a reset link after one use or an hour', 'Show the reset status on the account page'];
const AGREED = TITLES.map((t, i) => ({ id: `R-po-${i + 1}`, text: t }));
const NEW = 'reset emails retry once, within 20 seconds';
const outline = normalizeOutline({ why: 'proof', leftOut: [], slices: TITLES.map((title, i) => ({ id: `s${i + 1}`, title, goal: `Goal ${i + 1}`, inScope: [],
  outOfScope: [], acceptance: [`ok ${i + 1}`], dependsOn: [], estimate: 'medium', requirements: [`R-po-${i + 1}`] })) },
{ agreed: AGREED }).outline;
const care = { position: 'balanced', chosenBy: 'person', worcaPick: 'balanced' };
const { EventEmitter } = await import('node:events');
function liveRun(f, idx, pid, pendingQuestion = null) {
  const orch = new EventEmitter();
  orch.state = { id: pid, status: 'running', title: `Run ${idx} · ${TITLES[idx - 1]}`, projectDir: proj,
    steps: [{ key: 'x:n_impl:1', executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, cycle: 1, status: pendingQuestion ? 'done' : 'start', startedAt: now, activeMs: 1000, costUsd: 0 }],
    active: pendingQuestion ? [] : [{ nodeId: 'n_impl', executionId: 'x:n_impl:1' }], tokens: {}, wireDeliveries: {}, warnings: [], endReached: false,
    shaping: { approved: { file: 'plan.md' } } };
  orch.getState = () => orch.state;
  orch.runShape = { slice: { feature: f.id, index: idx } };
  orch.answer = () => true;
  for (const m of ['pause', 'stop']) orch[m] = () => true;
  const id = `run-${pid}`;
  runs.set(id, { id, kind: 'run', pipelineId: pid, status: 'running', events: [], pendingQuestion, projectDir: proj, startedAt: Date.now(), orch,
    title: orch.state.title, tags: [] });
  return id;
}
/** A marked 4-run feature (`states[k-1]`: done, running or planned) with its Chat thread. → {f, pid(k), threadId} */
function seedFeature(tag, title, states) {
  const pid = (k) => `c4${tag}0000${k}`;
  pipeline(pid(1), states[0], title, { smallRuns: true, care: { ...care, reason: 'Worca picks Balanced', facts: { touches: [], requirements: 4, subsystems: [], screens: false, size: null }, at: now } });
  const f = createSliceFeature({ pipelineId: pid(1), projectDir: proj, title, outline, perspectives: ['product', 'architect'], workflowId: 'wf_shape', smallRuns: true, care });
  states.forEach((st, i) => {
    const k = i + 1;
    if (k > 1 && st !== 'planned') {
      pipeline(pid(k), st, `Run ${k} · ${TITLES[i]}`);
      const t = getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = ?').get(f.id, k).ticket_id;
      getDb().prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = ? WHERE id = ?").run(pid(k), t);
      getDb().prepare('UPDATE shape_feature_slices SET pipeline_id = ? WHERE feature_id = ? AND idx = ?').run(pid(k), f.id, k);
    }
  });
  const thread = askStore.createThread({ title });
  const cardId = askStore.newAskId('card');
  askStore.appendMessage(thread.id, { role: 'user', text: `Plan ${title.toLowerCase()} in small runs` });
  askStore.appendMessage(thread.id, { role: 'assistant', status: 'done', text: 'Here is the feature:',
    blocks: [{ kind: 'card', id: cardId, state: 'tracked', card: { type: 'progress', pipelineId: pid(1), runId: `run-${pid(1)}`, projectKey: key, title, status: 'done' } }] });
  askStore.linkRun(thread.id, { runId: `run-${pid(1)}`, cardId, pipelineId: pid(1), status: 'done' });
  recordShapePlan({ threadId: thread.id, cardId, title });
  return { f, pid, threadId: thread.id };
}

// The stop: run 4 asks to change R-po-2, which finished run 2 owns.
const A = seedFeature('a', 'Reset emails', ['done', 'done', 'planned', 'running']);
const STOP = planStop({ run: 4, concern: { title: 'one send is not enough', kind: 'requirement', requirements: ['R-po-2'],
  proposals: [{ id: 'R-po-2', from: AGREED[1].text, text: NEW, landsAs: 'finished' }] } });
const PQ = { id: 'plan-n_refine-1', kind: 'plan', nodeId: 'n_refine', executionId: 'x:n_refine:1',
  plan: { nodeId: 'n_refine', port: 'plan', file: 'plan.md', round: 1, revisable: true, perspectives: ['product', 'architect'], smallRuns: true },
  concern: { title: 'one send is not enough', kind: 'requirement', requirements: ['R-po-2'] }, stop: STOP };
const STOP_RUN = liveRun(A.f, 4, A.pid(4), PQ);
// Not started (R-po-3, run 3 planned), running (R-po-2, run 2 live: the change stops it), finished (R-po-2, run 2 done).
const B = seedFeature('b', 'Reset links', ['done', 'running', 'planned', 'planned']);
liveRun(B.f, 2, B.pid(2));
const C = seedFeature('c', 'Reset retries', ['done', 'running', 'planned', 'planned']);
liveRun(C.f, 2, C.pid(2));
const D = seedFeature('d', 'Reset status', ['done', 'done', 'planned', 'planned']);
const apply = (x, id) => reqChanges.apply(x.f.id, [{ id, from: AGREED[Number(id.slice(-1)) - 1].text, to: NEW }], { kind: 'chat', by: 'proof' });
for (const [x, id, want] of [[B, 'R-po-3', 'not-started'], [C, 'R-po-2', 'running'], [D, 'R-po-2', 'finished']]) {
  const r = apply(x, id);
  check(r.ok && r.result.changes[0].case === want, `seed: ${id} lands as ${want} (${JSON.stringify(r)})`);
}
// The proof runs no scheduler: fire C's restart ticket the way the next tick does, so run 2 builds again from the new text.
{
  const t = getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = 2').get(C.f.id).ticket_id;
  const again = 'c4c00012';
  pipeline(again, 'running', `Run 2 · ${TITLES[1]}`);
  getDb().prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = ? WHERE id = ?").run(again, t);
  liveRun(C.f, 2, again);
}
// The chat card, proposed, on feature B's run 4.
const chatThread = askStore.createThread({ title: 'Reset links' });
askStore.appendMessage(chatThread.id, { role: 'user', text: 'R-po-4 should say the status shows within a minute' });
askStore.appendMessage(chatThread.id, { role: 'assistant', status: 'done', text: 'Here is the change:',
  blocks: [{ kind: 'card', id: askStore.newAskId('card'), state: 'proposed', card: { type: 'req-change', featureId: B.f.id, featureTitle: 'Reset links',
    requirement: 'R-po-4', from: AGREED[3].text, to: 'the account page shows the reset status within a minute', reason: 'people refresh too early',
    landsAs: 'not-started' } }] });
log(`server ${base} · features ${[A, B, C, D].map((x) => x.f.id).join(', ')}`);

// ---- chrome + cdp
profile = await mkdtemp(path.join(tmpdir(), 'worca-c4-profile-'));
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
  const file = path.join(SHOTS, `c4-${name}.png`);
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

/** The in-page measurement of one fold: rows, mark and first-text-line centres, clipped ids, overflow. */
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
  const rows = [...root.querySelectorAll(${JSON.stringify(rowSel)})].filter((r) => r.offsetParent).map((row) => {
    const mark = row.querySelector(${JSON.stringify(markSel)});
    const text = row.querySelector(${JSON.stringify(textSel)});
    const id = row.querySelector('.plan-check-id');
    const rb = row.getBoundingClientRect();
    const mb = mark ? mark.getBoundingClientRect() : null; const tb = text ? firstLine(text) : null;
    return { id: id ? id.textContent : null, text: (text && text.textContent || '').trim(), aria: mark ? mark.getAttribute('aria-label') : null,
      height: Math.round(rb.height * 10) / 10, idClipped: !!id && id.scrollWidth > id.clientWidth,
      markX: mb ? mb.left + mb.width / 2 : null, markY: mb ? mb.top + mb.height / 2 : null, textY: tb ? tb.top + tb.height / 2 : null };
  });
  const xs = rows.map((r) => r.markX).filter((x) => x != null);
  return { found: true, rows, line: (root.querySelector('.plan-fold-text') || {}).textContent || null,
    spreadX: xs.length ? Math.max(...xs) - Math.min(...xs) : 0,
    maxDy: Math.max(0, ...rows.filter((r) => r.markY != null && r.textY != null).map((r) => Math.abs(r.markY - r.textY))),
    overflow: root.scrollWidth > root.clientWidth || document.documentElement.scrollWidth > document.documentElement.clientWidth,
    wide: [root, ...root.querySelectorAll('*')].filter((e) => e.clientWidth > 0 && e.scrollWidth > e.clientWidth).map((e) => [e.className, e.scrollWidth, e.clientWidth]) };
})()`;
const FOLD = (scope) => [`${scope} .req-change-rule`, '.plan-check-row', '.plan-check-mark', '.plan-check-text'];
const RULE_LINE = 'How a change lands · by where the run that owns the requirement is';
function judge(list, theme, m, marked) {
  results.lists.push({ list, theme, ...m });
  const where = `${list}, ${theme}, ${WIDTH}px`;
  if (!m.found) { check(false, `${where}: the fold is on screen`); return; }
  check(m.line === RULE_LINE, `${where}: the fold line (${m.line})`);
  check(m.rows.length === 3 && m.rows.map((r) => r.id).join('|') === 'Not started|Running|Finished', `${where}: 3 rows (${JSON.stringify(m.rows.map((r) => r.id))})`);
  const on = m.rows.filter((r) => r.aria === 'this change');
  check(on.length === 1 && on[0].id === marked && m.rows.filter((r) => r.aria === 'not this change').length === 2, `${where}: one "this change" mark, on ${marked}`);
  const low = m.rows.filter((r) => r.height < 31.5);
  check(!low.length, `${where}: every fold row is at least 32px (${JSON.stringify(m.rows.map((r) => r.height))})`);
  check(m.maxDy <= 1, `${where}: each mark's y-centre is within 1px of its first text line (max ${m.maxDy.toFixed(2)}px)`);
  check(m.spreadX <= 1, `${where}: the marks share one x-centre within 1px (spread ${m.spreadX.toFixed(2)}px)`);
  check(!m.rows.some((r) => r.idClipped), `${where}: no .plan-check-id clipped`);
  check(!m.overflow, `${where}: no horizontal overflow`);
}
/** A card's notice, its visible questions, primaries and Answer buttons. */
const COUNTS = (rootSel) => `(() => {
  const root = [...document.querySelectorAll(${JSON.stringify(rootSel)})].find((r) => r.offsetParent);
  if (!root) return null;
  const vis = (els) => [...els].filter((b) => b.offsetParent && !b.closest('[hidden], .hidden'));
  const notice = vis(root.querySelectorAll('.req-change'))[0] || null;
  return { head: notice ? notice.querySelector('.ask-mcard-title').textContent : null, caps: notice ? [...notice.querySelectorAll('.cap')].map((c) => c.textContent) : [],
    notices: vis(root.querySelectorAll('.req-change')).length, folds: vis(root.querySelectorAll('.req-change-rule')).length,
    questions: vis(root.querySelectorAll('.qpanel .qopt, .qpanel .qtext')).length, primaries: vis(root.querySelectorAll('.btn-primary')).map((b) => b.textContent),
    qPrimaries: vis(root.querySelectorAll('.qpanel .btn-primary')).map((b) => b.textContent),
    answer: vis(root.querySelectorAll('button')).filter((b) => /^Answer/.test(b.textContent.trim())).length,
    cardButtons: vis(root.querySelectorAll('.qpanel button')).length,
    logs: [...root.querySelectorAll('.chat-rc-log-text')].map((n) => n.textContent),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth || root.scrollWidth > root.clientWidth };
})()`;
const LAND = { 'not-started': 'It plans from the new text.', running: 'It stopped, re-plans from the new text and continues.',
  finished: 'Run 5, a small change run, takes the next turn.' };
const HEAD = { 'not-started': 'R-po-3 changed · run 3 has not started', running: 'R-po-2 changed · run 2 was running', finished: 'R-po-2 changed · run 2 is finished' };
const MARK = { 'not-started': 'Not started', running: 'Running', finished: 'Finished' };

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: false });
const PROTO = pathToFileURL(PROTOTYPE).href;
for (const theme of THEMES) {
  // 1. The requirement stop with a proposal on the feature card: the new text in full above the fold, both below the options.
  await open(`${base}/?s=${theme}#chat/${A.threadId}`);
  await skipWelcome(); await setTheme(theme);
  if (await waitFor("!!document.querySelector('.chat-rc .req-change-rule')", `the stop's fold (${theme})`)) {
    await skipWelcome(); await reveal('.chat-rc .req-change-rule');
    const c = await ev(COUNTS('.chat-rc'));
    const text = await ev("[...document.querySelectorAll('.chat-rc .req-change-texts .plan-check-label')].map((o) => o.textContent).join(' | ')");
    check(text === `“${NEW}”`, `stop, ${theme}: the new text shows in full (${text})`);
    check(c && c.qPrimaries.length === 1 && c.qPrimaries[0] === 'Keep it', `stop, ${theme}: one primary naming the pick (${JSON.stringify(c && c.qPrimaries)})`);
    judge('stop fold', theme, await ev(MEASURE(...FOLD('.chat-rc'))), 'Finished');
    await shot(`app-req-change-stop-${theme}`);
  }
  // 2–4. The notice on the Build step: not started, running, finished.
  for (const [x, kase] of [[B, 'not-started'], [C, 'running'], [D, 'finished']]) {
    await open(`${base}/?n=${kase}-${theme}#chat/${x.threadId}`);
    await skipWelcome(); await setTheme(theme);
    if (await waitFor("!!document.querySelector('.chat-rc .req-change .cap')", `the ${kase} notice (${theme})`)) {
      await skipWelcome(); await reveal('.chat-rc .req-change');
      const c = await ev(COUNTS('.chat-rc'));
      check(c && c.head === HEAD[kase], `${kase}, ${theme}: the head (${c && c.head})`);
      check(c && c.caps.length === 1 && new RegExp(`^Changed in chat at \\d\\d:\\d\\d: “${NEW}”\\. ${LAND[kase].replace(/[.]/g, '\\.')} You are told, not asked\\.$`).test(c.caps[0]),
        `${kase}, ${theme}: one .cap line (${JSON.stringify(c && c.caps)})`);
      check(c && c.notices === 1 && !c.logs.some((t) => /^R-po-\d changed/.test(t)), `${kase}, ${theme}: the notice once, not a log row too`);
      if (kase === 'running') check(c && c.questions === 0 && c.primaries.length === 0 && c.answer === 0, `running, ${theme}: no question, no primary, no Answer (${JSON.stringify(c)})`);
      check(c && !c.overflow, `${kase}, ${theme}: no horizontal overflow`);
      judge(`${kase} fold`, theme, await ev(MEASURE(...FOLD('.chat-rc .req-change'))), MARK[kase]);
      const rows = await ev("[...document.querySelectorAll('.chat-rc-members .run-member .run-member-state')].map((n) => n.textContent)");
      if (kase === 'finished') check(rows.includes('next · small change run'), `finished, ${theme}: the change run reads next · small change run (${JSON.stringify(rows)})`);
      await shot(`app-req-change-${kase}-${theme}`);
    }
  }
  // 5. The chat card: Change, the reason, the new text once, the fold, Not now and Change it.
  await open(`${base}/?c=${theme}#chat/${chatThread.id}`);
  await skipWelcome(); await setTheme(theme);
  if (await waitFor("!!document.querySelector('[data-req-change-card=\"proposed\"]')", `the chat card (${theme})`)) {
    await skipWelcome(); await reveal('[data-req-change-card="proposed"]');
    const card = await ev(`(() => { const el = document.querySelector('[data-req-change-card="proposed"]');
      return { kind: el.querySelector('.ask-mcard-kind').textContent, title: el.querySelector('.ask-mcard-title').textContent,
        primaries: [...el.querySelectorAll('.btn-primary')].map((b) => b.textContent), text: el.textContent,
        overflow: el.scrollWidth > el.clientWidth || document.documentElement.scrollWidth > document.documentElement.clientWidth }; })()`);
    check(card.kind === 'Change' && card.title === 'R-po-4' && card.primaries.join() === 'Change it', `chat card, ${theme}: Change · R-po-4 · Change it (${JSON.stringify(card.primaries)})`);
    check((card.text.match(/within a minute/g) || []).length === 1, `chat card, ${theme}: the new text once`);
    check(!card.overflow, `chat card, ${theme}: no horizontal overflow`);
    judge('chat card fold', theme, await ev(MEASURE(...FOLD('[data-req-change-card="proposed"]'))), 'Not started');
    await shot(`app-req-change-chat-${theme}`);
  }
  // 6–7. The run page and the side panel of the asking run: no notice, no fold, no card button.
  await open(`${base}/?r=${theme}#running/${STOP_RUN}`);
  await skipWelcome(); await setTheme(theme);
  if (await waitFor("!!document.querySelector('#run-detail .qpanel')", `the run page (${theme})`)) {
    await sleep(600);
    const r = await ev(COUNTS('#run-detail'));
    check(r && r.notices === 0 && r.folds === 0 && r.cardButtons === 0 && !r.overflow, `run page, ${theme}: no notice, fold or card button (${JSON.stringify(r)})`);
  }
  await shot(`app-req-change-run-page-${theme}`);
  await open(`${base}/?p=${theme}#chat/new/run/${A.pid(4)}/overview`);
  await skipWelcome(); await setTheme(theme);
  if (await waitFor("!!document.querySelector('[data-chat-panel] .qpanel')", `the side panel (${theme})`)) {
    await sleep(600);
    const p = await ev(COUNTS('[data-chat-panel] .crp-host > .rd'));
    check(p && p.notices === 0 && p.folds === 0 && p.cardButtons === 0, `side panel, ${theme}: no notice, fold or card button (${JSON.stringify(p)})`);
  }
  await shot(`app-req-change-side-panel-${theme}`);
  for (const screen of ['req-change', 'spec-changed']) {
    await open(`${PROTO}#${screen}`); await setTheme(theme); await sleep(300);
    await shot(`prototype-${screen}-${theme}`);
  }
}
check(errors.length === 0, `no page errors${errors.length ? ` — ${errors.slice(0, 3).join(' | ')}` : ''}`);
results.minutes = Math.round((Date.now() - T0) / 600) / 100;
results.failed = failed;
results.verdict = failed ? `${failed} FAILED` : 'all passed';
await writeFile(logFile, JSON.stringify(results, null, 2) + '\n');
log(`${results.shots.length} PNGs and ${logFile} in ${results.minutes} min; ${results.verdict}`);
await shutdown(failed ? 1 : 0);
