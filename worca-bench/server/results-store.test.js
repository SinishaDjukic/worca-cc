import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  aggregateByProfile,
  aggregateProfile,
  compareProfiles,
  readProfileDefs,
  readResults,
  srcHash,
} from './results-store.js';

function row(overrides = {}) {
  return {
    schema_version: 1,
    profile: 'p1',
    benchmark: 'swe-bench-verified',
    instance_id: 'inst-1',
    worca_ref: 'local',
    template: 'builtin:feature',
    rep: 1,
    run_id: 'r1',
    status: 'graded',
    resolved: true,
    score: 1.0,
    cost_usd: 0.4,
    wall_time_s: 600,
    loop_counters: { implement_test: 2, pr_changes: 0 },
    completed_at: '2026-06-16T10:00:00Z',
    ...overrides,
  };
}

describe('readResults', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bench-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns [] when results.jsonl is missing', () => {
    expect(readResults(dir)).toEqual([]);
  });

  it('parses one object per line and skips blanks/malformed', () => {
    const lines = [
      JSON.stringify(row({ rep: 1 })),
      '',
      '   ',
      '{ not valid json',
      JSON.stringify(row({ rep: 2, resolved: false })),
    ].join('\n');
    writeFileSync(join(dir, 'results.jsonl'), `${lines}\n`);
    const rows = readResults(dir);
    expect(rows).toHaveLength(2);
    expect(rows[0].rep).toBe(1);
    expect(rows[1].resolved).toBe(false);
  });
});

describe('aggregateProfile', () => {
  it('computes resolved_rate over graded rows only', () => {
    const rows = [
      row({ rep: 1, resolved: true }),
      row({ rep: 2, resolved: false }),
      row({ rep: 3, resolved: true }),
      // not-yet-graded reps excluded from the denominator
      row({ rep: 4, status: 'ran', resolved: null }),
      row({ rep: 5, status: 'error', resolved: null }),
    ];
    const agg = aggregateProfile('p1', rows);
    expect(agg.reps).toBe(5);
    expect(agg.graded).toBe(3);
    expect(agg.resolved).toBe(2);
    expect(agg.resolved_rate).toBeCloseTo(2 / 3);
  });

  it('computes mean cost, wall time, and iterations', () => {
    const rows = [
      row({ rep: 1, cost_usd: 0.2, wall_time_s: 100, loop_counters: { a: 1 } }),
      row({ rep: 2, cost_usd: 0.4, wall_time_s: 300, loop_counters: { a: 3 } }),
    ];
    const agg = aggregateProfile('p1', rows);
    expect(agg.mean_cost_usd).toBeCloseTo(0.3);
    expect(agg.mean_wall_s).toBeCloseTo(200);
    expect(agg.mean_iterations).toBeCloseTo(2);
  });

  it('carries benchmark/worca_ref/template from the first row', () => {
    const agg = aggregateProfile('p1', [row()]);
    expect(agg.benchmark).toBe('swe-bench-verified');
    expect(agg.worca_ref).toBe('local');
    expect(agg.template).toBe('builtin:feature');
  });

  it('carries worca_version + grade_mode config metadata from the first row', () => {
    const agg = aggregateProfile('p1', [
      row({ worca_version: '0.58.0', grade_mode: 'local-docker' }),
    ]);
    expect(agg.worca_version).toBe('0.58.0');
    expect(agg.grade_mode).toBe('local-docker');
  });

  it('picks last_run as the latest completed_at', () => {
    const rows = [
      row({ rep: 1, completed_at: '2026-06-16T10:00:00Z' }),
      row({ rep: 2, completed_at: '2026-06-16T12:00:00Z' }),
    ];
    expect(aggregateProfile('p1', rows).last_run).toBe('2026-06-16T12:00:00Z');
  });

  it('handles empty input without throwing', () => {
    const agg = aggregateProfile('p1', []);
    expect(agg.reps).toBe(0);
    expect(agg.resolved_rate).toBe(0);
    expect(agg.mean_cost_usd).toBeNull();
    expect(agg.mean_iterations).toBeNull();
  });

  it('dedupes re-runs by (instance, rep), keeping the latest', () => {
    const agg = aggregateProfile('p1', [
      row({
        status: 'skipped',
        resolved: null,
        completed_at: '2026-06-16T09:00:00Z',
      }),
      row({
        status: 'graded',
        resolved: true,
        completed_at: '2026-06-16T11:00:00Z',
      }),
    ]);
    expect(agg.reps).toBe(1); // the stale skipped attempt is superseded
    expect(agg.resolved_rate).toBe(1);
  });

  it('computes mean_score and excludes skipped + errored reps from means', () => {
    const agg = aggregateProfile('p1', [
      row({
        instance_id: 'a',
        rep: 1,
        status: 'graded',
        resolved: true,
        score: 1.0,
        cost_usd: 1.0,
        wall_time_s: 100,
      }),
      row({
        instance_id: 'b',
        rep: 1,
        status: 'graded',
        resolved: false,
        score: 0.0,
        cost_usd: 3.0,
        wall_time_s: 300,
      }),
      // errored rep with 0 cost/time must not drag the means down
      row({
        instance_id: 'c',
        rep: 1,
        status: 'error',
        resolved: null,
        score: null,
        cost_usd: 0,
        wall_time_s: 0,
      }),
    ]);
    expect(agg.mean_score).toBe(0.5); // (1 + 0) / 2 graded
    expect(agg.mean_cost_usd).toBe(2.0); // (1 + 3) / 2, error excluded
    expect(agg.mean_wall_s).toBe(200);
  });

  it('excludes skipped reps from cost/wall/iteration means', () => {
    const agg = aggregateProfile('p1', [
      row({
        instance_id: 'a',
        rep: 1,
        status: 'graded',
        resolved: true,
        cost_usd: 1.0,
        wall_time_s: 100,
        loop_counters: { implement_test: 2 },
      }),
      row({
        instance_id: 'b',
        rep: 1,
        status: 'skipped',
        resolved: null,
        cost_usd: 0,
        wall_time_s: 0,
        loop_counters: {},
      }),
    ]);
    expect(agg.reps).toBe(2); // both count as reps
    expect(agg.mean_cost_usd).toBe(1.0); // the skipped 0 is excluded
    expect(agg.mean_wall_s).toBe(100);
    expect(agg.mean_iterations).toBe(2);
  });
});

describe('readProfileDefs', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bench-defs-'));
    mkdirSync(join(dir, 'profiles'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('parses benchmark, template, and nested grade.mode', () => {
    writeFileSync(
      join(dir, 'profiles', 'p.yaml'),
      'name: p\nbenchmark: swe-bench-verified\ntemplate: builtin:quick-fix\ngrade:\n  mode: local-docker\n',
    );
    const [def] = readProfileDefs(dir);
    expect(def.name).toBe('p');
    expect(def.benchmark).toBe('swe-bench-verified');
    expect(def.template).toBe('builtin:quick-fix');
    expect(def.grade_mode).toBe('local-docker');
  });

  it('parses the inline grade shorthand (grade: stub)', () => {
    writeFileSync(
      join(dir, 'profiles', 'q.yaml'),
      'name: q\nbenchmark: commit0\ntemplate: builtin:feature\ngrade: stub\n',
    );
    expect(readProfileDefs(dir)[0].grade_mode).toBe('stub');
  });

  it('strips inline YAML comments from scalar values', () => {
    writeFileSync(
      join(dir, 'profiles', 'c.yaml'),
      'name: c\nbenchmark: swe-bench-verified\ngrade:\n  mode: local-docker    # needs Docker\n',
    );
    expect(readProfileDefs(dir)[0].grade_mode).toBe('local-docker');
  });
});

describe('src scoping (same name across result dirs)', () => {
  it('keeps same-named profiles from different dirs distinct', () => {
    const out = aggregateByProfile([
      row({ profile: 'x', _source_dir: '/data/a', resolved: true }),
      row({ profile: 'x', _source_dir: '/data/b', resolved: false }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.every((o) => o.name === 'x')).toBe(true);
    expect(out[0].src).not.toBe(out[1].src);
    expect(new Set(out.map((o) => o.source_dir))).toEqual(
      new Set(['/data/a', '/data/b']),
    );
    expect(new Set(out.map((o) => o.source_label))).toEqual(
      new Set(['a', 'b']),
    );
  });

  it('compareProfiles scopes a ref by name@src', () => {
    const rows = [
      row({
        profile: 'x',
        instance_id: 'a',
        _source_dir: '/data/a',
        resolved: true,
        cost_usd: 1,
      }),
      row({
        profile: 'x',
        instance_id: 'b',
        _source_dir: '/data/b',
        resolved: false,
        cost_usd: 5,
      }),
    ];
    const [a] = compareProfiles(rows, [`x@${srcHash('/data/a')}`]);
    expect(a.resolved_rate).toBe(1); // only the /data/a row
    expect(a.mean_cost_usd).toBe(1);
    // a bare name (no @src) still matches across dirs
    expect(compareProfiles(rows, ['x'])[0].reps).toBe(2);
  });
});

describe('aggregateByProfile', () => {
  it('groups rows by profile and sorts by name', () => {
    const rows = [
      row({ profile: 'zeta', rep: 1, resolved: true }),
      row({ profile: 'alpha', rep: 1, resolved: false }),
      row({ profile: 'alpha', rep: 2, resolved: true }),
    ];
    const out = aggregateByProfile(rows);
    expect(out.map((a) => a.name)).toEqual(['alpha', 'zeta']);
    const alpha = out.find((a) => a.name === 'alpha');
    expect(alpha.reps).toBe(2);
    expect(alpha.resolved_rate).toBeCloseTo(0.5);
  });

  it('returns [] for empty input', () => {
    expect(aggregateByProfile([])).toEqual([]);
  });
});

describe('compareProfiles', () => {
  it('returns aggregates in requested order, zero-filling missing', () => {
    const rows = [
      row({ profile: 'a', resolved: true }),
      row({ profile: 'b', resolved: false }),
    ];
    const out = compareProfiles(rows, ['b', 'a', 'missing']);
    expect(out.map((a) => a.name)).toEqual(['b', 'a', 'missing']);
    expect(out[2].reps).toBe(0);
    expect(out[2].resolved_rate).toBe(0);
  });
});
