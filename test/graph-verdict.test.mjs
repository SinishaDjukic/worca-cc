// test/graph-verdict.test.mjs — the verdict vocabulary, and protocol.mjs
// reading reviews through the shared core.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';
import * as verdict from '../src/shared/graph/verdict.mjs';
import * as protocol from '../src/core/protocol.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('severities, the blocking set and normalizeSeverity (trim, lowercase, default minor)', async () => {
  await checkRows([
    { name: 'severities and the blocking set', run: () => {
      assert.deepEqual(verdict.SEVERITIES, ['critical', 'major', 'minor', 'suggestion']);
      assert.deepEqual([...verdict.BLOCKING].sort(), ['critical', 'major']);
      assert.ok(verdict.SEVERITIES.slice(0, 2).every((s) => verdict.BLOCKING.has(s)));
      assert.ok(verdict.SEVERITIES.slice(2).every((s) => !verdict.BLOCKING.has(s)));
    } },
    { name: 'normalizeSeverity: trims, lowercases, defaults to minor', run: () => {
      assert.equal(verdict.normalizeSeverity('  CRITICAL '), 'critical');
      assert.equal(verdict.normalizeSeverity('Major'), 'major');
      assert.equal(verdict.normalizeSeverity('nonsense'), 'minor');
      for (const bad of [undefined, null, 3, {}, []]) assert.equal(verdict.normalizeSeverity(bad), 'minor');
    } },
  ]);
});

test('hasBlocking / blockingIssues read a review tolerantly', () => {
  const review = { issues: [{ severity: 'minor' }, { severity: ' Major ' }, { severity: 'suggestion' }] };
  assert.equal(verdict.hasBlocking(review), true);
  assert.deepEqual(verdict.blockingIssues(review), [{ severity: ' Major ' }]);
  assert.equal(verdict.hasBlocking({ issues: [{ severity: 'minor' }] }), false);
  assert.deepEqual(verdict.blockingIssues({ issues: [{ severity: 'minor' }] }), []);
  for (const bad of [null, undefined, {}, { issues: 'x' }]) {
    assert.equal(verdict.hasBlocking(bad), false);
    assert.deepEqual(verdict.blockingIssues(bad), []);
  }
  // An unknown severity normalizes to minor => never blocking.
  assert.equal(verdict.hasBlocking({ issues: [{ severity: 'catastrophic' }] }), false);
});

test('protocol.readReview still normalizes severities through the moved helper', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-verdict-'));
  const file = join(dir, 'review.json');
  await writeFile(file, JSON.stringify({ summary: 's', issues: [{ severity: 'CRITICAL', title: 't' }] }), 'utf8');
  const r = await protocol.readReview(file);
  assert.equal(r.issues[0].severity, 'critical');
  assert.equal(protocol.hasBlocking(r), true);
  await rm(dir, { recursive: true, force: true });
});

test('output-graded verdicts: resolved never blocks, an unverified fix under issues does, normalizeReview keeps resolved + lanes', async () => {
  await checkRows([
    { name: 'a verdict whose only major sits under resolved is clean', run: () => {
      const r = { issues: [], resolved: [{ severity: 'major', title: 'fixed and verified' }], summary: 'ok' };
      assert.equal(verdict.hasBlocking(r), false);
      assert.deepEqual(verdict.blockingIssues(r), []);
    } },
    { name: 'a fix applied but not verified, listed under issues, blocks', run: () => {
      const r = { issues: [{ severity: 'major', title: 'fix applied, not verified' }], resolved: [{ severity: 'major', title: 'other' }], summary: '' };
      assert.equal(verdict.hasBlocking(r), true);
      assert.equal(verdict.blockingIssues(r).length, 1);
    } },
    { name: 'normalizeReview keeps resolved (normalized items) and lanes (trimmed strings); issues stays the first key', run: () => {
      const n = protocol.normalizeReview({
        summary: ' s ', lanes: ['replay', ' suite ', 3, ''],
        resolved: [{ severity: 'MAJOR', title: ' t ', detail: 'd' }, 'junk', null],
        issues: [{ severity: 'minor', title: 'open' }],
      });
      assert.deepEqual(Object.keys(n), ['issues', 'summary', 'resolved', 'lanes']);
      assert.deepEqual(n.issues, [{ severity: 'minor', title: 'open', detail: '', location: '' }]);
      assert.deepEqual(n.resolved, [{ severity: 'major', title: 't', detail: 'd', location: '' }]);
      assert.deepEqual(n.lanes, ['replay', 'suite']);
      assert.equal(n.summary, 's');
    } },
    { name: 'absent, empty or malformed resolved/lanes are omitted (the clean-review pins stay byte-identical)', run: () => {
      assert.deepEqual(protocol.normalizeReview({ issues: [], summary: 'ok' }), { issues: [], summary: 'ok' });
      assert.deepEqual(protocol.normalizeReview({ issues: [], summary: 'ok', resolved: [], lanes: [] }), { issues: [], summary: 'ok' });
      assert.deepEqual(protocol.normalizeReview({ issues: [], summary: '', resolved: 'x', lanes: 'y' }), { issues: [], summary: '' });
      assert.deepEqual(protocol.normalizeReview({ issues: [], summary: '', resolved: ['junk'], lanes: [3, ' '] }), { issues: [], summary: '' });
    } },
    { name: 'readReview from a file keeps resolved + lanes and still gates on issues only', run: async () => {
      const dir = await mkdtemp(join(tmpdir(), 'worca-verdict-'));
      const file = join(dir, 'review.json');
      await writeFile(file, JSON.stringify({ issues: [], resolved: [{ severity: 'major', title: 'r' }], lanes: ['replay'], summary: 'clean' }), 'utf8');
      const r = await protocol.readReview(file);
      assert.equal(protocol.hasBlocking(r), false);
      assert.equal(r.resolved.length, 1);
      assert.deepEqual(r.lanes, ['replay']);
      await rm(dir, { recursive: true, force: true });
    } },
  ]);
});
