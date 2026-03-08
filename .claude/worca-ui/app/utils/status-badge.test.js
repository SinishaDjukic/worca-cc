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
  it('statusIcon returns SVG strings for known statuses', () => {
    expect(statusIcon('completed')).toContain('<svg');
    expect(statusIcon('completed')).toContain('</svg>');
    expect(statusIcon('error')).toContain('<svg');
    expect(statusIcon('pending')).toContain('<svg');
  });
  it('statusIcon returns ? for unknown', () => {
    expect(statusIcon('whatever')).toBe('?');
  });
  it('statusIcon adds icon-spin class for in_progress', () => {
    expect(statusIcon('in_progress')).toContain('class="icon-spin"');
  });
});
