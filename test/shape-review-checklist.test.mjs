import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';
import { hasBlocking } from '../src/shared/graph/verdict.mjs';
import {
  CHECKLIST_PR_MARKER,
  normalizeReviewChecklist,
  applyChecklist,
  checklistTally,
  checklistTallyText,
  latestChecklist,
  checklistMarkdown,
  checklistFindingsMarkdown,
  reviewChecklistBlock,
} from '../src/shared/shape/review-checklist.mjs';

const ITEMS = [
  { id: 'R-arch-1', perspective: 'architect', text: 'Stored as definitions.' },
  { id: 'R-qa-1', perspective: 'qa', text: 'Unknown metric rejected.' },
  { id: 'R-qa-2', perspective: 'qa', text: 'Pinned chart is listed.' },
];
const allMet = [
  { id: 'R-arch-1', status: 'met', evidence: 'a' },
  { id: 'R-qa-1', status: 'na', evidence: '' },
  { id: 'R-qa-2', status: 'met', evidence: 'b' },
];

test('normalizeReviewChecklist', async () => {
  await checkRows([
    { name: 'non-array gives null', run: () => assert.equal(normalizeReviewChecklist('nope'), null) },
    { name: 'status case and spaces', run: () => assert.deepEqual(
      normalizeReviewChecklist([{ id: 'R-qa-1', status: 'MET' }, { id: 'R-qa-2', status: ' met ' }]).map((c) => c.status), ['met', 'met']) },
    { name: 'na aliases', run: () => assert.deepEqual(
      normalizeReviewChecklist(['n/a', 'N.A.', 'not applicable'].map((s) => ({ id: 'R-qa-1', status: s }))).map((c) => c.status), ['na', 'na', 'na']) },
    { name: 'unknown status is unmet', run: () => assert.equal(normalizeReviewChecklist([{ id: 'R-qa-1', status: 'partial' }])[0].status, 'unmet') },
    { name: 'bad ids dropped', run: () => assert.deepEqual(
      normalizeReviewChecklist([{ id: 'R-x', status: 'met' }, { id: 'qa-1', status: 'met' }, { id: 5, status: 'met' }, null, 'x']), []) },
    { name: 'evidence one line and capped', run: () => {
      const [a, b] = normalizeReviewChecklist([
        { id: 'R-qa-1', status: 'met', evidence: 'line1\n  line2' },
        { id: 'R-qa-2', status: 'met', evidence: 'x'.repeat(900) }]);
      assert.equal(a.evidence, 'line1 line2');
      assert.equal(b.evidence.length, 500);
    } },
  ]);
});

test('applyChecklist', async () => {
  const titles = (v) => v.issues.map((i) => i.title);
  await checkRows([
    { name: 'unmet item', run: () => {
      const v = applyChecklist({ issues: [], summary: '', checklist: [
        { id: 'R-arch-1', status: 'met', evidence: 'a' }, { id: 'R-qa-1', status: 'unmet', evidence: 'no test' },
        { id: 'R-qa-2', status: 'na', evidence: '' }] }, ITEMS);
      assert.equal(v.issues.length, 1);
      assert.match(v.issues[0].title, /^R-qa-1 not met: /);
      assert.equal(v.issues[0].detail, 'no test');
      assert.equal(v.issues[0].severity, 'major');
      assert.ok(hasBlocking(v));
    } },
    { name: 'met without evidence', run: () => {
      for (const ev of ['', '   ']) {
        const v = applyChecklist({ issues: [], summary: '', checklist: [
          { id: 'R-arch-1', status: 'met', evidence: ev.trim() }, { id: 'R-qa-1', status: 'na', evidence: '' },
          { id: 'R-qa-2', status: 'na', evidence: '' }] }, ITEMS);
        assert.equal(v.issues.length, 1);
        assert.match(v.issues[0].title, /marked met without evidence$/);
        assert.ok(hasBlocking(v));
      }
    } },
    { name: 'na without evidence is fine', run: () => {
      const v = applyChecklist({ issues: [], summary: '', checklist: allMet }, ITEMS);
      assert.deepEqual(v.issues, []);
      assert.ok(!hasBlocking(v));
    } },
    { name: 'checklist absent: one major naming all ids', run: () => {
      const v = applyChecklist({ issues: [], summary: '', checklist: null }, ITEMS);
      assert.equal(v.issues.length, 1);
      assert.equal(v.issues[0].title, 'Perspective checklist missing from the review');
      for (const it of ITEMS) assert.ok(v.issues[0].detail.includes(it.id));
      assert.deepEqual(v.checklist.map((c) => c.status), ['missing', 'missing', 'missing']);
      assert.ok(hasBlocking(v));
    } },
    { name: 'no checklist key at all', run: () => {
      const v = applyChecklist({ issues: [], summary: '' }, ITEMS);
      assert.equal(v.issues.length, 1);
    } },
    { name: 'partial list', run: () => {
      const v = applyChecklist({ issues: [], summary: '', checklist: [{ id: 'R-arch-1', status: 'met', evidence: 'a' }] }, ITEMS);
      assert.deepEqual(titles(v), ['Checklist items not reported: R-qa-1, R-qa-2']);
      assert.deepEqual(v.checklist.map((c) => c.status), ['met', 'missing', 'missing']);
      assert.ok(hasBlocking(v));
    } },
    { name: 'unknown id ignored, duplicate first wins', run: () => {
      const v = applyChecklist({ issues: [], summary: '', checklist: [
        { id: 'R-sec-9', status: 'unmet', evidence: 'x' },
        { id: 'R-arch-1', status: 'met', evidence: 'first' }, { id: 'R-arch-1', status: 'unmet', evidence: 'second' },
        { id: 'R-qa-1', status: 'na', evidence: '' }, { id: 'R-qa-2', status: 'na', evidence: '' }] }, ITEMS);
      assert.deepEqual(v.issues, []);
      assert.equal(v.checklist[0].evidence, 'first');
      assert.equal(v.checklist.length, 3);
    } },
    { name: 'reviewer issues come first in order', run: () => {
      const own = [{ severity: 'minor', title: 'a', detail: '', location: '' }, { severity: 'major', title: 'b', detail: '', location: '' }];
      const v = applyChecklist({ issues: own, summary: 's', checklist: null }, ITEMS);
      assert.deepEqual(v.issues.slice(0, 2), own);
      assert.equal(v.issues.length, 3);
      assert.equal(v.summary, 's');
    } },
    { name: 'no items: no checklist key', run: () => {
      const v = applyChecklist({ issues: [], summary: 's', checklist: [{ id: 'R-qa-1', status: 'met', evidence: 'x' }] }, []);
      assert.deepEqual(Object.keys(v), ['issues', 'summary']);
      assert.deepEqual(Object.keys(applyChecklist({ issues: [], summary: '' }, undefined)), ['issues', 'summary']);
    } },
    { name: 'merged entries have exactly five keys', run: () => {
      const v = applyChecklist({ issues: [], summary: '', checklist: allMet }, ITEMS);
      for (const c of v.checklist) assert.deepEqual(Object.keys(c).sort(), ['evidence', 'id', 'perspective', 'status', 'text']);
    } },
  ]);
});

test('tally, tally text, latestChecklist', async () => {
  await checkRows([
    { name: 'tally counts', run: () => assert.deepEqual(
      checklistTally([{ status: 'met' }, { status: 'unmet' }, { status: 'na' }, { status: 'missing' }, { status: 'weird' }, null]),
      { met: 1, unmet: 1, na: 1, missing: 3, total: 6 }) },
    { name: 'text default', run: () => assert.equal(checklistTallyText({ met: 3, unmet: 1, na: 1, missing: 0 }), 'Checklist: 3 met · 1 unmet · 1 n/a') },
    { name: 'text prefix and missing suffix', run: () => assert.equal(
      checklistTallyText({ met: 1, unmet: 0, na: 0, missing: 2 }, { prefix: '' }), '1 met · 0 unmet · 0 n/a · 2 not reported') },
    { name: 'latest picks highest cycle with checklist', run: () => {
      const l = latestChecklist([
        { kind: 'impl', cycle: 1, checklist: [{ id: 'a' }] }, { kind: 'impl', cycle: 3, checklist: [] },
        { kind: 'impl', cycle: 2, checklist: [{ id: 'b' }] }, { kind: 'impl', cycle: 4 }]);
      assert.deepEqual(l, { kind: 'impl', cycle: 2, checklist: [{ id: 'b' }] });
    } },
    { name: 'latest null', run: () => { assert.equal(latestChecklist([]), null); assert.equal(latestChecklist(undefined), null); } },
  ]);
});

test('checklistMarkdown / findings / prompt block', async () => {
  await checkRows([
    { name: 'four row formats', run: () => {
      const md = checklistMarkdown([
        { id: 'R-qa-1', text: 'Rejects\nempty.', status: 'met', evidence: 'test x\npasses' },
        { id: 'R-ux-1', text: 'Screen', status: 'na', evidence: 'no UI' },
        { id: 'R-arch-1', text: 'Defs', status: 'unmet', evidence: 'in caller' },
        { id: 'R-qa-2', text: 'Listed', status: 'missing', evidence: '' }]);
      assert.equal(md, `${CHECKLIST_PR_MARKER}\n## Perspective checklist\n\n` +
        '- [x] **R-qa-1** Rejects empty. — test x passes\n' +
        '- [ ] ~~**R-ux-1** Screen~~ — Not applicable: no UI\n' +
        '- [ ] **R-arch-1** Defs — Not met: in caller\n' +
        '- [ ] **R-qa-2** Listed — Not reported by the review\n');
    } },
    { name: 'empty list', run: () => assert.equal(checklistMarkdown([]), '') },
    { name: 'findings markdown', run: () => {
      const md = checklistFindingsMarkdown([{ severity: 'major', title: 'T', detail: 'D', location: 'L' }]);
      assert.match(md, /^## Perspective checklist \(added by Worca\)/);
      assert.match(md, /- \*\*\[major\]\*\* T — D \(`L`\)/);
    } },
    { name: 'prompt block', run: () => {
      const b = reviewChecklistBlock(ITEMS);
      assert.match(b, /^## Perspective checklist/);
      assert.ok(b.includes('`R-arch-1` (Architect): Stored as definitions.'));
      assert.ok(b.includes('`R-qa-2` (QA): Pinned chart is listed.'));
      assert.equal(reviewChecklistBlock([]), '');
      assert.equal(reviewChecklistBlock(undefined), '');
    } },
  ]);
});

import { checklistScore } from '../src/shared/shape/review-checklist.mjs';

test('checklistScore: met over the items that apply (n/a left out, not reported counts against)', () => {
  assert.equal(checklistScore({ met: 12, unmet: 1, na: 3, missing: 1, total: 17 }), 'Checklist 12/14');
  assert.equal(checklistScore({ met: 2, unmet: 0, na: 0, missing: 0, total: 2 }), 'Checklist 2/2');
  assert.equal(checklistScore(null), 'Checklist 0/0');
});
