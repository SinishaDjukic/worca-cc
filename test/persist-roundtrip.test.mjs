// test/persist-roundtrip.test.mjs
// Phase 3.14 — end-to-end regression proofs that round-trip a REAL pipeline through
// the orchestrator's _persist() UPSERT (the path a Task-3.3-style unit test on
// fullState() can NOT cover, because it never goes through _persist()):
//
//  A11 (C2) — the NULL-clobber data-loss class is dead. Running a WORCA_MOCK
//    pipeline to completion calls _persist() many times; the first post-create
//    persist must NOT null the createPipeline-owned identity columns. We assert the
//    durable readPipeline() row still carries the ORIGINAL prompt + projectKey +
//    status, and that the mutated total_cost_usd / total_active_ms survived as real
//    (non-NULL) persisted values equal to the live state — not clobbered to NULL
//    (which _persist's catch{} would have silently hidden).
//
//  A16 (M3) — the orchestrator indexes a published review's shared markdown, so the
//    index-based deletePipeline (Task 3.13) actually unlinks the shared
//    reviews/<date>-<base>-impl-review.md (the regression the old name-pattern
//    deleter caught but a naive index-only deleter would leak). Driven by a REAL
//    mock run (NOT a manual recordArtifact), so it proves the orchestrator->index
//    wiring, then proves the deleter removes the on-disk shared file.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { writeWorkflow } from '../src/core/workflows.mjs';
import { readPipeline, listArtifacts } from '../src/core/artifacts.mjs';
import { deletePipeline } from '../src/core/pipeline-delete.mjs';
import { projectKey } from '../src/core/store.mjs';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { posix } from './helpers/posix-path.mjs';

const PROMPT = 'add a login screen with email + password';

// Run the built-in Plan->Refine->Implement->Review shape under MOCK to completion,
// in a throwaway temp WORCA_HOME + temp git-less project dir (A12: never cwd).
// Returns the live orchestrator + its terminal state for DB-roundtrip assertions.
async function runMockToDone() {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-persist-home-'));
  const prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;
  _resetForTests();                                    // fresh DB singleton at this home
  const steps = [['planner'], ['refiner'], ['implementer'], ['reviewer']]
    .map((g, i) => g.map((key, j) => ({ id: `s${i}_${j}`, key })));
  const feedbacks = [['s1_0', 's1_0'], ['s3_0', 's2_0']]
    .map(([from, to], k) => ({ id: `fb_${k}`, from, to }));
  const tpl = await writeWorkflow({ name: 'roundtrip', steps, feedbacks });
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-persist-proj-'));
  const orch = createOrchestrator({
    projectDir, prompt: PROMPT, auto: true, claude: { mock: true }, workflowId: tpl.id,
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', 'mock pipeline converges to done');
  return { home, prevHome, projectDir, orch, id: orch.getState().id };
}

const cleanups = [];
after(async () => {
  for (const fn of cleanups.splice(0)) { try { await fn(); } catch { /* best-effort */ } }
});
function restoreHome(prevHome) {
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
}

test('A11: a completed mock run round-trips prompt/projectKey/status/cost through _persist() (no NULL-clobber)', async () => {
  const { prevHome, projectDir, orch, id } = await runMockToDone();
  cleanups.push(() => restoreHome(prevHome));
  const live = orch.getState();

  // Durable history read (readPipeline -> rowToState from the DB row).
  const saved = await readPipeline(projectDir, id);
  assert.ok(saved && saved.state, 'readPipeline returns the persisted run');
  const st = saved.state;

  // (1) prompt — the C2 column. createPipeline INSERTs it; _persist's curated UPSERT
  // must NOT include it in its SET list, so it survives verbatim.
  assert.equal(st.prompt, PROMPT, 'prompt survived _persist() verbatim (C2 fix)');

  // (2) projectKey — the C1 column (this.state omits it; toPipelineRow derives it
  // from projectDir, and the UPSERT never re-SETs it).
  assert.equal(st.projectKey, projectKey(projectDir), 'projectKey survived (C1 fix)');

  // (3) status — a mutable column that legitimately reaches 'done'.
  assert.equal(st.status, 'done', 'terminal status persisted');

  // (4) total cost / active ms — mutable columns. Assert they are REAL persisted
  // values equal to the live terminal state, read straight from the DB columns
  // (bypassing rowToState's `?? 0` fallback) so a NULL clobber could not hide as 0.
  const rawRow = getDb()
    .prepare('SELECT prompt, project_key, status, total_cost_usd, total_active_ms FROM pipelines WHERE id = ?')
    .get(id);
  assert.notEqual(rawRow.prompt, null, 'prompt column is not NULL in the DB');
  assert.notEqual(rawRow.project_key, null, 'project_key column is not NULL in the DB');
  assert.equal(typeof rawRow.total_cost_usd, 'number', 'total_cost_usd is a real (non-NULL) number');
  assert.equal(rawRow.total_cost_usd, live.totalCostUsd, 'persisted cost equals the live terminal cost');
  assert.equal(typeof rawRow.total_active_ms, 'number', 'total_active_ms is a real (non-NULL) number');
  assert.equal(rawRow.total_active_ms, live.totalActiveMs, 'persisted active-ms equals the live terminal value');
  // A real run accrues active time; this proves a MUTATED value round-tripped (not a default).
  assert.ok(rawRow.total_active_ms > 0, 'active-ms accrued and persisted (mutated value survived)');
});

test('a step\'s skills round-trips through writeState -> readPipeline; absent reads back as []', async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-skill-rt-home-'));
  const prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;
  _resetForTests();
  cleanups.push(() => restoreHome(prevHome));

  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-skill-rt-proj-'));
  const { id } = await seedPipeline(projectDir, {
    title: 'Run', status: 'done',
    steps: [
      { key: '2:n1', nodeId: 'n1', cycle: 1, skills: ['skill:graphify'] },
      { key: '3:n2', nodeId: 'n2', cycle: 1 }, // no skills
    ],
  });
  const saved = await readPipeline(projectDir, id);
  assert.ok(saved && saved.state, 'readPipeline returns the persisted run');
  const byKey = (k) => saved.state.steps.find((s) => s.key === k);
  assert.deepEqual(byKey('2:n1').skills, ['skill:graphify'], 'step skills survived the round-trip');
  assert.deepEqual(byKey('3:n2').skills, [], 'a step with no skills reads back as []');
});

test('A16: a completed mock run indexes the shared review md; deletePipeline unlinks it', async () => {
  const { prevHome, projectDir, id } = await runMockToDone();
  cleanups.push(() => restoreHome(prevHome));

  // The reviewer published an impl-review md -> _publishNodeIo indexed it as kind
  // 'review' (store-root-relative). Prove the row exists.
  const arts = await listArtifacts(id);
  const review = arts.find((a) => a.kind === 'review');
  assert.ok(review, 'a review artifact row was indexed by the orchestrator (A16)');
  assert.match(posix(review.relPath), /^reviews\/.*-impl-review\.md$/, 'indexed shared review path is store-root-relative');

  // The shared file exists on disk under the project store root
  // (<WORCA_HOME>/.worca-cc/store/<key>/reviews/...).
  const reviewAbs = join(process.env.WORCA_HOME, '.worca-cc', 'store', projectKey(projectDir), review.relPath);
  assert.equal(existsSync(reviewAbs), true, 'the shared review md is on disk before delete');
  // Sanity: it has the mock review content (it really was written by the run).
  assert.ok((await readFile(reviewAbs, 'utf8')).length > 0, 'review md is non-empty');

  // The index-based deleter must unlink that exact shared review md (the regression
  // a naive index-only deleter would leak). Driven by the indexed row, NOT a guess.
  const report = await deletePipeline({ projectDir, id });
  assert.ok(report && report.ok, 'deletePipeline succeeded');
  assert.equal(existsSync(reviewAbs), false, 'deletePipeline unlinked the shared review md (A16)');
  assert.ok(report.reviewFiles.includes(reviewAbs), 'report.reviewFiles records the removed shared review md');
  // And the row is gone (FK cascade cleared the artifacts index).
  assert.equal((await listArtifacts(id)).length, 0, 'artifacts rows cascade-deleted with the pipeline');
});
