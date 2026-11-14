// src/core/repo-readiness/facts.mjs
// Fact collection over git and the filesystem for the agent-readiness checks.
// Never throws: failures land in the Facts fields (isRepo / timedOut / error / partial data).
// Every git call is async (it runs in the UI server) and takes its env from guardedGitEnv (security G2): `git status`
// refreshes the index, which runs core.fsmonitor, and the check runs right after a run that could write .git/config.
import { execFile } from 'node:child_process';
import { statSync, existsSync } from 'node:fs';
import { open, readdir, lstat, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { INTERACTIVE_TIMEOUT_MS } from '../git-sync.mjs';
import { guardedGitEnv } from '../git-guard.mjs';
import { stripHostCredentials } from '../host-credentials.mjs';

const FILE_CAP = 200_000;

// Candidate instruction files whose porcelain state feeds the fingerprint and the
// instructions.* checks. Kept broad; engines.mjs decides which belong to which engine.
export const INSTRUCTION_CANDIDATES = Object.freeze([
  'CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md',
  'AGENTS.md', 'AGENTS.override.md',
  '.github/copilot-instructions.md', 'GEMINI.md', 'QWEN.md', '.goosehints',
]);

export const HEAVY_DIRS = Object.freeze([
  'node_modules', 'dist', 'build', 'out', 'target', '.venv', 'venv',
  '__pycache__', '.next', 'coverage',
]);

export const MANIFESTS = Object.freeze([
  'package.json', 'pyproject.toml', 'Makefile', 'makefile',
  'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'build.gradle.kts',
  'pnpm-workspace.yaml',
]);

// Instruction files whose TEXT a check needs (single-source cross-reference, instructionMentions).
// Only the first TEXT_READ_CAP bytes are read, so a huge file is never loaded whole.
const TEXT_CANDIDATES = Object.freeze(['CLAUDE.md', 'AGENTS.md', '.github/copilot-instructions.md']);
export const TEXT_READ_CAP = 256 * 1024;
// Manifests are read up to this many bytes; a longer one is cut and its JSON.parse fails (checks.mjs reads it as unreadable).
export const MANIFEST_READ_CAP = 1024 * 1024;

// Rule directories whose files a Folder project lists from disk (the engines' instruction globs need a file list).
const RULE_DIRS = Object.freeze(['.claude/rules', '.github/instructions', '.cursor/rules']);
const RULE_WALK_CAP = 2000;
const RULE_DEPTH = 8;

/**
 * One git call under the evaluation's deadline. Resolves {ok, out, timedOut, refused}; never rejects. `refused` is the
 * guard's reason when the repository's config must not run a git call (GIT_CONFIG_REFUSED and the like).
 */
async function gitOut(dir, args, deadline, { input, maxBuffer = 64 * 1024 * 1024, indexFile = null } = {}) {
  let env;
  try {
    env = await guardedGitEnv(dir, { env: stripHostCredentials(process.env), timeout: Math.max(1, deadline - Date.now()) });
    // Set after the guard: the index file picks no config, so the guard's listing (and its memo) stay shared.
    if (indexFile) env = { ...env, GIT_INDEX_FILE: indexFile };
  } catch (e) {
    // Out of time while the guard read the config is a timeout; a missing folder is "not a repo"; anything else is a refusal.
    if (Date.now() >= deadline) return { ok: false, out: '', timedOut: true, refused: null };
    return { ok: false, out: '', timedOut: false, refused: e?.code === 'ENOENT' ? null : e?.message || String(e) };
  }
  return new Promise((done) => {
    const child = execFile('git', ['-C', dir, ...args], {
      env, timeout: Math.max(1, deadline - Date.now()), maxBuffer, encoding: 'utf8', windowsHide: true,
    }, (err, out, stderr) => {
      if (!err) return done({ ok: true, out, timedOut: false, code: 0 });
      done({ ok: false, out: '', timedOut: err.killed === true || err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT',
        code: typeof err.code === 'number' ? err.code : null, stderr: String(stderr || '').trim() });
    });
    child.stdin?.end(input);
  });
}

/**
 * The work tree and HEAD, as two calls so a repository with no commits is still a repo (headSha null).
 * `ok` is false only when the work tree call fails; `refused` comes from it.
 */
async function headOf(dir, deadline, gitOpts) {
  const top = await gitOut(dir, ['rev-parse', '--show-toplevel'], deadline, gitOpts);
  if (!top.ok) return { ok: false, headSha: null, timedOut: top.timedOut, refused: top.refused ?? null };
  const head = await gitOut(dir, ['rev-parse', '--verify', '-q', 'HEAD'], deadline, gitOpts);
  return { ok: true, headSha: head.ok ? head.out.trim() || null : null, timedOut: head.timedOut, refused: null };
}

/**
 * A temporary index holding the tree a run's teardown commit records (run-harness `_commitWork`): the checkout's own
 * index copied (HEAD read into a fresh one when it has none), each `exclude` path dropped from it
 * (`rm -r --cached --ignore-unmatch`), then `git add -A -- . :(exclude)<path>…`, leaving off an exclude an ignore rule
 * already covers (git refuses it: worktree.mjs withoutIgnored). A `.gitignore`d file stays out, as in the commit. The
 * checkout's own index is never written; the commit's blobs land in the object store early, as `git add` writes them.
 * Every call is a guarded one (gitOut). Resolves `{ indexFile, cleanup }`, or `{ failed: { timedOut, error } }`.
 */
async function committedIndex(dir, headSha, exclude, deadline) {
  let tmp;
  try { tmp = await mkdtemp(join(tmpdir(), 'worca-readiness-index-')); } catch (e) {
    return { failed: { timedOut: false, error: `no temporary index: ${e?.message || e}` } };
  }
  const indexFile = join(tmp, 'index');
  const cleanup = () => rm(tmp, { recursive: true, force: true }).catch(() => {});
  const fail = async (r, step) => {
    await cleanup();
    return { failed: { timedOut: !!r.timedOut, error: r.timedOut ? null : r.refused || `git ${step} failed in a temporary index${r.stderr ? `: ${r.stderr}` : ''}` } };
  };
  const opts = { indexFile, maxBuffer: 4 * 1024 * 1024 };
  const noSplit = ['-c', 'core.splitIndex=false'];   // a split index would write its shared part next to the repository's
  const at = await gitOut(dir, ['rev-parse', '--git-path', 'index'], deadline);
  if (!at.ok) return fail(at, 'rev-parse');
  let copied = false;
  try { await copyFile(resolve(dir, at.out.trim()), indexFile); copied = true; } catch { /* no index yet */ }
  if (!copied && headSha) {
    const rt = await gitOut(dir, [...noSplit, 'read-tree', headSha], deadline, opts);
    if (!rt.ok) return fail(rt, 'read-tree');
  }
  const paths = [...new Set(exclude.filter((p) => typeof p === 'string' && p).map((p) => p.replace(/^:\(exclude\)/, '')))];
  let addable = paths;
  if (paths.length) {
    const rmc = await gitOut(dir, [...noSplit, 'rm', '-r', '--cached', '-q', '--ignore-unmatch', '--', ...paths], deadline, opts);
    if (!rmc.ok) return fail(rmc, 'rm --cached');
    const ci = await gitOut(dir, ['-c', 'core.quotePath=false', 'check-ignore', '--', ...paths], deadline, opts);
    if (ci.timedOut) return fail(ci, 'check-ignore');
    if (ci.ok) {   // exit 0: some are ignored; 1: none; anything else: keep them all (as withoutIgnored)
      const ignored = new Set(ci.out.split('\n').map((l) => l.trim()).filter(Boolean));
      addable = paths.filter((p) => !ignored.has(p));
    }
  }
  const add = await gitOut(dir, addable.length ? [...noSplit, 'add', '-A', '--', '.', ...addable.map((p) => `:(exclude)${p}`)]
    : [...noSplit, 'add', '-A'], deadline, opts);
  if (!add.ok) return fail(add, 'add');
  return { indexFile, cleanup };
}

/**
 * Never throws. Resolves a Facts object; partial on timeout.
 * `committed: { exclude }` (a run checkout): judge the tree as the run's teardown will commit it — the tracked set,
 * the instruction files' porcelain and check-ignore all read a temporary index (committedIndex), so a file the run
 * wrote counts as committed and a `.gitignore`d one does not. Without it, the checkout's own index (the chip's path).
 */
export async function collectFacts(dir, { now = Date.now(), timeoutMs = INTERACTIVE_TIMEOUT_MS, folder = false, committed = null } = {}) {
  const deadline = now + timeoutMs;
  const f = {
    dir, isRepo: false, headSha: null, tracked: null, trackedSet: null,
    truncated: false, instructionStatus: {}, sizes: {}, manifests: {}, texts: {},
    heavyIgnored: {}, heavyPresent: [], timedOut: false, error: null, folder, listed: null,
  };
  // A Folder project runs on a copy of the folder, and worca never runs git in it: read the files from disk only.
  if (folder) {
    await readFiles(dir, f);
    f.listed = [...INSTRUCTION_CANDIDATES.filter((c) => f.sizes[c] !== undefined), ...await walkRuleDirs(dir)];
    return f;
  }
  let idx = null;
  try {
    // 1) repo + HEAD
    const head = await headOf(dir, deadline);
    if (head.refused) { f.error = head.refused; return f; }   // a refused config: the report is unknown, never "not a repo"
    if (!head.ok) { f.timedOut = head.timedOut; return f; }   // not a repo → git.repo fails, rest skip
    f.isRepo = true;
    f.headSha = head.headSha;   // null in a repository with no commits
    f.timedOut = head.timedOut;

    // 1b) a run checkout: the tree its teardown commits, in a temporary index (a failure leaves the facts partial)
    if (committed) {
      idx = await committedIndex(dir, f.headSha, Array.isArray(committed.exclude) ? committed.exclude : [], deadline);
      if (idx.failed) {
        if (idx.failed.timedOut) f.timedOut = true; else f.error = idx.failed.error;
        idx = null;
        return f;
      }
    }
    const g = idx ? { indexFile: idx.indexFile } : {};

    // 2) tracked set (NUL-delimited), capped
    const ls = await gitOut(dir, ['ls-files', '-z'], deadline, g);
    if (ls.ok) {
      const entries = ls.out.split('\0').filter(Boolean);
      if (entries.length > FILE_CAP) { f.truncated = true; f.tracked = entries.slice(0, FILE_CAP); }
      else f.tracked = entries;
      f.trackedSet = new Set(f.tracked);
    } else { f.timedOut = f.timedOut || ls.timedOut; }

    // 3) porcelain of instruction candidates → committed/untracked/modified + fingerprint input
    const st = await gitOut(dir, ['status', '--porcelain', '-z', '--', ...INSTRUCTION_CANDIDATES], deadline, g);
    if (!st.ok) f.timedOut = f.timedOut || st.timedOut;
    // `-z` records are `XY<space>path` terminated by NUL; rename records carry a second NUL path
    // (irrelevant for these candidates). We only need {path → 2-char code}.
    for (const rec of (st.ok ? st.out : '').split('\0')) {
      if (rec.length < 4) continue;
      // Over the temporary index, X (staged against HEAD) is exactly what the commit records: only a work-tree
      // difference left after it (Y) is "not committed".
      if (idx && rec[1] === ' ') continue;
      f.instructionStatus[rec.slice(3)] = rec.slice(0, 2);   // '??' untracked, ' M' modified, 'A ' staged
    }

    // 4) sizes of candidates present on disk; 5) tracked manifests + bounded instruction texts
    await readFiles(dir, f, f.trackedSet);

    // 6) heavy dirs present on disk + git check-ignore
    for (const d of HEAVY_DIRS) if (existsSync(join(dir, d))) f.heavyPresent.push(d);
    if (f.heavyPresent.length) {
      // `git check-ignore -z --stdin` prints only the ignored ones (`-z` requires `--stdin`;
      // exit 1 with no output simply means none of them is ignored).
      const ci = await gitOut(dir, ['check-ignore', '-z', '--stdin'], deadline, { ...g, input: f.heavyPresent.join('\0') + '\0' });
      if (!ci.ok) f.timedOut = f.timedOut || ci.timedOut;
      const ignored = new Set((ci.ok ? ci.out : '').split('\0').filter(Boolean));
      for (const d of f.heavyPresent) f.heavyIgnored[d] = ignored.has(d);
    }
  } catch (e) {
    f.error = e?.message || String(e);
  } finally {
    await idx?.cleanup();
  }

  if (Date.now() >= deadline) f.timedOut = true;
  return f;
}

/**
 * SHA1 over HEAD + the porcelain codes of the instruction candidates. Known limitation: on-disk
 * edits that do not change a candidate's porcelain code (or HEAD) do not move the fingerprint.
 */
export function fingerprintOf(facts) {
  const status = Object.entries(facts?.instructionStatus || {})
    .map(([path, code]) => `${code}${path}`)
    .sort();
  return createHash('sha1')
    .update(`${facts?.headSha || ''}\n${status.join('\n')}`)
    .digest('hex');
}

/**
 * fingerprintOf(collectFacts(dir)) from two small async git calls (HEAD, the candidates' porcelain), without the
 * full collection: the cache's per-read check (cache.mjs). Never throws; a non-repo reads as collectFacts' does.
 */
export async function quickFingerprint(dir, { timeoutMs = INTERACTIVE_TIMEOUT_MS, folder = false } = {}) {
  if (folder) {   // no git: the candidates', manifests' and rule files' sizes and mtimes
    const files = [...INSTRUCTION_CANDIDATES, ...MANIFESTS, ...await walkRuleDirs(dir)];
    const parts = files.map((c) => { try { const st = statSync(join(dir, c)); return `${c}:${st.size}:${st.mtimeMs}`; } catch { return ''; } });
    return createHash('sha1').update(`folder\n${parts.join('\n')}`).digest('hex');
  }
  const facts = { headSha: null, instructionStatus: {} };
  const deadline = Date.now() + timeoutMs;
  const small = { maxBuffer: 4 * 1024 * 1024 };
  const head = await headOf(dir, deadline, small);
  if (head.ok) {
    facts.headSha = head.headSha;
    const st = await gitOut(dir, ['status', '--porcelain', '-z', '--', ...INSTRUCTION_CANDIDATES], deadline, small);
    for (const rec of (st.ok ? st.out : '').split('\0')) {
      if (rec.length < 4) continue;
      facts.instructionStatus[rec.slice(3)] = rec.slice(0, 2);
    }
  }
  return fingerprintOf(facts);
}

/**
 * The files the instruction globs can match: the tracked set in a git project, the listed files in a Folder project
 * (null when neither is known). `trackedSet` alone keeps meaning "tracked by git".
 */
export function presentFiles(facts) {
  if (facts?.trackedSet) return facts.trackedSet;
  return facts?.listed ? new Set(facts.listed) : null;
}

/**
 * Sizes of the candidate instruction files, manifests and bounded instruction texts, read from disk (no git).
 * With `tracked`, only tracked manifests and texts are read.
 */
async function readFiles(dir, f, tracked = null) {
  const keep = (p) => !tracked || tracked.has(p);
  for (const c of INSTRUCTION_CANDIDATES) {
    try { const p = join(dir, c); if (existsSync(p)) f.sizes[c] = statSync(p).size; } catch { /* ignore */ }
  }
  for (const m of MANIFESTS) {
    if (!keep(m)) continue;
    const text = await readCapped(join(dir, m), MANIFEST_READ_CAP);
    if (text !== null) f.manifests[m] = text;
  }
  for (const t of TEXT_CANDIDATES) {
    if (!keep(t)) continue;   // only tracked text matters
    const text = await readCapped(join(dir, t), TEXT_READ_CAP);
    if (text !== null) f.texts[t] = text;
  }
}

/** The first `cap` bytes of a file as UTF-8; null on any error (absent, a directory, unreadable). */
async function readCapped(path, cap) {
  let fh;
  try {
    fh = await open(path, 'r');
    const { size } = await fh.stat();
    const buf = Buffer.alloc(Math.min(size, cap));
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } catch {
    return null;
  } finally {
    await fh?.close().catch(() => {});
  }
}

/**
 * Files under the rule directories, as sorted posix paths relative to `dir`. Symlinks are never followed; the walk
 * stops silently after RULE_WALK_CAP entries or RULE_DEPTH levels. A missing directory gives nothing.
 */
async function walkRuleDirs(dir) {
  const out = [];
  let seen = 0;
  const walk = async (rel, depth) => {
    if (depth > RULE_DEPTH || seen >= RULE_WALK_CAP) return;
    let entries;
    try { entries = await readdir(join(dir, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (++seen > RULE_WALK_CAP) return;
      if (e.isSymbolicLink()) continue;
      const p = `${rel}/${e.name}`;
      if (e.isDirectory()) await walk(p, depth + 1);
      else if (e.isFile()) out.push(p);
    }
  };
  for (const d of RULE_DIRS) {
    // Both the parent (.cursor) and the rule dir itself: a symlink in either would list files outside the folder.
    try {
      if ((await lstat(join(dir, d.split('/')[0]))).isSymbolicLink() || (await lstat(join(dir, d))).isSymbolicLink()) continue;
    } catch { continue; }
    await walk(d, 1);
  }
  return out.sort();
}
