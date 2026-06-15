/**
 * Tests for the log-line handler wiring contract in main.js.
 *
 * The log-line WebSocket handler should ONLY write to Live Output terminal,
 * NOT to Log History terminal. Log History is populated exclusively by
 * log-bulk (historical backfill on subscribe/resubscribe).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Extract the body of the ws.on('eventName', ...) handler from main.js source.
 * Returns the handler body string, or null if not found.
 */
function extractHandler(src, eventName) {
  const marker = `ws.on('${eventName}'`;
  const start = src.indexOf(marker);
  if (start === -1) return null;
  let i = src.indexOf('{', start);
  if (i === -1) return null;
  const startBrace = i;
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}') depth--;
    if (depth === 0) break;
  }
  return src.slice(startBrace, i + 1);
}

describe('log-line handler: streaming isolation', () => {
  const source = readFileSync(join(__dirname, 'main.js'), 'utf8');
  const handler = extractHandler(source, 'log-line');

  it('log-line handler exists', () => {
    expect(handler).not.toBeNull();
  });

  it('does NOT call writeLogLine (Log History)', () => {
    // writeLogLine writes to the Log History xterm terminal
    // log-line events should only stream to Live Output
    expect(handler).not.toContain('writeLogLine(');
  });

  it('does NOT call writeIterationSeparator (Log History)', () => {
    // writeIterationSeparator writes to the Log History xterm terminal
    expect(handler).not.toContain('writeIterationSeparator(');
  });

  it('still calls writeLiveLogLine (Live Output)', () => {
    expect(handler).toContain('writeLiveLogLine(');
  });

  it('still calls writeLiveIterationSeparator (Live Output)', () => {
    expect(handler).toContain('writeLiveIterationSeparator(');
  });

  it('still calls store.appendLog for state tracking', () => {
    expect(handler).toContain('store.appendLog(');
  });
});

describe('log-bulk handler: Log History backfill', () => {
  const source = readFileSync(join(__dirname, 'main.js'), 'utf8');
  const handler = extractHandler(source, 'log-bulk');

  it('log-bulk handler exists', () => {
    expect(handler).not.toBeNull();
  });

  it('still calls writeLogLine for Log History backfill', () => {
    // log-bulk is the correct path for populating Log History
    expect(handler).toContain('writeLogLine(');
  });

  it('includes iteration from payload in bulk entries', () => {
    // Bulk entries must carry payload.iteration so log history can group by iteration
    expect(handler).toContain('iteration: payload.iteration');
  });

  it('uses the persisted per-line write-time, not receive-time', () => {
    // Each bulk entry's timestamp comes from the parallel payload.timestamps
    // array (the real write-time parsed from the log file), NOT a synthesized
    // receive-time. Legacy lines have null there and render as "--:--:--".
    expect(handler).toContain('payload.timestamps');
    expect(handler).toMatch(/timestamp:\s*timestamps\[i\]\s*\?\?\s*null/);
    // The old receive-time stamping must be gone.
    expect(handler).not.toMatch(/timestamp:\s*new Date\(\)\.toISOString\(\)/);
  });

  it('carries the origin stream onto each bulk entry (W-074)', () => {
    // The parallel payload.streams[] array tags each line out/err; entries
    // must default to "out" for legacy/untagged backfill.
    expect(handler).toContain('payload.streams');
    expect(handler).toMatch(/stream:\s*streams\[i\]\s*\|\|\s*'out'/);
  });

  it('gates the Log History write on the stream filter (W-074)', () => {
    // Backfill written to the history terminal must honor the active stream
    // filter so a fresh subscribe matches a client-side replay.
    expect(handler).toContain('logStreamMatches(entry)');
  });
});
