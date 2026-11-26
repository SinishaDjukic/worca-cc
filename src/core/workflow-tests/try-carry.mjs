// src/core/workflow-tests/try-carry.mjs — workflow tests 3b (D71, D81): what a Pretend try's Claude spawn carries over
// from the person's own Claude Code settings (it loads no user settings itself, D70a): the sign-in helpers and env, the
// person's deny rules and sandbox; what the run redacts of them, and the carry lines the run harness records. Moved out
// of engines/claude.mjs (file split; it keeps only the call sites in runClaudeProcess and buildSettingsPayload).
import { prepareModelEnv, isReadableModelEnvKey } from '../model-env.mjs';
import { agentIdentityFor } from '../agent-pool.mjs';
import { brokerEnabled } from '../broker-client.mjs';
import { currentOwner } from '../billing.mjs';
import { readUserSignIn, readUserSafety, sandboxProblem, SIGN_IN_SETTINGS_KEYS } from '../engines/claude-sign-in.mjs';

/** Workflow tests 3b (D71): the sign-in helpers a Pretend try carries over from the person's user settings (non-empty strings
 *  of SIGN_IN_SETTINGS_KEYS only); null when there are none. */
export function signInSettingsOf(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const out = {};
  for (const k of SIGN_IN_SETTINGS_KEYS) if (typeof s[k] === 'string' && s[k] !== '') out[k] = s[k];
  return Object.keys(out).length ? out : null;
}

/** Workflow tests 3b (D81): the person's own deny rules and sandbox, or null when there are none. C1: a sandbox the CLI
 *  would reject (sandboxProblem) is never carried: it would make the CLI drop the whole settings file, Worca's guards with it. */
export function safetySettingsOf(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const deny = Array.isArray(s.deny) ? s.deny.filter((x) => typeof x === 'string' && x.trim()) : [];
  const sandbox = s.sandbox && sandboxProblem(s.sandbox) === null ? s.sandbox : null;
  return deny.length || sandbox ? { deny, sandbox } : null;
}

/**
 * Workflow tests 3b (D71): the sign-in a Pretend try carries over from the person's user settings, and the person's own
 * guards (D81); null when there is neither. Read per spawn from the folder the spawn's CLI will read (a model profile may
 * move CLAUDE_CONFIG_DIR). Nothing at all with the credential broker on (its token is the spawn's only model credential) or
 * into a spawn that runs as another OS user (agent isolation: one user's sign-in never moves to another; M12: nor are the
 * operator's own rules shown to agents). M3: an agent user that cannot be looked up counts as one (fail closed). `cwd`: the
 * spawn's working directory, whose `.claude` sandbox stays on top of the person's (D81a); `sources`: the spawn's setting
 * sources (M7); `userLoaded`: the run itself loads user settings (M11); `ownDeny`: Worca's own deny rules for the same
 * --settings file (Task 5 fix review, concern 1). Never throws.
 * @returns {{env: Record<string,string>, settings: Record<string,string>, safety?: {deny: string[], sandbox: object|null},
 *   warnings?: string[], notes?: string[]} | null}
 */
export function signInCarry({ modelEnv = null, asAgent = false, read = readUserSignIn, readSafety = readUserSafety,
  agentUser = () => agentIdentityFor(currentOwner()), cwd = null, sources = undefined, userLoaded = true, ownDeny = [] } = {}) {
  try {
    // D71, M12: neither the sign-in nor the guards with the broker on or into a spawn that runs as another OS user.
    let isolated = false;
    if (asAgent) { try { isolated = !!agentUser(); } catch { isolated = true; } }
    if (brokerEnabled() || isolated) return null;
    const extra = modelEnv && typeof modelEnv === 'object' && Object.keys(modelEnv).length ? prepareModelEnv(modelEnv).env : {};
    const env = { ...process.env, ...extra };
    // D81: the person's own deny rules and sandbox. The deny rules only add blocks; the sandbox keeps Claude Code's order
    // (D81a): the spawn's checkout (`cwd`) has its project, then local sandbox laid on top.
    let safety = null;
    let warnings = [];
    let notes = [];
    const texts = (a) => (Array.isArray(a) ? a.filter((w) => typeof w === 'string' && w) : []);
    try {
      const g = readSafety({ env, cwd, sources, userLoaded, ownDeny: Array.isArray(ownDeny) ? ownDeny : [] });
      if (g && ((Array.isArray(g.deny) && g.deny.length) || g.sandbox)) safety = { deny: g.deny || [], sandbox: g.sandbox || null };
      if (g) { warnings = texts(g.warnings); notes = texts(g.notes); }
    } catch { safety = null; }
    const s = read({ env });
    const signIn = s && s.state === 'found' ? s : null;
    if (!signIn && !safety && !warnings.length && !notes.length) return null;
    return { env: { ...(signIn ? signIn.env || {} : {}) }, settings: { ...(signIn ? signIn.settings || {} : {}) }, ...(safety ? { safety } : {}),
      ...(warnings.length ? { warnings } : {}), ...(notes.length ? { notes } : {}) };
  } catch { return null; }
}

/** The carry of one runClaudeProcess spawn: read only for a Pretend try (`pluginsOff` true), else null and nothing is
 *  read. `cwd`: the spawn's (the process's when absent); `ownDeny`: the spawn's own deny rules (concern 1). `carryOf`: a
 *  test seam (signInCarry). */
export function pretendTryCarry({ pluginsOff, modelEnv, asAgent, cwd, settingSources, runLoadsUserSettings, permissionRules } = {}, { carryOf = signInCarry } = {}) {
  return pluginsOff === true
    ? carryOf({ modelEnv, asAgent, cwd: cwd || process.cwd(), sources: settingSources, userLoaded: runLoadsUserSettings === true,
      ownDeny: permissionRules && Array.isArray(permissionRules.deny) ? permissionRules.deny : [] }) : null;
}

/** What a spawn hands on of its carry (null: nothing): the sign-in helpers (D71) and the person's guards (D81) to stage,
 *  and the sign-in env. */
export const carryStageOpts = (carry) => ({ signInSettings: carry && Object.keys(carry.settings).length ? carry.settings : null,
  safetySettings: carry && carry.safety ? carry.safety : null });
export const carryEnv = (carry) => (carry && Object.keys(carry.env).length ? carry.env : null);

/** Task 5 (security review M1): every carried value the run redacts: the secret env values (secretValuesOf) and the
 *  helper commands (`apiKeyHelper` may hold a key inline); the redactor itself ignores those under 8 characters. */
export function carryRedactValues(carry) {
  if (!carry) return [];
  const helpers = carry.settings && typeof carry.settings === 'object' ? Object.values(carry.settings).filter((v) => typeof v === 'string') : [];
  return [...secretValuesOf(carry.env), ...helpers];
}

/** Task 5 (security review C1, L5): what the runner says about a Pretend try's carry, as a stderr line of the spawn. The run
 *  harness records a warning once as a run warning, and a note once in the run log (carryLine). */
export const CARRY_WARNING_PREFIX = '[worca] try carry warning: ';
export const CARRY_NOTE_PREFIX = '[worca] try carry note: ';
/** A carry line's kind and text, or null for any other line. */
export function carryLine(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (t.startsWith(CARRY_WARNING_PREFIX)) return { kind: 'warning', text: t.slice(CARRY_WARNING_PREFIX.length) };
  if (t.startsWith(CARRY_NOTE_PREFIX)) return { kind: 'note', text: t.slice(CARRY_NOTE_PREFIX.length) };
  return null;
}
/** The lines a carry gives: each sandbox warning (C1), each note of what a sandbox layer left out (D81b), then how many
 *  personal deny rules came along (L5). */
export function carryLines(carry) {
  if (!carry) return [];
  const n = carry.safety && Array.isArray(carry.safety.deny) ? carry.safety.deny.length : 0;
  return [...(carry.warnings || []).map((w) => `${CARRY_WARNING_PREFIX}${w}`), ...(carry.notes || []).map((t) => `${CARRY_NOTE_PREFIX}${t}`),
    ...(n ? [`${CARRY_NOTE_PREFIX}This try also follows ${n} deny rule${n === 1 ? '' : 's'} from your own Claude Code settings.`] : [])];
}

// M9: plain routing keys a run may show (AWS_DEFAULT_REGION and Vertex's per-model VERTEX_REGION_* are regions, not secrets).
const ROUTING_KEY_RE = /^(CLOUD_ML_REGION|AWS_REGION|AWS_DEFAULT_REGION|AWS_PROFILE|ANTHROPIC_VERTEX_PROJECT_ID|HTTP_PROXY|HTTPS_PROXY|NO_PROXY|VERTEX_REGION_[A-Z0-9_]+)$/i;
const URL_PARTS_RE = /^[a-z][a-z0-9+.-]*:\/\/(?:([^@/?#]*)@)?[^/?#]*([^?#]*)(\?[^#]*)?/i;
const decoded = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
/**
 * The carried values a run must never show (D71, D71a): every string value of 8+ characters except the keys that are
 * safe to print (readable model-env keys and plain routing keys). A URL's username and password (4+ chars) are redacted
 * on their own, also on the printable keys (ANTHROPIC_BASE_URL, the proxies): as written, decoded, and as URL re-encodes
 * them (M9). M9, as corrected by the fix review (m7): so are the whole carried URL, its query, and those path segments that
 * look like a token (16+ token characters); a plain path such as `/anthropic` is not, so it is not blanked out of every text.
 */
export function secretValuesOf(env) {
  const out = [];
  for (const [k, v] of Object.entries(env || {})) {
    if (typeof v !== 'string') continue;
    if (v.length >= 8 && !isReadableModelEnvKey(k) && !ROUTING_KEY_RE.test(k)) out.push(v);
    let u = null;
    try { u = new URL(v); } catch { /* not a URL */ }
    if (!u) continue;
    const m = URL_PARTS_RE.exec(v.trim());
    const raw = m && m[1] != null ? [m[1].split(':')[0], m[1].includes(':') ? m[1].slice(m[1].indexOf(':') + 1) : ''] : [];
    if (!m) {   // not `scheme://…` (e.g. a header line that happens to parse): no login, path or query of its own
      for (const part of [u.username, u.password]) { if (part.length >= 4) out.push(part); }
      continue;
    }
    // Task 5 fix review (m7): the whole URL as carried, its login and its query; of its path only a segment that looks like a
    // secret (SECRET_SEGMENT_RE), so a plain gateway path such as `/anthropic` is not blanked out of every text.
    if (v.length >= 8) out.push(v);
    for (const part of [...raw, ...raw.map(decoded), u.username, u.password]) { if (part.length >= 4) out.push(part); }
    const query = m[3] && m[3] !== '?' ? m[3] : '';
    for (const part of [query, u.search]) { if (part) out.push(part); }
    for (const seg of (m[2] || '').split('/')) { if (SECRET_SEGMENT_RE.test(seg)) out.push(seg, decoded(seg)); }
  }
  return [...new Set(out)];
}
/** m7: a URL path segment that looks like a token: 16 or more characters of a token's alphabet. */
const SECRET_SEGMENT_RE = /^[A-Za-z0-9._~+=%-]{16,}$/;
