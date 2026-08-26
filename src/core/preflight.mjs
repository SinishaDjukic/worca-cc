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

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { constants as FS, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';

/**
 * Run a command and resolve to its trimmed stdout, or null on any failure.
 * Times out defensively so a hung probe can't block preflight.
 */
function execSafe(cmd, args, { timeout = 4000 } = {}) {
  return new Promise((resolveP) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      resolveP(null);
      return;
    }
    let out = '';
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
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
  if (await whichOk('graphify')) return { found: true, kind: 'cli' };
  if (await pipxMentions('graphify')) return { found: true, kind: 'cli' };
  if (await pipShows('graphify')) return { found: true, kind: 'cli' };
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
    whichOk('code-review-graph'),
    pipxMentions('code-review-graph'),
    pipShows('code-review-graph'),
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
 * Instruction for agents when a fresh AST graph has been built INSIDE the
 * current worktree at ./graphify-out/. Paths are cwd-relative (agents run with
 * cwd=worktree); the AST-only nature is called out so agents calibrate.
 */
export function worktreeGraphInstruction() {
  return (
    'A code knowledge-graph CLI named "graphify" is available, and a fresh graph ' +
    'for THIS worktree has been built at graphify-out/ (relative to your working ' +
    'directory). It is an AST-only structural graph (symbols, files, and their ' +
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
 * by timeoutMs (macOS has no timeout(1)); on overrun the child is SIGKILLed.
 * Never throws. Resolves { ok, code, timedOut, stderr }.
 */
export function runGraphifyUpdate({ dir, cwd, timeoutMs = 120000 } = {}) {
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
      resolveP(val);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      done({ ok: false, code: -1, timedOut: true, stderr: 'graphify update timed out' });
    }, timeoutMs);
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
 * Deliberately NO `addDir` field: `--add-dir` is not probed because no shipped
 * feature uses it (§5.3 — it needs `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`
 * to carry memory at all, E2), and a probe field no consumer reads is dead weight.
 *
 * Never throws: a missing binary / hung process resolves to
 * `{ mcpConfig: false, version: null }`, which the caller treats the same as an old
 * CLI. (A machine with no `claude` on PATH fails loudly at the first node anyway.)
 * @param {string} [bin] the claude binary (defaults to `claude`)
 * @returns {Promise<{mcpConfig: boolean, version: string|null}>}
 */
// ── Windows: the executable behind a bare `claude` ────────────────────────────
// Native Windows resolves a bare name on PATH to `.exe` only, and Node refuses
// to run .cmd/.bat shims without a shell (CVE-2024-27980). The npm install of
// Claude Code (>= 2.1 — every version Worca supports) puts a `claude.cmd` shim
// on PATH whose target is a REAL native binary at npm's fixed layout:
//   <shim dir>\node_modules\@anthropic-ai\claude-code\bin\claude.exe
// (the package's postinstall copies the platform binary over a ~500-byte text
// placeholder there). resolveClaudeBin() spawns that .exe directly — no shell,
// correct kill target, no quoting surface — and explainUnspawnableClaude()
// covers the cases where that is not possible.

export const NPM_CLAUDE_EXE_SEGMENTS = Object.freeze(['node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe']);

/** A real PE executable (MZ header, bigger than npm's placeholder stub). */
export function isNativeExe(p) {
  try {
    const st = statSync(p);
    if (!st.isFile() || st.size < 4096) return false;
    const fd = openSync(p, 'r');
    try {
      const head = Buffer.alloc(2);
      readSync(fd, head, 0, 2, 0);
      return head.toString('latin1') === 'MZ';
    } finally { closeSync(fd); }
  } catch { return false; }
}

const _ov = { isNativeExe: null };
const _resolveCache = new Map();
/** Test seam (mirrors folder-dialog.mjs): swap the PE check so an end-to-end
 *  test on a POSIX host can stand in a shell script for claude.exe. */
export const _testing = {
  set({ isNativeExe: native = _ov.isNativeExe } = {}) { _ov.isNativeExe = native; _resolveCache.clear(); },
  reset() { _ov.isNativeExe = null; _resolveCache.clear(); },
};

/** What `bin` reaches on a Windows PATH: a real .exe (spawn works as-is), the
 *  shims found, and — next to the FIRST shim — the npm package's native binary
 *  when present, with whether it is real or still the placeholder. */
function probeWindowsClaude(bin, { pathEnv, exists, native }) {
  const name = String(bin || 'claude').trim() || 'claude';
  const ok = (p) => { try { return !!exists(p); } catch { return false; } }; // a probe error is "absent"
  const out = { name, exe: null, shims: [], npm: null };
  if (/\.exe$/i.test(name)) { out.exe = name; return out; }       // explicit .exe: nothing to resolve
  const explicitPath = /[\\/]/.test(name);
  const shimExt = /\.(cmd|bat|ps1)$/i.test(name);
  const stems = explicitPath ? [name] : pathEnv.split(';').filter(Boolean).map((d) => join(d, name));
  for (const stem of stems) {
    if (!shimExt && ok(stem + '.exe')) { out.exe = stem + '.exe'; return out; }
    for (const ext of shimExt ? [''] : ['.cmd', '.bat', '.ps1']) {
      const shim = stem + ext;
      if (!ok(shim)) continue;
      out.shims.push(shim);
      if (!out.npm) {
        const candidate = join(dirname(shim), ...NPM_CLAUDE_EXE_SEGMENTS);
        if (ok(candidate)) out.npm = { exe: candidate, native: !!native(candidate) };
      }
    }
  }
  return out;
}

/**
 * The executable to spawn for `bin` on THIS host. Off Windows, and whenever a
 * real .exe is reachable, that is `bin` unchanged (spawn's own PATH lookup is
 * correct). When the only PATH hit is npm's .cmd shim and the package's native
 * claude.exe sits next to it, that .exe is returned instead — with a one-line
 * `note` for the log. Otherwise `bin` unchanged again, and the spawn's ENOENT
 * is what explainUnspawnableClaude() turns into an actionable message.
 *
 * Pure with injected platform/pathEnv/exists/isNativeExe; the default
 * (uninjected) resolution is memoised per bin+PATH — PATH does not change under
 * a running process, and the probe is a handful of stat()s per spawn otherwise.
 * @param {string} [bin]
 * @param {{platform?:string, pathEnv?:string, exists?:(p:string)=>boolean, isNativeExe?:(p:string)=>boolean}} [opts]
 * @returns {{bin:string, source:'as-is'|'exe'|'npm', note:string|null}}
 */
export function resolveClaudeBin(bin = 'claude', opts = {}) {
  const platform = opts.platform ?? process.platform;
  if (platform !== 'win32') return { bin, source: 'as-is', note: null };
  const pathEnv = opts.pathEnv ?? (process.env.PATH ?? '');
  const injected = Object.keys(opts).length > 0;
  const key = `${bin}\0${pathEnv}`;
  if (!injected && _resolveCache.has(key)) return _resolveCache.get(key);
  const p = probeWindowsClaude(bin, {
    pathEnv, exists: opts.exists ?? existsSync, native: opts.isNativeExe ?? _ov.isNativeExe ?? isNativeExe,
  });
  let out;
  if (p.exe) out = { bin, source: 'exe', note: null };
  else if (p.npm && p.npm.native) {
    out = { bin: p.npm.exe, source: 'npm', note:
      `using the npm-installed Claude Code binary ${p.npm.exe} ("${p.name}" on PATH is npm's .cmd shim, which Node cannot spawn directly)` };
  } else out = { bin, source: 'as-is', note: null };
  if (!injected) _resolveCache.set(key, out);
  return out;
}

/**
 * Why a bare `claude` cannot be spawned on THIS host, or null when the generic
 * error is the whole story (or when resolveClaudeBin() would have handled it).
 * Two Windows cases get an actionable message: the npm shim with the package's
 * binary still being the postinstall placeholder, and a shim with no native
 * binary next to it at all (non-npm layout, or a pre-native package).
 *
 * Pure: platform / PATH / existence / PE check are injectable. Never throws.
 * @param {string} [bin] the configured claude binary (name or path)
 * @param {{platform?:string, pathEnv?:string, exists?:(p:string)=>boolean, isNativeExe?:(p:string)=>boolean}} [o]
 * @returns {string|null}
 */
export function explainUnspawnableClaude(bin = 'claude', {
  platform = process.platform,
  pathEnv = process.env.PATH ?? '',
  exists = existsSync,
  isNativeExe: native = _ov.isNativeExe ?? isNativeExe,
} = {}) {
  if (platform !== 'win32') return null;
  const p = probeWindowsClaude(bin, { pathEnv, exists, native });
  if (p.exe || !p.shims.length) return null;           // a real exe, or a plain "not installed"
  if (p.npm && p.npm.native) return null;               // resolveClaudeBin() spawns this one — not a failure
  const base = `"${p.name}" resolves to a script shim (${p.shims[0]}) — the npm install of Claude Code. ` +
    'Windows only launches a .exe by name and Node cannot run a .cmd/.bat shim without a shell. ';
  if (p.npm) {
    const installer = join(dirname(dirname(p.npm.exe)), 'install.cjs');
    return base + `Worca would run the package's native binary instead, but ${p.npm.exe} is still npm's ` +
      `placeholder — the package's postinstall did not run (--ignore-scripts / --omit=optional). Run: node ${installer}, ` +
      'or reinstall Claude Code without those flags.';
  }
  return base + `No native binary was found next to it (${join(dirname(p.shims[0]), ...NPM_CLAUDE_EXE_SEGMENTS)}). ` +
    'Install the native Windows build (irm https://claude.ai/install.ps1 | iex), or set WORCA_CLAUDE_BIN to the full path of claude.exe.';
}

export async function probeClaudeCapabilities(bin = 'claude') {
  const name = bin && String(bin).trim() ? String(bin).trim() : 'claude';
  const exe = resolveClaudeBin(name).bin; // same resolution as the runner's spawn (npm shim → native .exe)
  const help = await execSafe(exe, ['--help'], { timeout: 8000 });
  const raw = await execSafe(exe, ['--version'], { timeout: 8000 });
  const version = raw ? (/(\d+\.\d+\.\d+)/.exec(raw)?.[1] ?? raw.split(/\s+/)[0] ?? null) : null;
  return { mcpConfig: !!help && help.includes('--mcp-config'), version };
}
