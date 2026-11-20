// test/parity-visual.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodePNG } from '../assets/promo-kit/tools/analyze.mjs';
import { diffPng, MASKS, isPageContainer, idMasks, PIN_STYLE, steady, capture } from '../tools/parity/visual.mjs';

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

/** A page that records what is done to it, enough for go() and capture(). */
function fakePage() {
  const calls = [];
  const page = {
    calls,
    evaluate: async (fn) => { calls.push(`evaluate ${String(fn)}`); },
    addStyleTag: async ({ content }) => { calls.push(`style ${content}`); },
    mouse: { move: async (x, y) => { calls.push(`mouse ${x},${y}`); } },
    reload: async () => {}, waitForFunction: async () => {}, waitForSelector: async () => {}, waitForLoadState: async () => {},
    locator: (s) => s, getByText: (t) => t,
    screenshot: async ({ path }) => { calls.push(`shot ${path}`); },
  };
  return page;
}
const SETTLE = [/^style /, /^evaluate .*activeElement.*blur/, /^mouse 0,0$/, /^evaluate .*requestAnimationFrame.*requestAnimationFrame/s];

test('steady: pin style, then blur, then the mouse to (0,0), then two animation frames', async () => {
  assert.equal(PIN_STYLE, '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}');
  const page = fakePage();
  await steady(page);
  assert.equal(page.calls.length, 4);
  assert.equal(page.calls[0], `style ${PIN_STYLE}`);
  SETTLE.forEach((re, i) => assert.match(page.calls[i], re, page.calls[i]));
});

test('capture: every one of the 18 shots is taken right after steady', async (t) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true });
  t.after(() => { globalThis.fetch = realFetch; });
  const page = fakePage();
  const seed = { projectKey: 'k1', pipelineId: 'p1', runId: 'r1', threadId: 't1', heldRunId: 'r2' };
  const shots = await capture(page, { base: 'http://x.invalid' }, seed, '/tmp/parity-shots');
  assert.equal(shots.length, 18);
  const at = page.calls.flatMap((c, i) => (c.startsWith('shot ') ? [i] : []));
  assert.equal(at.length, 18);
  for (const i of at) SETTLE.forEach((re, k) => assert.match(page.calls[i - 4 + k], re, `before ${page.calls[i]}`));
});

test('steady in Chrome: transitions are off and the focused field is blurred', async (t) => {
  const { chromePath, openBrowser } = await import('../tools/parity/flows.mjs');
  try { chromePath(); } catch { t.skip('no Chrome (set CHROME_BIN)'); return; }
  const browser = await openBrowser();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<style>input{transition:outline 2s;border-radius:8px}input:focus{outline:4px solid red}</style><input autofocus>');
  await page.focus('input');
  await steady(page);
  const r = await page.evaluate(() => ({ active: document.activeElement.tagName,
    transition: getComputedStyle(document.querySelector('input')).transitionDuration,
    caret: getComputedStyle(document.querySelector('input')).caretColor }));
  assert.deepEqual(r, { active: 'BODY', transition: '0s', caret: 'rgba(0, 0, 0, 0)' });
});
