// test/ui-palette-layout.test.mjs — palette containment rules from the web-UI
// review: F3 (a long unbroken description painted straight through the card
// border and across its neighbours) and F4 (the palette's 20px top padding sat
// ABOVE the sticky header row, so cards scrolled visibly through that strip).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Comments stripped first: a /* … */ block above a rule would otherwise be
// captured as part of its selector list and break the exact-match below.
const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ');

// Every rule body whose selector LIST contains `selector` exactly (see
// test/ui-stage-row-blurb.test.mjs for why this beats a first-match helper).
function rules(selector) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const sels = m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' '));
    if (sels.includes(selector)) out.push(m[2]);
  }
  return out;
}
const body = (selector) => rules(selector).join(';');

// ---------- F3: nothing escapes the card ----------

test('the palette card clips its own content so a long word cannot paint over its neighbours', () => {
  const card = body('.agent-pill');
  assert.ok(card, '.agent-pill rule must exist');
  assert.match(card, /overflow:\s*hidden/, 'card is the last line of defence against overflowing children');
  assert.match(card, /min-width:\s*0/, 'grid item must be allowed to shrink below its min-content width');
});

test('the card description stretches to the card width and breaks unbreakable tokens', () => {
  const pdesc = body('.agent-pill .pdesc');
  assert.ok(pdesc, '.agent-pill .pdesc rule must exist');
  assert.match(pdesc, /align-self:\s*stretch/, 'flex-start would shrink-to-fit the full 100-char string');
  assert.match(pdesc, /max-width:\s*100%/, 'never wider than the card content box');
  assert.match(pdesc, /overflow-wrap:\s*anywhere/, 'a URL / path / 100xa must wrap, not overflow');
  assert.match(pdesc, /-webkit-line-clamp:\s*2/, 'the 2-line clamp still holds');
});

test('the card header row is bounded the same way (long display names)', () => {
  const phead = body('.agent-pill .phead');
  assert.ok(phead, '.agent-pill .phead rule must exist');
  assert.match(phead, /max-width:\s*100%/, 'header cannot exceed the card');
  assert.match(phead, /overflow-wrap:\s*anywhere/, 'a long unbroken name wraps inside the card');
});

// ---------- 3-line text budget: name 2 lines max, description fills the rest ----------

test('the name clamps at 2 lines and breaks unbreakable tokens', () => {
  const pname = body('.agent-pill .pname');
  assert.ok(pname, '.agent-pill .pname rule must exist');
  assert.match(pname, /-webkit-line-clamp:\s*2/, 'names never exceed 2 lines');
  assert.match(pname, /overflow:\s*hidden/, 'clamp needs overflow hidden to cut line 3');
  assert.match(pname, /overflow-wrap:\s*anywhere/, 'a long unbroken name wraps, not overflows');
  assert.match(pname, /min-width:\s*0/, 'flex item must be allowed to shrink');
});

test('a 2-line name (.name-2l) drops the description to 1 line', () => {
  const one = body('.agent-pill.name-2l .pdesc');
  assert.ok(one, '.agent-pill.name-2l .pdesc rule must exist');
  assert.match(one, /-webkit-line-clamp:\s*1/, 'wrapped name leaves 1 line for the description');
});

// ---------- F4: no see-through band above the pinned header ----------

test('the palette scroll container has no top padding for sticky to fight', () => {
  const pal = body('.palette');
  assert.ok(pal, '.palette rule must exist');
  assert.match(pal, /padding:\s*0 24px 20px/, 'top padding moves into the sticky header row itself');
  assert.match(pal, /overflow-y:\s*auto/, 'palette is still the scroll container');
  assert.match(pal, /max-height:\s*320px/, 'scale cap unchanged');
});

test('the pinned header row paints the reclaimed top band itself', () => {
  const label = body('.palette .p-label');
  assert.ok(label, '.palette .p-label rule must exist');
  assert.match(label, /position:\s*sticky/, 'header stays pinned');
  assert.match(label, /top:\s*0/, 'pins flush against the container top');
  assert.match(label, /padding-top:\s*20px/, 're-applies the inset .palette no longer provides');
  assert.match(label, /background:\s*var\(--panel\)/, 'opaque, so scrolled cards never show through');
});
