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
  it('maps skipped', () => {
    expect(statusClass('skipped')).toBe('status-skipped');
  });
  it('returns fallback for unknown', () => {
    expect(statusClass('whatever')).toBe('status-unknown');
  });
  it('statusIcon returns SVG strings for known statuses', () => {
    expect(statusIcon('completed')).toContain('<svg');
    expect(statusIcon('completed')).toContain('</svg>');
    expect(statusIcon('error')).toContain('<svg');
    expect(statusIcon('pending')).toContain('<svg');
    expect(statusIcon('skipped')).toContain('<svg');
  });
  it('statusIcon returns ? for unknown', () => {
    expect(statusIcon('whatever')).toBe('?');
  });
  it('statusIcon adds icon-spin class for in_progress', () => {
    expect(statusIcon('in_progress')).toContain('class="icon-spin"');
  });

  // New lifecycle states
  it('maps running to status-running', () => {
    expect(statusClass('running')).toBe('status-running');
  });
  it('maps paused to status-paused', () => {
    expect(statusClass('paused')).toBe('status-paused');
  });
  it('maps failed to status-failed', () => {
    expect(statusClass('failed')).toBe('status-failed');
  });
  it('maps resuming to status-resuming', () => {
    expect(statusClass('resuming')).toBe('status-resuming');
  });
  it('statusIcon returns SVG for running', () => {
    expect(statusIcon('running')).toContain('<svg');
  });
  it('statusIcon adds icon-spin class for running', () => {
    expect(statusIcon('running')).toContain('class="icon-spin"');
  });
  it('statusIcon returns SVG for paused', () => {
    expect(statusIcon('paused')).toContain('<svg');
  });
  it('statusIcon returns SVG for failed', () => {
    expect(statusIcon('failed')).toContain('<svg');
  });
  it('statusIcon returns SVG for resuming', () => {
    expect(statusIcon('resuming')).toContain('<svg');
  });
  it('statusIcon adds icon-spin class for resuming', () => {
    expect(statusIcon('resuming')).toContain('class="icon-spin"');
  });
});
