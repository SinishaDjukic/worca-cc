// src/core/session-trace.mjs — the session trace (session groups, Tasks 35–36; spec §6.2, §6.4, C5, C6).
// One append-only NDJSON file per session, `<pipelineDir>/sessions/<sid>/trace.ndjson`: ids, names, counts, tokens, costs
// and times only, never a prompt, brief, report or tool I/O (`docs/run-telemetry.md`). Always on, independent of the
// runTelemetry flag. The live summary (`state.sessionHosts[sid]`) and the one rebuilt from the file are the same fold.
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SESSION_ID_RE } from '../shared/graph/constants.mjs';

export const TRACE_VERSION = 1;
export const TRACE_FILE = 'trace.ndjson';
export const TRACE_KINDS = Object.freeze(['open', 'mode', 'degrade', 'turn_start', 'dispatch', 'member_bound', 'member_done',
  'turn_end', 'cost', 'reconcile', 'watchdog', 'rotate', 'restart', 'resume', 'pause', 'verdict', 'close']);
/** The keys each kind may carry beyond the common ones. A writer that needs a new key adds it here first. */
export const TRACE_FIELDS = Object.freeze({
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
const COMMON = ['v', 'ts', 'seq', 'kind', 'runId', 'sid', 'hostEpoch', 'hostSessionId'];
/** Never in a trace, at any depth (the privacy rule). */
const FORBIDDEN = new Set(['prompt', 'brief', 'text', 'report', 'input', 'output', 'content', 'message', 'systemPrompt', 'result']);
const STRING_MAX = 200;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const EMPTY = () => ({ records: [], torn: 0, invalid: 0, seqGaps: 0 });

/** `<pipelineDir>/sessions/<sid>/trace.ndjson`. Throws on anything but a session id (path safety). */
export function tracePath(pipelineDir, sid) {
  if (typeof sid !== 'string' || !SESSION_ID_RE.test(sid)) throw new Error(`not a session id: ${JSON.stringify(sid)}`);
  return join(pipelineDir, 'sessions', sid, TRACE_FILE);
}

function deepProblems(v, out) {
  if (typeof v === 'string') { if (v.length > STRING_MAX) out.push(`string over ${STRING_MAX} characters`); return; }
  if (Array.isArray(v)) { for (const x of v) deepProblems(x, out); return; }
  if (!isObj(v)) return;
  for (const [k, x] of Object.entries(v)) {
    if (FORBIDDEN.has(k)) out.push(`forbidden key ${k}`);
    else deepProblems(x, out);
  }
}

/** Every problem of one parsed line: kind, version, seq, ts, top-level keys, forbidden keys at any depth, long strings. */
export function traceRecordProblems(rec) {
  if (!isObj(rec)) return ['not an object'];
  const out = [];
  const allowed = TRACE_KINDS.includes(rec.kind) ? TRACE_FIELDS[rec.kind] : null;
  if (!allowed) out.push(`unknown kind ${String(rec.kind)}`);
  if (rec.v !== TRACE_VERSION) out.push('bad v');
  if (!Number.isInteger(rec.seq) || rec.seq < 1) out.push('bad seq');
  if (typeof rec.ts !== 'string' || !ISO_RE.test(rec.ts)) out.push('bad ts');
  for (const [k, x] of Object.entries(rec)) {
    if (FORBIDDEN.has(k)) { out.push(`forbidden key ${k}`); continue; }
    if (allowed && !COMMON.includes(k) && !allowed.includes(k)) out.push(`unknown key ${k}`);
    deepProblems(x, out);
  }
  return out;
}

/** A value as the trace may hold it: strings cut at 200, forbidden keys dropped at any depth (v2; each counted). */
function clean(v, drop) {
  if (typeof v === 'string') return v.length > STRING_MAX ? v.slice(0, STRING_MAX) : v;
  if (Array.isArray(v)) return v.map((x) => clean(x, drop));
  if (!isObj(v)) return v;
  const o = {};
  for (const [k, x] of Object.entries(v)) {
    if (FORBIDDEN.has(k)) { drop(); continue; }
    o[k] = clean(x, drop);
  }
  return o;
}

/** Pure: the records of a trace file's text, skipping (and counting) torn and invalid lines. */
export function parseTrace(text) {
  const out = EMPTY();
  let prev = 0;                                             // the first record follows seq 0, so a lost head shows (v5)
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { out.torn += 1; continue; }
    if (traceRecordProblems(rec).length) { out.invalid += 1; continue; }   // <pipelineDir> is agent-writable
    if (rec.seq !== prev + 1) out.seqGaps += 1;
    prev = rec.seq;
    out.records.push(rec);
  }
  return out;
}

export async function readTrace(file) {
  try { return parseTrace(await readFile(file, 'utf8')); } catch (err) { if (err?.code === 'ENOENT') return EMPTY(); throw err; }
}

/** The synchronous twin (the restore in Task 47 is synchronous, critique minor 1). */
export function readTraceSync(file) {
  try { return parseTrace(readFileSync(file, 'utf8')); } catch (err) { if (err?.code === 'ENOENT') return EMPTY(); throw err; }
}

/** The seq of the last parseable line with an integer seq (a reopened trace continues after it). */
function lastSeqOf(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i].trim()) continue;
    try {
      const rec = JSON.parse(lines[i]);
      if (isObj(rec) && Number.isInteger(rec.seq) && rec.seq >= 1) return rec.seq;
    } catch { /* torn */ }
  }
  return 0;
}

/** The writer. `append` never throws: an unknown kind gives `null`; unknown and forbidden keys are dropped (and
 *  counted in `dropped()`); strings are cut at 200; `v`/`ts`/`seq` are stamped; writes chain FIFO. */
export function createSessionTrace({ pipelineDir, sid, runId, now = () => new Date().toISOString() }) {
  const path = tracePath(pipelineDir, sid);
  let seq = 0;
  let tornTail = false;
  try {
    const text = readFileSync(path, 'utf8');                 // once, at creation
    seq = lastSeqOf(text);
    tornTail = text.length > 0 && !text.endsWith('\n');      // the next record starts on a line of its own
  } catch { /* a new trace */ }
  let chain = Promise.resolve();
  let dirReady = false;
  let dropped = 0;
  let writeErrors = 0;
  const drop = () => { dropped += 1; };

  function append(kind, fields = {}) {
    try {
      if (!TRACE_KINDS.includes(kind)) return null;
      const allowed = TRACE_FIELDS[kind];
      const f = isObj(fields) ? fields : {};
      const rec = { v: TRACE_VERSION, ts: now(), seq: seq + 1, kind, runId: clean(runId ?? null, drop), sid,
        hostEpoch: clean(f.hostEpoch ?? null, drop), hostSessionId: clean(f.hostSessionId ?? null, drop) };
      for (const [k, x] of Object.entries(f)) {
        if (k === 'hostEpoch' || k === 'hostSessionId') continue;   // already on the record
        if (!allowed.includes(k)) { drop(); continue; }             // stamped, unknown and forbidden keys alike
        rec[k] = clean(x, drop);
      }
      const line = JSON.stringify(rec);
      const written = JSON.parse(line);                       // the record as the file holds it (NaN → null, undefined dropped)
      seq = rec.seq;
      chain = chain.then(async () => {
        if (!dirReady) { await mkdir(dirname(path), { recursive: true }); dirReady = true; }
        await appendFile(path, `${tornTail ? '\n' : ''}${line}\n`, 'utf8');
        tornTail = false;                                     // only a write that landed ends the torn line (v4)
      }).catch(() => { writeErrors += 1; });
      return written;
    } catch {
      return null;
    }
  }

  return {
    path,
    append,
    lastSeq: () => seq,
    dropped: () => dropped,
    writeErrors: () => writeErrors,
    flush: () => chain,
    close: () => chain,                                      // no handle is held: closing is flushing
  };
}
