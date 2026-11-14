// test/stillhet-demo-actions.test.mjs — "Would…" lives only in ui/public/stillhet/demo/demo-actions.js (the prototype host's
// demo adapter). The generated bundles (components.js, graph.js) are not source and are skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = new URL('../ui/public/stillhet/', import.meta.url).pathname;
const GENERATED = new Set(['components.js', 'graph.js', 'app.css']);
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = path.join(d, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

test('"Would" appears in no Stillhet source file but demo/demo-actions.js', () => {
  const hits = walk(ROOT)
    .filter((p) => /\.(js|mjs|html|css)$/.test(p) && !GENERATED.has(path.relative(ROOT, p)))
    .filter((p) => /\bWould\b/.test(readFileSync(p, 'utf8')))
    .map((p) => path.relative(ROOT, p));
  assert.deepEqual(hits, ['demo/demo-actions.js']);
});

test('no Stillhet source fakes an action with "(not in this prototype)": it asks window.RailWould instead', () => {
  const hits = walk(ROOT)
    .filter((p) => /\.(js|mjs|html)$/.test(p) && !GENERATED.has(path.relative(ROOT, p)) && !p.endsWith('demo-actions.js'))
    .filter((p) => /not in this prototype/.test(readFileSync(p, 'utf8')))
    .map((p) => path.relative(ROOT, p));
  assert.deepEqual(hits, []);
});

test('only the prototype host loads demo-actions.js', () => {
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(readFileSync(ROOT + 'boot.js', 'utf8'), sandbox);
  assert.ok(sandbox.module.exports.list('prototype').scripts.includes('demo/demo-actions.js'));
  assert.ok(!sandbox.module.exports.list('app').scripts.includes('demo/demo-actions.js'));
});
