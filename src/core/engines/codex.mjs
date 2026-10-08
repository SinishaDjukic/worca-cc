// src/core/engines/codex.mjs
// The codex CLI adapter (plans/harness-bridge-design.md §10): `codex exec --json`
// argv, the JSONL stream normalized into worca's event vocabulary, cost estimated
// from codex's cumulative per-thread usage, error classification, and the spawn
// path on the shared supervisor (engines/spawn.mjs).
//
// Facts this module encodes (checked against codex-cli 0.146 and 0.154):
// - `exec` has no --ask-for-approval: approval is `never` in exec mode.
// - `exec resume <thread>` rejects --sandbox, -C and --add-dir; both ride `-c`.
// - The prompt is the last positional; `-` reads it from stdin (no argv limit).
// - --ignore-user-config (exec and exec resume) skips $CODEX_HOME/config.toml, whose
//   MCP servers, plugins, notify hook and default model worca's guardrails never saw;
//   the sign-in still comes from CODEX_HOME.
// - `turn.completed.usage` is CUMULATIVE for the thread, and cached_input_tokens /
//   reasoning_output_tokens are subsets of input_tokens / output_tokens.
// - A failed turn ends with `error` + `turn.failed`, and codex may still exit 0. A
//   top-level `error` alone is not a failure: codex also reports its stream retries
//   that way ("Reconnecting... 1/5 (…)") and may go on to complete the turn.
import { mkdirSync, readFileSync, writeFileSync, existsSync, symlinkSync, rmSync, renameSync, readdirSync, linkSync, copyFileSync, lstatSync, readlinkSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { join, resolve, dirname, relative } from 'node:path';
import { worcaHome } from '../projects.mjs';
import { hostGuardEnabled, hostGuardSystemPrompt } from '../host-guard.mjs';
import { CAPABILITY_KEYS } from './capabilities.mjs';
import { superviseSpawn, composeSpawnEnv, cleanRunEnv, safeEmit, writableRootsInWorcaHome } from './spawn.mjs';
import { createRedactor } from '../redact.mjs';
import { strongestClass } from '../recoverable-error.mjs';
import { ARGV_INLINE_LIMIT } from './claude.mjs';
import { CODEX_PRICES } from '../list-prices.mjs';
import { codexEndpointSpawn, findCodexEndpointEntry } from './codex-endpoint.mjs';
import { scopeLauncherEnv } from '../mcp/launch.mjs';

export const CODEX_DEFAULT_BIN = process.env.WORCA_CODEX_BIN || 'codex';

/** Stored session ids are engine-qualified so a resume never hands a codex
 *  thread to claude (or a claude session to codex). */
export const CODEX_SESSION_PREFIX = 'codex:';

/** The codex thread in a stored session id, or null when the id is not codex's. */
export function codexThreadOf(sessionId) {
  return typeof sessionId === 'string' && sessionId.startsWith(CODEX_SESSION_PREFIX) && sessionId.length > CODEX_SESSION_PREFIX.length
    ? sessionId.slice(CODEX_SESSION_PREFIX.length) : null;
}

/** What the adapter can do for worca (design §10.3). Only a literal false degrades:
 *  codex has no per-spawn tool allowlist, no hook stream (its hooks run only once a person
 *  has reviewed and trusted them) and no native turn or spend cap (the adapter counts tool
 *  calls against maxTurns itself; a spend cap has nothing to stop mid-turn).
 *  - MCP servers attach through `-c mcp_servers.*` (stdio only).
 *  - Permission rules: the deny rules codex can hold become command rules (codexRulePlan);
 *    the rest are reported by unenforcedRules, and the run gate refuses them unless allowed.
 *  - Sub-agents: codex's own spawn_agent, with worca's investigator defined as an agent role
 *    that carries the memory block (codexInvestigatorRole).
 *  - Skills: codex loads `.agents/skills` from the cwd, where the run context mounts them. */
const CODEX_FALSE = new Set(['allowedTools', 'hookTelemetry', 'turnBudget']);

/** The model a codex spawn runs when worca names none: codex-cli 0.146's own built-in default under
 *  --ignore-user-config (seen in the session log of an unnamed-model exec). Naming it changes nothing codex
 *  runs, and keeps every Codex call priced (CODEX_PRICES) instead of a $0.00 "cost unknown". */
export const CODEX_DEFAULT_MODEL = 'gpt-5.6-sol';
export const codexCapabilities = Object.freeze(Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, !CODEX_FALSE.has(k)])));

/** Ask Worca on Codex (cascading-settings-design.md D13): the flags that leave codex no shell, no native web search,
 *  no browser / apps / plugins / sub-agents. null = this codex cannot be locked down, and an Ask turn on Codex refuses
 *  (turn.mjs). Task 0 (plans/ask-on-codex-spike.md (a)) found codex-cli 0.146.0-alpha.9.2 cannot be: under
 *  `--disable shell_tool --disable unified_exec …` the shell is gone, but `view_image` still reads any image file on
 *  disk and sub-agents still spawn, and no flag or config key switches them off. When a codex version can, set this
 *  to the verified list (valid on `exec` and `exec resume` alike) and re-run the spike. */
export const CODEX_ASK_LOCKDOWN = null;
/** Every read-only spawn — a utility job over untrusted input (a diff, a task text — D11) — runs with codex's shell off.
 *  The read-only sandbox still lets the shell read the whole disk, so a prompt-injected task could otherwise read a key
 *  file into its answer. Verified to remove the shell on codex-cli 0.146 (plans/ask-on-codex-spike.md (a)). An Ask
 *  lockdown list replaces these flags and must carry them itself. */
export const CODEX_SHELL_OFF = Object.freeze(['--disable', 'shell_tool', '--disable', 'unified_exec']);
export const CODEX_MCP_TOOL_TIMEOUT_SEC = 1800;

// ── permission rules ─────────────────────────────────────────────────────────

/** A deny rule's command prefix (`Bash(git push)`, `Bash(git push:*)`, `Bash(npm run *)`), or null when it is
 *  not a plain command prefix (a glob or quote inside, or not a Bash rule). */
function bashPrefix(rule) {
  const m = /^Bash\((.+)\)$/.exec(String(rule).trim());
  if (!m) return null;
  const body = m[1].trim().replace(/(?::\*| \*)$/, '').trim();
  if (!body || /[*?"'`$\\()|;&<>]/.test(body)) return null;
  return body.split(/\s+/);
}

/** How far a codex command rule reaches (plans/harness-bridge-design.md §10.3; verified on codex-cli 0.146). codex
 *  splits a shell script into commands only when it is plain words: a redirect, a `$(…)`, a `$VAR` or a `VAR=x cmd`
 *  makes it match the whole `bash -lc …` argv instead, so the rule never sees the command. The gate and the run log
 *  say so in these words. */
export const CODEX_COMMAND_RULE_REACH = 'they catch a command run directly, by full path or in an && chain, but not one with a redirect, a substitution or a variable';

/**
 * What codex can hold of a run's permission rules. Only DENY rules are worca policy (allow / ask are never
 * lifted, and codex exec never asks). A `Bash(cmd…)` prefix becomes a codex command rule (decision forbidden),
 * which is only a PARTIAL guard (CODEX_COMMAND_RULE_REACH): such rules are `partial`, and the run gate treats
 * them like the rules codex cannot hold (they need --allow-unguarded-engine) while the spawn still writes them.
 * A bare `Bash` turns the shell off; `WebSearch` turns codex's web search off. `WebFetch` has no codex tool to deny,
 * and codex fetches a page through its shell (`curl`) or its web search: it is held only when the same rules turn
 * both off, else it is `unenforced`. Path rules (`Read(…)`, `Edit(…)`, `Write(…)`), MCP tool rules and globs cannot
 * be held: they are `unenforced`.
 * @returns {{prefixes:string[][], shellOff:boolean, webSearchOff:boolean, enforced:string[], partial:string[], unenforced:string[]}}
 */
export function codexRulePlan(permissionRules) {
  const out = { prefixes: [], shellOff: false, webSearchOff: false, enforced: [], partial: [], unenforced: [] };
  const deny = Array.isArray(permissionRules?.deny) ? permissionRules.deny : [];
  const denied = new Set(deny.map((r) => String(r).trim()));
  const noFetch = denied.has('Bash') && denied.has('WebSearch');
  for (const raw of deny) {
    const rule = String(raw).trim();
    if (!rule) continue;
    if (rule === 'Bash') { out.shellOff = true; out.enforced.push(rule); continue; }
    if (rule === 'WebSearch') { out.webSearchOff = true; out.enforced.push(rule); continue; }
    if (rule === 'WebFetch') { (noFetch ? out.enforced : out.unenforced).push(rule); continue; }
    const prefix = bashPrefix(rule);
    if (prefix) {
      if (!out.prefixes.some((p) => p.join(' ') === prefix.join(' '))) out.prefixes.push(prefix);
      out.partial.push(rule);
    } else out.unenforced.push(rule);
  }
  return out;
}

/** The deny rules codex cannot hold (the run gate's question). */
export function unenforcedRules(permissionRules) { return codexRulePlan(permissionRules).unenforced; }

/** The deny rules codex holds only in part, as command rules (CODEX_COMMAND_RULE_REACH). */
export function partialRules(permissionRules) { return codexRulePlan(permissionRules).partial; }

/** The codex execpolicy file for `prefixes` (Starlark; a JSON string is a valid Starlark string). */
export function codexRulesFile(prefixes) {
  return prefixes.map((p) => `prefix_rule(pattern=${JSON.stringify(p)}, decision="forbidden", justification=${JSON.stringify(`worca guardrail: Bash(${p.join(' ')}:*)`)})`).join('\n') + '\n';
}

/** The user's own codex home: where codex keeps its sign-in. */
export const userCodexHome = (env = process.env) => (env.CODEX_HOME && env.CODEX_HOME.trim()) || join(homedir(), '.codex');

/** Where worca keeps its managed codex homes (guardedCodexHome). */
const codexHomesBase = () => join(worcaHome(), 'engines', 'codex', 'homes');

/**
 * A worca-managed CODEX_HOME holding `rules`. codex reads command rules only from its home's `rules/` folder,
 * so a guarded spawn runs under one home per rule set; its sign-in is the user's own auth.json, linked in and
 * re-pointed on every call (keepAuthLinked). A thread written under another home is brought in on resume
 * (bringCodexThreadHome). Never throws.
 */
export function guardedCodexHome(rulesText, { base = codexHomesBase(), userHome = userCodexHome() } = {}) {
  const dir = join(base, createHash('sha256').update(rulesText).digest('hex').slice(0, 12));
  try {
    mkdirSync(join(dir, 'rules'), { recursive: true });
    const file = join(dir, 'rules', 'worca.rules');
    let cur = null;
    try { cur = readFileSync(file, 'utf8'); } catch { /* new home */ }
    // Two runs starting together may both write: each writes its own temp file and renames it into place, so
    // codex never reads a truncated or empty rules file (no command rules while worca reports them held).
    if (cur !== rulesText) {
      const tmp = join(dir, 'rules', `.worca.rules.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
      try { writeFileSync(tmp, rulesText); renameSync(tmp, file); } finally { rmSync(tmp, { force: true }); }
    }
    keepAuthLinked(dir, userHome);
  } catch { /* the spawn then fails on its sign-in and says so */ }
  return dir;
}

/**
 * The managed home's auth.json as a link to the user's current one. The user's codex home can move (CODEX_HOME) or
 * sign out, so the link is checked on every spawn: a link to another file, or one left dangling, is re-pointed
 * (a temp link renamed into place, as the rules file is), and removed when the user has no auth.json. A regular
 * file is left alone: it is a sign-in codex itself wrote in this home.
 */
function keepAuthLinked(dir, userHome) {
  const auth = join(dir, 'auth.json');
  const want = join(userHome, 'auth.json');
  let link;   // undefined: nothing there; null: a regular file; else the link's target
  try { link = lstatSync(auth).isSymbolicLink() ? readlinkSync(auth) : null; } catch { link = undefined; }
  if (link === null) return;
  if (!existsSync(want)) { if (link !== undefined) rmSync(auth, { force: true }); return; }
  if (link === want) return;
  const tmp = join(dir, `.auth.json.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  try { symlinkSync(want, tmp); renameSync(tmp, auth); } finally { rmSync(tmp, { force: true }); }
}

/** codex's session file for `thread` under `home` (`sessions/<y>/<m>/<d>/rollout-<time>-<thread>.jsonl`), or null. */
export function findCodexRollout(home, thread) {
  if (!home || !thread) return null;
  const suffix = `-${thread}.jsonl`;
  const walk = (dir, depth) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const e of entries) {
      if (e.isFile() && e.name.startsWith('rollout-') && e.name.endsWith(suffix)) return join(dir, e.name);
      if (e.isDirectory() && depth < 3) { const f = walk(join(dir, e.name), depth + 1); if (f) return f; }
    }
    return null;
  };
  return walk(join(home, 'sessions'), 0);
}

/** The codex homes a thread may have been written under: the user's own and every worca-managed one. */
function knownCodexHomes() {
  const base = codexHomesBase();
  let managed = [];
  try { managed = readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(base, e.name)); } catch { /* none yet */ }
  return [userCodexHome(), ...managed];
}

/**
 * Makes `thread` resumable under `home`. A thread lives in the home of the spawn that started it, and a guarded spawn's
 * home follows its rule set, so a rule change between pause and resume (or a move between guarded and unguarded) moves
 * the home. codex finds a thread by its session file anywhere under the home's sessions/ (checked on codex-cli 0.162),
 * so the file is hard-linked in from the home that has it: one file, so either home resumes the latest turn. A copy
 * stands in when the homes are on different volumes. Never throws; false when no home has the thread.
 */
export function bringCodexThreadHome(home, thread, { homes = knownCodexHomes() } = {}) {
  if (findCodexRollout(home, thread)) return true;
  for (const h of homes) {
    if (!h || resolve(h) === resolve(home)) continue;
    const src = findCodexRollout(h, thread);
    if (!src) continue;
    const dest = join(home, relative(h, src));
    try {
      mkdirSync(dirname(dest), { recursive: true });
      try { linkSync(src, dest); } catch { copyFileSync(src, dest); }
      return true;
    } catch { return false; }
  }
  return false;
}

/**
 * The thread's cumulative usage as codex last recorded it in its session file (the last `token_count` event), or null.
 * `exec --json` reports usage only on `turn.completed`, so this is the only record of a turn stopped before it.
 */
export function codexRolloutUsage(home, thread) {
  const file = findCodexRollout(home, thread);
  if (!file) return null;
  let lines;
  try { lines = readFileSync(file, 'utf8').split('\n'); } catch { return null; }
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i].includes('"token_count"')) continue;
    try {
      const evt = JSON.parse(lines[i]);
      const total = evt?.payload?.type === 'token_count' ? evt.payload.info?.total_token_usage : null;
      if (total && typeof total === 'object') return readUsage(total);
    } catch { /* a torn last line: try the one before */ }
  }
  return null;
}

// ── sub-agents ───────────────────────────────────────────────────────────────

/** The codex agent role worca's fan-out dispatches (`spawn_agent` with this `agent_type`). */
export const CODEX_INVESTIGATOR_ROLE = 'worca_investigator';
const CODEX_EFFORTS = Object.freeze(['minimal', 'low', 'medium', 'high', 'xhigh']);
const DEFAULT_INVESTIGATOR_PROMPT = 'You are a read-only investigator dispatched by a worca pipeline agent. Investigate exactly what you were asked, in the directories you were given. Never edit, write, commit, branch or spawn sub-agents. Report concrete findings with file paths, then stop.';

/**
 * The investigator role of a fan-out spawn: the `--agents` definition worca would hand Claude (its prompt,
 * model and effort; a Claude model or effort codex cannot run is dropped), plus the memory block, which
 * Claude's sub-agents get through --append-subagent-system-prompt. codex roles inherit the parent's sandbox,
 * so read-only is the role's instruction, as it is for Claude's investigator (which keeps Bash).
 * @returns {{description:string, toml:string, model:string|null}} `model`: the role's own, null when it inherits the parent's
 */
export function codexInvestigatorRole({ agents, subagentSystemPrompt, inheritModel = false } = {}) {
  const def = agents && typeof agents === 'object' ? Object.values(agents)[0] : null;
  const prompt = [typeof def?.prompt === 'string' && def.prompt.trim() ? def.prompt.trim() : DEFAULT_INVESTIGATOR_PROMPT,
    typeof subagentSystemPrompt === 'string' ? subagentSystemPrompt.trim() : ''].filter(Boolean).join('\n\n');
  const lines = [`developer_instructions = ${tomlString(prompt)}`];
  // On a custom endpoint the role inherits the parent's model with its provider: a built-in id would go to the endpoint.
  const model = !inheritModel && codexModelPriced(def?.model) && def?.model ? def.model : null;
  if (model) lines.push(`model = ${tomlString(model)}`);
  const effort = def?.effort === 'max' ? 'xhigh' : def?.effort;
  if (CODEX_EFFORTS.includes(effort)) lines.push(`model_reasoning_effort = ${tomlString(effort)}`);
  return { description: typeof def?.description === 'string' && def.description ? def.description : 'Read-only investigator for one area; reports its findings to the agent that dispatched it.',
    toml: `${lines.join('\n')}\n`, model };
}   // the Ask turn's own 30-minute clock bounds it (propose_workflow classifies, test_script runs)
const MCP_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ENV_REF_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** The servers of an --mcp-config document that codex cannot attach: it takes stdio servers only. */
export function codexUnattachableMcp(servers) {
  return Object.entries(servers && typeof servers === 'object' ? servers : {})
    .filter(([name, srv]) => !MCP_NAME_RE.test(name) || !srv || typeof srv.command !== 'string').map(([name]) => name);
}

/** `${VAR}` references in a server's env values, filled from `from` the way Claude Code expands an --mcp-config
 *  (the MCP registry writes `${MCPSECRET_…}` references; the values ride the spawn env). An unknown name
 *  becomes empty, as in a shell. */
export function expandMcpEnvRefs(servers, from = {}) {
  const out = {};
  for (const [name, srv] of Object.entries(servers && typeof servers === 'object' ? servers : {})) {
    if (!srv || typeof srv !== 'object' || !srv.env || typeof srv.env !== 'object') { out[name] = srv; continue; }
    const env = {};
    for (const [k, v] of Object.entries(srv.env)) env[k] = typeof v === 'string' ? v.replace(ENV_REF_RE, (_, n) => (typeof from[n] === 'string' ? from[n] : '')) : v;
    out[name] = { ...srv, env };
  }
  return out;
}
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The per-call `-c mcp_servers.<name>.*` overrides for the stdio servers of an --mcp-config document (spec §4.6).
 * Env VALUES never ride argv (any local user can read argv): they are returned for the codex process env, and only
 * their names go to `env_vars`, which codex copies into the server's env (plans/ask-on-codex-spike.md (d)).
 * `passEnv` adds names already in the codex env (SSH_AUTH_SOCK, the web search key's variable).
 */
export function codexMcpOverrides(servers, { passEnv = [] } = {}) {
  const args = [];
  const env = {};
  const all = Object.entries(servers && typeof servers === 'object' ? servers : {});
  // Every server's env shares the ONE codex process env: a name another server declares is never passed on here.
  const declared = new Set(all.flatMap(([, srv]) => Object.keys(srv?.env && typeof srv.env === 'object' ? srv.env : {})));
  for (const [name, srv] of all) {
    if (!MCP_NAME_RE.test(name) || !srv || typeof srv.command !== 'string') continue;   // stdio servers only
    const key = `mcp_servers.${name}`;
    args.push('-c', `${key}.command=${tomlString(srv.command)}`);
    args.push('-c', `${key}.args=[${(Array.isArray(srv.args) ? srv.args : []).map((a) => tomlString(String(a))).join(',')}]`);
    const names = [];
    for (const [k, v] of Object.entries(srv.env && typeof srv.env === 'object' ? srv.env : {})) {
      if (!ENV_NAME_RE.test(k) || typeof v !== 'string') continue;
      if (Object.hasOwn(env, k) && env[k] !== v) throw new Error(`MCP servers declare ${k} with different values — codex hands its servers one shared environment`);
      env[k] = v; names.push(k);
    }
    for (const k of passEnv) if (ENV_NAME_RE.test(k) && !names.includes(k) && !declared.has(k)) names.push(k);
    if (names.length) args.push('-c', `${key}.env_vars=[${names.map(tomlString).join(',')}]`);
    args.push('-c', `${key}.required=true`, '-c', `${key}.startup_timeout_sec=30`,
      '-c', `${key}.tool_timeout_sec=${CODEX_MCP_TOOL_TIMEOUT_SEC}`, '-c', `${key}.default_tools_approval_mode="approve"`);
  }
  return { args, env };
}

/** An MCP tool result as Claude's stream gives it: the text of a `{content:[{type:'text',text}]}` wrapper, else JSON. */
export function mcpResultText(result) {
  if (typeof result === 'string') return result;
  const content = result && Array.isArray(result.content) ? result.content : null;
  if (content && content.length && content.every((c) => c && c.type === 'text' && typeof c.text === 'string')) return content.map((c) => c.text).join('');
  return JSON.stringify(result ?? '');
}

/** True when worca can price `model` on Codex (CODEX_PRICES) — a cost cap needs it (D14). No model is
 *  CODEX_DEFAULT_MODEL, which the adapter names on every spawn. A model on its own endpoint is priced
 *  only by its catalog price override (the list prices are OpenAI's, not the endpoint's). */
export function codexModelPriced(model) {
  const m = model == null || model === '' ? CODEX_DEFAULT_MODEL : model;
  const endpoint = findCodexEndpointEntry(m);
  if (endpoint) return !!endpoint.cost;
  return typeof m === 'string' && Object.hasOwn(CODEX_PRICES, m);
}

/** codex's answer to `exec resume <unknown thread>` (plans/ask-on-codex-spike.md (g)). */
export const CODEX_RESUME_NOT_FOUND_RE = /no rollout found for (?:thread|conversation) id/i;
export function codexResumeNotFound(err) { return CODEX_RESUME_NOT_FOUND_RE.test(String((err && err.message) || err || '')); }

/**
 * A TOML basic string: quotes, backslashes and control characters escaped, so a
 * system prompt that starts with `[`, `{` or a digit is never parsed as TOML.
 * @param {string} s
 */
export function tomlString(s) {
  const body = String(s).replace(/[\u0000-\u001f\u007f"\\]/g, (ch) => {
    if (ch === '"') return '\\"';
    if (ch === '\\') return '\\\\';
    if (ch === '\n') return '\\n';
    if (ch === '\r') return '\\r';
    if (ch === '\t') return '\\t';
    return `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
  });
  return `"${body}"`;
}

/**
 * `codex exec` argv. The prompt always travels on stdin (`-`).
 *   fresh:  exec [-i IMG]… --json --skip-git-repo-check --ignore-user-config --sandbox workspace-write [lockdown… | read-only: shell off] [mcp…] [-m M] [-c effort] [-c developer_instructions] [--add-dir D]… -
 *   resume: exec resume <thread> [-i IMG]… --json --skip-git-repo-check --ignore-user-config -c sandbox_mode="workspace-write" [-c writable_roots] [lockdown…] [mcp…] [-m M] [-c effort] [-c developer_instructions] -
 * images / lockdown: an Ask Worca spawn only (runCodexProcess askLockdown). mcp: any spawn handed an --mcp-config.
 * @param {{systemPrompt?:string, model?:string, effort?:string, resumeThreadId?:string|null, addDirs?:string[], sandbox?:string, images?:string[], lockdown?:string[], mcp?:string[]}} o
 */
export function buildCodexArgs({ systemPrompt, model, effort, resumeThreadId, addDirs, sandbox, images, lockdown, mcp } = {}) {
  const mode = sandbox === 'read-only' ? 'read-only' : 'workspace-write';
  const dirs = mode === 'read-only' ? [] : (Array.isArray(addDirs) ? addDirs.filter((d) => typeof d === 'string' && d) : []);
  // `-i <FILE>...` takes several values: placed right after the subcommand, the next token is always a flag,
  // never the `-` stdin prompt (plans/ask-on-codex-spike.md (f)).
  const imgs = (Array.isArray(images) ? images.filter((p) => typeof p === 'string' && p) : []).flatMap((p) => ['-i', p]);
  const args = ['exec'];
  if (resumeThreadId) {
    args.push('resume', resumeThreadId, ...imgs, '--json', '--skip-git-repo-check', '--ignore-user-config', '-c', `sandbox_mode="${mode}"`);
    if (dirs.length) args.push('-c', `sandbox_workspace_write.writable_roots=[${dirs.map(tomlString).join(',')}]`);
  } else {
    args.push(...imgs, '--json', '--skip-git-repo-check', '--ignore-user-config', '--sandbox', mode);
  }
  args.push(...(Array.isArray(lockdown) ? lockdown : mode === 'read-only' ? CODEX_SHELL_OFF : []));
  if (Array.isArray(mcp)) args.push(...mcp);
  if (model) args.push('-m', String(model));
  if (effort) args.push('-c', `model_reasoning_effort=${tomlString(effort)}`);
  if (systemPrompt) args.push('-c', `developer_instructions=${tomlString(systemPrompt)}`);
  if (!resumeThreadId) for (const d of dirs) args.push('--add-dir', d);
  args.push('-');
  return args;
}

// ── usage and cost ───────────────────────────────────────────────────────────

const ZERO_USAGE = Object.freeze({ input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 });

function readUsage(u) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    input: n(u?.input_tokens), cached: n(u?.cached_input_tokens), cacheWrite: n(u?.cache_write_input_tokens),
    output: n(u?.output_tokens), reasoning: n(u?.reasoning_output_tokens),
  };
}

function diffUsage(now, prior) {
  const out = {};
  for (const k of Object.keys(ZERO_USAGE)) out[k] = Math.max(0, (now[k] || 0) - (prior?.[k] || 0));
  return out;
}

/** API list prices in $ per million tokens (input, output). A ChatGPT plan is not
 *  billed per token, so these are estimates; worca's per-model cost overrides
 *  (config.mjs#resolveModelCost) still apply on top. */
export { CODEX_PRICES };
const CACHED_INPUT_RATE = 0.1;

/** $ estimate for one turn's usage delta, or null for an unknown model. Cached
 *  input is part of `input`; reasoning is part of `output` (never added twice). */
export function estimateCodexCostUsd(model, usage) {
  const price = typeof model === 'string' ? CODEX_PRICES[model] : undefined;
  if (!price || !usage) return null;
  const input = Number(usage.input) || 0;
  const cached = Math.min(Number(usage.cached) || 0, input);
  const output = Number(usage.output) || 0;
  const [inRate, outRate] = price;
  return ((input - cached) * inRate + cached * inRate * CACHED_INPUT_RATE + output * outRate) / 1e6;
}

/** A usage delta in the Claude-style keys worca's cost overrides read. */
function claudeStyleUsage(d) {
  return {
    input_tokens: Math.max(0, d.input - d.cached), cache_read_input_tokens: d.cached,
    cache_creation_input_tokens: d.cacheWrite, output_tokens: d.output,
  };
}

// ── stream ───────────────────────────────────────────────────────────────────

const text = (v) => (typeof v === 'string' ? v : '');

/**
 * `codex exec --json` lines in, normalized events out (src/core/engines/events.mjs).
 * push(line|object) returns the events for that line; finish() returns
 * { text, error, cumulativeUsage } for the whole run. `error` is set by a
 * `turn.failed`, or by the last top-level `error` when no turn completed; a
 * top-level `error` followed by `turn.completed` (a retry codex recovered from)
 * is only a warning.
 * `unpriced`: the model runs on a custom endpoint, so no list price applies (cost stays unknown here;
 * worca's per-model price override still applies on top, config.mjs#resolveModelCost).
 * `subagent`: the agent role and model this spawn's sub-agents run as (a fan-out's investigator role), for their rows.
 * @param {{model?:string, priorUsage?:object|null, unpriced?:boolean, subagent?:{type?:string|null, model?:string|null}}} [o]
 */
export function createCodexNormalizer({ model, priorUsage = null, unpriced = false, subagent = null } = {}) {
  const texts = [];
  const collab = new Set();
  const startedTools = new Set();
  let failed = null;
  let lastError = null;
  let turnCompleted = false;
  let lastUsage = priorUsage ? { ...ZERO_USAGE, ...priorUsage } : null;

  // A collab_tool_call carries little on codex-cli 0.146: `exec --json` streams only the parent's `wait` on its
  // sub-agents (test/fixtures/codex/collab-wait.jsonl: no prompt, no receivers, no agent type), never the
  // spawn_agent call. The row is labelled from what the item has (its prompt, else its tool), and typed and
  // modelled from the role the spawn defined (codexInvestigatorRole), else the parent's model.
  function collabEvents(item, completed) {
    const out = [];
    if (!collab.has(item.id)) {
      collab.add(item.id);
      const prompt = text(item.prompt);
      const tool = text(item.tool);
      const label = prompt || (tool === 'wait' || tool === 'wait_agent' ? 'Codex sub-agents' : `Codex sub-agents: ${tool.replace(/_/g, ' ') || 'call'}`);
      const named = text(item.agent_type) || (Array.isArray(item.receiver_agents) ? item.receiver_agents.filter(Boolean).join(',') : '');
      const type = named || subagent?.type || null;
      const runModel = subagent?.model || model || null;
      out.push({ type: 'subagent', event: 'spawn', toolUseId: item.id, label, description: prompt || label,
        ...(type ? { subagentType: type } : {}), ...(runModel ? { model: runModel } : {}) });
    }
    if (completed) {
      const states = Array.isArray(item.agents_states) ? item.agents_states : Object.values(item.agents_states || {});
      const failed = states.some((s) => /fail|error|abort|decline/i.test(String(s?.status ?? '')));
      out.push({ type: 'subagent', event: failed ? 'error' : 'finish', toolUseId: item.id });
    }
    return out;
  }

  const mcpCall = (it) => ({ name: `mcp__${text(it.server)}__${text(it.tool)}`, input: it.arguments ?? {}, toolUseId: it.id });
  const bashCall = (it) => ({ name: 'Bash', input: { command: text(it.command) }, toolUseId: it.id });
  // codex's native web search (an item with its query): shown as Claude's WebSearch, so a chat that must not search sees it.
  const searchCall = (it) => ({ name: 'WebSearch', input: { query: text(it.query) }, toolUseId: it.id });
  // A search's query may arrive only with its completion, so it is shown then, call and result together.
  const startedCall = (it) => (it.type === 'mcp_tool_call' ? mcpCall(it) : it.type === 'command_execution' ? bashCall(it) : null);
  // The result alone when item.started already showed the call, else the pair.
  const finish = (it, call, res) => {
    const result = { type: 'toolResult', parentId: null, meta: null, results: [res] };
    return startedTools.has(it.id) ? [result] : [{ type: 'tool', parentId: null, calls: [call] }, result];
  };

  function item(evt) {
    const it = evt.item;
    if (!it || typeof it !== 'object' || typeof it.id !== 'string') return [];
    const completed = evt.type === 'item.completed';
    if (it.type === 'collab_tool_call') return collabEvents(it, completed);
    if (!completed) {
      // D15: a tool row shows while the call runs; its result follows at completion. A shell command is seen the
      // moment it starts, so an Ask turn's watchdog (turn.mjs, D13) stops the chat before the command runs on.
      const call = evt.type === 'item.started' && !startedTools.has(it.id) ? startedCall(it) : null;
      if (!call) return [];
      startedTools.add(it.id);
      return [{ type: 'tool', parentId: null, calls: [call] }];
    }
    switch (it.type) {
      case 'agent_message': {
        const t = text(it.text);
        if (!t) return [];
        texts.push(t);
        return [{ type: 'text', text: t, parentId: null, from: 'assistant', blocks: [t], messageId: it.id }];
      }
      case 'command_execution': {
        const out = text(it.aggregated_output);
        return finish(it, bashCall(it), { toolUseId: it.id, isError: it.exit_code !== 0 || it.status === 'failed', text: out, content: out });
      }
      case 'file_change': {
        const changes = Array.isArray(it.changes) ? it.changes : [];
        const failed = it.status === 'failed';
        const calls = changes.map((c, i) => ({ name: 'Edit', input: { file_path: text(c?.path) }, toolUseId: `${it.id}:${i}` }));
        const results = changes.map((c, i) => ({ toolUseId: `${it.id}:${i}`, isError: failed, text: text(c?.kind), content: text(c?.kind) }));
        return calls.length ? [{ type: 'tool', parentId: null, calls }, { type: 'toolResult', parentId: null, meta: null, results }] : [];
      }
      case 'mcp_tool_call': {
        const failed = it.status === 'failed' || it.result?.is_error === true || it.result?.isError === true;
        const out = failed && it.error ? text(it.error?.message) : mcpResultText(it.result);
        return finish(it, mcpCall(it), { toolUseId: it.id, isError: failed, text: out, content: out });
      }
      case 'web_search':
        return finish(it, searchCall(it), { toolUseId: it.id, isError: false, text: '', content: '' });
      case 'error':
        // Non-fatal notices (skill budget, model metadata): the run goes on.
        return text(it.message) ? [{ type: 'stderr', stream: 'err', text: `codex: ${it.message}` }] : [];
      default:
        return []; // reasoning, todo_list: nothing worca reads
    }
  }

  function push(line) {
    let evt = line;
    if (typeof line === 'string') {
      const t = line.trim();
      if (!t.startsWith('{')) return [];
      try { evt = JSON.parse(t); } catch { return []; }
    }
    if (!evt || typeof evt !== 'object') return [];
    switch (evt.type) {
      case 'thread.started':
        return typeof evt.thread_id === 'string'
          ? [{ type: 'session', sessionId: CODEX_SESSION_PREFIX + evt.thread_id, model: model ?? null, init: true }] : [];
      case 'item.started':
      case 'item.completed':
        return item(evt);
      case 'error':
        lastError = text(evt.message) || 'codex reported an error';
        return [{ type: 'stderr', stream: 'err', text: `codex: ${lastError}` }];
      case 'turn.failed':
        failed = text(evt.error?.message) || lastError || 'codex turn failed';
        return [];
      case 'turn.completed': {
        turnCompleted = true;
        const cumulative = readUsage(evt.usage);
        const delta = diffUsage(cumulative, lastUsage);
        lastUsage = cumulative;
        const cost = unpriced ? null : estimateCodexCostUsd(model, delta);
        return [{
          type: 'result', text: texts.join('\n'), isError: false, usage: claudeStyleUsage(delta),
          ...(cost != null ? { costUsd: cost } : {}),
        }];
      }
      default:
        return [];
    }
  }

  const error = () => failed || (turnCompleted ? null : lastError);
  return { push, finish: () => ({ text: texts.join('\n'), error: error(), cumulativeUsage: lastUsage, completed: turnCompleted }) };
}

// ── errors and auth ──────────────────────────────────────────────────────────

/** @returns {'auth'|'usage_limit'|'rate_limit'|'quota'|'network'|null} */
export function classifyCodexError(err) {
  if (err && typeof err === 'object' && 'errorClass' in err && err.errorClass !== undefined) return err.errorClass;
  const msg = String((err && err.message) || err || '');
  if (/\b40[13]\b|unauthorized|not logged in|please run .*login|codex login|invalid api key|authentication/i.test(msg)) return 'auth';
  if (/hit your[^.]*\blimit\b|reached your[^.]*\blimit\b|\blimit\b[^.]*\bresets?\b|usage limit[^.]*try again/i.test(msg)) return 'usage_limit';
  if (/\b429\b|\b529\b|rate.?limit|too many requests|overloaded/i.test(msg)) return 'rate_limit';
  if (/credit balance|insufficient_quota|quota|billing/i.test(msg)) return 'quota';
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|EPIPE|socket hang up|fetch failed|stream error|network|connection (refused|reset|closed|error)/i.test(msg)) return 'network';
  return null;
}

/** `codex login status` output -> true / false / null (unknown). It prints to stderr. */
export function parseLoginStatus({ code, stdout = '', stderr = '' } = {}) {
  const all = `${stdout}\n${stderr}`;
  if (/not logged in/i.test(all)) return false;
  if (/logged in/i.test(all)) return true;
  if (code === 1) return false;
  return null;
}

/**
 * The engine's run-start check (engines/index.mjs `preflight`): the binary runs and
 * `codex login status` says it is signed in. Never rejects. Resolves `{refusal}` when
 * the run cannot start (no binary, signed out), `{warning}` when it cannot tell, and
 * `{}` when it can. `signIn: false` (every model the run uses is on its own endpoint)
 * checks only that the binary runs.
 */
export function codexPreflight({ bin = CODEX_DEFAULT_BIN, timeoutMs = 10000, signIn = true } = {}) {
  return new Promise((resolve) => {
    execFile(bin, ['login', 'status'], { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') {
        resolve(/^(ENOENT|EACCES|EINVAL)$/.test(String(err.code))
          ? { refusal: `cannot run ${bin} (${err.code}) — install codex, or point WORCA_CODEX_BIN at it` }
          : { warning: `could not check the codex sign-in (${err.message})` });
        return;
      }
      const signedIn = parseLoginStatus({ code: err ? err.code : 0, stdout, stderr });
      if (!signIn) resolve({});
      else if (signedIn === false) resolve({ refusal: `${bin} is not signed in — run \`codex login\`` });
      else if (signedIn === null) resolve({ warning: `could not tell whether ${bin} is signed in (\`codex login status\` said nothing recognizable)` });
      else resolve({});
    });
  });
}

// ── spawn ────────────────────────────────────────────────────────────────────

const defaultUsageDir = () => join(worcaHome(), 'engines', 'codex', 'usage');
const usageFile = (dir, thread) => join(dir, `${thread.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);

function loadUsage(dir, thread) {
  try { return { ...ZERO_USAGE, ...JSON.parse(readFileSync(usageFile(dir, thread), 'utf8')) }; } catch { return null; }
}
function storeUsage(dir, thread, usage) {
  try { mkdirSync(dir, { recursive: true }); writeFileSync(usageFile(dir, thread), JSON.stringify(usage)); } catch { /* best effort: a lost file only over-charges one resume */ }
}

/**
 * Run one codex turn. Same resolved value and rejection contract as the Claude
 * adapter: {text, exitCode}; an Error with `errorClass` on failure.
 * Options a codex spawn has no lever for (allowedTools, permissionRules,
 * appendSubagentSystemPrompt, maxBudgetUsd, …) are ignored; the run start logs
 * each of them as a degradation (the capability map). `maxTurns` caps the main
 * agent's tool calls of a helper job (never an Ask chat's: its watchdog owns that
 * cap, turn.mjs): the call past it stops the turn with a `turnCap` error.
 */
export async function runCodexProcess({
  cwd = process.cwd(), systemPrompt = '', prompt = '', model: namedModel, effort, onEvent = () => {}, signal,
  bin = CODEX_DEFAULT_BIN, resumeSessionId, addDirs, writableDirs, sandbox, envScrub, envAllowlist, asAgent, usageDir = defaultUsageDir(),
  mcpConfigPath, spawnEnv: runSpawnEnv, redactValues, maxTurns, images, askLockdown,
  permissionRules, allowedTools, agents, appendSubagentSystemPrompt,
} = {}) {
  if (signal?.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
  const model = namedModel || CODEX_DEFAULT_MODEL;
  // A model on its own OpenAI-compatible endpoint (codex-endpoint.mjs): codex connects to it directly. Throws
  // (auth class) before any spawn when the endpoint has no usable key.
  const endpoint = codexEndpointSpawn(model);
  // MCP registry §5.5.3: with registry secrets in this spawn's env, every emit, the result text and the error leave
  // redacted. The endpoint's key and header values are redacted the same way.
  const secrets = [...(Array.isArray(redactValues) ? redactValues : []), ...(endpoint ? endpoint.secrets : [])];
  const redactor = secrets.length ? createRedactor(secrets) : null;
  if (redactor) { const emit = onEvent; onEvent = (e) => emit(redactor.deep(e)); }
  const redacted = (err) => {
    if (redactor && err && typeof err.message === 'string') err.message = redactor.text(err.message);
    if (redactor && err && typeof err.stack === 'string') err.stack = redactor.text(err.stack);
    return err;
  };
  let thread = codexThreadOf(resumeSessionId);
  if (resumeSessionId && !thread) {
    safeEmit(onEvent, { type: 'stderr', stream: 'err', text: `[worca] codex: stored session ${JSON.stringify(String(resumeSessionId).slice(0, 12))}… is not a codex thread — starting a fresh one` });
  }
  const guardOn = hostGuardEnabled();
  let sys = guardOn ? [hostGuardSystemPrompt(process.pid), systemPrompt].filter(Boolean).join('\n\n') : systemPrompt;
  let stdin = String(prompt ?? '');
  // No system-prompt file flag: a prompt too large for one argv value is folded
  // into stdin behind a delimiter (the systemPromptFlag fallback).
  if (sys && tomlString(sys).length > ARGV_INLINE_LIMIT) {
    stdin = `=== SYSTEM ===\n${sys}\n=== END SYSTEM ===\n\n${stdin}`;
    sys = '';
  }
  // Ask Worca on Codex (spec §4.6): the lockdown rides an Ask spawn only. askLockdown is true (use
  // CODEX_ASK_LOCKDOWN) or an explicit, verified flag list.
  const lockdown = Array.isArray(askLockdown) ? askLockdown : CODEX_ASK_LOCKDOWN;
  // An empty list is no lockdown at all: refused exactly like none.
  if (askLockdown && (!Array.isArray(lockdown) || !lockdown.length)) throw new Error(`${bin}: this codex cannot be locked down for a chat (its image viewer and sub-agents stay on) — Ask on Codex is unavailable`);
  // The sandbox writes only the cwd: the memory mount and the node's output dirs
  // become writable roots (--add-dir fresh, writable_roots on resume).
  const dirs = [...new Set([...(addDirs || []), ...(writableDirs || [])])];
  if (sandbox !== 'read-only') {
    const inHome = writableRootsInWorcaHome({ cwd, roots: dirs });
    if (inHome.length) throw new Error(`${bin}: refusing to start codex — it would be able to write ${inHome.join(', ')}, inside Worca's home (${worcaHome()}), where Worca keeps its database, settings and plugins; codex cannot hold the rules that protect them`);
  }
  // Any spawn's --mcp-config (a pipeline node's servers, a helper job's file tools, Ask's worca server) becomes
  // per-call `-c mcp_servers.*` overrides. The run-start gate refuses a run whose servers codex cannot attach.
  // A read-only spawn is a utility job over untrusted input (a diff, a task text — D11): codex's
  // read-only sandbox still lets its shell read the environment, so it gets the scrubbed base env
  // (plus codex's own CODEX_/OPENAI_ keys), never the host's cloud or model credentials.
  const scrub = envScrub || sandbox === 'read-only';
  const envOpts = { envScrub: scrub, envAllowlist, prefixes: ['CODEX_', 'OPENAI_'], hostPid: guardOn ? process.pid : null };
  let mcpServers = null;
  if (mcpConfigPath) {
    let doc;
    try { doc = JSON.parse(readFileSync(mcpConfigPath, 'utf8')); } catch (err) { throw new Error(`${bin}: cannot read the MCP config ${mcpConfigPath}: ${err.message}`); }
    const all = doc && typeof doc.mcpServers === 'object' ? doc.mcpServers : {};
    const unattachable = new Set(codexUnattachableMcp(all));
    if (unattachable.size) safeEmit(onEvent, { type: 'stderr', stream: 'err', text: `[worca] codex attaches stdio MCP servers only — not attached: ${[...unattachable].join(', ')}` });
    // `${VAR}` references expand from what Claude Code would expand them from: this spawn's env plus the run's spawn env
    // (the registry copies' MCPSECRET_* values), which reaches the servers only through those references.
    const from = composeSpawnEnv({ ...envOpts, runEnv: cleanRunEnv(runSpawnEnv) }).env;
    // Two registry copies of one server would share a launcher env name in codex's one env: each copy reads its own.
    mcpServers = expandMcpEnvRefs(Object.fromEntries(Object.entries(all).filter(([n]) => !unattachable.has(n)).map(([n, srv]) => [n, scopeLauncherEnv(srv)])), from);
  }
  const serverEnv = codexMcpOverrides(mcpServers).env;
  // An Ask chat (askLockdown: no shell, so nothing but codex reads its env) hands its spawn env to its MCP servers the
  // way a Claude chat does — Claude Code passes its own env to stdio children: the agent-mode command token
  // (ask/spawn.mjs). A pipeline node keeps it out of codex's env (its shell would read it): there it reaches the
  // servers only through `${VAR}` references, expanded above.
  const askEnv = askLockdown ? cleanRunEnv(runSpawnEnv) : null;
  const ownEnv = { ...serverEnv, ...(askEnv ?? {}) };
  // Fan-out (the runner granted the sub-agent tool): worca's investigator becomes a codex agent role for this call.
  const role = Array.isArray(allowedTools) && allowedTools.some((t) => t === 'Agent' || t === 'Task') && !askLockdown
    ? codexInvestigatorRole({ agents, subagentSystemPrompt: appendSubagentSystemPrompt, inheritModel: !!endpoint }) : null;
  const normalizer = createCodexNormalizer({ model, priorUsage: thread ? loadUsage(usageDir, thread) : null, unpriced: !!endpoint,
    subagent: role ? { type: CODEX_INVESTIGATOR_ROLE, model: role.model } : null });
  const { env } = composeSpawnEnv({ ...envOpts, ...(Object.keys(ownEnv).length ? { runEnv: ownEnv } : {}) });
  // Guardrails: the deny rules codex can hold (codexRulePlan). Command rules live in a worca-managed CODEX_HOME.
  const plan = codexRulePlan(permissionRules);
  if (plan.prefixes.length) env.CODEX_HOME = guardedCodexHome(codexRulesFile(plan.prefixes));
  const home = (env.CODEX_HOME && String(env.CODEX_HOME).trim()) || join(homedir(), '.codex');
  if (thread) bringCodexThreadHome(home, thread);
  const extra = [];
  if (plan.shellOff && sandbox !== 'read-only' && !askLockdown) extra.push(...CODEX_SHELL_OFF);
  if (plan.webSearchOff) extra.push('-c', 'web_search="disabled"');
  let roleFile = null;
  if (role) {
    try {
      const dir = join(worcaHome(), 'tmp', 'codex-roles');
      mkdirSync(dir, { recursive: true });
      roleFile = join(dir, `${CODEX_INVESTIGATOR_ROLE}-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.toml`);
      writeFileSync(roleFile, role.toml, { mode: 0o600 });
      extra.push('-c', `agents.${CODEX_INVESTIGATOR_ROLE}.description=${tomlString(role.description)}`,
        '-c', `agents.${CODEX_INVESTIGATOR_ROLE}.config_file=${tomlString(roleFile)}`);
    } catch { roleFile = null; /* no role: the agent's sub-agents run as codex's default */ }
  }
  // codex hands an MCP server only a short default env plus `env_vars`: name every variable of codex's own env, so the
  // worca server gets what a Claude chat's child inherits (proxy, CA bundle, WORCA_CODEX_BIN, codex's own keys…).
  const mcp = codexMcpOverrides(mcpServers, { passEnv: Object.keys(env) });
  // The endpoint's key and headers join codex's env only now, so no MCP server is handed them.
  if (endpoint) { Object.assign(env, endpoint.env); extra.push(...endpoint.args); }
  const args = buildCodexArgs({ systemPrompt: sys, model: endpoint ? endpoint.model : model, effort, resumeThreadId: thread, addDirs: dirs, sandbox, mcp: [...mcp.args, ...extra],
    ...(askLockdown ? { lockdown, images } : {}) });
  let sawThread = thread;
  // The thread's usage once the spawn ends, stored for the next resume. `exec --json` reports usage only on
  // `turn.completed`: a turn that ended without it (the turn cap, an abort, a failed turn) still ran, and codex recorded
  // its usage in the thread's session file. That spend is booked as this spawn's result (its stop or failure is still
  // what the spawn throws), and stored, so the next resume is charged only its own turn.
  const settleUsage = () => {
    const f = normalizer.finish();
    if (!sawThread) return f;
    const now = f.completed ? null : codexRolloutUsage(home, sawThread);
    if (now) {
      const delta = diffUsage(now, f.cumulativeUsage);
      if (Object.values(delta).some((v) => v > 0)) {
        const cost = endpoint ? null : estimateCodexCostUsd(model, delta);
        safeEmit(onEvent, { type: 'result', subtype: 'error_during_execution', isError: true, text: '', usage: claudeStyleUsage(delta),
          ...(cost != null ? { costUsd: cost } : {}) });
      }
    }
    const usage = now || f.cumulativeUsage;
    if (usage) storeUsage(usageDir, sawThread, usage);
    return f;
  };
  // maxTurns: the main agent's tool calls (sub-agent calls do not count). An Ask chat's cap is its watchdog's alone
  // (turn.mjs _watch): it reads the live limit and ends the turn as a stop with the limit notice, so a spawn-time
  // count here could only trip first, with a different number, as an error.
  const cap = !askLockdown && Number.isInteger(maxTurns) && maxTurns > 0 ? maxTurns : null;
  const capCtrl = new AbortController();
  let toolCalls = 0; let capped = false;
  const spawnSignal = cap ? (signal ? AbortSignal.any([signal, capCtrl.signal]) : capCtrl.signal) : signal;
  const res = await superviseSpawn({
    file: bin, args, displayBin: bin, cwd, env, stdin, signal: spawnSignal, asAgent, stagedDir: null, onEvent,
    cleanup: () => { if (roleFile) rmSync(roleFile, { force: true }); },
    stdoutErrorDetail: () => normalizer.finish().error || '',
    classify: (m) => classifyCodexError(m),
    spawnError: (err, pfx) => Object.assign(new Error(`${pfx}: ${err.message}`), { errorClass: /ENOENT|EINVAL/.test(String(err.code || err.message)) ? 'network' : null }),
    onDone: (code) => ({ code }),
    onStdoutLine: (line) => {
      for (const e of normalizer.push(line)) {
        safeEmit(onEvent, e);
        if (cap && !capped && e.type === 'tool' && (e.parentId ?? null) === null && (toolCalls += Array.isArray(e.calls) ? e.calls.length : 1) > cap) {
          capped = true; capCtrl.abort();
        }
        if (e.type === 'session') {
          sawThread = codexThreadOf(e.sessionId);
          // Pause/Resume: the runner's own session event (no `init`) is the one the
          // harness stamps on the step, as the Claude adapter does.
          safeEmit(onEvent, { type: 'session', sessionId: e.sessionId });
        }
      }
    },
  }).catch((err) => {
    const f = settleUsage();
    if (capped && !signal?.aborted) throw redacted(Object.assign(new Error(`${bin}: stopped after ${cap} tool calls (the turn cap)`), { turnCap: true }));
    // codex writes tracing lines to stderr for recoverable tool errors (a rejected
    // patch), so a non-zero exit's stderr detail and class can miss the failure the
    // turn reported on stdout (a usage limit, a 429): that one leads, and its class
    // counts too.
    if (f.error && err?.name !== 'AbortError' && err?.stream === 'err') {
      err.message = `${bin}: ${f.error} — ${err.message}`;
      err.errorClass = strongestClass(err.errorClass ?? null, classifyCodexError(f.error));
    }
    throw redacted(err);
  });
  const final = settleUsage();
  // The cap tripped while codex was already finishing: the turn still went past it.
  if (capped && !signal?.aborted) throw redacted(Object.assign(new Error(`${bin}: stopped after ${cap} tool calls (the turn cap)`), { turnCap: true }));
  if (final.error) {
    const err = new Error(`${bin}: ${final.error}`);
    err.errorClass = classifyCodexError(final.error);
    throw redacted(err);
  }
  return { text: redactor ? redactor.text(final.text) : final.text, exitCode: res.code };
}
