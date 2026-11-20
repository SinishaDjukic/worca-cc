// test/artifacts-list.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { recordArtifact, listRunArtifacts, resolveIndexedArtifactForRow, findPipelineRowById, forgetMissingArtifacts } from '../src/core/artifacts.mjs';
import { checkRows } from './helpers/rows.mjs';

useTempHome(after);

test('listRunArtifacts returns attributed, byte-sized, ordered rows; [] for an unknown run', async () => {
  await checkRows([
    { name: 'listRunArtifacts returns attributed, byte-sized, ordered rows', run: async () => {
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
    } },
    { name: 'listRunArtifacts returns [] for an unknown run', run: async () => {
      assert.deepEqual(await listRunArtifacts('deadbeef'), []);
    } },
  ]);
});

// Splitting resolveIndexedArtifactForRow into "access() picks the base" +
// "readFile in the wrapper" changed the contract from "the first base the file
// can be READ from" to "the first base it EXISTS at". access() is F_OK, and a
// DIRECTORY passes it — so a run folder holding a `plans/` directory where the
// store holds `plans/plan.md` fixes the base to the run dir and the read then
// fails with EISDIR, returning 500 instead of the store-root copy.
test('base selection skips a path that exists but is not a readable file', async () => {
  const { id, dir, key } = await seedPipeline(await mkdtemp(join(tmpdir(), 'worca-basesel-')), { title: 'B', status: 'done' });
  const storeRoot = dirname(dirname(dir));                 // <store>/<key>/
  // The store-root copy: the real artifact, recorded store-root-relative.
  await mkdir(join(storeRoot, 'plans'), { recursive: true });
  await writeFile(join(storeRoot, 'plans', 'plan.md'), '# the real plan\n', 'utf8');
  // The run folder shadows the same rel path with a DIRECTORY.
  await mkdir(join(dir, 'plans', 'plan.md'), { recursive: true });
  recordArtifact(id, 'plan', 'plans/plan.md');

  const hit = await resolveIndexedArtifactForRow(findPipelineRowById(id), 'plans/plan.md');
  assert.ok(hit, 'resolves rather than throwing EISDIR');
  assert.equal(hit.rel, 'plans/plan.md');
  assert.equal(hit.text, '# the real plan\n', 'the readable store-root copy wins over the shadowing directory');
  assert.ok(key);
});

// The same shadowing case as the base-selection test, one layer up: sizeOf picked
// the first base that STATS, so a directory at <runDir>/<rel> reported its inode
// size while the viewer read the store-root file. The row and the viewer have to
// mean the same copy.
test('the byte size skips a directory shadowing the rel path', async () => {
  const { id, dir } = await seedPipeline(await mkdtemp(join(tmpdir(), 'worca-sizeof-')), { title: 'S', status: 'done' });
  const storeRoot = dirname(dirname(dir));
  await mkdir(join(storeRoot, 'plans'), { recursive: true });
  await writeFile(join(storeRoot, 'plans', 'plan.md'), 'exactly ten', 'utf8');   // 11 bytes
  await mkdir(join(dir, 'plans', 'plan.md'), { recursive: true });
  recordArtifact(id, 'plan', 'plans/plan.md');

  const [row] = (await listRunArtifacts(id)).filter((a) => a.relPath === 'plans/plan.md');
  assert.equal(row.bytes, 11, 'the readable file is measured, not the shadowing directory');
});

// Indexing only ever ADDED rows. The deck audit deletes and recreates shots/
// every cycle, so a fix cycle that cuts a slide left the dropped slide's
// screenshot indexed — a row that renders 0 B, 404s when clicked, and that
// list_run_artifacts hands the model for read_run_artifact to fail on.
test('forgetMissingArtifacts drops rows for files the directory no longer holds', async () => {
  const { id } = await seedPipeline(await mkdtemp(join(tmpdir(), 'worca-forget-')), { title: 'F', status: 'done' });
  for (const n of ['s01.png', 's02.png', 's03.png']) recordArtifact(id, 'deck-shot', `shots/${n}`);
  recordArtifact(id, 'deck', 'deck/deck.html');
  recordArtifact(id, 'prompt', 'prompt.md');

  // Cycle 2 reshoots two slides; the third was cut.
  const removed = forgetMissingArtifacts(id, 'shots', new Set(['s01.png', 's02.png']));

  assert.deepEqual(removed, ['shots/s03.png'], 'the prune names what it dropped');
  const kept = (await listRunArtifacts(id)).map((a) => a.relPath);
  assert.ok(!kept.includes('shots/s03.png'), 'the cut slide went');
  for (const still of ['shots/s01.png', 'shots/s02.png', 'deck/deck.html', 'prompt.md']) {
    assert.ok(kept.includes(still), `${still} must survive: ${kept.join(',')}`);
  }
});

test('forgetMissingArtifacts is one level deep and refuses nonsense', async () => {
  const { id } = await seedPipeline(await mkdtemp(join(tmpdir(), 'worca-forget2-')), { title: 'F2', status: 'done' });
  recordArtifact(id, 'deck-asset', 'deck/fonts/inter.woff2');   // nested: owned by nobody here
  recordArtifact(id, 'deck', 'deck/deck.html');

  assert.deepEqual(forgetMissingArtifacts(id, 'deck', new Set(['deck.html'])), [], 'a nested row is left alone');
  assert.deepEqual(forgetMissingArtifacts(id, '', new Set()), []);
  assert.deepEqual(forgetMissingArtifacts(id, 'deck', null), [], 'a missing listing prunes nothing');
  const rels = (await listRunArtifacts(id)).map((a) => a.relPath);
  assert.ok(rels.includes('deck/fonts/inter.woff2'), rels.join(','));
  assert.ok(rels.includes('deck/deck.html'), rels.join(','));
});

test('forgetMissingArtifacts escapes LIKE wildcards (_ and %) in a directory name', async () => {
  await checkRows([
    // `_` is a single-character WILDCARD in SQLite LIKE, and EXTRA_GLOB_RE admits it
    // in a directory name — so sweeping `my_dir/` also selected rows under `myXdir/`,
    // whose basenames are absent from my_dir's listing and were therefore DELETEd.
    // An index row for a file still on disk, which then 404s from the raw route and
    // from read_run_artifact.
    { name: 'forgetMissingArtifacts does not treat _ in a directory name as a wildcard', run: async () => {
      const { id } = await seedPipeline(await mkdtemp(join(tmpdir(), 'worca-like-')), { title: 'L', status: 'done' });
      recordArtifact(id, 'shot', 'my_dir/a.png');
      recordArtifact(id, 'shot', 'myXdir/b.png');          // a DIFFERENT directory
      recordArtifact(id, 'shot', 'my_dir/gone.png');

      const removed = forgetMissingArtifacts(id, 'my_dir', new Set(['a.png']));

      assert.deepEqual(removed, ['my_dir/gone.png'], 'only my_dir/gone.png');
      const rels = (await listRunArtifacts(id)).map((a) => a.relPath);
      assert.ok(rels.includes('myXdir/b.png'), `a neighbouring directory was pruned: ${rels.join(',')}`);
      assert.ok(rels.includes('my_dir/a.png'), rels.join(','));
      assert.ok(!rels.includes('my_dir/gone.png'), rels.join(','));
    } },
    { name: 'forgetMissingArtifacts does not treat % in a directory name as a wildcard', run: async () => {
      const { id } = await seedPipeline(await mkdtemp(join(tmpdir(), 'worca-like2-')), { title: 'L2', status: 'done' });
      recordArtifact(id, 'shot', 'a%b/one.png');
      recordArtifact(id, 'shot', 'axxb/two.png');
      assert.deepEqual(forgetMissingArtifacts(id, 'a%b', new Set()), ['a%b/one.png']);
      assert.ok((await listRunArtifacts(id)).map((a) => a.relPath).includes('axxb/two.png'));
    } },
  ]);
});

// Plan/review markdown is STORE-ROOT relative, not run-dir relative:
// listRunArtifacts and resolveIndexedArtifactFileForRow both resolve a row
// against the run dir FIRST and then the store root. The prune only ever saw the
// run dir's listing, so a row whose file lives at the store root looked absent
// and was deleted. EXTRA_GLOB_RE accepts `reviews/*` and `plans/*`, so a plugin-
// or user-authored agent declaring one silently unindexed every review of the
// run on its first execution — files still on disk, 404 from the artifact routes,
// gone from History. The prune must agree with the readers about where a row can
// live.
test('forgetMissingArtifacts keeps a row whose file lives at the store root', async () => {
  const projDir = await mkdtemp(join(tmpdir(), 'worca-forget-store-'));
  const { id } = await seedPipeline(projDir, { title: 'F3', status: 'done' });
  const row = findPipelineRowById(id);
  const { projectStorePath } = await import('../src/core/store.mjs');
  const storeRoot = projectStorePath(row.project_key);
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(join(storeRoot, 'reviews'), { recursive: true });
  await writeFile(join(storeRoot, 'reviews', 'impl-review-1.md'), '# review', 'utf8');
  recordArtifact(id, 'review', 'reviews/impl-review-1.md');

  // An agent sweeps a run-dir `reviews/` that exists but holds something else.
  const removed = forgetMissingArtifacts(id, 'reviews', new Set(['scratch.md']));

  assert.deepEqual(removed, [], 'the store-root review is not "missing"');
  const kept = (await listRunArtifacts(id)).map((a) => a.relPath);
  assert.ok(kept.includes('reviews/impl-review-1.md'), kept.join(','));
});

test('listRunArtifacts paging: offset without limit, and an unsafe limit is no limit', async () => {
  await checkRows([
    // SQLite accepts OFFSET only alongside LIMIT, so `hasOffset = hasLimit && …`
    // silently returned page 1 to a caller that passed an offset and no limit — the
    // shape a future caller reaches for after reading `nextOffset` in a response.
    // `LIMIT -1` is SQLite's "no limit", which lets the offset stand on its own.
    { name: 'listRunArtifacts honours an offset given without a limit', run: async () => {
      const { id } = await seedPipeline(await mkdtemp(join(tmpdir(), 'worca-offset-')), { title: 'O', status: 'done' });
      for (const n of ['a.md', 'b.md', 'c.md']) recordArtifact(id, 'plan', `plans/${n}`);
      const all = (await listRunArtifacts(id, {})).map((a) => a.relPath);
      const skipped = (await listRunArtifacts(id, { offset: 2 })).map((a) => a.relPath);
      assert.equal(skipped.length, all.length - 2, 'two rows were skipped');
      assert.deepEqual(skipped, all.slice(2), 'and they are the right two');
    } },
    // The offset guard was moved to Number.isSafeInteger because node:sqlite refuses
    // to bind a non-safe integer (`datatype mismatch`, surfacing as a 500) — and the
    // comment says the guard belongs "where the value meets the statement, so no
    // caller can reintroduce it". `limit` is the same statement, bound the same way,
    // and was left on Number.isInteger. Both current callers happen to clamp; the
    // next one to forward a query param would not.
    { name: 'listRunArtifacts survives an unsafe limit the way it survives an unsafe offset', run: async () => {
      const { id } = await seedPipeline(await mkdtemp(join(tmpdir(), 'worca-biglimit-')), { title: 'B', status: 'done' });
      recordArtifact(id, 'plan', 'plans/a.md');
      const rows = await listRunArtifacts(id, { limit: 1e20 });
      assert.ok(Array.isArray(rows) && rows.length >= 1, 'an absurd limit is simply no limit, not a throw');
    } },
  ]);
});

test('re-kinding a file: indexedNamesUnder exposes the kind and forgetOtherKinds retires the old row', async () => {
  await checkRows([
    // indexedNamesUnder returns BASENAMES, kind-blind — while recordArtifact's PK is
    // (pipeline_id, kind, rel_path) and forgetMissingArtifacts only drops rows whose
    // FILE is gone. So a file already indexed under kind A that a later sweep claims
    // under kind B kept its A row: skipped entirely when its mtime predates the
    // execution, and DOUBLE-listed when it did not. Reachable for any run spanning the
    // V32 deck/deck-asset split, and for any sidecar edit that re-kinds a glob. A file
    // has one kind at a time — that is exactly why the ports are first-match-wins.
    { name: 're-kinding a file replaces its row instead of leaving two', run: async () => {
      const { id } = await seedPipeline(await mkdtemp(join(tmpdir(), 'worca-rekind-')), { title: 'K', status: 'done' });
      recordArtifact(id, 'deck', 'deck/deck-stage.js', { stepKey: 'x:n_build:1', nodeId: 'n_build', cycle: 1 });
      const { indexedNamesUnder } = await import('../src/core/artifacts.mjs');

      const known = indexedNamesUnder(id, 'deck');
      assert.ok(known.has('deck-stage.js'), 'the name is known');
      assert.deepEqual([...(known.get('deck-stage.js') || [])], ['deck'],
        'and the KIND it is known under is available, so a sweep can tell A from B');
    } },
    { name: 'forgetOtherKinds retires the superseded row so the file is listed once', run: async () => {
      const { id } = await seedPipeline(await mkdtemp(join(tmpdir(), 'worca-rekind2-')), { title: 'K2', status: 'done' });
      const { forgetOtherKinds } = await import('../src/core/artifacts.mjs');
      recordArtifact(id, 'deck', 'deck/deck-stage.js', { stepKey: 'x:n_build:1', nodeId: 'n_build', cycle: 1 });
      recordArtifact(id, 'deck-asset', 'deck/deck-stage.js', { stepKey: 'x:n_build:2', nodeId: 'n_build', cycle: 2 });
      assert.equal((await listRunArtifacts(id)).filter((a) => a.relPath === 'deck/deck-stage.js').length, 2,
        'both rows exist to begin with — that is the bug');

      const dropped = forgetOtherKinds(id, 'deck/deck-stage.js', 'deck-asset');

      assert.deepEqual(dropped, ['deck'], 'it says what it retired');
      const rows = (await listRunArtifacts(id)).filter((a) => a.relPath === 'deck/deck-stage.js');
      assert.equal(rows.length, 1, 'one kind per file');
      assert.equal(rows[0].kind, 'deck-asset', 'the current one survives');
      assert.deepEqual(forgetOtherKinds(id, 'deck/deck-stage.js', 'deck-asset'), [], 'idempotent');
    } },
  ]);
});

// The prune decides from a readdir SNAPSHOT taken before the sweep's own awaits.
// run-harness names concurrent sweeps as real ("a workspace fan-out of an
// extraFiles-declaring agent; _indexExtraFiles awaits between files, so they
// interleave"): execution A lists shots/ as {s01..s03}, B then writes and records
// s04.png, and A's prune deletes B's row for a file that is on disk — which then
// 404s for the life of the run, since the raw route resolves `rel` only among
// indexed rows. The FILE is the truth, not a snapshot of it.
test('the prune keeps a row whose file exists, even if the listing missed it', async () => {
  const projDir = await mkdtemp(join(tmpdir(), 'worca-prune-race-'));
  const { id, dir } = await seedPipeline(projDir, { title: 'R', status: 'running' });
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(join(dir, 'shots'), { recursive: true });
  for (const n of ['s01.png', 's04.png']) await writeFile(join(dir, 'shots', n), 'x');
  recordArtifact(id, 'deck-shot', 'shots/s01.png');
  recordArtifact(id, 'deck-shot', 'shots/s04.png');   // written by the other execution
  recordArtifact(id, 'deck-shot', 'shots/s99.png');   // genuinely gone

  // A stale snapshot that never saw s04.
  const removed = forgetMissingArtifacts(id, 'shots', new Set(['s01.png']), dir);

  assert.deepEqual(removed, ['shots/s99.png'], 'only the row with no file goes');
  const kept = (await listRunArtifacts(id)).map((a) => a.relPath);
  assert.ok(kept.includes('shots/s04.png'), `a file on disk keeps its row: ${kept.join(',')}`);
});

// G11: only `work` rows refused links; every other kind followed them, so an agent that swapped its plan (or any run
// file) for a link made the artifact routes serve whatever the worca user can read. Every kind is now served only as
// a real file with no link anywhere between its base and itself, and the listing sizes nothing behind a link.
test('no artifact kind is served or sized through a link planted in the run dir or the store', async () => {
  const { symlink, rm } = await import('node:fs/promises');
  const { id, dir } = await seedPipeline(await mkdtemp(join(tmpdir(), 'worca-g11-')), { title: 'G11', status: 'done' });
  const storeRoot = dirname(dirname(dir));
  const secretDir = await mkdtemp(join(tmpdir(), 'worca-g11-secret-'));
  await writeFile(join(secretDir, 'settings.json'), '{"secret":"s3cr3t!"}', 'utf8');
  await mkdir(join(storeRoot, 'plans'), { recursive: true });
  await writeFile(join(storeRoot, 'plans', 'plan.md'), '# plan\n', 'utf8');
  await mkdir(join(dir, 'extras'), { recursive: true });
  await writeFile(join(dir, 'extras', 'a.md'), 'mine', 'utf8');
  await writeFile(join(dir, 'note.md'), 'note', 'utf8');
  recordArtifact(id, 'plan', 'plans/plan.md');
  recordArtifact(id, 'extra', 'extras/a.md');
  recordArtifact(id, 'note', 'note.md');
  const row = findPipelineRowById(id);
  assert.equal((await resolveIndexedArtifactForRow(row, 'plans/plan.md')).text, '# plan\n');
  assert.equal((await resolveIndexedArtifactForRow(row, 'extras/a.md')).text, 'mine');
  assert.equal((await resolveIndexedArtifactForRow(row, 'note.md')).text, 'note');

  await rm(join(storeRoot, 'plans', 'plan.md'));
  await rm(join(dir, 'extras'), { recursive: true });
  await rm(join(dir, 'note.md'));
  try {
    await symlink(join(secretDir, 'settings.json'), join(storeRoot, 'plans', 'plan.md'));   // a file swapped for a link
    await symlink(secretDir, join(dir, 'extras'), 'junction');                              // a folder swapped for a link
    await writeFile(join(secretDir, 'a.md'), 'not yours', 'utf8');
    await symlink(join(secretDir, 'settings.json'), join(dir, 'note.md'));
  } catch (e) { if (e.code === 'EPERM') return; throw e; }   // Windows without the privilege
  assert.equal(await resolveIndexedArtifactForRow(row, 'plans/plan.md'), null, 'a store-root plan swapped for a link');
  assert.equal(await resolveIndexedArtifactForRow(row, 'extras/a.md'), null, 'a run folder swapped for a link');
  assert.equal(await resolveIndexedArtifactForRow(row, 'note.md'), null, 'a run file swapped for a link');
  const bytes = Object.fromEntries((await listRunArtifacts(id)).map((a) => [a.relPath, a.bytes]));
  assert.deepEqual([bytes['plans/plan.md'], bytes['extras/a.md'], bytes['note.md']], [0, 0, 0], 'nothing behind a link is sized');
});
