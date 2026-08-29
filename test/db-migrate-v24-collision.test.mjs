// test/db-migrate-v24-collision.test.mjs
// Three cases that each need their own pristine WORCA_HOME (useTempHome(after)
// sets it at module-eval time, so a file has exactly ONE home): a seed id held
// by an ARCHIVED row, a crashed prior attempt's truncated .pre-v24.bak, and the
// "no backup, no break" refusal when the snapshot cannot be taken at all. Each
// case rebuilds the whole fixture (build*Db wipes every table it writes), so
// they may share the one home; the .bak path is cleared per case for the same
// reason.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, statSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { useTempHome } from './helpers/temp-home.mjs';
import { buildCollisionDb } from './helpers/db-collision.mjs';
import { buildResidueDb } from './helpers/db-residue-v22.mjs';
import { getDb } from '../src/core/db.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';

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

// db.mjs#backupBeforeV24's catch/throw arm — the branch's "no backup, no break"
// invariant on the ONLY data-rewriting migration. Downgrade the throw to a
// console.warn (the module's house style elsewhere) and a user on a full or
// read-only disk gets their v1 templates archived, seven seeds inserted and
// their resume points swept with nothing to restore from. A directory at the
// .bak path is the cheapest way to make `VACUUM INTO` fail for real (no fs
// stubbing): sqlite reports "unable to open database".
test('no usable backup, no break: V24 refuses to run and leaves the v23 DB untouched', () => {
  const fx = buildResidueDb();
  const bak = `${fx.dbFile}.pre-v24.bak`;
  rmSync(bak, { recursive: true, force: true });   // the previous case left a real one
  mkdirSync(bak, { recursive: true });             // VACUUM INTO cannot write here
  // backupBeforeV24 names the path sqlite reports (PRAGMA database_list), which on
  // macOS is the REALPATH of the temp home — /private/var/…, not /var/….
  const realDbFile = realpathSync(fx.dbFile);
  let thrown = null;
  try { getDb(); } catch (err) { thrown = err; }
  assert.ok(thrown, 'migrate must THROW when the pre-v24 snapshot cannot be taken');
  assert.ok(thrown.message.startsWith(`worca cannot take the pre-v24 database backup at ${realDbFile}.pre-v24.bak: `),
    `unexpected message: ${thrown.message}`);
  assert.ok(thrown.message.endsWith('. The v2 upgrade rewrites saved pipelines, so it refuses to run '
    + `without one — free disk space or make ${dirname(realDbFile)} writable and start worca again.`),
  `unexpected message tail: ${thrown.message}`);
  assert.match(thrown.message, /unable to open database/, 'the sqlite cause is quoted for the user');
  assert.ok(thrown.cause instanceof Error, 'the original sqlite error rides as `cause`');
  // And the refusal is total: the ladder never opened its transaction.
  const db = new DatabaseSync(fx.dbFile, { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 23, 'user_version stays 23');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workflows WHERE archived_at IS NOT NULL').get().n, 0,
      'no v1 row may be archived without a backup');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workflows').get().n, fx.v1Ids.length,
      'and no seed was inserted');
    for (const t of SEED_TEMPLATES) {
      assert.equal(db.prepare('SELECT 1 AS n FROM workflows WHERE id = ?').get(t.id), undefined,
        `${t.id} must not exist yet`);
    }
    assert.equal(db.prepare("SELECT 1 AS n FROM store_meta WHERE key = 'migration:v24'").get(), undefined,
      'the break was never recorded');
  } finally { db.close(); }
});
