// test/outcome.test.mjs — the pure run-outcome collector (slice 1 of "flag runs that
// finished without doing the work"). No I/O, no engine imports: just facts → outcome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UNMET_ORDER,
  stepExpectations,
  computeOutcome,
  reasonLine,
  outcomeSuccessful,
} from '../src/core/outcome.mjs';
import { checkRows } from './helpers/rows.mjs';

test('computeOutcome: empty list is successful; any unmet fact fails', async () => {
  await checkRows([
    { name: 'empty list ⇒ successful, null reason', run: () => {
      assert.deepEqual(computeOutcome([]), { successful: true, reason: null });
    } },
    { name: 'non-array ⇒ successful (defensive)', run: () => {
      assert.deepEqual(computeOutcome(null), { successful: true, reason: null });
      assert.deepEqual(computeOutcome(undefined), { successful: true, reason: null });
    } },
    { name: 'one fact ⇒ unsuccessful with a reason naming the step', run: () => {
      const r = computeOutcome([{ nodeId: 'impl', step: 'Implementation', kind: 'no-code-change' }]);
      assert.equal(r.successful, false);
      assert.match(r.reason, /Implementation/);
    } },
  ]);
});

test('stepExpectations: missing-output (empty + absent) and missing-verdict', async () => {
  await checkRows([
    { name: 'absent required output ⇒ missing-output absent', run: () => {
      const out = stepExpectations({
        nodeId: 'plan', step: 'Planning',
        requiredMissing: [{ port: 'plan', empty: false }],
      });
      assert.equal(out.length, 1);
      assert.equal(out[0].kind, 'missing-output');
      assert.equal(out[0].detail, 'plan:absent');
    } },
    { name: '0-byte required output ⇒ missing-output empty', run: () => {
      const out = stepExpectations({
        nodeId: 'plan', step: 'Planning',
        requiredMissing: [{ port: 'plan', empty: true }],
      });
      assert.equal(out[0].detail, 'plan:empty');
    } },
    { name: 'declared-but-missing verdict ⇒ missing-verdict', run: () => {
      const out = stepExpectations({ nodeId: 'rev', step: 'Review', verdictMissing: true });
      assert.equal(out.length, 1);
      assert.equal(out[0].kind, 'missing-verdict');
    } },
    { name: 'nothing missing ⇒ no items', run: () => {
      assert.deepEqual(stepExpectations({ nodeId: 'x', step: 'X' }), []);
    } },
  ]);
});

test('reasonLine: wording per kind, single-line, ≤300 chars, keeps (+N more)', async () => {
  await checkRows([
    { name: 'partial-fanout names "3 of 7 tasks"', run: () => {
      const r = reasonLine({ nodeId: 'd', step: 'Decompose', kind: 'partial-fanout', detail: '3 of 7 tasks' });
      assert.match(r, /Decompose completed only 3 of 7 tasks\./);
    } },
    { name: 'review-blocking names "2 blocking issues"', run: () => {
      const r = reasonLine({ nodeId: 'rev', step: 'Review', kind: 'review-blocking', detail: '2 blocking issues' });
      assert.match(r, /2 blocking issues/);
    } },
    { name: 'missing-output (absent) names the port', run: () => {
      const r = reasonLine({ nodeId: 'plan', step: 'Planning', kind: 'missing-output', detail: 'plan:absent' });
      assert.match(r, /Planning's required output \(plan\) was never written\./);
    } },
    { name: 'missing-output (empty) says empty', run: () => {
      const r = reasonLine({ nodeId: 'plan', step: 'Planning', kind: 'missing-output', detail: 'plan:empty' });
      assert.match(r, /was empty\./);
    } },
    { name: 'missing-verdict wording', run: () => {
      const r = reasonLine({ nodeId: 'rev', step: 'Review', kind: 'missing-verdict' });
      assert.match(r, /Review never produced its verdict\./);
    } },
    { name: 'no-code-change wording', run: () => {
      const r = reasonLine({ nodeId: 'i', step: 'Implementation', kind: 'no-code-change' });
      assert.match(r, /Implementation produced no changes to the worktree\./);
    } },
    { name: 'end-not-reached wording', run: () => {
      const r = reasonLine({ nodeId: 'i', step: 'Implementation', kind: 'end-not-reached' });
      assert.match(r, /Implementation finished without reaching its end/);
    } },
    { name: 'single line, no newlines', run: () => {
      const r = reasonLine({ nodeId: 'i', step: 'Imp\nlementation', kind: 'no-code-change' });
      assert.ok(!r.includes('\n'));
    } },
    { name: 'long head truncates to ≤300 keeping (+N more)', run: () => {
      const longStep = 'X'.repeat(400);
      const items = [
        { nodeId: 'a', step: longStep, kind: 'no-code-change' },
        { nodeId: 'b', step: 'Other', kind: 'missing-verdict' },
        { nodeId: 'c', step: 'Third', kind: 'end-not-reached' },
      ];
      const r = reasonLine(items[0], items);
      assert.ok(r.length <= 300, `len=${r.length}`);
      assert.match(r, /\(\+2 more unmet expectations\)$/);
    } },
    { name: 'one extra ⇒ singular suffix', run: () => {
      const items = [
        { nodeId: 'a', step: 'A', kind: 'no-code-change' },
        { nodeId: 'b', step: 'B', kind: 'missing-verdict' },
      ];
      const r = reasonLine(items[0], items);
      assert.match(r, /\(\+1 more unmet expectation\)$/);
    } },
  ]);
});

test('computeOutcome: UNMET_ORDER picks the headline cause', async () => {
  await checkRows([
    { name: 'no-code-change outranks end-not-reached', run: () => {
      const r = computeOutcome([
        { nodeId: 'g', step: 'The run', kind: 'end-not-reached' },
        { nodeId: 'i', step: 'Implementation', kind: 'no-code-change' },
      ]);
      assert.equal(r.successful, false);
      assert.match(r.reason, /Implementation produced no changes/);
      assert.match(r.reason, /\(\+1 more unmet expectation\)$/);
    } },
    { name: 'UNMET_ORDER head is no-code-change', run: () => {
      assert.equal(UNMET_ORDER[0], 'no-code-change');
    } },
  ]);
});

test('outcomeSuccessful: null ⇒ true; {successful:false} ⇒ false', async () => {
  await checkRows([
    { name: 'null ⇒ true', run: () => assert.equal(outcomeSuccessful(null), true) },
    { name: 'undefined ⇒ true', run: () => assert.equal(outcomeSuccessful(undefined), true) },
    { name: '{successful:true} ⇒ true', run: () => assert.equal(outcomeSuccessful({ successful: true }), true) },
    { name: '{successful:false} ⇒ false', run: () => assert.equal(outcomeSuccessful({ successful: false }), false) },
    { name: 'missing successful key ⇒ true', run: () => assert.equal(outcomeSuccessful({ reason: 'x' }), true) },
  ]);
});
