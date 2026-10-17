// test/run-presets-store.test.mjs — run presets in SQLite (src/core/run-presets-store.mjs): a preset keeps the run's
// choices and never its task, names are unique per owner, and one owner never sees another's.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import { setupFromBody } from '../src/shared/run-presets.mjs';
import { createPreset, readPreset, listPresets, updatePreset, duplicatePreset, deletePreset, readRunSetup, createPresetFromRun } from '../src/core/run-presets-store.mjs';

useTempHome(after, 'worca-run-presets-store-');

const SETUP = { workflowId: 'wf_default', guardrailsId: 'normal', sameAsSource: true, sourceBranch: 'main',
  title: 'T', prompt: 'P', promptMarkdown: '# M', extras: ['f'], featureBranch: 'feat/x', allowUnguardedEngine: true,
  overlay: { nodes: { n_plan: { model: 'claude-opus-5-5', effort: 'high' } } } };

test('a preset round-trips and never keeps the task, the new-branch name or a consent', () => {
  const p = createPreset({ name: 'Quick fix', scope: { kind: 'project', ref: 'api-12345678' }, setup: SETUP });
  const back = readPreset(p.id);
  assert.deepEqual(back.setup, { workflowId: 'wf_default', guardrailsId: 'normal', sameAsSource: true, sourceBranch: 'main',
    overlay: { nodes: { n_plan: { model: 'claude-opus-5-5', effort: 'high' } } } });
  for (const k of ['title', 'prompt', 'promptMarkdown', 'extras', 'featureBranch', 'allowUnguardedEngine']) assert.equal(k in back.setup, false, k);
  assert.deepEqual(back.scope, { kind: 'project', ref: 'api-12345678' });
});

test('names are unique per owner ignoring case; duplicate picks a free name; owners are isolated', () => {
  const a = createPreset({ name: 'Nightly', setup: {} });
  assert.throws(() => createPreset({ name: 'NIGHTLY', setup: {} }), (e) => e.code === 'DUPLICATE');
  assert.equal(duplicatePreset(a.id).name, 'Nightly (copy)');
  assert.equal(duplicatePreset(a.id).name, 'Nightly (copy 2)');
  const b = createPreset({ name: 'Nightly', setup: {} }, { owner: 'ana' });
  assert.equal(readPreset(b.id, { owner: 'bo' }), null);
  assert.equal(deletePreset(b.id, { owner: 'bo' }), false);
  assert.equal(listPresets({ owner: 'ana' }).length, 1);
});

test('update renames and re-scopes; a global scope drops branch names; bad input throws BAD_PRESET', () => {
  const p = createPreset({ name: 'Scoped', scope: { kind: 'project', ref: 'api-12345678' }, setup: SETUP });
  const u = updatePreset(p.id, { name: 'Global now', scope: { kind: 'global' } });
  assert.equal(u.name, 'Global now');
  assert.equal(u.setup.sourceBranch, undefined);
  assert.throws(() => updatePreset(p.id, { name: '' }), (e) => e.code === 'BAD_PRESET');
  assert.throws(() => createPreset({ name: 'Big', setup: { tags: ['x'.repeat(40000)] } }), (e) => e.code === 'BAD_PRESET');
  assert.throws(() => updatePreset('rp_000000000000', { name: 'x' }), (e) => e.code === 'NOT_FOUND');
});

const FULL = { workflowId: 'wf_default', guardrailsId: 'normal', sourceBranch: 'main', sameAsSource: true, mock: true,
  overlay: { nodes: { n_plan: { model: 'claude-haiku-4-5', effort: 'medium', fanOut: false },
    n_impl: { model: 'claude-opus-5-5', effort: 'high', fanOut: true } }, wires: { w5: { maxCycles: 2 } } } };
// What POST /api/run carries besides the picks: never part of a setup.
const TASK = { prompt: 'fix login', title: 'Fix login', promptMarkdown: '# x', extras: ['a.md'], featureBranch: 'feat/x',
  allowUnguardedEngine: true, pastTeamCap: true, policyReason: 'r', scheduledFor: '2026-10-18T10:00:00.000Z', projectDir: '/tmp/api' };
// The start path's capture (ui/server.mjs runSetupOf), minus snapshotFor: the run's own target kind keeps branch names.
const runSetupOfBody = (body) => setupFromBody(body, { scope: 'project' });
const seedRun = (id, runSetup, { target = 'project', ws = null } = {}) => getDb()
  .prepare('INSERT INTO pipelines (id, project_key, workspace_key, target, run_setup) VALUES (?, ?, ?, ?, ?)')
  .run(id, 'api-12345678', ws, target, runSetup == null ? null : JSON.stringify(runSetup));

test('writeState keeps run_setup from the INSERT; a later write (a resume) never clears it', async () => {
  const { writeState } = await import('../src/core/artifacts.mjs');
  const st = { id: 'rsetup01', projectKey: 'api-12345678', status: 'running', phase: 'plan' };
  await writeState('/tmp/x-rsetup01', st, { runSetup: JSON.stringify({ workflowId: 'wf_default' }) });
  await writeState('/tmp/x-rsetup01', { ...st, status: 'done' });
  assert.deepEqual(readRunSetup('rsetup01').setup, { workflowId: 'wf_default' });
});

test('a preset saved from a run equals the preset saved from the same picks in New run', () => {
  const stored = runSetupOfBody({ ...TASK, ...FULL });
  for (const k of Object.keys(TASK)) assert.equal(k in stored, false, `${k} is never stored`);
  seedRun('runeq001', stored);
  const scope = { kind: 'project', ref: 'api-12345678' };
  const fromRun = createPresetFromRun('runeq001', { name: 'From run', scope });
  // New run's Save current setup…: presetSetupFromForm → setupFromBody(draft, { scope: 'project' }) → createPreset.
  const byHand = createPreset({ name: 'By hand', scope, setup: setupFromBody({ ...FULL, title: 'other', prompt: 'other' }, { scope: 'project' }) });
  assert.deepEqual(fromRun.setup, byHand.setup);
  assert.deepEqual(fromRun.scope, byHand.scope);
});

test('a global preset saved from a run drops the branch names, like one saved in New run', () => {
  seedRun('runeq002', runSetupOfBody(FULL));
  const p = createPresetFromRun('runeq002', { name: 'Any from run', scope: { kind: 'global' } });
  assert.equal(p.setup.sourceBranch, undefined);
  assert.equal(p.setup.sameAsSource, true);
});

test('a pre-v62 run has no setup: readRunSetup answers null and saving throws NO_RUN_SETUP; an unknown run is NOT_FOUND', () => {
  seedRun('legacy02', null);
  assert.deepEqual(readRunSetup('legacy02'), { setup: null, target: { kind: 'project', ref: 'api-12345678' } });
  assert.throws(() => createPresetFromRun('legacy02', { name: 'x', scope: { kind: 'global' } }), (e) => e.code === 'NO_RUN_SETUP');
  assert.equal(readRunSetup('nope0000'), undefined);
  assert.equal(readRunSetup('../etc'), undefined);
  assert.throws(() => createPresetFromRun('nope0000', { name: 'x' }), (e) => e.code === 'NOT_FOUND');
});

test('a corrupt run_setup reads as no setup, and a workspace run names its workspace as the target', () => {
  getDb().prepare("INSERT INTO pipelines (id, project_key, workspace_key, target, run_setup) VALUES ('wsrun001', 'api-12345678', 'wks-abc', 'workspace', '{bad')").run();
  assert.deepEqual(readRunSetup('wsrun001'), { setup: null, target: { kind: 'workspace', ref: 'wks-abc' } });
});
