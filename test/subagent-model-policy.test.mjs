// test/subagent-model-policy.test.mjs
// The per-node sub-agent model policy: what a fan-out node's Task/Agent children
// run on. ONE wire — the prompt block (subagentModelDirective) — because the CLI
// resolves a child's model as Task-call `model` > agent frontmatter `model:` >
// env default > parent, so only an explicit Task-level `model` reliably binds
// every child. The directive therefore instructs passing `model` on EVERY call.
//   'auto'    (THE DEFAULT for an unset node) — the agent chooses per spawn via
//             a who-checks-the-output rubric;
//   a pin     ('sonnet'|'opus'|'fable') — pass exactly that value on every call;
//   'inherit' — no block at all: children ride the CLI's own resolution
//               (frontmatter, else the parent's model) — the pre-feature prompt.
// Plus the persistence layers the setting travels through (step config, node
// override, workflow defaults, resolved node, run manifest) and the recorded
// per-child model that makes the whole thing verifiable after a run.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  SUBAGENT_MODELS, SUBAGENT_MODEL_VALUES, SUBAGENT_AUTO, SUBAGENT_INHERIT, SUBAGENT_DEFAULT,
  isSubagentModelValue, effectiveSubagentModel, subagentModelIssue,
  isReservedModelEnvKey, prepareModelEnv,
} from '../src/core/model-env.mjs';
import {
  ctxSubagentModel, subagentModelDirective, fanOutDirective,
  _runOptsForTests as runOpts,
} from '../src/core/phases.mjs';
import { setStep, setNodeModel, readConfig, readRunConfig } from '../src/core/config.mjs';
import { sanitizeNodeDefaults, resolveGraph, writeGraphWorkflow } from '../src/core/workflows.mjs';
import { upsertSubAgent, listSubAgents } from '../src/core/artifacts.mjs';
import { _resetForTests } from '../src/core/db.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';

const dirs = [];
const prevEnv = {
  HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME,
  WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK,
};
let proj;
beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-samp-home-'));
  const whome = await mkdtemp(join(tmpdir(), 'worca-cc-samp-whome-'));
  proj = await mkdtemp(join(tmpdir(), 'worca-cc-samp-proj-'));
  dirs.push(home, whome, proj);
  _resetForTests();
  process.env.HOME = home; process.env.USERPROFILE = home;
  process.env.WORCA_HOME = whome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
after(async () => {
  _resetForTests();
  for (const k of Object.keys(prevEnv)) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

// ── the vocabulary ───────────────────────────────────────────────────────────

test('the vocabulary is the CLI alias enum minus haiku, plus "agent picks" and an explicit inherit', () => {
  assert.deepEqual(SUBAGENT_MODELS, ['sonnet', 'opus', 'fable']);
  assert.deepEqual(SUBAGENT_MODEL_VALUES, ['sonnet', 'opus', 'fable', 'auto', 'inherit']);
  for (const v of SUBAGENT_MODEL_VALUES) assert.ok(isSubagentModelValue(v), `${v} is storable`);
  for (const v of ['haiku', 'claude-opus-5', '', null, undefined, 'AUTO']) {
    assert.equal(isSubagentModelValue(v), false, `${String(v)} is not storable`);
  }
});

test('an unset (or off-vocabulary) value resolves to auto — agents choose BY DEFAULT', () => {
  assert.equal(SUBAGENT_DEFAULT, SUBAGENT_AUTO);
  for (const v of ['', undefined, null, 'haiku']) {
    assert.equal(effectiveSubagentModel(v), SUBAGENT_AUTO, `${String(v)} -> auto`);
  }
  for (const v of SUBAGENT_MODEL_VALUES) assert.equal(effectiveSubagentModel(v), v, `${v} -> itself`);
});

test('subagentModelIssue: one message for every writer; silence for empty/valid', () => {
  for (const v of ['', null, undefined, ...SUBAGENT_MODEL_VALUES]) {
    assert.equal(subagentModelIssue(v), '', `${String(v)} is acceptable`);
  }
  assert.equal(subagentModelIssue('haiku'), 'unknown sub-agent model "haiku"');
  assert.match(subagentModelIssue('claude-opus-5'), /unknown sub-agent model/);
});

test('CLAUDE_CODE_SUBAGENT_MODEL is a reserved model-env key: a catalog entry cannot smuggle a floor', () => {
  assert.equal(isReservedModelEnvKey('CLAUDE_CODE_SUBAGENT_MODEL'), true);
  const { env, dropped } = prepareModelEnv({ CLAUDE_CODE_SUBAGENT_MODEL: 'haiku', A: '1' });
  assert.deepEqual(env, { A: '1' });
  assert.deepEqual(dropped, ['CLAUDE_CODE_SUBAGENT_MODEL'],
    'the per-node prompt policy is the only sanctioned wire — an env floor from the catalog is dropped');
});

// ── resolution into the run ──────────────────────────────────────────────────

test('ctxSubagentModel: node value wins, unset defaults to auto, no fan-out means inherit', () => {
  assert.equal(ctxSubagentModel({ node: { fanOut: true, subagentModel: 'opus' } }), 'opus');
  assert.equal(ctxSubagentModel({ node: { fanOut: true, subagentModel: SUBAGENT_INHERIT } }), SUBAGENT_INHERIT);
  assert.equal(ctxSubagentModel({ node: { fanOut: true } }), SUBAGENT_AUTO, 'unset -> the agent picks');
  assert.equal(ctxSubagentModel({ node: { fanOut: true, subagentModel: 'haiku' } }), SUBAGENT_AUTO,
    'an off-vocabulary survivor falls to the default, never to the argv');
  assert.equal(ctxSubagentModel({ node: { fanOut: false, subagentModel: 'opus' } }), SUBAGENT_INHERIT,
    'a node that cannot spawn children has nothing to place');
  assert.equal(ctxSubagentModel(null), SUBAGENT_INHERIT);
  assert.equal(ctxSubagentModel({ fanOut: true, subagentModel: 'fable' }), SUBAGENT_AUTO,
    'no ctx-level field: only a NODE carries the setting (the v1 clarify pre-step is gone)');
});

test('the policy never touches the spawn env: runOpts modelEnv is exactly the catalog env', () => {
  const call = { role: 'implementer', prompt: 'p', systemPrompt: 's', allowedTools: ['Read'] };
  const base = { projectDir: proj, claudeOpts: {} };
  for (const node of [
    { fanOut: true, subagentModel: SUBAGENT_AUTO },
    { fanOut: true, subagentModel: 'opus' },
    { fanOut: true },
    { fanOut: false, subagentModel: 'opus' },
  ]) {
    const opts = runOpts({ ...base, node }, call);
    assert.equal(opts.modelEnv, undefined, `${JSON.stringify(node)} -> no policy env`);
    assert.doesNotMatch(JSON.stringify(opts), /CLAUDE_CODE_SUBAGENT_MODEL/);
  }
});

// ── the prompt wire ──────────────────────────────────────────────────────────

test('the auto directive demands an explicit model on EVERY call and rubrics on who checks', () => {
  const text = subagentModelDirective(SUBAGENT_AUTO);
  assert.match(text, /pass `model` on EVERY Task\/Agent call/);
  assert.match(text, /operator has asked you to choose/, 'attributes the request, as the Task schema requires');
  assert.match(text, /agent definition may pin its own default/,
    'says WHY omitting is unreliable (frontmatter outranks an omitted param)');
  for (const m of SUBAGENT_MODELS) assert.match(text, new RegExp('`' + m + '`'), `offers ${m}`);
  assert.doesNotMatch(text, /haiku/, 'haiku is not on the menu');
  assert.match(text, /WHO CHECKS THE OUTPUT/, 'the rubric keys on verifiability, not apparent difficulty');
  assert.doesNotMatch(text, /lands in the diff|write the code|apply a known edit/,
    'the tiers describe READ-ONLY investigation — the enclosing fan-out block forbids writing children');
});

test('a pinned directive demands passing exactly that model on every call', () => {
  const text = subagentModelDirective('opus');
  assert.match(text, /pass `model: "opus"` on EVERY Task\/Agent call/);
  assert.match(text, /agent definition may pin its own default/,
    'explains why omitting the param would NOT land on the pin');
  assert.doesNotMatch(text, /YOUR call/, 'a pinned node offers no choice');
});

test('inherit (and any unknown value) contributes no prompt text at all', () => {
  assert.equal(subagentModelDirective(SUBAGENT_INHERIT), '');
  assert.equal(subagentModelDirective(''), '');
  assert.equal(subagentModelDirective('haiku'), '');
  assert.equal(subagentModelDirective(undefined), '');
});

test('fanOutDirective: inherit keeps the pre-feature bytes; auto/pin append after the read-only tail', () => {
  const plain = fanOutDirective(true);
  assert.doesNotMatch(plain, /Sub-agent model/);
  assert.equal(fanOutDirective(true, { subagentModel: SUBAGENT_INHERIT }), plain,
    'inherit is byte-identical to the pre-feature prompt');
  assert.equal(fanOutDirective(false, { subagentModel: 'opus' }), '', 'no fan-out, no block');

  for (const v of [SUBAGENT_AUTO, 'fable']) {
    const withPolicy = fanOutDirective(true, { subagentModel: v });
    assert.ok(withPolicy.startsWith(plain), `${v}: the policy block is appended, never spliced in`);
    assert.match(withPolicy, /Sub-agent model/);
  }
});

// ── persistence: per-role step config ────────────────────────────────────────

test('setStep persists a sub-agent model and clears it on an explicit empty value', async () => {
  await setStep(proj, 'planner', { subagentModel: 'opus' });
  assert.equal((await readConfig(proj)).steps.planner.subagentModel, 'opus');

  await setStep(proj, 'planner', { subagentModel: '' });
  assert.equal((await readConfig(proj)).steps.planner, undefined, 'cleared back to the auto default');
});

test('inherit is a STORED value, distinct from the cleared default', async () => {
  await setStep(proj, 'planner', { subagentModel: SUBAGENT_INHERIT });
  assert.equal((await readConfig(proj)).steps.planner.subagentModel, SUBAGENT_INHERIT,
    'the operator can pin children to the node model even though the default is auto');
});

test('a write that omits subagentModel preserves it (an older client must not wipe the policy)', async () => {
  await setStep(proj, 'planner', { subagentModel: 'fable' });
  await setStep(proj, 'planner', { fanOut: true });
  const step = (await readConfig(proj)).steps.planner;
  assert.equal(step.subagentModel, 'fable');
  assert.equal(step.fanOut, true);
});

test('setStep rejects a model outside the alias enum', async () => {
  await assert.rejects(() => setStep(proj, 'planner', { subagentModel: 'haiku' }),
    /unknown sub-agent model "haiku"/);
  await assert.rejects(() => setStep(proj, 'planner', { subagentModel: 'claude-opus-5' }),
    /unknown sub-agent model/);
});

// ── persistence: per-node run config ─────────────────────────────────────────

test('setNodeModel round-trips the setting through the normalized node row', async () => {
  await setNodeModel(proj, 'wf_x', 'n_impl', { subagentModel: 'sonnet' });
  const cfg = await readRunConfig(proj);
  assert.equal(cfg.workflows.wf_x.nodes.n_impl.subagentModel, 'sonnet');

  // A later model-only write must not wipe it (same preserve rule as the toggles).
  await setNodeModel(proj, 'wf_x', 'n_impl', { model: '' });
  assert.equal((await readRunConfig(proj)).workflows.wf_x.nodes.n_impl.subagentModel, 'sonnet');

  await setNodeModel(proj, 'wf_x', 'n_impl', { subagentModel: '' });
  assert.equal((await readRunConfig(proj)).workflows.wf_x, undefined, 'the row is gone once nothing is set');
});

test('setNodeModel rejects a model outside the alias enum', async () => {
  await assert.rejects(() => setNodeModel(proj, 'wf_x', 'n_impl', { subagentModel: 'haiku' }),
    /unknown sub-agent model "haiku"/);
});

// ── persistence: workflow-template defaults ──────────────────────────────────

test('sanitizeNodeDefaults keeps every legal value and drops an illegal one', () => {
  assert.deepEqual(sanitizeNodeDefaults({ subagentModel: 'fable' }), { subagentModel: 'fable' });
  assert.deepEqual(sanitizeNodeDefaults({ subagentModel: SUBAGENT_AUTO }), { subagentModel: SUBAGENT_AUTO });
  assert.deepEqual(sanitizeNodeDefaults({ subagentModel: SUBAGENT_INHERIT }), { subagentModel: SUBAGENT_INHERIT });
  assert.equal(sanitizeNodeDefaults({ subagentModel: 'haiku' }), undefined, 'dropped, never stored');
  assert.equal(sanitizeNodeDefaults({ subagentModel: '' }), undefined);
});

// ── resolution: which layer a node's policy comes from ──────────────────────

const REGISTRY = {
  planner: {
    key: 'planner', runnerType: 'producer', agentFile: 'worca-cc-planner.md',
    metaVersion: 2, fanOut: true,
    inputs: [{ id: 'task', type: 'md' }],
    outputs: [{ id: 'plan', type: 'md', filename: '{base}.md' }],
  },
};
const GRAPH = (config) => ({
  id: 'wf_sam', name: 'SAM',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 240, y: 0, config },
    { id: 'n_end', kind: 'end', x: 480, y: 0, config: {} },
  ],
  wires: [],
});

test('resolveGraph layers the policy: per-project node override > template default > unset', async () => {
  await writeGraphWorkflow(GRAPH({}));
  const bare = await resolveGraph(proj, 'wf_sam', REGISTRY);
  assert.equal(bare.nodes.n_plan.subagentModel, '',
    'nothing configured anywhere -> unset; the RUNTIME resolves that to auto (ctxSubagentModel)');

  await writeGraphWorkflow(GRAPH({ subagentModel: 'sonnet' }));
  const templated = await resolveGraph(proj, 'wf_sam', REGISTRY);
  assert.equal(templated.nodes.n_plan.subagentModel, 'sonnet', 'the template default applies');

  await setNodeModel(proj, 'wf_sam', 'n_plan', { subagentModel: SUBAGENT_INHERIT });
  const overridden = await resolveGraph(proj, 'wf_sam', REGISTRY);
  assert.equal(overridden.nodes.n_plan.subagentModel, SUBAGENT_INHERIT, 'the project override wins');
});

test('an off-vocabulary TEMPLATE value is dropped at resolve time, not resolved verbatim', async () => {
  // validateGraph whitelists the key but never inspects the value (a plugin
  // template import comes through exactly this path), so the resolver is the
  // last line of defense before the manifest freezes the run.
  await writeGraphWorkflow(GRAPH({ subagentModel: 'haiku' }));
  const resolved = await resolveGraph(proj, 'wf_sam', REGISTRY);
  assert.equal(resolved.nodes.n_plan.subagentModel, '',
    'haiku never reaches the manifest — the node rides the default instead');
});

// ── the audit trail: what each child actually ran on ─────────────────────────

test('a spawned child records the model it ran on, and later updates never null it', async () => {
  const { id: pid } = await seedPipeline(proj, { title: 'Run', status: 'running' });

  upsertSubAgent(pid, {
    id: 'toolu_a', label: 'research auth', status: 'running',
    startedAt: '2026-08-30T00:00:01Z', runModel: 'sonnet',
  });
  upsertSubAgent(pid, { id: 'toolu_a', status: 'done', finishedAt: '2026-08-30T00:00:09Z' });

  const [row] = listSubAgents(pid);
  assert.equal(row.status, 'done');
  assert.equal(row.runModel, 'sonnet', 'the finish update is COALESCE-guarded');
});

test('a child with no recorded model reads back as null (pre-v25 rows paint no pill)', async () => {
  const { id: pid } = await seedPipeline(proj, { title: 'Run', status: 'running' });
  upsertSubAgent(pid, { id: 'toolu_b', status: 'running', startedAt: '2026-08-30T00:00:01Z' });
  assert.equal(listSubAgents(pid)[0].runModel, null);
});
