// test/settings-commit-message.test.mjs — Settings › Runs › Commit message: the stored setting and what
// buildRunCommitMessage makes of it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_COMMIT_MESSAGE, commitMessageSettings, setCommitMessage, assertCommitMessageInput,
} from '../src/core/settings.mjs';
import { buildRunCommitMessage } from '../src/core/commit-message.mjs';

let home; const prev = {};
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-commitmsg-'));
  for (const k of ['HOME', 'USERPROFILE']) { prev[k] = process.env[k]; process.env[k] = home; }
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await rm(home, { recursive: true, force: true });
});

test('commitMessage: both parts on by default; a partial patch keeps the other key; null resets', async () => {
  assert.deepEqual(DEFAULT_COMMIT_MESSAGE, { prefix: true, runTrailer: true });
  assert.deepEqual(commitMessageSettings(), { prefix: true, runTrailer: true });
  assert.deepEqual(await setCommitMessage({ prefix: false }), { prefix: false, runTrailer: true });
  assert.deepEqual(await setCommitMessage({ runTrailer: false }), { prefix: false, runTrailer: false });
  assert.deepEqual(await setCommitMessage({ prefix: null }), { prefix: true, runTrailer: false }, 'a null key resets that key');
  assert.deepEqual(await setCommitMessage(null), { prefix: true, runTrailer: true });
});

test('commitMessage: bad input is refused with a field-shaped message', () => {
  assert.throws(() => assertCommitMessageInput({ prefix: 'no' }), /commitMessage\.prefix must be true or false/);
  assert.throws(() => assertCommitMessageInput({ runTrailer: 1 }), /commitMessage\.runTrailer must be true or false/);
  assert.throws(() => assertCommitMessageInput({ pipelineLine: true }), /unknown commitMessage setting: pipelineLine/);
  assert.throws(() => assertCommitMessageInput([]), /commitMessage must be an object/);
  assert.doesNotThrow(() => assertCommitMessageInput(null));
  assert.doesNotThrow(() => assertCommitMessageInput({ prefix: null }));
});

test('buildRunCommitMessage: the prefix and the Worca-Run trailer drop on their own; the body stays', () => {
  const o = { title: 'Add login', runId: 'p1', summary: 'Why it is needed.' };
  assert.equal(buildRunCommitMessage(o), 'worca: Add login\n\nWhy it is needed.\n\nWorca-Run: p1');
  assert.equal(buildRunCommitMessage({ ...o, prefix: false }), 'Add login\n\nWhy it is needed.\n\nWorca-Run: p1');
  assert.equal(buildRunCommitMessage({ ...o, runTrailer: false }), 'worca: Add login\n\nWhy it is needed.');
  assert.equal(buildRunCommitMessage({ ...o, ...{ prefix: false, runTrailer: false } }), 'Add login\n\nWhy it is needed.');
  assert.equal(buildRunCommitMessage({ title: '', prefix: false }), 'changes', 'an empty title still says something');
});
