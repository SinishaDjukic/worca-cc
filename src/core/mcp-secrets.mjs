// src/core/mcp-secrets.mjs
// Secrets in the MCP server definitions a run hands its agents (credential broker,
// docs/credential-broker.md). A run's --mcp-config merges each project's MCP servers and
// the local-scope ones from worca's own ~/.claude.json; whatever an entry carries in its
// `env`, `headers` or URL reaches the agent: the server process runs as the agent user
// with that environment, and the config file is readable to it. That is the one class
// of credential agents could still read once model keys live in the broker.
//
// A literal secret-looking value is a finding; a whole `${VAR}` reference is not: the CLI
// expands it from the agent's own environment, so the secret is only there if the operator
// put it in worca's environment on purpose (where agents can read it just the same).
//   WORCA_MCP_SECRETS = block | warn | off   default: block with the broker on, else warn.
// block drops the server from the run's config and says so; warn only says so. Values are
// never printed. Pure.

const SECRET_NAME_RE = /(^|[_-])(TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIALS?|AUTH|COOKIE|SESSION)([_-]|$)|authorization|api[-_]?key|x-api-key|bearer/i;
const QUERY_SECRET_RE = /^(api[-_]?key|key|token|access[-_]?token|secret|password|auth|sig|signature)$/i;
const REF_RE = /^\$\{[A-Za-z_][A-Za-z0-9_]*(:-[^}]*)?\}$/;
const TOKEN_SHAPE_RE = /\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.)/;

export const MCP_SECRET_MODES = Object.freeze(['block', 'warn', 'off']);

/** The effective mode: WORCA_MCP_SECRETS, else block with the broker on, else warn. */
export function mcpSecretsMode(env = process.env) {
  const v = String(env.WORCA_MCP_SECRETS || '').trim().toLowerCase();
  if (MCP_SECRET_MODES.includes(v)) return v;
  return typeof env.WORCA_BROKER_URL === 'string' && env.WORCA_BROKER_URL.trim() ? 'block' : 'warn';
}

const literal = (v) => typeof v === 'string' && v.trim() !== '' && !REF_RE.test(v.trim());
/** Bearer ${VAR} and the like: a reference with a fixed scheme word is still a reference. */
const refOnly = (v) => /^(Bearer|Basic|token)\s+\$\{[A-Za-z_][A-Za-z0-9_]*\}$/i.test(String(v).trim());

/** Where one server definition carries a literal secret: ['env LINEAR_API_KEY', 'header Authorization', …]. */
export function mcpSecretFindings(def) {
  const out = [];
  if (!def || typeof def !== 'object') return out;
  for (const [k, v] of Object.entries(def.env || {})) {
    if (literal(v) && (SECRET_NAME_RE.test(k) || TOKEN_SHAPE_RE.test(v))) out.push(`env ${k}`);
  }
  for (const [k, v] of Object.entries(def.headers || {})) {
    if (literal(v) && !refOnly(v) && (SECRET_NAME_RE.test(k) || TOKEN_SHAPE_RE.test(v))) out.push(`header ${k}`);
  }
  if (typeof def.url === 'string') {
    try {
      const u = new URL(def.url);
      if (u.password || u.username) out.push('credentials in the URL');
      for (const [k, v] of u.searchParams) if (QUERY_SECRET_RE.test(k) && literal(v)) out.push(`URL parameter ${k}`);
    } catch { /* not a URL: nothing to find */ }
  }
  for (const a of Array.isArray(def.args) ? def.args : []) {
    if (typeof a === 'string' && TOKEN_SHAPE_RE.test(a)) { out.push('a token in args'); break; }
  }
  return out;
}

/**
 * Screen a run's MCP servers. `block` drops the ones carrying a literal secret.
 * @returns {{servers: Record<string, object>, warnings: string[], dropped: string[]}}
 */
export function screenMcpSecrets(servers, { mode = 'warn' } = {}) {
  if (mode === 'off') return { servers, warnings: [], dropped: [] };
  const kept = {};
  const warnings = [];
  const dropped = [];
  for (const [name, def] of Object.entries(servers || {})) {
    const f = mcpSecretFindings(def);
    if (!f.length) { kept[name] = def; continue; }
    const where = f.join(', ');
    if (mode === 'block') {
      dropped.push(name);
      warnings.push(`MCP server \`${name}\` was left out of this run: it carries a secret (${where}) that its agents could read. ` +
        'Remove the secret from its definition, or set WORCA_MCP_SECRETS=warn to accept that agents can read it.');
    } else {
      kept[name] = def;
      warnings.push(`MCP server \`${name}\` carries a secret (${where}); the run's agents can read it.`);
    }
  }
  return { servers: kept, warnings, dropped };
}
