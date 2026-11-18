// test/design-picture-rules.test.mjs — how a Design build treats a picture of the product (src/core/design/prompts.mjs
// and the kit CONTRACTs). A screenshot is shown whole inside its box with room around it, never zoomed in or cut by its
// frame; the lead makes each picture one whole thing, looks at it before a brief names it, and gives its pixel size so
// the builder can shape the box; the lead's last pass sends back a section that cuts or cramps one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { builderSystemPrompt, integratePrompt, leadSystemPrompt } from '../src/core/design/prompts.mjs';

const KINDS = ['web', 'presentation', 'pitch', 'video'];
const kit = (dir) => readFileSync(new URL(`../assets/design-kit/${dir}/CONTRACT.md`, import.meta.url), 'utf8');

const WHOLE = 'A screenshot, or any other picture of the product, is shown whole.';
const ROOM = 'A picture has room: clear space on every side between it, or the frame drawn around it, and the edges of its card, section or slide.';

test('every kind\'s lead and builders show a picture whole, inside its box, with room around it', () => {
  for (const kind of KINDS) {
    for (const [who, s] of [['lead', leadSystemPrompt({ kind })], ['builder', builderSystemPrompt({ kind })]]) {
      const at = `${kind} ${who}`;
      assert.equal(s.split(WHOLE).length, 2, `${at}: shown whole, once`);
      assert.equal(s.split(ROOM).length, 2, `${at}: room, once`);
      for (const re of [/Its box has the picture's own proportions \(`aspect-ratio` from its pixel size\)/, /`object-fit: contain`, never `cover`/,
        /No frame, mask, zoom or `overflow: hidden` cuts into it, and none of it lies outside its box\./, /Where a picture moves, it comes to rest whole\./,
        /To point at one part, ring it on the whole picture, or show a picture of that part alone\./, /It never touches an edge and never runs past one\./]) assert.match(s, re, at);
      const craft = s.slice(s.indexOf('\nCraft:\n'));
      assert.ok(craft.includes(WHOLE) && craft.includes(ROOM), `${at}: both are Craft rules`);
    }
  }
});

test('the lead makes each picture one whole thing with space around it, and looks at it before a brief names it', () => {
  for (const kind of KINDS) {
    const s = leadSystemPrompt({ kind });
    for (const re of [/A picture is one whole thing: a whole screen, or one whole part of a screen \(a card, a panel, a dialog, a row\)/,
      /with a little of the page's own ground around it on every side/, /Never one that cuts through text, a control or a card\./,
      /shoot that element \(`page\.screenshot\(\{ clip \}\)`, the element's `boundingBox\(\)` plus about 24px a side\)/,
      /or cut a screenshot on the part's own edges plus that space/,
      /Read every picture you copied, cut or shot before a brief names it\./, /a picture you have not looked at is not used/]) assert.match(s, re, kind);
    assert.ok(s.indexOf('A picture is one whole thing') > s.indexOf('The project (when your task has a Project line):'), `${kind}: among the project rules`);
    assert.doesNotMatch(builderSystemPrompt({ kind }), /boundingBox|A picture is one whole thing/, `${kind}: the lead makes the pictures, never a builder`);
  }
});

test('a brief gives each picture\'s pixel size, and the lead plans the place to the picture\'s shape', () => {
  for (const kind of KINDS) {
    const s = leadSystemPrompt({ kind });
    assert.match(s, /Beside each picture's path a `brief` gives its pixel size \(`assets\/project\/run\.png`, 2190×1516\)/, kind);
    assert.match(s, /Plan the place to the picture's shape, a wide place for a wide picture, so it is shown whole and large enough to read\./, kind);
    assert.match(s, /Never plan a pose that leaves part of a picture outside its frame\./, kind);
    const design = s.slice(s.indexOf('\nDesign:\n'), s.indexOf('\nCraft:\n'));
    assert.match(design, /gives its pixel size/, `${kind}: a Design rule`);
  }
});

test('the lead\'s last pass sends back a section whose picture is cut or cramped', () => {
  const p = integratePrompt({ findings: [], integrationFile: '/w/integration.json' });
  assert.match(p, /worst first: a product shown as a stand-in, a picture cut by its frame or left with no room around it, filler badges and labels/);
});

test('each kit CONTRACT states the two picture rules', () => {
  for (const dir of ['web', 'deck', 'video']) {
    const c = kit(dir);
    assert.ok(c.includes(WHOLE), `${dir}: shown whole`);
    assert.ok(c.includes('`object-fit: contain`, never `cover`'), `${dir}: contain`);
    assert.ok(c.includes('Where a picture moves, it comes to rest whole.'), `${dir}: rest`);
    assert.ok(c.includes(ROOM), `${dir}: room`);
  }
});
