import { describe, it, expect } from 'vitest';
import { resolveIterationTab } from './stage-tab-memory.js';

describe('resolveIterationTab', () => {
  it('returns latest iteration when no user choice exists', () => {
    const map = new Map();
    const iters = [{ number: 1 }, { number: 2 }, { number: 3 }];
    expect(resolveIterationTab(map, 'plan', iters)).toBe(3);
  });

  it('returns user choice when one was recorded', () => {
    const map = new Map([['plan', 1]]);
    const iters = [{ number: 1 }, { number: 2 }, { number: 3 }];
    expect(resolveIterationTab(map, 'plan', iters)).toBe(1);
  });

  it('re-expand restores user choice (same map, same stage)', () => {
    const map = new Map();
    const iters = [{ number: 1 }, { number: 2 }];
    // First expand: defaults to latest
    expect(resolveIterationTab(map, 'implement', iters)).toBe(2);
    // User switches to iter 1
    map.set('implement', 1);
    // Re-expand: user choice is restored
    expect(resolveIterationTab(map, 'implement', iters)).toBe(1);
  });

  it('clearing the map resets to latest (simulates run change)', () => {
    const map = new Map([['plan', 1]]);
    map.clear();
    const iters = [{ number: 1 }, { number: 2 }];
    expect(resolveIterationTab(map, 'plan', iters)).toBe(2);
  });

  it('returns null for empty iterations array', () => {
    const map = new Map();
    expect(resolveIterationTab(map, 'plan', [])).toBeNull();
  });

  it('returns null for undefined iterations', () => {
    const map = new Map();
    expect(resolveIterationTab(map, 'plan', undefined)).toBeNull();
  });

  it('handles null tabMap gracefully (defaults to latest)', () => {
    const iters = [{ number: 1 }, { number: 2 }];
    expect(resolveIterationTab(null, 'plan', iters)).toBe(2);
  });

  it('different stages have independent memory', () => {
    const map = new Map([['plan', 1]]);
    const planIters = [{ number: 1 }, { number: 2 }, { number: 3 }];
    const testIters = [{ number: 1 }, { number: 2 }];
    expect(resolveIterationTab(map, 'plan', planIters)).toBe(1);
    expect(resolveIterationTab(map, 'test', testIters)).toBe(2);
  });
});
