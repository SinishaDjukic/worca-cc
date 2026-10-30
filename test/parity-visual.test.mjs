// test/parity-visual.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodePNG } from '../assets/promo-kit/tools/analyze.mjs';
import { diffPng, MASKS, isPageContainer, idMasks } from '../tools/parity/visual.mjs';

const solid = (w, h, rgb) => encodePNG(w, h, new Uint8Array(w * h * 3).map((_, i) => rgb[i % 3]));

test('identical PNGs differ by 0 pixels', () => {
  assert.equal(diffPng(solid(4, 4, [10, 20, 30]), solid(4, 4, [10, 20, 30])).pixels, 0);
});
test('one channel off by 1 counts the pixel', () => {
  const a = solid(2, 1, [0, 0, 0]); const b = encodePNG(2, 1, new Uint8Array([0, 0, 0, 0, 0, 1]));
  assert.equal(diffPng(a, b).pixels, 1);
});
test('a size mismatch is a difference with both sizes, not a crash', () => {
  const r = diffPng(solid(2, 2, [0, 0, 0]), solid(3, 2, [0, 0, 0]));
  assert.equal(r.sizeMismatch, true);
  assert.equal(r.note, 'size 2×2 vs 3×2');
  assert.ok(r.pixels > 0);
});
test('masks name existing pages only and never a page container', () => {
  for (const [page, sels] of Object.entries(MASKS)) {
    assert.match(page, /^(chat-home|chat-thread|new-run|runs|live-run|history|settings|labs|stats)$/);
    for (const s of sels) assert.equal(isPageContainer(s), false, `${page}: ${s}`);
  }
  for (const s of ['body', 'main', '.view', 'section.view[data-view="runs"]', '[data-view]']) assert.equal(isPageContainer(s), true, s);
});
test('idMasks: one text mask per seeded id that is set', () => {
  const page = { getByText: (t) => `text:${t}` };
  assert.deepEqual(idMasks(page, { runId: 'r1', heldRunId: 'r2', pipelineId: 'p1', threadId: '', heldPipelineId: 'p2' }),
    ['text:r1', 'text:r2', 'text:p1', 'text:p2']);
});
