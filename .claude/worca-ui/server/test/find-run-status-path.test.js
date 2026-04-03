import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findRunStatusPath } from '../project-routes.js';

describe('findRunStatusPath', () => {
  let worcaDir;

  beforeEach(() => {
    worcaDir = mkdtempSync(join(tmpdir(), 'find-run-status-'));
  });

  afterEach(() => {
    rmSync(worcaDir, { recursive: true, force: true });
  });

  it('returns path in runs/{id}/status.json when it exists', () => {
    const runId = 'test-run-1';
    const runDir = join(worcaDir, 'runs', runId);
    mkdirSync(runDir, { recursive: true });
    const statusPath = join(runDir, 'status.json');
    writeFileSync(statusPath, '{}');

    expect(findRunStatusPath(worcaDir, runId)).toBe(statusPath);
  });

  it('falls back to results/{id}/status.json', () => {
    const runId = 'test-run-2';
    const resultDir = join(worcaDir, 'results', runId);
    mkdirSync(resultDir, { recursive: true });
    const statusPath = join(resultDir, 'status.json');
    writeFileSync(statusPath, '{}');

    expect(findRunStatusPath(worcaDir, runId)).toBe(statusPath);
  });

  it('falls back to legacy results/{id}.json', () => {
    const runId = 'test-run-3';
    mkdirSync(join(worcaDir, 'results'), { recursive: true });
    const statusPath = join(worcaDir, 'results', `${runId}.json`);
    writeFileSync(statusPath, '{}');

    expect(findRunStatusPath(worcaDir, runId)).toBe(statusPath);
  });

  it('returns null when no status file exists', () => {
    expect(findRunStatusPath(worcaDir, 'nonexistent')).toBeNull();
  });

  it('prefers runs/ over results/ when both exist', () => {
    const runId = 'test-run-4';
    const runsDir = join(worcaDir, 'runs', runId);
    mkdirSync(runsDir, { recursive: true });
    const runsPath = join(runsDir, 'status.json');
    writeFileSync(runsPath, '{}');

    const resultsDir = join(worcaDir, 'results', runId);
    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(join(resultsDir, 'status.json'), '{}');

    expect(findRunStatusPath(worcaDir, runId)).toBe(runsPath);
  });

  it('prefers results/{id}/status.json over legacy results/{id}.json', () => {
    const runId = 'test-run-5';
    const resultsSubDir = join(worcaDir, 'results', runId);
    mkdirSync(resultsSubDir, { recursive: true });
    const dirPath = join(resultsSubDir, 'status.json');
    writeFileSync(dirPath, '{}');

    writeFileSync(join(worcaDir, 'results', `${runId}.json`), '{}');

    expect(findRunStatusPath(worcaDir, runId)).toBe(dirPath);
  });
});
