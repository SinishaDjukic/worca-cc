// src/core/bridge/provider-ops.mjs
// The operations the Providers card and `worca models …` share
// (model-bridge-design.md §8.1, §8.4, §9): sign-in sessions for the Copilot
// device flow, sign-out, the provider state payload (never a token), the
// Copilot models list for import, the import itself, and a connection test
// for the key-based providers. Import contract: settings.mjs + the bridge's
// own modules; config.mjs imports NOTHING from here (the bridge is below it).

import {
  providerConfig, allProviders, updateProvider, resolveProviderSecret, providerSecretSet,
  copilotTermsAcknowledged, acknowledgeCopilotTerms, clearCopilotSignIn,
  listGlobalModels, addGlobalModel, updateGlobalModel,
} from '../settings.mjs';
import { modelEnvRef, maskModelEnvValue, COPILOT_TERMS_VERSION, UPSTREAM_PROVIDERS, isUpstreamBaseUrl, EFFORTS } from '../model-env.mjs';
import {
  startDeviceFlow, pollDeviceFlow, githubLogin, copilotToken, invalidateCopilotToken,
  listCopilotModels, copilotUsage, catalogEntryForCopilotModel, copilotApiFor,
} from './providers/copilot.mjs';
import { keyOptional } from './registry.mjs';
import { listEndpointModels, catalogEntryForEndpointModel, importableModel } from './providers/endpoint.mjs';
import { isOpenRouter } from './openrouter.mjs';

/** The OpenRouter API base a preset / `worca models set openrouter` points the openai provider at. */
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// ── Copilot sign-in sessions (in memory; a device code lives ~15 min) ────────
const sessions = new Map();   // deviceCode -> { startedAt, expiresAt, interval, lastPoll }
const SESSION_TTL_MS = 20 * 60 * 1000;

function sweepSessions(now = Date.now()) {
  for (const [k, s] of sessions) if (s.expiresAt < now) sessions.delete(k);
}

/**
 * Begin a Copilot sign-in. Refuses until the terms are acknowledged (§8.2).
 * @returns {Promise<{deviceCode, userCode, verificationUri, interval, expiresIn}>}
 */
export async function beginCopilotLogin({ fetch: f } = {}) {
  if (!copilotTermsAcknowledged()) {
    throw Object.assign(new Error('acknowledge the GitHub Copilot notice before signing in'), { code: 'TERMS' });
  }
  sweepSessions();
  const flow = await startDeviceFlow({ fetch: f });
  sessions.set(flow.deviceCode, { startedAt: Date.now(), expiresAt: Date.now() + Math.min(flow.expiresIn * 1000, SESSION_TTL_MS), interval: flow.interval });
  return flow;
}

/**
 * One poll of a sign-in session. On approval the GitHub token and login are
 * stored and the session ends.
 * @returns {Promise<{pending:true, interval?:number}|{ok:true, login:string}|{error:string}>}
 */
export async function pollCopilotLogin(deviceCode, { fetch: f } = {}) {
  sweepSessions();
  const s = sessions.get(deviceCode);
  if (!s) return { error: 'unknown or expired sign-in session — start again' };
  const r = await pollDeviceFlow(deviceCode, { fetch: f });
  if (r.pending) { if (r.interval) s.interval = r.interval; return { pending: true, interval: s.interval }; }
  sessions.delete(deviceCode);
  if (r.error) return { error: r.error };
  let login = '';
  try { login = await githubLogin(r.token, { fetch: f }); } catch { login = ''; }
  // Prove the account has Copilot before storing: a token without Copilot
  // access would only fail later, mid-run.
  try {
    await copilotToken(r.token, { fetch: f, force: true });
  } catch (err) {
    return { error: err && err.code === 'EXCHANGE' ? `signed in as ${login || 'GitHub user'}, but the account has no Copilot access — ${err.message}` : (err.message || String(err)) };
  }
  await updateProvider('copilot', { githubToken: r.token, ...(login ? { login } : {}) });
  return { ok: true, login };
}

/** Sign out of Copilot: forget the token, drop the cached exchange. */
export async function copilotLogout() {
  const cfg = providerConfig('copilot');
  const tok = resolveProviderSecret(cfg.githubToken);
  if (tok) invalidateCopilotToken(tok);
  await clearCopilotSignIn();
}

/** Record the terms acknowledgement (§8.2). */
export async function acknowledgeTerms() { return acknowledgeCopilotTerms(); }

// ── state payloads (never a secret) ──────────────────────────────────────────

const secretSource = (v) => (!v ? null : modelEnvRef(v) ? 'env' : 'stored');

/**
 * The Providers card payload (§9). `quota` is fetched only when asked — it is
 * a network call to GitHub — and is null when the account exposes none.
 * @param {{quota?:boolean, fetch?:typeof fetch}} [opts]
 */
export async function providersState({ quota = false, fetch: f } = {}) {
  const all = allProviders();
  const c = all.copilot;
  const token = resolveProviderSecret(c.githubToken);
  const copilot = {
    connected: !!token,
    login: c.login || null,
    accountType: c.accountType,
    acknowledgedTerms: c.acknowledgedTerms || null,
    termsCurrent: copilotTermsAcknowledged(),
    termsVersion: COPILOT_TERMS_VERSION,
    maxConcurrent: c.maxConcurrent,
    tokenSource: secretSource(c.githubToken),
    tokenRef: modelEnvRef(c.githubToken) ? c.githubToken : null,
    quota: null,
  };
  if (quota && token) {
    try { copilot.quota = await copilotUsage(token, { fetch: f }); } catch { copilot.quota = null; }
  }
  const keyed = (name) => {
    const p = all[name];
    return {
      configured: !!resolveProviderSecret(p.apiKey),
      keyOptional: keyOptional(name, p.baseUrl),
      keySet: providerSecretSet(name),
      keySource: secretSource(p.apiKey),
      keyRef: modelEnvRef(p.apiKey) ? p.apiKey : null,
      keyMasked: p.apiKey && !modelEnvRef(p.apiKey) ? maskModelEnvValue(p.apiKey) : null,
      baseUrl: p.baseUrl,
      maxConcurrent: p.maxConcurrent,
    };
  };
  return { copilot, openai: keyed('openai'), anthropic: keyed('anthropic') };
}

/** Patch a provider from the UI/CLI; masked key echoes are dropped ("keep"). */
export async function patchProvider(name, patch = {}) {
  if (!UPSTREAM_PROVIDERS.includes(name)) throw new Error(`unknown provider ${JSON.stringify(name)}`);
  const p = { ...patch };
  for (const k of ['apiKey', 'githubToken']) if (typeof p[k] === 'string' && p[k].startsWith('••')) delete p[k];
  return updateProvider(name, p);
}

// ── Copilot models: list for import, import ─────────────────────────────────

/** Copilot's models for the import sheet, each with `inCatalog` (§8.4). */
export async function copilotModelsForImport({ fetch: f } = {}) {
  const c = providerConfig('copilot');
  const token = resolveProviderSecret(c.githubToken);
  if (!token) throw Object.assign(new Error('not signed in to GitHub Copilot'), { code: 'NOT_SIGNED_IN' });
  const list = await listCopilotModels(token, { accountType: c.accountType, fetch: f });
  const have = new Set(listGlobalModels().map((m) => m.id.toLowerCase()));
  return list.map((m) => ({ ...m, api: copilotApiFor(m), catalogId: `copilot-${m.id}`, inCatalog: have.has(`copilot-${m.id}`.toLowerCase()) }))
    .sort((a, b) => (Number(b.pickerEnabled) - Number(a.pickerEnabled)) || a.name.localeCompare(b.name));
}

/**
 * Import Copilot models into the catalog (§8.4). A new id gets the full
 * import shape; an existing `copilot-*` id has its api, upstream model and
 * capabilities refreshed, and its efforts widened only when they are the old
 * importer's automatic medium-only default — a user-edited label, efforts or
 * pricing is never overwritten.
 * @param {string[]} ids  Copilot model ids (not catalog ids)
 * @returns {Promise<{created:string[], updated:string[], skipped:string[]}>}
 */
export async function importCopilotModels(ids, { fetch: f } = {}) {
  const wanted = new Set((Array.isArray(ids) ? ids : []).map((s) => String(s)));
  if (!wanted.size) throw new Error('pick at least one model to import');
  const list = await copilotModelsForImport({ fetch: f });
  const byId = new Map(list.map((m) => [m.id, m]));
  const created = []; const updated = []; const skipped = [];
  for (const id of wanted) {
    const m = byId.get(id);
    if (!m) { skipped.push(id); continue; }
    const entry = catalogEntryForCopilotModel(m);
    if (m.inCatalog) {
      const current = listGlobalModels().find((x) => x.id.toLowerCase() === entry.id.toLowerCase());
      if (!current || !current.upstream || current.upstream.provider !== 'copilot') { skipped.push(id); continue; }
      const patch = { upstream: { ...current.upstream, api: entry.upstream.api, model: entry.upstream.model, capabilities: entry.upstream.capabilities } };
      // Before Copilot listed effort levels, a translated model the id regex missed
      // was stored non-reasoning and trimmed to medium. Widen exactly that automatic
      // default — never a list the user chose: a reasoning entry pinned to medium
      // stays, and an Anthropic entry was never trimmed, so its medium is the user's.
      const autoMediumOnly = current.upstream.api !== 'anthropic' && entry.upstream.api !== 'anthropic'
        && Array.isArray(current.efforts) && current.efforts.length === 1 && current.efforts[0] === 'medium'
        && !(current.upstream.capabilities && current.upstream.capabilities.reasoning === true);
      if (autoMediumOnly) {
        const next = entry.efforts === undefined ? [...EFFORTS] : entry.efforts;
        if (!(next.length === 1 && next[0] === 'medium')) patch.efforts = next;
      }
      await updateGlobalModel(current.id, patch);
      updated.push(current.id);
    } else {
      await addGlobalModel(entry);
      created.push(entry.id);
    }
  }
  return { created, updated, skipped };
}

// ── OpenAI-compatible endpoints: discovery, import ──────────────────────────

/** The provider's own base URL when the caller names none, trailing slash trimmed. */
function endpointBase(baseUrl) {
  const b = String(baseUrl || '').trim() || providerConfig('openai').baseUrl || '';
  if (!isUpstreamBaseUrl(b)) throw new Error('baseUrl must be an http(s) URL with no query or fragment');
  return b.replace(/\/+$/, '');
}

/**
 * What an OpenAI-compatible endpoint serves, each row with `catalogId` and `inCatalog` (§8.4's
 * Copilot import, for a server you run: llama.cpp, Ollama, LM Studio, vLLM, a gateway).
 * @param {{baseUrl?:string, fetch?:typeof fetch}} [opts]
 */
export async function endpointModelsForImport({ baseUrl, fetch: f } = {}) {
  const base = endpointBase(baseUrl);
  const p = providerConfig('openai');
  const key = resolveProviderSecret(p.apiKey);
  const out = await listEndpointModels(base, { apiKey: key, fetch: f });
  const have = new Set(listGlobalModels().map((m) => m.id.toLowerCase()));
  return {
    ...out,
    models: out.models.map((m) => {
      const entry = catalogEntryForEndpointModel(m, { server: out.server, baseUrl: out.baseUrl, providerBaseUrl: p.baseUrl });
      const usable = importableModel(m);
      const existing = existingEndpointEntry(m.id, out.baseUrl, p.baseUrl);
      const catalogId = existing ? existing.id : entry.id;
      return { ...m, catalogId, inCatalog: !!existing || have.has(entry.id.toLowerCase()), importable: usable.ok, ...(usable.ok ? {} : { blocked: usable.why }) };
    }),
  };
}

const trimUrl = (u) => String(u || '').trim().replace(/\/+$/, '').toLowerCase();

/**
 * The catalog entry that already imports `upstreamId` from this endpoint, whatever its id says.
 * Ids are derived (and their prefix changed: a remote endpoint's models were `local-…`), so a
 * re-import matches on what the entry POINTS AT — the openai provider, this upstream id, and this
 * base URL (its own, or the provider's when it carries none) — and refreshes the entry the user
 * already has instead of adding a twin under the new id.
 */
function existingEndpointEntry(upstreamId, baseUrl, providerBaseUrl) {
  const want = trimUrl(baseUrl);
  return listGlobalModels().find((x) => x.upstream && x.upstream.provider === 'openai'
    && x.upstream.model === upstreamId && trimUrl(x.upstream.baseUrl || providerBaseUrl) === want) || null;
}

/**
 * Import endpoint models into the catalog. A new id gets the full entry; an existing one keeps the
 * label, efforts and pricing you edited and only has its upstream refreshed.
 * @param {string[]} ids  model ids as the endpoint reports them (not catalog ids)
 * @returns {Promise<{created:string[], updated:string[], skipped:Array<{id:string, why:string}>, server:string, baseUrl:string}>}
 */
export async function importEndpointModels(ids, { baseUrl, fetch: f } = {}) {
  const wanted = new Set((Array.isArray(ids) ? ids : []).map((s) => String(s)));
  if (!wanted.size) throw new Error('pick at least one model to import');
  const out = await endpointModelsForImport({ baseUrl, fetch: f });
  const byId = new Map(out.models.map((m) => [m.id, m]));
  const p = providerConfig('openai');
  const created = []; const updated = []; const skipped = [];
  for (const id of wanted) {
    const m = byId.get(id);
    if (!m) { skipped.push({ id, why: 'the endpoint does not serve it' }); continue; }
    if (!m.importable) { skipped.push({ id, why: m.blocked || 'not usable in a pipeline' }); continue; }
    const entry = catalogEntryForEndpointModel(m, { server: out.server, baseUrl: out.baseUrl, providerBaseUrl: p.baseUrl });
    const current = existingEndpointEntry(m.id, out.baseUrl, p.baseUrl)
      || listGlobalModels().find((x) => x.id.toLowerCase() === entry.id.toLowerCase());
    if (current) {
      if (!current.upstream || current.upstream.provider !== 'openai') { skipped.push({ id, why: `"${current.id}" already exists and is not an OpenAI-compatible entry` }); continue; }
      await updateGlobalModel(current.id, { upstream: { ...current.upstream, model: entry.upstream.model, ...(entry.upstream.baseUrl ? { baseUrl: entry.upstream.baseUrl } : {}), ...(entry.upstream.capabilities ? { capabilities: entry.upstream.capabilities } : {}) } });
      updated.push(current.id);
    } else {
      await addGlobalModel(entry);
      created.push(entry.id);
    }
  }
  return { created, updated, skipped, server: out.server, serverLabel: out.serverLabel, baseUrl: out.baseUrl, warnings: out.warnings };
}

// ── OpenRouter: the key's own limits ────────────────────────────────────────

const finiteOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * What OpenRouter says about the key (GET {base}/key): credit limit and what is left, spend, the
 * free-model daily allowance and the rate limit. The `label` is dropped — OpenRouter builds it from
 * the key itself (`sk-or-v1-abc…xyz`). Never throws: null when there is no key or no answer.
 * @returns {Promise<null|{limit:number|null, limitRemaining:number|null, usage:number|null, usageDaily:number|null,
 *   isFreeTier:boolean, freeDaily:{used:number,limit:number,remaining:number}|null, rateLimit:object|null}>}
 */
export async function openRouterKeyInfo(baseUrl, apiKey, { fetch: f = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  if (!apiKey) return null;
  try {
    const r = await f(`${String(baseUrl || '').replace(/\/+$/, '')}/key`, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    const j = await r.json();
    const d = j && j.data;
    if (!d || typeof d !== 'object') return null;
    const fd = d.free_model_daily_requests;
    const rl = d.rate_limit;
    return {
      limit: finiteOrNull(d.limit),
      limitRemaining: finiteOrNull(d.limit_remaining),
      usage: finiteOrNull(d.usage),
      usageDaily: finiteOrNull(d.usage_daily),
      isFreeTier: d.is_free_tier === true,
      freeDaily: fd && typeof fd === 'object' && finiteOrNull(fd.limit) !== null
        ? { used: finiteOrNull(fd.used) ?? 0, limit: fd.limit, remaining: finiteOrNull(fd.remaining) ?? Math.max(0, fd.limit - (finiteOrNull(fd.used) ?? 0)) }
        : null,
      // OpenRouter answers `requests: -1` for a key with no request-rate limit of its own.
      rateLimit: rl && typeof rl === 'object' && finiteOrNull(rl.requests) > 0 ? { requests: rl.requests, interval: String(rl.interval || '') } : null,
    };
  } catch { return null; }
}

/** One line for the Providers card and `worca models test`. Pure. */
export function formatOpenRouterKeyInfo(info) {
  if (!info) return '';
  const usd = (n) => `$${n.toFixed(2)}`;
  const bits = [];
  if (info.limit !== null && info.limit !== undefined) {
    const left = info.limitRemaining ?? (info.usage !== null && info.usage !== undefined ? Math.max(0, info.limit - info.usage) : null);
    bits.push(left !== null ? `credit ${usd(left)} of ${usd(info.limit)} left` : `credit limit ${usd(info.limit)}`);
  } else {
    bits.push('no credit limit');
    if (info.usage !== null && info.usage !== undefined) bits.push(`${usd(info.usage)} used`);
  }
  if (info.freeDaily) bits.push(`free-model requests today ${info.freeDaily.remaining} / ${info.freeDaily.limit}`);
  if (info.isFreeTier) bits.push('free tier');
  if (info.rateLimit) bits.push(`rate limit ${info.rateLimit.requests} per ${info.rateLimit.interval}`);
  return bits.join(' · ');
}

// ── key-based providers: connection test ────────────────────────────────────

/**
 * A cheap reachability + auth check for openai / anthropic (§8.1): GET the models list with the
 * configured key. Never throws.
 *
 * `baseUrl` / `apiKey` test values that are NOT stored yet — what the user has typed into the
 * Providers card. Testing the stored ones instead made the button lie: type a local llama.cpp URL,
 * press Test, and the answer was "no API key configured", because it had tested api.openai.com.
 * A masked echo (••…) means "keep what is stored" exactly as a save does.
 * @returns {Promise<{ok:true, models?:number}|{ok:false, message:string}>}
 */
export async function testProviderConnection(name, { fetch: f = globalThis.fetch, baseUrl = '', apiKey } = {}) {
  if (name === 'copilot') {
    const c = providerConfig('copilot');
    const token = resolveProviderSecret(c.githubToken);
    if (!token) return { ok: false, message: 'not signed in' };
    try { await copilotToken(token, { fetch: f, force: true }); return { ok: true }; } catch (err) { return { ok: false, message: err.message || String(err) }; }
  }
  if (!UPSTREAM_PROVIDERS.includes(name)) return { ok: false, message: `unknown provider ${name}` };
  const stored = providerConfig(name);
  const typedKey = typeof apiKey === 'string' && !apiKey.startsWith('••') ? apiKey.trim() : null;
  const p = {
    ...stored,
    ...(baseUrl && isUpstreamBaseUrl(baseUrl) ? { baseUrl: baseUrl.trim().replace(/\/+$/, '') } : {}),
    ...(typedKey === null ? {} : { apiKey: typedKey }),
  };
  const key = resolveProviderSecret(p.apiKey);
  const keyIsSet = typedKey === null ? providerSecretSet(name) : !!typedKey;
  if (!key && (keyIsSet || !keyOptional(name, p.baseUrl))) return { ok: false, message: keyIsSet ? 'the key\'s ${VAR} is not set in worca\'s environment' : `no API key configured for ${p.baseUrl}` };
  const base = (p.baseUrl || '').replace(/\/+$/, '');
  const url = name === 'anthropic' ? (/\/v1$/.test(base) ? `${base}/models` : `${base}/v1/models`) : `${base}/models`;
  const headers = name === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : (key ? { authorization: `Bearer ${key}` } : {});
  try {
    const r = await f(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (r.status === 401 || r.status === 403) return { ok: false, message: `authentication failed (${r.status})` };
    if (!r.ok) return { ok: false, message: `endpoint answered ${r.status}` };
    const j = await r.json().catch(() => null);
    const n = j && Array.isArray(j.data) ? j.data.length : undefined;
    // OpenRouter lists its models without a key, so a reachable list proves nothing about the key:
    // its /key does, and says what the key may still spend. A key it rejects fails the test.
    if (name === 'openai' && isOpenRouter(base)) {
      if (!key) return { ok: false, message: 'no API key configured — OpenRouter lists models without one, but every call needs it' };
      const info = await openRouterKeyInfo(base, key, { fetch: f });
      if (!info) return { ok: false, message: 'authentication failed — OpenRouter did not accept the key (its /key check failed)' };
      return { ok: true, ...(n !== undefined ? { models: n } : {}), openrouter: info, detail: formatOpenRouterKeyInfo(info) };
    }
    return { ok: true, ...(n !== undefined ? { models: n } : {}) };
  } catch (err) {
    return { ok: false, message: `endpoint unreachable — ${err && err.message ? err.message : String(err)}` };
  }
}
