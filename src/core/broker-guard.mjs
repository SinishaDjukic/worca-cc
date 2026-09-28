// src/core/broker-guard.mjs
// Guarantee K1 (plans/credential-broker-design.html §6.8): with the credential
// broker on, no model credential may exist anywhere an agent can reach. worca
// refuses to start while one does, and names each finding by WHERE it is — never by
// its value. The pure part takes everything as input; the boot wrapper gathers it.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Env vars that authenticate a model provider. Empty values (as Compose sets them) don't count. */
export const MODEL_CREDENTIAL_ENV_KEYS = Object.freeze([
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN',
  'OPENAI_API_KEY', 'OPENROUTER_API_KEY',
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_BEARER_TOKEN_BEDROCK',
  'GOOGLE_APPLICATION_CREDENTIALS', 'ANTHROPIC_FOUNDRY_API_KEY', 'AZURE_OPENAI_API_KEY',
]);

// ANTHROPIC_AUTH_TOKEN, OPENAI_API_KEY, … — but not *_MAX_OUTPUT_TOKENS (same rule as ask/model-proposal.mjs).
const SECRET_ENV_RE = /(^|_)(TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIALS?)(_|$)/i;
const SECRET_HEADER_RE = /authorization|api[-_]?key|token|secret|cookie|password/i;
const LOOPBACK_RE =/^https?:\/\/(127\.\d+\.\d+\.\d+|localhost|\[::1\])(:\d+)?(\/|$)/i;

const describe = (v) => `(set, ${String(v).length} chars)`;

/**
 * @param {{env?:Record<string,string|undefined>, files?:{path:string, kind:'login'|'settings'|'secret', content?:string}[],
 *          models?:object[], providers?:Record<string,object>, brokerUrl?:string}} o
 * @returns {string[]} findings, one line each
 */
export function findLocalCredentials({ env = {}, files = [], models = [], providers = {}, brokerUrl = '', slotOrigins = [] } = {}) {
  const out = [];
  for (const k of MODEL_CREDENTIAL_ENV_KEYS) {
    const v = env[k];
    if (typeof v === 'string' && v.trim()) out.push(`env ${k} ${describe(v.trim())}`);
  }
  for (const f of files) {
    if (f.kind === 'login') out.push(`${f.path}: a stored Claude Code sign-in`);
    else if (f.kind === 'secret') out.push(`${f.path}: a mounted API key`);
    else if (f.kind === 'settings' && /"apiKeyHelper"\s*:/.test(f.content || '')) out.push(`${f.path}: an apiKeyHelper`);
  }
  const brokerPrefix = brokerUrl ? `${brokerUrl.replace(/\/+$/, '')}/p/` : null;
  for (const m of models || []) {
    const id = JSON.stringify(m?.id ?? '?');
    for (const [k, v] of Object.entries(m?.env || {})) {
      if (typeof v !== 'string' || !v.trim()) continue;
      if (k === 'ANTHROPIC_BASE_URL') {
        if (!(brokerPrefix && v.trim().startsWith(brokerPrefix))) out.push(`catalog model ${id}: env ANTHROPIC_BASE_URL routes around the broker`);
      } else if (SECRET_ENV_RE.test(k)) {
        out.push(`catalog model ${id}: env ${k} ${/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(v.trim()) ? `= ${v.trim()}` : describe(v.trim())}`);
      }
    }
    const up = m?.upstream;
    if (up && typeof up === 'object') {
      if (typeof up.apiKey === 'string' && up.apiKey.trim()) out.push(`catalog model ${id}: upstream.apiKey`);
      // A remote endpoint is fine when a broker slot pins its origin (the bridge goes there
      // through the broker); a keyless local one is reached directly and holds no key.
      if (typeof up.baseUrl === 'string' && up.baseUrl.trim() && !LOOPBACK_RE.test(up.baseUrl.trim()) && !isPrivateUrl(up.baseUrl)) {
        let origin = null;
        try { origin = new URL(up.baseUrl).origin; } catch { /* reported below */ }
        if (!origin || !slotOrigins.includes(origin)) {
          out.push(`catalog model ${id}: upstream.baseUrl ${origin ? new URL(origin).host : up.baseUrl} has no credential slot on the broker (add one to WORCA_BROKER_SLOTS_FILE)`);
        }
      }
      for (const [h, v] of Object.entries(up.headers || {})) {
        if (SECRET_HEADER_RE.test(h) && typeof v === 'string' && v.trim()) out.push(`catalog model ${id}: upstream.headers ${h}`);
      }
    }
  }
  for (const [name, p] of Object.entries(providers || {})) {
    for (const k of ['apiKey', 'githubToken']) {
      if (p && typeof p[k] === 'string' && p[k].trim()) out.push(`providers.${name}.${k}`);
    }
  }
  return out;
}

function isPrivateUrl(u) {
  try {
    const h = new URL(u).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (h === 'host.docker.internal' || h.endsWith('.internal') || h.endsWith('.local') || !h.includes('.')) return true;
    const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h);
    if (!m) return false;
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
  } catch { return false; }
}

/** The files the guard looks at under each HOME that agents or the server run with. */
export function credentialFiles(homes, { exists = existsSync, read = (p) => readFileSync(p, 'utf8') } = {}) {
  const out = [];
  for (const home of [...new Set(homes.filter(Boolean))]) {
    const dir = process.env.CLAUDE_CONFIG_DIR && home === process.env.HOME ? process.env.CLAUDE_CONFIG_DIR : join(home, '.claude');
    const login = join(dir, '.credentials.json');
    if (exists(login)) out.push({ path: login, kind: 'login' });
    const settings = join(dir, 'settings.json');
    if (exists(settings)) {
      let content = '';
      try { content = read(settings); } catch { content = ''; }
      out.push({ path: settings, kind: 'settings', content });
    }
  }
  if (exists('/run/secrets/anthropic_api_key')) out.push({ path: '/run/secrets/anthropic_api_key', kind: 'secret' });
  return out;
}

/** The one-paragraph refusal the server prints before exiting 78. */
export function guardMessage(findings, keyPage) {
  return [
    'worca: the credential broker is on, but model credentials are still reachable by agents:',
    ...findings.map((f) => `worca:   ${f}`),
    `worca: remove them from worca (they belong in the broker${keyPage ? `: ${keyPage}` : ''}), then restart.`,
  ].join('\n');
}
