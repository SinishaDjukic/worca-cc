// test/run-presets-store.test.mjs — run presets in SQLite (src/core/run-presets-store.mjs): a preset keeps the run's
// choices and never its task, names are unique per owner, and one owner never sees another's.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createPreset, readPreset, listPresets, updatePreset, duplicatePreset, deletePreset } from '../src/core/run-presets-store.mjs';

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
