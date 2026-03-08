import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readLastLines, resolveLogPath } from './log-tailer.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

  it('resolveLogPath returns stage log path', () => {
    const path = resolveLogPath(dir, 'plan');
    expect(path).toBe(join(dir, 'logs', 'plan.log'));
  });

  it('resolveLogPath returns orchestrator log for null stage', () => {
    const path = resolveLogPath(dir, null);
    expect(path).toBe(join(dir, 'logs', 'orchestrator.log'));
  });
});
