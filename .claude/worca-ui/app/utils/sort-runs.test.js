import { describe, it, expect } from 'vitest';
import { sortByStartDesc } from './sort-runs.js';

describe('sortByStartDesc', () => {
  it('sorts runs by started_at descending (newest first)', () => {
    const runs = [
      { id: 'a', started_at: '2026-03-01T10:00:00Z' },
      { id: 'b', started_at: '2026-03-03T10:00:00Z' },
      { id: 'c', started_at: '2026-03-02T10:00:00Z' },
    ];
    const sorted = sortByStartDesc(runs);
    expect(sorted.map(r => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('places runs with missing started_at at the end', () => {
    const runs = [
      { id: 'a', started_at: '2026-03-01T10:00:00Z' },
      { id: 'b', started_at: null },
      { id: 'c', started_at: '2026-03-02T10:00:00Z' },
      { id: 'd' },
    ];
    const sorted = sortByStartDesc(runs);
    expect(sorted[0].id).toBe('c');
    expect(sorted[1].id).toBe('a');
    // b and d (no started_at) come last
    expect(['b', 'd']).toContain(sorted[2].id);
    expect(['b', 'd']).toContain(sorted[3].id);
  });

  it('does not mutate the original array', () => {
    const runs = [
      { id: 'a', started_at: '2026-03-01T10:00:00Z' },
      { id: 'b', started_at: '2026-03-03T10:00:00Z' },
    ];
    const original = [...runs];
    sortByStartDesc(runs);
    expect(runs[0].id).toBe(original[0].id);
    expect(runs[1].id).toBe(original[1].id);
  });

  it('returns an empty array when given an empty array', () => {
    expect(sortByStartDesc([])).toEqual([]);
  });
});
