// The five Worca Levels bird avatars: static SVGs derived from the mascot design template.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRows } from './helpers/rows.mjs';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../ui/public/assets/worca-levels');
const HUES = { curious: 235, runner: 195, hooked: 295, worcaholic: 65, council: 150 };
const KEYS = Object.keys(HUES);

const read = (key) => readFileSync(resolve(DIR, `${key}.svg`), 'utf8');
const ids = (src) => [...src.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

test('each bird SVG is a self-contained 100x100 avatar with a W mark', async () => {
  await checkRows(KEYS.map((key) => ({
    name: key,
    run: () => {
      assert.ok(existsSync(resolve(DIR, `${key}.svg`)), `${key}.svg exists`);
      const src = read(key);
      assert.match(src, /^<svg\b[^>]*\sviewBox="0 0 100 100"/, 'root <svg> with the 100x100 viewBox');
      assert.match(src, /<\/svg>\s*$/, 'closes with </svg>');
      assert.ok(src.includes(`<circle cx="50" cy="50" r="50" fill="oklch(0.92 0.04 ${HUES[key]})"`), 'background circle uses the level hue');
      assert.match(src, /<text\b[^>]*>W<\/text>/, 'has a W <text>');
      assert.doesNotMatch(src, /display="none"/, 'no hidden groups');
      assert.doesNotMatch(src, /\{\{/, 'no unresolved template placeholders');
      assert.doesNotMatch(src, /<script/i, 'no <script>');
      assert.doesNotMatch(src.match(/^<svg\b[^>]*>/)[0], /\s(width|height|aria-label|style)=/, 'root <svg> has no templated width/height/aria-label/style');
    },
  })));
});

test('gradient ids are suffixed with the level key and unique across all five files', async () => {
  await checkRows([
    ...KEYS.map((key) => ({
      name: `${key} ids end with the key`,
      run: () => {
        const list = ids(read(key));
        assert.deepEqual(list, [`promoShine-${key}`, `promoNose-${key}`]);
        for (const ref of read(key).matchAll(/url\(#([^)]+)\)/g)) assert.ok(list.includes(ref[1]), `${ref[1]} is defined in ${key}.svg`);
      },
    })),
    { name: 'no id repeats across the five files', run: () => {
      const all = KEYS.flatMap((k) => ids(read(k)));
      assert.equal(new Set(all).size, all.length);
    } },
  ]);
});

test('hooked wears the flat cap; the directory holds exactly the five birds', async () => {
  await checkRows([
    { name: 'hooked has the flat-cap path', run: () => assert.ok(read('hooked').includes('M22 42 C21 28')) },
    { name: 'no leftover avatar files', run: () => assert.deepEqual(readdirSync(DIR).sort(), KEYS.map((k) => `${k}.svg`).sort()) },
  ]);
});
