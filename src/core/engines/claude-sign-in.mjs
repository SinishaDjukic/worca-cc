// src/core/engines/claude-sign-in.mjs
// The Claude Code sign-in kept in the person's own user settings (workflow tests 3b, D71). A Pretend try spawns with
// `--setting-sources project` (or `project,local`, D70a), which drops that file; readUserSignIn reads only the sign-in out of it, so the try is
// still signed in and nothing else of the person's setup (hooks, plugins, permissions, other env) comes along. The key rule
// is the requirements interview's (A1.1 D6), moved here unchanged.
import { readFileSync, statSync } from 'node:fs';
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

/** D81: at most this many of the person's own deny rules are carried. */
export const SAFETY_DENY_MAX = 500;
/** D81a: a settings file larger than this (bytes) is not read; it adds nothing. */
export const SETTINGS_FILE_MAX = 1024 * 1024;
const noSafety = () => ({ deny: [], sandbox: null });
const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const readCapped = (p) => {
  if (statSync(p).size > SETTINGS_FILE_MAX) throw Object.assign(new Error('settings file too large'), { code: 'EFBIG' });
  return readFileSync(p, 'utf8');
};
/** A settings file as an object (a leading BOM read), or null: no file, unreadable, too large, not JSON, not an object. Never throws. */
function settingsObject(file, read) {
  try {
    const raw = String(read(file));
    if (raw.length > SETTINGS_FILE_MAX) return null;
    const s = JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw);
    return isPlain(s) ? s : null;
  } catch { return null; }
}

/**
 * D81a: `over` laid on `base` by Claude Code's settings merge: scalars from `over`; lists joined, deduplicated, `base`'s
 * entries first; plain objects merged by the same rules.
 */
export function layerSandbox(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (k === '__proto__') continue;
    const b = Object.hasOwn(out, k) ? out[k] : undefined;
    out[k] = Array.isArray(b) && Array.isArray(v) ? [...new Set([...b, ...v])] : isPlain(b) && isPlain(v) ? layerSandbox(b, v) : v;
  }
  return out;
}

/**
 * Workflow tests 3b (D81): the person's own guards in their user settings: `permissions.deny` (non-empty strings,
 * deduplicated, at most SAFETY_DENY_MAX) and `sandbox` (a plain object). Never their allow or ask rules. Nothing from a file
 * Worca cannot read or parse. Never throws.
 * Deny rules merge across scopes, so they only ever add blocks. The sandbox does not: carried on the command line it would
 * outrank the project's, so (D81a) the try checkout's (`cwd`) `.claude/settings.json` and then `.claude/settings.local.json`
 * sandbox are laid over the person's (layerSandbox), keeping Claude Code's own order (local > project > user). A project or
 * local file that cannot be read or parsed adds nothing. No sandbox of the person's: none (the project's loads by itself).
 * @returns {{deny: string[], sandbox: object|null}}
 */
export function readUserSafety({ env = process.env, home, read = readCapped, cwd = null } = {}) {
  try {
    const s = settingsObject(userSettingsFile({ env, home }), read);
    if (!s) return noSafety();
    const d = isPlain(s.permissions) && Array.isArray(s.permissions.deny) ? s.permissions.deny : [];
    const deny = [...new Set(d.filter((x) => typeof x === 'string' && x.trim()))].slice(0, SAFETY_DENY_MAX);
    let sandbox = isPlain(s.sandbox) ? s.sandbox : null;
    if (sandbox && typeof cwd === 'string' && cwd) {
      for (const name of ['settings.json', 'settings.local.json']) {
        const p = settingsObject(join(cwd, '.claude', name), read);
        if (p && isPlain(p.sandbox)) sandbox = layerSandbox(sandbox, p.sandbox);
      }
    }
    return { deny, sandbox };
  } catch { return noSafety(); }
}
