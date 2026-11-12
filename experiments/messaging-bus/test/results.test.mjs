// T-results: RESULTS.md cites the committed results/eN.json summaries exactly (plan §4.4 table convention).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const md = readFileSync(`${ROOT}RESULTS.md`, 'utf8');

/** The `## E<n>` section text up to the next `## ` heading. */
function section(n) {
  const start = md.search(new RegExp(`^## E${n}\\b`, 'm'));
  assert.ok(start >= 0, `## E${n} section`);
  const rest = md.slice(start + 3);
  const end = rest.search(/^## /m);
  return end >= 0 ? rest.slice(0, end) : rest;
}

test('one section per experiment with hypothesis, method, numbers and verdict', () => {
  for (const n of [1, 2, 3, 4]) {
    const s = section(n);
    for (const h of ['Hypothesis', 'Method', 'Numbers', 'Verdict']) assert.match(s, new RegExp(`^### ${h}`, 'm'), `E${n} ${h}`);
  }
  assert.match(md, /^## Not tested/m);
  assert.match(md, /^## Recommendation/m);
  assert.match(md, /^## Environment/m);
  assert.ok(section(3).includes('computed from a step model'));
});

test('every key/value in the numbers tables equals the JSON summary', () => {
  let checked = 0;
  for (const n of [1, 2, 3, 4]) {
    const summary = JSON.parse(readFileSync(`${ROOT}results/e${n}.json`, 'utf8')).summary;
    const rows = section(n).split('\n').filter((l) => /^\|\s*`e\d\./.test(l));
    assert.ok(rows.length > 0, `E${n} has a numbers table`);
    for (const row of rows) {
      const cells = row.split('|').slice(1, -1).map((c) => c.trim());
      assert.equal(cells.length, 4, row);
      const key = cells[0].replace(/`/g, '');
      assert.ok(key.startsWith(`e${n}.`), `${key} belongs to E${n}`);
      assert.ok(Object.hasOwn(summary, key), `${key} in results/e${n}.json`);
      assert.equal(cells[1], String(summary[key]), key);
      checked += 1;
    }
  }
  assert.ok(checked >= 20);
});
