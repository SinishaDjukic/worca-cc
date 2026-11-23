// test/mcp-views.test.mjs — the read models behind Settings › MCP servers and the project MCP tab
// (spec §7, §8): list order, warning dot, Used by, member states, Team locks, secrets never out.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  buildSetsView, buildSetView, buildCatalogView, buildProjectAssignment, membershipKeys, teamSetsOf,
  getSetView, teamMemberRefusal,
} from '../src/core/mcp/views.mjs';
import { materializeCopy } from '../src/core/mcp/registry.mjs';
import { createSet, addManualServer, putMember } from '../src/core/mcp/store.mjs';
import { checkRows } from './helpers/rows.mjs';

useTempHome(after);

const NOW = Date.parse('2026-09-29T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();
const nul = (o) => Object.assign(Object.create(null), o);
const f = (key, label, extra = {}) => ({ key, label, secret: false, oauth: false, required: false, ...extra });
const SENTRY = { type: 'http', url: 'https://mcp.sentry.dev/mcp',
  headers: { Authorization: { field: 'token', prefix: 'Bearer ' }, 'X-Sentry-Org': { field: 'org' } },
  fields: [f('token', 'Sentry token', { secret: true, oauth: true, required: true }), f('org', 'Organization', { required: true })],
  description: 'Sentry issues and events' };
const JIRA = { type: 'stdio', command: 'node', args: ['./mcp/jira.mjs'],
  env: { JIRA_URL: { field: 'baseUrl' }, JIRA_TOKEN: { field: 'token' } },
  fields: [f('baseUrl', 'Jira URL', { required: true, default: 'https://acme.atlassian.net' }), f('token', 'API token', { secret: true, required: true })],
  description: 'Search and read Jira issues' };
const PLAYWRIGHT = { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp'], env: {}, fields: [], description: 'Drive a browser' };
const GITHUB = { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'],
  env: { GITHUB_HOST: { field: 'host' }, GITHUB_PERSONAL_ACCESS_TOKEN: { field: 'token' } },
  fields: [f('host', 'Host'), f('token', 'token', { secret: true, required: true })], description: 'Repos' };

const entry = (id, def, extra = {}) => {
  const [source, rest] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
  const name = rest.slice(rest.lastIndexOf('/') + 1);
  return { id, source, name, def, dir: source === 'plugin' ? '/p/acme-tools' : null, code: source === 'plugin' ? '3f9c21a' : null,
    pluginEnabled: true, base: name, provisional: false, ...(source === 'plugin' ? { plugin: rest.split('/')[0] } : {}),
    ...(source === 'policy' ? { home: rest.slice(0, rest.lastIndexOf('/')) } : {}), ...extra };
};
const CATALOG = [
  entry('manual:playwright', PLAYWRIGHT),
  entry('plugin:acme-tools/jira', JIRA),
  entry('plugin:acme-tools/sentry', SENTRY),
  entry('policy:acme/platform/github', GITHUB),
];
const TEAMS = [{ home: 'acme/platform', required: [
  { name: 'github', type: 'stdio', command: 'npx', values: { host: 'github.acme.io' } },
  { plugin: 'acme-tools', server: 'sentry', values: { org: 'acme' } },
] }];

function snapshot() {
  return {
    newer: false,
    bases: nul({}), manual: nul({}), policy: nul({}), retired: [],
    sets: nul({
      general: { name: 'General', members: [
        { server: 'plugin:acme-tools/jira', enabled: true, values: {} },
        { server: 'manual:playwright', enabled: true, values: {} }] },
      shop: { name: 'Shop', slug: 'shop', members: [] },
      billing: { name: 'Billing', slug: 'billing', members: [
        { server: 'plugin:acme-tools/sentry', enabled: true, values: { org: 'acme-billing' } },
        { server: 'plugin:acme-tools/jira', enabled: true, values: {} }] },
    }),
    teams: nul({
      'acme/platform': { id: 'team-acme-platform-9333', slug: 'team-platfor', name: 'Team · acme/platform',
        members: { 'policy:acme/platform/github': { enabled: true, values: { host: 'mine.acme.io' }, seeded: { host: 'github.acme.io' }, consent: 'h1' },
          'plugin:acme-tools/sentry': { enabled: false, values: { org: 'acme' }, seeded: {}, consent: null } } },
      'old/home': { id: 'team-old-home-1234', slug: 'team-home', name: 'Team · old/home', members: {} },
    }),
    projects: nul({ 'billing-1a2b3c4d': { sets: ['billing'], includeGeneral: false }, 'mobile-3c4d5e6f': { sets: ['shop'] } }),
    secrets: nul({
      general: { 'plugin:acme-tools/jira': { token: { value: 'jira-general-secret-1', updatedAt: daysAgo(40) } } },
      billing: { 'plugin:acme-tools/sentry': { token: { value: 'sntrys-billing-secret', updatedAt: daysAgo(31) } } },
      'team-acme-platform-9333': { 'policy:acme/platform/github': { token: { value: { $env: 'MCP_GH' }, updatedAt: daysAgo(1) } } },
    }),
    tests: nul({}),
  };
}
const PROJECTS = [{ key: 'billing-1a2b3c4d', name: 'billing' }, { key: 'mobile-3c4d5e6f', name: 'mobile' }, { key: 'shop-2b3c4d5e', name: 'shop' }];
function ctx(over = {}) {
  return { snapshot: snapshot(), catalog: CATALOG, teams: TEAMS, projects: PROJECTS,
    projectHomes: { 'billing-1a2b3c4d': 'acme/platform', 'shop-2b3c4d5e': null }, claudeNames: [],
    env: { MCP_GH: 'gh-token-from-env' }, platform: 'linux', execPath: '/usr/bin/node', worcaRoot: '/w', now: NOW, ...over };
}
const fingerprintOf = (e, values, secrets) => materializeCopy({ entry: e, values, secrets, copy: 'x', name: 'x' }, ctx()).fingerprint;

test('buildSetsView: order (General, user sets by name, Team sets), greyed homes, the warning dot (problems only), Used by per set kind', async () => {
  const v = buildSetsView(ctx());
  await checkRows([
    { name: 'set list order: General, user sets by name, then Team sets; a home that governs nothing here is greyed', run: () => {
      assert.deepEqual(v.sets.map((s) => [s.id, s.group, s.greyed]), [
        ['general', 'general', false], ['billing', 'set', false], ['shop', 'set', false],
        ['team-acme-platform-9333', 'team', false], ['team-old-home-1234', 'team', true]]);
      assert.equal(v.sets.find((s) => s.id === 'team-old-home-1234').serverCount, 0);
    } },
    { name: 'warning dot: a member with a problem marks its set; "not tested" alone does not', run: () => {
      const by = Object.fromEntries(v.sets.map((s) => [s.id, s.problem]));
      assert.equal(by.billing, true, 'billing · jira has no token');
      assert.equal(by.general, false);
      assert.equal(by.shop, false);
    } },
    { name: 'Used by: General = projects that include it; a user set = its projects; a Team set = projects following its home', run: () => {
      const used = Object.fromEntries(v.sets.map((s) => [s.id, s.usedBy.map((p) => p.name)]));
      assert.deepEqual(used.general, ['mobile', 'shop'], 'billing switched it off; a missing key or no entry ⇒ on');
      assert.deepEqual(used.billing, ['billing']);
      assert.deepEqual(used.shop, ['mobile']);
      assert.deepEqual(used['team-acme-platform-9333'], ['billing']);
    } },
  ]);
});

test('member cards: field states, secrets as { set, updatedAt, env? }, OAuth age, problem text', () => {
  const v = buildSetView(ctx(), 'billing');
  const sentry = v.members.find((m) => m.serverId === 'plugin:acme-tools/sentry');
  assert.equal(sentry.copy, 'sentry_billing');
  assert.equal(sentry.sourceLabel, 'acme-tools');
  assert.deepEqual(sentry.fields.find((x) => x.key === 'token').state, { set: true, updatedAt: daysAgo(31), old: true });
  assert.equal(sentry.fields.find((x) => x.key === 'org').value, 'acme-billing');
  assert.equal(sentry.problem, null);
  const jira = v.members.find((m) => m.serverId === 'plugin:acme-tools/jira');
  assert.equal(jira.reason, 'missing:token');
  assert.equal(jira.problem, 'API token not set');
  assert.equal(JSON.stringify(v).includes('sntrys-billing-secret'), false, 'a secret value never leaves');
  const gj = buildSetView(ctx(), 'general').members.find((m) => m.serverId === 'plugin:acme-tools/jira');
  assert.equal(gj.fields.find((x) => x.key === 'token').state.old, false, 'only an OAuth token ages into amber');
  const c = ctx();
  c.snapshot.sets.billing.members[0].pending = true;   // an interrupted two-file write (§4.5) runs nothing until rewritten
  const p = buildSetView(c, 'billing').members.find((m) => m.serverId === 'plugin:acme-tools/sentry');
  assert.deepEqual([p.enabled, p.reason], [false, 'off'], 'a pending member reads as off, as the resolver treats it');
});

test('test state: current, stale after a value or a secret change, tool too long', () => {
  const c = ctx();
  const e = CATALOG.find((x) => x.id === 'plugin:acme-tools/sentry');
  const long = 'x'.repeat(50);
  c.snapshot.tests['billing|plugin:acme-tools/sentry'] = { at: daysAgo(3), ok: true, tools: ['a', 'b', long], error: null,
    fingerprint: fingerprintOf(e, { org: 'acme-billing' }, c.snapshot.secrets.billing['plugin:acme-tools/sentry']) };
  const sentry = () => buildSetView(c, 'billing').members.find((x) => x.serverId === e.id);
  assert.deepEqual(sentry().test, { at: daysAgo(3), ok: true, tools: 3, error: null, stale: false });
  assert.deepEqual(sentry().tooLong, { limit: 64, tool: long });
  c.snapshot.sets.billing.members[0].values = { org: 'acme-other' };
  assert.equal(sentry().test.stale, true, 'a value change makes the result stale');
  c.snapshot.sets.billing.members[0].values = { org: 'acme-billing' };
  c.snapshot.secrets.billing['plugin:acme-tools/sentry'] = { token: { value: 'sntrys-billing-secret-2', updatedAt: daysAgo(0) } };
  assert.equal(sentry().test.stale, true, 'a secret Replace makes the result stale');
});

test('Team members: consent flag, never-consented reads as a choice, "Team suggests" only where the value differs', () => {
  const v = buildSetView(ctx(), 'team-acme-platform-9333');
  assert.equal(v.set.group, 'team');
  const gh = v.members.find((m) => m.serverId === 'policy:acme/platform/github');
  assert.equal(gh.team.consented, true);
  assert.deepEqual(gh.team.suggests, [{ key: 'host', value: 'github.acme.io' }]);
  assert.deepEqual(gh.fields.find((x) => x.key === 'token').state, { set: true, updatedAt: daysAgo(1), env: 'MCP_GH', old: false });
  const sentry = v.members.find((m) => m.serverId === 'plugin:acme-tools/sentry');
  assert.equal(sentry.team.consented, false);
  assert.equal(sentry.reason, 'needs-consent');
  assert.equal(sentry.problem, null, 'needs-consent is a choice, not a problem');
  assert.deepEqual(sentry.team.suggests, [], 'a value equal to the team value is not suggested');
});

test('teamSetsOf keeps a persisted record and computes provisional ones for new homes, in home order', () => {
  const s = snapshot();
  delete s.teams['acme/platform'];
  const t = teamSetsOf(s, [{ home: 'zeta/platform', required: [] }, ...TEAMS]);
  assert.deepEqual(t.map((x) => [x.name, x.slug, x.provisional, x.greyed]), [
    ['Team · acme/platform', 'team-platfor', true, false], ['Team · old/home', 'team-home', undefined, true],
    ['Team · zeta/platform', 'team-pl-042e', true, false]]);
  assert.equal(buildSetView({ ...ctx(), snapshot: s }, 'team-acme-platform-9333').members[0].provisional, true, 'its copies\' names are provisional');
  const two = { ...ctx(), snapshot: s, teams: [{ home: 'zeta/platform', required: [{ name: 'github' }] }, ...TEAMS],
    catalog: [...CATALOG, entry('policy:zeta/platform/github', GITHUB)] };
  const zeta = teamSetsOf(s, two.teams).find((x) => x.home === 'zeta/platform');
  assert.equal(buildSetView(two, zeta.id).members[0].copy, 'github_team-pl-042e', 'the card names the copy as the set list and Test do');
});

test('catalog view: source labels, In sets incl. Team sets, last tool count, badges, def only for manual rows', () => {
  const c = ctx({ claudeNames: ['playwright'], catalog: CATALOG.map((x) => (x.id === 'plugin:acme-tools/jira' ? { ...x, pluginEnabled: false } : x)) });
  c.snapshot.tests['general|manual:playwright'] = { at: daysAgo(5), ok: true, tools: ['a', 'b'], error: null, fingerprint: 'x' };
  c.snapshot.tests['shop|manual:playwright'] = { at: daysAgo(1), ok: true, tools: ['a', 'b', 'c'], error: null, fingerprint: 'x' };
  c.snapshot.tests['billing|manual:playwright'] = { at: daysAgo(0), ok: false, tools: [], error: 'boom', fingerprint: 'x' };
  c.snapshot.tests['general|plugin:acme-tools/jira'] = { at: daysAgo(2), ok: true, error: null, fingerprint: 'x' };   // a hand edit: no tools
  const v = buildCatalogView(c);
  const row = (id) => v.servers.find((s) => s.id === id);
  assert.deepEqual(v.servers.map((s) => s.sourceLabel), ['Manual', 'acme-tools', 'acme-tools', 'Team · acme/platform']);
  assert.deepEqual(row('plugin:acme-tools/sentry').inSets.map((s) => s.name), ['Billing', 'Team · acme/platform']);
  assert.equal(row('manual:playwright').tools, 3, 'the most recent passing test of any set');
  assert.equal(row('plugin:acme-tools/jira').tools, 0, 'a stored result without tools reads as none');
  assert.equal(row('manual:playwright').inClaudeConfig, true);
  assert.equal(row('plugin:acme-tools/jira').pluginDisabled, true);
  assert.ok(row('manual:playwright').def, 'manual rows carry their definition for Edit');
  assert.equal(row('plugin:acme-tools/sentry').def, undefined);
});

test('catalog view: needsSetup follows the set list\'s problem dot', () => {
  const c = ctx();
  const sets = buildSetsView(c).sets;
  const v = buildCatalogView(c);
  for (const e of v.servers) {
    const expected = e.inSets.some((x) => sets.find((s) => s.id === x.id).members
      .some((m) => m.serverId === e.id && (m.problem || m.test === 'failed')));
    assert.equal(e.needsSetup, expected, e.id);
  }
  assert.ok(v.servers.every((e) => typeof e.needsSetup === 'boolean'));
  const bad = ctx();
  bad.snapshot.tests['billing|plugin:acme-tools/sentry'] = { at: daysAgo(0), ok: false, tools: [], error: 'boom', fingerprint: 'x' };
  const row = (id) => buildCatalogView(bad).servers.find((s) => s.id === id);
  assert.equal(row('plugin:acme-tools/sentry').needsSetup, true, 'a failing test in a set it is in');
  assert.equal(row('manual:playwright').needsSetup, false);
});

test('project assignment: chips, Team chip, the zero-set flag and the Add set choices', () => {
  const c = ctx();
  const billing = buildProjectAssignment(c, 'billing-1a2b3c4d', { home: 'acme/platform' });
  assert.deepEqual(billing.sets, [{ id: 'billing', name: 'Billing' }]);
  assert.equal(billing.includeGeneral, false);
  assert.deepEqual(billing.team, { id: 'team-acme-platform-9333', name: 'Team · acme/platform', home: 'acme/platform' });
  assert.equal(billing.none, false);
  assert.deepEqual(billing.choices, [{ id: 'shop', name: 'Shop' }]);
  assert.equal(buildProjectAssignment(c, 'mobile-3c4d5e6f', null).includeGeneral, true, 'a missing key ⇒ on');
  c.snapshot.projects['shop-2b3c4d5e'] = { sets: [], includeGeneral: false };
  assert.equal(buildProjectAssignment(c, 'shop-2b3c4d5e', null).none, true);
  assert.equal(buildProjectAssignment(c, 'other-00000000', null).includeGeneral, true, 'no entry ⇒ General on');
  c.snapshot.projects['billing-1a2b3c4d'] = { sets: [], includeGeneral: false };
  assert.equal(buildProjectAssignment(c, 'billing-1a2b3c4d', { home: 'acme/platform' }).none, false, 'a Team set is a set');
});

test('membershipKeys walks the switched-on user and Team memberships', () => {
  assert.deepEqual(membershipKeys(ctx(), (id) => id.startsWith('plugin:acme-tools/') || id.startsWith('policy:')), [
    'general|plugin:acme-tools/jira', 'billing|plugin:acme-tools/sentry', 'billing|plugin:acme-tools/jira',
    'team-acme-platform-9333|policy:acme/platform/github'], 'a switched-off membership (the Team sentry) is left alone');
});

test('Team locks (§11.2): update only, no add or remove by hand, never-consented turns on only from the checklist', () => {
  const c = ctx();
  const T = 'team-acme-platform-9333';
  assert.deepEqual(teamMemberRefusal(c, T, 'policy:acme/platform/github', { enabled: false }), { home: 'acme/platform' });
  assert.deepEqual(teamMemberRefusal(c, T, 'plugin:acme-tools/sentry', { values: { org: 'x' } }), { home: 'acme/platform' });
  assert.equal(teamMemberRefusal(c, T, 'plugin:acme-tools/sentry', { enabled: true }).error, 'turn it on from the team checklist');
  assert.equal(teamMemberRefusal(c, T, 'policy:acme/platform/github', { enabled: true }).home, 'acme/platform', 'a consented member switches freely');
  assert.equal(teamMemberRefusal(c, T, 'manual:playwright', { enabled: true }).status, 409, 'not derived from policy');
  assert.equal(teamMemberRefusal(c, 'team-nope-0000', 'policy:acme/platform/github', {}).status, 404);
  assert.equal(teamMemberRefusal(c, 'team-old-home-1234', 'policy:acme/platform/github', {}).status, 409, 'a greyed set has no members');
});

test('getSetView over the real store: a stored secret reads as set, never as its value', async () => {
  const { id } = await createSet('Payments');
  const def = await addManualServer('pg', { type: 'stdio', command: 'npx', args: ['-y', 'pg-mcp'], env: { PGPASSWORD: { field: 'password' } },
    fields: [{ key: 'password', label: 'Password', secret: true, required: true }], description: 'pg' });
  await putMember(id, 'manual:pg', { enabled: true, values: {}, secrets: { password: 'hunter2-hunter2' } }, { def });
  const v = await getSetView(id);
  const m = v.members.find((x) => x.serverId === 'manual:pg');
  assert.equal(m.fields[0].state.set, true);
  assert.equal(JSON.stringify(v).includes('hunter2-hunter2'), false);
  assert.equal(await getSetView('nope'), null);
});
