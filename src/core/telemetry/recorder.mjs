// src/core/telemetry/recorder.mjs — Run telemetry (Labs flag, docs/run-telemetry.md).
//
// Watches a run's normalized agent events and the harness's own work, and appends compact
// NDJSON records to <runDir>/telemetry.ndjson. Recording only: nothing here changes what a run
// does, every public method swallows its own errors, and a run without the flag never creates
// a recorder at all.
//
// Records (one JSON object per line, `t` = the kind; `ts` = epoch ms):
//   run      {v, ts}                                         the recorder started (bind)
//   step     {ts, step, node, status}                        a step row changed status
//   session  {ts, step, session?, model?, init?}             a spawn named its session / model
//   call     {ts, step, session, sub, msg, model, in, cr, cw, out, ctx, gapMs, tools}
//            one model call (an assistant message), main stream (sub: null) or a sub-agent's
//            (sub: the parent tool_use id). ctx = in + cr + cw, the prompt the call sent.
//            gapMs: from the stream's previous boundary (session start, the previous call, a tool
//            result) to the call's first frame — model wait, approximately.
//   tool     {ts, step, sub, name, ms, err}                  a tool call's run time
//   retry    {ts, step, sub, attempt, status, reason, delayMs}
//   compact  {ts, step, sub, trigger, preTokens}             the CLI compacted the context
//   agent    {ts, step, ev, id, type, model, tokens, ms}     a sub-agent spawned / finished
//   result   {ts, step, session, in, cr, cw, out, ctx, costUsd, cumulative, turns, durationMs}
//            the end-of-session usage; the only usage some engines report
//   harness  {ts, windowMs, persists, persistMs, persistMaxMs, rows, emits, emitBytes,
//            emitMaxBytes, lagP50Ms, lagP99Ms, lagMaxMs}    Worca's own work, per window
//   end      {ts, dbBytes, telemetryBytes, logBytes}
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { createRunLogWriter } from '../run-log.mjs';

export const TELEMETRY_FILE = 'telemetry.ndjson';
export const TELEMETRY_VERSION = 1;
const WINDOW_MS = 10_000;

const n = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);
const ms = (v) => Math.round(v);

/** Claude-style usage → the compact fields every record uses. */
export function usageFields(u) {
  const o = u && typeof u === 'object' ? u : {};
  const f = { in: n(o.input_tokens), cr: n(o.cache_read_input_tokens), cw: n(o.cache_creation_input_tokens), out: n(o.output_tokens) };
  f.ctx = f.in + f.cr + f.cw;
  return f;
}

/**
 * @param {{writer?:{bind:Function,push:Function,close:Function}, now?:()=>number, windowMs?:number,
 *   lag?:boolean}} [o]  lag: false skips the event-loop monitor (tests)
 */
export function createTelemetryRecorder({ writer = createRunLogWriter({ fileName: TELEMETRY_FILE }), now = Date.now, windowMs = WINDOW_MS, lag = true } = {}) {
  const sessions = new Map();     // step -> current session id
  const streams = new Map();      // `${step}\0${sub}` -> { boundary, pending }
  const openTools = new Map();    // toolUseId -> { ts, name, step, sub }
  let win = freshWindow();
  let timer = null;
  let hist = null;
  let closed = false;

  function freshWindow() { return { start: now(), persists: 0, persistMs: 0, persistMaxMs: 0, rows: 0, emits: 0, emitBytes: 0, emitMaxBytes: 0 }; }
  const push = (rec) => { if (!closed) writer.push(rec); };

  function stream(step, sub) {
    const k = `${step}\0${sub ?? ''}`;
    let s = streams.get(k);
    if (!s) { s = { step, sub: sub ?? null, boundary: null, pending: null, done: new Set() }; streams.set(k, s); }
    return s;
  }

  function flushCall(s) {
    const p = s.pending;
    if (!p) return;
    s.pending = null;
    if (p.msg !== null) s.done.add(p.msg);
    push({ t: 'call', ts: p.ts, step: s.step, session: sessions.get(s.step) ?? null, sub: s.sub, msg: p.msg, model: p.model,
      ...usageFields(p.usage), gapMs: p.gapMs, tools: p.tools });
  }

  function flushStep(step) {
    for (const s of streams.values()) if (s.step === step) flushCall(s);
  }

  function onUsage(e, step, ts) {
    // start/delta: partial-message streams only. `total`: a session sum (Goose), recorded by its `result`.
    if (e.phase !== 'message' || !e.usage || e.total) return;
    const s = stream(step, e.parentId);
    const id = e.messageId ?? null;
    if (id !== null && s.done.has(id)) return;          // a late content block of a call already written
    if (s.pending && id !== null && s.pending.msg === id) {   // the CLI repeats a message's usage per content block
      s.pending.usage = e.usage;
      if (e.model) s.pending.model = e.model;
      return;
    }
    flushCall(s);
    s.pending = { ts, msg: id, usage: e.usage, model: e.model ?? null, gapMs: s.boundary == null ? null : ms(ts - s.boundary), tools: [] };
    s.boundary = ts;
  }

  function onTool(e, step, ts) {
    const s = stream(step, e.parentId);
    for (const c of Array.isArray(e.calls) ? e.calls : []) {
      if (!c || typeof c.name !== 'string') continue;
      if (s.pending && (e.messageId == null || s.pending.msg === e.messageId)) s.pending.tools.push(c.name);
      if (c.toolUseId) openTools.set(c.toolUseId, { ts, name: c.name, step, sub: e.parentId ?? null });
    }
  }

  function onToolResult(e, step, ts) {
    const s = stream(step, e.parentId);
    flushCall(s);
    s.boundary = ts;
    for (const r of Array.isArray(e.results) ? e.results : []) {
      const t = r && r.toolUseId ? openTools.get(r.toolUseId) : null;
      if (!t) continue;
      openTools.delete(r.toolUseId);
      push({ t: 'tool', ts: t.ts, step: t.step, sub: t.sub, name: t.name, ms: ms(ts - t.ts), err: !!r.isError });
    }
  }

  function observe(e, attr) {
    const step = attr?.stepKey ?? attr?.executionId ?? null;
    if (!step || !e || typeof e !== 'object') return;
    const ts = now();
    switch (e.type) {
      case 'session': {
        flushStep(step);                // a call still open from the previous spawn keeps that spawn's session
        if (!e.init && typeof e.sessionId === 'string') sessions.set(step, e.sessionId);
        push({ t: 'session', ts, step, ...(typeof e.sessionId === 'string' ? { session: e.sessionId } : {}),
          ...(e.model ? { model: e.model } : {}), ...(e.init ? { init: true } : {}) });
        stream(step, null).boundary = ts;
        return;
      }
      case 'usage': return onUsage(e, step, ts);
      case 'tool': return onTool(e, step, ts);
      case 'toolResult': return onToolResult(e, step, ts);
      case 'retry':
        push({ t: 'retry', ts, step, sub: e.parentId ?? null, attempt: e.attempt ?? null, status: e.httpStatus ?? null, reason: e.reason ?? null, delayMs: e.delayMs ?? null });
        return;
      case 'compact':
        push({ t: 'compact', ts, step, sub: e.parentId ?? null, trigger: e.trigger ?? null, preTokens: e.preTokens ?? null });
        return;
      case 'subagent':
        if (e.event !== 'spawn' && e.event !== 'finish' && e.event !== 'error') return;
        push({ t: 'agent', ts, step, ev: e.event, id: e.toolUseId ?? null, type: e.subagentType ?? e.agentType ?? null,
          model: e.resolvedModel ?? e.model ?? null, tokens: e.tokens ?? null, ms: e.durationMs ?? null });
        return;
      case 'result':
        flushStep(step);
        push({ t: 'result', ts, step, session: sessions.get(step) ?? e.sessionId ?? null, ...usageFields(e.usage),
          costUsd: Number.isFinite(e.costUsd) ? e.costUsd : null, cumulative: !!e.cumulativeCost,
          turns: e.numTurns ?? null, durationMs: e.durationMs ?? null });
        return;
      default:
    }
  }

  function windowRecord() {
    const ts = now();
    const rec = { t: 'harness', ts, windowMs: ms(ts - win.start), persists: win.persists, persistMs: ms(win.persistMs), persistMaxMs: ms(win.persistMaxMs),
      rows: win.rows, emits: win.emits, emitBytes: win.emitBytes, emitMaxBytes: win.emitMaxBytes };
    if (hist && hist.count > 0) {
      rec.lagP50Ms = ms(hist.percentile(50) / 1e6);
      rec.lagP99Ms = ms(hist.percentile(99) / 1e6);
      rec.lagMaxMs = ms(hist.max / 1e6);
      hist.reset();
    }
    const busy = win.persists || win.emits || rec.lagMaxMs > 0;
    win = freshWindow();
    if (busy) push(rec);
  }

  const safe = (fn) => (...a) => { try { return fn(...a); } catch { return undefined; } };

  return {
    /** Point the recorder at the run dir and start the harness window timer. Idempotent. */
    bind: safe((dir) => {
      if (timer || closed || !dir) return;
      writer.bind(dir);
      push({ t: 'run', v: TELEMETRY_VERSION, ts: now() });
      if (lag) { hist = monitorEventLoopDelay({ resolution: 20 }); hist.enable(); }
      win = freshWindow();
      timer = setInterval(safe(windowRecord), windowMs);
      if (typeof timer.unref === 'function') timer.unref();
    }),
    /** One normalized agent event with its step attribution (run-harness _onAgentEvent). */
    observe: safe(observe),
    /** A step row's status changed (orchestrator _execStep). */
    stepStatus: safe((step, node, status) => {
      if (!step) return;
      if (status !== 'start') flushStep(step);
      push({ t: 'step', ts: now(), step, node: node ?? null, status });
    }),
    /** One state save took `took` ms and wrote `rows` step rows. */
    persisted: safe((took, rows) => {
      win.persists += 1;
      win.persistMs += took;
      if (took > win.persistMaxMs) win.persistMaxMs = took;
      win.rows += n(rows);
    }),
    /** One live `state` frame went out; its size is what a client receives. */
    stateEmitted: safe((payload) => {
      const bytes = Buffer.byteLength(JSON.stringify(payload) || '', 'utf8');
      win.emits += 1;
      win.emitBytes += bytes;
      if (bytes > win.emitMaxBytes) win.emitMaxBytes = bytes;
    }),
    /** Flush what is open, write the last window and the end record, stop. */
    close: safe((end = {}) => {
      if (closed) return Promise.resolve();
      for (const s of streams.values()) flushCall(s);
      if (timer) { clearInterval(timer); timer = null; windowRecord(); }
      if (hist) { hist.disable(); hist = null; }
      push({ t: 'end', ts: now(), ...end });
      closed = true;
      return Promise.resolve(writer.close()).catch(() => {});
    }),
    isClosed: () => closed,
  };
}
