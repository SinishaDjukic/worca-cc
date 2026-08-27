// test/graph-verdict.test.mjs — the verdict vocabulary, and the proof that
// protocol.mjs and the shared core are ONE source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as verdict from '../src/shared/graph/verdict.mjs';
import * as protocol from '../src/core/protocol.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('severities and the blocking set', () => {
  assert.deepEqual(verdict.SEVERITIES, ['critical', 'major', 'minor', 'suggestion']);
  assert.deepEqual([...verdict.BLOCKING].sort(), ['critical', 'major']);
  assert.ok(verdict.SEVERITIES.slice(0, 2).every((s) => verdict.BLOCKING.has(s)));
  assert.ok(verdict.SEVERITIES.slice(2).every((s) => !verdict.BLOCKING.has(s)));
});

test('normalizeSeverity: trims, lowercases, defaults to minor', () => {
  assert.equal(verdict.normalizeSeverity('  CRITICAL '), 'critical');
  assert.equal(verdict.normalizeSeverity('Major'), 'major');
  assert.equal(verdict.normalizeSeverity('nonsense'), 'minor');
  for (const bad of [undefined, null, 3, {}, []]) assert.equal(verdict.normalizeSeverity(bad), 'minor');
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

test('protocol.mjs re-exports the SAME function objects (one source, no copy)', () => {
  assert.equal(protocol.hasBlocking, verdict.hasBlocking);
  assert.equal(protocol.blockingIssues, verdict.blockingIssues);
  assert.equal(protocol.normalizeSeverity, verdict.normalizeSeverity);
  assert.equal(protocol.SEVERITIES, verdict.SEVERITIES);
  assert.equal(protocol.BLOCKING, verdict.BLOCKING);
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
