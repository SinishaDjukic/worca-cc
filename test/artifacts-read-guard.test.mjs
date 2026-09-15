// Spec §7 / D11: the read path stats before it reads, refuses binary kinds and
// files above the cap, and realpath-checks containment in the base it reads from
// (a symlink an agent drops can never read outside the store). Legacy store-root
// rows keep resolving (D12).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { projectStorePath } from '../src/core/store.mjs';
import {
  recordArtifact, findPipelineRowById, resolveIndexedArtifactForRow, ARTIFACT_READ_MAX_BYTES, BINARY_KINDS,
} from '../src/core/artifacts.mjs';

useTempHome(after);
const POSIX = { skip: process.platform === 'win32' ? 'symlink creation needs a privilege on Windows' : false };
const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });

async function seeded() {
  const proj = tmp('worca-guard-proj-');
  const { id, dir, key } = await seedPipeline(proj, { title: 'G', status: 'done' });
  const step = join(dir, 'steps', 'n_x-c1');
  mkdirSync(join(step, 'shots'), { recursive: true });
  return { id, dir, key, step, row: findPipelineRowById(id), attr: { stepKey: 'x:n_x:1', nodeId: 'n_x', cycle: 1 } };
}

test('constants: 2 MB cap, image + binary refused', () => {
  assert.equal(ARTIFACT_READ_MAX_BYTES, 2 * 1024 * 1024);
  assert.deepEqual([...BINARY_KINDS].sort(), ['binary', 'image']);
});

test('plain read, legacy store-root row, binary kind, too-large file, missing file', async () => {
  const { id, dir, key, step, row, attr } = await seeded();
  writeFileSync(join(step, 'note.md'), '# hi\n');
  recordArtifact(id, 'markdown', 'steps/n_x-c1/note.md', attr);
  assert.deepEqual(await resolveIndexedArtifactForRow(row, 'steps/n_x-c1/note.md'), { rel: 'steps/n_x-c1/note.md', text: '# hi\n' });
  assert.deepEqual(await resolveIndexedArtifactForRow(row, '/abs/elsewhere/steps/n_x-c1/note.md'), { rel: 'steps/n_x-c1/note.md', text: '# hi\n' }, 'suffix match still works');
  // D12: an old run's store-root row still opens through the store-root base.
  const plans = join(projectStorePath(key), 'plans');
  mkdirSync(plans, { recursive: true });
  writeFileSync(join(plans, 'old.md'), 'old');
  recordArtifact(id, 'plan', 'plans/old.md');
  assert.deepEqual(await resolveIndexedArtifactForRow(row, 'plans/old.md'), { rel: 'plans/old.md', text: 'old' });
  // Binary kinds: size only, never the bytes.
  writeFileSync(join(step, 'shots', 'one.png'), Buffer.from([0x89, 0x50]));
  recordArtifact(id, 'image', 'steps/n_x-c1/shots/one.png', attr);
  assert.deepEqual(await resolveIndexedArtifactForRow(row, 'steps/n_x-c1/shots/one.png'), { rel: 'steps/n_x-c1/shots/one.png', bytes: 2, binary: true });
  writeFileSync(join(step, 'bundle.zip'), 'zz');
  recordArtifact(id, 'binary', 'steps/n_x-c1/bundle.zip', attr);
  assert.deepEqual(await resolveIndexedArtifactForRow(row, 'steps/n_x-c1/bundle.zip'), { rel: 'steps/n_x-c1/bundle.zip', bytes: 2, binary: true });
  // A binary EXTENSION under a non-binary kind (a run extra, a free-text
  // artifactKind) is refused the same way: the bytes are never read as utf8.
  mkdirSync(join(dir, 'extras'), { recursive: true });
  writeFileSync(join(dir, 'extras', 'shot.png'), Buffer.from([0x89, 0x50, 0x4e]));
  recordArtifact(id, 'extra', 'extras/shot.png');
  assert.deepEqual(await resolveIndexedArtifactForRow(row, 'extras/shot.png'), { rel: 'extras/shot.png', bytes: 3, binary: true });
  // Above the cap: stat only (sparse file — nothing is read).
  writeFileSync(join(step, 'big.txt'), '');
  await truncate(join(step, 'big.txt'), ARTIFACT_READ_MAX_BYTES + 1);
  recordArtifact(id, 'text', 'steps/n_x-c1/big.txt', attr);
  assert.deepEqual(await resolveIndexedArtifactForRow(row, 'steps/n_x-c1/big.txt'), { rel: 'steps/n_x-c1/big.txt', bytes: ARTIFACT_READ_MAX_BYTES + 1, tooLarge: true, cap: ARTIFACT_READ_MAX_BYTES });
  // Exactly at the cap still reads.
  writeFileSync(join(step, 'edge.txt'), '');
  await truncate(join(step, 'edge.txt'), ARTIFACT_READ_MAX_BYTES);
  recordArtifact(id, 'text', 'steps/n_x-c1/edge.txt', attr);
  assert.equal((await resolveIndexedArtifactForRow(row, 'steps/n_x-c1/edge.txt')).text.length, ARTIFACT_READ_MAX_BYTES);
  // Indexed but gone from disk, and a directory row.
  recordArtifact(id, 'markdown', 'steps/n_x-c1/gone.md', attr);
  assert.equal(await resolveIndexedArtifactForRow(row, 'steps/n_x-c1/gone.md'), null);
  recordArtifact(id, 'text', 'steps/n_x-c1/shots', attr);
  assert.equal(await resolveIndexedArtifactForRow(row, 'steps/n_x-c1/shots'), null, 'a directory is never served');
});

test('a symlink that escapes the run dir is refused; a symlink inside it still resolves', POSIX, async () => {
  const { id, step, row, attr } = await seeded();
  const outside = tmp('worca-guard-outside-');
  writeFileSync(join(outside, 'secret.md'), 'S');
  symlinkSync(join(outside, 'secret.md'), join(step, 'link.md'));
  recordArtifact(id, 'markdown', 'steps/n_x-c1/link.md', attr);
  assert.equal(await resolveIndexedArtifactForRow(row, 'steps/n_x-c1/link.md'), null, 'the escape is null (404), never a fall-through to the store root');
  writeFileSync(join(step, 'real.md'), 'R');
  symlinkSync(join(step, 'real.md'), join(step, 'alias.md'));
  recordArtifact(id, 'markdown', 'steps/n_x-c1/alias.md', attr);
  assert.deepEqual(await resolveIndexedArtifactForRow(row, 'steps/n_x-c1/alias.md'), { rel: 'steps/n_x-c1/alias.md', text: 'R' });
});
