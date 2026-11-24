// test/real-run.test.mjs — the one real-run rule (src/core/real-run.mjs): a run that finished AND cost
// something, and was not a demo (mock) run. Onboarding, Statistics and (phase 7) levels facts share it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import { isRealRun, REAL_RUN_SQL, DEMO_RUN_SQL } from '../src/core/real-run.mjs';

useTempHome(after);

const mockIt = (id) => getDb().prepare('UPDATE pipelines SET run_setup = ? WHERE id = ?').run(JSON.stringify({ mock: true }), id);
const count = () => Number(getDb().prepare(`SELECT COUNT(*) AS n FROM pipelines p WHERE ${REAL_RUN_SQL()}`).get().n);

test('isRealRun: done+mock is not real; done+$0 is not real; error with cost is not real', async () => {
  const mock = await seedPipeline('/tmp/rr', { status: 'done', totalCostUsd: 1.5 });
  mockIt(mock.id);
  const free = await seedPipeline('/tmp/rr', { status: 'done', totalCostUsd: 0 });
  const failed = await seedPipeline('/tmp/rr', { status: 'error', totalCostUsd: 0.42 });
  assert.equal(isRealRun(mock.id), false, 'a demo run never counts');
  assert.equal(isRealRun(free.id), false, 'a $0 run never counts');
  assert.equal(isRealRun(failed.id), false, 'only a finished run counts');
});

test('isRealRun: done with a run total is real; done with only a step cost is real; deleted still real', async () => {
  const total = await seedPipeline('/tmp/rr', { status: 'done', totalCostUsd: 0.5 });
  const stepOnly = await seedPipeline('/tmp/rr', {
    status: 'done', totalCostUsd: 0,
    steps: [{ key: 'plan', status: 'done', costUsd: 0.2 }],
  });
  assert.equal(isRealRun(total.id), true);
  assert.equal(isRealRun(stepOnly.id), true, 'a step cost stands in for a missing run total');
  getDb().prepare('UPDATE pipelines SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), total.id);
  assert.equal(isRealRun(total.id), true, 'deleting a run does not take its first-real-run credit away');
});

test('isRealRun: a workflow test try (pipelines.is_test) is never real, even done and paid', async () => {
  const tried = await seedPipeline('/tmp/rr', { status: 'done', totalCostUsd: 0.9 });
  assert.equal(isRealRun(tried.id), true);
  getDb().prepare('UPDATE pipelines SET is_test = 1 WHERE id = ?').run(tried.id);
  assert.equal(isRealRun(tried.id), false, 'tries stay out of Getting started, Statistics and the levels');
});

test('isRealRun is a guarded read: unknown or missing ids are false, never a throw', () => {
  assert.equal(isRealRun('nope0000'), false);
  assert.equal(isRealRun(null), false);
  assert.equal(isRealRun(undefined), false);
});

test('REAL_RUN_SQL honours the alias and DEMO_RUN_SQL is its demo half', async () => {
  const before = count();
  const r = await seedPipeline('/tmp/rr', { status: 'done', totalCostUsd: 3 });
  assert.equal(count(), before + 1);
  const n = Number(getDb().prepare(`SELECT COUNT(*) AS n FROM pipelines q WHERE ${REAL_RUN_SQL('q')} AND q.id = ?`).get(r.id).n);
  assert.equal(n, 1);
  mockIt(r.id);
  assert.equal(count(), before);
  assert.equal(Number(getDb().prepare(`SELECT COUNT(*) AS n FROM pipelines p WHERE ${DEMO_RUN_SQL()} AND p.id = ?`).get(r.id).n), 1);
});

// I-5: the consumers take the rule from real-run.mjs and keep no private copy of it.
// TODO(p7t1): add src/core/worca-levels/facts.mjs here once it adopts the rule in phase 7.
test('onboarding.mjs and cost-budget.mjs import real-run.mjs and carry no private real-run predicate', () => {
  const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  const onboarding = read('src/core/onboarding.mjs');
  const budget = read('src/core/cost-budget.mjs');
  assert.match(onboarding, /from '\.\/real-run\.mjs'/);
  assert.match(budget, /from '\.\/real-run\.mjs'/);
  assert.doesNotMatch(onboarding, /total_cost_usd/, 'onboarding asks real-run.mjs, never the cost column');
  assert.doesNotMatch(budget, /\$\.mock/, 'the demo predicate lives in real-run.mjs only');
});
