import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestNames, resolveNamingModel, groupNamePrompt, parseGroupName, suggestGroupName } from '../src/core/naming.mjs';
import { SMART_NAMING_DEFAULTS } from '../src/core/settings.mjs';

const reply = (o) => async () => ({ text: typeof o === 'string' ? o : JSON.stringify(o) });
const base = { prompt: 'Login redirects back after SSO on Safari', projectDir: '/tmp' };
const deps = (run, extra = {}) => ({ settings: () => ({ ...SMART_NAMING_DEFAULTS, types: [...SMART_NAMING_DEFAULTS.types] }), pickModel: () => null, run, ...extra });

test('a valid reply becomes title, type, slug, branch', async () => {
  const r = await suggestNames(base, deps(reply({ title: 'Fix Safari SSO redirect loop', type: 'fix', slug: 'safari-sso-redirect-loop', reason: 'reports broken behaviour' })));
  assert.equal(r.source, 'model'); assert.equal(r.branch, 'fix/safari-sso-redirect-loop'); assert.equal(r.type, 'fix');
  assert.equal(r.title, 'Fix Safari SSO redirect loop');
});
test('a type outside the allowed list becomes the first type; the slug is sanitised', async () => {
  const r = await suggestNames(base, deps(reply({ title: 'T x', type: 'hotfix', slug: 'Bad Slug!!' })));
  assert.equal(r.type, 'feat'); assert.equal(r.branch, 'feat/bad-slug');
});
test('a hostile slug cannot escape the branch', async () => {
  const r = await suggestNames(base, deps(reply({ title: 'T x', type: 'fix', slug: '../../etc/passwd' })));
  assert.equal(r.source, 'model'); assert.ok(!r.branch.includes('..'));
});
test('the chosen model and effort reach the spawn', async () => {
  let seen;
  await suggestNames(base, deps(async (o) => { seen = o; return { text: '{"title":"Some title","type":"fix","slug":"a-b"}' }; }, { pickModel: () => ({ model: 'claude-haiku-5-5', effort: 'low' }) }));
  assert.equal(seen.model, 'claude-haiku-5-5'); assert.equal(seen.effort, 'low');
});
test('garbage, a refusal, an empty task and a spawn failure all fall back without throwing', async () => {
  assert.equal((await suggestNames(base, deps(reply('sorry, I cannot')))).source, 'fallback');
  assert.equal((await suggestNames(base, deps(reply({ title: 'I need more context?', slug: '' })))).source, 'fallback');
  assert.equal((await suggestNames(base, deps(async () => { throw new Error('spawn ENOENT'); }))).source, 'fallback');
  assert.equal((await suggestNames({ prompt: '  ' }, deps(reply({})))).error, 'empty task');
});
test('the cost sink receives the priced result', async () => {
  const costs = [];
  const run = async (o) => { o.onEvent({ type: 'result', costUsd: 0.0001, usage: { input_tokens: 10, output_tokens: 5 } }); return { text: '{"title":"Some title","type":"fix","slug":"a-b"}' }; };
  const r = await suggestNames(base, deps(run, { onCost: (c) => costs.push(c) }));
  assert.equal(r.source, 'model');
  assert.equal(costs.length, 1); assert.ok(costs[0].costUsd > 0);
});
const row = (id, extra = {}) => ({ id, label: id, efforts: ['low', 'medium', 'high'], engine: 'claude', connection: { kind: 'signin', engine: 'claude' }, harnesses: ['claude'], ...extra });
test('the model comes from deps.pickModel (resolveNamingModel), never a leftover smartNaming.model', async () => {
  let seen;
  const run = async (o) => { seen = o; return { text: '{"title":"Some title","type":"fix","slug":"a-b"}' }; };
  const settings = () => ({ ...SMART_NAMING_DEFAULTS, types: [...SMART_NAMING_DEFAULTS.types], model: { model: 'legacy-model', effort: 'max' } });
  const rows = [row('claude-opus-5-5'), row('claude-haiku-5-5', { efforts: ['minimal', 'low'] })];
  await suggestNames(base, deps(run, { settings, pickModel: () => resolveNamingModel({ model: 'claude-opus-5-5', effort: 'high' }, rows, () => null) }));
  assert.deepEqual([seen.model, seen.effort], ['claude-opus-5-5', 'high'], 'the Run naming setting wins');
  await suggestNames(base, deps(run, { settings, pickModel: () => resolveNamingModel({ model: null, effort: null }, rows, () => null) }));
  assert.deepEqual([seen.model, seen.effort], ['claude-haiku-5-5', 'minimal'], 'unset: the cheapest ready Claude model at its lowest effort');
});

test('groupNamePrompt: titles and first messages only, 300 characters, at most 20 chats', () => {
  const p = groupNamePrompt([{ title: 'Fix the login', firstMessage: 'Safari loops after SSO' }, { title: '', firstMessage: 'x'.repeat(400) }]);
  assert.match(p, /1\. Title: Fix the login\n {3}First message: Safari loops after SSO/);
  assert.match(p, /2\. Title: \(none\)/);
  assert.ok(!p.includes('x'.repeat(301)));
  assert.equal(groupNamePrompt(Array.from({ length: 25 }, (_, i) => ({ title: `t${i}` }))).split('\n').filter((l) => /^\d+\./.test(l)).length, 20);
});

test('suggestGroupName: one call on the picked model; a usable name, else a fallback', async () => {
  let seen = null;
  const run = async (o) => { seen = o; return { text: '{"name":"Login and SSO"}' }; };
  const r = await suggestGroupName({ chats: [{ title: 'Fix the login', firstMessage: 'Safari loops' }] },
    { run, pickModel: () => ({ model: 'claude-haiku-5-5', effort: null }) });
  assert.deepEqual(r, { source: 'model', name: 'Login and SSO', model: 'claude-haiku-5-5' });
  assert.equal(seen.model, 'claude-haiku-5-5');
  assert.match(seen.prompt, /Fix the login/);
  assert.equal((await suggestGroupName({ chats: [{ title: 'a' }] }, { run: async () => ({ text: 'no json' }) })).source, 'fallback');
  assert.equal((await suggestGroupName({ chats: [] }, { run })).source, 'fallback');
  assert.equal(parseGroupName('{"name":"Release prep."}'), 'Release prep');
});

test('groupNamePrompt for runs: "Runs:" and each run\'s prompt as "Prompt"', () => {
  const p = groupNamePrompt([{ title: 'Fix', firstMessage: 'Do x' }], { of: 'runs' });
  assert.ok(p.startsWith('Runs:'));
  assert.match(p, /Prompt: Do x/);
  assert.doesNotMatch(p, /First message/);
});
