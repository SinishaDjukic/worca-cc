// test/role-slots.test.mjs — the one model-pick module (src/shared/graph/role-slots.mjs): cleaning a pick, keeping it
// only where the run's engine runs it, the layer order (run > project > template, an effort travels with its model) and
// per-role resolution. Node picks (workflows.mjs ownedPair) and role picks share pickOnEngine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanPick, pickOnEngine, pickOrDrop, layerPick, resolveRolePicks, pickDropWarnings } from '../src/shared/graph/role-slots.mjs';
import { effortOn } from '../src/shared/connections.mjs';
import { effortsForEngine } from '../src/core/model-env.mjs';

const CLAUDE_ONLY = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5']);
const CODEX_ONLY = new Set(['gpt-5.5']);
/** Engine membership as the catalog answers it: a Claude model runs on claude, a Codex model on codex, others anywhere. */
const env = (engine) => ({
  runs: (m) => (engine === 'claude' ? !CODEX_ONLY.has(m) : !CLAUDE_ONLY.has(m)),
  efforts: effortsForEngine(engine),
  effortOn,
});

test('cleanPick trims, drops blanks, non-strings and over-long values; null when nothing is left', () => {
  assert.deepEqual(cleanPick({ model: ' claude-opus-5-5 ', effort: ' max ' }), { model: 'claude-opus-5-5', effort: 'max' });
  assert.deepEqual(cleanPick({ model: '', effort: 'high' }), { effort: 'high' });
  assert.deepEqual(cleanPick({ model: 7, effort: 'x'.repeat(33) }), null);
  assert.deepEqual(cleanPick({ model: 'm'.repeat(201) }), null);
  assert.deepEqual(cleanPick({ model: 'm'.repeat(200) }), { model: 'm'.repeat(200) });
  assert.equal(cleanPick({ model: '  ', effort: '' }), null);
  assert.equal(cleanPick(null), null);
  assert.equal(cleanPick('claude-opus-5-5'), null);
});

test('pickOnEngine keeps a pick the engine runs, drops a Claude-only model on codex, maps the effort with effortOn', () => {
  assert.deepEqual(pickOnEngine({ model: 'claude-opus-5-5', effort: 'max' }, 'claude', env('claude')), { model: 'claude-opus-5-5', effort: 'max' });
  assert.deepEqual(pickOnEngine({ model: 'claude-opus-5-5', effort: 'max' }, 'codex', env('codex')), {}, 'dropped whole: no effort rides alone');
  assert.deepEqual(pickOnEngine({ model: 'gpt-5.5', effort: 'max' }, 'codex', env('codex')), { model: 'gpt-5.5', effort: 'high' }, 'nearest codex effort');
  assert.deepEqual(pickOnEngine({ model: 'gpt-5.5', effort: 'low' }, 'codex', env('codex')), { model: 'gpt-5.5', effort: 'low' });
  assert.deepEqual(pickOnEngine({ effort: 'max' }, 'codex', env('codex')), {}, 'an effort without a model is kept only when the engine lists it');
  assert.deepEqual(pickOnEngine({ effort: 'high' }, 'codex', env('codex')), { effort: 'high' });
  assert.deepEqual(pickOnEngine(null, 'claude', env('claude')), {});
});

test('layerPick: the first layer naming a model wins with its own effort only; else the first effort', () => {
  assert.deepEqual(layerPick([{ model: 'a' }, { model: 'b', effort: 'max' }]), { model: 'a' }, 'an effort travels with its model');
  assert.deepEqual(layerPick([{ effort: 'high' }, { model: 'b', effort: 'max' }]), { model: 'b', effort: 'max' });
  assert.deepEqual(layerPick([null, { effort: 'high' }, { effort: 'max' }]), { effort: 'high' });
  assert.deepEqual(layerPick([null, undefined, {}]), {});
});

const ROLES = [
  { key: 'correctness', label: 'Correctness' },
  { key: 'security', label: 'Security', model: 'claude-haiku-4-5', effort: 'medium' },
  { key: 'fit', label: 'Fit' },
];

test('resolveRolePicks: run > project > template per role, with the source; a role nothing names is absent', () => {
  const picks = resolveRolePicks({
    roles: ROLES,
    overlay: { correctness: { model: 'claude-opus-5-5', effort: 'max' } },
    project: { correctness: { model: 'claude-sonnet-5-5' }, security: { model: 'claude-sonnet-5-5', effort: 'high' } },
    engine: 'claude', ...env('claude'),
  });
  assert.deepEqual(picks, {
    correctness: { model: 'claude-opus-5-5', effort: 'max', source: 'run' },
    security: { model: 'claude-sonnet-5-5', effort: 'high', source: 'project' },
  });
  const tpl = resolveRolePicks({ roles: ROLES, overlay: {}, project: {}, engine: 'claude', ...env('claude') });
  assert.deepEqual(tpl, { security: { model: 'claude-haiku-4-5', effort: 'medium', source: 'template' } });
});

test('resolveRolePicks: a model the engine does not run is dropped, and the entry keeps what was wanted', () => {
  const picks = resolveRolePicks({ roles: ROLES, overlay: {}, project: {}, engine: 'codex', ...env('codex') });
  assert.deepEqual(picks, { security: { source: 'template', wanted: { model: 'claude-haiku-4-5', effort: 'medium' } } });
  const mapped = resolveRolePicks({ roles: ROLES, overlay: { fit: { model: 'gpt-5.5', effort: 'max' } }, project: undefined, engine: 'codex', ...env('codex') });
  assert.deepEqual(mapped.fit, { model: 'gpt-5.5', effort: 'high', source: 'run' });
});

test('node and role picks share pickOrDrop', () => {
  const sel = { model: 'gpt-5.5', effort: 'max' };
  const role = resolveRolePicks({ roles: [{ key: 'qa', label: 'QA', ...sel }], overlay: {}, project: {}, engine: 'codex', ...env('codex') });
  const { source: _s, ...pair } = role.qa;
  assert.deepEqual(pair, pickOnEngine(sel, 'codex', env('codex')));
  // workflows.mjs ownedPair is a one-line wrapper over pickOrDrop, the function pickOnEngine reads.
  const src = readFileSync(new URL('../src/core/workflows.mjs', import.meta.url), 'utf8');
  const body = /function ownedPair\([^)]*\) \{([\s\S]*?)\n\}/.exec(src)[1];
  assert.match(body, /return pickOrDrop\(sel, engine, \{/);
  assert.equal(body.trim().split('\n').length, 1, 'ownedPair has no logic of its own');
});

test('pickOrDrop: a pick the engine cannot run comes back as dropped; a kept or mapped pick drops nothing', () => {
  assert.deepEqual(pickOrDrop({ model: 'claude-opus-5-5', effort: 'max' }, 'codex', env('codex')),
    { pick: {}, dropped: { model: 'claude-opus-5-5', effort: 'max' } });
  assert.deepEqual(pickOrDrop({ model: 'gpt-5.5', effort: 'max' }, 'codex', env('codex')), { pick: { model: 'gpt-5.5', effort: 'high' }, dropped: null }, 'a mapped effort is no drop');
  assert.deepEqual(pickOrDrop({ model: 'claude-opus-5-5', effort: 'max' }, 'claude', env('claude')), { pick: { model: 'claude-opus-5-5', effort: 'max' }, dropped: null });
  assert.deepEqual(pickOrDrop({ effort: 'max' }, 'codex', env('codex')), { pick: {}, dropped: { effort: 'max' } }, 'an effort-only pick the engine lacks');
  assert.deepEqual(pickOrDrop({ effort: 'high' }, 'codex', env('codex')), { pick: { effort: 'high' }, dropped: null });
  assert.deepEqual(pickOrDrop(null, 'codex', env('codex')), { pick: {}, dropped: null });
  assert.deepEqual(pickOrDrop({}, 'codex', env('codex')), { pick: {}, dropped: null });
});

test('resolveRolePicks: an effort-only pick the engine lacks is recorded as wanted', () => {
  const picks = resolveRolePicks({ roles: ROLES, overlay: { fit: { effort: 'max' } }, project: {}, engine: 'codex', ...env('codex') });
  assert.deepEqual(picks.fit, { source: 'run', wanted: { effort: 'max' } });
});

const NODES = () => ({
  n_task: { nodeId: 'n_task', kind: 'task' },
  n_plan: { nodeId: 'n_plan', kind: 'agent', key: 'planner', meta: { displayName: 'Plan' }, wanted: { model: 'claude-opus-5-5', source: 'run' } },
  n_rev: { nodeId: 'n_rev', kind: 'agent', key: 'reviewer', meta: {}, model: 'gpt-5.5', wanted: { model: 'claude-opus-5-5', effort: 'max', source: 'project' } },
  n_roles: {
    nodeId: 'n_roles', kind: 'agent', key: 'planReviewer', meta: { displayName: 'Plan Review' }, wanted: { model: 'claude-sonnet-5-5', source: 'template' },
    roles: {
      security: { source: 'run', wanted: { model: 'claude-opus-5-5' } },
      product: { source: 'template', wanted: { model: 'claude-opus-5-5', effort: 'medium' } },
      qa: { source: 'run', wanted: { effort: 'max' } },
      ux: { model: 'gpt-5.5', source: 'run' },
      bad: null,
    },
  },
  n_eff: { nodeId: 'n_eff', kind: 'agent', key: 'implementer', meta: {}, wanted: { effort: 'max', source: 'run' } },
  n_junk: null,
});

test('pickDropWarnings: one line per dropped node or role pick, in node order, each once; quietTemplate skips template drops', () => {
  const roleLabel = (nc, key) => ({ security: 'Security', product: 'Product', qa: 'QA' })[key] || key;
  const lines = pickDropWarnings(NODES(), { engine: 'codex', roleLabel });
  assert.deepEqual(lines, [
    "Plan: claude-opus-5-5 is not on OpenAI Codex, runs OpenAI Codex's default model",
    'reviewer: claude-opus-5-5 is not on OpenAI Codex, runs gpt-5.5',
    "Plan Review: claude-sonnet-5-5 is not on OpenAI Codex, runs OpenAI Codex's default model",
    "Plan Review · Security: claude-opus-5-5 is not on OpenAI Codex, runs the node's model",
    "Plan Review · Product: claude-opus-5-5 is not on OpenAI Codex, runs the node's model",
    "Plan Review · QA: effort max is not on OpenAI Codex, runs the node's effort",
    "implementer: effort max is not on OpenAI Codex, runs OpenAI Codex's default effort",
  ]);
  const quiet = pickDropWarnings(NODES(), { engine: 'codex', quietTemplate: true, roleLabel });
  assert.equal(quiet.filter((l) => /claude-sonnet-5-5|Product/.test(l)).length, 0, 'built-in template drops stay quiet');
  assert.equal(quiet.length, 5);
  const twice = { ...NODES(), n_copy: { ...NODES().n_plan } };
  assert.equal(pickDropWarnings(twice, { engine: 'codex' }).filter((l) => l.startsWith('Plan: ')).length, 1, 'deduped');
  assert.deepEqual(pickDropWarnings(NODES(), { engine: 'codex' }).find((l) => l.includes('· security')), "Plan Review · security: claude-opus-5-5 is not on OpenAI Codex, runs the node's model", 'the role key is the default label');
  assert.deepEqual(pickDropWarnings(null, { engine: 'codex' }), []);
});

test('resolveRolePicks: the helper-job slot beats the template and loses to the project; no slot changes nothing', () => {
  const roles = [{ key: 'product', label: 'Product', model: 'claude-opus-5-5', effort: 'medium' }, { key: 'ux', label: 'UX' }];
  const base = { roles, engine: 'claude', ...env('claude') };
  assert.deepEqual(resolveRolePicks({ ...base, slot: { product: { model: 'claude-haiku-4-5', effort: 'high' } } }),
    { product: { model: 'claude-haiku-4-5', effort: 'high', source: 'slot' } });
  assert.deepEqual(resolveRolePicks({ ...base, project: { product: { model: 'claude-sonnet-5-5' } }, slot: { product: { model: 'claude-haiku-4-5' } } }),
    { product: { model: 'claude-sonnet-5-5', source: 'project' } });
  assert.deepEqual(resolveRolePicks({ ...base, slot: undefined }), resolveRolePicks(base));
  assert.deepEqual(resolveRolePicks(base), { product: { model: 'claude-opus-5-5', effort: 'medium', source: 'template' } });
});

test('pickDropWarnings: a wanted record whose source is default is never printed', () => {
  const nc = { n: { kind: 'agent', key: 'planReviewer', meta: { displayName: 'Plan Review' }, model: 'gw',
    wanted: { model: 'claude-sonnet-5-5', source: 'default' },
    roles: { product: { effort: 'high', source: 'default', wanted: { model: 'claude-opus-5-5', effort: 'medium' } } } } };
  assert.deepEqual(pickDropWarnings(nc, { engine: 'claude' }), []);
  assert.deepEqual(pickDropWarnings(nc, { engine: 'codex' }), []);
});
