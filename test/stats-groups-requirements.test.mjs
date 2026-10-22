// test/stats-groups-requirements.test.mjs — Requirements spend (plans/requirements-design.md D9) under the
// Statistics filters and Group by (#718): like Chat spend it counts in Spent, gets its own row in every
// group table so the rows still reconcile with Spent, and a filter (tags, person) drops it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import { getStats } from '../src/core/stats.mjs';
import { recordCostDelta, recordAskCostDelta, recordRequirementsCostDelta, roundUsd } from '../src/core/cost-budget.mjs';
import { insertRunTags } from '../src/core/run-tags-store.mjs';

useTempHome(after);
let sandboxHome; const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-statsgr-'));
  for (const k of ['HOME', 'USERPROFILE']) { prevEnv[k] = process.env[k]; process.env[k] = sandboxHome; }
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
});

const NOW = new Date(2026, 8, 10, 12);                   // Thu 2026-09-10 local → lastMonth = August
const at = (m, d, hh = 12) => +new Date(2026, m - 1, d, hh);
const iso = (m, d, hh = 12) => new Date(2026, m - 1, d, hh).toISOString();
const sum = (rows) => roundUsd(rows.reduce((a, r) => a + r.spentUsd, 0));

before(async () => {
  const { id } = await seedPipeline('/tmp/p', { status: 'done' });
  getDb().prepare('UPDATE pipelines SET started_at = ?, started_by = ? WHERE id = ?').run(iso(8, 3), 'alice', id);
  insertRunTags(id, ['client:acme']);
  recordCostDelta({ pipelineId: id, amountUsd: 2, tsMs: at(8, 3) });
  recordAskCostDelta({ threadId: 't1', messageId: 'm1', amountUsd: 0.75, tokens: 10, model: 'x', tsMs: at(8, 20) });
  recordRequirementsCostDelta({ featureSeq: 1, turnId: 1, amountUsd: 0.5, tsMs: at(8, 10) });
  recordRequirementsCostDelta({ featureSeq: 2, turnId: 2, amountUsd: 0.25, tsMs: at(8, 11) });
});

test('unfiltered: Spent carries Requirements spend and every group table has a Requirements row that reconciles', () => {
  const s = getStats({ requirementsEnabled: true, range: 'lastMonth', now: NOW, groupBy: 'tag:client', tagKeys: ['client'] });
  assert.deepEqual(s.totals.requirements, { spendUsd: 0.75, features: 2 });
  assert.equal(s.totals.spentUsd, 3.5);                  // 2 run + 0.75 Chat + 0.75 Requirements
  const req = s.groups.rows.find((r) => r.kind === 'requirements');
  assert.ok(req, 'a Requirements row');
  assert.equal(req.label, 'Requirements');
  assert.equal(req.spentUsd, 0.75);
  assert.equal(req.features, 2);
  assert.equal(req.runs, 0);
  assert.equal(s.groups.rows.at(-1), req, 'after the Chat row');
  assert.equal(sum(s.groups.rows), s.totals.spentUsd, 'the rows reconcile with Spent (no residual on the top row)');
  assert.equal(s.groups.rows.find((r) => r.kind === 'value').spentUsd, 2);
  for (const t of s.tagGroups) assert.equal(sum(t.rows), s.totals.spentUsd, `By ${t.key} reconciles`);
  assert.equal(roundUsd(s.series.reduce((a, b) => a + b.spentUsd, 0)), s.totals.spentUsd, 'the bars add up to Spent');
});

test('a filter (tag or person) drops Requirements spend everywhere, like Chat spend', () => {
  for (const filter of [{ tags: ['client:acme'] }, { person: 'alice' }]) {
    const s = getStats({ requirementsEnabled: true, range: 'lastMonth', now: NOW, filter, groupBy: 'person' });
    assert.deepEqual(s.totals.requirements, { spendUsd: 0, features: 0 });
    assert.equal(s.totals.spentUsd, 2, JSON.stringify(filter));
    assert.ok(!s.groups.rows.some((r) => r.kind === 'requirements' || r.kind === 'ask'));
    assert.equal(roundUsd(s.series.reduce((a, b) => a + b.spentUsd, 0)), 2);
  }
});

test('all time: Requirements spend counts and the group rows reconcile', () => {
  const s = getStats({ requirementsEnabled: true, range: 'all', now: NOW, groupBy: 'person' });
  assert.deepEqual(s.totals.requirements, { spendUsd: 0.75, features: 2 });
  assert.equal(sum(s.groups.rows), s.totals.spentUsd);
  assert.equal(s.groups.rows.find((r) => r.kind === 'requirements').spentUsd, 0.75);
});

test('flag off: the money already spent stays in Spent and keeps its Requirements row; only the tile totals go', () => {
  const s = getStats({ requirementsEnabled: false, range: 'lastMonth', now: NOW, groupBy: 'tag:client', tagKeys: ['client'] });
  assert.equal('requirements' in s.totals, false, 'no tile figures');
  assert.equal('requirements' in s.prev, false);
  assert.equal(s.totals.spentUsd, 3.5, 'Spent still counts it');
  assert.equal(s.groups.rows.find((r) => r.kind === 'requirements').spentUsd, 0.75, 'the row stays, so the table reconciles');
  assert.equal(sum(s.groups.rows), s.totals.spentUsd);
});
