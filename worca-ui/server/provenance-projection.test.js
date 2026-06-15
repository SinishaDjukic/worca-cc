/**
 * Verify that `provenance` from status.json is projected onto the UI-exposed
 * run object. The _shapeRunFromFile function spreads the full status dict, so
 * provenance flows through automatically — this test pins that invariant.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearDiscoverRunsCache, discoverRuns, findRun } from './watcher.js';

describe('provenance projection onto run object', () => {
  let dir;
  beforeEach(() => {
    dir = join(tmpdir(), `worca-provenance-${Date.now()}`);
    mkdirSync(join(dir, 'runs'), { recursive: true });
    mkdirSync(join(dir, 'results'), { recursive: true });
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    clearDiscoverRunsCache();
  });

  it('provenance from status.json is present on the run object returned by findRun', () => {
    const runId = 'run-prov-1';
    const runDir = join(dir, 'runs', runId);
    mkdirSync(runDir, { recursive: true });
    const provenance = {
      worca_version: '0.57.0',
      runtime_source: {
        source: 'git',
        repo: 'worca-cc',
        commit: 'abc123',
        branch: 'main',
        dirty: false,
      },
    };
    writeFileSync(
      join(runDir, 'status.json'),
      JSON.stringify({
        run_id: runId,
        started_at: '2026-06-01T10:00:00Z',
        pipeline_status: 'running',
        work_request: { title: 'test' },
        stages: {},
        provenance,
      }),
    );
    const run = findRun(dir, runId);
    expect(run).not.toBeNull();
    expect(run.provenance).toEqual(provenance);
  });

  it('provenance from status.json is present via discoverRuns', () => {
    const runId = 'run-prov-2';
    const runDir = join(dir, 'runs', runId);
    mkdirSync(runDir, { recursive: true });
    const provenance = { worca_version: '0.58.0', runtime_source: null };
    writeFileSync(
      join(runDir, 'status.json'),
      JSON.stringify({
        run_id: runId,
        started_at: '2026-06-01T11:00:00Z',
        pipeline_status: 'completed',
        work_request: { title: 'done' },
        stages: {},
        provenance,
      }),
    );
    const runs = discoverRuns(dir);
    const run = runs.find((r) => r.id === runId);
    expect(run).toBeDefined();
    expect(run.provenance).toEqual(provenance);
  });

  it('run without provenance in status.json has undefined provenance on the run object', () => {
    const runId = 'run-prov-3';
    const runDir = join(dir, 'runs', runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, 'status.json'),
      JSON.stringify({
        run_id: runId,
        started_at: '2026-06-01T12:00:00Z',
        pipeline_status: 'completed',
        work_request: { title: 'old run' },
        stages: {},
      }),
    );
    const run = findRun(dir, runId);
    expect(run).not.toBeNull();
    expect(run.provenance).toBeUndefined();
  });
});
