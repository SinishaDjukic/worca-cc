import { describe, expect, it } from 'vitest';
import { buildHash, parseHash } from './router.js';

describe('router', () => {
  it('parseHash extracts section from simple path', () => {
    expect(parseHash('#/active')).toEqual({
      section: 'active',
      runId: null,
      projectId: null,
    });
    expect(parseHash('#/history')).toEqual({
      section: 'history',
      runId: null,
      projectId: null,
    });
    expect(parseHash('')).toEqual({
      section: 'active',
      runId: null,
      projectId: null,
    });
  });

  it('parseHash extracts runId from path segment', () => {
    expect(parseHash('#/active/run-123')).toEqual({
      section: 'active',
      runId: 'run-123',
      projectId: null,
    });
  });

  it('parseHash extracts projectId and section from path segments', () => {
    expect(parseHash('#/project/my-proj/active')).toEqual({
      section: 'active',
      runId: null,
      projectId: 'my-proj',
    });
  });

  it('parseHash extracts projectId, section, and runId', () => {
    expect(parseHash('#/project/proj-a/active/run-1')).toEqual({
      section: 'active',
      runId: 'run-1',
      projectId: 'proj-a',
    });
  });

  it('buildHash creates simple hash without project', () => {
    expect(buildHash('active', null)).toBe('#/active');
    expect(buildHash('active', 'run-1')).toBe('#/active/run-1');
  });

  it('buildHash includes project as path segment', () => {
    expect(buildHash('active', 'run-1', 'proj-a')).toBe(
      '#/project/proj-a/active/run-1',
    );
    expect(buildHash('active', null, 'proj-a')).toBe('#/project/proj-a/active');
  });

  it('buildHash omits project when null', () => {
    expect(buildHash('active', 'run-1', null)).toBe('#/active/run-1');
    expect(buildHash('active', null, null)).toBe('#/active');
  });

  it('navigate accepts optional projectId (round-trip)', () => {
    const hash = buildHash('history', 'run-2', 'proj-b');
    const parsed = parseHash(hash);
    expect(parsed.projectId).toBe('proj-b');
    expect(parsed.runId).toBe('run-2');
    expect(parsed.section).toBe('history');
  });

  // Backward compatibility with old query-param format
  it('parseHash supports legacy ?run= query param', () => {
    expect(parseHash('#/active?run=abc')).toEqual({
      section: 'active',
      runId: 'abc',
      projectId: null,
    });
  });

  it('parseHash supports legacy ?project= query param', () => {
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
});
