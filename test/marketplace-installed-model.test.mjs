// test/marketplace-installed-model.test.mjs — what the Installed tab shows, as data (board 3.1, 3.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  versionOf, updateOf, needsSetup, problemsOf, attention, updatable, kindsMeta, policyItems, policySummary,
  findCatalogItem, goesAway, removeChanges, usedByRow, usedByNote, leftoverIconKind, glyphOf,
} from '../ui/public/marketplace/installed-model.mjs';
import { KINDS, MIX, NONE } from '../ui/public/marketplace/kinds.mjs';

const ZERO = { taskSources: 0, chatChannels: 0, mcpServers: 0, models: 0, agents: 0, scripts: 0, skills: 0, workflows: 0 };
const row = (name, extra = {}) => ({ name, version: '0.1.0', pinnedSha: 'a'.repeat(40), enabled: true, linked: false, broken: false,
  apiMismatch: null, pythonMissing: false, ignored: [], mcpSets: [], skillSets: [], contributions: { ...ZERO }, latest: null,
  setup: { ok: true, missing: [], noProfiles: [] }, notes: [], ...extra });
const L = (version, access = []) => ({ version, sha: 'b'.repeat(40), marketplace: 'worca-cc', access });
const SECRET = { kind: 'secret', id: 'github.webhookSecret', red: true };
const SLACK_SETUP = { ok: false, missing: [{ kind: 'chatChannel', id: 'slack', keys: ['botToken'] }], noProfiles: [] };
const MSG = 'built for plugin API 2; this version of worca requires plugin API 3 for agents and pipeline templates — update or reinstall the plugin (1 agent(s), 1 template(s) ignored)';

test('versionOf: the version, else the pinned sha7, else empty', () => {
  assert.equal(versionOf(row('a')), '0.1.0');
  assert.equal(versionOf(row('a', { version: null, pinnedSha: 'deadbeef99' })), 'deadbee');
  assert.equal(versionOf({ name: 'a' }), '');
});

test('updateOf: latest → from/to; review only when latest.access asks for something (L7); a linked plugin never updates', () => {
  assert.equal(updateOf(row('a')), null);
  assert.deepEqual(updateOf(row('a', { latest: L('0.1.1') })), { from: '0.1.0', to: '0.1.1', review: false });
  assert.deepEqual(updateOf(row('g', { version: '0.2.0', latest: L('0.3.0', [SECRET]) })), { from: '0.2.0', to: '0.3.0', review: true });
  assert.equal(updateOf(row('v', { latest: { version: null, sha: 'f00ba12345', marketplace: 'm', access: [] } })).to, 'f00ba12');
  assert.equal(updateOf(row('l', { linked: true, latest: L('9.0.0') })), null);
});

test('needsSetup: enabled and setup.ok === false (missing keys or no profile yet); a disabled plugin or a row without setup does not', () => {
  assert.equal(needsSetup(row('s', { setup: SLACK_SETUP })), true);
  assert.equal(needsSetup(row('s', { setup: { ok: false, missing: [], noProfiles: ['jira'] } })), true);
  assert.equal(needsSetup(row('s', { setup: SLACK_SETUP, enabled: false })), false);
  assert.equal(needsSetup(row('s', { setup: undefined })), false);
});

test('problemsOf: needs update WINS over broken (one chip); python and ignored add chips; the server text stays as lines', () => {
  assert.deepEqual(problemsOf(row('o', { broken: true, apiMismatch: { builtFor: 2, host: 3, agents: 1, workflows: 1, message: MSG } })),
    { chips: [{ key: 'api', label: 'Needs update', tone: 'warn' }], lines: [MSG] });
  assert.deepEqual(problemsOf(row('b', { broken: true })), { chips: [{ key: 'broken', label: 'Broken', tone: 'bad' }], lines: [] });
  assert.deepEqual(problemsOf(row('p', { pythonMissing: true, ignored: [
    { file: 'agents/x.md', reason: 'collides with a built-in agent' }, { file: 'workflows/y.json', reason: 'v1 steps template' }] })), {
    chips: [{ key: 'python', label: 'Python not found', tone: 'warn' }, { key: 'ignored', label: '2 ignored', tone: 'bad' }],
    lines: ['agents/x.md: collides with a built-in agent', 'workflows/y.json: v1 steps template'],
  });
  assert.deepEqual(problemsOf(row('fine')), { chips: [], lines: [] });
  assert.deepEqual(problemsOf({ name: 'bare' }), { chips: [], lines: [] });
});

test('attention: updates, then needs setup, then problems — alphabetical inside each, one entry per reason', () => {
  const plugins = [
    row('slack-chat', { setup: SLACK_SETUP }),
    row('github-source', { version: '0.2.0', latest: L('0.3.0', [SECRET]) }),
    row('discretestack-models'),
    row('atlassian-mcp', { latest: L('0.1.1') }),
    row('old', { broken: true, latest: L('2.0.0') }),
  ];
  assert.deepEqual(attention(plugins).map((i) => [i.reason, i.row.name]), [
    ['update', 'atlassian-mcp'], ['update', 'github-source'], ['update', 'old'], ['setup', 'slack-chat'], ['problem', 'old'],
  ]);
  assert.deepEqual(updatable(plugins), ['atlassian-mcp', 'github-source', 'old']);
  assert.deepEqual(attention(undefined), []);
});

test('kindsMeta: counted, lower-case kind words, "MCP" kept, KIND_ORDER; arrays count too', () => {
  const t = (s) => kindsMeta(s).map((m) => m.text);
  assert.deepEqual(t({ ...ZERO, mcpServers: 1 }), ['1 MCP server']);
  assert.deepEqual(t({ ...ZERO, models: 2 }), ['2 models']);
  assert.deepEqual(t({ ...ZERO, taskSources: 1 }), ['1 task source']);
  assert.deepEqual(t({ ...ZERO, chatChannels: 1 }), ['1 chat channel']);
  assert.deepEqual(t({ ...ZERO, agents: 1, scripts: 2 }), ['1 agent', '2 scripts']);
  assert.deepEqual(kindsMeta({ agents: 2, skills: 1, workflows: 1 }).map((m) => [m.kind, m.text]),
    [['agents', '2 agents'], ['skills', '1 skill'], ['workflows', '1 workflow']]);
  assert.deepEqual(t({ agents: ['issueTriager'], taskSources: ['github'], skills: [], workflows: [] }), ['1 task source', '1 agent']);
  assert.deepEqual(t({}), []);
});

test('policyItems: missing / outdated / disabled from the policy, ok + needs setup from the row join, blocked last', () => {
  const scopes = { requirements: [
    { name: 'azure-boards-source', marketplace: 'worca-cc', minVersion: '0.1.0', state: 'missing', installed: null, homes: ['acme/gw'] },
    { name: 'jira', marketplace: '', minVersion: '2.0.0', state: 'outdated', installed: { version: '1.0.0', enabled: true }, homes: ['acme/gw'] },
    { name: 'teams-chat', minVersion: null, state: 'disabled', homes: ['acme/gw'] },
    { name: 'slack-chat', minVersion: null, state: 'ok', homes: ['acme/gw'], config: { notifyChatIds: 'C07Q2M4KD1' } },
    { name: 'github-source', minVersion: null, state: 'ok', homes: ['acme/gw'] },
  ], blockedPlugins: [{ name: 'legacy', home: 'acme/gw' }, { name: 'legacy', home: 'acme/web' }] };
  const plugins = [row('slack-chat', { setup: SLACK_SETUP }), row('github-source')];
  const items = policyItems(scopes, plugins);
  assert.deepEqual(items.map((i) => [i.name, i.state, i.minVersion, i.marketplace]), [
    ['azure-boards-source', 'missing', '0.1.0', 'worca-cc'], ['jira', 'outdated', '2.0.0', ''], ['teams-chat', 'disabled', null, ''],
    ['slack-chat', 'needs-setup', null, ''], ['legacy', 'blocked', null, ''],
  ]);
  assert.deepEqual(items[3].config, { notifyChatIds: 'C07Q2M4KD1' });
  assert.deepEqual(policyItems(null, plugins), []);
  assert.equal(policySummary(items), '1 missing · 1 outdated · 1 disabled · 1 needs setup · 1 blocked');
  assert.equal(policySummary([{ state: 'missing' }, { state: 'missing' }, { state: 'needs-setup' }, { state: 'needs-setup' }]), '2 missing · 2 need setup');
});

test('findCatalogItem: the policy hint matches marketplace id, name or url; else the first snapshot listing the name; else null', () => {
  const item = (mid, mname, url) => ({ key: `${mid}/jira`, name: 'jira', iconKind: 'taskSources',
    marketplace: { id: mid, name: mname, stale: false, snapshotAt: null }, source: { repoUrl: url, subdir: 'plugins/jira', sha: 'a'.repeat(40), webUrl: null } });
  const cat = [item('one', 'One', 'https://x/one'), item('two', 'Two', 'https://x/two')];
  assert.equal(findCatalogItem(cat, 'jira', 'two').key, 'two/jira');
  assert.equal(findCatalogItem(cat, 'jira', 'Two').key, 'two/jira');
  assert.equal(findCatalogItem(cat, 'jira', 'https://x/two').key, 'two/jira');
  assert.equal(findCatalogItem(cat, 'jira', 'elsewhere').key, 'one/jira');
  assert.equal(findCatalogItem(cat, 'jira', '').key, 'one/jira');
  assert.equal(findCatalogItem(cat, 'nope', ''), null);
  assert.equal(findCatalogItem(undefined, 'jira', ''), null);
});

test('goesAway: one row per contribution of the installed inventory; counted rows when the inventory is unknown', () => {
  const inv = { taskSources: [{ id: 'github', displayName: 'GitHub Issues', secrets: [] }], chatChannels: [],
    mcpServers: [{ name: 'atlassian', type: 'http', url: 'https://mcp.atlassian.com/v1/sse' }], models: [{ id: 'm1' }],
    agents: [{ key: 'triager' }], scripts: [{ key: 'tidy' }], skills: ['release-style'], workflows: ['release-notes'] };
  assert.deepEqual(goesAway(inv, null).map((g) => [g.kind, g.text, g.id]), [
    ['taskSources', 'Task source', 'github'], ['mcpServers', 'MCP server', 'atlassian'], ['models', 'Model', 'm1'],
    ['agents', 'Agent', 'triager'], ['scripts', 'Script', 'tidy'], ['skills', 'Skill', 'release-style'], ['workflows', 'Workflow', 'release-notes'],
  ]);
  assert.deepEqual(goesAway(null, { ...ZERO, models: 2, mcpServers: 1 }).map((g) => [g.kind, g.text, g.id]),
    [['mcpServers', '1 MCP server', null], ['models', '2 models', null]]);
  assert.deepEqual(goesAway(null, undefined), []);
});

test('removeChanges: one row per MCP set and per skill set, naming what each loses', () => {
  assert.deepEqual(removeChanges(row('a', { mcpSets: ['Havn'], skillSets: ['Billing', 'Team · acme/platform'] }), { mcpServers: [{ name: 'atlassian' }], skills: ['deploy', 'grows'] }), [
    { set: 'Havn', text: 'loses the atlassian server with its values and secrets' },
    { set: 'Billing', text: 'loses the deploy, grows skills' },
    { set: 'Team · acme/platform', text: 'loses the deploy, grows skills' },
  ]);
  assert.deepEqual(removeChanges(row('b', { mcpSets: ['General'] }), { mcpServers: [{ name: 'jira' }, { name: 'confluence' }] }),
    [{ set: 'General', text: 'loses the jira, confluence servers with their values and secrets' }]);
  assert.deepEqual(removeChanges(row('c', { mcpSets: ['General'], skillSets: ['Billing'] }), null),
    [{ set: 'General', text: 'loses its servers with their values and secrets' }, { set: 'Billing', text: 'loses its skills' }]);
  assert.deepEqual(removeChanges(row('d', { skillSets: ['Billing'] }), { skills: ['deploy'] }), [{ set: 'Billing', text: 'loses the deploy skill' }]);
  assert.deepEqual(removeChanges({ name: 'x', contributions: {} }, null), []);
});

test('usedByRow / usedByNote: model selections as drawn (board 3.4); other references name what holds the contribution', () => {
  const sel = (id, count) => ({ kind: 'model-selection', contributionKind: 'models', contribution: id, label: id, count, href: '#models' });
  assert.deepEqual(usedByRow(sel('discretestack-stable', 2)), { kind: 'models', title: 'discretestack-stable', meta: 'Model · 2 pipeline selections', href: '#models' });
  assert.equal(usedByRow(sel('discretestack-stable-fast', 1)).meta, 'Model · 1 pipeline selection');
  // SM11: one row shape per kind (P1 pluginReferences, sorted by kind, label, contribution).
  assert.deepEqual(usedByRow({ kind: 'workflow', contributionKind: 'agents', contribution: 'triager', label: 'Docs Flow', count: 1, href: '#workflows/wf_docs' }),
    { kind: 'agents', title: 'triager', meta: 'Agent · in Docs Flow', href: '#workflows/wf_docs' });
  assert.deepEqual(usedByRow({ kind: 'active-workflow', contributionKind: 'workflows', contribution: 'Release notes', label: 'gateway', count: 1, href: '#new' }),
    { kind: 'workflows', title: 'Release notes', meta: 'Workflow · active in gateway', href: '#new' });
  assert.deepEqual(usedByRow({ kind: 'paused-run', contributionKind: 'workflows', contribution: 'Release notes', label: 'Release 1.2', count: 1, href: '#history/gateway-00000001/pl_7' }),
    { kind: 'workflows', title: 'Release notes', meta: 'Workflow · in paused run Release 1.2', href: '#history/gateway-00000001/pl_7' });
  assert.equal(usedByRow({ kind: 'paused-run', contributionKind: null, contribution: null, label: 'Release 1.2', count: 1 }).title, 'Release 1.2', 'defaults hold for a short row');
  assert.equal(usedByRow({ kind: 'workflow', contributionKind: 'agents', contribution: null, label: 'Docs Flow', count: 1 }).href, null);
  assert.equal(usedByNote([sel('a', 1), sel('b', 2)]), 'Clear those selections first.');
  assert.equal(usedByNote([sel('a', 1), { kind: 'workflow', label: 'Docs Flow' }]), 'Clear those first.');
});

test('leftoverIconKind: a snapshot that still lists the name decides the glyph; else none', () => {
  assert.equal(leftoverIconKind([{ name: 'telegram-chat', iconKind: 'chatChannels' }], 'telegram-chat'), 'chatChannels');
  assert.equal(leftoverIconKind([], 'telegram-chat'), 'none');
  assert.equal(leftoverIconKind(undefined, 'telegram-chat'), 'none');
  assert.deepEqual([glyphOf('chatChannels'), glyphOf('mix'), glyphOf('none')], [KINDS.chatChannels.glyph, MIX.glyph, NONE.glyph]);
});
