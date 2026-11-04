// The user's own Claude Code settings file, read only to decide whether a spawn may drop it (`--setting-sources project`).
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SIGN_IN_ENV_KEYS = new Set([
  'CLAUDE_CODE_OAUTH_TOKEN', 'NODE_EXTRA_CA_CERTS', 'CLOUD_ML_REGION', 'GOOGLE_APPLICATION_CREDENTIALS',
  'CLAUDE_CODE_CLIENT_CERT', 'CLAUDE_CODE_CLIENT_KEY',
]);
const isSignInEnvKey = (k) => SIGN_IN_ENV_KEYS.has(k) || /^https?_proxy$/i.test(k) || k.startsWith('ANTHROPIC_')
  || k.startsWith('CLAUDE_CODE_USE_') || k.startsWith('AWS_');

/**
 * Whether the user-level Claude Code settings carry sign-in or network configuration (A1.1 D6): a
 * non-empty `apiKeyHelper`, `awsAuthRefresh` or `awsCredentialExport`, or an `env` block with CLAUDE_CODE_OAUTH_TOKEN,
 * CLAUDE_CODE_USE_* (Vertex, Bedrock, Foundry...), AWS_*, CLOUD_ML_REGION, GOOGLE_APPLICATION_CREDENTIALS,
 * CLAUDE_CODE_CLIENT_CERT / _KEY, ANTHROPIC_*, HTTP(S)_PROXY (either case) or NODE_EXTRA_CA_CERTS. Then an interview keeps all setting sources, since
 * `--setting-sources project` would drop that file and the call would not be signed in. The file is the
 * one the CLI reads: `settings.json` in CLAUDE_CONFIG_DIR, else in `<home>/.claude` (as
 * skills-registry/host.mjs). A MISSING file (ENOENT / ENOTDIR), a blank one, or valid JSON that is not an object means false
 * (hermetic); a file that exists but cannot be read or parsed means true (keep user settings, A2's behaviour). Never throws.
 * Not seen: a model profile's modelEnv can set CLAUDE_CONFIG_DIR / HOME for the child, which moves the file the CLI
 * reads; this guard looks at the server's own environment only.
 */
export function userClaudeSignIn({ env = process.env, home, read = (p) => readFileSync(p, 'utf8') } = {}) {
  try {
    const dir = typeof env?.CLAUDE_CONFIG_DIR === 'string' && env.CLAUDE_CONFIG_DIR.trim()
      ? env.CLAUDE_CONFIG_DIR.trim() : join(home ?? homedir(), '.claude');   // homedir() can throw: inside the try
    let raw;
    try { raw = String(read(join(dir, 'settings.json'))); } catch (err) {
      return !(err && (err.code === 'ENOENT' || err.code === 'ENOTDIR'));   // missing: hermetic; unreadable: keep
    }
    const text = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;   // a leading BOM is tolerated
    if (!text.trim()) return false;   // a blank file holds no sign-in: hermetic
    let s;
    try { s = JSON.parse(text); } catch { return true; }
    if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
    for (const key of ['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport']) if (typeof s[key] === 'string' && s[key] !== '') return true;
    const e = s.env;
    return !!e && typeof e === 'object' && !Array.isArray(e) && Object.keys(e).some(isSignInEnvKey);
  } catch { return false; }
}
