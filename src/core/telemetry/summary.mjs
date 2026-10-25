// src/core/telemetry/summary.mjs — telemetry.ndjson (recorder.mjs) → per-step statistics for the run
// page's Agents tab (GET /api/runs/:id/telemetry). Pure: the window lookup is passed in.

export const MAX_POINTS = 200;
/** A sub-agent's tool call spans the sub-agent's whole run: its time is not tool time. */
const AGENT_TOOLS = new Set(['Agent', 'Task', 'task']);

const sum = (a, f) => a.reduce((x, r) => x + (Number(f(r)) || 0), 0);

/** Parse NDJSON text; a torn or foreign line is skipped. */
export function parseTelemetry(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    if (!line) continue;
    try { const r = JSON.parse(line); if (r && typeof r === 'object' && typeof r.t === 'string') out.push(r); } catch { /* skip */ }
  }
  return out;
}

/**
 * Keep at most `max` points: the series is cut into `max` buckets and each bucket keeps its
 * fullest point, so a peak is never sampled away.
 * @param {Array<Array<number>>} pts  [[x, y, ...], ...], x ascending; y at index 1
 */
export function downsampleMax(pts, max = MAX_POINTS) {
  if (pts.length <= max) return pts;
  const out = [];
  const size = pts.length / max;
  for (let b = 0; b < max; b++) {
    const from = Math.floor(b * size);
    const to = Math.min(pts.length, Math.floor((b + 1) * size));
    let best = pts[from];
    for (let i = from + 1; i < to; i++) if (pts[i][1] > best[1]) best = pts[i];
    out.push(best);
  }
  return out;
}

function stepSummary(key, recs, windowOf) {
  const steps = recs.filter((r) => r.t === 'step');
  const startTs = steps.find((r) => r.status === 'start')?.ts ?? recs[0]?.ts ?? null;
  const endTs = [...steps].reverse().find((r) => r.status !== 'start')?.ts ?? null;
  const calls = recs.filter((r) => r.t === 'call' && r.sub == null);
  const subCalls = recs.filter((r) => r.t === 'call' && r.sub != null);
  const results = recs.filter((r) => r.t === 'result');
  const usedResults = results.filter((r) => r.ctx > 0 || r.out > 0);   // all zero = the engine reported no usage
  const sessions = [];
  for (const r of recs) if ((r.t === 'session' || r.t === 'call' || r.t === 'result') && r.session && !sessions.includes(r.session)) sessions.push(r.session);
  const models = [];
  for (const r of recs) {
    const m = r.t === 'call' && r.sub == null ? r.model : r.t === 'session' ? r.model : null;
    if (m && !models.includes(m)) models.push(m);
  }
  const model = [...calls].reverse().find((r) => r.model)?.model ?? models[models.length - 1] ?? null;
  const t0 = startTs ?? calls[0]?.ts ?? 0;
  const perCall = calls.length > 0;
  // No per-call usage (Codex, Copilot, Cursor, Gemini, Goose): the session's end figure is the one
  // point. For engines that report a thread total it can overstate the context — `endOnly` says so.
  const points = perCall
    ? calls.map((r) => [r.ts - t0, r.ctx, null, sessions.indexOf(r.session)])   // out: a call's own count is a placeholder, so no point carries it
    : usedResults.map((r) => [r.ts - t0, r.ctx, r.out, sessions.indexOf(r.session)]);
  const ctxs = points.map((p) => p[1]);
  const tools = recs.filter((r) => r.t === 'tool' && r.sub == null && !AGENT_TOOLS.has(r.name));
  const firstSeen = recs.find((r) => r.t === 'session' || r.t === 'call')?.ts ?? null;
  const sub = new Map();
  for (const r of subCalls) {
    const a = sub.get(r.sub) || { calls: 0, peak: 0 };
    a.calls += 1;
    if (r.ctx > a.peak) a.peak = r.ctx;
    sub.set(r.sub, a);
  }
  const w = windowOf(model);
  const ctxSum = sum(calls, (r) => r.ctx);
  return {
    key,
    node: steps.find((r) => r.node)?.node ?? null,
    status: steps[steps.length - 1]?.status ?? null,
    model,
    models,
    window: w?.tokens ?? null,
    windowFrom: w?.from ?? null,
    perCall,
    calls: calls.length,
    sessions: sessions.length,
    // A context size exists only per call. An end-of-session figure is a sum over every call of the
    // session (Codex, Copilot, Cursor, Gemini, Goose), so it is reported apart, never as a peak.
    peak: perCall && ctxs.length ? Math.max(...ctxs) : null,
    final: perCall && ctxs.length ? ctxs[ctxs.length - 1] : null,
    sessionInput: !perCall && usedResults.length ? sum(usedResults, (r) => r.ctx) : null,
    // A call's output count is a placeholder (Claude stream-json: the message_start value, 2–16 for
    // messages of 142–877); the result's is the real one. Without a result (a killed run) the sum of
    // the calls is only a floor.
    output: usedResults.some((r) => r.out > 0) ? sum(usedResults, (r) => r.out) : sum(calls, (r) => r.out),
    // 'calls': no result arrived (a killed spawn), so `output` is a lower bound of placeholders.
    outputFrom: usedResults.some((r) => r.out > 0) ? 'result' : calls.length ? 'calls' : null,
    cacheShare: ctxSum > 0 ? sum(calls, (r) => r.cr) / ctxSum : null,
    wallMs: startTs != null && endTs != null ? endTs - startTs : null,
    startupMs: startTs != null && firstSeen != null ? Math.max(0, firstSeen - startTs) : null,
    modelMs: sum(calls, (r) => r.gapMs),
    toolMs: sum(tools, (r) => r.ms),
    toolCalls: tools.length,
    toolErrors: tools.filter((r) => r.err).length,
    retries: recs.filter((r) => r.t === 'retry').length,
    compactions: recs.filter((r) => r.t === 'compact').map((r) => ({ at: r.ts - t0, trigger: r.trigger ?? null, preTokens: r.preTokens ?? null, sub: r.sub ?? null })),
    subAgents: recs.filter((r) => r.t === 'agent' && r.ev === 'spawn').length,
    subCalls: subCalls.length,
    subPeak: subCalls.length ? Math.max(...subCalls.map((r) => r.ctx)) : null,
    costUsd: results.length ? results[results.length - 1].costUsd : null,
    series: downsampleMax(points),
    seriesPoints: points.length,
  };
}

function harnessSummary(recs) {
  const h = recs.filter((r) => r.t === 'harness');
  const persists = sum(h, (r) => r.persists);
  const emits = sum(h, (r) => r.emits);
  const lags = h.filter((r) => Number.isFinite(r.lagP99Ms));
  return {
    windows: h.length,
    persists,
    persistMs: sum(h, (r) => r.persistMs),
    persistAvgMs: persists ? sum(h, (r) => r.persistMs) / persists : null,
    persistMaxMs: h.length ? Math.max(...h.map((r) => r.persistMaxMs || 0)) : null,
    rowsPerPersist: persists ? sum(h, (r) => r.rows) / persists : null,
    emits,
    emitBytes: sum(h, (r) => r.emitBytes),
    emitAvgBytes: emits ? sum(h, (r) => r.emitBytes) / emits : null,
    emitMaxBytes: h.length ? Math.max(...h.map((r) => r.emitMaxBytes || 0)) : null,
    lagP99MaxMs: lags.length ? Math.max(...lags.map((r) => r.lagP99Ms)) : null,
    lagMaxMs: lags.length ? Math.max(...lags.map((r) => r.lagMaxMs || 0)) : null,
  };
}

/**
 * @param {string|Array<object>} input  telemetry.ndjson text or parsed records
 * @param {{windowOf?:(model:string|null)=>({tokens:number, from:string}|null)}} [o]
 * @returns {{version:number|null, startedAt:number|null, steps:Record<string,object>, harness:object, end:object|null, records:number}}
 */
export function summarizeTelemetry(input, { windowOf = () => null } = {}) {
  const recs = Array.isArray(input) ? input : parseTelemetry(input);
  const byStep = new Map();
  for (const r of recs) {
    if (typeof r.step !== 'string' || !r.step) continue;
    let a = byStep.get(r.step);
    if (!a) { a = []; byStep.set(r.step, a); }
    a.push(r);
  }
  const steps = {};
  for (const [key, list] of byStep) steps[key] = stepSummary(key, list, windowOf);
  const run = recs.find((r) => r.t === 'run');
  const end = [...recs].reverse().find((r) => r.t === 'end') || null;
  return { version: run?.v ?? null, startedAt: run?.ts ?? null, steps, harness: harnessSummary(recs), end, records: recs.length };
}
