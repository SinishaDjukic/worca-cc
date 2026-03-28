import { describe, expect, it } from 'vitest';
import { buildHash, parseHash } from './router.js';

describe('router', () => {
  it('parseHash extracts section and runId', () => {
    expect(parseHash('#/active')).toEqual({ section: 'active', runId: null, projectId: null });
    expect(parseHash('#/active?run=abc')).toEqual({
      section: 'active',
      runId: 'abc',
      projectId: null,
    });
    expect(parseHash('#/history')).toEqual({ section: 'history', runId: null, projectId: null });
    expect(parseHash('')).toEqual({ section: 'active', runId: null, projectId: null });
  });

  it('buildHash creates hash string', () => {
    expect(buildHash('active', null)).toBe('#/active');
    expect(buildHash('active', 'run-1')).toBe('#/active?run=run-1');
  });

  it('parseHash extracts projectId from ?project= param', () => {
    expect(parseHash('#/active?project=my-proj')).toEqual({
      section: 'active',
      runId: null,
      projectId: 'my-proj',
    });
  });

  it('parseHash returns projectId=null when absent', () => {
    expect(parseHash('#/active')).toEqual({
      section: 'active',
      runId: null,
      projectId: null,
    });
  });

  it('buildHash includes project param when provided', () => {
    expect(buildHash('active', 'run-1', 'proj-a')).toBe(
      '#/active?run=run-1&project=proj-a',
    );
    expect(buildHash('active', null, 'proj-a')).toBe(
      '#/active?project=proj-a',
    );
  });

  it('buildHash omits project param when null', () => {
    expect(buildHash('active', 'run-1', null)).toBe('#/active?run=run-1');
    expect(buildHash('active', null, null)).toBe('#/active');
  });

  it('navigate accepts optional projectId', () => {
    // parseHash + buildHash round-trip
    const hash = buildHash('history', 'run-2', 'proj-b');
    const parsed = parseHash(hash);
    expect(parsed.projectId).toBe('proj-b');
    expect(parsed.runId).toBe('run-2');
    expect(parsed.section).toBe('history');
  });
});
