import { describe, it, expect } from 'vitest';
import { statusClass, statusIcon } from './status-badge.js';

describe('status-badge', () => {
  it('maps pending to correct class', () => {
    expect(statusClass('pending')).toBe('status-pending');
  });
  it('maps in_progress', () => {
    expect(statusClass('in_progress')).toBe('status-in-progress');
  });
  it('maps completed', () => {
    expect(statusClass('completed')).toBe('status-completed');
  });
  it('maps error', () => {
    expect(statusClass('error')).toBe('status-error');
  });
  it('returns fallback for unknown', () => {
    expect(statusClass('whatever')).toBe('status-unknown');
  });
  it('statusIcon returns correct symbols', () => {
    expect(statusIcon('completed')).toBe('\u2713');
    expect(statusIcon('error')).toBe('\u2717');
    expect(statusIcon('pending')).toBe('\u25CB');
  });
});
