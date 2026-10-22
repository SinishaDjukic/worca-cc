// test/db-migrate-v71.test.mjs — v71: utility_cost_ledger (Smart run naming spend, no run behind it).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION, getDb } from '../src/core/db.mjs';
import { recordUtilityCost, utilityTotals } from '../src/core/cost-budget.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

test('v71 adds utility_cost_ledger to a v70 DB', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('DROP TABLE utility_cost_ledger; PRAGMA user_version = 70');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 71);
  assert.deepEqual(db.prepare('PRAGMA table_info(utility_cost_ledger)').all().map((c) => c.name),
    ['id', 'kind', 'amount_usd', 'tokens_in', 'tokens_out', 'model', 'ts']);
});

test('a naming call writes one utility row and zero cost_ledger rows; $0 leaves none; totals sum the window', () => {
  const db = getDb();
  const before = db.prepare('SELECT COUNT(*) AS n FROM cost_ledger').get().n;
  recordUtilityCost('naming', { costUsd: 0.0002, usage: { input_tokens: 300, output_tokens: 30 }, model: 'claude-haiku-5-5', tsMs: 1000 });
  recordUtilityCost('naming', { costUsd: 0, tsMs: 1000 });
  recordUtilityCost('naming', { costUsd: NaN, tsMs: 1000 });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM utility_cost_ledger').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cost_ledger').get().n, before);
  assert.deepEqual(utilityTotals(0, 2000), { naming: { usd: 0.0002, count: 1 } });
  assert.deepEqual(utilityTotals(2000, 3000), { naming: { usd: 0, count: 0 } });
});
