// test/folder-retain.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { sweepRunRoots } from '../src/core/worktree.mjs';
import { writeRunManifest, liveRetainMembers } from '../src/core/run-manifest.mjs';
import { folderApplyRetainFor, runRootSweepLookups } from '../src/core/artifacts.mjs';
import { archivePipeline, discardRetainedWorktrees } from '../src/core/pipeline-delete.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import { worcaHome } from '../src/core/projects.mjs';

useTempHome(after);
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), `worca-retain-${p}-`)); dirs.push(d); return d; };
function folderRoot(id) {
  const root = join(worcaHome(), 'runs', id); const copyDir = join(root, 'repos', 'site-00000001');
  mkdirSync(copyDir, { recursive: true }); writeFileSync(join(copyDir, 'x.txt'), 'x\n');
  return { root, copyDir };
}

test('liveRetainMembers honours worktreeDir and copyDir', () => {
  const { copyDir } = folderRoot('aaaa0001');
  assert.equal(liveRetainMembers({ members: [{ copyDir }] }).length, 1);
  assert.equal(liveRetainMembers({ members: [{ worktreeDir: copyDir }] }).length, 1);
  assert.equal(liveRetainMembers({ members: [{ copyDir: join(copyDir, 'gone') }] }).length, 0);
  assert.deepEqual(liveRetainMembers(null), []);
});

test('the boot sweep keeps a folder-apply root while its copy exists and reclaims it once the copy is gone', async () => {
  const { root, copyDir } = folderRoot('aaaa0002');
  await writeRunManifest(root, { pipelineId: 'aaaa0002', runRootMode: 'detached', workMode: 'folder', members: [{ projectKey: 'site-00000001', copyDir, workMode: 'folder' }],
    retain: { reason: 'folder-apply', at: 'now', members: [{ projectKey: 'site-00000001', copyDir, reason: 'folder-apply' }] } });
  const lookups = { statusOf: () => 'done', membersOf: async () => [], pipelineDirOf: async () => null, retainOf: async () => null, log: () => {} };
  assert.deepEqual((await sweepRunRoots({ worcaHome: worcaHome(), ...lookups })).keep, [root]);
  rmSync(copyDir, { recursive: true, force: true });
  assert.deepEqual((await sweepRunRoots({ worcaHome: worcaHome(), ...lookups })).removed, [root]);
});

test('the DB fallback: a pending folder row with a live copy is retained; a settled one or a gone copy is not', async () => {
  const proj = tmp('proj');
  const { id } = await seedPipeline(proj, { status: 'done', branch: { workMode: 'folder', runRootMode: 'detached', copyDir: proj, changes: { state: 'pending', counts: { added: 1, modified: 0, deleted: 0 } } } });
  const row = () => getDb().prepare('SELECT * FROM pipelines WHERE id = ?').get(id);
  assert.deepEqual(folderApplyRetainFor(row()), { reason: 'folder-apply', members: [{ projectKey: row().project_key, copyDir: proj }] });
  assert.equal(runRootSweepLookups().retainOf(id)?.reason, 'folder-apply', 'the boot sweep\'s DB fallback is wired');
  const setBranch = (b) => getDb().prepare('UPDATE pipelines SET branch = ? WHERE id = ?').run(JSON.stringify(b), id);
  setBranch({ workMode: 'folder', copyDir: join(proj, 'gone'), changes: { state: 'pending', counts: { added: 1, modified: 0, deleted: 0 } } });
  assert.equal(folderApplyRetainFor(row()), null, 'a copy removed by hand self-clears');
  setBranch({ workMode: 'folder', copyDir: proj, changes: { state: 'applied' } });
  assert.equal(folderApplyRetainFor(row()), null);
});

test('Archive of a pending folder run discards the copy and marks it discarded, never touching the folder; discard-worktree leaves it alone', async () => {
  const proj = tmp('arch'); writeFileSync(join(proj, 'mine.txt'), 'mine\n');
  const { id, key } = await seedPipeline(proj, { status: 'done' });
  const { root, copyDir } = folderRoot(id);
  getDb().prepare('UPDATE pipelines SET branch = ? WHERE id = ?').run(JSON.stringify({ workMode: 'folder', runRootMode: 'detached', copyDir, realDir: proj,
    changes: { state: 'pending', counts: { added: 1, modified: 0, deleted: 0 } } }), id);
  await writeRunManifest(root, { pipelineId: id, workMode: 'folder', members: [{ projectKey: key, copyDir }], retain: { reason: 'folder-apply', members: [{ projectKey: key, copyDir, reason: 'folder-apply' }] } });
  assert.equal((await discardRetainedWorktrees({ key, id })).discarded, false);
  assert.ok(existsSync(copyDir), 'discard-worktree never snapshots or removes a folder copy');
  assert.equal((await archivePipeline({ key, id, by: 'ada@example.com' })).archived, true);
  assert.equal(existsSync(root), false);
  assert.equal(JSON.parse(getDb().prepare('SELECT branch FROM pipelines WHERE id = ?').get(id).branch).changes.state, 'discarded');
  assert.ok(existsSync(join(proj, 'mine.txt')));
  const events = getDb().prepare('SELECT text, actor FROM pipeline_events WHERE pipeline_id = ?').all(id).map((e) => ({ ...e }));
  assert.deepEqual(events.filter((e) => e.text.startsWith('Discarded')),
    [{ text: `Discarded the run's changes (archived) by ada@example.com; \`${proj}\` was not touched.`, actor: 'ada@example.com' }]);
});

test('Archive of an applied folder run keeps its state applied', async () => {
  const proj = tmp('applied');
  const { id, key } = await seedPipeline(proj, { status: 'done', branch: { workMode: 'folder', runRootMode: 'detached', copyDir: join(proj, 'gone'), realDir: proj,
    changes: { state: 'applied', counts: { added: 1, modified: 0, deleted: 0 }, appliedAt: '2026-10-18T00:00:00.000Z' } } });
  assert.equal((await archivePipeline({ key, id })).archived, true);
  assert.equal(JSON.parse(getDb().prepare('SELECT branch FROM pipelines WHERE id = ?').get(id).branch).changes.state, 'applied');
});
