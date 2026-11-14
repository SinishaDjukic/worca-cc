// test/stillhet-market-map.test.mjs — slice 8 D4–D7: dev's GET /api/marketplaces and GET /api/plugins answers mapped to the
// prototype's Marketplace records (ui/public/stillhet/live/market-map.mjs), the one place dev's field names are read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marketOf, pluginsOf, kindOf, nameOf, brandOf, setupFieldsOf } from '../ui/public/stillhet/live/market-map.mjs';
import { githubWebUrl } from '../src/shared/plugin-access.mjs';

const SHA = 'a'.repeat(40), NOW = Date.parse('2026-11-14T12:00:00Z');
const inv = (o = {}) => ({ agents: [], scripts: [], taskSources: [], chatChannels: [], models: [], modelSecrets: [], mcpServers: [], skills: [], workflows: [], depCount: null, setupCommands: [], ...o });
const market = (o = {}) => ({ id: 'mkt-a', url: 'https://github.com/acme/market', name: 'Acme', ref: 'main', lastSync: { sha: SHA, at: '2026-11-14T11:55:00Z' }, lastError: null, plugins: [], ...o });
const snap = (name, o = {}) => ({ name, subdir: `plugins/${name}`, description: `${name} does things`, version: '0.1.0', notes: [], installed: false, inventory: inv(), ...o });
const row = (name, o = {}) => ({ name, version: '0.1.0', pinnedSha: 'b'.repeat(40), repo: 'https://github.com/acme/market', subdir: `plugins/${name}`, marketplace: 'mkt-a', enabled: true, linked: false, contributions: { agents: 0, scripts: 0, taskSources: 1, chatChannels: 0, models: 0, mcpServers: 0, skills: 0, workflows: 0 }, setup: { ok: true, missing: [], noProfiles: [] }, description: `${name} does things`, latest: null, ...o });

test('kindOf: the first non-zero contribution in the fixed order; workflows outrank agents; none is Skills', () => {
  assert.equal(kindOf({ workflows: 1, agents: 3 }), 'Workflows');
  assert.equal(kindOf({ taskSources: 1 }), 'Task sources');
  assert.equal(kindOf({ chatChannels: 1, mcpServers: 2 }), 'Chat channels');
  assert.equal(kindOf({ mcpServers: 2, agents: 1 }), 'MCP servers');
  assert.equal(kindOf({}), 'Skills');
});

test('nameOf: the one task source or chat channel names it, the plugin name otherwise', () => {
  assert.equal(nameOf(snap('jira-source', { inventory: inv({ taskSources: [{ id: 'jira', displayName: 'Jira', secrets: ['token'] }] }) })), 'Jira');
  assert.equal(nameOf(snap('two', { inventory: inv({ taskSources: [{ id: 'a', displayName: 'A' }, { id: 'b', displayName: 'B' }] }) })), 'two');
  assert.equal(nameOf(null, row('linked-one')), 'linked-one');
});

test('brandOf: a channel platform or a source id naming a known brand; empty otherwise', () => {
  assert.equal(brandOf(inv({ chatChannels: [{ id: 'main', displayName: 'Slack', platform: 'slack' }] })), 'brand-slack');
  assert.equal(brandOf(inv({ taskSources: [{ id: 'github-issues', displayName: 'Issues' }] })), 'brand-github');
  assert.equal(brandOf(inv({ taskSources: [{ id: 'azure', displayName: 'Azure' }] })), '');
  assert.equal(brandOf(undefined), '');
});

test('marketOf: the 7-character sha, the branch, builtin, the GitHub link and the sync words', () => {
  const m = marketOf(market({ builtin: true, ref: 'dev' }), NOW);
  assert.deepEqual(m, { id: 'mkt-a', name: 'Acme', url: 'github.com/acme/market', branch: 'dev', sha: 'aaaaaaa', synced: '5 minutes ago', builtin: true, webUrl: githubWebUrl('https://github.com/acme/market', SHA), error: '' });
  const never = marketOf(market({ url: '/tmp/folder', ref: undefined, lastSync: null, lastError: { message: 'unreachable', at: 'x' } }), NOW);
  assert.equal(never.branch, 'HEAD'); assert.equal(never.sha, ''); assert.equal(never.synced, 'never'); assert.equal(never.webUrl, null); assert.equal(never.error, 'unreachable'); assert.equal(never.builtin, false);
  assert.equal(marketOf(market({ lastSync: { sha: SHA, at: '2026-11-14T11:59:40Z' } }), NOW).synced, 'just now');
});

test('pluginsOf: update from latest.version, needsSetup from setup.ok false, one record per plugin across markets', () => {
  const jira = snap('jira-source', { inventory: inv({ taskSources: [{ id: 'jira', displayName: 'Jira', secrets: ['token'] }] }) });
  const markets = [market({ plugins: [jira, snap('free')] }), market({ id: 'mkt-b', name: 'B', url: 'https://github.com/b/b', plugins: [snap('jira-source'), snap('only-b')] })];
  const rows = [row('jira-source', { latest: { version: '0.2.0', sha: SHA, marketplace: 'mkt-a', access: [] }, setup: { ok: false, missing: [{ kind: 'taskSource', id: 'jira', keys: ['token'] }], noProfiles: [] } })];
  const out = pluginsOf(markets, rows, {});
  assert.deepEqual(out.map((p) => p.id), ['jira-source', 'free', 'only-b']);
  const j = out[0];
  assert.equal(j.update, '0.2.0'); assert.equal(j.needsSetup, true); assert.equal(j.installed, true); assert.equal(j.name, 'Jira'); assert.equal(j.kind, 'Task sources');
  assert.equal(j.market, 'mkt-a'); assert.deepEqual(j.adds, ['A task source: Jira']); assert.equal(j.ver, '0.1.0');
  assert.equal(out[2].market, 'mkt-b');
  assert.equal(out[1].installed, false); assert.equal(out[1].update, undefined); assert.equal(out[1].needsSetup, false); assert.equal(out[1].uses, undefined, 'dev has no usage figure (D7)');
});

test('pluginsOf: asks are the inventory secrets when not installed, the config labels when installed', () => {
  const s = snap('slack-chat', { inventory: inv({ chatChannels: [{ id: 'main', displayName: 'Slack', platform: 'slack', secrets: ['botToken', 'appToken'] }] }) });
  const [p] = pluginsOf([market({ plugins: [s] })], [], {});
  assert.deepEqual(p.asks, ['botToken', 'appToken']); assert.equal(p.brand, 'brand-slack'); assert.equal(p.kind, 'Chat channels');
  const cfg = { sources: [], channels: [{ id: 'main', schema: [{ key: 'botToken', label: 'Bot token', secret: true, required: true, advanced: false }, { key: 'x', label: 'X', required: false }], values: { botToken: { set: false } } }] };
  const [q] = pluginsOf([market({ plugins: [s] })], [row('slack-chat')], { 'slack-chat': cfg });
  assert.deepEqual(q.asks, ['Bot token']);
});

test('source.webUrl: githubWebUrl for a GitHub market (its full sha), null for a folder; a linked row is market linked', () => {
  const [p] = pluginsOf([market({ plugins: [snap('free')] })], [], {});
  assert.deepEqual(p.source, { repoUrl: 'https://github.com/acme/market', sha: SHA, subdir: 'plugins/free', webUrl: githubWebUrl('https://github.com/acme/market', SHA, 'plugins/free') });
  const [f] = pluginsOf([market({ url: '/tmp/m', plugins: [snap('free')] })], [], {});
  assert.equal(f.source.webUrl, null);
  const [l] = pluginsOf([], [row('mine', { marketplace: null, linked: true, repo: '/tmp/mine', subdir: '' })], {});
  assert.equal(l.market, 'linked'); assert.equal(l.installed, true); assert.equal(l.source.webUrl, null);
});

test('setupFieldsOf: required fields (advanced ones only while empty) of sources, channels and model secrets; set secrets marked', () => {
  const cfg = {
    sources: [{ id: 'main', multiProfile: false, profile: null, schema: [{ key: 'token', label: 'Token', secret: true, required: true, advanced: false }, { key: 'url', label: 'Site', required: true, advanced: true }, { key: 'opt', label: 'Opt', required: false }], values: { token: { set: true } } },
      { id: 'multi', multiProfile: true, profile: null, profiles: [], schema: [{ key: 'k', label: 'Key', required: true }], values: {} }],
    channels: [{ id: 'ch', schema: [{ key: 'bot', label: 'Bot token', secret: true, required: true }], values: { bot: { set: false } } }],
    models: { schema: [{ key: 'API_KEY', label: 'API key', secret: true, required: false }], values: { API_KEY: { set: false } } },
  };
  assert.deepEqual(setupFieldsOf(cfg), [
    { target: 'source', sourceId: 'main', key: 'token', label: 'Token', secret: true, set: true },
    { target: 'source', sourceId: 'main', key: 'url', label: 'Site', secret: false, set: false },
    { target: 'source', sourceId: 'multi', profile: null, key: 'k', label: 'Key', secret: false, set: false },
    { target: 'channel', channelId: 'ch', key: 'bot', label: 'Bot token', secret: true, set: false },
    { target: 'modelSecrets', key: 'API_KEY', label: 'API key', secret: true, set: false },
  ]);
  assert.deepEqual(setupFieldsOf({ ...cfg, models: { ...cfg.models, broker: { keyPage: null } } }).filter((f) => f.target === 'modelSecrets'), [], 'the broker holds model keys');
  assert.deepEqual(setupFieldsOf(null), []);
  const filled = { sources: [{ ...cfg.sources[0], values: { token: { set: true }, url: 'acme' } }] };
  assert.deepEqual(setupFieldsOf(filled).map((f) => f.key), ['token'], 'an advanced field once set stays with Settings');
  const bare = { sources: [{ id: 'multi', multiProfile: true, profile: null, profiles: [], schema: [{ key: 'opt', required: false }], values: {} }] };
  assert.deepEqual(setupFieldsOf(bare), [{ target: 'source', sourceId: 'multi', profile: null, key: '', label: 'A first profile for multi', secret: false, set: false, profileOnly: true }], 'no profile and nothing to type: it asks for the first profile');
});
