// test/db-migrate-v24-collision.test.mjs
// Two cases that each need their own pristine WORCA_HOME (useTempHome(after)
// sets it at module-eval time, so a file has exactly ONE home): a seed id held
// by an ARCHIVED row, and a crashed prior attempt's truncated .pre-v24.bak.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { useTempHome } from './helpers/temp-home.mjs';
import { buildCollisionDb } from './helpers/db-collision.mjs';
import { buildResidueDb } from './helpers/db-residue-v22.mjs';
import { getDb } from '../src/core/db.mjs';

useTempHome(after);

test('a seed id held by an ARCHIVED row is skipped and audited', () => {
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  try { buildCollisionDb(); getDb(); } finally { console.warn = realWarn; }
  const db = getDb();
  const row = db.prepare('SELECT version, archived_at FROM workflows WHERE id = ?').get('wf_quick-fix');
  assert.equal(row.version, 1, 'the archived squatter is untouched');
  assert.ok(row.archived_at);
  assert.ok(warnings.includes('[worca] V24: seed wf_quick-fix skipped — id held by an archived template'),
    `expected the skip audit line, got: ${JSON.stringify(warnings)}`);
  const report = JSON.parse(db.prepare("SELECT data FROM store_meta WHERE key = 'migration:v24'").get().data);
  assert.deepEqual(report.seedsSkipped, ['wf_quick-fix']);
  assert.equal(report.seeded.includes('wf_quick-fix'), false);
  assert.equal(report.seeded.length, 6, 'the other six seeds still land');
});

// `existsSync` alone would read a 0-byte crash leftover as "backup taken" and
// rewrite the user's data with nothing to restore from. usableBackup() opens the
// file and checks it is stamped BEFORE the break.
test('a truncated .pre-v24.bak is re-taken, not trusted', () => {
  const fx = buildResidueDb();
  writeFileSync(`${fx.dbFile}.pre-v24.bak`, '');   // crashed prior attempt
  assert.equal(statSync(`${fx.dbFile}.pre-v24.bak`).size, 0);
  getDb();
  const bak = new DatabaseSync(`${fx.dbFile}.pre-v24.bak`, { readOnly: true });
  try {
    assert.equal(bak.prepare('PRAGMA user_version').get().user_version, 23, 'a real pre-break snapshot');
    assert.ok(bak.prepare("SELECT 1 AS n FROM workflows WHERE id = 'wf_simple-plan'").get(), 'with the v1 rows in it');
  } finally { bak.close(); }
});
