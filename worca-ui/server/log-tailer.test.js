import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listIterationFiles,
  listLogFiles,
  parseLogLine,
  readLastLines,
  readNewLines,
  resolveIterationLogPath,
  resolveLogPath,
  STAGE_ORDER,
  splitTimestamps,
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

describe('parseLogLine', () => {
  it('splits a new-format line into timestamp and message', () => {
    const { ts, text } = parseLogLine(
      '2026-06-14T12:00:00.000+00:00\t[tool:Read] foo.py',
    );
    expect(ts).toBe('2026-06-14T12:00:00.000+00:00');
    expect(text).toBe('[tool:Read] foo.py');
  });

  it('accepts a Z-suffixed (UTC) timestamp', () => {
    const { ts, text } = parseLogLine('2026-06-14T12:00:00Z\thello');
    expect(ts).toBe('2026-06-14T12:00:00Z');
    expect(text).toBe('hello');
  });

  it('only splits on the first tab — tabs inside the message survive', () => {
    const { ts, text } = parseLogLine('2026-06-14T12:00:00.000+00:00\ta\tb\tc');
    expect(ts).toBe('2026-06-14T12:00:00.000+00:00');
    expect(text).toBe('a\tb\tc');
  });

  it('treats a legacy line (no prefix) as ts=null, text=raw', () => {
    const { ts, text } = parseLogLine('[init] model=opus');
    expect(ts).toBeNull();
    expect(text).toBe('[init] model=opus');
  });

  it('does not treat an ISO-looking-but-untabbed line as timestamped', () => {
    const raw = '2026-06-14T12:00:00.000+00:00 started';
    const { ts, text } = parseLogLine(raw);
    expect(ts).toBeNull();
    expect(text).toBe(raw);
  });

  it('rejects a malformed timestamp prefix', () => {
    const raw = '2026-13-99T99:99:99\tnope';
    const { ts } = parseLogLine(raw);
    expect(ts).toBeNull();
  });
});

describe('splitTimestamps', () => {
  it('returns parallel lines + timestamps arrays', () => {
    const { lines, timestamps } = splitTimestamps([
      '2026-06-14T12:00:00.000+00:00\tone',
      'legacy two',
      '2026-06-14T12:00:01.000+00:00\tthree',
    ]);
    expect(lines).toEqual(['one', 'legacy two', 'three']);
    expect(timestamps).toEqual([
      '2026-06-14T12:00:00.000+00:00',
      null,
      '2026-06-14T12:00:01.000+00:00',
    ]);
  });

  it('handles an empty input', () => {
    expect(splitTimestamps([])).toEqual({ lines: [], timestamps: [] });
  });
});

describe('readNewLines', () => {
  let dir;
  beforeEach(() => {
    dir = join(tmpdir(), `worca-tail-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads only the bytes after the offset', () => {
    const path = join(dir, 'a.log');
    writeFileSync(path, 'first\nsecond\n');
    const off = Buffer.byteLength('first\n');
    const { lines, newOffset } = readNewLines(path, off);
    expect(lines).toEqual(['second']);
    expect(newOffset).toBe(Buffer.byteLength('first\nsecond\n'));
  });

  it('does not consume a trailing partial (un-terminated) line', () => {
    const path = join(dir, 'b.log');
    writeFileSync(path, 'done\npartial-no-newline');
    const { lines, newOffset } = readNewLines(path, 0);
    // Only the complete line is emitted; the partial stays buffered.
    expect(lines).toEqual(['done']);
    expect(newOffset).toBe(Buffer.byteLength('done\n'));
    // Once the partial line is completed, the next read picks it up whole.
    writeFileSync(path, 'done\npartial-now-complete\n');
    const next = readNewLines(path, newOffset);
    expect(next.lines).toEqual(['partial-now-complete']);
  });

  it('returns nothing when no complete line is available yet', () => {
    const path = join(dir, 'c.log');
    writeFileSync(path, 'no-newline-yet');
    const { lines, newOffset } = readNewLines(path, 0);
    expect(lines).toEqual([]);
    expect(newOffset).toBe(0);
  });

  it('advances the offset correctly across multibyte content', () => {
    const path = join(dir, 'd.log');
    const content = '2026-06-14T12:00:00.000+00:00\t⏎ café\n';
    writeFileSync(path, content);
    const { lines, newOffset } = readNewLines(path, 0);
    expect(lines).toEqual(['2026-06-14T12:00:00.000+00:00\t⏎ café']);
    expect(newOffset).toBe(Buffer.byteLength(content, 'utf8'));
  });
});
