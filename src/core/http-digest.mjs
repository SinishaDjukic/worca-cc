// src/core/http-digest.mjs — HTTP Digest (RFC 7616; RFC 2617 without qop) for the corporate proxy, and the
// Proxy-Authenticate parser upstream-proxy.mjs uses for every scheme. A leaf: node:crypto only.
import { createHash, randomBytes } from 'node:crypto';

export class DigestError extends Error {}

/** Algorithm name (upper case) -> node hash. Preference order for pickDigest. */
const ALGORITHMS = Object.freeze([['SHA-256', 'sha256'], ['SHA-256-SESS', 'sha256'], ['MD5', 'md5'], ['MD5-SESS', 'md5']]);
const HASH = new Map(ALGORITHMS);
const TOKEN = /[!#$%&'*+\-.^_`|~0-9A-Za-z]+/y;
const TOKEN68 = /^[ \t]+([A-Za-z0-9+/._~-]+=*)(?=[ \t]*(?:,|$))/;

/**
 * Proxy-Authenticate values -> [{ scheme (lower case), token (token68 or ''), params: { lower-case name: value } }].
 * Handles several challenges per line, quoted strings with commas and backslash escapes.
 */
export function parseChallenges(values) {
  const out = [];
  for (const v of [].concat(values ?? [])) {
    const s = String(v);
    let i = 0;
    let cur = null;
    const skip = () => { while (i < s.length && /[\s,]/.test(s[i])) i += 1; };
    for (skip(); i < s.length; skip()) {
      TOKEN.lastIndex = i;
      const m = TOKEN.exec(s);
      if (!m) { i += 1; continue; }
      const word = m[0];
      i = TOKEN.lastIndex;
      let j = i;
      while (s[j] === ' ' || s[j] === '\t') j += 1;
      if (cur && s[j] === '=') {   // auth-param of the current challenge
        j += 1;
        while (s[j] === ' ' || s[j] === '\t') j += 1;
        let val = '';
        if (s[j] === '"') {
          j += 1;
          while (j < s.length && s[j] !== '"') { if (s[j] === '\\') j += 1; val += s[j] ?? ''; j += 1; }
          j += 1;
        } else {
          TOKEN.lastIndex = j;
          const t = TOKEN.exec(s);
          if (t) { val = t[0]; j = TOKEN.lastIndex; }
        }
        cur.params[word.toLowerCase()] = val;
        i = j;
        continue;
      }
      cur = { scheme: word.toLowerCase(), token: '', params: {} };
      out.push(cur);
      const t68 = TOKEN68.exec(s.slice(i));
      if (t68) { cur.token = t68[1]; i += t68[0].length; }
    }
  }
  return out;
}

const qopsOf = (c) => String(c.params.qop || '').split(',').map((q) => q.trim().toLowerCase()).filter(Boolean);
const answerable = (c) => c.scheme === 'digest' && HASH.has(String(c.params.algorithm || 'MD5').toUpperCase())
  && !!c.params.nonce && (qopsOf(c).length === 0 || qopsOf(c).includes('auth')) && !/^true$/i.test(c.params.userhash || '');

/** The Digest challenge Worca answers best (SHA-256 first), or null. */
export function pickDigest(challenges) {
  const ds = challenges.filter(answerable);
  for (const [name] of ALGORITHMS) {
    const hit = ds.find((c) => String(c.params.algorithm || 'MD5').toUpperCase() === name);
    if (hit) return hit;
  }
  return null;
}

/** True when a Digest challenge says the nonce went stale (RFC 7616 §3.3): not a password refusal. */
export const isStaleDigest = (values) => parseChallenges(values).some((c) => c.scheme === 'digest' && /^true$/i.test(c.params.stale || ''));

const quote = (s) => `"${String(s).replace(/(["\\])/g, '\\$1')}"`;

/** The base HA1 = H(username:realm:password) (RFC 7616 §3.4.2) for `algorithm` (the -sess step is added later). */
export function digestHa1({ username, realm, password, algorithm = 'MD5' }) {
  const hash = HASH.get(String(algorithm).toUpperCase());
  if (!hash) throw new DigestError(`the Digest algorithm ${algorithm} is not supported`);
  return createHash(hash).update(`${username}:${realm ?? ''}:${password}`, 'utf8').digest('hex');
}

/**
 * The Proxy-Authorization value for `challenge`. `uri` is the request-target as sent: "host:port" for
 * CONNECT, the absolute URL for a proxied GET. `ha1(realm, algorithm)` returns the base HA1 (how
 * ProxyCredentials answers without handing out the password, D8a); `password` is the test-vector form.
 * Throws DigestError for what cannot be answered.
 */
export function digestAuthorization({ challenge, username, password, ha1: ha1Of = null, method, uri,
  cnonce = randomBytes(16).toString('hex'), nc = 1 }) {
  const p = challenge.params;
  const alg = String(p.algorithm || 'MD5').toUpperCase();
  const hash = HASH.get(alg);
  if (!hash) throw new DigestError(`the Digest algorithm ${alg} is not supported`);
  if (/^true$/i.test(p.userhash || '')) throw new DigestError('Digest userhash is not supported');
  if (!p.nonce) throw new DigestError('the Digest challenge has no nonce');
  for (const v of [username, p.realm, p.nonce, p.opaque, uri, method, cnonce]) {
    if (v !== undefined && /[\r\n]/.test(String(v))) throw new DigestError('a Digest value contains a line break');
  }
  if (!Number.isInteger(nc) || nc < 1) throw new DigestError('the Digest nonce count must be a positive integer');
  const qops = qopsOf(challenge);
  if (qops.length && !qops.includes('auth')) throw new DigestError('the Digest challenge offers only qop=auth-int');
  const qop = qops.length ? 'auth' : '';
  const H = (s) => createHash(hash).update(s, 'utf8').digest('hex');
  const ncHex = nc.toString(16).padStart(8, '0');
  const baseAlg = alg.replace(/-SESS$/, '');
  let ha1 = ha1Of ? ha1Of(p.realm ?? '', baseAlg) : digestHa1({ username, realm: p.realm, password, algorithm: baseAlg });
  if (alg.endsWith('-SESS')) ha1 = H(`${ha1}:${p.nonce}:${cnonce}`);
  const ha2 = H(`${method}:${uri}`);
  const response = qop ? H(`${ha1}:${p.nonce}:${ncHex}:${cnonce}:${qop}:${ha2}`) : H(`${ha1}:${p.nonce}:${ha2}`);
  const parts = [`username=${quote(username)}`, `realm=${quote(p.realm ?? '')}`, `nonce=${quote(p.nonce)}`, `uri=${quote(uri)}`,
    `response=${quote(response)}`];
  if (p.algorithm) parts.push(`algorithm=${p.algorithm}`);
  if (qop) parts.push(`qop=${qop}`, `nc=${ncHex}`, `cnonce=${quote(cnonce)}`);
  if (p.opaque !== undefined) parts.push(`opaque=${quote(p.opaque)}`);
  return `Digest ${parts.join(', ')}`;
}
