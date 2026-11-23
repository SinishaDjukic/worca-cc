import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const home = mkdtempSync(join(tmpdir(), 'act-settings-'));
const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
process.env.HOME = home; process.env.USERPROFILE = home;
after(() => { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } rmSync(home, { recursive: true, force: true }); });
const { actionsSettings, setActionsSettings } = await import('../src/core/settings.mjs');

test('actions settings: defaults, validation, clear', async () => {
  assert.deepEqual(actionsSettings(), { keep: 'never', portLow: 4400, portHigh: 4499, editor: '', terminal: '', maxCheckouts: null, previewPorts: 'all' });
  await assert.rejects(setActionsSettings({ keep: 'always' }), /keep/);
  await assert.rejects(setActionsSettings({ portLow: 5000, portHigh: 4000 }), /low/);
  await assert.rejects(setActionsSettings({ maxCheckouts: 0 }), /1 to 100/);
  const s = await setActionsSettings({ keep: 'until-pr', maxCheckouts: 5 });
  assert.equal(s.keep, 'until-pr'); assert.equal(s.maxCheckouts, 5);
  assert.equal((await setActionsSettings({ keep: null })).keep, 'never');
});

test('actions settings: previewPorts is all | range, cleared back to all', async () => {
  await assert.rejects(setActionsSettings({ previewPorts: 'any' }), /actions\.previewPorts must be one of all \| range/);
  assert.equal((await setActionsSettings({ previewPorts: 'range' })).previewPorts, 'range');
  assert.equal((await setActionsSettings({ previewPorts: null })).previewPorts, 'all');
});
