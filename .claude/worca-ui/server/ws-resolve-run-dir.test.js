import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveActiveRunDir } from './ws.js';

describe('resolveActiveRunDir', () => {
  let worcaDir;

  beforeEach(() => {
    worcaDir = join(tmpdir(), `worca-ws-${Date.now()}`);
    mkdirSync(worcaDir, { recursive: true });
  });

  afterEach(() => rmSync(worcaDir, { recursive: true, force: true }));

  it('returns run dir when active_run exists with non-empty runId even without status.json', () => {
    const runId = '20260317-084204';
    const runDir = join(worcaDir, 'runs', runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(worcaDir, 'active_run'), runId);
    // Deliberately NO status.json in runDir

    const result = resolveActiveRunDir(worcaDir);
    expect(result).toBe(runDir);
  });

  it('falls back to worcaDir when active_run does not exist', () => {
    const result = resolveActiveRunDir(worcaDir);
    expect(result).toBe(worcaDir);
  });

  it('falls back to worcaDir when active_run is empty', () => {
    writeFileSync(join(worcaDir, 'active_run'), '');
    const result = resolveActiveRunDir(worcaDir);
    expect(result).toBe(worcaDir);
  });

  it('returns run dir when active_run has trailing whitespace/newline', () => {
    const runId = '20260317-084204';
    const runDir = join(worcaDir, 'runs', runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(worcaDir, 'active_run'), `${runId}\n`);

    const result = resolveActiveRunDir(worcaDir);
    expect(result).toBe(runDir);
  });
});
