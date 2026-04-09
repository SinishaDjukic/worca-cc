import { describe, expect, it } from 'vitest';
import { beadsStatusClass, statusVariant } from './beads-panel.js';

describe('statusVariant()', () => {
  it('returns success for open', () => {
    expect(statusVariant('open')).toBe('success');
  });

  it('returns primary for in_progress (blue — actively being worked on)', () => {
    expect(statusVariant('in_progress')).toBe('primary');
  });

  it('returns neutral for closed', () => {
    expect(statusVariant('closed')).toBe('neutral');
  });

  it('returns warning for blocked (amber — waiting, needs attention)', () => {
    expect(statusVariant('blocked')).toBe('warning');
  });

  it('returns neutral for unknown status', () => {
    expect(statusVariant('unknown')).toBe('neutral');
  });
});

describe('beadsStatusClass()', () => {
  it('returns closed for closed issues regardless of blocked_by', () => {
    expect(beadsStatusClass({ status: 'closed', blocked_by: ['dep1'] })).toBe(
      'closed',
    );
  });

  it('returns blocked when blocked_by has entries', () => {
    expect(beadsStatusClass({ status: 'open', blocked_by: ['dep1'] })).toBe(
      'blocked',
    );
  });

  it('returns in_progress for in_progress with no blockers', () => {
    expect(beadsStatusClass({ status: 'in_progress', blocked_by: [] })).toBe(
      'in_progress',
    );
  });

  it('returns open for open with no blockers', () => {
    expect(beadsStatusClass({ status: 'open', blocked_by: [] })).toBe('open');
  });

  it('returns open when blocked_by is absent', () => {
    expect(beadsStatusClass({ status: 'open' })).toBe('open');
  });
});
