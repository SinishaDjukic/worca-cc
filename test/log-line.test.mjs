// test/log-line.test.mjs
// Pure, DOM-free unit test of the log-line presentation helpers (mirrors
// composer-ui): className, clipboard serialization, and cycle separators.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  logLineClass, logLineTime, logLineText, serializeLog, cycleSeparatorBefore,
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

// ── cycle separators ────────────────────────────────────────────────────────

test('cycleSeparatorBefore labels a cycle boundary', () => {
  assert.equal(cycleSeparatorBefore({ cycle: 1 }, { cycle: 2 }), 'Cycle 2');
  assert.equal(cycleSeparatorBefore({ cycle: 2 }, { cycle: 3 }), 'Cycle 3');
});

test('cycleSeparatorBefore returns null within one cycle', () => {
  assert.equal(cycleSeparatorBefore({ cycle: 2 }, { cycle: 2 }), null);
});

test('cycleSeparatorBefore draws no leading header on the first rendered line', () => {
  assert.equal(cycleSeparatorBefore(null, { cycle: 1 }), null);
  assert.equal(cycleSeparatorBefore(undefined, { cycle: 2 }), null,
    'even when the pane opens mid-run on cycle 2 — nothing above it to separate from');
});

test('cycleSeparatorBefore ignores cycle-less records on either side', () => {
  assert.equal(cycleSeparatorBefore({ cycle: 1 }, { text: 'orchestrator notice' }), null);
  assert.equal(cycleSeparatorBefore({ text: 'orchestrator notice' }, { cycle: 2 }), null);
  assert.equal(cycleSeparatorBefore(null, null), null);
});

test('cycleSeparatorBefore compares as strings so 2 and "2" agree', () => {
  assert.equal(cycleSeparatorBefore({ cycle: 2 }, { cycle: '2' }), null);
  assert.equal(cycleSeparatorBefore({ cycle: '1' }, { cycle: 2 }), 'Cycle 2');
});
