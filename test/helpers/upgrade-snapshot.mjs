// test/helpers/upgrade-snapshot.mjs — load test/fixtures/upgrade-snapshot/dev-v60.json into the current DB as a v60
// database and run the real migration, as an upgrade does.
import { readFileSync } from 'node:fs';
import { getDb, migrate, SCHEMA_VERSION } from '../../src/core/db.mjs';

export const SNAPSHOT = JSON.parse(readFileSync(new URL('../fixtures/upgrade-snapshot/dev-v60.json', import.meta.url), 'utf8'));
const ORDER = ['pipelines', 'pipeline_steps', 'schedules', 'scheduled_runs', 'shape_features', 'shape_feature_slices'];

export function loadUpgradeSnapshot(snap = SNAPSHOT) {
  const db = getDb();                                  // a fresh temp home: migrated to SCHEMA_VERSION
  // Back to the recorded version (the test/db-migrate-v61.test.mjs recipe), so migrate() runs the real v61 step.
  if (snap.schemaVersion === 60 && SCHEMA_VERSION >= 61) db.exec('DROP TABLE run_group_members; DROP TABLE run_groups; PRAGMA user_version = 60');
  for (const t of ORDER) {
    const rows = snap.tables[t] || [];
    if (!rows.length) continue;
    const have = new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
    const cols = Object.keys(rows[0]).filter((c) => have.has(c));
    const ins = db.prepare(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
    for (const r of rows) ins.run(...cols.map((c) => (r[c] === undefined ? null : r[c])));
  }
  migrate(db);
  return db;
}
