// src/core/ask/web-fetch.mjs
// Ask Worca's ONLY network path (docs/guardrails.md "Web access"): server-enforced web_fetch/web_search.
// Every rule here holds regardless of what the model asks — the model only supplies a URL/query.
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { pipeline } from 'node:stream';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';
import { hostAllowed } from '../web-allowlist.mjs';
import { htmlToText } from './html-text.mjs';

export const WEB_LIMITS = Object.freeze({
  timeoutMs: 15_000, maxBytes: 2 * 1024 * 1024, maxTextChars: 100_000, maxRedirects: 3,
  urlMaxChars: 2048, queryMaxChars: 256, pathMaxChars: 512, dataRunChars: 64,
  searchQueryMaxChars: 200, searchMaxBytes: 1024 * 1024, searchMaxResults: 10,
});
const USER_AGENT = 'worca-ask/1 (+https://github.com/SinishaDjukic/worca-cc)';
const FETCH_HEADERS = Object.freeze({ 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8,*/*;q=0.1', 'accept-encoding': 'gzip, deflate, br' });
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export class WebAccessError extends Error {
  constructor(message, { code = 'refused', status = null } = {}) { super(message); this.name = 'WebAccessError'; this.code = code; this.status = status; }
}

// ── URL rule ──
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
// A "data run" is ≥ dataRunChars of [A-Za-z0-9+=_-] ('/' deliberately excluded: path segments are
// judged one by one). It is allowed only when word-like: every -/_ part ≤ 20 chars and letters-only,
// digits-only or ≤ 4 chars. Slugs/titles pass; base64, base64url, hex and tokens do not.
const WORDY_PART = (p) => p.length <= 20 && (/^[A-Za-z]*$/.test(p) || /^\d*$/.test(p) || p.length <= 4);
export function looksLikeData(s, runChars = WEB_LIMITS.dataRunChars) {
  const re = new RegExp(`[A-Za-z0-9+=_-]{${runChars},}`, 'g');
  for (const m of String(s).matchAll(re)) if (!m[0].split(/[-_]/).every(WORDY_PART)) return true;
  return false;
}

export function checkWebUrl(raw, allowedDomains, { redirect = false, limits = WEB_LIMITS } = {}) {
  const pre = redirect ? 'redirect refused: ' : '';
  const s = String(raw ?? '').trim();
  if (s.length > limits.urlMaxChars) throw new WebAccessError(`${pre}URL longer than ${limits.urlMaxChars} characters`);
  let u; try { u = new URL(s); } catch { throw new WebAccessError(`${pre}not a valid absolute URL`); }
  if (u.protocol !== 'https:') throw new WebAccessError(`${pre}only https URLs are allowed (got ${u.protocol.replace(/:$/, '')})`);
  if (u.username || u.password) throw new WebAccessError(`${pre}URLs with credentials are not allowed`);
  if (u.port) throw new WebAccessError(`${pre}only the default https port (443) is allowed`);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) throw new WebAccessError(`${pre}IP-address URLs are not allowed — use a host name on the allowlist`);
  if (!hostAllowed(host, allowedDomains)) {
    throw new WebAccessError(`${pre}host "${host}" is not on the Ask web allowlist (${allowedDomains.join(', ') || 'empty'}). Call propose_web_access with this URL and a one-line reason, then end your turn — the user allows or declines it on the card.`, { code: 'not-allowlisted' });
  }
  const query = u.search.replace(/^\?/, '');
  if (query.length > limits.queryMaxChars) throw new WebAccessError(`${pre}query string longer than ${limits.queryMaxChars} characters — URLs must not carry data`);
  if (u.pathname.length > limits.pathMaxChars) throw new WebAccessError(`${pre}path longer than ${limits.pathMaxChars} characters — URLs must not carry data`);
  if (looksLikeData(safeDecode(u.pathname)) || looksLikeData(safeDecode(query))) throw new WebAccessError(`${pre}the URL looks like it carries encoded data — refused`);
  u.hash = '';
  return u;
}

// ── SSRF guard ──
const BLOCKED = new BlockList();
for (const [n, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) BLOCKED.addSubnet(n, p, 'ipv4');
// IPv6 rules. NEVER add '::ffff:0:0/96' here: node's BlockList checks an IPv4 address against IPv6
// rules in its v4-mapped form, so that rule matches ALL of IPv4 (every fetch would be refused).
// v4-mapped and NAT64 addresses are instead decoded and checked against the IPv4 rules above.
// '::/96' covers '::', '::1' and the deprecated IPv4-compatible '::a.b.c.d'.
for (const [n, p] of [['::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 32], ['2001:db8::', 32],
  ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]]) BLOCKED.addSubnet(n, p, 'ipv6');

const canon6 = (a) => { try { return new URL(`http://[${a}]/`).hostname.slice(1, -1); } catch { return a.toLowerCase(); } };
const hexV4 = (hi, lo) => { const h = parseInt(hi, 16); const l = parseInt(lo, 16); return `${h >> 8}.${h & 255}.${l >> 8}.${l & 255}`; };

export function isBlockedAddress(addr) {
  const a = String(addr ?? '');
  const fam = isIP(a);
  if (fam === 4) return BLOCKED.check(a, 'ipv4');
  if (fam !== 6) return true;
  const c = canon6(a);                                      // WHATWG canonical: '64:ff9b:0:0:0:0:7f00:1' → '64:ff9b::7f00:1'
  const m = /^(::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(c);   // v4-mapped + NAT64 well-known prefix
  if (m) return BLOCKED.check(hexV4(m[2], m[3]), 'ipv4');
  if (/^(::ffff:|64:ff9b::)/.test(c)) return true;
  return BLOCKED.check(c, 'ipv6');
}

/** A net/https `lookup` that refuses when ANY answer is non-public — checked on the address actually dialled. */
export function makeGuardedLookup(resolve = dnsLookup) {
  return function guardedLookup(hostname, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    const opts = options && typeof options === 'object' ? options : {};
    resolve(hostname, { all: true, verbatim: true }, (err, answers) => {
      if (err) return callback(err);
      const list = (answers || []).map((x) => (typeof x === 'string' ? { address: x, family: isIP(x) } : x));
      if (!list.length) return callback(Object.assign(new Error(`${hostname} did not resolve`), { code: 'ENOTFOUND' }));
      const bad = list.find((x) => isBlockedAddress(x.address));
      if (bad) return callback(Object.assign(new Error(`${hostname} resolves to a private or reserved address (${bad.address}) — refused`), { code: 'EWORCA_BLOCKED' }));
      const want = opts.family === 4 || opts.family === 6 ? list.filter((x) => x.family === opts.family) : list;
      if (!want.length) return callback(Object.assign(new Error(`${hostname} has no IPv${opts.family} address`), { code: 'ENOTFOUND' }));
      if (opts.all) return callback(null, want);
      return callback(null, want[0].address, want[0].family);
    });
  };
}
export const guardedLookup = makeGuardedLookup();

// ── transport: GET only, no agent (fresh socket ⇒ lookup always runs), decompressed body ──
function decoded(res) {
  const enc = String(res.headers['content-encoding'] || '').trim().toLowerCase();
  const z = enc === 'gzip' || enc === 'x-gzip' ? createGunzip() : enc === 'deflate' ? createInflate() : enc === 'br' ? createBrotliDecompress() : null;
  if (!z) return res;
  pipeline(res, z, () => {});
  return z;
}
export function httpsTransport({ url, signal, lookup = guardedLookup, headers }) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { method: 'GET', headers, lookup, signal, agent: false }, (res) => {
      const body = decoded(res);
      resolve({ status: res.statusCode || 0, headers: res.headers, body, destroy: () => { res.destroy(); body.destroy?.(); } });
    });
    req.on('error', reject);
    req.end();
  });
}

async function readCapped(body, max) {
  const chunks = []; let n = 0; let truncated = false;
  for await (const c of body) {
    const b = Buffer.isBuffer(c) ? c : Buffer.from(c);
    if (n + b.length > max) { chunks.push(b.subarray(0, max - n)); n = max; truncated = true; break; }
    chunks.push(b); n += b.length;
  }
  return { buf: Buffer.concat(chunks, n), truncated };
}

const TEXTUAL = (mime) => /^text\/(html|plain|markdown|csv|xml)$/.test(mime) || mime === 'application/xhtml+xml'
  || mime === 'application/json' || mime === 'application/xml' || /^application\/[\w.+-]+\+(json|xml)$/.test(mime);

export function parseContentType(v) {
  const [mime, ...params] = String(v || '').split(';');
  const cs = params.map((p) => p.trim()).find((p) => /^charset=/i.test(p));
  return { mime: mime.trim().toLowerCase(), charset: cs ? cs.slice(8).replace(/"/g, '').trim() : null };
}
function decodeText(buf, charset, mime) {
  let label = charset;
  if (!label && /html/.test(mime)) label = /<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.subarray(0, 1024).toString('latin1'))?.[1] || null;
  try { return new TextDecoder(label || 'utf-8').decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

// Failures that mean the host could not be reached at all: on a worca with no route to the
// internet (compose.egress.yml's internal network, a firewall) every public host fails this way.
const UNREACHABLE = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH']);
const noInternetHint = (host) => ` — could not reach ${host || 'the host'}. This worca may not have internet access (the operator may have locked outbound traffic down); check the host name, or ask them.`;

/** `reached`: whether the host answered at all (a timeout before that is a connection timeout). */
function wrapNetError(err, deadline, limits, { host = null, reached = false } = {}) {
  if (err instanceof WebAccessError) return err;
  if (deadline.aborted) {
    const hint = reached ? '' : noInternetHint(host);
    return new WebAccessError(`timed out after ${limits.timeoutMs / 1000} s${hint}`, { code: 'timeout' });
  }
  if (err && err.code === 'EWORCA_BLOCKED') return new WebAccessError(err.message, { code: 'blocked-address' });
  if (err && err.name === 'AbortError') return new WebAccessError('the chat turn ended', { code: 'aborted' });
  const hint = UNREACHABLE.has(err?.code) ? noInternetHint(host) : '';
  return new WebAccessError(`network error: ${err?.code || err?.message || err}${hint}`, { code: 'network' });
}

export function createWebFetcher({ allowedDomains, transport = httpsTransport, lookup = guardedLookup, signal = null, limits = WEB_LIMITS, log = () => {} }) {
  async function fetchUrl(raw) {
    const entry = { tool: 'web_fetch', url: String(raw ?? '').slice(0, 512), finalUrl: null, status: null, bytes: 0, ok: false, error: null };
    const deadline = AbortSignal.timeout(limits.timeoutMs);
    const sig = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const net = { host: null, reached: false };
    try {
      let url = checkWebUrl(raw, allowedDomains, { limits });
      let res; let hops = 0;
      for (;;) {
        net.host = url.hostname; net.reached = false;
        res = await transport({ url, signal: sig, lookup, headers: { ...FETCH_HEADERS } });
        net.reached = true;
        if (!REDIRECTS.has(res.status)) break;
        res.destroy();
        hops += 1;
        if (hops > limits.maxRedirects) throw new WebAccessError(`more than ${limits.maxRedirects} redirects`);
        const loc = res.headers.location;
        if (!loc) throw new WebAccessError(`HTTP ${res.status} without a Location header`);
        let next; try { next = new URL(String(loc), url); } catch { throw new WebAccessError('redirect to an invalid URL'); }
        url = checkWebUrl(next.href, allowedDomains, { redirect: true, limits });
      }
      entry.finalUrl = url.href; entry.status = res.status;
      if (res.status < 200 || res.status >= 300) { res.destroy(); throw new WebAccessError(`HTTP ${res.status} from ${url.hostname}`, { code: 'http', status: res.status }); }
      const type = parseContentType(res.headers['content-type']);
      if (!TEXTUAL(type.mime)) { res.destroy(); throw new WebAccessError(`unsupported content type "${type.mime || 'unknown'}" — web_fetch reads HTML and text only`); }
      const { buf, truncated: rawCut } = await readCapped(res.body, limits.maxBytes);
      res.destroy();
      entry.bytes = buf.length;
      const decodedText = decodeText(buf, type.charset, type.mime);
      const isHtml = type.mime === 'text/html' || type.mime === 'application/xhtml+xml';
      const conv = isHtml ? await htmlToText(decodedText, url.href, { maxChars: limits.maxTextChars })
        : { title: null, text: decodedText.slice(0, limits.maxTextChars), truncated: decodedText.length > limits.maxTextChars };
      entry.ok = true;
      return { url: String(raw).trim(), finalUrl: url.href, status: res.status, contentType: type.mime, title: conv.title, text: conv.text, truncated: rawCut || conv.truncated, bytes: buf.length };
    } catch (err) {
      const e = wrapNetError(err, deadline, limits, net);
      entry.error = e.message.slice(0, 300);
      throw e;
    } finally {
      try { log(entry); } catch { /* logging never breaks a fetch */ }
    }
  }
  return { fetch: fetchUrl };
}

// ── web_search: any GET JSON search API. The endpoint is user-configured, so it is not
// allowlist-checked — but it is https-only and SSRF-guarded like every other request. ──
const clip = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
export function normalizeSearchResults(json, count) {
  const arrays = [json?.web?.results, json?.results, json?.items, json?.data, json?.organic, json?.webPages?.value];
  const arr = arrays.find((a) => Array.isArray(a)) || [];
  const out = [];
  for (const r of arr) {
    if (out.length >= count) break;
    const url = typeof (r?.url ?? r?.link ?? r?.href) === 'string' ? (r.url ?? r.link ?? r.href) : '';
    let u; try { u = new URL(url); } catch { continue; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
    out.push({ title: clip(r.title ?? r.name, 200), url: u.href, snippet: clip(r.snippet ?? r.description ?? r.content, 500) });
  }
  return out;
}

export function createWebSearcher({ search, key = '', allowedDomains = [], transport = httpsTransport, lookup = guardedLookup, signal = null, limits = WEB_LIMITS, log = () => {} }) {
  async function run(query, count = 5) {
    const q = String(query ?? '').trim();
    const n = Math.max(1, Math.min(limits.searchMaxResults, Number.isInteger(count) ? count : 5));
    let host = null; let reached = false;
    const entry = { tool: 'web_search', url: null, queryChars: q.length, finalUrl: null, status: null, bytes: 0, ok: false, error: null };
    const deadline = AbortSignal.timeout(limits.timeoutMs);
    const sig = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
      if (!q) throw new WebAccessError('query is required');
      if (q.length > limits.searchQueryMaxChars) throw new WebAccessError(`query longer than ${limits.searchQueryMaxChars} characters`);
      if (looksLikeData(q)) throw new WebAccessError('the query looks like it carries encoded data — refused');
      const needsKey = !!search.keyHeader || search.url.includes('{key}');
      if (needsKey && !key) throw new WebAccessError('the search key is not set in worca\'s environment — ask the user to set the variable named in Settings → Ask Worca → Web access');
      const href = search.url.replace('{query}', encodeURIComponent(q)).replace('{key}', encodeURIComponent(key));
      let url; try { url = new URL(href); } catch { throw new WebAccessError('the search endpoint URL is invalid'); }
      host = url.hostname; entry.url = `https://${host}/…`;
      if (url.protocol !== 'https:') throw new WebAccessError('the search endpoint must be https');
      if (isIP(host.replace(/^\[|\]$/g, ''))) throw new WebAccessError('IP-address search endpoints are not allowed');
      const headers = { 'user-agent': USER_AGENT, accept: 'application/json', 'accept-encoding': 'gzip, deflate, br' };
      if (search.keyHeader && key) headers[search.keyHeader.toLowerCase()] = `${search.keyPrefix || ''}${key}`;
      const res = await transport({ url, signal: sig, lookup, headers });
      reached = true;
      entry.status = res.status;
      if (REDIRECTS.has(res.status)) { res.destroy(); throw new WebAccessError('the search endpoint redirected — configure its final URL in Settings'); }
      if (res.status < 200 || res.status >= 300) { res.destroy(); throw new WebAccessError(`the search endpoint answered HTTP ${res.status}`, { code: 'http', status: res.status }); }
      const { buf } = await readCapped(res.body, limits.searchMaxBytes);
      res.destroy();
      entry.bytes = buf.length;
      let json; try { json = JSON.parse(buf.toString('utf8')); } catch { throw new WebAccessError('the search endpoint did not return JSON'); }
      const results = normalizeSearchResults(json, n).map((r) => ({ ...r, fetchable: hostAllowed(new URL(r.url).hostname, allowedDomains) }));
      entry.ok = true;
      return { query: q, results };
    } catch (err) {
      const e = wrapNetError(err, deadline, limits, { host, reached });
      entry.error = e.message.slice(0, 300);
      throw e;
    } finally {
      try { log(entry); } catch { /* never breaks a search */ }
    }
  }
  return { search: run };
}
