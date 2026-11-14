// ui/routes/prompt-check/correction-route.mjs — feature "prompt-check" (docs/prompt-check.md, "The chip"):
// POST /api/prompt-check/kind-correction records a person's correction of the chip's kind. Ids and kinds only: the body
// is validated before the setting check and any write, only the whitelisted fields are copied, and the server stamps
// `at`. Off unless the chat pref `promptCheck` is true. Its own token bucket, as the grade route.
import { TokenBucket } from '../../../src/core/chat/rate-limiter.mjs';
import { chatPrefs } from '../../../src/core/settings.mjs';
import { CORRECTION_SURFACES, CORRECTION_ID_RE, recordKindCorrection } from '../../../src/core/prompt-check/corrections.mjs';
import { PROMPT_KINDS } from '../../../src/shared/prompt-check/assessment.mjs';
import { badRequest } from '../../server.mjs';

const BUCKET_PER_MIN = 60;

let bucket = new TokenBucket(BUCKET_PER_MIN);
/** Test seam: swap the module's bucket (null restores a fresh one). */
export function _setCorrectionBucketForTest(b) { bucket = b || new TokenBucket(BUCKET_PER_MIN); }

const validId = (v) => v === undefined || v === null || (typeof v === 'string' && CORRECTION_ID_RE.test(v));
const present = (v) => v !== undefined && v !== null && v !== '';

/** The request body → {error} or the whitelisted correction. */
function validate(b) {
  if (!CORRECTION_SURFACES.includes(b.surface)) return { error: 'surface is required' };
  if (b.surface === 'new-run' ? !present(b.runId) : !present(b.threadId)) {
    return { error: b.surface === 'new-run' ? 'runId is required' : 'threadId is required' };
  }
  if (![b.threadId, b.cardId, b.runId].every(validId)) return { error: 'id is invalid' };
  if (!PROMPT_KINDS.includes(b.proposedKind)) return { error: 'proposedKind is invalid' };
  if (!PROMPT_KINDS.includes(b.chosenKind)) return { error: 'chosenKind is invalid' };
  if (b.chosenKind === b.proposedKind) return { error: 'the kind did not change' };
  return {
    surface: b.surface,
    threadId: b.threadId ?? null,
    cardId: b.cardId ?? null,
    runId: b.runId ?? null,
    proposedKind: b.proposedKind,
    chosenKind: b.chosenKind,
  };
}

export function register(app) {

app.post('/api/prompt-check/kind-correction', (req, res) => {
  const startedMs = Date.now();
  let surface = 'unknown';
  try {
    const v = validate(req.body && typeof req.body === 'object' ? req.body : {});
    if (v.error) return badRequest(res, v.error);
    surface = v.surface;   // from the four-value enum, never the raw body
    if (chatPrefs().promptCheck !== true) return res.status(409).json({ error: 'prompt check is off' });
    if (!bucket.tryConsume()) return res.status(429).json({ error: 'too many corrections, try again in a moment' });
    const row = recordKindCorrection(v);
    console.log(`[worca] prompt-check kind-correction surface=${surface} ${Date.now() - startedMs}ms`);
    return res.status(201).json({ ok: true, at: row.at });
  } catch {
    // Express 4 does not catch a throw that escapes a handler's promise; answer here (fixed words, no error text).
    if (!res.headersSent) res.status(500).json({ error: 'could not record the kind correction' });
    return undefined;
  }
});
}
