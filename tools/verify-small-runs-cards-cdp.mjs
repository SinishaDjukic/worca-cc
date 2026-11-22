#!/usr/bin/env node
// tools/verify-small-runs-cards-cdp.mjs — headless-Chrome closing check of Shaper small runs Feature C (C1–C5) on the
// mock engine, seeded data only. The Verifier's states are held by seeding (a running `pipelines` row and a live runs-map
// entry for the Verifier run and for one gap run, beside `outline.verify` at `verifying`, `gaps` and `clean`), never by
// waiting on a live mock run. At 375px, in light and dark, each surface is captured beside its prototype screen
// (`plans/shaper-refresh/prototype.html#id`, the moment's segment clicked):
//   C5 `#verifier` verifying ([data-vf="vw"]) and gap found ([data-vf="vf"]), `#ship` (state line and receipt), the
//      bound stop (`#run-stops`), on the Chat card, plus the run page and side panel of the Verifier run and a gap run;
//   C1 `#prototype` offered, building, built, remark proposed, confirmed ([data-proto] 0, .5, 1, 2, 3);
//   C2 `#build` rows and `#run-panel` Agents; C3 `#run-stops` question, answered fold and waiting row;
//   C4 `#req-change` notice and its "How a change lands" fold;
// and one reduced-motion capture of Prototype building. A live phase then follows a REAL paced mock Design build
// (WORCA_MOCK_DESIGN_MS=400) on the Chat card: the Lead row, a row per screen and pieces assembling, captured mid-build
// and with reduced motion (chat-prototype-building-mid-light, chat-prototype-building-reduced-motion-light). Every list (the Verifier's gap `.srows` included) is measured:
// row heights, the 32px one-line check, the mark column's x and y centre spread, maxDy and overflow, into
// small-runs-cards-measure.json beside the app-… / prototype-… PNGs in SHOTS_DIR.
// New wording with no prototype screen is paired with `#run-stops` for layout only, never for text.
// NOT part of `npm test`: it needs Chrome. It writes the verdict "incomplete" first and stops with "timeout" after 30
// minutes. Run: H=$(mktemp -d "$TMPDIR/x.XXXXXX"); env -u FORCE_COLOR HOME=$H VERIFY_PORT=4947 SHOTS_DIR=… node --disable-warning=ExperimentalWarning tools/verify-small-runs-cards-cdp.mjs
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
  notes: ['The detail leaves out the cost, as every S8 line does; "Ready to ship" is the word, so the detail does not repeat it.',
    'New wording with no prototype screen (the bound stop, "Ship with the gap", the accepted receipt, the stopped line) is paired with #run-stops for layout only.'] };
let logFile = null;
const writeLog = (verdict) => { if (logFile) writeFileSync(logFile, JSON.stringify({ ...results, verdict }, null, 2) + '\n'); };
async function shutdown(code) {
  try { if (chrome) chrome.kill('SIGKILL'); } catch {}
  try { if (srv) await new Promise((r) => srv.close(r)); } catch {}
  for (const d of [home, proj, profile]) { try { if (d) await rm(d, { recursive: true, force: true }); } catch {} }
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection']) {
  process.on(sig, (e) => { if (e && e.stack) console.error(e.stack); shutdown(1); });
}
// The hard cap: past 30 minutes the log says "timeout" and the run stops.
setTimeout(() => { log(`FAIL the 30-minute cap was reached after ${((Date.now() - T0) / 60000).toFixed(1)} min`); writeLog('timeout'); shutdown(2); }, CAP_MS);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (ok, what) => { results.checks.push({ ok: !!ok, what }); if (ok) log(`ok   ${what}`); else { failed += 1; log(`FAIL ${what}`); } };

// ---- a sandboxed HOME and WORCA_HOME, the mock engine, the flag on, then the server in process (VERIFY_PORT, else a
// free port: never the inherited one, which is the host app's).
home = await mkdtemp(path.join(tmpdir(), 'worca-c5-home-'));
process.env.HOME = home; process.env.USERPROFILE = home;
process.env.WORCA_HOME = path.join(home, '.worca-cc');
process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
process.env.WORCA_MOCK = '1';
process.env.WORCA_FLAGS = 'shaperSmallRuns';
const SHOTS = process.env.SHOTS_DIR || await mkdtemp(path.join(tmpdir(), 'worca-c5-shots-'));
await mkdir(SHOTS, { recursive: true });
logFile = path.join(SHOTS, 'small-runs-cards-measure.json');
// The verdict line is written first: a run cut short still leaves a log that says so.
writeLog('incomplete');
proj = await mkdtemp(path.join(tmpdir(), 'worca-c5-proj-'));
for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'proof@worca.local'], ['config', 'user.name', 'proof']]) execFileSync('git', a, { cwd: proj });
await writeFile(path.join(proj, 'README.md'), '# small runs cards proof\n');
execFileSync('git', ['add', '-A'], { cwd: proj });
execFileSync('git', ['commit', '-qm', 'init'], { cwd: proj });
const imp = (rel) => import(new URL(rel, import.meta.url).href);
const { server, runs, reqChanges } = await imp('../ui/server.mjs');
const { getDb } = await imp('../src/core/db.mjs');
const { projectKey } = await imp('../src/core/store.mjs');
const { writeStoreMeta } = await imp('../src/core/artifacts.mjs');
const { createSliceFeature, recordShapePlan, changeAgreedRequirements, setFeatureAcceptance, recordShip } = await imp('../src/core/shape/features.mjs');
const askStore = await imp('../src/core/ask/store.mjs');
const { normalizeOutline } = await imp('../src/shared/shape/slices.mjs');
const { gateStop } = await imp('../src/shared/shape/run-stops.mjs');
const { verifyStop } = await imp('../src/shared/shape/verifier.mjs');
const { prototypeView } = await imp('../src/shared/shape/prototype.mjs');
const { careRunPlan } = await imp('../src/shared/shape/feature-record.mjs');
const { runRolesOf } = await imp('../src/shared/shape/requirements.mjs');
const { careRunGraph } = await imp('../src/core/shape/care-run.mjs');
const { resolveGraph } = await imp('../src/core/workflows.mjs');
const { loadAgentRegistry } = await imp('../src/core/agent-registry.mjs');
const { buildGraphManifest } = await imp('../src/shared/graph/manifest.mjs');
const { createPrototypeDesign, startPrototypeBuild, prototypeBrief } = await imp('../src/core/shape/prototype-design.mjs');
const { designBuilds } = await imp('../ui/server.mjs');
srv = server;
await new Promise((r, rej) => { srv.once('error', (err) => rej(new Error(`cannot listen on VERIFY_PORT ${process.env.VERIFY_PORT}: ${err.message}`))); srv.listen(Number(process.env.VERIFY_PORT || 0), '127.0.0.1', r); });
const base = `http://127.0.0.1:${srv.address().port}`;
const post = (url, body) => fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) });
{ const r = await post('/api/settings', { uiLevel: 'expert' }); if (!r.ok) throw new Error(`could not pin the interface mode: HTTP ${r.status}`); }

// ---- seeding: marked 4-run features, one agreed requirement per run. Care: Balanced (2 fix cycles).
const key = projectKey(proj);
writeStoreMeta(key, 'project', { key, name: 'Proof', path: proj });
const now = new Date().toISOString();
const pipeline = (id, status, title, stats = null) => getDb().prepare(`INSERT INTO pipelines (id, project_key, target, title, status, phase,
  cycle, started_at, updated_at, total_cost_usd, total_active_ms, branch, shape_stats) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run(id, key, 'project', title, status, status, 0, now, now, 0, 0, JSON.stringify({ source: 'main', feature: `feat/${id}` }), stats ? JSON.stringify(stats) : null);
const TITLES = ['Store sign-ups in the project database', 'Send a welcome email from the email service',
  'Show the sign-up form on the landing page', 'List new members on the admin page'];
const AGREED = TITLES.map((t, i) => ({ id: `R-po-${i + 1}`, text: t, example: `example ${i + 1}` }));
const outline = normalizeOutline({ why: 'proof', leftOut: [], slices: TITLES.map((title, i) => ({ id: `s${i + 1}`, title, goal: `Goal ${i + 1}`, inScope: [],
  outOfScope: [], acceptance: [`ok ${i + 1}`], dependsOn: [], estimate: 'medium', requirements: [`R-po-${i + 1}`] })) },
{ agreed: AGREED }).outline;
const care = { position: 'balanced', chosenBy: 'person', worcaPick: 'balanced' };
const careRec = { ...care, reason: 'Worca picks Balanced', facts: { touches: [], requirements: 4, subsystems: [], screens: false, size: null }, at: now };
const careRun = careRunPlan('balanced', { runRoles: runRolesOf(['R-po-2']) });
const reg = loadAgentRegistry();
const resolved = await resolveGraph(proj, 'wf_shape_slice_req', reg, undefined, { transform: (t) => careRunGraph(t, careRun) });
const stepper = { ...buildGraphManifest(resolved.template, resolved.agentsByKey, { overlays: { nodes: resolved.nodes, wires: resolved.wires } }), careRun };
const vResolved = await resolveGraph(proj, 'wf_shape_verify', reg);
const vStepper = buildGraphManifest(vResolved.template, vResolved.agentsByKey, { overlays: { nodes: vResolved.nodes, wires: vResolved.wires } });
const step = (nodeId, status = 'done') => ({ key: `x:${nodeId}:1`, executionId: `x:${nodeId}:1`, nodeId, ordinal: 1, cycle: 1, status,
  startedAt: now, activeMs: 1000, costUsd: 0 });
const { EventEmitter } = await import('node:events');
const answered = [];
/** A live runs-map entry: a slice run at node `at` (its Care graph), or the Verifier run (`verify`) at n_verify. */
function liveRun(pid, title, { at = 'n_impl', pendingQuestion = null, runShape, status = 'running', verify = false } = {}) {
  const orch = new EventEmitter();
  const order = verify ? ['n_task', 'n_verify'] : ['n_task', 'n_clarify', 'n_plan', 'n_roles', 'n_refine', 'n_tests', 'n_impl', 'n_review'];
  orch.state = { id: pid, status, title, projectDir: proj, stepper: verify ? vStepper : stepper,
    steps: [...order.slice(0, Math.max(0, order.indexOf(at))).map((id) => step(id)), step(at, pendingQuestion || status === 'paused' ? 'done' : 'start')],
    active: pendingQuestion || status === 'paused' ? [] : [{ nodeId: at, executionId: `x:${at}:1` }], tokens: {}, wireDeliveries: {}, warnings: [], endReached: false,
    ...(verify ? {} : { shaping: { approved: { file: 'plan.md' } } }) };
  orch.getState = () => orch.state;
  orch.runShape = runShape;
  orch.answer = (id, payload) => { answered.push({ pid, id, payload }); return true; };
  for (const m of ['pause', 'stop']) orch[m] = () => true;
  const id = `run-${pid}`;
  runs.set(id, { id, kind: 'run', pipelineId: pid, status, events: [], pendingQuestion, projectDir: proj, startedAt: Date.now(), orch, title, tags: [] });
  return id;
}
function thread(title, pid) {
  const th = askStore.createThread({ title });
  const cardId = askStore.newAskId('card');
  askStore.appendMessage(th.id, { role: 'user', text: `Plan ${title.toLowerCase()} in small runs` });
  askStore.appendMessage(th.id, { role: 'assistant', status: 'done', text: 'Here is the feature:',
    blocks: [{ kind: 'card', id: cardId, state: 'tracked', card: { type: 'progress', pipelineId: pid, runId: `run-${pid}`, projectKey: key, title, status: 'done' } }] });
  askStore.linkRun(th.id, { runId: `run-${pid}`, cardId, pipelineId: pid, status: 'done' });
  recordShapePlan({ threadId: th.id, cardId, title });
  return th.id;
}
/** A marked 4-run feature (`states[k-1]`: done, running or planned) with its Chat thread. → {f, pid(k), threadId} */
function seedFeature(tag, title, states, { withOutline = outline, requirementKinds = null } = {}) {
  const pid = (k) => `c5${tag}00000${k}`;
  pipeline(pid(1), states[0], title, { smallRuns: true, care: careRec });
  const f = createSliceFeature({ pipelineId: pid(1), projectDir: proj, title, outline: withOutline, perspectives: ['product', 'architect'], workflowId: 'wf_shape',
    smallRuns: true, care, requirementKinds });
  states.forEach((st, i) => {
    const k = i + 1;
    if (k > 1 && st !== 'planned') fire(f, k, pid(k), st, `Run ${k} · ${TITLES[i]}`);
  });
  return { f, pid, threadId: thread(title, pid(1)) };
}
function fire(f, k, pid, status, title) {
  pipeline(pid, status, title);
  const t = getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = ?').get(f.id, k).ticket_id;
  getDb().prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = ? WHERE id = ?").run(pid, t);
  getDb().prepare('UPDATE shape_feature_slices SET pipeline_id = ? WHERE feature_id = ? AND idx = ?').run(pid, f.id, k);
}
/** The feature's Verifier check record, written as verifier.mjs writes it. */
function setVerify(f, check) {
  const row = getDb().prepare('SELECT outline FROM shape_features WHERE id = ?').get(f.id);
  const o = JSON.parse(row.outline);
  getDb().prepare('UPDATE shape_features SET outline = ? WHERE id = ?').run(JSON.stringify({ ...o, verify: { checks: [check] } }), f.id);
}
const HELD = ['R-po-1', 'R-po-3', 'R-po-4'];
const GAP = { id: 'R-po-2', why: 'sign-up never calls the email service', title: 'Call the email service from sign-up' };
const vCheck = (x, vpid, state, over = {}) => ({ round: 1, ticketId: `t-${vpid}`, pipelineId: vpid, head: { index: 4, pipelineId: x.pid(4) }, headSha: null,
  state, result: null, gapRuns: [], extra: 0, fixCycles: 2, at: now, ...over });
const VERIFY = (fid, round) => ({ verify: { featureId: fid, round, fixCycles: 2, extra: 0, owned: AGREED.map((a) => a.id), head: { index: 4, pipelineId: 'x' } } });

// C5 verifying: every run done, the Verifier run live at n_verify.
const VW = seedFeature('vw', 'Sign-up', ['done', 'done', 'done', 'done']);
const VW_RUN = 'c5vwv00001';
pipeline(VW_RUN, 'running', 'Sign-up · Verifier');
setVerify(VW.f, vCheck(VW, VW_RUN, 'verifying'));
liveRun(VW_RUN, 'Sign-up · Verifier', { at: 'n_verify', verify: true, runShape: VERIFY(VW.f.id, 1) });
// C5 gap found: one gap run (run 5, a change run) building.
const VF = seedFeature('vf', 'Welcome email', ['done', 'done', 'done', 'done']);
const VF_RUN = 'c5vfv00001';
pipeline(VF_RUN, 'done', 'Welcome email · Verifier');
const added = changeAgreedRequirements(VF.f.id, { changes: [], appendFor: [{ ownerIndex: 2, title: GAP.title, goal: GAP.why, ids: [GAP.id] }] }).added[0];
const GAP_RUN = 'c5vfg00005';
fire(VF.f, added.index, GAP_RUN, 'running', `Run ${added.index} · ${GAP.title}`);
liveRun(GAP_RUN, `Run ${added.index} · ${GAP.title}`, { runShape: { slice: { feature: VF.f.id, index: added.index } } });
setVerify(VF.f, vCheck(VF, VF_RUN, 'gaps', { result: { held: HELD, gaps: [GAP] }, gapRuns: [added.index] }));
// C5 no gap: clean.
const VC = seedFeature('vc', 'Member list', ['done', 'done', 'done', 'done']);
pipeline('c5vcv00001', 'done', 'Member list · Verifier');
setVerify(VC.f, vCheck(VC, 'c5vcv00001', 'clean', { result: { held: AGREED.map((a) => a.id), gaps: [] } }));
// C5 the bound stop: round 3 of Balanced, one gap still open; the Verifier run asks.
const VA = seedFeature('va', 'Landing form', ['done', 'done', 'done', 'done']);
const VA_RUN = 'c5vav00001';
pipeline(VA_RUN, 'running', 'Landing form · Verifier');
setVerify(VA.f, vCheck(VA, VA_RUN, 'verifying', { round: 3 }));
const VSTOP = verifyStop({ gaps: [GAP], round: 3, fixCycles: 2 });
const VPQ = { id: 'verify-3-x:n_verify:1', kind: 'gate', nodeId: 'n_verify', executionId: 'x:n_verify:1', issues: [], stop: VSTOP };
liveRun(VA_RUN, 'Landing form · Verifier', { at: 'n_verify', verify: true, pendingQuestion: VPQ, runShape: VERIFY(VA.f.id, 3) });

// C2 + C3: run 2 waits on its objection stop, run 3 builds, run 4 builds on run 2.
const RS = seedFeature('rs', 'Charts', ['done', 'running', 'running', 'planned']);
const ISSUES = [{ severity: 'major', title: 'A chart link opens for a visitor who is not a member', detail: 'GET /c/:id skips the member check' }];
const RSTOP = gateStop({ run: 2, issues: ISSUES, fixCycles: 3, nodeId: 'n_review' });
const RPQ = { id: 'gate-w9-3', kind: 'gate', wireId: 'w9', nodeId: 'n_review', executionId: 'x:n_review:3', deliveryNo: 3, issues: ISSUES, stop: RSTOP };
const RS_RUN = liveRun(RS.pid(2), `Run 2 · ${TITLES[1]}`, { at: 'n_review', pendingQuestion: RPQ, runShape: { slice: { feature: RS.f.id, index: 2 } } });
liveRun(RS.pid(3), `Run 3 · ${TITLES[2]}`, { runShape: { slice: { feature: RS.f.id, index: 3 } } });
// C4: a finished owner gets a change run (the notice and its fold).
const RC = seedFeature('rc', 'Reset emails', ['done', 'done', 'planned', 'planned']);
{ const r = reqChanges.apply(RC.f.id, [{ id: 'R-po-2', from: AGREED[1].text, to: 'welcome emails retry once, within 20 seconds' }], { kind: 'chat', by: 'proof' });
  check(r.ok && r.result.changes[0].case === 'finished', `seed: the C4 change lands as finished (${JSON.stringify(r)})`); }
// C1: a planning run per Prototype moment (offered is its open ask; the others its saved record).
const PROTO_REC = (state, over = {}) => ({ v: 1, state, screenIds: ['R-ux-1'], round: 1, screens: [{ section: 'signup', name: 'Sign-up form', ids: ['R-ux-1'] }],
  costUsd: 0.4, findings: [], reviewRounds: state === 'building' ? 0 : 1, remarks: state === 'remark' ? 1 : 0, rebuilt: false, at: now, ...over });
const PROTO_MOMENTS = [
  ['0', 'offered', PROTO_REC('offered', { screens: [], reviewRounds: 0 })],
  ['.5', 'building', PROTO_REC('building')],
  ['1', 'built', PROTO_REC('built')],
  ['2', 'remark', PROTO_REC('remark', { remark: { text: 'make the button bigger', id: 'R-ux-1', proposed: { text: 'A large sign-up button', example: 'the button is 48px', was: 'A sign-up button' } } })],
  ['3', 'confirmed', PROTO_REC('confirmed')],
];
const PROTO = {};
for (const [i, [, moment, rec]] of PROTO_MOMENTS.entries()) {
  const pid = `c5pr00000${i + 1}`;
  pipeline(pid, 'running', `Sign-up · ${moment}`, { smallRuns: true, care: careRec, prototype: rec });
  const pq = moment === 'offered' ? { id: `proto-n_proto-1-x-1`, kind: 'prototype', nodeId: 'n_proto', prototype: { moment: 'offered', ...prototypeView(rec), screens: [] } } : null;
  liveRun(pid, `Sign-up · ${moment}`, { at: 'n_refine', pendingQuestion: pq, runShape: { perspectives: ['product', 'ux'] } });
  PROTO[moment] = { pid, threadId: thread(`Sign-up ${moment}`, pid) };
}
// D1 Ship: every run done, no Verifier check (state S9: the ship step), R-comp-4 for Compliance to confirm.
const SHIP_OUTLINE = { ...outline, agreed: [...outline.agreed, { id: 'R-comp-4', text: 'The sign-up data stays in the EU', example: 'rows live in eu-west' }] };
const shipFeature = (tag, title) => seedFeature(tag, title, ['done', 'done', 'done', 'done'],
  { withOutline: SHIP_OUTLINE, requirementKinds: { 'R-comp-4': { kind: 'confirmed', role: 'compliance' } } });
const COMP_MET = { id: 'R-comp-4', mark: 'met', role: 'compliance', by: 'proof', at: now };
const SB = shipFeature('sb', 'Ship blocked');
const SR = shipFeature('sr', 'Ship ready');
setFeatureAcceptance(SR.f.id, [COMP_MET]);
const SD = shipFeature('sd', 'Ship done');
setFeatureAcceptance(SD.f.id, [COMP_MET]);
[1, 2, 3, 4].forEach((k) => getDb().prepare("UPDATE pipelines SET pr_url = ?, pr_number = ?, pr_state = 'OPEN' WHERE id = ?")
  .run(`https://github.com/proof/repo/pull/${1430 + k}`, 1430 + k, SD.pid(k)));
recordShip(SD.f.id, { mode: 'stacked' });
const SK = shipFeature('sk', 'Ship keyboard');
// Owner direction da6198d8d: R-comp-4 marked Not met with a reason: Ship open, the reason on its own line.
const SN = shipFeature('sn', 'Ship not met');
setFeatureAcceptance(SN.f.id, [{ id: 'R-comp-4', mark: 'not-met', reason: 'Legal has not signed the EU clause yet', role: 'compliance', by: 'proof', at: now }]);
log(`server ${base} · seeded`);

// ---- chrome + cdp
profile = await mkdtemp(path.join(tmpdir(), 'worca-c5-profile-'));
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
  const file = path.join(SHOTS, `c5-${name}.png`);
  await writeFile(file, Buffer.from(data, 'base64'));
  results.shots.push(file);
  return file;
}
async function open(url) {
  await cdp('Page.navigate', { url });
  await sleep(600);
}
const setTheme = (theme) => ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)};0`);
/** Clicks the Welcome dialog's "Skip" (and the level dialog's "Got it") for up to 3 s. */
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

/** The in-page measurement of one list: per row its height and one-line state, the mark's and the first text line's
 *  centres; the marks' x spread, maxDy and overflow. */
const MEASURE = (rootSel, rowSel, markSel, textSel) => `(() => {
  const root = [...document.querySelectorAll(${JSON.stringify(rootSel)})].filter((r) => r.offsetParent)[0];
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
    return { text: (text && text.textContent || '').trim(), height: Math.round(rb.height * 10) / 10,
      markX: mb ? mb.left + mb.width / 2 : null, textX: tb ? tb.left : null, markY: mb ? mb.top + mb.height / 2 : null, textY: tb ? tb.top + tb.height / 2 : null,
      textLines: text ? lines(text) : 0, oneLine: !tops.length || Math.max(...tops) - Math.min(...tops) <= 8 };
  });
  const xs = rows.map((r) => r.markX).filter((x) => x != null);
  const txs = rows.map((r) => r.textX).filter((x) => x != null);
  return { found: true, rows, spreadX: xs.length ? Math.max(...xs) - Math.min(...xs) : 0, textSpreadX: txs.length ? Math.max(...txs) - Math.min(...txs) : 0,
    maxDy: Math.max(0, ...rows.filter((r) => r.markY != null && r.textY != null).map((r) => Math.abs(r.markY - r.textY))),
    overflow: root.scrollWidth > root.clientWidth || document.documentElement.scrollWidth > document.documentElement.clientWidth };
})()`;
/** Judges one list: `oneLine` lists (run rows) want every row one 32px line; others (the gap list, whose why may wrap,
 *  the folds) every row at least 32px with its mark on the first text line. */
function judge(list, theme, m, { oneLine = true, width = WIDTH } = {}) {
  results.lists.push({ list, theme, width, ...m });
  const where = `${list}, ${theme}, ${width}px`;
  if (!m.found) { check(false, `${where}: the list is on screen`); return; }
  const off = oneLine ? m.rows.filter((r) => !r.oneLine || r.textLines > 1 || Math.abs(r.height - 32) > 0.5) : m.rows.filter((r) => r.height < 31.5);
  check(m.rows.length > 0 && off.length === 0, `${where}: ${oneLine ? 'every row is one 32px line' : 'every row is at least 32px'} (${m.rows.length} rows${off.length ? `; off: ${JSON.stringify(off.map((r) => [r.text, r.height, r.textLines]))}` : ''})`);
  check(m.maxDy <= 1, `${where}: each mark's y-centre is within 1px of its first text line (max ${m.maxDy.toFixed(2)}px)`);
  check(m.spreadX <= 1, `${where}: the marks share one x-centre within 1px (spread ${m.spreadX.toFixed(2)}px)`);
  check(!m.overflow, `${where}: no horizontal overflow`);
}
const RUN_ROWS = ['.chat-rc-members', '.run-member', '.status-dot', '.run-member-title'];
/** Owner direction d86d13181: the Verifier receipt row and the gap rows, measured as one list (one mark column, one text start). */
const VERIFY_ROWS = ['.chat-rc', ':is(.chat-rc-log-verify, .verify-gaps) > .plan-check-row', '.plan-check-mark', '.plan-check-text'];
/** The Verifier receipt row and, when up, the gap rows: the mark on the first text line, one mark x, one text x. */
async function judgeVerifyLine(where, theme) {
  const m = await ev(MEASURE(...VERIFY_ROWS));
  results.lists.push({ list: `${where} Verifier line`, theme, ...m });
  const at = `${where} Verifier line, ${theme}, ${WIDTH}px`;
  if (!m.found || !m.rows.length) { check(false, `${at}: the Verifier row is on screen`); return; }
  check(m.maxDy <= 1, `${at}: the mark sits on the first text line (max dy ${m.maxDy.toFixed(2)}px; ${JSON.stringify(m.rows.map((r) => [r.markX, r.textX]))})`);
  check(m.spreadX <= 1 && m.textSpreadX <= 1, `${at}: one mark column and one text start with the gap rows (mark spread ${m.spreadX.toFixed(2)}px, text spread ${m.textSpreadX.toFixed(2)}px)`);
}
const GAP_ROWS = (scope) => [`${scope} .verify-gaps`, '.plan-check-row', '.plan-check-mark', '.plan-check-text'];
const AGENT_ROWS = (scope) => [`${scope} .run-agents`, '.plan-check-row', '.plan-check-mark', '.plan-check-text'];
const FOLD_ROWS = ['.chat-rc .req-change-rule', '.plan-check-row', '.plan-check-mark', '.plan-check-text'];
const PANEL = '[data-chat-panel] .crp-host > .rd';
const STATUS = "(() => { const s = [...document.querySelectorAll('.chat-rc .chat-rc-status')].find((x) => x.offsetParent); return s ? { word: (s.querySelector('.run-status-word') || {}).textContent || null, detail: (s.querySelector('.run-status-detail') || {}).textContent || null } : null; })()";
const LOGS = "[...document.querySelectorAll('.chat-rc .chat-rc-log-text')].map((n) => n.textContent)";
const COUNTS = (rootSel) => `(() => {
  const root = [...document.querySelectorAll(${JSON.stringify(rootSel)})].find((r) => r.offsetParent);
  if (!root) return null;
  const vis = (els) => [...els].filter((b) => b.offsetParent && !b.closest('[hidden], .hidden'));
  return { questions: vis(root.querySelectorAll('.qpanel[data-qid]')).length, primaries: vis(root.querySelectorAll('.btn-primary')).map((b) => b.textContent),
    preset: (vis(root.querySelectorAll('.qopt[data-preset]'))[0] || {}).textContent || null,
    answer: vis(root.querySelectorAll('button')).filter((b) => /^Answer/.test(b.textContent.trim())).length,
    resume: vis(root.querySelectorAll('button')).filter((b) => /Resume/.test(b.textContent)).length,
    gapLists: vis(root.querySelectorAll('.verify-gaps')).length, rcMembers: vis(root.querySelectorAll('.run-member[data-key="verifier"]')).length,
    rawLinks: vis(root.querySelectorAll('a')).filter((a) => /^https?:/.test(a.getAttribute('href') || '')).length,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
})()`;

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: false });
const PROTO_URL = pathToFileURL(PROTOTYPE).href;
/** A prototype screen, the moment's segment clicked (`seg` = a selector), then the capture. */
async function prototypeShot(screen, seg, name, theme) {
  await open(`${PROTO_URL}?${name}-${theme}#${screen}`); await setTheme(theme); await sleep(300);
  // `seg` is one selector or (D1 Ship's moments) a list clicked in order.
  for (const sel of [].concat(seg || [])) { await ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (b) b.click(); return !!b; })()`); await sleep(300); }
  await shot(`prototype-${name}-${theme}`);
}
/** Opens a Chat thread's feature card. → true when its state line is up */
async function card(threadId, q, what, theme) {
  await open(`${base}/?${q}-${theme}#chat/${threadId}`);
  await skipWelcome(); await setTheme(theme);
  const ok = await waitFor("!!document.querySelector('.chat-rc .chat-rc-status .run-status-word')", `${what} (${theme})`);
  if (ok) { await skipWelcome(); await sleep(400); }
  return ok;
}
/** The run page and the side panel of `pid` (its runs-map id `runId`): no card button, no raw link, no overflow. */
async function runViews(runId, pid, name, theme) {
  await open(`${base}/?r${name}-${theme}#running/${runId}`);
  await skipWelcome(); await setTheme(theme);
  if (await waitFor("!!document.querySelector('#run-detail')", `the ${name} run page (${theme})`)) {
    await sleep(800);
    const r = await ev(COUNTS('#run-detail'));
    check(r && r.rawLinks === 0 && !r.overflow, `${name} run page, ${theme}: no raw browser link, no overflow (${JSON.stringify(r)})`);
    if (await ev("!!document.querySelector('#run-detail .run-agents .plan-check-row')")) judge(`${name} run page Agents`, theme, await ev(MEASURE(...AGENT_ROWS('#run-detail'))), { oneLine: false });
  }
  await shot(`app-${name}-run-page-${theme}`);
  await open(`${base}/?p${name}-${theme}#chat/new/run/${pid}/overview`);
  await skipWelcome(); await setTheme(theme);
  if (await waitFor(`!!document.querySelector(${JSON.stringify(PANEL)})`, `the ${name} side panel (${theme})`)) {
    await sleep(800);
    const p = await ev(COUNTS(PANEL));
    check(p && p.rawLinks === 0 && !p.overflow, `${name} side panel, ${theme}: no raw browser link, no overflow (${JSON.stringify(p)})`);
    if (await ev(`!!document.querySelector(${JSON.stringify(`${PANEL} .run-agents .plan-check-row`)})`)) judge(`${name} side panel Agents`, theme, await ev(MEASURE(...AGENT_ROWS(PANEL))), { oneLine: false });
  }
  await shot(`app-${name}-side-panel-${theme}`);
}

// ---- D1 Ship: blocked, ready and done in the one card's ship step, beside the prototype's #ship moments.
const SHIP = '.chat-rc .chat-rc-ship .ask-shipcard';
const SHIP_ROWS = (list) => [`${SHIP} ${list}`, '.plan-check-row', '.plan-check-mark', '.plan-check-text'];
const SHIP_FACTS = `(() => { const r = [...document.querySelectorAll(${JSON.stringify(SHIP)})].find((x) => x.offsetParent); if (!r) return null;
  const c = r.querySelector('[data-act="ship-create"]'); const why = r.querySelector('.ask-shipcard-why');
  const vis = (els) => [...els].filter((b) => b.offsetParent);
  return { phase: r.dataset.shipCard, why: why ? why.textContent : null, create: c ? c.textContent : null, disabled: c ? c.disabled : null,
    primary: c ? c.classList.contains('btn-primary') : null, described: !!why && !!c && c.getAttribute('aria-describedby') === why.id,
    marks: vis(r.querySelectorAll('.ask-shipcard-mark .seg')).map((b) => b.getAttribute('aria-label')),
    pressed: vis(r.querySelectorAll('.ask-shipcard-mark [aria-pressed="true"]')).map((b) => b.textContent),
    note: (r.querySelector('.ask-shipcard-confirmed .plan-check-detail') || {}).textContent || null,
    reasonLine: (r.querySelector('.ask-shipcard-reason') || {}).textContent || null,
    stateDetail: (() => { const c = r.closest('.chat-rc'); const d = c && c.querySelector('.chat-rc-status .run-status-detail'); return d && !d.hidden ? d.textContent : null; })(),
    prsOpen: (() => { const c = r.closest('.chat-rc'); return c ? (c.innerText.match(/PRs open/g) || []).length : 0; })(),
    views: (() => { const c = r.closest('.chat-rc'); return c ? vis(c.querySelectorAll('a, button')).filter((b) => /^View PRs?$/.test(b.textContent.trim())).map((b) => b.textContent.trim()) : []; })(),
    care: vis(r.querySelectorAll('[data-fact="care"]')).length,
    waiting: (r.querySelector('.ask-mcard-body').textContent.match(/waiting for compliance/gi) || []).length,
    prs: vis(r.querySelectorAll('.ask-shipcard-prs .plan-check-row')).map((x) => [x.querySelector('.plan-check-id').textContent, x.querySelector('.plan-check-detail').textContent]),
    done: (r.querySelector('.ask-shipcard-done') || {}).textContent || null,
    careAbove: (() => { const k = r.querySelector('[data-fact="care"]'); const p = r.querySelector('.ask-shipcard-prs'); return !p || !!(k && (k.compareDocumentPosition(p) & 4)); })() };
})()`;
const SHIP_READY = (what, theme) => waitFor(`!!document.querySelector(${JSON.stringify(SHIP)})`, `${what} (${theme})`);
/** At 375px a Ship row's detail drops under its title (the .srows rule): rows there are judged at least 32px with the mark
 *  on the first text line; at 1280px every row is one 32px line. */
async function shipCells(theme, width) {
  const at = `${theme}, ${width}px`;
  if (await card(SB.threadId, `sb${width}`, 'the Ship blocked card', theme) && await SHIP_READY('the Ship blocked card', theme)) {
    await reveal(SHIP);
    const f = await ev(SHIP_FACTS);
    check(f && f.why === 'Waiting for Compliance to confirm R-comp-4' && f.waiting === 1 && !f.stateDetail, `ship blocked, ${at}: the reason once, no waiting step detail (${JSON.stringify(f)})`);
    check(f && f.create === 'Create 4 PRs' && f.disabled && !f.primary && f.described, `ship blocked, ${at}: Create 4 PRs disabled, not primary, described by the reason`);
    check(f && f.marks.length === 1 && f.marks[0] === 'Mark R-comp-4 as Compliance: The sign-up data stays in the EU' && f.pressed.length === 0 && f.care === 1,
      `ship blocked, ${at}: one unmarked Met / Not met / Dropped picker, one Care row`);
    const c = await ev(COUNTS('.chat-rc'));
    check(c && c.primaries.length === 0 && c.answer === 0 && c.rawLinks === 0, `ship blocked, ${at}: no primary, no Answer, no raw link (${JSON.stringify(c)})`);
    judge('ship blocked confirmed rows', theme, await ev(MEASURE(...SHIP_ROWS('.ask-shipcard-confirmed'))), { oneLine: false, width });
    await shot(`app-ship-blocked-${theme}-${width}`);
  }
  await prototypeShot('ship', null, `ship-blocked-${width}`, theme);
  if (await card(SR.threadId, `sr${width}`, 'the Ship ready card', theme) && await SHIP_READY('the Ship ready card', theme)) {
    await reveal(SHIP);
    const f = await ev(SHIP_FACTS);
    check(f && f.why === null && f.pressed.join() === 'Met' && f.create === 'Create 4 PRs' && !f.disabled && f.primary && f.care === 1, `ship ready, ${at}: Met marked, no reason, Create 4 PRs primary (${JSON.stringify(f)})`);
    const c = await ev(COUNTS('.chat-rc'));
    check(c && c.primaries.length === 1 && c.primaries[0] === 'Create 4 PRs' && c.answer === 0, `ship ready, ${at}: exactly one primary, no Answer (${JSON.stringify(c)})`);
    judge('ship ready confirmed rows', theme, await ev(MEASURE(...SHIP_ROWS('.ask-shipcard-confirmed'))), { oneLine: width > WIDTH, width });
    await shot(`app-ship-ready-${theme}-${width}`);
  }
  await prototypeShot('ship', ['[data-act="compok"]', '[data-mark="R-po-3:Met"]', '[data-mark="R-ux-2:Met"]'], `ship-ready-${width}`, theme);
  if (await card(SN.threadId, `sn${width}`, 'the Ship not-met card', theme) && await SHIP_READY('the Ship not-met card', theme)) {
    await reveal(SHIP);
    const f = await ev(SHIP_FACTS);
    check(f && f.pressed.join() === 'Not met' && /^Marked Not met by you/.test(f.note || '') && f.reasonLine === 'Legal has not signed the EU clause yet'
      && f.why === null && !f.disabled && f.primary, `ship not met, ${at}: the mark, the reason on its own line, Ship open (${JSON.stringify(f)})`);
    await shot(`app-ship-not-met-${theme}-${width}`);
  }
  if (await card(SD.threadId, `sd${width}`, 'the Ship done card', theme) && await SHIP_READY('the Ship done card', theme)) {
    await reveal(SHIP);
    const f = await ev(SHIP_FACTS);
    check(f && f.done === null && f.stateDetail === '4 PRs open' && f.prsOpen === 1 && f.care === 1 && f.careAbove,
      `ship done, ${at}: 4 PRs open once (the state line), the Care row once above the PRs (${JSON.stringify(f)})`);
    check(f && f.views.join() === 'View PRs', `ship done, ${at}: one view action, View PRs (${JSON.stringify(f && f.views)})`);
    check(f && f.prs.length === 4 && f.prs[0][1] === 'into main' && new Set(f.prs.map((x) => x[0])).size === 4, `ship done, ${at}: one row per PR, run 1 first into main`);
    const c = await ev(COUNTS('.chat-rc'));
    check(c && c.rawLinks === 0 && c.primaries.length === 0, `ship done, ${at}: no raw link, View PRs quiet (${JSON.stringify(c)})`);
    judge('ship done PR rows', theme, await ev(MEASURE(...SHIP_ROWS('.ask-shipcard-prs'))), { oneLine: width > WIDTH, width });
    await shot(`app-ship-done-${theme}-${width}`);
  }
  await prototypeShot('ship', ['[data-act="prdlg"]', '[data-act="prok"]'], `ship-done-${width}`, theme);
}

for (const theme of THEMES) {
  for (const width of [1280, WIDTH]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await shipCells(theme, width);
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: false });
  // ---- C5: verifying, gap found, the bound stop, no gap; the Verifier's and a gap run's run page and side panel.
  if (await card(VW.threadId, 'vw', 'the verifying card', theme)) {
    const s = await ev(STATUS);
    check(s && s.word === 'Verifying' && s.detail === 'the Verifier walks the main flow · 4 of 4 runs done', `verifying, ${theme}: word and detail (${JSON.stringify(s)})`);
    const c = await ev(COUNTS('.chat-rc'));
    check(c && c.questions === 0 && !c.primaries.includes('Pause') && !c.overflow, `verifying, ${theme}: no question, no Pause, no overflow (${JSON.stringify(c)})`);
    await reveal('.chat-rc-members'); judge('verifying run rows', theme, await ev(MEASURE(...RUN_ROWS)));
    await shot(`app-verifier-verifying-${theme}`);
  }
  await prototypeShot('verifier', '[data-vf="vw"]', 'verifier-verifying', theme);
  if (await card(VF.threadId, 'vf', 'the gap-found card', theme)) {
    const s = await ev(STATUS);
    check(s && s.word === 'Working' && s.detail === '4 of 5 runs done', `gap found, ${theme}: word and detail (${JSON.stringify(s)})`);
    const logs = await ev(LOGS);
    check(logs.includes('Verifier: 3 of 4 hold · 1 gap · run 5 added for it'), `gap found, ${theme}: the gap receipt (${JSON.stringify(logs)})`);
    const c = await ev(COUNTS('.chat-rc'));
    check(c && c.gapLists === 1, `gap found, ${theme}: one gap list (${JSON.stringify(c)})`);
    const words = await ev("[...document.querySelectorAll('.chat-rc-members .run-member .run-member-state')].map((n) => n.textContent)");
    check(words.length === 5, `gap found, ${theme}: the gap run is a run row (${JSON.stringify(words)})`);
    await reveal('.chat-rc .verify-gaps'); judge('verifier gap list', theme, await ev(MEASURE(...GAP_ROWS('.chat-rc'))), { oneLine: false });
    await judgeVerifyLine('gap found', theme);
    await reveal('.chat-rc-members'); judge('gap found run rows', theme, await ev(MEASURE(...RUN_ROWS)));
    await shot(`app-verifier-gap-found-${theme}`);
  }
  await prototypeShot('verifier', '[data-vf="vf"]', 'verifier-gap-found', theme);
  if (await card(VA.threadId, 'va', 'the bound stop card', theme)) {
    if (await waitFor("!!document.querySelector('.chat-rc .qpanel .verify-gaps')", `the bound stop's question (${theme})`)) {
      await reveal('.chat-rc .qopt');
      const s = await ev(STATUS);
      check(s && s.word === 'Needs you', `bound stop, ${theme}: Needs you (${JSON.stringify(s)})`);
      const c = await ev(COUNTS('.chat-rc'));
      check(c && c.questions === 1 && c.primaries.length === 1 && c.primaries[0] === 'Add a run for the gap' && c.answer === 0 && c.gapLists === 1,
        `bound stop, ${theme}: one question, one primary naming the pick, no Answer, one gap list (${JSON.stringify(c)})`);
      check(c && /Add a run for the gap/.test(c.preset || ''), `bound stop, ${theme}: Worca's pick preselected`);
      judge('bound stop gap list', theme, await ev(MEASURE(...GAP_ROWS('.chat-rc .qpanel'))), { oneLine: false });
      await shot(`app-verifier-bound-stop-${theme}`);
    }
  }
  if (await card(VC.threadId, 'vc', 'the no-gap card', theme)) {
    const s = await ev(STATUS);
    check(s && s.word === 'Ready to ship' && !s.detail, `no gap, ${theme}: Ready to ship, said once (${JSON.stringify(s)})`);
    const logs = await ev(LOGS);
    check(logs.includes('Verified: the 4 requirements owned by runs hold in the main flow'), `no gap, ${theme}: the clean receipt (${JSON.stringify(logs)})`);
    await reveal('.chat-rc .chat-rc-log-verify'); await judgeVerifyLine('no gap', theme);
    await shot(`app-verifier-no-gap-${theme}`);
  }
  await prototypeShot('ship', null, 'ship', theme);
  await runViews(`run-${VW_RUN}`, VW_RUN, 'verifier', theme);
  await runViews(`run-${GAP_RUN}`, GAP_RUN, 'gap-run', theme);

  // ---- C1: the Prototype moments.
  for (const [seg, moment] of PROTO_MOMENTS) {
    if (await card(PROTO[moment].threadId, `p${moment}`, `the prototype ${moment} card`, theme)) {
      const c = await ev(COUNTS('.chat-rc'));
      check(c && !c.overflow && c.rawLinks === 0, `prototype ${moment}, ${theme}: no overflow, no raw link (${JSON.stringify(c)})`);
      // A moment whose card shows check rows (built, remark, building: the Lead row) gets them measured.
      if (await ev("[...document.querySelectorAll('.chat-rc .srows .plan-check-row')].some((r) => r.offsetParent)")) {
        judge(`prototype ${moment} rows`, theme, await ev(MEASURE('.chat-rc .srows:has(.plan-check-row)', '.plan-check-row', '.plan-check-mark', '.plan-check-text')), { oneLine: false });
      }
      await shot(`app-prototype-${moment}-${theme}`);
    }
    await prototypeShot('prototype', `[data-proto="${seg}"]`, `prototype-${moment}`, theme);
  }

  // ---- C2 + C3: the run rows with a stop open, the run panel's Agents, the answered fold.
  runs.get(RS_RUN).heldStop = null;
  if (await card(RS.threadId, 'rs', 'the run-stops card', theme)) {
    const c = await ev(COUNTS('.chat-rc'));
    check(c && c.questions === 1 && c.primaries.length === 1 && c.answer === 0, `run stop, ${theme}: one question, one primary, no Answer (${JSON.stringify(c)})`);
    await shot(`app-run-stops-question-${theme}`);
    await reveal('.chat-rc-members');
    const words = await ev("[...document.querySelectorAll('.chat-rc-members .run-member .run-member-state')].map((n) => n.textContent)");
    check(words.includes('waiting for you'), `waiting row, ${theme}: waiting for you (${JSON.stringify(words)})`);
    judge('build rows (stop open)', theme, await ev(MEASURE(...RUN_ROWS)));
    await shot(`app-build-rows-${theme}`);
  }
  await prototypeShot('build', null, 'build', theme);
  await prototypeShot('run-stops', null, 'run-stops', theme);
  await runViews(RS_RUN, RS.pid(2), 'run-panel', theme);
  await prototypeShot('run-panel', null, 'run-panel', theme);
  const res = await post('/api/answer', { runId: RS_RUN, id: RPQ.id, payload: { decision: 'another' } });
  check(res.ok, `run stop, ${theme}: the answer is held while run 3 builds (${res.status})`);
  if (await card(RS.threadId, 'rsa', 'the answered fold', theme)) {
    if (await waitFor("!!document.querySelector('.chat-rc .qpanel .chat-rc-log-row')", `the answered fold row (${theme})`)) {
      await reveal('.chat-rc .qpanel .chat-rc-log-row');
      await shot(`app-run-stops-answered-${theme}`);
      judge('build rows (answer held)', theme, await ev(MEASURE(...RUN_ROWS)));
    }
  }

  // ---- C4: the change notice and "How a change lands".
  if (await card(RC.threadId, 'rc', 'the change notice', theme)) {
    if (await waitFor("!!document.querySelector('.chat-rc .req-change .cap')", `the change notice (${theme})`)) {
      await reveal('.chat-rc .req-change');
      judge('change fold', theme, await ev(MEASURE(...FOLD_ROWS)), { oneLine: false });
      await shot(`app-req-change-${theme}`);
    }
  }
  await prototypeShot('req-change', null, 'req-change', theme);
}

// ---- D1 Ship keyboard (light, 375px): Tab reaches Met, its group's computed name names R-comp-4, Enter marks it (the
// real confirm verb), and the focus stays on Met through the confirm route's repaint.
const key1 = (key, code, vk, text) => cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, ...(text ? { text } : {}) })
  .then(() => cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk }));
if (await card(SK.threadId, 'sk', 'the Ship keyboard card', 'light') && await SHIP_READY('the Ship keyboard card', 'light')) {
  await reveal(SHIP);
  const BTN = `${SHIP} [data-act="ship-mark-R-comp-4-met"]`;
  const GROUP = `${SHIP} .ask-shipcard-mark .seg`;
  // Focus the control just before Met in tab order, then one real Tab.
  await ev(`(() => { const all = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')]
    .filter((e) => e.offsetParent && !e.disabled && e.tabIndex >= 0); const b = document.querySelector(${JSON.stringify(BTN)});
    const i = all.indexOf(b); if (i > 0) all[i - 1].focus(); return i; })()`);
  await key1('Tab', 'Tab', 9);
  const reached = await ev(`document.activeElement === document.querySelector(${JSON.stringify(BTN)})`);
  check(reached, 'ship keyboard: Tab reaches Met');
  const { root } = await cdp('DOM.getDocument', { depth: 0 });
  const { nodeId } = await cdp('DOM.querySelector', { nodeId: root.nodeId, selector: GROUP });
  const ax = nodeId ? await cdp('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false }) : null;
  const name = ax && ax.nodes && ax.nodes[0] && ax.nodes[0].name ? ax.nodes[0].name.value : '';
  check(/R-comp-4/.test(name), `ship keyboard: the computed name names R-comp-4 (${JSON.stringify(name)})`);
  await key1('Enter', 'Enter', 13, '\r');
  await waitFor(`document.querySelector(${JSON.stringify(BTN)})?.getAttribute('aria-pressed') === 'true'`, 'the Met row to read confirmed');
  await sleep(400);
  const focus = await ev(`(() => { const a = document.activeElement; return { act: a.dataset ? a.dataset.act : null, pressed: a.getAttribute('aria-pressed'),
    note: (document.querySelector(${JSON.stringify(`${SHIP} .ask-shipcard-confirmed .plan-check-detail`)}) || {}).textContent }; })()`);
  check(focus && focus.act === 'ship-mark-R-comp-4-met' && focus.pressed === 'true' && /^confirmed by Compliance/.test(focus.note || ''), `ship keyboard: the focus stays on Met (${JSON.stringify(focus)})`);
  await shot('app-ship-keyboard-confirmed-light');
}

// ---- one reduced-motion capture of Prototype building.
await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
if (await card(PROTO.building.threadId, 'rm', 'the reduced-motion prototype building card', 'light')) await shot('app-prototype-building-reduced-motion-light');
await cdp('Emulation.setEmulatedMedia', { features: [] });

// ---- the live phase (item 6): a real paced mock Design build behind a Chat card whose saved Prototype state is
// `building`. The card subscribes to the build's frames (app.js) and follows them; nothing is seeded on the page.
const LIVE_SCREENS = [{ id: 'R-ux-1', text: 'The sign-up form asks for an email and a password' },
  { id: 'R-ux-2', text: 'The welcome page greets the new member by name' }];
async function liveBuild(tag) {
  process.env.WORCA_MOCK_DESIGN_MS = '400';   // at 1500 ms the mock Lead plans for ~2.5 min before the first screen row
  const designId = createPrototypeDesign({ projectKey: key, title: `Sign-up live ${tag}` });
  const started = await startPrototypeBuild({ designId, brief: prototypeBrief({ title: `Sign-up live ${tag}`, requirements: LIVE_SCREENS }), deps: { designBuilds } });
  check(!started.refused && started.buildId, `live ${tag}: the paced mock Design build started (${JSON.stringify(started)})`);
  if (started.refused || !started.buildId) return null;
  const pid = `c5lv${tag}00001`;
  const rec = PROTO_REC('building', { designId, buildId: started.buildId, screenIds: LIVE_SCREENS.map((x) => x.id), screens: [] });
  pipeline(pid, 'running', `Sign-up live ${tag}`, { smallRuns: true, care: careRec, prototype: rec });
  liveRun(pid, `Sign-up live ${tag}`, { at: 'n_refine', runShape: { perspectives: ['product', 'ux'] } });
  return thread(`Sign-up live ${tag}`, pid);
}
const MID = "(() => { const rows = [...document.querySelectorAll('.chat-rc .proto-rows[aria-busy=\"true\"] .plan-check-row')].filter((r) => r.offsetParent);"
  + " return rows.length >= 2 && !!document.querySelector('.chat-rc .proto-col .proto-piece'); })()";
const LIVE_ROWS = "[...document.querySelectorAll('.chat-rc .proto-rows .plan-check-row')].map((r) => r.textContent.trim())";
{
  const t = await liveBuild('mid');
  if (t && await card(t, 'lvm', 'the live building card', 'light')) {
    if (await waitFor(MID, 'the live build: the Lead row, a row per screen and a piece (light)', 120000)) {
      await reveal('.chat-rc .proto-rows');
      const rows = await ev(LIVE_ROWS);
      check(rows.length >= 3 && /^Lead/.test(rows[0]), `live build: the Lead row, then one row per planned screen (${JSON.stringify(rows)})`);
      results.live = { rows, live: await ev("document.querySelectorAll('.chat-rc .proto-rows .plan-check-mark.is-live').length"),
        pieces: await ev("document.querySelectorAll('.chat-rc .proto-col .proto-piece').length") };
      await shot('chat-prototype-building-mid-light');
    }
  }
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const r = await liveBuild('rm');
  if (r && await card(r, 'lvr', 'the live reduced-motion building card', 'light')) {
    if (await waitFor(MID, 'the live build with reduced motion (light)', 120000)) {
      await reveal('.chat-rc .proto-rows');
      await shot('chat-prototype-building-reduced-motion-light');
    }
  }
  await cdp('Emulation.setEmulatedMedia', { features: [] });
}

check(errors.length === 0, `no page errors${errors.length ? ` — ${errors.slice(0, 3).join(' | ')}` : ''}`);
results.minutes = Math.round((Date.now() - T0) / 600) / 100;
results.failed = failed;
const verdict = failed ? `${failed} FAILED` : 'all passed';
writeLog(verdict);
log(`${results.shots.length} PNGs and ${logFile} in ${results.minutes} min; ${verdict}`);
await shutdown(failed ? 1 : 0);
