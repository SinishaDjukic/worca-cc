// src/broker/tokens.mjs
// Per-spawn tokens (plans/credential-broker-design.html §5.4). A token is
// `wbt_` + 43 base64url chars (32 random bytes). The broker stores only its
// SHA-256, so a copy of the database cannot be replayed. The `wbt_` prefix exists so
// worca can redact a token wherever agent output is stored or shown.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOKEN_PREFIX = 'wbt_';
export const TOKEN_RE = /^wbt_[A-Za-z0-9_-]{43}$/;
export const SPAWN_KINDS = Object.freeze(['phase', 'ask', 'aux', 'test']);
/** Default and maximum lifetime per spawn kind, before the operator's global cap. */
export const KIND_TTL_MS = Object.freeze({ aux: 10 * 60_000, test: 10 * 60_000, ask: 2 * 3_600_000, phase: 24 * 3_600_000 });
const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const EMAIL_RE = /^[^\s@<>]{1,200}(@[^\s@<>]{1,200})?$/;

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

/** Constant-time string comparison (both sides hashed first so lengths match). */
export function safeEqual(a, b) {
  const ha = createHash('sha256').update(String(a ?? '')).digest();
  const hb = createHash('sha256').update(String(b ?? '')).digest();
  return timingSafeEqual(ha, hb) && String(a ?? '').length === String(b ?? '').length;
}

/** Normalise a person id: lower-cased email, or 'local'. null when unusable. */
export function normalizeBillTo(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return s && EMAIL_RE.test(s) ? s : null;
}

/**
 * Validate a mint request body. Returns {req} or {error}.
 * @param {object} body {billTo, slots, spawnId, runId?, threadId?, kind, ttlSec?, budgetUsd?, issuer}
 */
export function parseMintRequest(body, { slotIds, maxTtlMs }) {
  const b = body && typeof body === 'object' ? body : {};
  const billTo = normalizeBillTo(b.billTo);
  if (!billTo) return { error: 'billTo must be an email or "local"' };
  if (!Array.isArray(b.slots) || !b.slots.length || !b.slots.every((s) => slotIds.includes(s))) {
    return { error: `slots must be a non-empty list of known slots (${slotIds.join(', ')})` };
  }
  if (!ID_RE.test(String(b.spawnId || ''))) return { error: 'spawnId is required ([A-Za-z0-9._:-], at most 128)' };
  if (!ID_RE.test(String(b.issuer || ''))) return { error: 'issuer is required' };
  for (const k of ['runId', 'threadId']) {
    if (b[k] != null && !ID_RE.test(String(b[k]))) return { error: `${k} has unsupported characters` };
  }
  const kind = SPAWN_KINDS.includes(b.kind) ? b.kind : null;
  if (!kind) return { error: `kind must be one of ${SPAWN_KINDS.join(', ')}` };
  const kindMax = KIND_TTL_MS[kind];
  let ttlMs = kindMax;
  if (b.ttlSec != null) {
    const n = Number(b.ttlSec);
    if (!Number.isFinite(n) || n <= 0) return { error: 'ttlSec must be a positive number' };
    ttlMs = Math.min(n * 1000, kindMax);
  }
  ttlMs = Math.min(ttlMs, maxTtlMs);
  let budgetUsd = null;
  if (b.budgetUsd != null) {
    const n = Number(b.budgetUsd);
    if (!Number.isFinite(n) || n < 0) return { error: 'budgetUsd must be a number >= 0' };
    budgetUsd = n;
  }
  return {
    req: {
      billTo, slots: [...new Set(b.slots)], spawnId: String(b.spawnId), issuer: String(b.issuer),
      runId: b.runId != null ? String(b.runId) : null, threadId: b.threadId != null ? String(b.threadId) : null,
      kind, ttlMs, budgetUsd,
      // worca says so when the spawn runs under its person's own agent user (agent-pool.mjs):
      // only then may a personal Claude subscription be used for it in multi mode.
      isolated: b.isolated === true,
    },
  };
}

/** Mint and store a token. Returns {token, expiresAt}. A reused spawnId revokes the old token first. */
export function mintToken(store, req, now = Date.now()) {
  const old = store.tokenBySpawn(req.spawnId);
  if (old) {
    store.revokeSpawn(req.spawnId, now);
    store.db.prepare('DELETE FROM tokens WHERE spawn_id = ?').run(req.spawnId);
  }
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  const expiresAt = now + req.ttlMs;
  store.insertToken({ ...req, hash: hashToken(token), createdAt: now, expiresAt });
  return { token, expiresAt: new Date(expiresAt).toISOString() };
}

/**
 * Look a presented token up. Returns {row} for a live token, or {error} naming why
 * it is refused ('missing' | 'malformed' | 'unknown' | 'revoked' | 'expired').
 */
export function resolveToken(store, token, now = Date.now()) {
  if (!token) return { error: 'missing' };
  if (!TOKEN_RE.test(token)) return { error: 'malformed' };
  const row = store.tokenByHash(hashToken(token));
  if (!row) return { error: 'unknown' };
  if (row.revoked_at) return { error: 'revoked' };
  if (Date.parse(row.expires_at) <= now) return { error: 'expired' };
  let slots = [];
  try { slots = JSON.parse(row.slots); } catch { slots = []; }
  return { row: { ...row, slots } };
}

/** The token a request carries: `x-api-key`, or `Authorization: Bearer`. */
export function tokenFromHeaders(headers) {
  const k = headers['x-api-key'];
  if (typeof k === 'string' && k.trim()) return k.trim();
  const a = headers.authorization;
  if (typeof a === 'string') {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(a);
    if (m) return m[1];
  }
  return null;
}
