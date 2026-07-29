// test/results-assemble.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketFiles, selectKeyChecks, splitNitpicks, linkIssues, assembleResults }
  from '../src/core/results.mjs';

test('bucketFiles splits new vs changed and sums lines', () => {
  const ns = [
    { status: 'A', path: 'src/new.ts' },
    { status: 'M', path: 'src/mod.ts' },
    { status: 'D', path: 'src/del.ts' },
    { status: 'R', from: 'src/old.ts', path: 'src/ren.ts' },
  ];
  const num = new Map([
    ['src/new.ts', { added: 10, removed: 0, binary: false }],
    ['src/mod.ts', { added: 3, removed: 2, binary: false }],
    ['src/ren.ts', { added: 1, removed: 1, binary: false }],
  ]);
  const b = bucketFiles(ns, num);
  assert.deepEqual(b.newFiles.map((f) => f.path), ['src/new.ts']);
  assert.equal(b.counts.filesNew, 1);
  assert.equal(b.counts.filesChanged, 3); // M + D + R
  assert.equal(b.counts.filesDeleted, 1);
  assert.equal(b.counts.linesAdded, 14);
  assert.equal(b.counts.linesRemoved, 3);
  const ren = b.changedFiles.find((f) => f.status === 'R');
  assert.equal(ren.from, 'src/old.ts');
});

test('selectKeyChecks keeps latest cycle, critical+major, sorted, deduped', () => {
  const reviews = [
    { kind: 'impl', cycle: 1, issues: [{ severity: 'major', title: 'old', detail: '', location: '' }], summary: '' },
    { kind: 'impl', cycle: 2, issues: [
        { severity: 'major', title: 'B', detail: 'd', location: 'src/x.ts:1' },
        { severity: 'critical', title: 'A', detail: 'd', location: '' },
        { severity: 'minor', title: 'nit', detail: '', location: '' },
      ], summary: '' },
    { kind: 'plan', cycle: 1, issues: [{ severity: 'major', title: 'B', detail: 'd', location: '' }], summary: '' },
  ];
  const checks = selectKeyChecks(reviews);
  assert.deepEqual(checks.map((c) => c.title), ['A', 'B']); // critical first, dedup B across kinds
  assert.equal(checks.find((c) => c.title === 'B').kind, 'impl,plan'); // cross-kind tag
  assert.ok(checks.every((c) => c.id));
  assert.ok(!checks.some((c) => c.title === 'old')); // cycle 1 superseded
});

test('splitNitpicks returns only minor+suggestion of latest cycle', () => {
  const reviews = [{ kind: 'impl', cycle: 2, issues: [
    { severity: 'minor', title: 'nit', detail: '', location: '' },
    { severity: 'critical', title: 'A', detail: '', location: '' },
  ], summary: '' }];
  const nits = splitNitpicks(reviews);
  assert.deepEqual(nits.map((n) => n.title), ['nit']);
});

test('linkIssues attaches file to check and issue id to changedFile', () => {
  const checks = [{ id: 'i1', severity: 'major', title: 'B', detail: '', location: 'src/x.ts:1', kind: 'impl' }];
  const files = { changedFiles: [{ path: 'src/x.ts', status: 'M', issues: [] }], newFiles: [] };
  linkIssues(checks, files);
  assert.equal(checks[0].file, 'src/x.ts');
  assert.deepEqual(files.changedFiles[0].issues, ['i1']);
});

test('assembleResults is deterministic (byte-identical)', () => {
  const input = {
    nameStatus: [{ status: 'A', path: 'a.ts' }, { status: 'M', path: 'b.ts' }],
    numstat: new Map([['a.ts', { added: 2, removed: 0, binary: false }], ['b.ts', { added: 1, removed: 1, binary: false }]]),
    reviews: [{ kind: 'impl', cycle: 1, issues: [{ severity: 'critical', title: 'X', detail: 'd', location: 'b.ts:1' }], summary: '' }],
  };
  const r1 = JSON.stringify(assembleResults(input));
  const r2 = JSON.stringify(assembleResults(input));
  assert.equal(r1, r2);
  const r = assembleResults(input);
  assert.equal(r.summary.blockingIssues, 1);
  assert.equal(r.summary.filesNew, 1);
  assert.equal(r.keyThingsToCheck[0].file, 'b.ts'); // linked
});
