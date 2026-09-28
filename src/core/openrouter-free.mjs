// src/core/openrouter-free.mjs
// OpenRouter's daily allowance of `:free` requests (docs/models.md › OpenRouter): how many
// are left today. 1000 a day on an account that bought $10 of credit, 50 below; every model
// call is one request (each agent turn, each tool round trip, each retry), and a small
// pipeline run takes about 90.
//
// OpenRouter's GET /key is the truth (free_model_daily_requests). Between readings every
// `:free` call the bridge forwards lowers the count, and a 429 for the daily limit sets it to
// 0; the next reading corrects any drift. A reading is kept for READ_TTL_MS.
//
// Whose allowance: without the credential broker, the key on Settings › Providers (one per
// install). With the broker, each person's own key, read through the broker with a
// short-lived token billed to them; the bridge can't tell whose key a call used there, so
// the count refreshes more often instead of being lowered per call.
import { createHash } from 'node:crypto';
import { bridgeEvents } from './bridge/telemetry.mjs';
import { openRouterKeyInfo } from './bridge/provider-ops.mjs';
import { isOpenRouter } from './bridge/openrouter.mjs';
import { providerConfig, resolveProviderSecret, listGlobalModels } from './settings.mjs';
import { listPluginModels } from './plugin-models.mjs';
import { brokerEnabled, brokerInfo, mintSpawnToken, revokeSpawnToken, slotBaseUrl } from './broker-client.mjs';
import { isFreeDailyLimit } from './recoverable-error.mjs';

const READ_TTL_MS = 5 * 60_000;
const READ_TTL_BROKER_MS = 60_000;

/** Whether an upstream (upstreamSettings shape) is an OpenRouter `:free` model. Pure. */
export function isOpenRouterFree(us) {
  return !!us && /:free$/i.test(String(us.model || '')) && isOpenRouter(String(us.baseUrl || ''));
}

/** A stable, non-reversible name for a key: which allowance a call spent. */
export function keyAccount(apiKey) {
  return apiKey ? `key:${createHash('sha256').update(String(apiKey)).digest('hex').slice(0, 16)}` : null;
}

/** The next 00:00 UTC after `now` (ms): when OpenRouter resets the daily allowance. Pure. */
export function nextUtcMidnight(now = Date.now()) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/** The catalog's OpenRouter `:free` models (ids). Never throws. */
export function freeModelIds() {
  const openaiBase = (() => { try { return providerConfig('openai').baseUrl || ''; } catch { return ''; } })();
  const out = [];
  let all = [];
  try { all = [...listGlobalModels(), ...listPluginModels()]; } catch { all = []; }
  for (const m of all) {
    const u = m && m.upstream;
    if (!u || u.provider !== 'openai') continue;
    if (isOpenRouterFree({ model: u.model, baseUrl: u.baseUrl || openaiBase })) out.push(m.id);
  }
  return out;
}

// account -> { used, limit, remaining, readAt, resetAt }
const state = new Map();
const inflight = new Map();

function remember(account, info, now) {
  const fd = info && info.freeDaily;
  if (!fd) { state.set(account, { none: true, readAt: now }); return state.get(account); }
  const s = { used: fd.used, limit: fd.limit, remaining: fd.remaining, readAt: now, resetAt: nextUtcMidnight(now) };
  state.set(account, s);
  return s;
}

/** Lower an account's count by one call (a `:free` call the bridge forwarded). */
export function tallyFreeCall(account, now = Date.now()) {
  const s = account && state.get(account);
  if (!s || s.none) return;
  if (now >= s.resetAt) { state.delete(account); return; }   // a new day: the next reading says
  s.used = Math.min(s.limit, s.used + 1);
  s.remaining = Math.max(0, s.remaining - 1);
}

/** The daily limit was hit: nothing is left until the reset. */
export function markFreeDailySpent(account) {
  const s = account && state.get(account);
  if (!s || s.none) return;
  s.used = s.limit;
  s.remaining = 0;
}

// The bridge's telemetry: every forwarded `:free` call lowers the count of the key it used;
// a daily-limit refusal empties it.
bridgeEvents.on('call', (e) => { if (e && e.free && e.account) tallyFreeCall(e.account); });
bridgeEvents.on('failure', (e) => { if (e && e.account && isFreeDailyLimit(e.message)) markFreeDailySpent(e.account); });

/** Which allowance `person` spends from, and how to read it: {account, read:(fetch)=>info}. */
async function source(person) {
  if (brokerEnabled()) {
    const info = await brokerInfo();
    const who = info.mode === 'multi' ? person : 'local';
    if (!who || who === 'local' && info.mode === 'multi') return null;
    const base = slotBaseUrl('openrouter');
    if (!base || !(info.slots || []).some((s) => s.id === 'openrouter')) return null;
    return {
      account: `person:${who}`,
      ttl: READ_TTL_BROKER_MS,
      read: async (f) => {
        const minted = await mintSpawnToken({ billTo: who, slots: ['openrouter'], kind: 'aux' });
        try { return await openRouterKeyInfo(`${base}/api/v1`, minted.token, { fetch: f }); } finally { revokeSpawnToken(minted.spawnId); }
      },
    };
  }
  const cfg = providerConfig('openai');
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '');
  const key = resolveProviderSecret(cfg.apiKey);
  if (!isOpenRouter(base) || !key) return null;
  return { account: keyAccount(key), ttl: READ_TTL_MS, read: (f) => openRouterKeyInfo(base, key, { fetch: f }) };
}

/**
 * Today's free-model allowance for `person` (the signed-in viewer; ignored without the broker).
 * `models`: the catalog's OpenRouter `:free` model ids (the new-run form checks its nodes against them).
 * @returns {Promise<{enabled:false}|{enabled:true, known:false, models:string[], reason?:string}|
 *   {enabled:true, known:true, models:string[], used:number, limit:number, remaining:number, resetAt:string, readAt:string}>}
 */
export async function freeDailyStatus({ person = null, force = false, fetch: f = globalThis.fetch, now = Date.now } = {}) {
  const models = freeModelIds();
  if (!models.length) return { enabled: false };
  let src;
  try { src = await source(person); } catch (err) { return { enabled: true, known: false, models, reason: err.message }; }
  if (!src) return { enabled: true, known: false, models, reason: 'no OpenRouter key to read' };
  let s = state.get(src.account);
  const t = now();
  if (force || !s || t - s.readAt > src.ttl || (s.resetAt && t >= s.resetAt)) {
    if (!inflight.has(src.account)) {
      inflight.set(src.account, (async () => {
        try { return remember(src.account, await src.read(f), now()); } finally { inflight.delete(src.account); }
      })());
    }
    try { s = await inflight.get(src.account); } catch { /* keep the last reading */ }
  }
  if (!s || s.none) return { enabled: true, known: false, models, reason: 'OpenRouter did not report a daily allowance for this key' };
  return {
    enabled: true, known: true, models, used: s.used, limit: s.limit, remaining: s.remaining,
    resetAt: new Date(s.resetAt).toISOString(), readAt: new Date(s.readAt).toISOString(),
  };
}

/** The last reading for `person`'s allowance, without a network call: {used, limit} or {}. */
export function cachedFreeDailyCounts(person = null) {
  let account = null;
  if (brokerEnabled()) account = person ? `person:${person}` : 'person:local';
  else {
    try {
      const cfg = providerConfig('openai');
      if (isOpenRouter(String(cfg.baseUrl || ''))) account = keyAccount(resolveProviderSecret(cfg.apiKey));
    } catch { account = null; }
  }
  const s = account && state.get(account);
  return s && !s.none ? { used: s.used, limit: s.limit } : {};
}

/** Test hook. */
export function _resetFreeDaily() { state.clear(); inflight.clear(); }
