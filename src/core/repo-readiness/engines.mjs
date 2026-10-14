// Per-engine view of the readiness checks: which instruction files each engine reads, the perEngine check
// rows (one per engine), the ignore list, and the resulting level. Pure over facts (+ env for engine locks).
import { listEngines } from '../engines/index.mjs';
import { engineLocks } from '../engines/readiness.mjs';
import { CLAUDE_INSTRUCTION_FILES, CLAUDE_INSTRUCTION_GLOBS } from '../engines/claude.mjs';
import { CODEX_INSTRUCTION_FILES } from '../engines/codex.mjs';
import { COPILOT_INSTRUCTION_FILES } from '../engines/copilot.mjs';
import { CURSOR_INSTRUCTION_FILES } from '../engines/cursor.mjs';
import { CHECKS } from './checks.mjs';

// Untracked by convention, so never part of `instructions.committed`.
const LOCAL_ONLY_FILES = Object.freeze(['CLAUDE.local.md']);

// `committedExempt`: Claude reads the real directory (run-context), not the worktree, so an uncommitted file is fine.
const SOURCES = Object.freeze({
  claude: { files: CLAUDE_INSTRUCTION_FILES, globs: CLAUDE_INSTRUCTION_GLOBS, committedExempt: true },
  codex: { files: CODEX_INSTRUCTION_FILES, globs: [] },
  copilot: { files: COPILOT_INSTRUCTION_FILES, globs: [] },
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

/** The literal instruction files that exist for this engine: tracked, or present on disk. */
function presentFiles(src, facts) {
  return src.files.filter((p) => facts.trackedSet?.has(p) || facts.sizes?.[p] !== undefined);
}

const PER_ENGINE = Object.freeze({
  'instructions.present': (src, facts) => {
    if (!hasSources(src)) return { status: 'skip' };
    if (presentFiles(src, facts).length || globMatches(src, facts).length) return { status: 'pass' };
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
      : { status: 'pass' };
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

const appliesList = (check, engineNames) => (check.engines === 'all' ? [...engineNames] : check.engines.filter((n) => engineNames.includes(n)));
const rowApplies = (row, name) => row.engines.includes(name);

function makeRow(check, scope, result, ignoreSet) {
  return {
    id: check.id,
    title: check.title,
    severity: check.severity,
    ...scope,
    status: ignoreSet.has(check.id) ? 'ignored' : result.status,
    ...(result.detail === undefined ? {} : { detail: result.detail }),
    fix: check.fix,
  };
}

/** One row per (perEngine check, engine): `engines: [name]` plus `engine: name`. */
function runPerEngine(facts, engines, ignoreSet) {
  const flatRows = [];
  const byEngine = Object.fromEntries(engines.map((n) => [n, []]));
  for (const check of CHECKS) {
    if (check.engines !== 'perEngine') continue;
    const impl = PER_ENGINE[check.id];
    for (const name of engines) {
      const result = impl ? safeRun({ run: (f) => impl(sourcesOf(name), f) }, facts) : { status: 'skip' };
      const row = makeRow(check, { engines: [name], engine: name }, result, ignoreSet);
      flatRows.push(row);
      byEngine[name].push(row);
    }
  }
  return { flatRows, byEngine };
}

function levelFor(name, sharedRows, engineRows, facts, ignoreSet) {
  const repo = sharedRows.find((r) => r.id === 'git.repo');
  if (facts.error || repo?.status === 'fail') return { level: 'unknown', failing: [] };
  const applicable = [...sharedRows.filter((r) => r.engine === undefined && rowApplies(r, name)), ...(engineRows ?? [])]
    .filter((r) => !ignoreSet.has(r.id) && r.status !== 'ignored');
  // 'error' and 'skip' never count as failures.
  const failing = applicable.filter((r) => r.status === 'fail');
  const level = failing.some((r) => r.severity === 'blocker') ? 'not-ready'
    : failing.some((r) => r.severity === 'warn') ? 'partial' : 'ready';
  return { level, failing: failing.map((r) => r.id) };
}

/** Full report rows plus a level per engine. An engine locked by the broker is `unknown` with the lock reason. */
export function evaluateEngines(facts, { ignore = [], env = process.env } = {}) {
  const ignoreSet = new Set(ignore);
  const engines = listEngines().map((e) => e.name).filter((n) => n !== 'mock');
  const lockedBy = new Map(engineLocks(env).map((l) => [l.name, l.reason]));

  const rows = [];
  for (const check of CHECKS) {
    if (check.engines === 'perEngine') continue;
    rows.push(makeRow(check, { engines: appliesList(check, engines) }, safeRun(check, facts), ignoreSet));
  }
  const perEngine = runPerEngine(facts, engines, ignoreSet);
  rows.push(...perEngine.flatRows);

  const out = {};
  for (const name of engines) {
    out[name] = lockedBy.has(name)
      ? { level: 'unknown', failing: [], locked: lockedBy.get(name) }
      : levelFor(name, rows, perEngine.byEngine[name], facts, ignoreSet);
  }
  return { engines: out, checks: rows };
}
