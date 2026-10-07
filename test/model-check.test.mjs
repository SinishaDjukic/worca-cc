// test/model-check.test.mjs
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { addGlobalModel, updateProvider } from '../src/core/settings.mjs';
import {
  isAnthropicModelId, collectModelUses, checkModelLocal, checkRunModels, pendingNodeIds,
  clearModelProbeCache, modelUnavailableError,
} from '../src/core/model-check.mjs';
import { withEnv } from './helpers/with-env.mjs';
import { checkRows } from './helpers/rows.mjs';

const saved = {};
before(async () => {
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK', 'ORCH_MOCK']) saved[k] = process.env[k];
  delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK;
  const home = mkdtempSync(join(tmpdir(), 'mcheck-home-'));
  process.env.HOME = home; process.env.USERPROFILE = home;
  process.env.WORCA_HOME = mkdtempSync(join(tmpdir(), 'mcheck-wh-'));
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1'; // catalog guard: HOME is sandboxed above
  _resetForTests();
  await addGlobalModel({ id: 'cp-gpt', label: 'Copilot GPT', efforts: ['medium'], upstream: { provider: 'copilot', api: 'openai-chat', model: 'gpt-4.1' } });
  await addGlobalModel({ id: 'oa-gpt', label: 'OpenAI GPT', efforts: ['medium'], upstream: { provider: 'openai', api: 'openai-chat', model: 'gpt-5', baseUrl: 'https://api.openai.com/v1' } });
  await addGlobalModel({ id: 'gw-env', label: 'Gateway', efforts: ['medium'], env: { ANTHROPIC_BASE_URL: '${MCHECK_GW_URL}', ANTHROPIC_AUTH_TOKEN: '${MCHECK_GW_TOKEN}' } });
});
after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } _resetForTests(); });
beforeEach(() => clearModelProbeCache());

const signedIn = async () => ({ state: 'signed-in', source: 'cli', detail: null });
const signedOut = async () => ({ state: 'signed-out', source: 'cli', detail: null });
const manifestOf = (...nodes) => ({ version: 2, graph: { nodes: nodes.map(([id, model, label]) => ({ id, kind: 'agent', key: id, label: label || id, model: model ?? '' })), wires: [] } });

test('isAnthropicModelId: raw Claude ids and CLI aliases pass, foreign ids do not', () => {
  for (const id of ['claude-opus-5-5', 'claude-opus-4-8[1m]', 'claude-sonnet-5-20260101', 'us.anthropic.claude-sonnet-4-20250514-v1:0', 'claude-opus-4@20250514', 'sonnet', 'Opus']) assert.equal(isAnthropicModelId(id), true, id);
  for (const id of ['gpt-5', 'claude', 'my-claude-model', 'openrouter/anthropic/claude-3', '', null]) assert.equal(isAnthropicModelId(id), false, String(id));
});

test('collectModelUses: node models fall back to the run model; the CLI default is null', () => {
  const m = manifestOf(['n_plan', 'oa-gpt', 'Plan'], ['n_impl', '', 'Implement'], ['n_rev', '', 'Review']);
  assert.deepEqual(collectModelUses(m, { runModel: 'claude-sonnet-5' }), [
    { model: 'oa-gpt', nodes: ['Plan'] }, { model: 'claude-sonnet-5', nodes: ['Implement', 'Review'] },
  ]);
  assert.deepEqual(collectModelUses(m, {}).map((u) => u.model), ['oa-gpt', null]);
  assert.deepEqual(collectModelUses(m, { onlyNodes: ['n_rev'] }), [{ model: null, nodes: ['Review'] }]);
  // Auto before the decision: an empty graph checks only the run model it will fall back to.
  assert.deepEqual(collectModelUses(manifestOf(), { runModel: 'oa-gpt', includeRunModel: true }), [{ model: 'oa-gpt', nodes: ['the run model'] }]);
  assert.deepEqual(collectModelUses(manifestOf(), { includeRunModel: true }), []);
});

test('checkModelLocal: bridged readiness, env ${VAR}s, unknown ids', async () => {
  await checkRows([
    { name: 'copilot terms not acknowledged', run: () => {
      const v = checkModelLocal('cp-gpt');
      assert.equal(v.ok, false); assert.equal(v.reason, 'terms'); assert.match(v.fix, /Copilot notice in Settings › Providers/);
    } },
    { name: 'copilot signed out (terms ok)', run: async () => {
      await updateProvider('copilot', { acknowledgedTerms: new Date().toISOString(), termsVersion: 99 });
      const v = checkModelLocal('cp-gpt');
      assert.equal(v.reason, 'not_signed_in'); assert.match(v.fix, /sign in to Copilot in Settings › Providers/);
    } },
    { name: 'openai: no key', run: () => {
      const v = checkModelLocal('oa-gpt');
      assert.equal(v.reason, 'no_key'); assert.match(v.fix, /add an API key for openai in Settings › Providers/);
    } },
    { name: 'openai: key is an unset ${VAR}', run: async () => {
      await updateProvider('openai', { apiKey: '${MCHECK_OPENAI_KEY}' });
      const v = checkModelLocal('oa-gpt');
      assert.equal(v.reason, 'no_key'); assert.match(v.fix, /set MCHECK_OPENAI_KEY/);
    } },
    { name: 'env endpoint with unset ${VAR}s', run: () => {
      const v = checkModelLocal('gw-env');
      assert.equal(v.connection, 'env'); assert.equal(v.reason, 'env_unset');
      assert.match(v.fix, /set MCHECK_GW_URL, MCHECK_GW_TOKEN/);
    } },
    { name: 'env endpoint with its ${VAR}s set', run: () => withEnv({ MCHECK_GW_URL: 'http://127.0.0.1:9', MCHECK_GW_TOKEN: 't' }, () => {
      assert.deepEqual(checkModelLocal('gw-env'), { ok: true, connection: 'env' });
    }) },
    { name: 'unknown foreign id blocks', run: () => {
      const v = checkModelLocal('gpt-9-turbo');
      assert.equal(v.ok, false); assert.equal(v.reason, 'unknown_model'); assert.match(v.fix, /Settings › Models/);
    } },
    { name: 'raw claude id off the catalog passes on the default connection', run: () => {
      assert.deepEqual(checkModelLocal('claude-opus-9-9'), { ok: true, connection: 'default' });
    } },
  ]);
});

test('checkRunModels: the CLI sign-in gates only default-connection models', async () => {
  const m = manifestOf(['n_plan', 'claude-sonnet-5', 'Plan'], ['n_impl', '', 'Implement']);
  const out = await checkRunModels(m, { live: false, claudeAuth: signedOut });
  assert.equal(out.ok, false);
  assert.deepEqual(out.problems.map((p) => [p.model, p.reason, p.nodes]), [['claude-sonnet-5', 'signed_out', ['Plan']], [null, 'signed_out', ['Implement']]]);
  assert.equal((await checkRunModels(m, { live: false, claudeAuth: signedIn })).ok, true);
  // 'unknown' (an old CLI, a hang) never blocks
  assert.equal((await checkRunModels(m, { live: false, claudeAuth: async () => ({ state: 'unknown' }) })).ok, true);
});

test('checkRunModels: the live probe blocks on auth/unreachable, warns on status/timeout, and is cached', async () => {
  await updateProvider('openai', { apiKey: 'sk-test' });
  const m = manifestOf(['n_plan', 'oa-gpt', 'Plan']);
  let calls = 0;
  const probeWith = (r) => async () => { calls += 1; return r; };
  await checkRows([
    { name: 'auth → problem', run: async () => {
      clearModelProbeCache();
      const out = await checkRunModels(m, { claudeAuth: signedIn, probe: probeWith({ ok: false, kind: 'auth', message: 'authentication failed (401)' }) });
      assert.equal(out.ok, false); assert.equal(out.problems[0].reason, 'probe_auth'); assert.match(out.problems[0].fix, /rejected/);
    } },
    { name: 'unreachable → problem', run: async () => {
      clearModelProbeCache();
      const out = await checkRunModels(m, { claudeAuth: signedIn, probe: probeWith({ ok: false, kind: 'unreachable', message: 'endpoint unreachable — fetch failed' }) });
      assert.equal(out.problems[0].reason, 'probe_unreachable'); assert.match(out.problems[0].fix, /endpoint unreachable|start it|base URL/);
    } },
    { name: 'status → warning only', run: async () => {
      clearModelProbeCache();
      const out = await checkRunModels(m, { claudeAuth: signedIn, probe: probeWith({ ok: false, kind: 'status', message: 'endpoint answered 404' }) });
      assert.equal(out.ok, true); assert.equal(out.warnings.length, 1);
    } },
    { name: 'a hung probe is time-boxed into a warning', run: async () => {
      clearModelProbeCache();
      const out = await checkRunModels(m, { claudeAuth: signedIn, timeoutMs: 20, probe: () => new Promise(() => {}) });
      assert.equal(out.ok, true); assert.match(out.warnings[0].message, /no answer within/);
    } },
    { name: 'success is cached per provider/baseUrl/key', run: async () => {
      clearModelProbeCache(); calls = 0;
      const ok = probeWith({ ok: true });
      await checkRunModels(m, { claudeAuth: signedIn, probe: ok });
      await checkRunModels(m, { claudeAuth: signedIn, probe: ok });
      assert.equal(calls, 1);
    } },
    { name: 'live:false never probes', run: async () => {
      calls = 0; clearModelProbeCache();
      await checkRunModels(m, { live: false, claudeAuth: signedIn, probe: probeWith({ ok: false, kind: 'auth', message: 'x' }) });
      assert.equal(calls, 0);
    } },
  ]);
});

test('modelUnavailableError names node, model, reason and fix, and is classed for the failure policy', () => {
  const err = modelUnavailableError({ problems: [{ model: 'oa-gpt', provider: 'openai', nodes: ['Plan', 'Implement'], reason: 'no_key', message: 'provider openai: no API key — open Settings › Providers', fix: 'add an API key for openai in Settings › Providers' }] });
  assert.match(err.message, /^Preflight failed: a model this run uses is not available/);
  assert.match(err.message, /"oa-gpt" \(openai\) — used by Plan, Implement: provider openai: no API key/);
  assert.match(err.message, /Fix: add an API key for openai in Settings › Providers\./);
  assert.equal(err.errorClass, 'model_unavailable');
  assert.equal(err.code, 'model-unavailable');
  assert.match(modelUnavailableError({ problems: err.problems }, { when: 'resume' }).message, /^A model this run uses is not available[\s\S]*Fix it, then resume\.$/);
});

test('pendingNodeIds: finished nodes drop out unless a pending node can re-trigger them', () => {
  const manifest = {
    graph: {
      nodes: [{ id: 'n_task', kind: 'task' }, { id: 'n_clarify', kind: 'agent' }, { id: 'n_plan', kind: 'agent' }, { id: 'n_impl', kind: 'agent' }, { id: 'n_review', kind: 'agent' }],
      wires: [
        { from: { node: 'n_task' }, to: { node: 'n_clarify' } }, { from: { node: 'n_clarify' }, to: { node: 'n_plan' } },
        { from: { node: 'n_plan' }, to: { node: 'n_impl' } }, { from: { node: 'n_impl' }, to: { node: 'n_review' } },
        { from: { node: 'n_review' }, to: { node: 'n_impl' } },   // the fix loop
      ],
    },
  };
  // graph/scheduler.mjs exec statuses: 'start' | 'done' | 'error' | 'skipped' | 'paused'
  const snapshot = { execs: [{ nodeId: 'n_clarify', status: 'done' }, { nodeId: 'n_plan', status: 'done' }, { nodeId: 'n_impl', status: 'done' }, { nodeId: 'n_review', status: 'start' }] };
  assert.deepEqual(pendingNodeIds(manifest, snapshot).sort(), ['n_impl', 'n_review']);   // the loop can re-run Implement
  // an errored / paused execution is not finished: it re-runs on resume
  const errored = { execs: [{ nodeId: 'n_clarify', status: 'done' }, { nodeId: 'n_plan', status: 'error' }] };
  assert.deepEqual(pendingNodeIds(manifest, errored).sort(), ['n_impl', 'n_plan', 'n_review']);
  // one finished and one open execution of the same node: open wins
  const reran = { execs: [{ nodeId: 'n_clarify', status: 'done' }, { nodeId: 'n_clarify', status: 'paused' }, { nodeId: 'n_plan', status: 'done' }, { nodeId: 'n_impl', status: 'done' }, { nodeId: 'n_review', status: 'done' }] };
  assert.deepEqual(pendingNodeIds(manifest, reran).sort(), ['n_clarify', 'n_impl', 'n_plan', 'n_review']);
  // a pre-dispatch / decision point has no snapshot (orchestrator _buildResumePoint): every node
  assert.equal(pendingNodeIds(manifest, null), null);
});
