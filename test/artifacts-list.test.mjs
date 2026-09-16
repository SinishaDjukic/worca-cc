// test/artifacts-list.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { recordArtifact, listRunArtifacts } from '../src/core/artifacts.mjs';

useTempHome(after);

test('listRunArtifacts returns attributed, byte-sized, ordered rows', async () => {
  const { id, dir } = await seedPipeline(process.cwd(), { title: 'A', status: 'done' });
  writeFileSync(join(dir, 'note.md'), 'hello');                  // 5 bytes
  mkdirSync(join(dir, 'extras'), { recursive: true });
  writeFileSync(join(dir, 'extras', 'a.md'), 'world!!');         // 7 bytes
  recordArtifact(id, 'note', 'note.md');                        // legacy: NULL attribution
  recordArtifact(id, 'extra', 'extras/a.md', { stepKey: 'exec-9', nodeId: 'planner', cycle: 2 });

  const rows = await listRunArtifacts(id);
  // seedPipeline records prompt.md too (NULL attribution) — filter to the ones we added.
  const note = rows.find((r) => r.kind === 'note');
  const extra = rows.find((r) => r.kind === 'extra');
  assert.equal(note.stepKey, null);            // legacy row: NULL attribution
  assert.deepEqual(
    { kind: extra.kind, stepKey: extra.stepKey, nodeId: extra.nodeId, cycle: extra.cycle, relPath: extra.relPath, bytes: extra.bytes },
    { kind: 'extra', stepKey: 'exec-9', nodeId: 'planner', cycle: 2, relPath: 'extras/a.md', bytes: 7 },
  );
  assert.equal(note.bytes, 5);
  // Legacy (NULL created_at) rows bucket ahead of attributed rows.
  const firstAttributedIdx = rows.findIndex((r) => r.createdAt != null);
  const lastLegacyIdx = rows.map((r) => r.createdAt).lastIndexOf(null);
  assert.ok(lastLegacyIdx < firstAttributedIdx, 'legacy NULL-attribution rows sort first');
  assert.equal((await listRunArtifacts(id, { stepKey: 'exec-9' })).length, 1);
  assert.equal((await listRunArtifacts(id, { kind: 'extra' })).length, 1);
});

test('listRunArtifacts returns [] for an unknown run', async () => {
  assert.deepEqual(await listRunArtifacts('deadbeef'), []);
});
