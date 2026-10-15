// Per-engine view of the readiness checks: which instruction files each engine reads, the tool-scope check
// rows (one per engine), the repository rows (once), the ignore list, and the resulting levels.
// Pure over facts (+ env for engine locks).
import { listEngines } from '../engines/index.mjs';
import { engineLocks } from '../engines/readiness.mjs';
import { CLAUDE_INSTRUCTION_FILES, CLAUDE_INSTRUCTION_GLOBS } from '../engines/claude.mjs';
import { CODEX_INSTRUCTION_FILES } from '../engines/codex.mjs';
import { COPILOT_INSTRUCTION_FILES } from '../engines/copilot.mjs';
import { CURSOR_INSTRUCTION_FILES } from '../engines/cursor.mjs';
import { DEFAULT_CONTEXT_MAX_BYTES_PER_FILE, DEFAULT_CONTEXT_MAX_BYTES_TOTAL } from '../settings.mjs';
import { CHECKS } from './checks.mjs';

// Untracked by convention, so never part of `instructions.committed`.
const LOCAL_ONLY_FILES = Object.freeze(['CLAUDE.local.md']);

// `committedExempt`: Claude reads the real directory (run-context), not the worktree, so an uncommitted file is fine.
// `fallback`: files the engine reads only when none of `files` exists (globs do not count): Claude Code reads
// AGENTS.md when there is no CLAUDE.md, .claude/CLAUDE.md or CLAUDE.local.md (code.claude.com/docs/en/memory#agents-md).
// `missingFix`: the `instructions.present` fix for this engine (the catalog's fix is the generic fallback).
const SOURCES = Object.freeze({
  claude: {
    files: CLAUDE_INSTRUCTION_FILES, globs: CLAUDE_INSTRUCTION_GLOBS, committedExempt: true,
    fallback: ['AGENTS.md', '.claude/AGENTS.md'],
    missingFix: 'Add AGENTS.md (OpenAI Codex and GitHub Copilot read it too) or CLAUDE.md.',
  },
  codex: { files: CODEX_INSTRUCTION_FILES, globs: [], missingFix: 'Add AGENTS.md.' },
  copilot: { files: COPILOT_INSTRUCTION_FILES, globs: [], missingFix: 'Add AGENTS.md or .github/copilot-instructions.md.' },
  cursor: { files: CURSOR_INSTRUCTION_FILES, globs: [] },
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
const hasSources = (src) => src.files.length + src.globs.length > 0;

function globMatches(src, facts) {
  if (!facts.trackedSet) return [];
  const res = src.globs.map(globRe);
  return [...facts.trackedSet].filter((p) => res.some((re) => re.test(p)));
}

/** The literal instruction files the engine reads that exist: tracked, or present on disk. Its fallback files only when none of its own exists. */
function presentFiles(src, facts) {
  const exists = (p) => facts.trackedSet?.has(p) || facts.sizes?.[p] !== undefined;
  const own = src.files.filter(exists);
  return own.length ? own : (src.fallback || []).filter(exists);
}

const kb = (n) => `${Math.round(n / 1024)} KB`;

// Tool-scope checks: run once per engine, on that engine's own instruction files.
const TOOL = Object.freeze({
  'instructions.present': (src, facts) => {
    if (!hasSources(src)) return { status: 'skip' };
    const found = [...presentFiles(src, facts), ...globMatches(src, facts)];
    if (found.length) return { status: 'pass', detail: `${found.slice(0, 2).join(', ')} found` };
    return { status: 'fail', detail: `none of ${[...src.files, ...src.globs, ...(src.fallback || [])].join(', ')} found` };
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

  const repoRows = CHECKS.filter((c) => c.scope === 'repository').map((c) => row(c, safeRun(c, facts)));
  const toolRows = {};
  for (const name of engines) {
    toolRows[name] = CHECKS.filter((c) => c.scope === 'tool').map((c) => {
      const impl = TOOL[c.id];
      return row(c, impl ? safeRun({ run: (f) => impl(sourcesOf(name), f) }, facts) : { status: 'skip' }, name);
    });
  }

  const broken = !!facts.error || repoRows.find((r) => r.id === 'git.repo')?.status === 'fail';
  const unknown = { level: 'unknown', failing: [] };
  const out = {};
  for (const name of engines) {
    out[name] = lockedBy.has(name) ? { ...unknown, locked: lockedBy.get(name) } : broken ? unknown : levelOf(toolRows[name], ignoreSet);
  }
  return {
    checks: [...repoRows, ...engines.flatMap((n) => toolRows[n])],
    repository: broken ? unknown : levelOf(repoRows, ignoreSet),
    engines: out,
  };
}
