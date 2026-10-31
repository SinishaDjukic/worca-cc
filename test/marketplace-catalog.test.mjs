// test/marketplace-catalog.test.mjs — the Browse catalogue model (marketplace P3, CONTRACT §3.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog, filterCatalog, groupCatalog, facetCounts, marketplaceHealth, shortDate, noteText } from '../ui/public/marketplace/catalog.mjs';
import { OFF, EXAMPLE, ROWS } from './helpers/marketplace-fixtures.mjs';

test('buildCatalog: one item per snapshot plugin in marketplace order; versions, install and update state, secrets, source', () => {
  const items = buildCatalog([OFF, EXAMPLE], ROWS);
  assert.deepEqual(items.map((i) => i.key), ['off/github-source', 'off/slack-chat', 'off/release-notes', 'example/bmf-models']);
  const [gh, slack, rn, bmf] = items;
  assert.deepEqual([gh.version, gh.installed, gh.update, gh.row, gh.iconKind, gh.secrets], ['0.2.0', true, { version: '0.3.0' }, ROWS[0], 'taskSources', ['token']]);
  assert.deepEqual([slack.version, slack.installed, slack.update, slack.row, slack.secrets], ['0.1.0', false, null, null, ['botToken', 'appToken']]);
  assert.deepEqual([rn.iconKind, rn.counts.agents, rn.counts.skills], ['mix', 2, 1]);
  assert.deepEqual([bmf.version, bmf.marketplace], ['16b6363', { id: 'example', name: 'example/worca-marketplace', stale: true, snapshotAt: '2026-09-03T12:00:00.000Z' }]);
  assert.deepEqual(gh.source, { repoUrl: OFF.url, subdir: 'plugins/github-source', sha: OFF.lastSync.sha,
    webUrl: `https://github.com/SinishaDjukic/worca-cc/tree/${OFF.lastSync.sha}/plugins/github-source` });
  assert.equal(gh.entry, OFF.plugins[0]);
  const [snap] = buildCatalog([OFF], [{ ...ROWS[0], contributions: { ...ROWS[0].contributions, agents: 2 } }]);
  assert.deepEqual([snap.iconKind, snap.counts.agents], ['taskSources', 0]);   // counts come from the snapshot, never the row
});

test('buildCatalog: the update shows only on the provenance marketplace; thin entries are tolerated', () => {
  const [mir] = buildCatalog([{ ...EXAMPLE, id: 'mirror', plugins: [OFF.plugins[0]] }], ROWS);
  assert.deepEqual([mir.installed, mir.row, mir.update, mir.version], [true, ROWS[0], null, '0.2.0']);
  const [thin] = buildCatalog([{ id: 'acme', name: 'acme', plugins: [{ name: 'x' }] }], []);
  assert.deepEqual([thin.version, thin.description, thin.source.sha, thin.source.webUrl, thin.iconKind, thin.marketplace.stale], [null, '', null, null, 'none', false]);
  const [flag] = buildCatalog([{ id: 'acme', name: 'acme', plugins: [{ name: 'x', installed: true }] }], []);
  assert.deepEqual([flag.installed, flag.row], [true, null]);
  const [sec] = buildCatalog([{ id: 'acme', name: 'acme', plugins: [{ name: 's', inventory: { taskSources: [{ id: 't', secrets: ['token'] }],
    chatChannels: [{ id: 'c', secrets: ['token', 'botToken'] }], modelSecrets: [{ key: 'apiKey', label: 'API key' }] } }] }], []);
  assert.deepEqual(sec.secrets, ['token', 'botToken', 'apiKey']);
  assert.deepEqual(buildCatalog([{ id: 'acme', name: 'acme' }], undefined), []);
});

test('filterCatalog: search name and description, Adds includes mixed plugins, From, Hide installed', () => {
  const items = buildCatalog([OFF, EXAMPLE], ROWS);
  const names = (f) => filterCatalog(items, f).map((i) => i.name);
  assert.deepEqual(names({ q: '  SLACK ' }), ['slack-chat']);
  assert.deepEqual(names({ q: 'agents and skill' }), ['release-notes']);
  assert.deepEqual(names({ adds: 'skills' }), ['release-notes']);
  assert.deepEqual(names({ from: 'example' }), ['bmf-models']);
  assert.deepEqual(names({ hideInstalled: true }), ['slack-chat', 'release-notes', 'bmf-models']);
  assert.deepEqual(names({ q: 'gitlab' }), []);
});

test('groupCatalog: kinds in KIND_ORDER, then Mixed, then Other; empty groups dropped; order kept inside a group', () => {
  const none = { ...OFF, id: 'z', plugins: [{ name: 'old-exporter', inventory: {} }] };
  assert.deepEqual(groupCatalog(buildCatalog([OFF, EXAMPLE, none], [])).map((g) => [g.key, g.title, g.items.map((i) => i.name)]), [
    ['taskSources', 'Task sources', ['github-source']], ['chatChannels', 'Chat channels', ['slack-chat']], ['models', 'Models', ['bmf-models']],
    ['mix', 'Mixed', ['release-notes']], ['none', 'Other', ['old-exporter']]]);
});

test('facetCounts: all, per kind (a mixed plugin counts in each of its kinds), per marketplace', () => {
  assert.deepEqual(facetCounts(buildCatalog([OFF, EXAMPLE], ROWS)), { all: 4,
    kinds: { taskSources: 1, chatChannels: 1, mcpServers: 0, models: 1, agents: 1, scripts: 0, skills: 1, workflows: 1 }, from: { off: 3, example: 1 } });
  assert.equal(facetCounts(filterCatalog(buildCatalog([OFF, EXAMPLE], ROWS), { from: 'example' })).all, 1);
});

test('marketplaceHealth (SM4: lastError non-null), shortDate and noteText (SM5)', () => {
  assert.deepEqual(marketplaceHealth([OFF, EXAMPLE]), { unreachable: 1, syncedAt: '2026-09-03T12:00:00.000Z' });
  assert.deepEqual(marketplaceHealth([OFF, { ...EXAMPLE, lastError: { message: 'branch "x" not found', code: 'SYNC_FAILED', at: 'z' } }]).unreachable, 1);
  assert.deepEqual(marketplaceHealth([{ id: 'n', plugins: [] }]), { unreachable: 0, syncedAt: null });
  const at = (y, m, d) => new Date(y, m - 1, d, 12).toISOString();   // local noon: the same calendar day in every zone
  const now = new Date(2031, 9, 20, 12).getTime();                    // a year the real clock is not in
  assert.deepEqual([shortDate(at(2031, 9, 3), now), shortDate(at(2030, 9, 3), now), shortDate(null, now), shortDate('nope', now)], ['Sep 3', 'Sep 3, 2030', '', '']);
  assert.equal(noteText('plugins/discretestack-models/worca-cc-plugin.json: models[0] ("discretestack-stable"): env key "CLAUDE_CODE_SUBAGENT_MODEL" is reserved — ignored'),
    'models[0] ("discretestack-stable"): env key "CLAUDE_CODE_SUBAGENT_MODEL" is reserved — ignored');
  assert.equal(noteText('worca-cc-marketplace.json: bad/entry — skipped'), 'worca-cc-marketplace.json: bad/entry — skipped');
});
