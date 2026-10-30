// test/workflow-test-project-checks.test.mjs — workflow tests 3a, Task 6 (D47, D57, D58, D59): what a project try changed,
// the command check, and text checks that read a file of the project.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { normaliseCheck, checkLabel, commandSummary, CHECK_KIND_LABELS, PROJECT_FILE_KIND_LABEL } from '../src/shared/workflow-tests/checks.mjs';
import { projectChanges, checkTry, readCheckFile, runCommandCheck, isProjectRow } from '../src/core/workflow-tests/result.mjs';
import * as store from '../src/core/workflow-tests/store.mjs';

const dirs = [];
let home;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'worca-cc-wftpchk-')); dirs.push(home); _resetForTests(); process.env.WORCA_HOME = home; });
after(() => { _resetForTests(); delete process.env.WORCA_HOME; for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });
const check = (raw) => normaliseCheck(raw).check;

test('the command check: its shape, its limits and its label (board 33)', () => {
  assert.deepEqual(check({ kind: 'command', cmd: '  npm test ' }), { kind: 'command', cmd: 'npm test', timeoutMin: 10 });
  assert.deepEqual(check({ kind: 'command', cmd: 'npm test', timeoutMin: '30' }), { kind: 'command', cmd: 'npm test', timeoutMin: 30 });
  assert.equal(normaliseCheck({ kind: 'command', cmd: '' }).error, 'write the command, such as npm test');
  assert.equal(normaliseCheck({ kind: 'command', cmd: 'a\nb' }).error, 'the command must fit on one line of up to 500 characters');
  assert.equal(normaliseCheck({ kind: 'command', cmd: 'npm test', timeoutMin: 7 }).error, 'the time limit must be 1, 5, 10 or 30 minutes');
  assert.equal(checkLabel(check({ kind: 'command', cmd: 'npm test' })), 'The command npm test passes');
  assert.equal(CHECK_KIND_LABELS.command, 'The command passes');
  assert.equal(PROJECT_FILE_KIND_LABEL, 'A file with this name is added or changed');
});

test('a text check can read a file; its label says which', () => {
  assert.deepEqual(check({ kind: 'sections', names: 'Fixed', file: 'CHANGELOG.md' }), { kind: 'sections', names: ['Fixed'], file: 'CHANGELOG.md' });
  assert.equal(checkLabel(check({ kind: 'sections', names: 'Fixed', file: 'CHANGELOG.md' })), 'Has the section Fixed in CHANGELOG.md');
  assert.equal(checkLabel(check({ kind: 'mentions', text: 'rounds', file: 'docs\\brief.md' })), 'Mentions "rounds" in docs/brief.md');
  assert.equal(checkLabel(check({ kind: 'words', max: 900, file: 'docs/brief.md' })), 'Length is at most 900 words in docs/brief.md');
  assert.deepEqual(check({ kind: 'mentions', text: 'x', file: '' }), { kind: 'mentions', text: 'x' }, 'no file: the Part 2 shape');
  for (const bad of ['../x', '/etc/passwd', 'C:/x']) {
    assert.equal(normaliseCheck({ kind: 'mentions', text: 'x', file: bad }).error, 'give a file inside the project, such as CHANGELOG.md', bad);
  }
});

test('an example with a project keeps its command check (Task 2 refuses it without one)', () => {
  const pin = { key: 'worca-cc-1a2b3c4d', startSha: 'a'.repeat(40), startRef: 'main', startAt: '2026-10-28T09:00:00.000Z', startCommit: 'a'.repeat(40), changes: null, setupCmd: null };
  const ex = store.createExample('wf_c', { name: 'x', request: 'r', checks: [{ kind: 'command', cmd: 'npm test' }] }, { project: pin });
  assert.deepEqual(ex.checks.map((c) => [c.kind, c.cmd, c.timeoutMin]), [['command', 'npm test', 10]]);
});

test('the summary line: node:test counts, a "passed" line, else the last line', () => {
  assert.equal(commandSummary('ok\nℹ tests 213\nℹ pass 213\nℹ fail 0\nℹ duration_ms 812'), '213 passed');
  assert.equal(commandSummary('ℹ pass 212\nℹ fail 1\nℹ duration_ms 812'), '212 passed, 1 failed');
  assert.equal(commandSummary('Tests: 1 failed, 212 passed, 213 total\nTime: 3 s'), 'Tests: 1 failed, 212 passed, 213 total');
  assert.equal(commandSummary('\u001b[32mall good\u001b[0m\n\n'), 'all good');
  assert.equal(commandSummary(''), '');
});

test('what changed: board 36\'s counts; a rename is a change; the paths a file check matches leave the removed out', () => {
  const c = projectChanges({ summary: { linesAdded: 22, linesRemoved: 31 },
    newFiles: [{ path: 'src/money.mjs', status: 'A', added: 20, removed: 0 }],
    changedFiles: [{ path: 'src/round.mjs', status: 'M', added: 2, removed: 1 }, { path: 'src/legacy-round.mjs', status: 'D', added: 0, removed: 30 },
      { path: 'test/new.test.mjs', status: 'R', from: 'test/old.test.mjs', added: 0, removed: 0 }] });
  assert.deepEqual(c.counts, { added: 1, changed: 2, removed: 1 });
  assert.deepEqual([c.total, c.added, c.removed], [4, 22, 31]);
  assert.deepEqual(c.files.map((f) => [f.status, f.path]), [['removed', 'src/legacy-round.mjs'], ['added', 'src/money.mjs'], ['changed', 'src/round.mjs'], ['renamed', 'test/new.test.mjs']]);
  assert.deepEqual(c.paths, ['src/money.mjs', 'src/round.mjs', 'test/new.test.mjs']);
  assert.equal(c.files.find((f) => f.status === 'renamed').from, 'test/old.test.mjs');
  assert.deepEqual(projectChanges(null), { files: [], paths: [], total: 0, counts: { added: 0, changed: 0, removed: 0 }, added: 0, removed: 0 });
  assert.equal(isProjectRow({ project_key: 'x-1a2b3c4d', branch: JSON.stringify({ baseSha: 'a'.repeat(40) }) }), true);
  assert.equal(isProjectRow({ project_key: 'x-1a2b3c4d', branch: null }), false, 'Part 2\'s seeded rows stay no-project');
});

/** A finished project try's outcome, as readTryOutcome builds it, on a real folder (no git needed for the checks). */
function outcome(dir, { status = 'done', files = ['src/feature.mjs'] } = {}) {
  return { pipelineId: null, facts: { status, costUsd: 0, durationMs: 1, sentBack: 0, help: [], failReason: null },
    name: null, text: 'Fixed the rounding.', source: 'end-value', files,
    project: { checkoutDir: dir, files: files.map((p) => ({ status: 'added', path: p, added: 1, removed: 0 })), paths: files },
    logFile: join(dir, '..', 'calls.ndjson') };
}

test('the command check runs in the checkout after the pure checks; its value and output are kept', { timeout: 60000 }, async () => {
  const dir = join(home, 'checkout');
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n\n## Fixed\n\nRounding.\n');
  writeFileSync(join(dir, 'pass.mjs'), "import { writeFileSync } from 'node:fs'; writeFileSync('CHANGELOG.md', '# gone\\n'); console.log('ℹ pass 3'); console.log('ℹ fail 0');\n");
  writeFileSync(join(dir, 'fail.mjs'), "console.log('ℹ pass 2'); console.log('ℹ fail 1'); process.exit(1);\n");
  const example = { basics: { noError: true, noHelp: true, maxCostUsd: null, maxSentBack: null }, checks: [
    { id: 'c_1', ...check({ kind: 'command', cmd: 'node pass.mjs' }) },
    { id: 'c_2', ...check({ kind: 'sections', names: 'Fixed', file: 'CHANGELOG.md' }) },
    { id: 'c_3', ...check({ kind: 'file', name: 'feature.mjs' }) },
    { id: 'c_4', ...check({ kind: 'command', cmd: 'node fail.mjs' }) },
    { id: 'c_5', ...check({ kind: 'mentions', text: 'x', file: 'missing.md' }) },
  ] };
  const seen = [];
  const v = await checkTry(example, outcome(dir), { onCommand: (c) => seen.push(c) });
  assert.deepEqual(v.checks.map((c) => [c.label, c.met, c.value]), [
    ['The command node pass.mjs passes', true, '3 passed'],
    ['Has the section Fixed in CHANGELOG.md', true, 'Met'],
    ['Has a file named feature.mjs', true, 'Met'],
    ['The command node fail.mjs passes', false, '2 passed, 1 failed'],
    ['Mentions "x" in missing.md', false, 'No file named missing.md'],
  ], 'the sections check read CHANGELOG.md before the first command rewrote it');
  assert.match(v.checks[3].output, /fail 1/);
  assert.deepEqual(seen, ['node pass.mjs', 'node fail.mjs']);
  assert.equal(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8'), '# gone\n', 'the commands did run, after the pure checks');
});

test('a try that did not finish runs no command; a checkout that is gone runs none either', async () => {
  const example = { basics: { noError: true, noHelp: false, maxCostUsd: null, maxSentBack: null }, checks: [{ id: 'c_1', ...check({ kind: 'command', cmd: 'node x.mjs' }) }] };
  const stopped = await checkTry(example, outcome(home, { status: 'stopped' }));
  assert.equal(stopped.checks[0].value, 'Not run: the try did not finish');
  const gone = outcome(home);
  gone.project.checkoutDir = null;
  assert.equal((await checkTry(example, gone)).checks[0].value, 'Not run: the copy of the project is gone');
});

test('a time limit stops a command; a file outside the checkout is never read', async () => {
  const dir = join(home, 'slow');
  mkdirSync(dir, { recursive: true });
  const r = await runCommandCheck({ kind: 'command', cmd: 'node -e "setTimeout(() => {}, 60000)"', timeoutMin: 1 }, { cwd: dir, run: async (o) => ({ ok: false, exitCode: null, timedOut: true, ms: o.timeoutMs, tail: '' }) });
  assert.deepEqual([r.met, r.value, r.timedOut], [false, 'Stopped after 1 minute', true]);
  assert.equal(await readCheckFile(outcome(dir), '../outside.md'), null);
});

test('a file reached through a linked folder that leads outside the checkout is never read', async () => {
  const dir = join(home, 'linked');
  const outside = join(home, 'outside');
  mkdirSync(join(dir, 'docs'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, 'secret.md'), 'secret');
  writeFileSync(join(dir, 'docs', 'ok.md'), 'fine');
  try { symlinkSync(outside, join(dir, 'out'), 'junction'); } catch (e) { return; }   // no link rights here: nothing to test
  assert.equal(await readCheckFile(outcome(dir), 'out/secret.md'), null);
  assert.equal(await readCheckFile(outcome(dir), 'docs/ok.md'), 'fine');
  for (const bad of ['/etc/passwd', 'C:/x.md', 'C:\\x.md']) assert.equal(await readCheckFile(outcome(dir), bad), null, bad);
});

test('Fix 1: the verdict item of a command its time limit stopped carries timedOut; any other command item has no such key', async () => {
  const example = { basics: { noError: true, noHelp: false, maxCostUsd: null, maxSentBack: null }, checks: [
    { id: 'c_1', ...check({ kind: 'command', cmd: 'node slow.mjs' }) }, { id: 'c_2', ...check({ kind: 'command', cmd: 'node fail.mjs' }) }] };
  const runCommand = async (c) => (c.cmd === 'node slow.mjs' ? { met: false, value: 'Stopped after 5 minutes', output: 'ℹ pass 3', timedOut: true }
    : { met: false, value: '2 passed, 1 failed', output: 'ℹ fail 1' });
  const v = await checkTry(example, outcome(home), { runCommand });
  assert.deepEqual(v.checks[0], { id: 'c_1', label: 'The command node slow.mjs passes', met: false, value: 'Stopped after 5 minutes', output: 'ℹ pass 3', timedOut: true });
  assert.deepEqual(Object.keys(v.checks[1]), ['id', 'label', 'met', 'value', 'output'], 'the Part 2 shape otherwise');
});

test('a command that throws is "Ended with an error"; the other checks keep their verdict', async () => {
  const example = { basics: { noError: true, noHelp: false, maxCostUsd: null, maxSentBack: null }, checks: [
    { id: 'c_1', ...check({ kind: 'command', cmd: 'node x.mjs' }) }, { id: 'c_2', ...check({ kind: 'mentions', text: 'rounding' }) }] };
  const v = await checkTry(example, outcome(home), { runCommand: async () => { throw new Error('boom'); } });
  assert.deepEqual(v.checks.map((c) => [c.met, c.value]), [[false, 'Ended with an error'], [true, 'Met']]);
});

test('the command gets the try guard env and the checkout as its folder', async () => {
  let seen;
  await runCommandCheck({ kind: 'command', cmd: 'x', timeoutMin: 5 }, { cwd: home, logFile: join(home, 'calls.ndjson'),
    run: async (o) => { seen = o; return { ok: true, exitCode: 0, timedOut: false, ms: 1, tail: 'ℹ pass 1\nℹ fail 0' }; } });
  assert.equal(seen.cwd, home);
  assert.equal(seen.timeoutMs, 300000);
  assert.ok(Object.keys(seen.env).some((k) => /^WORCA_/.test(k) && String(seen.env[k]).includes('calls.ndjson')), 'the guard log reaches the command');
});

test('a file path keeps its inner spaces', () => {
  assert.equal(check({ kind: 'mentions', text: 'x', file: ' docs/my  notes.md ' }).file, 'docs/my  notes.md');
});
