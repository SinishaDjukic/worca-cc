// Stillhet slice 9 D5: the pure mapping between a project page's "How its tasks run" sentences and dev's project
// settings (GET/PATCH /api/projects/:key/settings), and its default tags and Labels answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SET_KEYS, setsOf, patchOf, defaultsOf } from '../ui/public/stillhet/live/projects-map.mjs';

const state = (own = {}, user = {}) => {
  const ids = ['pr.open', 'run.engine', 'pipelineCostLimitUsd', 'memory.team', 'runUserClaudeSettings'];
  const DEF = { 'pr.open': 'none', 'run.engine': 'claude', pipelineCostLimitUsd: null, 'memory.team': false, runUserClaudeSettings: false };
  const layers = Object.fromEntries(ids.map((id) => [id, { project: own[id], user: user[id], default: DEF[id] }]));
  const effective = Object.fromEntries(ids.map((id) => { const v = own[id] !== undefined ? own[id] : user[id] !== undefined ? user[id] : DEF[id]; return [id, { value: v, source: own[id] !== undefined ? 'project' : 'user' }]; }));
  return { own, effective, layers, roles: [] };
};

test('SET_KEYS is the frozen D5 table: each sentence names its dev setting', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(SET_KEYS).map(([k, v]) => [k, v.id])), { pr: 'pr.open', engine: 'run.engine', cap: 'pipelineCostLimitUsd', memory: 'memory.team', setup: 'runUserClaudeSettings' });
  assert.ok(Object.isFrozen(SET_KEYS));
});

test('setsOf: each sentence reads its word and the word it inherits; a value of the project\'s own is marked own', () => {
  const s = setsOf(state({ 'pr.open': 'draft' }, { pipelineCostLimitUsd: 50 }), false);
  assert.deepEqual(s.pr, { value: 'create a draft PR', yours: 'open no PR', own: true });
  assert.deepEqual(s.cap, { value: '$50', yours: '$50', own: false });
  assert.equal(setsOf(state()).cap.value, 'no cap');
  assert.equal(setsOf(state({ 'run.engine': 'codex' })).engine.value, 'Codex');
  assert.equal(setsOf(state({ 'memory.team': 'only' }), true).memory.value, 'the team\'s notes');
  assert.equal(setsOf(state({ runUserClaudeSettings: true })).setup.value, 'on');
  assert.equal(setsOf(state({ pipelineCostLimitUsd: 35 })).cap.value, '$35', 'a cap outside the list still reads');
});

test('patchOf: a word becomes its setting\'s value; an unknown word throws', () => {
  assert.deepEqual(patchOf('memory', 'the team\'s notes'), { 'memory.team': 'only' });
  assert.deepEqual(patchOf('memory', 'its own notes'), { 'memory.team': false });
  assert.deepEqual(patchOf('cap', 'no cap'), { pipelineCostLimitUsd: null });
  assert.deepEqual(patchOf('pr', 'create a PR ready for review'), { 'pr.open': 'ready' });
  assert.deepEqual(patchOf('engine', 'Gemini CLI'), { 'run.engine': 'gemini' });
  assert.deepEqual(patchOf('setup', 'off'), { runUserClaudeSettings: false });
  assert.throws(() => patchOf('pr', 'open a PR to the moon'));
  assert.throws(() => patchOf('branch', '{type}/{slug}'));
});

test('defaultsOf: tags in the design\'s key: value form and labels, labels [] when absent', () => {
  assert.deepEqual(defaultsOf({ tags: ['team:web'] }), { tags: ['team: web'], labels: [] });
  assert.deepEqual(defaultsOf({ tags: ['a:b'], labels: ['x'] }), { tags: ['a: b'], labels: ['x'] });
  assert.deepEqual(defaultsOf(null), { tags: [], labels: [] });
});
