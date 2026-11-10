// test/requirements-model-choice.test.mjs — the default, a feature's harness and model, the switch (9c D2-D4, D13, D18).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createAskModels } from '../src/core/ask/models.mjs';
import { createFeature, getFeature, listTurns, updateFeature } from '../src/core/requirements/store.mjs';
import { startOrientation, settled, isBusy } from '../src/core/requirements/interview.mjs';
import { markStarting, unmarkStarting } from '../src/core/requirements/starting.mjs';
import {
  scopeOf, defaultChoice, briefDefault, recommendedModel, featureModel, checkChoice, setFeatureModel,
} from '../src/core/requirements/model-choice.mjs';

useTempHome(after);

const RAW = [
  { id: 'claude-opus-x', label: 'Opus', efforts: ['medium', 'high'], engine: 'claude' },
  { id: 'gpt-everyday', label: 'GPT', efforts: ['low', 'medium'], engine: 'codex' },
  { id: 'gpt-first', label: 'GPT first', efforts: ['medium'], engine: 'codex' },
  { id: 'cop-1', label: 'Cop', efforts: ['medium'], engine: 'copilot' },
];
const ask = () => createAskModels({ listModels: async () => RAW, askPrefs: () => ({ engine: 'claude', slots: {} }),
  codexAvailable: () => true, copilotAvailable: () => true });
const READY = (extra = {}) => async () => [
  { name: 'claude', ready: true }, { name: 'codex', ready: true }, { name: 'copilot', ready: true }, { name: 'cursor', ready: true }, ...Object.entries(extra).map(([name, v]) => ({ name, ...v })),
].reduce((acc, r) => { acc.set(r.name, { ...r, ...(extra[r.name] || {}) }); return acc; }, new Map()).values().toArray();
const deps = (engine, over = {}) => {
  const a = ask();
  return { resolveEngine: () => ({ engine }), engines: () => ['claude', 'codex', 'copilot'], readiness: READY(),
    roleModel: () => null, catalog: a.askCatalog, validate: a.validateModelEffort,
    interviewModel: async () => ({ model: 'claude-opus-x', effort: 'medium' }), ...over };
};
const claude = { engine: 'claude', model: 'claude-opus-x', effort: 'medium' };

test('scopeOf: project key or workspace', () => {
  assert.deepEqual(scopeOf({ scopeType: 'project', scopeKey: 'k' }), { projectKey: 'k' });
  assert.deepEqual(scopeOf({ scopeType: 'workspace', scopeKey: 'w' }), { workspace: true });
});

test('defaultChoice: codex default takes the everyday role model, else the catalog default; effort null', async () => {
  const r = await defaultChoice({ projectKey: 'k' }, deps('codex', { roleModel: () => ({ model: 'gpt-everyday' }) }));
  assert.deepEqual(r, { choice: { engine: 'codex', model: 'gpt-everyday', effort: null }, fallbackReason: null });
  const r2 = await defaultChoice({ projectKey: 'k' }, deps('codex'));
  assert.equal(r2.choice.engine, 'codex');
  assert.equal(r2.choice.effort, null);
  assert.ok(['gpt-everyday', 'gpt-first'].includes(r2.choice.model));
  // a role model the catalog does not run on codex is ignored
  const r3 = await defaultChoice({ projectKey: 'k' }, deps('codex', { roleModel: () => ({ model: 'claude-opus-x' }) }));
  assert.notEqual(r3.choice.model, 'claude-opus-x');
});

test('defaultChoice: claude -> interviewModel pair; cursor -> Claude + the Cursor sentence', async () => {
  assert.deepEqual(await defaultChoice({ projectKey: 'k' }, deps('claude')), { choice: claude, fallbackReason: null });
  assert.deepEqual(await defaultChoice({ projectKey: 'k' }, deps('cursor')),
    { choice: claude, fallbackReason: "Your default engine is Cursor, which can't run Requirements, so this starts on Claude." });
});

test('defaultChoice: not signed in and broker fall back to Claude with the verbatim sentences', async () => {
  const off = await defaultChoice({ projectKey: 'k' }, deps('codex', { readiness: async () => [{ name: 'codex', ready: false, reason: 'not signed in' }] }));
  assert.deepEqual(off, { choice: claude, fallbackReason: "Codex isn't signed in, so this starts on Claude." });
  const br = await defaultChoice({ projectKey: 'k' }, deps('codex', { readiness: async () => [{ name: 'codex', ready: false, reason: 'broker', broker: true }] }));
  assert.deepEqual(br, { choice: claude, fallbackReason: 'Codex is off while the credential broker is on, so this starts on Claude.' });
  const cop = await defaultChoice({ projectKey: 'k' }, deps('copilot', { readiness: async () => [{ name: 'copilot', ready: false, reason: 'not installed' }] }));
  assert.equal(cop.fallbackReason, "Copilot isn't installed, so this starts on Claude.");
});

test('briefDefault (D18): a repo-reading engine stays; gemini-like (no repo) falls to Claude with the no-repo line', async () => {
  const ok = await briefDefault({ projectKey: 'k' }, deps('codex'));
  assert.equal(ok.choice.engine, 'codex');
  assert.equal(ok.fallbackReason, null);
  const cap = deps('gemini', { engines: () => ['claude', 'codex', 'gemini'] });
  const no = await briefDefault({ projectKey: 'k' }, cap);
  assert.deepEqual(no, { choice: claude, fallbackReason: "Your default engine is Gemini CLI, which can't read the repo, so this brief is made on Claude." });
  assert.equal((await briefDefault({ projectKey: 'k' }, deps('cursor'))).fallbackReason,
    "Your default engine is Cursor, which can't run Requirements, so this starts on Claude.");
  const off = await briefDefault({ projectKey: 'k' }, deps('codex', { readiness: async () => [{ name: 'codex', ready: false, reason: 'not signed in' }] }));
  assert.equal(off.fallbackReason, "Codex isn't signed in, so this starts on Claude.");
});

test('recommendedModel: the deep role model of the engine, or null', () => {
  assert.equal(recommendedModel('codex', { resolveRole: (e, r) => (r === 'deep' ? { model: `${e}-deep` } : null) }), 'codex-deep');
  assert.equal(recommendedModel('codex', { resolveRole: () => null }), null);
});

test('featureModel: NULL feature = today\'s pair; stored choice kept; D2: run.engine change does not move it', async () => {
  assert.deepEqual(await featureModel({ model: null }, deps('codex')), { ...claude, notice: null });
  const f = { model: { engine: 'codex', model: 'gpt-everyday', effort: null } };
  assert.deepEqual(await featureModel(f, deps('codex')), { engine: 'codex', model: 'gpt-everyday', effort: null, notice: null });
  assert.deepEqual(await featureModel(f, deps('claude')), { engine: 'codex', model: 'gpt-everyday', effort: null, notice: null });
});

test('featureModel: a removed model -> the engine default + notice; a removed effort -> null effort, no notice', async () => {
  const gone = await featureModel({ model: { engine: 'codex', model: 'gpt-gone', effort: null } }, deps('codex'));
  assert.equal(gone.engine, 'codex');
  assert.ok(['gpt-everyday', 'gpt-first'].includes(gone.model));
  assert.equal(gone.notice, 'gpt-gone is no longer available, so this step used the default.');
  const cl = await featureModel({ model: { engine: 'claude', model: 'claude-gone', effort: 'high' } }, deps('claude'));
  assert.deepEqual(cl, { ...claude, notice: 'claude-gone is no longer available, so this step used the default.' });
  const eff = await featureModel({ model: { engine: 'codex', model: 'gpt-first', effort: 'high' } }, deps('codex'));
  assert.deepEqual(eff, { engine: 'codex', model: 'gpt-first', effort: null, notice: null });
});

test('checkChoice: cursor, unknown model, wrong harness, bad effort refused; null effort ok', async () => {
  const d = deps('claude');
  assert.deepEqual(await checkChoice({ engine: 'cursor', model: 'x', effort: null }, d), { ok: false, error: "Cursor can't run Requirements." });
  assert.equal((await checkChoice({ engine: 'codex', model: 'nope', effort: null }, d)).ok, false);
  assert.equal((await checkChoice({ engine: 'codex', model: 'claude-opus-x', effort: null }, d)).ok, false);
  assert.equal((await checkChoice({ engine: 'codex', model: 'gpt-first', effort: 'max' }, d)).ok, false);
  assert.deepEqual(await checkChoice({ engine: 'codex', model: 'gpt-first', effort: null }, d), { ok: true, choice: { engine: 'codex', model: 'gpt-first', effort: null } });
  assert.deepEqual(await checkChoice({ engine: 'claude', model: 'claude-opus-x', effort: 'high' }, d), { ok: true, choice: { engine: 'claude', model: 'claude-opus-x', effort: 'high' } });
});

test('setFeatureModel: writes the model, a model turn with from, calls afterSwitch', async () => {
  const f = createFeature({ scopeType: 'project', scopeKey: 'k', title: 't', description: 'd' });
  const calls = [];
  const choice = { engine: 'codex', model: 'gpt-first', effort: null };
  const g = await setFeatureModel(f.seq, choice, { by: 'po' }, { ...deps('claude'), afterSwitch: (...a) => calls.push(a) });
  assert.deepEqual(g.model, choice);
  assert.deepEqual(getFeature(f.seq).model, choice);
  const t = listTurns(f.seq).at(-1);
  assert.equal(t.kind, 'model');
  assert.deepEqual(t.payload, { ...choice, from: claude });
  assert.deepEqual(calls, [[f.seq, 'codex']]);
});

test('setFeatureModel: refused while busy, archived or starting', async () => {
  const choice = { engine: 'codex', model: 'gpt-first', effort: null };
  const f = createFeature({ scopeType: 'project', scopeKey: 'k', title: 't', description: 'd' });
  let release;
  const gate = new Promise((res) => { release = res; });
  const jd = { runClaudeImpl: async () => { await gate; return { text: '{"spec":{},"questions":[],"done":true}' }; },
    listModels: async () => [], listProjects: async () => [], workspaceTarget: async () => null,
    openLook: async () => null, openWorkspaceLook: async () => null, onChange: () => {} };
  const p = startOrientation(f.seq, {}, jd);
  assert.equal(isBusy(f.seq), true);
  await assert.rejects(setFeatureModel(f.seq, choice, {}, deps('claude')), (e) => e.code === 'BUSY');
  release(); await p; await settled(f.seq);

  const a = createFeature({ scopeType: 'project', scopeKey: 'k', title: 'a', description: 'd' });
  updateFeature(a.seq, { status: 'archived' });
  await assert.rejects(setFeatureModel(a.seq, choice, {}, deps('claude')), (e) => e.code === 'CONFLICT');

  const s = createFeature({ scopeType: 'project', scopeKey: 'k', title: 's', description: 'd' });
  markStarting(s.seq);
  try { await assert.rejects(setFeatureModel(s.seq, choice, {}, deps('claude')), (e) => e.code === 'BUSY'); } finally { unmarkStarting(s.seq); }
  assert.equal(getFeature(s.seq).model, null);
});

test('featureModel: a stored model of an unavailable engine is kept, no notice (D13); available + gone = removed', async () => {
  const f = { model: { engine: 'codex', model: 'gpt-everyday', effort: null } };
  const a = ask();
  const off = deps('codex', { validate: async () => ({ ok: false, error: 'unknown model "gpt-everyday"' }), catalog: async () => { const c = await a.askCatalog({ withSecrets: false }); return { ...c, models: c.models.filter((m) => m.engine !== 'codex'), defaults: { ...c.defaults, codex: null } }; } });
  assert.deepEqual(await featureModel(f, off), { engine: 'codex', model: 'gpt-everyday', effort: null, notice: null });
});

test('defaultChoice: an engine that is not offered (not Cursor) reads the can-not-run sentence', async () => {
  const r = await defaultChoice({ projectKey: 'k' }, deps('opencode'));
  assert.deepEqual(r, { choice: claude, fallbackReason: "OpenCode can't run Requirements, so this starts on Claude." });
});
