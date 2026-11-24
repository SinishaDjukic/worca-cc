// test/workflow-test-scope-checks.test.mjs — workflow tests 3b, Task 6 (Q10, D73): "Changes only files under …", "Leaves these
// files unchanged" and "Changes at most N files", counted exactly from a try's change list.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { normaliseCheck, checkLabel, runCheck, pathMatches, CHECK_KINDS, CHECK_KIND_LABELS, PROJECT_KINDS, SCOPE_KINDS } from '../src/shared/workflow-tests/checks.mjs';
import { projectChanges, checkTry } from '../src/core/workflow-tests/result.mjs';
import * as store from '../src/core/workflow-tests/store.mjs';

const dirs = [];
beforeEach(() => { const h = mkdtempSync(join(tmpdir(), 'worca-cc-wftscope-')); dirs.push(h); _resetForTests(); process.env.WORCA_HOME = h; });
after(() => { _resetForTests(); delete process.env.WORCA_HOME; for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const check = (raw) => normaliseCheck(raw).check;
const changes = (touched, total = touched.length) => ({ touched, total });
const errorOf = (raw) => normaliseCheck(raw).error;

test('the kinds, their names, and that they need a project (board 33)', () => {
  assert.deepEqual(SCOPE_KINDS, ['under', 'unchanged', 'max-files']);
  for (const k of SCOPE_KINDS) { assert.ok(CHECK_KINDS.includes(k), k); assert.ok(PROJECT_KINDS.includes(k), k); }
  assert.deepEqual([CHECK_KIND_LABELS.under, CHECK_KIND_LABELS.unchanged, CHECK_KIND_LABELS['max-files']],
    ['Changes only files under …', 'Leaves these files unchanged', 'Changes at most N files']);
  assert.throws(() => store.createExample('wf_s', { name: 'x', request: 'r', checks: [{ kind: 'under', dirs: 'src/' }] }),
    /this check needs a project: pick one under Where it starts/);
  assert.throws(() => store.createExample('wf_s', { name: 'x', request: 'r', checks: [{ kind: 'command', cmd: 'npm test' }] }),
    /the command check needs a project: pick one under Where it starts/, '3a\'s sentence for the command check stays');
});

test('"Changes only files under": folders, cleaned; refused when empty, outside the project or a pattern', () => {
  assert.deepEqual(check({ kind: 'under', dirs: 'src/, test' }), { kind: 'under', dirs: ['src/', 'test/'] });
  assert.deepEqual(check({ kind: 'under', dirs: ['./src//', 'src', 'docs\\guide'] }), { kind: 'under', dirs: ['src/', 'docs/guide/'] });
  assert.deepEqual(check({ kind: 'under', dirs: 'a/./b, ./c/./, d/.' }), { kind: 'under', dirs: ['a/b/', 'c/', 'd/'] }, 'a `.` folder is dropped');
  for (const bad of ['', ' , ']) assert.equal(errorOf({ kind: 'under', dirs: bad }), 'name at least one folder', JSON.stringify(bad));
  for (const bad of ['/etc', 'C:/x', '../up', 'a/../b', 'src/*', '.', 'a?b']) assert.equal(errorOf({ kind: 'under', dirs: bad }), 'give folders inside the project, such as src/', bad);
  assert.equal(errorOf({ kind: 'under', dirs: Array.from({ length: 21 }, (_, i) => `d${i}`) }), 'at most 20 folders');
  assert.equal(checkLabel(check({ kind: 'under', dirs: 'src/, test/' })), 'Changes only files under src/ and test/');
  assert.equal(checkLabel(check({ kind: 'under', dirs: 'a, b, c' })), 'Changes only files under a/, b/ and c/');
});

test('"Leaves these files unchanged": names and patterns, cleaned; refused when empty or outside the project', () => {
  assert.deepEqual(check({ kind: 'unchanged', patterns: 'test/fixtures/**, package-lock.json' }), { kind: 'unchanged', patterns: ['test/fixtures/**', 'package-lock.json'] });
  assert.deepEqual(check({ kind: 'unchanged', patterns: ['./a.txt', 'a.txt', 'b\\c'] }), { kind: 'unchanged', patterns: ['a.txt', 'b/c'] });
  assert.deepEqual(check({ kind: 'unchanged', patterns: 'a/./b, x/./y/./**' }), { kind: 'unchanged', patterns: ['a/b', 'x/y/**'] });
  assert.equal(errorOf({ kind: 'unchanged', patterns: '' }), 'name at least one file or pattern');
  for (const bad of ['/abs', 'C:/x', 'a/../b']) assert.equal(errorOf({ kind: 'unchanged', patterns: bad }), 'give files or patterns inside the project, such as test/**', bad);
  assert.equal(errorOf({ kind: 'unchanged', patterns: Array.from({ length: 21 }, (_, i) => `f${i}`) }), 'at most 20 files or patterns');
  assert.equal(checkLabel(check({ kind: 'unchanged', patterns: 'test/fixtures/**' })), 'Leaves these files unchanged: test/fixtures/**');
  assert.equal(checkLabel(check({ kind: 'unchanged', patterns: 'a, b' })), 'Leaves these files unchanged: a, b');
});

test('Windows input: a backslash in a typed folder or pattern is normalised, so matching never depends on the OS separator', () => {
  const under = check({ kind: 'under', dirs: 'src\\app, docs\\guide\\' });
  assert.deepEqual(under.dirs, ['src/app/', 'docs/guide/']);
  assert.deepEqual(runCheck(under, { changes: changes(['src/app/a.mjs', 'docs/guide/x.md']) }), { met: true, value: 'Met' });
  const keep = check({ kind: 'unchanged', patterns: 'test\\fixtures\\**' });
  assert.deepEqual(keep.patterns, ['test/fixtures/**']);
  assert.equal(runCheck(keep, { changes: changes(['test/fixtures/a.json']) }).met, false);
  assert.equal(runCheck(keep, { changes: changes(['src/a.mjs']) }).met, true);
});

test('"Changes at most N files": a whole number from 0 to 10000', () => {
  assert.deepEqual(check({ kind: 'max-files', max: '6' }), { kind: 'max-files', max: 6 });
  assert.deepEqual(check({ kind: 'max-files', max: 0 }), { kind: 'max-files', max: 0 });
  assert.deepEqual(check({ kind: 'max-files', max: ' 7 ' }), { kind: 'max-files', max: 7 });
  for (const bad of ['', -1, 1.5, '1.5', '6 files', 10001, null, undefined, true, false, [5], ['5'], {}, '0x10', '1e3']) {
    assert.equal(errorOf({ kind: 'max-files', max: bad }), 'the most files must be a whole number from 0 to 10000', String(bad));
  }
  assert.deepEqual([checkLabel(check({ kind: 'max-files', max: 6 })), checkLabel(check({ kind: 'max-files', max: 1 }))], ['Changes at most 6 files', 'Changes at most 1 file']);
});

test('patterns: ** across folders, * and ? inside a name, a folder with /, a name at any depth; case counts', () => {
  const yes = [['test/**', 'test/a.js'], ['test/**', 'test/x/y/z.js'], ['test/fixtures/', 'test/fixtures/a.json'], ['*.lock', 'yarn.lock'],
    ['package-lock.json', 'package-lock.json'], ['package-lock.json', 'apps/web/package-lock.json'], ['src/**/*.test.mjs', 'src/a.test.mjs'],
    ['src/**/*.test.mjs', 'src/x/y/a.test.mjs'], ['docs/?.md', 'docs/a.md'], ['**', 'any/thing'],
    // a `**` in the middle may stand for no folders
    ['**/fixtures/**', 'fixtures/a.json'], ['src/**/b/**', 'src/b/c'], ['**/fixtures/**', 'x/y/fixtures/a.json'],
    // .gitignore: a path with no glob covers what is inside it; no `/` (but a trailing one) means at any depth
    ['test/fixtures', 'test/fixtures/a.json'], ['test/fixtures', 'test/fixtures'], ['test/fixtures', 'test/fixtures/x/y.json'],
    ['node_modules', 'node_modules/x'], ['node_modules', 'a/node_modules/x'], ['node_modules', 'a/node_modules'],
    ['fixtures/', 'x/fixtures/a'], ['fixtures/', 'fixtures/a'], ['README.md', 'README.md']];
  const no = [['test/**', 'test'], ['test/**', 'tests/a.js'], ['*.lock', 'yarn.lock.bak'], ['src/*.mjs', 'src/x/a.mjs'], ['docs/?.md', 'docs/ab.md'],
    ['README.md', 'readme.md'], ['test/fixtures/', 'test/fixtures-old/a'], ['a/b', 'x/a/b'],
    ['src/**', 'src'], ['src/**/b/**', 'src/b'], ['**/fixtures/**', 'fixtures'], ['fixtures/', 'fixtures'], ['test/fixtures/', 'test/fixtures'],
    ['fixtures', 'fixturesX/a'], ['test/fix', 'test/fixtures/a'], ['node_modules', 'node_modulesX/a'], ['test/fixtures', 'x/test/fixtures/a'],
    ['test/fixtures', 'test/fixtures-old/a'], ['a/b', 'a/bc']];
  for (const [p, x] of yes) assert.equal(pathMatches(p, x), true, `${p} ~ ${x}`);
  for (const [p, x] of no) assert.equal(pathMatches(p, x), false, `${p} !~ ${x}`);
  const t0 = Date.now();
  assert.equal(pathMatches(`${'*a'.repeat(40)}b`, 'a'.repeat(200)), false);
  assert.equal(pathMatches(`${'**/'.repeat(20)}x`, `${'d/'.repeat(100)}y`), false);
  assert.equal(pathMatches(`${'**/a/'.repeat(20)}**`, `${'a/'.repeat(100)}y`), true);
  assert.ok(Date.now() - t0 < 2000, 'no runaway backtracking (loose: CI runners are loaded)');
});

test('the values: Met, the first file that broke it, the count', () => {
  const under = check({ kind: 'under', dirs: 'src/, test/' });
  assert.deepEqual(runCheck(under, { changes: changes(['src/a.mjs', 'test/a.test.mjs']) }), { met: true, value: 'Met' });
  assert.deepEqual(runCheck(under, { changes: changes(['docs/x.md', 'src/a.mjs', 'z.txt']) }), { met: false, value: 'Changed docs/x.md and 1 more' });
  assert.deepEqual(runCheck(under, { changes: changes([]) }), { met: true, value: 'Met' }, 'nothing changed is inside every folder');
  const keep = check({ kind: 'unchanged', patterns: 'test/fixtures/**' });
  assert.deepEqual(runCheck(keep, { changes: changes(['src/a.mjs']) }), { met: true, value: 'Met' });
  assert.deepEqual(runCheck(keep, { changes: changes(['test/fixtures/a.json']) }), { met: false, value: 'Changed test/fixtures/a.json' });
  const most = check({ kind: 'max-files', max: 3 });
  assert.deepEqual(runCheck(most, { changes: changes(['a', 'b', 'c']) }), { met: true, value: '3 files' });
  assert.deepEqual(runCheck(most, { changes: changes(['a', 'b', 'c', 'd']) }), { met: false, value: '4 files' });
  assert.deepEqual(runCheck(check({ kind: 'max-files', max: 0 }), { changes: changes([], 0) }), { met: true, value: 'No files' });
  assert.deepEqual(runCheck(most, { changes: changes(['a'], 1) }), { met: true, value: '1 file' });
  assert.deepEqual(runCheck(under, {}), { met: false, value: 'Not run: the example has no project' });
  const long = `src2/${'x'.repeat(150)}.mjs`;
  assert.equal(runCheck(under, { changes: changes([long]) }).value, `Changed ${long.slice(0, 99)}…`);
});

test('renames count both paths for the folder and unchanged checks, and once for the count; a copy only its new path', () => {
  const c = projectChanges({ summary: {}, newFiles: [{ path: 'src/copy.mjs', status: 'C', from: 'vendor/orig.mjs' }],
    changedFiles: [{ path: 'src/new.mjs', status: 'R', from: 'lib/old.mjs' }, { path: 'src/gone.mjs', status: 'D' }] });
  assert.deepEqual(c.touched, ['lib/old.mjs', 'src/copy.mjs', 'src/gone.mjs', 'src/new.mjs']);
  assert.equal(c.total, 3);
  assert.equal(runCheck(check({ kind: 'under', dirs: 'src/' }), { changes: c }).met, false, 'moved out of lib/: lib/ changed');
  assert.equal(runCheck(check({ kind: 'unchanged', patterns: 'lib/**' }), { changes: c }).met, false);
  assert.deepEqual(runCheck(check({ kind: 'max-files', max: 3 }), { changes: c }), { met: true, value: '3 files' });
  assert.ok(!c.touched.includes('vendor/orig.mjs'), 'a copy\'s source is not touched');
  assert.deepEqual(runCheck(check({ kind: 'unchanged', patterns: 'vendor/**' }), { changes: c }), { met: true, value: 'Met' });
});

test('checkTry: scope checks read the try\'s change list, whatever the try did, and carry their kind for the side by side', async () => {
  const ex = { basics: { noError: false, noHelp: false, maxCostUsd: null, maxSentBack: null }, checks: [
    { id: 'c_1', ...check({ kind: 'under', dirs: 'src/' }) }, { id: 'c_2', ...check({ kind: 'unchanged', patterns: 'test/**' }) },
    { id: 'c_3', ...check({ kind: 'max-files', max: 1 }) }] };
  const outcome = { pipelineId: null, facts: { status: 'error', costUsd: 0, help: [] }, text: null, files: [],
    project: { touched: ['src/a.mjs', 'test/b.test.mjs'], total: 2, checkoutDir: null } };
  const v = await checkTry(ex, outcome);
  assert.deepEqual(v.checks.map((c) => [c.id, c.met, c.value, c.kind]), [['c_1', false, 'Changed test/b.test.mjs', 'under'],
    ['c_2', false, 'Changed test/b.test.mjs', 'unchanged'], ['c_3', false, '2 files', 'max-files']]);
  assert.deepEqual([v.checks[0].dirs, v.checks[1].patterns, v.checks[2].max], [['src/'], ['test/**'], 1]);
  assert.ok(v.checks.every((c) => !c.worcaProblem), 'a scope check Worca ran is never Worca\'s problem');
});

test('checkTry: when the change list is gone, Worca could not count: a Worca problem, never a pass or a workflow fault', async () => {
  const ex = { basics: { noError: false, noHelp: false, maxCostUsd: null, maxSentBack: null }, checks: [
    { id: 'c_1', ...check({ kind: 'under', dirs: 'src/' }) }, { id: 'c_3', ...check({ kind: 'max-files', max: 5 }) }] };
  const outcome = { pipelineId: null, facts: { status: 'done', costUsd: 0, help: [] }, text: null, files: [],
    project: { touched: null, total: 0, checkoutDir: null } };
  const v = await checkTry(ex, outcome);
  assert.deepEqual(v.checks.map((c) => [c.met, c.value, c.worcaProblem]),
    [[false, 'Not run: the list of changed files is gone', true], [false, 'Not run: the list of changed files is gone', true]]);
  assert.deepEqual(v.checks.map((c) => [c.kind, c.dirs, c.max]), [['under', ['src/'], undefined], ['max-files', undefined, 5]],
    'it carries its kind and parameters like every scope result');
});

test('checkTry: a try that did not finish and left no change list changed nothing: the checks count an empty list, no Worca problem', async () => {
  const ex = { basics: { noError: false, noHelp: false, maxCostUsd: null, maxSentBack: null }, checks: [
    { id: 'c_1', ...check({ kind: 'under', dirs: 'src/' }) }, { id: 'c_2', ...check({ kind: 'unchanged', patterns: 'test/**' }) },
    { id: 'c_3', ...check({ kind: 'max-files', max: 0 }) }] };
  for (const status of ['error', 'stopped']) {
    const outcome = { pipelineId: null, facts: { status, costUsd: 0, help: [], failReason: 'The workflow failed.' }, text: null, files: [],
      project: { touched: null, total: 0, checkoutDir: null } };
    const v = await checkTry(ex, outcome);
    assert.deepEqual(v.checks.map((c) => [c.id, c.met, c.value, c.kind, !!c.worcaProblem]),
      [['c_1', true, 'Met', 'under', false], ['c_2', true, 'Met', 'unchanged', false], ['c_3', true, 'No files', 'max-files', false]], status);
  }
});
