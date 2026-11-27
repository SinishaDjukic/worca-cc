// test/ci-gate.test.mjs — the verdict of ci.yml's `CI gate` job (tools/ci-gate.mjs).
// A covered job that fails or is cancelled fails the gate; `success` and `skipped` (a docs-only PR)
// pass it. A run superseded by a newer PR push gets its own summary heading but still exits 1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as gate from '../tools/ci-gate.mjs';

const { gateVerdict, isSuperseded, renderSummary } = gate;

const SCRIPT = fileURLToPath(new URL('../tools/ci-gate.mjs', import.meta.url));
const SHA_A = 'a'.repeat(40);
const SHA_B = '0123456789abcdef0123456789abcdef01234567';
const JOBS = ['changes', 'test-fast', 'test-slow', 'cdp', 'extension', 'extension-e2e', 'docker'];
const needsOf = (results) => Object.fromEntries(Object.entries(results).map(([job, result]) => [job, { result, outputs: {} }]));
const all = (result, over = {}) => needsOf({ ...Object.fromEntries(JOBS.map((j) => [j, result])), ...over });

test('isSuperseded: only a PR run whose live head is a different 40-hex SHA', () => {
  assert.equal(isSuperseded({ event: 'pull_request', runSha: SHA_A, prHeadSha: SHA_B }), true);
  assert.equal(isSuperseded({ event: 'pull_request', runSha: SHA_A, prHeadSha: SHA_A }), false, 'same SHA: a hand-cancel');
  assert.equal(isSuperseded({ event: 'push', runSha: SHA_A, prHeadSha: SHA_B }), false, 'a dev push is never superseded');
  assert.equal(isSuperseded({ event: 'pull_request', runSha: SHA_A, prHeadSha: '' }), false, 'API failure: unknown never excuses');
  assert.equal(isSuperseded({ event: 'pull_request', runSha: SHA_A, prHeadSha: 'not-a-sha-' + 'z'.repeat(30) }), false);
  assert.equal(isSuperseded({ event: 'pull_request', runSha: SHA_A, prHeadSha: SHA_B.toUpperCase() }), false, 'hex must be lowercase 40');
});

test('gateVerdict: every job success or skipped passes (the docs-only shape)', () => {
  const docsOnly = all('skipped', { changes: 'success' });
  const v = gateVerdict(docsOnly);
  assert.equal(v.ok, true);
  assert.equal(v.superseded, false);
  assert.equal(v.rows.length, 7);
  assert.ok(v.rows.every((r) => r.verdict === 'pass'));
  assert.equal(v.rows.filter((r) => r.result === 'skipped').length, 6);
  assert.equal(gateVerdict(all('success')).ok, true);
});

test('gateVerdict: a failed extension job fails the gate on that row', () => {
  const v = gateVerdict(all('success', { extension: 'failure' }));
  assert.equal(v.ok, false);
  assert.deepEqual(v.rows.filter((r) => r.verdict === 'fail'), [{ job: 'extension', result: 'failure', verdict: 'fail' }]);
});

test('gateVerdict: a cancelled job fails unless the run was superseded', () => {
  const needs = all('success', { 'test-fast': 'cancelled', cdp: 'cancelled' });
  const plain = gateVerdict(needs);
  assert.equal(plain.ok, false);
  assert.equal(plain.superseded, false);
  assert.deepEqual(plain.rows.filter((r) => r.verdict === 'fail').map((r) => r.job), ['cdp', 'test-fast']);
  assert.equal(gateVerdict(needs, {}).ok, false, 'superseded defaults to false');
  const sup = gateVerdict(needs, { superseded: true });
  assert.equal(sup.ok, true);
  assert.equal(sup.superseded, true);
  assert.ok(sup.rows.every((r) => r.verdict === 'pass'));
});

test('gateVerdict: superseded never excuses a failure (no cancelled row)', () => {
  const v = gateVerdict(all('success', { docker: 'failure' }), { superseded: true });
  assert.equal(v.ok, false);
  assert.equal(v.superseded, false);
});

test('gateVerdict: superseded with no cancelled row is the normal verdict, not "superseded"', () => {
  const v = gateVerdict(all('success'), { superseded: true });
  assert.equal(v.ok, true);
  assert.equal(v.superseded, false);
});

test('gateVerdict: a failure before the cancel stays failed; the summary says failed', () => {
  const v = gateVerdict(needsOf({ a: 'failure', b: 'cancelled' }), { superseded: true });
  assert.equal(v.ok, false);
  assert.equal(v.superseded, false);
  assert.ok(renderSummary(v, { prHeadSha: SHA_B }).startsWith('CI gate: failed'));
});

test('gateVerdict: an unknown or missing result fails', () => {
  const neutral = gateVerdict(all('success', { cdp: 'neutral' }));
  assert.equal(neutral.ok, false);
  assert.deepEqual(neutral.rows.find((r) => r.job === 'cdp'), { job: 'cdp', result: 'neutral', verdict: 'fail' });
  const needs = all('success');
  needs.docker = { outputs: {} };
  const missing = gateVerdict(needs);
  assert.equal(missing.ok, false);
  assert.equal(missing.rows.find((r) => r.job === 'docker').verdict, 'fail');
});

test('gateVerdict: empty needs fails with one "(none)" row', () => {
  const v = gateVerdict({});
  assert.equal(v.ok, false);
  assert.deepEqual(v.rows, [{ job: '(none)', result: 'no jobs', verdict: 'fail' }]);
});

test('gateVerdict: rows are sorted by job id whatever key order needs has', () => {
  const results = { changes: 'success', 'test-fast': 'failure', 'test-slow': 'skipped', cdp: 'cancelled', extension: 'success', 'extension-e2e': 'success', docker: 'success' };
  const forward = needsOf(results);
  const backward = needsOf(Object.fromEntries(Object.entries(results).reverse()));
  const a = gateVerdict(forward).rows;
  assert.deepEqual(a, gateVerdict(backward).rows);
  assert.deepEqual(a.map((r) => r.job), [...JOBS].sort());
});

test('renderSummary: failed heading and a raw-result row per job; superseded heading carries the short SHA', () => {
  const failed = renderSummary(gateVerdict(all('success', { extension: 'failure' })));
  assert.ok(failed.startsWith('CI gate: failed'), failed);
  assert.ok(failed.includes('| Job | Result |'), failed);
  assert.ok(failed.includes('| extension | failure |'), failed);
  assert.ok(failed.includes('| changes | success |'), failed);

  const passed = renderSummary(gateVerdict(all('skipped', { changes: 'success' })));
  assert.ok(passed.startsWith('CI gate: passed'), passed);
  assert.equal((passed.match(/\| skipped \|/g) || []).length, 6, passed);
  // A docs-only PR's summary names each skipped job, not just a count.
  for (const job of ['test-fast', 'test-slow', 'cdp', 'extension', 'extension-e2e', 'docker']) assert.ok(passed.includes(`| ${job} | skipped |`), `${job}: ${passed}`);
  assert.ok(passed.includes('| changes | success |'), passed);

  const sup = renderSummary(gateVerdict(all('success', { 'test-fast': 'cancelled' }), { superseded: true }), { prHeadSha: SHA_B });
  assert.ok(sup.startsWith(`CI gate: superseded by ${SHA_B.slice(0, 7)}`), sup);
  assert.ok(sup.includes('(no verdict)'), sup);
  assert.ok(sup.includes('| test-fast | cancelled |'), sup);
});

// The CLI: the exit code is the contract the workflow step relies on.
const cli = (env) => spawnSync(process.execPath, [SCRIPT], {
  encoding: 'utf8',
  env: { PATH: process.env.PATH, GITHUB_STEP_SUMMARY: '', ...env },
});

test('CLI: NEEDS unset or not JSON exits 2 with a hint', () => {
  const unset = cli({});
  assert.equal(unset.status, 2, unset.stderr);
  assert.match(unset.stderr, /NEEDS is not set/);
  const bad = cli({ NEEDS: '{not json' });
  assert.equal(bad.status, 2, bad.stderr);
  assert.match(bad.stderr, /NEEDS is not set or not JSON/);
});

test('CLI: all success exits 0, one failure exits 1', () => {
  const ok = cli({ NEEDS: JSON.stringify(all('success')), EVENT_NAME: 'push', RUN_SHA: SHA_A });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /CI gate: passed/);
  const fail = cli({ NEEDS: JSON.stringify(all('success', { extension: 'failure' })), EVENT_NAME: 'push', RUN_SHA: SHA_A });
  assert.equal(fail.status, 1, fail.stdout + fail.stderr);
  assert.match(fail.stdout, /\| extension \| failure \|/);
});

test('CLI: a cancelled run always exits 1; a superseded one says so in its heading', () => {
  const NEEDS = JSON.stringify(all('success', { 'test-fast': 'cancelled' }));
  const hand = cli({ NEEDS, EVENT_NAME: 'pull_request', RUN_SHA: SHA_A, PR_HEAD_SHA: SHA_A });
  assert.equal(hand.status, 1, 'hand-cancel on the PR head fails');
  const sup = cli({ NEEDS, EVENT_NAME: 'pull_request', RUN_SHA: SHA_A, PR_HEAD_SHA: SHA_B });
  // Red even when superseded: a green gate on the old SHA could satisfy the required check if
  // that SHA becomes the PR head again (a force-push back) before its own run reports.
  assert.equal(sup.status, 1, sup.stdout + sup.stderr);
  assert.match(sup.stdout, /CI gate: superseded by 0123456/);
  const lookupFailed = cli({ NEEDS, EVENT_NAME: 'pull_request', RUN_SHA: SHA_A, PR_HEAD_SHA: '' });
  assert.equal(lookupFailed.status, 1, 'a failed PR-head lookup never excuses a cancel');
  const push = cli({ NEEDS, EVENT_NAME: 'push', RUN_SHA: SHA_A, PR_HEAD_SHA: SHA_B });
  assert.equal(push.status, 1, 'a cancelled dev push fails');
});

test('CLI: appends the summary to GITHUB_STEP_SUMMARY', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-gate-'));
  try {
    const file = join(dir, 'summary.md');
    writeFileSync(file, 'earlier step\n');
    const r = cli({ NEEDS: JSON.stringify(all('success', { extension: 'failure' })), EVENT_NAME: 'push', RUN_SHA: SHA_A, GITHUB_STEP_SUMMARY: file });
    assert.equal(r.status, 1);
    const text = readFileSync(file, 'utf8');
    assert.ok(text.startsWith('earlier step\n'), 'appended, not overwritten');
    assert.match(text, /CI gate: failed/);
    assert.match(text, /\| Job \| Result \|/);
    assert.match(text, /\| extension \| failure \|/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const importSpecs = (src) => [...src.matchAll(/(?:^|\n)\s*import\s[^'"]*?['"]([^'"]+)['"]/g), ...src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);

test('tools/ci-gate.mjs imports only node: builtins plus ./quarantine.mjs, which imports only node: (the gate job runs no npm ci)', () => {
  const specs = importSpecs(readFileSync(SCRIPT, 'utf8'));
  assert.ok(specs.length > 0, 'found the imports');
  assert.deepEqual(specs.filter((s) => !s.startsWith('node:') && s !== './quarantine.mjs'), []);
  const q = importSpecs(readFileSync(fileURLToPath(new URL('../tools/quarantine.mjs', import.meta.url)), 'utf8'));
  assert.ok(q.length > 0, 'found quarantine.mjs imports');
  assert.deepEqual(q.filter((s) => !s.startsWith('node:')), [], 'tools/quarantine.mjs imports only node: builtins');
});

// ── Failing test files in the gate summary (R-po-6) ─────────────────────────────────────────
// Each fast or slow shard that goes red writes one failure record { version, tier, shard, node, files }
// (tools/test.mjs --failures-out); the gate reads them and names each shard and file, marking the
// files on the base branch's quarantine list.
const rec = (tier, node, shard, files) => ({ version: 1, tier, shard, node, files });
const helper = (name) => {
  assert.equal(typeof gate[name], 'function', `tools/ci-gate.mjs exports ${name}`);
  return gate[name];
};
const UI = 'test/ui-ship-words.test.mjs';
const GIT = 'test/git-sync.test.mjs';

test('failureLines: two shard records, both lines in job order', () => {
  const failureLines = helper('failureLines');
  const lines = failureLines([rec('slow', '24.11.0', '1/2', [GIT]), rec('fast', '24.11.0', '3/4', [UI])]);
  assert.deepEqual(lines, [
    'fast (Node 24, shard 3/4): `test/ui-ship-words.test.mjs` failed',
    'slow (Node 24, shard 1/2): `test/git-sync.test.mjs` failed',
  ]);
});

test('R-po-6 example: the gate summary reads "fast (Node 24, shard 3…): `test/ui-ship-words.test.mjs` failed"', () => {
  const failureLines = helper('failureLines');
  const verdict = gateVerdict(all('success', { 'test-fast': 'failure' }));
  const lines = failureLines([rec('fast', '24.11.0', '3/4', [UI])], { needs: all('success', { 'test-fast': 'failure' }) });
  const summary = renderSummary(verdict, { lines });
  assert.match(summary, /^- fast \(Node 24, shard 3\/4\): `test\/ui-ship-words\.test\.mjs` failed$/m, summary);
});

test('failureLines orders Node 22.19.0 before 24 before 26 and shard 2/4 before 10/12', () => {
  const failureLines = helper('failureLines');
  const lines = failureLines([
    rec('fast', '26.0.0', '1/4', ['test/c.test.mjs']),
    rec('fast', '24.11.0', '10/12', ['test/e.test.mjs']),
    rec('fast', '22.19.0', '1/4', ['test/a.test.mjs']),
    rec('fast', '24.11.0', '2/4', ['test/d.test.mjs']),
    rec('all', '24.11.0', '1/1', ['test/f.test.mjs']),
    rec('slow', '24.11.0', '2/2', ['test/b.test.mjs', 'test/a.test.mjs']),
  ]);
  assert.deepEqual(lines, [
    'fast (Node 22, shard 1/4): `test/a.test.mjs` failed',
    'fast (Node 24, shard 2/4): `test/d.test.mjs` failed',
    'fast (Node 24, shard 10/12): `test/e.test.mjs` failed',
    'fast (Node 26, shard 1/4): `test/c.test.mjs` failed',
    'slow (Node 24, shard 2/2): `test/a.test.mjs` failed',
    'slow (Node 24, shard 2/2): `test/b.test.mjs` failed',
    'all (Node 24, shard 1/1): `test/f.test.mjs` failed',
  ]);
});

test('failureLines marks a file on the quarantine list', () => {
  const failureLines = helper('failureLines');
  const lines = failureLines([rec('fast', '24.11.0', '3/4', [UI, 'test/b.test.mjs'])], { quarantined: new Set([UI]) });
  assert.deepEqual(lines, [
    'fast (Node 24, shard 3/4): `test/b.test.mjs` failed',
    'fast (Node 24, shard 3/4): `test/ui-ship-words.test.mjs` failed (quarantined)',
  ]);
});

test('failureLines: an empty record and a failed job with no record', () => {
  const failureLines = helper('failureLines');
  const needs = all('success', { 'test-fast': 'failure', 'test-slow': 'failure' });
  assert.deepEqual(failureLines([rec('fast', '24.11.0', '3/4', [])], { needs }), [
    'fast (Node 24, shard 3/4): failed, no failing test file recorded (see the job log)',
    'test-slow: failure, no failing test file recorded (see the job log)',
  ]);
  assert.deepEqual(failureLines([], { needs }), [
    'test-fast: failure, no failing test file recorded (see the job log)',
    'test-slow: failure, no failing test file recorded (see the job log)',
  ]);
  assert.deepEqual(failureLines([], { needs: all('success', { 'test-fast': 'cancelled', extension: 'failure' }) }), [],
    'a cancelled test job, or another failed job, gets no line');
  assert.deepEqual(failureLines([]), [], 'no records, no needs: no lines');
});

test('readFailureRecords reads subfolders and skips bad records', () => {
  const readFailureRecords = helper('readFailureRecords');
  const dir = mkdtempSync(join(tmpdir(), 'ci-gate-failures-'));
  try {
    // download-artifact puts each artifact in its own folder.
    mkdirSync(join(dir, 'test-failures-1-fast-24-3'));
    mkdirSync(join(dir, 'test-failures-1-slow-1'));
    mkdirSync(join(dir, 'test-failures-1-fast-26-2'));
    writeFileSync(join(dir, 'test-failures-1-fast-24-3', 'fast-24-3.json'), JSON.stringify(rec('fast', '24.11.0', '3/4', [UI])));
    writeFileSync(join(dir, 'test-failures-1-slow-1', 'slow-1.json'), JSON.stringify(rec('slow', '24.11.0', '1/2', [GIT])));
    writeFileSync(join(dir, 'test-failures-1-fast-26-2', 'bad-shape.json'), JSON.stringify({ version: 2, tier: 'fast', shard: '2/4', node: '26.0.0', files: [] }));
    writeFileSync(join(dir, 'garbage.json'), '{ not json');
    writeFileSync(join(dir, 'notes.txt'), 'not a record');
    const { records, unreadable } = readFailureRecords(dir);
    assert.deepEqual(records.map((r) => r.shard).sort(), ['1/2', '3/4']);
    assert.deepEqual(records.find((r) => r.tier === 'fast'), rec('fast', '24.11.0', '3/4', [UI]));
    assert.equal(unreadable.length, 2, JSON.stringify(unreadable));
    assert.ok(unreadable.some((f) => String(f).includes('garbage.json')), JSON.stringify(unreadable));
    assert.ok(unreadable.some((f) => String(f).includes('bad-shape.json')), JSON.stringify(unreadable));
    for (const bad of [
      { version: 1, tier: 'medium', shard: '1/4', node: '24', files: [] },
      { version: 1, tier: 'fast', shard: '3', node: '24', files: [] },
      { version: 1, tier: 'fast', shard: '3/4', node: 24, files: [] },
      { version: 1, tier: 'fast', shard: '3/4', node: '24', files: [1] },
      { version: 1, tier: 'fast', shard: '3/4', node: '24' },
    ]) {
      const one = mkdtempSync(join(tmpdir(), 'ci-gate-bad-'));
      try {
        writeFileSync(join(one, 'r.json'), JSON.stringify(bad));
        const got = readFailureRecords(one);
        assert.deepEqual(got.records, [], JSON.stringify(bad));
        assert.equal(got.unreadable.length, 1, JSON.stringify(bad));
      } finally { rmSync(one, { recursive: true, force: true }); }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.deepEqual(readFailureRecords(join(tmpdir(), 'ci-gate-no-such-dir-' + process.pid)), { records: [], unreadable: [] });
  const empty = mkdtempSync(join(tmpdir(), 'ci-gate-empty-'));
  try { assert.deepEqual(readFailureRecords(empty), { records: [], unreadable: [] }); } finally { rmSync(empty, { recursive: true, force: true }); }
});

test('quarantinedTests: the test paths of ROOT/test/quarantine.json; a missing list is empty', () => {
  const quarantinedTests = helper('quarantinedTests');
  const root = mkdtempSync(join(tmpdir(), 'ci-gate-quarantine-'));
  try {
    assert.deepEqual([...quarantinedTests(root)], []);
    mkdirSync(join(root, 'test'));
    writeFileSync(join(root, 'test', 'quarantine.json'), JSON.stringify({ entries: [
      { path: UI, reason: 'flaky', exitCondition: 'green 20x' },
      { path: 'e2e/extension/x.spec.mjs', reason: 'flaky', exitCondition: 'green 20x' },
    ] }));
    assert.deepEqual([...quarantinedTests(root)], [UI]);
    writeFileSync(join(root, 'test', 'quarantine.json'), '{ not json');
    assert.throws(() => quarantinedTests(root), /not valid JSON/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('renderSummary: lines only on a failed verdict', () => {
  const lines = ['fast (Node 24, shard 3/4): `test/ui-ship-words.test.mjs` failed'];
  const failedV = gateVerdict(all('success', { 'test-fast': 'failure' }));
  const failed = renderSummary(failedV, { lines });
  const table = renderSummary(failedV).split('\n').slice(2).join('\n');
  assert.equal(failed, ['CI gate: failed', '', '### Failing tests', '', '- ' + lines[0], ''].join('\n') + '\n' + table);
  assert.ok(failed.indexOf('### Failing tests') < failed.indexOf('| Job | Result |'), failed);
  assert.equal(renderSummary(failedV, { lines: [] }), renderSummary(failedV), 'no lines: the slice-1 output');

  const passedV = gateVerdict(all('success'));
  assert.equal(renderSummary(passedV, { lines }), renderSummary(passedV), 'a passed gate shows no failing section');
  const supV = gateVerdict(all('success', { 'test-fast': 'cancelled' }), { superseded: true });
  assert.equal(renderSummary(supV, { prHeadSha: SHA_B, lines }), renderSummary(supV, { prHeadSha: SHA_B }), 'superseded: unchanged');
});

// A FAILURES_DIR as download-artifact leaves it, and a BASE_QUARANTINE_ROOT holding test/quarantine.json.
const gateFixture = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-gate-cli-'));
  try {
    const failures = join(dir, 'test-failures');
    mkdirSync(join(failures, 'test-failures-1-fast-24-3'), { recursive: true });
    writeFileSync(join(failures, 'test-failures-1-fast-24-3', 'fast-24-3.json'), JSON.stringify(rec('fast', '24.11.0', '3/4', [UI, 'test/b.test.mjs'])));
    const base = join(dir, 'base-quarantine');
    mkdirSync(join(base, 'test'), { recursive: true });
    writeFileSync(join(base, 'test', 'quarantine.json'), JSON.stringify({ entries: [{ path: UI, reason: 'flaky', exitCondition: 'green 20x' }] }));
    return fn({ dir, failures, base });
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('CLI: a red shard record lands in GITHUB_STEP_SUMMARY', () => gateFixture(({ dir, failures, base }) => {
  const file = join(dir, 'summary.md');
  const r = cli({ NEEDS: JSON.stringify(all('success', { 'test-fast': 'failure' })), EVENT_NAME: 'pull_request', RUN_SHA: SHA_A, PR_HEAD_SHA: SHA_A,
    GITHUB_STEP_SUMMARY: file, FAILURES_DIR: failures, BASE_QUARANTINE_ROOT: base });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const text = readFileSync(file, 'utf8');
  assert.match(text, /### Failing tests/);
  assert.ok(text.includes('- fast (Node 24, shard 3/4): `test/b.test.mjs` failed\n'), text);
  assert.ok(text.includes('- fast (Node 24, shard 3/4): `test/ui-ship-words.test.mjs` failed (quarantined)\n'), text);
  assert.match(text, /\| test-fast \| failure \|/);
}));

test('CLI: failure records and quarantine never change the exit code', () => gateFixture(({ failures, base }) => {
  const ok = cli({ NEEDS: JSON.stringify(all('success')), EVENT_NAME: 'push', RUN_SHA: SHA_A, FAILURES_DIR: failures, BASE_QUARANTINE_ROOT: base });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.doesNotMatch(ok.stdout, /Failing tests|ui-ship-words/);
  const fail = cli({ NEEDS: JSON.stringify(all('success', { extension: 'failure' })), EVENT_NAME: 'push', RUN_SHA: SHA_A, FAILURES_DIR: failures, BASE_QUARANTINE_ROOT: base });
  assert.equal(fail.status, 1, fail.stdout + fail.stderr);
  const NEEDS = JSON.stringify(all('success', { 'test-fast': 'cancelled' }));
  const sup = cli({ NEEDS, EVENT_NAME: 'pull_request', RUN_SHA: SHA_A, PR_HEAD_SHA: SHA_B, FAILURES_DIR: failures, BASE_QUARANTINE_ROOT: base });
  assert.equal(sup.status, 1, 'superseded keeps exit 1');
  assert.doesNotMatch(sup.stdout, /Failing tests/, 'superseded shows no failing section');
  assert.equal(cli({ FAILURES_DIR: failures, BASE_QUARANTINE_ROOT: base }).status, 2, 'NEEDS unset still exits 2');
}));

test('CLI: missing or garbage FAILURES_DIR and BASE_QUARANTINE_ROOT', () => gateFixture(({ dir, failures, base }) => {
  const NEEDS = JSON.stringify(all('success', { 'test-fast': 'failure' }));
  const missing = cli({ NEEDS, EVENT_NAME: 'push', RUN_SHA: SHA_A, FAILURES_DIR: join(dir, 'nope'), BASE_QUARANTINE_ROOT: join(dir, 'nope-either') });
  assert.equal(missing.status, 1, missing.stdout + missing.stderr);
  assert.ok(missing.stdout.includes('- test-fast: failure, no failing test file recorded (see the job log)'), missing.stdout);

  writeFileSync(join(failures, 'test-failures-1-fast-24-3', 'junk.json'), '{ half a record');
  writeFileSync(join(base, 'test', 'quarantine.json'), '{ not json');
  const garbage = cli({ NEEDS, EVENT_NAME: 'push', RUN_SHA: SHA_A, FAILURES_DIR: failures, BASE_QUARANTINE_ROOT: base });
  assert.equal(garbage.status, 1, garbage.stdout + garbage.stderr);
  assert.match(garbage.stderr, /ci-gate: .*junk\.json/, garbage.stderr);
  assert.match(garbage.stderr, /ci-gate: .*quarantine/, garbage.stderr);
  assert.ok(garbage.stdout.includes('- fast (Node 24, shard 3/4): `test/ui-ship-words.test.mjs` failed\n'), 'an unreadable list marks nothing: ' + garbage.stdout);
  assert.doesNotMatch(garbage.stdout, /\(quarantined\)/);

  const ok = cli({ NEEDS: JSON.stringify(all('success')), EVENT_NAME: 'push', RUN_SHA: SHA_A, FAILURES_DIR: failures, BASE_QUARANTINE_ROOT: base });
  assert.equal(ok.status, 0, 'garbage never turns a passing gate red: ' + ok.stderr);
}));
