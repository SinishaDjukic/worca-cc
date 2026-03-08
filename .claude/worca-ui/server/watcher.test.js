import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { discoverRuns, createRunId } from './watcher.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('watcher', () => {
  let dir;
  beforeEach(() => {
    dir = join(tmpdir(), `worca-watch-${Date.now()}`);
    mkdirSync(join(dir, 'results'), { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('createRunId generates deterministic ID from status', () => {
    const status = { started_at: '2026-03-08T10:00:00Z', work_request: { title: 'test' } };
    const id = createRunId(status);
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(createRunId(status)).toBe(id);
  });

  it('discoverRuns finds active run from status.json', () => {
    const status = {
      started_at: '2026-03-08T10:00:00Z',
      stage: 'implement',
      work_request: { title: 'test' },
      stages: { plan: { status: 'completed' }, implement: { status: 'in_progress' } }
    };
    writeFileSync(join(dir, 'status.json'), JSON.stringify(status));
    const runs = discoverRuns(dir);
    expect(runs.length).toBe(1);
    expect(runs[0].stage).toBe('implement');
    expect(runs[0].active).toBe(true);
  });

  it('discoverRuns finds completed runs from results/', () => {
    const result = {
      started_at: '2026-03-07T09:00:00Z',
      stage: 'pr',
      work_request: { title: 'old run' },
      stages: { plan: { status: 'completed' }, pr: { status: 'completed' } }
    };
    writeFileSync(join(dir, 'results', 'abc123.json'), JSON.stringify(result));
    const runs = discoverRuns(dir);
    expect(runs.length).toBe(1);
    expect(runs[0].active).toBe(false);
  });
});
