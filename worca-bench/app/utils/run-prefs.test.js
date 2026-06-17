// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { loadRunPrefs, saveRunPrefs } from './run-prefs.js';

describe('run-prefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns {} when nothing is stored for the profile', () => {
    expect(loadRunPrefs('demo')).toEqual({});
  });

  it('round-trips saved controls for a profile', () => {
    const prefs = {
      reps: '3',
      maxInstances: '5',
      maxParallel: '8',
      canary: 'off',
      graphify: 'full',
      codeReviewGraph: 'structural',
    };
    saveRunPrefs('demo', prefs);
    expect(loadRunPrefs('demo')).toEqual(prefs);
  });

  it('keeps profiles isolated from each other', () => {
    saveRunPrefs('a', { reps: '1' });
    saveRunPrefs('b', { reps: '9' });
    expect(loadRunPrefs('a')).toEqual({ reps: '1' });
    expect(loadRunPrefs('b')).toEqual({ reps: '9' });
  });

  it('overwrites prior values for the same profile', () => {
    saveRunPrefs('demo', { reps: '1', canary: 'on' });
    saveRunPrefs('demo', { reps: '2', canary: 'off' });
    expect(loadRunPrefs('demo')).toEqual({ reps: '2', canary: 'off' });
  });

  it('returns {} for a corrupt store instead of throwing', () => {
    localStorage.setItem('worca-bench:run-options', '{not json');
    expect(loadRunPrefs('demo')).toEqual({});
  });

  it('ignores empty/missing profile names', () => {
    expect(loadRunPrefs('')).toEqual({});
    expect(() => saveRunPrefs('', { reps: '1' })).not.toThrow();
  });
});
