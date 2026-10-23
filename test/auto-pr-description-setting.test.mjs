// test/auto-pr-description-setting.test.mjs
// The opt-in autoGeneratePrDescription setting: OFF by default, boolean-only, and the
// key leaves settings.json when it goes back to the default.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  settingsFile, autoGeneratePrDescription, setAutoGeneratePrDescription,
  assertAutoGeneratePrDescriptionInput, DEFAULT_AUTO_GENERATE_PR_DESCRIPTION,
} from '../src/core/settings.mjs';
import { checkRows } from './helpers/rows.mjs';

let home, prevHome, prevProfile;

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-auto-pr-desc-'));
  prevHome = process.env.HOME; prevProfile = process.env.USERPROFILE;
  process.env.HOME = home; process.env.USERPROFILE = home;
  await mkdir(join(home, '.worca-cc'), { recursive: true });
});
after(async () => {
  if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  if (prevProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevProfile;
  await rm(home, { recursive: true, force: true });
});

const stored = async () => JSON.parse(await readFile(settingsFile(), 'utf8'));

test('autoGeneratePrDescription: default off, boolean-only, key dropped at the default', async () => {
  await checkRows([
    { name: 'missing reads as false (the default)', run: async () => {
      await writeFile(settingsFile(), '{}\n', 'utf8');
      assert.equal(DEFAULT_AUTO_GENERATE_PR_DESCRIPTION, false);
      assert.equal(autoGeneratePrDescription(), false);
    } },
    { name: 'a corrupt stored value reads as the default', run: async () => {
      await writeFile(settingsFile(), JSON.stringify({ autoGeneratePrDescription: 'yes' }), 'utf8');
      const warn = console.warn; console.warn = () => {};
      try { assert.equal(autoGeneratePrDescription(), false); } finally { console.warn = warn; }
    } },
    { name: 'true persists and reads back; other keys survive', run: async () => {
      await writeFile(settingsFile(), JSON.stringify({ theme: 'dark' }), 'utf8');
      assert.deepEqual(await setAutoGeneratePrDescription(true), { autoGeneratePrDescription: true });
      assert.equal(autoGeneratePrDescription(), true);
      assert.deepEqual(await stored(), { theme: 'dark', autoGeneratePrDescription: true });
    } },
    { name: 'false deletes the key', run: async () => {
      await writeFile(settingsFile(), JSON.stringify({ autoGeneratePrDescription: true }), 'utf8');
      assert.deepEqual(await setAutoGeneratePrDescription(false), { autoGeneratePrDescription: false });
      assert.equal('autoGeneratePrDescription' in await stored(), false);
    } },
    { name: 'non-booleans are refused and nothing is written', run: async () => {
      await writeFile(settingsFile(), '{}\n', 'utf8');
      for (const bad of ['true', 1, null, undefined, {}]) {
        assert.throws(() => assertAutoGeneratePrDescriptionInput(bad), /autoGeneratePrDescription must be true or false/);
        await assert.rejects(setAutoGeneratePrDescription(bad), /must be true or false/);
      }
      assert.deepEqual(await stored(), {});
    } },
  ]);
});
