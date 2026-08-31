// test/artifacts-db.test.mjs
// Phase 3 — artifacts.mjs on node:sqlite (store_meta, ensureMeta, writeState,
// appendAudit). Each test runs against a throwaway WORCA_HOME with the DB
// singleton reset so getDb() reopens against it (mirrors 01-db-foundation.md).
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { readStoreMeta, writeStoreMeta, deleteStoreMeta } from '../src/core/artifacts.mjs';
import { ensureArtifactDirs, writeState, appendAudit, createPipeline, updatePipelineTitle } from '../src/core/artifacts.mjs';
import { recordArtifact, listArtifacts } from '../src/core/artifacts.mjs';
import { writeReview, readReviewRow, readPipelineExtras, readPipelineByKey, writeClarify } from '../src/core/artifacts.mjs';
import { readRunLogText } from '../src/core/artifacts.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { projectKey } from '../src/core/store.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { writeSeedGraph } from './helpers/graph-templates.mjs';

const homes = [];
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-art-'));
  homes.push(dir);
  _resetForTests();
  process.env.WORCA_HOME = dir;
});
after(async () => {
  _resetForTests();
  delete process.env.WORCA_HOME;
  await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true })));
});

// ── Task 3.1 — store_meta read/write/delete ────────────────────────────────────

test('store_meta: write then read round-trips the JSON payload', () => {
  const data = { key: 'k1', path: '/p/k1', name: 'K One', firstSeenAt: '2026-01-01T00:00:00Z' };
  writeStoreMeta('k1', 'project', data);
  assert.deepEqual(readStoreMeta('k1'), data);
});

test('store_meta: read of an unknown key returns null', () => {
  assert.equal(readStoreMeta('nope'), null);
});

test('store_meta: write is an upsert (second write replaces)', () => {
  writeStoreMeta('k1', 'project', { name: 'old' });
  writeStoreMeta('k1', 'project', { name: 'new' });
  assert.deepEqual(readStoreMeta('k1'), { name: 'new' });
});

test('store_meta: delete removes the row', () => {
  writeStoreMeta('k1', 'workspace', { name: 'x' });
  deleteStoreMeta('k1');
  assert.equal(readStoreMeta('k1'), null);
});

// ── Task 3.2 — ensureMeta/ensureWorkspaceMeta back onto store_meta ──────────────

test('ensureArtifactDirs persists project meta to store_meta and preserves firstSeenAt', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-proj-'));
  homes.push(proj);
  const p1 = await ensureArtifactDirs(proj);
  assert.equal(p1.meta.key, projectKey(proj));
  assert.ok(p1.meta.firstSeenAt);
  // Row exists in the DB, not as a meta.json file.
  assert.deepEqual(readStoreMeta(projectKey(proj)), p1.meta);
  const p2 = await ensureArtifactDirs(proj); // re-run
  assert.equal(p2.meta.firstSeenAt, p1.meta.firstSeenAt, 'firstSeenAt preserved');
});

// ── Task 3.3 — writeState UPSERT pipelines + REPLACE pipeline_steps ─────────────

function fullState(over = {}) {
  return {
    id: 'aaaa1111', title: 'Demo', projectDir: '/p', projectKey: 'proj-00000001',
    projectName: 'P', status: 'running', phase: 'plan', cycle: 1,
    startedAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z',
    totalCostUsd: 0.17, totalActiveMs: 4200, prompt: 'do the thing',
    branch: { source: 'main', feature: 'worca-cc/demo-aaaa1111', worktreeDir: '/wt', reusedExisting: false },
    stepper: { nodes: [{ id: 's0_0' }] }, tools: { tool: 'graphify', kind: 'cli' },
    steps: [
      { key: 'plan', phase: 'plan', nodeId: 's0_0', stepIndex: 0, cycle: 1, status: 'done',
        startedAt: '2026-06-01T00:00:01Z', updatedAt: '2026-06-01T00:00:02Z', activeMs: 1200, runningSince: null, costUsd: 0.10 },
      { key: 'implement#1', phase: 'implement', cycle: 1, status: 'running',
        startedAt: '2026-06-01T00:00:03Z', updatedAt: '2026-06-01T00:00:03Z', activeMs: 0, runningSince: 1700000000000, costUsd: 0.07 },
    ],
    ...over,
  };
}

test('writeState upserts a pipelines row with scalar + JSON columns', async () => {
  const out = await writeState('/some/dir-aaaa1111', fullState());
  assert.ok(out.updatedAt, 'returns the stamped object');
  const row = getDb().prepare('SELECT * FROM pipelines WHERE id = ?').get('aaaa1111');
  assert.equal(row.title, 'Demo');
  assert.equal(row.project_key, 'proj-00000001');
  assert.equal(row.status, 'running');
  assert.equal(row.total_cost_usd, 0.17);
  assert.equal(row.total_active_ms, 4200);
  assert.equal(row.prompt, 'do the thing');
  assert.equal(JSON.parse(row.branch).feature, 'worca-cc/demo-aaaa1111');
  assert.equal(JSON.parse(row.tools).tool, 'graphify');
});

test('writeState replaces pipeline_steps from state.steps[]', async () => {
  await writeState('/d-aaaa1111', fullState());
  let steps = getDb().prepare('SELECT * FROM pipeline_steps WHERE pipeline_id = ? ORDER BY key').all('aaaa1111');
  assert.equal(steps.length, 2);
  const plan = steps.find((s) => s.key === 'plan');
  assert.equal(plan.node_id, 's0_0');
  assert.equal(plan.active_ms, 1200);
  assert.equal(plan.cost_usd, 0.10);
  assert.equal(plan.running_since, null);
  const impl = steps.find((s) => s.key === 'implement#1');
  assert.equal(impl.running_since, '1700000000000', 'epoch-ms stored as text is round-trippable');

  // A second writeState with FEWER steps must REPLACE (not merge).
  await writeState('/d-aaaa1111', fullState({ steps: [fullState().steps[0]] }));
  steps = getDb().prepare('SELECT key FROM pipeline_steps WHERE pipeline_id = ?').all('aaaa1111');
  assert.deepEqual(steps.map((s) => s.key), ['plan'], 'old implement#1 row removed on replace');
});

test('writeState persists the workspace superset into workspace_meta', async () => {
  await writeState('/d-bbbb2222', fullState({
    id: 'bbbb2222', target: 'workspace', workspaceKey: 'wks-demo-12345678',
    workspaceId: 'wks-demo-12345678', workspaceName: 'Demo WS', workspaceDescription: 'desc',
    projectKeys: ['p1', 'p2'], projects: [{ projectKey: 'p1', projectDir: '/a', projectName: 'a' }],
    checkpointRefs: { p1: 'abc' }, branches: { p1: { feature: 'f' } },
  }));
  const row = getDb().prepare('SELECT target, workspace_key, workspace_meta FROM pipelines WHERE id = ?').get('bbbb2222');
  assert.equal(row.target, 'workspace');
  assert.equal(row.workspace_key, 'wks-demo-12345678');
  const wm = JSON.parse(row.workspace_meta);
  assert.deepEqual(wm.projectKeys, ['p1', 'p2']);
  assert.equal(wm.workspaceName, 'Demo WS');
  assert.deepEqual(wm.branches, { p1: { feature: 'f' } });
});

// A11(a) — the curated ON CONFLICT DO UPDATE SET list MUST NOT clobber the
// creation-immutable identity columns that the orchestrator's this.state omits
// (prompt/title/started_at). Simulate: createPipeline's INSERT (full identity)
// then a _persist()-style re-write whose object is missing prompt/title (as
// this.state is). The immutable columns must survive; only the mutable columns
// update.
test('writeState UPSERT preserves creation-immutable columns absent from a later state (A11a)', async () => {
  // 1) Initial persist with the full identity (what createPipeline writes).
  await writeState('/d-cccc3333', fullState({
    id: 'cccc3333', prompt: 'ORIGINAL PROMPT', title: 'Orig Title',
    baseName: 'orig-base', datePrefix: '01-06-26', startedAt: '2026-06-01T00:00:00Z',
    status: 'created', phase: 'created',
  }));
  // 2) A later persist whose object OMITS prompt/title (mirrors orchestrator
  //    this.state, which never carries them) but mutates status/cost.
  const later = fullState({ id: 'cccc3333', status: 'done', phase: 'done', totalCostUsd: 0.99 });
  delete later.prompt;
  later.title = undefined; // present-but-undefined, as a partial state object can be
  await writeState('/d-cccc3333', later);
  const row = getDb().prepare('SELECT * FROM pipelines WHERE id = ?').get('cccc3333');
  // Mutable columns updated:
  assert.equal(row.status, 'done', 'status mutates');
  assert.equal(row.total_cost_usd, 0.99, 'cost mutates');
  // Creation-immutable columns survived (NOT nulled by the second write):
  assert.equal(row.prompt, 'ORIGINAL PROMPT', 'prompt preserved (A11a)');
  assert.equal(row.title, 'Orig Title', 'title preserved (A11a)');
  assert.equal(row.started_at, '2026-06-01T00:00:00Z', 'started_at preserved (A11a)');
});

// A11(a) + 3.5 fix — base_name/date_prefix are the one createPipeline-owned pair
// that the orchestrator sets LATER (orchestrator.mjs:351-352), not in
// createPipeline's INSERT (§0.2). They must FILL from a later writeState
// (NULL->value, via COALESCE) AND, once set, must NEVER be clobbered back to NULL
// by a still-later writeState that omits them. This is the dead-NULL bug the 3.5
// COALESCE(excluded.col, col) guard closes while keeping the anti-clobber promise.
test('writeState fills base_name/date_prefix from a later state then never clobbers them to NULL (A11a / 3.5)', async () => {
  // 1) createPipeline-style INSERT: identity set, but NO baseName/datePrefix
  //    (createPipeline's state object never carries them).
  const created = fullState({
    id: 'ffff6666', prompt: 'CP PROMPT', title: 'CP Title',
    startedAt: '2026-06-01T00:00:00Z', status: 'created', phase: 'created',
  });
  delete created.baseName; delete created.datePrefix;
  await writeState('/d-ffff6666', created);
  let row = getDb().prepare('SELECT base_name, date_prefix FROM pipelines WHERE id = ?').get('ffff6666');
  assert.equal(row.base_name, null, 'base_name starts NULL (createPipeline does not set it)');
  assert.equal(row.date_prefix, null, 'date_prefix starts NULL (createPipeline does not set it)');

  // 2) The orchestrator sets this.state.baseName/datePrefix at :351-352, then the
  //    first _persist(): the COALESCE guard must FILL the NULL columns.
  await writeState('/d-ffff6666', fullState({
    id: 'ffff6666', baseName: 'cp-base', datePrefix: '01-06-26', status: 'running', phase: 'plan',
  }));
  row = getDb().prepare('SELECT base_name, date_prefix, status FROM pipelines WHERE id = ?').get('ffff6666');
  assert.equal(row.base_name, 'cp-base', 'base_name FILLED from the later state (NULL->value)');
  assert.equal(row.date_prefix, '01-06-26', 'date_prefix FILLED from the later state (NULL->value)');
  assert.equal(row.status, 'running', 'status still mutates');

  // 3) A still-later _persist() whose object OMITS baseName/datePrefix (a partial
  //    state object) must NOT clobber the now-set values back to NULL.
  const partial = fullState({ id: 'ffff6666', status: 'done', phase: 'done' });
  delete partial.baseName; delete partial.datePrefix;
  await writeState('/d-ffff6666', partial);
  row = getDb().prepare('SELECT base_name, date_prefix, status FROM pipelines WHERE id = ?').get('ffff6666');
  assert.equal(row.base_name, 'cp-base', 'base_name NOT clobbered to NULL by a later omitting state');
  assert.equal(row.date_prefix, '01-06-26', 'date_prefix NOT clobbered to NULL by a later omitting state');
  assert.equal(row.status, 'done', 'status still mutates on the final write');
});

// C1 — toPipelineRow derives project_key from projectDir when the object omits
// projectKey (the orchestrator's this.state carries projectDir, not projectKey).
// The INSERT arm must satisfy project_key NOT NULL via the derivation.
test('writeState derives project_key from projectDir when projectKey is absent (C1)', async () => {
  const st = fullState({ id: 'dddd4444' });
  delete st.projectKey; // mirror orchestrator this.state (projectDir only)
  st.projectDir = '/p';
  await writeState('/d-dddd4444', st);
  const row = getDb().prepare('SELECT project_key FROM pipelines WHERE id = ?').get('dddd4444');
  assert.equal(row.project_key, projectKey('/p'), 'project_key derived from projectDir');
});

test('writeState with an id-less state is a no-op (returns the stamped object, inserts nothing)', async () => {
  const before = getDb().prepare('SELECT COUNT(*) c FROM pipelines').get().c;
  const out = await writeState('/d-noid', fullState({ id: null }));
  assert.ok(out.updatedAt, 'still returns the stamped object');
  const after = getDb().prepare('SELECT COUNT(*) c FROM pipelines').get().c;
  assert.equal(after, before, 'no row inserted for an id-less state');
});

// ── updatePipelineTitle — dedicated post-creation title UPDATE ──────────────────

test('updatePipelineTitle mutates the title column (and only that)', async () => {
  const p = await createPipeline(process.cwd(), { prompt: 'Provisional first line\nmore' });
  const before = getDb().prepare('SELECT title, prompt, started_at FROM pipelines WHERE id=?').get(p.id);
  assert.equal(before.title, 'Provisional first line');

  updatePipelineTitle(p.id, 'Concise LLM Title');

  const after = getDb().prepare('SELECT title, prompt, started_at FROM pipelines WHERE id=?').get(p.id);
  assert.equal(after.title, 'Concise LLM Title');
  assert.equal(after.prompt, before.prompt, 'prompt untouched');         // immutable column preserved
  assert.equal(after.started_at, before.started_at, 'started_at untouched');
});

test('updatePipelineTitle is a no-op for blank input or unknown id', async () => {
  const p = await createPipeline(process.cwd(), { prompt: 'Keep me' });
  updatePipelineTitle(p.id, '');            // blank → ignored
  updatePipelineTitle('does-not-exist', 'X');
  const row = getDb().prepare('SELECT title FROM pipelines WHERE id=?').get(p.id);
  assert.equal(row.title, 'Keep me');
});

// ── Task 3.4 — appendAudit -> pipeline_events ──────────────────────────────────

test('appendAudit inserts a pipeline_events row resolved from the dir basename id', async () => {
  // Seed a pipelines row the event can FK to.
  await writeState('/whatever-aaaa1111', fullState()); // id aaaa1111
  // A dir whose basename ends in -aaaa1111; the cache is cold for this exact path,
  // so resolution falls back to the basename regex.
  await appendAudit('/x/store/k/pipelines/01-06-26-demo-aaaa1111', 'Pipeline created.');
  await appendAudit('/x/store/k/pipelines/01-06-26-demo-aaaa1111', 'Workflow: default.');
  const rows = getDb().prepare(
    'SELECT ts, text FROM pipeline_events WHERE pipeline_id = ? ORDER BY id').all('aaaa1111');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].text, 'Pipeline created.');
  assert.equal(rows[1].text, 'Workflow: default.');
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(rows[0].ts), 'ts is an ISO timestamp');
});

test('appendAudit uses the dir->id cache fast path seeded by writeState', async () => {
  // writeState seeds rememberDir(resolve('/run/01-06-26-x-aaaa1111'), 'aaaa1111').
  await writeState('/run/01-06-26-x-aaaa1111', fullState());
  // Same path: a cache hit (no regex needed) inserts against the seeded id.
  await appendAudit('/run/01-06-26-x-aaaa1111', 'cached line');
  const rows = getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ?').all('aaaa1111');
  assert.deepEqual(rows.map((r) => r.text), ['cached line']);
});

test('appendAudit no-ops when no id can be resolved (no throw)', async () => {
  await appendAudit('/no/id/here', 'orphan line'); // basename has no -<8hex>
  // Nothing inserted, and it did not throw.
  const n = getDb().prepare('SELECT COUNT(*) c FROM pipeline_events').get().c;
  assert.equal(typeof n, 'number');
  assert.equal(n, 0, 'no event row inserted for an unresolvable dir');
});

test('appendAudit trims the line and stores ISO ts (reproduces old audit semantics)', async () => {
  await writeState('/d-eeee5555', fullState({ id: 'eeee5555' }));
  await appendAudit('/d-eeee5555', '   spaced line   ');
  const row = getDb().prepare('SELECT ts, text FROM pipeline_events WHERE pipeline_id = ?').get('eeee5555');
  assert.equal(row.text, 'spaced line', 'leading/trailing whitespace trimmed');
  assert.ok(/^\d{4}-\d{2}-\d{2}T.*Z$/.test(row.ts), 'ISO 8601 timestamp');
});

// ── Task 3.5 — createPipeline INSERTs the row; keeps human seed files; indexes prompt
// WORCA_HOME is already a throwaway temp dir (beforeEach) with the DB reset, so
// createPipeline writes its run dir under that home's store and INSERTs into that DB.

test('createPipeline inserts a pipelines row, mkdirs the run dir, seeds prompt.md', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-cp-'));
  homes.push(proj);
  const { id, dir, promptText } = await createPipeline(proj, { prompt: 'add pagination', title: 'Add pagination' });
  assert.equal(promptText, 'add pagination');
  // Run dir + human seed files still on FS.
  await stat(dir);
  assert.ok(existsSync(join(dir, 'prompt.md')), 'prompt.md seeded for humans');
  assert.equal(await readFile(join(dir, 'prompt.md'), 'utf8'), 'add pagination');
  // M1: the redundant pipeline.md stub is no longer written (pipeline_events is authoritative).
  assert.equal(existsSync(join(dir, 'pipeline.md')), false, 'pipeline.md stub removed');
  // NO state.json on disk anymore.
  assert.equal(existsSync(join(dir, 'state.json')), false, 'state is in the DB, not state.json');
  // The pipelines row exists with prompt + project key + status created.
  const row = getDb().prepare('SELECT * FROM pipelines WHERE id = ?').get(id);
  assert.ok(row, 'pipelines row inserted');
  assert.equal(row.prompt, 'add pagination');
  assert.equal(row.status, 'created');
  assert.equal(row.project_key, projectKey(proj));
  // The prompt artifact is indexed (dir-relative).
  const arts = getDb().prepare('SELECT kind, rel_path FROM artifacts WHERE pipeline_id = ?').all(id);
  assert.ok(arts.some((a) => a.kind === 'prompt' && a.rel_path === 'prompt.md'));
});

test('createPipeline (workspace) inserts workspace_meta + records workspace-description.md', async () => {
  const a = await mkdtemp(join(tmpdir(), 'worca-cc-cpa-'));
  const b = await mkdtemp(join(tmpdir(), 'worca-cc-cpb-'));
  homes.push(a, b);
  const WKEY = 'wks-demo-12345678';
  const projects = [
    { projectKey: projectKey(a), projectDir: a, projectName: 'a' },
    { projectKey: projectKey(b), projectDir: b, projectName: 'b' },
  ].sort((x, y) => (x.projectKey < y.projectKey ? -1 : 1));
  const { id, dir } = await createPipeline(projects[0].projectDir, {
    prompt: 'task', workspaceKey: WKEY, workspaceId: WKEY, workspaceName: 'Demo WS',
    workspaceDescription: 'lots of detail', projects,
  });
  const row = getDb().prepare('SELECT target, workspace_key, workspace_meta FROM pipelines WHERE id = ?').get(id);
  assert.equal(row.target, 'workspace');
  assert.equal(row.workspace_key, WKEY);
  assert.equal(JSON.parse(row.workspace_meta).workspaceName, 'Demo WS');
  // Frozen snapshot still on FS + indexed.
  assert.equal(await readFile(join(dir, 'workspace-description.md'), 'utf8'), 'lots of detail');
  const arts = getDb().prepare('SELECT kind, rel_path FROM artifacts WHERE pipeline_id = ?').all(id);
  assert.ok(arts.some((a) => a.kind === 'workspace-description' && a.rel_path === 'workspace-description.md'));
});

// ── Task 3.8 — artifacts index: recordArtifact / listArtifacts ──────────────────

test('recordArtifact indexes a (kind, relPath) and listArtifacts returns them', async () => {
  await writeState('/d-cccc3333', fullState({ id: 'cccc3333' })); // FK parent
  await recordArtifact('cccc3333', 'plan', 'plans/01-06-26-demo.md');
  await recordArtifact('cccc3333', 'review', 'reviews/01-06-26-demo-impl-review.md');
  await recordArtifact('cccc3333', 'checklist', 'manual-tests-checklist.md');
  // Idempotent: same triple twice does not duplicate.
  await recordArtifact('cccc3333', 'plan', 'plans/01-06-26-demo.md');
  const arts = await listArtifacts('cccc3333');
  assert.equal(arts.length, 3);
  assert.deepEqual(
    arts.map((a) => `${a.kind}:${a.relPath}`).sort(),
    ['checklist:manual-tests-checklist.md', 'plan:plans/01-06-26-demo.md',
     'review:reviews/01-06-26-demo-impl-review.md']);
});

// ── Task 3.9 — a mock run indexes plan/review/checklist markdown via _artifact ──
// Binding assertion (3.9 + A16): a REAL mock pipeline populates the artifacts table
// with prompt + plan + checklist + review (the review row is the A16(5) fix — before
// it, _publishNodeIo only indexed plan/checklist, leaking the shared review md on
// delete). WORCA_HOME is the throwaway temp dir from beforeEach; the orchestrator
// runs against that home's DB.

test('a mock run indexes plan + checklist + review markdown in the artifacts table', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-art-proj-'));
  homes.push(projectDir);
  // planner -> refiner -> implementer -> reviewer -> manualTestsChecklist:
  // produces plan (planner/refiner), code (implementer), review md (reviewer:
  // impl-review), and checklist (manualTestsChecklist). prompt is indexed by
  // createPipeline.
  // wf_full-no-decompose: planner -> refiner -> implementer -> reviewer ->
  // manualTestsChecklist -> manualWebUiTesting, so the run produces plan, code,
  // a review md and a checklist md — the four kinds this test indexes.
  const tpl = await writeSeedGraph('wf_full-no-decompose', 'wf_art-index');
  const orch = createOrchestrator({ projectDir, prompt: 'demo', auto: true, claude: { mock: true }, workflowId: tpl.id });
  const res = await orch.run();
  assert.equal(res.status, 'done', 'pipeline converges');
  const id = orch.getState().id;
  const kinds = (await listArtifacts(id)).map((a) => a.kind);
  assert.ok(kinds.includes('prompt'), 'prompt indexed by createPipeline');
  assert.ok(kinds.includes('plan'), 'plan markdown indexed');
  assert.ok(kinds.includes('checklist'), 'checklist markdown indexed');
  assert.ok(kinds.includes('review'), 'review markdown indexed (A16(5))');
});

// ── Task 3.11 — reviews: per-cycle verdicts into the reviews table ──────────────

test('writeReview upserts a per-cycle verdict keyed (kind,cycle)', async () => {
  await writeState('/d-rrrr4444', fullState({ id: 'rrrr4444' }));
  writeReview('rrrr4444', 'impl', 1, { issues: [{ severity: 'major', title: 'x', detail: '', location: '' }], summary: 's' });
  writeReview('rrrr4444', 'impl', 2, { issues: [], summary: 'clean' });
  assert.equal(readReviewRow('rrrr4444', 'impl', 1).summary, 's');
  assert.equal(readReviewRow('rrrr4444', 'impl', 2).issues.length, 0);
  // Re-running a cycle replaces its verdict.
  writeReview('rrrr4444', 'impl', 1, { issues: [], summary: 'fixed' });
  assert.equal(readReviewRow('rrrr4444', 'impl', 1).summary, 'fixed');
  assert.equal(readReviewRow('rrrr4444', 'impl', 99), null);
});

// ── M1.5 — pipeline.md is no longer written (pipeline_events is authoritative) ────
test('createPipeline does not write a redundant pipeline.md', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-nopmd-'));
  const { dir } = await createPipeline(projectDir, { prompt: 'hello', title: 'T' });
  assert.equal(existsSync(join(dir, 'pipeline.md')), false, 'pipeline.md stub removed');
  assert.equal(existsSync(join(dir, 'prompt.md')), true, 'prompt.md still written');
  await rm(projectDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

// ── M1.1 — readPipelineExtras enumerates clarify + every review row ──────────────
test('readPipelineExtras returns clarify {questions,answers} and all review rows', async () => {
  seedPipelineRow({ id: 'ex000001', projectKey: 'proj-00000001', status: 'done' });
  await writeClarify('ex000001', {
    questions: { questions: [{ id: 'q1', question: 'Which DB?', options: ['a', 'b', 'c'], allowFreeText: true }] },
  });
  await writeClarify('ex000001', {
    answers: { answers: [{ id: 'q1', question: 'Which DB?', choice: 'a' }] },
  });
  await writeReview('ex000001', 'impl', 1, { issues: [{ severity: 'major', title: 't', detail: 'd', location: 'l' }], summary: 's1' });
  await writeReview('ex000001', 'impl', 2, { issues: [], summary: 'clean' });
  await writeReview('ex000001', 'refine', 1, { issues: [], summary: 'r-ok' });

  const ex = readPipelineExtras('ex000001');
  // clarify halves are the UNWRAPPED arrays (UI consumes .questions / .answers directly)
  assert.equal(ex.clarify.questions.length, 1);
  assert.equal(ex.clarify.questions[0].question, 'Which DB?');
  assert.equal(ex.clarify.answers[0].choice, 'a');
  // reviews: flat list, ordered (kind asc, cycle asc), each row carries its verdict
  assert.deepEqual(ex.reviews.map((r) => [r.kind, r.cycle]), [['impl', 1], ['impl', 2], ['refine', 1]]);
  assert.equal(ex.reviews[0].summary, 's1');
  assert.equal(ex.reviews[0].issues[0].severity, 'major');
  assert.equal(ex.reviews[1].issues.length, 0);
});

test('readPipelineExtras on a bare pipeline returns empty arrays (never null)', () => {
  seedPipelineRow({ id: 'ex000002', projectKey: 'proj-00000001', status: 'done' });
  const ex = readPipelineExtras('ex000002');
  assert.deepEqual(ex, { clarify: { questions: [], answers: [] }, reviews: [], stepQuestions: [] });
});

test('readPipelineByKey attaches clarify + reviews to the detail response', async () => {
  seedPipelineRow({ id: 'ex000003', projectKey: 'proj-deadbeef', status: 'done', title: 'T' });
  await writeReview('ex000003', 'impl', 1, { issues: [], summary: 'ok' });
  const data = await readPipelineByKey('proj-deadbeef', 'ex000003');
  assert.equal(data.state.title, 'T');                 // unchanged
  assert.equal(typeof data.auditMarkdown, 'string');   // unchanged
  assert.equal(data.reviews.length, 1);                // NEW
  assert.equal(data.reviews[0].summary, 'ok');
  assert.deepEqual(data.clarify, { questions: [], answers: [] }); // NEW
});

// ── Task 3 — readRunLogText + artifacts in the detail payload ───────────────────
test('readRunLogText returns the NDJSON for a run, null when absent/unknown', async () => {
  // seed a pipeline row + its run dir, write a live-log.ndjson, then read it back by key+id
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-rlr-proj-'));
  const { id, dir } = await createPipeline(projectDir, { prompt: 'demo' });
  recordArtifact(id, 'live-log', 'live-log.ndjson');
  await writeFile(join(dir, 'live-log.ndjson'), '{"source":"planner","level":"info","text":"hi","ts":"t"}\n', 'utf8');

  const key = projectKey(projectDir);
  const text = await readRunLogText(key, id);
  assert.ok(text && text.includes('"text":"hi"'), 'returns the persisted NDJSON');
  assert.equal(await readRunLogText(key, 'deadbeef'), null, 'unknown id -> null');
});

test('readPipelineByKey surfaces the artifacts index (so History can show the Live-logs dropdown)', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-rlr2-proj-'));
  const { id } = await createPipeline(projectDir, { prompt: 'demo' });
  recordArtifact(id, 'live-log', 'live-log.ndjson');
  const data = await readPipelineByKey(projectKey(projectDir), id);
  assert.ok(Array.isArray(data.artifacts), 'artifacts array present');
  assert.ok(data.artifacts.some((a) => a.kind === 'live-log'), 'live-log artifact listed');
});

// P8a: History decides whether to OFFER Resume from this flag, and the v2 upgrade
// NULLs every retired v1 resume point — so it must be read from the row, never
// inferred from the status (an interrupted run may or may not still carry one).
test('rowToState reports `resumable` from the row\'s resume_point, not its status', async () => {
  seedPipelineRow({ id: 'rsm00001', projectKey: 'proj-00000001', status: 'paused' });
  const key = 'proj-00000001';
  const noPoint = await readPipelineByKey(key, 'rsm00001');
  assert.equal(noPoint.state.resumable, false, 'a NULLed (retired) point is not resumable');

  getDb().prepare('UPDATE pipelines SET resume_point = ? WHERE id = ?')
    .run(JSON.stringify({ version: 2, snapshot: null }), 'rsm00001');
  const withPoint = await readPipelineByKey(key, 'rsm00001');
  assert.equal(withPoint.state.resumable, true, 'a live point is resumable');
});
