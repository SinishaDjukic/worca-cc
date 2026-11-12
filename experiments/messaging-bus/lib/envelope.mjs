// experiments/messaging-bus/lib/envelope.mjs
// The bus envelope (plan §3.1): time-ordered ids, topic rules, size and hop limits.
// `from`, `origin` and `seq` are stamped by the transport, so validateDraft drops them.
import { randomBytes } from 'node:crypto';

export const BODY_TEXT_MAX = 4000; // = CHAT_MESSAGE_TEXT_MAX on the cross-chat branch
export const BODY_DATA_MAX = 8192; // bytes of JSON
export const MAX_HOPS = 6; // = CHAT_MESSAGE_MAX_HOPS
export const KINDS = new Set(['note', 'question', 'answer', 'contract.changed', 'finding', 'status', 'direction']);
export const FROM_KINDS = new Set(['run', 'step', 'agent', 'chat', 'person', 'system']);
export const SCOPE_KINDS = new Set(['project', 'workspace', 'none']);

const SEGMENT = '[a-z0-9_-]{1,64}';
/** A whole topic: 1..8 dotted segments (the 200-char cap is checked separately). */
export const TOPIC_RE = new RegExp(`^${SEGMENT}(?:\\.${SEGMENT}){0,7}$`);
const PATTERN_RE = new RegExp(`^${SEGMENT}(?:\\.${SEGMENT}){0,6}\\.\\*$`);
const ID_SEGMENT_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ENVELOPE_ID_RE = /^m_[0-9A-HJKMNP-TV-Z]{26}$/;

export class BusError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BusError';
    this.code = code;
  }
}

// Crockford base32: 10 chars of ms timestamp + 16 chars (80 bits) of randomness, monotonic within a ms.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RAND_MAX = (1n << 80n) - 1n;
let lastTime = -1;
let lastRand = 0n;

function encode(n, len) {
  let out = '';
  let v = BigInt(n);
  for (let i = 0; i < len; i++) {
    out = B32[Number(v & 31n)] + out;
    v >>= 5n;
  }
  return out;
}

/** 'm_' + 26 chars; strictly increasing within this process even when the clock stalls or steps back. */
export function newId(now = Date.now()) {
  let t = Math.max(0, Math.floor(now));
  if (t <= lastTime) {
    t = lastTime;
    lastRand += 1n;
    if (lastRand > RAND_MAX) { t += 1; lastRand = BigInt('0x' + randomBytes(10).toString('hex')) >> 1n; }
  } else {
    // the top bit stays clear so many same-ms increments never overflow
    lastRand = BigInt('0x' + randomBytes(10).toString('hex')) >> 1n;
  }
  lastTime = t;
  return 'm_' + encode(t, 10) + encode(lastRand, 16);
}

/** A topic to publish on (`pattern: true` also allows one trailing `*` segment, for subscriptions). */
export function validateTopic(t, { pattern = false } = {}) {
  const fail = (message) => ({ ok: false, code: 'BUS_BAD_TOPIC', message });
  if (typeof t !== 'string' || t.length === 0) return fail('topic must be a non-empty string');
  if (t.length > 200) return fail('topic longer than 200 chars');
  if (TOPIC_RE.test(t)) return { ok: true };
  if (pattern && PATTERN_RE.test(t)) return { ok: true };
  return fail(`bad topic ${JSON.stringify(t.slice(0, 80))}: dotted [a-z0-9_-]{1,64} segments, at most 8`);
}

/** An id that may become part of a consumer id (session_id, agent_id, reader). */
export function validateSegmentId(s) {
  return typeof s === 'string' && ID_SEGMENT_RE.test(s);
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const strOrNull = (v) => v === undefined || v === null || typeof v === 'string';

/** A draft → a normalised envelope without the stamped fields, or the first refusal. */
export function validateDraft(d) {
  const bad = (code, message) => ({ ok: false, code, message });
  if (!isObj(d)) return bad('BUS_BAD_ENVELOPE', 'draft must be an object');
  const topic = validateTopic(d.topic);
  if (!topic.ok) return topic;
  if (!KINDS.has(d.kind)) return bad('BUS_BAD_ENVELOPE', `unknown kind ${JSON.stringify(String(d.kind).slice(0, 40))}`);
  if (!isObj(d.body) || typeof d.body.text !== 'string') return bad('BUS_BAD_ENVELOPE', 'body.text must be a string');
  if (d.body.text.length > BODY_TEXT_MAX) return bad('BUS_TOO_LARGE', `body.text over ${BODY_TEXT_MAX} chars`);
  const body = { text: d.body.text };
  if (d.body.data !== undefined) {
    if (!isObj(d.body.data)) return bad('BUS_BAD_ENVELOPE', 'body.data must be an object');
    let json;
    try { json = JSON.stringify(d.body.data); } catch { return bad('BUS_BAD_ENVELOPE', 'body.data is not JSON'); }
    if (Buffer.byteLength(json, 'utf8') > BODY_DATA_MAX) return bad('BUS_TOO_LARGE', `body.data over ${BODY_DATA_MAX} bytes`);
    body.data = JSON.parse(json);
  }
  const hop = d.hop ?? 1;
  if (!Number.isInteger(hop) || hop < 1) return bad('BUS_BAD_ENVELOPE', 'hop must be an integer ≥ 1');
  if (hop > MAX_HOPS) return bad('BUS_HOP_LIMIT', `hop ${hop} over ${MAX_HOPS}`);
  if (d.id !== undefined && (typeof d.id !== 'string' || !ENVELOPE_ID_RE.test(d.id))) return bad('BUS_BAD_ENVELOPE', 'bad id');
  if (!strOrNull(d.corr) || !strOrNull(d.replyTo)) return bad('BUS_BAD_ENVELOPE', 'corr/replyTo must be strings');
  if (d.replyTo && !ENVELOPE_ID_RE.test(d.replyTo)) return bad('BUS_BAD_ENVELOPE', 'replyTo must be an envelope id');
  const ttlMs = d.ttlMs ?? null;
  if (ttlMs !== null && (!Number.isInteger(ttlMs) || ttlMs < 1)) return bad('BUS_BAD_ENVELOPE', 'ttlMs must be a positive integer');
  let scope = { kind: 'none', key: null, owner: null };
  if (d.scope !== undefined) {
    if (!isObj(d.scope) || !SCOPE_KINDS.has(d.scope.kind) || !strOrNull(d.scope.key) || !strOrNull(d.scope.owner)) {
      return bad('BUS_BAD_ENVELOPE', 'bad scope');
    }
    scope = { kind: d.scope.kind, key: d.scope.key ?? null, owner: d.scope.owner ?? null };
  }
  const ts = d.ts ?? Date.now();
  if (!Number.isInteger(ts)) return bad('BUS_BAD_ENVELOPE', 'ts must be an integer');
  return {
    ok: true,
    env: {
      v: 1, id: d.id ?? newId(), topic: d.topic, kind: d.kind, scope, ts,
      corr: d.corr ?? null, replyTo: d.replyTo ?? null, hop, ttlMs, body,
    },
  };
}

/** The transport-side identity: validated, never read from a draft. */
export function validateFrom(from) {
  if (!isObj(from) || !FROM_KINDS.has(from.kind) || typeof from.id !== 'string' || from.id.length === 0 || from.id.length > 200) {
    return { ok: false, code: 'BUS_BAD_ENVELOPE', message: 'bad from' };
  }
  if (from.sub !== undefined && from.sub !== null && !validateSegmentId(from.sub)) {
    return { ok: false, code: 'BUS_BAD_ENVELOPE', message: 'bad from.sub' };
  }
  return { ok: true, from: { kind: from.kind, id: from.id, sub: from.sub ?? null } };
}
