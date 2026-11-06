import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../ui/public/assets/worca-levels');
const FILES = ['calf', 'swimmer', 'hunter', 'pod-leader'].map((n) => `${n}.svg`);

function load(file) {
  const path = resolve(DIR, file);
  assert.ok(existsSync(path), `${file} exists`);
  const src = readFileSync(path, 'utf8');
  assert.ok(src.trim().length > 0, `${file} is non-empty`);
  return src;
}

function ids(src) {
  return [...src.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
}

for (const file of FILES) {
  test(`${file}: root <svg> with a viewBox and no <text>`, () => {
    const src = load(file).replace(/<\?xml[^>]*\?>/, '').replace(/<!--[\s\S]*?-->/g, '').trim();
    assert.match(src, /^<svg\b[^>]*\sviewBox="[^"]+"/, 'root element is <svg> with viewBox');
    assert.match(src, /<\/svg>\s*$/, 'closes with </svg>');
    assert.doesNotMatch(src, /<text[\s>]/, 'no <text> element');
  });

  test(`${file}: ids are unique within the file`, () => {
    const list = ids(load(file));
    assert.equal(new Set(list).size, list.length, `duplicate ids in ${file}`);
  });
}

test('ids are unique across the four files', () => {
  const all = FILES.flatMap((f) => ids(load(f)));
  assert.equal(new Set(all).size, all.length, 'ids clash across files');
});
