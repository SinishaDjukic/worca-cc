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
// D2 (D2_ONLY=1 runs it alone): the cases runs-list, run-facts, agents-place and card-members of a marked 10-run
//   feature, in light and dark at 375px and 1280px at Expert, and the flag-off control's Agents places per page;
// D3 (D3_ONLY=1 runs it alone): the feature page's Requirements (one fold per role) and Decisions tabs of a marked
//   feature before and after Ship, light and dark at 1280px and 375px, beside the prototype's `#feature` tabs;
// the held row (HELD_ONLY=1 runs it alone): a run held on a clash, its reason and one Start now, light and dark at 1280px;
// the take-in (last; TAKEIN_ONLY=1 runs it alone): the moved step a run that waited at a stop logs once it took in a
//   finished run's work, and its stop's "Not sent: …" line after a refused take-in, light and dark at 1280px;
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
const { projectKey, projectStorePath } = await imp('../src/core/store.mjs');
const { addProject } = await imp('../src/core/projects.mjs');
const { writeStoreMeta, recordArtifact, appendAuditById } = await imp('../src/core/artifacts.mjs');
const { createSliceFeature, recordShapePlan, changeAgreedRequirements, setFeatureAcceptance, recordShip, setClashHold } = await imp('../src/core/shape/features.mjs');
const askStore = await imp('../src/core/ask/store.mjs');
const { normalizeOutline } = await imp('../src/shared/shape/slices.mjs');
const { gateStop } = await imp('../src/shared/shape/run-stops.mjs');
const { baseMovedAudit } = await imp('../src/core/git-sync.mjs');
const { verifyStop } = await imp('../src/shared/shape/verifier.mjs');
const { prototypeView } = await imp('../src/shared/shape/prototype.mjs');
const { careRunPlan } = await imp('../src/shared/shape/feature-record.mjs');
const { runRolesOf } = await imp('../src/shared/shape/requirements.mjs');
const { careRunGraph } = await imp('../src/core/shape/care-run.mjs');
const { resolveGraph } = await imp('../src/core/workflows.mjs');
const { loadAgentRegistry } = await imp('../src/core/agent-registry.mjs');
const { buildGraphManifest } = await imp('../src/shared/graph/manifest.mjs');
const { createPrototypeDesign, startPrototypeBuild, prototypeBrief } = await imp('../src/core/shape/prototype-design.mjs');
const { designBuilds, _testing: { heldStops } } = await imp('../ui/server.mjs');
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
function seedFeature(tag, title, states, { withOutline = outline, requirementKinds = null, titles = TITLES } = {}) {
  const pid = (k) => `c5${tag}00000${k}`;
  pipeline(pid(1), states[0], title, { smallRuns: true, care: careRec });
  const f = createSliceFeature({ pipelineId: pid(1), projectDir: proj, title, outline: withOutline, perspectives: ['product', 'architect'], workflowId: 'wf_shape',
    smallRuns: true, care, requirementKinds });
  states.forEach((st, i) => {
    const k = i + 1;
    if (k > 1 && st !== 'planned') fire(f, k, pid(k), st, `Run ${k} · ${titles[i]}`);
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
// The Care outcome needs the feature's recorded figures (measure.mjs writes them when a feature finishes): ready and done
// carry them, blocked has none (its Care row is the choice alone).
const FIGURES = { requirementsMet: { met: 4, total: 5 }, gapsAtEnd: 1, changesAfterShip: 0 };
const figures = (fid) => getDb().prepare(`INSERT INTO shape_feature_figures (feature_id, care, figures, recorded_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
  .run(fid, 'balanced', JSON.stringify(FIGURES), now, now);
const SR = shipFeature('sr', 'Ship ready');
setFeatureAcceptance(SR.f.id, [COMP_MET]);
figures(SR.f.id);
const SD = shipFeature('sd', 'Ship done');
// Done with R-comp-4 Not met: its row sits under the PR rows.
setFeatureAcceptance(SD.f.id, [{ ...COMP_MET, mark: 'not-met', reason: 'Legal has not signed the EU clause yet' }]);
figures(SD.f.id);
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
    careText: (r.querySelector('[data-fact="care"] .rd-kv-v') || {}).textContent || null,
    stats: (r.querySelector('.ask-shipcard-stats') || {}).textContent || null,
    titled: !!r.querySelector('.ask-mcard-title'),
    whyIds: why ? [...why.querySelectorAll('.ask-shipcard-id')].map((x) => [x.textContent, x.getBoundingClientRect().height]) : [],
    whyLine: why ? parseFloat(getComputedStyle(why).lineHeight) || 0 : 0,
    unmet: vis(r.querySelectorAll('.ask-shipcard-unmet .plan-check-row')).map((x) => [x.querySelector('.plan-check-id').textContent, x.querySelector('.plan-check-detail').textContent]),
    unmetBelow: (() => { const p = r.querySelector('.ask-shipcard-prs'); const u = r.querySelector('.ask-shipcard-unmet'); return !!(p && u && (p.compareDocumentPosition(u) & 4)); })(),
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
    check(f && f.why === 'Waiting for Compliance to confirm R-comp-4' && f.waiting === 1 && f.stateDetail === 'waiting for Compliance',
      `ship blocked, ${at}: the reason once in the card; the step detail names who it waits for (D1 shipDetail, the owner's call) (${JSON.stringify(f)})`);
    check(f && f.create === 'Create 4 PRs' && f.disabled && !f.primary && f.described, `ship blocked, ${at}: Create 4 PRs disabled, not primary, described by the reason`);
    check(f && f.marks.length === 1 && f.marks[0] === 'Mark R-comp-4 as Compliance: The sign-up data stays in the EU' && f.pressed.length === 0 && f.care === 1,
      `ship blocked, ${at}: one unmarked Met / Not met / Dropped picker, one Care row`);
    check(f && f.careText === "Balanced · Worca's pick" && f.stats === 'Your turn: mark what only a person can' && !f.titled,
      `ship blocked, ${at}: Care kept as Worca's pick with no outcome (no figures), the step named once with no feature title (${JSON.stringify(f)})`);
    check(f && f.whyIds.length === 1 && f.whyIds[0][0] === 'R-comp-4' && f.whyIds[0][1] <= f.whyLine * 1.5,
      `ship blocked, ${at}: R-comp-4 in the reason stays on one line (${JSON.stringify(f && f.whyIds)})`);
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
    check(f && f.stats === 'Ready to ship' && !f.titled
      && /^Balanced · Worca's pick · \d of 5 built requirements met · 1 gap found at the end · 0 changes after ship so far$/.test(f.careText || ''),
    `ship ready, ${at}: Ready to ship, the Care outcome from the recorded figures (${JSON.stringify(f && [f.stats, f.careText])})`);
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
    check(f && /^Balanced · Worca's pick · \d of 5 built requirements met · 1 gap found at the end · 0 changes after ship so far$/.test(f.careText || '') && !f.titled,
      `ship done, ${at}: the Care outcome from the recorded figures (${JSON.stringify(f && f.careText)})`);
    // D3 (D5): with the flag on, the row reads the one shared status (its confirmed entry's shown.text).
    check(f && f.unmetBelow && f.unmet.length === 1 && f.unmet[0][0] === 'R-comp-4' && f.unmet[0][1] === 'Marked Not met by you · Legal has not signed the EU clause yet',
      `ship done, ${at}: the Not met row under the PR rows (${JSON.stringify(f && f.unmet)})`);
    check(f && f.views.join() === 'View PRs', `ship done, ${at}: one view action, View PRs (${JSON.stringify(f && f.views)})`);
    check(f && f.prs.length === 4 && f.prs[0][1] === 'into main' && new Set(f.prs.map((x) => x[0])).size === 4, `ship done, ${at}: one row per PR, run 1 first into main`);
    const c = await ev(COUNTS('.chat-rc'));
    check(c && c.rawLinks === 0 && c.primaries.length === 0, `ship done, ${at}: no raw link, View PRs quiet (${JSON.stringify(c)})`);
    judge('ship done PR rows', theme, await ev(MEASURE(...SHIP_ROWS('.ask-shipcard-prs'))), { oneLine: width > WIDTH, width });
    await shot(`app-ship-done-${theme}-${width}`);
  }
  await prototypeShot('ship', ['[data-act="prdlg"]', '[data-act="prok"]'], `ship-done-${width}`, theme);
}

// ---- Shaper small runs D2: the Runs-list group row and its one-line members, the run's facts (Starts from, Owns) and
// the one Agents place on the live page, the saved page and the panel, and the chat card's members. A marked 10-run
// feature: run 1 (the planning run) and runs 2–9 done, run 10 live with stages, run 3 with a fix round. Cases:
// runs-list, run-facts, agents-place, card-members; light and dark, 375px and 1280px, Expert. The flag-off control
// flips the flag on the same server and seed (D18), counts the Agents places per page, then turns it back on.
// Run 4's title is long on purpose: the D4 truncation proof (the title ellipsizes, the short word keeps its natural width).
const D2_LONG = 4;
const D2_TITLES = ['Store sign-ups', 'Welcome email', 'Show the sign-up form',
  'List new members with their sign-up source, their referral code, their chosen plan and the date they joined', 'Export the member list',
  'Filter members by date', 'Sort the member list', 'Page through members', 'Search members by name', 'Show a member count'];
const D2_AGREED = D2_TITLES.map((t, i) => ({ id: i === 9 ? 'R-arch-10' : `R-po-${i + 1}`, text: t, example: `example ${i + 1}` }));
const d2Outline = normalizeOutline({ why: 'proof', leftOut: [], slices: D2_TITLES.map((title, i) => ({ id: `s${i + 1}`, title, goal: `Goal ${i + 1}`,
  inScope: [], outOfScope: [], acceptance: [`ok ${i + 1}`], dependsOn: [], estimate: 'small', requirements: [D2_AGREED[i].id] })) }, { agreed: D2_AGREED }).outline;
const D2 = seedFeature('d2', 'Member admin', [...Array(9).fill('done'), 'running'], { withOutline: d2Outline, titles: D2_TITLES });
const D2_LIVE = D2.pid(10);
const D2_SAVED = D2.pid(2);
// Each run starts from the run before it (run 1 from the feature base): its stored branch source.
for (let k = 2; k <= 10; k++) getDb().prepare('UPDATE pipelines SET branch = ? WHERE id = ?').run(JSON.stringify({ source: `feat/${D2.pid(k - 1)}`, feature: `feat/${D2.pid(k)}` }), D2.pid(k));
// The done runs carry their Care graph, done steps and plan v1 + v2 (the saved page's Agents rows and the Planner detail).
for (let k = 1; k <= 9; k++) {
  const pid = D2.pid(k);
  getDb().prepare('UPDATE pipelines SET stepper = ?, total_cost_usd = ? WHERE id = ?').run(JSON.stringify(stepper), 0.41, pid);
  for (const n of ['n_clarify', 'n_plan', 'n_roles', 'n_refine', 'n_tests', 'n_impl', 'n_review']) {
    getDb().prepare('INSERT INTO pipeline_steps (pipeline_id, key, node_id, cycle, status, started_at, execution_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(pid, `x:${n}:1`, n, 1, 'done', now, `x:${n}:1`);
  }
  recordArtifact(pid, 'plan', `plans/d2-run-${k}.md`);
  recordArtifact(pid, 'plan', `plans/d2-run-${k}-v2.md`);
}
// Run 3's fix round (a done Watch round): the member keeps dev's rounds line under its row.
pipeline('c5d2r00003', 'done', 'Fix round 2 of run 3');
getDb().prepare('UPDATE pipelines SET branch = ? WHERE id = ?').run(JSON.stringify({ source: 'main', feature: 'feat/c5d2r00003',
  roundOf: { pipelineId: D2.pid(3), round: 2, request: 'merge dev in', by: 'watch' } }), 'c5d2r00003');
const D2_RUN = liveRun(D2_LIVE, `Run 10 · ${D2_TITLES[9]}`, { at: 'n_impl', runShape: { slice: { feature: D2.f.id, index: 10 } } });
const D2_SAVED_URL = `#history/${key}/${D2_SAVED}/details/overview`;

/** The Runs-list members of the D2 group: each one-line row (an anchor without a stage block) at 32px, its dot in one
 *  mark column; the staged live member's stage block whole inside its anchor. */
const D2_MEMBERS = `(() => {
  const g = document.querySelector('.runs-item[data-row-key="chain:${D2.f.id}"]');
  if (!g) return { found: false };
  const items = [...g.querySelectorAll('.srows.runs-members > .runs-item')];
  const rows = items.map((it) => {
    const a = it.querySelector(':scope > a.runs-row'); const dot = it.querySelector(':scope > .runs-pick .status-dot');
    const t = a.querySelector('.runs-row-title'); const ab = a.getBoundingClientRect(); const db = dot.getBoundingClientRect(); const tb = t.getBoundingClientRect();
    const stage = a.querySelector(':scope > .runs-stage');
    // The D4 truncation proof: the line keeps its natural width (never clipped), the title is what ellipsizes.
    const sub = a.querySelector(':scope > .runs-row-sub'); const sb = sub ? sub.getBoundingClientRect() : null;
    return { text: t.textContent, pid: a.dataset.pipelineId || '', height: Math.round(ab.height * 10) / 10, staged: !!stage,
      sub: sub ? sub.textContent : null, subW: sb ? Math.round(sb.width * 10) / 10 : null, subScroll: sub ? sub.scrollWidth : null, subClient: sub ? sub.clientWidth : null,
      titleCut: t.scrollWidth > t.clientWidth, titleEllipsis: getComputedStyle(t).textOverflow === 'ellipsis', anchorFits: a.scrollWidth <= a.clientWidth + 1,
      stageInside: stage ? stage.getBoundingClientRect().bottom <= ab.bottom + 0.5 : null, rounds: !!it.querySelector(':scope > .runs-rounds-line'),
      markX: db.left + db.width / 2, markY: db.top + db.height / 2, textY: tb.top + tb.height / 2,
      textLines: Math.round(tb.height / (parseFloat(getComputedStyle(t).lineHeight) || 20)) };
  });
  const one = rows.filter((r) => !r.staged);
  const xs = one.map((r) => r.markX);
  return { found: true, groups: document.querySelectorAll('.runs-item[data-row-key="chain:${D2.f.id}"]').length, rows,
    spreadX: xs.length ? Math.max(...xs) - Math.min(...xs) : 0, maxDy: Math.max(0, ...one.map((r) => Math.abs(r.markY - r.textY))),
    shown: !!g.offsetParent && !!g.querySelector(':scope > a.runs-row').getClientRects().length,
    cost: [...g.querySelectorAll(':scope > a.runs-row .runs-cost')].filter((c) => c.offsetParent).length, costTitle: g.querySelector(':scope > a.runs-row').getAttribute('title'),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth };
})()`;
/** Visible Agents places under `scope`: the `.rd-run-agents` box plus the Agents tab, in the row or under "More". */
const AGENT_PLACES = (scope) => `(() => {
  const seen = (sel) => [...document.querySelectorAll(sel)].filter((x) => x.offsetParent && !x.hidden).length;
  const tab = seen(${JSON.stringify(`${scope} :is(.rd-tab, .hd-tab)[data-sec="agents"]`)});
  let menu = 0;
  const more = [...document.querySelectorAll(${JSON.stringify(`${scope} .tabs > .tab-more`)})].find((x) => x.offsetParent);
  if (more && !tab) {
    more.click();
    menu = [...document.querySelectorAll('body > .wfv-menu .wfv-menu-l')].filter((x) => x.textContent === 'Agents').length;
    more.click();
  }
  return seen(${JSON.stringify(`${scope} .rd-run-agents`)}) + tab + menu;
})()`;
/** The facts box: one "Starts from", each owned id once, every id and Owns label whole, and the box names neither the
 *  feature title nor the run's own "Run N". */
const FACTS = (scope, runN) => `(() => {
  const root = document.querySelector(${JSON.stringify(scope)});
  const box = root && [...root.querySelectorAll('.run-facts')].find((x) => x.offsetParent);
  if (!box) return { found: false };
  const whole = (els) => [...els].filter((e) => e.offsetParent).every((e) => e.scrollWidth <= e.clientWidth);
  const text = root.textContent;
  return { found: true, boxes: [...root.querySelectorAll('.run-facts')].filter((x) => x.offsetParent).length, starts: (text.match(/Starts from/g) || []).length,
    ids: [...box.querySelectorAll('.plan-check-id')].map((e) => [e.textContent, [...root.querySelectorAll('.plan-check-id')].filter((x) => x.textContent === e.textContent && x.offsetParent).length]),
    idsWhole: whole(box.querySelectorAll('.plan-check-id')), labelsWhole: whole(box.querySelectorAll('.plan-check-label')),
    wordsWhole: whole(box.querySelectorAll('.plan-check-detail')), words: [...box.querySelectorAll('.plan-check-detail')].map((e) => e.textContent),
    repeats: box.textContent.includes('Member admin') || new RegExp('\\\\bRun ${runN}\\\\b').test(box.textContent),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
})()`;
/** The done Planner row: 32px, and whether its detail ("plan v2 · after the plan review") is visible on the row's line. */
const PLANNER = (scope) => `(() => {
  const row = [...document.querySelectorAll(${JSON.stringify(`${scope} .run-agents .plan-check-row`)})].find((r) => r.offsetParent && r.querySelector('.plan-check-label').textContent === 'Planner');
  if (!row) return null;
  const d = row.querySelector('.plan-check-detail'); const t = row.querySelector('.plan-check-text');
  const db = d.getBoundingClientRect(); const tb = t.getBoundingClientRect();
  return { height: Math.round(row.getBoundingClientRect().height * 10) / 10, detail: d.textContent, shown: db.top < tb.bottom && db.bottom <= tb.bottom + 0.5 };
})()`;

async function d2Page(url, scope, name, theme, width, { runN = null, flagOff = false } = {}) {
  await open(url);
  await skipWelcome(); await setTheme(theme);
  const ok = await waitFor(`!!document.querySelector(${JSON.stringify(`${scope} .rd-run-agents`)}) || !!document.querySelector(${JSON.stringify(`${scope} :is(.rd-tab, .hd-tab)[data-sec="agents"]`)})`, `the D2 ${name} (${theme}, ${width}px)`);
  if (!ok) return null;
  await sleep(900);
  const places = await ev(AGENT_PLACES(scope));
  if (flagOff) return places;
  check(places === 1, `agents-place: ${name}, ${theme}, ${width}px: exactly 1 visible Agents place (${places})`);
  if (runN != null && await waitFor(`!!document.querySelector(${JSON.stringify(`${scope} .run-facts`)})`, `the D2 ${name} facts (${theme}, ${width}px)`)) {
    const f = await ev(FACTS(scope, runN));
    check(f.found && f.boxes === 1 && f.starts === 1 && f.ids.length >= 1 && f.ids.every(([, n]) => n === 1) && !f.repeats,
      `run-facts: ${name}, ${theme}, ${width}px: one box, "Starts from" once, each owned id once, no title or own run number (${JSON.stringify(f)})`);
    // D3 (D4): an Owns row carries its status word; at 375px the text shrinks first and the word stays whole (the row's
    // tooltip holds the text), so labels are judged whole at 1280px.
    check(f.idsWhole && f.wordsWhole && f.words.length > 0 && (width === WIDTH || f.labelsWhole) && !f.overflow,
      `run-facts: ${name}, ${theme}, ${width}px: every id and status word whole${width === WIDTH ? '' : ', every Owns label whole'}, no overflow (${JSON.stringify(f.words)})`);
    if (width === WIDTH) judge(`run-facts ${name} Owns`, theme, await ev(MEASURE(`${scope} .run-facts`, '.plan-check-row', '.plan-check-mark', '.plan-check-text')), { width });
  }
  if (width === WIDTH && await ev(`!!document.querySelector(${JSON.stringify(`${scope} .run-agents .plan-check-row`)})`)) {
    judge(`agents-place ${name} Agents`, theme, await ev(MEASURE(...AGENT_ROWS(scope))), { width });
  }
  await reveal(`${scope} :is(.run-facts, .run-agents)`);
  await sleep(200);
  return places;
}

async function d2Phase() {
  { const r = await post('/api/settings', { uiLevel: 'expert' }); check(r.ok, `D2: the Expert level is set (${r.status})`); }
  for (const theme of THEMES) {
    for (const width of [WIDTH, 1280]) {
      await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      // ---- runs-list: 1 group row, 10 members, member 1 = the planning run; one-line members 32px, one mark column.
      // #runs reopens the last run opened (the earlier cases' pages): forget it, so the list itself is on screen.
      await ev("(() => { try { localStorage.removeItem('worca-cc.runs.last'); } catch {} return 0; })()");
      await open(`${base}/?d2l-${theme}-${width}#runs`);
      await skipWelcome(); await setTheme(theme);
      if (await waitFor(`!!document.querySelector('.runs-item[data-row-key="chain:${D2.f.id}"]')`, `the D2 group row (${theme}, ${width}px)`)) {
        await ev(`(() => { const b = document.querySelector('.runs-item[data-row-key="chain:${D2.f.id}"] > .runs-row-tail .runs-expand'); if (b && b.getAttribute('aria-expanded') !== 'true') b.click(); return 1; })()`);
        await waitFor(`document.querySelectorAll('.runs-item[data-row-key="chain:${D2.f.id}"] .srows.runs-members > .runs-item').length === 10`, `the D2 group's 10 members (${theme}, ${width}px)`);
        await sleep(500);
        const m = await ev(D2_MEMBERS);
        results.lists.push({ list: 'runs-list D2 members', theme, width, ...m });
        check(m.found && m.shown && m.groups === 1 && m.rows.length === 10 && m.rows[0].pid === D2.pid(1) && m.rows[0].text.startsWith('1 · '),
          `runs-list, ${theme}, ${width}px: 1 group row, 10 members, member 1 is the planning run ${D2.pid(1)} (${JSON.stringify(m.found ? m.rows.map((r) => r.pid) : m)})`);
        check(m.cost === 1 && !m.costTitle, `runs-list, ${theme}, ${width}px: the cost is visible once and the anchor has no cost title`);
        const off = m.rows.filter((r) => !r.staged && (Math.abs(r.height - 32) > 1 || r.textLines > 1));
        check(!off.length, `runs-list, ${theme}, ${width}px: every one-line member is 32px (±1px) (${JSON.stringify(off.map((r) => [r.text, r.height]))})`);
        check(m.spreadX <= 1 && m.maxDy <= 1, `runs-list, ${theme}, ${width}px: one mark column (spread ${m.spreadX.toFixed(2)}px, max dy ${m.maxDy.toFixed(2)}px)`);
        check(m.rows.some((r) => r.staged) && m.rows.filter((r) => r.staged).every((r) => r.stageInside), `runs-list, ${theme}, ${width}px: the staged live member's .runs-stage bottom is inside its anchor`);
        check(m.rows.some((r) => r.rounds), `runs-list, ${theme}, ${width}px: the member with a fix round keeps its rounds line`);
        // Owner direction db0a5c6c7: a member says the card's short word; runs 1–9 finished, so each reads 'done' (run 3's
        // line is its fix round's, the rounds line below it: D6).
        const words = m.rows.slice(0, 9).filter((r) => !r.rounds).map((r) => r.sub);
        check(words.length === 8 && words.every((w) => w === 'done'), `runs-list, ${theme}, ${width}px: the finished members read the card's short word 'done' (${JSON.stringify(words)})`);
        // D4 truncation, measured: every member's line at its natural width (rect width = scrollWidth ±1px, never clipped).
        const clipped = m.rows.filter((r) => r.sub && (Math.abs(r.subW - r.subScroll) > 1 || r.subScroll > r.subClient));
        check(!clipped.length, `runs-list, ${theme}, ${width}px: every member's .runs-row-sub keeps its natural width (${JSON.stringify(m.rows.map((r) => [r.sub, r.subW, r.subScroll, r.subClient]))})`);
        const long = m.rows[D2_LONG - 1];
        check(long && long.titleEllipsis && long.titleCut && Math.abs(long.height - 32) <= 1 && long.anchorFits,
          `runs-list, ${theme}, ${width}px: the long-title member's title is what ellipsizes, its row stays 32px and nothing spills (${JSON.stringify(long)})`);
        check(!m.overflow && m.scrollWidth <= width, `runs-list, ${theme}, ${width}px: no horizontal overflow (scrollWidth ${m.scrollWidth})`);
        await reveal(`.runs-item[data-row-key="chain:${D2.f.id}"]`);
        await shot(`app-d2-runs-list-${theme}-${width}`);
      }
      // ---- run-facts and agents-place: the live page, the saved page, the panel.
      await d2Page(`${base}/?d2r-${theme}-${width}#running/${D2_RUN}`, '#run-detail', 'live run page', theme, width, { runN: 10 });
      await shot(`app-d2-run-page-${theme}-${width}`);
      await d2Page(`${base}/?d2h-${theme}-${width}${D2_SAVED_URL}`, '#hist-detail', 'saved run page', theme, width, { runN: 2 });
      const p = await ev(PLANNER('#hist-detail'));
      check(p && Math.abs(p.height - 32) <= 1 && p.detail === 'plan v2 · after the plan review' && (width === WIDTH || p.shown),
        `agents-place: the done Planner row with its long detail is 32px at ${width}px, the detail ${width === WIDTH ? 'never wraps' : 'shown'} (${JSON.stringify(p)})`);
      if (p) results.lists.push({ list: 'saved Planner row', theme, width, ...p });
      await shot(`app-d2-saved-page-${theme}-${width}`);
      await d2Page(`${base}/?d2p-${theme}-${width}#chat/new/run/${D2_LIVE}/overview`, PANEL, 'side panel', theme, width, { runN: 10 });
      await shot(`app-d2-side-panel-${theme}-${width}`);
      // ---- card-members: the chat card's one-line members, the Requirements fold collapsed.
      if (await card(D2.threadId, `d2c-${width}`, 'the D2 card', theme)) {
        await reveal('.chat-rc-members');
        check(await ev("!!document.querySelector('.chat-rc-members ol.run-members.is-one-line')"), `card-members, ${theme}, ${width}px: ol.run-members.is-one-line`);
        if (width === WIDTH) judge('card-members D2 run rows', theme, await ev(MEASURE(...RUN_ROWS)), { width });
        await shot(`app-d2-card-members-${theme}-${width}`);
      }
    }
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: false });
  // ---- the flag-off control (D18): the same server and seed, the flag off (env cleared, PATCH /api/flags), dev's places.
  delete process.env.WORCA_FLAGS;
  const offRes = await fetch(`${base}/api/flags`, { method: 'PATCH', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ shaperSmallRuns: false }) });
  check(offRes.ok, `flag-off control: PATCH /api/flags turns shaperSmallRuns off (${offRes.status})`);
  const live = await d2Page(`${base}/?d2off-r#running/${D2_RUN}`, '#run-detail', 'live run page (flag off)', 'light', WIDTH, { flagOff: true });
  const panel = await d2Page(`${base}/?d2off-p#chat/new/run/${D2_LIVE}/overview`, PANEL, 'side panel (flag off)', 'light', WIDTH, { flagOff: true });
  const saved = await d2Page(`${base}/?d2off-h${D2_SAVED_URL}`, '#hist-detail', 'saved run page (flag off)', 'light', WIDTH, { flagOff: true });
  results.flagOff = { live, panel, saved };
  check(live === 2 && panel === 2 && saved === 1, `flag-off control: dev's Agents places, live 2, panel 2, saved 1 (${JSON.stringify(results.flagOff)})`);
  check(await ev("!document.querySelector('.run-facts')"), 'flag-off control: no .run-facts node');
  const onRes = await fetch(`${base}/api/flags`, { method: 'PATCH', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ shaperSmallRuns: true }) });
  process.env.WORCA_FLAGS = 'shaperSmallRuns';
  check(onRes.ok, `flag-off control: the flag is back on (${onRes.status})`);
}
/** The closing lines: page errors, the verdict, the log. */
async function finish() {
  check(errors.length === 0, `no page errors${errors.length ? ` — ${errors.slice(0, 3).join(' | ')}` : ''}`);
  results.minutes = Math.round((Date.now() - T0) / 600) / 100;
  results.failed = failed;
  const verdict = failed ? `${failed} FAILED` : 'all passed';
  writeLog(verdict);
  log(`${results.shots.length} PNGs and ${logFile} in ${results.minutes} min; ${verdict}`);
  await shutdown(failed ? 1 : 0);
}

// ---- Shaper small runs D3: the feature page's Requirements and Decisions tabs. A marked feature: the planning run
// (run 1) and 4 runs, each owning one requirement, R-po-1's text changed after its run finished (a change run, run 6),
// R-comp-1 confirmed by Compliance. Before Ship: run 2 done, run 3 building, runs 4–6 not started, R-comp-1 waiting.
// After Ship: R-comp-1 marked Not met through POST /confirm with a short reason, every run done, the ship applied.
const D3_TITLES = ['Plan the member export', 'Export members as CSV', 'Email the export link', 'Keep a download log', 'Show the export button'];
const D3_AGREED = [...D3_TITLES.slice(1).map((t, i) => ({ id: `R-po-${i + 1}`, text: t, example: `example ${i + 1}` })),
  { id: 'R-comp-1', text: 'A signed copy of each export is kept', example: 'a PDF per export' }];
const d3Outline = normalizeOutline({ why: 'proof', leftOut: [], slices: D3_TITLES.map((title, i) => ({ id: `s${i + 1}`, title, goal: `Goal ${i + 1}`,
  inScope: [], outOfScope: [], acceptance: [`ok ${i + 1}`], dependsOn: [], estimate: 'small', requirements: i ? [`R-po-${i}`] : [] })) }, { agreed: D3_AGREED }).outline;
const D3 = seedFeature('d3', 'Member export', ['done', 'done', 'running', 'planned', 'planned'],
  { withOutline: d3Outline, titles: D3_TITLES, requirementKinds: { 'R-comp-1': { kind: 'confirmed', role: 'compliance' } } });
// The decision log's lines (featureLog reads the runs' audit lines): the planning run's agreed requirements and Split,
// run 2's approved plan.
appendAuditById(D3.pid(1), 'Requirements approval **approve** by proof.');
appendAuditById(D3.pid(1), 'Slice outline **approve** by proof.');
appendAuditById(D3.pid(2), 'Plan approval **approve** by proof.');
{ const r = reqChanges.apply(D3.f.id, [{ id: 'R-po-1', from: D3_AGREED[0].text, to: 'Export members as CSV with a header row' }], { kind: 'chat', by: 'proof' });
  check(r.ok && r.result.changes[0].case === 'finished', `seed: the D3 change lands on a change run (${JSON.stringify(r)})`); }
const D3_BEFORE = { 'R-po-1': 'run 2 · changed · run 6 builds it', 'R-po-2': 'run 3 · being built', 'R-po-3': 'run 4 · to do', 'R-po-4': 'run 5 · to do',
  'R-comp-1': 'confirmed by a person · Compliance' };
const D3_REASON = 'unsigned';
const D3_AFTER = { 'R-po-1': 'run 2 · met · changed by run 6', 'R-po-2': 'run 3 · met', 'R-po-3': 'run 4 · met', 'R-po-4': 'run 5 · met',
  'R-comp-1': `Marked Not met by you · ${D3_REASON}` };
const D3_REQS = '.gpage-requirements .shape-feature-reqs';
const D3_DECS = '.gpage-decisions.shape-feature-decisions';
/** The Requirements tab's facts: every row's note, whether an id spans two lines or a note is cut, each label's visible
 *  width, the run link's colour against the note's. Every role fold is opened first (an all-met role starts closed). */
const D3_REQ_FACTS = `(() => {
  const root = document.querySelector(${JSON.stringify(D3_REQS)});
  if (!root) return null;
  for (const h of root.querySelectorAll('.shape-role-fold-head[aria-expanded="false"]')) h.click();
  const lines = (el) => Math.round(el.getBoundingClientRect().height / (parseFloat(getComputedStyle(el).lineHeight) || 20));
  const rows = [...root.querySelectorAll('.plan-check-row')].filter((r) => r.offsetParent).map((r) => {
    const id = r.querySelector('.plan-check-id'); const d = r.querySelector('.plan-check-detail'); const l = r.querySelector('.plan-check-label');
    return { id: r.dataset.key, note: d.textContent, idLines: lines(id), noteCut: d.scrollWidth > d.clientWidth + 0.5, labelW: Math.round(l.getBoundingClientRect().width) };
  });
  const a = root.querySelector('a.rd-fact-link'); const d = a && a.closest('.plan-check-detail');
  return { tab: (document.querySelector('.gpage .rd-tab[aria-selected="true"]') || {}).dataset?.tab || null, hash: location.hash,
    cap: (root.querySelector('.shape-feature-reqs-cap') || {}).textContent || null, roles: [...root.querySelectorAll('.shape-role-fold-head')].map((h) => h.dataset.role),
    rows, link: a ? { href: a.getAttribute('href'), color: getComputedStyle(a).color, noteColor: getComputedStyle(d).color } : null,
    overflow: root.scrollWidth > root.clientWidth || document.documentElement.scrollWidth > document.documentElement.clientWidth,
    widths: [root.scrollWidth, root.clientWidth, document.documentElement.scrollWidth, document.documentElement.clientWidth],
    spill: [...root.querySelectorAll('*')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right + (parseFloat(getComputedStyle(e).marginRight) || 0) > root.getBoundingClientRect().right + 0.5; })
      .slice(0, 4).map((e) => [String(e.className && e.className.baseVal != null ? e.className.baseVal : e.className), e.tagName, Math.round(e.getBoundingClientRect().right - root.getBoundingClientRect().right), getComputedStyle(e).marginRight])
      .concat((() => { const out = []; const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const rr = root.getBoundingClientRect().right;
        for (let t = w.nextNode(); t && out.length < 4; t = w.nextNode()) { const r = document.createRange(); r.selectNodeContents(t);
          const b = [...r.getClientRects()].reduce((m, x) => Math.max(m, x.right), 0); if (b > rr + 0.5) out.push(['text', t.parentElement.className, t.textContent.slice(0, 30), Math.round(b - rr)]); }
        return out; })()) };
})()`;
/** The Decisions tab's facts: the Care row (once, first, its label whole), the other rows' labels, every Show fold closed. */
const D3_DEC_FACTS = `(() => {
  const root = document.querySelector(${JSON.stringify(D3_DECS)});
  if (!root) return null;
  const items = [...root.querySelectorAll(':scope > ul > li')];
  const care = root.querySelectorAll('[data-fact="care"]');
  const label = care[0] && care[0].querySelector('.plan-check-label');
  return { care: care.length, first: items[0] === care[0], careText: label ? label.textContent : null, careCut: label ? label.scrollWidth > label.clientWidth + 0.5 : null,
    lines: items.slice(1).map((li) => li.querySelector('.plan-check-label').textContent),
    decided: items.every((li) => li.querySelector('.plan-check-mark').getAttribute('aria-label') === 'decided'),
    folded: [...root.querySelectorAll('.chat-rc-log-detail')].every((x) => x.hidden),
    idLines: [...root.querySelectorAll('.plan-check-id')].filter((x) => x.textContent).map((x) => Math.round(x.getBoundingClientRect().height / (parseFloat(getComputedStyle(x).lineHeight) || 20))),
    overflow: root.scrollWidth > root.clientWidth || document.documentElement.scrollWidth > document.documentElement.clientWidth };
})()`;

async function d3Cells(phase, theme, width, want) {
  const at = `${phase}, ${theme}, ${width}px`;
  await open(`${base}/?d3r-${phase}-${theme}-${width}#feature/${D3.f.id}/requirements`);
  await skipWelcome(); await setTheme(theme);
  if (await waitFor(`!!document.querySelector(${JSON.stringify(`${D3_REQS} .plan-check-row`)})`, `the D3 Requirements tab (${at})`)) {
    await sleep(500);
    const f = await ev(D3_REQ_FACTS);
    results.lists.push({ list: `d3 requirements facts ${phase}`, theme, width, ...f });
    check(f && f.tab === 'requirements' && f.hash === `#feature/${D3.f.id}/requirements`, `requirements, ${at}: the deep link selects Requirements (${JSON.stringify(f && [f.tab, f.hash])})`);
    check(f && f.cap === '5 requirements · 4 owned by a run · 1 confirmed by a person' && f.roles.join() === 'product,compliance',
      `requirements, ${at}: the caption and one fold per role, Product then Compliance (${JSON.stringify(f && [f.cap, f.roles])})`);
    const notes = f ? Object.fromEntries(f.rows.map((r) => [r.id, r.note])) : {};
    check(f && f.rows.length === 5 && Object.keys(want).every((k) => notes[k] === want[k]),
      `requirements, ${at}: every row's status (${JSON.stringify(notes)})`);
    check(f && f.rows.every((r) => r.idLines <= 1), `requirements, ${at}: no id spans two lines`);
    check(f && f.rows.every((r) => !r.noteCut) && !f.overflow, `requirements, ${at}: no status note is cut, no overflow (${JSON.stringify(f && [f.rows.map((r) => [r.id, r.noteCut]), f.widths, f.spill])})`);
    check(f && f.link && f.link.href.startsWith('#') && f.link.color !== f.link.noteColor, `requirements, ${at}: the run link wears the link colour (${JSON.stringify(f && f.link)})`);
    if (width === WIDTH) results.lists.push({ list: `d3 requirements label widths ${phase}`, theme, width, labels: f ? f.rows.map((r) => [r.id, r.labelW]) : null });
    if (width === WIDTH) log(`d3 requirements ${at}: visible label widths ${JSON.stringify(f ? f.rows.map((r) => [r.id, r.labelW]) : null)}`);
    judge(`d3 requirements ${phase}`, theme, await ev(MEASURE(D3_REQS, '.plan-check-row', '.plan-check-mark', '.plan-check-text')), { width, oneLine: true });
    await reveal(D3_REQS);
    await shot(`app-d3-requirements-${phase}-${theme}-${width}`);
  }
  await open(`${base}/?d3d-${phase}-${theme}-${width}#feature/${D3.f.id}/decisions`);
  await skipWelcome(); await setTheme(theme);
  if (await waitFor(`!!document.querySelector(${JSON.stringify(`${D3_DECS} [data-fact="care"]`)})`, `the D3 Decisions tab (${at})`)) {
    await sleep(500);
    const f = await ev(D3_DEC_FACTS);
    results.lists.push({ list: `d3 decisions facts ${phase}`, theme, width, ...f });
    check(f && f.care === 1 && f.first && /^Care: Balanced/.test(f.careText || '') && !f.careCut, `decisions, ${at}: one Care row, first, its label whole (${JSON.stringify(f && [f.care, f.careText, f.careCut])})`);
    check(f && f.lines.length > 0 && f.decided && f.folded && f.idLines.every((n) => n <= 1) && !f.overflow,
      `decisions, ${at}: the log lines, each named decided, folds closed, ids on one line, no overflow (${JSON.stringify(f && f.lines)})`);
    judge(`d3 decisions ${phase}`, theme, await ev(MEASURE(D3_DECS, 'li:not([data-fact="care"]) > .plan-check-row', '.plan-check-mark', '.plan-check-text')), { width, oneLine: true });
    await shot(`app-d3-decisions-${phase}-${theme}-${width}`);
  }
}
/** The prototype's #feature after Ship: #ship at moment rs, Compliance confirmed, then a hash change in the same page. */
async function prototypeFeatureAfter(tab, name, theme) {
  await open(`${PROTO_URL}?${name}-${theme}#ship`); await setTheme(theme); await sleep(300);
  await ev(`(() => { const b = document.querySelector('[data-act="compok"]'); if (b) b.click(); return !!b; })()`); await sleep(300);
  await ev("(() => { location.hash = '#feature'; return 0; })()"); await sleep(500);
  for (const sel of ['[data-moment="rs"]', `[data-tab="${tab}"]`]) { await ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (b) b.click(); return !!b; })()`); await sleep(300); }
  await shot(`prototype-${name}-${theme}`);
}

async function d3Phase() {
  const t0 = Date.now();
  { const r = await post('/api/settings', { uiLevel: 'expert' }); check(r.ok, `D3: the Expert level is set (${r.status})`); }
  for (const theme of THEMES) {
    for (const width of [1280, WIDTH]) {
      await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await d3Cells('before', theme, width, D3_BEFORE);
    }
    await prototypeShot('feature', ['[data-moment="vf"]', '[data-tab="Requirements"]'], 'feature-requirements-before', theme);
    await prototypeShot('feature', ['[data-moment="vf"]', '[data-tab="Decisions"]'], 'feature-decisions-before', theme);
  }
  // Ship: R-comp-1 marked through the route, every run done, the ship applied (as the Ship done case seeds it).
  const r = await post(`/api/shape/features/${D3.f.id}/confirm`, { id: 'R-comp-1', mark: 'not-met', reason: D3_REASON });
  check(r.ok, `D3: POST /confirm marks R-comp-1 Not met (${r.status})`);
  getDb().prepare("UPDATE pipelines SET status = 'done' WHERE id = ?").run(D3.pid(3));
  for (const k of [4, 5, 6]) fire(D3.f, k, D3.pid(k), 'done', `Run ${k}`);
  [1, 2, 3, 4, 5, 6].forEach((k) => getDb().prepare("UPDATE pipelines SET pr_url = ?, pr_number = ?, pr_state = 'OPEN' WHERE id = ?")
    .run(`https://github.com/proof/repo/pull/${1530 + k}`, 1530 + k, D3.pid(k)));
  recordShip(D3.f.id, { mode: 'stacked' });
  for (const theme of THEMES) {
    for (const width of [1280, WIDTH]) {
      await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await d3Cells('after', theme, width, D3_AFTER);
    }
    await prototypeFeatureAfter('Requirements', 'feature-requirements-after', theme);
    await prototypeFeatureAfter('Decisions', 'feature-decisions-after', theme);
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: false });
  results.d3Minutes = Math.round((Date.now() - t0) / 600) / 100;
  log(`D3: ${results.d3Minutes} min`);
}

// ---- Shaper small runs, slice 2: a run held because the runs it builds on clash. A marked 4-run feature, runs 1 to 3
// done, run 4's ticket scheduled with "Ask me before each run" off, and the clash hold set as the fire-time check sets
// it. The Chat card's held row reads the reason, with one Start now, at 1280px in the classic look, light and dark:
// small-runs-held-clash-light.png and small-runs-held-clash-dark.png in SHOTS_DIR.
const HELD_REASON = 'runs 2 and 3 clash in src/a.mjs';
async function heldPhase() {
  const HC = seedFeature('hc', 'Clash', ['done', 'done', 'done', 'planned']);
  getDb().prepare('UPDATE shape_features SET approve_each = 0 WHERE id = ?').run(HC.f.id);
  const t4 = getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = 4').get(HC.f.id).ticket_id;
  setClashHold(t4, { reason: HELD_REASON, runs: [2, 3], files: ['src/a.mjs'], at: Date.now() });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const theme of THEMES) {
    if (!(await card(HC.threadId, 'held', 'the clash-held card', theme))) continue;
    if (await waitFor("!!document.querySelector('.chat-rc .shape-feature-held-why')", `the held row (${theme})`)) {
      const r = await ev(`(() => { const vis = (els) => [...els].filter((b) => b.offsetParent);
        return { why: (vis(document.querySelectorAll('.chat-rc .shape-feature-held-why'))[0] || {}).textContent || null,
          starts: vis(document.querySelectorAll('.chat-rc [data-act="feature-start"]')).filter((b) => b.textContent.trim() === 'Start now').length }; })()`);
      check(r.why === `Run 4 is held: ${HELD_REASON}`, `held row, ${theme}: "Run 4 is held: ${HELD_REASON}" (${JSON.stringify(r.why)})`);
      check(r.starts === 1, `held row, ${theme}: Start now shows once (${r.starts})`);
      await reveal('.chat-rc .shape-feature-held');
    }
    // A notice (feedback.mjs) can sit over the card's footer: dismiss each one before the capture.
    await ev("(() => { for (const b of document.querySelectorAll('button[aria-label=\"Dismiss\"]')) if (b.offsetParent) b.click(); return 0; })()");
    await sleep(400);
    const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
    const file = path.join(SHOTS, `small-runs-held-clash-${theme}.png`);
    await writeFile(file, Buffer.from(data, 'base64'));
    results.shots.push(file);
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: false });
}

// ---- Shaper small runs, slice 3: a run that waited at a stop takes in what finished meanwhile. A marked 4-run feature,
// runs 1 and 3 done, run 2 live at its stop. Run 2's audit line is the one the harness writes once it merged run 3's
// branch (`Base \`feat/run-3\` moved: merged into \`feat/run-2\` (1 commit).`), so the Chat card's log reads
// `feat/run-3 moved · run 2 starts from it`: small-runs-taken-in-light.png and -dark.png. Then run 2's entry carries a
// refused take-in (`takeInRefused`), and its open stop reads `Not sent: runs 2 and 3 clash in src/a.mjs`:
// small-runs-take-in-refused-light.png and -dark.png. 1280px, the classic look, in SHOTS_DIR.
const TAKEIN_REASON = 'runs 2 and 3 clash in src/a.mjs';
const TAKEIN_STEP = 'feat/run-3 moved · run 2 starts from it';
async function takeInPhase() {
  const TI = seedFeature('ti', 'Take in', ['done', 'running', 'done', 'planned']);
  const stop = gateStop({ run: 2, issues: ISSUES, fixCycles: 3, nodeId: 'n_review' });
  const pq = { id: 'gate-ti-3', kind: 'gate', wireId: 'w9', nodeId: 'n_review', executionId: 'x:n_review:3', deliveryNo: 3, issues: ISSUES, stop };
  const runId = liveRun(TI.pid(2), `Run 2 · ${TITLES[1]}`, { at: 'n_review', pendingQuestion: pq, runShape: { slice: { feature: TI.f.id, index: 2 } } });
  appendAuditById(TI.pid(2), baseMovedAudit('feat/run-3', 'feat/run-2', { merged: true, behind: 1 }));
  const capture = async (name) => {
    await ev("(() => { for (const b of document.querySelectorAll('button[aria-label=\"Dismiss\"]')) if (b.offsetParent) b.click(); return 0; })()");
    await sleep(400);
    const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
    const file = path.join(SHOTS, name);
    await writeFile(file, Buffer.from(data, 'base64'));
    results.shots.push(file);
  };
  const visibleText = (sel) => ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => e.offsetParent && !e.hidden).map((e) => e.textContent.trim())`);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const theme of THEMES) {
    if (!(await card(TI.threadId, 'takein', 'the take-in card', theme))) continue;
    const seen = await waitFor(`[...document.querySelectorAll('.chat-rc .chat-rc-log li')].some((li) => li.offsetParent && li.textContent.includes(${JSON.stringify(TAKEIN_STEP)}))`,
      `the moved step (${theme})`);
    check(seen, `take-in, ${theme}: the log reads "${TAKEIN_STEP}"`);
    if (seen) await ev(`(() => { const li = [...document.querySelectorAll('.chat-rc .chat-rc-log li')].find((x) => x.offsetParent && x.textContent.includes(${JSON.stringify(TAKEIN_STEP)})); if (li) li.scrollIntoView({ block: 'center' }); return !!li; })()`);
    await capture(`small-runs-taken-in-${theme}.png`);
  }
  runs.get(runId).takeInRefused = { id: pq.id, reason: TAKEIN_REASON };
  for (const theme of THEMES) {
    if (!(await card(TI.threadId, 'takein-refused', 'the refused take-in card', theme))) continue;
    const seen = await waitFor(`[...document.querySelectorAll('.chat-rc .plan-err')].some((e) => e.offsetParent && !e.hidden && e.textContent === ${JSON.stringify(`Not sent: ${TAKEIN_REASON}`)})`,
      `the refused stop (${theme})`);
    const lines = await visibleText('.chat-rc .plan-err');
    check(seen && lines.length === 1, `take-in refused, ${theme}: one "Not sent: ${TAKEIN_REASON}" line (${JSON.stringify(lines)})`);
    if (seen) await reveal('.chat-rc .plan-err');
    await capture(`small-runs-take-in-refused-${theme}.png`);
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: false });
}

// ---- Shaper small runs, slice 4: Ship lists the PRs along the real branches (the flag on, 1280px, the classic look).
// Two marked 4-run features with explicit `feat/run-N` branch records (runs 1 to 4 stand for the outline's 7 to 10):
// "Ship list", the waited shape (finish order 1, 3, 2, 4; run 2 took run 3 in): run 1 into the base, 3 onto #1, 2 onto #3,
// 4 onto #2, and the stats line only the rule writes, "stacked along the real branches": small-runs-ship-list-light.png
// and -dark.png. "Ship combined", the combine shape (run 4 started from run 3 and combined run 2): 3 PRs open, no row for
// run 2, though run 2 has a PR of its own (the finish-order fallback would list it): small-runs-ship-list-combined-light.png
// and -dark.png. Then the same combine seed not yet shipped: the ready card's Create reads "Create 3 PRs" (no shot).
async function shipListPhase() {
  const setBranches = (x, recs, finish) => {
    recs.forEach((rec, i) => {
      const k = i + 1;
      const at = new Date(Date.parse(now) + (finish.indexOf(k) + 1) * 60_000).toISOString();
      getDb().prepare('UPDATE pipelines SET branch = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(rec), at, x.pid(k));
    });
  };
  const withPrs = (x) => [1, 2, 3, 4].forEach((k) => getDb().prepare("UPDATE pipelines SET pr_url = ?, pr_number = ?, pr_state = 'OPEN' WHERE id = ?")
    .run(`https://github.com/proof/repo/pull/${k}`, k, x.pid(k)));
  const seed = (tag, title, recsOf, finish, { shipped = true } = {}) => {
    const x = shipFeature(tag, title);
    setFeatureAcceptance(x.f.id, [COMP_MET]);
    setBranches(x, recsOf(x), finish);
    if (shipped) { withPrs(x); recordShip(x.f.id, { mode: 'stacked' }); }
    return x;
  };
  const WAITED = (x) => [{ source: 'main', feature: 'feat/run-1' }, { source: 'feat/run-3', sourceFrom: 'feat/run-1', feature: 'feat/run-2',
    tookIn: [{ index: 3, branch: 'feat/run-3', pipelineId: x.pid(3) }] }, { source: 'feat/run-1', feature: 'feat/run-3' },
  { source: 'feat/run-2', feature: 'feat/run-4' }];
  const COMBINED = () => [{ source: 'main', feature: 'feat/run-1' }, { source: 'feat/run-1', feature: 'feat/run-2' },
    { source: 'feat/run-1', feature: 'feat/run-3' }, { source: 'feat/run-3', feature: 'feat/run-4', combined: [{ index: 2, branch: 'feat/run-2' }] }];
  const SL = seed('sl', 'Ship list', WAITED, [1, 3, 2, 4]);
  const SC = seed('sc', 'Ship combined', COMBINED, [1, 2, 3, 4]);
  const SQ = seed('sq', 'Ship combined ready', COMBINED, [1, 2, 3, 4], { shipped: false });
  // The ship rule wants a passed Verifier check for the tip of the head Ship ships (run 4): the branches exist in the
  // sandbox repo, all on its one commit.
  for (let k = 1; k <= 4; k++) execFileSync('git', ['branch', '-f', `feat/run-${k}`], { cwd: proj });
  const headSha = execFileSync('git', ['rev-parse', 'feat/run-4'], { cwd: proj, encoding: 'utf8' }).trim();
  pipeline('c5sqv00001', 'done', 'Ship combined ready · Verifier');
  setVerify(SQ.f, vCheck(SQ, 'c5sqv00001', 'clean', { headSha, result: { held: [...AGREED.map((a) => a.id), 'R-comp-4'], gaps: [] } }));
  const runsOf = (f) => (f ? f.prs.map(([, note], i) => [f.rowRuns[i], note]) : null);
  const ROW_RUNS = `[...document.querySelectorAll(${JSON.stringify(`${SHIP} .ask-shipcard-prs .plan-check-row`)})].filter((x) => x.offsetParent)
    .map((x) => Number((x.textContent.match(/run (\\d+) ·/) || [])[1]) || null)`;
  const facts = async () => { const f = await ev(SHIP_FACTS); if (f) f.rowRuns = await ev(ROW_RUNS); return f; };
  const capture = async (name) => {
    await ev("(() => { for (const b of document.querySelectorAll('button[aria-label=\"Dismiss\"]')) if (b.offsetParent) b.click(); return 0; })()");
    await reveal(SHIP);
    await sleep(400);
    const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
    const file = path.join(SHOTS, name);
    await writeFile(file, Buffer.from(data, 'base64'));
    results.shots.push(file);
  };
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const theme of THEMES) {
    if (await card(SL.threadId, 'shiplist', 'the Ship list card', theme) && await SHIP_READY('the Ship list card', theme)) {
      const f = await facts();
      check(f && f.stats === 'stacked along the real branches', `ship list, ${theme}: the stats line reads "stacked along the real branches" (${JSON.stringify(f && f.stats)})`);
      check(f && f.stateDetail === '4 PRs open', `ship list, ${theme}: 4 PRs open (${JSON.stringify(f && f.stateDetail)})`);
      check(JSON.stringify(runsOf(f)) === JSON.stringify([[1, 'into main'], [3, 'onto #1'], [2, 'onto #3'], [4, 'onto #2']]),
        `ship list, ${theme}: run 1 into main, run 3 onto #1, run 2 onto #3, run 4 onto #2 (${JSON.stringify(runsOf(f))})`);
      await capture(`small-runs-ship-list-${theme}.png`);
    }
    if (await card(SC.threadId, 'shipcombined', 'the Ship combined card', theme) && await SHIP_READY('the Ship combined card', theme)) {
      const f = await facts();
      check(f && f.stateDetail === '3 PRs open' && f.stats === 'stacked along the real branches',
        `ship combined, ${theme}: 3 PRs open, stacked along the real branches (${JSON.stringify(f && [f.stateDetail, f.stats])})`);
      check(JSON.stringify(runsOf(f)) === JSON.stringify([[1, 'into main'], [3, 'onto #1'], [4, 'onto #3']]),
        `ship combined, ${theme}: rows run 1, run 3, run 4 and none for run 2 (${JSON.stringify(runsOf(f))})`);
      await capture(`small-runs-ship-list-combined-${theme}.png`);
    }
  }
  if (await card(SQ.threadId, 'shipready', 'the Ship combined ready card', 'light') && await SHIP_READY('the Ship combined ready card', 'light')) {
    const f = await facts();
    check(f && f.create === 'Create 3 PRs' && !f.disabled, `ship combined ready: Create reads "Create 3 PRs" (${JSON.stringify(f && f.create)})`);
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: false });
}

// ---- Shaper small runs, slice 7: a resume waits its turn. A marked 4-run feature, run 1 done, run 2 working (a running
// runs-map entry), run 3 paused with a resume point and no runs-map entry. Run 3's saved page Resume is clicked: the
// server holds it after run 2, so the page keeps the paused run and a button that reads Resume, and no runs-map entry is
// made for run 3. 1280px, the classic look, light and dark: held-resume-light.png and held-resume-dark.png in SHOTS_DIR.
async function heldResumePhase() {
  const HR = seedFeature('hr', 'Held resume', ['done', 'running', 'planned', 'planned']);
  liveRun(HR.pid(2), `Run 2 · ${TITLES[1]}`, { runShape: { slice: { feature: HR.f.id, index: 2 } } });
  // Run 3 has what the saved page needs to offer Resume: an 8-hex id, its run folder, an onboarded project, a resume point.
  const five = 'ab7e0003';
  fire(HR.f, 3, five, 'paused', `Run 3 · ${TITLES[2]}`);
  getDb().prepare('UPDATE pipelines SET resume_point = ? WHERE id = ?').run(JSON.stringify({ version: 2, ledger: [], tokens: {} }), five);
  await mkdir(path.join(projectStorePath(key), 'pipelines', `held-resume-${five}`), { recursive: true });
  try { await addProject({ name: 'Proof', path: proj }); } catch { /* already onboarded */ }
  const RESUME = "[...document.querySelectorAll('#hist-detail .hd-resume')].find((b) => b.offsetParent)";
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const theme of THEMES) {
    await open(`${base}/?heldresume-${theme}#history/${key}/${five}`);
    await skipWelcome(); await setTheme(theme);
    if (!(await waitFor(`!!(${RESUME})`, `run 3's Resume (${theme})`))) continue;
    await skipWelcome();
    check(/Resume/.test(await ev(`(${RESUME}).textContent`)), `held resume, ${theme}: the saved page offers Resume`);
    // Slice 8: before the press, the Resume says which run it would wait for.
    check(await waitFor(`(${RESUME}).textContent.trim() === 'Resume after run 2'`, `run 3's Resume after run 2 (${theme})`),
      `held resume, ${theme}: before the click the button reads Resume after run 2 (${JSON.stringify(await ev(`(${RESUME}).textContent.trim()`))})`);
    await ev(`(${RESUME}).click()`);
    const back = await waitFor(`(() => { const b = ${RESUME}; return !!b && !b.disabled && b.textContent.trim() === 'Resume'; })()`, `the Resume button back (${theme})`);
    const held = await (await fetch(`${base}/api/shape/features/${HR.f.id}`)).json().catch(() => null);
    const row = held && (held.feature || held).slices?.find((x) => x.index === 3);
    check(back, `held resume, ${theme}: the button reads Resume again and is enabled`);
    check(row && row.state === 'paused', `held resume, ${theme}: run 3 still reads paused (${JSON.stringify(row && row.state)})`);
    check(![...runs.values()].some((e) => e.pipelineId === five), `held resume, ${theme}: no runs-map entry for run 3`);
    check(JSON.stringify(heldStops.heldResumeOf(five)) === '{"after":2}', `held resume, ${theme}: the server holds it after run 2 (${JSON.stringify(heldStops.heldResumeOf(five))})`);
    check(!(await ev("document.querySelector('#toasts')?.textContent.includes('Could not resume') || false")), `held resume, ${theme}: no refusal toast`);
    check(!(await ev("[...document.querySelectorAll('#hist-detail *')].some((e) => e.offsetParent && /^Starting/.test(e.textContent.trim()) && !e.children.length)")),
      `held resume, ${theme}: no phantom Starting run`);
    await ev("(() => { for (const b of document.querySelectorAll('button[aria-label=\"Dismiss\"]')) if (b.offsetParent) b.click(); return 0; })()");
    await sleep(400);
    const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
    const file = path.join(SHOTS, `held-resume-${theme}.png`);
    await writeFile(file, Buffer.from(data, 'base64'));
    results.shots.push(file);
    heldStops.dropResume(five);   // slice 8: the next theme starts from a paused run that is not held yet
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: false });
}

// ---- Shaper small runs, slice 8: the `after run N` row and the Resume wording. A marked 6-run feature, runs 1–3 done,
// run 4 working (a running runs-map entry), run 5 not started, run 6 paused with a resume point and no runs-map entry.
// At 1280px, light and dark: run 6's saved page Resume reads "Resume after run 4" (resume-after-run-THEME.png); it is
// clicked, the server holds it after run 4 and the button reads plain Resume; the feature page's Runs table row of run 6
// then reads "after run 4" on the after mark (after-run-row-THEME.png). Once at 375px in light, before the click: the
// label neither wraps nor overflows, on the saved page and in Chat's run panel.
const AR_TITLES = [...TITLES, 'Export the member list', 'Filter members by date'];
const AR_AGREED = AR_TITLES.map((t, i) => ({ id: `R-po-${i + 1}`, text: t, example: `example ${i + 1}` }));
const arOutline = normalizeOutline({ why: 'proof', leftOut: [], slices: AR_TITLES.map((title, i) => ({ id: `s${i + 1}`, title, goal: `Goal ${i + 1}`,
  inScope: [], outOfScope: [], acceptance: [`ok ${i + 1}`], dependsOn: [], estimate: 'small', requirements: [AR_AGREED[i].id] })) }, { agreed: AR_AGREED }).outline;
async function afterRunPhase() {
  const AR = seedFeature('ar', 'After run', ['done', 'done', 'done', 'running', 'planned', 'planned'], { withOutline: arOutline, titles: AR_TITLES });
  liveRun(AR.pid(4), `Run 4 · ${AR_TITLES[3]}`, { runShape: { slice: { feature: AR.f.id, index: 4 } } });
  const six = 'ab7e0006';
  fire(AR.f, 6, six, 'paused', `Run 6 · ${AR_TITLES[5]}`);
  getDb().prepare('UPDATE pipelines SET resume_point = ? WHERE id = ?').run(JSON.stringify({ version: 2, ledger: [], tokens: {} }), six);
  await mkdir(path.join(projectStorePath(key), 'pipelines', `after-run-${six}`), { recursive: true });
  try { await addProject({ name: 'Proof', path: proj }); } catch { /* already onboarded */ }
  const RESUME = "[...document.querySelectorAll('#hist-detail .hd-resume')].find((b) => b.offsetParent)";
  const WAITS = `(() => { const b = ${RESUME}; return !!b && b.textContent.trim() === 'Resume after run 4'; })()`;
  // One line, no overflow: the label's line boxes and its bar.
  const FITS = (btn) => `(() => { const b = ${btn}; if (!b) return null; const l = b.querySelector('.hd-btn-label, .rd-btn-label') || b;
    const bar = b.closest('.rd-bar-end') || b.parentElement; const lines = new Set([...l.getClientRects()].map((r) => Math.round(r.top))).size;
    return { text: b.textContent.trim(), lines, fits: bar.scrollWidth <= bar.clientWidth, own: b.scrollWidth <= b.clientWidth }; })()`;
  const fitOk = (r) => !!r && r.text === 'Resume after run 4' && r.lines === 1 && r.fits && r.own;
  const ROW6 = "[...document.querySelectorAll('.gpage-runs .run-member')].find((li) => li.offsetParent && li.querySelector('.run-member-num')?.textContent.trim() === '6')";
  // 375px, light, before any click.
  await cdp('Emulation.setDeviceMetricsOverride', { width: 375, height: 900, deviceScaleFactor: 1, mobile: false });
  await open(`${base}/?afterrun-narrow#history/${key}/${six}`);
  await skipWelcome(); await setTheme('light');
  if (await waitFor(WAITS, "run 6's Resume after run 4 at 375px")) {
    const r = await ev(FITS(RESUME));
    check(fitOk(r), `after run, 375px: the saved page's Resume after run 4 keeps one line and fits (${JSON.stringify(r)})`);
  }
  await open(`${base}/?afterrun-panel#chat/new/run/${six}/overview`);
  await skipWelcome(); await setTheme('light');
  const PANEL = "[...document.querySelectorAll('.hd-resume, .rd-pause')].find((b) => b.offsetParent && b.textContent.trim().startsWith('Resume'))";
  if (await waitFor(`(() => { const b = ${PANEL}; return !!b && b.textContent.trim() === 'Resume after run 4'; })()`, "Chat's run panel Resume after run 4 at 375px")) {
    const r = await ev(FITS(PANEL));
    check(fitOk(r), `after run, 375px: Chat's run panel reads Resume after run 4 on one line that fits (${JSON.stringify(r)})`);
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const capture = async (name) => {
    await ev("(() => { for (const b of document.querySelectorAll('button[aria-label=\"Dismiss\"]')) if (b.offsetParent) b.click(); return 0; })()");
    await sleep(400);
    const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
    const file = path.join(SHOTS, name);
    await writeFile(file, Buffer.from(data, 'base64'));
    results.shots.push(file);
  };
  for (const theme of THEMES) {
    await open(`${base}/?afterrun-${theme}#history/${key}/${six}`);
    await skipWelcome(); await setTheme(theme);
    const waits = await waitFor(WAITS, `run 6's Resume after run 4 (${theme})`);
    check(waits, `after run, ${theme}: before the press run 6's Resume reads Resume after run 4 (${JSON.stringify(await ev(`(${RESUME})?.textContent.trim()`))})`);
    if (!waits) continue;
    await skipWelcome();
    await capture(`resume-after-run-${theme}.png`);
    await ev(`(${RESUME}).click()`);
    const back = await waitFor(`(() => { const b = ${RESUME}; return !!b && !b.disabled && b.textContent.trim() === 'Resume'; })()`, `the plain Resume back (${theme})`);
    check(back, `after run, ${theme}: once held the button reads plain Resume and is enabled`);
    check(JSON.stringify(heldStops.heldResumeOf(six)) === '{"after":4}', `after run, ${theme}: the server holds it after run 4 (${JSON.stringify(heldStops.heldResumeOf(six))})`);
    check(![...runs.values()].some((e) => e.pipelineId === six), `after run, ${theme}: no runs-map entry for run 6`);
    await open(`${base}/?afterrun-row-${theme}#feature/${encodeURIComponent(AR.f.id)}`);
    await skipWelcome(); await setTheme(theme);
    const row = await waitFor(`(() => { const li = ${ROW6}; return !!li && li.dataset.mark === 'after'
      && (li.querySelector('.run-member-state')?.textContent || '').trim() === 'after run 4'; })()`, `run 6's after run 4 row (${theme})`);
    check(row, `after run, ${theme}: the Runs table row of run 6 reads after run 4 with data-mark="after" (${JSON.stringify(await ev(`(() => { const li = ${ROW6}; return li ? [li.dataset.mark || null, li.querySelector('.run-member-state')?.textContent || null] : null; })()`))})`);
    if (row) await capture(`after-run-row-${theme}.png`);
    heldStops.dropResume(six);   // the next theme starts from a paused run that is not held yet
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: false });
}

// D2_ONLY=1 runs the D2 cases alone, D3_ONLY=1 the D3 cases, HELD_ONLY=1 the clash-held row, TAKEIN_ONLY=1 the take-in, SHIP_LIST_ONLY=1
// the Ship list along the real branches, HELD_RESUME_ONLY=1 the held resume, AFTER_RUN_ONLY=1 the after-run row and Resume wording (each command stays under 10 minutes); unset, every case runs, D2 before D3, the held row, then the take-in last.
if (process.env.D2_ONLY === '1') { await d2Phase(); await finish(); }
if (process.env.D3_ONLY === '1') { await d3Phase(); await finish(); }
if (process.env.HELD_ONLY === '1') { await heldPhase(); await finish(); }
if (process.env.TAKEIN_ONLY === '1') { await takeInPhase(); await finish(); }
if (process.env.SHIP_LIST_ONLY === '1') { await shipListPhase(); await finish(); }
if (process.env.HELD_RESUME_ONLY === '1') { await heldResumePhase(); await finish(); }
if (process.env.AFTER_RUN_ONLY === '1') { await afterRunPhase(); await finish(); }

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

await shipListPhase();
await heldResumePhase();
await afterRunPhase();
await d2Phase();
await d3Phase();
await heldPhase();
await takeInPhase();
await finish();
