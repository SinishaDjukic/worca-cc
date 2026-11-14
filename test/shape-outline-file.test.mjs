// test/shape-outline-file.test.mjs — the slice outline file after a Planner spawn (src/core/shape/outline-file.mjs):
// a new outline, the same outline (re-asked), or a plan instead (flat). A plan an earlier spawn left is never fresh.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileSha, outlineFileState } from '../src/core/shape/outline-file.mjs';

const dir = mkdtempSync(join(tmpdir(), 'worca-outline-file-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const file = join(dir, 'slices.json');
const planFile = join(dir, 'plan.md');
const OUTLINE = '{"slices":[1,2]}\n';

test('fileSha: null when missing, a stable sha256 hex otherwise', async () => {
  assert.equal(await fileSha(join(dir, 'nope.json')), null);
  writeFileSync(file, OUTLINE);
  const a = await fileSha(file);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(await fileSha(file), a);
});

test('outlineFileState: missing → flat; no baseline → outline; changed → outline', async () => {
  rmSync(file, { force: true });
  assert.equal(await outlineFileState(file), 'flat');
  writeFileSync(file, OUTLINE);
  assert.equal(await outlineFileState(file), 'outline');
  const baseline = { sha: await fileSha(file), planSha: null };
  writeFileSync(file, '{"slices":[1,2,3]}\n');
  assert.equal(await outlineFileState(file, { baseline, planFile }), 'outline');
});

test('outlineFileState: same outline plus a new plan → flat; plus the stale plan → unchanged; no or empty plan → unchanged', async () => {
  writeFileSync(file, OUTLINE);
  const sha = await fileSha(file);
  rmSync(planFile, { force: true });
  assert.equal(await outlineFileState(file, { baseline: { sha, planSha: null }, planFile }), 'unchanged');
  writeFileSync(planFile, '');
  assert.equal(await outlineFileState(file, { baseline: { sha, planSha: null }, planFile }), 'unchanged');
  writeFileSync(planFile, '# Plan\n');
  assert.equal(await outlineFileState(file, { baseline: { sha, planSha: null }, planFile }), 'flat');
  const planSha = await fileSha(planFile);
  assert.equal(await outlineFileState(file, { baseline: { sha, planSha }, planFile }), 'unchanged', 'a plan left by an earlier spawn');
  assert.equal(await outlineFileState(file, { baseline: { sha, planSha: null }, planFile: null }), 'unchanged');
  unlinkSync(planFile);
});
