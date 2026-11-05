// src/core/engines/claude-sign-in.mjs
// The Claude Code sign-in kept in the person's own user settings (workflow tests 3b, D71). A Pretend try spawns with
// `--setting-sources project` (or `project,local`, D70a), which drops that file; readUserSignIn reads only the sign-in out of it, so the try is
// still signed in and nothing else of the person's setup (hooks, plugins, permissions, other env) comes along. The key rule
// is the requirements interview's (A1.1 D6), moved here unchanged.
import { lstatSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, posix } from 'node:path';

/** Keys of the user settings' `env` block that sign Claude Code in or route its traffic (A1.1 D6). */
export const SIGN_IN_ENV_KEYS = new Set([
  'CLAUDE_CODE_OAUTH_TOKEN', 'NODE_EXTRA_CA_CERTS', 'CLOUD_ML_REGION', 'GOOGLE_APPLICATION_CREDENTIALS',
  'CLAUDE_CODE_CLIENT_CERT', 'CLAUDE_CODE_CLIENT_KEY',
]);
export const isSignInEnvKey = (k) => SIGN_IN_ENV_KEYS.has(k) || /^https?_proxy$/i.test(k) || k.startsWith('ANTHROPIC_')
  || k.startsWith('CLAUDE_CODE_USE_') || k.startsWith('AWS_');
/** The settings keys that sign in by running a command. */
export const SIGN_IN_SETTINGS_KEYS = Object.freeze(['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport']);

/** The user settings file the CLI reads: `settings.json` in CLAUDE_CONFIG_DIR (trimmed), else in `<home>/.claude`. Task 5
 *  (security review M10): null for a relative CLAUDE_CONFIG_DIR. The CLI resolves it against the spawn's working directory
 *  (the checkout), not Worca's, so Worca would read another file than the CLI; nothing is carried then. */
export function userSettingsFile({ env = process.env, home } = {}) {
  const set = typeof env?.CLAUDE_CONFIG_DIR === 'string' && env.CLAUDE_CONFIG_DIR.trim() ? env.CLAUDE_CONFIG_DIR.trim() : null;
  if (set !== null && !isAbsolute(set)) return null;
  return join(set ?? join(home ?? homedir(), '.claude'), 'settings.json');
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
    const file = userSettingsFile({ env, home });
    if (!file) return none('none');
    let raw;
    try { raw = String(read(file)); } catch (err) {
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
  allowNestedUserNamespaces: isBool,   // 2.1.318 (D81b's schema read)
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

// ── I1 (security review, 2026-11-04): a deny rule whose path starts with a single `/` is anchored at the folder of the
// settings file it sits in (probe P5). Moved into Worca's --settings file it would be anchored at the staging folder, so it
// is rewritten to the absolute `//` form of the person's config folder. Claude Code matches Windows paths in their POSIX
// form (C:\Users\a is /c/Users/a). `~/` and `//` rules, relative ones and rules without a path keep their meaning anywhere.
const PATH_RULE_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'NotebookRead', 'Glob', 'Grep', 'LS']);
const BACKSLASH = String.fromCharCode(92);
/** `dir` as the CLI's absolute POSIX path (`/c/Users/a` for `C:\Users\a`) without a trailing `/`; null for a UNC or relative folder. */
function posixDir(dir) {
  const f = String(dir).split(BACKSLASH).join('/');
  if (f.startsWith('//')) return null;   // a network share: no `//` form names it
  const m = /^([A-Za-z]):(\/.*)?$/.exec(f);
  const p = m ? `/${m[1].toLowerCase()}${m[2] || '/'}` : f;
  return p.startsWith('/') ? p.replace(/\/+$/, '') : null;
}
/** I1: `rule` with a `/…` path (a file-tool rule) anchored at `configDir` in the `//` form; every other rule as it is. */
export function anchoredDenyRule(rule, configDir) {
  const m = /^([A-Za-z][A-Za-z0-9_]*)\(([\s\S]*)\)$/.exec(String(rule));
  if (!m || !PATH_RULE_TOOLS.has(m[1]) || !m[2].startsWith('/') || m[2].startsWith('//')) return rule;
  const dir = posixDir(configDir);
  return dir === null ? rule : `${m[1]}(/${dir}${m[2]})`;
}

// ── D81b (2026-11-05): Worca's --settings file is a flag-tier source the CLI trusts fully, so a project or local layer laid
// into it never carries what Claude Code takes only from the user, managed (policy) or --settings tiers: a normal run ignores
// those keys in a project's settings. Source: the sandbox settings schema of Claude Code 2.1.318 (its descriptions: "Only
// honored from user, managed/policy, or CLI (--settings) settings — project settings (.claude/settings.json and
// .claude/settings.local.json) are ignored", "Only honored from admin-controlled managed settings", "set in managed settings").
export const PROJECT_IGNORED_SANDBOX_KEYS = Object.freeze(['network.strictAllowlist', 'network.tlsTerminate', 'network.allowManagedDomainsOnly',
  'filesystem.disabled', 'filesystem.allowManagedReadPathsOnly', 'credentials.allowPlaintextInject', 'credentials.awsPairs', 'credentials.sigv4',
  'allowAppleEvents', 'ripgrep', 'bwrapPath', 'socatPath']);
/** D81b: keys whose `true` a normal run ignores in a project's settings, while a project `false` still applies ("true from
 *  project settings … is ignored (false there still applies)"): only a project's true is left out, so its false holds. */
export const PROJECT_TRUE_IGNORED_SANDBOX_KEYS = Object.freeze(['allowUnsandboxedCommands', 'allowNestedUserNamespaces']);
/** D81b: while user (or managed, or --settings) settings set network.strictAllowlist, the CLI leaves these out of a
 *  project's settings ("values from project settings are ignored"; for allowedDomains in strictAllowlist's own text, for the
 *  proxy ports in their `$_` rule). Review m1: not excludedCommands, whose rule (`Nt`) does not name strictAllowlist. */
export const STRICT_ALLOWLIST_IGNORED_SANDBOX_KEYS = Object.freeze(['network.allowedDomains', 'network.httpProxyPort', 'network.socksProxyPort']);
// Task 5 fix review (concern 1, m2): Worca's OWN --settings rules (never the person's carried ones) switch on some of the CLI's
// project filters in a normal run too: "When managed settings or a --settings file set … a Read(…) deny rule …" (its `W_` and
// `B_` rules: a project allowRead that re-opens a denied path, or an allowWrite under one, or either as a glob or a network
// path, is ignored), and "… a WebFetch(domain:…) deny rule …" (`$_`: the project's proxy ports are ignored). The guardrail
// presets' Read(…) denies are in every normal run's --settings. Laid into Worca's file, those project values would skip that
// filter, so they are left to the CLI, which still reads them from the project file under its own filter: nothing is lost.
/** Worca's own deny rules: whether one is a Read(…) rule, and whether one is a WebFetch(domain:…) rule. */
function ownTriggers(ownDeny) {
  const rules = (Array.isArray(ownDeny) ? ownDeny : []).filter((r) => typeof r === 'string').map((r) => r.trim());
  return { readDeny: rules.some((r) => /^Read\((?!\))[\s\S]*\)$/.test(r)), domainDeny: rules.some((r) => /^WebFetch\(domain:[\s\S]+\)$/.test(r)) };
}
/** Concern 1: the project sandbox keys the CLI filters by Worca's own rules (ownTriggers), left out of the lay-in unsaid. */
const ownFilteredKeys = (own) => [...(own.readDeny ? ['filesystem.allowRead', 'filesystem.allowWrite'] : []),
  ...(own.domainDeny ? ['network.httpProxyPort', 'network.socksProxyPort'] : [])];
/** A project layer without the keys the CLI would not take from it, and its `true` for PROJECT_TRUE_IGNORED_SANDBOX_KEYS
 *  ("a false in managed, --settings or user settings holds whatever project settings say (false there still applies)").
 *  `own`: the keys the CLI reads from the project file itself under a filter Worca's own rules switch on (concern 1). */
function projectLayer(sb, { strict, own = [] }) {
  const drop = new Set([...PROJECT_IGNORED_SANDBOX_KEYS, ...(strict ? STRICT_ALLOWLIST_IGNORED_SANDBOX_KEYS : [])]);
  const left = new Set(own);
  const dropped = [];
  const walk = (o, prefix) => {
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      if (k === '__proto__') continue;
      const path = prefix ? `${prefix}.${k}` : k;
      if (drop.has(path) || (PROJECT_TRUE_IGNORED_SANDBOX_KEYS.includes(path) && v === true)) { dropped.push(`sandbox.${path}`); continue; }
      if (left.has(path)) continue;
      if (isPlain(v) && [...drop, ...left].some((d) => d.startsWith(`${path}.`))) {
        const sub = walk(v, path);
        if (Object.keys(sub).length || !Object.keys(v).length) out[k] = sub;   // emptied by the drop: left out
        continue;
      }
      out[k] = v;
    }
    return out;
  };
  return { sandbox: walk(sb, ''), dropped };
}

// D81b: sandbox paths the CLI resolves against the root of the settings file they sit in (its schema: "absolute, ~ expanded,
// or relative to the settings file root (project root for project settings, ~/.claude for user settings)"). In Worca's
// --settings file a relative one would resolve against the staging folder, so it is written out against its own root.
// ignoreViolations and network.allowUnixSockets paths have no documented resolution: a relative one is left out.
const SANDBOX_FS_PATH_KEYS = Object.freeze(['allowWrite', 'denyWrite', 'denyRead', 'allowRead']);
const fwdSlashes = (p) => (process.platform === 'win32' ? String(p).split(BACKSLASH).join('/') : String(p));
const isRelativeSandboxPath = (v) => {
  const t = v.trim();
  return !(t === '~' || /^~[\\/]/.test(t) || t.startsWith('//') || isAbsolute(t)
    || (process.platform === 'win32' && /^%(?:USERPROFILE|APPDATA|LOCALAPPDATA)%/i.test(t)));
};
/** `sb` with its relative paths written against `root` (null: cannot be placed), and the entries left out. */
function placeSandboxPaths(sb, root) {
  const base = root ? fwdSlashes(root) : null;
  const placeable = !!base && !base.startsWith('//');
  const place = (v) => posix.join(base, fwdSlashes(v.trim()));
  const dropped = [];
  const keep = (list, at) => list.filter((v, i) => {
    const out = typeof v === 'string' && isRelativeSandboxPath(v);
    if (out) dropped.push(`${at}[${i}]`);
    return !out;
  });
  const fix = (list, at) => (placeable ? list.map((v) => (typeof v === 'string' && isRelativeSandboxPath(v) ? place(v) : v)) : keep(list, at));
  const out = { ...sb };
  if (isPlain(out.filesystem)) {
    const f = { ...out.filesystem };
    for (const k of SANDBOX_FS_PATH_KEYS) if (Array.isArray(f[k])) f[k] = fix(f[k], `sandbox.filesystem.${k}`);
    out.filesystem = f;
  }
  if (isPlain(out.credentials) && Array.isArray(out.credentials.files)) {
    const files = [];
    out.credentials.files.forEach((e, i) => {
      if (!isPlain(e) || typeof e.path !== 'string' || !isRelativeSandboxPath(e.path)) files.push(e);
      else if (placeable) files.push({ ...e, path: place(e.path) });
      else dropped.push(`sandbox.credentials.files[${i}]`);
    });
    out.credentials = { ...out.credentials, files };
  }
  if (isPlain(out.ignoreViolations)) {
    const iv = {};
    for (const [pat, list] of Object.entries(out.ignoreViolations)) {
      if (pat !== '__proto__') iv[pat] = Array.isArray(list) ? keep(list, `sandbox.ignoreViolations.${pat}`) : list;
    }
    out.ignoreViolations = iv;
  }
  if (isPlain(out.network) && Array.isArray(out.network.allowUnixSockets)) {
    out.network = { ...out.network, allowUnixSockets: keep(out.network.allowUnixSockets, 'sandbox.network.allowUnixSockets') };
  }
  return { sandbox: out, dropped };
}
/** D81b: the run-log line for what a layer left out, or null. */
function leftOutNote(who, keys, paths) {
  const parts = [];
  if (keys.length) parts.push(`Worca did not carry these sandbox settings from ${who}: ${keys.join(', ')}. Claude Code takes them only from your own, managed or command-line settings.`);
  if (paths.length) parts.push(`Worca did not carry these sandbox paths from ${who}, as it could not tell what they point at once moved: ${paths.join(', ')}.`);
  return parts.length ? parts.join(' ') : null;
}
/** M7: a plain file in the checkout's own `.claude` folder (never through a link: `.claude` or the file being one). */
function checkoutSettingsFile(cwd, name) {
  try {
    if (!lstatSync(join(cwd, '.claude')).isDirectory()) return null;   // a symlink or junction is not a directory to lstat
    const p = join(cwd, '.claude', name);
    return lstatSync(p).isFile() ? p : null;
  } catch { return null; }
}

/**
 * Workflow tests 3b (D81): the person's own guards in their user settings: `permissions.deny` (non-empty strings,
 * deduplicated, at most SAFETY_DENY_MAX) and `sandbox` (a plain object). Never their allow or ask rules. Nothing from a file
 * Worca cannot read or parse. Never throws.
 * Deny rules merge across scopes, so they only ever add blocks. I1: a rule anchored at the settings folder (`/…`) is written
 * against the person's config folder (anchoredDenyRule). The sandbox does not merge: carried on the command line it would
 * outrank the project's, so (D81a) the try checkout's (`cwd`) `.claude/settings.json` and then `.claude/settings.local.json`
 * sandbox are laid over the person's (layerSandbox), keeping Claude Code's own order (local > project > user). A project or
 * local file that cannot be read or parsed adds nothing. No sandbox of the person's: none (the project's loads by itself).
 * M7: a checkout file is read only when its source is one of the spawn's `sources` (default both), and never through a link.
 * C1: every layer is checked (sandboxProblem) before it is laid on, and the result after. A person's sandbox that fails
 * carries no sandbox at all; a project or local one that fails adds nothing; a clash once laid together carries none. Each
 * gives one line in `warnings` (present only when there is one), which the runner turns into a run warning.
 * D81b: a project or local layer leaves out what the CLI takes only from the user, managed or flag tiers
 * (PROJECT_IGNORED_SANDBOX_KEYS, its `allowUnsandboxedCommands: true`, and with the person's network.strictAllowlist on
 * STRICT_ALLOWLIST_IGNORED_SANDBOX_KEYS); relative sandbox paths are written against their own root (the config folder, the
 * checkout), and those with no known root are left out. Each layer that leaves something out gives one line in `notes`.
 * M11: `userLoaded: false` (the run itself loads no user settings) carries `autoAllowBashIfSandboxed: false` under the
 * project's layers: the person's sandbox must not auto-approve Bash a normal project-only run would ask about.
 * Concern 1 (Task 5 fix review): `ownDeny` are Worca's own deny rules in the same --settings file (never the person's). A
 * Read(…) one leaves the project's filesystem.allowRead and allowWrite out of the lay-in, a WebFetch(domain:…) one its proxy
 * ports: a normal run's CLI filters those project values by the same rules, and still reads them from the project file.
 * @returns {{deny: string[], sandbox: object|null, warnings?: string[], notes?: string[]}}
 */
export function readUserSafety({ env = process.env, home, read = readCapped, cwd = null, sources = ['project', 'local'], userLoaded = true, ownDeny = [] } = {}) {
  try {
    const file = userSettingsFile({ env, home });
    if (!file) return noSafety();
    const s = settingsObject(file, read);
    if (!s) return noSafety();
    const configDir = dirname(file);
    const d = isPlain(s.permissions) && Array.isArray(s.permissions.deny) ? s.permissions.deny : [];
    const deny = [...new Set(d.filter((x) => typeof x === 'string' && x.trim()).map((r) => anchoredDenyRule(r, configDir)))].slice(0, SAFETY_DENY_MAX);
    const warnings = [];
    const notes = [];
    let sandbox = isPlain(s.sandbox) ? s.sandbox : null;
    const bad = sandbox ? sandboxProblem(sandbox) : null;
    if (bad) { warnings.push(sandboxNotCarried('your', bad)); sandbox = null; }
    if (sandbox) {
      const placed = placeSandboxPaths(sandbox, configDir);
      sandbox = placed.sandbox;
      const n = leftOutNote('your Claude Code settings', [], placed.dropped);
      if (n) notes.push(n);
      if (userLoaded === false) sandbox = { ...sandbox, autoAllowBashIfSandboxed: false };
    }
    if (sandbox && typeof cwd === 'string' && cwd) {
      const strict = isPlain(sandbox.network) && sandbox.network.strictAllowlist === true;
      const list = Array.isArray(sources) ? sources : [];
      for (const [name, source] of [['settings.json', 'project'], ['settings.local.json', 'local']]) {
        if (!list.includes(source)) continue;
        const f = checkoutSettingsFile(cwd, name);
        const p = f ? settingsObject(f, read) : null;
        if (!p || !isPlain(p.sandbox)) continue;
        const pBad = sandboxProblem(p.sandbox);
        if (pBad) { warnings.push(sandboxNotCarried(`the project's .claude/${name}`, pBad)); continue; }
        const layer = projectLayer(p.sandbox, { strict, own: ownFilteredKeys(ownTriggers(ownDeny)) });
        const placed = placeSandboxPaths(layer.sandbox, cwd);
        const n = leftOutNote(`the project's .claude/${name}`, layer.dropped, placed.dropped);
        if (n) notes.push(n);
        sandbox = layerSandbox(sandbox, placed.sandbox);
      }
      const clash = sandboxProblem(sandbox);
      if (clash) { warnings.push(sandboxNotCarried('your', `${clash} (with the project's laid over it)`)); sandbox = null; }
    }
    return { deny, sandbox, ...(warnings.length ? { warnings } : {}), ...(notes.length ? { notes } : {}) };
  } catch { return noSafety(); }
}
