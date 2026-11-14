// test/design-kinds.test.mjs — Design P7 Task 1: the kind predicates and the build-mode board style.
// The board style's real behaviour in browsers is R8's probe (tools/spikes/design-board-r8/probe.mjs), run by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DECK_KINDS, isBoardKind, isDeckKind, isFilmKind, isDocKind, usesSlots, stagesKitEachDrive, kitFolder, kitScriptNames, thumbStillCss, BOARD_SCALE, boardCss } from '../src/core/design/kinds.mjs';

test('kinds', () => {
  assert.deepEqual(DECK_KINDS, ['presentation', 'pitch']);
  assert.deepEqual(['web', 'presentation', 'pitch', 'video', 'deck', 'nope', 'constructor'].map(kitFolder), ['web', 'deck', 'deck', 'video', null, null, null]);
  assert.deepEqual(['web', 'pitch', 'video'].map(isBoardKind), [false, true, true]);
  assert.equal(isDeckKind('video'), false); assert.equal(isFilmKind('video'), true);
  assert.deepEqual(kitScriptNames('web'), []);
  assert.deepEqual(kitScriptNames('pitch'), ['deck-stage.js', 'deck-pipeline.js', 'deck-enhance.js']);
  assert.deepEqual(kitScriptNames('video'), ['gsap.min.js', 'film.js']);
  // What the kit stager and the assembler lean on: presentation inlines the pitch scripts, anything else has no folder
  // and no scripts, and one caller's list is not the next caller's.
  assert.deepEqual(kitScriptNames('presentation'), kitScriptNames('pitch'));
  assert.deepEqual([null, undefined, '../design-kit/web', '__proto__'].map(kitFolder), [null, null, null, null]);
  assert.deepEqual([null, undefined, 'deck'].map(isBoardKind), [false, false, false]);
  assert.deepEqual(kitScriptNames('constructor'), []);
  const names = kitScriptNames('video'); names.push('x');
  assert.deepEqual(kitScriptNames('video'), ['gsap.min.js', 'film.js']);
});

test('a document: its own kit folder, no scripts, not a board, no slots, the kit staged on every drive', () => {
  const all = ['web', 'presentation', 'pitch', 'video', 'document', 'nope', undefined];
  assert.equal(kitFolder('document'), 'document');
  assert.deepEqual(kitScriptNames('document'), []);
  assert.equal(thumbStillCss('document'), '');
  assert.deepEqual(all.map(isDocKind), [false, false, false, false, true, false, false]);
  assert.deepEqual(all.map(isBoardKind), [false, true, true, true, false, false, false]);
  assert.deepEqual(all.map(usesSlots), [true, false, false, false, false, false, false]);
  assert.deepEqual(all.map(stagesKitEachDrive), [false, true, true, true, true, false, false]);
});

test('boardCss: fixed tracks, the slide box kept, every step and reveal shown, both scales', () => {
  assert.equal(BOARD_SCALE, 'transform');
  const t = boardCss('transform'); const z = boardCss('zoom');
  for (const css of [t, z]) {
    for (const s of ['[data-worca-board]{display:grid!important', 'repeat(var(--worca-board-cols,3),calc(1920px*var(--worca-board-s,.178)))', 'grid-auto-rows:calc(1080px*var(--worca-board-s,.178))',
      'width:1920px!important', 'height:1080px!important', 'overflow:hidden!important', '[data-worca-board] [data-step]', '[data-worca-board] [data-deck-caption]{display:none!important}', '[data-worca-board]>[data-worca-slot]{background:#0B0D11}', 'var(--worca-board-bg,#101217)', 'visibility:visible!important']) assert.ok(css.includes(s), s);
  }
  assert.ok(t.includes('transform:scale(var(--worca-board-s,.178))!important;transform-origin:0 0!important'));
  assert.ok(z.includes('zoom:var(--worca-board-s,.178)!important'));
  assert.equal(boardCss(), t);
  assert.throws(() => boardCss('scale'), TypeError);
});
