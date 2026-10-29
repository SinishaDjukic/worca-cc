// deck-enhance.js boots its own notion of the active slide.
//
// `initAll()` hardcoded `activate(0)` and `currentIdx = 0`, and the `message`
// listener that syncs with deck-stage is registered AFTER that — by which point
// deck-stage (which the contract loads FIRST) has already broadcast its initial
// slideIndexChanged. Reload on `deck.html#7` — the hash deck-stage itself stamps
// on every nav — and the stage shows slide 7 while deck-enhance believes slide 1
// is active: `.is-active` lands on the wrong section, and ArrowRight
// stopImmediatePropagation()s to reveal [data-step] elements on an invisible
// slide, so the deck looks frozen for maxStep keypresses.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { checkRows } from './helpers/rows.mjs';

const SRC = readFileSync(fileURLToPath(new URL('../assets/deck-kit/deck-enhance.js', import.meta.url)), 'utf8');
// Every window this file opens; closing them stops their timers, which otherwise hold the process seconds after the last test.
const windows = [];
after(() => { for (const w of windows) w.close(); });

/** A mounted stage: seven slides, with deck-stage's own active marker on one. */
function boot({ hash = '', activeIndex = null, steps = 0, stepsOn = 0 } = {}) {
  const sections = Array.from({ length: 7 }, (_, i) => {
    const active = i === activeIndex ? ' data-deck-active=""' : '';
    // `stepsOn` defaults to slide 1 because the boot tests below deliberately put
    // the reveals on a slide that is NOT showing; the rail-mutation tests need
    // them on the slide that is.
    const reveals = i === stepsOn && steps
      ? Array.from({ length: steps }, (_, n) => `<p data-step="${n + 1}">r${n + 1}</p>`).join('')
      : '';
    return `<section data-label="0${i + 1}"${active}><h1>S${i + 1}</h1>${reveals}</section>`;
  }).join('');
  const dom = new JSDOM(
    `<!doctype html><body><deck-stage width="1920" height="1080">${sections}</deck-stage></body>`,
    { url: `http://localhost/deck.html${hash}`, runScripts: 'outside-only' },
  );
  windows.push(dom.window);
  dom.window.eval(SRC);
  return dom.window;
}

/** deck-enhance defers its boot (DOMContentLoaded, then a 50ms poll), so wait
 *  for it to actually wire up before asserting. */
async function booted(opts) {
  const win = boot(opts);
  for (let i = 0; i < 40 && !win.__deckEnhanceRan; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(win.__deckEnhanceRan, true, 'deck-enhance never booted in the harness');
  return win;
}

const activeLabels = (win) => [...win.document.querySelectorAll('section.is-active')]
  .map((s) => s.getAttribute('data-label'));

test('boot picks the showing slide: active marker, then hash, else slide 1 (incl. out-of-range hash)', async () => {
  // [row name, boot opts, expected active labels, assertion message]
  const cases = [
    ['boot follows deck-stage\'s own active marker, not slide 1', { hash: '#7', activeIndex: 6 }, ['07'],
      'the stage is on slide 7, so deck-enhance must be too'],
    ['with no marker yet, boot follows the URL hash deck-stage restores from', { hash: '#4' }, ['04']],
    ['a bare load with no hash and no marker still starts on slide 1', undefined, ['01']],
    ['an out-of-range hash falls back to slide 1 rather than nothing', { hash: '#99' }, ['01']],
  ];
  await checkRows(cases.map(([name, opts, want, message]) => ({ name, run: async () => {
    const win = await booted(opts);
    assert.deepEqual(activeLabels(win), want, message);
  } })));
});

test('the step cursor starts on the slide actually showing, not on slide 1', async () => {
  // Slide 1 carries the reveals; the stage is on slide 7. An ArrowRight must
  // advance the SLIDE, not silently reveal steps on the hidden first one.
  const win = await booted({ hash: '#7', activeIndex: 6, steps: 3 });
  const ev = new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
  win.dispatchEvent(ev);
  const revealed = win.document.querySelectorAll('section[data-label="01"] .step-visible').length;
  assert.equal(revealed, 0, 'no step was revealed on the slide nobody can see');
});

// deck-stage re-broadcasts slideIndexChanged with the UNCHANGED index after a
// rail mutation (_toggleSkip, and _deleteSlide/_moveSlide via
// _applyIndex({broadcast:true})), so the popup's thumbnails re-pick. This handler
// treated every message as a slide change and unconditionally zeroed the visible
// slide's [data-step] reveals — so right-clicking a thumbnail and choosing Skip on
// some OTHER slide silently rewound the slide you were presenting.
//
// A reset is the deliberate exception: deck-stage re-applies with force so the
// reveals DO zero, and it says so by marking the message.
test('a re-broadcast of the same slide index does not rewind its reveals', async () => {
  const win = await booted({ activeIndex: 0, steps: 3 });
  const slide = win.document.querySelectorAll('section')[0];

  win.postMessage({ slideIndexChanged: 0, deckTotal: 7 }, '*');
  await new Promise((r) => setTimeout(r, 10));
  // Reveal two steps, then let an unrelated rail mutation re-broadcast slide 0.
  win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  const revealed = slide.querySelectorAll('[data-step].step-visible').length;
  assert.ok(revealed > 0, `steps revealed to begin with: ${revealed}`);

  win.postMessage({ slideIndexChanged: 0, deckTotal: 7 }, '*');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(slide.querySelectorAll('[data-step].step-visible').length, revealed,
    'an unrelated rail mutation leaves the reveals where they were');
});

test('rail deletes keep the presented slide reveals; the heir of the index starts clean', async () => {
  await checkRows([
    // THE INDEX IS NOT A STABLE NAME FOR A SLIDE. _deleteSlide and _moveSlide
    // deliberately RENUMBER _index so the same section stays on screen across a rail
    // mutation, and the postMessage payload carries no `reason` — so an
    // index-equality test read "5 -> 4" as a navigation and blanked every built-up
    // reveal of the slide being presented the moment the user deleted or reordered
    // some OTHER thumbnail. Mid-presentation. Comparing the slide ELEMENT gets every
    // case right at once, including the one an index test cannot get right at all:
    // when the presented slide is itself deleted, a DIFFERENT section takes its index
    // and the reveals must zero (the row below this one).
    { name: 'deleting another slide leaves the presented slide\'s reveals intact', run: async () => {
      const win = await booted({ activeIndex: 4, steps: 3, stepsOn: 4 });
      const sections = [...win.document.querySelectorAll('section')];
      const presented = sections[4];
      win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await new Promise((r) => setTimeout(r, 10));
      const revealed = presented.querySelectorAll('[data-step].step-visible').length;
      assert.ok(revealed > 0, `steps revealed to begin with: ${revealed}`);

      // _deleteSlide(1), exactly as deck-stage performs it: the section leaves the
      // DOM and _index goes 4 -> 3 so the same content stays on screen.
      sections[1].remove();
      win.postMessage({ slideIndexChanged: 3, deckTotal: 6, deckSkipped: [] }, '*');
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(presented.querySelectorAll('[data-step].step-visible').length, revealed,
        'deleting an unrelated thumbnail rewound the slide being presented');
    } },
    { name: 'the slide that inherits the index starts from nothing', run: async () => {
      const win = await booted({ activeIndex: 4, steps: 3, stepsOn: 4 });
      const sections = [...win.document.querySelectorAll('section')];
      const heir = sections[5];
      heir.innerHTML += '<p data-step="1" class="step-visible">stale</p>';

      // _deleteSlide(4) on the slide being presented: the index does NOT move, so
      // slide 6 slides into it and is now on screen — different content, and its
      // reveals must not be inherited from whatever state it was left in.
      sections[4].remove();
      win.postMessage({ slideIndexChanged: 4, deckTotal: 6, deckSkipped: [] }, '*');
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(heir.querySelectorAll('[data-step].step-visible').length, 0,
        'the slide that took the index kept a stale reveal');
    } },
  ]);
});

// This listener is on `window` with capture:true and every branch ends in
// stopImmediatePropagation(), so deck-stage's per-thumbnail keydown handler — its
// header documents "↑/↓ with a thumbnail focused to step between slides" — was
// unreachable whenever deck-enhance.js is loaded, i.e. always in deck.html.
// Worse than dead: ArrowDown fell through to stage.next(), which advances from
// _index rather than from the focused thumb and never moves focus, so a second
// press repeated the same jump and walking the rail by keyboard was impossible.
test('a focused rail thumbnail keeps ArrowUp/ArrowDown for itself', async () => {
  const win = await booted({ activeIndex: 0, steps: 3 });
  const slide = win.document.querySelectorAll('section')[0];

  // Off the rail, deck-enhance owns the key: it reveals a step and consumes it.
  const loose = win.document.createElement('div');
  win.document.body.appendChild(loose);
  const consumed = loose.dispatchEvent(
    new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true, composed: true }));
  assert.equal(consumed, false, 'deck-enhance no longer owns ArrowDown off the rail');
  const revealed = slide.querySelectorAll('[data-step].step-visible').length;
  assert.ok(revealed > 0, 'ArrowDown off the rail should have revealed a step');

  // On a thumbnail it passes straight through — unconsumed, and with the reveals
  // of the slide on screen left exactly where they were.
  const thumb = win.document.createElement('div');
  thumb.className = 'thumb';
  win.document.body.appendChild(thumb);
  const passed = thumb.dispatchEvent(
    new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true, composed: true }));
  assert.equal(passed, true, 'the rail\'s own navigation key is still swallowed before it arrives');
  assert.equal(slide.querySelectorAll('[data-step].step-visible').length, revealed,
    'walking the rail must not also step the reveals of the slide on screen');
});
