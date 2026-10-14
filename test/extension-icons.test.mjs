// test/extension-icons.test.mjs — the committed extension icons are real PNGs of the size their name says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ICON_SIZES, pngSize } from '../tools/build-extension.mjs';

test('extension/icons/worca-<n>.png is n×n for every manifest size', () => {
  for (const s of ICON_SIZES) assert.deepEqual(pngSize(readFileSync(new URL(`../extension/icons/worca-${s}.png`, import.meta.url))), { width: s, height: s }, `worca-${s}.png`);
});
