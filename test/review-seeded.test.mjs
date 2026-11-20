// test/review-seeded.test.mjs — #990 slice 6: a seeded-defect run through the engine's role-review step. A hand-built
// (non-Shaper) workflow's `reviewer` node declares `correctness` and `security`; each role slice's verdict is replaced
// with the fixture's recorded one, so the planted defects are found (or missed) through the run's role records. The
// finished run's pipelines.review_stats row and reviewQuality then report the same counts. Mock mode, a git dir, no server.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { _testing } from '../src/core/graph/executor.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { writeState } from '../src/core/artifacts.mjs';
import { getDb } from '../src/core/db.mjs';
import { reviewQuality } from '../src/core/stats.mjs';
import { roleCounts } from '../src/shared/review/findings.mjs';

useTempHome(after);

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/seeded-defects/plan-review.json', import.meta.url), 'utf8'));

let sandboxHome;
const prevEnv = {};
const ENV = ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK_ROLE_REVIEW', 'WORCA_MOCK_DISPOSITIONS', 'WORCA_MOCK_CONFLICTS'];
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-review-seeded-home-'));
  for (const k of ENV) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  delete process.env.WORCA_MOCK_ROLE_REVIEW;
  delete process.env.WORCA_MOCK_CONFLICTS;
  process.env.WORCA_MOCK_DISPOSITIONS = JSON.stringify(FIXTURE.dispositions);
});
afterEach(() => { _testing.runClaude = null; });
after(async () => {
  for (const k of ENV) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const GRAPH = {
  name: 'Seeded defects', domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
    { id: 'n_reviewer', kind: 'agent', key: 'reviewer', x: 600, y: 0,
      config: { roleReview: { roles: FIXTURE.roles, source: 'declared', target: 'plan', sink: 'refiner' } } },
    { id: 'n_refine', kind: 'agent', key: 'refiner', x: 900, y: 0, config: { awaitAll: true } },
    { id: 'n_end', kind: 'end', x: 1200, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_reviewer', port: 'plan' } },
    { id: 'w3', from: { node: 'n_reviewer', port: 'plan' }, to: { node: 'n_refine', port: 'plan' } },
    { id: 'w4', from: { node: 'n_reviewer', port: 'findings' }, to: { node: 'n_refine', port: 'findings' } },
    { id: 'w5', from: { node: 'n_refine', port: 'revise' }, to: { node: 'n_reviewer', port: 'revise' }, config: { maxCycles: 2, onExhausted: 'clean' } },
    { id: 'w6', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_end', port: 'result' } }],
};

const marker = (p, k) => (new RegExp(`^${k}: (.*)$`, 'm').exec(p) || [])[1] || '';
const sectionKey = (s) => String(s ?? '').trim().toLowerCase();

/** The planted defects a run's role records name: role key plus section, over the non-skipped records only. */
function findPlanted(defects, roleReviews) {
  const records = (roleReviews?.rounds || []).flatMap((round) => (round.roles || []).filter((r) => r && !r.skipped));
  const found = [];
  const missed = [];
  for (const d of defects) {
    const hit = records.filter((r) => r.key === d.role).flatMap((r) => r.findings || [])
      .find((f) => sectionKey(f.section) === sectionKey(d.section));
    if (hit) found.push({ defect: d.id, findingId: hit.id }); else missed.push(d.id);
  }
  return { found, missed };
}

let orch = null;
before(async () => {
  const { id: workflowId } = await writeGraphWorkflow({ ...GRAPH });
  _testing.runClaude = async (o) => {
    const out = await runClaude(o);
    // The recorded verdict replaces the mock reviewer's: the orchestrator reads it only after every slice has returned.
    const role = marker(o.prompt, 'MOCK_PERSPECTIVE');
    const json = marker(o.prompt, 'MOCK_JSON');
    if (role && json && FIXTURE.verdicts[role]) await writeFile(json, JSON.stringify(FIXTURE.verdicts[role]));
    return out;
  };
  orch = createOrchestrator({ projectDir: gitDir('review-seeded'), workflowId, prompt: 'demo', claude: { mock: true } });
  orch.on('question', (q) => setImmediate(() => orch.answer(q.id, q.kind === 'plan' ? { decision: 'approve' } : { answers: [] })));
  const res = await orch.run();
  _testing.runClaude = null;
  assert.equal(res.status, 'done', res.error);
});

const rowOf = (id) => getDb().prepare('SELECT status, review_stats FROM pipelines WHERE id = ?').get(id);

test('a hand-built role-review run: the planted defects are found in its role records', () => {
  const rr = orch.state.roleReviews;
  assert.equal(rr.rounds.length, 1);
  const round = rr.rounds[0];
  assert.deepEqual(round.roles.map((r) => r.findings.map((f) => f.section)),
    [['Testing', 'Naming'], ['auth', 'Rollback']], 'the role records carry the recorded verdicts');
  const { found, missed } = findPlanted(FIXTURE.defects, rr);
  assert.deepEqual(found, [
    { defect: 'd1', findingId: 'security-1-1' },
    { defect: 'd2', findingId: 'security-1-2' },
    { defect: 'd3', findingId: 'correctness-1-1' },
  ]);
  assert.deepEqual(missed, ['d4']);
  for (const r of round.roles) assert.deepEqual(roleCounts(r), FIXTURE.expected[r.key], r.key);
});

test('the finished run\'s review_stats row and reviewQuality report the expected counts', () => {
  const id = orch.getState().id;
  const row = rowOf(id);
  assert.equal(row.status, 'done');
  const stored = JSON.parse(row.review_stats);
  assert.deepEqual(stored, { v: 1, roles: [
    { target: 'plan', role: 'correctness', label: 'Correctness', reviews: 1, ...FIXTURE.expected.correctness },
    { target: 'plan', role: 'security', label: 'Security', reviews: 1, ...FIXTURE.expected.security },
  ] });
  const q = reviewQuality(0, Date.now() + 1);
  assert.equal(q.runs, 1);
  assert.deepEqual(q.roles, [
    { target: 'plan', role: 'correctness', label: 'Correctness', runs: 1, reviews: 1, ...FIXTURE.expected.correctness },
    { target: 'plan', role: 'security', label: 'Security', runs: 1, reviews: 1, ...FIXTURE.expected.security },
  ]);
});

test('a later writeState without roleReviews keeps review_stats', async () => {
  const id = orch.getState().id;
  const before = rowOf(id).review_stats;
  assert.ok(before);
  const { roleReviews, ...rest } = structuredClone(orch.state);
  assert.ok(roleReviews);
  await writeState(join(tmpdir(), `review-seeded-${id}`), rest);
  assert.equal(rowOf(id).review_stats, before);
});
