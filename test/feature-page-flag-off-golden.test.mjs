// test/feature-page-flag-off-golden.test.mjs — Shaper small runs D3 (D17): with the flag off for a marked feature, or
// for an unmarked feature with the flag on, the #feature/ID group page (Runs, Overview and Decisions tabs) is exactly
// dev's at checkpoint 94de52ef8, and a marked feature's `ship.smallRuns` entries keep dev's keys with the flag off. The
// fixture holds each case's normalized `.gpage` outerHTML (only `data-sig` values and clock digits are stripped) and the
// key lists. The fixtures below are written here (not imported from other test files), so this file runs on its own
// inside the checkpoint archive.
//
// The fixture was generated ONCE, from a `git archive` of the checkpoint, never from this tree:
//   D=$(mktemp -d "$TMPDIR/golden.XXXXXX"); git archive 94de52ef8 | tar -x -C "$D"
//   ln -s "$PWD/node_modules" "$D/node_modules"; cp test/feature-page-flag-off-golden.test.mjs "$D/test/"
//   (cd "$D" && UPDATE_FEATURE_PAGE_GOLDEN=1 node tools/test.mjs test/feature-page-flag-off-golden.test.mjs)
//   cp "$D/test/fixtures/shaper/feature-page-flag-off-golden.json" test/fixtures/shaper/
// Do NOT regenerate it on a later tree: it is the proof that flag-off output never moved.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { bootApp } from './helpers/run-page-boot.mjs';
import { getDb } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';
import { createSliceFeature, featureView } from '../src/core/shape/features.mjs';
import { applyFlags } from '../ui/public/flags.mjs';

const FIXTURE = new URL('./fixtures/shaper/feature-page-flag-off-golden.json', import.meta.url);
const CAPTURED_AT = '94de52ef8';
const UPDATE = process.env.UPDATE_FEATURE_PAGE_GOLDEN === '1';
const golden = UPDATE ? { capturedAt: CAPTURED_AT, cases: {} } : JSON.parse(readFileSync(FIXTURE, 'utf8'));
// Times are wall-clock: the digits of a duration or clock text are not the page's DOM shape.
const stable = (html) => html.replace(/ data-sig="[^"]*"/g, ' data-sig=""')
  .replace(/\d+(\.\d+)?\s?(ms|s|m|h|d)\b/g, 'T').replace(/\d{1,2}:\d{2}(:\d{2})?/g, 'T');
const check = (name, value) => {
  if (UPDATE) { golden.cases[name] = value; return; }
  assert.ok(name in golden.cases, `${name} is in the golden`);
  assert.deepEqual(value, golden.cases[name], name);
};

useTempHome(after, 'worca-feature-page-golden-');
after(() => { if (UPDATE) writeFileSync(FIXTURE, `${JSON.stringify(golden, null, 2)}\n`); });

const withFlag = async (on, fn) => {
  const prev = process.env.WORCA_FLAGS;
  try { if (on) process.env.WORCA_FLAGS = 'shaperSmallRuns'; else delete process.env.WORCA_FLAGS; return await fn(); }
  finally { if (prev === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prev; }
};

// ── The server: a marked feature's ship.smallRuns entries with the flag off ──────────────────────────────────────────
const slice = (n) => ({ id: `s${n}`, title: `Slice ${n}`, goal: `Goal ${n}`, inScope: [], outOfScope: [], acceptance: [`ok ${n}`], dependsOn: [], estimate: 'M' });
const OUTLINE = { why: 'because', slices: [1, 2, 3].map(slice), leftOut: [],
  agreed: [{ id: 'R-po-1', text: 'People see it' }, { id: 'R-po-2', text: 'People export it' }, { id: 'R-comp-1', text: 'A signed copy is kept' }] };
OUTLINE.slices[0].requirements = ['R-po-1'];
OUTLINE.slices[1].requirements = ['R-po-2'];

test('D3 golden: a marked feature\'s ship.smallRuns entries keep dev\'s keys with the flag off', async () => {
  const project = mkdtempSync(join(tmpdir(), 'worca-feature-page-golden-proj-'));
  try {
    seedPipelineRow({ id: 'fgold-marked', projectKey: projectKey(project), status: 'done', title: 'fgold-marked', branch: { source: 'main', feature: 'feat/fgold' } });
    getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(JSON.stringify({ smallRuns: true }), 'fgold-marked');
    const id = (await withFlag(false, () => createSliceFeature({ pipelineId: 'fgold-marked', projectDir: project, title: 'Feature gold', outline: OUTLINE,
      perspectives: ['product'], workflowId: 'wf_shape', startedBy: 'ann' }))).id;
    getDb().prepare('UPDATE shape_features SET requirement_kinds = ? WHERE id = ?')
      .run(JSON.stringify({ 'R-comp-1': { kind: 'confirmed', role: 'compliance' } }), id);
    const sr = await withFlag(false, () => featureView(id).ship.smallRuns);
    const keys = (xs) => xs.map((e) => Object.keys(e).sort());
    check('api: marked, flag off: ship.smallRuns entry keys', { owned: keys(sr.owned), confirmed: keys(sr.confirmed) });
  } finally { rmSync(project, { recursive: true, force: true }); }
});

// ── The page: a 3-run feature, marked with the flag off, and unmarked with the flag on ─────────────────────────────────
const member = (i) => ({ position: i, title: `Slice ${i}`, pipelineId: `p${i}`, ticketId: null, status: 'done', pr: null, ticket: null, adhoc: false, after: null });
const GROUPS = { groups: [{ id: 'feat_g', kind: 'feature', title: 'Run tags', projectKey: null, planning: null,
  members: [member(1), member(2), member(3)], cost: { usd: 1.5, byPipeline: {} } }] };
const SMALL_RUNS = {
  confirmed: [{ id: 'R-comp-1', text: 'A signed copy is kept', role: 'compliance', roleLabel: 'Compliance', state: 'waiting', mark: null, reason: null, at: null }],
  owned: [{ id: 'R-po-1', text: 'People see it', run: 1, status: 'holds' }, { id: 'R-po-2', text: 'People export it', run: 2, status: 'holds' }],
  waiting: ['R-comp-1'], blocked: true, reason: 'Waiting for Compliance to confirm R-comp-1', met: { met: 2, total: 3 }, unmet: [],
  care: { choice: "Balanced · Worca's pick", outcome: null, line: "Care: Balanced · Worca's pick" }, base: 'main',
  order: [1, 2, 3].map((i) => ({ index: i, pipelineId: `p${i}`, title: `Slice ${i}`, pr: null, onto: null })),
};
const feature = (marked) => ({ id: 'feat_g', title: 'Run tags', projectKey: 'acme', status: 'active', approveEach: false, total: 3, done: 3, halted: null,
  open: false, replacedBy: null, replan: null, originPipelineId: 'p0', log: [{ key: 'outline', run: null, text: 'Split into 3 runs', detail: [] }],
  slices: [1, 2, 3].map((i) => ({ index: i, title: `Slice ${i}`, state: 'done', pipelineId: `p${i}`, pr: null })),
  ship: { ready: true, mode: null, prUrl: null, suggested: null, linesAdded: null, linesRemoved: null, files: null, result: null,
    ...(marked ? { smallRuns: SMALL_RUNS } : {}) } });
const json = (b, s = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } }));

async function pages(marked, flag) {
  const f = feature(marked);
  const ctx = await bootApp({ fetchHandler: (url) => (url.startsWith('/api/run-groups') ? json(GROUPS)
    : url.startsWith('/api/shape/features/feat_g') ? json(f)
      : url.startsWith('/api/night-decisions') ? json({ decisions: [] })
        : url.startsWith('/api/history') ? json({ pipelines: [], ghAvailable: false }) : null) });
  applyFlags({ shaperSmallRuns: flag }, ctx.window.document);
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', runs: [] });
  await ctx.settle();
  const out = {};
  for (const [name, hash] of [['runs', 'feature/feat_g'], ['overview', 'feature/feat_g/overview'], ['decisions', 'feature/feat_g/decisions']]) {
    ctx.go(hash);
    await ctx.settle(10);
    const gp = ctx.window.document.querySelector('#runs-pane #group-detail .gpage');
    assert.ok(gp, `${name}: the group page rendered`);
    out[name] = stable(gp.outerHTML);
  }
  return out;
}

test('D3 golden: flag off marked and flag on unmarked: the group page equals the checkpoint golden', async () => {
  check('page: marked, flag off', await pages(true, false));
  check('page: unmarked, flag on', await pages(false, true));
  if (!UPDATE) assert.equal(golden.capturedAt, CAPTURED_AT);
  assert.ok(UPDATE || existsSync(FIXTURE));
});
