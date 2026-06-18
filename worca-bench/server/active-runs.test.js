import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `bd stats --json` is shelled out for authoritative bead counts; mock it so the
// suite is hermetic (no bd binary, no real beads DB needed).
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));

import { execFileSync } from 'node:child_process';
import {
  activeByProfile,
  discoverActive,
  discoverRegrades,
} from './active-runs.js';

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bench-active-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function seedStatus(profile, inst, rep, runId, status) {
  const runDir = join(
    dir,
    'work',
    profile,
    inst,
    `rep${rep}`,
    '.worca',
    'runs',
    runId,
  );
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'status.json'), JSON.stringify(status));
}

function seedRegrade(profile, hb) {
  const d = join(dir, 'runs', profile);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'regrade-status.json'), JSON.stringify(hb));
}

describe('discoverRegrades', () => {
  it('surfaces a running heartbeat with a live pid as active', () => {
    seedRegrade('demo', {
      profile: 'demo',
      mode: 'modal',
      pid: process.pid, // this test process is alive
      total: 20,
      done: 7,
      current: 'astropy__astropy-14539',
      counts: { graded: 7, resolved: 4, error: 0 },
      status: 'running',
    });
    const [r] = discoverRegrades(dir);
    expect(r.active).toBe(true);
    expect(r.done).toBe(7);
    expect(r.current).toBe('astropy__astropy-14539');
    expect(typeof r.src).toBe('string');
  });

  it('reclassifies a running heartbeat with a dead pid as ended (not active)', () => {
    seedRegrade('demo', {
      profile: 'demo',
      pid: 2147483000, // implausible pid → not alive
      status: 'running',
      total: 20,
      done: 13,
    });
    const [r] = discoverRegrades(dir);
    expect(r.status).toBe('ended');
    expect(r.active).toBe(false);
  });

  it('keeps a done heartbeat inactive', () => {
    seedRegrade('demo', { profile: 'demo', pid: process.pid, status: 'done' });
    const [r] = discoverRegrades(dir);
    expect(r.active).toBe(false);
  });
});

function seedTemplate(profile, inst, rep, id, stagesCfg) {
  const tdir = join(
    dir,
    'work',
    profile,
    inst,
    `rep${rep}`,
    '.claude',
    'worca',
    'templates',
    id,
  );
  mkdirSync(tdir, { recursive: true });
  writeFileSync(
    join(tdir, 'template.json'),
    JSON.stringify({ config: { stages: stagesCfg } }),
  );
}

describe('discoverActive', () => {
  it('returns nothing when there is no work/ dir', () => {
    expect(discoverActive(dir)).toEqual([]);
  });

  it('reads stage progress from an in-flight status.json', () => {
    seedStatus('p1', 'astropy__astropy-1', 1, 'p1__astropy__astropy-1__rep1', {
      run_id: 'p1__astropy__astropy-1__rep1',
      pipeline_status: 'running',
      stages: {
        preflight: { status: 'completed', skipped: true },
        plan: { status: 'completed', agent: 'planner', model_alias: 'opus' },
        coordinate: { status: 'in_progress', agent: 'coordinator' },
        implement: { status: 'pending' },
      },
    });
    const [run] = discoverActive(dir);
    expect(run.profile).toBe('p1');
    expect(run.instance).toBe('astropy__astropy-1');
    expect(run.rep).toBe(1);
    expect(run.kind).toBe('rep');
    expect(run.pipeline_status).toBe('running');
    expect(run.phase).toBe('running');
    expect(run.stage).toBe('coordinate'); // the in_progress stage
    expect(run.stages.map((s) => `${s.name}:${s.status}`)).toEqual([
      'preflight:completed',
      'plan:completed',
      'coordinate:in_progress',
      'implement:pending',
    ]);
    expect(run.stages[1].model).toBe('opus'); // model_alias preferred
  });

  it('derives loop-back counts (×N) from the stage iteration counter', () => {
    seedStatus('p1', 'lib', 1, 'p1__lib__rep1', {
      run_id: 'p1__lib__rep1',
      pipeline_status: 'running',
      stages: {
        plan: { status: 'completed', iteration: 1 },
        implement: { status: 'in_progress', iteration: 4 },
        test: { status: 'completed', iteration: 3 },
      },
    });
    const [run] = discoverActive(dir);
    const byName = Object.fromEntries(run.stages.map((s) => [s.name, s]));
    expect(byName.implement.iters).toBe(4); // ran 4 times (loop-backs)
    expect(byName.test.iters).toBe(3);
    expect(byName.plan.iters).toBeUndefined(); // single-pass → no suffix
    // No beads DB seeded → no bead count attached.
    expect(byName.implement.beads).toBeUndefined();
  });

  it('attaches authoritative bead counts from `bd stats` (closed/total)', () => {
    execFileSync.mockReturnValue(
      JSON.stringify({ summary: { total_issues: 5, closed_issues: 1 } }),
    );
    seedStatus('p2', 'lib2', 1, 'p2__lib2__rep1', {
      run_id: 'p2__lib2__rep1',
      pipeline_status: 'running',
      stages: { implement: { status: 'in_progress' } },
    });
    // Seed a beads DB so the existsSync guard passes and bd is consulted.
    const beadsDir = join(dir, 'work', 'p2', 'lib2', 'rep1', '.beads');
    mkdirSync(beadsDir, { recursive: true });
    writeFileSync(join(beadsDir, 'beads.db'), 'x');

    const [run] = discoverActive(dir);
    const imp = run.stages.find((s) => s.name === 'implement');
    expect(imp.beads).toEqual({ done: 1, total: 5 });
    expect(execFileSync).toHaveBeenCalledWith(
      'bd',
      ['stats', '--json'],
      expect.objectContaining({ cwd: expect.stringContaining('rep1') }),
    );
  });

  it('shows no bead count when `bd` fails (never a wrong number)', () => {
    execFileSync.mockImplementation(() => {
      throw new Error('bd not found');
    });
    seedStatus('p3', 'lib3', 1, 'p3__lib3__rep1', {
      run_id: 'p3__lib3__rep1',
      pipeline_status: 'running',
      stages: { implement: { status: 'in_progress' } },
    });
    const beadsDir = join(dir, 'work', 'p3', 'lib3', 'rep1', '.beads');
    mkdirSync(beadsDir, { recursive: true });
    writeFileSync(join(beadsDir, 'beads.db'), 'x');

    const [run] = discoverActive(dir);
    expect(
      run.stages.find((s) => s.name === 'implement').beads,
    ).toBeUndefined();
  });

  it('excludes terminal runs (interrupted/failed) whose work tree lingers', () => {
    // A stopped run leaves an `interrupted` status.json on disk until cleanup;
    // it must NOT surface as an active run (no stale "running" live card).
    seedStatus('p1', 'astropy__astropy-stopped', 1, 'p1__stopped__rep1', {
      run_id: 'p1__stopped__rep1',
      pipeline_status: 'interrupted',
      stages: { plan: { status: 'interrupted' } },
    });
    seedStatus('p1', 'astropy__astropy-broke', 1, 'p1__broke__rep1', {
      run_id: 'p1__broke__rep1',
      pipeline_status: 'failed',
      stages: {
        plan: { status: 'completed' },
        implement: { status: 'failed' },
      },
    });
    // A genuinely running one alongside them is still reported.
    seedStatus('p1', 'astropy__astropy-live', 1, 'p1__live__rep1', {
      run_id: 'p1__live__rep1',
      pipeline_status: 'running',
      stages: { plan: { status: 'in_progress' } },
    });
    const runs = discoverActive(dir);
    expect(runs.map((r) => r.instance)).toEqual(['astropy__astropy-live']);
  });

  it('reports the grading phase when the pipeline is completed but still active', () => {
    seedStatus('p1', 'i', 1, 'p1__i__rep1', {
      run_id: 'p1__i__rep1',
      pipeline_status: 'completed',
      stages: {
        plan: { status: 'completed' },
        implement: { status: 'completed' },
      },
    });
    expect(discoverActive(dir)[0].phase).toBe('grading');
  });

  it('hides template-disabled stages but keeps ones that ran', () => {
    seedStatus('p1', 'i', 1, 'p1__i__rep1', {
      run_id: 'p1__i__rep1',
      pipeline_status: 'running',
      pipeline_template: 'builtin:quick-fix',
      stages: {
        preflight: { status: 'completed', skipped: true },
        plan: { status: 'completed' },
        coordinate: { status: 'in_progress' },
        implement: { status: 'pending' },
        test: { status: 'pending' },
        review: { status: 'pending' },
        pr: { status: 'pending' },
      },
    });
    seedTemplate('p1', 'i', 1, 'quick-fix', {
      plan: { enabled: true },
      coordinate: { enabled: true },
      implement: { enabled: true },
      test: { enabled: false },
      review: { enabled: false },
      pr: { enabled: false },
    });
    const names = discoverActive(dir)[0].stages.map((s) => s.name);
    // test/review/pr disabled + never ran -> hidden; preflight (skipped) kept.
    expect(names).toEqual(['preflight', 'plan', 'coordinate', 'implement']);
  });

  it('shows all stages when the template config is unavailable', () => {
    seedStatus('p1', 'i', 1, 'p1__i__rep1', {
      run_id: 'p1__i__rep1',
      pipeline_status: 'running',
      pipeline_template: 'builtin:quick-fix',
      stages: { plan: { status: 'completed' }, test: { status: 'pending' } },
    });
    // no seedTemplate -> can't resolve -> show everything
    expect(discoverActive(dir)[0].stages.map((s) => s.name)).toEqual([
      'plan',
      'test',
    ]);
  });

  it('flags a canary run by its run_id', () => {
    seedStatus('p1', '__canary__', 0, 'canary-quick-fix', {
      run_id: 'canary-quick-fix',
      pipeline_status: 'running',
      stages: { plan: { status: 'in_progress' } },
    });
    expect(discoverActive(dir)[0].kind).toBe('canary');
  });

  it('falls back to the last completed stage when none is in progress', () => {
    seedStatus('p1', 'i', 1, 'p1__i__rep1', {
      run_id: 'p1__i__rep1',
      stages: {
        plan: { status: 'completed' },
        coordinate: { status: 'completed' },
        implement: { status: 'pending' },
      },
    });
    expect(discoverActive(dir)[0].stage).toBe('coordinate');
  });
});

describe('activeByProfile', () => {
  it('keeps the most recently updated run per (src, profile)', () => {
    const map = activeByProfile([
      { profile: 'a', src: 's1', stage: 'plan', _mtime: 1 },
      { profile: 'a', src: 's1', stage: 'test', _mtime: 5 },
      { profile: 'b', src: 's1', stage: 'review', _mtime: 2 },
      // same name, different src — tracked separately
      { profile: 'a', src: 's2', stage: 'implement', _mtime: 9 },
    ]);
    expect(map.get('s1::a').stage).toBe('test');
    expect(map.get('s1::b').stage).toBe('review');
    expect(map.get('s2::a').stage).toBe('implement');
  });
});
