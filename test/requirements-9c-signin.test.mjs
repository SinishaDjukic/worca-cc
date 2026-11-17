// test/requirements-9c-signin.test.mjs — 9c fix B4: Claude counts as ready for Requirements when it is signed in, when the user's
// Claude settings sign it in, or when some of its models sign in by themselves (a company model profile: Vertex, a token, an
// endpoint); only those models are offered then, and the D4 line never says "this starts on Claude" when Claude can't run.
// A sandboxed HOME holds the settings (as plugin-models.test.mjs); readiness is injected, nothing is spawned.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { JSDOM } from 'jsdom';
import { _resetForTests } from '../src/core/db.mjs';
import { listModels } from '../src/core/config.mjs';
import { createAskModels } from '../src/core/ask/models.mjs';
import { claudeModelRunsSignedOut } from '../src/core/claude-auth.mjs';
import { defaultChoice, briefDefault } from '../src/core/requirements/model-choice.mjs';
import { registerRequirementsRoutes } from '../src/core/requirements/routes.mjs';

const prev = Object.fromEntries(['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_FLAGS', 'WORCA_MOCK', 'ORCH_MOCK']
  .map((k) => [k, process.env[k]]));
const home = mkdtempSync(join(tmpdir(), 'req-9c-signin-home-'));
const worcaHome = mkdtempSync(join(tmpdir(), 'req-9c-signin-whome-'));
const VERTEX = { CLAUDE_CODE_USE_VERTEX: '1', ANTHROPIC_VERTEX_BASE_URL: 'https://vertex.example', ANTHROPIC_AUTH_TOKEN: 'not-a-secret',
  CLOUD_ML_REGION: 'europe-west1', ANTHROPIC_VERTEX_PROJECT_ID: 'p', CLAUDE_CODE_SKIP_VERTEX_AUTH: '1' };
const settings = (models) => {
  mkdirSync(join(home, '.worca-cc'), { recursive: true });
  writeFileSync(join(home, '.worca-cc', 'settings.json'), JSON.stringify({ models }));
};
const COMPANY = [
  { id: 'claude-opus-5-5', env: VERTEX },
  { id: 'corp-endpoint', label: 'Corp endpoint', env: { ANTHROPIC_BASE_URL: 'https://llm.example', ANTHROPIC_AUTH_TOKEN: 'x' } },
  { id: 'corp-knob', label: 'Corp knob', env: { CLAUDE_CODE_MAX_OUTPUT_TOKENS: '8000' } },
];

let srv; let base;
before(async () => {
  Object.assign(process.env, { HOME: home, USERPROFILE: home, WORCA_HOME: worcaHome, WORCA_TEST_ALLOW_HOME_FALLBACK: '1', WORCA_FLAGS: 'requirements' });
  delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK;
  _resetForTests();
  settings(COMPANY);
});
after(async () => {
  srv?.closeAllConnections?.();
  if (srv) await Promise.race([new Promise((r) => srv.close(r)), new Promise((r) => setTimeout(r, 500))]);
  _resetForTests();
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(home, { recursive: true, force: true });
  rmSync(worcaHome, { recursive: true, force: true });
});

const SIGNED_OUT = { name: 'claude', label: 'Claude Code', ready: false, reason: 'Claude Code is not signed in — run claude, then /login' };
const state = { readiness: [SIGNED_OUT], userSignIn: false, engine: 'claude' };
const ask = createAskModels({ listModels: (dir) => listModels(dir), askPrefs: () => ({ engine: 'claude', slots: {} }), codexAvailable: () => true, copilotAvailable: () => true });
const deps = {
  readiness: async () => state.readiness,
  userSignIn: () => state.userSignIn,
  engines: () => ['claude', 'codex', 'copilot'],
  catalog: ask.askCatalog,
  validate: ask.validateModelEffort,
  resolveEngine: () => ({ engine: state.engine }),
  roleModel: () => null,
  resolveRole: () => null,
  listModels: (dir) => listModels(dir),
  interviewModel: async () => ({ model: 'claude-sonnet-5-5', effort: 'medium' }),
};
const models = async () => {
  if (!srv) {
    const app = express();
    app.use(express.json());
    registerRequirementsRoutes(app, { broadcast: () => {}, deps });
    srv = app.listen(0, '127.0.0.1');
    await new Promise((r) => srv.once('listening', r));
    base = `http://127.0.0.1:${srv.address().port}`;
  }
  const r = await fetch(`${base}/api/requirements/models`);
  return r.json();
};

test('claudeModelRunsSignedOut: a model profile that signs in by itself (Vertex, a token) or an endpoint runs signed out; a knob alone does not', () => {
  assert.equal(claudeModelRunsSignedOut('claude-opus-5-5'), true, 'Vertex profile');
  assert.equal(claudeModelRunsSignedOut('corp-endpoint'), true, 'an endpoint');
  assert.equal(claudeModelRunsSignedOut('corp-knob'), false, 'an env without sign-in');
  assert.equal(claudeModelRunsSignedOut('claude-sonnet-5-5'), false, 'a built-in model without a profile');
  assert.equal(claudeModelRunsSignedOut(''), false);
});

test('GET /models: Claude not signed in but with company models is ready and offers only those; the default is one of them', async () => {
  state.readiness = [SIGNED_OUT]; state.userSignIn = false;
  const r = await models();
  const claude = r.harnesses.find((h) => h.engine === 'claude');
  assert.deepEqual([claude.ready, claude.short], [true, null]);
  assert.deepEqual(claude.onlyModels, ['claude-opus-5-5', 'corp-endpoint']);
  assert.ok(claude.onlyModels.includes(r.defaults.claude.model), r.defaults.claude.model);
});

test('GET /models: the user\'s Claude settings sign it in: every model; no company model and no sign-in: greyed "Not signed in"', async () => {
  state.readiness = [SIGNED_OUT]; state.userSignIn = true;
  let claude = (await models()).harnesses.find((h) => h.engine === 'claude');
  assert.equal(claude.ready, true);
  assert.equal(claude.onlyModels, undefined);
  state.userSignIn = false;
  settings([{ id: 'corp-knob', label: 'Corp knob', env: { CLAUDE_CODE_MAX_OUTPUT_TOKENS: '8000' } }]);
  try {
    claude = (await models()).harnesses.find((h) => h.engine === 'claude');
    assert.deepEqual([claude.ready, claude.short], [false, 'Not signed in']);
    // signed in: as before
    state.readiness = [{ name: 'claude', ready: true }];
    claude = (await models()).harnesses.find((h) => h.engine === 'claude');
    assert.deepEqual([claude.ready, claude.onlyModels], [true, undefined]);
  } finally { settings(COMPANY); state.readiness = [SIGNED_OUT]; }
});

test('D4 with B4: a fallback to Claude names a model that runs; when Claude cannot run either, the line never says "starts on Claude"', async () => {
  state.engine = 'codex';
  const codexOff = { name: 'codex', ready: false, reason: 'not signed in' };
  try {
    state.readiness = [SIGNED_OUT, codexOff];
    const ok = await defaultChoice({ projectKey: 'k' }, deps);
    assert.deepEqual(ok, { choice: { engine: 'claude', model: 'claude-opus-5-5', effort: null }, fallbackReason: "OpenAI Codex isn't signed in, so this starts on Claude." });
    settings([]);
    const no = await defaultChoice({ projectKey: 'k' }, deps);
    assert.equal(no.fallbackReason, "Claude Code isn't signed in. Sign in, or change the model.");
    assert.doesNotMatch(no.fallbackReason, /starts on Claude/);
    const brief = await briefDefault({ projectKey: 'k' }, deps);
    assert.doesNotMatch(brief.fallbackReason, /starts on Claude|made on Claude/);
    // Claude signed in: today's sentence and pick
    state.readiness = [{ name: 'claude', ready: true }, codexOff];
    assert.deepEqual(await defaultChoice({ projectKey: 'k' }, deps),
      { choice: { engine: 'claude', model: 'claude-sonnet-5-5', effort: 'medium' }, fallbackReason: "OpenAI Codex isn't signed in, so this starts on Claude." });
  } finally { settings(COMPANY); state.engine = 'claude'; state.readiness = [SIGNED_OUT]; }
});

test('whoInterviews: a harness with onlyModels lists only those models', async () => {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const { whoInterviews } = await import('../ui/public/requirements-model.mjs');
  const MODELS = [{ id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium'] }, { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: ['medium'] },
    { id: 'corp-endpoint', label: 'Corp endpoint', efforts: ['medium'] }];
  const H = [{ engine: 'claude', label: 'Claude Code', choiceLabel: 'Claude Code', ready: true, repo: true, files: true, onlyModels: ['claude-opus-5-5', 'corp-endpoint'] }];
  const w = whoInterviews(window.document, { models: MODELS, harnesses: H, choice: { engine: 'claude', model: 'claude-sonnet-5-5' }, defaults: {} });
  assert.deepEqual([...w.el.querySelector('.req-who-model').options].map((o) => o.value), ['claude-opus-5-5', 'corp-endpoint']);
  assert.equal(w.value().model, 'claude-opus-5-5', 'a pick that cannot run moves to the first that can');
  window.close();
});
