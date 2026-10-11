// src/core/broker-client.mjs
// worca's side of the credential broker (plans/credential-broker-design.html §6.1).
// With WORCA_BROKER_URL set, worca holds no model credential: every claude spawn
// gets a short-lived token from the broker instead (claude-runner.mjs), and the
// broker adds the person's real key on the way to the provider.
//
//   WORCA_BROKER_URL          the broker's INTERNAL address (http://broker:8080). Unset = off.
//   WORCA_BROKER_SECRET(_FILE) the shared secret for the broker's /internal API
//   WORCA_BROKER_SYSTEM_BILL_TO who pays for work no signed-in person caused
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

/** This server process's identity towards the broker: tokens issued under an older one are revoked at boot. */
export const BOOT_ID = `srv-${randomUUID()}`;
const INFO_TTL_MS = 60_000;
const CALL_TIMEOUT_MS = 10_000;

/** Whether the broker is on (pure: reads only `env`). */
export function brokerEnabled(env = process.env) {
  return typeof env.WORCA_BROKER_URL === 'string' && env.WORCA_BROKER_URL.trim() !== '';
}

/** Why `engine` cannot run while the broker is on, else null. Only Claude Code spends through the broker; another
 *  engine signs in with its own credentials (a ChatGPT or Cursor sign-in, an API key in its env), which the broker can
 *  neither bill per person nor keep from the agent. Runs, Ask chats and GET /api/engines all refuse with this. */
export function brokerEngineRefusal(engine, env = process.env) {
  if (!brokerEnabled(env) || !engine || engine === 'claude' || engine === 'mock') return null;
  return `the credential broker is on, and ${engine} signs in with its own credentials, which the broker cannot bill or revoke`;
}

/** {url, secret, error}: the broker's address without a trailing slash, and the secret. */
export function brokerConfig(env = process.env, readFile = readFileSync) {
  if (!brokerEnabled(env)) return null;
  let url = String(env.WORCA_BROKER_URL).trim().replace(/\/+$/, '');
  let error = null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') error = 'WORCA_BROKER_URL must be http(s)';
    else if (u.pathname !== '/' || u.search || u.username) error = 'WORCA_BROKER_URL must be an origin, e.g. http://broker:8080';
    url = u.origin;
  } catch { error = 'WORCA_BROKER_URL is not a URL'; }
  let secret = null;
  const file = String(env.WORCA_BROKER_SECRET_FILE || '').trim();
  if (file) {
    try { secret = String(readFile(file, 'utf8')).trim() || null; } catch (err) { error ||= `WORCA_BROKER_SECRET_FILE cannot be read: ${err.code || err.message}`; }
  } else if (typeof env.WORCA_BROKER_SECRET === 'string') secret = env.WORCA_BROKER_SECRET.trim() || null;
  if (!secret) error ||= 'WORCA_BROKER_SECRET (or WORCA_BROKER_SECRET_FILE) is required with WORCA_BROKER_URL';
  return { url, secret, error };
}

let _cfg = null;
function cfg() {
  if (!_cfg) _cfg = brokerConfig();
  return _cfg;
}
/** Test seam: forget cached config and info. */
export function resetBrokerClient() { _cfg = null; _info = null; }

async function call(method, path, body, { timeoutMs = CALL_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const c = cfg();
  if (!c) throw new Error('the credential broker is not configured');
  if (c.error) throw new Error(c.error);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(`${c.url}${path}`, {
      method,
      headers: { authorization: `Bearer ${c.secret}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
  } catch (err) {
    throw new Error(`cannot reach the credential broker at ${c.url}: ${err.name === 'AbortError' ? 'timed out' : (err.cause?.code || err.message)}`);
  } finally { clearTimeout(timer); }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    const why = res.status === 401 ? 'the broker refused worca\'s secret (WORCA_BROKER_SECRET differs between worca and the broker)' : (data?.error || `HTTP ${res.status}`);
    throw Object.assign(new Error(`credential broker: ${why}`), { status: res.status });
  }
  return data;
}

let _info = null;
/** GET /internal/info, cached for a minute. */
export async function brokerInfo({ force = false } = {}) {
  if (!force && _info && Date.now() - _info.at < INFO_TTL_MS) return _info.value;
  const value = await call('GET', '/internal/info');
  _info = { at: Date.now(), value };
  return value;
}

/** The last info fetched, without a network call (null before the first). */
export function cachedBrokerInfo() { return _info ? _info.value : null; }

/** Mint a spawn token. Returns {token, expiresAt, spawnId}. */
export async function mintSpawnToken({ billTo, slots, runId = null, threadId = null, kind = 'phase', ttlSec, budgetUsd, isolated = false } = {}) {
  const spawnId = `sp-${randomUUID()}`;
  const body = { billTo, slots, spawnId, kind, issuer: BOOT_ID, isolated: isolated === true };
  if (runId) body.runId = String(runId);
  if (threadId) body.threadId = String(threadId);
  if (ttlSec) body.ttlSec = ttlSec;
  if (budgetUsd != null) body.budgetUsd = budgetUsd;
  const r = await call('POST', '/internal/tokens', body);
  return { ...r, spawnId };
}

/** Revoke one spawn's token. Never throws: the token also expires on its own. */
export async function revokeSpawnToken(spawnId) {
  if (!spawnId) return;
  try { await call('DELETE', `/internal/tokens/${encodeURIComponent(spawnId)}`); }
  catch (err) { console.warn(`[worca] broker: could not revoke a spawn token (it expires on its own): ${err.message}`); }
}

/** Revoke every token an earlier worca process issued (their spawns died with it). */
export async function revokeStaleTokens() {
  return call('POST', '/internal/tokens/revoke', { exceptIssuer: BOOT_ID });
}

/**
 * "Push as me": `person`'s GitHub user token for ONE git or gh call worca makes itself.
 * Rejects with .code 'not_connected' | 'not_configured' | 'expired' when there is none.
 */
export async function personGithubToken(person) {
  try {
    return await call('POST', '/internal/github-token', { person });
  } catch (err) {
    // call() folds the broker's {error, code} into the message; recover the code.
    const m = /not connected|not set up|renew|sign in again/i.exec(err.message || '');
    err.code = !m ? err.code : /not set up/i.test(m[0]) ? 'not_configured' : /not connected/i.test(m[0]) ? 'not_connected' : 'expired';
    throw err;
  }
}

/** Slot status for one person: {person, keyPage, slots:[{id,label,state,…}]}. */
export async function personSlots(person) {
  return call('GET', `/internal/people/${encodeURIComponent(String(person || '').toLowerCase())}/slots`);
}

/** Replace the plugin slots (plugin-broker-slots.mjs). Returns {slots:[id]}. */
export async function putPluginSlots(slots) {
  return call('PUT', '/internal/plugin-slots', { slots });
}

/** Usage rows, newest first. */
export async function brokerUsage({ since, billTo, runId } = {}) {
  const q = new URLSearchParams();
  if (since) q.set('since', since);
  if (billTo) q.set('billTo', billTo);
  if (runId) q.set('runId', runId);
  return call('GET', `/internal/usage${q.size ? `?${q}` : ''}`);
}

/** Spend per person and slot in a window: {rows:[{billTo, slot, usd, requests, runs, …}]}. */
export async function brokerUsageSummary({ since, until } = {}) {
  const q = new URLSearchParams();
  if (since) q.set('since', since);
  if (until) q.set('until', until);
  return call('GET', `/internal/usage/summary${q.size ? `?${q}` : ''}`);
}

/**
 * Summary rows (one per person and slot) folded into one row per person, most spend first.
 * Pure. `local` (single mode, or work no signed-in person caused) stays its own row.
 */
export function foldUsageByPerson(rows = []) {
  const by = new Map();
  for (const r of rows) {
    const p = by.get(r.billTo) || { person: r.billTo, usd: 0, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, lastAt: null, slots: [] };
    p.usd += Number(r.usd) || 0;
    p.requests += Number(r.requests) || 0;
    p.inputTokens += Number(r.inputTokens) || 0;
    p.outputTokens += Number(r.outputTokens) || 0;
    p.cacheReadTokens += Number(r.cacheReadTokens) || 0;
    if (!p.lastAt || (r.lastAt && r.lastAt > p.lastAt)) p.lastAt = r.lastAt || p.lastAt;
    p.slots.push({ slot: r.slot, plan: r.plan || 'api', usd: Number(r.usd) || 0, requests: Number(r.requests) || 0 });
    by.set(r.billTo, p);
  }
  return [...by.values()].sort((a, b) => b.usd - a.usd || b.requests - a.requests);
}

/** The broker proxy URL for a slot. */
export function slotBaseUrl(slot, env = process.env) {
  const c = brokerConfig(env);
  return c ? `${c.url}/p/${slot}` : null;
}

/** The slot a broker proxy URL names, or null when `url` is not this broker's. */
export function slotOfBaseUrl(url, env = process.env) {
  const c = brokerConfig(env);
  if (!c || typeof url !== 'string') return null;
  const m = new RegExp(`^${c.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/p/([a-z][a-z0-9-]{1,31})/?$`).exec(url.trim());
  return m ? m[1] : null;
}

/**
 * Boot check (plans/credential-broker-design.html §6.7): reach the broker (retrying
 * while it starts), then revoke tokens a previous worca process left behind.
 * Resolves with the broker's info; rejects with a one-line reason.
 */
export async function connectBroker({ waitMs = 60_000, log = console.log } = {}) {
  const c = cfg();
  if (c?.error) throw new Error(c.error);
  const deadline = Date.now() + waitMs;
  let lastErr;
  for (;;) {
    try {
      const info = await brokerInfo({ force: true });
      try { await revokeStaleTokens(); } catch (err) { log(`[worca] broker: could not revoke older tokens: ${err.message}`); }
      return info;
    } catch (err) {
      lastErr = err;
      if (err.status === 401 || Date.now() >= deadline) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error(`cannot reach the credential broker: ${lastErr?.message || 'unknown error'}`);
}
