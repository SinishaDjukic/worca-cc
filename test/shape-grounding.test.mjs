import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, realpath, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { checkPaths, lineCount } from '../src/core/shape/grounding.mjs';

test('found, missing, (new), :line; outside paths are never stat\'ed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shape-ground-'));
  await mkdir(join(dir, 'src'));
  await writeFile(join(dir, 'src', 'a.mjs'), 'one\ntwo\nthree\n');
  const outside = await mkdtemp(join(tmpdir(), 'shape-out-'));
  await writeFile(join(outside, 'secret.mjs'), 'x');
  await symlink(join(outside, 'secret.mjs'), join(dir, 'src', 'link.mjs'));
  const md = '## Code layout\n- `src/a.mjs`\n- `src/a.mjs:3`\n- `src/a.mjs:4`\n- `src/a.mjs:9`\n- `src/b.mjs` (new)\n- `src/c.mjs`\n- `src/../../etc/passwd`\n- `src/link.mjs`\n';
  const stats = [];
  const fs = { realpath, readFile, stat: async (p) => { stats.push(p); return stat(p); } };
  const g = await checkPaths(md, dir, { fs });
  const out = await realpath(outside);
  assert.deepEqual(g.map((x) => [x.path, x.line ?? null, x.found, x.isNew]), [
    ['src/a.mjs', null, true, false], ['src/a.mjs', 3, true, false], ['src/a.mjs', 4, false, false], // 3 lines + trailing \n
    ['src/a.mjs', 9, false, false],
    ['src/b.mjs', null, false, true], ['src/c.mjs', null, false, false],
    ['src/../../etc/passwd', null, false, false], ['src/link.mjs', null, false, false]]);
  assert.ok(stats.length > 0 && stats.every((p) => !p.endsWith(`${sep}etc${sep}passwd`) && !p.startsWith(out)));
  assert.deepEqual(['', 'a', 'a\n', 'a\nb', 'a\nb\n'].map(lineCount), [0, 1, 1, 2, 2]);
});

test('missing is set only for a path that does not exist, cited without :line', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shape-ground-missing-'));
  await mkdir(join(dir, 'src'));
  await writeFile(join(dir, 'src', 'a.mjs'), 'one\n');
  const md = '## Code layout\n- `src/a.mjs`\n- `src/a.mjs:9`\n- `src/gone.mjs`\n- `src/gone.mjs:2`\n- `src/../../etc/passwd`\n';
  const g = await checkPaths(md, dir);
  assert.deepEqual(g.map((x) => [x.path, x.line ?? null, x.missing === true]), [
    ['src/a.mjs', null, false], ['src/a.mjs', 9, false], ['src/gone.mjs', null, true],
    ['src/gone.mjs', 2, false], ['src/../../etc/passwd', null, false]]);
});
