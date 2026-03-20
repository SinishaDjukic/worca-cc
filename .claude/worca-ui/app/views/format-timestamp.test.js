import { describe, it, expect } from 'vitest';

// Test formatTimestamp from both view modules
import { formatTimestamp as liveOutputFormat } from './live-output.js';
import { formatTimestamp as logViewerFormat } from './log-viewer.js';

describe('formatTimestamp (live-output)', () => {
  it('converts ISO string to HH:MM:SS local time', () => {
    const iso = '2026-03-20T14:30:45Z';
    const expected = new Date(iso).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    expect(liveOutputFormat(iso)).toBe(expected);
  });

  it('handles midnight UTC', () => {
    const iso = '2026-01-01T00:00:00Z';
    const expected = new Date(iso).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    expect(liveOutputFormat(iso)).toBe(expected);
  });

  it('returns empty string for falsy input', () => {
    expect(liveOutputFormat(null)).toBe('');
    expect(liveOutputFormat(undefined)).toBe('');
    expect(liveOutputFormat('')).toBe('');
  });
});

describe('formatTimestamp (log-viewer)', () => {
  it('converts ISO string to HH:MM:SS local time', () => {
    const iso = '2026-03-20T14:30:45Z';
    const expected = new Date(iso).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    expect(logViewerFormat(iso)).toBe(expected);
  });

  it('handles midnight UTC', () => {
    const iso = '2026-01-01T00:00:00Z';
    const expected = new Date(iso).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    expect(logViewerFormat(iso)).toBe(expected);
  });

  it('returns empty string for falsy input', () => {
    expect(logViewerFormat(null)).toBe('');
    expect(logViewerFormat(undefined)).toBe('');
    expect(logViewerFormat('')).toBe('');
  });
});
