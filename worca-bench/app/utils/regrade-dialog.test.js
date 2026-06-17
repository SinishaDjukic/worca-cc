// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadRegradeMode,
  REGRADE_MODES,
  saveRegradeMode,
} from './regrade-dialog.js';

describe('regrade mode persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to sb-cli when nothing is stored', () => {
    expect(loadRegradeMode()).toBe('sb-cli');
  });

  it('round-trips a valid backend choice', () => {
    saveRegradeMode('modal');
    expect(loadRegradeMode()).toBe('modal');
  });

  it('rejects an unknown backend (save no-op, load falls back)', () => {
    saveRegradeMode('bogus');
    expect(loadRegradeMode()).toBe('sb-cli');
    localStorage.setItem('worca-bench:regrade-mode', 'also-bogus');
    expect(loadRegradeMode()).toBe('sb-cli');
  });

  it('offers exactly the three real grade backends', () => {
    expect(REGRADE_MODES.map((m) => m.value)).toEqual([
      'local-docker',
      'sb-cli',
      'modal',
    ]);
  });
});
