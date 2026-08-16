// test/settings-models.test.mjs
// Global model catalog in settings.json (configurable-models-design.md §4.1):
// loud-and-lenient reader, throwing setters, minimal stored shape, unknown-key
// survival on the shared read-modify-write object.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  settingsFile, listGlobalModels, addGlobalModel, updateGlobalModel, removeGlobalModel,
} from '../src/core/settings.mjs';
import { EFFORTS } from '../src/core/model-env.mjs';

// Sandbox the home so settingsFile() resolves into a temp dir. These tests
// never open the DB, so (unlike settings.test.mjs) no WORCA_HOME/db handling
// is needed — the settings module reads HOME fresh per call. The catalog
// read/write guard requires WORCA_TEST_ALLOW_HOME_FALLBACK once HOME is
// sandboxed (same contract as settings.test.mjs).
async function withSandbox(fn) {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-models-'));
  const prev = {
    HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE,
    WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK,
  };
  process.env.HOME = home; process.env.USERPROFILE = home;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  try { return await fn(home); }
  finally {
    for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) {
      if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k];
    }
    await rm(home, { recursive: true, force: true });
  }
}

const readRawSettings = async () => JSON.parse(await readFile(settingsFile(), 'utf8'));

test('empty: no settings file -> []', async () => {
  await withSandbox(() => {
    assert.deepEqual(listGlobalModels(), []);
  });
});

test('add: full entry round-trips; efforts normalize to EFFORTS order', async () => {
  await withSandbox(async () => {
    const added = await addGlobalModel({
      id: 'glm-4.7', label: 'GLM 4.7 (proxy)', efforts: ['high', 'medium'],
      env: { ANTHROPIC_BASE_URL: 'https://proxy.example/v1', ANTHROPIC_AUTH_TOKEN: '${MY_TOKEN}' },
    });
    assert.deepEqual(added, {
      id: 'glm-4.7', label: 'GLM 4.7 (proxy)', efforts: ['medium', 'high'],
      env: { ANTHROPIC_BASE_URL: 'https://proxy.example/v1', ANTHROPIC_AUTH_TOKEN: '${MY_TOKEN}' },
    });
    assert.deepEqual(listGlobalModels(), [added]);
  });
});

test('add: minimal entry gets id-as-label and the full effort set; stored shape is MINIMAL', async () => {
  await withSandbox(async () => {
    const added = await addGlobalModel({ id: 'my-fine-tune' });
    assert.deepEqual(added, { id: 'my-fine-tune', label: 'my-fine-tune', efforts: [...EFFORTS] });
    // Defaults are NOT frozen into the file (a future EFFORTS change must apply).
    assert.deepEqual((await readRawSettings()).models, [{ id: 'my-fine-tune' }]);
  });
});

test('add: rejections — missing id, duplicate id (case-insensitive), unknown effort, reserved/bad env', async () => {
  await withSandbox(async () => {
    await assert.rejects(addGlobalModel({}), /model id must be a non-empty string/);
    await assert.rejects(addGlobalModel({ id: '  ' }), /model id must be a non-empty string/);
    await addGlobalModel({ id: 'M1' });
    await assert.rejects(addGlobalModel({ id: 'm1' }), /already exists/);
    await assert.rejects(addGlobalModel({ id: 'm2', efforts: ['low'] }), /unknown effort "low"/);
    await assert.rejects(addGlobalModel({ id: 'm2', env: { PATH: '/x' } }), /env key "PATH" is reserved/);
    await assert.rejects(addGlobalModel({ id: 'm2', env: { WORCA_MOCK: '1' } }), /reserved/);
    await assert.rejects(addGlobalModel({ id: 'm2', env: { OK: 42 } }), /must be a non-empty string/);
    await assert.rejects(addGlobalModel({ id: 'm2', env: { OK: '' } }), /must be a non-empty string/);
    // Nothing from the failed writes leaked into the file.
    assert.deepEqual(listGlobalModels().map((m) => m.id), ['M1']);
  });
});

test('update: label/efforts reset semantics and per-key env merge', async () => {
  await withSandbox(async () => {
    await addGlobalModel({ id: 'm1', label: 'One', efforts: ['medium'], env: { A: '1', B: '2' } });

    // Omitted fields kept; env object merges per key, null DELETES a key.
    let m = await updateGlobalModel('m1', { env: { B: null, C: '3' } });
    assert.deepEqual(m, { id: 'm1', label: 'One', efforts: ['medium'], env: { A: '1', C: '3' } });

    // '' label resets to id; [] efforts resets to the full set.
    m = await updateGlobalModel('m1', { label: '', efforts: [] });
    assert.deepEqual(m, { id: 'm1', label: 'm1', efforts: [...EFFORTS], env: { A: '1', C: '3' } });

    // env: null clears the whole map; lookup is case-insensitive.
    m = await updateGlobalModel('M1', { env: null });
    assert.deepEqual(m, { id: 'm1', label: 'm1', efforts: [...EFFORTS] });
    // Cleared-to-default entry stores minimally again.
    assert.deepEqual((await readRawSettings()).models, [{ id: 'm1' }]);

    await assert.rejects(updateGlobalModel('nope', { label: 'x' }), /unknown model id/);
    await assert.rejects(updateGlobalModel('m1', { env: { PATH: '/x' } }), /reserved/);
    await assert.rejects(updateGlobalModel('m1', { efforts: ['low'] }), /unknown effort/);
  });
});

test('remove: deletes the entry, drops the key when empty, throws on unknown', async () => {
  await withSandbox(async () => {
    await addGlobalModel({ id: 'm1' });
    await addGlobalModel({ id: 'm2' });
    await removeGlobalModel('M1'); // case-insensitive
    assert.deepEqual(listGlobalModels().map((m) => m.id), ['m2']);
    await removeGlobalModel('m2');
    assert.deepEqual(listGlobalModels(), []);
    assert.equal((await readRawSettings()).models, undefined); // key dropped, not []
    await assert.rejects(removeGlobalModel('m1'), /unknown model id/);
  });
});

test('reader: hand-edited junk is dropped loudly, salvage is per-entry', async () => {
  await withSandbox(async (home) => {
    await mkdir(join(home, '.worca-cc'), { recursive: true });
    await writeFile(settingsFile(), JSON.stringify({
      models: [
        'not-an-object',
        { label: 'no id' },
        { id: 'ok', efforts: ['high', 'bogus'], env: { PATH: '/evil', GOOD: 'v', BAD: 7, WORCA_MOCK: '1' } },
        { id: 'OK', label: 'dup of ok' },
        { id: 'plain' },
      ],
    }, null, 2));
    assert.deepEqual(listGlobalModels(), [
      { id: 'ok', label: 'ok', efforts: ['high'], env: { GOOD: 'v' } },   // salvaged
      { id: 'plain', label: 'plain', efforts: [...EFFORTS] },             // dup 'OK' dropped, first wins
    ]);
  });
});

test('reader: non-array models value -> [] without throwing', async () => {
  await withSandbox(async (home) => {
    await mkdir(join(home, '.worca-cc'), { recursive: true });
    await writeFile(settingsFile(), JSON.stringify({ models: 'oops' }));
    assert.deepEqual(listGlobalModels(), []);
  });
});

test('read-modify-write: catalog writes never disturb other/unknown settings keys', async () => {
  await withSandbox(async (home) => {
    await mkdir(join(home, '.worca-cc'), { recursive: true });
    await writeFile(settingsFile(), JSON.stringify({ root: '/somewhere', futureKey: { a: 1 } }));
    await addGlobalModel({ id: 'm1' });
    await updateGlobalModel('m1', { label: 'One' });
    await removeGlobalModel('m1');
    const raw = await readRawSettings();
    assert.equal(raw.root, '/somewhere');
    assert.deepEqual(raw.futureKey, { a: 1 });
  });
});
