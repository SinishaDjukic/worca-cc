// src/core/mcp/registry.mjs
// The MCP registry resolver (MCP registry design §5): which registry servers a spawn gets, under
// which names, with which env. The core is pure — every disk, env and platform fact comes in as
// input, like policy/effective.mjs — and resolveRegistry is its IO shell.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCP_ENV_VAR_RE, URL_SAFE_SECRET_RE } from './definitions.mjs';
import { QUERY_SECRET_RE, hasTokenShape } from '../mcp-secrets.mjs';
import { copyName, secretEnvName } from './identity.mjs';
import { collectSets } from './sets.mjs';
import { readMcpStore, testFingerprint } from './store.mjs';
import { loadCatalog } from './catalog.mjs';
import { WIN_CMD_METACHAR_RE, resolveWindowsCommand } from '../win-command.mjs';
import { cachedPolicyFor, cachedPolicyForKey, cachedPolicyHomes } from '../policy/cache.mjs';
import { readWorkspace } from '../workspaces.mjs';
import { projectKey } from '../store.mjs';
import { bridgedModelInfo } from '../config.mjs';
import { isTranslatedApi } from '../model-env.mjs';

const WORCA_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const has = (v) => typeof v === 'string' && v !== '';
const own = (map, key) => (map && Object.hasOwn(map, key) ? map[key] : undefined);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byKeys = (...keys) => (a, b) => { for (const k of keys) { const d = cmp(k(a), k(b)); if (d) return d; } return 0; };
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const URL_PLACEHOLDER = 'mcpsecretref';   // stands in for a secret ref while the URL is re-checked
// A URL inside a longer word (`--db=postgresql://app:pw@db/x`), found as P1's §4.3 screen finds one.
const URL_IN_TEXT_RE = /[A-Za-z][A-Za-z0-9+.-]{0,31}:\/\/\S+/g;

/** A token shape in a finished string, each secret ref taken as a space: no token runs through a ref, and the text on
 *  either side of one was screened on write (the placeholder word would complete one: `xoxr-` + ref). */
const tokenIn = (parts) => hasTokenShape(parts.map((p) => (typeof p === 'string' ? p : ' ')).join(''));

/** §4.3's substring screen on a finished string: a token shape anywhere, a URL with a password, a secret-named query
 *  parameter with a value. On write it screens each value alone, so a credential built across pieces
 *  (`postgresql://` + `deploy:pw@db`, `…?token=` + `abc`) only shows here. A secret ref stands in as URL_PLACEHOLDER,
 *  and only in a string that holds a ref: a value that spells the word is plain text like any other. */
function plainSecret(parts) {
  if (tokenIn(parts)) return true;
  const holdsRef = parts.some((p) => typeof p !== 'string');
  const plain = (v) => v !== '' && !(holdsRef && v.includes(URL_PLACEHOLDER));
  const s = parts.map((p) => (typeof p === 'string' ? p : URL_PLACEHOLDER)).join('');
  return [s, ...s.split(/\s+/), ...(s.match(URL_IN_TEXT_RE) ?? [])].some((piece) => {
    let u;
    try { u = new URL(piece, 'https://base.invalid'); } catch { return false; }
    return plain(u.password) || [...u.searchParams].some(([k, v]) => QUERY_SECRET_RE.test(k) && plain(v));
  });
}

/**
 * One membership as its --mcp-config entry (§5.4), or the first §5.7 reason of rows 6–10 that applies.
 * Shared with Test (§7.3), which expands the entry's `${MCPSECRET_…}` refs from `env` itself.
 * @param {{ entry: object, values?: object, secrets?: object, copy: string, name: string }} m
 *   entry = the CatalogEntry; values = the membership's non-secret values; secrets = its
 *   secrets.json records `{ [key]: { value, updatedAt } }`; copy = the §4.4 copy name (env names);
 *   name = the final name (`--copy`).
 * @param {{ env?: object, platform: string, execPath: string, worcaRoot: string, resolveCommand?: Function }} ctx
 * @returns {{ reason: string } | { server: object, env: Record<string,string>, secretValues: string[], fingerprint: string }}
 */
export function materializeCopy({ entry, values = {}, secrets = {}, copy, name }, { env = {}, platform, execPath, worcaRoot, resolveCommand }) {
  const { def } = entry;
  const stored = (key) => (Object.hasOwn(secrets, key) ? secrets[key] : null);
  for (const f of def.fields) {
    const s = f.secret ? stored(f.key)?.value : null;
    if (s && typeof s === 'object' && !MCP_ENV_VAR_RE.test(String(s.$env))) return { reason: `env-denied:${s.$env}` };
  }
  const val = Object.create(null);
  const secret = Object.create(null);
  for (const f of def.fields) {
    const s = stored(f.key)?.value;
    const v = !f.secret ? (Object.hasOwn(values, f.key) && has(values[f.key]) ? values[f.key] : f.default)
      : typeof s === 'string' ? s : s && typeof s === 'object' ? env[s.$env] : undefined;
    if (has(v)) val[f.key] = v;
    secret[f.key] = f.secret;
  }
  // §4.3: a `$env` secret whose variable is unset or empty is missing even when its field is optional.
  const envRef = (f) => { const s = f.secret ? stored(f.key)?.value : null; return !!s && typeof s === 'object'; };
  const missing = def.fields.find((f) => (f.required || envRef(f)) && !Object.hasOwn(val, f.key));
  if (missing) return { reason: `missing:${missing.key}` };

  // A finished string is a list of parts: text, or { ref } for a secret (its value goes in `out`).
  const out = {};
  const plug = (s) => (entry.source === 'plugin' && s.startsWith('./') ? resolve(entry.dir, s) : s);
  const build = (v, { url = false, literal = (s) => s } = {}) => {
    if (typeof v === 'string') return [literal(v)];
    if (!Object.hasOwn(val, v.field)) return null;          // an optional field with no value: left out
    let mid = url ? encodeURIComponent(val[v.field].toWellFormed()) : val[v.field];   // a lone surrogate would throw
    if (secret[v.field]) { const ref = secretEnvName(copy, v.field); out[ref] = val[v.field]; mid = { ref }; }
    return [v.prefix ?? '', mid, v.suffix ?? ''];
  };
  const text = (parts) => parts.map((p) => (typeof p === 'string' ? p : `\${${p.ref}}`)).join('');
  const unsafe = (parts) => parts.map((p) => (typeof p === 'string' ? p : '\0')).join('').includes('${');
  const pairs = (map) => Object.entries(map ?? {}).map(([k, v]) => [k, build(v)]).filter(([, p]) => p);

  let server;
  if (def.type === 'stdio') {
    const args = (def.args ?? []).map((a) => build(a, { literal: plug })).filter(Boolean);
    const childEnv = pairs(def.env);
    let command = def.command === 'node' ? execPath : plug(def.command);
    // The command and the copy's name land in the launcher's argv, which the CLI expands too (a plugin's dir, or a
    // hand-edited slug or base, can hold `${`).
    if ([...args, ...childEnv.map(([, p]) => p), [command], [name]].some(unsafe)) return { reason: 'unsafe-text' };
    // A credential built across pieces never reaches argv (`ps` shows it to every local user) or the server's env.
    // The args as written: a plugin's resolved dir is Worca's install (or linked) path, no text anyone typed.
    const written = (def.args ?? []).map((a) => build(a)).filter(Boolean);
    if ([...written, ...childEnv.map(([, p]) => p)].some(plainSecret)) return { reason: 'unsafe-text' };
    const argv = args.map(text);
    let winShim = false;
    if (platform === 'win32' && command !== execPath) {
      const found = resolveCommand(command);
      if (!found) return { reason: 'command-not-found' };
      if (found.kind === 'ps1') return { reason: 'win-shim-unsupported' };
      winShim = found.kind === 'shim';
      if (winShim && [found.path, ...argv].some((a) => WIN_CMD_METACHAR_RE.test(a))) return { reason: 'win-cmd-metachar' };
      command = found.path;
    }
    const keys = childEnv.map(([k]) => k);
    server = {
      type: 'stdio', command: execPath,
      args: [join(worcaRoot, 'src', 'core', 'mcp', 'launch.mjs'), '--copy', name,
        ...(keys.length ? ['--env', keys.join(',')] : []), ...(winShim ? ['--win-shim'] : []), '--', command, ...argv],
      ...(keys.length ? { env: Object.fromEntries(childEnv.map(([k, p]) => [`MCPCHILD_${k}`, text(p)])) } : {}),
    };
  } else {
    // A leading field is the base URL (P1: "the field supplies scheme and host"), taken as written like a whole-URL
    // ref; every later value is percent-encoded. The re-checks below run on the result either way.
    const url = typeof def.url === 'string' ? [def.url]
      : Array.isArray(def.url) ? def.url.flatMap((u, i) => build(u, { url: i > 0 }) ?? []) : build(def.url) ?? [];
    const headers = pairs(def.headers);
    if ([url, ...headers.map(([, p]) => p)].some(unsafe)) return { reason: 'unsafe-text' };
    // §4.3 again on each finished string: a header in full, the url for a token shape (its password and query rules
    // are the URL re-check's below: passwordPlain, queryPlain).
    if (tokenIn(url) || headers.some(([, p]) => plainSecret(p))) return { reason: 'unsafe-text' };
    let u = null;
    try { u = new URL(url.map((p) => (typeof p === 'string' ? p : URL_PLACEHOLDER)).join('')); } catch { /* not a URL */ }
    const holdsRef = url.some((p) => typeof p !== 'string');   // else the placeholder word is a value's own text
    const schemeOk = u && (u.protocol === 'https:' || (u.protocol === 'http:' && LOOPBACK_HOSTS.has(u.hostname)));
    const refOutside = holdsRef && !!u && [u.protocol, u.username, u.password, u.host, u.hash].some((s) => s.toLowerCase().includes(URL_PLACEHOLDER));
    const refUnsafe = url.some((p) => typeof p !== 'string' && !URL_SAFE_SECRET_RE.test(out[p.ref]));
    // §4.1: a secret-named query parameter takes only a secret field. The validator cannot see the query of a URL
    // that starts with a field (`<field>://h\v1?token=<field>` parses only once the scheme is known): checked here.
    const queryPlain = !!u && [...u.searchParams].some(([k, v]) => QUERY_SECRET_RE.test(k) && v !== '' && !(holdsRef && v.includes(URL_PLACEHOLDER)));
    // §4.3 refuses a value that parses as a URL with a password, but screens it alone: `deploy:pw@host` spliced behind a
    // `https://` prefix passes that screen (it parses as scheme `deploy:`), so the materialized URL is checked here.
    const passwordPlain = !!u && u.password !== '';
    if (!schemeOk || refOutside || refUnsafe || queryPlain || passwordPlain) return { reason: 'invalid-url' };
    server = { type: def.type, url: text(url), ...(headers.length ? { headers: Object.fromEntries(headers.map(([k, p]) => [k, text(p)])) } : {}) };
  }

  const fpValues = {};
  const fpSecrets = {};
  for (const f of def.fields) {
    if (!f.secret && Object.hasOwn(val, f.key)) fpValues[f.key] = val[f.key];
    if (f.secret && stored(f.key)) fpSecrets[f.key] = stored(f.key).updatedAt ?? null;
  }
  return {
    server, env: out, secretValues: [...new Set(Object.values(out))],
    fingerprint: testFingerprint({ def, code: entry.code ?? null, values: fpValues, secrets: fpSecrets }),
  };
}

/** §5.7 reasons that produce a run warning. `env-denied:` and `missing:` match by prefix:
 *  `PROBLEM_REASONS.has(r) || PROBLEM_REASONS.has(r.slice(0, r.indexOf(':') + 1))`. */
export const PROBLEM_REASONS = new Set(['missing-server', 'plugin-disabled', 'env-denied:', 'missing:', 'unsafe-text',
  'invalid-url', 'command-not-found', 'win-shim-unsupported', 'win-cmd-metachar', 'name-taken', 'untested', 'env-collision', 'cap']);

const WHY = {
  'missing-server': 'the server is no longer installed',
  'plugin-disabled': 'plugin disabled',
  'needs-consent': 'turn it on in the team checklist',
  off: 'off',
  'opted-out': 'opted out for this run',
  'chat-off': 'switched off for this chat',
  'unsafe-text': 'a value would form "${" or a plain-text secret (a token, a URL password, a secret-named query parameter) with the text around it',
  'invalid-url': 'its URL is not https (or loopback http), a secret sits outside its path or query or is not URL-safe (letters, digits, . _ ~ -), or it holds a password or a secret-named query parameter in plain text',
  'command-not-found': 'command not found on PATH',
  'win-shim-unsupported': 'PowerShell scripts are not supported — use the package\'s node entry point',
  'win-cmd-metachar': 'an argument holds a character cmd.exe would interpret (& | < > ^ % " !)',
  'name-taken': 'its name and the name with _w are both taken by other MCP servers',
  untested: 'not tested — run Test so its tool names can be checked for this model',
  'env-collision': 'its secret env name collides with another copy\'s',
  cap: 'over the MCP server limit for one spawn',
  'engine-remote': "a remote server, and this chat's engine attaches local (stdio) servers only",
  'engine-name': "a name this chat's engine cannot use (only letters, digits, _ and -, at most 64 characters)",
  'engine-incomplete': 'no command and no url',
};

/** The reason part of a skip's line (§5.7), e.g. "API token not set": `missing:<key>` reads "<field label> not set". */
export function skipReasonText(skip, catalog) {
  const entry = catalog.find((e) => e.id === skip.serverId);
  const [kind, detail] = [skip.reason.slice(0, skip.reason.indexOf(':') + 1), skip.reason.slice(skip.reason.indexOf(':') + 1)];
  return kind === 'missing:' ? `${entry?.def.fields.find((x) => x.key === detail)?.label ?? detail} not set`
    : kind === 'env-denied:' ? `$env variable ${detail} is not an MCP_* name` : WHY[skip.reason];
}

/** One line for a skipped membership, e.g. "jira in Billing skipped: API token not set" (§5.7). */
export function skipMessage(skip, catalog) {
  const entry = catalog.find((e) => e.id === skip.serverId);
  const label = entry ? entry.base : skip.serverId.slice(skip.serverId.lastIndexOf('/') + 1).replace(/^[a-z]+:/, '');
  return `${label} in ${skip.setName} skipped: ${skipReasonText(skip, catalog)}`;
}

// teamMembers and collectSets (§5.1) live in sets.mjs, shared with the skills resolver (skills registry §4.2).
export { teamMembers } from './sets.mjs';

/**
 * The pure resolver (§5): the registry copies one spawn gets. Input and output exactly as the design's §5
 * signature; every output array sorted, so the same inputs in any array order give byte-identical output.
 */
export function resolveMcpServers({
  surface, targets = [], teams = {}, store, optOut = [], off = { sets: [], members: [] }, env = {},
  platform, execPath, worcaRoot, toolNameLimit = 128, copyCap = surface === 'ask' ? 12 : 24, taken = [],
  mcpTimeoutMs = null, resolveCommand,
}) {
  const ask = surface === 'ask';
  const catalog = new Map(store.catalog.map((e) => [e.id, e]));
  const sets = collectSets({ ask, targets, teams, store });
  const ctx = { env, platform, execPath, worcaRoot, resolveCommand };
  const opted = new Set(ask ? [] : optOut);
  const offSets = new Set(ask ? off?.sets ?? [] : []);
  const offMembers = new Set(ask ? off?.members ?? [] : []);
  const takenNames = new Set([...taken, 'worca']);   // §5.3, §9.2: `worca` is reserved — a hand-edited base never takes it

  const memberships = [];
  for (const set of sets.values()) {
    set.members = set.members.filter((m, i, all) => all.findIndex((x) => x.serverId === m.serverId) === i);
    for (const m of set.members) memberships.push({ set, ...m });
  }
  memberships.sort(byKeys((m) => m.set.id, (m) => m.serverId));

  const skipped = [];
  const skip = (m, copy, reason) => skipped.push({ setId: m.set.id, setName: m.set.name, serverId: m.serverId, copy, reason });
  const candidates = [];
  for (const m of memberships) {
    const entry = catalog.get(m.serverId);
    if (!entry) { skip(m, null, 'missing-server'); continue; }
    const key = `${m.set.id}|${m.serverId}`;
    const copy = copyName(entry.base, m.set.slug);
    const early = entry.pluginEnabled === false ? 'plugin-disabled'
      : m.team && !m.consent ? 'needs-consent'
      : !m.enabled ? 'off'
      : opted.has(key) ? 'opted-out'
      : offSets.has(m.set.id) || offMembers.has(key) ? 'chat-off' : null;
    if (early) { skip(m, copy, early); continue; }
    const name = takenNames.has(copy) ? `${copy}_w` : copy;
    const mat = materializeCopy({ entry, values: m.values, secrets: own(own(store.secrets, m.set.id), m.serverId) ?? {}, copy, name }, ctx);
    if (mat.reason) { skip(m, copy, mat.reason); continue; }
    if (name !== copy && takenNames.has(name)) { skip(m, copy, 'name-taken'); continue; }
    const test = own(store.tests, key);
    const current = !!test && test.ok === true && test.fingerprint === mat.fingerprint;
    candidates.push({ m, entry, copy, name, mat, current, tools: current ? test.tools ?? [] : [] });
  }

  // §5.6 keep order: project sets by best target rank, then Team, then General; inside a group by copy name.
  const keepGroup = (set) => (set.group === 'set' ? 0 : set.group === 'team' ? 1 : 2);
  candidates.sort(byKeys((s) => keepGroup(s.m.set), (s) => (s.m.set.group === 'set' ? s.m.set.rank : 0), (s) => s.copy, (s) => s.m.set.id));
  // A hand-edited slug (`w`, or one another set holds) can give two copies one final name: the copy kept first holds
  // it and the other is name-taken — in keep order, so the holder is the copy the cap would keep, and before untested
  // (§5.7 rows 11, 12).
  const finals = new Set();
  const survivors = candidates.filter((s) => {
    if (finals.has(s.name)) { skip(s.m, s.copy, 'name-taken'); return false; }
    if (toolNameLimit === 64 && !s.current) { skip(s.m, s.copy, 'untested'); return false; }
    finals.add(s.name);
    return true;
  });

  const holders = new Map();
  for (const s of survivors) for (const n of Object.keys(s.mat.env)) holders.set(n, (holders.get(n) ?? 0) + 1);
  const clean = survivors.filter((s) => {   // still in keep order
    const clash = Object.keys(s.mat.env).some((n) => holders.get(n) > 1);
    if (clash) skip(s.m, s.copy, 'env-collision');
    return !clash;
  });
  for (const s of clean.slice(copyCap)) skip(s.m, s.copy, 'cap');
  const started = clean.slice(0, copyCap).sort(byKeys((s) => s.name));

  const disallowedTools = [];
  const skippedTools = [];
  for (const s of started) {
    for (const tool of s.tools) {
      const full = `mcp__${s.name}__${String(tool).replace(/[^A-Za-z0-9_-]/g, '_')}`;
      if (full.length > toolNameLimit) { disallowedTools.push(full); skippedTools.push({ name: s.name, tool, reason: `tool-name-too-long:${tool}` }); }
    }
  }
  const outEnv = Object.assign({}, ...started.map((s) => s.mat.env));
  if (mcpTimeoutMs != null && started.length) {
    const mine = env.MCP_TIMEOUT;
    outEnv.MCP_TIMEOUT = /^\d+$/.test(mine ?? '') && Number(mine) >= 1000 ? mine : String(mcpTimeoutMs);
  }
  const pickerGroup = (set) => (set.group === 'general' ? 0 : set.group === 'set' ? 1 : 2);
  return {
    servers: Object.fromEntries(started.map((s) => [s.name, s.mat.server])),
    env: Object.fromEntries(Object.keys(outEnv).sort().map((k) => [k, outEnv[k]])),
    secretValues: [...new Set(started.flatMap((s) => s.mat.secretValues))].sort(),
    grants: started.map((s) => `mcp__${s.name}`),
    disallowedTools: disallowedTools.sort(),
    copies: started.map((s) => ({
      name: s.name, copy: s.copy, setId: s.m.set.id, setName: s.m.set.name, serverId: s.m.serverId,
      projects: [...s.m.set.projects].sort(), description: s.entry.def.description ?? '',
      renamedFrom: s.name === s.copy ? null : s.copy, provisional: !!(s.entry.provisional || s.m.set.provisional),
      untested: !s.current,
    })),
    skipped: skipped.sort(byKeys((x) => x.setId, (x) => x.serverId)),
    skippedTools: skippedTools.sort(byKeys((x) => x.name, (x) => x.tool)),
    sets: [...sets.values()]
      .sort(byKeys(pickerGroup, (x) => (x.group === 'set' ? x.rank : 0), (x) => x.name, (x) => x.id))
      .map((x) => ({
        id: x.id, name: x.name, group: x.group,
        routes: [...x.routes].sort(byKeys(([, r]) => r.rank, ([p]) => p)).map(([project, r]) => ({ project, route: r.route })),
        members: x.members.length, started: started.filter((s) => s.m.set === x).length,
      })),
  };
}

/** A policy doc's `mcp.required` entries ([] when there are none). */
export function requiredOf(doc) {
  const v = doc?.fields?.['mcp.required']?.value;
  return Array.isArray(v) ? v : [];
}

/** A policy doc's `skills.required` entries `{ plugin, skill }` ([] when there are none; skills registry F8). */
export function requiredSkillsOf(doc) {
  const v = doc?.fields?.['skills.required']?.value;
  return Array.isArray(v) ? v : [];
}

// One cached home's Team set input: `requiredSkills` only when the policy requires a skill, so an MCP-only home reads
// exactly as before; null when it requires neither.
function teamInputOf(home, doc) {
  const required = requiredOf(doc);
  const requiredSkills = requiredSkillsOf(doc);
  if (!required.length && !requiredSkills.length) return null;
  return { home, required, ...(requiredSkills.length ? { requiredSkills } : {}) };
}

/**
 * The Team set input (§11.2) of one Ask / preview target, from the policy cache — never git, never the network
 * (§9.2): a project's policy (its own or the home it follows); a workspace's policy home while it is still a
 * member. null when there is no policy or it requires no MCP server and no skill. `deps` are test seams.
 * @param {{ projectKey?: string, workspaceId?: string }} target
 * @returns {Promise<{ home: string, required: object[], requiredSkills?: object[] } | null>}
 */
export async function cachedTeamFor(target, { policyForKey = cachedPolicyForKey, policyForDir = cachedPolicyFor, readWs = readWorkspace } = {}) {
  let p = null;
  if (target?.projectKey) p = policyForKey(target.projectKey);
  else if (target?.workspaceId) {
    const ws = await readWs(target.workspaceId);
    let homeKey = null;
    try { homeKey = ws?.policyProject ? projectKey(ws.policyProject) : null; } catch { /* unreadable path: no home */ }
    if (homeKey && ws.projectKeys.includes(homeKey)) p = policyForDir(ws.policyProject);
  }
  return p ? teamInputOf(p.home, p.doc) : null;
}

/** Every cached policy home that requires ≥1 MCP server or skill: [{ home, required, requiredSkills?, doc }]. */
export function cachedTeams(homes = cachedPolicyHomes()) {
  return homes.map((h) => { const t = teamInputOf(h.slug, h.doc); return t && { ...t, doc: h.doc }; }).filter(Boolean);
}

/** §5.6: 64 when any of the models is translated by the bridge (OpenAI-style upstreams cap tool names at 64), else 128. */
export function toolNameLimitFor(models) {
  return (models ?? []).some((m) => isTranslatedApi(bridgedModelInfo(m)?.api)) ? 64 : 128;
}

/** This host's facts for materializeCopy / resolveMcpServers: one launcher path and PATH lookup for every spawn
 *  and for Test (§7.3 "exactly as a spawn would"). */
export function hostContext() {
  return { env: process.env, platform: process.platform, execPath: process.execPath, worcaRoot: WORCA_ROOT,
    resolveCommand: (bin) => resolveWindowsCommand(bin, { pathEnv: process.env.PATH ?? '', pathext: process.env.PATHEXT }) };
}

/**
 * The IO shell: the store snapshot, the catalog and this host's facts into resolveMcpServers. `opts` is the §5
 * input minus store, env, platform, execPath, worcaRoot and resolveCommand. A registry file written by a newer
 * Worca resolves nothing (§4.5) and says so with `newer: true`.
 */
export async function resolveRegistry(opts) {
  const snap = await readMcpStore();
  if (snap.newer) {
    return { servers: {}, env: {}, secretValues: [], grants: [], disallowedTools: [], copies: [], skipped: [], skippedTools: [], sets: [], newer: true };
  }
  const catalog = await loadCatalog(snap);
  return resolveMcpServers({
    ...opts,
    store: { catalog, bases: snap.bases, sets: snap.sets, teams: snap.teams, projects: snap.projects, secrets: snap.secrets, tests: snap.tests },
    ...hostContext(),
  });
}
