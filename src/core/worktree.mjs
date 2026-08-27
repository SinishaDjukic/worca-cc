// src/core/worktree.mjs
// Per-pipeline git worktree isolation. Every helper is async, returns plain data,
// and never throws on missing files / non-zero git exits unless explicitly noted
// (createWorktree throws on a fatal git failure because the run cannot continue).
//
// Layout (legacy, the retained default):
//         <projectDir>/.worca-cc/worktrees/<pipelineId>/   <- checkout
// Layout (detached, caller passes baseDir + checkoutName):
//         <worcaHome>/runs/<pipelineId>/repos/<projectKey>/
// Either way the shared .git store stays in <projectDir>/.git <- no duplication.
//
// Branch naming: callers pass a fully-formed feature branch (e.g. "worca-cc/foo-abc12345")
// OR the orchestrator derives one via suggestBranchName(). sanitizeBranchName is the
// single source of truth for what reaches `git branch`.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, realpath, readdir, rename, stat } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';

import { slugify } from './artifacts.mjs';
// settings.mjs is a leaf (node builtins only), so importing the §10 flag reader here
// adds no dependency on the DB layer — worktree.mjs stays DB-free.
import { runRootMode } from './settings.mjs';
import {
  readRunManifest, rmGuarded, rescueModifiedMounts, scanStrayEntries, copyRunManifestTo,
} from './run-manifest.mjs';

const WORKTREES_DIRNAME = join('.worca-cc', 'worktrees');
const BRANCH_PREFIX = 'worca-cc/';
const MAX_BRANCH_LEN = 80;
// Keep branch names short and readable: at most this many significant words
// survive into the slug (the shortId is appended after).
const MAX_BRANCH_WORDS = 6;
// Generic filler dropped from a prompt-derived slug so the name carries the
// meaningful nouns, not boilerplate. Articles, prepositions, conjunctions,
// pronouns, and the imperative scaffolding that prefixes most task prompts
// ("build a…", "let's create…"). Deliberately conservative — domain verbs like
// add/fix/refactor are kept because they carry intent.
const BRANCH_STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'of', 'for', 'and', 'or', 'in', 'on', 'into', 'with',
  'at', 'by', 'from', 'we', 'i', 'you', 'it', 'that', 'this', 'these', 'those',
  'lets', 'let', 'please', 'just', 'also', 'should', 'would', 'could', 'can',
  'will', 'want', 'wants', 'need', 'needs', 'make', 'build', 'create', 'some',
  'our', 'my',
]);

// Checkout-heavy ops (worktree add/remove) legitimately exceed the default
// 30 s on large repos — give them a longer leash before the SIGKILL deadline.
const SLOW_GIT_TIMEOUT_MS = 120_000;

/** Run git and resolve to { ok, stdout, stderr, code }. Never throws.
 *  `env` is MERGED OVER process.env (never a replacement): the git binary and the
 *  credential helper need PATH/HOME. Only the Ask Worca callers pass it. */
function git(cwd, args, { signal, timeout = 30_000, env, maxBytes = 0 } = {}) {
  return new Promise((res) => {
    let child;
    try {
      child = spawn('git', args, {
        cwd, stdio: ['ignore', 'pipe', 'pipe'], signal,
        ...(env ? { env: { ...process.env, ...env } } : {}),
      });
    } catch (err) {
      res({ ok: false, stdout: '', stderr: err.message, code: -1 });
      return;
    }
    let stdout = '', stderr = '';
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      res(val);
    };
    const timer = timeout > 0
      ? setTimeout(() => {
          try { child.kill('SIGKILL'); } catch {}
          done({ ok: false, stdout, stderr: stderr ? `git timed out: ${stderr}` : 'git timed out', code: -1 });
        }, timeout)
      : null;
    // `maxBytes` caps the CAPTURE (review of PR #376): the Ask `git` tool re-runs a
    // command per `offset` page, so `log -p --all` on a big repo accumulated the
    // whole history in memory every page. Past the cap the child is killed and
    // the result is `ok` with `truncated: true` — the caller says so and pages
    // within what it got.
    let captured = 0;
    let truncated = false;
    child.stdout?.on('data', (b) => {
      if (truncated) return;
      captured += b.length;
      stdout += b.toString();
      if (maxBytes > 0 && captured > maxBytes) {
        truncated = true;
        stdout = Buffer.from(stdout, 'utf8').subarray(0, maxBytes).toString('utf8');
        try { child.kill('SIGKILL'); } catch { /* gone */ }
        done({ ok: true, stdout, stderr, code: 0, truncated: true });
      }
    });
    child.stderr?.on('data', (b) => (stderr += b.toString()));
    child.on('error', (err) => done({ ok: false, stdout, stderr: stderr || err.message, code: -1 }));
    child.on('close', (code) => done({ ok: code === 0, stdout, stderr, code: code ?? -1 }));
  });
}

/**
 * Reduce arbitrary text to a git-safe branch name fragment.
 */
export function sanitizeBranchName(raw) {
  const s = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-/_.]+|[-/_.]+$/g, '');
  return s.slice(0, MAX_BRANCH_LEN);
}

/**
 * Reduce free text to a short, meaningful kebab slug: slugify, drop generic
 * stopwords, keep the first MAX_BRANCH_WORDS significant words. If stopword
 * removal would empty the slug (every word was filler), keep the raw words so
 * we never return nothing. Returns '' only for empty/punctuation-only input.
 */
function keywordSlug(text) {
  const line = firstLine(text);
  if (!line) return ''; // slugify('') yields 'untitled'; let the caller pick 'feature'
  const words = slugify(line).split('-').filter(Boolean);
  if (!words.length) return '';
  const kept = words.filter((w) => !BRANCH_STOPWORDS.has(w));
  return (kept.length ? kept : words).slice(0, MAX_BRANCH_WORDS).join('-');
}

/**
 * Propose a feature branch name WITHOUT an LLM (so preflight stays free and
 * fully deterministic). Title-first: a caller-supplied title is the clearest
 * intent, so slugify it directly; otherwise derive a keyword slug from the
 * prompt's first line. Always returns a sanitized "<prefix><slug>-<shortId>".
 */
export function suggestBranchName({ prompt, title, pipelineId } = {}) {
  const shortId = String(pipelineId || '').slice(0, 8) || 'run';
  // A title is explicit intent — slugify it verbatim (only word-cap for length),
  // never strip stopwords (would mangle deliberate names like "A/B Testing").
  const fromTitle = title
    ? slugify(title).split('-').filter(Boolean).slice(0, MAX_BRANCH_WORDS).join('-')
    : '';
  const core = fromTitle || keywordSlug(prompt) || 'feature';
  return sanitizeBranchName(`${BRANCH_PREFIX}${core}-${shortId}`);
}

/** All local branch names (no remotes). Empty array on a non-repo. */
export async function listLocalBranches(projectDir) {
  const r = await git(projectDir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/']);
  if (!r.ok) return [];
  return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

/** The branch HEAD currently points to in `projectDir`, or null. */
export async function currentBranch(projectDir) {
  const r = await git(projectDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!r.ok) return null;
  const name = r.stdout.trim();
  return name && name !== 'HEAD' ? name : null;
}

/**
 * Best-effort default-branch resolution. HEAD branch, then init.defaultBranch,
 * then origin/HEAD, then first local branch. On a detached HEAD with no local
 * branches, fall back to the HEAD SHA (always a valid commit-ish for
 * `worktree add`) and only then to the literal 'main' (m1).
 */
export async function resolveDefaultBranch(projectDir) {
  const head = await currentBranch(projectDir);
  if (head) return head;
  const cfg = await git(projectDir, ['config', '--get', 'init.defaultBranch']);
  if (cfg.ok && cfg.stdout.trim()) return cfg.stdout.trim();
  const originHead = await git(projectDir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (originHead.ok && originHead.stdout.trim()) {
    return originHead.stdout.trim().replace(/^origin\//, '');
  }
  const branches = await listLocalBranches(projectDir);
  if (branches.length) return branches.sort()[0];
  // Detached HEAD, no branches: a raw SHA is a valid source for `worktree add`.
  const sha = await git(projectDir, ['rev-parse', 'HEAD']);
  if (sha.ok && sha.stdout.trim()) return sha.stdout.trim();
  return 'main';
}

/**
 * True iff `ref` resolves to a commit in `projectDir`. Rejects any value
 * beginning with '-' (would be parsed as a git option). The single source of
 * truth for "is this a usable worktree source" — used both by createWorktree
 * (throws) and the API (clean 400) so an injected `--force`/`-q`/unknown ref
 * never reaches `git worktree add`. (M1)
 */
export async function isValidSourceRef(projectDir, ref) {
  if (typeof ref !== 'string' || !ref || /^-/.test(ref)) return false;
  const r = await git(projectDir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return r.ok && !!r.stdout.trim();
}

/**
 * Parse `git worktree list --porcelain` and return the path of the worktree
 * that currently has `branch` checked out, or null. Used to detect the
 * "branch already in use" conflict before a reuse `worktree add` (M2).
 */
export async function worktreePathForBranch(projectDir, branch) {
  const r = await git(projectDir, ['worktree', 'list', '--porcelain']);
  if (!r.ok) return null;
  let curPath = null;
  for (const line of r.stdout.split(/\r?\n/)) {
    // git prints '/'-separated paths even on Windows; resolve() gives callers the
    // native form they compare against (createWorktree's own worktreeDir).
    if (line.startsWith('worktree ')) curPath = resolve(line.slice('worktree '.length).trim());
    else if (line.startsWith('branch ')) {
      const ref = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
      if (ref === branch) return curPath;
    }
  }
  return null;
}

/**
 * Create a worktree checking out a new branch <featureBranch> off <sourceBranch>.
 * When the branch already exists locally we attach to it instead of forking (resume
 * semantics) and set reusedExisting=true.
 *
 * Placement: `<baseDir>/<checkoutName>` when both are supplied (the detached run
 * root: `<worcaHome>/runs/<pipelineId>/repos/<projectKey>`), else the retained
 * legacy default `<projectDir>/.worca-cc/worktrees/<pipelineId>` (§10 rollback).
 * Git mechanics are safe out of tree: the shared object store stays in
 * `<projectDir>/.git` and the worktree's gitdir pointers are absolute.
 *
 * @param {object} args
 * @param {string} [args.baseDir]       parent dir for the checkout (default: legacy base)
 * @param {string} [args.checkoutName]  checkout dir name (default: pipelineId)
 */
export async function createWorktree({
  projectDir, pipelineId, sourceBranch, featureBranch, signal, baseDir, checkoutName,
}) {
  if (!projectDir) throw new Error('projectDir required');
  if (!pipelineId) throw new Error('pipelineId required');
  if (!sourceBranch) throw new Error('sourceBranch required');
  // S2: pipelineId becomes a path segment and is later passed to a recursive
  // remove — reject anything that could escape the worktrees base.
  if (!/^[A-Za-z0-9._-]+$/.test(pipelineId) || pipelineId === '.' || pipelineId === '..') {
    throw new Error(`invalid pipelineId: ${JSON.stringify(pipelineId)}`);
  }
  const branch = sanitizeBranchName(featureBranch);
  if (!branch) throw new Error('featureBranch resolves to empty after sanitize');
  // Compare sanitized forms so case/format variants of the same name don't slip past.
  if (branch === sanitizeBranchName(sourceBranch)) {
    throw new Error(`featureBranch and sourceBranch both resolve to "${branch}" — they must differ`);
  }

  const base = baseDir
    ? resolve(baseDir)
    : join(resolve(projectDir), WORKTREES_DIRNAME);   // legacy path retained for rollback
  await mkdir(base, { recursive: true });
  // Canonicalize the base so worktreeDir matches what `git worktree list`
  // reports (git emits realpaths). Without this the M2 self-equality check below
  // mis-fires on symlinked roots (e.g. macOS /tmp -> /private/tmp).
  const baseReal = await realpath(base).catch(() => resolve(base));
  const name = checkoutName || pipelineId;
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..') {
    throw new Error(`invalid checkout name: ${JSON.stringify(name)}`);
  }
  const worktreeDir = join(baseReal, name);
  // Belt-and-braces: the sanitized name can't traverse, but assert containment
  // so a future caller can't turn this into a delete-anything primitive.
  if (!worktreeDir.startsWith(baseReal + sep)) {
    throw new Error(`worktree path escapes base: ${worktreeDir}`);
  }

  const branches = await listLocalBranches(projectDir);
  const reusedExisting = branches.includes(branch);

  let args;
  if (reusedExisting) {
    // M2: git forbids checking out one branch in two worktrees at once. Reap
    // stale registrations first; if a *live* worktree still holds it, fail with
    // an actionable message rather than a raw exit-128 mid-pipeline.
    await git(projectDir, ['worktree', 'prune']);
    const inUse = await worktreePathForBranch(projectDir, branch);
    if (inUse && resolve(inUse) !== resolve(worktreeDir)) {
      throw new Error(`branch "${branch}" is already checked out in worktree ${inUse}`);
    }
    args = ['worktree', 'add', '--', worktreeDir, branch];
  } else {
    // M1: validate the source resolves to a real commit (rejects leading-dash
    // option injection and unknown refs); '--' stops git parsing the trailing
    // positionals as options as a second line of defense.
    if (!(await isValidSourceRef(projectDir, sourceBranch))) {
      throw new Error(`sourceBranch is not a valid ref: ${JSON.stringify(sourceBranch)}`);
    }
    args = ['worktree', 'add', '-b', branch, '--', worktreeDir, sourceBranch];
  }
  const r = await git(projectDir, args, { signal, timeout: SLOW_GIT_TIMEOUT_MS });
  if (!r.ok) {
    const err = new Error(`git worktree add failed: ${r.stderr.trim() || `exit ${r.code}`}`);
    // The ONE abort path that surfaced as a PLAIN error: on signal abort Node
    // kills the spawned git and git() resolves ok:false (spawn's 'error' yields
    // "The operation was aborted" — or whatever git wrote before dying, which
    // may not mention the abort at all). Stamp the name every other abort/stop
    // site sets so isAbort callers classify the stop as a stop, not a failure.
    if (signal?.aborted) err.name = 'AbortError';
    throw err;
  }
  return { worktreeDir, branch, sourceBranch, reusedExisting };
}

/**
 * Remove a worktree dir + (optionally) its branch. Returns
 * { ok, steps: [{ step, ok, stderr }] } so callers can log/assert — failures are
 * never silently swallowed (M3).
 *
 * IMPORTANT: the non-force path only succeeds on a *pristine* checkout — git
 * refuses to remove a worktree with modified/untracked files. Agents always
 * edit files, so teardown of an agent-run worktree MUST pass force:true or it
 * leaks. With force:true the dir is also removed directly as a backstop, and
 * the registration is pruned so a later reuse of the branch won't trip M2.
 */
export async function removeWorktree({ projectDir, worktreeDir, branch, force = false } = {}) {
  const steps = [];
  if (worktreeDir) {
    const args = force
      ? ['worktree', 'remove', '--force', worktreeDir]
      : ['worktree', 'remove', worktreeDir];
    const r = await git(projectDir, args, { timeout: SLOW_GIT_TIMEOUT_MS });
    steps.push({ step: 'worktree-remove', ok: r.ok, stderr: r.stderr.trim() });
    if (force) {
      const fsRes = await rm(worktreeDir, { recursive: true, force: true })
        .then(() => null)
        .catch((e) => e.message);
      if (fsRes) steps.push({ step: 'rm-dir', ok: false, stderr: fsRes });
    }
    // Reap the (now-missing) registration so it can't collide on reuse.
    await git(projectDir, ['worktree', 'prune']);
  }
  if (branch) {
    const r = await git(projectDir, ['branch', force ? '-D' : '-d', branch]);
    steps.push({ step: 'branch-delete', ok: r.ok, stderr: r.stderr.trim() });
  }
  return { ok: steps.every((s) => s.ok), steps };
}

/**
 * Create a DETACHED worktree at `worktreeDir` checking out `ref` — the Ask
 * Worca inspection checkout (ask-worca-worktrees-design.md §3). Detached by
 * construction: no branch is created, locked or deleted, so the pipeline
 * branch-in-use check (M2) never sees these. The caller (ask/worktrees.mjs)
 * owns path construction and containment; this validates only the ref (M1
 * doctrine: reject option-injection before git parses argv) and throws on a
 * fatal git failure with the same AbortError stamp createWorktree uses.
 */
export async function createDetachedWorktree({ projectDir, worktreeDir, ref, signal } = {}) {
  if (!projectDir) throw new Error('projectDir required');
  if (!worktreeDir) throw new Error('worktreeDir required');
  if (!(await isValidSourceRef(projectDir, ref))) {
    throw new Error(`ref is not a valid commit-ish: ${JSON.stringify(ref ?? null)}`);
  }
  await git(projectDir, ['worktree', 'prune']);
  const r = await git(projectDir, ['worktree', 'add', '--detach', '--', worktreeDir, ref],
    { signal, timeout: SLOW_GIT_TIMEOUT_MS });
  if (!r.ok) {
    const err = new Error(`git worktree add --detach failed: ${r.stderr.trim() || `exit ${r.code}`}`);
    if (signal?.aborted) err.name = 'AbortError';
    throw err;
  }
  const head = await git(worktreeDir, ['rev-parse', 'HEAD']);
  return { worktreeDir, commit: head.ok ? head.stdout.trim() : null };
}

/** HEAD commit sha of any checkout (worktree or repo), or null. */
export async function worktreeHead(dir) {
  const r = await git(dir, ['rev-parse', 'HEAD']);
  return r.ok ? r.stdout.trim() : null;
}

/**
 * Env for every Ask Worca git spawn (spec §8). Pager OFF and — load-bearing —
 * NEVER prompt: an https/ssh fetch with no cached credential would otherwise
 * block on a terminal/askpass prompt until the SLOW_GIT_TIMEOUT_MS SIGKILL,
 * holding the MCP call open for two minutes. GIT_ASKPASS/SSH_ASKPASS='' stop the
 * GUI askpass fallback too. NOTE we deliberately do NOT set GIT_CONFIG_GLOBAL:
 * the keychain credential helper for https fetch lives in the user's global
 * config (E3), so nuking it would break authenticated fetch; the external-diff
 * exec vector is closed per-invocation in the tool handler with
 * `-c diff.external=` + `--no-ext-diff` instead.
 */
export const ASK_GIT_ENV = Object.freeze({
  GIT_PAGER: 'cat', PAGER: 'cat', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '',
});

/**
 * Raw capture runner for the Ask Worca `git` MCP tool. The ONLY gate between a
 * model-authored argv and this spawn is ask/git-allowlist.mjs — callers pass
 * exclusively its validated output. Spawn semantics identical to every other
 * helper here ({ok, stdout, stderr, code}, never throws), plus the ASK_GIT_ENV
 * hardening and the caller's abort signal.
 */
export function runGitCapture(cwd, args, { signal, timeoutMs = SLOW_GIT_TIMEOUT_MS, maxBytes = 0 } = {}) {
  return git(cwd, args, { signal, timeout: timeoutMs, env: ASK_GIT_ENV, maxBytes });
}

/**
 * Stage every remaining change and render a binary-capable patch against HEAD
 * DIRECTLY INTO outFile (no in-memory patch string — agent-created artifacts can
 * be huge). Staging is intentional: it makes untracked files part of the patch.
 * Uses the slow git timeout: big binary diffs legitimately take time.
 * Crash-safe: streams to `<outFile>.part` and renames on success, so a
 * SIGKILL/timeout/full disk can never leave a TRUNCATED patch under the final
 * name. A clean tree is SUCCESS with `file: null` (nothing to save is not a
 * failure — discard after a manual commit relies on it). A git failure returns
 * without removing anything so the checkout stays authoritative.
 */
export async function snapshotWorktreePatch(worktreeDir, outFile) {
  if (!worktreeDir || !outFile) {
    return { ok: false, step: 'path', message: 'worktreeDir and outFile are required' };
  }
  const add = await git(worktreeDir, ['add', '-A'], { timeout: SLOW_GIT_TIMEOUT_MS });
  if (!add.ok) {
    return { ok: false, step: 'add', message: add.stderr.trim() || `exit ${add.code}`, fromStderr: !!add.stderr.trim() };
  }
  const part = `${outFile}.part`;
  const diff = await git(worktreeDir, ['diff', '--binary', `--output=${part}`, 'HEAD', '--'],
    { timeout: SLOW_GIT_TIMEOUT_MS });
  if (!diff.ok) {
    await rm(part, { force: true }).catch(() => {});
    return { ok: false, step: 'diff', message: diff.stderr.trim() || `exit ${diff.code}`, fromStderr: !!diff.stderr.trim() };
  }
  let bytes = 0;
  try { bytes = (await stat(part)).size; } catch { /* treated as empty below */ }
  if (!bytes) {
    // Nothing uncommitted: a 0-byte "recovery patch" on disk would be a lie.
    await rm(part, { force: true }).catch(() => {});
    return { ok: true, file: null, bytes: 0 };
  }
  await rename(part, outFile);
  return { ok: true, file: outFile, bytes };
}

function firstLine(text) {
  if (!text) return '';
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.replace(/^#+\s*/, '').trim();
    if (t) return t;
  }
  return '';
}

// ── run-root sweeps (§8.12) ───────────────────────────────────────────────────
//
// The ACTIVE set. `paused` and `interrupted` are the two RESUMABLE statuses
// (the resume route rejects everything else — ui/server.mjs), `running` and
// `pausing` are LIVE (the live-entry guard treats them as non-terminal). All four
// must keep their run roots. Stated POSITIVELY — never "terminal ⇒ delete": at boot
// reconcileStaleRunning stamps every stale `running` row → `interrupted`, and
// `interrupted` runs ARE resumable, so a "not paused and not running ⇒ terminal"
// rule would destroy the uncommitted work of every crashed run at the exact boot
// that made it resumable (_commitWork runs only at teardown; _buildResults only on
// the done path — there is no patch artifact to fall back on).
export const RUN_ROOT_KEEP = new Set(['running', 'pausing', 'paused', 'interrupted']);
export const RUN_ROOT_REMOVE = new Set(['done', 'stopped', 'error']);

/**
 * Sweep `<worcaHome>/runs/*`: keep active run roots, reclaim terminal ones,
 * quarantine anything undecidable. Called at server boot (AFTER
 * reconcileStaleRunning — the ordering is pinned, §8.12) and by `worca doctor`.
 *
 * `worktree.mjs` stays DB-FREE: every pipelines-row lookup is an INJECTED callback
 * owned by the caller (server boot / doctor), which also makes this helper
 * unit-testable with plain stubs.
 *
 * **A LOOKUP FAILURE IS NOT "NO ROW".** `statusOf` must return a status string for a
 * row that exists, `null` only when the row is VERIFIABLY absent, and THROW when the
 * lookup itself could not be performed. The distinction is load-bearing: the row-less
 * disposition is *reclaim*, so a DB that cannot be opened (corrupt file, ABI mismatch
 * after a Node upgrade, bad permissions) collapsing to null would force-remove the
 * worktrees and rm -rf the run roots of every `paused`/`interrupted` run at the next
 * boot — the §8.12 catastrophe, on the error path. A throw therefore skips that run
 * root untouched (no rename, no removal: a transient DB problem must not
 * orphan-quarantine everything either) and is reported in `failed` + logged loudly.
 * The same applies to `membersOf`: if we cannot enumerate what to clean up, we do not
 * remove anything.
 *
 * @param {object} args
 * @param {string}   args.worcaHome        worcaHome() — `<home>/.worca-cc`
 * @param {Function} args.statusOf         (id) => status string | null (null = row
 *                                         verifiably absent); THROWS on lookup failure
 * @param {Function} [args.membersOf]      (id) => Promise<[{projectDir, worktreeDir}]> | null
 *                                         DB fallback used only when run.json is
 *                                         missing; THROWS on lookup failure
 * @param {Function} [args.pipelineDirOf]  (id) => Promise<string|null> — the durable
 *                                         artifact dir, for the rescue-before-remove
 *                                         triple (§8.11/§8.20/§5.2). Injected for the
 *                                         same DB-free reason as the two above. May
 *                                         degrade to null: it is consulted after the
 *                                         disposition and only names a copy target.
 * @param {Function} [args.retainOf]       (id) => retained-work record | null. DB
 *                                         fallback when the manifest is absent or
 *                                         its recorded worktrees are no longer live.
 * @param {Function} [args.log]            (level, message) sink; defaults to console
 * @returns {Promise<{keep:string[], removed:string[], quarantined:string[],
 *                    failed:string[], warnings:string[]}>}
 */
export async function sweepRunRoots({
  worcaHome, statusOf, membersOf, pipelineDirOf, retainOf, log,
} = {}) {
  const out = { keep: [], removed: [], quarantined: [], failed: [], warnings: [] };
  const say = typeof log === 'function'
    ? log
    : (level, msg) => { (level === 'warn' ? console.warn : console.log)(`[worca] run-root sweep: ${msg}`); };
  if (!worcaHome) return out;
  const runsBase = join(worcaHome, 'runs');
  let entries;
  try { entries = await readdir(runsBase, { withFileTypes: true }); } catch { return out; }

  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!entry.isDirectory()) continue;
    // A previously quarantined root is skipped entirely, so nothing is re-logged
    // forever and nothing is deleted on a guess.
    if (/\.orphan-/.test(entry.name)) continue;
    const dir = join(runsBase, entry.name);
    const manifest = await readRunManifest(dir);              // may be null
    const id = manifest?.pipelineId || basename(dir);

    // Three states, never two: status string / verifiably absent (null) / lookup
    // FAILED. Only "verifiably absent" may reach the reclaim path below.
    let status;
    try {
      if (typeof statusOf !== 'function') throw new Error('statusOf callback is required');
      status = statusOf(id);
    } catch (err) {
      const reason = `skip ${dir}: pipelines-row lookup FAILED (${err?.message || err}) — leaving it untouched`;
      out.failed.push(dir);
      out.warnings.push(reason);
      say('warn', reason);
      continue;   // never guess: a lookup failure removes and renames nothing
    }

    if (status && RUN_ROOT_KEEP.has(status)) {
      out.keep.push(dir);
      say('info', `keep ${dir} (${status})`);
      continue;
    }

    // A manifest retain record is live only while at least one named checkout
    // still exists. This makes manual recovery/removal self-clearing instead of
    // leaking the run root forever. The DB callback is an independent fallback.
    const manifestRetain = manifest?.retain;
    const manifestMembers = Array.isArray(manifestRetain?.members) ? manifestRetain.members : [];
    let retained = manifestMembers.some((m) => m?.worktreeDir && existsSync(m.worktreeDir))
      ? manifestRetain
      : null;
    // Same three-state doctrine as statusOf/membersOf: "retention unknown" must
    // never collapse into "remove", so a lookup throw skips this root untouched
    // and is reported in `failed` + logged loudly (it must NOT abort the sweep —
    // this call site is outside the statusOf try/catch).
    if (!retained && typeof retainOf === 'function') {
      try {
        retained = await retainOf(id);
      } catch (err) {
        const reason = `skip ${dir}: retention lookup FAILED (${err?.message || err}) — leaving it untouched`;
        out.failed.push(dir);
        out.warnings.push(reason);
        say('warn', reason);
        continue;
      }
    }
    if (retained) {
      out.keep.push(dir);
      say('info', `keep ${dir} (${status || 'no row'}, retained: ${retained.reason || 'unknown'})`);
      continue;
    }
    if (status && !RUN_ROOT_REMOVE.has(status)) {
      out.quarantined.push(dir);
      say('warn', `quarantine ${dir}: unknown status ${status}`);
      continue;
    }

    // status ∈ REMOVE, or the row is gone (deleted pipeline): reclaim.
    if (status) {
      // rescue-before-remove runs ONLY when a pipelines row exists (its artifact
      // dir is derivable). Row-less roots skip it — the pipeline was deliberately
      // deleted and its artifact dir is gone.
      let pipelineDir = null;
      try { pipelineDir = pipelineDirOf ? await pipelineDirOf(id) : null; } catch { pipelineDir = null; }
      const injected = manifest?.injectedPaths || {};
      for (const [scope, list] of Object.entries(injected)) {
        const baseDir = scope === 'runRoot'
          ? dir
          : (manifest?.members || []).find((m) => m?.projectKey === scope)?.worktreeDir || join(dir, 'repos', scope);
        const w = await rescueModifiedMounts({
          baseDir, entries: list, pipelineDir, scope, pipelineId: id,
        });
        out.warnings.push(...w);
        for (const line of w) say('warn', `${id}: ${line}`);
      }
      const strays = await scanStrayEntries({ runRoot: dir, pipelineDir });
      out.warnings.push(...strays);
      for (const line of strays) say('warn', `${id}: ${line}`);
      await copyRunManifestTo(dir, pipelineDir);
    } else if (!manifest) {
      // Row-less AND no readable manifest: quarantine ONCE by renaming, rather
      // than deleting on a guess. Later sweeps skip `*.orphan-*` entirely.
      const dest = `${dir}.orphan-${Date.now()}`;
      try {
        await rename(dir, dest);
        out.quarantined.push(dest);
        say('warn', `quarantine ${dir} -> ${basename(dest)}: no pipelines row and no readable run.json`);
      } catch (err) {
        out.warnings.push(`quarantine rename failed for ${dir}: ${err?.message || err}`);
        say('warn', `quarantine rename failed for ${dir}: ${err?.message || err}`);
      }
      continue;
    }

    // Same three-state rule for the DB fallback: if we cannot enumerate the members
    // we must not remove anything, or the run root would be rm -rf'd while its
    // worktrees stayed registered in the real repos.
    let members = manifest?.members ?? null;
    if (!members && membersOf) {
      try {
        members = await membersOf(id);
      } catch (err) {
        const reason = `skip ${dir}: member lookup FAILED (${err?.message || err}) — leaving it untouched`;
        out.failed.push(dir);
        out.warnings.push(reason);
        say('warn', reason);
        continue;
      }
    }
    members = members ?? [];
    for (const m of members) {
      if (!m?.projectDir || !m?.worktreeDir) continue;
      await removeWorktree({ projectDir: m.projectDir, worktreeDir: m.worktreeDir, branch: null, force: true });
    }
    const res = await rmGuarded(dir, { worcaHome, pipelineId: basename(dir) });
    if (res.removed) {
      out.removed.push(dir);
      say('info', `removed ${dir}${status ? ` (${status})` : ' (no pipelines row)'}`);
    } else {
      out.warnings.push(res.reason || `removal refused for ${dir}`);
      say('warn', res.reason || `removal refused for ${dir}`);
    }
  }
  return out;
}

/**
 * One-time migration sweep of the LEGACY worktree base
 * `<projectDir>/.worca-cc/worktrees/*` for a registered project. DEFINED + unit
 * tested in Phase 1; wired at server boot in Phase 7.
 *
 * "Leftover" is defined, not assumed: the directory basename IS the pipelineId, so
 * each candidate is looked up in `pipelines` before anything is removed; a candidate
 * is SKIPPED when its status is in RUN_ROOT_KEEP or when `referencedPaths` still
 * names that path (a run may have been recorded under a different id shape); it is
 * removed only for RUN_ROOT_REMOVE statuses; anything else is quarantine-logged.
 *
 * **A TOTAL NO-OP while the effective run-root mode is `legacy`** — under legacy
 * `<projectDir>/.worca-cc/worktrees/<id>` is the LIVE location of every active run,
 * so sweeping there would make the documented rollback self-destroying (run legacy →
 * pause → restart → the paused run's checkout is deleted and resume() hard-fails
 * with the agent's uncommitted work gone). This is a migration step for trees left
 * behind by the flip, and it only ever runs when the flip is in effect.
 *
 * **A LOOKUP FAILURE IS NOT "NO ROW"** — the same three-state rule sweepRunRoots
 * documents above: `statusOf` returns a status for a row that exists, `null` only
 * when the row is VERIFIABLY absent, and THROWS when the lookup could not be
 * performed. A throw skips that candidate untouched and is reported in `failed` +
 * logged loudly, instead of collapsing into the row-less quarantine-log (which would
 * misreport "the DB is unreadable" as "these runs were deleted").
 *
 * @param {string} projectDir
 * @param {object} args
 * @param {Function} args.statusOf            (id) => status | null; THROWS on lookup failure
 * @param {Function|string} [args.mode]       injected effective mode; DEFAULTS to the
 *                                            real runRootMode() reader, so the Phase-7
 *                                            boot call needs only { statusOf }
 * @param {Set<string>|string[]} [args.referencedPaths] worktree paths any row still
 *                                            claims (state.branch.worktreeDir /
 *                                            state.branches[*].worktreeDir /
 *                                            workspace_meta); injected because
 *                                            worktree.mjs stays DB-free
 * @param {Function} [args.log]
 */
export async function sweepLegacyWorktrees(projectDir, {
  statusOf, mode = runRootMode, referencedPaths, log,
} = {}) {
  const out = { keep: [], removed: [], quarantined: [], failed: [], warnings: [], skipped: false };
  const say = typeof log === 'function'
    ? log
    : (level, msg) => { (level === 'warn' ? console.warn : console.log)(`[worca] legacy sweep: ${msg}`); };
  const effective = typeof mode === 'function' ? mode() : mode;
  if (effective !== 'detached') {
    out.skipped = true;   // §10: never sweep the live legacy base
    return out;
  }
  if (!projectDir) return out;
  const base = join(resolve(projectDir), WORKTREES_DIRNAME);
  const referenced = new Set(
    [...(referencedPaths || [])].filter(Boolean).map((p) => resolve(p)),
  );
  let entries;
  try { entries = await readdir(base, { withFileTypes: true }); } catch { return out; }

  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!entry.isDirectory()) continue;
    const dir = join(base, entry.name);
    if (referenced.has(resolve(dir))) {
      out.keep.push(dir);
      say('info', `keep ${dir} (still referenced by a pipelines row)`);
      continue;
    }
    const id = entry.name;                                   // worktree.mjs names the dir by pipelineId
    // Three states, never two: status string / verifiably absent (null) / lookup
    // FAILED. Only "verifiably absent" may reach the quarantine-log below.
    let status;
    try {
      if (typeof statusOf !== 'function') throw new Error('statusOf callback is required');
      status = statusOf(id);
    } catch (err) {
      const reason = `skip ${dir}: pipelines-row lookup FAILED (${err?.message || err}) — leaving it untouched`;
      out.failed.push(dir);
      out.warnings.push(reason);
      say('warn', reason);
      continue;   // never guess: a lookup failure removes and quarantine-logs nothing
    }
    if (status && RUN_ROOT_KEEP.has(status)) {
      out.keep.push(dir);
      say('info', `keep ${dir} (${status})`);
      continue;
    }
    if (!status || !RUN_ROOT_REMOVE.has(status)) {
      out.quarantined.push(dir);
      say('warn', `quarantine ${dir}: ${status ? `unknown status ${status}` : 'no pipelines row'}`);
      continue;
    }
    const res = await removeWorktree({ projectDir, worktreeDir: dir, branch: null, force: true });
    out.removed.push(dir);
    for (const s of res.steps.filter((x) => !x.ok)) {
      out.warnings.push(`${entry.name}: ${s.step}: ${s.stderr || 'failed'}`);
    }
    say('info', `removed ${dir} (${status})`);
  }
  return out;
}

/**
 * Fan `sweepLegacyWorktrees` out over a list of project dirs — the projects registry
 * (`projects.mjs#listProjects`) at server boot and in `worca doctor` — aggregating
 * every disposition into one report. Both wirings share this so the aggregation and
 * the mode gate can never drift between them, while each keeps its own printing.
 *
 * Takes plain dirs plus the INJECTED lookups (`artifacts.mjs#legacySweepLookups`), so
 * worktree.mjs stays DB-free. `mode` is resolved ONCE here and passed down verbatim:
 * one boot can never sweep half the registry in one mode and half in the other.
 *
 * Idempotent by construction — every disposition is decided from the caller's row
 * snapshot, and a second pass finds the removed dirs already gone — so re-running it
 * at every boot, or during a §10 rollback, is safe. A dir with no
 * `.worca-cc/worktrees` (or no such project on disk) contributes nothing, silently.
 *
 * @param {string[]} projectDirs
 * @param {object} args  statusOf / referencedPaths / log forwarded verbatim
 * @param {Function|string} [args.mode]
 * @returns {Promise<{projects:number, skipped:boolean, keep:string[], removed:string[],
 *                    quarantined:string[], failed:string[], warnings:string[]}>}
 */
export async function sweepLegacyWorktreesAll(projectDirs, {
  statusOf, mode = runRootMode, referencedPaths, log,
} = {}) {
  const out = {
    projects: 0, skipped: false,
    keep: [], removed: [], quarantined: [], failed: [], warnings: [],
  };
  const effective = typeof mode === 'function' ? mode() : mode;
  if (effective !== 'detached') {
    out.skipped = true;    // §10: under legacy those paths hold every live and paused run
    return out;
  }
  for (const dir of projectDirs || []) {
    if (!dir) continue;
    const res = await sweepLegacyWorktrees(dir, { statusOf, mode: effective, referencedPaths, log });
    out.projects += 1;
    for (const key of ['keep', 'removed', 'quarantined', 'failed', 'warnings']) {
      out[key].push(...(res[key] || []));
    }
  }
  return out;
}
