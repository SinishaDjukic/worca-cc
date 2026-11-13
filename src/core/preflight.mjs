// src/core/preflight.mjs
// Detect optional knowledge-graph tooling in the user's environment so agents
// can be told to use it. Two tools are supported:
//   - graphify              (github.com/safishamsi/graphify)
//   - code-review-graph     (github.com/tirth8205/code-review-graph)
//
// Rule: if BOTH are present, prefer graphify.
//
// Every probe is wrapped so that a missing binary, missing file, or failing
// subprocess resolves to `false` and NEVER throws.

import { spawn, spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { constants as FS, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { gitAvailable } from './git-available.mjs';
import { guardedGitEnvSync } from './git-guard.mjs';
import { withNoGitPath } from './nogit-stub.mjs';
import { cmpVersions } from './preflight-node.mjs';
import { CLAUDE_AGENTS_FILE_MIN } from './session-mode.mjs';
import { isNativeExe, resolveCliBin, explainUnspawnableCli, _testing as resolverTesting } from './cli-resolve.mjs';
import { CLAUDE_CLI, NPM_CLAUDE_EXE_SEGMENTS } from './engines/cli-specs.mjs';

const _probeChildren = new Set();
/** Test seam: kill the probes still running (each resolves null), so a stopped run's preflight cannot hold a test process open. */
export function _stopToolProbes() { for (const child of _probeChildren) { try { child.kill('SIGKILL'); } catch { /* gone */ } } }

/**
 * Run a command and resolve to its trimmed stdout, or null on any failure.
 * Times out defensively so a hung probe can't block preflight.
 */
function execSafe(cmd, args, { timeout = 4000 } = {}) {
  return new Promise((resolveP) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: withNoGitPath(process.env) });
    } catch {
      resolveP(null);
      return;
    }
    _probeChildren.add(child);
    let out = '';
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      _probeChildren.delete(child);
      resolveP(val);
    };
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      done(null);
    }, timeout);

    child.stdout?.on('data', (d) => {
      out += d.toString();
    });
    // Drain stderr so the child can't block on a full pipe.
    child.stderr?.on('data', () => {});
    child.on('error', () => done(null));
    child.on('close', (code) => done(code === 0 ? out.trim() : null));
  });
}

/** True if `which <name>` resolves to a path. */
async function whichOk(name) {
  const out = await execSafe('which', [name]);
  return typeof out === 'string' && out.length > 0;
}

/** True if a filesystem path is accessible. */
async function pathExists(p) {
  try {
    await access(p, FS.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** True if `pipx list` output mentions `needle` (case-insensitive). */
async function pipxMentions(needle) {
  const out = await execSafe('pipx', ['list']);
  return !!out && out.toLowerCase().includes(needle.toLowerCase());
}

/** True if `pip show <pkg>` (or pip3) reports an installed package. */
async function pipShows(pkg) {
  for (const pip of ['pip', 'pip3']) {
    const out = await execSafe(pip, ['show', pkg]);
    if (out && out.toLowerCase().includes('name:')) return true;
  }
  return false;
}

const PROBE_TTL_MS = 60_000;
const _cliProbes = new Map();
/** Test seam: forget the memoized CLI probes. */
export function _resetToolProbeCache() { _cliProbes.clear(); }
function cliProbes(now = Date.now()) {
  const key = process.env.PATH || '';
  const hit = _cliProbes.get(key);
  if (hit && now - hit.at < PROBE_TTL_MS) return hit.value;
  const value = (async () => {
    const [graphify, crg] = await Promise.all([
      (async () => (await whichOk('graphify')) || (await pipxMentions('graphify')) || (await pipShows('graphify')))(),
      (async () => (await Promise.all([whichOk('code-review-graph'), pipxMentions('code-review-graph'), pipShows('code-review-graph')])).some(Boolean))(),
    ]);
    return { graphify, crg };
  })().catch(() => ({ graphify: false, crg: false }));
  _cliProbes.set(key, { at: now, value });
  return value;
}

/**
 * Detect graphify and HOW it is installed. Returns:
 *   { found: boolean, kind: 'cli'|'skill'|'output-cached'|null }
 *
 * The `kind` controls the instruction wording so the agent picks the right
 * dispatch mechanism (Bash CLI vs Skill tool vs read cached output). Priority:
 *   1. `which graphify`            → 'cli'   (executable on PATH)
 *   2. pipx / pip shows graphify   → 'cli'   (importable / on PATH soon)
 *   3. ~/.claude/skills/graphify/  → 'skill' (Claude Code skill, no binary)
 *   4. <projectDir>/graphify-out   → 'output-cached' (graph exists from prior run)
 *
 * Ordering matters: a host with both a CLI and a skill prefers the CLI because
 * an agent can drive it directly. An `output-cached` win is the weakest — it
 * means a graph exists but we don't know how it was built.
 */
async function detectGraphify(projectDir) {
  if ((await cliProbes()).graphify) return { found: true, kind: 'cli' };
  if (await pathExists(join(homedir(), '.claude', 'skills', 'graphify', 'SKILL.md'))) {
    return { found: true, kind: 'skill' };
  }
  if (await pathExists(join(projectDir, 'graphify-out'))) {
    return { found: true, kind: 'output-cached' };
  }
  return { found: false, kind: null };
}

/**
 * Detect code-review-graph. ANY of:
 *  - `which code-review-graph`
 *  - pipx list / pip show code-review-graph mentions it
 *  - a cloned dir named code-review-graph reachable (cwd or home)
 */
async function detectCodeReviewGraph(projectDir) {
  const checks = await Promise.all([
    cliProbes().then((p) => p.crg),
    pathExists(join(projectDir, 'code-review-graph')),
    pathExists(join(homedir(), 'code-review-graph')),
  ]);
  return checks.some(Boolean);
}

/**
 * Build the human-readable instruction injected into agent system prompts.
 * The wording is branched by `kind` so the agent uses the right dispatch
 * mechanism (Bash CLI, Skill tool, or simply reading cached output).
 */
export function buildInstruction(tool, kind) {
  if (tool === 'graphify') {
    if (kind === 'skill') {
      return (
        'A code knowledge-graph SKILL named "graphify" is available. It is a ' +
        'Claude Code skill, NOT a shell command — do NOT try to run it via Bash. ' +
        'BEFORE analyzing or planning, invoke it via the `Skill` tool, e.g. ' +
        '`Skill(skill: "graphify", args: "<your question about the code>")`. ' +
        'Use its output to ground your work in real codebase structure rather ' +
        'than assumptions. A cached graph may already exist at ' +
        'graphify-out/ — consult it if present.'
      );
    }
    if (kind === 'output-cached') {
      return (
        'A graphify knowledge graph has ALREADY been built for this project at ' +
        'graphify-out/. No graphify binary or Skill was detected, so ' +
        'do NOT try to invoke or rebuild it — just READ the cached output. BEFORE ' +
        'analyzing or planning, read graphify-out/GRAPH_REPORT.md for the overview, ' +
        'then open graphify-out/graph.json to trace specific symbols and their ' +
        'edges, so your understanding is grounded in real structure rather than ' +
        'assumptions.'
      );
    }
    // 'cli' (or unspecified, treated as CLI for safety).
    // `graphify query` does literal token-matching to pick BFS start nodes, so a
    // natural-language PHRASE matches almost nothing (only stray tokens, often in
    // test files) and yields noise — which makes agents give up and fall back to
    // grep. The instruction therefore teaches one-concept-at-a-time querying and
    // points at the already-built graph instead of a nonexistent build command.
    return (
      'A code knowledge-graph CLI named "graphify" is available on PATH, and a ' +
      'graph has ALREADY been built at graphify-out/ (do NOT rebuild). ' +
      'BEFORE analyzing or planning, ground yourself in the real codebase: first ' +
      'read graphify-out/GRAPH_REPORT.md for the overview, then query the graph ' +
      'via Bash. Query ONE concept at a time — a single symbol or term, NOT a ' +
      'natural-language phrase (phrases match almost nothing and return noise). ' +
      'Useful commands:\n' +
      '  graphify query "<concept>"    # BFS neighborhood of one term, e.g. "effort"\n' +
      '  graphify explain "<symbol>"   # one node plus its direct connections\n' +
      '  graphify path "<A>" "<B>"     # how two symbols are connected\n' +
      'Run several single-concept queries rather than one long one. Use ' +
      'Glob/Grep/Read only for what the graph cannot answer.'
    );
  }
  if (tool === 'code-review-graph') {
    return (
      'A code-analysis CLI named "code-review-graph" is available in this ' +
      'environment. Run it via Bash to build a graph of the codebase and inform ' +
      'your analysis, planning, and review with its output rather than relying ' +
      'on assumptions about code structure.'
    );
  }
  return '';
}

/**
 * Instruction for agents when an AST graph has been built INSIDE the current
 * worktree at ./graphify-out/. Paths are cwd-relative (agents run with
 * cwd=worktree); the AST-only nature is called out so agents calibrate. The
 * graph is built once, at run start, and every later step gets this same text,
 * so it says when the graph was built instead of calling it fresh, and how to
 * refresh it (GRAPH_REPORT.md's own header asks for `graphify update .` too).
 */
export function worktreeGraphInstruction() {
  return (
    'A code knowledge-graph CLI named "graphify" is available, and a graph of this ' +
    'worktree, built at the start of this run, is at graphify-out/ (relative to your ' +
    'working directory). It does not show changes made since; run ' +
    '`graphify update .` first if you need them. ' +
    'It is an AST-only structural graph (symbols, files, and their ' +
    'structural relationships) with NO semantic/inferred edges. BEFORE analyzing ' +
    'or planning, ground yourself in the real code: first read ' +
    'graphify-out/GRAPH_REPORT.md for the overview, then query the graph via Bash. ' +
    'Query ONE concept at a time — a single symbol or term, NOT a natural-language ' +
    'phrase (phrases match almost nothing and return noise). Useful commands:\n' +
    '  graphify query "<concept>"    # BFS neighborhood of one term\n' +
    '  graphify explain "<symbol>"   # one node plus its direct connections\n' +
    '  graphify path "<A>" "<B>"     # how two symbols are connected\n' +
    'Run several single-concept queries. Use Glob/Grep/Read for anything the ' +
    'graph cannot answer.'
  );
}

/**
 * Run `graphify update <dir>` headlessly to build/refresh an AST graph at
 * <dir>/graphify-out/. Spawned with cwd=cwd so graphify's stray cwd-relative
 * manifest write lands inside the same worktree, never the main repo. Bounded
 * by timeoutMs (macOS has no timeout(1)); on overrun the child is SIGKILLed,
 * and so it is when `signal` aborts. Never throws. Resolves { ok, code, timedOut, stderr }.
 *
 * Before the build, <dir>/graphify-out/.gitignore = `*` makes the output ignore
 * itself (the memory mount's sentinel, memory-sync.mjs mountMemory): a target
 * repo that does not gitignore graphify-out/ would otherwise get the graph in
 * the reviewer diff, an agent's `git add -A` and the kept-branch commit. The
 * sentinel ignores itself too, so it never reaches a commit. A repo that already
 * tracks files under graphify-out/ gets no sentinel (it commits its graph on
 * purpose). A failed write is not fatal: the build runs as before.
 */
export function runGraphifyUpdate({ dir, cwd, timeoutMs = 120000, signal } = {}) {
  try {
    if (!existsSync(dir)) throw new Error('no dir');
    // A repo that commits its graph keeps doing so: hiding only the NEW files would commit half a graph.
    const tracked = gitAvailable() ? spawnSync('git', ['ls-files', '--', 'graphify-out'], { cwd: dir, encoding: 'utf8', timeout: 10000, env: guardedGitEnvSync(dir) }) : null;
    if (!(tracked && tracked.status === 0 && tracked.stdout.trim())) {
      mkdirSync(join(dir, 'graphify-out'), { recursive: true });
      writeFileSync(join(dir, 'graphify-out', '.gitignore'), '*\n', 'utf8');
    }
  } catch { /* the build still runs; the output is just not hidden */ }
  return new Promise((resolveP) => {
    let child;
    try {
      child = spawn('graphify', ['update', dir], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolveP({ ok: false, code: -1, timedOut: false, stderr: err.message });
      return;
    }
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolveP(val);
    };
    const kill = () => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
      done({ ok: false, code: -1, timedOut: true, stderr: 'graphify update timed out' });
    }, timeoutMs);
    // signal: the caller stops the build (a run's teardown); resolves once the process has exited.
    const onAbort = () => kill();
    if (signal?.aborted) kill(); else signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', () => {});
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => done({ ok: false, code: -1, timedOut, stderr: stderr || err.message }));
    child.on('close', (code) => done({ ok: code === 0, code: code ?? -1, timedOut, stderr }));
  });
}

/**
 * Detect optional tooling for a project directory.
 * @param {string} projectDir
 * @returns {Promise<{
 *   graphify:boolean,
 *   codeReviewGraph:boolean,
 *   tool:('graphify'|'code-review-graph'|null),
 *   kind:('cli'|'skill'|'output-cached'|null),
 *   instruction:string,
 * }>}
 */
export async function detectTools(projectDir) {
  const dir = projectDir || process.cwd();
  let graphifyInfo = { found: false, kind: null };
  let codeReviewGraph = false;
  try {
    [graphifyInfo, codeReviewGraph] = await Promise.all([
      detectGraphify(dir),
      detectCodeReviewGraph(dir),
    ]);
  } catch {
    // Absolute belt-and-suspenders: detection must never throw.
    graphifyInfo = { found: false, kind: null };
    codeReviewGraph = false;
  }
  // BOTH installed => prefer graphify.
  const tool = graphifyInfo.found ? 'graphify' : codeReviewGraph ? 'code-review-graph' : null;
  const kind = tool === 'graphify' ? graphifyInfo.kind : tool === 'code-review-graph' ? 'cli' : null;
  return {
    graphify: graphifyInfo.found,
    codeReviewGraph,
    tool,
    kind,
    instruction: buildInstruction(tool, kind),
  };
}

/**
 * Detect tooling for EACH project in a workspace, in parallel. A trivial
 * Promise.all over detectTools, returning a Map keyed by projectDir so the
 * orchestrator can grant each member its own per-project graph instruction.
 * detectTools never throws, so this never throws. Member order is irrelevant
 * (the Map is keyed by dir); the caller iterates by sorted projectKey.
 * @param {string[]} projectDirs
 * @returns {Promise<Map<string,{tool,kind,instruction}>>}
 */
export async function detectToolsPerProject(projectDirs) {
  const dirs = Array.isArray(projectDirs) ? projectDirs : [];
  const infos = await Promise.all(dirs.map((dir) => detectTools(dir)));
  const map = new Map();
  dirs.forEach((dir, i) => map.set(dir, infos[i]));
  return map;
}

/**
 * §8.18 / Phase-0 gate V5: parse `claude --help` ONCE per run and assert that this
 * build advertises `--mcp-config`. Version drift, not a CLI unknown — V5 PASSED on
 * the development machine (`claude --help` line 113,
 * `docs/run-root-verification.md`), so this ships as insurance for OTHER machines.
 *
 * On absence the caller degrades gracefully (skip the flag, warn loudly naming the
 * required version >= 2.1.220) rather than failing the run: R1(a)/(c) still hold via
 * the cwd and ancestor mechanisms, and R1(b) is reported as DEGRADED.
 *
 * No `addDir` preflight probe: Ask Worca's memory mount passes `--add-dir`
 * (claude-runner `addDirs`), verified by the 2026-09-13 rules probe, not by preflight.
 *
 * Never throws: a missing binary / hung process resolves to
 * `{ mcpConfig: false, version: null }`, which the caller treats the same as an old
 * CLI. (A machine with no `claude` on PATH fails loudly at the first node anyway.)
 * @param {string} [bin] the claude binary (defaults to `claude`)
 * @returns {Promise<{mcpConfig: boolean, version: string|null}>}
 */
// ── Windows: the executable behind a bare `claude` ────────────────────────────
// Native Windows resolves a bare name on PATH to `.exe` only, and Node refuses
// to run .cmd/.bat shims without a shell (CVE-2024-27980). The shared resolver
// (cli-resolve.mjs, spec CLAUDE_CLI) finds the npm package's native claude.exe
// next to the shim; these wrappers keep Claude's long-standing names and shapes.

export { NPM_CLAUDE_EXE_SEGMENTS, isNativeExe };

/** Test seam: delegates to the shared resolver's (PE check swap, memo clear). */
export const _testing = {
  set(o) { resolverTesting.set(o); },
  reset() { resolverTesting.reset(); },
};

/**
 * The executable to spawn for the configured Claude `bin` on THIS host: `bin`
 * unchanged off Windows or when a real .exe is reachable; the npm package's
 * native claude.exe when the only PATH hit is npm's shim. See cli-resolve.mjs.
 * @param {string} [bin]
 * @param {object} [opts] injectable platform/pathEnv/exists/isNativeExe
 * @returns {{bin:string, source:'as-is'|'exe'|'npm'|'shim-exe', note:string|null}}
 */
export function resolveClaudeBin(bin = 'claude', opts = {}) {
  const { bin: out, source, note } = resolveCliBin(bin, CLAUDE_CLI, opts);
  return { bin: out, source, note };
}

/** Why the configured Claude cannot be spawned on THIS host, or null. Never throws. */
export function explainUnspawnableClaude(bin = 'claude', o = {}) {
  return explainUnspawnableCli(bin || 'claude', CLAUDE_CLI, o);
}

export async function probeClaudeCapabilities(bin = 'claude') {
  const name = bin && String(bin).trim() ? String(bin).trim() : 'claude';
  const exe = resolveClaudeBin(name).bin; // same resolution as the runner's spawn (npm shim → native .exe)
  const help = await execSafe(exe, ['--help'], { timeout: 8000 });
  const raw = await execSafe(exe, ['--version'], { timeout: 8000 });
  const version = raw ? (/(\d+\.\d+\.\d+)/.exec(raw)?.[1] ?? raw.split(/\s+/)[0] ?? null) : null;
  // pluginDir (skills registry §4.1): a set's skills reach a spawn only through --plugin-dir.
  // Session groups (Task 29): a host spawn needs --forward-subagent-text (by --help) and `--agents <file>` (by version,
  // 2.1.281). Never probe --max-turns or --append-subagent-system-prompt by --help: both are hidden there on 2.1.308 but
  // accepted by the binary (verify suggestion 9).
  return { mcpConfig: !!help && help.includes('--mcp-config'), pluginDir: !!help && help.includes('--plugin-dir'), version,
    forwardSubagentText: !!help && help.includes('--forward-subagent-text'),
    agentsFile: !!version && cmpVersions(version, CLAUDE_AGENTS_FILE_MIN) >= 0 };   // the floor the worker check (claude.mjs) uses too
}

// ── Is the Claude Code CLI signed in? ─────────────────────────────────────────
// Finding the binary is not enough: a signed-out CLI starts, then every agent
// exits 1 with "Not logged in" (a workspace scan got ~30 s into its first phase
// before failing). probeClaudeAuth asks `claude auth status` up front.
//
// Only 'signed-out' may ever block anything. 'unknown' — an older CLI without the
// `auth` command, a hang, unparseable output — never does, so a probe gap can
// only fall back to today's behaviour, never refuse a working setup.

/** Env vars that authenticate the CLI without a stored sign-in, which `claude
 *  auth status` does not (reliably) report: a custom endpoint or the model bridge
 *  (ANTHROPIC_AUTH_TOKEN), an API key or OAuth token, and the cloud transports
 *  (Bedrock / Vertex / Foundry). ANTHROPIC_BASE_URL is not one: it says where
 *  calls go, and the CLI still answers "Not logged in" without a credential. */
export const CLAUDE_AUTH_ENV_KEYS = Object.freeze([
  'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN',
]);
export const CLAUDE_AUTH_ENV_FLAGS = Object.freeze([
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
]);

const flagOn = (v) => !!v && v !== '0' && String(v).toLowerCase() !== 'false';

/** The first env var that signs the CLI in on its own, or null. Pure. */
export function claudeAuthFromEnv(env = process.env) {
  for (const k of CLAUDE_AUTH_ENV_KEYS) if (typeof env[k] === 'string' && env[k].trim()) return k;
  for (const k of CLAUDE_AUTH_ENV_FLAGS) if (flagOn(env[k])) return k;
  return null;
}

/**
 * Read `claude auth status` output (JSON by default, `--text` on some builds).
 * @param {string} text  stdout + stderr
 * @returns {'signed-in'|'signed-out'|'unknown'}
 */
export function parseClaudeAuthStatus(text) {
  const s = String(text || '').trim();
  if (!s) return 'unknown';
  const json = /\{[\s\S]*\}/.exec(s);
  if (json) {
    try {
      const o = JSON.parse(json[0]);
      if (o && typeof o.loggedIn === 'boolean') return o.loggedIn ? 'signed-in' : 'signed-out';
    } catch { /* fall through to the text forms */ }
  }
  if (/\bnot (logged|signed) in\b|\blogged out\b|\bsigned out\b/i.test(s)) return 'signed-out';
  if (/\b(logged|signed) in\b/i.test(s)) return 'signed-in';
  return 'unknown';
}

/** Run a command with any exit code: resolves {code, out} (stdout+stderr), or
 *  null on a spawn failure / timeout. `auth status` exits non-zero when signed out. */
function execAnyExit(cmd, args, { timeout = 8000 } = {}) {
  return new Promise((resolveP) => {
    let child;
    try { child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: withNoGitPath(process.env) }); }
    catch { resolveP(null); return; }
    let out = '';
    let settled = false;
    const done = (val) => { if (settled) return; settled = true; clearTimeout(timer); resolveP(val); };
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } done(null); }, timeout);
    child.stdout?.on('data', (d) => { out += d.toString(); });
    child.stderr?.on('data', (d) => { out += d.toString(); });
    child.on('error', () => done(null));
    child.on('close', (code) => done({ code, out }));
  });
}

/** The refusal every surface shows for a signed-out CLI (the API's `code`, and its text). */
export const CLAUDE_SIGNED_OUT_CODE = 'claude-signed-out';
export const CLAUDE_SIGNED_OUT_MESSAGE = "Claude Code isn't signed in. Run `claude` in a terminal and type /login, then try again.";

/** Is `message` the CLI's own signed-out failure ("Not logged in · Please run
 *  /login")? For surfaces that only learn it after the spawn. Pure. */
export function isClaudeSignedOutError(message) {
  return /\bnot logged in\b|please run \/login/i.test(String(message || ''));
}

export const CLAUDE_AUTH_TTL_MS = 60_000;
const _authCache = new Map();   // exe -> { at, promise }

/** Test seam: forget remembered answers. */
export function clearClaudeAuthCache() { _authCache.clear(); }

/**
 * Is the Claude Code CLI signed in? Never throws.
 *  - mock mode: never starts claude → {state:'unknown', source:'mock'}
 *  - an auth env var (see CLAUDE_AUTH_ENV_KEYS / _FLAGS) → {state:'signed-in', source:'env'}
 *  - otherwise `claude auth status`, remembered per binary for CLAUDE_AUTH_TTL_MS
 *    (concurrent callers share one spawn); `force` skips the remembered answer.
 * @param {{bin?:string, env?:Record<string,string|undefined>, mock?:boolean, force?:boolean,
 *   now?:()=>number, run?:(exe:string, args:string[])=>Promise<{code:number,out:string}|null>}} [o]
 * @returns {Promise<{state:'signed-in'|'signed-out'|'unknown', source:'mock'|'env'|'cli', detail:string|null}>}
 */
export async function probeClaudeAuth({
  bin = 'claude', env = process.env, mock, force = false, now = Date.now, run = execAnyExit,
} = {}) {
  const isMock = mock ?? (flagOn(env.WORCA_MOCK ?? env.ORCH_MOCK));
  if (isMock) return { state: 'unknown', source: 'mock', detail: null };
  // Credential broker (broker-client.mjs): the CLI is signed in per spawn with a
  // broker token, never by worca's env or a stored login. Whether the PERSON has a
  // key is the broker's per-slot status, not this probe's question.
  if (typeof env.WORCA_BROKER_URL === 'string' && env.WORCA_BROKER_URL.trim()) return { state: 'signed-in', source: 'broker', detail: 'broker' };
  const envKey = claudeAuthFromEnv(env);
  if (envKey) return { state: 'signed-in', source: 'env', detail: envKey };
  const name = bin && String(bin).trim() ? String(bin).trim() : 'claude';
  const exe = resolveClaudeBin(name).bin;
  const hit = _authCache.get(exe);
  if (!force && hit && now() - hit.at < CLAUDE_AUTH_TTL_MS) return hit.promise;
  const promise = Promise.resolve()
    .then(() => run(exe, ['auth', 'status']))
    .then((r) => ({ state: r ? parseClaudeAuthStatus(r.out) : 'unknown', source: 'cli', detail: null }))
    .catch(() => ({ state: 'unknown', source: 'cli', detail: null }));
  _authCache.set(exe, { at: now(), promise });
  return promise;
}
