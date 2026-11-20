// test/attach-run-artifacts.test.mjs — tools/attach-run-artifacts.mjs against the real schema (getDb() in a temp WORCA_HOME).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

const HOME = mkdtempSync(join(tmpdir(), 'attach-home-'));
process.env.WORCA_HOME = HOME;
process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
const { getDb } = await import('../src/core/db.mjs');
const { attach, pipelineIdOf, dbPath, KIND_RE } = await import('../tools/attach-run-artifacts.mjs');

const now = new Date().toISOString();
getDb().prepare(`INSERT INTO pipelines (id, project_key, target, title, status, phase, cycle, started_at, updated_at)
  VALUES (?, 'proj-a', 'project', ?, ?, 'plan', 1, ?, ?)`).run('abc12345', 'proof run', 'done', now, now);
const db = () => new DatabaseSync(dbPath());
const file = (name, text) => { const d = mkdtempSync(join(tmpdir(), 'attach-f-')); const f = join(d, name); writeFileSync(f, text); return f; };

test('attach copies the files under split-proof/ and indexes one artifacts row each; a second attach adds none', async () => {
  assert.equal(dbPath(), join(HOME, '.worca-cc', 'worca-cc.db'));
  assert.equal(dbPath(), (await import('../src/core/db.mjs')).dbPath(), 'the same file getDb() opens');
  const dir = join(HOME, '.worca-cc/store/k/pipelines/31-10-26-x-abc12345'); mkdirSync(dir, { recursive: true });
  const f1 = file('f1.md', '# proof\n');
  const r = attach({ dir, kind: 'split-verify', files: [f1], db: db() });
  assert.deepEqual(r, { id: 'abc12345', rels: ['split-proof/f1.md'] });
  assert.equal(readFileSync(join(dir, 'split-proof/f1.md'), 'utf8'), '# proof\n');
  const rows = () => getDb().prepare("SELECT pipeline_id, kind, rel_path, created_at FROM artifacts WHERE pipeline_id = 'abc12345'").all();
  assert.deepEqual(rows().map((x) => [x.pipeline_id, x.kind, x.rel_path]), [['abc12345', 'split-verify', 'split-proof/f1.md']]);
  assert.ok(rows()[0].created_at);
  attach({ dir, kind: 'split-verify', files: [f1], db: db() });
  assert.equal(rows().length, 1, 'the conflict clause keeps one row');
});

test('a run with no pipelines row is refused and nothing is copied; a bad kind or folder name is refused', () => {
  const dir = join(HOME, '.worca-cc/store/k/pipelines/31-10-26-y-abc99999'); mkdirSync(dir, { recursive: true });
  assert.throws(() => attach({ dir, kind: 'split-verify', files: [file('g.md', 'x')], db: db() }), /no run abc99999 in DB/);
  assert.equal(existsSync(join(dir, 'split-proof')), false);
  assert.throws(() => attach({ dir, kind: 'Bad Kind', files: [], db: db() }), /bad kind/);
  assert.throws(() => pipelineIdOf('/tmp/nodash'), /not a run folder/);
  assert.equal(pipelineIdOf('/x/31-10-26-final-round-for-919-before-ship-merge-nothing-in-315d1de2'), '315d1de2');
});

test('KIND_RE is the kind rule of src/shared/graph/agent-meta.mjs (EXTRA_KIND_RE), copied, not drifted', () => {
  const src = readFileSync(new URL('../src/shared/graph/agent-meta.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes(KIND_RE.source), KIND_RE.source);
});
