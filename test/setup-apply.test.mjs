// test/setup-apply.test.mjs
// POST /api/setup/apply (D20): writeSettingsKeys and the next* split (settings.mjs), the proxy gate split
// (checkSave / applyWritten), brokerRefusal, userLine, plan → commit → run in src/core/setup/apply.mjs,
// and the routes (202 + frames + poll, 400, 409, 415, 403). Every side effect is injected.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

const HOME = useTempHome(after);
const REAL = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
process.env.HOME = HOME; process.env.USERPROFILE = HOME;      // settings.json lives under HOME, not WORCA_HOME
process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';             // provider staging's node:test guard
delete process.env.WORCA_BROKER_URL;

const { planSetupApply, commitSetupPlan, runSetupSteps, SetupFieldError, SetupConflictError, sameValue, PROVIDER_LABELS, LOGIN_LABELS } = await import('../src/core/setup/apply.mjs');
const settings = await import('../src/core/settings.mjs');
const { createProxyHost } = await import('../src/core/proxy-host.mjs');
const { brokerRefusal } = await import('../src/core/bridge/provider-ops.mjs');
const { savedLoginRefusal } = await import('../src/core/proxy-credentials.mjs');
const { INTERNAL_KEY, userLine } = await import('../src/core/settings-errors.mjs');
const { SAVED_TEXT, SAVED_OFF_TEXT, PORT_PENDING_TEXT } = await import('../src/shared/network-proxy-text.mjs');

const settingsPath = () => join(HOME, '.worca-cc', 'settings.json');
const seed = (obj) => { mkdirSync(join(HOME, '.worca-cc'), { recursive: true }); writeFileSync(settingsPath(), JSON.stringify(obj, null, 2) + '\n'); };
const read = () => JSON.parse(readFileSync(settingsPath(), 'utf8'));

function fakeDeps(over = {}) {
  const calls = [];
  const writes = [];
  return { calls, writes, deps: {
    writeSettingsKeys: async (v) => { writes.push(Object.keys(v)); return settings.writeSettingsKeys(v); },
    checkProxy: () => ({ refused: null }), fixedPortNow: () => null,
    checkModelRoles: async (p) => p,
    applyProxy: async (np) => { calls.push('proxy-swap'); return { networkProxy: np, applied: true, pending: [] }; },
    saveLogin: async (l) => { calls.push('proxy-login'); return { label: `${l.domain}\\${l.user}` }; },
    verifyCopilot: async () => { calls.push('copilot-signin'); return { ok: true }; },
    importCopilot: async (ids) => { calls.push('copilot-import'); return { created: ids, updated: [], skipped: [] }; },
    importEndpoint: async (ids) => { calls.push('openai-import'); return { created: ids, updated: [], skipped: [] }; },
    testModel: async (id) => { calls.push(`test:${id}`); return { ok: true, text: 'OK' }; },
    brokerRefusal: () => null,
    ...over,
  } };
}
const brokerOn = (what) => Object.assign(new Error(`worca can't ${what}: with the credential broker, each person does that on the key page (https://keys.acme.example)`), { code: 'BROKER' });
async function applyAll(body, deps) {
  const plan = await planSetupApply(body, deps);
  await commitSetupPlan(plan, deps);
  return { plan, out: await runSetupSteps(plan, { deps }) };
}

// ── Step 1: settings.mjs ──
test('writeSettingsKeys: one write, listed keys set or deleted, others untouched', async () => {
  seed({ theme: 'dark', uiLevel: 'expert', pipelineCostLimitUsd: 3 });
  await settings.writeSettingsKeys({ pipelineCostLimitUsd: 5, uiLevel: undefined });
  assert.deepEqual(read(), { theme: 'dark', pipelineCostLimitUsd: 5 });
});

test('next*: same normalisation as the setters', () => {
  assert.equal(settings.nextAutoGeneratePrDescription(false), undefined);          // the default is elided, like the setter
  assert.equal(settings.nextAutoGeneratePrDescription(true), true);
  assert.equal(settings.nextUsdCap('pipelineCostLimitUsd', ''), undefined);        // a clear
  assert.equal(settings.nextUsdCap('pipelineCostLimitUsd', 4), 4);
  assert.throws(() => settings.nextUsdCap('pipelineCostLimitUsd', -1), /pipelineCostLimitUsd must be a positive number of USD/);
  assert.throws(() => settings.nextUiLevel('pro'), /uiLevel must be simple, advanced or expert/);
  assert.equal(settings.nextCostLimitResetPeriod(null), undefined);
  assert.equal(settings.nextRunEngine(''), undefined);
  assert.equal(settings.nextSmartNaming({ suggestTitle: false, model: 'x' }, { suggestTitle: true }), undefined);   // back to defaults: block deleted
  assert.deepEqual(settings.nextModelRoles({ claude: { quick: { model: 'a' } } }, { claude: { quick: null } }), undefined);
  assert.deepEqual(settings.nextProviders({ openai: { baseUrl: 'http://x/v1' } }, 'openai', { baseUrl: 'http://y/v1/ ', apiKey: '' }), { openai: { baseUrl: 'http://y/v1' } });
  assert.throws(() => settings.nextProviders({}, 'openai', { baseUrl: 'ftp://x' }), /^Error: baseUrl must be an http\(s\) URL/);
});

test('setModelRoles still answers {} after the last role is cleared', async () => {
  seed({ modelRoles: { claude: { quick: { model: 'claude-haiku-5-5' } } } });
  assert.deepEqual(await settings.setModelRoles({ claude: { quick: null } }), { modelRoles: {} });
  assert.equal(read().modelRoles, undefined);
});

// ── Step 2: proxy gate split, broker refusal, user lines ──
test('checkSave refuses an untested upstream; applyWritten swaps without writing', async () => {
  const applied = [];
  const host = createProxyHost({ egress: () => null, apply: async (np) => { applied.push(np); return { changed: true, pending: [] }; },
    io: { settings: () => ({}), preview: (p) => ({ ...p }), readLogin: () => null, env: () => ({}), now: () => 0,
      checkUpstream: async () => ({ ok: true, upstream: { upstream: 'proxy.acme.example:8080' }, results: [] }) } });
  const np = { enabled: true, upstream: 'proxy.acme.example:8080', auth: 'none' };
  assert.equal(host.checkSave(np).refused.body.code, 'UNTESTED');
  await host.test(np, { record: true });
  assert.equal(host.checkSave(np).refused, null);
  const r = await host.applyWritten(np, null);
  assert.equal(r.applied, true);
  assert.deepEqual(applied, [np]);
});

test('brokerRefusal returns the pointer without throwing', () => {
  assert.equal(brokerRefusal('store a provider key'), null);
  process.env.WORCA_BROKER_URL = 'http://127.0.0.1:1';
  try { assert.match(brokerRefusal('store a provider key').message, /^worca can't store a provider key: with the credential broker, each person does that on the key page/); }
  finally { delete process.env.WORCA_BROKER_URL; }
});

test('no user-facing text holds an internal key or a credential', async () => {
  for (const auth of ['basic', 'digest']) assert.doesNotMatch(savedLoginRefusal(auth), INTERNAL_KEY);
  assert.equal(savedLoginRefusal('auto'), null);
  assert.equal(userLine('connect failed http://jdoe:secret@proxy.acme.example:8080'), 'Connect failed http://proxy.acme.example:8080.');
  assert.equal(userLine('networkProxy.auth is basic', 'Login'), '“Login” has a value Worca can’t use.');
  assert.equal(userLine('x'.repeat(400)).length, 301);
  const { deps } = fakeDeps({ saveLogin: async () => { throw new Error('write failed at https://u:p@x.example'); } });
  seed({ networkProxy: { enabled: true, upstream: 'proxy.acme.example:8080', auth: 'ntlm' } });
  const plan = await planSetupApply({ network: { login: { domain: 'ACME', user: 'jdoe', password: 'pw' } } }, deps);
  const out = await runSetupSteps(plan, { deps });
  assert.equal(out.results[0].state, 'failed');
  assert.match(out.results[0].line, /^Could not log in: write failed/);
  assert.doesNotMatch(out.results[0].line, /u:p@/);
  for (const r of out.results) assert.doesNotMatch(r.line, INTERNAL_KEY);
});

// ── Step 5: plan, commit, run ──
test('AC-3.2: an invalid field in any group writes nothing and names the field', async () => {
  seed({ theme: 'dark' });
  const before = readFileSync(settingsPath(), 'utf8');
  for (const [body, field] of [
    [{ work: { uiLevel: 'simple', pipelineCostLimitUsd: -1 } }, 'work.pipelineCostLimitUsd'],
    [{ work: { uiLevel: 'pro' } }, 'work.uiLevel'],
    [{ network: { networkProxy: { auth: 'kerberos' } } }, 'network.networkProxy.auth'],
    [{ access: { openai: { baseUrl: 'ftp://x' } } }, 'access.openai.baseUrl'],
    [{ models: { modelRoles: { claude: { fast: { model: 'x' } } } } }, 'models.modelRoles.claude'],
    [{ network: { login: { user: 'jdoe', password: '' } } }, 'network.login.password'],
    [{ work: { colour: 'red' } }, 'work.colour'],
  ]) {
    const { deps, writes } = fakeDeps();
    await assert.rejects(planSetupApply({ ...body, work: { runEngine: 'claude', ...(body.work || {}) } }, deps),
      (e) => {
        assert.ok(e instanceof SetupFieldError, field);
        assert.equal(e.field, field);
        if (field !== 'work.colour') assert.doesNotMatch(e.message, INTERNAL_KEY, `${field}: ${e.message}`);
        return true;
      });
    assert.deepEqual(writes, []);
  }
  assert.equal(readFileSync(settingsPath(), 'utf8'), before);
});

test('AC-3.2 labels: the 400 text names the visible label', async () => {
  seed({});
  const { deps } = fakeDeps();
  const msg = async (body) => { try { await planSetupApply(body, deps); } catch (e) { return e.message; } return null; };
  assert.match(await msg({ work: { pipelineCostLimitUsd: -1 } }), /^“Per-pipeline cost limit” must/);
  assert.match(await msg({ models: { testRoles: 'yes' } }), /^“Models · Test the roles”/);
  assert.match(await msg({ access: { copilot: { acknowledgeTerms: false } } }), /^“GitHub Copilot · Acknowledge the notice”/);
  assert.match(await msg({ access: { copilot: { signIn: 'yes' } } }), /^“GitHub Copilot · Sign in”/);
  assert.match(await msg({ network: { login: { domain: 'ACME', user: '', password: 'pw' } } }), /^“User name”/);
});

test('AC-3.3: one write, one ordered result per side effect', async () => {
  seed({});
  const { deps, writes, calls } = fakeDeps();
  const plan = await planSetupApply({
    network: { networkProxy: { enabled: true, upstream: 'proxy.acme.example:8080', auth: 'ntlm' }, login: { domain: 'ACME', user: 'jdoe', password: 'pw' } },
    access: { copilot: { acknowledgeTerms: true, signIn: true, importModels: ['claude-opus-5-5'] } },
    models: { modelRoles: { claude: { everyday: { model: 'claude-sonnet-5-5' } } }, testRoles: true },
    work: { uiLevel: 'simple', pipelineCostLimitUsd: 5 },
  }, deps);
  await commitSetupPlan(plan, deps);
  const seen = [];
  const out = await runSetupSteps(plan, { deps, onResult: (r) => seen.push(r) });
  assert.equal(writes.length, 1);
  assert.deepEqual(seen.map((r) => r.id), ['proxy-swap', 'proxy-login', 'copilot-signin', 'copilot-import', 'role-test.claude.everyday']);
  assert.ok(seen.every((r) => r.state === 'ok'));
  assert.deepEqual(calls, ['proxy-swap', 'proxy-login', 'copilot-signin', 'copilot-import', 'test:claude-sonnet-5-5']);
  assert.equal(out.ok, true);
  const s = read();
  assert.equal(s.pipelineCostLimitUsd, 5);
  assert.equal(s.uiLevel, 'simple');
  assert.match(s.networkProxy.upstream, /proxy\.acme\.example:8080$/);
  assert.ok(s.providers.copilot.acknowledgedTerms);
  assert.equal(seen[1].line, 'Logged in as ACME\\jdoe.');
  assert.doesNotMatch(JSON.stringify(out), /"pw"/);
});

test('AC-3.3 full order: every side-effect kind, roles labelled with their engine', async () => {
  seed({});
  const { deps, calls } = fakeDeps();
  const { out } = await applyAll({
    network: { networkProxy: { enabled: true, upstream: 'proxy.acme.example:8080', auth: 'ntlm' }, login: { domain: 'ACME', user: 'jdoe', password: 'pw' } },
    access: { copilot: { signIn: true, importModels: ['claude-opus-5-5'] }, openai: { baseUrl: 'http://127.0.0.1:8080/v1', importModels: ['qwen3'] } },
    models: { modelRoles: { claude: { everyday: { model: 'claude-sonnet-5-5' } }, codex: { quick: { model: 'gpt-5.5-mini' } } }, testRoles: true },
  }, deps);
  assert.deepEqual(out.results.map((r) => r.id), ['proxy-swap', 'proxy-login', 'copilot-signin', 'copilot-import', 'openai-import', 'role-test.claude.everyday', 'role-test.codex.quick']);
  assert.deepEqual(calls, ['proxy-swap', 'proxy-login', 'copilot-signin', 'copilot-import', 'openai-import', 'test:claude-sonnet-5-5', 'test:gpt-5.5-mini']);
  assert.equal(out.results[0].line, SAVED_TEXT);
  assert.equal(out.results[4].line, 'Imported 1 model from http://127.0.0.1:8080/v1.');
  assert.deepEqual(out.results.slice(-2).map((r) => r.label), ['Everyday coding · Claude', 'Quick jobs · Codex']);
});

test('proxy-swap lines are the card\'s sentences', async () => {
  for (const [enabled, pending, line] of [[true, [], SAVED_TEXT], [false, [], SAVED_OFF_TEXT], [true, ['fixedPort'], SAVED_TEXT + PORT_PENDING_TEXT]]) {
    seed({});
    const { deps } = fakeDeps({ applyProxy: async (np) => ({ networkProxy: np, applied: true, pending }) });
    const { out } = await applyAll({ network: { networkProxy: { enabled, upstream: 'proxy.acme.example:8080', auth: 'ntlm' } } }, deps);
    assert.equal(out.results[0].line, line);
  }
});

test('AC-3.4: a refused Copilot sign-in keeps earlier writes and names the step to retry', async () => {
  seed({});
  const { deps } = fakeDeps({ verifyCopilot: async () => ({ ok: false, message: 'GitHub rejected the stored token (401) — sign in again' }) });
  const body = { access: { copilot: { signIn: true, importModels: ['gpt-5.5'] } }, work: { pipelineCostLimitUsd: 7 } };
  const { out } = await applyAll(body, deps);
  assert.equal(out.ok, false);
  assert.equal(out.retry, 'copilot-signin');
  assert.deepEqual(out.results.map((r) => [r.id, r.state]), [['copilot-signin', 'failed'], ['copilot-import', 'skipped']]);
  assert.equal(out.results[0].retry, 'copilot-signin');
  assert.equal(out.results[0].line, 'GitHub Copilot sign-in failed: GitHub rejected the stored token (401) — sign in again.');
  assert.equal(out.results[1].line, 'Not run: GitHub Copilot sign-in failed first.');
  assert.equal(read().pipelineCostLimitUsd, 7);                   // the earlier write stays
  // Retry: the same body with fromStep writes nothing new and runs from the sign-in.
  const { deps: d2, writes: w2, calls: c2 } = fakeDeps();
  const again = await planSetupApply({ ...body, fromStep: 'copilot-signin' }, d2);
  await commitSetupPlan(again, d2);
  assert.deepEqual(w2, []);
  assert.equal((await runSetupSteps(again, { deps: d2 })).ok, true);
  assert.deepEqual(c2, ['copilot-signin', 'copilot-import']);
});

test('a Copilot reason that does not say "sign in again" gets the retry hint', async () => {
  seed({});
  const { deps } = fakeDeps({ verifyCopilot: async () => ({ ok: false, message: 'GitHub did not answer.' }) });
  const { out } = await applyAll({ access: { copilot: { signIn: true } } }, deps);
  assert.equal(out.results[0].line, 'GitHub Copilot sign-in failed: GitHub did not answer. Sign in again, then retry.');
});

test('fromStep: earlier steps are skipped as done; a step the plan lacks is a 400', async () => {
  seed({ networkProxy: { enabled: true, upstream: 'proxy.acme.example:8080', auth: 'ntlm' } });
  const { deps, calls } = fakeDeps();
  const plan = await planSetupApply({ network: { login: { domain: 'ACME', user: 'jdoe', password: 'pw' } }, access: { copilot: { signIn: true } }, fromStep: 'copilot-signin' }, deps);
  const out = await runSetupSteps(plan, { deps });
  assert.deepEqual(out.results.map((r) => [r.id, r.state, r.line]), [['proxy-login', 'skipped', 'Done before; not run again.'], ['copilot-signin', 'ok', 'Signed in to GitHub Copilot.']]);
  assert.deepEqual(calls, ['copilot-signin']);
  await assert.rejects(planSetupApply({ work: { uiLevel: 'simple' }, fromStep: 'proxy-swap' }, deps), (e) => e.field === 'fromStep');
});

test('a failing role test fails that step only and skips the rest', async () => {
  seed({});
  const { deps } = fakeDeps({ testModel: async (id) => (id === 'claude-opus-5-5' ? { ok: false, message: 'model not found', hint: 'Pick another model.' } : { ok: true }) });
  const { out } = await applyAll({ models: { modelRoles: { claude: { deep: { model: 'claude-opus-5-5' }, quick: { model: 'claude-haiku-5-5' } } }, testRoles: true } }, deps);
  assert.deepEqual(out.results.map((r) => r.state), ['failed', 'skipped']);
  assert.equal(out.results[0].line, 'Model not found. Pick another model.');
  assert.equal(out.retry, 'role-test.claude.deep');
});

test('an import whose ids were all there says so', async () => {
  seed({});
  const { deps } = fakeDeps({ importCopilot: async () => ({ created: [], updated: [], skipped: ['gpt-5.5'] }) });
  const { out } = await applyAll({ access: { copilot: { importModels: ['gpt-5.5'] } } }, deps);
  assert.equal(out.results[0].line, 'Those models were already imported.');
});

test('a failed proxy swap is retried with fromStep although nothing is written', async () => {
  seed({});
  const body = { network: { networkProxy: { enabled: true, upstream: 'proxy.acme.example:8080', auth: 'ntlm' } }, work: { pipelineCostLimitUsd: 3 } };
  const { deps } = fakeDeps({ applyProxy: async (np) => ({ networkProxy: np, applied: false, pending: [], upstreamError: 'saved, but not applied yet: connect ECONNREFUSED' }) });
  const { out } = await applyAll(body, deps);
  assert.deepEqual([out.ok, out.retry, out.results[0].state], [false, 'proxy-swap', 'failed']);
  assert.match(out.results[0].line, /^Saved, but not applied yet: /);
  // The 10-minute pass expired meanwhile: the gate now refuses, but the planned value is already stored.
  const { deps: d2, writes: w2, calls: c2 } = fakeDeps({ checkProxy: () => ({ refused: { status: 409, body: { code: 'UNTESTED', error: 'Test first' } } }) });
  const again = await planSetupApply({ ...body, fromStep: 'proxy-swap' }, d2);
  assert.deepEqual(again.written, []);
  await commitSetupPlan(again, d2);
  assert.deepEqual(w2, []);
  assert.equal((await runSetupSteps(again, { deps: d2 })).ok, true);
  assert.deepEqual(c2, ['proxy-swap']);
});

test('an untested proxy upstream is a 400 UNTESTED and writes nothing', async () => {
  seed({ theme: 'dark' });
  const before = readFileSync(settingsPath(), 'utf8');
  const { deps, writes } = fakeDeps({ checkProxy: () => ({ refused: { status: 409, body: { code: 'UNTESTED', error: 'Test these proxy settings first' } } }) });
  await assert.rejects(planSetupApply({ network: { networkProxy: { enabled: true, upstream: 'proxy.acme.example:8080' } } }, deps),
    (e) => e.field === 'network.networkProxy' && e.code === 'UNTESTED');
  assert.deepEqual(writes, []);
  assert.equal(readFileSync(settingsPath(), 'utf8'), before);
});

test('a missing proxy gate fails closed', async () => {
  seed({});
  const { deps } = fakeDeps();
  delete deps.checkProxy;
  await assert.rejects(planSetupApply({ network: { networkProxy: { enabled: true, upstream: 'proxy.acme.example:8080' } } }, deps), /checkProxy/);
});

test('a login with Basic or Digest is refused with the card\'s wording; clearing the proxy lets it through', async () => {
  const { deps } = fakeDeps();
  seed({});
  await assert.rejects(planSetupApply({ network: { networkProxy: { auth: 'basic' }, login: { domain: 'ACME', user: 'jdoe', password: 'pw' } } }, deps),
    (e) => e.field === 'network.login' && e.message === savedLoginRefusal('basic'));
  seed({ networkProxy: { enabled: true, upstream: 'proxy.acme.example:8080', auth: 'basic' } });
  await assert.rejects(planSetupApply({ network: { login: { domain: 'ACME', user: 'jdoe', password: 'pw' } } }, deps), (e) => e.field === 'network.login');
  const plan = await planSetupApply({ network: { networkProxy: null, login: { domain: 'ACME', user: 'jdoe', password: 'pw' } } }, deps);
  assert.ok(plan.steps.some((s) => s.id === 'proxy-login'));
});

test('AC-3.5: a re-run that changes only the per-run limit writes only pipelineCostLimitUsd', async () => {
  const saved = { theme: 'dark', uiLevel: 'simple', pipelineCostLimitUsd: 5, totalCostLimitUsd: 50, costLimitResetPeriod: 'weekly',
    autoGeneratePrDescription: true, runEngine: 'claude', modelRoles: { claude: { quick: { model: 'claude-haiku-5-5', effort: 'low' } } } };
  seed(saved);
  const { deps, writes } = fakeDeps();
  const plan = await planSetupApply({
    work: { uiLevel: 'simple', pipelineCostLimitUsd: 8, totalCostLimitUsd: 50, costLimitResetPeriod: 'weekly', autoGeneratePrDescription: true, runEngine: 'claude' },
    models: { modelRoles: { claude: { quick: { model: 'claude-haiku-5-5', effort: 'low' } } } },
  }, deps);
  assert.deepEqual(plan.written, ['pipelineCostLimitUsd']);
  await commitSetupPlan(plan, deps);
  assert.deepEqual(writes, [['pipelineCostLimitUsd']]);
  assert.deepEqual(read(), { ...saved, pipelineCostLimitUsd: 8 });
});

test('nothing changed: no write at all; acknowledged terms are not re-stamped', async () => {
  seed({ uiLevel: 'simple' });
  const { deps, writes } = fakeDeps({ now: () => new Date('2026-10-25T00:00:00Z') });
  const first = await planSetupApply({ access: { copilot: { acknowledgeTerms: true } } }, deps);
  await commitSetupPlan(first, deps);
  assert.deepEqual(first.written, ['providers']);
  const plan = await planSetupApply({ work: { uiLevel: 'simple' }, access: { copilot: { acknowledgeTerms: true } } }, deps);
  assert.deepEqual(plan.written, []);
  await commitSetupPlan(plan, deps);
  assert.equal(writes.length, 1);
});

test('a masked API key echo is dropped, never stored', async () => {
  seed({ providers: { openai: { baseUrl: 'http://127.0.0.1:8080/v1', apiKey: 'sk-real' } } });
  const { deps } = fakeDeps();
  const plan = await planSetupApply({ access: { openai: { baseUrl: 'http://127.0.0.1:8080/v1', apiKey: '••••' } } }, deps);
  assert.deepEqual(plan.written, []);
});

test('AC-3.6: with the broker on, provider keys are refused with the pointer and the rest continues', async () => {
  seed({});
  const { deps } = fakeDeps({ brokerRefusal: brokerOn });
  const { out } = await applyAll({ access: { openai: { baseUrl: 'http://127.0.0.1:8080/v1', apiKey: 'sk-test' } }, work: { pipelineCostLimitUsd: 4 } }, deps);
  assert.deepEqual(out.results[0], { id: 'provider-key.openai', label: 'OpenAI-compatible · API key', state: 'refused', line: brokerOn('store a provider key').message });
  assert.equal(out.ok, true);
  const s = read();
  assert.equal(s.pipelineCostLimitUsd, 4);
  assert.equal(s.providers.openai.baseUrl, 'http://127.0.0.1:8080/v1');
  assert.equal(s.providers.openai.apiKey, undefined);             // never stored
});

test('AC-3.6 broker: anthropic, whitespace and non-string keys; a refused sign-in skips its import', async () => {
  seed({});
  const { deps, calls } = fakeDeps({ brokerRefusal: brokerOn });
  const { out } = await applyAll({ access: {
    anthropic: { baseUrl: 'https://llm.acme.example', apiKey: 'sk-ant-1' },
    openai: { baseUrl: 'http://127.0.0.1:8080/v1', apiKey: '   ' },
    copilot: { signIn: true, importModels: ['gpt-5.5'] },
  }, work: { pipelineCostLimitUsd: 4 } }, deps);
  assert.equal(out.ok, true);
  assert.deepEqual(out.results.map((r) => [r.id, r.state]), [['provider-key.anthropic', 'refused'], ['copilot-signin', 'refused'], ['copilot-import', 'skipped']]);
  assert.equal(out.results[1].line, brokerOn('sign in to GitHub Copilot').message);
  assert.equal(out.results[2].line, 'Not run: GitHub Copilot sign-in is on the key page.');
  assert.deepEqual(calls, []);
  const s = read();
  assert.equal(s.providers.anthropic.apiKey, undefined);
  assert.equal(s.providers.openai?.apiKey, undefined);            // whitespace-only is a clear, never a stored key
  assert.equal(s.pipelineCostLimitUsd, 4);
  // A non-string key is a validation error, not a refusal.
  await assert.rejects(planSetupApply({ access: { openai: { apiKey: 42 } } }, deps), (e) => e.field === 'access.openai.apiKey');
});

test('sameValue ignores key order; a reordered role block writes nothing', async () => {
  assert.equal(sameValue({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 }), true);
  assert.equal(sameValue({ a: 1 }, { a: 2 }), false);
  assert.equal(sameValue([1, 2], [2, 1]), false);
  seed({ modelRoles: { claude: { quick: { effort: 'low', model: 'claude-haiku-5-5' } } } });
  const { deps } = fakeDeps();
  const plan = await planSetupApply({ models: { modelRoles: { claude: { quick: { model: 'claude-haiku-5-5', effort: 'low' } } } } }, deps);
  assert.deepEqual(plan.written, []);
});

test('commit refuses when a written key changed on disk since plan', async () => {
  seed({ pipelineCostLimitUsd: 1 });
  const { deps, writes } = fakeDeps();
  const plan = await planSetupApply({ work: { pipelineCostLimitUsd: 2 } }, deps);
  seed({ pipelineCostLimitUsd: 9 });                             // another tab saved in between
  await assert.rejects(commitSetupPlan(plan, deps), (e) => e instanceof SetupConflictError && e.keys[0] === 'pipelineCostLimitUsd');
  assert.deepEqual(writes, []);
  assert.equal(read().pipelineCostLimitUsd, 9);
});

test('label pins: provider labels match Models › Providers, login labels match the card', async () => {
  const { PROVIDER_LABELS: viewLabels } = await import('../ui/public/bridge-view.mjs');
  assert.deepEqual({ ...PROVIDER_LABELS }, viewLabels);
  const card = readFileSync(new URL('../ui/public/settings-network-proxy.mjs', import.meta.url), 'utf8');
  for (const label of Object.values(LOGIN_LABELS)) assert.ok(card.includes(`'${label}'`), label);
});

// ── Step 6: the routes ──
let srv, base, testing;
before(async () => {
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  testing = mod._testing;
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  testing?.resetSetup();
  if (srv) await new Promise((r) => srv.close(r));
  delete process.env.WORCA_MOCK;
  delete process.env.WORCA_BROKER_URL;
  for (const [k, v] of Object.entries(REAL)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});
beforeEach(() => { testing?.resetSetup(); delete process.env.WORCA_BROKER_URL; });   // no override or lock leaks between tests

function listen() {                       // test/api-runs-bulk.test.mjs's fake socket
  const frames = [];
  const ws = { OPEN: 1, readyState: 1, send: (t) => frames.push(JSON.parse(t)) };
  testing.sockets.add(ws);
  return { frames, close: () => testing.sockets.delete(ws) };
}
async function waitFor(fn, { timeoutMs = 5000, stepMs = 20 } = {}) {
  const end = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('waitFor timed out'); await new Promise((r) => setTimeout(r, stepMs)); }
}
const post = (body, headers = { 'content-type': 'application/json' }) =>
  fetch(`${base}/api/setup/apply`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
const poll = async (id) => (await fetch(`${base}/api/setup/apply/${id}`)).json();
const settled = (id) => waitFor(async () => { const j = await poll(id); return j.done ? j : null; });
const fileNow = () => (existsSync(settingsPath()) ? readFileSync(settingsPath(), 'utf8') : null);

test('POST /api/setup/apply: 202, then one frame per side effect and a terminal frame', async () => {
  rmSync(settingsPath(), { force: true });
  testing.setSetupDeps({ verifyCopilot: async () => ({ ok: false, message: 'GitHub rejected the stored token (401) — sign in again' }),
    importCopilot: async (ids) => ({ created: ids, updated: [], skipped: [] }) });
  const { frames, close } = listen();
  const res = await post({ access: { copilot: { signIn: true, importModels: ['gpt-5.5'] } }, work: { pipelineCostLimitUsd: 6 } });
  assert.equal(res.status, 202);
  const { id, written, steps } = await res.json();
  assert.deepEqual(written, ['pipelineCostLimitUsd']);
  assert.deepEqual(steps.map((s) => s.id), ['copilot-signin', 'copilot-import']);
  const job = await settled(id);
  close();
  const mine = frames.filter((f) => f.type === 'setup-apply' && f.id === id);
  assert.deepEqual(mine.map((f) => (f.done ? 'done' : f.result.id)), ['copilot-signin', 'copilot-import', 'done']);
  assert.equal(mine.at(-1).retry, 'copilot-signin');
  assert.equal(mine.at(-1).ok, false);
  assert.equal(job.retry, 'copilot-signin');
  assert.ok(frames.some((f) => f.type === 'settings-changed'));
  assert.ok(frames.some((f) => f.type === 'budget-changed'));
  assert.equal(JSON.parse(fileNow()).pipelineCostLimitUsd, 6);
});

test('POST /api/setup/apply: 400 names the field and writes nothing', async () => {
  const before = fileNow();
  const res = await post({ work: { uiLevel: 'simple' }, access: { anthropic: { baseUrl: 'not a url' } } });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).field, 'access.anthropic.baseUrl');
  assert.equal(fileNow(), before);
  // The lock was released: the next valid POST is accepted.
  const ok = await post({ work: { uiLevel: 'simple' } });
  assert.equal(ok.status, 202);
  await settled((await ok.json()).id);
});

test('POST /api/setup/apply: 409 while one runs, 415 for a non-JSON body', async () => {
  let release;
  const started = new Promise((go) => {
    testing.setSetupDeps({ verifyCopilot: () => new Promise((r) => { release = () => r({ ok: true }); go(); }) });
  });
  const first = await post({ access: { copilot: { signIn: true } } });
  assert.equal(first.status, 202);
  const { id } = await first.json();
  await started;
  const second = await post({ work: { pipelineCostLimitUsd: 2 } });
  assert.equal(second.status, 409);
  assert.deepEqual(await second.json(), { error: 'Setup is already applying. Wait for it to finish, then try again.', code: 'SETUP_RUNNING', id });
  release();
  await settled(id);
  const before = fileNow();
  const form = await post('work[pipelineCostLimitUsd]=9', { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(form.status, 415);
  assert.equal((await form.json()).code, 'JSON_REQUIRED');
  assert.equal(fileNow(), before);
});

test('POST /api/setup/apply with WORCA_BROKER_URL: refused key row, no apiKey stored, rest written', async () => {
  process.env.WORCA_BROKER_URL = 'http://127.0.0.1:1';            // brokerEnabled(); no request reaches it
  const res = await post({ access: { openai: { baseUrl: 'http://127.0.0.1:8080/v1', apiKey: 'sk-live-000' } }, work: { pipelineCostLimitUsd: 5 } });
  assert.equal(res.status, 202);
  const { id, steps } = await res.json();
  assert.deepEqual(steps.map((s) => s.id), ['provider-key.openai']);
  const job = await settled(id);
  assert.equal(job.ok, true);
  assert.equal(job.results[0].state, 'refused');
  assert.match(job.results[0].line, /^worca can't store a provider key: with the credential broker/);
  const s = JSON.parse(fileNow());
  assert.equal(s.providers.openai.apiKey, undefined);
  assert.equal(s.pipelineCostLimitUsd, 5);
  assert.doesNotMatch(JSON.stringify(job), /sk-live-000/);
});

test('GET /api/setup/apply/:id: 404 for an unknown job', async () => {
  const r = await fetch(`${base}/api/setup/apply/stp_nope`);
  assert.equal(r.status, 404);
});

test('all three setup routes refuse an agent caller', async () => {
  process.env.WORCA_AGENT_USER = 'worca-agent';
  process.env.WORCA_AGENT_HOME = join(HOME, 'agent');
  try {
    const before = fileNow();
    for (const r of [await fetch(`${base}/api/setup/detect`), await post({ work: { pipelineCostLimitUsd: 3 } }), await fetch(`${base}/api/setup/apply/stp_x`)]) {
      assert.equal(r.status, 403);
      assert.equal((await r.json()).code, 'SETUP_AGENT_BLOCKED');
    }
    assert.equal(fileNow(), before);
  } finally { delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME; }
});

test('work.hideBuiltinModels / sync / networkWait: validated, merged and written once', async () => {
  seed({ sync: { remote: 'upstream' } });
  const { deps } = fakeDeps();
  const plan = await planSetupApply({ work: { hideBuiltinModels: true, sync: { beforeRun: false }, networkWait: { maxWaitMin: 60 } } }, deps);
  assert.deepEqual(plan.written.sort(), ['hideBuiltinModels', 'hideBuiltinModelsChosen', 'networkWait', 'sync']);
  assert.deepEqual(plan.values.sync, { remote: 'upstream', beforeRun: false });
  await assert.rejects(planSetupApply({ work: { sync: { remote: 'https://x' } } }, deps), (e) => e.field === 'work.sync.remote' && /remote NAME/.test(e.message));
  await assert.rejects(planSetupApply({ work: { networkWait: { maxWaitMin: 0 } } }, deps), (e) => e.field === 'work.networkWait.maxWaitMin');
});
