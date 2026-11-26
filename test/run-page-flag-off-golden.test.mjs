// test/run-page-flag-off-golden.test.mjs — Shaper small runs D2 (D17): with the flag off, or for a run without the
// small-runs marker, the run page (live and saved), the Runs-list group row and the /slice and /api/run-groups keys
// are exactly dev's at checkpoint 3d1a51e17. The fixture holds each case's normalized outerHTML (only `data-sig`
// values are stripped) and the key lists. The fixtures below are written here (not imported from other test files),
// so this file runs on its own inside the checkpoint archive.
//
// The fixture was generated ONCE, from a `git archive` of the checkpoint, never from this tree:
//   D=$(mktemp -d "$TMPDIR/golden.XXXXXX"); git archive 3d1a51e17 | tar -x -C "$D"
//   ln -s "$PWD/node_modules" "$D/node_modules"; cp test/run-page-flag-off-golden.test.mjs "$D/test/"
//   (cd "$D" && UPDATE_RUN_PAGE_GOLDEN=1 node tools/test.mjs test/run-page-flag-off-golden.test.mjs)
//   cp "$D/test/fixtures/shaper/run-page-flag-off-golden.json" test/fixtures/shaper/
// Do NOT regenerate it on a later tree: it is the proof that flag-off output never moved.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { bootApp, helloRun } from './helpers/run-page-boot.mjs';
import { bootDetail, openDetail, settle as hdSettle, DETAIL, ROW, ok } from './helpers/history-detail-boot.mjs';
import { getDb } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';
import { createSliceFeature } from '../src/core/shape/features.mjs';
import { careRunPlan } from '../src/shared/shape/feature-record.mjs';
import { applyFlags } from '../ui/public/flags.mjs';
import { buildRunsModel, renderRunsList } from '../ui/public/runs-list.mjs';

const FIXTURE = new URL('./fixtures/shaper/run-page-flag-off-golden.json', import.meta.url);
const CAPTURED_AT = '3d1a51e17';
const UPDATE = process.env.UPDATE_RUN_PAGE_GOLDEN === '1';
const golden = UPDATE ? { capturedAt: CAPTURED_AT, cases: {} } : JSON.parse(readFileSync(FIXTURE, 'utf8'));
const nodeFetch = globalThis.fetch;   // the jsdom boots below replace the global fetch
const normalize = (html) => html.replace(/ data-sig="[^"]*"/g, ' data-sig=""');
// `gv-moving` is a transient animation class the graph drops on a timer: whether a snapshot holds it depends on load,
// not on the DOM shape. It is stripped from both sides at compare time, so the checkpoint fixture stays untouched.
// Where a run's agents execute (run-sandbox-note.mjs, #1634) came after the checkpoint and has nothing to do with the
// small-runs flag: its line under the status block and its header segment are stripped the same way.
const transient = (v) => (typeof v === 'string' ? v.replace(/ gv-moving(?=[" ])/g, '')
  .replace(/<p class="rd-exec-line"[^>]*>[\s\S]*?<\/p>/g, '')
  .replace(/<span class="rd-dot">·<\/span><(a|span) class="rd-exec-env[^"]*"[^>]*>[^<]*<\/\1>/g, '')
  : Array.isArray(v) ? v.map(transient) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, transient(x)])) : v);
const check = (name, value) => {
  if (UPDATE) { golden.cases[name] = value; return; }
  assert.ok(name in golden.cases, `${name} is in the golden`);
  assert.deepEqual(transient(value), transient(golden.cases[name]), name);
};

useTempHome(after, 'worca-run-page-golden-');

// ── The three runs: a marked Care run, an unmarked feature run, a dev run ──────────────────────────────────────────
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
before(async () => {
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  project = mkdtempSync(join(tmpdir(), 'worca-run-page-golden-proj-'));
  getDb();
});
after(async () => {
  if (srv) await Promise.race([new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }), new Promise((r) => setTimeout(r, 500).unref?.())]);
  if (project) rmSync(project, { recursive: true, force: true });
  if (UPDATE) writeFileSync(FIXTURE, `${JSON.stringify(golden, null, 2)}\n`);
});

// The API is checked first: the jsdom boots of the next test replace the global fetch.
test('D2 golden: /slice and /api/run-groups keep dev\'s keys (marked + flag off, unmarked + flag on, dev run + flag on)', async () => {
  const marked = await feature('golden-marked', true);
  const plain = await feature('golden-plain', false);
  seedPipelineRow({ id: 'golden-dev', projectKey: projectKey(project), status: 'done', title: 'golden-dev' });
  const get = async (p) => { const r = await nodeFetch(`${base}${p}`); return { status: r.status, body: await r.json() }; };
  const sliceKeys = async (pid) => { const r = await get(`/api/shape/pipelines/${pid}/slice`); return { status: r.status, keys: Object.keys(r.body) }; };
  const groupKeys = async (fid) => {
    const g = (await get('/api/run-groups')).body.groups.find((x) => x.id === fid);
    return g ? { keys: Object.keys(g), member: Object.keys(g.members[0]) } : null;
  };
  check('api: marked, flag off', await withFlag(false, async () => ({ slice: await sliceKeys('golden-marked'), group: await groupKeys(marked) })));
  check('api: unmarked, flag on', await withFlag(true, async () => ({ slice: await sliceKeys('golden-plain'), group: await groupKeys(plain) })));
  check('api: dev run, flag on', await withFlag(true, async () => ({ slice: await sliceKeys('golden-dev') })));
});

// ── The run page DOM ────────────────────────────────────────────────────────────────────────────────────────────────
const agent = (id, key) => ({ id, kind: 'agent', key, x: 0, y: 0, label: key, ports: { inputs: [], outputs: [] } });
const manifest = (careRun) => ({ version: 2, template: { id: 'wf_shape_slice_req' },
  graph: { nodes: [['n_clarify', 'clarify'], ['n_plan', 'planner'], ['n_refine', 'refiner'], ['n_impl', 'implementer'], ['n_review', 'reviewer'],
    ['n_roles', 'planReviewer'], ['n_tests', 'testWriter']].map(([id, key]) => agent(id, key)), wires: [] }, ...(careRun ? { careRun } : {}) });
const row = (nodeId, status = 'done') => ({ key: `x:${nodeId}:1`, executionId: `x:${nodeId}:1`, nodeId, ordinal: 1, cycle: 1, status, startedAt: '2026-11-21T10:00:00Z' });
const CARE = careRunPlan('balanced', { runRoles: ['product', 'architect'] });
const STEPS = ['n_clarify', 'n_plan', 'n_roles', 'n_refine'].map((id) => row(id));
const SUBS = [{ id: 'a1', label: 'Explore repo', nodeId: 'n_plan', cycle: 1, status: 'finished', durationMs: 124000, costUsd: 0.04 }];
const DEV_SLICE = { featureId: 'feat_g', title: 'Charts', index: 2, total: 3, sliceTitle: 'Export', state: 'running', next: null, threadId: null };
/** name → { flag (UI), careRun, slice answer (null: 404, not a slice) } */
const RUNS = {
  'marked care, flag off': { flag: false, careRun: CARE, slice: DEV_SLICE },
  'unmarked feature, flag on': { flag: true, careRun: null, slice: DEV_SLICE },
  'dev run, flag on': { flag: true, careRun: null, slice: null },
};
const sliceArm = (c) => (url) => (/\/api\/shape\/pipelines\/[^/]+\/slice$/.test(url)
  ? (c.slice ? ok(c.slice) : Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'not a slice' }) })) : null);
// Times are wall-clock (an elapsed live run): the digits of a duration or clock text are not the run page's DOM shape.
const stable = (html) => normalize(html).replace(/\d+(\.\d+)?\s?(ms|s|m|h|d)\b/g, 'T').replace(/\d{1,2}:\d{2}(:\d{2})?/g, 'T');

async function livePage(c) {
  const ctx = await bootApp({ fetchHandler: (u) => sliceArm(c)(u) || (u.endsWith('/api/history') ? ok({ pipelines: [], ghAvailable: false }) : null) });
  applyFlags({ shaperSmallRuns: c.flag }, ctx.window.document);
  helloRun(ctx, { runId: 'r-g', pipelineId: 'p-g', stepper: manifest(c.careRun), steps: [...STEPS, row('n_tests', 'start')],
    active: [{ nodeId: 'n_tests', executionId: 'x:n_tests:1' }], subAgents: SUBS, startedAt: '2026-01-01T00:00:00Z' });
  ctx.go('running/r-g');
  await ctx.settle(8);
  const d = ctx.window.document;
  const overview = d.querySelector('#run-detail .rd-sec[data-sec="overview"]').outerHTML;
  const tabs = d.querySelector('#run-detail .rd-tabs').outerHTML;
  const btn = d.querySelector('#run-detail .rd-tab[data-sec="agents"]');
  btn.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await ctx.settle(4);
  return { overview: stable(overview), tabs: stable(tabs), agents: stable(d.querySelector('#run-detail .rd-sec[data-sec="agents"]').outerHTML) };
}

async function savedPage(c) {
  const detail = { ...DETAIL, state: { ...DETAIL.state, stepper: manifest(c.careRun), steps: [...STEPS, row('n_tests'), row('n_impl')], subAgents: SUBS } };
  const ctx = await bootDetail({ detail, arms: sliceArm(c) });
  applyFlags({ shaperSmallRuns: c.flag }, ctx.window.document);
  await openDetail(ctx, 'details/overview');
  await hdSettle(ctx.window, 8);
  const d = ctx.window.document;
  return { overview: stable(d.querySelector(`#hist-detail .hd-sec[data-sec="overview"]`).outerHTML), tabs: stable(d.querySelector('#hist-detail .hd-tabs').outerHTML) };
}

test('D2 golden: the live and saved run page are dev\'s for a marked Care run (flag off), an unmarked feature run and a dev run (flag on)', async () => {
  assert.ok(ROW.id);
  for (const [name, c] of Object.entries(RUNS)) {
    check(`live: ${name}`, await livePage(c));
    check(`saved: ${name}`, await savedPage(c));
  }
});

// ── The Runs-list group row ─────────────────────────────────────────────────────────────────────────────────────────
test('D2 golden: the Runs-list group row of an unmarked feature (flag on) and a marked feature (flag off) is dev\'s', async () => {
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  const NOW = Date.parse('2026-10-18T12:00:00Z');
  const draw = async (on, fid) => withFlag(on, async () => {
    const r = await nodeFetch(`${base}/api/run-groups`);
    const g = (await r.json()).groups.find((x) => x.id === fid);
    const group = { id: g.id, groupKind: g.kind, title: g.title, cost: g.cost, ...(g.smallRuns ? { smallRuns: g.smallRuns } : {}),
      members: g.members.map((m) => ({ position: m.position, title: m.title, pipelineId: m.pipelineId, ticketId: m.ticketId,
        kind: m.pipelineId ? 'hist' : 'sched', run: m.pipelineId ? { status: m.status } : { ticket: m.ticket } })) };
    const history = g.members.filter((m) => m.pipelineId).map((m) => ({ id: m.pipelineId, projectKey: 'k', title: m.pipelineId, status: 'done', run: { status: 'done' } }));
    const host = doc.createElement('div');
    host.append(...renderRunsList(doc, buildRunsModel({ history, groups: [group], toggled: new Map([[`chain:${fid}`, true]]), now: NOW })));
    return normalize(host.querySelector(`.runs-item[data-row-key="chain:${fid}"]`).outerHTML)
      .replace(new RegExp(fid, 'g'), 'FEATURE').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'TICKET');
  });
  const ids = getDb().prepare("SELECT id, origin_pipeline_id FROM shape_features WHERE origin_pipeline_id IN ('golden-marked', 'golden-plain')").all();
  const fidOf = (o) => ids.find((x) => x.origin_pipeline_id === o).id;
  check('runs list: unmarked, flag on', await draw(true, fidOf('golden-plain')));
  check('runs list: marked, flag off', await draw(false, fidOf('golden-marked')));
  if (!UPDATE) assert.equal(golden.capturedAt, CAPTURED_AT);
  assert.ok(UPDATE || existsSync(FIXTURE));
});
