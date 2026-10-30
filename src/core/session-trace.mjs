// src/core/session-trace.mjs — the session trace (session groups, Tasks 35–36; spec §6.2, §6.4, C5, C6).
// One append-only NDJSON file per session, `<pipelineDir>/sessions/<sid>/trace.ndjson`: ids, names, counts, tokens, costs
// and times only, never a prompt, brief, report or tool I/O (`docs/run-telemetry.md`). Always on, independent of the
// runTelemetry flag. The live summary (`state.sessionHosts[sid]`) and the one rebuilt from the file are the same fold.
import { appendFile, lstat, mkdir, open, readFile, readdir, realpath } from 'node:fs/promises';
import { constants as fsc, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { SESSION_ID_RE } from '../shared/graph/constants.mjs';
import { engineLabel } from '../shared/engine-switch.mjs';

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
const DEPTH_MAX = 32;                                       // no writer nests more than about 3; a deeper line is forged
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const EMPTY = () => ({ records: [], torn: 0, invalid: 0, seqGaps: 0 });

/** `<pipelineDir>/sessions/<sid>/trace.ndjson`. Throws on anything but a session id (path safety). */
export function tracePath(pipelineDir, sid) {
  if (typeof sid !== 'string' || !SESSION_ID_RE.test(sid)) throw new Error(`not a session id: ${JSON.stringify(sid)}`);
  return join(pipelineDir, 'sessions', sid, TRACE_FILE);
}

/** `depth` is the nesting level of `v`'s container; past DEPTH_MAX the walk stops, so a hostile line cannot blow the stack. */
function deepProblems(v, out, depth = 1) {
  if (typeof v === 'string') { if (v.length > STRING_MAX) out.push(`string over ${STRING_MAX} characters`); return; }
  if (!v || typeof v !== 'object') return;
  if (depth > DEPTH_MAX) { out.push(`nested over ${DEPTH_MAX} levels`); return; }
  if (Array.isArray(v)) { for (const x of v) deepProblems(x, out, depth + 1); return; }
  for (const [k, x] of Object.entries(v)) {
    if (FORBIDDEN.has(k)) out.push(`forbidden key ${k}`);
    else deepProblems(x, out, depth + 1);
  }
}

/** Every problem of one parsed line: kind, version, seq, ts, top-level keys, forbidden keys at any depth, long strings,
 *  nesting over 32 levels. */
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
      }).catch(() => { writeErrors += 1; tornTail = true; });  // it may have landed a fragment; at worst one blank line
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

// ── Reducer (Task 36): one fold builds the live summary and rebuilds it from the file (C6) ──

const HISTORY_KINDS = new Set(['rotate', 'restart', 'resume', 'pause', 'degrade']);
const ROW_KINDS = new Set(['turn_start', 'dispatch', 'member_bound', 'member_done', 'turn_end', 'cost', 'reconcile', 'watchdog']);
const fin = (v) => Number.isFinite(v);
const addUsd = (a, x) => (fin(x) ? (a ?? 0) + x : a);

export function emptySummary({ sid = null, label = null, members = [] } = {}) {
  return { sid, label, mode: null, modeReason: null, engine: null, transport: null, hostEpoch: 0, hostSessionId: null,
    hostModel: null, status: 'cold', turns: 0, dispatches: 0, rotations: 0, restarts: 0, costUsd: null, hostOverheadUsd: null,
    startedAt: null, endedAt: null, lastTurnAt: null, reconciled: true, members: Array.isArray(members) ? [...members] : [] };
}

/** Pure: a new Summary with one record applied (spec §6.4). */
export function applyTraceRecord(summary, rec) {
  const s = { ...summary };
  if (!isObj(rec)) return s;
  if (s.sid == null && typeof rec.sid === 'string') s.sid = rec.sid;   // a fold started from nothing takes the trace's sid (v4)
  if (fin(rec.hostEpoch) && rec.hostEpoch > s.hostEpoch) {             // a new epoch: its host id is unknown until its init (v4)
    s.hostEpoch = rec.hostEpoch;
    s.hostSessionId = rec.hostSessionId ?? null;
  } else if (rec.hostSessionId != null && !(fin(rec.hostEpoch) && rec.hostEpoch < s.hostEpoch)) {
    s.hostSessionId = rec.hostSessionId;                               // an older epoch's id never comes back
  }
  switch (rec.kind) {
    case 'open':
      s.status = 'cold';
      s.label = rec.label ?? s.label;
      if (Array.isArray(rec.members)) s.members = [...rec.members];
      s.mode = rec.mode ?? s.mode;
      s.engine = rec.engine ?? s.engine;
      s.transport = rec.transport ?? s.transport;
      s.hostModel = s.hostModel ?? rec.hostModel ?? null;      // a resolved turn_end model wins over the requested one
      s.startedAt = s.startedAt ?? rec.ts ?? null;
      break;
    case 'mode':
      s.mode = rec.mode ?? s.mode;
      s.modeReason = rec.reason ?? s.modeReason;
      s.engine = rec.engine ?? s.engine;
      s.transport = rec.transport ?? s.transport;
      break;
    case 'degrade':
      s.status = 'separate';
      s.mode = rec.to ?? s.mode;
      s.modeReason = rec.reason ?? s.modeReason;
      break;
    case 'restart':
      s.restarts += 1;
      s.engine = rec.engine ?? s.engine;
      s.transport = rec.transport ?? s.transport;
      if (rec.epochCheck?.ok === false) s.reconciled = false;
      break;
    case 'rotate':
      s.rotations += 1;
      if (rec.epochCheck?.ok === false) s.reconciled = false;
      break;
    case 'turn_start': s.status = 'busy'; s.turns += 1; break;
    case 'dispatch': s.dispatches += 1; break;
    case 'turn_end':
      s.status = 'idle';
      s.lastTurnAt = rec.ts ?? s.lastTurnAt;
      if (rec.hostModel != null) s.hostModel = rec.hostModel;  // the resolved init model (C35)
      break;
    case 'cost':
      if (fin(rec.memberUsd) || fin(rec.hostOverheadUsd)) s.costUsd = addUsd(addUsd(s.costUsd ?? 0, rec.memberUsd), rec.hostOverheadUsd);
      s.hostOverheadUsd = addUsd(s.hostOverheadUsd, rec.hostOverheadUsd);
      break;
    case 'reconcile': if (rec.ok === false) s.reconciled = false; break;
    case 'pause': s.status = 'paused'; break;
    case 'resume': s.status = 'idle'; break;
    case 'close':
      s.status = rec.status ?? s.status;
      s.endedAt = rec.ts ?? s.endedAt;
      if (Array.isArray(rec.epochChecks) && rec.epochChecks.some((c) => c?.ok === false)) s.reconciled = false;
      break;
    default: break;
  }
  return s;
}

export function reduceTrace(records) {
  const list = Array.isArray(records) ? records : [];
  return list.reduce(applyTraceRecord, emptySummary({ sid: list[0]?.sid ?? null }));
}

const emptyRow = (turnId) => ({ turnId, dispatchId: null, executionId: null, nodeId: null, attempt: null, memberAgentId: null,
  memberTranscriptId: null, startedAt: null, durationMs: null, tokens: null, memberUsd: null, hostOverheadUsd: null, costSource: null,
  carriedUsd: 0, isError: null, verdict: null, issues: null, reconcileOk: null, watchdog: null });

/** One row per turn (keyed by `turnId`, C31), in the order turns first appear. A carried `cost` record books onto its own
 *  (cut) turn; the turn that carried it shows the amount as `carriedUsd`. A `verdict` joins by `dispatchId`, else by
 *  `executionId` (that execution's latest dispatch, v3: `noteVerdict(executionId, …)` is keyed by execution). */
export function turnRows(records) {
  const rows = new Map();
  const byDispatch = new Map();
  const byExecution = new Map();
  const row = (turnId) => { if (!rows.has(turnId)) rows.set(turnId, emptyRow(turnId)); return rows.get(turnId); };
  for (const rec of Array.isArray(records) ? records : []) {
    if (!isObj(rec)) continue;
    if (rec.kind === 'verdict') {
      const r = rows.get(byDispatch.get(rec.dispatchId) ?? byExecution.get(rec.executionId));
      if (r) { r.verdict = rec.verdict ?? null; r.issues = rec.issues ?? null; }
      continue;
    }
    if (!ROW_KINDS.has(rec.kind) || typeof rec.turnId !== 'string') continue;
    const r = row(rec.turnId);
    if (typeof rec.dispatchId === 'string') { r.dispatchId = rec.dispatchId; byDispatch.set(rec.dispatchId, rec.turnId); }
    switch (rec.kind) {
      case 'turn_start': r.startedAt = rec.ts ?? null; break;
      case 'dispatch':
        r.executionId = rec.executionId ?? r.executionId; r.nodeId = rec.nodeId ?? r.nodeId; r.attempt = rec.attempt ?? r.attempt;
        if (typeof rec.executionId === 'string') byExecution.set(rec.executionId, rec.turnId);
        break;
      case 'member_bound': r.memberAgentId = rec.memberAgentId ?? r.memberAgentId; break;
      case 'member_done':
        r.memberAgentId = rec.memberAgentId ?? r.memberAgentId;
        r.memberTranscriptId = rec.memberTranscriptId ?? null;
        r.tokens = rec.tokens ?? null;
        r.isError = typeof rec.isError === 'boolean' ? rec.isError : null;
        break;
      case 'turn_end': r.durationMs = rec.durationMs ?? null; break;
      case 'cost':
        r.memberUsd = addUsd(r.memberUsd, rec.memberUsd);
        r.hostOverheadUsd = addUsd(r.hostOverheadUsd, rec.hostOverheadUsd);
        r.costSource = rec.costSource ?? r.costSource;
        r.executionId = r.executionId ?? rec.executionId ?? null;
        r.nodeId = r.nodeId ?? rec.nodeId ?? null;
        if (typeof rec.carriedBy === 'string' && fin(rec.memberUsd)) row(rec.carriedBy).carriedUsd += rec.memberUsd;
        break;
      case 'reconcile': r.reconcileOk = typeof rec.ok === 'boolean' ? rec.ok : null; break;
      case 'watchdog':                                          // the first error-level code wins over warnings, else the first
        if (r.watchdog === null || (rec.level === 'error' && r.watchdog.level !== 'error')) r.watchdog = { code: rec.code ?? null, level: rec.level ?? null };
        break;
      default: break;
    }
  }
  return [...rows.values()];
}

export function sessionHistory(records) {
  return (Array.isArray(records) ? records : []).filter((r) => isObj(r) && HISTORY_KINDS.has(r.kind))
    .map((r) => ({ kind: r.kind, ts: r.ts ?? null, reason: r.reason ?? r.after ?? null, hostEpoch: r.hostEpoch ?? null, hostSessionId: r.hostSessionId ?? null }));
}

/** Every failed check of a trace, the harness figure first (Task 54). A turn check comes from its `reconcile` record; an
 *  epoch check from `rotate`/`restart` (`epochCheck`) and `close` (`epochChecks`, which repeats them), one per epoch (it
 *  names its `epoch`). A failure sticks: a close after a resume re-checks a restored epoch from zero (0 vs 0, ok), which
 *  must not hide the check that failed before it. */
export function reconcileMismatches(records) {
  const turns = [];
  const epochs = new Map();
  for (const rec of Array.isArray(records) ? records : []) {
    if (!isObj(rec)) continue;
    if (rec.kind === 'reconcile' && Array.isArray(rec.checks)) {
      for (const c of rec.checks) {
        if (isObj(c) && c.ok === false) turns.push({ turnId: rec.turnId ?? null, method: c.method ?? null, harnessUsd: c.harnessUsd ?? null, otherUsd: c.otherUsd ?? null });
      }
    }
    const checks = rec.kind === 'close' ? (Array.isArray(rec.epochChecks) ? rec.epochChecks : [])
      : (rec.kind === 'rotate' || rec.kind === 'restart') && isObj(rec.epochCheck) ? [rec.epochCheck] : [];
    for (const c of checks) {
      if (!isObj(c)) continue;
      const epoch = c.epoch ?? rec.hostEpoch ?? null;
      if (epochs.get(epoch)?.ok !== false) epochs.set(epoch, { ...c, epoch });
    }
  }
  const failed = [...epochs.values()].filter((c) => c.ok === false)
    .map((c) => ({ turnId: null, method: 'epoch', harnessUsd: c.harnessTotalUsd ?? null, otherUsd: c.bookedUsd ?? null, epoch: c.epoch }));
  return [...turns, ...failed];
}

/** One session as the API, the CLI and the Sessions tab show it: the Summary (`turns` is its COUNT), the per-turn rows,
 *  the history, the failed checks and what the reader skipped. `sid` names it even when no line was valid. With no valid
 *  record nothing was checked: `reconciled` and `reconcile.ok` are null (never "reconciled"). */
export function sessionReport({ records = [], torn = 0, invalid = 0, seqGaps = 0 } = {}, sid = records[0]?.sid ?? null) {
  const mismatches = reconcileMismatches(records);
  const checked = records.length > 0;
  // The writer's own word: a close that says `reconciled: false` stands even when the failed record it summed was lost
  // (a write error leaves a seq gap), so the report never reads "reconciled" where the host said otherwise.
  const writerNo = records.some((r) => isObj(r) && r.kind === 'close' && r.reconciled === false);
  const summary = records.reduce(applyTraceRecord, emptySummary({ sid }));
  // One rule for both fields: a failed check, the writer's no, or a record that says it failed (the fold) is not
  // reconciled, so a record whose `ok` and `checks` disagree (the folder is agent-writable) never splits them.
  const ok = mismatches.length > 0 || writerNo || summary.reconciled === false ? false : checked ? true : null;
  return { ...summary, reconciled: ok, turnRows: turnRows(records), history: sessionHistory(records),
    reconcile: { ok, mismatches }, integrity: { torn, invalid, seqGaps } };
}

/** A trace the report reads at most (16 MiB, thousands of turns): the dir is agent-writable and the Sessions tab asks
 *  every 2 s, so a planted giant file is listed as unreadable, never parsed on the server's event loop. */
export const TRACE_READ_MAX = 16 * 1024 * 1024;

/** The trace of `sid` opened for reading, or null when there is none at exactly `<runDir>/sessions/<sid>/trace.ndjson`.
 *  The run dir is agent-writable, so nothing planted there is read or served (P3-D13's rule, folder-copy.mjs
 *  `openRegular`): never through a link at its name or a linked folder above it (the real path is checked from the run
 *  dir's own), never through a hard link (the writer's file has one name: a second name is another file planted under
 *  this one, which macOS lets any user make), never blocking on a FIFO, and the handle is the very file the lstat saw
 *  (one open; dev + ino). It throws when the file or its folder exists and cannot be read (EACCES), so the report lists
 *  it unreadable; the caller closes the handle. */
export async function openTraceFile(runDir, sid) {
  if (typeof sid !== 'string' || !SESSION_ID_RE.test(sid)) return null;
  const file = tracePath(runDir, sid);
  let st;
  try {
    const root = await realpath(runDir);
    if (relative(root, await realpath(dirname(file))) !== join('sessions', sid)) return null;   // a linked folder: not this run's
    st = await lstat(file);
    if (!st.isFile() || st.nlink !== 1 || relative(root, await realpath(file)) !== join('sessions', sid, TRACE_FILE)) return null;
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR' || err.code === 'ELOOP')) return null;   // none (yet), or not a folder
    throw err;
  }
  let fh;
  try { fh = await open(file, fsc.O_RDONLY | (fsc.O_NOFOLLOW ?? 0) | (fsc.O_NONBLOCK ?? 0)); } catch (err) {
    if (err && (err.code === 'ELOOP' || err.code === 'EMLINK' || err.code === 'ENOENT')) return null;   // swapped for a link, or gone
    throw err;
  }
  try {
    const now = await fh.stat();
    if (now.isFile() && now.nlink === 1 && now.dev === st.dev && now.ino === st.ino) return fh;
  } catch { /* closed below */ }
  await fh.close();
  return null;
}

/** Every session of a run, from `<runDir>/sessions/<sid>/trace.ndjson` (only dirs named like a session id, only real
 *  files), in the order they first ran: the sessions that ran a turn by their first turn's start, then the rest by the open
 *  (every host opens at run start, in the same millisecond), then the sid. A trace that exists but cannot be read (or is over TRACE_READ_MAX) is listed with
 *  `integrity.unreadable: true`, nothing checked, never a failed report. TRACE_READ_MAX is the budget of the whole report:
 *  once the traces read add up to it, the rest are listed unreadable (many planted files are one big one). A run without a
 *  session (or whose `sessions` is a link loop) gives `{ sessions: [] }`. */
export async function sessionsReport(runDir) {
  let names = [];
  try { names = await readdir(join(runDir, 'sessions')); } catch (err) { if (!['ENOENT', 'ENOTDIR', 'ELOOP'].includes(err?.code)) throw err; }
  const sessions = [];
  let budget = TRACE_READ_MAX;
  for (const sid of names.filter((n) => SESSION_ID_RE.test(n))) {
    let read;
    try {
      const fh = await openTraceFile(runDir, sid);
      if (!fh) continue;                                       // no trace (yet), or not a real file of this run
      try {
        const { size } = await fh.stat();
        if (size > budget) throw new Error('trace too large');
        budget -= size;
        read = parseTrace(await fh.readFile('utf8'));
      } finally { await fh.close(); }
    } catch {
      sessions.push({ ...sessionReport(EMPTY(), sid), integrity: { torn: 0, invalid: 0, seqGaps: 0, unreadable: true } });
      continue;
    }
    if (!read.records.length && !read.torn && !read.invalid) continue;   // an empty file is no session
    sessions.push(sessionReport(read, sid));                   // the dir name is the path-safe id
  }
  const unstarted = (x) => (x.startedAt == null ? 1 : 0);      // a trace with no valid open goes last
  const ranAt = (x) => x.turnRows.find((r) => r.startedAt)?.startedAt;   // a first turn whose start was lost (a seq gap) still ran
  const noTurn = (x) => (ranAt(x) ? 0 : 1);                    // opened, never ran: after the ones that ran
  const firstRan = (x) => String(ranAt(x) ?? x.startedAt ?? '');
  return { sessions: sessions.sort((a, b) => unstarted(a) - unstarted(b) || noTurn(a) - noTurn(b) || firstRan(a).localeCompare(firstRan(b))
    || a.sid.localeCompare(b.sid)) };
}

const EVENT_KEYS = ['turnId', 'dispatchId', 'executionId', 'nodeId', 'attempt', 'memberAgentId', 'costSource'];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

/** The `sessionHost` event (spec §6.4). `reason` carries a watchdog's code. */
export function sessionHostEvent(rec, summary = {}) {
  if (!isObj(rec)) return null;                              // append() gives null when a record could not be written (v5)
  return { sid: summary.sid ?? rec.sid, transition: rec.kind, hostSessionId: summary.hostSessionId ?? rec.hostSessionId ?? null,
    hostEpoch: summary.hostEpoch ?? rec.hostEpoch ?? null, engine: summary.engine ?? null, mode: summary.mode ?? null,
    transport: summary.transport ?? null, ts: rec.ts, ...pick(rec, EVENT_KEYS), reason: rec.reason ?? rec.code ?? rec.after ?? undefined,
    ...(rec.kind === 'cost' ? { costUsd: rec.memberUsd, hostOverheadUsd: rec.hostOverheadUsd } : {}),
    ...(rec.kind === 'close' ? { costUsd: rec.costUsd, hostOverheadUsd: rec.hostOverheadUsd, turns: rec.turns } : {}),
    ...(rec.kind === 'watchdog' ? { level: rec.level ?? null } : {}) };   // the CLI prints a failed dispatch, not a warning (Task 55)
}

const MODE_WORDS = { subagents: 'sub-agents', shared: 'one conversation', separate: 'separate sessions' };
const usd = (x) => (fin(x) ? `$${x.toFixed(4)}` : 'cost unknown');

/** The audit line a record adds, or null (pinned; the harness keeps only the first reconcile mismatch per sid). */
export function sessionAuditLine(rec, summary = {}) {
  if (!isObj(rec)) return null;
  const sid = rec.sid ?? summary.sid;
  switch (rec.kind) {
    case 'open': {
      const members = Array.isArray(rec.members) ? rec.members : summary.members || [];
      const mode = rec.mode ?? summary.mode;
      return `Session ${sid} "${rec.label ?? summary.label}" (${engineLabel(rec.engine ?? summary.engine)}, ${MODE_WORDS[mode] ?? mode}): opened for ${members.length} steps.`;
    }
    case 'degrade': return `Session ${sid}: runs as separate sessions — ${rec.reason}.`;
    case 'rotate': return `Session ${sid}: rotated to a fresh host session (${rec.reason}; epoch ${(rec.fromEpoch ?? rec.hostEpoch) + 1}).`;
    case 'restart': return `Session ${sid}: restarted fresh (${rec.reason}).`;
    case 'resume': {                                          // no host yet (paused before its first init, or separate): never "null" (v5)
      const host = rec.hostSessionId ?? summary.hostSessionId;
      return host == null ? `Session ${sid}: resumed after ${rec.after}.` : `Session ${sid}: resumed host session ${host} after ${rec.after}.`;
    }
    case 'watchdog': return rec.level === 'error' ? `Session ${sid}: dispatch ${rec.dispatchId} failed — ${rec.code}.` : null;
    case 'reconcile': {
      if (rec.ok !== false) return null;
      const c = (Array.isArray(rec.checks) ? rec.checks : []).find((x) => x?.ok === false) || {};
      return `Session ${sid}: cost reconcile mismatch on ${rec.turnId} — harness ${usd(c.harnessUsd)} vs ${c.method} ${usd(c.otherUsd)} (the harness figure is booked).`;
    }
    case 'close':
      return `Session ${sid}: closed — ${rec.turns} turns, ${rec.dispatches} dispatches, ${usd(rec.costUsd)}, ${rec.rotations} rotations, ${rec.restarts} restarts, reconciled ${rec.reconciled ? 'yes' : 'no'}.`;
    default: return null;
  }
}
