// src/core/repo-readiness/facts.mjs
// Pure fact collection over git and the filesystem for the agent-readiness checks.
// Never throws: failures land in the Facts fields (isRepo / timedOut / partial data).
import { execFileSync, execFile } from 'node:child_process';
import { statSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { INTERACTIVE_TIMEOUT_MS } from '../git-sync.mjs';

const FILE_CAP = 200_000;

// Candidate instruction files whose porcelain state feeds the fingerprint and the
// instructions.* checks. Kept broad; engines.mjs decides which belong to which engine.
export const INSTRUCTION_CANDIDATES = Object.freeze([
  'CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md',
  'AGENTS.md', 'AGENTS.override.md',
  '.github/copilot-instructions.md',
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
// Read under the byte cap so a huge file cannot blow the buffer.
const TEXT_CANDIDATES = Object.freeze(['CLAUDE.md', 'AGENTS.md', '.github/copilot-instructions.md']);
const TEXT_READ_CAP = 256 * 1024;

/** One deadline for the whole evaluation. Returns {ok,out,timedOut}. Never throws. */
function gitOut(dir, args, deadline, input) {
  const remaining = Math.max(1, deadline - Date.now());
  try {
    const out = execFileSync('git', ['-C', dir, ...args], {
      timeout: remaining, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8',
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
      ...(input === undefined ? {} : { input }),
    });
    return { ok: true, out, timedOut: false };
  } catch (e) {
    return { ok: false, out: '', timedOut: e?.code === 'ETIMEDOUT' || e?.killed === true || e?.signal === 'SIGTERM' };
  }
}

/** Never throws. Returns a Facts object; partial on timeout. */
export function collectFacts(dir, { now = Date.now(), timeoutMs = INTERACTIVE_TIMEOUT_MS } = {}) {
  const deadline = now + timeoutMs;
  const f = {
    dir, isRepo: false, headSha: null, tracked: null, trackedSet: null,
    truncated: false, instructionStatus: {}, sizes: {}, manifests: {}, texts: {},
    heavyIgnored: {}, heavyPresent: [], timedOut: false, error: null,
  };
  try {
    // 1) repo + HEAD
    const top = gitOut(dir, ['rev-parse', '--show-toplevel', 'HEAD'], deadline);
    if (!top.ok) { f.timedOut = top.timedOut; return f; }   // not a repo → git.repo fails, rest skip
    const lines = top.out.trim().split('\n');
    f.isRepo = true;
    f.headSha = lines[1] || null;

    // 2) tracked set (NUL-delimited), capped
    const ls = gitOut(dir, ['ls-files', '-z'], deadline);
    if (ls.ok) {
      const entries = ls.out.split('\0').filter(Boolean);
      if (entries.length > FILE_CAP) { f.truncated = true; f.tracked = entries.slice(0, FILE_CAP); }
      else f.tracked = entries;
      f.trackedSet = new Set(f.tracked);
    } else { f.timedOut = f.timedOut || ls.timedOut; }

    // 3) porcelain of instruction candidates → committed/untracked/modified + fingerprint input
    const st = gitOut(dir, ['status', '--porcelain', '-z', '--', ...INSTRUCTION_CANDIDATES], deadline);
    if (!st.ok) f.timedOut = f.timedOut || st.timedOut;
    // `-z` records are `XY<space>path` terminated by NUL; rename records carry a second NUL path
    // (irrelevant for these candidates). We only need {path → 2-char code}.
    for (const rec of (st.ok ? st.out : '').split('\0')) {
      if (rec.length < 4) continue;
      f.instructionStatus[rec.slice(3)] = rec.slice(0, 2);   // '??' untracked, ' M' modified, 'A ' staged
    }

    // 4) sizes of candidates present on disk
    for (const c of INSTRUCTION_CANDIDATES) {
      const p = join(dir, c);
      try { if (existsSync(p)) f.sizes[c] = statSync(p).size; } catch { /* ignore */ }
    }

    // 5) tracked manifests + bounded instruction texts
    for (const m of MANIFESTS) {
      if (f.trackedSet && !f.trackedSet.has(m)) continue;
      try { f.manifests[m] = readFileSync(join(dir, m), 'utf8'); } catch { /* ignore */ }
    }
    for (const t of TEXT_CANDIDATES) {
      if (f.trackedSet && !f.trackedSet.has(t)) continue;   // only tracked text matters
      try { f.texts[t] = readFileSync(join(dir, t), 'utf8').slice(0, TEXT_READ_CAP); } catch { /* ignore */ }
    }

    // 6) heavy dirs present on disk + git check-ignore
    for (const d of HEAVY_DIRS) if (existsSync(join(dir, d))) f.heavyPresent.push(d);
    if (f.heavyPresent.length) {
      // `git check-ignore -z --stdin` prints only the ignored ones (`-z` requires `--stdin`;
      // exit 1 with no output simply means none of them is ignored).
      const ci = gitOut(dir, ['check-ignore', '-z', '--stdin'], deadline, f.heavyPresent.join('\0') + '\0');
      if (!ci.ok) f.timedOut = f.timedOut || ci.timedOut;
      const ignored = new Set((ci.ok ? ci.out : '').split('\0').filter(Boolean));
      for (const d of f.heavyPresent) f.heavyIgnored[d] = ignored.has(d);
    }
  } catch (e) {
    f.error = e?.message || String(e);
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

function gitAsync(dir, args, timeoutMs) {
  return new Promise((res) => {
    execFile('git', ['-C', dir, ...args], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
      (err, out) => res(err ? null : out));
  });
}

/**
 * fingerprintOf(collectFacts(dir)) from two small async git calls (HEAD, the candidates' porcelain), without the
 * full collection: the cache's per-read check (cache.mjs). Never throws; a non-repo reads as collectFacts' does.
 */
export async function quickFingerprint(dir, { timeoutMs = INTERACTIVE_TIMEOUT_MS } = {}) {
  const facts = { headSha: null, instructionStatus: {} };
  const top = await gitAsync(dir, ['rev-parse', '--show-toplevel', 'HEAD'], timeoutMs);
  if (top !== null) {
    facts.headSha = top.trim().split('\n')[1] || null;
    const st = await gitAsync(dir, ['status', '--porcelain', '-z', '--', ...INSTRUCTION_CANDIDATES], timeoutMs);
    for (const rec of (st || '').split('\0')) {
      if (rec.length < 4) continue;
      facts.instructionStatus[rec.slice(3)] = rec.slice(0, 2);
    }
  }
  return fingerprintOf(facts);
}
