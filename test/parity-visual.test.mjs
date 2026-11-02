// test/parity-visual.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('newPage: a pinned page (the shots) gets reduced motion, a seeded Math.random and frozen intervals; a flow page reduced motion only', async () => {
  const { newPage, SEEDED_RANDOM, FROZEN_INTERVALS } = await import('../tools/parity/flows.mjs');
  const crawl = await import('../tools/parity/crawl.mjs');
  assert.equal(crawl.SEEDED_RANDOM, SEEDED_RANDOM);              // one pin, shared by the crawler and the shots
  assert.equal(crawl.FROZEN_INTERVALS, FROZEN_INTERVALS);
  const made = [];
  const browser = { newContext: async (opts) => { const c = { opts, scripts: [] }; made.push(c);
    c.addInitScript = async (s) => { c.scripts.push(s); };
    c.newPage = async () => ({ on() {}, goto: async () => {} }); return c; } };
  await newPage(browser, { port: 1 }, { pin: true });
  await newPage(browser, { port: 1 });
  assert.equal(made[0].opts.reducedMotion, 'reduce');
  assert.deepEqual(made[0].scripts, [SEEDED_RANDOM, FROZEN_INTERVALS]);
  assert.equal(made[1].opts.reducedMotion, 'reduce');
  assert.deepEqual(made[1].scripts, []);                          // the flows wait on real polling (chat home's runs tick)
});

test('every visual mask has a reason row in docs/parity-harness.md, and every row is a live mask', () => {
  const doc = readFileSync(new URL('../docs/parity-harness.md', import.meta.url), 'utf8');
  const rows = [...doc.matchAll(/^\| `([\w-]+)` \| `([^`]+)` \| (.+?) \|$/gm)].map(([, page, sel, why]) => ({ page, sel, why: why.trim() }));
  const json = Object.entries(JSON.parse(readFileSync(new URL('../tools/parity/visual-masks.json', import.meta.url), 'utf8'))).flatMap(([page, sels]) => sels.map((sel) => ({ page, sel })));
  assert.deepEqual(rows.map(({ page, sel }) => `${page} ${sel}`).sort(), json.map(({ page, sel }) => `${page} ${sel}`).sort());
  for (const r of rows) assert.ok(r.why.length > 10, `${r.page} ${r.sel}`);
});
