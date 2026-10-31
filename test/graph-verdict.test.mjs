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

test('severities, the blocking set and normalizeSeverity (trim, lowercase, aliases, default major)', async () => {
  await checkRows([
    { name: 'severities and the blocking set', run: () => {
      assert.deepEqual(verdict.SEVERITIES, ['critical', 'major', 'minor', 'suggestion']);
      assert.deepEqual([...verdict.BLOCKING].sort(), ['critical', 'major']);
      assert.ok(verdict.SEVERITIES.slice(0, 2).every((s) => verdict.BLOCKING.has(s)));
      assert.ok(verdict.SEVERITIES.slice(2).every((s) => !verdict.BLOCKING.has(s)));
    } },
    { name: 'normalizeSeverity: trims, lowercases, defaults to major (E7: silence is not approval)', run: () => {
      assert.equal(verdict.normalizeSeverity('  CRITICAL '), 'critical');
      assert.equal(verdict.normalizeSeverity('Major'), 'major');
      // A misspelled or new severity blocks: it costs at most one bounded fix cycle,
      // while reading "high" as minor could ship a SQL injection unreviewed.
      for (const v of ['nonsense', 'catastrophic', 'majr', 'medium', 'error', '', 1, {}, [], undefined, null, { level: 'critical' }]) {
        assert.equal(verdict.normalizeSeverity(v), 'major', JSON.stringify(v));
      }
    } },
    { name: 'normalizeSeverity: a small alias table', run: () => {
      for (const v of ['blocker', 'P0', 'severe', 'fatal']) assert.equal(verdict.normalizeSeverity(v), 'critical', v);
      for (const v of ['high', 'p1', 'important']) assert.equal(verdict.normalizeSeverity(v), 'major', v);
      for (const v of ['low', 'nit', 'nitpick', 'p3', 'trivial']) assert.equal(verdict.normalizeSeverity(v), 'minor', v);
      for (const v of ['info', 'suggest', 'optional']) assert.equal(verdict.normalizeSeverity(v), 'suggestion', v);
    } },
    { name: 'isKnownSeverity: the four values and the aliases only', run: () => {
      assert.equal(verdict.isKnownSeverity(' Minor '), true);
      assert.equal(verdict.isKnownSeverity('high'), true);
      assert.equal(verdict.isKnownSeverity('nonsense'), false);
      assert.equal(verdict.isKnownSeverity(undefined), false);
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
  // An unknown severity normalizes to major => blocking (E7).
  assert.equal(verdict.hasBlocking({ issues: [{ severity: 'catastrophic' }] }), true);
  assert.equal(verdict.hasBlocking({ issues: [{ title: 'no severity at all' }] }), true);
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

test('normalizeReview: closed issues (status fixed/resolved/wontfix) leave `issues` for a `closed` list (1.3)', () => {
  const r = protocol.normalizeReview({ summary: 's', issues: [
    { severity: 'critical', title: 'open one' },
    { severity: 'critical', title: 'was fixed', status: 'fixed' },
    { severity: 'major', title: 'resolved', status: ' Resolved ' },
    { severity: 'major', title: 'won\'t fix', status: 'wontfix' },
    { severity: 'major', title: 'still open', status: 'open' },
  ] });
  assert.deepEqual(r.issues.map((i) => i.title), ['open one', 'still open']);
  assert.deepEqual(r.closed.map((i) => [i.title, i.status]), [['was fixed', 'fixed'], ['resolved', 'resolved'], ["won't fix", 'wontfix']]);
  assert.equal(protocol.hasBlocking({ issues: [{ severity: 'critical', status: 'fixed' }].filter(() => false) }), false);
  // No closed issues: no key (the shape every existing caller compares).
  assert.equal(Object.hasOwn(protocol.normalizeReview({ issues: [], summary: '' }), 'closed'), false);
});

test('normalizeReview: a top-level reject verdict with no blocking issue blocks (1.3)', () => {
  for (const word of ['reject', 'rejected', 'fail', 'failed', 'changes_requested', 'Request Changes']) {
    const r = protocol.normalizeReview({ verdict: word, issues: [] });
    assert.equal(protocol.hasBlocking(r), true, word);
    assert.match(r.issues[0].title, /verdict/i);
  }
  assert.equal(protocol.hasBlocking(protocol.normalizeReview({ verdict: 'approve', issues: [] })), false);
  // A reject that already lists a blocking issue gets no synthetic one.
  const listed = protocol.normalizeReview({ verdict: 'reject', issues: [{ severity: 'major', title: 'x' }] });
  assert.equal(listed.issues.length, 1);
});

test('readVerdict: only a direct parse or ONE fenced block (1.4); unknown severities are reported', async () => {
  const { readVerdict } = await import('../src/core/graph/exec-io.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-verdict-strict-'));
  try {
    const example = join(dir, 'example.json');
    await writeFile(example, 'Schema example: {"issues":[]}\nReal: {"issues":[{"severity":"critical","title":"sqli"}]}', 'utf8');
    await assert.rejects(() => readVerdict(example), (e) => e.code === 'BAD_VERDICT');
    const twoFences = join(dir, 'two.json');
    await writeFile(twoFences, '```json\n{"issues":[]}\n```\nthen\n```json\n{"issues":[{"severity":"critical"}]}\n```', 'utf8');
    await assert.rejects(() => readVerdict(twoFences), (e) => e.code === 'BAD_VERDICT');
    const oneFence = join(dir, 'one.json');
    await writeFile(oneFence, 'Here it is:\n```json\n{"issues":[{"severity":"high","title":"t"}]}\n```\n', 'utf8');
    const v = await readVerdict(oneFence);
    assert.equal(v.issues[0].severity, 'major');
    const unknown = join(dir, 'unknown.json');
    await writeFile(unknown, JSON.stringify({ issues: [{ severity: 'catastrophic', title: 'a' }, { severity: 'minor', title: 'b' }] }), 'utf8');
    const u = await readVerdict(unknown);
    assert.equal(u.issues[0].severity, 'major');
    assert.deepEqual(u.unknownSeverities, ['catastrophic']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
