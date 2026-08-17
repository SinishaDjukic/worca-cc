// test/log-line.test.mjs
// Pure, DOM-free unit test of the log-line presentation helpers (mirrors
// composer-ui): className, clipboard serialization, and cycle separators.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  logLineClass, logLineTime, logLineText, serializeLog, cycleSeparatorBefore,
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
// `prevCycle` is the cycle of the last RENDERED record that HAD one — callers
// carry it past cycle-less notices (artifact events, git/orchestrator lines)
// that land exactly at rewind boundaries and must not mask them.

test('cycleSeparatorBefore labels a cycle boundary', () => {
  assert.equal(cycleSeparatorBefore(1, { cycle: 2 }), 'Cycle 2');
});
test('cycleSeparatorBefore returns null within one cycle', () => {
  assert.equal(cycleSeparatorBefore(2, { cycle: 2 }), null);
});
test('no leading header: null prevCycle (nothing cycled rendered yet) yields null', () => {
  assert.equal(cycleSeparatorBefore(null, { cycle: 1 }), null);
  assert.equal(cycleSeparatorBefore(null, { cycle: 2 }), null);
});
test('a cycle-less record never triggers a separator', () => {
  assert.equal(cycleSeparatorBefore(1, { text: 'artifact: review.md' }), null);
  assert.equal(cycleSeparatorBefore(1, null), null);
});
test('a cycle-less notice AT the boundary does not mask the separator', () => {
  let prev = null;
  const seq = [{ cycle: 1, text: 'work' }, { text: 'artifact: review.md' }, { cycle: 2, text: 're-run' }];
  const seps = seq.map((rec) => {
    const s = cycleSeparatorBefore(prev, rec);
    if (rec.cycle != null) prev = rec.cycle;
    return s;
  });
  assert.deepEqual(seps, [null, null, 'Cycle 2']);
});
test('cycleSeparatorBefore compares as strings so 2 and "2" agree', () => {
  assert.equal(cycleSeparatorBefore(2, { cycle: '2' }), null);
  assert.equal(cycleSeparatorBefore('1', { cycle: 2 }), 'Cycle 2');
});

// ── NDJSON projection ───────────────────────────────────────────────────────

test('projectLogRecord keeps cycle and stream — the axes the pickers/separators need', () => {
  const rec = projectLogRecord({
    source: 'implementer', level: 'warn', text: '429, retrying', ts: TS,
    sub: false, stepIndex: 3, cycle: 2, stream: 'err', nodeId: 'n1',
  });
  assert.deepEqual(rec, {
    source: 'implementer', level: 'warn', text: '429, retrying', ts: TS,
    sub: false, stepIndex: 3, cycle: 2, stream: 'err',
  });
});

test('projectLogRecord leaves absent attribution absent (no undefined keys)', () => {
  const rec = projectLogRecord({ source: 'git', level: 'info', text: 'x', ts: TS });
  assert.deepEqual(Object.keys(rec).sort(), ['level', 'source', 'sub', 'text', 'ts']);
});
