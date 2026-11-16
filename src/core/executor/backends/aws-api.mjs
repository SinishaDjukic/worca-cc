// src/core/executor/backends/aws-api.mjs
// The few AWS calls the ecs backend makes, over plain HTTPS with undici and no SDK: Signature
// Version 4 signing, the credentials a controller task has, and one JSON 1.1 call (ECS speaks it).
//
// Credentials, the first that is set:
//   AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (+ AWS_SESSION_TOKEN)     static, e.g. a test
//   AWS_CONTAINER_CREDENTIALS_RELATIVE_URI                              an ECS task role (169.254.170.2)
//   AWS_CONTAINER_CREDENTIALS_FULL_URI (+ AWS_CONTAINER_AUTHORIZATION_TOKEN[_FILE])  Pod Identity and the like
// Temporary ones are fetched again five minutes before they expire. The instance's own role (IMDS)
// is deliberately not used: a controller gets exactly the task role it was given.
//
// The credentials endpoint is never reached through HTTPS_PROXY (its own undici Agent); the AWS
// API is, like any other outbound call. Errors from the API surface as
// `AwsApiError { status, type, message }`, `type` being the short `__type` (ThrottlingException).
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fetch, Agent } from 'undici';
import { sleep } from '../shared.mjs';

const ECS_CREDENTIALS_HOST = 'http://169.254.170.2';
const REFRESH_BEFORE_MS = 5 * 60_000;
const RETRIED_TYPES = new Set(['ThrottlingException', 'Throttling', 'TooManyRequestsException', 'RequestLimitExceeded', 'ServerException', 'ServiceUnavailable', 'InternalFailure']);

export class AwsApiError extends Error {
  constructor({ status, type, message, op }) {
    super(message || type || `HTTP ${status}`);
    this.name = 'AwsApiError';
    this.status = status;
    this.type = type || null;
    this.op = op || null;
  }
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

/** `YYYYMMDDTHHMMSSZ` for a Date. */
export function amzDate(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

const encodeRfc3986 = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * Sign a request with Signature Version 4 (pure). `headers` must carry `host` and `x-amz-date`
 * (and `x-amz-security-token` for temporary credentials); returns the `authorization` value.
 * Every header given is signed. `path` is already URI-encoded; `query` is a plain object.
 */
export function signV4({ method = 'POST', path = '/', query = {}, headers, body = '', region, service, credentials }) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const names = Object.keys(lower).sort();
  const date = lower['x-amz-date'];
  if (!date) throw new Error('signV4: x-amz-date is required');
  const day = date.slice(0, 8);
  const canonicalHeaders = names.map((n) => `${n}:${String(lower[n]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalQuery = Object.keys(query).sort().map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(String(query[k]))}`).join('&');
  const canonical = [method, path, canonicalQuery, canonicalHeaders, signedHeaders, sha256(body)].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', date, scope, sha256(canonical)].join('\n');
  const kDate = hmac(`AWS4${credentials.secretAccessKey}`, day);
  const kSigning = hmac(hmac(hmac(kDate, region), service), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

/** Where the credentials come from (pure): `{ kind: 'static' | 'container', ... }`, or null when none is configured. */
export function credentialSource(env = process.env) {
  const id = String(env.AWS_ACCESS_KEY_ID || '').trim();
  const secret = String(env.AWS_SECRET_ACCESS_KEY || '').trim();
  if (id && secret) return { kind: 'static', credentials: { accessKeyId: id, secretAccessKey: secret, sessionToken: String(env.AWS_SESSION_TOKEN || '').trim() || null } };
  const rel = String(env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI || '').trim();
  if (rel) return { kind: 'container', url: `${ECS_CREDENTIALS_HOST}${rel.startsWith('/') ? '' : '/'}${rel}`, tokenFile: null, token: null };
  const full = String(env.AWS_CONTAINER_CREDENTIALS_FULL_URI || '').trim();
  if (full) {
    return { kind: 'container', url: full,
      tokenFile: String(env.AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE || '').trim() || null,
      token: String(env.AWS_CONTAINER_AUTHORIZATION_TOKEN || '').trim() || null };
  }
  return null;
}

/** A function that resolves to `{ accessKeyId, secretAccessKey, sessionToken }`, cached until shortly before expiry. */
export function createCredentialProvider({ env = process.env, now = () => Date.now() } = {}) {
  const source = credentialSource(env);
  if (!source) {
    throw new Error('no AWS credentials: give the controller task a task role (ECS sets AWS_CONTAINER_CREDENTIALS_RELATIVE_URI), or set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY');
  }
  if (source.kind === 'static') return async () => source.credentials;
  const agent = new Agent({ connect: { timeout: 5_000 } });
  let cached = null;
  let inflight = null;
  const fetchOnce = async () => {
    const headers = {};
    const token = source.tokenFile ? (() => { try { return readFileSync(source.tokenFile, 'utf8').trim(); } catch { return null; } })() : source.token;
    if (token) headers.authorization = token;
    let res;
    try { res = await fetch(source.url, { headers, dispatcher: agent, signal: AbortSignal.timeout(10_000) }); } catch (err) {
      throw new Error(`cannot reach the container credentials endpoint ${source.url}: ${err?.cause?.message || err?.message || err}`);
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`the container credentials endpoint answered HTTP ${res.status}: ${text.slice(0, 200)}`);
    let body;
    try { body = JSON.parse(text); } catch { throw new Error('the container credentials endpoint returned no JSON'); }
    if (!body.AccessKeyId || !body.SecretAccessKey) throw new Error('the container credentials endpoint returned no keys');
    return { accessKeyId: body.AccessKeyId, secretAccessKey: body.SecretAccessKey, sessionToken: body.Token || null,
      expiresAt: body.Expiration ? Date.parse(body.Expiration) : null };
  };
  return async () => {
    if (cached && (!cached.expiresAt || cached.expiresAt - REFRESH_BEFORE_MS > now())) return cached;
    inflight ||= fetchOnce().then((c) => { cached = c; return c; }).finally(() => { inflight = null; });
    return inflight;
  };
}

/**
 * A client for one JSON 1.1 service: `call(op, body)` resolves to the parsed answer. `endpoint`
 * defaults to `https://<service>.<region>.amazonaws.com`; `targetPrefix` is the service's
 * X-Amz-Target prefix. Throttling and 5xx answers are retried `retries` times with backoff.
 */
export function createJsonClient({ service, region, targetPrefix, endpoint = null, credentials, retries = 4, retryMs = 500, timeoutMs = 30_000 }) {
  if (!region) throw new Error(`${service}: no region`);
  const base = (endpoint || `https://${service}.${region}.amazonaws.com`).replace(/\/+$/, '');
  const url = new URL(`${base}/`);
  async function once(op, payload) {
    const creds = await credentials();
    const body = JSON.stringify(payload ?? {});
    const headers = {
      host: url.host,
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-date': amzDate(),
      'x-amz-target': `${targetPrefix}.${op}`,
      ...(creds.sessionToken ? { 'x-amz-security-token': creds.sessionToken } : {}),
    };
    headers.authorization = signV4({ method: 'POST', path: url.pathname, headers: { ...headers }, body, region, service, credentials: creds });
    delete headers.host;   // undici sets it from the URL; it is the same value
    let res;
    try { res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeoutMs) }); } catch (err) {
      throw Object.assign(new Error(`cannot reach ${service} at ${base}: ${err?.cause?.message || err?.message || err}`), { network: true });
    }
    const text = await res.text();
    let parsed = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { message: text.slice(0, 300) }; }
    if (res.ok) return parsed;
    const type = String(parsed.__type || res.headers.get('x-amzn-errortype') || '').split('#').pop().split(':')[0] || null;
    throw new AwsApiError({ status: res.status, type, message: parsed.message || parsed.Message || type || `HTTP ${res.status}`, op });
  }
  return {
    endpoint: base,
    region,
    async call(op, payload) {
      for (let attempt = 0; ; attempt += 1) {
        try { return await once(op, payload); } catch (err) {
          const again = attempt < retries && (err.network || (err instanceof AwsApiError && (RETRIED_TYPES.has(err.type) || err.status >= 500)));
          if (!again) throw err;
          await sleep(retryMs * 2 ** attempt);
        }
      }
    },
  };
}
