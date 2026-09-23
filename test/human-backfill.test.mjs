// One-shot run-level backfill (money-saved design §6.1): pre-v33 runs get pipelines.human_hours
// from results.json + the indexed plan/review markdown + decomposition JSON + the persisted
// verdicts (reviews.verdict); steps stay NULL; runs that already carry a step estimate are never
// touched; missing files never throw. Fixtures are seeded the way the PRODUCT writes them.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import { recordArtifact, writeReview } from '../src/core/artifacts.mjs';
import { projectStorePath } from '../src/core/store.mjs';
import { backfillHumanHours } from '../src/core/human-backfill.mjs';
import { estimateStepHours, roundHours } from '../src/shared/human-estimate.mjs';

useTempHome(after);

const step = (key, agentKey, over = {}) => ({ key, executionId: key, nodeId: key, kind: 'cycle', ordinal: 1, cycle: 1, agentKey, phase: agentKey, status: 'done', activeMs: 1, runningSince: null, costUsd: 1, ...over });

test('a legacy done run is credited from results.json, plan md versions, review md, decomposition json and the persisted verdicts', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'hb-proj-'));
  const { id, dir, key } = await seedPipeline(projectDir, { status: 'done',
    steps: [step('a', 'planner'), step('b', 'implementer'), step('c', 'reviewer')] });
  const root = projectStorePath(key);
  mkdirSync(join(root, 'plans'), { recursive: true }); mkdirSync(join(root, 'reviews'), { recursive: true });
  writeFileSync(join(root, 'plans', '01-09-26-feat.md'), 'w '.repeat(1000));
  writeFileSync(join(root, 'plans', '01-09-26-feat-v2.md'), 'w '.repeat(1000));
  writeFileSync(join(root, 'reviews', '01-09-26-feat-impl-review.md'), 'w '.repeat(300));
  writeFileSync(join(dir, 'decomposition.json'), JSON.stringify({ tasks: [{}, {}, {}] }));
  writeFileSync(join(dir, 'results.json'), JSON.stringify({ summary: { filesNew: 2, filesChanged: 3, filesDeleted: 0, linesAdded: 400, linesRemoved: 50 } }));
  recordArtifact(id, 'plan', 'plans/01-09-26-feat.md');
  recordArtifact(id, 'plan', 'plans/01-09-26-feat-v2.md');
  recordArtifact(id, 'review', 'reviews/01-09-26-feat-impl-review.md');
  recordArtifact(id, 'decomposition', 'decomposition.json');
  recordArtifact(id, 'results', 'results.json');
  recordArtifact(id, 'prompt', 'prompt.md');
  // The product persists every verdict in reviews.verdict (writeReview); the *-review-cycleN.json
  // file is transient scratch and is NEVER an artifacts row — the verdict credit reads the table.
  await writeReview(id, 'refine', 1, { issues: [{}, {}, {}, {}], summary: 'four findings' });
  await writeReview(id, 'impl', 1, { issues: [{}, {}], summary: 'two findings' });        // a verifier ran → one read of the diff

  const r = backfillHumanHours(getDb());
  assert.equal(r.credited, 1);
  const a = (over) => ({ nodeKind: 'agent', agent: { runnerType: 'producer' }, cycle: 1, code: null, outputs: [], reads: null, ...over });
  const expect = roundHours([
    a({ code: { files: 5, insertions: 400, deletions: 50 } }),
    a({ outputs: [{ type: 'md', words: 1000, revision: false }] }),
    a({ cycle: 1, outputs: [{ type: 'md', words: 1000, revision: true }] }),   // -v2 is the FIRST revision (cycle 1: no decay), as the step path credits it
    a({ outputs: [{ type: 'md', words: 300, revision: false }] }),
    a({ outputs: [{ type: 'json', items: 3 }] }),                              // decomposition.json (artifacts row)
    a({ outputs: [{ type: 'json', items: 4 }] }),                              // refine verdict (reviews row)
    a({ outputs: [{ type: 'json', items: 2 }] }),                              // impl verdict (reviews row)
    a({ agent: { runnerType: 'verifier' }, reads: { diffLines: 450, words: 0 } }),
  ].reduce((s, e) => s + estimateStepHours(e).hours, 0));
  assert.ok(expect > 0);
  assert.equal(getDb().prepare('SELECT human_hours FROM pipelines WHERE id = ?').get(id).human_hours, expect);
  assert.ok(getDb().prepare('SELECT human_hours FROM pipeline_steps WHERE pipeline_id = ?').all(id).every((s) => s.human_hours == null), 'steps stay NULL');
  assert.equal(backfillHumanHours(getDb()).credited, 0, 'idempotent');
});

test('missing files credit nothing and never throw; a run with a step estimate is skipped; a running run is skipped', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'hb-proj2-'));
  const legacy = await seedPipeline(projectDir, { status: 'stopped', steps: [step('a', 'planner')] });
  recordArtifact(legacy.id, 'plan', 'plans/01-09-26-x.md');      // indexed, never written
  const modern = await seedPipeline(projectDir, { status: 'done', humanHours: 3, steps: [step('a', 'planner', { humanHours: 3 })] });
  const live = await seedPipeline(projectDir, { status: 'running', steps: [step('a', 'planner')] });
  const r = backfillHumanHours(getDb());
  assert.equal(r.credited, 0);
  assert.equal(getDb().prepare('SELECT human_hours FROM pipelines WHERE id = ?').get(legacy.id).human_hours, 0);
  assert.equal(getDb().prepare('SELECT human_hours FROM pipelines WHERE id = ?').get(modern.id).human_hours, 3);
  assert.equal(getDb().prepare('SELECT human_hours FROM pipelines WHERE id = ?').get(live.id).human_hours, 0);
});

test('a plan-only stopped run: its verdicts count as json, and without a code diff there is no verifier read', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'hb-proj3-'));
  const { id } = await seedPipeline(projectDir, { status: 'stopped', steps: [step('a', 'planner'), step('b', 'refiner')] });
  await writeReview(id, 'refine', 1, { issues: [{}], summary: 'one finding' });
  assert.equal(backfillHumanHours(getDb()).credited, 1);
  const only = estimateStepHours({ nodeKind: 'agent', agent: { runnerType: 'producer' }, cycle: 1, code: null, outputs: [{ type: 'json', items: 1 }], reads: null }).hours;
  assert.equal(getDb().prepare('SELECT human_hours FROM pipelines WHERE id = ?').get(id).human_hours, only);   // 0.25 + 0.05 = 0.3
});
