import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  memoryCaps, setWorcaRoot, settingsFile,
  DEFAULT_MEMORY_SOFT_BYTES_PER_FILE, DEFAULT_MEMORY_HARD_BYTES_PER_FILE,
  DEFAULT_MEMORY_MAX_FILES_PER_SCOPE, DEFAULT_MEMORY_INDEX_MAX_BYTES, DEFAULT_MEMORY_HOOK_MAX_CHARS,
} from '../src/core/settings.mjs';

// settingsFile() resolves under HOME (not WORCA_HOME): sandbox HOME like
// test/run-root-layout.test.mjs does for the runRootMode precedence test.
let home; const prev = {};
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-mem-settings-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prev[k] = process.env[k];
  process.env.HOME = home; process.env.USERPROFILE = home;
  delete process.env.WORCA_HOME;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
after(async () => {
  for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await rm(home, { recursive: true, force: true });
});

test('memoryCaps: defaults when settings carry no memory block', () => {
  assert.deepEqual(memoryCaps(), {
    softBytesPerFile: DEFAULT_MEMORY_SOFT_BYTES_PER_FILE,
    hardBytesPerFile: DEFAULT_MEMORY_HARD_BYTES_PER_FILE,
    maxFilesPerScope: DEFAULT_MEMORY_MAX_FILES_PER_SCOPE,
    indexMaxBytes: DEFAULT_MEMORY_INDEX_MAX_BYTES,
    hookMaxChars: DEFAULT_MEMORY_HOOK_MAX_CHARS,
  });
  assert.equal(DEFAULT_MEMORY_SOFT_BYTES_PER_FILE, 8192);
  assert.equal(DEFAULT_MEMORY_HARD_BYTES_PER_FILE, 32768);
  assert.equal(DEFAULT_MEMORY_MAX_FILES_PER_SCOPE, 50);
  assert.equal(DEFAULT_MEMORY_INDEX_MAX_BYTES, 4096);
  assert.equal(DEFAULT_MEMORY_HOOK_MAX_CHARS, 160);
});

test('memoryCaps: settings.memory overrides each key; invalid values fall back WITH a warning', async () => {
  await setWorcaRoot('');                                   // creates settings.json
  const cur = JSON.parse(await readFile(settingsFile(), 'utf8'));
  await writeFile(settingsFile(), JSON.stringify({ ...cur, memory: { maxBytesPerFile: 1000, softBytesPerFile: 500, maxFilesPerScope: 7, indexMaxBytes: 'big', hookMaxChars: 0 } }, null, 2));
  const warnings = []; const orig = console.warn; console.warn = (...a) => warnings.push(a.join(' '));
  try {
    const caps = memoryCaps();
    assert.equal(caps.hardBytesPerFile, 1000);
    assert.equal(caps.softBytesPerFile, 500);
    assert.equal(caps.maxFilesPerScope, 7);
    assert.equal(caps.indexMaxBytes, DEFAULT_MEMORY_INDEX_MAX_BYTES, 'a string is not a cap');
    assert.equal(caps.hookMaxChars, DEFAULT_MEMORY_HOOK_MAX_CHARS, '0 is not a cap');
    assert.ok(warnings.some((w) => /memory\.indexMaxBytes/.test(w)), warnings.join('\n'));
    assert.ok(warnings.some((w) => /memory\.hookMaxChars/.test(w)), warnings.join('\n'));
  } finally { console.warn = orig; }
});
