// test/preflight-node.test.mjs
// Unit tests for the dependency-free semver-ish compare used by the runtime Node
// preflight. We test the PURE helpers (cmpVersions, meetsMinNode) — no process.exit,
// no DB. The import-probe + exit wiring is covered by the entry-point smoke checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cmpVersions, meetsMinNode, MIN_NODE } from '../src/core/preflight-node.mjs';

test('MIN_NODE is the flagless node:sqlite floor', () => {
  assert.equal(MIN_NODE, '22.13.0', 'min supported Node is 22.13.0 (flagless node:sqlite)');
});

test('cmpVersions orders by numeric major.minor.patch', () => {
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
});

test('cmpVersions is numeric, not lexicographic (the classic 9 vs 13 trap)', () => {
  // Lexicographically "9" > "13"; numerically 9 < 13. Must be numeric.
  assert.equal(cmpVersions('22.9.0', '22.13.0'), -1, '22.9.0 < 22.13.0 numerically');
  assert.equal(cmpVersions('22.130.0', '22.13.0'), 1, '130 > 13 numerically');
});

test('cmpVersions tolerates a leading "v" and pre-release/build suffixes', () => {
  assert.equal(cmpVersions('v22.13.0', '22.13.0'), 0, 'leading v ignored');
  // Nightly/RC tags like 23.0.0-nightly… compare on the numeric core only.
  assert.equal(cmpVersions('23.0.0-nightly20250101', '22.13.0'), 1);
  assert.equal(cmpVersions('22.13.0-rc.1', '22.13.0'), 0, 'suffix ignored for the core compare');
});

test('cmpVersions tolerates missing components (treated as 0)', () => {
  assert.equal(cmpVersions('22', '22.0.0'), 0);
  assert.equal(cmpVersions('22.13', '22.13.0'), 0);
  assert.equal(cmpVersions('23', '22.13.0'), 1);
});

test('meetsMinNode(actual) is true at/above MIN_NODE, false below', () => {
  assert.equal(meetsMinNode('22.13.0'), true, 'exactly the floor passes');
  assert.equal(meetsMinNode('22.13.5'), true);
  assert.equal(meetsMinNode('23.4.0'), true);
  assert.equal(meetsMinNode('25.6.1'), true, "this repo's Node passes");
  assert.equal(meetsMinNode('22.12.0'), false, 'one minor below the floor fails');
  assert.equal(meetsMinNode('22.5.0'), false, 'flagged-era version fails');
  assert.equal(meetsMinNode('18.20.0'), false, 'old LTS fails');
});

test('meetsMinNode defaults to the running process version when called with no arg', () => {
  // Sanity: under the test runner (Node >= 22.13) this is true. Proves the default
  // path reads process.versions.node.
  assert.equal(meetsMinNode(), true);
});
