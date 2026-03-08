import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readPreferences, writePreferences } from './preferences.js';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('preferences', () => {
  let dir;
  beforeEach(() => {
    dir = join(tmpdir(), `worca-prefs-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns defaults when file missing', () => {
    const prefs = readPreferences(join(dir, 'preferences.json'));
    expect(prefs.theme).toBe('light');
  });

  it('writes and reads back', () => {
    const path = join(dir, 'preferences.json');
    writePreferences({ theme: 'dark' }, path);
    const prefs = readPreferences(path);
    expect(prefs.theme).toBe('dark');
  });

  it('creates parent directory if needed', () => {
    const path = join(dir, 'sub', 'dir', 'preferences.json');
    writePreferences({ theme: 'dark' }, path);
    const prefs = readPreferences(path);
    expect(prefs.theme).toBe('dark');
  });
});
