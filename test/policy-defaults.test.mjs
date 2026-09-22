// test/policy-defaults.test.mjs
// Default-kind team-policy fields applied where Worca already reads its settings (team-policy
// design §6, §8), from the discovery cache: default workflow, human in the loop, step models,
// hide built-ins, Ask Worca limits, and the guardrail-set / model catalogs (gp:<id>, policy rows).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { projectKey } from '../src/core/store.mjs';
import { writeTeamPolicyPrefs, readRunConfig, setHumanInLoop, setActiveWorkflow, resolveStepModels, setStep, listModels, resolveModelEnv, catalogHasModel } from '../src/core/config.mjs';
import { setHideBuiltinModels, setAskMaxTurns } from '../src/core/settings.mjs';
import { readGuardrailSet, listPolicyGuardrailSets, isPolicyGuardrailSetId } from '../src/core/guardrail-store.mjs';
import { askLimits } from '../src/core/ask/limits.mjs';
import { cachedPolicyFor, cachedPolicyHomes, teamDefault } from '../src/core/policy/cache.mjs';

useTempHome(after);
let sandboxHome; const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-policy-defaults-'));
  for (const k of ['HOME', 'USERPROFILE']) { prevEnv[k] = process.env[k]; process.env[k] = sandboxHome; }
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
});

const home = mkdtempSync(join(tmpdir(), 'worca-policy-home-'));
const follower = mkdtempSync(join(tmpdir(), 'worca-policy-follower-'));
const bare = mkdtempSync(join(tmpdir(), 'worca-policy-none-'));

const DOC = {
  schema: 1, fields: {
    'workflows.default': { kind: 'default', value: 'wf_default' },
    'run.humanInLoop': { kind: 'default', value: false },
    'models.steps': { kind: 'default', value: { planner: { model: 'claude-opus-5-5', effort: 'high' }, implementer: { model: 'acme-proxy-opus' } } },
    'models.hideBuiltins': { kind: 'default', value: true },
    'ask.maxTurns': { kind: 'default', value: 12 },
    'ask.maxBudgetUsd': { kind: 'default', value: 0.5 },
    'cost.pipelineLimitUsd': { kind: 'soft', value: 10 },
  },
  workspaceRuns: {},
  catalogs: {
    guardrailSets: [{ id: 'gateway-normal', name: 'Gateway normal', protectedPaths: ['.env*'], deny: ['Bash(git push)'] }],
    models: [{ id: 'acme-proxy-opus', label: 'Opus via Acme gateway', efforts: ['medium', 'high'], env: { ANTHROPIC_BASE_URL: 'https://llm.acme.internal', ANTHROPIC_AUTH_TOKEN: '${ACME_LLM_TOKEN}' } }],
  },
};

before(() => {
  writeTeamPolicyPrefs(projectKey(home), { present: true, docKnown: true, slug: 'acme/gateway', headSha: 'abc1234', delegateTo: null, doc: DOC });
  writeTeamPolicyPrefs(projectKey(follower), { present: true, docKnown: true, slug: 'acme/billing', delegateTo: 'acme/gateway', doc: { schema: 1, delegateTo: 'acme/gateway' } });
});

test('the cache resolves a home and a follower; a project without a branch has nothing', () => {
  assert.equal(cachedPolicyFor(home).home, 'acme/gateway');
  assert.equal(cachedPolicyFor(follower).home, 'acme/gateway', 'a marker resolves to the cached home');
  assert.equal(cachedPolicyFor(bare), null);
  assert.deepEqual(cachedPolicyHomes().map((h) => h.slug), ['acme/gateway']);
  assert.equal(teamDefault(home, 'workflows.default'), 'wf_default');
  assert.equal(teamDefault(home, 'cost.pipelineLimitUsd'), undefined, 'a soft entry is not a default');
});

test('default workflow and human in the loop start the project off, until it sets its own', async () => {
  let cfg = await readRunConfig(follower);
  assert.equal(cfg.activeWorkflowId, 'wf_default'); assert.equal(cfg.activeWorkflowSource, 'team-policy');
  assert.equal(cfg.humanInLoop, false);
  assert.equal(cfg.humanInLoopSet, undefined, 'bookkeeping never leaks into run config');
  await setActiveWorkflow(follower, 'wf_auto');
  await setHumanInLoop(follower, true);
  cfg = await readRunConfig(follower);
  assert.equal(cfg.activeWorkflowId, 'wf_auto'); assert.equal(cfg.activeWorkflowSource, undefined);
  assert.equal(cfg.humanInLoop, undefined, 'the project switched it back on itself');
  const none = await readRunConfig(bare);
  assert.equal(none.activeWorkflowId, 'wf_auto'); assert.equal(none.humanInLoop, undefined);
});

test('step defaults fill roles the project has not configured', async () => {
  let m = await resolveStepModels(home, undefined);
  assert.deepEqual(m.planner, { model: 'claude-opus-5-5', effort: 'high' });
  assert.equal(m.implementer.model, 'acme-proxy-opus');
  await setStep(home, 'planner', { model: 'claude-sonnet-5', effort: 'medium' });
  m = await resolveStepModels(home, undefined);
  assert.deepEqual(m.planner, { model: 'claude-sonnet-5', effort: 'medium' }, 'the project\'s own choice wins');
  const none = await resolveStepModels(bare, 'claude-haiku-4-5');
  assert.equal(none.planner.model, 'claude-haiku-4-5');
});

test('model catalog: a policy row with its routing env; hide built-ins is a default', async () => {
  const cat = await listModels(home);
  const pol = cat.find((x) => x.id === 'acme-proxy-opus');
  assert.equal(pol.custom, 'policy'); assert.equal(pol.policy, 'acme/gateway'); assert.equal(pol.routed, true);
  assert.ok(cat.filter((x) => !x.custom).every((x) => x.hidden === true), 'team default hides the built-ins');
  assert.ok((await listModels(bare)).filter((x) => !x.custom).every((x) => !x.hidden), 'not for an ungoverned project');
  await setHideBuiltinModels(false);
  assert.ok((await listModels(home)).filter((x) => !x.custom).every((x) => !x.hidden), 'the developer\'s stored choice wins');
  assert.ok(catalogHasModel('ACME-proxy-opus'));
  process.env.ACME_LLM_TOKEN = 'tok';
  const env = resolveModelEnv('acme-proxy-opus');
  assert.equal(env.ANTHROPIC_BASE_URL, 'https://llm.acme.internal');
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'tok', '${VAR} indirection resolves from the process env');
  delete process.env.ACME_LLM_TOKEN;
});

test('guardrail catalog: gp:<id> reads as a virtual, sanitised set with a policy origin', async () => {
  assert.equal(isPolicyGuardrailSetId('gp:gateway-normal'), true);
  assert.equal(isPolicyGuardrailSetId('gr_x'), false);
  const s = await readGuardrailSet('gp:gateway-normal');
  assert.equal(s.name, 'Gateway normal'); assert.equal(s.origin, 'policy:acme/gateway');
  assert.deepEqual(s.settings.protectedPaths, ['.env*']);
  assert.equal(await readGuardrailSet('gp:nope'), null, 'a vanished set reads as missing (the fail-open path)');
  assert.deepEqual(listPolicyGuardrailSets().map((x) => x.id), ['gp:gateway-normal']);
});

test('Ask Worca limits: team defaults for a pinned governed project, never over a stored value', async () => {
  assert.deepEqual(askLimits({ projectKey: projectKey(home) }), { maxTurns: 12, maxBudgetUsd: 0.5 });
  const plain = askLimits();
  assert.equal(plain.maxTurns, 40);
  await setAskMaxTurns(30);
  assert.equal(askLimits({ projectKey: projectKey(home) }).maxTurns, 30);
  assert.equal(askLimits({ projectKey: projectKey(bare) }).maxTurns, 30);
});
