// test/workflow-test-plain-text.test.mjs — board 59 D (approved 2026-11-21): Check the checker's excerpts are shown as plain text, with
// markdown marks removed and line breaks kept. Display only: the stored excerpt and the proof search are unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plainText } from '../src/shared/workflow-tests/plain-text.mjs';

test("D: board 59's excerpt: the stars and the bullet mark go, the line break stays", () => {
  assert.equal(plainText('**Contract**: Create a content outline\n- **Hook / Problem** (2–3 sentences): Q3 data (38% of tickets)'),
    'Contract: Create a content outline\nHook / Problem (2–3 sentences): Q3 data (38% of tickets)');
});

test('D: headings, quotes, list markers, emphasis, code and links', () => {
  assert.equal(plainText('## Success metric\n\nCut tickets by 60%.'), 'Success metric\n\nCut tickets by 60%.', 'a leading # and the empty line kept');
  assert.equal(plainText('# One\n###### Six'), 'One\nSix');
  assert.equal(plainText('> A quote\n> > nested'), 'A quote\nnested');
  assert.equal(plainText('- one\n* two\n+ three\n1. four\n12) five'), 'one\ntwo\nthree\nfour\nfive');
  assert.equal(plainText('  - an indented item'), '  an indented item', 'the indentation is kept, the marker goes');
  assert.equal(plainText('Say *this* and _that_, __both__ and **all**.'), 'Say this and that, both and all.');
  assert.equal(plainText('Run `npm test` or ``a `b` c``.'), 'Run npm test or a b c.');
  assert.equal(plainText('See [the docs](https://example.com/a_b) and ![a chart](c.png).'), 'See the docs and a chart.');
  assert.equal(plainText('```js\nconst a = 1;\n```'), 'const a = 1;', 'the fence lines go, the code stays');
  assert.equal(plainText('Above\n---\nBelow'), 'Above\nBelow', 'a rule line goes');
  assert.equal(plainText('> - **Goal**: 60%'), 'Goal: 60%');
});

test('D: what only looks like a mark stays', () => {
  assert.equal(plainText('snake_case_name, 2 * 3 * 4, a_b and #hashtag'), 'snake_case_name, 2 * 3 * 4, a_b and #hashtag');
  assert.equal(plainText('Price: 5 - 3 = 2'), 'Price: 5 - 3 = 2');
  assert.equal(plainText('Target: customers … States launch target'), 'Target: customers … States launch target', 'board 59 E: the " … " join stays');
});

test('D: an excerpt cut in the middle of a bold mark loses the stray stars; anything not a string is empty', () => {
  assert.equal(plainText('**Contract: Create a content outl…'), 'Contract: Create a content outl…');
  assert.equal(plainText(null), '');
  assert.equal(plainText(undefined), '');
  assert.equal(plainText('Line one\r\nLine two'), 'Line one\nLine two');
});

test('review M7: a mark that is part of what the line says stays: "> 500" (more than), "- 5%" (minus), a year before a full stop', () => {
  assert.equal(plainText('> 500 customers within 90 days'), '> 500 customers within 90 days');
  assert.equal(plainText('- 5% churn after launch'), '- 5% churn after launch');
  assert.equal(plainText('* 3 more seats'), '* 3 more seats');
  assert.equal(plainText('2024. Revenue grew'), '2024. Revenue grew');
  assert.equal(plainText('> Most of us\n> > said yes'), 'Most of us\nsaid yes', 'a quote mark before words still goes');
  assert.equal(plainText('- one\n100. hundred\n1000. stays'), 'one\nhundred\n1000. stays', 'a list number has 1 to 3 digits');
});
