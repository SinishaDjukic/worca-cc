// test/run-page-flag-off-golden.test.mjs — Shaper small runs D2 (D17), R-arch-1: "flag off changes nothing" for the run
// page, proved from the SAME tree, never from a frozen fixture.
// - Equality: the flag-off render of a marked run (live page and saved page) equals the flag-on render of its unmarked
//   twin, the same run with every small-runs marker removed (no `stepper.careRun`, a feature with no
//   `shape_stats.smallRuns`, so `/slice` carries no `owns` / `startsFrom`).
// - Sensitivity: the flag-on render of the marked run differs from that twin, and the test names the Shaper part that
//   makes the difference, so the equality cannot pass vacuously.
// - One carve-out: the live page paints its Care rows (`.rd-run-agents`) from `stepper.careRun` without reading the flag,
//   by design (the registry: "a feature started with it on keeps … Care"). The live Care pair removes them from both
//   sides (`withoutCareRows`); the live owns-only pair is the live overview's full-equality case.
// Every `/slice` answer a page stub serves is the real `ui/server.mjs` answer, fetched in `before()` under the same flag
// state as the page it feeds. A run-page change that has nothing to do with the flag (a new badge) moves both sides
// alike and needs no regeneration.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { runPageOn, helloRun } from './helpers/run-page-boot.mjs';
import { openDetail, settle as hdSettle, DETAIL, ok, detailOn, historyFetch } from './helpers/history-detail-boot.mjs';
import { getDb } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';
import { createSliceFeature } from '../src/core/shape/features.mjs';
import { careRunPlan } from '../src/shared/shape/feature-record.mjs';
import { applyFlags } from '../ui/public/flags.mjs';
import { buildRunsModel, renderRunsList } from '../ui/public/runs-list.mjs';
import { useSharedApp } from './helpers/shared-app-boot.mjs';

const nodeFetch = globalThis.fetch;   // captured before any jsdom boot replaces the global fetch

const app = useSharedApp({ before, beforeEach, after }, { fetchHandler: historyFetch() });
const bootApp = runPageOn(app);
const bootDetail = detailOn(app).detail;

useTempHome(after, 'worca-run-page-golden-');

// ── canon: the only text normaliser, applied to both sides of every comparison ─────────────────────────────────────
// Each rule is named. No other text is rewritten.
const CANON_RULES = {
  // `data-sig` values are paint signatures, not DOM shape.
  sig: [/ data-sig="[^"]*"/g, ' data-sig=""'],
  // Durations and clocks are wall-clock (an elapsed live run).
  duration: [/\d+(\.\d+)?\s?(ms|s|m|h|d)\b/g, 'T'],
  clock: [/\d{1,2}:\d{2}(:\d{2})?/g, 'T'],
  // `gv-moving` is a transient animation class the graph drops on a timer.
  moving: [/ gv-moving(?=[" ])/g, ''],
  // The route label counter is module-level in ui/public/run-head.mjs and shared across app.js boots.
  routeLabel: [/rd-route-label-\d+/g, 'rd-route-label-N'],
  // Each live page gets its own pipeline id (app.js caches a pipeline's /slice answer for the life of the shared app).
  pipelineId: [/\bp-g\d+\b/g, 'p-g'],
};
const canonText = (html) => Object.values(CANON_RULES).reduce((s, [re, to]) => s.replace(re, to), html);
// The Runs-list row only: the feature ids, the pipeline ids and the titles derived from them, and the ticket ids.
// They are rewritten BEFORE the text rules, whose duration rule would otherwise eat digits inside an id.
const canonRow = (html, fids) => canonText(fids.reduce((s, fid) => s.replaceAll(fid, 'FEATURE'), html)
  .replace(/golden-(marked|plain)/g, 'PIPELINE')
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'TICKET'));
const canon = (v) => (typeof v === 'string' ? canonText(v)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, canon(x)])) : v);

/** The single structural removal: the live page's Care rows, on both sides of the live Care pair only (D5). */
function withoutCareRows(html) {
  const doc = new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
  doc.querySelectorAll('.rd-run-agents').forEach((e) => e.remove());
  return doc.body.innerHTML;
}

const same = (a, b, label) => assert.deepEqual(canon(a), canon(b), `equality · ${label}`);
const differs = (a, b, label) => assert.notDeepEqual(canon(a), canon(b), `sensitivity · ${label}`);

// ── The three features and their real server answers ─────────────────────────────────────────────────────────────
const slice = (n) => ({ id: `s${n}`, title: `Slice ${n}`, goal: `Goal ${n}`, inScope: [], outOfScope: [], acceptance: [`ok ${n}`], dependsOn: [], estimate: 'M' });
const OUTLINE = { why: 'because', slices: [1, 2, 3].map(slice), agreed: [{ id: 'R-po-1', text: 'People see it' }], leftOut: [] };
OUTLINE.slices[0].requirements = ['R-po-1'];
let project;
const withFlag = async (on, fn) => {
  const prev = process.env.WORCA_FLAGS;
  try { if (on) process.env.WORCA_FLAGS = 'shaperSmallRuns'; else delete process.env.WORCA_FLAGS; return await fn(); }
  finally { if (prev === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prev; }
};
const feature = async (id, marked) => {
  seedPipelineRow({ id, projectKey: projectKey(project), status: 'done', title: id, branch: { source: 'main', feature: `feat/${id}` } });
  if (marked) getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(JSON.stringify({ smallRuns: true }), id);
  return (await withFlag(false, () => createSliceFeature({ pipelineId: id, projectDir: project, title: `Feature ${id}`, outline: OUTLINE,
    perspectives: ['product'], workflowId: 'wf_shape', startedBy: 'ann' }))).id;
};

let srv, base;
const get = async (p) => { const r = await nodeFetch(`${base}${p}`); return { status: r.status, body: await r.json() }; };
/** The real `/slice` answer of a pipeline under a flag state (a 404 stays a 404). */
const sliceAnswer = (pipelineId, on) => withFlag(on, () => get(`/api/shape/pipelines/${pipelineId}/slice`));
const groupOf = (fid, on) => withFlag(on, async () => (await get('/api/run-groups')).body.groups.find((x) => x.id === fid) || null);

const FEATURES = {};   // marked / plain → feature id
const API = {};        // the answers test 1 reads
// careRun (null: none) and the `/slice` answer for each flag state.
const CARE = careRunPlan('balanced', { runRoles: ['product', 'architect'] });
const RUNS = {};

before(async () => {
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  project = mkdtempSync(join(tmpdir(), 'worca-run-page-golden-proj-'));
  getDb();
  FEATURES.marked = await feature('golden-marked', true);
  FEATURES.plain = await feature('golden-plain', false);
  seedPipelineRow({ id: 'golden-dev', projectKey: projectKey(project), status: 'done', title: 'golden-dev' });
  const marked = { true: await sliceAnswer('golden-marked', true), false: await sliceAnswer('golden-marked', false) };
  const plain = { true: await sliceAnswer('golden-plain', true), false: await sliceAnswer('golden-plain', false) };
  const dev = { true: await sliceAnswer('golden-dev', true), false: await sliceAnswer('golden-dev', false) };
  Object.assign(API, { marked, plain, dev,
    groups: { markedOff: await groupOf(FEATURES.marked, false), markedOn: await groupOf(FEATURES.marked, true), plainOn: await groupOf(FEATURES.plain, true) } });
  Object.assign(RUNS, {
    care: { careRun: CARE, slice: marked },
    owns: { careRun: null, slice: marked },
    twin: { careRun: null, slice: plain },
    dev: { careRun: null, slice: dev },
  });
});
after(async () => {
  if (srv) await Promise.race([new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }), new Promise((r) => setTimeout(r, 500).unref?.())]);
  if (project) rmSync(project, { recursive: true, force: true });
});

// ── Test 1: the API keys ────────────────────────────────────────────────────────────────────────────────────────────
const keysOf = (a) => ({ status: a.status, keys: Object.keys(a.body).sort() });
const groupKeys = (g) => (g ? { keys: Object.keys(g).sort(), member: Object.keys(g.members[0]).sort() } : null);

test('/slice and /api/run-groups: flag off for a marked feature equals flag on for an unmarked one, and flag on for the marked one differs', () => {
  // Sensitivity first: the flag-on marked answers carry the Shaper parts.
  assert.equal(API.marked.true.status, 200, 'sensitivity · /slice · marked, flag on answers');
  assert.ok('owns' in API.marked.true.body, 'sensitivity · /slice · marked, flag on carries owns');
  assert.ok('startsFrom' in API.marked.true.body, 'sensitivity · /slice · marked, flag on carries startsFrom');
  differs(keysOf(API.marked.true), keysOf(API.plain.true), '/slice · marked on vs unmarked on');
  assert.ok(API.groups.markedOn && API.groups.markedOn.smallRuns, 'sensitivity · /api/run-groups · marked, flag on carries smallRuns');
  differs(groupKeys(API.groups.markedOn), groupKeys(API.groups.plainOn), '/api/run-groups · marked on vs unmarked on');
  // Equality.
  same(keysOf(API.marked.false), keysOf(API.plain.true), '/slice · marked off = unmarked on');
  same(groupKeys(API.groups.markedOff), groupKeys(API.groups.plainOn), '/api/run-groups · marked off = unmarked on');
  assert.equal(API.dev.true.status, 404, '/slice · dev run, flag on is no slice');
  same(keysOf(API.dev.false), keysOf(API.dev.true), '/slice · dev run off = on');
});

// ── The run page DOM ────────────────────────────────────────────────────────────────────────────────────────────────
const agent = (id, key) => ({ id, kind: 'agent', key, x: 0, y: 0, label: key, ports: { inputs: [], outputs: [] } });
const manifest = (careRun) => ({ version: 2, template: { id: 'wf_shape_slice_req' },
  graph: { nodes: [['n_clarify', 'clarify'], ['n_plan', 'planner'], ['n_refine', 'refiner'], ['n_impl', 'implementer'], ['n_review', 'reviewer'],
    ['n_roles', 'planReviewer'], ['n_tests', 'testWriter']].map(([id, key]) => agent(id, key)), wires: [] }, ...(careRun ? { careRun } : {}) });
const row = (nodeId, status = 'done') => ({ key: `x:${nodeId}:1`, executionId: `x:${nodeId}:1`, nodeId, ordinal: 1, cycle: 1, status, startedAt: '2026-11-21T10:00:00Z' });
const STEPS = ['n_clarify', 'n_plan', 'n_roles', 'n_refine'].map((id) => row(id));
const SUBS = [{ id: 'a1', label: 'Explore repo', nodeId: 'n_plan', cycle: 1, status: 'finished', durationMs: 124000, costUsd: 0.04 }];
/** The page's `/slice` stub: the real answer `before()` fetched for this run and this flag state. */
const sliceArm = (answer) => (url) => (/\/api\/shape\/pipelines\/[^/]+\/slice$/.test(url)
  ? (answer.status === 200 ? ok(answer.body) : Promise.resolve({ ok: false, status: answer.status, json: async () => answer.body })) : null);
const required = (d, sel) => {
  const e = d.querySelector(sel);
  if (!e) throw new TypeError(`missing ${sel}`);
  return e;
};

async function livePage(run, on) {
  const arm = sliceArm(run.slice[on]);
  const ctx = await bootApp({ fetchHandler: (u) => arm(u) || (u.endsWith('/api/history') ? ok({ pipelines: [], ghAvailable: false }) : null) });
  applyFlags({ shaperSmallRuns: on }, ctx.window.document);
  // its own pipeline id: the app keeps what it fetched for a pipeline across the tests of the one shared app
  helloRun(ctx, { runId: 'r-g', pipelineId: app.uid('p-g'), stepper: manifest(run.careRun), steps: [...STEPS, row('n_tests', 'start')],
    active: [{ nodeId: 'n_tests', executionId: 'x:n_tests:1' }], subAgents: SUBS, startedAt: '2026-01-01T00:00:00Z' });
  ctx.go('running/r-g');
  await ctx.settle(8);
  const d = ctx.window.document;
  const overview = required(d, '#run-detail .rd-sec[data-sec="overview"]').outerHTML;
  const tabs = required(d, '#run-detail .rd-tabs').outerHTML;
  const facts = d.querySelector('#run-detail .rd-run-facts')?.outerHTML ?? null;
  required(d, '#run-detail .rd-tab[data-sec="agents"]').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await ctx.settle(4);
  return { overview, tabs, agents: required(d, '#run-detail .rd-sec[data-sec="agents"]').outerHTML, facts };
}

async function savedPage(run, on) {
  const detail = { ...DETAIL, state: { ...DETAIL.state, stepper: manifest(run.careRun), steps: [...STEPS, row('n_tests'), row('n_impl')], subAgents: SUBS } };
  const ctx = await bootDetail({ detail, arms: sliceArm(run.slice[on]) });
  applyFlags({ shaperSmallRuns: on }, ctx.window.document);
  // Every saved page shares DETAIL's pipeline id, and the shared app keeps a pipeline's /slice answer across resets:
  // a schedules-changed frame clears that cache, so this page asks for (and paints) its own run's answer.
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'schedules-changed' }) });
  await hdSettle(ctx.window, 4);
  const asked = ctx.calls.length;
  await openDetail(ctx, 'details/overview');
  await hdSettle(ctx.window, 8);
  // flag off, the saved page reads no /slice at all (hdRunPlaces returns first)
  if (on) assert.ok(ctx.calls.slice(asked).some((c) => /\/api\/shape\/pipelines\/[^/]+\/slice$/.test(c.url)),
    'the saved page fetched its own /slice answer');
  const d = ctx.window.document;
  return { overview: required(d, '#hist-detail .hd-sec[data-sec="overview"]').outerHTML, tabs: required(d, '#hist-detail .hd-tabs').outerHTML };
}

// The twin's flag-on renders are shared by the pairs below (one boot each).
let liveTwinOn, savedTwinOn;
const liveTwin = async () => (liveTwinOn ||= await livePage(RUNS.twin, true));
const savedTwin = async () => (savedTwinOn ||= await savedPage(RUNS.twin, true));

test('live run page: flag off equals flag on of the unmarked twin (Care run, owns-only run, dev run)', async () => {
  const twin = await liveTwin();
  const careOff = await livePage(RUNS.care, false);
  same({ ...careOff, overview: withoutCareRows(careOff.overview) }, { ...twin, overview: withoutCareRows(twin.overview) }, 'live · care off = twin on');
  same(await livePage(RUNS.owns, false), twin, 'live · owns off = twin on');
  same(await livePage(RUNS.dev, false), await livePage(RUNS.dev, true), 'live · dev off = dev on');
});

test('saved run page: flag off equals flag on of the unmarked twin (Care run, dev run)', async () => {
  same(await savedPage(RUNS.care, false), await savedTwin(), 'saved · care off = twin on');
  same(await savedPage(RUNS.dev, false), await savedPage(RUNS.dev, true), 'saved · dev off = dev on');
});

test('sensitivity: flag on for a marked run differs from the unmarked twin, live and saved', async () => {
  const twin = await liveTwin();
  const careOn = await livePage(RUNS.care, true);
  differs(careOn, twin, 'live · care on vs twin on');
  const agentsTab = new JSDOM(careOn.tabs).window.document.querySelector('.rd-tab[data-sec="agents"]');
  assert.ok(agentsTab && agentsTab.hidden, 'sensitivity · live · care on: the Agents tab is hidden (merged into the Overview\'s Care rows)');
  const ownsOn = await livePage(RUNS.owns, true);
  assert.notEqual(ownsOn.facts, null, 'sensitivity · live · owns on: the .rd-run-facts box is painted');
  differs(ownsOn.facts, twin.facts, 'live · owns on vs twin on (.rd-run-facts)');
  const savedCareOn = await savedPage(RUNS.care, true);
  differs(savedCareOn, await savedTwin(), 'saved · care on vs twin on');
  assert.match(savedCareOn.overview, /class="rd-run-agents"/, 'sensitivity · saved · care on: the Overview holds .rd-run-agents');
});

// ── The Runs-list group row ─────────────────────────────────────────────────────────────────────────────────────────
test('Runs-list group row: flag off for the marked feature equals flag on for the unmarked one; flag on for the marked one differs', async () => {
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  const NOW = Date.parse('2026-10-18T12:00:00Z');
  const fids = [FEATURES.marked, FEATURES.plain];
  const draw = async (on, fid) => {
    const g = await groupOf(fid, on);
    const group = { id: g.id, groupKind: g.kind, title: g.title, cost: g.cost, ...(g.smallRuns ? { smallRuns: g.smallRuns } : {}),
      members: g.members.map((m) => ({ position: m.position, title: m.title, pipelineId: m.pipelineId, ticketId: m.ticketId,
        kind: m.pipelineId ? 'hist' : 'sched', run: m.pipelineId ? { status: m.status } : { ticket: m.ticket } })) };
    const history = g.members.filter((m) => m.pipelineId).map((m) => ({ id: m.pipelineId, projectKey: 'k', title: m.pipelineId, status: 'done', run: { status: 'done' } }));
    const host = doc.createElement('div');
    host.append(...renderRunsList(doc, buildRunsModel({ history, groups: [group], toggled: new Map([[`chain:${fid}`, true]]), now: NOW })));
    return canonRow(required(host, `.runs-item[data-row-key="chain:${fid}"]`).outerHTML, fids);
  };
  const plainOn = await draw(true, FEATURES.plain);
  assert.equal(await draw(false, FEATURES.marked), plainOn, 'equality · runs list · marked off = unmarked on');
  assert.notEqual(await draw(true, FEATURES.marked), plainOn, 'sensitivity · runs list · marked on vs unmarked on');
});
