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
//   failed  run 5 failed: the red "!", run 6 `waits for run 5 (failed)`, runs 15 and 16 `cannot start · waits for run …`.
// For each world and theme, at 1280px and deviceScaleFactor 2, it shoots the Chat card and the feature page Runs tab:
// `rows-{world}-{card|page}-{theme}.png`. A JSON log records every row (word, data-mark, dot class, height, wrap,
// word colour). It also checks base-world runs 7 and 12 at 375px in light. The script exits non-zero on any failed
// check: a row that is not one 32px line, a word that wraps, a pulse on a row whose mark is not live, a live word that
// reads working, an open stop or failed word not in its ink token. A canceled run keeps today's row (no mark).
// Slice 5 adds two surfaces. `side`: the Runs list at #runs with the feature group expanded, `rows-{world}-side-{theme}.png`
// and one 360px light shot `rows-busy-side-360-light.png`; every member's word, dot and data-mark equal the card's, the
// live member keeps its .runs-stage strips (Plan, Build, Review, Ready), the ask and failed words take the card's ink,
// the dashed ring's centre sits within 1px of a plain dot's, and at 360px each run number and word stays visible. `run`:
// the run page head (the header's state line) of busy runs 2 (ask), 5 (failed), 6 (live) and held run 4 (after run 3),
// `rows-{world}-run{n}-{theme}.png`; its word and dot equal the card's, and its detail restates no dev state word.
// Slice 6 adds the `stops` surface: the Chat card's open stop list in the busy world, per theme at 1280px and 2x.
// `stops-busy-card-{theme}.png`: 4 lines in run order (runs 2, 4, 5, 11) with their exact texts, run 5's red "!" and its
// Resume, a mounted visible .qpanel per open line whose data-qrun is that run's seeded run id, and no footer Resume. Then
// Approve on run 4's real step card must post run 4's run id to /answer. `stops-refused-{theme}.png`: run 5's Resume is
// refused (run 6 is going) and its line shows the refusal with Resume enabled again. `stops-after-{theme}.png`: busy with
// run 4 re-seeded building lists 3 lines, runs 2, 5 and 11. SURFACE=stops runs only this surface.
// Slice 13 checks each open line's step card: no visible banner or step head, the card question's padding (16px top for
// plan and gate, 0px for clarify; 0px left) and wrapping foot, a 0px host margin, "Run N" once, the question text shown,
// and each line row at most 32.5px. `stops-kinds-card-{theme}.png` seeds run 4 at a gate stop and run 11 at a clarify
// ask; `stops-busy-card-360-light.png` is the busy list at 360px in light.
// Slice 7 adds the `line` surface: the feature's state line and need count on the Chat card head with its status block
// (`line-{world}-card-{theme}.png`) and on the feature page head (`line-{world}-page-{theme}.png`), per theme at 1280px
// and 2x, in four worlds: busy (run 6 reviewing), next (busy, run 6 not started), two (slice 1's M5b: runs 8 and 10 build)
// and acts (only run 2's stop, Ask before each run on). It checks each exact line, the chip text once per surface, no chip
// in two, the chip height and the card detail's line count. SURFACE=line runs only this surface.
// Slice 8 adds the `links` surface: in the base world, per theme at 1280px and 2x, on the Chat card and the feature page,
// real CDP input points at run 12 (mouseMoved to its dot), keeps it (focus, then Enter), moves off the list with focus
// on the body, and lets go (Escape). It checks solid [1, 7, 10] and dashed [16] while pointed and kept, no mark after
// Escape, a 3px bar shown on the marked rows, and that every row and the element after the list keep their rects in
// every phase (`results.links`, samePositions). Shots: `links-base-{card|page}-{theme}.png` and
// `links-kept-base-{card|page}-{theme}.png`. SURFACE=links runs only this surface.
// Slice 9 adds the `map` surface: the run order map (ui/public/shape/run-order-map.mjs) mounted with renderRunOrderMap on
// the served page from the card payload's `slices`, in worlds base, busy, held, change and after2 (base with run 2 done),
// `map-{world}-{theme}.png` per theme at 1280px and 2x. From real DOM rects: no link segment meets a dot or a number of a
// run it does not join; each map dot's class equals the Chat card row's (rows with a data-mark and no violet dot); base
// draws exactly its 15 links; the root is aria-hidden; narrowed to 240px it overflows and three Tabs never focus inside
// it; only live dots pulse; after2 draws nothing from run 2. R-ux-6: each rendered path is sampled with getPointAtLength,
// and a link that comes within 7px of the centre of a dot it does not join fails (`mapTooClose`). Slice 9's "links that
// share no run never run together" is retired (D5): the agreed mock's lane puts every skip link under one row on one line.
// SURFACE=map runs only this surface.
// Slice 10 adds the `order` surface: Show order on the feature page's Runs tab, in worlds base and busy, per theme at
// 1280px and 2x. Each pass reloads #feature/ID and waits for the rows' words. Closed first (`order-closed-{world}-{theme}.png`);
// a real click opens it (`order-open-{world}-{theme}.png`): Hide order, focus kept on the toggle, one aria-hidden map of 16
// runs, the toggle right-aligned, the state line unmoved, the rows below the body. Then #chat/new and back: closed on return.
// The Chat card and the Runs list carry no drawing. One 360px light shot, `order-open-busy-360-light.png`, with no page
// scroll sideways and the map scrolling in its own box, then closed again after #runs and back (the slide layout keeps the
// page root). SURFACE=order runs only this surface.
// Slice 13 adds the order worlds `later` (every run done, run 17 builds on run 16 and run 18 on nothing, both change runs;
// s17: run 19 an extra run on nothing (dependsOn [])) and `still` (base with run 3 paused, run 5 failed, run 6 stopped). later: runs 17, 18 and 19 stand right of the run before
// them (run 19 exactly one column right of run 18, no link drawn into it), every path.rom-link is is-faint and strokes the resolved --line-2. still: each of those dots is its row's dot,
// never is-grey-ring. Then the agreed mock (plans/shaper-refresh/run-order-mock.html, its resting frame, Show order open)
// is shot per theme as `mock-order-{theme}.png` and put beside the app as `order-vs-mock-{base|later|still}-{theme}.png`.
// R-ux-6 (D11): in base, per theme, the real mouse points at run 3's row (`order-hover-base-{theme}.png`): run 3 and
// exactly 3→4 and 3→10 are is-lit, drawn last, 2px --ink; the other 13 are is-dim. A click keeps them after the pointer
// leaves (`order-kept-base-{theme}.png`); Escape clears every mark. The kept ring (.rom-run.is-lit::before) of a live run
// reads the same rect and opacity twice 400ms apart, its top at or below the number's bottom; the number's background is
// its nearest painted ancestor's; the page's getAnimations() holds only the live dots' pulse. The resting frame is put
// beside the mock's as `order-vs-mock-rest-{theme}.png`. Known differences from the mock: rows keep run-number order and
// the column gap is a fixed 64px (Open question 2), and (slice 16) the lane sits in the gap between rows, 6px above the
// mock's, so no number ever cuts it.
// Slice 16 adds the `waiting` surface (SURFACE=waiting): run 4 paused while run 9 builds. A real POST /api/resume (Resume on run
// 4's run page) is held for its turn: `resume-held-toast-{theme}.png` (the toast "Run 9 holds the turn"),
// `resume-menu-held-{theme}.png` (More ways to resume reads "Waiting for its turn after run 9"), `chat-resume-held-{theme}.png`
// (the chat card's Resume reads "Waiting for its turn", disabled) and `runs-group-held-{theme}.png` (the Runs list's group
// line "Waiting for its turn · Run 4", outside Needs you). A total cost limit below a seeded cost then refuses a press
// (`resume-refused-{theme}.png`, "Not resumed: the cost limit is reached") and the held resume at its turn
// (`rows-refused-{theme}.png`, the row word "not resumed: the cost limit is reached"). `rows-cannot-start-{theme}.png`
// shoots the failed world's row "cannot start · waits for run …". Every ask and failed row word's contrast against the
// computed --bg is written to run-status-rows-contrast.json; on the light page each must reach 4.5:1.
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
const WORLDS = ['base', 'busy', 'held', 'change', 'failed'].filter((w) => (!process.env.WORLD || w === process.env.WORLD) && process.env.SURFACE !== 'stops' && process.env.SURFACE !== 'line' && process.env.SURFACE !== 'links' && process.env.SURFACE !== 'map' && process.env.SURFACE !== 'order' && process.env.SURFACE !== 'waiting');   // WORLD=held runs one world
const WIDE = 1280;
const NARROW = 375;
const SIDE_NARROW = 360;   // s5: the Runs list's narrow shot
const T0 = Date.now();
const log = (m) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}\n`);

let chrome = null; let srv = null; let home = null; let proj = null; let profile = null; let failed = 0;
const results = { startedAt: new Date(T0).toISOString(), rows: [], shots: [], checks: [], contrast: [] };
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
const { server, runs, schedulerTick } = await imp('../ui/server.mjs');
const { projectKey } = await imp('../src/core/store.mjs');
const { writeStoreMeta, runDirForRow } = await imp('../src/core/artifacts.mjs');
const { recordShapePlan, setApproveEach } = await imp('../src/core/shape/features.mjs');
const askStore = await imp('../src/core/ask/store.mjs');
const { resolveGraph } = await imp('../src/core/workflows.mjs');
const { loadAgentRegistry } = await imp('../src/core/agent-registry.mjs');
const { buildGraphManifest } = await imp('../src/shared/graph/manifest.mjs');
const { careRunPlan } = await imp('../src/shared/shape/feature-record.mjs');
const { runRolesOf } = await imp('../src/shared/shape/requirements.mjs');
const { careRunGraph } = await imp('../src/core/shape/care-run.mjs');
const { world, SIXTEEN_RUN_STATES, SIXTEEN_RUN_LINKS } = await imp('../test/helpers/shape-sixteen-runs.mjs');
const { planStop, gateStop } = await imp('../src/shared/shape/run-stops.mjs');
const { getDb } = await imp('../src/core/db.mjs');
const { recordCostDelta } = await imp('../src/core/cost-budget.mjs');
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
// s13: a gate stop is the review loop's real payload (gateStop): the Reviewer objects after its fix cycles ran out.
const GATE_ISSUES = [{ severity: 'major', title: 'The cache key misses the lockfile', role: 'Reviewer' }];
const gateOf = (run) => ({ id: `q${run}`, kind: 'gate', nodeId: 'n_review', executionId: 'x:n_review:1', issues: GATE_ISSUES,
  stop: gateStop({ run, issues: GATE_ISSUES, fixCycles: 2, nodeId: 'n_review' }) });
// s13: a plain clarify ask of the shaping run, several questions.
const clarifyOf = (run) => ({ id: `q${run}`, kind: 'clarify', nodeId: 'n_clarify', executionId: 'x:n_clarify:1', questions: [
  { id: 'cache', question: 'Which cache should the runner keep between runs?', options: ['node_modules', 'The npm cache', 'None'], recommended: 'The npm cache' },
  { id: 'scope', question: 'Should the merge gate cover draft pull requests?', options: ['Yes', 'No'], recommended: 'No' }] });
const ORDER = ['n_task', 'n_clarify', 'n_plan', 'n_roles', 'n_refine', 'n_tests', 'n_impl', 'n_review'];
const liveIds = [];
function liveRun(featureId, run, pid, how) {
  const orch = new EventEmitter();
  // slice 7: the line surface seeds busy run 6 at n_review; s13: a gate stop waits at n_review, a clarify ask at n_clarify
  const at = how.stop === 'objection' ? 'n_review' : how.stop ? 'n_refine' : how.ask === 'clarify' ? 'n_clarify' : how.at || 'n_impl';
  const pq = how.stop === 'objection' ? gateOf(run) : how.ask === 'clarify' ? clarifyOf(run)
    : how.stop ? { id: `q${run}`, kind: 'plan', nodeId: 'n_refine', executionId: 'x:n_refine:1',
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
  // s13 stops: busy with run 4 at a gate stop (the Reviewer objects) and run 11 at a plain clarify ask.
  'stops-kinds': { spec: { done: SIXTEEN_RUN_STATES.busy.done, states: { ...SIXTEEN_RUN_STATES.busy.states, 4: { stop: 'objection' }, 11: { ask: 'clarify' } } } },
  // s7 line: busy with run 6 reviewing; busy with run 6 not started; slice 1's M5b; only run 2's stop, Ask before each run.
  'line-busy': { spec: SIXTEEN_RUN_STATES.busy, at: { 6: 'n_review' } },
  'line-next': { spec: { done: SIXTEEN_RUN_STATES.busy.done, states: Object.fromEntries(Object.entries(SIXTEEN_RUN_STATES.busy.states).filter(([r]) => r !== '6')) } },
  'line-two': { spec: { done: [1, 2, 3, 4, 9, 11], states: { 5: { pipe: 'paused' }, 8: { pipe: 'running' }, 10: { pipe: 'running' } } } },
  'line-acts': { spec: { done: [1], states: { 2: { stop: 'requirement' } } }, then: (fx) => setApproveEach(fx.featureId, true) },
  // s12 line: run 1 (the planning run's own pipeline, the Chat card's) at the Reviewer, nothing done.
  'line-first': { spec: { done: [], states: { 1: { pipe: 'running' } } }, at: { 1: 'n_review' } },
  // s9 map: base with run 2 done, so its links are gone.
  after2: { spec: { done: [...SIXTEEN_RUN_STATES.base.done, 2], states: Object.fromEntries(Object.entries(SIXTEEN_RUN_STATES.base.states).filter(([r]) => r !== '2')) } },
  // s13 order: every run of the 16 done, run 17 a Verifier change run ([16]) and run 18 a chat change run ([]), both
  // planned: no link holds a run back, so every link is drawn faint, and 17 and 18 stand after the run before them.
  // s17: run 19 an extra run on nothing (dependsOn []), added from the chat card: it stands after run 18, no link into it.
  later: { spec: { done: SIXTEEN_RUN_LINKS.map(({ run }) => run), states: {} },
    links: [...SIXTEEN_RUN_LINKS, { run: 17, dependsOn: [16] }, { run: 18, dependsOn: [] }, { run: 19, dependsOn: [] }],
    then: (fx) => { fx.setKind(17, 'change'); fx.setKind(18, 'change'); fx.setKind(19, 'extra'); } },
  // s16 waiting: run 4 paused (its Resume is pressed for real) while run 9 builds, so the resume is held behind run 9 and
  // run 4 is the Chat card's current run (its footer Resume acts on run 4).
  waiting: { spec: { done: [1, 2, 3], states: { 4: { pipe: 'paused' }, 9: { pipe: 'running' } } } },
  // s13 order: base with run 3 paused, run 6 stopped and run 5 failed: each map dot is its row's dot.
  still: { spec: { done: SIXTEEN_RUN_STATES.base.done, states: { ...SIXTEEN_RUN_STATES.base.states, 3: { pipe: 'paused' }, 5: { pipe: 'error' }, 6: { pipe: 'stopped' } } } },
};
/** Seeds one world (cancelling the previous world's tickets and live runs) and its Chat thread; returns the routes. */
function seed(name) {
  for (const id of liveIds.splice(0)) runs.delete(id);
  const { spec, then, at = {}, links } = SPECS[name];
  const fx = world(proj, spec, links ? { links } : {});
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
  const ink = { 'amber-ink-strong': tone('var(--amber-ink-strong)'), 'red-ink-strong': tone('var(--red-ink-strong)'), 'ink-2': tone('var(--ink-2)') };
  // Slice 16 (R-qa-5): the page ground as the browser computes it, from a probe painted background: var(--bg).
  const probe = document.createElement('div'); probe.style.cssText = 'background: var(--bg)'; document.body.append(probe);
  const bg = getComputedStyle(probe).backgroundColor; probe.remove();
  const rows = [...root.querySelectorAll('.run-member')].filter((li) => li.offsetParent && li.dataset.key !== 'planning').map((li) => {
    const st = li.querySelector('.run-member-state'); const dot = li.querySelector('.status-dot');
    const lh = st ? parseFloat(getComputedStyle(st).lineHeight) || 20 : 20;
    return { run: Number(li.querySelector('.run-member-num')?.textContent || 0), word: st ? st.textContent : null, mark: li.dataset.mark || null,
      dot: dot ? dot.className : '', symbol: dot ? dot.dataset.symbol || null : null, height: Math.round(li.getBoundingClientRect().height * 10) / 10,
      wrap: !!st && (st.getBoundingClientRect().height > lh + 1 || st.scrollWidth > st.clientWidth + 1),
      color: st ? getComputedStyle(st).color : null, second: !!li.querySelector('.run-member-line'), sig: SIG(dot) };
  });
  return { rows, ink, bg, theme: document.documentElement.dataset.theme || '' };
})()`;
/** Slice 16 (R-qa-5): the WCAG contrast of two computed rgb() colours. */
function contrastOf(fg, bgc) {
  const lum = (c) => {
    const [r, g, b] = String(c).match(/[\d.]+/g).slice(0, 3).map((v) => Number(v) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a, b] = [lum(fg), lum(bgc)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}
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
    const want = r.mark === 'ask' ? m.ink['amber-ink-strong'] : m.ink['red-ink-strong'];
    check(r.color === want, `${where}: run ${r.run}'s word "${r.word}" reads ${r.mark === 'ask' ? '--amber-ink-strong' : '--red-ink-strong'} (${r.color} vs ${want})`);
    // Slice 16 (R-qa-5): on the light page the word reads at least 4.5:1 against the computed --bg.
    const ratio = contrastOf(r.color, m.bg);
    results.contrast.push({ where, run: r.run, word: r.word, mark: r.mark, color: r.color, bg: m.bg, theme: m.theme, ratio: Math.round(ratio * 100) / 100 });
    if (m.theme === 'light') check(ratio >= 4.5, `${where}: run ${r.run}'s "${r.word}" reads ${ratio.toFixed(2)}:1 on --bg ${m.bg} (at least 4.5)`);
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
    for (const n of [15, 16]) check(at(n).mark === 'faint' && /is-grey-ring/.test(at(n).dot) && !!at(n).word, `${where}: run ${n} (cannot start) names why on the grey ring (${at(n).word})`);
  },
};
const SURFACES = { card: '.chat-rc-members', page: '#group-detail div.gpage-runs',
  // s5: the Runs list's expanded feature group, and the run page head.
  side: '.runs-members.srows', run: '.run-state-line' };
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
/** s5: the run page head as the person sees it: the header's state line (its dot, word and step), shown on every tab, and
 *  the detail of the status card under it (.rd-sheet .run-status), which repeats neither the word nor the step. */
const RUN_HEAD = `(() => {
  const SIG = ${SIG_SRC};
  const line = [...document.querySelectorAll('.run-state-line')].find((x) => x.offsetParent);
  if (!line) return null;
  const card = line.closest('.rd, .hd')?.querySelector('.rd-sheet .run-status');
  const word = line.querySelector('.run-state-word'); const step = line.querySelector('.run-state-step');
  const detail = card?.querySelector('.run-status-detail');
  const dot = line.firstElementChild;
  const said = [step && !step.hidden ? step.textContent.replace(/^ · /, '') : '', detail && !detail.hidden ? detail.textContent : ''].filter(Boolean).join(' · ');
  return { hash: location.hash, word: word ? word.textContent : null, detail: said, sig: SIG(dot), dot: dot ? dot.className : '' };
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
        check(false, `${where}: the header's state line is on screen`);
        log(`  seen: ${JSON.stringify(await ev(`(() => ({ hash: location.hash, heads: [...document.querySelectorAll('.rd-sheet .run-status')].map((x) => [x.closest('[id]')?.id, !!x.offsetParent, x.textContent.slice(0, 60)]), views: [...document.querySelectorAll('.view:not(.hidden)')].map((x) => x.id) }))()`))}`);
        continue;
      }
      check(h.word === want.word && h.sig === want.sig, `${where}: the head's word and dot equal the card's (${h.word} ${h.sig} vs ${want.word} ${want.sig}, ${h.hash})`);
      check(!/^working$/i.test(String(h.word).trim()), `${where}: a live word is never working (${h.word})`);
      const dev = devSegs(h.detail);
      check(dev.length === 0, `${where}: the step and run-status-detail restate no dev state word (needs you, paused, waiting, working, failed, stopped, running, starts …): "${h.detail}"`);
      results.rows.push({ where, head: h, card: { word: want.word, sig: want.sig, mark: want.mark } });
      await shotOf(SURFACES.run, `rows-${name}-run${n}-${theme}.png`, 'center');   // the page's sticky tabs cover a head scrolled to the top
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
    // s13: what the open line's step card shows. Its own panel only (qHost > .qpanel), never a nested one.
    const qHost = li.querySelector('.chat-rc-stop-q'); const own = qHost && qHost.querySelector(':scope > .qpanel');
    const seen = (sel) => { const el = own && own.querySelector(sel); return !!el && getComputedStyle(el).display !== 'none' && !!el.offsetParent; };
    const cs = own && getComputedStyle(own); const foot = own && own.querySelector('.qpanel-foot');
    const lineRow = li.querySelector('.chat-rc-stop-line');
    const style = qHost ? { banner: seen('.qpanel-head'), head: seen('.step-head'), kind: own ? own.dataset.kind || null : null,
      pad: cs ? { top: cs.paddingTop, left: cs.paddingLeft } : null, foot: foot ? getComputedStyle(foot).flexWrap : null,
      margin: getComputedStyle(qHost).marginTop,
      runs: (li.innerText.match(new RegExp('\\\\bRun ' + li.dataset.run + '\\\\b', 'g')) || []).length,
      asked: [...li.querySelectorAll('.qtext')].some((t) => !!t.offsetParent) } : null;
    return { run: Number(li.dataset.run), text: li.querySelector('.chat-rc-stop-text')?.textContent || '', dot: dot ? dot.className : '',
      symbol: dot ? dot.dataset.symbol || null : null, height: Math.round(li.getBoundingClientRect().height * 10) / 10,
      lineHeight: lineRow ? Math.round(lineRow.getBoundingClientRect().height * 10) / 10 : null, inner: li.innerText, style,
      title: li.querySelector('.chat-rc-stop-text')?.title || '',
      qpanel: q ? { visible: !!q.offsetParent && !q.classList.contains('hidden'), qrun: q.dataset.qrun || null } : null,
      resume: b ? { label: b.getAttribute('aria-label'), visible: !!b.offsetParent, disabled: b.disabled } : null,
      err: err && !err.hidden ? err.textContent : '' };
  });
  return { lines, footerResume: !!card.querySelector('.chat-rc-factions [data-act="feature-resume"]') };
})()`;
/** Records each /answer request's body in the page, so the proof reads which run an Approve names. */
const TAP_ANSWERS = `(() => { if (window.__answers) return 0; window.__answers = []; const f = window.fetch;
  window.fetch = (u, o) => { try { if (/[/]answer$/.test(String(u).split('?')[0])) window.__answers.push({ url: String(u), body: o && o.body ? JSON.parse(o.body) : null }); } catch {} return f(u, o); }; return 0; })()`;
const LINE_MAX_PX = 32.5;   // slice 6: a .chat-rc-stop-line row is one line
/** s13 (R-ux-5): each open line's step card draws as the card question, each fact once. A plan or gate panel has the
 *  card's 16px top padding; a clarify or form panel has 0px (its .qblock carries it), as the card question's does. */
function judgeStopStyle(where, l) {
  const s = l.style;
  if (!s) return;
  const top = s.kind === 'clarify' || s.kind === 'form' ? '0px' : '16px';
  check(s.banner === false, `${where}: run ${l.run}'s line shows no .qpanel-head banner`);
  check(s.head === false, `${where}: run ${l.run}'s line shows no .step-head`);
  check(!!s.pad && s.pad.top === top && s.pad.left === '0px', `${where}: run ${l.run}'s ${s.kind} panel has the card's padding, ${top} top and 0px left (${JSON.stringify(s.pad)})`);
  check(s.foot === null || s.foot === 'wrap', `${where}: run ${l.run}'s foot wraps (${s.foot})`);
  check(s.margin === '0px', `${where}: run ${l.run}'s question host adds no top margin (${s.margin})`);
  check(s.runs === 1, `${where}: run ${l.run}'s line reads "Run ${l.run}" once (${s.runs})`);
  check(s.asked === true, `${where}: run ${l.run}'s question text is visible`);
  check(!/ready for your approval/.test(l.inner) && !/\bShape \d+\/\d+/.test(l.inner), `${where}: run ${l.run}'s line has no "ready for your approval" and no "Shape N/M"`);
}
async function stopsShot(routes, theme, file, want, width = WIDE) {
  await metrics(width);
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
    judgeStopStyle(where, l);
  }
  // R-qa-9: each row is one line at 1280px and at 360px; a long text ellipsises and keeps the whole line as its tooltip.
  for (const l of m.lines) {
    check(l.lineHeight !== null && l.lineHeight <= LINE_MAX_PX, `${where}: run ${l.run}'s .chat-rc-stop-line is one line, at most ${LINE_MAX_PX}px (${l.lineHeight}px)`);
    check(l.title === l.text, `${where}: run ${l.run}'s line text is its own tooltip (${JSON.stringify(l.title)})`);
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
    // s13: run 4 at a gate stop and run 11 at a clarify ask pass the same style checks as the plan stops.
    const kinds = seed('stops-kinds');
    const k = await stopsShot(kinds, theme, `stops-kinds-card-${theme}.png`, [BUSY_STOP_LINES[0], 'Run 4 · gate · holds up 5, 6, 7, 12, 16',
      BUSY_STOP_LINES[2], 'Run 11 · questions · holds up 13, 14, 15, 16']);
    if (k) await shotOf(STOPS_ROOT, `stops-kinds-card-${theme}.png`);
  }
  // s13: the busy list at 360px in light: each line stays one line and reads its run once.
  const narrow = await stopsShot(seed('busy'), 'light', 'stops-busy-card-360-light.png', BUSY_STOP_LINES, SIDE_NARROW);
  if (narrow) await shotOf(STOPS_ROOT, 'stops-busy-card-360-light.png');
  await metrics(WIDE);
}

// ---- s7 line: the feature's state line and need count, on the Chat card head and status, and on the feature page head.
const LINE_WORLDS = {
  busy: { line: 'Run 6 reviewing · next: run 9', done: '2 of 16 runs done', chip: '4 need you' },
  next: { line: 'next: run 9', done: '2 of 16 runs done', chip: '4 need you' },
  two: { line: 'Run 8 building, run 10 building · next: run 13', done: '6 of 16 runs done', chip: '' },
  acts: { line: 'Nothing can go on until you act', done: '1 of 16 runs done', chip: '1 needs you' },
  first: { line: 'Run 1 reviewing · next: run 9', done: '0 of 16 runs done', chip: '' },
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
          // s12: run 1 runs in the card's own pipeline; its row reads the same word as the other surfaces.
          if (name === 'first') {
            const r1 = ((await ev(ROWS('.chat-rc-members'))) || { rows: [] }).rows.find((r) => r.run === 1);
            check(!!r1 && r1.word === 'reviewing', `${where}: the card's run 1 row reads "reviewing" (${r1 ? r1.word : 'no row'})`);
          }
        }
        await shotUnion(sf.root, [sf.head, sf.status], `line-${name}-${surface}-${theme}.png`);
      }
    }
  }
}

// ---- s8 links: pointing at run 12, keeping it with Enter, letting go with Escape; nothing moves.
/** Rects of every run row and of the element after the list, rounded to 0.01px, plus the marks and the kept row. */
const LINKS_READ = (rootSel) => `(() => {
  const host = [...document.querySelectorAll(${JSON.stringify(rootSel)})].find((r) => r.offsetParent);
  if (!host) return null;
  const r2 = (v) => Math.round(v * 100) / 100;
  const rect = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: r2(b.left), y: r2(b.top), w: r2(b.width), h: r2(b.height) }; };
  const num = (li) => Number(li.querySelector('.run-member-num')?.textContent || 0);
  const rows = [...host.querySelectorAll('.run-member')].map((li) => ({ run: num(li), ...rect(li) }));
  const marked = (sel) => [...host.querySelectorAll(sel)].map(num).sort((a, b) => a - b);
  const bars = [...host.querySelectorAll('.run-member[data-link]')].map((li) => { const cs = getComputedStyle(li, '::before'); return { run: num(li), width: cs.width, opacity: cs.opacity }; });
  return { rows, after: rect(host.nextElementSibling), solid: marked('[data-link="on"]'), dashed: marked('[data-link="by"]'), kept: marked('[data-link-kept]'),
    current: marked('.run-member[aria-current="true"]'), bars, bodyFocused: document.activeElement === document.body };
})()`;
const pressKey = (keyName, code, vk, text) => [['keyDown', text], ['keyUp', undefined]].reduce((p, [type, t]) => p.then(() => cdp('Input.dispatchKeyEvent',
  { type, key: keyName, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(t ? { text: t } : {}) })), Promise.resolve());
const posOf = (m) => JSON.stringify({ rows: m.rows, after: m.after });
if ((!process.env.WORLD && !process.env.SURFACE) || process.env.SURFACE === 'links') {
  const routes = seed('base');
  results.links = [];
  for (const theme of THEMES) {
    await metrics(WIDE);
    for (const surface of ['card', 'page']) {
      const sel = SURFACES[surface];
      const where = `links base ${surface}, ${theme}, ${WIDE}px`;
      await go(routes[surface], theme);
      if (!await waitFor(`(() => [...document.querySelectorAll(${JSON.stringify(`${sel} .run-member[data-run]`)})].filter((li) => li.offsetParent).length === 16)()`, `${where}: 16 link rows`)) continue;
      await skipWelcome(); await sleep(500);
      await ev("document.querySelector('.toast[data-key=\"role-defaults\"] .toast-x')?.click();0");
      await ev(`(() => { const li = [...document.querySelectorAll(${JSON.stringify(`${sel} .run-member[data-run="12"]`)})].find((x) => x.offsetParent); li.scrollIntoView({ block: 'center' }); return 0; })()`);
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
      await sleep(300);
      const before = await ev(LINKS_READ(sel));
      // 1. point: the mouse on run 12's dot
      const dot = await ev(`(() => { const d = [...document.querySelectorAll(${JSON.stringify(`${sel} .run-member[data-run="12"] .status-dot`)})].find((x) => x.offsetParent);
        const b = d.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dot.x, y: dot.y });
      await sleep(300);
      const pointed = await ev(LINKS_READ(sel));
      await shotOf(surface === 'card' ? '.chat-rc' : sel, `links-base-${surface}-${theme}.png`, 'center');
      // 2. keep: focus run 12, Enter, then the mouse off the list and the focus on the body
      await ev(`(() => { [...document.querySelectorAll(${JSON.stringify(`${sel} .run-member[data-run="12"]`)})].find((x) => x.offsetParent).focus({ preventScroll: true }); return 0; })()`);
      await pressKey('Enter', 'Enter', 13, '\r');
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
      await ev('(() => { document.activeElement?.blur(); document.body.focus(); return 0; })()');
      await sleep(300);
      const kept = await ev(LINKS_READ(sel));
      check(await ev('document.activeElement === document.body'), `${where}: the focus is on the body before the kept shot`);
      await shotOf(surface === 'card' ? '.chat-rc' : sel, `links-kept-base-${surface}-${theme}.png`, 'center');
      // 3. let go: Escape with the focus still on the body
      await pressKey('Escape', 'Escape', 27);
      await sleep(300);
      const released = await ev(LINKS_READ(sel));
      const phases = { before, pointed, kept, released };
      const samePositions = [pointed, kept, released].every((m) => !!m && posOf(m) === posOf(before));
      const solid = pointed && pointed.solid; const dashed = pointed && pointed.dashed;
      results.links.push({ surface, theme, phases, solid, dashed, samePositions });
      const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      check(eq(pointed.solid, [1, 7, 10]) && eq(pointed.dashed, [16]) && pointed.kept.length === 0, `${where}: pointed at 12, solid [1, 7, 10] and dashed [16], nothing kept (${JSON.stringify([pointed.solid, pointed.dashed, pointed.kept])})`);
      check(pointed.bars.length === 4 && pointed.bars.every((b) => b.width === '3px' && b.opacity === '1'), `${where}: each marked row shows its 3px ::before bar (${JSON.stringify(pointed.bars)})`);
      check(eq(kept.solid, [1, 7, 10]) && eq(kept.dashed, [16]) && eq(kept.kept, [12]) && eq(kept.current, [12]) && kept.bodyFocused,
        `${where}: kept with Enter, the marks stay with the focus on the body (${JSON.stringify([kept.solid, kept.dashed, kept.kept, kept.current, kept.bodyFocused])})`);
      check(released.solid.length + released.dashed.length + released.kept.length + released.current.length === 0, `${where}: Escape on the body lets go of every mark`);
      check(samePositions, `${where}: every row and the element after the list keep their rects before, pointed, kept and released`);
    }
  }
}

// ---- s9 map: the run order map mounted on the served page from each world's real card payload.
const MAP_WORLDS = ['base', 'busy', 'held', 'change', 'after2'];
const MAP_NARROW = 240;   // the host width at which the map must scroll sideways
const MAP_BASE_PAIRS = [[2, 7], [2, 8], [3, 4], [3, 10], [4, 5], [5, 6], [6, 7], [7, 12], [8, 15], [9, 16], [10, 12], [12, 16], [13, 14], [14, 15], [15, 16]];
/** Mounts the map in a fixed host (a button before it, for the Tab check) over the page; resolves to the run count. */
const MAP_MOUNT = (slices) => `(async () => {
  document.getElementById('rom-host')?.remove();
  const { renderRunOrderMap } = await import('/shape/run-order-map.mjs');
  const host = document.createElement('div');
  host.id = 'rom-host';
  host.style.cssText = 'position:absolute;left:0;top:0;z-index:2147483647;padding:16px;background:var(--panel);color:var(--ink)';
  const before = document.createElement('button');
  before.type = 'button'; before.id = 'rom-before'; before.className = 'btn btn-sm'; before.textContent = 'Before the map';
  host.append(before, renderRunOrderMap(document, ${JSON.stringify(slices)}));
  document.body.append(host);
  return host.querySelectorAll('.rom-run').length;
})()`;
/** R-ux-6: a rendered path's points in client px, sampled along it with getPointAtLength (curves included). */
const SAMPLE_PATH = 'const len = p.getTotalLength(); const points = []; for (let k = 0; k <= 160; k += 1) { const q = p.getPointAtLength(len * k / 160); points.push([q.x + sb.left, q.y + sb.top]); }';
/** The mounted map: its links (points in px, sampled along each rendered path, plus the svg's client offset) and every
 *  run's dot and number rects, dot class and data-mark, read from the real layout. */
const MAP_READ = `(() => {
  const host = document.getElementById('rom-host'); const root = host && host.querySelector('.rom');
  if (!root) return null;
  const sb = root.querySelector('svg.rom-links').getBoundingClientRect();
  const rect = (el) => { const b = el.getBoundingClientRect(); return { x0: b.left, y0: b.top, x1: b.right, y1: b.bottom }; };
  const links = [...root.querySelectorAll('path.rom-link')].map((p) => {
    ${SAMPLE_PATH}
    return { from: Number(p.dataset.from), to: Number(p.dataset.to), points, d: p.getAttribute('d') };
  });
  const runs = [...root.querySelectorAll('.rom-run')].map((r) => {
    const dot = r.querySelector('.rom-run .status-dot'); const n = r.querySelector('.rom-n');
    return { run: Number(r.dataset.run), mark: r.dataset.mark || null, dot: dot.className, dotBox: rect(dot), nBox: rect(n) };
  });
  return { ariaHidden: root.getAttribute('aria-hidden'), tabindex: root.getAttribute('tabindex'), links, runs };
})()`;
/** R-ux-6: every (link, run) pair where the sampled link comes within 7px of the centre of a dot it does not join, and
 *  (slice 16, direction d8776dd9f) every sampled link point inside any run's number box (`.nBox`, its own ends' included),
 *  the unit test's rule: the lane runs in the gap between rows. */
function mapTooClose(m) {
  const out = [];
  const near = (q, a, b) => {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]]; const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / len)) : 0;
    return Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy);
  };
  for (const l of m.links) {
    for (const r of m.runs) {
      if (r.run === l.from || r.run === l.to) continue;
      const c = [(r.dotBox.x0 + r.dotBox.x1) / 2, (r.dotBox.y0 + r.dotBox.y1) / 2];
      let d = Infinity;
      for (let i = 1; i < l.points.length; i += 1) d = Math.min(d, near(c, l.points[i - 1], l.points[i]));
      if (d < 7) out.push(`${l.from}→${l.to} passes ${d.toFixed(1)}px from run ${r.run}'s dot`);
    }
    for (const r of m.runs) {
      const b = r.nBox;
      if (l.points.some(([x, y]) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1)) out.push(`${l.from}→${l.to} meets run ${r.run}'s number`);
    }
  }
  return out;
}
if ((!process.env.WORLD && !process.env.SURFACE) || process.env.SURFACE === 'map') {
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
  for (const name of MAP_WORLDS) {
    const routes = seed(name);
    const r = await fetch(`${base}/api/shape/pipelines/${encodeURIComponent(routes.origin)}/card`);
    const c = r.ok ? await r.json() : null;
    const slices = c && c.feature ? c.feature.slices : null;
    check(Array.isArray(slices) && slices.length === 16, `map ${name}: the card payload carries the 16 slices (HTTP ${r.status})`);
    if (!slices) continue;
    for (const theme of THEMES) {
      const where = `map ${name}, ${theme}, ${WIDE}px`;
      await metrics(WIDE);
      await go(routes.card, theme);
      // The Chat card's own rows: each run's .chat-rc-members .status-dot class and data-mark, the map's reference.
      if (!await waitFor(ready('.chat-rc-members'), `${where}: the card's 16 marked run rows`)) continue;
      await skipWelcome(); await sleep(500);
      const card = await ev(ROWS('.chat-rc-members'));
      const count = await ev(MAP_MOUNT(slices));
      check(count === 16, `${where}: the map draws 16 runs (${count})`);
      await sleep(400);
      const m = await ev(MAP_READ);
      if (!m) { check(false, `${where}: the map is on the page`); continue; }
      const pairs = m.links.map((l) => [l.from, l.to]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      results.rows.push({ where, map: { pairs, runs: m.runs.map((x) => [x.run, x.mark, x.dot]) } });
      check(m.ariaHidden === 'true' && m.tabindex === '-1', `${where}: the root is aria-hidden with tabindex -1 (${m.ariaHidden}, ${m.tabindex})`);
      const unparsed = m.links.filter((l) => l.points.length < 2);
      check(unparsed.length === 0, `${where}: every path.rom-link d parses into at least 2 points (${JSON.stringify(unparsed.map((l) => l.d))})`);
      const cross = mapTooClose(m);
      check(cross.length === 0, `${where}: no rendered path.rom-link comes within 7px of the centre of a .rom-run .status-dot it does not join, nor meets any .rom-n number (${JSON.stringify(cross)})`);
      const rowOf = (n) => (card?.rows || []).find((x) => x.run === n);
      const compared = m.runs.filter((x) => { const row = rowOf(x.run); return row && row.mark && !/\bis-violet\b/.test(row.dot); });
      const diff = compared.filter((x) => x.dot !== rowOf(x.run).dot);
      check(compared.length > 0 && diff.length === 0, `${where}: each map dot's class equals the card row's dot class (${compared.length} compared; ${JSON.stringify(diff.map((x) => [x.run, x.dot, '≠', rowOf(x.run).dot]))})`);
      const pulse = m.runs.filter((x) => /\bis-pulse\b/.test(x.dot) !== (x.mark === 'live'));
      check(pulse.length === 0, `${where}: only data-mark="live" dots carry is-pulse (${JSON.stringify(pulse.map((x) => [x.run, x.mark]))})`);
      if (name === 'base') check(JSON.stringify(pairs) === JSON.stringify(MAP_BASE_PAIRS), `${where}: the links are exactly the 15 base pairs (${JSON.stringify(pairs)})`);
      if (name === 'after2') check(await ev(`document.querySelectorAll('#rom-host path.rom-link[data-from="2"]').length`) === 0 && !m.links.some((l) => l.from === 2), `${where}: run 2 is done, so no data-from="2" link`);
      await shotOf('#rom-host', `map-${name}-${theme}.png`);
      // Narrowed to MAP_NARROW the map scrolls sideways, and Tab from the button before it never lands inside it.
      await ev(`(() => { const h = document.getElementById('rom-host'); h.style.width = '${MAP_NARROW}px'; h.style.boxSizing = 'border-box'; return 0; })()`);
      await sleep(200);
      const scroll = await ev(`(() => { const r = document.querySelector('#rom-host .rom'); return { sw: r.scrollWidth, cw: r.clientWidth }; })()`);
      check(scroll.sw > scroll.cw, `${where}: narrowed to ${MAP_NARROW}px the map overflows (scrollWidth ${scroll.sw} > clientWidth ${scroll.cw})`);
      await ev(`document.getElementById('rom-before').focus();0`);
      const inside = [];
      for (let i = 0; i < 3; i += 1) {
        await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await sleep(100);
        inside.push(await ev(`(() => { const a = document.activeElement; return !!a && !!a.closest('.rom'); })()`));
      }
      check(!inside.some(Boolean), `${where}: three Tab presses from the button before the map never focus inside .rom (${JSON.stringify(inside)})`);
      await ev(`document.getElementById('rom-host')?.remove();0`);
    }
  }
}

// ---- s10 order: Show order on the feature page's Runs tab, closed first, opened by a real click, closed on return.
const ORDER_WORLDS = ['base', 'busy', 'later', 'still'];
/** s13: the run count each order world draws (later adds runs 17 and 18 to the 16; s17: and run 19 an extra run on
 *  nothing (dependsOn [])). */
const ORDER_RUNS = { later: 19 };
/** s13: the open Show order map on the feature page, as MAP_READ reads it, plus each path's classes and stroke, the
 *  resolved --line-2 and --ink-3 strokes in this theme, and each feature page row's dot class. */
const ORDER_MAP_READ = `(() => {
  const gp = [...document.querySelectorAll('#group-detail .gpage')].find((x) => x.offsetParent);
  const root = gp && gp.querySelector('.rom');
  if (!root) return null;
  const sb = root.querySelector('svg.rom-links').getBoundingClientRect();
  const rect = (el) => { const b = el.getBoundingClientRect(); return { x0: b.left, y0: b.top, x1: b.right, y1: b.bottom }; };
  const tone = (v) => { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.style.stroke = v; root.querySelector('svg.rom-links').append(p); const c = getComputedStyle(p).stroke; p.remove(); return c; };
  const links = [...root.querySelectorAll('path.rom-link')].map((p) => {
    ${SAMPLE_PATH}
    return { from: Number(p.dataset.from), to: Number(p.dataset.to), points, cls: [...p.classList].join(' '), stroke: getComputedStyle(p).stroke };
  });
  const runs = [...root.querySelectorAll('.rom-run')].map((r) => {
    const dot = r.querySelector('.status-dot'); const n = r.querySelector('.rom-n');
    return { run: Number(r.dataset.run), mark: r.dataset.mark || null, dot: dot.className, dotBox: rect(dot), nBox: rect(n) };
  });
  const rows = [...gp.querySelectorAll('.gpage-runs .run-member')].filter((li) => li.offsetParent && li.dataset.key !== 'planning')
    .map((li) => ({ run: Number(li.querySelector('.run-member-num')?.textContent || 0), dot: li.querySelector('.status-dot')?.className || '' }));
  return { links, runs, rows, line2: tone('var(--line-2)'), ink3: tone('var(--ink-3)'), hint: gp.querySelector('.gpage-order-hint')?.textContent || '' };
})()`;
/** s13: the agreed mock's Show order at its resting frame (run 1 done, run 2 asks, run 3 builds), opened in this theme. */
const MOCK_URL = new URL('../plans/shaper-refresh/run-order-mock.html', import.meta.url).href;
async function mockShot(theme) {
  await cdp('Page.navigate', { url: `${MOCK_URL}?t=${theme}` });
  await sleep(900);
  await ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)};0`);
  const opened = await ev(`(() => { const t = document.getElementById('page-order'); if (!t) return false; t.click(); return t.getAttribute('aria-expanded') === 'true'; })()`);
  check(opened, `mock, ${theme}: #page-order opens the mock's Show order`);
  await sleep(400);
  await shotOf('.screen.page', `mock-order-${theme}.png`);
}
/** s13: one page with the app's open Show order (left) and the mock's (right), shot as order-vs-mock-{world}-{theme}.png
 *  (R-ux-6: `pair` names another output, as order-vs-mock-rest-{theme}.png for the resting frame). */
async function sideBySide(name, theme, pair = name) {
  const app = path.join(SHOTS, `order-open-${name}-${theme}.png`);
  const mock = path.join(SHOTS, `mock-order-${theme}.png`);
  if (!existsSync(app) || !existsSync(mock)) { check(false, `order-vs-mock-${pair}-${theme}.png: both halves were shot`); return; }
  const src = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  await ev(`(() => { document.documentElement.dataset.theme = ${JSON.stringify(theme)};
    document.body.style.cssText = 'margin:0;padding:16px;background:${theme === 'dark' ? '#1b1b1a' : '#fff'};font:13px system-ui;color:${theme === 'dark' ? '#eee' : '#222'}';
    document.body.innerHTML = '<div id="pair" style="display:flex;gap:24px;align-items:flex-start">'
      + '<figure style="margin:0"><figcaption>App · ${name}</figcaption><img style="width:640px"></figure>'
      + '<figure style="margin:0"><figcaption>Mock · resting frame</figcaption><img style="width:640px"></figure></div>';
    const [a, m] = document.querySelectorAll('#pair img'); a.src = ${JSON.stringify(src(app))}; m.src = ${JSON.stringify(src(mock))};
    return 0; })()`);
  await waitFor(`[...document.querySelectorAll('#pair img')].every((i) => i.complete && i.naturalWidth > 0)`, `order-vs-mock-${pair}-${theme}: both images loaded`);
  await shotOf('#pair', `order-vs-mock-${pair}-${theme}.png`);
}
const ORDER_NARROW = 360;
/** s17: scroll the open map's own box to its right end, so the shot shows the last runs (19 in later). */
const ROM_TO_END = `(() => { const r = document.querySelector('#group-detail .rom'); if (r) r.scrollLeft = r.scrollWidth; return r ? r.scrollLeft : null; })()`;
/** The feature page's Show order block: the toggle, the body, the map, and the rects the checks compare. */
const ORDER_READ = `(() => {
  const gp = [...document.querySelectorAll('#group-detail .gpage')].find((x) => x.offsetParent);
  if (!gp) return null;
  const t = gp.querySelector('.gpage-order-toggle'); const body = gp.querySelector('.gpage-order-body');
  const panel = gp.querySelector('.gpage-panel[data-tab="runs"]');
  const rect = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom }; };
  const roms = gp.querySelectorAll('.rom');
  const first = [...gp.querySelectorAll('.gpage-runs .run-member')].find((li) => li.offsetParent);
  const pr = panel ? panel.getBoundingClientRect().right - parseFloat(getComputedStyle(panel).paddingRight || '0') : null;
  return { text: t ? t.textContent : null, expanded: t ? t.getAttribute('aria-expanded') : null, bodyHidden: body ? body.hidden : null,
    roms: roms.length, romHidden: roms[0] ? roms[0].getAttribute('aria-hidden') : null, runs: roms[0] ? roms[0].querySelectorAll('.rom-run').length : 0,
    focused: !!t && document.activeElement === t, toggle: rect(t), panelRight: pr, state: rect(gp.querySelector('.gpage-card .run-status')),
    body: rect(body), first: rect(first),
    romScroll: roms[0] ? { sw: roms[0].scrollWidth, cw: roms[0].clientWidth } : null,
    docScroll: { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth } };
})()`;
/** A fresh mount of the feature page: navigate, reload, then wait for a member row with its word (the feature view). */
async function freshOrderPage(routes, theme, where) {
  await go(routes.page, theme);
  await cdp('Page.reload');
  await sleep(900);
  await skipWelcome();
  await ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)};0`);
  const ok = await waitFor(`(() => [...document.querySelectorAll('#group-detail div.gpage-runs .run-member')].some((li) => li.offsetParent
    && (li.querySelector('.run-member-state')?.textContent || '').trim()))()`, `${where}: a member row with its word (the feature view landed)`);
  if (ok) { await sleep(500); await ev("document.querySelector('.toast[data-key=\"role-defaults\"] .toast-x')?.click();0"); await sleep(200); }
  return ok;
}
/** Real CDP input: the mouse moves to the visible toggle's centre, presses and releases. */
async function clickToggle() {
  const p = await ev(`(() => { const t = [...document.querySelectorAll('#group-detail .gpage-order-toggle')].find((x) => x.offsetParent); if (!t) return null;
    const b = t.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  if (!p) return false;
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  for (const type of ['mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await sleep(400);
  return true;
}
const scrollToToggle = () => ev(`(() => { const t = [...document.querySelectorAll('#group-detail .gpage-order-toggle')].find((x) => x.offsetParent); if (t) t.scrollIntoView({ block: 'center' }); return !!t; })()`);
/** Drawings and Show order toggles inside `sel`'s visible element (null when it is not on screen). */
const NO_DRAWING = (sel) => `(() => { const h = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.offsetParent); if (!h) return null;
  return { roms: h.querySelectorAll('.rom, .rom-run').length, toggles: h.querySelectorAll('.gpage-order-toggle').length
    + [...h.querySelectorAll('button')].filter((b) => /^(Show|Hide) order$/.test(b.textContent.trim())).length }; })()`;
/** Leaves the open page for `away` by hash, comes back, and answers whether Show order reads closed with no map. */
async function returnClosed(routes, away) {
  await ev(`location.hash = ${JSON.stringify(away)};0`);
  await sleep(900);
  await ev(`location.hash = ${JSON.stringify(routes.page)};0`);
  await waitFor(`[...document.querySelectorAll('#group-detail .gpage-order-toggle')].some((x) => x.offsetParent)`, `the toggle after ${away} and back`);
  await sleep(400);
  const back = await ev(ORDER_READ);
  results.order.push({ away, back });
  return !!back && back.expanded === 'false' && back.roms === 0;
}
// ---- R-ux-6 (D11): pointing at and keeping run 3's row marks the open map; the marks and the ring are still.
/** The open map's marks: lit runs, lit and dimmed links, whether the lit paths are the last children, their strokes. */
const MARKS_READ = `(() => {
  const gp = [...document.querySelectorAll('#group-detail .gpage')].find((x) => x.offsetParent);
  const root = gp && gp.querySelector('.rom');
  if (!root) return null;
  const key = (p) => p.dataset.from + '→' + p.dataset.to;
  const kids = [...root.querySelector('svg.rom-links').children];
  const lit = kids.filter((p) => p.classList.contains('is-lit'));
  const dim = kids.filter((p) => p.classList.contains('is-dim'));
  const tone = (v) => { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.style.stroke = v; root.querySelector('svg.rom-links').append(p); const c = getComputedStyle(p).stroke; p.remove(); return c; };
  return { runs: [...root.querySelectorAll('.rom-run.is-lit')].map((r) => Number(r.dataset.run)), lit: lit.map(key).sort(), dim: dim.length,
    litLast: kids.slice(kids.length - lit.length).every((p) => p.classList.contains('is-lit')),
    litStroke: lit.map((p) => [getComputedStyle(p).stroke, getComputedStyle(p).strokeWidth]), dimOpacity: dim.map((p) => getComputedStyle(p).opacity),
    ink: tone('var(--ink)'), marked: root.querySelectorAll('.is-lit, .is-dim').length };
})()`;
/** Run n's ring (.rom-run.is-lit::before, centred on the 0×0 run box) and number: rect, opacity, border, background. */
const RING_READ = (n) => `(() => {
  const gp = [...document.querySelectorAll('#group-detail .gpage')].find((x) => x.offsetParent);
  const r = gp && gp.querySelector('.rom .rom-run[data-run="${n}"]');
  if (!r) return null;
  const b = r.getBoundingClientRect(); const cs = getComputedStyle(r, '::before');
  const w = parseFloat(cs.width); const h = parseFloat(cs.height);
  const num = r.querySelector('.rom-n'); const nb = num.getBoundingClientRect();
  let behind = null;
  for (let a = r.parentElement; a && !behind; a = a.parentElement) { const c = getComputedStyle(a).backgroundColor; if (c && c !== 'transparent' && !/^rgba\\(.*,\\s*0\\)$/.test(c)) behind = c; }
  return { mark: r.dataset.mark || null, ring: { x: b.left - w / 2, y: b.top - h / 2, w, h, opacity: cs.opacity, content: cs.content, border: cs.borderTopWidth + ' ' + cs.borderTopStyle },
    dot: getComputedStyle(r.querySelector('.status-dot')).opacity, nBottom: nb.bottom, bg: getComputedStyle(num).backgroundColor, behind };
})()`;
/** The feature page's running animations: only the live dots' pulse may be among them. */
const ANIMS_READ = `(() => {
  const gp = [...document.querySelectorAll('#group-detail .gpage')].find((x) => x.offsetParent);
  const all = document.getAnimations();
  return { all: all.length, gp: !!gp, inside: all.filter((a) => { const t = a.effect && a.effect.target; return !!t && !!gp && gp.contains(t); })
    .map((a) => ({ name: a.animationName || a.transitionProperty || a.constructor.name, cls: String(a.effect.target.className?.baseVal ?? a.effect.target.className), pseudo: a.effect.pseudoElement || null })) };
})()`;
/** Run n's row number, in view: the Show order block stays at the top (where shotOf puts it, so a shot never scrolls the
 *  pointer onto another row); a row below the fold is scrolled to the centre instead. */
const rowPoint = (n) => ev(`(() => { const gp = [...document.querySelectorAll('#group-detail .gpage')].find((x) => x.offsetParent);
  const t = gp && gp.querySelector('.gpage-runs .run-member[data-run="${n}"] .run-member-num'); if (!t) return null;
  gp.querySelector('.gpage-order')?.scrollIntoView({ block: 'start' });
  if (t.getBoundingClientRect().bottom > innerHeight) t.scrollIntoView({ block: 'center' });
  const b = t.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
const mouseTo = (p) => cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
async function mouseClick(p) {
  await mouseTo(p);
  for (const type of ['mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
}
async function pressEscape() {
  for (const type of ['keyDown', 'keyUp']) await cdp('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
}
const THREE_MARKS = { runs: [3], lit: ['3→10', '3→4'], dim: 13 };
const marksOk = (m) => !!m && JSON.stringify([m.runs, m.lit, m.dim]) === JSON.stringify([THREE_MARKS.runs, THREE_MARKS.lit, THREE_MARKS.dim]) && m.litLast
  && m.litStroke.every(([c, w]) => c === m.ink && w === '2px') && m.dimOpacity.every((o) => o === '0.18');
async function orderMarks(theme, where) {
  const away = { x: 4, y: 4 };
  const p3 = await rowPoint(3);
  if (!p3) { check(false, `${where}: run 3's row is on screen`); return; }
  // 1. the real pointer on run 3's row
  await mouseTo(p3); await sleep(300);
  const hover = await ev(MARKS_READ);
  results.order.push({ where, hover });
  check(marksOk(hover), `${where}: pointing at run 3's row: .rom-run[data-run="3"] and exactly 3→4 and 3→10 are is-lit (last children, 2px --ink), the other 13 is-dim at .18 (${JSON.stringify(hover)})`);
  await shotOf('#group-detail .gpage-order', `order-hover-base-${theme}.png`);
  const still = await ev(MARKS_READ);
  check(marksOk(still), `${where}: the hover shot still shows run 3's marks (${JSON.stringify(still && [still.runs, still.lit, still.dim])})`);
  // 2. a click keeps them after the pointer leaves
  await mouseClick(await rowPoint(3) || p3); await sleep(200);
  await mouseTo(away); await sleep(300);
  const kept = await ev(MARKS_READ);
  results.order.push({ where, kept });
  check(marksOk(kept), `${where}: kept run 3 keeps the same marks after the pointer leaves (${JSON.stringify(kept)})`);
  const ring = await ev(RING_READ(3));
  check(!!ring && ring.ring.w === 22 && ring.ring.h === 22 && ring.ring.border === '2px solid', `${where}: run 3's ring is 22px with a 2px solid border (${JSON.stringify(ring && ring.ring)})`);
  check(!!ring && ring.ring.y >= ring.nBottom - 0.5, `${where}: the ring's top ${ring && ring.ring.y} is at or below the number's bottom ${ring && ring.nBottom}`);
  check(!!ring && !!ring.behind && ring.bg === ring.behind, `${where}: the number's background ${ring && ring.bg} is its nearest painted ancestor's ${ring && ring.behind}`);
  await shotOf('#group-detail .gpage-order', `order-kept-base-${theme}.png`);
  const anims = await ev(ANIMS_READ);
  const inside = anims ? anims.inside : [];
  const other = inside.filter((a) => a.name !== 'wr-pulse' || !/\bstatus-dot\b/.test(a.cls) || a.pseudo);
  const pulses = inside.filter((a) => a.name === 'wr-pulse').length;
  check(pulses > 0 && other.length === 0, `${where}: getAnimations() on the feature page holds the live dots' wr-pulse (${pulses}) and nothing else (${JSON.stringify(other)}; ${JSON.stringify(anims && [anims.all, anims.gp])})`);
  // 3. the ring on a live run stays still while its dot pulses: two reads 400ms apart
  const live = (await ev(ORDER_MAP_READ))?.runs.find((r) => r.mark === 'live')?.run;
  if (live == null) check(false, `${where}: a live run to ring`);
  else {
    if (live !== 3) { await mouseClick(await rowPoint(live)); await sleep(200); await mouseTo(away); await sleep(300); }
    const a = await ev(RING_READ(live)); await sleep(400); const b = await ev(RING_READ(live));
    check(!!a && !!b && a.mark === 'live' && JSON.stringify(a.ring) === JSON.stringify(b.ring), `${where}: live run ${live}'s kept ring reads the same rect and opacity 400ms apart (${JSON.stringify([a && a.ring, b && b.ring, a && a.dot, b && b.dot])})`);
  }
  // 4. Escape lets go: no mark is left
  await pressEscape(); await sleep(300);
  const gone = await ev(MARKS_READ);
  check(!!gone && gone.marked === 0, `${where}: Escape leaves 0 is-lit and 0 is-dim in the map (${gone && gone.marked})`);
}
const closedOk = (m) => !!m && m.text === 'Show order' && m.expanded === 'false' && m.bodyHidden === true && m.roms === 0;
if ((!process.env.WORLD && !process.env.SURFACE) || process.env.SURFACE === 'order') {
  results.order = [];
  for (const name of ORDER_WORLDS) {
    const routes = seed(name);
    for (const theme of THEMES) {
      const where = `order ${name}, ${theme}, ${WIDE}px`;
      await metrics(WIDE);
      if (!await freshOrderPage(routes, theme, where)) continue;
      // 1. closed on the first open of the Runs tab
      await scrollToToggle();
      const closed = await ev(ORDER_READ);
      check(closedOk(closed), `${where}: first open reads Show order, aria-expanded="false", a hidden body and 0 .rom (${JSON.stringify(closed && [closed.text, closed.expanded, closed.bodyHidden, closed.roms])})`);
      await shotOf('#group-detail .gpage-panel[data-tab="runs"]', `order-closed-${name}-${theme}.png`);
      // 2. a real click opens it; nothing above the toggle moves
      await scrollToToggle();
      const before = await ev(ORDER_READ);
      await clickToggle();
      const open = await ev(ORDER_READ);
      results.order.push({ where, closed, before, open });
      if (!open) { check(false, `${where}: the feature page is on screen after the click`); continue; }
      check(open.text === 'Hide order' && open.expanded === 'true' && open.bodyHidden === false, `${where}: the click reads Hide order with aria-expanded="true" and the body shown (${JSON.stringify([open.text, open.expanded, open.bodyHidden])})`);
      const want = ORDER_RUNS[name] || 16;
      check(open.roms === 1 && open.romHidden === 'true' && open.runs === want, `${where}: one .rom[aria-hidden="true"] with ${want} .rom-run, 16 outside later (${open.roms}, ${open.romHidden}, ${open.runs})`);
      check(open.focused, `${where}: activeElement is still the .gpage-order-toggle after the click`);
      check(!!open.toggle && open.panelRight != null && Math.abs(open.toggle.r - open.panelRight) <= 1, `${where}: the toggle's right edge sits within 1px of the Runs panel's (${open.toggle && open.toggle.r} vs ${open.panelRight})`);
      check(!!before && !!before.state && !!open.state && Math.abs(before.state.y - open.state.y) < 0.5 && Math.abs(before.state.b - open.state.b) < 0.5, `${where}: the state line keeps its rect (${JSON.stringify([before && before.state, open.state])})`);
      check(!!open.first && !!open.body && open.first.y >= open.body.b - 0.5, `${where}: the first run row sits below the open body (${open.first && open.first.y} >= ${open.body && open.body.b})`);
      // s13: faint links once none holds a run back, later runs after the run before them, the row's dot on still runs.
      const om = await ev(ORDER_MAP_READ);
      if (!om) check(false, `${where}: the open map is readable`);
      else {
        results.order.push({ where, map: { links: om.links.map((l) => [l.from, l.to, l.cls, l.stroke]), runs: om.runs.map((x) => [x.run, x.dot]), line2: om.line2 } });
        const cross = mapTooClose(om);
        check(cross.length === 0, `${where}: no rendered path.rom-link comes within 7px of the centre of a dot it does not join (${JSON.stringify(cross)})`);
        check(om.hint.includes('every link is drawn faint') && !/are not drawn/.test(om.hint), `${where}: the hint reads the s13 words (${om.hint})`);
        const faint = om.links.filter((l) => /\bis-faint\b/.test(l.cls));
        if (name === 'later') {
          const x = (n) => { const r = om.runs.find((q) => q.run === n); return r ? (r.dotBox.x0 + r.dotBox.x1) / 2 : NaN; };
          check(x(17) > x(16), `${where}: run 17's dot stands right of run 16's (${x(17)} > ${x(16)})`);
          check(x(18) > x(17), `${where}: run 18 (buildsOn []) stands right of run 17, the run before it (${x(18)} > ${x(17)})`);
          check(x(18) > x(1), `${where}: run 18 is not in the first column (${x(18)} > ${x(1)})`);
          // s17: run 19 (an extra run, buildsOn []) stands exactly one column right of run 18, never in the first column.
          check(x(19) > x(18) && Math.abs((x(19) - x(18)) - (x(18) - x(17))) <= 1, `${where}: run 19 (extra, buildsOn []) stands one column right of run 18 (${x(19) - x(18)} vs ${x(18) - x(17)})`);
          check(x(19) > x(1), `${where}: run 19 is not in the first column (${x(19)} > ${x(1)})`);
          check(!om.links.some((l) => l.to === 19), `${where}: no link is drawn into run 19 (${JSON.stringify(om.links.filter((l) => l.to === 19).map((l) => [l.from, l.to]))})`);
          check(om.links.length === 19 && faint.length === om.links.length, `${where}: every one of the 19 path.rom-link has is-faint (${faint.length} of ${om.links.length})`);
          const off = om.links.filter((l) => l.stroke !== om.line2);
          check(om.line2 && om.line2 !== om.ink3 && off.length === 0, `${where}: each faint stroke is the resolved --line-2 ${om.line2} (${JSON.stringify(off.map((l) => [l.from, l.to, l.stroke]))})`);
        } else {
          check(faint.length === 0 && om.links.length > 0, `${where}: a link holds a run back, so no path is is-faint (${faint.length} of ${om.links.length})`);
        }
        if (name === 'still') {
          const diff = [3, 5, 6].map((n) => [n, om.runs.find((q) => q.run === n)?.dot, om.rows.find((q) => q.run === n)?.dot]).filter(([, a, b]) => !a || a !== b);
          check(diff.length === 0, `${where}: runs 3, 5 and 6 each carry their feature page row's .status-dot class (${JSON.stringify(diff)})`);
          const ring = [3, 5, 6].filter((n) => /\bis-grey-ring\b/.test(om.runs.find((q) => q.run === n)?.dot || ''));
          check(ring.length === 0, `${where}: none of runs 3, 5 and 6 is is-grey-ring (${JSON.stringify(ring)})`);
        }
      }
      if (name === 'later') await ev(ROM_TO_END);   // s17: run 19 stands past the box's right edge; show it in the shot
      await shotOf('#group-detail .gpage-panel[data-tab="runs"]', `order-open-${name}-${theme}.png`);
      if (name === 'base') await orderMarks(theme, where);
      // 3. another view and back: closed on return. Side by side (split, 1280px) #runs keeps this page open beside the
      // list, so it is no return; #chat/new is. The slide layout's #runs return is checked in the 360px pass below.
      check(await returnClosed(routes, '#chat/new'), `${where}: closed again on return from #chat/new`);
      // 4. no drawing on the Chat card or the Runs list (the s10 worlds: their readiness waits on 16 marked rows)
      if (!['base', 'busy'].includes(name)) continue;
      await go(routes.card, theme);
      if (await waitFor(ready('.chat-rc-members'), `${where}: the card's 16 marked run rows`)) {
        const card = await ev(NO_DRAWING('.chat-rc'));
        check(!!card && card.roms === 0 && card.toggles === 0, `${where}: no drawing and no Show order on the Chat card (.chat-rc) (${JSON.stringify(card)})`);
      }
      if (await openSide(routes, theme, `${where} side`)) {
        const list = await ev(NO_DRAWING('#runs-list'));
        check(!!list && list.roms === 0 && list.toggles === 0, `${where}: no drawing and no Show order in the Runs list (${JSON.stringify(list)})`);
      }
    }
  }
  // 5. one 360px light shot of busy, open: the page has no sideways scroll; the map scrolls in its own box
  {
    const routes = seed('busy');
    const where = `order busy, light, ${ORDER_NARROW}px`;
    await metrics(ORDER_NARROW);
    if (await freshOrderPage(routes, 'light', where)) {
      await scrollToToggle();
      await clickToggle();
      const m = await ev(ORDER_READ);
      results.order.push({ where, open: m });
      check(!!m && m.expanded === 'true' && m.roms === 1 && m.runs === 16, `${where}: open with the 16-run map (${JSON.stringify(m && [m.expanded, m.roms, m.runs])})`);
      check(!!m && m.docScroll.sw <= m.docScroll.cw, `${where}: the document has no horizontal scroll (scrollWidth ${m && m.docScroll.sw} <= ${m && m.docScroll.cw})`);
      check(!!m && !!m.romScroll && m.romScroll.sw > m.romScroll.cw, `${where}: the map scrolls sideways inside its own box (scrollWidth ${m && m.romScroll && m.romScroll.sw} > clientWidth ${m && m.romScroll && m.romScroll.cw})`);
      await shotOf('#group-detail .gpage-panel[data-tab="runs"]', 'order-open-busy-360-light.png');
      // The slide layout: #runs is the list itself, the page root is kept for the way back, and the toggle is closed again.
      check(await returnClosed(routes, '#runs'), `${where}: closed again after #runs and back (slide layout)`);
    }
    await metrics(WIDE);
  }
  // 5b. s17: one 360px light shot of later, open: the map is one column wider (run 19 after run 18); the page still has no
  // sideways scroll and the map scrolls in its own box.
  {
    const routes = seed('later');
    const where = `order later, light, ${ORDER_NARROW}px`;
    await metrics(ORDER_NARROW);
    if (await freshOrderPage(routes, 'light', where)) {
      await scrollToToggle();
      await clickToggle();
      const m = await ev(ORDER_READ);
      results.order.push({ where, open: m });
      check(!!m && m.expanded === 'true' && m.roms === 1 && m.runs === ORDER_RUNS.later, `${where}: open with the ${ORDER_RUNS.later}-run map (${JSON.stringify(m && [m.expanded, m.roms, m.runs])})`);
      check(!!m && m.docScroll.sw <= m.docScroll.cw, `${where}: the document has no horizontal scroll (scrollWidth ${m && m.docScroll.sw} <= ${m && m.docScroll.cw})`);
      check(!!m && !!m.romScroll && m.romScroll.sw > m.romScroll.cw, `${where}: the map scrolls sideways inside its own box (scrollWidth ${m && m.romScroll && m.romScroll.sw} > clientWidth ${m && m.romScroll && m.romScroll.cw})`);
      await ev(ROM_TO_END);
      await shotOf('#group-detail .gpage-panel[data-tab="runs"]', 'order-open-later-360-light.png');
    }
    await metrics(WIDE);
  }
  // 6. s13: the agreed mock beside the app, per theme. base compares layout, dots and link tokens with the mock's resting
  // frame; later and still draw states the mock does not (faint links, runs after run 16, stopped dots), so there the
  // mock half is the token and spacing reference only.
  for (const theme of THEMES) {
    await metrics(WIDE);
    await mockShot(theme);
    for (const name of ['base', 'later', 'still']) await sideBySide(name, theme);
    await sideBySide('base', theme, 'rest');   // R-ux-6: the app at rest (nothing pointed) beside the mock's resting frame
  }
  log('  order vs mock, known differences: rows in run-number order and a fixed 64px column gap (Open question 2); the lane sits in the gap between rows, 6px above the mock\'s, clear of every number');
}

// ---- s16 waiting: a run held for its turn reads that it waits; a refused press and a refusal at the turn say why.
const TOASTS = `[...document.querySelectorAll('#toasts .toast')].map((t) => ({ title: t.querySelector('.tt')?.textContent || '', detail: t.querySelector('.td')?.textContent || '' }))`;
const VISIBLE = (sel) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.offsetParent)`;
const clearToasts = () => ev(`(() => { for (const x of document.querySelectorAll('#toasts .toast .toast-x')) x.click(); return 0; })()`);
/** Press run 4's Resume on its saved run page: a real POST /api/resume. → the toasts shown after it */
async function pressFour(routes, theme, where) {
  await go(routes.run(4), theme);
  if (!await waitFor(`(() => { const b = ${VISIBLE('.hd-resume')}; return !!b && !b.disabled; })()`, `${where}: run 4's Resume`)) {
    log(`  api: ${JSON.stringify(await ev(`fetch('/api/history/${key}/${routes.pipelineOf(4)}').then((r) => r.json()).then((d) => ({ resumable: d.state && d.state.resumable, status: d.state && d.state.status, keys: Object.keys(d) }))`))}`);
    log(`  seen: ${JSON.stringify(await ev(`({ hash: location.hash, resume: [...document.querySelectorAll('.hd-resume')].map((b) => [!!b.offsetParent, b.hidden, b.disabled, b.title]), head: document.querySelector('#hist-detail')?.innerText.slice(0, 300) })`))}`);
    return null;
  }
  await skipWelcome(); await clearToasts();
  await sleep(1500);   // the run's slice info loads with the page: only then is the press a Shaper one (D6)
  await ev(`(() => { const f = window.fetch; window.__resumed = []; window.fetch = async (...a) => { const r = await f(...a);
    if (String(a[0]).includes('/api/resume')) r.clone().text().then((t) => window.__resumed.push([r.status, t])); return r; }; return 0; })()`);
  await ev(`(${VISIBLE('.hd-resume')}).click(), 0`);
  if (!await waitFor(`${TOASTS}.length > 0`, `${where}: a toast after the press`)) log(`  resume answered: ${JSON.stringify(await ev('window.__resumed'))}`);
  return ev(TOASTS);
}
const memberWord = (n) => `(() => { const li = [...document.querySelectorAll('.chat-rc-members .run-member')].find((x) => x.offsetParent && x.querySelector('.run-member-num')?.textContent === '${n}'); return li ? li.querySelector('.run-member-state')?.textContent || '' : null; })()`;
if ((!process.env.WORLD && !process.env.SURFACE) || process.env.SURFACE === 'waiting') {
  const routes = seed('waiting');
  // Run 4 can be resumed: a resume point and its run dir, as a real paused run has (artifacts.mjs readPipelineByKey).
  { const four = routes.pipelineOf(4);
    getDb().prepare('UPDATE pipelines SET resume_point = ? WHERE id = ?').run(JSON.stringify({ version: 2 }), four);
    await mkdir(await runDirForRow(getDb().prepare('SELECT * FROM pipelines WHERE id = ?').get(four)), { recursive: true });
    const r = await post('/api/projects', { name: 'Proof', path: proj });   // a run resumes only in an onboarded project
    check(r.ok || r.status === 409, `waiting: the proof project is onboarded (HTTP ${r.status})`); }
  for (const theme of THEMES) {
    await metrics(WIDE);
    const where = `waiting, ${theme}, ${WIDE}px`;
    const toasts = await pressFour(routes, theme, where);
    check(!!toasts && toasts.some((t) => t.title === 'Waiting for its turn' && t.detail === 'Run 9 holds the turn'), `${where}: the held press says "Run 9 holds the turn" (${JSON.stringify(toasts)})`);
    await shotOf('#toasts .toast', `resume-held-toast-${theme}.png`);
    // More ways to resume, opened by its real button.
    await waitFor(`(() => { const b = ${VISIBLE('.hd-resume-more')}; return !!b; })()`, `${where}: More ways to resume`);
    await clearToasts();
    await sleep(800);   // the feature frame clears the slice info; the page paints the menu note once it reloads
    await ev(`(${VISIBLE('.hd-resume-more')}).click(), 0`);
    await waitFor(`(() => { const m = ${VISIBLE('.hd-resume-menu')}; return !!m && m.querySelector('.resume-on-saved small').textContent === 'Waiting for its turn after run 9'; })()`, `${where}: More ways to resume reads "Waiting for its turn after run 9"`);
    await shotOf('.hd-resume-menu', `resume-menu-held-${theme}.png`);
    await ev(`(${VISIBLE('.hd-resume-more')})?.click(), 0`);
    // The chat card's Resume (it acts on run 4): disabled, with its reason; Stop is still there.
    await go(routes.card, theme);
    const foot = `(() => { const b = [...document.querySelectorAll('.chat-rc-foot [data-model-action="resume"]')].find((x) => x.offsetParent); return b ? [b.textContent, b.disabled, b.title] : null; })()`;
    await waitFor(`(() => { const f = ${foot}; return !!f && f[0] === 'Waiting for its turn'; })()`, `${where}: the chat card's Resume reads "Waiting for its turn"`);
    const f = await ev(foot);
    check(!!f && f[0] === 'Waiting for its turn' && f[1] === true && f[2] === 'Goes on after run 9', `${where}: the chat card's Resume is disabled with "Goes on after run 9" (${JSON.stringify(f)})`);
    await skipWelcome();
    await shotOf('.chat-rc', `chat-resume-held-${theme}.png`);
    // The Runs list: the group line says it waits, once, and the group is not under Needs you.
    await go(routes.side, theme);
    await sleep(400);
    await ev(`(() => { const b = [...document.querySelectorAll('.gpage-back')].find((x) => x.offsetParent); if (b) b.click(); return 0; })()`);
    const sub = `(() => { const it = document.querySelector(${JSON.stringify(groupSel(routes.featureId))}); if (!it) return null;
      return { sub: it.querySelector(':scope > a.runs-row > .runs-row-sub')?.textContent || '', section: it.closest('.runs-sec')?.dataset.section || '' }; })()`;
    if (!await waitFor(`(() => { const r = ${sub}; return !!r && /waiting for its turn/i.test(r.sub); })()`, `${where}: the group line says it waits`)) {
      log(`  seen: ${JSON.stringify(await ev(`(() => ({ hash: location.hash, row: ${sub}, keys: [...document.querySelectorAll('.runs-item[data-row-key]')].map((x) => x.dataset.rowKey).slice(0, 12) }))()`))}`);
    }
    const g = await ev(sub);
    check(!!g && g.sub === 'Waiting for its turn · Run 4' && !/paused/i.test(g.sub) && g.section !== 'needs', `${where}: the Runs list group line reads "Waiting for its turn · Run 4", outside Needs you (${JSON.stringify(g)})`);
    await shotOf(groupSel(routes.featureId), `runs-group-held-${theme}.png`);
  }
  // The cost limit: a total limit below a cost seeded on the planning run (its cost ledger), set through the settings API.
  recordCostDelta({ pipelineId: routes.origin, amountUsd: 5 });
  { const r = await post('/api/settings', { totalCostLimitUsd: 1 }); check(r.ok, `waiting: the total cost limit is set (HTTP ${r.status})`); }
  for (const theme of THEMES) {
    await metrics(WIDE);
    const where = `waiting refused, ${theme}, ${WIDE}px`;
    const toasts = await pressFour(routes, theme, where);
    check(!!toasts && toasts.some((t) => t.title === 'Could not resume the run' && t.detail === 'Not resumed: the cost limit is reached'), `${where}: the refused press says "Not resumed: the cost limit is reached" (${JSON.stringify(toasts)})`);
    await shotOf('#toasts .toast', `resume-refused-${theme}.png`);
  }
  // Run 9 finishes: the held resume's turn comes, and the cost limit refuses it there.
  const nine = `run-${routes.pipelineOf(9)}`;
  runs.delete(nine); liveIds.splice(liveIds.indexOf(nine), 1);
  getDb().prepare("UPDATE pipelines SET status = 'done' WHERE id = ?").run(routes.pipelineOf(9));
  await schedulerTick();
  await sleep(1000);
  for (const theme of THEMES) {
    await metrics(WIDE);
    const where = `waiting refused at its turn, ${theme}, ${WIDE}px`;
    await go(routes.card, theme);
    await waitFor(`${memberWord(4)} === 'not resumed: the cost limit is reached'`, `${where}: run 4's row says why`);
    check(await ev(memberWord(4)) === 'not resumed: the cost limit is reached', `${where}: run 4's row reads "not resumed: the cost limit is reached" (${await ev(memberWord(4))})`);
    await skipWelcome();
    await shotOf('.chat-rc-members', `rows-refused-${theme}.png`);
  }
  { const r = await post('/api/settings', { totalCostLimitUsd: null }); check(r.ok, `waiting: the total cost limit is cleared (HTTP ${r.status})`); }
  // A run that cannot start names the run that can never finish, with its cause.
  const failedRoutes = seed('failed');
  for (const theme of THEMES) {
    await metrics(WIDE);
    const where = `cannot start, ${theme}, ${WIDE}px`;
    await go(failedRoutes.card, theme);
    if (!await waitFor(ready(SURFACES.card), `${where}: 16 marked run rows`)) continue;
    const words = [await ev(memberWord(15)), await ev(memberWord(16))];
    check(Array.isArray(words) && words.every((w) => /^cannot start · waits for run /.test(w || '')), `${where}: runs 15 and 16 read "cannot start · waits for run …" (${JSON.stringify(words)})`);
    await skipWelcome();
    await shotOf('.chat-rc-members', `rows-cannot-start-${theme}.png`);
  }
}

// Slice 16 (R-qa-5): each ask and failed row word's colour, the computed --bg and their ratio.
await writeFile(path.join(SHOTS, 'run-status-rows-contrast.json'), JSON.stringify(results.contrast, null, 2) + '\n');
results.errors = errors;
check(errors.length === 0, `no page errors${errors.length ? ` — ${errors.slice(0, 3).join(' | ')}` : ''}`);
results.minutes = Math.round((Date.now() - T0) / 600) / 100;
results.failed = failed;
const logFile = path.join(SHOTS, 'rows-measure.json');
await writeFile(logFile, JSON.stringify(results, null, 2) + '\n');
log(`${results.shots.length} PNGs and ${logFile} in ${results.minutes} min; ${failed ? `${failed} FAILED` : 'all passed'}`);
if (failed) process.exitCode = 1;
await shutdown(failed ? 1 : 0);
