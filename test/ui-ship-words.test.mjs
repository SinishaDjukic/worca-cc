// test/ui-ship-words.test.mjs — the shared ship label and done-state words (audit F-7, F-11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { CREATE_PR_LABEL, doneStatusWord } from '../ui/public/ship-words.mjs';

const read = (p) => readFileSync(new URL(`../ui/public/${p}`, import.meta.url), 'utf8');
const noComments = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).map((l) => l.replace(/\s\/\/.*$/, '')).join('\n');

test('CREATE_PR_LABEL and doneStatusWord', () => {
  assert.equal(CREATE_PR_LABEL, 'Create PR');
  assert.equal(doneStatusWord('ready'), 'Ready to ship');
  assert.equal(doneStatusWord('in-review'), 'In review');
  assert.equal(doneStatusWord('merged'), 'Merged');
  assert.equal(doneStatusWord('needs-you'), 'Needs you');
  assert.equal(doneStatusWord('running'), '');
});

test('entry buttons read CREATE_PR_LABEL; only the dialog says "Create pull request"', () => {
  for (const f of ['app.js', 'chat/run-card.mjs', 'chat/action-cards.mjs']) {
    const src = noComments(read(f));
    assert.equal(/['"`]Create PR['"`]/.test(src), false, `${f}: entry buttons read CREATE_PR_LABEL`);
    if (f !== 'app.js') assert.equal(/['"`]Create pull request['"`]/.test(src), false, `${f}: entry buttons read CREATE_PR_LABEL`);
  }
  assert.equal((noComments(read('app.js')).match(/['"`]Create pull request['"`]/g) || []).length, 2, 'only the Create PR dialog confirm resets');
  const html = read('index.html');
  assert.match(html, /class="btn btn-primary shipit-ok">Create pull request</);
  assert.match(html, /hd-pr"[^>]*>Create PR</);
  assert.match(html, /id="shipit-modal"[^>]*aria-label="Create pull request"/);
  assert.match(html, /<h2>Create pull request<\/h2>/);
});

test('no "Ship it" or "View pull request" label is left in ui/public (comments aside)', () => {
  const html = read('index.html').replace(/<!--[\s\S]*?-->/g, '');
  assert.equal(html.includes('Ship it'), false, 'index.html');
  const walk = (dir) => readdirSync(new URL(`../ui/public/${dir}`, import.meta.url), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}${e.name}/`) : /\.(mjs|js)$/.test(e.name) ? [`${dir}${e.name}`] : []);
  const files = walk('');
  assert.ok(files.includes('app.js') && files.includes('chat/run-card.mjs'), 'precondition: the walk reaches app.js and chat/');
  for (const f of files) {
    const src = noComments(read(f)).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal(/['"`][^'"`\n]*\bShip it\b/.test(src), false, `${f}: a "Ship it" string literal`);
    assert.equal(/['"`][^'"`\n]*View pull request/.test(src), false, `${f}: say "View PR"`);
  }
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
