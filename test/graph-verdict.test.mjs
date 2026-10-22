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

test('normalizeReview keeps a reviewer checklist as a conditional key (spec D7)', async () => {
  assert.deepEqual(Object.keys(protocol.normalizeReview({ issues: [], summary: 's' })), ['issues', 'summary']);
  const withList = protocol.normalizeReview({ issues: [], summary: 's', checklist: [{ id: 'R-qa-1', status: 'met', evidence: 'x' }] });
  assert.deepEqual(withList.checklist, [{ id: 'R-qa-1', status: 'met', evidence: 'x' }]);
  assert.equal(Object.hasOwn(protocol.normalizeReview({ issues: [], summary: 's', checklist: 'nope' }), 'checklist'), false);
});

test('readVerdict returns a checklist the file carries (spec D7)', async () => {
  const { readVerdict } = await import('../src/core/graph/exec-io.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-verdict-cl-'));
  try {
    const file = join(dir, 'v.json');
    await writeFile(file, JSON.stringify({ issues: [], summary: 's', checklist: [{ id: 'R-qa-1', status: 'na', evidence: 'r' }] }), 'utf8');
    const v = await readVerdict(file);
    assert.deepEqual(v.checklist, [{ id: 'R-qa-1', status: 'na', evidence: 'r' }]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
