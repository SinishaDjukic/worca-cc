// test/shape-small-runs-words.test.mjs — the words "small runs" still in the product. A literal scan over src/ and ui/
// (the pattern of test/ui-ship-words.test.mjs: string literals outside comments) lists every literal holding whitespace
// that says "small runs" or "small-runs". The one named exception is the Labs title; the keys that match a stored
// record's old reason are data (and, with the flag off, the words kept as before); everything else is listed in KNOWN
// until it is reworded, and KNOWN only shrinks. A bare hyphenated token (`small-runs` alone) is not read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { FLAGS } from '../src/shared/flags/registry.mjs';
// A namespace read, so a missing new export (LEGACY_OUTCOME_REASONS) fails only the tests that need it.
import * as PR_AUTO from '../src/shared/pr-auto.mjs';
import { groupShipChoice } from '../ui/public/ship-group-dialog.mjs';
// A namespace read: the carried-run words are new exports.
import * as LEDGER from '../src/shared/shape/ship-ledger.mjs';

const EXCEPTION = 'Shaper small runs';   // the Labs entry's title
const OLD_REASON = 'small runs ship a PR per run';

const noComments = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).map((l) => l.replace(/\s\/\/.*$/, '')).join('\n');
const literals = (src) => src.match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) || [];
const walkFrom = (root, dir = '') => readdirSync(new URL(`../${root}/${dir}`, import.meta.url), { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? (e.name === 'vendor' ? [] : walkFrom(root, `${dir}${e.name}/`)) : /\.(mjs|js)$/.test(e.name) ? [`${root}/${dir}${e.name}`] : []);
const readRepo = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** The literals of `src` (without their quotes) that hold whitespace and say small runs; an `is-small-runs` class token is not words. */
const hits = (src) => literals(noComments(src).replace(/\/\*[\s\S]*?\*\//g, '')).map((lit) => lit.slice(1, -1))
  .filter((text) => /\s/.test(text) && /small[ -]runs/i.test(text.replace(/(^|\s)is-small-runs(?=\s|$)/g, '$1')));
const FOUND = ['src', 'ui'].flatMap((root) => walkFrom(root)).sort()
  .flatMap((file) => hits(readRepo(file)).map((text) => ({ file, text })));

/** Each entry is a literal's file and its first 60 characters. */
const head = ({ file, text }) => ({ file, text: text.slice(0, 60) });
const KNOWN = [
  { file: 'src/core/ask/tools.mjs', text: 'Shaper small runs: when the user asks to change the text of ' },   // change_requirement
  { file: 'src/core/shape/changes.mjs', text: '${f.title} is not built with small runs' },
  { file: 'src/core/shape/changes.mjs', text: 'requirement changes need Shaper small runs' },
  { file: 'src/shared/flags/registry.mjs', text: 'Shaper builds a feature as small runs, checked as a whole by' },   // the Labs description
  { file: 'ui/routes/shape/features.mjs', text: 'nothing to resume now: the Verifier is not stopped, a run or' },   // NOTHING_TO_RESUME
];
const byPlace = (a, b) => `${a.file}\n${a.text}`.localeCompare(`${b.file}\n${b.text}`);
const legacyKeys = () => Object.keys(PR_AUTO.LEGACY_OUTCOME_REASONS || {});

test('the scan reads literals, not comments or bare tokens (mutation check)', () => {
  assert.deepEqual(hits("const a = 'small runs ship a PR per run';"), [OLD_REASON]);
  assert.deepEqual(hits('el.title = `a small-runs feature ${x}`;'), ['a small-runs feature ${x}']);
  assert.deepEqual(hits("// a 'small runs' note\n/* 'small runs here' */\nimport x from './small-runs.mjs';\nconst k = 'small-runs';"), []);
  assert.deepEqual(hits("h('div', `ask-card is-${p} is-small-runs`)"), [], 'a class token is not words');
});

test('every small-runs literal is the Labs title, a legacy record key or a known one', () => {
  const legacy = new Set(legacyKeys());
  const left = FOUND.filter(({ text }) => text !== EXCEPTION && !legacy.has(text)).map(head);
  assert.deepEqual(left.sort(byPlace), [...KNOWN].sort(byPlace));
});

test('the One reason is gone from every flag-on word; it stays only as the legacy constant the flag-off paths share', () => {
  assert.deepEqual(FOUND.filter(({ text }) => text === OLD_REASON).map(({ file }) => file), ['src/shared/shape/ship-ledger.mjs'],
    'the old reason stays only as the key that maps a stored record');
  assert.deepEqual(legacyKeys(), [OLD_REASON]);
  assert.equal(KNOWN.some(({ text }) => text === OLD_REASON), false);
  const url = 'https://github.com/me/repo/pull/40';
  for (const oneOk of [true, false]) {
    for (const pr of [null, { url, number: 40, state: 'OPEN' }]) {
      const members = [{ position: 1, pr: null }, { position: 2, pr }];
      const { oneOff } = groupShipChoice({ kind: 'feature', members, all: members, smallRuns: true, oneOk });
      // With the flag off, nothing changes for a small-runs feature, wording included (owner direction).
      if (oneOk) assert.doesNotMatch(oneOff, /small[ -]runs/i, `oneOk ${oneOk}, pr ${!!pr}`);
      else assert.equal(oneOff, OLD_REASON, `flag off, pr ${!!pr}: the words as before`);
    }
  }
});

test('the exception is the Labs title', () => {
  assert.equal(FLAGS.find((f) => f.key === 'shaperSmallRuns').title, EXCEPTION);
  assert.deepEqual(FOUND.filter(({ text }) => text === EXCEPTION).map(({ file }) => file), ['src/shared/flags/registry.mjs']);
});

test('the Labs description says a feature ships as one PR or as stacked PRs, and keeps what Off does', () => {
  const { description } = FLAGS.find((f) => f.key === 'shaperSmallRuns');
  assert.ok(description.includes('shipped as one PR or as stacked PRs'), description);
  assert.doesNotMatch(description, /shipped as one stacked PR per run/);
  assert.ok(description.includes('stacked Ship'), 'with the flag off, Ship stays stacked');
});

test('the carried-run and not-counted words say no small runs', () => {
  const url = (n) => `https://github.com/me/repo/pull/${n}`;
  const open = (n) => ({ url: url(n), number: n, state: 'OPEN' });
  const words = [
    LEDGER.carriedLine({ index: 2, by: 3, pr: open(40) }),
    LEDGER.carriedLine({ index: 2, by: 3, pr: { url: 'created:2', state: 'OPEN' } }),
    LEDGER.carriedLine({ index: 2, by: 3, pr: null }),
    LEDGER.keptOpenNote([{ index: 2, pr: open(40) }]),
    LEDGER.keptOpenNote([{ index: 2, pr: open(40) }, { index: 4, pr: open(41) }]),
  ];
  assert.ok(words.every((w) => typeof w === 'string' && /\s/.test(w)), JSON.stringify(words));
  assert.deepEqual(words.flatMap((w) => hits(JSON.stringify(w))), []);
});
