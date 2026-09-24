// test/policy-local.test.mjs
// The developer's side of the fold (src/core/policy/local.mjs): the settings snapshot's `set`
// flags, plugin requirements against the lock, blocked findings, marketplace seeding that
// remembers what policy added (a local removal is never undone).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { setPipelineCostLimitUsd, setAskMaxBudgetUsd } from '../src/core/settings.mjs';
import { setHumanInLoop, setActiveWorkflow } from '../src/core/config.mjs';
import { writePluginsLock } from '../src/core/plugins-lock.mjs';
import { readMarketplaces, writeMarketplaces } from '../src/core/marketplaces.mjs';
import { localSnapshot, installedPluginsMap, pluginRequirements, blockedPluginFindings, marketplaceSeedCandidates, seedPolicyMarketplaces, WORCA_VERSION } from '../src/core/policy/local.mjs';
import { normalizePolicyDoc } from '../src/core/policy/registry.mjs';

useTempHome(after);
let sandboxHome; const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-policy-local-'));
  for (const k of ['HOME', 'USERPROFILE']) { prevEnv[k] = process.env[k]; process.env[k] = sandboxHome; }
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
});
const proj = mkdtempSync(join(tmpdir(), 'worca-policy-local-proj-'));

test('localSnapshot: `set` means the developer stored a value; project keys need a project', async () => {
  let s = localSnapshot(null);
  assert.equal(s['cost.pipelineLimitUsd'].set, false); assert.equal(s['cost.pipelineLimitUsd'].value, null);
  assert.equal(s['ask.maxTurns'].set, false); assert.equal(s['ask.maxTurns'].value, 400);
  assert.deepEqual(s['ask.maxBudgetUsd'], { value: null, set: false }, 'the default is no cap, and it is not a stored choice');
  assert.equal(s['workflows.default'], undefined);
  await setPipelineCostLimitUsd(7);
  await setAskMaxBudgetUsd(null);
  s = localSnapshot(proj);
  assert.deepEqual(s['cost.pipelineLimitUsd'], { value: 7, set: true });
  assert.deepEqual(s['ask.maxBudgetUsd'], { value: null, set: true }, 'a literal null (no cap) is a stored choice');
  assert.equal(s['run.humanInLoop'].value, true); assert.equal(s['run.humanInLoop'].set, false);
  await setHumanInLoop(proj, false);
  await setActiveWorkflow(proj, 'wf_default');
  s = localSnapshot(proj);
  assert.deepEqual(s['run.humanInLoop'], { value: false, set: true });
  assert.deepEqual(s['workflows.default'], { value: 'wf_default', set: true });
  assert.match(WORCA_VERSION, /^\d+\.\d+\.\d+/);
  await setPipelineCostLimitUsd('');
});

const homes = () => [{ slug: 'acme/gateway', doc: normalizePolicyDoc({ schema: 1, fields: {
  'plugins.required': { kind: 'soft', value: [{ name: 'github-source', marketplace: 'worca-cc' }, { name: 'acme-jira', marketplace: 'acme/worca-plugins', minVersion: '1.2.0', config: { baseUrl: 'https://acme.atlassian.net' } }] },
  'plugins.blocked': { kind: 'soft', value: ['old-plugin'] },
  'plugins.marketplaces': { kind: 'default', value: ['acme/worca-plugins', 'https://github.com/acme/more.git'] },
} }).doc }, { slug: 'acme/other', doc: normalizePolicyDoc({ schema: 1, fields: {
  'plugins.required': { kind: 'soft', value: [{ name: 'acme-jira', minVersion: '1.3.0' }] },
  'plugins.marketplaces': { kind: 'default', value: ['acme/worca-plugins'] },
} }).doc }];

test('pluginRequirements: union across homes, the higher floor wins, state against the lock', () => {
  writePluginsLock({ 'acme-jira': { version: '1.2.5', enabled: true, repo: 'r' }, 'old-plugin': { version: '0.1.0', enabled: true }, 'other': { version: '1', enabled: false } });
  assert.deepEqual(installedPluginsMap()['acme-jira'], { version: '1.2.5', enabled: true, via: null });
  const reqs = pluginRequirements(homes());
  assert.deepEqual(reqs.map((r) => [r.name, r.state, r.minVersion, r.homes]), [
    ['acme-jira', 'outdated', '1.3.0', ['acme/gateway', 'acme/other']],
    ['github-source', 'missing', null, ['acme/gateway']],
  ]);
  assert.equal(reqs[0].config.baseUrl, 'https://acme.atlassian.net'); assert.equal(reqs[0].marketplace, 'acme/worca-plugins');
  assert.deepEqual(blockedPluginFindings(homes()), [{ name: 'old-plugin', home: 'acme/gateway' }]);
  writePluginsLock({ 'acme-jira': { version: '1.3.0', enabled: false } });
  assert.equal(pluginRequirements(homes())[0].state, 'disabled');
  writePluginsLock({});
});

test('marketplace seeding: added once, remembered, a removal is not undone; failures never block', async () => {
  writeMarketplaces({ seededBuiltin: true, marketplaces: {} });
  const cands = marketplaceSeedCandidates(homes());
  assert.deepEqual(cands.map((c) => [c.url, c.homes]), [['https://github.com/acme/worca-plugins', ['acme/gateway', 'acme/other']], ['https://github.com/acme/more', ['acme/gateway']]]);
  const calls = [];
  const add = async (url) => { calls.push(url); if (url.endsWith('more')) throw new Error('boom'); return { id: 'x', url }; };
  const res = await seedPolicyMarketplaces(homes(), { add });
  assert.deepEqual(res.map((r) => [r.url, r.added, r.error]), [['https://github.com/acme/worca-plugins', true, null], ['https://github.com/acme/more', false, 'boom']]);
  assert.deepEqual(readMarketplaces().policySeeded.sort(), ['https://github.com/acme/more', 'https://github.com/acme/worca-plugins']);
  // Both are remembered: the next tick adds nothing, even after a deliberate local removal.
  assert.deepEqual(marketplaceSeedCandidates(homes()), []);
  assert.deepEqual(await seedPolicyMarketplaces(homes(), { add }), []);
  assert.equal(calls.length, 2);
});
