// test/design-probe-stats.test.mjs — the Design P2 probe recipe in tools/ask-capture-fixtures.mjs (plan Task 1).
// R1 asks whether a long Write.content reaches us gradually: the statistic is byte-weighted, because an early
// file_path chunk followed by a held value looks gradual by chunk count alone (L2.18). The live probe itself
// runs by hand with WORCA_ALLOW_LIVE_CLAUDE=1 (M14); nothing here spawns the real CLI.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toolInputChunkStats, probeVerdict, selectScenarios, SCENARIOS, runCaptureTurn } from '../tools/ask-capture-fixtures.mjs';

const se = (event) => ({ type: 'stream_event', event, parent_tool_use_id: null });
const start = se({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't1', name: 'Write', input: {} } });
const chunk = (s) => se({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: s } });
const stop = se({ type: 'content_block_stop', index: 1 });

test('even chunks read as gradual', () => {
  const body = Array.from({ length: 10 }, () => 'x'.repeat(100));
  const arrivals = [0, ...body.map((_, i) => 1000 * (i + 1)), 11000];
  const [t] = toolInputChunkStats([start, ...body.map(chunk), stop], arrivals).tools;
  assert.deepEqual([t.name, t.chunks, t.bytes, t.blockMs, t.largestGapMs], ['Write', 10, 1000, 11000, 1000]);
  assert.ok(t.spreadRatio >= 0.5);
  assert.equal(probeVerdict(t), 'gradual');
});
test('a held value released at the end reads as coarse, though the first chunk was early', () => {
  const big = Array.from({ length: 9 }, () => 'x'.repeat(2000));
  const frames = [start, chunk('{"file_path":"/a.html","content":"'), ...big.map(chunk), stop];
  const arrivals = [0, 100, ...big.map((_, i) => 9000 + i), 9010];
  const [t] = toolInputChunkStats(frames, arrivals).tools;
  assert.ok(t.spreadRatio < 0.01);
  assert.equal(probeVerdict(t), 'coarse');
  assert.equal(t.toolUseId, 't1');
  assert.equal(t.largestGapMs, 8900);
  assert.equal(t.firstContentMs, 9000, 'the first byte of the content VALUE, not the early file_path chunk');
});
test('a block with no bytes is unknown; empty chunks do not count', () => {
  const [t] = toolInputChunkStats([start, chunk(''), stop], [0, 1, 2]).tools;
  assert.deepEqual([t.chunks, t.spreadRatio], [0, null]);
  assert.equal(probeVerdict(t), 'unknown');
  assert.deepEqual([0.5, 0.49].map((spreadRatio) => probeVerdict({ spreadRatio })), ['gradual', 'coarse']);
});
test('a sub-agent tool input is not the main thread', () => {
  const sub = (f) => ({ ...f, parent_tool_use_id: 'toolu_task' });
  const { tools } = toolInputChunkStats([start, chunk('x'), stop].map(sub), [0, 1, 2]);
  assert.deepEqual(tools, []);
});
test('writesPerPath counts whole tool calls', () => {
  const a = { type: 'assistant', parent_tool_use_id: null, message: { content: [
    { type: 'tool_use', id: 'a', name: 'Write', input: { file_path: '/a.html', content: 'x' } },
    { type: 'tool_use', id: 'b', name: 'Edit', input: { file_path: '/a.html', old_string: 'x', new_string: 'y' } }] } };
  assert.deepEqual(toolInputChunkStats([a], [0]).writesPerPath, { '/a.html': { write: 1, edit: 1 } });
});
test('a bare capture never spends on the design scenarios', () => {
  assert.ok(selectScenarios(SCENARIOS, { only: null }).every((s) => s.recipe !== 'design'));
  assert.deepEqual(selectScenarios(SCENARIOS, { only: 'design-long-write' }).map((s) => s.name), ['design-long-write']);
  assert.deepEqual(SCENARIOS.filter((s) => s.recipe === 'design').map((s) => s.name), ['design-long-write', 'design-overwrite-no-read', 'design-many-edits']);
});

test('the design scenarios carry the probe flags and a one-attempt timeout', () => {
  const design = SCENARIOS.filter((s) => s.recipe === 'design');
  for (const s of design) assert.deepEqual([s.timeoutMs, s.maxBudgetUsd], [300000, 2], s.name);
  assert.deepEqual(design.find((s) => s.name === 'design-overwrite-no-read').seed, { 'page.html': '<p>old</p>\n' });
  const many = design.find((s) => s.name === 'design-many-edits').prompt;
  for (const re of [/one `?Write`?/i, /top-down/i, /one root/i, /style\.css/, /script\.js/, /relative to work/i, /no external urls/i, /end with one line/i, /Section id: pricing\./]) assert.match(many, re);
});

test('each design check reads the frames it is meant to', () => {
  const byName = Object.fromEntries(SCENARIOS.map((s) => [s.name, s]));
  const use = (id, name, input) => ({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id, name, input }] } });
  const res = (id, content, isError) => ({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: id, content, ...(isError ? { is_error: true } : {}) }] } });
  // long-write: one Write of at least 15000 characters, else the capture fails
  assert.throws(() => byName['design-long-write'].check([use('w', 'Write', { file_path: '/p.html', content: 'x'.repeat(14999) })], {}), /15000/);
  assert.doesNotThrow(() => byName['design-long-write'].check([use('w', 'Write', { file_path: '/p.html', content: 'x'.repeat(15000) })], {}));
  // overwrite-no-read: never throws, records the Write's result
  const refused = {};
  byName['design-overwrite-no-read'].check([use('w', 'Write', { file_path: '/p.html', content: 'new' }), res('w', 'File has not been read yet.', true)], refused);
  assert.deepEqual(refused.overwrite, { isError: true, text: 'File has not been read yet.' });
  const allowed = {};
  byName['design-overwrite-no-read'].check([use('w', 'Write', { file_path: '/p.html', content: 'new' }), res('w', [{ type: 'text', text: 'ok' }], false)], allowed);
  assert.deepEqual(allowed.overwrite, { isError: false, text: 'ok' });
  const none = {};
  assert.doesNotThrow(() => byName['design-overwrite-no-read'].check([], none));
  assert.deepEqual(none.overwrite, { isError: null, text: null });
  // many-edits: records writesPerPath; a tool_use id seen twice is one call
  const m = {};
  const edit = use('c', 'Edit', { file_path: '/i.html', old_string: 'y', new_string: 'z' });
  byName['design-many-edits'].check([use('a', 'Write', { file_path: '/i.html', content: 'x' }), use('b', 'Edit', { file_path: '/i.html', old_string: 'x', new_string: 'y' }), edit, edit], m);
  assert.deepEqual(m.writesPerPath, { '/i.html': { write: 1, edit: 2 } });
});

const POSIX = process.platform === 'win32' ? { skip: 'POSIX shell fixture' } : {};
const dir = mkdtempSync(join(tmpdir(), 'worca-probe-stats-'));
after(() => rmSync(dir, { recursive: true, force: true }));

test('a capture turn records one arrival time per raw frame, never decreasing', POSIX, async () => {
  const bin = join(dir, 'claude');
  writeFileSync(bin, `#!/bin/sh
echo '{"type":"system","subtype":"init","session_id":"s1","model":"m"}'
echo 'not json, so not a frame'
sleep 0.1
echo '{"type":"assistant","message":{"id":"m1","content":[{"type":"text","text":"hi"}]}}'
echo '{"type":"result","subtype":"success","result":"hi","total_cost_usd":0}'
echo 'stderr line' 1>&2
`);
  chmodSync(bin, 0o755);
  const arrivals = [];
  const { frames } = await runCaptureTurn({ bin, cwd: dir, prompt: 'P', systemPrompt: 'S', permissionMode: 'dontAsk' }, { arrivals });
  assert.equal(arrivals.length, frames.length);
  assert.equal(frames.length, 3);
  assert.ok(arrivals.every((ms, i) => Number.isFinite(ms) && ms >= 0 && (i === 0 || ms >= arrivals[i - 1])), JSON.stringify(arrivals));
});
