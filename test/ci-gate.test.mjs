// test/ci-gate.test.mjs — the verdict of ci.yml's `CI gate` job (tools/ci-gate.mjs).
// A covered job that fails or is cancelled fails the gate; `success` and `skipped` (a docs-only PR)
// pass it. A run superseded by a newer PR push gets its own summary heading but still exits 1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateVerdict, isSuperseded, renderSummary } from '../tools/ci-gate.mjs';

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

test('tools/ci-gate.mjs imports only node: builtins (the gate job runs no npm ci)', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  const specs = [...src.matchAll(/(?:^|\n)\s*import\s[^'"]*?['"]([^'"]+)['"]/g), ...src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  assert.ok(specs.length > 0, 'found the imports');
  assert.deepEqual(specs.filter((s) => !s.startsWith('node:')), []);
});
