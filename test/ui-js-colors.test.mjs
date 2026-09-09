// test/ui-js-colors.test.mjs — no colour literal in the browser code either
// (spec §4.2): chip colours are token references, the one canvas painter reads
// its ink from the theme. thinking-orb.mjs keeps '25,25,27' as the no-style
// fallback: an r,g,b triplet, not a hex, so it is not a hit and no allowlist exists
// (at 5a22ca47 the only hits are app.js:867 and :15067, both fixed by Task 4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const dir = fileURLToPath(new URL('../ui/public', import.meta.url));
const files = ['app.js', ...readdirSync(dir).filter((f) => f.endsWith('.mjs')), ...readdirSync(join(dir, 'graph')).filter((f) => f.endsWith('.mjs')).map((f) => `graph/${f}`)];

test('browser JS carries no quoted hex colour and no rgb()/rgba() with numeric channels', () => {
  const offenders = [];
  for (const f of files) {
    // `//` after a `:` is a URL inside a string ('https://…'), not a comment: keep the rest of that line.
    const src = readFileSync(join(dir, f), 'utf8').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of src.matchAll(/['"`]#[0-9a-fA-F]{3,8}['"`]|rgba?\(\s*\d/g)) offenders.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(offenders, []);
});

test('COMPOSER_COLORS maps every family to its token', () => {
  const src = readFileSync(join(dir, 'app.js'), 'utf8');
  const m = src.match(/const COMPOSER_COLORS = \{([^}]*)\}/);
  assert.ok(m, 'COMPOSER_COLORS present');
  for (const fam of ['green', 'peach', 'red', 'blue', 'violet', 'amber']) assert.ok(m[1].includes(`${fam}: 'var(--${fam})'`), fam);
  assert.ok(src.includes("COMPOSER_COLORS[chip.color] || 'var(--ink-3)'"), 'the unknown-colour fallback is a token too');
});
