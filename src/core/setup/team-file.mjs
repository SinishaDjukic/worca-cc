// src/core/setup/team-file.mjs
// The team setup (plans/setup-assistant-design.md D12, D16, D17): a team policy document limited to the Setup group
// and the spend limits. One reader for the standalone file (~/.worca-cc/team-setup.json, WORCA_TEAM_SETUP,
// `worca setup --from`) and the policy homes. A document that carries a network, provider, key, token or password
// field is REFUSED with that field named, never cleaned: the sender has to see what they almost shared (AC-5.5).
// A leaf for the CLI and detect: it never imports the SQLite policy cache; the server injects the homes (T14).
import { createHash } from 'node:crypto';
import { openSync, fstatSync, readSync, closeSync, constants as fsConstants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { normalizePolicyDoc, looksLikeSecret, POLICY_SCHEMA, FIELDS } from '../policy/registry.mjs';
import { settingsFile } from '../settings.mjs';
import { mapUpstreamModel, shareUpstream, MODEL_ROLES } from '../model-roles.mjs';

export const TEAM_SETUP_FILE = 'team-setup.json';
export const TEAM_SETUP_MAX_BYTES = 64 * 1024;
/** The fields a team setup may carry (D12, D14): the Setup group, the spend limits and the built-ins switch. */
export const TEAM_SETUP_KEYS = Object.freeze([
  ...FIELDS.filter((f) => f.group === 'setup').map((f) => f.key),
  'cost.pipelineLimitUsd', 'cost.totalLimitUsd', 'cost.resetPeriod', 'models.hideBuiltins',
]);
const DOC_KEYS = new Set(['schema', 'title', 'notes', 'updatedAt', 'updatedBy', 'fields']);
// policy key → apply body field (src/core/setup/apply.mjs SETUP_GROUPS.work); models.roles is mapped separately.
const WORK_OF = Object.freeze({
  'setup.uiLevel': 'uiLevel', 'setup.autoPrDescription': 'autoGeneratePrDescription', 'setup.smartNaming': 'smartNaming',
  'setup.runEngine': 'runEngine', 'setup.sync': 'sync', 'setup.networkWait': 'networkWait',
  'cost.pipelineLimitUsd': 'pipelineCostLimitUsd', 'cost.totalLimitUsd': 'totalCostLimitUsd', 'cost.resetPeriod': 'costLimitResetPeriod',
  'models.hideBuiltins': 'hideBuiltinModels',
});
/** The settings.json keys Share may read (T14): never networkProxy, providers or a login. */
export const SHARE_SETTING_KEYS = Object.freeze(['modelRoles', ...Object.values(WORK_OF)]);
const TAG_KEYS = new Set(['runs.tagDimensions', 'runs.enforceTags']);
const MAX_DEPTH = 16;
const NAME_MAX = 60;

// One rule per class D12 never carries. A key is split into lowercase words on ".", "_", "-" and camelCase
// ("githubToken" → github, token; "network.proxy" → network, proxy) and each word, plus the joined key, is matched
// WHOLE, so "keyboardLayout", "tokenizer" or "passthrough" pass (they are then dropped as non-setup keys).
const FORBIDDEN = [
  [new Set(['network', 'networkproxy', 'proxy', 'upstream', 'noproxy', 'fixedport', 'httpproxy', 'httpsproxy', 'login', 'proxylogin']), 'network settings'],
  [new Set(['provider', 'providers', 'copilot', 'openai', 'anthropic', 'openrouter', 'baseurl', 'accounttype', 'endpoint']), 'model provider settings'],
  [new Set(['key', 'apikey', 'private', 'privatekey']), 'keys'],
  [new Set(['token', 'tokens', 'githubtoken', 'oauth']), 'tokens'],
  [new Set(['password', 'passwd', 'pass', 'secret', 'secrets', 'credential', 'credentials', 'authorization', 'cookie', 'cookies', 'bearer', 'session', 'cert', 'certs', 'certificate']), 'passwords'],
];
const wordsOf = (k) => String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[\s._-]+/).filter(Boolean);
function forbiddenClass(k) {
  const words = wordsOf(k); const joined = words.join('');
  for (const [set, what] of FORBIDDEN) if (set.has(joined) || words.some((w) => set.has(w))) return what;
  return null;
}
// What an error may echo: a key that looks like a secret is masked, a long path is cut (security-1-5).
const shownSeg = (k) => (looksLikeSecret(k) ? '(a name that looks like a key)' : k);
const shownPath = (p) => (p.length > NAME_MAX ? `${p.slice(0, NAME_MAX)}…` : p);
// A registry warning quotes inner names ('unknown field "x"', 'harness "x"'): mask a secret-looking one, cut the rest.
const WARN_MAX = 200;
const safeWarning = (w) => {
  const s = String(w).replace(/"([^"]*)"/g, (m, name) => (looksLikeSecret(name) ? '"(a name that looks like a key)"' : m));
  return s.length > WARN_MAX ? `${s.slice(0, WARN_MAX)}…` : s;
};
const refusal = (field, what) => { const f = shownPath(field); return { ok: false, field: f, error: `A team setup never carries ${what}: “${f}”. Remove it and try again.` }; };
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function scan(value, path, depth = 0) {
  if (depth > MAX_DEPTH) { const f = shownPath(path); return { ok: false, field: f, error: `A team setup is nested too deeply at “${f}”.` }; }
  if (typeof value === 'string') return looksLikeSecret(value) ? refusal(path, 'keys or tokens') : null;
  if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) { const r = scan(value[i], `${path}[${i}]`, depth + 1); if (r) return r; } return null; }
  if (!isObj(value)) return null;
  for (const k of Object.keys(value)) {
    const at = path ? `${path}.${shownSeg(k)}` : shownSeg(k);
    // A registry field key under `fields` is a known name ("setup.networkWait" holds "network" as a word); its
    // value is still scanned below.
    const what = path === 'fields' && TEAM_SETUP_KEYS.includes(k) ? null : forbiddenClass(k);
    if (what) return refusal(at, what);
    const r = scan(value[k], at, depth + 1); if (r) return r;
  }
  return null;
}

/**
 * Validate a parsed team setup document. Refusals first (the whole document), then the allowlist and the registry
 * (one warning per dropped field, the rest applies, AC-5.1).
 * @returns {{ok:true, doc:object, warnings:string[]}|{ok:false, field:string, error:string}}
 */
export function checkTeamSetup(raw) {
  if (!isObj(raw)) return { ok: false, field: null, error: 'A team setup is one JSON object.' };
  const refused = scan(raw, '');
  if (refused) return refused;
  const warnings = [];
  for (const k of Object.keys(raw)) if (!DOC_KEYS.has(k)) warnings.push(`${shownPath(shownSeg(k))}: a team setup file cannot carry it — dropped`);
  const fields = {};
  for (const [k, v] of Object.entries(isObj(raw.fields) ? raw.fields : {})) {
    if (TEAM_SETUP_KEYS.includes(k)) fields[k] = v;
    else if (TAG_KEYS.has(k)) warnings.push(`${k}: tags come from the project's team policy, not a team setup file — dropped`);
    else warnings.push(`${shownPath(shownSeg(k))}: not a team setup field — dropped`);
  }
  const norm = normalizePolicyDoc({ schema: raw.schema ?? POLICY_SCHEMA, title: raw.title, notes: raw.notes, fields });
  return { ok: true, doc: { schema: POLICY_SCHEMA, title: norm.doc.title ?? null, notes: norm.doc.notes ?? null, fields: norm.doc.fields }, warnings: [...warnings, ...norm.warnings.map(safeWarning)] };
}

/** Where the file is looked for (T12). A URL is refused: this version reads files only. */
export function teamSetupPath({ env = process.env } = {}) {
  const v = typeof env.WORCA_TEAM_SETUP === 'string' ? env.WORCA_TEAM_SETUP.trim() : '';
  if (/^https?:\/\//i.test(v)) return { path: null, source: 'env', error: 'Worca reads a team setup from a file on this machine.' };
  if (v) return { path: resolve(v.replace(/^~(?=$|[\\/])/, homedir())), source: 'env' };
  return { path: join(dirname(settingsFile()), TEAM_SETUP_FILE), source: 'home' };
}

/**
 * Read and check one file. `path` overrides the lookup (`worca setup --from`). Never throws. One open: fstat on
 * the open descriptor (no stat/read race), then at most 64 KiB + 1 bytes are read, so a file that grows or a
 * device never hangs or floods the reader. O_NONBLOCK keeps a FIFO from blocking the open.
 */
export function readTeamSetupFile({ env = process.env, path = null } = {}) {
  const at = path ? { path: resolve(path), source: 'cli' } : teamSetupPath({ env });
  if (at.error) return { found: true, ok: false, path: null, source: at.source, field: 'WORCA_TEAM_SETUP', error: at.error };
  const base = { found: true, path: at.path, source: at.source };
  let fd;
  // O_NONBLOCK is undefined on Windows (no FIFOs there): `?? 0` keeps a plain read-only open.
  try { fd = openSync(at.path, fsConstants.O_RDONLY | (fsConstants.O_NONBLOCK ?? 0)); } catch (e) {
    if (e?.code === 'ENOENT') return { found: false, path: at.path, source: at.source };
    if (e?.code === 'EISDIR') return { ...base, ok: false, field: null, error: 'The team setup path is not a file.' };
    return { ...base, ok: false, field: null, error: 'Worca could not open the team setup file.' };
  }
  let text;
  try {
    if (!fstatSync(fd).isFile()) return { ...base, ok: false, field: null, error: 'The team setup path is not a file.' };
    const buf = Buffer.alloc(TEAM_SETUP_MAX_BYTES + 1);
    let n = 0; let r;
    while (n < buf.length && (r = readSync(fd, buf, n, buf.length - n, null)) > 0) n += r;
    if (n > TEAM_SETUP_MAX_BYTES) return { ...base, ok: false, field: null, error: 'The team setup file is larger than 64 KB.' };
    text = buf.subarray(0, n).toString('utf8');
  } catch { return { ...base, ok: false, field: null, error: 'Worca could not read the team setup file.' }; }
  finally { closeSync(fd); }
  let raw; try { raw = JSON.parse(text); } catch { return { ...base, ok: false, field: null, error: 'The team setup file is not valid JSON.' }; }
  try { return { ...base, ...checkTeamSetup(raw) }; }
  catch { return { ...base, ok: false, field: null, error: 'Worca could not check the team setup file.' }; }
}

const stable = (v) => (Array.isArray(v) ? v.map(stable) : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v);
/** T16: changes when, and only when, a team setup field changes. */
export function teamSetupHash(fields = {}) {
  const picked = Object.fromEntries(TEAM_SETUP_KEYS.filter((k) => isObj(fields?.[k])).map((k) => [k, fields[k]]));
  return createHash('sha256').update(JSON.stringify(stable(picked))).digest('hex').slice(0, 16);
}

/**
 * The apply-body values a team setup stands for (T10), roles mapped to this machine's sources (D13).
 * `keys` lists what the team filled, in apply-body paths, for the Team chips and the CLI's "left out" test.
 */
export function teamValues(fields = {}, { catalog = [], claudeAuth = 'unknown' } = {}) {
  const values = {}; const keys = []; const unmapped = [];
  const roles = fields['models.roles']?.value;
  if (isObj(roles)) {
    for (const [harness, picks] of Object.entries(roles)) {
      for (const role of MODEL_ROLES) {
        const pick = picks?.[role]; if (!isObj(pick)) continue;
        const hit = mapUpstreamModel(pick.model, harness, { catalog, claudeAuth });
        if (!hit.id) { unmapped.push({ harness, role, upstream: pick.model, line: hit.line }); continue; }
        ((((values.models ||= {}).modelRoles ||= {})[harness] ||= {})[role]) = { model: hit.id, ...(pick.effort ? { effort: pick.effort } : {}) };
        keys.push(`models.modelRoles.${harness}.${role}`);
      }
    }
  }
  for (const [policyKey, field] of Object.entries(WORK_OF)) {
    if (!isObj(fields[policyKey])) continue;
    (values.work ||= {})[field] = structuredClone(fields[policyKey].value);
    keys.push(`work.${field}`);
  }
  return { values, keys, unmapped };
}

/**
 * GET /api/setup/team (T14): the file and every cached policy home that carries team setup fields. `homes` is
 * required (the server passes policy/cache.mjs cachedPolicyHomes), so this module stays free of the DB. Each home's
 * Setup fields go through checkTeamSetup like a file (T9); a home that would be refused is skipped and logged.
 * `homesOnly`: the account notice's cheap read: no file, no catalog, just home, hash and the policy keys present.
 */
export function teamSetupState({ env = process.env, catalog = [], claudeAuth = 'unknown', homes, homesOnly = false, log = console.warn } = {}) {
  if (typeof homes !== 'function') throw new TypeError('teamSetupState needs homes()');
  const out = [];
  for (const h of homes() || []) {
    const picked = Object.fromEntries(TEAM_SETUP_KEYS.filter((k) => isObj(h?.doc?.fields?.[k])).map((k) => [k, h.doc.fields[k]]));
    if (!Object.keys(picked).length) continue;
    const c = checkTeamSetup({ schema: POLICY_SCHEMA, fields: picked });
    if (!c.ok) { log(`[setup] team setup in policy ${h.slug} not offered: ${c.error}`); continue; }
    const fields = c.doc.fields;
    if (!Object.keys(fields).length) continue;
    out.push(homesOnly ? { home: h.slug, hash: teamSetupHash(fields), keys: Object.keys(fields) }
      : { home: h.slug, hash: teamSetupHash(fields), ...teamValues(fields, { catalog, claudeAuth }) });
  }
  if (homesOnly) return { homes: out };
  const f = readTeamSetupFile({ env });
  const shown = (p) => (p ? p.replace(homedir(), '~') : p);
  const file = !f.found ? { found: false, path: shown(f.path) }
    : !f.ok ? { found: true, ok: false, path: shown(f.path), source: f.source, field: f.field, error: f.error }
      : { found: true, ok: true, path: shown(f.path), source: f.source, warnings: f.warnings, hash: teamSetupHash(f.doc.fields), ...teamValues(f.doc.fields, { catalog, claudeAuth }) };
  return { file, homes: out };
}

/**
 * D17: a draft team setup from the person's saved settings. Network and model access are never read; roles are
 * turned into upstream names. The result goes through checkTeamSetup, so a draft that would be refused never leaves.
 */
export function buildTeamSetup({ settings = {}, catalog = [] } = {}) {
  const fields = {};
  const roles = {}; const left = [];
  for (const [harness, picks] of Object.entries(isObj(settings.modelRoles) ? settings.modelRoles : {})) {
    for (const role of MODEL_ROLES) {
      const p = picks?.[role]; if (!isObj(p) || typeof p.model !== 'string' || !p.model.trim()) continue;
      const up = shareUpstream(p.model, catalog);
      if (!up) { left.push(`models.roles.${harness}.${role}: ${p.model} is not a model every machine knows — left out`); continue; }
      (roles[harness] ||= {})[role] = { model: up, ...(p.effort ? { effort: p.effort } : {}) };
    }
  }
  if (Object.keys(roles).length) fields['models.roles'] = { kind: 'default', value: roles };
  for (const [policyKey, field] of Object.entries(WORK_OF)) {
    if (settings[field] !== undefined && settings[field] !== null) fields[policyKey] = { kind: 'default', value: structuredClone(settings[field]) };
  }
  const draft = { schema: POLICY_SCHEMA, title: 'Team setup', notes: 'Shared from the Worca setup assistant. Network settings and model access are left out.', fields };
  const checked = checkTeamSetup(draft);
  if (!checked.ok) throw new Error(checked.error);
  const doc = { schema: POLICY_SCHEMA, title: draft.title, notes: draft.notes, fields: checked.doc.fields };
  return { doc, text: `${JSON.stringify(doc, null, 2)}\n`, warnings: [...left, ...checked.warnings] };
}
