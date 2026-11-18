// src/core/mcp/definitions.mjs
// MCP registry server definitions (registry design §4.1): one pure validator for every source —
// plugin manifests, the manual form, team-policy inline entries. Pure: no fs, no env.
//
// A definition says how to start a server and which fields each set fills in; it never holds a
// secret. Field refs `{ field, prefix?, suffix? }` stand where a set's value goes. Maps holding
// user keys (env, headers) are null-prototype, so `__proto__` and `constructor` are plain keys.

import { createHash } from 'node:crypto';
import { SECRET_NAME_RE, QUERY_SECRET_RE, hasTokenShape, mcpSecretFindings } from '../mcp-secrets.mjs';
import { looksLikeSecret } from '../policy/registry.mjs';

export const SERVER_NAME_RE = /^[a-z][a-z0-9-]{0,19}$/;
// Ids (§4.2, §4.4, §12): set ids (user, General, Team `team-…`); server ids `manual:<name>`,
// `plugin:<plugin>/<name>` (plugin per PLUGIN_NAME_RE), `policy:<lowercase home slug>/<name>` (home segments as
// slugSegment in metrics/sync.mjs makes them: `_` may lead, `.` and `-` never do);
// membership keys `<setId>|<memberId>` (mcpOptOut, mcpOff.members), a member being a server or a skill (skills registry §3.1).
export const SET_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const SERVER_ID_SRC = '(?:manual:[a-z][a-z0-9-]{0,19}|plugin:[a-z][a-z0-9]*(?:-[a-z0-9]+)*/[a-z][a-z0-9-]{0,19}|policy:[a-z0-9_][a-z0-9._-]*(?:/[a-z0-9_][a-z0-9._-]*)*/[a-z][a-z0-9-]{0,19})';
// At most 1024 characters, checked first: a 6.4 MB entry (P4 mcpOptOut, P5 mcpOff come from 8 MB bodies) would
// overflow the regexp backtrack stack in SERVER_ID_SRC's repeated groups and throw RangeError.
export const SERVER_ID_RE = new RegExp('^(?=.{1,1024}$)' + SERVER_ID_SRC + '$');
// Skill ids `skill:plugin:<plugin>/<name>` and `skill:library:<name>` (skills registry §3.1): a literal copy of SKILL_ID_SRC in
// src/core/skills-registry/ids.mjs, with no import between the two modules; test/mcp-store-skills.test.mjs asserts they are equal.
const SKILL_ID_SRC = '(?:skill:plugin:[a-z][a-z0-9]*(?:-[a-z0-9]+)*/[a-z0-9]+(?:-[a-z0-9]+)*|skill:library:[a-z0-9]+(?:-[a-z0-9]+)*)';
export const SET_MEMBER_ID_SRC = '(?:' + SERVER_ID_SRC + '|' + SKILL_ID_SRC + ')';
export const SET_MEMBER_ID_RE = new RegExp('^(?=.{1,1024}$)' + SET_MEMBER_ID_SRC + '$');
export const MEMBERSHIP_KEY_RE = new RegExp('^[a-z][a-z0-9-]{0,31}\\|(?=.{1,1024}$)' + SET_MEMBER_ID_SRC + '$');
const SKILL_MEMBERSHIP_KEY_RE = new RegExp('^[a-z][a-z0-9-]{0,31}\\|(?=.{1,1024}$)' + SKILL_ID_SRC + '$');
/** A membership key `<setId>|<memberId>` whose member is a skill. Text only: a key is never coerced. */
export const isSkillMemberKey = (key) => typeof key === 'string' && SKILL_MEMBERSHIP_KEY_RE.test(key);
// The words after /api/sets/ that name another part of the Sets API (the /api/sets alias in ui/server.mjs): no new set takes one as its id.
export const SETS_API_NOUNS = Object.freeze(['servers', 'projects', 'teams', 'preview']);
export const MCP_ENV_VAR_RE = /^MCP_[A-Z0-9_]{1,60}$/;
export const URL_SAFE_SECRET_RE = /^[A-Za-z0-9._~-]+$/;
const FIELD_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/; // RFC 7230 token
const REFUSED_HEADERS = new Set(['host', 'content-length', 'transfer-encoding', 'connection', 'upgrade']);
const RESERVED_ENV_RE = /^(MCPSECRET_|MCPCHILD_)/i;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const TYPES = new Set(['stdio', 'http', 'sse']);

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isRef = (v) => isObj(v) && typeof v.field === 'string';
const isAbsPath = (s) => /^([\\/]|[A-Za-z]:[\\/])/.test(s);
const placeholder = (i) => `mcpfield${i}x`;
const PLACEHOLDER_RE = /mcpfield(\d+)x/g;
/** The refs whose placeholder occurs in `s`, in ref order — one scan (`mcpfield` never starts inside a
 *  placeholder), not one `includes` per ref: refs × text is quadratic on a url of many refs. */
function refsIn(s, refs) {
  const hit = new Set();
  for (const m of s.matchAll(PLACEHOLDER_RE)) if (refs[Number(m[1])]?.ph === m[0]) hit.add(refs[Number(m[1])]);
  return [...hit].sort((a, b) => a.i - b.i);
}

/** Non-secret text (§4.1): no `${` (the CLI expands it), no control character. */
function textProblem(s) {
  if (s.includes('${')) return 'may not contain ${';
  if (/[\u0000-\u001F\u007F]/.test(s)) return 'may not contain control characters';
  return null;
}

/**
 * Validate and normalize one server definition.
 * @param {unknown} raw
 * @param {{name: string, source: 'plugin'|'manual'|'policy'}} opts  plugin: `./` command/args allowed
 *   (kept relative; the catalog resolves them against the plugin dir); manual and policy: refused.
 * @returns {{def: object|null, errors: string[]}}
 */
export function validateMcpDefinition(raw, { name, source }) {
  const errors = [];
  const err = (m) => errors.push(m);
  // Never template a name that is not text: `{ "toString": 0 }` (a policy entry's raw name) throws when coerced.
  if (typeof name !== 'string' || !SERVER_NAME_RE.test(name)) err(`name "${typeof name === 'string' ? name : ''}": 1–20 lowercase letters, digits or -, starting with a letter`);
  else if (name === 'worca') err('name "worca" is reserved');
  if (!isObj(raw)) return { def: null, errors: [...errors, 'the definition must be an object'] };
  if (!TYPES.has(raw.type)) return { def: null, errors: [...errors, 'type must be stdio, http or sse'] };
  const def = { type: raw.type };
  const plugin = source === 'plugin';

  const fields = [];
  const byKey = Object.create(null);
  const seenKeys = new Set();
  if (raw.fields !== undefined && !Array.isArray(raw.fields)) err('fields must be an array');
  for (const [i, f] of (Array.isArray(raw.fields) ? raw.fields : []).entries()) {
    if (!isObj(f) || typeof f.key !== 'string' || !FIELD_KEY_RE.test(f.key)) { err(`fields[${i}]: key must be 1–32 letters, digits or _, starting with a letter`); continue; }
    if (seenKeys.has(f.key.toUpperCase())) { err(`fields[${i}]: key ${f.key} is declared twice (keys are compared ignoring case)`); continue; }
    seenKeys.add(f.key.toUpperCase());
    for (const b of ['secret', 'oauth', 'required']) if (f[b] !== undefined && typeof f[b] !== 'boolean') err(`field ${f.key}: ${b} must be true or false`);
    const field = { key: f.key, label: f.label ?? f.key, secret: f.secret === true, oauth: f.oauth === true, required: f.required === true };
    if (typeof field.label !== 'string' || !field.label.trim()) err(`field ${f.key}: label must be text`);
    else if (textProblem(field.label)) err(`field ${f.key}: label ${textProblem(field.label)}`);
    if (field.oauth && !field.secret) err(`field ${f.key}: oauth applies to secret fields only`);
    if (f.default !== undefined) {
      if (field.secret) err(`field ${f.key}: a secret field has no default`);
      else if (typeof f.default !== 'string') err(`field ${f.key}: default must be text`);
      else if (textProblem(f.default)) err(`field ${f.key}: default ${textProblem(f.default)}`);
      else field.default = f.default;
    }
    fields.push(field);
    byKey[f.key] = field;
  }

  // One value position: literal text or a field ref. Returns the normalized value.
  const slot = (v, at) => {
    if (typeof v === 'string') { if (textProblem(v)) err(`${at}: ${textProblem(v)}`); return v; }
    if (!isRef(v)) { err(`${at}: must be text or { "field": … }`); return undefined; }
    if (!Object.hasOwn(byKey, v.field)) { err(`${at}: unknown field "${v.field}"`); return undefined; }
    const ref = { field: v.field };
    for (const k of ['prefix', 'suffix']) {
      if (v[k] === undefined || v[k] === '') continue;
      if (typeof v[k] !== 'string') { err(`${at}: ${k} must be text`); continue; }
      if (textProblem(v[k])) err(`${at} ${k}: ${textProblem(v[k])}`);
      ref[k] = v[k];
    }
    if (ref.prefix?.endsWith('$')) err(`${at}: prefix may not end with $`);
    if (ref.suffix?.startsWith('{')) err(`${at}: suffix may not start with {`);
    return ref;
  };
  const mustBeSecret = (v, at) => {
    if (isRef(v) && Object.hasOwn(byKey, v.field) && !byKey[v.field].secret) err(`${at}: field ${v.field} must be secret (the name says it carries a secret)`);
  };
  // env keys / header names: own keys, unique ignoring case; the value is one slot.
  const keyedSlots = (obj, label, at, check) => {
    if (!isObj(obj)) { err(`${label} must be an object`); return undefined; }
    const out = Object.create(null);
    const seen = new Set();
    for (const [k, v] of Object.entries(obj)) {
      const bad = check(k);
      if (bad) { err(`${at} ${k}: ${bad}`); continue; }
      if (seen.has(k.toUpperCase())) { err(`${at} ${k}: declared twice (names are compared ignoring case)`); continue; }
      seen.add(k.toUpperCase());
      out[k] = slot(v, `${at} ${k}`);
      if (SECRET_NAME_RE.test(k)) mustBeSecret(out[k], `${at} ${k}`);
    }
    return out;
  };

  if (def.type === 'stdio') {
    const cmd = raw.command;
    if (typeof cmd !== 'string' || !cmd.trim()) err('command is required');
    else {
      if (textProblem(cmd)) err(`command: ${textProblem(cmd)}`);
      if (/[\\/]/.test(cmd) && !isAbsPath(cmd) && !(plugin && cmd.startsWith('./'))) {
        err(plugin ? 'command: use ./… inside the plugin, an absolute path or a bare name' : 'command: use an absolute path or a bare name found on PATH');
      }
      def.command = cmd;
    }
    if (raw.args !== undefined) {
      if (!Array.isArray(raw.args)) err('args must be an array');
      else def.args = raw.args.map((a, i) => {
        const v = slot(a, `args[${i}]`);
        if (typeof v === 'string' && v.startsWith('./') && !plugin) err(`args[${i}]: ./ paths are only for plugin servers`);
        if (isRef(v) && byKey[v.field].secret) err(`args[${i}]: secret field ${v.field} cannot be an argument (every local user can read arguments) — pass it through env`);
        return v;
      });
    }
    if (raw.env !== undefined) {
      def.env = keyedSlots(raw.env, 'env', 'env', (k) =>
        !ENV_KEY_RE.test(k) ? 'names are letters, digits and _, not starting with a digit, at most 64'
          : RESERVED_ENV_RE.test(k) ? 'MCPSECRET_ and MCPCHILD_ names are reserved' : null);
    }
  } else {
    let url = Array.isArray(raw.url) && raw.url.length === 1 && !Array.isArray(raw.url[0]) ? raw.url[0] : raw.url;
    if (Array.isArray(url) && url.length && url.every((p) => typeof p === 'string')) url = url.join(''); // all text: one URL, screened whole
    if (url === undefined || (Array.isArray(url) && !url.length)) err('url is required');
    else {
      const parts = (Array.isArray(url) ? url : [url]).map((p, i) => slot(p, Array.isArray(url) ? `url[${i}]` : 'url'));
      def.url = Array.isArray(url) ? parts : parts[0];
      if (!parts.includes(undefined)) checkUrl(parts, byKey, err);
    }
    if (raw.headers !== undefined) {
      def.headers = keyedSlots(raw.headers, 'headers', 'header', (k) =>
        !HEADER_NAME_RE.test(k) ? 'not a valid header name' : REFUSED_HEADERS.has(k.toLowerCase()) ? 'not allowed' : null);
    }
  }

  def.fields = fields;
  if (raw.description !== undefined && typeof raw.description !== 'string') err('description must be text');
  def.description = typeof raw.description === 'string' ? raw.description : '';
  if (def.description.length > 200) err('description: at most 200 characters');
  if (textProblem(def.description)) err(`description: ${textProblem(def.description)}`);
  for (const m of mcpLiteralFindings(def)) errors.push(m); // not push(...): 100k+ findings overflow the stack
  return { def: errors.length ? null : def, errors };
}

// The url's parts joined with a placeholder per field ref, parsed once: scheme, secret placement
// (path or query only — never host, userinfo, fragment or the whole URL) and secret-named query values.
function checkUrl(parts, byKey, err) {
  const refs = [];
  let probe = '';
  for (const p of parts) {
    if (typeof p === 'string') { probe += p; continue; }
    if (!byKey[p.field].required) err(`url: field ${p.field} must be required`);
    refs.push({ field: p.field, ph: placeholder(refs.length), i: refs.length });
    probe += `${p.prefix ?? ''}${refs.at(-1).ph}${p.suffix ?? ''}`;
  }
  // Each part passed the text rules alone; where parts meet they may not form `${` either ('…/$' + '{HOME}').
  const pieces = parts.flatMap((p) => (typeof p === 'string' ? [p] : [p.prefix ?? '', p.suffix ?? '']));
  if (probe.includes('${') && !pieces.some((x) => x.includes('${'))) err('url: its parts may not join into ${');
  if (refs.length) { // literal secrets beside field refs (a plain string url is screened by mcpLiteralFindings)
    const literal = (v) => !!v && !refsIn(v, refs).length;
    let q = null;
    try { q = new URL(probe, 'https://base.invalid'); } catch { /* reported below */ }
    if (q && (literal(q.password) || [...q.searchParams].some(([k, v]) => QUERY_SECRET_RE.test(k) && literal(v)))) {
      err('url: looks like a secret — make it a secret field');
    }
  }
  if (refs.length && probe.startsWith(refs[0].ph)) {
    // The field supplies scheme and host, so placement is known only once materialized (the resolver re-checks, §5.4);
    // parsed against a stand-in origin, the query still shows which field a secret-named parameter takes.
    if (refs.some((r) => byKey[r.field].secret)) err('url: a URL that starts with a field cannot use a secret field');
    let rel = null;
    try { rel = new URL(probe, 'https://base.invalid'); } catch { /* the resolver rejects the materialized URL */ }
    if (rel) querySecretFields(rel, refs, byKey, err);
    return;
  }
  let u;
  try { u = new URL(probe); } catch { err('url: not a valid URL'); return; }
  if (!(u.protocol === 'https:' || (u.protocol === 'http:' && LOOPBACK.has(u.hostname)))) {
    err('url: must be https:// (http:// only for localhost, 127.0.0.1 or [::1])');
  }
  const inside = new Set(refsIn(u.pathname + u.search, refs));
  const outside = new Set(refsIn([u.username, u.password, u.host, u.hash].join(' '), refs));
  for (const r of refs) {
    if (byKey[r.field].secret && (outside.has(r) || !inside.has(r))) err(`url: secret field ${r.field} may appear only in the path or query`);
  }
  querySecretFields(u, refs, byKey, err);
}

// §4.1: a field in the value of a query parameter matching QUERY_SECRET_RE must be secret.
function querySecretFields(u, refs, byKey, err) {
  for (const [k, v] of u.searchParams) {
    if (!QUERY_SECRET_RE.test(k)) continue;
    for (const { field } of refsIn(v, refs)) if (!byKey[field].secret) err(`url: field ${field} is the value of ${k}: make it a secret field`);
  }
}

// A URL inside a longer word: `--db=postgresql://app:pw@db/x`, `-Dendpoint=https://…?token=…`. The scheme is
// bounded: an unbounded run backtracks once per start position, quadratic on long text (a PUT body, a policy
// value, a manifest arg).
const URL_IN_TEXT_RE = /[A-Za-z][A-Za-z0-9+.-]{0,31}:\/\/\S+/g;
// An image digest (`mcp/fetch@sha256:<hex>`) is a public content hash, not a key (§4.1: hex runs are also SHAs).
const IMAGE_DIGEST_RE = /@sha(?:256|384|512):[0-9a-f]{64,128}\b/gi;

/** §4.3 substring screen on one text: a token shape anywhere, a URL with a password, a secret-named
 *  query parameter with a value — parsing the whole text, each whitespace piece and each `scheme://…`
 *  substring. `base` also parses relative text such as `mcp?token=…`. */
function secretInText(s, base) {
  if (hasTokenShape(s)) return true;
  for (const piece of new Set([s, ...s.split(/\s+/), ...(s.match(URL_IN_TEXT_RE) ?? [])])) {
    let u;
    try { u = new URL(piece, base); } catch { continue; }
    if (u.password) return true;
    for (const [k, v] of u.searchParams) if (v && QUERY_SECRET_RE.test(k)) return true;
  }
  return false;
}

/**
 * The literal screen (§4.1): mcpSecretFindings plus, on every literal (command, args, env and header
 * values, url parts, every prefix/suffix, field defaults, description), the substring screen and
 * looksLikeSecret on each token split on whitespace, `=`, `:` and `,`. A bare 32-hex key is not
 * detected (hex runs are also commit SHAs), nor an image digest. `def` is a normalized definition.
 * @returns {string[]} one message per place
 */
export function mcpLiteralFindings(def) {
  const places = new Set(mcpSecretFindings(def));
  const check = (place, s) => {
    if (typeof s !== 'string') return;
    if (secretInText(s, 'https://base.invalid') || s.replace(IMAGE_DIGEST_RE, '@').split(/[\s=:,]+/).some(looksLikeSecret)) places.add(place);
  };
  const slotText = (place, v) => { if (isRef(v)) { check(place, v.prefix); check(place, v.suffix); } else check(place, v); };
  check('command', def.command);
  (Array.isArray(def.args) ? def.args : []).forEach((a, i) => slotText(`args[${i}]`, a));
  for (const [k, v] of Object.entries(def.env ?? {})) slotText(`env ${k}`, v);
  for (const [k, v] of Object.entries(def.headers ?? {})) slotText(`header ${k}`, v);
  for (const p of Array.isArray(def.url) ? def.url : [def.url]) slotText('url', p);
  for (const f of def.fields ?? []) check(`field ${f.key} default`, f.default);
  check('description', def.description);
  return [...places].map((p) => `${p}: looks like a secret — make it a secret field`);
}

/** A non-secret value typed into a set (§4.3; also policy `values`): null when fine, else why not. */
export function screenNonSecretValue(value) {
  if (typeof value !== 'string') return 'must be text';
  const bad = textProblem(value);
  if (bad) return bad;
  if (value.endsWith('$')) return 'may not end with $';
  if (value.startsWith('{')) return 'may not start with {';
  return secretInText(value, 'https://base.invalid') ? 'looks like a secret — make this field secret' : null;
}

/** JSON with object keys sorted recursively (arrays keep their order): stable hashing input. */
export function canonicalJson(value) {
  const norm = (v) => (Array.isArray(v) ? v.map(norm)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])])) : v);
  return JSON.stringify(norm(value));
}

export function sha256Hex(text) {
  return createHash('sha256').update(text).digest('hex');
}

/** The digest a chat card pins a stored definition by (docs/mcp-servers.md "Chat"): the card carries no stored literal. */
export const defDigest = (def) => sha256Hex(canonicalJson(def));
