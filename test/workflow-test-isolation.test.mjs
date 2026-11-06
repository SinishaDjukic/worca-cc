// test/workflow-test-isolation.test.mjs — D21/D22: a test try is marked once and every reader leaves it out, except the
// spending limit. Also the D20 seam (try-body.mjs).
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { createPipeline, writeState, isTestPipeline, listAllPipelines, countPipelines, findPipelineRowById, listNetworkWaitRuns } from '../src/core/artifacts.mjs';
import { getStats, reviewQuality } from '../src/core/stats.mjs';
import { recordCostDelta, budgetStatus } from '../src/core/cost-budget.mjs';
import { recordRunMetrics } from '../src/core/metrics/record.mjs';
import { listPeople } from '../src/core/ask/tool-deps.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { createVersion, versionsOverview } from '../src/core/workflow-versions.mjs';
import { projectKey } from '../src/core/store.mjs';
import { testTargetOf, tryRunBody, tryTitle } from '../src/core/workflow-tests/try-body.mjs';

delete process.env.WORCA_MOCK;   // isMockRun would answer 'mock' before the test check
const homes = [];
let projectDir;
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wftiso-'));
  homes.push(dir); _resetForTests(); process.env.WORCA_HOME = dir;
  projectDir = join(dir, 'proj');
});
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

async function seed({ isTest = false, by = null, usd = 0 } = {}) {
  const { id, dir } = await createPipeline(projectDir, { prompt: 'p', title: isTest ? 'Test: x · try 1' : 'normal', startedBy: by, isTest });
  const now = new Date().toISOString();
  // projectKey binds the NOT NULL column on the INSERT arm of writeState's upsert (test/helpers/db-seed.mjs).
  await writeState(dir, { projectKey: projectKey(projectDir), id, status: 'done', startedAt: now, updatedAt: now, totalCostUsd: usd, steps: [] });
  if (usd) recordCostDelta({ pipelineId: id, amountUsd: usd });
  return id;
}

test('the mark is written once, at creation, and survives every later write', async () => {
  const t = await seed({ isTest: true });
  const n = await seed();
  assert.equal(isTestPipeline(t), true);
  assert.equal(isTestPipeline(n), false);
  assert.equal(findPipelineRowById(t).is_test, 1);
  assert.equal(findPipelineRowById(n).is_test, null);
  assert.equal(isTestPipeline('nope0000'), false);
});

test('lists and counts leave test tries out', async () => {
  const t = await seed({ isTest: true });
  const n = await seed();
  const ids = (await listAllPipelines({ lite: true })).map((p) => p.id);
  assert.ok(ids.includes(n));
  assert.ok(!ids.includes(t));
  assert.equal(countPipelines(), 1);
});

test('Statistics leaves out their runs, spend and people; the spending limit still counts them', async () => {
  await seed({ isTest: true, by: 'tester@example.com', usd: 2 });
  await seed({ by: 'person@example.com', usd: 1 });
  const s = getStats({ range: 'month' });
  assert.equal(s.totals.runs, 1);
  assert.equal(s.totals.pipelineSpendUsd, 1);
  assert.ok(!s.people.some((p) => p.includes('tester')));
  assert.equal(getStats({ range: 'all' }).totals.pipelineSpendUsd, 1);
  assert.equal(budgetStatus().windowSpendUsd, 3);
  assert.deepEqual(listPeople().map((p) => p.name), ['person@example.com'], "Ask's people list leaves the tester out (M6)");
});

test("Statistics' review quality (#990 s6) leaves test tries out", async () => {
  const summary = JSON.stringify({ v: 1, roles: [{ target: 'plan', role: 'security', label: 'Security', reviews: 1, raised: 2, fixed: 1, disputed: 0, open: 1 }] });
  for (const id of [await seed({ isTest: true }), await seed()]) {
    getDb().prepare('UPDATE pipelines SET review_stats = ? WHERE id = ?').run(summary, id);
  }
  assert.equal(reviewQuality(Date.now() - 86_400_000, Date.now() + 86_400_000).runs, 1, 'one normal run, the try left out');
});

test('the Versions page counts no test try as a run of a version (review I1)', async () => {
  const md = join(process.env.WORCA_HOME, 'planner.md');
  await writeFile(md, 'Plan it.');
  const deps = { registry: { planner: { key: 'planner', origin: 'builtin', agentPath: md, displayName: 'Planner' } }, scripts: {} };
  await writeGraphWorkflow({ id: 'wf_iso', name: 'Iso', domain: 'product',
    nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} }],
    wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } }] });
  await createVersion('wf_iso', { deps });
  const stepper = JSON.stringify({ template: { id: 'wf_iso', name: 'Iso' }, workflowVersion: { no: 1 } });
  for (const id of [await seed({ isTest: true }), await seed({ isTest: true }), await seed()]) {
    getDb().prepare('UPDATE pipelines SET stepper = ? WHERE id = ?').run(stepper, id);
  }
  assert.equal((await versionsOverview('wf_iso', { deps })).versions[0].runs, 1, 'two tries of v1 and one normal run: 1 run');
});

test('team metrics record no test try', async () => {
  const t = await seed({ isTest: true });
  const out = await recordRunMetrics({ pipeline: { id: t }, opts: {}, claude: { mock: false }, projectDir }, { status: 'done' });
  assert.deepEqual(out, { recorded: false, reason: 'test' });
  const live = await recordRunMetrics({ pipeline: { id: 'abcd0000' }, opts: { workflowTest: true }, claude: { mock: false }, projectDir }, { status: 'done' });
  assert.equal(live.reason, 'test');
});

test('the network watch never resumes a test try', async () => {
  const t = await seed({ isTest: true });
  const n = await seed();
  const rp = JSON.stringify({ version: 2, network: { since: new Date().toISOString(), origin: 'https://api.example.com' } });
  for (const id of [t, n]) getDb().prepare("UPDATE pipelines SET status = 'paused', resume_point = ? WHERE id = ?").run(rp, id);
  assert.deepEqual(listNetworkWaitRuns().map((r) => r.id), [n]);
});

test('try-body: every workflow can be tested (3a D62); the run body of one try', () => {
  const graph = { nodes: [{ id: 'n1', kind: 'agent', key: 'coder' }] };
  assert.deepEqual(testTargetOf(graph, { coder: { needsRepo: true } }), { testable: true, reason: null, needsProject: true });
  assert.deepEqual(testTargetOf(graph, { coder: {} }), { testable: true, reason: null, needsProject: false });
  const ex = { name: 'Bulk invoice export', request: 'Write the brief.' };
  assert.equal(tryTitle(ex, 2), 'Test: Bulk invoice export · try 2');
  assert.deepEqual(tryRunBody(ex, [{ name: 'notes.md', data: Buffer.from('hi') }], { workflowId: 'wf_b', tryNo: 2 }), {
    noProject: true, workflowId: 'wf_b', prompt: 'Write the brief.', title: 'Test: Bulk invoice export · try 2',
    extras: [{ name: 'notes.md', dataBase64: Buffer.from('hi').toString('base64') }],
  });
  const quick = tryRunBody(ex, [], { workflowId: 'wf_b', tryNo: 0, quick: true });
  assert.deepEqual([quick.title, quick.mock], ['Quick check: Bulk invoice export', true]);
});
