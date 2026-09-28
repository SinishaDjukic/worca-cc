import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  memoryCaps, setWorcaRoot, settingsFile,
  DEFAULT_MEMORY_SOFT_BYTES_PER_FILE, DEFAULT_MEMORY_HARD_BYTES_PER_FILE,
  DEFAULT_MEMORY_MAX_FILES_PER_SCOPE, DEFAULT_MEMORY_HOOK_MAX_CHARS,
  DEFAULT_MEMORY_DEFRAG_WRITES, DEFAULT_MEMORY_DEFRAG_FILES, DEFAULT_MEMORY_DEFRAG_BYTES_PCT,
  DEFAULT_MEMORY_DEFRAG_ALWAYS_ON_BYTES,
  memoryDefragModel, setMemoryDefragModel, assertMemoryDefragModelInput, SETTINGS_POST_KEYS,
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
    hookMaxChars: DEFAULT_MEMORY_HOOK_MAX_CHARS,
    defrag: { writes: DEFAULT_MEMORY_DEFRAG_WRITES, files: DEFAULT_MEMORY_DEFRAG_FILES, bytesPct: DEFAULT_MEMORY_DEFRAG_BYTES_PCT, alwaysOnBytes: DEFAULT_MEMORY_DEFRAG_ALWAYS_ON_BYTES },
  });
  assert.equal(DEFAULT_MEMORY_SOFT_BYTES_PER_FILE, 8192);
  assert.equal(DEFAULT_MEMORY_HARD_BYTES_PER_FILE, 32768);
  assert.equal(DEFAULT_MEMORY_MAX_FILES_PER_SCOPE, 50);
  assert.equal(DEFAULT_MEMORY_DEFRAG_ALWAYS_ON_BYTES, 16384);
  assert.equal(DEFAULT_MEMORY_HOOK_MAX_CHARS, 160);
  assert.equal(DEFAULT_MEMORY_DEFRAG_WRITES, 10);
  assert.equal(DEFAULT_MEMORY_DEFRAG_FILES, 30);
  assert.equal(DEFAULT_MEMORY_DEFRAG_BYTES_PCT, 60);
});

test('memoryCaps: settings.memory overrides each key; invalid values fall back WITH a warning', async () => {
  await setWorcaRoot('');                                   // creates settings.json
  const cur = JSON.parse(await readFile(settingsFile(), 'utf8'));
  await writeFile(settingsFile(), JSON.stringify({ ...cur, memory: { maxBytesPerFile: 1000, softBytesPerFile: 500, maxFilesPerScope: 7, indexMaxBytes: 4096, hookMaxChars: 0, defrag: { alwaysOnBytes: 'lots' } } }, null, 2));
  const warnings = []; const orig = console.warn; console.warn = (...a) => warnings.push(a.join(' '));
  try {
    const caps = memoryCaps();
    assert.equal(caps.hardBytesPerFile, 1000);
    assert.equal(caps.softBytesPerFile, 500);
    assert.equal(caps.maxFilesPerScope, 7);
    assert.equal('indexMaxBytes' in caps, false, 'the index cap is gone; a leftover settings key is ignored');
    assert.ok(!warnings.some((w) => /indexMaxBytes/.test(w)), 'and never warned about');
    assert.equal(caps.defrag.alwaysOnBytes, DEFAULT_MEMORY_DEFRAG_ALWAYS_ON_BYTES, 'a string is not a byte threshold');
    assert.ok(warnings.some((w) => /memory\.defrag\.alwaysOnBytes/.test(w)), warnings.join('\n'));
    assert.equal(caps.hookMaxChars, DEFAULT_MEMORY_HOOK_MAX_CHARS, '0 is not a cap');
    assert.ok(warnings.some((w) => /memory\.hookMaxChars/.test(w)), warnings.join('\n'));
  } finally { console.warn = orig; }
});

test('memoryCaps.defrag: settings.memory.defrag overrides each threshold; bytesPct is 1..100; bad values warn by full key', async () => {
  await setWorcaRoot('');
  const cur = JSON.parse(await readFile(settingsFile(), 'utf8'));
  await writeFile(settingsFile(), JSON.stringify({ ...cur, memory: { defrag: { writes: 3, files: 12, bytesPct: 150 } } }, null, 2));
  const warnings = []; const orig = console.warn; console.warn = (...a) => warnings.push(a.join(' '));
  try {
    const { defrag } = memoryCaps();
    assert.deepEqual(defrag, { writes: 3, files: 12, bytesPct: DEFAULT_MEMORY_DEFRAG_BYTES_PCT, alwaysOnBytes: DEFAULT_MEMORY_DEFRAG_ALWAYS_ON_BYTES }, '150 % is not a share');
    assert.ok(warnings.some((w) => /memory\.defrag\.bytesPct/.test(w)), warnings.join('\n'));
  } finally { console.warn = orig; }
  await writeFile(settingsFile(), JSON.stringify({ ...cur, memory: { defrag: 'soon', maxFilesPerScope: 9 } }, null, 2));
  const blockWarnings = []; console.warn = (...a) => blockWarnings.push(a.join(' '));
  let caps;
  try { caps = memoryCaps(); } finally { console.warn = orig; }
  assert.deepEqual(caps.defrag, { writes: DEFAULT_MEMORY_DEFRAG_WRITES, files: DEFAULT_MEMORY_DEFRAG_FILES, bytesPct: DEFAULT_MEMORY_DEFRAG_BYTES_PCT, alwaysOnBytes: DEFAULT_MEMORY_DEFRAG_ALWAYS_ON_BYTES }, 'a non-object defrag block is ignored');
  assert.equal(caps.maxFilesPerScope, 9, 'the flat keys next to it still read');
  assert.ok(blockWarnings.some((w) => /memory\.defrag\b/.test(w)), blockWarnings.join('\n'));
  assert.equal(blockWarnings.length, 1, 'warned ONCE, not once per threshold key');
});

// ── Settings › Memory: the defragment model (memory.defrag.model / memory.defrag.effort) ──

/** Overwrite settings.json wholesale — the hand-edited-file path. */
async function writeSettingsJson(obj) {
  await setWorcaRoot('');                                   // creates the bootstrap dir + file
  await writeFile(settingsFile(), JSON.stringify(obj, null, 2));
}
const readSettingsJson = async () => JSON.parse(await readFile(settingsFile(), 'utf8'));

test('memoryDefragModel: unset by default; the stored pair reads back; an effort without a model reads as unset', async () => {
  await writeSettingsJson({});
  assert.deepEqual(memoryDefragModel(), { model: null, effort: null });
  await writeSettingsJson({ memory: { defrag: { model: ' claude-opus-5-5 ', effort: 'high' } } });
  assert.deepEqual(memoryDefragModel(), { model: 'claude-opus-5-5', effort: 'high' });
  await writeSettingsJson({ memory: { defrag: { effort: 'high' } } });
  assert.deepEqual(memoryDefragModel(), { model: null, effort: null }, 'an effort travels with its model');
});

test('memoryDefragModel: bad values warn by full key — once per value, not once per read — and read as unset (a bad effort drops only the effort)', async () => {
  const warnings = []; const orig = console.warn; console.warn = (...a) => warnings.push(a.join(' '));
  try {
    await writeSettingsJson({ memory: { defrag: { model: 42 } } });
    assert.deepEqual(memoryDefragModel(), { model: null, effort: null });
    assert.deepEqual(memoryDefragModel(), { model: null, effort: null });
    assert.equal(warnings.filter((w) => /memory\.defrag\.model 42\b/.test(w)).length, 1, `every GET /api/settings reads it: ${warnings.join('\n')}`);
    await writeSettingsJson({ memory: { defrag: { model: 'claude-opus-5-5', effort: 'turbo' } } });
    assert.deepEqual(memoryDefragModel(), { model: 'claude-opus-5-5', effort: null });
    memoryDefragModel();
    assert.equal(warnings.filter((w) => /memory\.defrag\.effort "turbo"/.test(w)).length, 1, warnings.join('\n'));
  } finally { console.warn = orig; }
});

test('memoryCaps never carries the defragment model, and readDefragThreshold never reads (or warns about) its string keys', async () => {
  await writeSettingsJson({ memory: { defrag: { writes: 3, model: 'claude-opus-5-5', effort: 'high' } } });
  const warnings = []; const orig = console.warn; console.warn = (...a) => warnings.push(a.join(' '));
  let caps;
  try { caps = memoryCaps(); } finally { console.warn = orig; }
  assert.deepEqual(caps.defrag, { writes: 3, files: DEFAULT_MEMORY_DEFRAG_FILES, bytesPct: DEFAULT_MEMORY_DEFRAG_BYTES_PCT, alwaysOnBytes: DEFAULT_MEMORY_DEFRAG_ALWAYS_ON_BYTES });
  assert.deepEqual(warnings, [], 'the model/effort strings are not thresholds and are never warned about');
});

test('memoryDefragModel reads unset under node:test unless the test opted in with a sandboxed HOME', async () => {
  await writeSettingsJson({ memory: { defrag: { model: 'claude-opus-5-5' } } });
  const prev = process.env.WORCA_TEST_ALLOW_HOME_FALLBACK;
  delete process.env.WORCA_TEST_ALLOW_HOME_FALLBACK;
  try { assert.deepEqual(memoryDefragModel(), { model: null, effort: null }); }
  finally { process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = prev; }
  assert.equal(memoryDefragModel().model, 'claude-opus-5-5');
});

test('setMemoryDefragModel: writes into the memory.defrag block, keeps the thresholds and every other key, clears tidily', async () => {
  await writeSettingsJson({ root: '', memory: { maxFilesPerScope: 9, defrag: { writes: 3 } }, theme: 'dark' });
  assert.deepEqual(await setMemoryDefragModel({ model: 'claude-opus-5-5', effort: 'high' }), { memoryDefrag: { model: 'claude-opus-5-5', effort: 'high' } });
  let s = await readSettingsJson();
  assert.deepEqual(s.memory, { maxFilesPerScope: 9, defrag: { writes: 3, model: 'claude-opus-5-5', effort: 'high' } });
  assert.equal(s.theme, 'dark', 'unrelated keys survive');
  await setMemoryDefragModel({ model: 'claude-haiku-4-5', effort: '' });
  assert.deepEqual((await readSettingsJson()).memory.defrag, { writes: 3, model: 'claude-haiku-4-5' }, 'a blank effort is not stored');
  await setMemoryDefragModel(null);
  assert.deepEqual((await readSettingsJson()).memory, { maxFilesPerScope: 9, defrag: { writes: 3 } }, 'clearing removes only the pair');
  await writeSettingsJson({ memory: { defrag: { model: 'x' } } });
  await setMemoryDefragModel({ model: '' });
  s = await readSettingsJson();
  assert.equal('memory' in s, false, 'a block left empty is removed');
});

test('assertMemoryDefragModelInput: the pair rule, the catalog casing, and the model\'s own efforts', () => {
  const models = [{ id: 'claude-opus-5-5', efforts: ['medium', 'high', 'xhigh', 'max'] }, { id: 'claude-haiku-4-5', efforts: ['medium', 'high'] }];
  assert.equal(assertMemoryDefragModelInput(null), null);
  assert.equal(assertMemoryDefragModelInput(''), null);
  assert.equal(assertMemoryDefragModelInput({ model: '', effort: '' }), null, 'clearing the model clears the effort');
  assert.equal(assertMemoryDefragModelInput({ model: '   ', effort: ' ' }), null, 'a whitespace-only model is blank too: a clear');
  assert.throws(() => assertMemoryDefragModelInput({ model: '', effort: 'high' }), /effort needs a model/);
  assert.throws(() => assertMemoryDefragModelInput('claude-opus-5-5'), /must be \{ model, effort \}/);
  assert.throws(() => assertMemoryDefragModelInput({ model: 7 }), /catalog model id/);
  assert.throws(() => assertMemoryDefragModelInput({ model: 'claude-opus-5-5', effort: 'turbo' }), /must be one of/);
  assert.deepEqual(assertMemoryDefragModelInput({ model: 'CLAUDE-OPUS-5-5', effort: 'max' }, models), { model: 'claude-opus-5-5', effort: 'max' });
  assert.deepEqual(assertMemoryDefragModelInput({ model: 'claude-opus-5-5', effort: ' high ' }, models), { model: 'claude-opus-5-5', effort: 'high' }, 'a padded effort is trimmed, like setNodeModel and a start pair');
  assert.throws(() => assertMemoryDefragModelInput({ model: 'gone-model' }, models), /unknown model "gone-model"/);
  assert.throws(() => assertMemoryDefragModelInput({ model: 'claude-haiku-4-5', effort: 'max' }, models), /claude-haiku-4-5 does not offer effort "max"/);
  assert.ok(SETTINGS_POST_KEYS.includes('memoryDefrag'), 'registered beside its setter (the root-clearing guard reads this list)');
});
