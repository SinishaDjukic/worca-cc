// test/log-line.test.mjs
// Pure, DOM-free unit test of the log-line presentation helpers (mirrors
// composer-ui): className, clipboard serialization, and cycle separators.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  logLineClass, logLineTime, logLineText, serializeLog, cycleSeparatorBefore, newCycleState,
  projectLogRecord,
} from '../ui/public/log-line.mjs';

test('sub=true adds the sub-agent class', () => {
  assert.equal(logLineClass('info', true), 'log-line lvl-info sub-agent');
});
test('sub=false omits the sub-agent class', () => {
  assert.equal(logLineClass('debug', false), 'log-line lvl-debug');
});
test('missing level defaults to info', () => {
  assert.equal(logLineClass(undefined, false), 'log-line lvl-info');
});

// ── clipboard serialization ─────────────────────────────────────────────────

// A fixed local wall-clock instant, so the expected hh:mm:ss is timezone-proof.
const TS = new Date(2026, 7, 17, 14, 5, 9).toISOString();

test('logLineTime renders local hh:mm:ss, zero-padded', () => {
  assert.equal(logLineTime(TS), '14:05:09');
  assert.equal(logLineTime(new Date(2026, 0, 1, 3, 4, 5).getTime()), '03:04:05');
});

test('logLineText renders "<ts> [source] text", the order the DOM line uses', () => {
  assert.equal(logLineText({ ts: TS, source: 'planner', text: 'Planning.' }), '14:05:09 [planner] Planning.');
});

test('logLineText keeps the sub-agent source tag verbatim', () => {
  assert.equal(
    logLineText({ ts: TS, source: 'planner ▸ research auth', text: '← result ok r1' }),
    '14:05:09 [planner ▸ research auth] ← result ok r1',
  );
});

test('logLineText tolerates a missing source / text', () => {
  assert.equal(logLineText({ ts: TS, text: 'no source' }), '14:05:09 no source');
  assert.equal(logLineText({ ts: TS, source: 'git' }), '14:05:09 [git] ');
  assert.equal(logLineText(null), '');
});

test('serializeLog joins records with newlines and skips holes', () => {
  const out = serializeLog([
    { ts: TS, source: 'planner', text: 'a' },
    null,
    { ts: TS, source: 'planner', text: 'b' },
  ]);
  assert.equal(out, '14:05:09 [planner] a\n14:05:09 [planner] b');
  assert.equal(serializeLog([]), '');
  assert.equal(serializeLog(undefined), '');
});

test('serializeLog draws the same cycle rules the pane renders', () => {
  const text = serializeLog([
    { ts: TS, source: 'reviewer', text: 'blocking issue', cycle: 1 },
    { ts: TS, source: 'artifact', text: 'review: r.md' },            // cycle-less boundary notice
    { ts: TS, source: 'implementer', text: 'fixing', cycle: 2 },
  ]);
  assert.deepEqual(text.split('\n'), [
    '14:05:09 [reviewer] blocking issue',
    '14:05:09 [artifact] review: r.md',
    '── Cycle 2 ──',
    '14:05:09 [implementer] fixing',
  ]);
});

test('serializeLog emits no separator for a single-cycle or cycle-less sequence', () => {
  assert.doesNotMatch(serializeLog([{ ts: TS, text: 'a', cycle: 2 }, { ts: TS, text: 'b', cycle: 2 }]), /Cycle/);
  assert.doesNotMatch(serializeLog([{ ts: TS, text: 'a' }, { ts: TS, text: 'b' }]), /Cycle/);
});

// ── cycle separators ────────────────────────────────────────────────────────
// v2 `cycle` is the PER-NODE ordinal, so the cursor is a per-node map, not one
// scalar: a rule is drawn only when a node's own ordinal EXCEEDS the highest it
// has already rendered. The map also carries the reader past cycle-less notices
// (artifact events, git/orchestrator lines) that land exactly at a boundary.
const seps = (recs) => { const st = newCycleState(); return recs.map((r) => cycleSeparatorBefore(st, r)); };

test('cycleSeparatorBefore labels a node re-running at a higher ordinal', () => {
  assert.deepEqual(seps([{ cycle: 1 }, { cycle: 2 }]), [null, 'Cycle 2']);
});
test('cycleSeparatorBefore returns null within one cycle', () => {
  assert.deepEqual(seps([{ cycle: 2 }, { cycle: 2 }]), [null, null]);
});
test('no leading header: the first cycled record of a node yields null', () => {
  assert.deepEqual(seps([{ cycle: 1 }]), [null]);
  assert.deepEqual(seps([{ cycle: 2 }]), [null]);
});
test('a cycle-less record never triggers a separator', () => {
  const st = newCycleState();
  assert.equal(cycleSeparatorBefore(st, { text: 'artifact: review.md' }), null);
  assert.equal(cycleSeparatorBefore(st, null), null);
});
test('a cycle-less notice AT the boundary does not mask the separator', () => {
  assert.deepEqual(
    seps([{ cycle: 1, text: 'work' }, { text: 'artifact: review.md' }, { cycle: 2, text: 're-run' }]),
    [null, null, 'Cycle 2'],
  );
});
test('cycleSeparatorBefore coerces so 2 and "2" agree', () => {
  assert.deepEqual(seps([{ cycle: 2 }, { cycle: '2' }]), [null, null]);
  assert.deepEqual(seps([{ cycle: '1' }, { cycle: 2 }]), [null, 'Cycle 2']);
});

// ── MIN-37: the ordinal is per NODE ─────────────────────────────────────────
test('MIN-37: interleaved concurrent nodes at different ordinals draw NO separator', () => {
  // R-P6b's case: a loop re-fired n_impl (ordinal 2) while the parallel n_test
  // is still on its first execution. Zero rewinds happened between these lines.
  const lines = [
    { source: 'implementer', text: 'patching a.js', nodeId: 'n_impl', executionId: 'x:n_impl:2', cycle: 2 },
    { source: 'tester', text: 'running suite', nodeId: 'n_test', executionId: 'x:n_test:1', cycle: 1 },
    { source: 'implementer', text: 'patching b.js', nodeId: 'n_impl', executionId: 'x:n_impl:2', cycle: 2 },
    { source: 'tester', text: '12 passed', nodeId: 'n_test', executionId: 'x:n_test:1', cycle: 1 },
    { source: 'implementer', text: 'done', nodeId: 'n_impl', executionId: 'x:n_impl:2', cycle: 2 },
  ];
  assert.deepEqual(seps(lines), [null, null, null, null, null]);
  assert.doesNotMatch(serializeLog(lines), /Cycle/, 'the clipboard copy agrees');
});

test('MIN-37: a node re-running gets exactly one rule, and a later node at ordinal 1 gets none', () => {
  // The shipped seed shape: the refiner self-loop re-fires, then the
  // implementer starts its FIRST execution.
  const lines = [
    { ts: TS, source: 'refiner', text: 'refining', nodeId: 'n_refine', cycle: 1 },
    { ts: TS, source: 'refiner', text: 'refining again', nodeId: 'n_refine', cycle: 2 },
    { ts: TS, source: 'implementer', text: 'implementing', nodeId: 'n_impl', cycle: 1 },
  ];
  assert.deepEqual(seps(lines), [null, 'Cycle 2', null]);
  assert.deepEqual(serializeLog(lines).split('\n'), [
    '14:05:09 [refiner] refining',
    '── Cycle 2 ──',
    '14:05:09 [refiner] refining again',
    '14:05:09 [implementer] implementing',
  ]);
});

test('MIN-37: a LOWER ordinal for the same node never draws a rule', () => {
  // A rewind only ever moves forward. An out-of-order record (a History replay
  // seeding a pane the live socket is already feeding) must not invent one.
  assert.deepEqual(seps([{ nodeId: 'a', cycle: 1 }, { nodeId: 'a', cycle: 3 }, { nodeId: 'a', cycle: 2 }, { nodeId: 'a', cycle: 4 }]),
    [null, 'Cycle 3', null, 'Cycle 4']);
});

test('MIN-37: one node\'s ordinals are independent of another\'s', () => {
  assert.deepEqual(seps([
    { nodeId: 'a', cycle: 1 }, { nodeId: 'b', cycle: 1 },
    { nodeId: 'a', cycle: 2 }, { nodeId: 'b', cycle: 2 },
    { nodeId: 'a', cycle: 2 }, { nodeId: 'b', cycle: 3 },
  ]), [null, null, 'Cycle 2', 'Cycle 2', null, 'Cycle 3']);
});

// ── NDJSON projection ───────────────────────────────────────────────────────

test('projectLogRecord keeps cycle, stream, nodeId and executionId — the axes the pickers/separators need', () => {
  const rec = projectLogRecord({
    source: 'implementer', level: 'warn', text: '429, retrying', ts: TS,
    sub: false, stepIndex: 3, cycle: 2, stream: 'err', nodeId: 'n1', executionId: 'x:n1:2', extra: 'dropped',
  });
  assert.deepEqual(rec, {
    source: 'implementer', level: 'warn', text: '429, retrying', ts: TS,
    sub: false, stepIndex: 3, cycle: 2, stream: 'err', nodeId: 'n1', executionId: 'x:n1:2',
  });
});

test('projectLogRecord leaves absent attribution absent (no undefined keys)', () => {
  const rec = projectLogRecord({ source: 'git', level: 'info', text: 'x', ts: TS });
  assert.deepEqual(Object.keys(rec).sort(), ['level', 'source', 'sub', 'text', 'ts']);
});
