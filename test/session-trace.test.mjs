// test/session-trace.test.mjs — the session trace: append-only, ordered, prompt-free, resumable, tamper-evident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSessionTrace, readTrace, readTraceSync, tracePath, traceRecordProblems, TRACE_KINDS, TRACE_FIELDS } from '../src/core/session-trace.mjs';

const SID = 's_k3f9a2b1';
const dir = () => mkdtempSync(join(tmpdir(), 'worca-trace-'));

test('append: v1 records, monotonic seq, the common ids, file under sessions/<sid>/', async () => {
  const d = dir();
  const t = createSessionTrace({ pipelineDir: d, sid: SID, runId: 'p1' });
  t.append('open', { hostEpoch: 1, hostSessionId: null, engine: 'claude', mode: 'subagents', transport: 'turns', hostModel: null, hostEffort: 'low', members: ['n_a', 'n_b'], label: 'One session' });
  t.append('turn_start', { hostEpoch: 1, hostSessionId: null, turnId: `t:${SID}:1`, resume: false, maxTurns: 4, maxBudgetUsd: null, hostModel: null, hostEffort: null });
  await t.close();
  assert.equal(t.path, tracePath(d, SID));
  assert.equal(t.path, join(d, 'sessions', SID, 'trace.ndjson'));
  const { records, torn, invalid, seqGaps } = await readTrace(t.path);
  assert.deepEqual([torn, invalid, seqGaps], [0, 0, 0]);
  assert.deepEqual(records.map((r) => [r.kind, r.seq, r.v, r.runId, r.sid]), [['open', 1, 1, 'p1', SID], ['turn_start', 2, 1, 'p1', SID]]);
  for (const r of records) assert.deepEqual(traceRecordProblems(r), []);
  assert.ok(TRACE_KINDS.includes('verdict'));
  assert.ok(TRACE_FIELDS.mode.includes('engine') && TRACE_FIELDS.restart.includes('engine'), 'minor 5');
  assert.deepEqual(readTraceSync(t.path).records, records);
});

test('privacy: a forbidden key or a long string never reaches the file', async () => {
  const d = dir();
  const t = createSessionTrace({ pipelineDir: d, sid: SID, runId: 'p1' });
  t.append('dispatch', { hostEpoch: 1, hostSessionId: 'H', turnId: 't', dispatchId: 'd', executionId: 'x:n_a:1', nodeId: 'n_a', attempt: 1, agentType: 'worca-x-n_a-1-a1', cold: false, queueMs: 0,
    prompt: 'SECRET BRIEF', detail: { content: 'SECRET' } });
  t.append('degrade', { hostEpoch: 0, hostSessionId: null, from: 'subagents', to: 'separate', reason: 'x'.repeat(500) });
  await t.close();
  const raw = readFileSync(t.path, 'utf8');
  assert.doesNotMatch(raw, /SECRET/);
  const { records } = await readTrace(t.path);
  assert.equal(records[1].reason.length, 200);
  assert.deepEqual(traceRecordProblems({ ...records[0], prompt: 'x' }), ['forbidden key prompt']);
});

test('a reopened trace continues seq; a torn last line is skipped and counted', async () => {
  const d = dir();
  const a = createSessionTrace({ pipelineDir: d, sid: SID, runId: 'p1' });
  a.append('resume', { hostEpoch: 1, hostSessionId: 'H', after: 'pause' });
  await a.close();
  appendFileSync(tracePath(d, SID), '{"v":1,"kind":"turn_st');          // a crash mid-append
  const b = createSessionTrace({ pipelineDir: d, sid: SID, runId: 'p1' });
  assert.equal(b.lastSeq(), 1);
  b.append('pause', { hostEpoch: 1, hostSessionId: 'H', turnId: null, dispatchId: null, reason: 'manual' });
  await b.close();
  const { records, torn } = await readTrace(tracePath(d, SID));
  assert.deepEqual(records.map((r) => r.seq), [1, 2]);
  assert.equal(torn, 1);
});

test('suggestion 2 — a forged or out-of-order line is skipped and counted, never reduced', async () => {
  const d = dir();
  const a = createSessionTrace({ pipelineDir: d, sid: SID, runId: 'p1' });
  a.append('resume', { hostEpoch: 1, hostSessionId: 'H', after: 'pause' });
  await a.close();
  appendFileSync(tracePath(d, SID), JSON.stringify({ v: 1, ts: '2026-10-28T10:00:00.000Z', seq: 2, kind: 'cost', runId: 'p1', sid: SID, hostEpoch: 1, hostSessionId: 'H', report: 'injected' }) + '\n');
  appendFileSync(tracePath(d, SID), JSON.stringify({ v: 1, ts: '2026-10-28T10:00:01.000Z', seq: 7, kind: 'resume', runId: 'p1', sid: SID, hostEpoch: 1, hostSessionId: 'H', after: 'crash' }) + '\n');
  const { records, invalid, seqGaps } = readTraceSync(tracePath(d, SID));
  assert.deepEqual(records.map((r) => r.seq), [1, 7]);
  assert.equal(invalid, 1);
  assert.equal(seqGaps, 1);
});

test('append never throws; a bad sid is refused at the path', () => {
  const t = createSessionTrace({ pipelineDir: dir(), sid: SID, runId: 'p1' });
  assert.equal(t.append('nope', {}), null);
  assert.throws(() => tracePath('/x', '../../etc'), /session id/);
});

// ── v2 ──
import { TRACE_VERSION, TRACE_FILE, parseTrace } from '../src/core/session-trace.mjs';
import { writeFileSync } from 'node:fs';
import { checkRows } from './helpers/rows.mjs';

test('v2 — the kinds and their allowed keys are pinned', () => {
  assert.deepEqual([TRACE_VERSION, TRACE_FILE], [1, 'trace.ndjson']);
  assert.deepEqual([...TRACE_KINDS], ['open', 'mode', 'degrade', 'turn_start', 'dispatch', 'member_bound', 'member_done', 'turn_end', 'cost',
    'reconcile', 'watchdog', 'rotate', 'restart', 'resume', 'pause', 'verdict', 'close']);
  assert.deepEqual(TRACE_FIELDS, {
    open: ['engine', 'mode', 'transport', 'hostModel', 'hostEffort', 'members', 'label'],
    mode: ['mode', 'requested', 'reason', 'engine', 'transport'],
    degrade: ['from', 'to', 'reason'],
    turn_start: ['turnId', 'resume', 'maxTurns', 'maxBudgetUsd', 'hostModel', 'hostEffort'],
    dispatch: ['turnId', 'dispatchId', 'executionId', 'nodeId', 'attempt', 'agentType', 'cold', 'queueMs'],
    member_bound: ['turnId', 'dispatchId', 'memberAgentId'],
    member_done: ['turnId', 'dispatchId', 'memberAgentId', 'memberTranscriptId', 'tokens', 'resolvedModel', 'durationMs', 'isError', 'errorClass'],
    turn_end: ['turnId', 'cumulativeUsd', 'deltaUsd', 'hostUsage', 'hostModel', 'numTurns', 'durationMs', 'exit', 'subtype'],
    cost: ['turnId', 'dispatchId', 'executionId', 'nodeId', 'memberUsd', 'hostOverheadUsd', 'costSource', 'hostPriced', 'overridden', 'carriedBy', 'cut'],
    reconcile: ['turnId', 'dispatchId', 'ok', 'checks'],
    watchdog: ['turnId', 'dispatchId', 'code', 'level', 'detail'],
    rotate: ['reason', 'fromSessionId', 'fromEpoch', 'dispatches', 'contextTokens', 'epochCheck'],
    restart: ['reason', 'fromSessionId', 'engine', 'transport', 'epochCheck'],
    resume: ['after'],
    pause: ['turnId', 'dispatchId', 'reason', 'cutTokens'],
    verdict: ['dispatchId', 'executionId', 'nodeId', 'verdict', 'issues'],
    close: ['status', 'costUsd', 'memberUsd', 'hostOverheadUsd', 'turns', 'dispatches', 'rotations', 'restarts', 'wallMs', 'activeMs', 'tokens', 'reconciled', 'epochChecks'],
  });
});

test('v2 — traceRecordProblems: one row per check', async () => {
  const ok = { v: 1, ts: '2026-10-28T10:00:00.000Z', seq: 1, kind: 'resume', runId: 'p1', sid: SID, hostEpoch: 1, hostSessionId: 'H', after: 'pause' };
  assert.deepEqual(traceRecordProblems(ok), []);
  const { after, ...base } = ok;
  await checkRows([
    { name: 'not an object', run: () => { assert.deepEqual(traceRecordProblems(null), ['not an object']); assert.deepEqual(traceRecordProblems([1]), ['not an object']); } },
    { name: 'unknown kind', run: () => assert.deepEqual(traceRecordProblems({ ...base, kind: 'nope' }), ['unknown kind nope']) },
    { name: 'version', run: () => assert.deepEqual(traceRecordProblems({ ...ok, v: 2 }), ['bad v']) },
    { name: 'seq 0 and 1.5', run: () => { assert.deepEqual(traceRecordProblems({ ...ok, seq: 0 }), ['bad seq']); assert.deepEqual(traceRecordProblems({ ...ok, seq: 1.5 }), ['bad seq']); } },
    { name: 'ts', run: () => { assert.deepEqual(traceRecordProblems({ ...ok, ts: 'yesterday' }), ['bad ts']); assert.deepEqual(traceRecordProblems({ ...ok, ts: 5 }), ['bad ts']); } },
    { name: 'unknown top-level key', run: () => assert.deepEqual(traceRecordProblems({ ...ok, turnId: 't' }), ['unknown key turnId']) },
    { name: 'a common key is allowed on every kind', run: () => assert.deepEqual(traceRecordProblems({ ...ok, hostEpoch: 2, hostSessionId: null }), []) },
    { name: 'forbidden key at depth', run: () => assert.deepEqual(traceRecordProblems({ ...base, kind: 'watchdog', detail: { a: [{ output: 'x' }] } }), ['forbidden key output']) },
    { name: 'long string at depth', run: () => assert.deepEqual(traceRecordProblems({ ...base, kind: 'watchdog', detail: { a: ['y'.repeat(201)] } }), ['string over 200 characters']) },
    { name: 'a 200-character string is fine', run: () => assert.deepEqual(traceRecordProblems({ ...ok, after: 'y'.repeat(200) }), []) },
  ]);
});

test('v2 — append: forbidden keys go at any depth (counted), stamped keys cannot be forged, absent common ids are null; it returns the record as written', async () => {
  const d = dir();
  const t = createSessionTrace({ pipelineDir: d, sid: SID, runId: 'p1', now: () => '2026-10-28T10:00:00.000Z' });
  const rec = t.append('watchdog', { turnId: 't', code: 'x', level: 'warn', detail: { text: 'SECRET', keep: 1, list: [{ content: 'SECRET', ok: 'y'.repeat(300) }] },
    v: 9, ts: 'forged', seq: 99, kind: 'cost', runId: 'other', sid: 's_zzzzzzzz' });
  assert.deepEqual(rec, { v: 1, ts: '2026-10-28T10:00:00.000Z', seq: 1, kind: 'watchdog', runId: 'p1', sid: SID, hostEpoch: null, hostSessionId: null,
    turnId: 't', code: 'x', level: 'warn', detail: { keep: 1, list: [{ ok: 'y'.repeat(200) }] } });
  assert.equal(t.dropped(), 8);
  await t.flush();
  assert.doesNotMatch(readFileSync(t.path, 'utf8'), /SECRET/);
  const { records, invalid } = readTraceSync(t.path);
  assert.deepEqual([records.length, invalid], [1, 0]);
  assert.deepEqual(records[0], rec);
  const nan = t.append('turn_end', { turnId: 't', deltaUsd: NaN, cumulativeUsd: Infinity, hostModel: undefined, durationMs: 5 });   // v3
  assert.deepEqual([nan.deltaUsd, nan.cumulativeUsd, 'hostModel' in nan, nan.durationMs], [null, null, false, 5], 'the record as the file holds it');
  await t.flush();
  assert.deepEqual(readTraceSync(t.path).records[1], nan);
});

test('v2 — writes keep seq order; a missing file reads empty; a failed write never throws', async () => {
  const d = dir();
  const t = createSessionTrace({ pipelineDir: d, sid: SID, runId: 'p1' });
  for (let i = 0; i < 40; i += 1) t.append('pause', { hostEpoch: 1, hostSessionId: 'H', turnId: null, dispatchId: null, reason: `r${i}` });
  await t.flush();
  const { records, seqGaps } = readTraceSync(t.path);
  assert.deepEqual(records.map((r) => r.reason), Array.from({ length: 40 }, (_, i) => `r${i}`));
  assert.equal(seqGaps, 0);
  assert.equal(t.lastSeq(), 40);
  assert.deepEqual(await readTrace(join(d, 'nope.ndjson')), { records: [], torn: 0, invalid: 0, seqGaps: 0 });
  assert.deepEqual(readTraceSync(join(d, 'nope.ndjson')), { records: [], torn: 0, invalid: 0, seqGaps: 0 });
  const file = join(d, 'a-file');
  writeFileSync(file, 'x');
  const bad = createSessionTrace({ pipelineDir: file, sid: SID, runId: 'p1' });   // sessions/ cannot be made under a file
  assert.equal(bad.append('resume', { after: 'x' }).seq, 1);
  await bad.flush();
  assert.equal(bad.writeErrors(), 1);
});

test('v2 — parseTrace counts torn, invalid and gaps; tracePath refuses anything but a session id', () => {
  const line = (seq) => JSON.stringify({ v: 1, ts: '2026-10-28T10:00:00.000Z', seq, kind: 'resume', runId: 'p1', sid: SID, hostEpoch: 1, hostSessionId: 'H', after: 'x' });
  assert.deepEqual(parseTrace(`${line(1)}\n\n{torn\n42\n${line(2)}\n${line(4)}\n`), { records: parseTrace(`${line(1)}\n${line(2)}\n${line(4)}`).records, torn: 1, invalid: 1, seqGaps: 1 });
  assert.equal(parseTrace('').records.length, 0);
  for (const bad of ['s_ABCDEFGH', 's_abc', 7, null]) assert.throws(() => tracePath('/x', bad), /session id/);
});

// ── v3 ──
test('v3 — a reopen continues after the LAST record with a seq; a read error other than a missing file is thrown', async () => {
  const d = dir();
  const a = createSessionTrace({ pipelineDir: d, sid: SID, runId: 'p1' });
  for (const after of ['a', 'b', 'c']) a.append('resume', { hostEpoch: 1, hostSessionId: 'H', after });
  await a.close();
  appendFileSync(tracePath(d, SID), '{"note":"no seq"}\n');
  assert.equal(createSessionTrace({ pipelineDir: d, sid: SID, runId: 'p1' }).lastSeq(), 3);
  await assert.rejects(readTrace(d), { code: 'EISDIR' });
  assert.throws(() => readTraceSync(d), { code: 'EISDIR' });
  const long = createSessionTrace({ pipelineDir: d, sid: 's_bbbbbbbb', runId: 'r'.repeat(300) });
  const lr = long.append('resume', { hostEpoch: 'e'.repeat(300), hostSessionId: 'h'.repeat(300), after: 'x' });
  assert.deepEqual([lr.runId.length, lr.hostEpoch.length, lr.hostSessionId.length, traceRecordProblems(lr)], [200, 200, 200, []], 'the stamped ids are cut too');
});

// ── v4 ──
test('v4 — a torn tail costs one newline; ts is a full ISO stamp; a failed append spends no seq; a seq below 1 is no reopen point; the common ids are not drops', async () => {
  const d = dir();
  const a = createSessionTrace({ pipelineDir: d, sid: SID, runId: 'p1' });
  a.append('resume', { hostEpoch: 1, hostSessionId: 'H', after: 'a' });
  await a.close();
  appendFileSync(tracePath(d, SID), '{"v":1,"kind":"turn_st');
  const b = createSessionTrace({ pipelineDir: d, sid: SID, runId: 'p1' });
  for (const after of ['b', 'c']) b.append('resume', { hostEpoch: 1, hostSessionId: 'H', after });
  await b.flush();
  assert.deepEqual(readFileSync(tracePath(d, SID), 'utf8').split('\n').map((l) => l === ''), [false, false, false, false, true], 'the newline goes before the first record after the torn line only');
  assert.equal(b.dropped(), 0, 'hostEpoch and hostSessionId are common keys, not dropped ones');
  const ok = { v: 1, ts: '2026-10-28T10:00:00.000Z', seq: 1, kind: 'resume', runId: 'p1', sid: SID, hostEpoch: 1, hostSessionId: 'H', after: 'x' };
  for (const ts of ['2026-10-28T10:00:00', '2026-10-28T10:00Z', '2026-10-28', '2026-10-28T10:00:00.000Z junk']) assert.deepEqual(traceRecordProblems({ ...ok, ts }), ['bad ts'], ts);
  assert.deepEqual(traceRecordProblems({ ...ok, ts: '2026-10-28T10:00:00Z' }), [], 'milliseconds are optional');
  const t = createSessionTrace({ pipelineDir: dir(), sid: SID, runId: 'p1' });
  t.append('resume', { after: 'x' });
  assert.equal(t.append('resume', { after: 1n }), null, 'a value JSON cannot hold: no record, no throw');
  assert.equal(t.lastSeq(), 1, 'and no seq is spent');
  assert.equal(t.append('resume', { after: 'y' }).seq, 2);
  const d2 = dir();
  const c = createSessionTrace({ pipelineDir: d2, sid: SID, runId: 'p1' });
  for (const after of ['a', 'b', 'c']) c.append('resume', { after });
  await c.flush();
  appendFileSync(tracePath(d2, SID), '{"seq":0}\n{"seq":2.5}\n');
  assert.equal(createSessionTrace({ pipelineDir: d2, sid: SID, runId: 'p1' }).lastSeq(), 3);
});

import { chmodSync } from 'node:fs';

test('v4 — a write that fails after a torn tail keeps the newline for the next one: the later record survives and the loss shows as a gap', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  const d = dir();
  const a = createSessionTrace({ pipelineDir: d, sid: SID, runId: 'p1' });
  a.append('resume', { hostEpoch: 1, hostSessionId: 'H', after: 'a' });
  await a.close();
  const file = tracePath(d, SID);
  appendFileSync(file, '{"v":1,"kind":"turn_st');
  const b = createSessionTrace({ pipelineDir: d, sid: SID, runId: 'p1' });
  chmodSync(file, 0o444);
  b.append('resume', { hostEpoch: 1, hostSessionId: 'H', after: 'lost' });
  await b.flush();
  chmodSync(file, 0o644);
  b.append('resume', { hostEpoch: 1, hostSessionId: 'H', after: 'c' });
  await b.flush();
  assert.equal(b.writeErrors(), 1);
  const { records, torn, seqGaps } = readTraceSync(file);
  assert.deepEqual([records.map((r) => [r.seq, r.after]), torn, seqGaps], [[[1, 'a'], [3, 'c']], 1, 1]);
});

// ── v5: a fourth sweep (refine cycle 4), operator mutants over every line of the writer ──
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

test('v5 — a last record that lost only its newline is still the reopen point; a clean or empty file gets no blank line; an absent runId is null', async () => {
  const d = dir();
  const p = tracePath(d, SID);
  const t1 = createSessionTrace({ pipelineDir: d, sid: SID, runId: 'p1' });
  t1.append('open', {}); t1.append('mode', {});
  await t1.flush();
  writeFileSync(p, readFileSync(p, 'utf8').replace(/\n$/, ''));       // a crash cut exactly the last newline
  const t2 = createSessionTrace({ pipelineDir: d, sid: SID, runId: 'p1' });
  assert.equal(t2.lastSeq(), 2, 'the last line still parses, so seq continues after it');
  t2.append('pause', {});
  await t2.flush();
  const r = readTraceSync(p);
  assert.deepEqual([r.records.map((x) => x.seq), r.torn, r.invalid, r.seqGaps], [[1, 2, 3], 0, 0, 0]);
  const t3 = createSessionTrace({ pipelineDir: d, sid: SID, runId: 'p1' });
  t3.append('resume', {});
  await t3.flush();
  const text = readFileSync(p, 'utf8');
  assert.equal(text.includes('\n\n'), false, 'a reopened clean file gets no blank line');
  assert.equal(text.split('\n').length, 5, 'four records, one newline each');
  const e = dir();
  const pe = tracePath(e, SID);
  mkdirSync(dirname(pe), { recursive: true });
  writeFileSync(pe, '');
  const t4 = createSessionTrace({ pipelineDir: e, sid: SID });
  const rec = t4.append('open', {});
  await t4.flush();
  assert.equal(readFileSync(pe, 'utf8').startsWith('\n'), false, 'an empty file is not a torn one');
  assert.equal(rec.runId, null, 'an absent runId is null');
  assert.equal(readTraceSync(pe).records[0].runId, null);
  assert.equal(t4.append('mode', { hostEpoch: 0 }).hostEpoch, 0, 'epoch 0 (no host session yet) is kept, not null');
});

test('v5 — seqGaps: the first record follows seq 0; a forged line never becomes a predecessor; a repeated or backward seq is a gap; a reopen follows the last parseable seq', async () => {
  const L = (seq, f = {}) => JSON.stringify({ v: 1, ts: '2026-10-28T10:00:00.000Z', seq, kind: 'pause', runId: 'p1', sid: SID, hostEpoch: 1, hostSessionId: 'H', ...f });
  const gaps = (lines) => parseTrace(lines.join('\n') + '\n').seqGaps;
  assert.equal(gaps([L(1), L(2)]), 0);
  assert.equal(gaps([L(3), L(4)]), 1, 'a deleted head shows');
  assert.equal(gaps([L(1, { report: 'x' }), L(2), L(3)]), 1, 'so does a forged first line');
  assert.equal(gaps([L(1), L(2, { report: 'x' }), L(3)]), 1, 'a forged middle line: 1 then 3');
  assert.equal(gaps([L(1), L(2), L(2)]), 1, 'a repeated seq (two writers on one file)');
  assert.equal(gaps([L(1), L(3), L(2)]), 2, 'a backward seq');
  const d = dir();
  const p = tracePath(d, SID);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${L(1)}\n${L(9, { report: 'x' })}\n`);
  assert.equal(createSessionTrace({ pipelineDir: d, sid: SID }).lastSeq(), 9, 'the master\'s rule: after the last PARSEABLE line, even a forged one (the reader still counts it invalid)');
});
