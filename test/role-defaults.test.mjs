// test/role-defaults.test.mjs — Worca's own model per role (#1450): what an empty role runs on Claude Code and Codex.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLE_DEFAULT_HARNESSES, CLAUDE_ROLE_DEFAULTS, deriveCodexRoleDefaults, roleDefaultFor, roleDefaultsPayload, noModelLines,
} from '../src/core/role-defaults.mjs';
import { isPremiumModel } from '../src/core/model-tiers.mjs';
import { MODEL_ROLES } from '../src/shared/model-roles.mjs';

test('Claude Code defaults: Opus 5.5 / Sonnet 5.5 / Haiku 5.5, no effort', () => {
  assert.deepEqual(ROLE_DEFAULT_HARNESSES, ['claude', 'codex']);
  assert.deepEqual(roleDefaultFor('claude', 'deep'), { model: 'claude-opus-5-5', effort: undefined, role: 'deep', source: 'worca-default' });
  assert.equal(roleDefaultFor('claude', 'everyday').model, 'claude-sonnet-5-5');
  assert.equal(roleDefaultFor('claude', 'quick').model, 'claude-haiku-5-5');
  assert.equal(CLAUDE_ROLE_DEFAULTS.deep.effort, undefined);
});

test('Codex defaults derive by tier: gpt-5.6-sol / gpt-6.1-sol / gpt-6-luna; the tiebreak keeps codex\'s own default', () => {
  assert.deepEqual(deriveCodexRoleDefaults(), { deep: { model: 'gpt-5.6-sol' }, everyday: { model: 'gpt-6.1-sol' }, quick: { model: 'gpt-6-luna' } });
  assert.equal(deriveCodexRoleDefaults(), deriveCodexRoleDefaults(), 'memoised for the default args');
  assert.equal(deriveCodexRoleDefaults(undefined, { prefer: null }).everyday.model, 'gpt-6-sol', 'without prefer the id order decides');
  assert.deepEqual(deriveCodexRoleDefaults(['gpt-6-astra', 'gpt-6-luna']), { quick: { model: 'gpt-6-luna' } }, 'a tier with no model leaves its role out; premium never');
  assert.equal(roleDefaultFor('codex', 'deep').model, 'gpt-5.6-sol');
});

test('no Worca default is premium (invariant 3)', () => {
  for (const engine of ROLE_DEFAULT_HARNESSES) for (const role of MODEL_ROLES) {
    const pick = roleDefaultFor(engine, role);
    assert.ok(pick, `${engine}/${role}`);
    assert.equal(isPremiumModel(pick.model), false, `${engine}/${role} → ${pick.model}`);
  }
});

test('signed out, other harnesses and unknown roles have no default', () => {
  assert.equal(roleDefaultFor('claude', 'deep', { claudeAuth: 'signed-out' }), null);
  assert.equal(roleDefaultFor('claude', 'deep', { claudeAuth: 'unknown' }).model, 'claude-opus-5-5');
  assert.equal(roleDefaultFor('codex', 'deep', { claudeAuth: 'signed-out' }).model, 'gpt-5.6-sol', 'claude auth never gates codex');
  for (const e of ['copilot', 'cursor', 'gemini', 'qwen', 'goose', 'opencode']) assert.equal(roleDefaultFor(e, 'deep'), null, e);
  assert.equal(roleDefaultFor('claude', 'fast'), null);
});

test('roleDefaultsPayload: { claude:{deep:{model},…}, codex:{…} }', () => {
  assert.deepEqual(roleDefaultsPayload(), {
    claude: { deep: { model: 'claude-opus-5-5' }, everyday: { model: 'claude-sonnet-5-5' }, quick: { model: 'claude-haiku-5-5' } },
    codex: { deep: { model: 'gpt-5.6-sol' }, everyday: { model: 'gpt-6.1-sol' }, quick: { model: 'gpt-6-luna' } },
  });
});

const agent = (key, extra = {}) => ({ kind: 'agent', authoredKey: key, meta: { displayName: key[0].toUpperCase() + key.slice(1) }, ...extra });

test('noModelLines: a tool-decides engine (or Claude signed out) warns once for its model-less steps', () => {
  const nodes = { a: agent('plan'), b: agent('build'), c: agent('check', { model: 'gpt-x' }), t: { kind: 'task' } };
  assert.deepEqual(noModelLines('copilot', nodes), ["2 steps have no model: GitHub Copilot decides which model runs (Worca can't know it or its price)."]);
  assert.deepEqual(noModelLines('claude', { a: agent('plan') }, { claudeAuth: 'signed-out' }),
    ["1 step has no model: Claude Code decides which model runs (Worca can't know it or its price)."]);
  assert.deepEqual(noModelLines('gemini', { c: agent('check', { model: 'g' }) }), []);
});

test('noModelLines: Worca-default and cli-decides steps get one line each; a chosen model (project, care fill) gets none', () => {
  const nodes = {
    a: agent('plan', { model: 'claude-opus-5-5', modelSource: 'worca-default' }),
    b: agent('build', { modelSource: 'cli-decides' }),
    c: agent('check', { model: 'claude-sonnet-5-5', modelSource: 'project' }),
    d: agent('review', { model: 'claude-haiku-5-5', modelSource: 'care' }),
  };
  const roles = { plan: 'deep', build: 'everyday', check: 'everyday', review: 'everyday' };
  const lines = noModelLines('claude', nodes, { labelOf: (id) => (id === 'claude-opus-5-5' ? 'Opus 5.5' : id), roleOf: (nc) => roles[nc.authoredKey] });
  assert.deepEqual(lines, [
    "Plan runs on Opus 5.5 (Worca's default for Deep thinking).",
    'Build: Claude Code decides the model (your Everyday tasks role).',
  ]);
});
