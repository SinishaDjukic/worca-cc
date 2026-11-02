// src/core/engines/claude-sign-in.mjs
// The Claude Code sign-in kept in the person's own user settings (workflow tests 3b, D71). A Pretend try spawns with
// `--setting-sources project,local`, which drops that file; readUserSignIn reads only the sign-in out of it, so the try is
// still signed in and nothing else of the person's setup (hooks, plugins, permissions, other env) comes along. The key rule
// is the requirements interview's (A1.1 D6), moved here unchanged.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Keys of the user settings' `env` block that sign Claude Code in or route its traffic (A1.1 D6). */
export const SIGN_IN_ENV_KEYS = new Set([
  'CLAUDE_CODE_OAUTH_TOKEN', 'NODE_EXTRA_CA_CERTS', 'CLOUD_ML_REGION', 'GOOGLE_APPLICATION_CREDENTIALS',
  'CLAUDE_CODE_CLIENT_CERT', 'CLAUDE_CODE_CLIENT_KEY',
]);
export const isSignInEnvKey = (k) => SIGN_IN_ENV_KEYS.has(k) || /^https?_proxy$/i.test(k) || k.startsWith('ANTHROPIC_')
  || k.startsWith('CLAUDE_CODE_USE_') || k.startsWith('AWS_');
/** The settings keys that sign in by running a command. */
export const SIGN_IN_SETTINGS_KEYS = Object.freeze(['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport']);

/** The user settings file the CLI reads: `settings.json` in CLAUDE_CONFIG_DIR (trimmed), else in `<home>/.claude`. */
export function userSettingsFile({ env = process.env, home } = {}) {
  const dir = typeof env?.CLAUDE_CONFIG_DIR === 'string' && env.CLAUDE_CONFIG_DIR.trim()
    ? env.CLAUDE_CONFIG_DIR.trim() : join(home ?? homedir(), '.claude');
  return join(dir, 'settings.json');
}

const none = (state) => ({ state, env: {}, settings: {} });

/**
 * The sign-in in the person's user settings, and nothing else. 'none': no file (ENOENT / ENOTDIR), a blank one, not an
 * object, or no sign-in in it. 'unreadable': a file that exists but cannot be read or parsed; nothing is carried from it
 * (the CLI cannot use it either). Env values that are text, numbers or yes/no are kept as text. Never throws.
 * @returns {{state: 'none'|'found'|'unreadable', env: Record<string,string>, settings: Record<string,string>}}
 */
export function readUserSignIn({ env = process.env, home, read = (p) => readFileSync(p, 'utf8') } = {}) {
  try {
    let raw;
    try { raw = String(read(userSettingsFile({ env, home }))); } catch (err) {
      return none(err && (err.code === 'ENOENT' || err.code === 'ENOTDIR') ? 'none' : 'unreadable');
    }
    const text = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
    if (!text.trim()) return none('none');
    let s;
    try { s = JSON.parse(text); } catch { return none('unreadable'); }
    if (!s || typeof s !== 'object' || Array.isArray(s)) return none('none');
    const settings = {};
    for (const k of SIGN_IN_SETTINGS_KEYS) if (typeof s[k] === 'string' && s[k] !== '') settings[k] = s[k];
    const out = {};
    const e = s.env;
    if (e && typeof e === 'object' && !Array.isArray(e)) {
      for (const [k, v] of Object.entries(e)) {
        if (!isSignInEnvKey(k)) continue;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
      }
    }
    return Object.keys(out).length || Object.keys(settings).length ? { state: 'found', env: out, settings } : none('none');
  } catch { return none('none'); }   // homedir() can throw: inside the try
}
