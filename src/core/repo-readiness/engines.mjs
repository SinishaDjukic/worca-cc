// Per-engine view of the readiness checks: which instruction files each engine reads, the tool-scope check
// rows (one per engine), the repository rows (once), the ignore list, and the resulting levels.
// Pure over facts (+ env for engine locks).
import { listEngines } from '../engines/index.mjs';
import { engineLocks } from '../engines/readiness.mjs';
import { CLAUDE_INSTRUCTION_FILES, CLAUDE_INSTRUCTION_GLOBS } from '../engines/claude.mjs';
import { CODEX_INSTRUCTION_FILES } from '../engines/codex.mjs';
import { COPILOT_INSTRUCTION_FILES, COPILOT_INSTRUCTION_GLOBS } from '../engines/copilot.mjs';
import { CURSOR_INSTRUCTION_FILES, CURSOR_INSTRUCTION_GLOBS } from '../engines/cursor.mjs';
import { GEMINI_INSTRUCTION_FILES } from '../engines/gemini.mjs';
import { QWEN_INSTRUCTION_FILES } from '../engines/qwen.mjs';
import { GOOSE_INSTRUCTION_FILES } from '../engines/goose.mjs';
import { OPENCODE_INSTRUCTION_FILES } from '../engines/opencode.mjs';
import { DEFAULT_CONTEXT_MAX_BYTES_PER_FILE, DEFAULT_CONTEXT_MAX_BYTES_TOTAL } from '../settings.mjs';
import { CHECKS } from './checks.mjs';
import { presentFiles as filesOf } from './facts.mjs';

// Untracked by convention, so never part of `instructions.committed`.
const LOCAL_ONLY_FILES = Object.freeze(['CLAUDE.local.md']);

// `committedExempt`: Claude reads the real directory (run-context), not the worktree, so an uncommitted file is fine.
// Claude Code has no AGENTS.md source: it reads AGENTS.md only when no CLAUDE.md is in its working folder or above it
// (code.claude.com/docs/en/memory#agents-md), and a Worca run writes <runRoot>/CLAUDE.md above the checkout. A run gets
// an AGENTS.md through an `@AGENTS.md` line in the project's CLAUDE.md, which run-context resolves from the real folder.
// `firstNonEmpty`: the engine reads only the first of `files` that has content (Codex: AGENTS.override.md, then AGENTS.md).
// `missingFix`: the `instructions.present` fix for this engine (the catalog's fix is the generic fallback).
const SOURCES = Object.freeze({
  claude: {
    files: CLAUDE_INSTRUCTION_FILES, globs: CLAUDE_INSTRUCTION_GLOBS, committedExempt: true,
    missingFix: 'Add CLAUDE.md. If the project already has an AGENTS.md, a line @AGENTS.md in CLAUDE.md pulls it in.',
  },
  codex: { files: CODEX_INSTRUCTION_FILES, globs: [], firstNonEmpty: true, missingFix: 'Add AGENTS.md.' },
  copilot: {
    files: COPILOT_INSTRUCTION_FILES, globs: COPILOT_INSTRUCTION_GLOBS,
    missingFix: 'Add AGENTS.md or .github/copilot-instructions.md.',
  },
  cursor: {
    files: CURSOR_INSTRUCTION_FILES, globs: CURSOR_INSTRUCTION_GLOBS,
    missingFix: 'Add AGENTS.md or a rule in .cursor/rules (a .mdc file).',
  },
  gemini: { files: GEMINI_INSTRUCTION_FILES, globs: [], missingFix: 'Add GEMINI.md.' },
  qwen: { files: QWEN_INSTRUCTION_FILES, globs: [], missingFix: 'Add QWEN.md or AGENTS.md.' },
  goose: { files: GOOSE_INSTRUCTION_FILES, globs: [], missingFix: 'Add AGENTS.md or .goosehints.' },
  opencode: { files: OPENCODE_INSTRUCTION_FILES, globs: [], missingFix: 'Add AGENTS.md.' },
});

export const DECLARED_ENGINES = Object.freeze(Object.keys(SOURCES));

const NO_SOURCES = Object.freeze({ files: [], globs: [] });

function globRe(glob) {
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '(?:.*/)?');
  return new RegExp(`^${re}$`);
}

const sourcesOf = (name) => SOURCES[name] ?? NO_SOURCES;
/** What the chip reads for an engine: `{ files, globs, firstNonEmpty? }` (an engine with no sources: empty lists). */
export function engineSources(name) {
  const { files, globs, firstNonEmpty } = sourcesOf(name);
  return { files, globs, ...(firstNonEmpty ? { firstNonEmpty: true } : {}) };
}
const hasSources = (src) => src.files.length + src.globs.length > 0;

function globMatches(src, facts) {
  const files = filesOf(facts);
  if (!files) return [];
  const res = src.globs.map(globRe);
  return [...files].filter((p) => res.some((re) => re.test(p)));
}

const exists = (p, facts) => facts.trackedSet?.has(p) || facts.sizes?.[p] !== undefined;

/** The literal instruction files the engine reads that exist: tracked, or present on disk. */
function presentFiles(src, facts) {
  const own = src.files.filter((p) => exists(p, facts));
  if (src.firstNonEmpty) return own.filter((p) => facts.sizes?.[p] !== 0).slice(0, 1);
  return own;
}


const kb = (n) => `${Math.round(n / 1024)} KB`;

// Tool-scope checks: run once per engine, on that engine's own instruction files.
const TOOL = Object.freeze({
  'instructions.present': (src, facts) => {
    if (!hasSources(src)) return { status: 'skip' };
    const found = [...presentFiles(src, facts), ...globMatches(src, facts)];
    if (found.length) return { status: 'pass', detail: `${found.slice(0, 2).join(', ')} found` };
    const empty = src.firstNonEmpty ? src.files.filter((p) => facts.sizes?.[p] === 0) : [];
    if (empty.length) return { status: 'fail', detail: `${empty.join(', ')} ${empty.length > 1 ? 'are' : 'is'} empty` };
    return { status: 'fail', detail: `none of ${[...src.files, ...src.globs].join(', ')} found` };
  },
  'instructions.committed': (src, facts) => {
    if (!hasSources(src) || src.committedExempt || !facts.trackedSet) return { status: 'skip' };
    const files = presentFiles(src, facts).filter((p) => !LOCAL_ONLY_FILES.includes(p));
    if (!files.length) return { status: 'skip' };
    // A worktree materializes only committed blobs: untracked, or tracked with any porcelain
    // change (staged or in the worktree), reaches the engine as missing or stale content.
    const notCommitted = files.filter((p) => !facts.trackedSet.has(p) || facts.instructionStatus?.[p]);
    return notCommitted.length
      ? { status: 'fail', detail: `${notCommitted.join(', ')} not committed` }
      : { status: 'pass', detail: `${files.join(', ')} committed` };
  },
  'instructions.size': (src, facts) => {
    if (!hasSources(src) || facts.truncated) return { status: 'skip' };
    const sizes = presentFiles(src, facts).map((p) => [p, facts.sizes?.[p]]).filter(([, n]) => typeof n === 'number');
    if (!sizes.length) return { status: 'skip' };
    const over = sizes.find(([, n]) => n > DEFAULT_CONTEXT_MAX_BYTES_PER_FILE);
    if (over) return { status: 'fail', detail: `${over[0]} is ${kb(over[1])}, over the ${kb(DEFAULT_CONTEXT_MAX_BYTES_PER_FILE)} limit` };
    const total = sizes.reduce((a, [, n]) => a + n, 0);
    if (total > DEFAULT_CONTEXT_MAX_BYTES_TOTAL) return { status: 'fail', detail: `instruction files total ${kb(total)}` };
    return { status: 'pass', detail: `under the ${kb(DEFAULT_CONTEXT_MAX_BYTES_PER_FILE)} limit` };
  },
});

/** Run a check; a throw becomes an 'error' result (never a failure). */
function safeRun(check, facts) {
  try {
    const r = check.run(facts);
    return r && typeof r.status === 'string' ? r : { status: 'error', detail: 'check returned no status' };
  } catch (e) {
    return { status: 'error', detail: e?.message || String(e) };
  }
}

// 'error' and 'skip' never count as failures; an ignored check never counts.
function levelOf(rows, ignoreSet) {
  const failing = rows.filter((r) => r.status === 'fail' && !ignoreSet.has(r.id));
  const level = failing.some((r) => r.severity === 'blocker') ? 'not-ready'
    : failing.some((r) => r.severity === 'warn') ? 'partial' : 'ready';
  return { level, failing: failing.map((r) => r.id) };
}

/**
 * The base report: repository rows (once), tool rows (one per engine), the repository level and a tool level per
 * engine. Which engines are used is not decided here (used.mjs / report.mjs). A locked engine is `unknown`.
 */
export function evaluateEngines(facts, { ignore = [], env = process.env } = {}) {
  const ignoreSet = new Set(ignore);
  const engines = listEngines().map((e) => e.name).filter((n) => n !== 'mock');
  const lockedBy = new Map(engineLocks(env).map((l) => [l.name, l.reason]));
  const row = (check, result, engine) => ({
    id: check.id, title: check.title, scope: check.scope, severity: check.severity,
    ...(engine ? { engine } : {}),
    status: ignoreSet.has(check.id) ? 'ignored' : result.status,
    ...(result.detail === undefined ? {} : { detail: result.detail }),
    fix: (check.id === 'instructions.present' && sourcesOf(engine).missingFix) || check.fix,
  });

  // Facts that could not be collected (git refused to run on this repository's config, or its first call timed out, so
  // whether this is a repository is not known) answer no check: each row says why.
  const failed = facts.error ? { status: 'error', detail: facts.error }
    : !facts.isRepo && facts.timedOut && !facts.folder ? { status: 'error', detail: 'git timed out' } : null;
  const repoRows = CHECKS.filter((c) => c.scope === 'repository').map((c) => row(c, failed || safeRun(c, facts)));
  // Only uncollected facts make the report unknown. Not a git repo is the repository's own failure (counted once, there):
  // the tool checks skip, and every judged tool is not-ready with no failure of its own. If the person ignores git.repo,
  // the tools have no facts to be judged on and stay unknown.
  const broken = !!failed;
  // The check's own result: an ignored row reads 'ignored', and the tools still have no repository to be judged in.
  const repoFailed = !broken && safeRun(CHECKS.find((c) => c.id === 'git.repo'), facts).status === 'fail';
  const noRepo = repoFailed && !ignoreSet.has('git.repo');
  const toolSkip = repoFailed ? { status: 'skip', detail: 'not a git work tree' } : null;
  const toolRows = {};
  for (const name of engines) {
    toolRows[name] = CHECKS.filter((c) => c.scope === 'tool').map((c) => {
      const impl = TOOL[c.id];
      return row(c, failed || toolSkip || (impl ? safeRun({ run: (f) => impl(sourcesOf(name), f) }, facts) : { status: 'skip' }), name);
    });
  }

  const unknown = { level: 'unknown', failing: [] };
  const out = {};
  for (const name of engines) {
    out[name] = lockedBy.has(name) ? { ...unknown, locked: lockedBy.get(name) }
      : broken ? unknown
      : noRepo ? { level: 'not-ready', failing: [] }
      : repoFailed ? unknown
      : levelOf(toolRows[name], ignoreSet);
  }
  return {
    checks: [...repoRows, ...engines.flatMap((n) => toolRows[n])],
    repository: broken ? unknown : levelOf(repoRows, ignoreSet),
    engines: out,
  };
}
