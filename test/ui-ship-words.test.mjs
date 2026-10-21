// test/ui-ship-words.test.mjs — the shared ship label and done-state words (audit F-7, F-11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SHIP_LABEL, doneStatusWord } from '../ui/public/ship-words.mjs';

const read = (p) => readFileSync(new URL(`../ui/public/${p}`, import.meta.url), 'utf8');
const noComments = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).map((l) => l.replace(/\s\/\/.*$/, '')).join('\n');

test('SHIP_LABEL and doneStatusWord', () => {
  assert.equal(SHIP_LABEL, 'Ship it');
  assert.equal(doneStatusWord('ready'), 'Ready to ship');
  assert.equal(doneStatusWord('in-review'), 'In review');
  assert.equal(doneStatusWord('merged'), 'Merged');
  assert.equal(doneStatusWord('needs-you'), 'Needs you');
  assert.equal(doneStatusWord('running'), '');
});

test('no "Create PR" label anywhere; entry buttons use SHIP_LABEL', () => {
  assert.equal(read('index.html').includes('Create PR'), false);
  for (const f of ['app.js', 'chat/run-card.mjs', 'chat/action-cards.mjs']) {
    const src = noComments(read(f));
    assert.equal(/['"`]Create PR['"`]/.test(src), false, f);
    if (f !== 'app.js') assert.equal(/['"`]Create pull request['"`]/.test(src), false, `${f}: entry buttons read SHIP_LABEL`);
  }
  assert.equal((noComments(read('app.js')).match(/['"`]Create pull request['"`]/g) || []).length, 2, 'only the Ship it dialog confirm resets');
  assert.match(read('index.html'), /class="btn btn-primary shipit-ok">Create pull request</);
  assert.match(read('index.html'), /hd-pr"[^>]*>Ship it</);
});

test('F-9: the four run-time surfaces route through whenLabel, none through formatInstant or toLocaleString', () => {
  const sheet = read('schedule-sheet.mjs');
  assert.equal((sheet.match(/whenLabel\(/g) || []).length >= 2, true);
  assert.equal(sheet.includes('formatInstant'), false);
  const app = noComments(read('app.js'));
  assert.match(app, /Starts \$\{whenLabel\(/);
  assert.equal(/started \$\{startedLabel\(/.test(app), false);
  assert.match(app, /function splitDateStamp\(iso\) \{\s*return \{ day: whenLabel\(iso\), clock: '' \};/);
});

test('F-22: a zero diff count is neutral ink and the files tile is a link', () => {
  const css = read('style.css');
  // --ink-2, not --ink-3: --ink-3 is 2.58:1 on the tile (the theme proof's AA gate).
  assert.match(css, /\.rd-stats \.hd-diff-counts \.is-zero\{color:var\(--ink-2\);\}/);
  assert.match(read('app.js'), /diff-del\$\{f\.removed === 0 \? ' is-zero' : ''\}/);
});

test('the stat card sub line is sans --ink-2: dropping .mono left the baseline, and --ink-3 is 2.8:1', () => {
  const css = read('style.css');
  assert.match(css, /\.hd-ov-card \.hd-ov-sub\{color:var\(--ink-2\);\}/);
  assert.match(read('app.js'), /s\.className = 'hd-ov-sub';/);
});
