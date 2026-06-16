// server/results-store.js
//
// Pure, side-effect-light helpers for reading and aggregating worca-bench
// results. The source of truth on disk is `<target-dir>/results.jsonl`, an
// append-only file with one JSON object per benchmark rep (see the schema in
// docs / the W-075 plan). Everything here is unit-testable without a server:
// `readResults` is the only function that touches the filesystem, and the
// aggregation functions operate on a plain rows array.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Read and parse `<targetDir>/results.jsonl` into an array of row objects.
 * Tolerant of blank lines and trailing newlines; malformed lines are skipped
 * rather than throwing, so one bad append never blanks the whole dashboard.
 *
 * @param {string} targetDir
 * @returns {object[]} parsed rows (empty array if the file is missing)
 */
export function readResults(targetDir) {
  const file = join(targetDir, 'results.jsonl');
  if (!existsSync(file)) return [];
  const raw = readFileSync(file, 'utf8');
  const rows = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed line — a partial append must not break the read.
    }
  }
  return rows;
}

/**
 * Read results from several dirs and concatenate, tagging each row with the
 * `_source_dir` it came from (so artifact drill-down can resolve against the
 * owning dir). Dirs are deduped.
 *
 * @param {string[]} dirs
 * @returns {object[]} parsed rows across all dirs
 */
export function readResultsMulti(dirs) {
  const out = [];
  const seen = new Set();
  for (const dir of dirs) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    for (const row of readResults(dir)) {
      out.push({ ...row, _source_dir: dir });
    }
  }
  return out;
}

/**
 * Read profile defs across several dirs, deduped by name (first dir wins).
 *
 * @param {string[]} dirs
 * @returns {Array<{name: string, benchmark: string|null}>}
 */
export function readProfileDefsMulti(dirs) {
  const out = [];
  const names = new Set();
  const seen = new Set();
  for (const dir of dirs) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    for (const def of readProfileDefs(dir)) {
      if (names.has(def.name)) continue;
      names.add(def.name);
      out.push(def);
    }
  }
  return out;
}

/**
 * Read experiment definitions from `<targetDir>/profiles/*.yaml`. We surface
 * only the cheap fields (name + benchmark) with a minimal line-oriented YAML
 * scan — no YAML dependency, and results.jsonl remains the source of truth for
 * everything else.
 *
 * Each def is tagged with `_source_dir` (the `profiles/` dir it was read from)
 * so the launcher can pass `--profiles-dir` and find a YAML authored in a
 * configured, non-primary result dir.
 *
 * @param {string} targetDir
 * @returns {Array<{name, benchmark, template, grade_mode, _source_dir}>}
 */
export function readProfileDefs(targetDir) {
  const dir = join(targetDir, 'profiles');
  if (!existsSync(dir)) return [];
  const scalar = (text, key) => {
    const m = text.match(new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, 'm'));
    if (!m) return null;
    // Strip an inline YAML comment (whitespace + #...) and surrounding quotes.
    const v = m[1]
      .replace(/\s+#.*$/, '')
      .trim()
      .replace(/^["']|["']$/g, '');
    return v || null;
  };
  const defs = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) continue;
    const name = entry.replace(/\.ya?ml$/, '');
    let benchmark = null;
    let template = null;
    let grade_mode = null;
    try {
      const text = readFileSync(join(dir, entry), 'utf8');
      benchmark = scalar(text, 'benchmark');
      template = scalar(text, 'template');
      // grade: { mode: X } (nested) or `grade: X` (inline shorthand).
      grade_mode = scalar(text, 'mode') || scalar(text, 'grade');
    } catch {
      // Unreadable profile file — surface the name only.
    }
    defs.push({ name, benchmark, template, grade_mode, _source_dir: dir });
  }
  return defs;
}

function _mean(values) {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return sum / values.length;
}

function _iterations(row) {
  const counters = row.loop_counters;
  if (!counters || typeof counters !== 'object') return 0;
  return Object.values(counters).reduce(
    (a, b) => a + (typeof b === 'number' ? b : 0),
    0,
  );
}

/**
 * Aggregate a single profile's rows into a summary object. Exported so the
 * profile-detail endpoint and compare endpoint share one code path.
 *
 * resolved_rate is computed over rows where `resolved` is a boolean (graded
 * reps) — `null`/missing reps (not yet graded, errored) are excluded from the
 * denominator so the rate reflects graded outcomes, not run progress.
 *
 * @param {string} name
 * @param {object[]} rows  rows already filtered to this profile
 * @returns {object} aggregate summary
 */
export function aggregateProfile(name, rows) {
  const first = rows[0] || {};
  const graded = rows.filter((r) => typeof r.resolved === 'boolean');
  const resolvedCount = graded.filter((r) => r.resolved === true).length;
  const costs = rows
    .map((r) => r.cost_usd)
    .filter((c) => typeof c === 'number');
  const walls = rows
    .map((r) => r.wall_time_s)
    .filter((w) => typeof w === 'number');
  const iterations = rows.map(_iterations);

  const lastRun = rows.reduce((latest, r) => {
    const ts = r.completed_at || r.started_at || null;
    if (ts && (!latest || ts > latest)) return ts;
    return latest;
  }, null);

  return {
    name,
    benchmark: first.benchmark || null,
    worca_ref: first.worca_ref || null,
    worca_version: first.worca_version || null,
    template: first.template || null,
    grade_mode: first.grade_mode || null,
    reps: rows.length,
    graded: graded.length,
    resolved: resolvedCount,
    resolved_rate: graded.length > 0 ? resolvedCount / graded.length : 0,
    mean_cost_usd: _mean(costs),
    mean_wall_s: _mean(walls),
    mean_iterations: _mean(iterations),
    n: rows.length,
    last_run: lastRun,
  };
}

/**
 * Group all rows by their `profile` field and aggregate each group.
 * Result is sorted by profile name for deterministic rendering.
 *
 * @param {object[]} rows
 * @returns {object[]} array of aggregate summaries, one per profile
 */
export function aggregateByProfile(rows) {
  const byProfile = new Map();
  for (const row of rows) {
    const key = row.profile || '(unknown)';
    if (!byProfile.has(key)) byProfile.set(key, []);
    byProfile.get(key).push(row);
  }
  const out = [];
  for (const [name, group] of byProfile) {
    out.push(aggregateProfile(name, group));
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Build a side-by-side comparison for the named profiles. Profiles with no
 * matching rows are returned with `reps: 0` so the compare table can still show
 * the requested column (rather than silently dropping it).
 *
 * @param {object[]} rows
 * @param {string[]} names
 * @returns {object[]} aggregates in the same order as `names`
 */
export function compareProfiles(rows, names) {
  const byProfile = new Map();
  for (const row of rows) {
    const key = row.profile || '(unknown)';
    if (!byProfile.has(key)) byProfile.set(key, []);
    byProfile.get(key).push(row);
  }
  return names.map((name) => aggregateProfile(name, byProfile.get(name) || []));
}
