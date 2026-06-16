import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activeByProfile, discoverActive } from './active-runs.js';

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
    expect(run.kind).toBe('rep');
    expect(run.pipeline_status).toBe('running');
    expect(run.stage).toBe('coordinate'); // the in_progress stage
    expect(run.stages.map((s) => `${s.name}:${s.status}`)).toEqual([
      'preflight:completed',
      'plan:completed',
      'coordinate:in_progress',
      'implement:pending',
    ]);
    expect(run.stages[1].model).toBe('opus'); // model_alias preferred
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
  it('keeps the most recently updated run per profile', () => {
    const map = activeByProfile([
      { profile: 'a', stage: 'plan', _mtime: 1 },
      { profile: 'a', stage: 'test', _mtime: 5 },
      { profile: 'b', stage: 'review', _mtime: 2 },
    ]);
    expect(map.get('a').stage).toBe('test');
    expect(map.get('b').stage).toBe('review');
  });
});
