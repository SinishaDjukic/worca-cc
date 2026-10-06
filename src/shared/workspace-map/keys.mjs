// src/shared/workspace-map/keys.mjs
// Key normalisation (spec §5.2): a fact's `norm` is ALWAYS computed here, never trusted from an
// LLM. Two facts join when their norms are equal; the fuzzy helpers (path suffix, topic glob,
// host alias) are the only other ways a consume meets a provide. Pure and total: bad input → null.

import { LIMITS } from './limits.mjs';
import { isAzureHost, parseAzurePath } from '../azure-remote.mjs';

const HTTP_METHODS = Object.freeze(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT', 'ALL', 'ANY', '*']);
const PKG_ECOSYSTEMS = Object.freeze(['npm', 'pypi', 'maven', 'go', 'cargo', 'nuget', 'gem', 'composer', 'git']);
const LOCAL_HOSTS = Object.freeze(['localhost', '0.0.0.0', '127.0.0.1', '::1', 'host.docker.internal']);
const PATH_CHARS = /^\/[\w.~!$&'()*+,;=:@%{}\-/]*$/;
/** A framework route parameter with a regex, an optional mark or a catch-all: `{id:[0-9]+}`,
 *  `{id:\d{3}}` (one nested `{…}` level), `{id?}`, `{id:int?}`, `{*path}`, `{**rest}` (gorilla/mux,
 *  Spring, ASP.NET, Laravel). Bounded and alternation-disjoint: linear. */
const BRACE_PARAM = /\{\*{0,2}[A-Za-z_][\w-]{0,64}(?:\?|:(?:[^{}]|\{[^{}]{0,20}\}){0,200})?\}/g;

/** Where a URL's query or fragment starts in a path or a cited text: the first '?' or '#' outside every placeholder
 *  (`${…}`, C# / Python / route '{…}', Ruby '#{…}' — never the '#' opening one) and never inside the userinfo of the
 *  text's first URL (`http://svc:pa?ss@host/x`: a password may hold '?' or '#'; a URL inside the query moves nothing).
 *  A placeholder's code is scanned whole, with its braces and string literals, so '{id?}', '{user?.Id}', `${this.#base}`,
 *  `${u?.type === 'org' ? a : b}`, `${xs.find((x) => x?.id === id)?.slug}` and Kotlin's `${user?.let { it.id }}` start
 *  none. A query in a string inside a placeholder (`${q ? '?sig=…' : ''}`, `${a ? '#top' : ''}` — a '?' or '#' before a
 *  name, so `split('?')` is none) starts at the outermost placeholder once that placeholder closes. An unclosed
 *  placeholder (a literal the lexer ended at a nested quote) is kept: its '?' is code, not a query — unless one of its
 *  strings held a '?' / '#' before a name (a regex literal `/'/g` misread the quotes): then the query starts there.
 *  The userinfo is skipped only when the scan reaches it (a URL inside a query moves nothing). -1 when there is none.
 *  One pass: linear. */
const USERINFO_END = /:\/\/[^\s/?#'"`]{0,256}:(?!\d{1,5}(?:[/?#]|$))[^\s/'"`@]{0,2048}@/y;
export function queryAt(s) {
  if (typeof s !== 'string') return -1;
  const at = s.indexOf('://');
  USERINFO_END.lastIndex = at;
  const u = at === -1 ? null : USERINFO_END.exec(s);
  const open = []; // '{': a placeholder, or a brace in its code; a quote: a string literal in a placeholder's code
  let outer = -1; // where the outermost open placeholder starts
  let quoted = -1; // a '?' / '#' before a name in a string of the open placeholder: the query starts at `outer` once it closes
  for (let i = 0; i < s.length; i += 1) {
    // the userinfo of the text's first URL, reached by the scan: skipped whole (a password may hold '?' or '#');
    // a URL inside a query (`/cb?next=http://u:p@h/y`) is never reached — the query cut came first
    if (u && i === at) { i = u.index + u[0].length - 1; continue; }
    const c = s[i];
    const top = open.length ? open[open.length - 1] : '';
    if (top === '{') {
      if (c === '{') open.push('{');
      else if (c === '}') { open.pop(); if (!open.length && quoted !== -1) return outer; }
      else if (c === '"' || c === "'" || c === '`') open.push(c);
      continue;
    }
    // URL text: outside every placeholder, or a string literal in a placeholder's code
    if (top && c === '\\') { i += 1; continue; }
    if (top && c === top) { open.pop(); continue; }
    const opens = c === '{' ? 1 : (c === '$' || c === '#') && s[i + 1] === '{' ? 2 : 0;
    if (opens) {
      if (!open.length) outer = i;
      open.push('{');
      i += opens - 1;
    } else if (c === '?' || c === '#') {
      if (!top) return i;
      if (quoted === -1 && /[\w${]/.test(s[i + 1] ?? '')) quoted = i;
    }
  }
  // -1, or the text ended inside that placeholder: a quote was misread (a regex literal `/'/g` in its code), so the
  // '?' / '#' was URL text
  return quoted;
}
/** The text before its query, trailing blanks dropped; a text that starts with its query keeps its first name only
 *  (`?hmac=…` → `?hmac=`): a query value of any name may be a credential (D21). Non-strings unchanged. */
export function cutQuery(s) {
  const c = queryAt(s);
  return c > 0 ? s.slice(0, c).trimEnd() || s.slice(0, c) : c === 0 ? s.replace(/=[^]*$/, '=') : s;
}
/** cutQuery for a code expression (`BASE + '/x?sig=' + s`, `fmt.Sprintf("%s/x?sig=%s", b, s)`): a query starts inside one of
 *  its string pieces only — a '?' or '#' between them is an operator (`cfg?.api`, `a ? B : C`, `x ?? D`, `this.#base`).
 *  Each piece is read once (to its closing quote) and cut as cutQuery reads it: linear. Non-strings unchanged. */
export function cutCode(e) {
  if (typeof e !== 'string') return e;
  for (let i = 0; i < e.length; i += 1) {
    const q = e[i];
    if (q !== '"' && q !== "'" && q !== '`') continue;
    let j = i + 1;
    while (j < e.length && e[j] !== q) j += e[j] === '\\' ? 2 : 1;
    const at = queryAt(e.slice(i + 1, j));
    if (at !== -1) return e.slice(0, i + 1 + at).trimEnd();
    i = j;
  }
  return e;
}

/** '/users/:id?x=1' → '/users/{}'. Accepts a full URL (scheme + host stripped), a relative path
 *  (Retrofit's "users/{id}" → '/users/{}') and a leading base-URL placeholder ('${base}/users').
 *  Every parameter style becomes '{}': :id, :id?, {id}, {0}, {id:[0-9]+}, {id?}, {*path}, {**rest},
 *  <id>, <int:id>, [id], [...slug], ${…}, %s, %d. '//' collapses; a trailing '/' goes (root stays
 *  '/'). null if not a path. */
export function normPath(path) {
  if (typeof path !== 'string') return null;
  let s = path.trim();
  if (!s || s.length > 2048) return null;
  s = s.replace(/\$\{[^}]*\}/g, '{}');
  // Before the query strip, which would cut `{id?}` at its '?' and leave `{id` behind.
  s = s.replace(BRACE_PARAM, '{}');
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(s) || /^\/\/[^/?#]*/.exec(s);
  if (scheme) s = s.slice(scheme[0].length);
  s = s.replace(/[?#].*$/, '');
  if (/\s/.test(s)) return null;
  if (s === '{}' || s.startsWith('{}/')) s = s.slice(2);
  if (!s.startsWith('/')) s = '/' + s;
  s = s
    .replace(/<[^<>/]*>/g, '{}')
    .replace(/\[[^[\]/]*\]/g, '{}')
    .replace(/\{[^{}/]*\}/g, '{}')
    .replace(/%[sd]/g, '{}')
    .replace(/(^|\/):[A-Za-z_][\w-]*\??(?=\/|$)/g, '$1{}');
  s = s.replace(/\/{2,}/g, '/');
  if (s.length > 1) s = s.replace(/\/+$/, '');
  if (!s) s = '/';
  return PATH_CHARS.test(s) ? s : null;
}

/** → 'http:GET /users/{}' | null. A blank, 'ANY', 'ALL' or '*' method is '*'. */
export function normHttp(method, path) {
  const raw = typeof method === 'string' ? method.trim().toUpperCase() : '';
  const m = !raw || raw === 'ANY' || raw === 'ALL' ? '*' : raw;
  if (m !== '*' && !/^[A-Z]+$/.test(m)) return null;
  const p = normPath(path);
  return p ? `http:${m} ${p}` : null;
}

/** → 'pkg:npm:@acme/auth' | null. npm, go, maven: as declared; pypi: PEP 503; cargo, nuget,
 *  gem, composer: lower-case. maven needs 'group:artifact' (a ':version' tail is dropped). */
export function normPkg(ecosystem, name) {
  const eco = typeof ecosystem === 'string' ? ecosystem.trim().toLowerCase() : '';
  if (!PKG_ECOSYSTEMS.includes(eco) || typeof name !== 'string') return null;
  let n = name.trim();
  if (!n || n.length > 214 || /\s/.test(n)) return null;
  if (eco === 'pypi') n = n.toLowerCase().replace(/[-_.]+/g, '-');
  else if (eco === 'maven') {
    const parts = n.split(':');
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    n = `${parts[0]}:${parts[1]}`;
  } else if (eco === 'cargo' || eco === 'nuget' || eco === 'gem' || eco === 'composer' || eco === 'git') n = n.toLowerCase();
  return `pkg:${eco}:${n}`;
}

/** 'http://billing:8080/x' → 'billing'; 'billing.internal' → 'billing'; 'billing' → 'billing'.
 *  The first DNS label, lower-case, port and user-info stripped. IPs, IPv6, localhost and
 *  friends, and anything that is not host-shaped → null. */
export function hostAlias(value) {
  if (typeof value !== 'string') return null;
  let s = value.trim();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^\/\//, '');
  s = s.replace(/^[^@/]*@/, '');
  s = s.split(/[/?#]/)[0];
  // A host is at most 253 chars (+ ':port'); longer input is not host-shaped, and the anchored
  // port regex below is quadratic on long ':${…' runs (1 MB took 98 s in the P3 dry run).
  if (!s || s.length > 270 || s.startsWith('[')) return null;
  s = s.replace(/:(\d+|\{\}|\$\{[^}]*\})$/, '').toLowerCase();
  if (!s || LOCAL_HOSTS.includes(s) || /^\d+(\.\d+){3}$/.test(s)) return null;
  const label = s.split('.')[0];
  return /^[a-z0-9]([a-z0-9_-]*[a-z0-9])?$/.test(label) ? label : null;
}

const ENV_URL_TAILS = Object.freeze(['url', 'uri', 'host', 'hostname', 'endpoint', 'addr', 'address']);
const ENV_SOFT_TAILS = Object.freeze(['base', 'service', 'svc', 'server', 'api']);
const ENV_HEADS = Object.freeze(['app', 'services', 'service', 'clients', 'client', 'remote', 'upstream', 'config']);

/** Env / config keys that name another service → candidate aliases, most specific first:
 *  'BILLING_API_URL' → ['billing-api', 'billing_api', 'billing']; 'services.billing.url' → ['billing'];
 *  'billingBaseUrl' → ['billing-base', 'billing_base', 'billing']; ASP.NET 'Billing:Url' → ['billing'].
 *  [] unless the key ends in a URL-ish token (url/uri/host/hostname/endpoint/addr/address). */
export function envStems(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) return [];
  const toks = value.trim().replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[._:\-\s]+/).filter(Boolean);
  let end = toks.length;
  if (!end || !ENV_URL_TAILS.includes(toks[end - 1])) return [];
  end -= 1;
  let start = 0;
  while (start < end - 1 && ENV_HEADS.includes(toks[start])) start += 1;
  const out = [];
  while (end > start) {
    const core = toks.slice(start, end);
    out.push(core.join('-'));
    if (core.length > 1) out.push(core.join('_'));
    if (!ENV_SOFT_TAILS.includes(toks[end - 1])) break;
    end -= 1;
  }
  return [...new Set(out)];
}

/** 'http://Billing.Internal:8080/x' → 'billing.internal': the whole host, lower-case, port and
 *  user-info stripped (hostAlias is its first label). IPs, IPv6, localhost and friends, and
 *  anything that is not host-shaped → null. */
export function hostName(value) {
  if (typeof value !== 'string') return null;
  let s = value.trim();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^\/\//, '');
  s = s.replace(/^[^@/]*@/, '');
  s = s.split(/[/?#]/)[0];
  if (!s || s.length > 270 || s.startsWith('[')) return null;
  s = s.replace(/:(\d+|\{\}|\$\{[^}]*\})$/, '').toLowerCase();
  if (!s || LOCAL_HOSTS.includes(s) || /^\d+(\.\d+){3}$/.test(s)) return null;
  return /^[a-z0-9]([a-z0-9_-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9_-]*[a-z0-9])?)*$/.test(s) ? s : null;
}

/** A git remote → 'host/path' ('github.com/acme/billing-api'): the ONE normaliser for the origin
 *  alias (extract) and for submodule URLs (P3). Accepted forms: scp-like `user@host:org/repo(.git)`
 *  (the user is required: `host:path` alone reads like a Windows drive path) and
 *  `scheme://[user[:pass]@]host[:port]/path` for any scheme (https, http, ssh, git, git+ssh …).
 *  User-info and port are dropped, the result is lower-cased, repeated '/' collapsed, and a
 *  trailing '/' and '.git' stripped. Local paths, `file://` URLs and host-only URLs → null.
 *  Every Azure DevOps spelling of one repository (https dev.azure.com, {org}.visualstudio.com, ssh v3)
 *  folds to 'dev.azure.com/org/project/repo'; an Azure path the parser rejects keeps the generic slug. */
export function remoteSlug(url) {
  if (typeof url !== 'string') return null;
  let s = url.trim();
  if (!s) return null;
  const scp = /^[\w.-]+@([\w.-]+):(?!\/)(.+)$/.exec(s);
  if (scp) s = `${scp[1]}/${scp[2]}`;
  else {
    const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(s);
    if (!m) return null;
    s = `${m[1]}/${m[2]}`;
  }
  const slash = s.indexOf('/');
  const host0 = s.slice(0, slash).toLowerCase();
  if (isAzureHost(host0)) {
    const az = parseAzurePath(host0, s.slice(slash + 1).replace(/\/+$/, '').replace(/\.git$/i, '').split('/'));
    if (az) s = ['dev.azure.com', az.org, az.project, az.repo].map((x, i) => (i ? encodeURIComponent(x) : x)).join('/');
  }
  s = s.toLowerCase().replace(/\/{2,}/g, '/').replace(/\/+$/, '').replace(/\.git$/, '');
  return /^[a-z0-9.-]+\/[\w.~/-]+$/.test(s) ? s : null;
}

/** Both args normalised paths. True when the provider's segments are a suffix of the consumer's
 *  ('{}' on either side matches any one segment) and at least one aligned pair is the same static
 *  segment — a consumer's '{}' alone never meets a provider ('/invoices/{}' does not match '/health'). */
export function pathSuffixMatch(consumerPath, providerPath) {
  if (typeof consumerPath !== 'string' || typeof providerPath !== 'string') return false;
  const c = consumerPath.split('/').filter(Boolean);
  const p = providerPath.split('/').filter(Boolean);
  if (!p.length || p.length > c.length) return false;
  const off = c.length - p.length;
  let agree = false;
  let provParam = false;
  let consParam = false;
  let agreeBefore = false;
  let agreeAfter = false;
  for (let i = 0; i < p.length; i += 1) {
    const cs = c[off + i];
    if (p[i] === '{}' || cs === '{}') {
      if (p[i] !== cs) { if (p[i] === '{}') provParam = true; else consParam = true; }
      continue;
    }
    if (p[i] !== cs) return false;
    agree = true;
    if (!consParam) agreeBefore = true;
    if (consParam && !provParam) agreeAfter = true;
  }
  // Crossed parameters (`/api/users/{}` against `/api/{tenant}/invoices`): each side's parameter sits on the
  // other's literal — two different resources. They align only when a literal agrees AFTER the consumer's
  // parameter and BEFORE the provider's, and the consumer's parameter is anchored in front too: a literal agrees
  // before it (`/api/${version}/users/me` against `/api/v1/users/{id}`), or both paths start with it over a
  // version (`${BASE}/${VERSION}/users/me` is `/{}/users/me`, against `/v1/users/{id}` or `/2/tweets/{id}`).
  // A parameter after a literal the provider lacks is that resource's id (`/users/{}/settings/theme` against
  // `/admin/settings/{}`), and a literal after both (`/users/{}/settings` against `/{tenant}/profile/settings`)
  // is a shared word — neither aligns two resources.
  const lead = off === 0 && /^v?\d/.test(p[0]);
  return agree && !(provParam && consParam && !(agreeAfter && (agreeBefore || lead)));
}

/** Segments are separated by '.' (AMQP, NATS, Kafka) or ':' (Redis channels), and the
 *  separators must agree: '*' = exactly one segment, '#' = zero or more, '>' = one or more (the
 *  rest); exact otherwise. 'orders.*' ↔ 'orders.created'; 'chat:*' ↔ 'chat:room1'. */
export function topicMatches(pattern, name) {
  if (typeof pattern !== 'string' || typeof name !== 'string' || !pattern || !name) return false;
  const p = pattern.split(/([.:])/); // segments at even indexes, separators at odd ones
  const n = name.split(/([.:])/);
  for (let i = 0; i < p.length; i += 2) {
    if (p[i] === '#') return true;
    if (p[i] === '>') return n.length > i;
    if (i >= n.length) return false;
    if (i > 0 && p[i - 1] !== n[i - 1]) return false;
    if (p[i] !== '*' && p[i] !== n[i]) return false;
  }
  return p.length === n.length;
}

/** The longest static prefix of a normalised path before the first segment holding '{}',
 *  returned only when it has ≥ 2 segments or ≥ 8 chars; else null. */
export function httpTerm(normalisedPath) {
  if (typeof normalisedPath !== 'string' || !normalisedPath.startsWith('/')) return null;
  const segs = normalisedPath.split('/').filter(Boolean);
  const stat = [];
  for (const seg of segs) {
    if (seg.includes('{}')) break;
    stat.push(seg);
  }
  if (!stat.length) return null;
  const term = '/' + stat.join('/');
  return stat.length >= 2 || term.length >= 8 ? term : null;
}

function splitHttpKey(key) {
  const m = /^([A-Za-z]+|\*)\s+(\S.*)$/.exec(key);
  if (m && HTTP_METHODS.includes(m[1].toUpperCase())) return [m[1], m[2]];
  return ['*', key];
}

function normDb(key) {
  const m = /^(db|table):(.*)$/i.exec(key);
  const prefix = m ? m[1].toLowerCase() : 'table';
  const name = (m ? m[2] : key).replace(/["`[\]]/g, '').trim().toLowerCase();
  return /^[\w$-]+(\.[\w$-]+)?$/.test(name) ? `${prefix}:${name}` : null;
}

function normGraphql(key) {
  const op = /^(?:op:|query\s+|mutation\s+|subscription\s+)(\w+)$/i.exec(key);
  if (op) return `graphql:op:${op[1]}`;
  return /^\w+\.\w+$/.test(key) ? `graphql:${key}` : null;
}

/** kind + raw key → norm string (spec §5.2) or null when not keyable. Raw key forms: http
 *  "GET /users/:id" | "/users/:id" (method *) | a full URL; pkg "<eco>:<name>"; db "db:<name>" |
 *  "table:<name>" | bare name (→ table); service: host / URL / alias; others: trimmed text. */
export function normKey(kind, key) {
  if (typeof key !== 'string') return null;
  const k = key.trim();
  if (!k) return null;
  switch (kind) {
    case 'http': {
      const [method, path] = splitHttpKey(k);
      return normHttp(method, path);
    }
    case 'pkg': {
      const i = k.indexOf(':');
      return i > 0 ? normPkg(k.slice(0, i), k.slice(i + 1)) : null;
    }
    case 'grpc': {
      const g = k.replace(/^\/+/, '');
      return /^[\w.]*\w(\/\w+)?$/.test(g) ? `grpc:${g}` : null;
    }
    case 'graphql': return normGraphql(k);
    case 'topic': return k.length <= 200 && !/\s/.test(k) ? `topic:${k}` : null;
    case 'db': return normDb(k);
    case 'service': {
      const a = hostAlias(k);
      return a ? `service:${a}` : null;
    }
    case 'other': return `other:${k.toLowerCase().replace(/\s+/g, ' ').slice(0, LIMITS.OTHER_KEY_MAX)}`;
    default: return null;
  }
}

/** The part of a norm after its kind prefix: 'http:GET /a/{}' → 'GET /a/{}', 'pkg:npm:x' → 'npm:x'. */
export function normBody(norm) {
  if (typeof norm !== 'string') return '';
  const i = norm.indexOf(':');
  return i < 0 ? norm : norm.slice(i + 1);
}
