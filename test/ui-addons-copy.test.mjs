// test/ui-addons-copy.test.mjs — Models and Providers are pages of their own (sidebar › Add-ons), not
// Settings tabs: no user-visible string in the UI or Ask's prompt sends anyone to "Settings › Models" or
// "Settings › Providers", and no link or hash points at the old #settings/models or #settings/providers
// (those still redirect; worca's own links go straight to the page). Comments aside, as in
// test/ui-new-run-copy.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('no user-visible "Settings › Models" / "Settings › Providers" and no #settings/models link is left (comments aside)', () => {
  const files = [
    'ui/public/index.html',
    ...readdirSync(new URL('../ui/public/', import.meta.url)).filter((f) => /\.(m?js)$/.test(f)).map((f) => `ui/public/${f}`),
    ...readdirSync(new URL('../src/core/ask/', import.meta.url)).filter((f) => f.endsWith('.mjs')).map((f) => `src/core/ask/${f}`),
  ];
  assert.ok(files.length > 40, `${files.length} files`);
  const bare = (src) => src.replace(/(^|[\s;,(){}[\]])\/\*[\s\S]*?\*\//g, '$1').replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^\s*|[;,(){}[\]]\s+)\/\/.*$/gm, '$1');
  const left = files.flatMap((f) => [...bare(read(f)).matchAll(/.{0,40}(?:Settings › (?:Models|Providers)\b|#settings\/(?:models|providers)\b).{0,20}/g)]
    .map((m) => `${f}: ${m[0].trim()}`));
  assert.deepEqual(left, []);
});
