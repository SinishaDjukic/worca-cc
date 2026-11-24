// test/workflow-test-liked.test.mjs — D101: one result you liked per example, text or a project's changes, at most 2 MB, UTF-8.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import * as store from '../src/core/workflow-tests/store.mjs';
import * as cs from '../src/core/workflow-tests/criteria-store.mjs';
import { likedFromPipeline } from '../src/core/workflow-tests/criteria-read.mjs';

const homes = [];
beforeEach(async () => { const d = await mkdtemp(join(tmpdir(), 'worca-cc-wftliked-')); homes.push(d); _resetForTests(); process.env.WORCA_HOME = d; });
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }))); });

test('put, read, replace and delete; refused when empty, too large or not text', async () => {
  const ex = store.createExample('wf', { name: 'E', request: 'R' });
  cs.putLiked(ex.id, { kind: 'text', name: 'brief-good.md', data: Buffer.from('# Brief\nGood.') });
  assert.deepEqual(store.readExample('wf', ex.id).liked, { kind: 'text', name: 'brief-good.md', size: 13 });
  assert.equal(cs.readLiked(ex.id).text, '# Brief\nGood.');
  cs.putLiked(ex.id, { kind: 'text', name: 'other.md', data: Buffer.from('Other') });
  assert.equal(cs.readLiked(ex.id).name, 'other.md');
  assert.throws(() => cs.putLiked(ex.id, { kind: 'text', name: 'a.md', data: Buffer.alloc(0) }), { code: 'BAD_REQUEST', message: 'the result you liked is empty' });
  assert.throws(() => cs.putLiked(ex.id, { kind: 'text', name: 'a.md', data: Buffer.alloc(cs.LIKED_MAX + 1, 97) }), { message: 'the result you liked is larger than 2 MB' });
  assert.throws(() => cs.putLiked(ex.id, { kind: 'text', name: 'a.png', data: Buffer.from([0xff, 0xfe, 0x81]) }), { message: 'the result you liked must be a text file' });
  cs.deleteLiked(ex.id);
  assert.equal(store.readExample('wf', ex.id).liked, null);
});

test('likedFromPipeline: a run\'s result; a project example also keeps its changes', async () => {
  const ex = store.createExample('wf', { name: 'E', request: 'R' });
  await likedFromPipeline(ex, 'p0000001', { readMain: async () => ({ name: 'brief.md', text: 'Good brief.' }), readPatch: async () => null, at: '2026-10-28T00:00:00Z' });
  assert.deepEqual(cs.readLiked(ex.id), { kind: 'text', name: 'brief.md', text: 'Good brief.', fromPipeline: 'p0000001' });
  const px = { ...ex, project: { key: 'p-1a2b3c4d' } };
  await likedFromPipeline(px, 'p0000002', { readMain: async () => ({ name: 'r.md', text: 'Fixed.' }),
    readPatch: async () => ({ patch: 'diff --git a/x b/x\n+1\ndiff --git a/y b/y\n+2\n' }), at: '2026-10-28T00:00:00Z' });
  const l = cs.readLiked(ex.id);
  assert.equal(l.kind, 'changes');
  assert.match(l.name, /^Changes from the run on .+ · 2 files$/);
  assert.match(l.text, /^Fixed\.\n\n--- The changes this try made/);
  // M9: a result over 2 MB is clipped on a character boundary, never refused.
  await likedFromPipeline(ex, 'p0000003', { readMain: async () => ({ name: 'big.md', text: 'a' + 'é'.repeat(cs.LIKED_MAX) }), readPatch: async () => null });
  const big = cs.readLiked(ex.id);
  assert.ok(Buffer.byteLength(big.text) <= cs.LIKED_MAX && big.text.endsWith('é'));
  // An invalid start date leaves the date out of the name.
  const px2 = { ...ex, project: { key: 'p-1a2b3c4d' } };
  await likedFromPipeline(px2, 'p0000004', { readMain: async () => ({ name: 'r.md', text: 'x' }), readPatch: async () => ({ patch: 'diff --git a/x b/x\n' }), at: 'garbage' });
  assert.equal(cs.readLiked(ex.id).name, 'Changes from the run · 1 file');
  assert.throws(() => cs.putLiked(ex.id, { kind: 'zip', name: 'a', data: Buffer.from('x') }), { message: 'the result you liked is text or changes' });
});
