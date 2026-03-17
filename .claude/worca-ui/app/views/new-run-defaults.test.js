import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDefaults, loadSettings } from './settings.js';

describe('getDefaults — cross-view wiring', () => {
  let origFetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('returns fallback { msize: 1, mloops: 1 } before settings are loaded', () => {
    // getDefaults relies on module-level settingsData which starts null
    // On a fresh import (or before loadSettings), it should return the fallback
    const defaults = getDefaults();
    expect(defaults).toEqual({ msize: 1, mloops: 1 });
  });

  it('returns stored defaults after loadSettings populates them', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        worca: {
          defaults: { msize: 5, mloops: 3 },
        },
        permissions: {},
      }),
    });

    await loadSettings();

    const defaults = getDefaults();
    expect(defaults.msize).toBe(5);
    expect(defaults.mloops).toBe(3);
  });

  it('normalizes missing defaults to { msize: 1, mloops: 1 } during loadSettings', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        worca: {},
        permissions: {},
      }),
    });

    await loadSettings();

    const defaults = getDefaults();
    expect(defaults).toEqual({ msize: 1, mloops: 1 });
  });

  it('returns fallback after loadSettings fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));

    await loadSettings();

    const defaults = getDefaults();
    expect(defaults).toEqual({ msize: 1, mloops: 1 });
  });
});

describe('new-run.js imports getDefaults', () => {
  it('getDefaults is exported from settings.js and callable', () => {
    expect(typeof getDefaults).toBe('function');
    const result = getDefaults();
    expect(result).toHaveProperty('msize');
    expect(result).toHaveProperty('mloops');
  });
});
