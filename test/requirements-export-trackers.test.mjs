// test/requirements-export-trackers.test.mjs — which task sources can export (plans/requirements-a6-design.md D1–D3, D11):
// enabled plugin sources with a connection whose capabilities() say export; the answer cached per plugin, source and
// installed version; every source probed at once within 10 s; a failed probe remembered for a minute (user decision
// 2026-10-26); the default connection; the reach sentences.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { linkPlugin } from '../src/core/plugin-store.mjs';
import { createProfile } from '../src/core/plugin-config.mjs';
import { readPluginsLock, writePluginsLock } from '../src/core/plugins-lock.mjs';
import { setBinding } from '../src/core/source-bindings.mjs';
import { PluginOpError } from '../src/core/plugin-shim.mjs';
import {
  EXPORT_TIMEOUT_MS, PROBE_TIMEOUT_MS, PROBE_RETRY_MS, exportTrackers, defaultConnection, reachReason, reachSentence, _resetExportCaches,
} from '../src/core/requirements/export.mjs';

useTempHome(after, 'worca-req-export-trackers-');
const JIRA_DIR = fileURLToPath(new URL('../plugins/jira-source', import.meta.url));
const MOCK_DIR = fileURLToPath(new URL('./fixtures/plugins/mock-source', import.meta.url));

/** A fake callSource answering capabilities per plugin; records every call. */
function fakeCall(answers) {
  const calls = [];
  const fn = async (o) => {
    calls.push(o);
    const a = answers[o.plugin];
    if (typeof a === 'function') return a(o);
    if (a instanceof Error) throw a;
    return a;
  };
  fn.calls = calls;
  return fn;
}

before(async () => {
  await linkPlugin('jira-source', JIRA_DIR);
  await linkPlugin('mock-source', MOCK_DIR);
});

test('no profile yet: a multi-profile source is no tracker (and is not even asked)', async () => {
  _resetExportCaches();
  const callSource = fakeCall({ 'jira-source': { writeBack: false, export: true }, 'mock-source': { writeBack: true } });
  assert.deepEqual(await exportTrackers({ callSource }), []);
  assert.deepEqual(callSource.calls.map((c) => c.plugin), ['mock-source']);
  assert.deepEqual(callSource.calls[0].args, { inputs: {} });
});

test('a source is a tracker when capabilities say export; probed with its first profile; the answer is cached', async () => {
  createProfile('jira-source', 'acme', 'acme.atlassian.net (Cloud)');
  createProfile('jira-source', 'beta', 'jira.beta.test (Data Center)');
  _resetExportCaches();
  const callSource = fakeCall({ 'jira-source': { writeBack: false, export: true }, 'mock-source': { writeBack: true } });
  const t = await exportTrackers({ callSource });
  assert.deepEqual(t, [{ plugin: 'jira-source', sourceId: 'jira', name: 'Jira', multiProfile: true,
    profiles: [{ id: 'acme', label: 'acme.atlassian.net (Cloud)' }, { id: 'beta', label: 'jira.beta.test (Data Center)' }] }]);
  assert.deepEqual(callSource.calls.map((c) => [c.plugin, c.op, c.profile, c.timeoutMs]),
    [['jira-source', 'capabilities', 'acme', PROBE_TIMEOUT_MS], ['mock-source', 'capabilities', undefined, PROBE_TIMEOUT_MS]]);
  await exportTrackers({ callSource });
  assert.equal(callSource.calls.length, 2, 'cached for the process');
});

test('every source is probed at once, each within 10 s: a slow connector does not hold the others up (D3)', async () => {
  _resetExportCaches();
  assert.deepEqual([PROBE_TIMEOUT_MS, PROBE_RETRY_MS], [10_000, 60_000]);
  let release;
  const gate = new Promise((r) => { release = r; });
  const callSource = fakeCall({ 'jira-source': async () => { await gate; return { export: true }; }, 'mock-source': { writeBack: true } });
  const pending = exportTrackers({ callSource });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(callSource.calls.map((c) => c.plugin), ['jira-source', 'mock-source'], 'both asked before the first answered');
  release();
  assert.deepEqual((await pending).map((x) => x.plugin), ['jira-source'], "listTaskSources' order is kept");
});

test('the cache is per installed version: a new version is asked again', async () => {
  _resetExportCaches();
  const callSource = fakeCall({ 'jira-source': { export: true }, 'mock-source': { writeBack: true } });
  await exportTrackers({ callSource });
  const lock = readPluginsLock();
  writePluginsLock({ ...lock, 'jira-source': { ...lock['jira-source'], version: '9.9.9' } });
  await exportTrackers({ callSource });
  assert.deepEqual(callSource.calls.filter((c) => c.plugin === 'jira-source').length, 2);
  writePluginsLock(lock);
});

test('a missing op means no export (cached); a failed probe is remembered for a minute, then asked again; any other answer is no', async () => {
  _resetExportCaches();
  let clock = 1_000_000;
  let jira = new PluginOpError('network', 'Jira unreachable: fetch failed');
  const callSource = fakeCall({ 'jira-source': () => { if (jira instanceof Error) throw jira; return jira; },
    'mock-source': new PluginOpError('unimplemented', 'connector does not implement op "capabilities"') });
  const d = { callSource, now: () => clock };
  const asked = () => callSource.calls.filter((c) => c.plugin === 'jira-source').length;
  assert.deepEqual(await exportTrackers(d), []);
  jira = { export: true };
  clock += 30_000;
  assert.deepEqual(await exportTrackers(d), [], 'within the minute the failure stands: no export for that connection');
  assert.equal(asked(), 1, 'and the source is not asked again');
  jira = { writeBack: true, export: 'yes' };
  clock += 31_000;
  assert.deepEqual(await exportTrackers(d), [], 'export must be true, not truthy');
  assert.equal(asked(), 2, 'asked again once the minute is over');
  jira = { export: true };
  clock += 61_000;
  assert.deepEqual(await exportTrackers(d), [], 'the "no" above was cached');
  _resetExportCaches();
  assert.deepEqual((await exportTrackers(d)).map((x) => x.plugin), ['jira-source']);
  assert.equal(callSource.calls.filter((c) => c.plugin === 'mock-source').length, 2, 'unimplemented was cached until the reset');
});

test('a single-profile source that can export is one connection named after it; a disabled plugin is left out', async () => {
  _resetExportCaches();
  const callSource = fakeCall({ 'jira-source': { export: true }, 'mock-source': { writeBack: true, export: true } });
  const t = await exportTrackers({ callSource });
  assert.deepEqual(t.map((x) => [x.plugin, x.name, x.multiProfile, x.profiles]), [
    ['jira-source', 'Jira', true, [{ id: 'acme', label: 'acme.atlassian.net (Cloud)' }, { id: 'beta', label: 'jira.beta.test (Data Center)' }]],
    ['mock-source', 'Mock Tasks', false, [{ id: null, label: 'Mock Tasks' }]],
  ]);
  const lock = readPluginsLock();
  writePluginsLock({ ...lock, 'mock-source': { ...lock['mock-source'], enabled: false } });
  assert.deepEqual((await exportTrackers({ callSource })).map((x) => x.plugin), ['jira-source']);
  writePluginsLock(lock);
});

test('defaultConnection (D2): the scope\'s bound profile, else the first tracker\'s first profile', () => {
  const trackers = [{ plugin: 'jira-source', sourceId: 'jira', name: 'Jira', multiProfile: true, profiles: [{ id: 'acme', label: 'a' }, { id: 'beta', label: 'b' }] },
    { plugin: 'mock-source', sourceId: 'mock', name: 'Mock Tasks', multiProfile: false, profiles: [{ id: null, label: 'Mock Tasks' }] }];
  const scope = { scopeType: 'project', scopeKey: 'shop-1' };
  assert.deepEqual(defaultConnection(scope, trackers), { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' });
  setBinding({ scopeType: 'project', scopeKey: 'shop-1', plugin: 'jira-source', sourceId: 'jira' }, 'beta');
  assert.deepEqual(defaultConnection(scope, trackers), { plugin: 'jira-source', sourceId: 'jira', profile: 'beta' });
  assert.deepEqual(defaultConnection({ scopeType: 'project', scopeKey: 'other' }, trackers.slice(1)), { plugin: 'mock-source', sourceId: 'mock', profile: null });
  assert.equal(defaultConnection(scope, []), null);
});

test('reach sentences (D11): the token, a minute, else the plugin\'s own words without the final period', () => {
  assert.equal(EXPORT_TIMEOUT_MS, 60_000);
  assert.equal(reachReason(new PluginOpError('auth', 'Jira token invalid or expired')), 'the API token was refused');
  assert.equal(reachReason(new PluginOpError('timeout', 'plugin "jira-source" op "createTicket" exceeded 60000ms (child killed)')), 'it did not answer within a minute');
  assert.equal(reachReason(new PluginOpError('network', 'Jira unreachable: fetch failed.')), 'Jira unreachable: fetch failed');
  assert.equal(reachSentence('Jira', new PluginOpError('auth', 'x')), 'Worca could not reach Jira: the API token was refused.');
});
