// server/results-store.js
//
// Pure, side-effect-light helpers for reading and aggregating worca-bench
// results. The source of truth on disk is `<target-dir>/results.jsonl`, an
// append-only file with one JSON object per benchmark rep (see the schema in
// docs / the W-075 plan). Everything here is unit-testable without a server:
// `readResults` is the only function that touches the filesystem, and the
// aggregation functions operate on a plain rows array.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * Stable short id for a result dir, so same-named profiles from different dirs
 * are distinct and individually navigable (`#/profile?name=X&src=<hash>`).
 */
export function srcHash(dir) {
  if (!dir) return 'na';
  return createHash('sha256').update(String(dir)).digest('hex').slice(0, 8);
}

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
 * Count the entries under a `selection.instance_ids:` YAML block. Returns the
 * number of `- item` lines indented under that key, or `null` when the key is
 * absent (no explicit selection → the benchmark runs its full instance set).
 * A line-oriented scan, consistent with the rest of this dependency-free reader.
 *
 * @param {string} text  raw YAML
 * @returns {number|null}
 */
export function countInstanceIds(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^\s*instance_ids\s*:/.test(l));
  if (start < 0) return null;
  const keyIndent = lines[start].match(/^\s*/)[0].length;
  let count = 0;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue; // blank / comment
    const indent = line.match(/^\s*/)[0].length;
    if (indent <= keyIndent) break; // dedented out of the block
    if (/^\s*-\s*\S/.test(line)) count++;
  }
  return count;
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
 * @returns {Array<{name, benchmark, template, grade_mode, instance_count, _source_dir}>}
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
    let instance_count = null;
    try {
      const text = readFileSync(join(dir, entry), 'utf8');
      benchmark = scalar(text, 'benchmark');
      template = scalar(text, 'template');
      // grade: { mode: X } (nested) or `grade: X` (inline shorthand).
      grade_mode = scalar(text, 'mode') || scalar(text, 'grade');
      // `selection.instance_ids` count — null when the key is absent (the
      // benchmark runs its full instance set, surfaced as "All" in the UI).
      instance_count = countInstanceIds(text);
    } catch {
      // Unreadable profile file — surface the name only.
    }
    defs.push({
      name,
      benchmark,
      template,
      grade_mode,
      instance_count,
      _source_dir: dir,
    });
  }
  return defs;
}

function _mean(values) {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return sum / values.length;
}

/**
 * Collapse re-runs: keep only the most recent row per (instance_id, rep) so a
 * re-run supersedes an earlier skipped/errored attempt instead of accumulating.
 * Latest = greatest completed_at (else started_at). Order is otherwise preserved.
 *
 * @param {object[]} rows
 * @returns {object[]}
 */
export function dedupeReps(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const key = `${r.instance_id ?? '?'}::${r.rep ?? '?'}`;
    const ts = r.completed_at || r.started_at || '';
    const cur = byKey.get(key);
    const curTs = cur ? cur.completed_at || cur.started_at || '' : '';
    if (!cur || ts >= curTs) byKey.set(key, r);
  }
  return [...byKey.values()];
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
export function aggregateProfile(name, allRows) {
  const rows = dedupeReps(allRows);
  const first = rows[0] || {};
  const graded = rows.filter((r) => typeof r.resolved === 'boolean');
  const resolvedCount = graded.filter((r) => r.resolved === true).length;
  // Skipped + errored reps carry no real measurement (cost/time ~0) — exclude
  // them so means/averages reflect reps that actually ran to a graded outcome.
  const measured = rows.filter(
    (r) => r.status !== 'skipped' && r.status !== 'error',
  );
  const costs = measured
    .map((r) => r.cost_usd)
    .filter((c) => typeof c === 'number');
  const walls = measured
    .map((r) => r.wall_time_s)
    .filter((w) => typeof w === 'number');
  const iterations = measured.map(_iterations);
  const scores = measured
    .map((r) => r.score)
    .filter((s) => typeof s === 'number');

  const lastRun = rows.reduce((latest, r) => {
    const ts = r.completed_at || r.started_at || null;
    if (ts && (!latest || ts > latest)) return ts;
    return latest;
  }, null);

  const sourceDir = first._source_dir || null;
  return {
    name,
    src: srcHash(sourceDir),
    source_dir: sourceDir,
    source_label: sourceDir ? basename(sourceDir) : null,
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
    mean_score: _mean(scores),
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
  // Group by (source dir, name) so a profile named X in two different result
  // dirs yields two distinct aggregates rather than silently merging.
  const byKey = new Map();
  for (const row of rows) {
    const name = row.profile || '(unknown)';
    const key = `${srcHash(row._source_dir)}::${name}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
  }
  const out = [];
  for (const group of byKey.values()) {
    out.push(aggregateProfile(group[0].profile || '(unknown)', group));
  }
  out.sort(
    (a, b) => a.name.localeCompare(b.name) || a.src.localeCompare(b.src),
  );
  return out;
}

/**
 * Build a side-by-side comparison for the requested profiles. Each ref is
 * `name` or `name@src` (src scopes to a specific result dir). Refs with no
 * matching rows return `reps: 0` so the compare column still shows.
 *
 * @param {object[]} rows
 * @param {string[]} refs   each "name" or "name@src"
 * @returns {object[]} aggregates in the same order as `refs`
 */
export function compareProfiles(rows, refs) {
  return refs.map((ref) => {
    const at = ref.lastIndexOf('@');
    const name = at >= 0 ? ref.slice(0, at) : ref;
    const src = at >= 0 ? ref.slice(at + 1) : null;
    const group = rows.filter(
      (r) =>
        (r.profile || '(unknown)') === name &&
        (src === null || srcHash(r._source_dir) === src),
    );
    return aggregateProfile(name, group);
  });
}
