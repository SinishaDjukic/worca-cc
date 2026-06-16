import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addResultDir,
  loadSettings,
  removeResultDir,
  resolveResultDirs,
  saveSettings,
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
});
