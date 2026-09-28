// src/broker/slots.mjs
// Credential slots (plans/credential-broker-design.html §5.3, §6.3): one kind of
// credential with ONE pinned destination. A request names a slot, never a host, so
// nothing on worca's side (the catalog, an Ask proposal, an agent's env) can send a
// key anywhere else (guarantee K2). Pure.

export const PROTOCOLS = Object.freeze(['anthropic', 'openai', 'github']);
export const AUTH_STYLES = Object.freeze(['x-api-key', 'bearer', 'copilot', 'github-user', 'none']);
const HEADER_NAME_RE = /^[a-z0-9-]{1,64}$/;
/** Request headers Copilot's gateway needs beyond the common allowlist (the editor identity). */
const COPILOT_HEADERS = Object.freeze([
  'copilot-integration-id', 'editor-version', 'editor-plugin-version', 'openai-intent',
  'x-github-api-version', 'x-request-id', 'x-initiator', 'copilot-vision-request',
]);
export const CREDENTIAL_KINDS = Object.freeze(['per-person', 'operator', 'none']);
const SLOT_ID_RE = /^[a-z][a-z0-9-]{1,31}$/;

const ANTHROPIC_PATHS = Object.freeze([
  ['POST', '/v1/messages'],
  ['POST', '/v1/messages/count_tokens'],
  ['GET', '/v1/models'],
]);
const OPENAI_PATHS = Object.freeze([
  ['POST', '/v1/chat/completions'],
  ['POST', '/v1/responses'],
  ['GET', '/v1/models'],
]);

/**
 * The built-in slots. `local` exists only when the operator names its upstream; `github`
 * ("push as me") only when the operator configured a GitHub App or OAuth App for it.
 */
export function builtinSlots({ localUrl = null, github = null } = {}) {
  const slots = [
    {
      // An API key (sk-ant-api…) or a Claude subscription token from `claude setup-token`
      // (sk-ant-oat…): the broker tells them apart and sends each the way it must be sent.
      id: 'anthropic', label: 'Anthropic API key or Claude subscription', protocol: 'anthropic',
      upstream: 'https://api.anthropic.com', auth: 'x-api-key', credential: 'per-person',
      paths: ANTHROPIC_PATHS, verify: { method: 'GET', path: '/v1/models' },
      keyHint: 'sk-ant-api… or, from `claude setup-token`, sk-ant-oat…',
    },
    {
      id: 'openai', label: 'OpenAI API key', protocol: 'openai',
      upstream: 'https://api.openai.com', auth: 'bearer', credential: 'per-person',
      paths: OPENAI_PATHS, verify: { method: 'GET', path: '/v1/models' },
      keyHint: 'sk-…',
    },
    {
      id: 'openrouter', label: 'OpenRouter API key', protocol: 'openai',
      upstream: 'https://openrouter.ai', auth: 'bearer', credential: 'per-person',
      paths: Object.freeze([['POST', '/api/v1/chat/completions'], ['GET', '/api/v1/models'], ['GET', '/api/v1/key']]),
      verify: { method: 'GET', path: '/api/v1/key' },
      keyHint: 'sk-or-…',
    },
    {
      // The upstream is where the token exchange says Copilot's API lives (always a
      // *.githubcopilot.com host, src/broker/copilot.mjs); this is only the fallback.
      id: 'copilot', label: 'GitHub Copilot', protocol: 'openai',
      upstream: 'https://api.githubcopilot.com', auth: 'copilot', credential: 'per-person',
      paths: Object.freeze([['POST', '/chat/completions'], ['POST', '/responses'], ['POST', '/v1/messages'], ['GET', '/models']]),
      headers: COPILOT_HEADERS, verify: { exchange: true }, keyHint: '', signIn: 'github-device',
    },
  ];
  if (github && github.clientId) {
    // Never proxied (no paths): worca asks the broker for a short-lived token for ONE
    // git or gh call of the acting person (/internal/github-token), and makes the call.
    slots.push({
      id: 'github', label: 'GitHub (push as me)', protocol: 'github',
      upstream: 'https://api.github.com', auth: 'github-user', credential: 'per-person',
      paths: Object.freeze([]), verify: { github: true }, keyHint: 'or paste a fine-grained token (github_pat_…)',
      signIn: 'github-device', clientId: github.clientId, scope: github.scope,
    });
  }
  if (localUrl) {
    slots.push({
      id: 'local', label: 'Local models', protocol: 'anthropic',
      upstream: localUrl, auth: 'none', credential: 'none',
      paths: ANTHROPIC_PATHS, verify: null, keyHint: '',
    });
  }
  return slots;
}

function isPrivateHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1' || h === 'host.docker.internal' || h.endsWith('.internal') || h.endsWith('.local')) return true;
  if (/^(fc|fd)[0-9a-f]{2}:/i.test(h)) return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h);
  if (!m) return !h.includes('.');          // a bare service name on a private network ("ollama")
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/** An upstream must be an origin: https anywhere, http only on a private network. */
export function upstreamIssue(v) {
  let u;
  try { u = new URL(String(v || '').trim()); } catch { return 'upstream is not a URL'; }
  if (u.username || u.password) return 'upstream must not carry credentials';
  if (u.pathname !== '/' || u.search || u.hash) return 'upstream must be an origin only (scheme://host[:port])';
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:' && isPrivateHost(u.hostname)) return null;
  return 'upstream must be https (http only for a private or loopback host)';
}

function normPaths(paths, where) {
  if (!Array.isArray(paths) || !paths.length) throw new Error(`${where}: paths must be a non-empty array of [METHOD, "/path"]`);
  return Object.freeze(paths.map((p) => {
    const [method, path] = Array.isArray(p) ? p : [p?.method, p?.path];
    const m = String(method || '').toUpperCase();
    if (!['GET', 'POST'].includes(m)) throw new Error(`${where}: method must be GET or POST`);
    if (typeof path !== 'string' || !path.startsWith('/') || pathIssue(path)) throw new Error(`${where}: bad path ${JSON.stringify(path)}`);
    return Object.freeze([m, path]);
  }));
}

/**
 * Merge the operator's slots file over the built-ins: an entry with a built-in id
 * overrides it field by field, a new id adds a slot. Throws with a message naming
 * the entry.
 */
export function mergeSlots(builtins, extra) {
  const byId = new Map(builtins.map((s) => [s.id, { ...s }]));
  if (extra !== undefined && extra !== null) {
    if (!Array.isArray(extra)) throw new Error('the slots file must hold a JSON array');
    for (const [i, e] of extra.entries()) {
      const where = `slots[${i}]`;
      if (!e || typeof e !== 'object') throw new Error(`${where} must be an object`);
      if (!SLOT_ID_RE.test(String(e.id || ''))) throw new Error(`${where}: id must match ${SLOT_ID_RE}`);
      const base = byId.get(e.id) || {};
      const s = { ...base, ...e };
      if (!PROTOCOLS.includes(s.protocol)) throw new Error(`${where}: protocol must be one of ${PROTOCOLS.join(', ')}`);
      if (!AUTH_STYLES.includes(s.auth)) throw new Error(`${where}: auth must be one of ${AUTH_STYLES.join(', ')}`);
      if (!CREDENTIAL_KINDS.includes(s.credential)) throw new Error(`${where}: credential must be one of ${CREDENTIAL_KINDS.join(', ')}`);
      const issue = upstreamIssue(s.upstream);
      if (issue) throw new Error(`${where}: ${issue}`);
      s.upstream = new URL(s.upstream).origin;
      // A GitHub ("push as me") slot is never proxied: it keeps no paths.
      s.paths = s.auth === 'github-user' ? Object.freeze([]) : normPaths(s.paths || (s.protocol === 'openai' ? OPENAI_PATHS : ANTHROPIC_PATHS), where);
      s.label = typeof s.label === 'string' && s.label.trim() ? s.label.trim() : s.id;
      if (s.verify && (typeof s.verify !== 'object' || (!s.verify.path && !s.verify.exchange && !s.verify.github))) throw new Error(`${where}: verify must be {method, path}`);
      if (s.headers !== undefined) {
        if (!Array.isArray(s.headers) || !s.headers.every((x) => HEADER_NAME_RE.test(String(x).toLowerCase()))) throw new Error(`${where}: headers must be a list of header names`);
        if (s.headers.some((x) => /^(authorization|x-api-key|cookie|host|proxy-.*)$/i.test(x))) throw new Error(`${where}: headers may not include credential or routing headers`);
        s.headers = Object.freeze(s.headers.map((x) => String(x).toLowerCase()));
      }
      for (const k of ['exchangeUrl', 'deviceBaseUrl']) {
        if ((s.auth !== 'copilot' && s.auth !== 'github-user') || s[k] === undefined) continue;
        let origin;
        try { origin = new URL(s[k]).origin; } catch { throw new Error(`${where}: ${k} is not a URL`); }
        const issue = upstreamIssue(origin);
        if (issue) throw new Error(`${where}: ${k}: ${issue}`);
      }
      byId.set(s.id, s);
    }
  }
  return [...byId.values()].map((s) => Object.freeze(s));
}

/**
 * Why a request path is unsafe to forward, or null. Rejects anything a
 * normalising upstream could read as a different path: dot segments, empty
 * segments, encoded slashes/backslashes/dots, backslashes and control chars.
 */
export function pathIssue(path) {
  const p = String(path);
  if (!p.startsWith('/')) return 'path must start with /';
  if (/[\u0000-\u001f\u007f\\]/.test(p)) return 'path has control characters or backslashes';
  if (/%(2f|5c|2e|00)/i.test(p)) return 'path has encoded separators';
  if (p.includes('//')) return 'path has empty segments';
  if (p.split('/').some((seg) => seg === '.' || seg === '..')) return 'path has dot segments';
  return null;
}

/** Whether `method path` (path WITHOUT the query) is on the slot's allowlist. */
export function isAllowedPath(slot, method, path) {
  if (pathIssue(path)) return false;
  const m = String(method || '').toUpperCase();
  return slot.paths.some(([pm, pp]) => pm === m && pp === path);
}
