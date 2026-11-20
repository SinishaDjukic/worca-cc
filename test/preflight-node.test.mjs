// test/preflight-node.test.mjs
// Unit tests for the dependency-free semver-ish compare used by the runtime Node
// preflight. We test the PURE helpers (cmpVersions, meetsMinNode) — no process.exit,
// no DB. The import-probe + exit wiring is covered by the entry-point smoke checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cmpVersions, meetsMinNode, MIN_NODE } from '../src/core/preflight-node.mjs';
import { checkRows } from './helpers/rows.mjs';

test('cmpVersions: numeric order (9 vs 13), v-prefix, pre-release suffix, missing components', async () => {
  await checkRows([
    { name: 'cmpVersions orders by numeric major.minor.patch', run: () => {
      // equal
      assert.equal(cmpVersions('22.13.0', '22.13.0'), 0);
      // patch
      assert.equal(cmpVersions('22.13.1', '22.13.0'), 1);
      assert.equal(cmpVersions('22.13.0', '22.13.1'), -1);
      // minor
      assert.equal(cmpVersions('22.13.0', '22.12.9'), 1);
      assert.equal(cmpVersions('22.12.99', '22.13.0'), -1);
      // major
      assert.equal(cmpVersions('23.0.0', '22.13.0'), 1);
      assert.equal(cmpVersions('22.99.99', '23.0.0'), -1);
    } },
    { name: 'cmpVersions is numeric, not lexicographic (the classic 9 vs 13 trap)', run: () => {
      // Lexicographically "9" > "13"; numerically 9 < 13. Must be numeric.
      assert.equal(cmpVersions('22.9.0', '22.13.0'), -1, '22.9.0 < 22.13.0 numerically');
      assert.equal(cmpVersions('22.130.0', '22.13.0'), 1, '130 > 13 numerically');
    } },
    { name: 'cmpVersions tolerates a leading "v" and pre-release/build suffixes', run: () => {
      assert.equal(cmpVersions('v22.13.0', '22.13.0'), 0, 'leading v ignored');
      // Nightly/RC tags like 23.0.0-nightly… compare on the numeric core only.
      assert.equal(cmpVersions('23.0.0-nightly20250101', '22.13.0'), 1);
      assert.equal(cmpVersions('22.13.0-rc.1', '22.13.0'), 0, 'suffix ignored for the core compare');
    } },
    { name: 'cmpVersions tolerates missing components (treated as 0)', run: () => {
      assert.equal(cmpVersions('22', '22.0.0'), 0);
      assert.equal(cmpVersions('22.13', '22.13.0'), 0);
      assert.equal(cmpVersions('23', '22.13.0'), 1);
    } },
  ]);
});

test('meetsMinNode: the 22.19.0 floor (MIN_NODE), boundaries, and the process default', async () => {
  await checkRows([
    { name: 'MIN_NODE is the flagless node:sqlite and undici 8 floor', run: () => {
      assert.equal(MIN_NODE, '22.19.0', 'min supported Node is 22.19.0 (flagless node:sqlite, undici 8)');
    } },
    { name: 'meetsMinNode(actual) is true at/above MIN_NODE, false below', run: () => {
      assert.equal(meetsMinNode('22.19.0'), true, 'exactly the floor passes');
      assert.equal(meetsMinNode('22.19.5'), true);
      assert.equal(meetsMinNode('23.4.0'), true);
      assert.equal(meetsMinNode('25.6.1'), true, "this repo's Node passes");
      assert.equal(meetsMinNode('22.18.0'), false, 'one minor below the floor fails');
      assert.equal(meetsMinNode('22.13.0'), false, 'flagless node:sqlite alone is not enough');
      assert.equal(meetsMinNode('22.5.0'), false, 'flagged-era version fails');
      assert.equal(meetsMinNode('18.20.0'), false, 'old LTS fails');
    } },
    { name: 'meetsMinNode defaults to the running process version when called with no arg', run: () => {
      // Sanity: under the test runner (Node >= 22.19) this is true. Proves the default
      // path reads process.versions.node.
      assert.equal(meetsMinNode(), true);
    } },
  ]);
});
