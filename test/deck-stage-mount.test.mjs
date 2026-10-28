// test/deck-stage-mount.test.mjs — where <deck-stage> lands when it mounts.
//
// ROUND 3, F5. The forward-then-back skip search lived only in _go, whose own
// comment enumerates "every other entry point" — but mount and deep-link restore
// are not among them: _onSlotChange calls _restoreIndex() and then _applyIndex()
// directly. A deck whose first slide is skipped therefore OPENED on that slide:
// dimmed in the rail, display:none at print, absent from the PDF, and prev()
// cannot leave it. Reachable with no exotic setup — skip slide 1 from the rail and
// reload (the `#1` that _applyIndex itself stamps restores index 0).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { checkRows } from './helpers/rows.mjs';

const SRC = readFileSync(fileURLToPath(new URL('../assets/deck-kit/deck-stage.js', import.meta.url)), 'utf8');
// Every window this file opens; closing them stops their timers, which otherwise hold the process seconds after the last test.
const windows = [];
after(() => { for (const w of windows) w.close(); });

/** Mount six slides, `skips` of them skipped, and wait for the stage to settle. */
async function mount(skips, hash = '') {
  const sections = Array.from({ length: 6 }, (_, i) =>
    `<section data-label="0${i + 1}"${skips.includes(i) ? ' data-deck-skip=""' : ''}>S${i + 1}</section>`).join('');
  const dom = new JSDOM(
    `<!doctype html><body><deck-stage width="1920" height="1080">${sections}</deck-stage></body>`,
    { url: `http://localhost/deck.html${hash}`, runScripts: 'outside-only', pretendToBeVisual: true },
  );
  // The rail's lazy-clone machinery; neither exists in jsdom and neither is what
  // this file is about.
  dom.window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  windows.push(dom.window);
  dom.window.eval(SRC);
  // slotchange is async, so the first _applyIndex has not run yet.
  for (let i = 0; i < 40; i++) {
    if (dom.window.document.querySelector('section[data-deck-active]')) break;
    await new Promise((r) => setTimeout(r, 5));
  }
  const active = dom.window.document.querySelector('section[data-deck-active]');
  assert.ok(active, 'the stage never marked an active slide');
  return active.getAttribute('data-label');
}

test('mount and deep links land on a live slide (forward, then back; all-skipped clamps)', async () => {
  await checkRows([
    { name: 'mount lands on the first live slide, never on a skipped one', run: async () => {
      assert.equal(await mount([]), '01', 'nothing skipped: slide 1, as before');
      assert.equal(await mount([0]), '02', 'slide 1 skipped');
      assert.equal(await mount([0, 1, 4]), '03', 'a run of skipped slides is walked past');
    } },
    { name: 'a deep link onto a skipped slide moves to a live one', run: async () => {
      assert.equal(await mount([], '#4'), '04', 'an ordinary deep link is untouched');
      assert.equal(await mount([0], '#1'), '02', 'forward off a skipped slide');
      assert.equal(await mount([4], '#5'), '06', 'forward again');
      // Nothing live after it → search BACK, so a deck ending in skipped slides still
      // opens somewhere you can present from.
      assert.equal(await mount([5], '#6'), '05', 'back when the tail is skipped');
    } },
    { name: 'a deck with every slide skipped keeps the clamp, rather than nowhere', run: async () => {
      assert.equal(await mount([0, 1, 2, 3, 4, 5]), '01');
    } },
  ]);
});

/** Mount, then run `mutate` against the live stage and report where it lands. */
async function afterMutation(skips, mutate) {
  const sections = Array.from({ length: 4 }, (_, i) =>
    `<section data-label="0${i + 1}"${skips.includes(i) ? ' data-deck-skip=""' : ''}>S${i + 1}</section>`).join('');
  const dom = new JSDOM(
    `<!doctype html><body><deck-stage width="1920" height="1080">${sections}</deck-stage></body>`,
    { url: 'http://localhost/deck.html', runScripts: 'outside-only', pretendToBeVisual: true },
  );
  dom.window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  windows.push(dom.window);
  dom.window.eval(SRC);
  for (let i = 0; i < 40; i++) {
    if (dom.window.document.querySelector('section[data-deck-active]')) break;
    await new Promise((r) => setTimeout(r, 5));
  }
  mutate(dom.window.document.querySelector('deck-stage'));
  await new Promise((r) => setTimeout(r, 10));
  const active = dom.window.document.querySelector('section[data-deck-active]');
  assert.ok(active, 'the stage lost its active slide across the mutation');
  return active.getAttribute('data-label');
}

// ROUND 4, R4-3. _deleteSlide adjusts _index arithmetically so the same CONTENT
// stays on screen, then calls _applyIndex directly — never _liveIndex. The
// arithmetic cannot know the slide it lands on is skipped, so deleting slide 1 of
// `01, 02[skip], 03` parked the presenter on 02.
test('deleting a slide never parks the stage on a skipped one', async () => {
  assert.equal(await afterMutation([], (s) => s._deleteSlide(0)), '02',
    'nothing skipped: the next slide, as before');
  assert.equal(await afterMutation([1], (s) => s._deleteSlide(0)), '03',
    'the skipped neighbour is walked past');
  // Delete the slide being presented when everything after it is skipped: the
  // search runs BACK, exactly as it does for a deep link onto the tail.
  assert.equal(await afterMutation([2, 3], (s) => { s.goTo(1); s._deleteSlide(1); }), '01');
});
