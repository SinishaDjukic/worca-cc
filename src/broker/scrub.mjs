// src/broker/scrub.mjs
// Guarantee K4 (plans/credential-broker-design.html §6.10): nothing the broker sends
// back to an agent contains a credential. Upstream error bodies sometimes echo the
// key they rejected, in full or masked (OpenAI: "Incorrect API key provided:
// sk-ab****xyz"). Pure.
import { gunzipSync } from 'node:zlib';

export const REMOVED = '[removed by worca broker]';

export const KEY_SHAPES = Object.freeze([
  /sk-ant-[A-Za-z0-9_-]{8,}/g,                 // Anthropic keys and OAuth tokens
  /sk-[A-Za-z0-9_-]*\*{2,}[A-Za-z0-9_-]*/g,    // OpenAI's masked echo "sk-ab****xyz"
  /sk-(?:proj-|or-v1-|or-)?[A-Za-z0-9_-]{8,}/g, // OpenAI / OpenRouter keys
  /\bgh[opsu]_[A-Za-z0-9]{20,}/g,              // GitHub tokens (Copilot sign-in)
  /\bA(?:KIA|SIA)[0-9A-Z]{16}\b/g,             // AWS access key ids
  /\bwbt_[A-Za-z0-9_-]{20,}/g,                 // the broker's own spawn tokens
]);

const WINDOW = 12;

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Remove `secrets` (exact values and every 12-character window of each) and every
 * known key shape from `text`.
 * @param {string} text
 * @param {string[]} [secrets]
 */
export function scrubText(text, secrets = []) {
  let out = String(text ?? '');
  for (const secret of secrets) {
    const s = String(secret || '');
    if (s.length < 8) continue;
    out = out.split(s).join(REMOVED);
    if (s.length > WINDOW) {
      // Any 12-char slice of the secret (a truncated echo) — one alternation, built once.
      const parts = new Set();
      for (let i = 0; i + WINDOW <= s.length; i++) parts.add(escapeRe(s.slice(i, i + WINDOW)));
      out = out.replace(new RegExp([...parts].join('|'), 'g'), REMOVED);
    }
  }
  for (const re of KEY_SHAPES) out = out.replace(re, REMOVED);
  return out;
}

const REMOVED_BYTES = Buffer.from(REMOVED);
const MIN_SECRET = 8;   // as scrubText: a shorter value is no secret worth matching
const secretValues = (secrets) => [...new Set((secrets || []).map((s) => String(s || '')).filter((s) => s.length >= MIN_SECRET))];

/** Exact-value scrub of `secrets` over a byte stream: a value split across chunks is still caught; only bytes
 *  that could begin a value (at most longest − 1) are held back. Never decodes, so UTF-8 split across chunks
 *  passes intact. Values under 8 characters are skipped, as scrubText does. Any chunking gives the same bytes
 *  as one whole-body pass (earliest match first, the longest on a tie). */
export function createByteScrubber(secrets = []) {
  const keys = secretValues(secrets).map((s) => Buffer.from(s));
  const hold = keys.reduce((m, k) => Math.max(m, k.length - 1), 0);
  let carry = Buffer.alloc(0);
  // The earliest position from `from` whose tail is a proper prefix of some value: it may finish in the next chunk.
  const pendingFrom = (buf, from) => {
    for (let i = Math.max(from, buf.length - hold); i < buf.length; i++) {
      const tail = buf.subarray(i);
      if (keys.some((k) => k.length > tail.length && k.subarray(0, tail.length).equals(tail))) return i;
    }
    return buf.length;
  };
  const scan = (buf, final) => {
    const out = []; let pos = 0; let cut;
    for (;;) {
      const wait = final ? buf.length : pendingFrom(buf, pos);
      let at = -1; let len = 0;
      for (const k of keys) { const i = buf.indexOf(k, pos); if (i !== -1 && (at === -1 || i < at || (i === at && k.length > len))) { at = i; len = k.length; } }
      // A match at or after `wait` could lose to a longer or earlier value still arriving: decide it next chunk.
      if (at === -1 || at >= wait) { cut = wait; break; }
      out.push(buf.subarray(pos, at), REMOVED_BYTES); pos = at + len;
    }
    out.push(buf.subarray(pos, cut));
    carry = Buffer.from(buf.subarray(cut));
    return Buffer.concat(out);
  };
  return {
    push: (chunk) => (keys.length ? scan(carry.length ? Buffer.concat([carry, chunk]) : Buffer.from(chunk), false) : Buffer.from(chunk)),
    flush: () => (keys.length ? scan(carry, true) : Buffer.alloc(0)),
  };
}

// ── Connect replies (Cursor: the broker's cursor slot, the relay's Connect routes) ──
// A streamed Connect reply is a run of envelopes: 1 flag byte (bit 0 compressed, bit 1 end of stream), a 4-byte
// big-endian length, then the message. A value inside a compressed message passes a byte scrub, so these replies are
// read message by message.

/** Asked of every Connect upstream: uncompressed messages. A Connect server may still answer in the request's own
 *  compression; createConnectScrubber reads gzip messages too. */
export const CONNECT_IDENTITY = Object.freeze({ 'connect-accept-encoding': 'identity' });
const encodingOf = (v) => String(v ?? '').trim().toLowerCase();
const isIdentity = (v) => encodingOf(v) === '' || encodingOf(v) === 'identity';
// Named in a refusal only when it is a known encoding: a header value is the upstream's, and may hold anything.
const KNOWN_ENCODINGS = new Set(['gzip', 'br', 'deflate', 'zstd', 'snappy', 'compress']);
const encodingName = (v) => (KNOWN_ENCODINGS.has(encodingOf(v)) ? `${encodingOf(v)} encoding` : 'an unknown encoding');
/** A streamed Connect reply (application/connect+…) is enveloped; a unary one (application/proto, json) is not. */
export const isConnectStream = (contentType) => /^application\/connect\+/i.test(String(contentType ?? '').trim());

/** Why a 2xx Connect reply with `headers` (lower-cased) cannot be checked for credentials, or null: a stream's messages
 *  in an encoding other than identity or gzip, or a body still in an HTTP content-encoding (`decoded`: the caller's
 *  HTTP client decoded it already, as fetch does). */
export function connectReplyProblem(headers, { decoded = false } = {}) {
  const h = headers || {};
  if (!decoded && !isIdentity(h['content-encoding'])) return `a reply in ${encodingName(h['content-encoding'])}`;
  const messages = h['connect-content-encoding'];
  if (isConnectStream(h['content-type']) && !isIdentity(messages) && encodingOf(messages) !== 'gzip') return `messages in ${encodingName(messages)}`;
  return null;
}

/** createByteScrubber for a streamed Connect reply, message by message: a gzip message is inflated before the scrub,
 *  and every message goes out uncompressed with its own length, so the framing holds when a value is replaced.
 *  push() returns null from the first message it cannot read (larger than `maxMessage`, or flagged compressed and
 *  not gzip): nothing of it passes, and the caller cuts the stream. flush() drops a message the upstream left
 *  unfinished. */
export function createConnectScrubber(secrets = [], { maxMessage = 32 << 20 } = {}) {
  const bytes = createByteScrubber(secrets);
  let buf = Buffer.alloc(0); let refused = false;
  const refuse = () => { refused = true; buf = Buffer.alloc(0); return null; };
  return {
    push(chunk) {
      if (refused) return null;
      buf = buf.length ? Buffer.concat([buf, chunk]) : Buffer.from(chunk);
      const out = [];
      while (buf.length >= 5) {
        const flag = buf[0]; const len = buf.readUInt32BE(1);
        if (len > maxMessage) return refuse();
        if (buf.length < 5 + len) break;
        let msg = buf.subarray(5, 5 + len); buf = buf.subarray(5 + len);
        if (flag & 1) { try { msg = gunzipSync(msg, { maxOutputLength: maxMessage }); } catch { return refuse(); } }
        const clean = Buffer.concat([bytes.push(msg), bytes.flush()]);
        const head = Buffer.alloc(5); head[0] = flag & 0xfe; head.writeUInt32BE(clean.length, 1);
        out.push(head, clean);
      }
      return Buffer.concat(out);
    },
    flush() { buf = Buffer.alloc(0); return Buffer.alloc(0); },
  };
}
