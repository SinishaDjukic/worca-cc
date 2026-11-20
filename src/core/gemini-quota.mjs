// src/core/gemini-quota.mjs — Gemini CLI's plan quota for the profile's usage rings. No headless Gemini output carries
// quota, so with a Login-with-Google sign-in the server asks Google's Code Assist host the way the CLI does:
// `loadCodeAssist` (once per server life or after an auth failure, only to learn the project when GOOGLE_CLOUD_PROJECT is unset), then
// `retrieveUserQuota`. The access token is read fresh per call from the CLI's oauth_creds.json, kept in a local and
// sent only to cloudcode-pa.googleapis.com; the file is never written and the token never refreshed (an expired
// token means no reading). The worca egress policy is checked before each request (the policy proxy covers child
// processes only); the server's global fetch follows the corporate proxy (env-proxy.mjs `useEnvProxy`).
import { openSync, fstatSync, readSync, closeSync, constants } from 'node:fs';
import { join } from 'node:path';
import { decide, readEgressPolicy } from './egress-proxy.mjs';
import { homeOf, readDotenv, settingsAuthType } from './engines/gemini-family.mjs';
import { toUsagePct, toResetMs, recordUsageReading } from './usage-limits.mjs';

const HOST = 'cloudcode-pa.googleapis.com';
const BASE = `https://${HOST}/v1internal:`;
const CREDS_MAX_BYTES = 64 * 1024;
const MAX_BUCKETS = 64;
const KEY_VARS = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_GENAI_USE_GCA'];

let lastModel = null;     // the model the last Gemini `session` event reported in this process
let cachedProject = null; // learned from loadCodeAssist, until a quota call's 401/403/404

/** The sign-in kind: { kind: 'google', base, credsFile, project } | { kind: 'encrypted' } | null. */
function signInOf(given) {
  const base = (typeof given.GEMINI_CLI_HOME === 'string' && given.GEMINI_CLI_HOME.trim()) || homeOf(given);
  const env = { ...readDotenv([join(base, '.gemini', '.env'), join(homeOf(given), '.env')]), ...given };
  const has = (k) => typeof env[k] === 'string' && env[k].trim() !== '';
  if (KEY_VARS.some(has)) return null;
  if (settingsAuthType(join(base, '.gemini', 'settings.json')) !== 'oauth-personal') return null;
  if (String(env.GEMINI_FORCE_ENCRYPTED_FILE_STORAGE ?? '').trim().toLowerCase() === 'true') return { kind: 'encrypted' };
  return { kind: 'google', base, credsFile: join(base, '.gemini', 'oauth_creds.json'),
    project: has('GOOGLE_CLOUD_PROJECT') ? env.GOOGLE_CLOUD_PROJECT.trim() : null };
}

/** Login with Google (`oauth-personal`, no API-key/Vertex/GCA variable, plain-file credentials):
 *  `{ base, credsFile, project }`, else null. */
export function geminiGoogleSignIn(env = process.env) {
  const s = signInOf(env);
  return s?.kind === 'google' ? { base: s.base, credsFile: s.credsFile, project: s.project } : null;
}

/** Remembers the model a Gemini session runs (its quota bucket is the one shown). */
export function noteGeminiModel(model) {
  if (typeof model === 'string' && model) lastModel = model;
}

/** The bucket of `model`, else the most used one (least left); buckets without a finite share left are skipped. */
export function pickBucket(buckets, model) {
  const list = (Array.isArray(buckets) ? buckets : []).filter((b) => b && typeof b === 'object' && Number.isFinite(b.remainingFraction));
  if (!list.length) return null;
  return (model && list.find((b) => b.modelId === model)) || list.reduce((a, b) => (b.remainingFraction < a.remainingFraction ? b : a));
}

/** A retrieveUserQuota body as a store reading (one Day window), or null. */
export function quotaReading(body, { model = lastModel, now = Date.now() } = {}) {
  if (!Array.isArray(body?.buckets)) return null;
  const b = pickBucket(body.buckets.slice(0, MAX_BUCKETS), model);
  if (!b) return null;
  const pct = toUsagePct(b.remainingFraction, 'fraction-left');
  const resetsAt = toResetMs(b.resetTime);
  if (pct === null || resetsAt === null) return null;
  return { observedAt: now, windows: [{ kind: 'day', pct, resetsAt }] };
}

/** The access token and expiry only, or null (missing, too large, unparsable). */
function readCreds(file) {
  let fd = null;
  try {
    // O_NONBLOCK: a FIFO at the path must not hang the server; only a regular file within the cap is read.
    fd = openSync(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > CREDS_MAX_BYTES) return null;
    const buf = Buffer.alloc(CREDS_MAX_BYTES + 1);
    let n = 0;
    for (let r; n < buf.length && (r = readSync(fd, buf, n, buf.length - n, n)) > 0;) n += r;
    if (n > CREDS_MAX_BYTES) return null;
    const j = JSON.parse(buf.toString('utf8', 0, n));
    const token = typeof j?.access_token === 'string' && j.access_token ? j.access_token : null;
    return token ? { token, expiry: Number.isFinite(j.expiry_date) ? j.expiry_date : null } : null;
  } catch { return null; } finally { if (fd !== null) closeSync(fd); }
}

const httpWhy = (status) => (status === 401 ? 'http-401' : status === 403 ? 'http-403' : 'http-error');

/**
 * One quota call. `{ ok: true, reading }` or `{ ok: false, why }`; `why` is a fixed code, never a token, body or path.
 * Every request is preceded by its own `decideHost` check and made with `redirect: 'error'`.
 */
export async function fetchGeminiQuota({ env = process.env, fetch = globalThis.fetch, now = Date.now(), readFile = readCreds,
  decideHost = (host) => decide(host, readEgressPolicy(env)), timeoutMs = 10000 } = {}) {
  const sign = signInOf(env);
  if (!sign) return { ok: false, why: 'no-sign-in' };
  if (sign.kind === 'encrypted') return { ok: false, why: 'encrypted-storage' };
  const creds = readFile(sign.credsFile);
  if (!creds) return { ok: false, why: 'no-token' };
  if (creds.expiry !== null && creds.expiry <= now) return { ok: false, why: 'expired' };
  const allowed = () => { try { const d = decideHost(HOST); return d === true || d?.ok === true; } catch { return false; } };
  const post = (method, body) => fetch(`${BASE}${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  let project = sign.project || cachedProject;
  if (!project) {
    if (!allowed()) return { ok: false, why: 'egress-refused' };
    let res;
    try { res = await post('loadCodeAssist', { metadata: { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' } }); }
    catch { return { ok: false, why: 'network' }; }
    if (res.status === 401 || res.status === 403) return { ok: false, why: httpWhy(res.status) };
    if (!res.ok) return { ok: false, why: 'no-project' };
    let body;
    try { body = await res.json(); } catch { return { ok: false, why: 'no-project' }; }
    const p = body?.cloudaicompanionProject;
    const id = typeof p === 'string' ? p : typeof p?.id === 'string' ? p.id : null;
    if (!id) return { ok: false, why: 'no-project' };
    project = cachedProject = id;
  }
  if (!allowed()) return { ok: false, why: 'egress-refused' };
  let res;
  try { res = await post('retrieveUserQuota', { project }); } catch { return { ok: false, why: 'network' }; }
  if (!res.ok) {
    // An account switch leaves a cached project the new sign-in cannot read: learn it again on the next call.
    if (!sign.project && [401, 403, 404].includes(res.status)) cachedProject = null;
    return { ok: false, why: httpWhy(res.status) };
  }
  let body;
  try { body = await res.json(); } catch { return { ok: false, why: 'bad-response' }; }
  const reading = quotaReading(body, { now });
  return reading ? { ok: true, reading } : { ok: false, why: 'bad-response' };
}

/**
 * The server's one Gemini poller: every `intervalMs` while a Worca page is open, one call in flight; a page opening
 * calls at once only when the last call is `intervalMs` old. A failure records nothing (the last reading stays until
 * its reset) and logs one line per change of `why`; no Login-with-Google sign-in is not a failure and logs nothing.
 */
export function createGeminiQuotaPoller({ run = fetchGeminiQuota, record = recordUsageReading, log = () => {}, intervalMs = 60000,
  now = Date.now, timers = globalThis } = {}) {
  let present = false;
  let timer = null;
  let inFlight = false;
  let lastCallAt = -Infinity;
  let lastWhy = null;
  async function tick() {
    if (!present || inFlight) return;
    inFlight = true;
    lastCallAt = now();
    try {
      const r = await run();
      if (r?.ok) { lastWhy = null; record('gemini', r.reading); }
      else if (r?.why && r.why !== lastWhy) {
        lastWhy = r.why;
        if (r.why !== 'no-sign-in') log(`[usage] Gemini quota: no reading (${r.why})`);
      }
    } catch { /* a display figure: never into the server */ }
    finally { inFlight = false; }
  }
  return {
    setPagePresent(on) {
      if (on && !present) {
        present = true;
        if (now() - lastCallAt >= intervalMs) tick();
        timer = timers.setInterval(tick, intervalMs);
        timer?.unref?.();
      } else if (!on && present) {
        present = false;
        if (timer !== null) timers.clearInterval(timer);
        timer = null;
      }
    },
    stop() { this.setPagePresent(false); },
  };
}

export function _resetGeminiQuotaForTests() { lastModel = null; cachedProject = null; }
