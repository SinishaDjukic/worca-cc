// test/boundary-ledger.test.mjs
// One owner for spend (plans/core-protection-layer-design.md §4.3): every booking goes through the harness's
// _bookUsage, and a model route is closed only by superviseSpawn or abandonRoute (src/core/spawn.mjs), never by an
// engine adapter, so what the relay measured is booked on every exit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');   // comments only

/** The body of method `name` in `src` (its first `name(` definition at class-member indent), brace-matched. Copied from
 *  test/boundary-catalog.test.mjs. */
function methodBody(src, name) {
  const at = src.search(new RegExp(`\\n  (async )?${name}\\(`));
  assert.ok(at >= 0, `${name} not found`);
  let i = src.indexOf('{', src.indexOf(')', at)); let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1);
  }
  throw new Error(`${name}: unbalanced`);
}

test('no engine adapter closes a route itself', () => {
  for (const f of readdirSync(join(ROOT, 'src/core/engines')).filter((x) => x.endsWith('.mjs'))) {
    const src = strip(readFileSync(join(ROOT, 'src/core/engines', f), 'utf8'));
    assert.ok(!/\.close(Engine|Model)?Route\(/.test(src), `${f} closes a model route; superviseSpawn or abandonRoute owns that`);
  }
});

test('only _bookUsage calls _recordCost', () => {
  const harness = strip(readFileSync(join(ROOT, 'src/core/run-harness.mjs'), 'utf8'));
  const body = methodBody(harness, '_bookUsage');
  assert.ok(body.includes('this._recordCost('), '_bookUsage books');
  // The definition line `_recordCost(costUsd, …) {` has no `this.` prefix, so it is not matched.
  assert.deepEqual(harness.replace(body, '').match(/this\._recordCost\(/g) || [], [], 'run-harness.mjs: _recordCost outside _bookUsage');
  const orch = strip(readFileSync(join(ROOT, 'src/core/orchestrator.mjs'), 'utf8'));
  assert.deepEqual(orch.match(/this\._recordCost\(/g) || [], [], 'orchestrator.mjs books through _bookUsage');
});
