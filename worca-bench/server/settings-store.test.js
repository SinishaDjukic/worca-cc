import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addResultDir,
  loadSettings,
  removeResultDir,
  resolveCacheDir,
  resolveResultDirs,
  saveSettings,
  setCacheDir,
} from './settings-store.js';

let home;
let dirA;
let dirB;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'wb-home-'));
  dirA = mkdtempSync(join(tmpdir(), 'wb-a-'));
  dirB = mkdtempSync(join(tmpdir(), 'wb-b-'));
});

describe('settings-store', () => {
  it('defaults to an empty result_dirs list', () => {
    expect(loadSettings(home).result_dirs).toEqual([]);
  });

  it('adds an existing dir, stores absolute, and dedupes', () => {
    addResultDir(dirA, home);
    addResultDir(dirA, home);
    expect(loadSettings(home).result_dirs).toEqual([resolve(dirA)]);
  });

  it('rejects a non-existent dir', () => {
    expect(() => addResultDir('/no/such/dir/here', home)).toThrow(
      /not a directory/,
    );
  });

  it('removes a dir', () => {
    addResultDir(dirA, home);
    addResultDir(dirB, home);
    removeResultDir(dirA, home);
    expect(loadSettings(home).result_dirs).toEqual([resolve(dirB)]);
  });

  it('resolves the union of primary + configured (existing, deduped)', () => {
    addResultDir(dirB, home);
    const { dirs, primary, configured } = resolveResultDirs(dirA, home);
    expect(primary).toBe(resolve(dirA));
    expect(dirs).toEqual([resolve(dirA), resolve(dirB)]);
    expect(configured).toEqual([resolve(dirB)]);
  });

  it('does not duplicate the primary when it is also configured', () => {
    addResultDir(dirA, home);
    const { dirs } = resolveResultDirs(dirA, home);
    expect(dirs).toEqual([resolve(dirA)]);
  });

  it('drops configured dirs that no longer exist (but keeps them recorded)', () => {
    saveSettings({ result_dirs: [resolve(dirB), '/gone/missing'] }, home);
    const { dirs, configured } = resolveResultDirs(dirA, home);
    expect(dirs).toContain(resolve(dirB));
    expect(dirs).not.toContain('/gone/missing');
    expect(configured).toContain('/gone/missing'); // still recorded in settings.json
  });

  describe('cache dir', () => {
    const ENV = 'WORCA_BENCH_CACHE';
    let saved;
    beforeEach(() => {
      saved = process.env[ENV];
      delete process.env[ENV];
    });
    afterEach(() => {
      if (saved === undefined) delete process.env[ENV];
      else process.env[ENV] = saved;
    });

    it('defaults to <home>/cache when unset', () => {
      const { dir, source } = resolveCacheDir(home);
      expect(dir).toBe(join(home, 'cache'));
      expect(source).toBe('default');
    });

    it('prefers the env var over the default', () => {
      process.env[ENV] = dirB;
      const { dir, source } = resolveCacheDir(home);
      expect(dir).toBe(resolve(dirB));
      expect(source).toBe('env');
    });

    it('prefers settings.cache_dir over the env var', () => {
      process.env[ENV] = dirB;
      setCacheDir(dirA, home);
      const { dir, source } = resolveCacheDir(home);
      expect(dir).toBe(resolve(dirA));
      expect(source).toBe('settings');
    });

    it('rejects a non-existent cache dir', () => {
      expect(() => setCacheDir('/no/such/cache', home)).toThrow(
        /not a directory/,
      );
    });

    it('clears the cache dir with an empty value (back to default)', () => {
      setCacheDir(dirA, home);
      setCacheDir('', home);
      expect(loadSettings(home).cache_dir).toBeUndefined();
      expect(resolveCacheDir(home).source).toBe('default');
    });
  });
});
