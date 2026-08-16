/**
 * Delivery-edge helpers shared by every chat plugin's worker: outbound text
 * chunking and the platform 429 retry ladder. Vendored byte-identically into
 * every chat plugin; test/chat-lib-drift.test.mjs enforces the copies never
 * diverge. Policy rate limiting lives HOST-side — this ladder only absorbs the
 * platform's own 429s at the send edge.
 * @module lib/send-util
 */

import { SEND_BACKOFF_DELAYS } from './segments.mjs';

/**
 * Split rendered text into <= limit chunks, preferring newline boundaries so a
 * multi-line status block never breaks mid-line. Always returns >= 1 chunk.
 * @param {string} text @param {number} limit
 * @returns {string[]}
 */
export function splitText(text, limit, { preferNewline = true } = {}) {
  const s = String(text ?? '');
  if (s.length <= limit) return [s];
  const chunks = [];
  let rest = s;
  while (rest.length > limit) {
    let cut = limit;
    if (preferNewline) {
      // limit-1: a newline AT index limit would make a limit+1-char chunk.
      const nl = rest.lastIndexOf('\n', limit - 1);
      if (nl > limit / 2) cut = nl + 1;
    }
    // Never cut between a surrogate pair (skip at cut===1: a 1-char budget
    // cannot hold a pair, and decrementing to 0 would loop forever).
    const cc = rest.charCodeAt(cut - 1);
    if (cc >= 0xd800 && cc <= 0xdbff && cut > 1) cut -= 1;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  chunks.push(rest);
  return chunks;
}

/** A typed send error the channel-worker child maps into send-result frames. */
export function sendError(kind, message, retryAfterMs) {
  const e = new Error(message);
  e.kind = kind;
  if (Number.isFinite(retryAfterMs)) e.retryAfterMs = retryAfterMs;
  return e;
}

/**
 * Run one HTTP send attempt through the 429 ladder. `attempt(n)` performs the
 * request and returns {retryAfterMs} to request a retry (platform 429) or
 * anything else to finish; throwing aborts immediately. Exhausted retries
 * throw kind 'rate-limit'.
 * @param {(attempt:number) => Promise<{retryAfterMs?:number}|void>} attempt
 * @param {(ms:number) => Promise<void>} [sleep]
 */
export async function withRetryLadder(attempt, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  let lastRetryMs = 0;
  for (let i = 0; i <= SEND_BACKOFF_DELAYS.length; i++) {
    const out = await attempt(i);
    if (!out || !Number.isFinite(out.retryAfterMs)) return out;
    lastRetryMs = out.retryAfterMs || SEND_BACKOFF_DELAYS[Math.min(i, SEND_BACKOFF_DELAYS.length - 1)];
    if (i === SEND_BACKOFF_DELAYS.length) break;
    await sleep(lastRetryMs);
  }
  throw sendError('rate-limit', 'platform rate limit persisted after retries', lastRetryMs);
}
