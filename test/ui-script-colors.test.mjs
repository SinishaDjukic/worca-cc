// test/ui-script-colors.test.mjs — the six script-only colour families exist as tokens and as canvas head rules (S10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'public', 'style.css'), 'utf8');
const FAMILIES = ['teal', 'pink', 'indigo', 'lime', 'cocoa', 'slate'];

test('each family has a solid, a bg and an ink token, the bg and ink in light-dark()', () => {
  for (const f of FAMILIES) {
    assert.match(css, new RegExp(`--${f}:#[0-9A-Fa-f]{6};`), `--${f}`);
    assert.match(css, new RegExp(`--${f}-bg:light-dark\\(#[0-9A-Fa-f]{6},#[0-9A-Fa-f]{6}\\);`), `--${f}-bg`);
    assert.match(css, new RegExp(`--${f}-ink:light-dark\\(#[0-9A-Fa-f]{6},#[0-9A-Fa-f]{6}\\);`), `--${f}-ink`);
  }
});

test('each family colours a canvas head beside the six agent families', () => {
  for (const f of [...FAMILIES, 'green', 'amber']) {
    assert.match(css, new RegExp(`\\.gv-world \\.h-${f}\\{background:var\\(--${f}-bg\\);color:var\\(--(?:h-)?${f}-ink\\);\\}`), f);
  }
});
