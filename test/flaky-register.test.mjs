// test/flaky-register.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { unlistedFailures, parseFailures } from '../tools/flaky-register.mjs';

const REG = JSON.parse(readFileSync(new URL('./flaky-register.json', import.meta.url), 'utf8'));

test('every row names an existing file that contains the test title, a symptom and how it was checked', () => {
  assert.ok(REG.length >= 1);
  for (const e of REG) {
    const url = new URL(`../${e.file}`, import.meta.url);
    assert.ok(existsSync(url), `${e.file} exists`);
    for (const k of ['file', 'test', 'symptom', 'alone']) assert.equal(typeof e[k], 'string', `${e.file}: ${k}`);
    assert.match(e.alone, /^(passes alone|fails alone too|environment)$/);
    if (e.test === '*') { assert.equal(e.alone, 'environment', `${e.file}: a file-level row is an environment failure`); continue; }
    const title = e.test.split('…')[0].trim();
    assert.ok(readFileSync(url, 'utf8').includes(title), `${e.file} contains "${title}"`);
  }
});

// The spec reporter's tail, as tools/test-run.mjs prints it (checked on Node 26.5.0 with one failing test and one
// file that fails to load): "✖ failing tests:", then per failure "test at FILE:L:C" and "✖ TITLE (ms)".
const SPEC_TAIL = (pairs, fail = pairs.length) => [
  '✔ passes (0.3ms)', `ℹ tests ${fail + 1}`, 'ℹ pass 1', `ℹ fail ${fail}`, '', '✖ failing tests:', '',
  ...pairs.flatMap(([file, title]) => [`test at ${file}:3:1`, `✖ ${title} (0.07ms)`, '  Error: boom', '']),
].join('\n');

test('no duplicate file+test rows', () => {
  const keys = REG.map((e) => `${e.file}::${e.test}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('unlistedFailures names failing tests that no row covers', () => {
  const log = SPEC_TAIL([['test/git-sync.test.mjs', 'a timed-out fetch kills its whole process group after 750 ms'],
    ['/abs/worktree/test/brand-new.test.mjs', 'something new']]);
  const reg = [{ file: 'test/git-sync.test.mjs', test: 'a timed-out fetch kills its whole process group …' }];
  assert.deepEqual(unlistedFailures(log, reg), [{ file: 'test/brand-new.test.mjs', test: 'something new' }]);
});

test('a file-level failure (load error, cleanup hook) is unlisted unless its file has a "*" row', () => {
  const log = SPEC_TAIL([['test/api-run-engine.test.mjs', 'test/api-run-engine.test.mjs'], ['test/x.test.mjs', 'test/x.test.mjs']]);
  const reg = [{ file: 'test/api-run-engine.test.mjs', test: '*', alone: 'environment' }];
  assert.deepEqual(unlistedFailures(log, reg), [{ file: 'test/x.test.mjs', test: '(file-level failure)' }]);
  const named = [{ file: 'test/x.test.mjs', test: 'some test …' }];
  assert.deepEqual(unlistedFailures(SPEC_TAIL([['test/x.test.mjs', 'test/x.test.mjs']]), named),
    [{ file: 'test/x.test.mjs', test: '(file-level failure)' }], 'a named row does not cover a load failure');
});

test('a log the parser cannot read is an error, never a silent pass', () => {
  assert.throws(() => parseFailures('just some text\n'), /no "ℹ fail N" summary/);
  assert.throws(() => parseFailures('ℹ fail 2\n'), /reports 2 failures but none were parsed/);
  assert.deepEqual(parseFailures('ℹ tests 3\nℹ fail 0\n'), []);
});

test('a row with an empty title prefix is refused: it would cover every failure in its file', () => {
  for (const t of ['', '… rest', '  …']) {
    assert.throws(() => unlistedFailures(SPEC_TAIL([['test/x.test.mjs', 'boom']]), [{ file: 'test/x.test.mjs', test: t }]), /empty title prefix/, JSON.stringify(t));
  }
});
