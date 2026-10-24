// test/ui-ship-words.test.mjs — the shared ship label and done-state words (audit F-7, F-11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { CREATE_PR_LABEL, VIEW_PR_LABEL, createPrLabel, viewPrLabel, doneStatusWord } from '../ui/public/ship-words.mjs';
import { ACTION_LABEL } from '../src/shared/run-model.mjs';

const read = (p) => readFileSync(new URL(`../ui/public/${p}`, import.meta.url), 'utf8');
const noComments = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).map((l) => l.replace(/\s\/\/.*$/, '')).join('\n');

test('CREATE_PR_LABEL and doneStatusWord', () => {
  assert.equal(CREATE_PR_LABEL, 'Create PR');
  assert.equal(doneStatusWord('ready'), 'Ready to ship');
  assert.equal(doneStatusWord('in-review'), 'In review');
  assert.equal(doneStatusWord('merged'), 'Merged');
  assert.equal(doneStatusWord('needs-you'), 'Needs you');
  assert.equal(doneStatusWord('running'), '');
  assert.equal(createPrLabel(1), 'Create PR');
  assert.equal(createPrLabel(3), 'Create 3 PRs');
  assert.equal(viewPrLabel(812), 'View PR #812');
  assert.equal(viewPrLabel(), 'View PR');
  assert.equal(ACTION_LABEL.ship, CREATE_PR_LABEL, 'run-model keeps its own copy (the server cannot import ui/public)');
  assert.equal(ACTION_LABEL['open-pr'], VIEW_PR_LABEL);
});

const BANS = [
  // The lookbehind lets the adjective through ("any open PR", "the open pull request"); the verb and the old labels fail.
  [/(?<!\b(?:[Aa]n|[Aa]ny|[Tt]he|[Ii]ts|[Nn]o|[Oo]ne|[Ee]very) )\b[Oo]pen(?:s|ing|ed)? (?:a |the |one |this |\$\{[^}]*\} )?(?:PR|[Pp]ull request)s?\b/, 'open is not a PR verb: say Create PR / create a PR'],
  [/\b(?:PRs?|[Pp]ull requests?) (?:(?:was|were|is|are|can be|cannot be|could not be) )?opened\b/, 'say "PR created"'],
  [/Create pull request/, 'say "Create PR"'],
  [/Could not open Create PR/, 'say "Could not create PR"'],
];
const literals = (src) => src.match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) || [];
const walkFrom = (root, dir = '') => readdirSync(new URL(`../${root}/${dir}`, import.meta.url), { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? (e.name === 'vendor' ? [] : walkFrom(root, `${dir}${e.name}/`)) : /\.(mjs|js)$/.test(e.name) ? [`${root}/${dir}${e.name}`] : []);
const readRepo = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const banHits = (src) => literals(noComments(src).replace(/\/\*[\s\S]*?\*\//g, ''))
  .flatMap((lit) => BANS.filter(([re]) => re.test(lit)).map(([, why]) => `${lit.slice(0, 80)} (${why})`));

test('PR wording guard: it catches the old words (mutation check)', () => {
  assert.equal(banHits("items.push({ label: `Open PR #${p.number}` });").length, 1);
  assert.equal(banHits("announce(ctx, 'Pull request opened');").length, 1);
  assert.equal(banHits("okBtn.textContent = 'Create pull request';").length, 1);
  assert.equal(banHits("const t = `Could not open PR: ${e.message}`;").length, 1);
  assert.equal(banHits("// Open PR #1 in a comment\nconst x = 'View PR #1';").length, 0, 'comments and the new words pass');
  assert.equal(banHits("const a = 'any open PR stay untouched'; const b = 'The open pull request is unchanged.';").length, 0, 'open as an adjective passes');
});

test('PR wording: no string literal uses "open" as a PR verb or says "Create pull request"', () => {
  const files = [...walkFrom('ui/public'), ...walkFrom('src/shared'), 'ui/server.mjs'];
  assert.ok(files.includes('ui/public/app.js') && files.includes('ui/public/run-head.mjs'), 'precondition: the walk reaches app.js');
  const hits = files.flatMap((f) => banHits(readRepo(f)).map((h) => `${f}: ${h}`));
  const html = read('index.html').replace(/<!--[\s\S]*?-->/g, '');
  for (const [re, why] of BANS) if (re.test(html)) hits.push(`index.html: ${re} (${why})`);
  assert.deepEqual(hits, []);
});

test('PR wording: buttons and dialog titles in index.html say "PR"; the Create PR dialog title equals its confirm', () => {
  const page = new JSDOM(read('index.html')).window.document;
  for (const b of page.querySelectorAll('button')) assert.doesNotMatch(b.textContent, /pull request/i, b.outerHTML.slice(0, 80));
  for (const d of page.querySelectorAll('[role="dialog"]')) {
    assert.doesNotMatch(d.getAttribute('aria-label') || '', /pull request/i, d.id);
    const h = d.querySelector('h2');
    if (h) assert.doesNotMatch(h.textContent, /pull request/i, d.id);
  }
  const m = page.getElementById('shipit-modal');
  assert.equal(m.getAttribute('aria-label'), CREATE_PR_LABEL);
  assert.equal(m.querySelector('.shipit-title').textContent, CREATE_PR_LABEL);
  assert.equal(m.querySelector('.shipit-ok').textContent.trim(), CREATE_PR_LABEL);
});

test('PR words: no JS module under ui/public repeats the Create PR / View PR(s) literal; ship-words.mjs owns them', () => {
  // index.html keeps 'Create PR' as the static fallback that setShipItLabel overwrites on every open.
  const files = walkFrom('ui/public').filter((f) => f !== 'ui/public/ship-words.mjs');
  const hits = files.filter((f) => /['"`](?:Create PR|View PRs?)['"`]/.test(noComments(readRepo(f))));
  assert.deepEqual(hits, [], 'read the label from ui/public/ship-words.mjs');
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
