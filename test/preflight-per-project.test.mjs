// test/preflight-per-project.test.mjs
// Unit tests for detectToolsPerProject: a trivial Promise.all over detectTools,
// keyed by projectDir. No tooling is installed in CI, so every entry degrades to
// the no-tool shape — what matters is the Map shape, the keying, and order safety.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { detectToolsPerProject, detectTools } from '../src/core/preflight.mjs';

const tmpDirs = [];
async function makeTmpDir(prefix = 'worca-cc-pf-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
import { after } from 'node:test';
after(async () => { await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true }))); });

test('detectToolsPerProject: returns a Map keyed by each projectDir', async () => {
  const a = await makeTmpDir();
  const b = await makeTmpDir();
  const map = await detectToolsPerProject([a, b]);
  assert.ok(map instanceof Map, 'returns a Map');
  assert.equal(map.size, 2);
  assert.ok(map.has(a) && map.has(b), 'each projectDir is a key');
  for (const dir of [a, b]) {
    const info = map.get(dir);
    assert.equal(typeof info, 'object');
    assert.ok('tool' in info && 'kind' in info && 'instruction' in info,
      'each entry carries {tool,kind,instruction}');
  }
});

test('detectToolsPerProject: each entry equals detectTools for that same dir', async () => {
  // Host-agnostic: whatever detectTools reports for a dir (tool present or not),
  // the per-project map must report exactly the same — it is a thin Promise.all.
  const a = await makeTmpDir();
  const direct = await detectTools(a);
  const map = await detectToolsPerProject([a]);
  assert.deepEqual(map.get(a), direct);
});

test('detectToolsPerProject: empty list -> empty Map', async () => {
  const map = await detectToolsPerProject([]);
  assert.ok(map instanceof Map);
  assert.equal(map.size, 0);
});
