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

// ── C1 (security review, 2026-11-04): the sandbox Worca carries is checked against the keys and types Claude Code
// documents (its settings schema, read from 2.1.304). A `--settings` file whose `sandbox` the CLI rejects is dropped WHOLE
// and silently, with Worca's own hooks and deny rules in it, so a layer with an unknown key or a wrong type is never carried.
// The check may be stricter than the CLI (it may refuse what the CLI would take); it never takes what the CLI refuses.
const isBool = (v) => typeof v === 'boolean';
const isStrList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isText = (v) => typeof v === 'string' && v !== '';
const isPort = (v) => Number.isInteger(v) && v >= 0 && v <= 65535;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const isEnvName = (v) => typeof v === 'string' && ENV_NAME_RE.test(v);
const isMachName = (s) => typeof s === 'string' && !(s.endsWith('*') ? s.slice(0, -1) : s).includes('*');
/** A regular expression with at least one capturing group (the CLI's `extract` rule). */
function capturingRegex(src) {
  if (typeof src !== 'string') return false;
  try { return new RegExp(`${new RegExp(src).source}|`).exec('').length - 1 >= 1; } catch { return false; }
}
/** The first key of `o` that `shape` does not name, or whose value fails its check, as a dotted path; null when all pass.
 *  A check is a predicate, a nested shape (a plain object), or a function returning a problem path (`{ problem }`). */
function shapeProblem(o, shape, at) {
  if (!isPlain(o)) return at;
  for (const [k, v] of Object.entries(o)) {
    const here = `${at}.${k}`;
    const check = k !== '__proto__' && Object.hasOwn(shape, k) ? shape[k] : null;
    if (!check) return here;
    const p = typeof check === 'function' ? (check(v) ? null : here)
      : typeof check.problem === 'function' ? check.problem(v, here) : shapeProblem(v, check, here);
    if (p) return p;
  }
  return null;
}
const isCredMode = (v) => v === 'deny' || v === 'mask';
const CRED_COMMON = Object.freeze({ mode: isCredMode, extract: (v) => typeof v === 'string', decode: (v) => v === 'jwt',
  onExtractNoMatch: (v) => v === 'warn' || v === 'deny' || v === 'error', maskClaims: isStrList, injectHosts: isStrList });
const CRED_FILE = Object.freeze({ ...CRED_COMMON, path: isText, maskDuplicates: isBool });
const CRED_ENV = Object.freeze({ ...CRED_COMMON, name: isEnvName });
/** One `credentials.files` (`env` false) or `credentials.envVars` (`env` true) entry, by the CLI's own rules. */
function credentialProblem(e, env, at) {
  const p = shapeProblem(e, env ? CRED_ENV : CRED_FILE, at);
  if (p) return p;
  if (env ? !isEnvName(e.name) : !isText(e.path)) return `${at}.${env ? 'name' : 'path'}`;
  if (!isCredMode(e.mode)) return `${at}.mode`;
  if (e.mode !== 'mask') return null;
  if (!env && e.path.endsWith('/')) return `${at}.path`;   // mask is for one file, never a folder
  if (e.extract !== undefined && !capturingRegex(e.extract)) return `${at}.extract`;
  if (e.maskClaims !== undefined && (!e.maskClaims.length || e.maskClaims.some((c) => !c) || e.decode === undefined)) return `${at}.maskClaims`;
  if (env && e.decode !== undefined && (e.extract !== undefined || e.onExtractNoMatch === 'deny' || e.onExtractNoMatch === 'error')) return `${at}.decode`;
  return null;
}
const listOf = (entry) => ({ problem: (v, at) => {
  if (!Array.isArray(v)) return at;
  for (let i = 0; i < v.length; i++) { const p = entry(v[i], `${at}[${i}]`); if (p) return p; }
  return null;
} });
const AWS_PAIR = Object.freeze({ accessKeyIdVar: isEnvName, secretAccessKeyVar: isEnvName, sessionTokenVar: isEnvName });
const SIGV4_POLICY = (v) => v === 'deny' || v === 'passthrough';
const CREDENTIALS = Object.freeze({
  files: listOf((e, at) => credentialProblem(e, false, at)),
  envVars: listOf((e, at) => credentialProblem(e, true, at)),
  allowPlaintextInject: isBool,
  awsPairs: { problem: (v, at) => {
    const seen = new Set();   // one variable fills one slot, within a pair and across pairs
    return listOf((e, here) => {
      const p = shapeProblem(e, AWS_PAIR, here);
      if (p) return p;
      if (!isEnvName(e.accessKeyIdVar) || !isEnvName(e.secretAccessKeyVar)) return here;
      for (const n of [e.accessKeyIdVar, e.secretAccessKeyVar, e.sessionTokenVar]) {
        if (n === undefined) continue;
        if (seen.has(n)) return here;
        seen.add(n);
      }
      return null;
    }).problem(v, at);
  } },
  sigv4: { streaming: SIGV4_POLICY, presigned: SIGV4_POLICY, sigv4a: SIGV4_POLICY },
});
const SANDBOX_SHAPE = Object.freeze({
  enabled: isBool, failIfUnavailable: isBool, autoAllowBashIfSandboxed: isBool, allowUnsandboxedCommands: isBool,
  network: {
    allowedDomains: isStrList, deniedDomains: isStrList, strictAllowlist: isBool, allowManagedDomainsOnly: isBool, allowUnixSockets: isStrList,
    allowAllUnixSockets: isBool, allowLocalBinding: isBool, allowMachLookup: (v) => Array.isArray(v) && v.every(isMachName),
    httpProxyPort: isPort, socksProxyPort: isPort, tlsTerminate: { caCertPath: isText, caKeyPath: isText },
  },
  filesystem: { allowWrite: isStrList, denyWrite: isStrList, denyRead: isStrList, allowRead: isStrList, allowManagedReadPathsOnly: isBool, disabled: isBool },
  credentials: CREDENTIALS,
  ignoreViolations: (v) => isPlain(v) && Object.entries(v).every(([k, x]) => k !== '__proto__' && isStrList(x)),
  enableWeakerNestedSandbox: isBool, enableWeakerNetworkIsolation: isBool, allowAppleEvents: isBool,
  excludedCommands: isStrList,
  ripgrep: { problem: (v, at) => shapeProblem(v, { command: (x) => typeof x === 'string', args: isStrList }, at) || (typeof v.command === 'string' ? null : at) },
  bwrapPath: (v) => typeof v === 'string', socatPath: (v) => typeof v === 'string',
});

/**
 * C1: the first part of a `sandbox` value Claude Code would reject (or that Worca does not know), as a dotted path such as
 * `sandbox.network.httpProxyPort`; null when the whole value is valid. A value that is not a plain object is `sandbox`.
 */
export function sandboxProblem(sandbox) {
  return shapeProblem(sandbox, SANDBOX_SHAPE, 'sandbox');
}
/** C1: the run warning for a sandbox Worca did not carry. `who`: whose settings, in plain words. */
export const sandboxNotCarried = (who, problem) => `Worca did not carry ${who} sandbox settings: ${problem} is not valid.`;

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
 * C1: every layer is checked (sandboxProblem) before it is laid on, and the result after. A person's sandbox that fails
 * carries no sandbox at all; a project or local one that fails adds nothing; a clash once laid together carries none. Each
 * gives one line in `warnings` (present only when there is one), which the runner turns into a run warning.
 * @returns {{deny: string[], sandbox: object|null, warnings?: string[]}}
 */
export function readUserSafety({ env = process.env, home, read = readCapped, cwd = null } = {}) {
  try {
    const s = settingsObject(userSettingsFile({ env, home }), read);
    if (!s) return noSafety();
    const d = isPlain(s.permissions) && Array.isArray(s.permissions.deny) ? s.permissions.deny : [];
    const deny = [...new Set(d.filter((x) => typeof x === 'string' && x.trim()))].slice(0, SAFETY_DENY_MAX);
    const warnings = [];
    let sandbox = isPlain(s.sandbox) ? s.sandbox : null;
    const bad = sandbox ? sandboxProblem(sandbox) : null;
    if (bad) { warnings.push(sandboxNotCarried('your', bad)); sandbox = null; }
    if (sandbox && typeof cwd === 'string' && cwd) {
      for (const name of ['settings.json', 'settings.local.json']) {
        const p = settingsObject(join(cwd, '.claude', name), read);
        if (!p || !isPlain(p.sandbox)) continue;
        const pBad = sandboxProblem(p.sandbox);
        if (pBad) { warnings.push(sandboxNotCarried(`the project's .claude/${name}`, pBad)); continue; }
        sandbox = layerSandbox(sandbox, p.sandbox);
      }
      const clash = sandboxProblem(sandbox);
      if (clash) { warnings.push(sandboxNotCarried('your', `${clash} (with the project's laid over it)`)); sandbox = null; }
    }
    return { deny, sandbox, ...(warnings.length ? { warnings } : {}) };
  } catch { return noSafety(); }
}
