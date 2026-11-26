// test/workflow-test-criteria.test.mjs — Part 4 (plans/workflow-tests-part4-plan.md D86, D87): an example's criteria and its
// checking model; neither changes the example fingerprint, so tries stay reusable.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests, prepare } from '../src/core/db.mjs';
import * as store from '../src/core/workflow-tests/store.mjs';
import { normaliseCriteria, normaliseJudge, criterionKey, CRITERIA_MAX } from '../src/shared/workflow-tests/criteria.mjs';

const homes = [];
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wftcrit-'));
  homes.push(dir); _resetForTests(); process.env.WORCA_HOME = dir;
});
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }))); });

const WF = 'wf_brief';
let n = 0;
const newId = () => `k_${String(++n).padStart(10, '0')}`;

test('normaliseCriteria: trims, drops empty rows, keeps ids, refuses twins, short, long and too many', () => {
  const r = normaliseCriteria([{ text: '  Names a success   metric ' }, { text: '' }, { id: 'k_abc', text: 'Quotes customers' }], newId);
  assert.equal(r.error, null);
  assert.deepEqual(r.criteria.map((c) => c.text), ['Names a success metric', 'Quotes customers']);
  assert.match(r.criteria[0].id, /^k_\d{10}$/);
  assert.equal(r.criteria[1].id, 'k_abc');
  assert.deepEqual(normaliseCriteria(undefined, newId), { criteria: [], error: null });
  assert.equal(normaliseCriteria([{ text: 'Names a metric.' }, { text: 'names  a METRIC' }], newId).error, '"names a METRIC" is there twice');
  assert.equal(normaliseCriteria([{ text: 'ab' }], newId).error, 'each criterion must be 3 to 300 characters');
  assert.equal(normaliseCriteria([{ text: 'x'.repeat(301) }], newId).error, 'each criterion must be 3 to 300 characters');
  assert.equal(normaliseCriteria(Array.from({ length: CRITERIA_MAX + 1 }, (_, i) => ({ text: `Criterion number ${i}` })), newId).error, 'at most 12 criteria');
  assert.equal(normaliseCriteria('Names a metric', newId).error, 'criteria must be a list');
  assert.equal(criterionKey('Names a “success” metric.'), 'names a "success" metric');
});

test('normaliseJudge: a model id or nothing', () => {
  assert.deepEqual(normaliseJudge({ model: 'claude-opus-5-5' }), { judge: { model: 'claude-opus-5-5' }, error: null });
  assert.deepEqual(normaliseJudge(null), { judge: null, error: null });
  assert.equal(normaliseJudge({ model: 'bad model!' }).error, 'pick the AI model that checks your criteria');
});

test('the store keeps criteria and the checking model, and the fingerprint ignores both', () => {
  const plain = store.createExample(WF, { name: 'Bulk invoice export', request: 'Write the brief.' });
  assert.deepEqual([plain.criteria, plain.judge], [[], null]);
  const up = store.updateExample(WF, plain.id, { criteria: [{ text: 'Names a success metric with a number' }], judge: { model: 'claude-opus-5-5' } });
  assert.equal(up.criteria.length, 1);
  assert.match(up.criteria[0].id, /^k_[0-9a-f]{10}$/);
  assert.deepEqual(up.judge, { model: 'claude-opus-5-5' });
  assert.equal(up.fingerprint, plain.fingerprint, 'criteria are not part of what a try depends on (D86)');
  const kept = store.updateExample(WF, plain.id, { name: 'Bulk export' });
  assert.deepEqual([kept.criteria[0].id, kept.judge.model], [up.criteria[0].id, 'claude-opus-5-5'], 'fields left out keep their value');
  assert.throws(() => store.updateExample(WF, plain.id, { criteria: [{ text: 'no' }] }), { code: 'BAD_REQUEST', message: 'each criterion must be 3 to 300 characters' });
});

test('deleting an example deletes its judgements, answers, rounds and liked result, never the ledger', () => {
  const ex = store.createExample(WF, { name: 'E', request: 'R', criteria: [{ text: 'Names a metric' }], judge: { model: 'claude-opus-5-5' } });
  const at = '2026-11-19T00:00:00Z';
  const j = prepare(`INSERT INTO wf_test_judgements (workflow_id, example_id, criterion_fp, model, purpose, created_at)
    VALUES (?, ?, 'fp', 'claude-opus-5-5', 'try', ?)`).run(WF, ex.id, at);
  prepare("INSERT INTO wf_test_judge_answers (judgement_id, agree, created_at) VALUES (?, 1, ?)").run(j.lastInsertRowid, at);
  prepare(`INSERT INTO wf_test_checker_rounds (workflow_id, example_id, criterion_id, criterion_fp, model, source, status, created_at)
    VALUES (?, ?, 'k_1', 'fp', 'm', '{}', 'done', ?)`).run(WF, ex.id, at);
  prepare("INSERT INTO wf_test_liked (example_id, kind, name, data, sha256, size, created_at) VALUES (?, 'text', 'a.md', x'61', 'h', 1, ?)").run(ex.id, at);
  prepare("INSERT INTO wf_test_judge_ledger (workflow_id, example_id, purpose, amount_usd, ts) VALUES (?, ?, 'try', 0.02, 1)").run(WF, ex.id);
  store.deleteExample(WF, ex.id);
  for (const t of ['wf_test_judgements', 'wf_test_judge_answers', 'wf_test_checker_rounds', 'wf_test_liked']) {
    assert.equal(prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, t);
  }
  assert.equal(prepare('SELECT COUNT(*) AS n FROM wf_test_judge_ledger').get().n, 1, 'spend never goes back');
});

test('final review I2: an example is not deleted while Check the checker is making a round of it, or while its criteria are checked', () => {
  const ex = store.createExample(WF, { name: 'E2', request: 'R', criteria: [{ text: 'Names a metric' }], judge: { model: 'claude-opus-5-5' } });
  const r = prepare(`INSERT INTO wf_test_checker_rounds (workflow_id, example_id, criterion_id, criterion_fp, model, source, status, created_at)
    VALUES (?, ?, 'k_1', 'fp', 'm', '{}', 'making', '2026-11-19T00:00:00Z')`).run(WF, ex.id);
  const busy = { code: 'BUSY', message: "Worca is checking this example's criteria: delete it when that is done" };
  assert.throws(() => store.deleteExample(WF, ex.id), busy);
  assert.ok(store.readExample(WF, ex.id), 'still there');
  prepare(`UPDATE wf_test_checker_rounds SET status = 'ready' WHERE id = ?`).run(r.lastInsertRowid);
  assert.throws(() => store.deleteExample(WF, ex.id, { checking: true }), busy, 'a check of a test that covers it');
  assert.equal(store.deleteExample(WF, ex.id), true, 'a ready round does not hold it');
  assert.equal(store.readExample(WF, ex.id), null);
});
