// ui/routes/prompt-check/improve-route.mjs — feature "prompt-check" (docs/prompt-check.md, "Improve"):
// POST /api/prompt-check/improve rewrites a Needs detail prompt into its kind's template. Click-only: the body is
// validated before the setting, its own token bucket, the budget and any model call; one call per surface (a newer one
// supersedes it); a 60 s timeout; utility cost booked as 'prompt-improve'. Cited paths are grounded against the
// request's registered project only and answered as {path, inRepo} pairs, never contents. Off answers 409, like the
// correction route. Responses are built from fixed keys; text, reply, paths and project never reach a log line.
import { TokenBucket } from '../../../src/core/chat/rate-limiter.mjs';
import { budgetStatus, recordUtilityCost } from '../../../src/core/cost-budget.mjs';
import { chatPrefs } from '../../../src/core/settings.mjs';
import { chatDescriptor } from '../../../src/core/engines/chat.mjs';
import { claimGrade, releaseGrade } from '../../../src/core/prompt-check/grade.mjs';
import { improveModel, improvePrompt } from '../../../src/core/prompt-check/improve.mjs';
import { pathsInRepo } from '../../../src/core/shape/grounding.mjs';
import { PROMPT_KINDS } from '../../../src/shared/prompt-check/assessment.mjs';
import { citedPaths, rewriteText } from '../../../src/shared/prompt-check/improve.mjs';
import { badRequest, projectDirForKey, registeredProjectForDir } from '../../server.mjs';

const SURFACE_KINDS = new Set(['chat', 'new-run', 'shaper', 'run-card']);
const TEXT_MAX = 20_000;
const OPEN_DECISIONS_MAX = 6;
const OPEN_DECISION_MAX = 400;
const PROJECT_MAX = 1024;
const PATH_MAX = 300;
const CHAT_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
const BUCKET_PER_MIN = 10;

let bucket = new TokenBucket(BUCKET_PER_MIN);
/** Test seam: swap the module's bucket (null restores a fresh one). */
export function _setImproveBucketForTest(b) { bucket = b || new TokenBucket(BUCKET_PER_MIN); }

const isStr = (v, max) => typeof v === 'string' && v.length >= 1 && v.length <= max;
const projectOk = (v) => v == null || (typeof v === 'string' && v.length <= PROJECT_MAX);

/** The request body → {error} or the validated input. Runs before any model call. */
function validate(b) {
  if (!isStr(b.requestId, 64)) return { error: 'requestId is required' };
  const s = b.surface;
  if (!s || typeof s !== 'object' || !SURFACE_KINDS.has(s.kind) || !isStr(s.id, 128)) return { error: 'surface is required' };
  if (typeof b.text !== 'string' || !b.text.trim()) return { error: 'text is required' };
  if (b.text.length > TEXT_MAX) return { error: 'text is too long' };
  if (!PROMPT_KINDS.includes(b.kind)) return { error: 'kind is invalid' };
  const od = b.openDecisions == null ? [] : b.openDecisions;
  if (!Array.isArray(od) || od.length > OPEN_DECISIONS_MAX || !od.every((d) => typeof d === 'string')) return { error: 'openDecisions is invalid' };
  if (!projectOk(b.projectKey) || !projectOk(b.projectDir) || (b.projectKey && b.projectDir)) return { error: 'project is invalid' };
  const engine = b.engine == null ? 'claude' : b.engine;
  if (engine !== 'claude' && (typeof engine !== 'string' || !chatDescriptor(engine))) return { error: 'unknown engine' };
  if (b.chatModel != null && (typeof b.chatModel !== 'string' || !CHAT_MODEL_RE.test(b.chatModel))) return { error: 'chatModel is invalid' };
  return {
    requestId: b.requestId,
    surfaceKind: s.kind,
    surfaceKey: `improve:${s.kind}:${s.id}`,
    text: b.text,
    kind: b.kind,
    openDecisions: od.map((d) => d.slice(0, OPEN_DECISION_MAX)),
    projectKey: b.projectKey || null,
    projectDir: b.projectDir || null,
    engine,
    chatModel: b.chatModel ?? null,
  };
}

/** The project root of a request (D8): a known key or a registered dir; anything else grounds against no root. */
async function projectRoot(v) {
  try {
    if (v.projectKey) return (await projectDirForKey(v.projectKey)) || null;
    if (v.projectDir) return (await registeredProjectForDir(v.projectDir))?.path || null;
  } catch { /* no root: every path is "not in the repo" */ }
  return null;
}

/** The one log line of a request: fixed fields and counts only. */
function logLine({ source, error = null, surface, paths = 0, notInRepo = 0, startedMs }) {
  console.log(`[worca] prompt-check improve source=${source}${error ? ` error=${error}` : ''} surface=${surface} paths=${paths} notInRepo=${notInRepo} ${Date.now() - startedMs}ms`);
}

export function register(app) {

app.post('/api/prompt-check/improve', async (req, res) => {
  const startedMs = Date.now();
  let surface = 'unknown';
  try {
    const v = validate(req.body && typeof req.body === 'object' ? req.body : {});
    if (v.error) return badRequest(res, v.error);
    surface = v.surfaceKind;   // from the four-value enum, never the raw body
    const { requestId } = v;
    if (chatPrefs().promptCheck !== true) return res.status(409).json({ error: 'prompt check is off' });
    if (!bucket.tryConsume()) return res.status(429).json({ error: 'too many rewrites, try again in a moment' });
    const failed = (error, model) => {
      logLine({ source: 'failed', error, surface, startedMs });
      return res.json({ requestId, source: 'failed', error, model: model ? model.label : null });
    };
    if (budgetStatus().blocked) return failed('total cost limit reached', null);
    const model = improveModel(v.engine, { chatModel: v.chatModel });
    const closed = new AbortController();
    res.on('close', () => { if (!res.writableEnded) closed.abort(); });
    // Claim the surface before any await: a newer request on the same surface always claims after this one.
    const ctl = claimGrade(v.surfaceKey);
    try {
      const root = await projectRoot(v);
      const r = await improvePrompt({ text: v.text, kind: v.kind, openDecisions: v.openDecisions }, {
        model: model?.id ?? null, engine: v.engine, signal: AbortSignal.any([ctl.signal, closed.signal]),
        onCost: (c) => { try { recordUtilityCost('prompt-improve', c); } catch { /* a ledger write never fails a rewrite */ } },
      });
      if (res.headersSent || closed.signal.aborted) { logLine({ source: 'closed', surface, startedMs }); return undefined; }
      if (r.source === 'aborted') {
        logLine({ source: 'superseded', surface, startedMs });
        return res.json({ requestId, source: 'superseded' });
      }
      if (r.source === 'failed') return failed(r.error, model);
      const text = rewriteText(r.rewrite);
      const grounded = await pathsInRepo(citedPaths(text), root);
      const paths = grounded.map((p) => ({ path: p.path.slice(0, PATH_MAX), inRepo: p.inRepo === true }));
      logLine({ source: r.source, surface, paths: paths.length, notInRepo: paths.filter((p) => !p.inRepo).length, startedMs });
      return res.json({ requestId, source: r.source, kind: v.kind, model: model ? model.label : null, rewrite: r.rewrite, text, paths });
    } finally {
      releaseGrade(v.surfaceKey, ctl);
    }
  } catch {
    // Express 4 does not catch a rejected async handler, and an unhandled rejection ends the server.
    logLine({ source: 'error', surface, startedMs });
    if (!res.headersSent) res.status(500).json({ error: 'prompt check failed' });
    return undefined;
  }
});
}
