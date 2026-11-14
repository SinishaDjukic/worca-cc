// ui/routes/prompt-check/grade-route.mjs — feature "prompt-check" (docs/prompt-check.md): POST /api/prompt-check/grade
// grades how clear a task prompt is. Modelled on POST /api/naming/suggest: its own token bucket, a deterministic fallback
// when the budget is blocked or no model is available, an abort on res.close, utility cost booked as 'prompt-check'.
// Off unless the chat pref `promptCheck` is true. Responses are built from fixed keys; prompt and reply text never
// reach a log line.
import { TokenBucket } from '../../../src/core/chat/rate-limiter.mjs';
import { budgetStatus, recordUtilityCost } from '../../../src/core/cost-budget.mjs';
import { chatPrefs } from '../../../src/core/settings.mjs';
import { chatDescriptor } from '../../../src/core/engines/chat.mjs';
import { claimGrade, releaseGrade, gradeModel, gradePrompt } from '../../../src/core/prompt-check/grade.mjs';
import { PROMPT_CHECK_WINDOW } from '../../../src/shared/prompt-check/assessment.mjs';
import { skipReason, textHash, deterministicAssessment } from '../../../src/shared/prompt-check/filter.mjs';
import { badRequest } from '../../server.mjs';

const SURFACE_KINDS = new Set(['chat', 'new-run', 'shaper', 'run-card']);
const FORCE_TASK_SURFACES = new Set(['run-card', 'shaper']);
const TEXT_MAX = 20_000;
const WINDOW_ITEM_MAX = 4_000;
const CHAT_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
const BUCKET_PER_MIN = 60;

let bucket = new TokenBucket(BUCKET_PER_MIN);
/** Test seam: swap the module's bucket (null restores a fresh one). */
export function _setGradeBucketForTest(b) { bucket = b || new TokenBucket(BUCKET_PER_MIN); }

const isStr = (v, max) => typeof v === 'string' && v.length >= 1 && v.length <= max;

/** The request body → {error} or the validated input. Runs before any model call. */
function validate(b) {
  if (!isStr(b.requestId, 64)) return { error: 'requestId is required' };
  const s = b.surface;
  if (!s || typeof s !== 'object' || !SURFACE_KINDS.has(s.kind) || !isStr(s.id, 128)) return { error: 'surface is required' };
  if (typeof b.text !== 'string' || !b.text.trim()) return { error: 'text is required' };
  if (b.text.length > TEXT_MAX) return { error: 'text is too long' };
  const win = Array.isArray(b.window) ? b.window : [];
  if (win.length > PROMPT_CHECK_WINDOW - 1) return { error: 'window has too many messages' };
  const engine = b.engine == null ? 'claude' : b.engine;
  if (engine !== 'claude' && (typeof engine !== 'string' || !chatDescriptor(engine))) return { error: 'unknown engine' };
  if (b.chatModel != null && (typeof b.chatModel !== 'string' || !CHAT_MODEL_RE.test(b.chatModel))) return { error: 'chatModel is invalid' };
  return {
    requestId: b.requestId,
    surfaceKind: s.kind,
    surfaceKey: `${s.kind}:${s.id}`,
    text: b.text,
    window: win.filter((w) => typeof w === 'string').map((w) => w.slice(0, WINDOW_ITEM_MAX)),
    forceTask: FORCE_TASK_SURFACES.has(s.kind) && b.forceTask !== false,
    engine,
    chatModel: b.chatModel ?? null,
  };
}

/** The one log line of a request: fixed fields only (never text, window, an error message or the reply). */
function logLine({ source, skip = null, error = null, surface, startedMs }) {
  console.log(`[worca] prompt-check ${source}${skip ? ` skip=${skip}` : ''}${error ? ` error=${error}` : ''} surface=${surface} ${Date.now() - startedMs}ms`);
}

export function register(app) {

app.post('/api/prompt-check/grade', async (req, res) => {
  const startedMs = Date.now();
  let surface = 'unknown';
  try {
    const v = validate(req.body || {});
    if (v.error) return badRequest(res, v.error);
    surface = v.surfaceKind;
    const { requestId } = v;
    if (chatPrefs().promptCheck !== true) return res.json({ requestId, source: 'off' });
    const hash = textHash(v.text);
    const skip = skipReason(v.text, { forceTask: v.forceTask });
    if (skip) return res.json({ requestId, textHash: hash, source: 'skipped', skip });
    if (!bucket.tryConsume()) return res.status(429).json({ error: 'too many checks, try again in a moment' });
    const fallback = (error) => {
      logLine({ source: 'deterministic', error, surface, startedMs });
      return res.json({ requestId, textHash: hash, source: 'deterministic', assessment: deterministicAssessment(v.text, { forceTask: v.forceTask }), error });
    };
    if (budgetStatus().blocked) return fallback('total cost limit reached');
    const model = gradeModel(v.engine, { chatModel: v.chatModel });
    const closed = new AbortController();
    res.on('close', () => { if (!res.writableEnded) closed.abort(); });
    const ctl = claimGrade(v.surfaceKey);
    try {
      const r = await gradePrompt({ text: v.text, window: v.window, forceTask: v.forceTask }, {
        model, engine: v.engine, signal: AbortSignal.any([ctl.signal, closed.signal]),
        onCost: (c) => { try { recordUtilityCost('prompt-check', c); } catch { /* a ledger write never fails a check */ } },
      });
      if (res.headersSent || closed.signal.aborted) return undefined;
      if (r.source === 'aborted') return res.json({ requestId, source: 'superseded' });
      if (r.source === 'deterministic') {
        logLine({ source: r.source, error: r.error, surface, startedMs });
        return res.json({ requestId, textHash: hash, source: r.source, assessment: r.assessment, error: r.error });
      }
      return res.json({ requestId, textHash: hash, source: r.source, assessment: r.assessment });
    } finally {
      releaseGrade(v.surfaceKey, ctl);
    }
  } catch {
    // Express 4 does not catch a rejected async handler, and an unhandled rejection ends the server.
    logLine({ source: 'failed', surface, startedMs });
    if (!res.headersSent) res.status(500).json({ error: 'prompt check failed' });
    return undefined;
  }
});
}
