import { describe, it, expect } from 'vitest';
import { formatDuration, elapsed } from './duration.js';

describe('formatDuration', () => {
  it('formats seconds', () => {
    expect(formatDuration(45000)).toBe('45s');
  });
  it('formats minutes and seconds', () => {
    expect(formatDuration(125000)).toBe('2m 5s');
  });
  it('formats hours', () => {
    expect(formatDuration(3661000)).toBe('1h 1m 1s');
  });
  it('handles zero', () => {
    expect(formatDuration(0)).toBe('0s');
  });
});

describe('elapsed', () => {
  it('computes ms between two ISO strings', () => {
    const start = '2026-03-08T10:00:00Z';
    const end = '2026-03-08T10:01:30Z';
    expect(elapsed(start, end)).toBe(90000);
  });
  it('uses now if end is null', () => {
    const start = new Date(Date.now() - 5000).toISOString();
    const ms = elapsed(start, null);
    expect(ms).toBeGreaterThanOrEqual(4900);
    expect(ms).toBeLessThan(6000);
  });
});
