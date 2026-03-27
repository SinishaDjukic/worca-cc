import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listIterationFiles,
  listLogFiles,
  readLastLines,
  resolveIterationLogPath,
  resolveLogPath,
  STAGE_ORDER,
} from './log-tailer.js';

describe('log-tailer', () => {
  let dir;
  beforeEach(() => {
    dir = join(tmpdir(), `worca-log-${Date.now()}`);
    mkdirSync(join(dir, 'logs'), { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('readLastLines returns last N lines', () => {
    const path = join(dir, 'logs', 'orchestrator.log');
    writeFileSync(path, 'line1\nline2\nline3\nline4\nline5\n');
    const lines = readLastLines(path, 3);
    expect(lines).toEqual(['line3', 'line4', 'line5']);
  });

  it('readLastLines returns all lines if fewer than N', () => {
    const path = join(dir, 'logs', 'test.log');
    writeFileSync(path, 'only\n');
    const lines = readLastLines(path, 100);
    expect(lines).toEqual(['only']);
  });

  it('readLastLines returns empty array for missing file', () => {
    const lines = readLastLines(join(dir, 'nope.log'), 10);
    expect(lines).toEqual([]);
  });

  it('resolveLogPath returns stage directory for stage without iteration', () => {
    const path = resolveLogPath(dir, 'plan');
    expect(path).toBe(join(dir, 'logs', 'plan'));
  });

  it('resolveLogPath returns orchestrator log for null stage', () => {
    const path = resolveLogPath(dir, null);
    expect(path).toBe(join(dir, 'logs', 'orchestrator.log'));
  });

  it('resolveLogPath with iteration returns nested path', () => {
    const path = resolveLogPath(dir, 'implement', 2);
    expect(path).toBe(join(dir, 'logs', 'implement', 'iter-2.log'));
  });

  it('resolveIterationLogPath returns correct path', () => {
    const path = resolveIterationLogPath(dir, 'test', 3);
    expect(path).toBe(join(dir, 'logs', 'test', 'iter-3.log'));
  });

  it('listIterationFiles returns sorted iterations', () => {
    const stageDir = join(dir, 'logs', 'implement');
    mkdirSync(stageDir, { recursive: true });
    writeFileSync(join(stageDir, 'iter-1.log'), 'data1\n');
    writeFileSync(join(stageDir, 'iter-3.log'), 'data3\n');
    writeFileSync(join(stageDir, 'iter-2.log'), 'data2\n');
    const iters = listIterationFiles(dir, 'implement');
    expect(iters.map((i) => i.iteration)).toEqual([1, 2, 3]);
  });

  it('listIterationFiles returns empty for missing stage dir', () => {
    const iters = listIterationFiles(dir, 'nonexistent');
    expect(iters).toEqual([]);
  });

  it('listLogFiles finds nested iteration files', () => {
    writeFileSync(join(dir, 'logs', 'orchestrator.log'), 'orch\n');
    const stageDir = join(dir, 'logs', 'implement');
    mkdirSync(stageDir, { recursive: true });
    writeFileSync(join(stageDir, 'iter-1.log'), 'impl1\n');
    writeFileSync(join(stageDir, 'iter-2.log'), 'impl2\n');
    const files = listLogFiles(dir);
    expect(files.length).toBe(3);
    const orch = files.find((f) => f.stage === 'orchestrator');
    expect(orch).toBeDefined();
    const impls = files.filter((f) => f.stage === 'implement');
    expect(impls.length).toBe(2);
    expect(impls[0].iteration).toBe(1);
    expect(impls[1].iteration).toBe(2);
  });

  it('STAGE_ORDER contains plan_review between plan and coordinate', () => {
    expect(STAGE_ORDER).toContain('plan_review');
    const planIdx = STAGE_ORDER.indexOf('plan');
    const reviewIdx = STAGE_ORDER.indexOf('plan_review');
    const coordinateIdx = STAGE_ORDER.indexOf('coordinate');
    expect(reviewIdx).toBeGreaterThan(planIdx);
    expect(reviewIdx).toBeLessThan(coordinateIdx);
  });

  it('plan_review stage sorts before coordinate in listLogFiles', () => {
    const prDir = join(dir, 'logs', 'plan_review');
    const coordDir = join(dir, 'logs', 'coordinate');
    mkdirSync(prDir, { recursive: true });
    mkdirSync(coordDir, { recursive: true });
    writeFileSync(join(prDir, 'iter-1.log'), 'pr\n');
    writeFileSync(join(coordDir, 'iter-1.log'), 'coord\n');
    const files = listLogFiles(dir);
    const prIdx = files.findIndex((f) => f.stage === 'plan_review');
    const coordIdx = files.findIndex((f) => f.stage === 'coordinate');
    expect(prIdx).toBeGreaterThanOrEqual(0);
    expect(coordIdx).toBeGreaterThanOrEqual(0);
    expect(prIdx).toBeLessThan(coordIdx);
  });
});
