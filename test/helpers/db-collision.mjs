// test/helpers/db-collision.mjs
// An ALREADY-ARCHIVED row squatting a seed id (`wf_quick-fix`): V24 must skip
// that seed, audit it, and leave the archived row untouched.
import { getDb, _resetForTests, dbPath } from '../../src/core/db.mjs';

export function buildCollisionDb() {
  const db = getDb();
  const dbFile = dbPath();
  db.exec('DELETE FROM workflows');
  db.exec(`INSERT INTO workflows (id,name,version,domain,steps,feedbacks,created_at,updated_at,archived_at)
    VALUES ('wf_quick-fix','Quick Fix',1,'coding','[]','[]','2026-07-01T00:00:00.000Z',
            '2026-07-01T00:00:00.000Z','2026-07-02T00:00:00.000Z')`);
  db.prepare("DELETE FROM store_meta WHERE key = 'migration:v24'").run();
  db.exec('PRAGMA user_version = 23');
  _resetForTests();
  return { dbFile };
}
