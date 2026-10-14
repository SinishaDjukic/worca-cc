// test/extension-build.test.mjs — production builds succeed and carry no E2E hooks; the test build keeps them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOne } from '../tools/build-extension.mjs';

test('production builds (chrome, edge, firefox) contain no test hooks', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'wx-build-'));
  try {
    for (const b of ['chrome', 'edge', 'firefox']) {
      const { out } = await buildOne(b, { dist });   // buildOne itself throws on a leaked hook
      for (const f of ['background.js', 'content.js', 'sidebar.js']) {
        const js = readFileSync(join(out, f), 'utf8');
        assert.doesNotMatch(js, /__worcaTest|__worcaSidebarTest|__WORCA_EXT_TEST__/, `${b}/${f}`);
        assert.doesNotMatch(js, /vad-web|onnxruntime|ricky0123/, `${b}/${f}: no voice runtime in the extension`);
      }
    }
  } finally { rmSync(dist, { recursive: true, force: true }); }
});

test('the --test build keeps the hooks (so the check above is not vacuous)', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'wx-build-'));
  try {
    const { out } = await buildOne('chrome', { test: true, dist });
    assert.match(readFileSync(join(out, 'background.js'), 'utf8'), /__worcaTest/);
    assert.match(readFileSync(join(out, 'sidebar.js'), 'utf8'), /__worcaSidebarTest/);
  } finally { rmSync(dist, { recursive: true, force: true }); }
});

// Chrome refuses a content script holding a Unicode noncharacter (U+FFFF, U+FDD0–U+FDEF, …) with "It isn't UTF-8
// encoded", so injection fails silently and Pinpoint and the capture never mount. esbuild copies a raw one from a
// regex source as is: a source must spell it as an escape (\uffff), never the character itself.
const NONCHAR = /[\uFDD0-\uFDEF\uFFFE\uFFFF]/;
test('every bundle loads in Chrome: no Unicode noncharacters (the content script would not inject)', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'wx-build-'));
  try {
    for (const [b, opts] of [['chrome', {}], ['firefox', {}], ['chrome', { test: true }]]) {
      const { out } = await buildOne(b, { ...opts, dist });
      for (const f of ['background.js', 'content.js', 'sidebar.js']) {
        assert.doesNotMatch(readFileSync(join(out, f), 'utf8'), NONCHAR, `${b}${opts.test ? ' (test)' : ''}/${f}`);
      }
    }
  } finally { rmSync(dist, { recursive: true, force: true }); }
});
