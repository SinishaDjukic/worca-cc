// test/mcp-resolve.test.mjs
// MCP registry §5.1–§5.3, §5.6, §5.7, §5.8: the pure resolver — which sets a target resolves to, which
// memberships start under which names, the skip reasons in table order, the caps, and the worked example.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMcpServers, teamMembers, skipMessage, skipReasonText, PROBLEM_REASONS } from '../src/core/mcp/registry.mjs';
import { secretEnvName } from '../src/core/mcp/identity.mjs';
import { testFingerprint } from '../src/core/mcp/store.mjs';

const EXEC = '/usr/bin/node';
const ROOT = '/opt/worca';
const LAUNCH = `${ROOT}/src/core/mcp/launch.mjs`;
const f = (key, o = {}) => ({ key, label: o.label ?? key, secret: !!o.secret, oauth: !!o.oauth, required: !!o.required,
  ...(o.default !== undefined ? { default: o.default } : {}) });
const nameOf = (id) => id.slice(id.lastIndexOf('/') + 1).replace(/^[a-z]+:/, '');
const cat = (id, def, o = {}) => ({ id, source: id.slice(0, id.indexOf(':')), name: nameOf(id), base: o.base ?? nameOf(id),
  provisional: !!o.provisional, dir: o.dir ?? null, code: o.code ?? null, pluginEnabled: o.pluginEnabled ?? true,
  def: { description: o.description ?? '', fields: [], ...def } });
const mem = (server, o = {}) => ({ server, enabled: o.enabled ?? true, values: o.values ?? {}, ...(o.pending ? { pending: true } : {}) });
const S = (value, updatedAt = '2026-09-20T00:00:00Z') => ({ value, updatedAt });
const P = (key, o = {}) => ({ kind: 'project', key, name: key, rank: 0, ...o });
const GENERAL = (...members) => ({ general: { name: 'General', members } });
function resolve(o) {
  return resolveMcpServers({
    surface: 'pipeline', targets: [], teams: {}, env: {}, platform: 'linux', execPath: EXEC, worcaRoot: ROOT,
    toolNameLimit: 128, taken: [], ...o,
    store: { catalog: [], bases: {}, sets: GENERAL(), teams: {}, projects: {}, secrets: {}, tests: {}, ...o.store },
  });
}
const PW = cat('manual:pw', { type: 'stdio', command: 'npx', args: ['-y', 'pw'] });
const WEB = cat('manual:web', { type: 'http', url: 'https://web.example/mcp' });
const names = (r) => r.copies.map((c) => c.name);
const reasons = (r) => r.skipped.map((s) => `${s.setId}|${s.serverId}:${s.reason}`);

// ── §5.8 worked example ──────────────────────────────────────────────────────────────────────────
const DIR = '/home/u/.worca-cc/plugins/acme-tools/versions/3f9c21a';
const GH = { name: 'github', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'],
  env: { GITHUB_HOST: 'github.acme.io', GITHUB_PERSONAL_ACCESS_TOKEN: { field: 'token' } },
  fields: [f('token', { secret: true, required: true })], description: 'GitHub Enterprise' };
const EXAMPLE = {
  catalog: [
    cat('manual:playwright', { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp'] }, { description: 'Browser automation' }),
    cat('manual:postgres-ro', { type: 'stdio', command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres', { field: 'database' }], env: { PGPASSWORD: { field: 'password' } },
      fields: [f('database', { label: 'Database URL', required: true }), f('password', { label: 'Password', secret: true, required: true })] },
    { description: 'Read-only replica of the app database' }),
    cat('plugin:acme-tools/jira', { type: 'stdio', command: 'node', args: ['./mcp/jira.mjs'],
      env: { JIRA_URL: { field: 'baseUrl' }, JIRA_TOKEN: { field: 'token' } },
      fields: [f('baseUrl', { label: 'Jira URL', required: true, default: 'https://acme.atlassian.net' }),
        f('token', { label: 'API token', secret: true, required: true })] },
    { dir: DIR, code: '3f9c21a', description: 'Search and read Jira issues' }),
    cat('plugin:acme-tools/sentry', { type: 'http', url: 'https://mcp.sentry.dev/mcp',
      headers: { Authorization: { field: 'token', prefix: 'Bearer ' }, 'X-Sentry-Org': { field: 'org' } },
      fields: [f('token', { label: 'Sentry token', secret: true, oauth: true, required: true }), f('org', { label: 'Organization', required: true })] },
    { dir: DIR, code: '3f9c21a', description: 'Sentry issues and events' }),
    cat('policy:acme/platform/github', { type: GH.type, command: GH.command, args: GH.args, env: GH.env, fields: GH.fields }, { description: GH.description }),
  ],
  bases: {},
  sets: {
    ...GENERAL(mem('plugin:acme-tools/jira'), mem('manual:playwright')),
    billing: { name: 'Billing', slug: 'billing', members: [
      mem('plugin:acme-tools/sentry', { values: { org: 'acme-billing' } }),
      mem('manual:postgres-ro', { values: { database: 'postgresql://readonly@db.internal/billing' } }),
      mem('plugin:acme-tools/jira')] },
    shop: { name: 'Shop', slug: 'shop', members: [
      mem('plugin:acme-tools/sentry', { values: { org: 'acme-shop' } }),
      mem('manual:postgres-ro', { values: { database: 'postgresql://readonly@db.internal/shop' } })] },
  },
  teams: { 'acme/platform': { id: 'team-acme-platform-9333', slug: 'team-platfor', name: 'Team · acme/platform',
    members: { 'policy:acme/platform/github': { enabled: true, values: {}, seeded: {}, consent: 'c0ffee' } } } },
  projects: { 'billing-1a2b3c4d': { sets: ['billing'], includeGeneral: false }, 'shop-5e6f7a8b': { sets: ['shop'], includeGeneral: true } },
  secrets: {
    general: { 'plugin:acme-tools/jira': { token: S('jira-general-token') } },
    billing: { 'plugin:acme-tools/sentry': { token: S('sntrys_billing_token') }, 'manual:postgres-ro': { password: S('pg-billing-password') } },
    shop: { 'plugin:acme-tools/sentry': { token: S('sntrys_shop_token') }, 'manual:postgres-ro': { password: S('pg-shop-password') } },
  },
  tests: {},
};
const TEAM = { home: 'acme/platform', required: [GH] };
const BILLING = 'billing-1a2b3c4d';
const SHOP = 'shop-5e6f7a8b';

test('§5.8 Ask turn: pinned billing + worktree shop — six copies, refs only in the entries, five secrets + MCP_TIMEOUT', () => {
  const r = resolve({
    surface: 'ask', copyCap: 12, mcpTimeoutMs: 15000, off: { sets: [], members: [] }, store: EXAMPLE,
    targets: [P(BILLING, { name: 'billing', route: 'pinned', rank: 0 }), P(SHOP, { name: 'shop', route: 'worktree', rank: 1 })],
    teams: { [BILLING]: TEAM, [SHOP]: TEAM },
  });
  assert.deepEqual(names(r), ['jira', 'playwright', 'postgres-ro_billing', 'postgres-ro_shop', 'sentry_billing', 'sentry_shop']);
  assert.deepEqual(r.grants, names(r).map((n) => `mcp__${n}`));
  assert.deepEqual(r.servers['postgres-ro_billing'], { type: 'stdio', command: EXEC,
    args: [LAUNCH, '--copy', 'postgres-ro_billing', '--env', 'PGPASSWORD', '--',
      'npx', '-y', '@modelcontextprotocol/server-postgres', 'postgresql://readonly@db.internal/billing'],
    env: { MCPCHILD_PGPASSWORD: '${MCPSECRET_590C7134}' } });
  assert.deepEqual(r.servers.sentry_billing, { type: 'http', url: 'https://mcp.sentry.dev/mcp',
    headers: { Authorization: 'Bearer ${MCPSECRET_2EB4507A}', 'X-Sentry-Org': 'acme-billing' } });
  assert.deepEqual(r.servers.jira, { type: 'stdio', command: EXEC,
    args: [LAUNCH, '--copy', 'jira', '--env', 'JIRA_URL,JIRA_TOKEN', '--', EXEC, `${DIR}/mcp/jira.mjs`],
    env: { MCPCHILD_JIRA_URL: 'https://acme.atlassian.net', MCPCHILD_JIRA_TOKEN: '${MCPSECRET_A41C6F76}' } });
  assert.deepEqual(r.servers.playwright.args, [LAUNCH, '--copy', 'playwright', '--', 'npx', '-y', '@playwright/mcp']);
  assert.equal(r.servers['postgres-ro_shop'].env.MCPCHILD_PGPASSWORD, '${MCPSECRET_CCEEA4F1}');
  assert.equal(r.servers.sentry_shop.headers.Authorization, 'Bearer ${MCPSECRET_250F6B8F}');
  assert.deepEqual(r.env, { MCPSECRET_250F6B8F: 'sntrys_shop_token', MCPSECRET_2EB4507A: 'sntrys_billing_token',
    MCPSECRET_590C7134: 'pg-billing-password', MCPSECRET_A41C6F76: 'jira-general-token', MCPSECRET_CCEEA4F1: 'pg-shop-password',
    MCP_TIMEOUT: '15000' });
  assert.deepEqual(r.secretValues, ['jira-general-token', 'pg-billing-password', 'pg-shop-password', 'sntrys_billing_token', 'sntrys_shop_token']);
  assert.deepEqual(r.skipped, [
    { setId: 'billing', setName: 'Billing', serverId: 'plugin:acme-tools/jira', copy: 'jira_billing', reason: 'missing:token' },
    { setId: 'team-acme-platform-9333', setName: 'Team · acme/platform', serverId: 'policy:acme/platform/github', copy: 'github_team-platfor', reason: 'missing:token' },
  ]);
  assert.equal(secretEnvName('github_team-platfor', 'token'), 'MCPSECRET_6C6DC2EE', 'the env name github would get');
  assert.deepEqual(r.sets, [
    { id: 'general', name: 'General', group: 'general', routes: [], members: 2, started: 2 },
    { id: 'billing', name: 'Billing', group: 'set', routes: [{ project: BILLING, route: 'pinned' }], members: 3, started: 2 },
    { id: 'shop', name: 'Shop', group: 'set', routes: [{ project: SHOP, route: 'worktree' }], members: 2, started: 2 },
    { id: 'team-acme-platform-9333', name: 'Team · acme/platform', group: 'team',
      routes: [{ project: BILLING, route: 'pinned' }, { project: SHOP, route: 'worktree' }], members: 1, started: 0 },
  ]);
  assert.deepEqual(r.copies.find((c) => c.name === 'jira').projects, [], 'General is nobody\'s in Ask');
  assert.deepEqual(r.copies.find((c) => c.name === 'sentry_billing'), { name: 'sentry_billing', copy: 'sentry_billing', setId: 'billing',
    setName: 'Billing', serverId: 'plugin:acme-tools/sentry', projects: [BILLING], description: 'Sentry issues and events',
    renamedFrom: null, provisional: false, untested: true, tools: null });
  assert.equal(skipMessage(r.skipped[0], EXAMPLE.catalog), 'jira in Billing skipped: API token not set');
  assert.equal(skipReasonText(r.skipped[0], EXAMPLE.catalog), 'API token not set');
  assert.deepEqual(r.disallowedTools, []);
  assert.deepEqual(r.skippedTools, []);
});

test('§5.8 workspace pipeline run on checkout: Shop\'s postgres-ro opted out, `jira` taken → `jira_w`, env name unchanged', () => {
  const r = resolve({
    surface: 'pipeline', copyCap: 24, store: EXAMPLE, optOut: ['shop|manual:postgres-ro'], taken: ['jira'],
    targets: [{ kind: 'workspace', id: 'checkout', name: 'checkout', rank: 0, members: [{ key: BILLING, name: 'billing' }, { key: SHOP, name: 'shop' }] }],
    teams: { 'ws:checkout': TEAM },
  });
  assert.deepEqual(names(r), ['jira_w', 'playwright', 'postgres-ro_billing', 'sentry_billing', 'sentry_shop']);
  assert.deepEqual(r.grants, ['mcp__jira_w', 'mcp__playwright', 'mcp__postgres-ro_billing', 'mcp__sentry_billing', 'mcp__sentry_shop']);
  assert.deepEqual(Object.keys(r.env), ['MCPSECRET_250F6B8F', 'MCPSECRET_2EB4507A', 'MCPSECRET_590C7134', 'MCPSECRET_A41C6F76']);
  assert.deepEqual(r.servers.jira_w.args.slice(0, 3), [LAUNCH, '--copy', 'jira_w']);
  assert.equal(r.servers.jira_w.env.MCPCHILD_JIRA_TOKEN, '${MCPSECRET_A41C6F76}');
  assert.deepEqual(r.copies[0], { name: 'jira_w', copy: 'jira', setId: 'general', setName: 'General', serverId: 'plugin:acme-tools/jira',
    projects: [SHOP], description: 'Search and read Jira issues', renamedFrom: 'jira', provisional: false, untested: true, tools: null });
  assert.deepEqual(r.copies.find((c) => c.name === 'sentry_shop').projects, [SHOP]);
  assert.deepEqual(reasons(r), ['billing|plugin:acme-tools/jira:missing:token', 'shop|manual:postgres-ro:opted-out',
    'team-acme-platform-9333|policy:acme/platform/github:missing:token']);
  assert.deepEqual(r.skipped.filter((s) => isProblem(s.reason)).map((s) => skipMessage(s, EXAMPLE.catalog)), [
    'jira in Billing skipped: API token not set', 'github in Team · acme/platform skipped: token not set']);
});
const isProblem = (reason) => PROBLEM_REASONS.has(reason) || PROBLEM_REASONS.has(reason.slice(0, reason.indexOf(':') + 1));

// ── §5.1 which sets ──────────────────────────────────────────────────────────────────────────────
const SETS = { ...GENERAL(mem('manual:pw')), a: { name: 'A', slug: 'a', members: [mem('manual:web')] }, b: { name: 'B', slug: 'b', members: [] } };
const ids = (r) => r.sets.map((s) => s.id);

test('project run: own(p) = Include General (missing ⇒ on) ∪ its sets, unknown ids ignored, ∪ its Team set', () => {
  const run = (assignment, teams = {}) => ids(resolve({ targets: [P('p1')], teams,
    store: { catalog: [PW, WEB], sets: SETS, projects: assignment ? { p1: assignment } : {} } }));
  assert.deepEqual(run(null), ['general'], 'no entry ⇒ General');
  assert.deepEqual(run({ sets: ['a'] }), ['general', 'a']);
  assert.deepEqual(run({ sets: ['a', 'gone'], includeGeneral: false }), ['a']);
  assert.deepEqual(run({ sets: [], includeGeneral: false }), [], 'no sets at all');
  const team = { home: 'acme/platform', required: [{ plugin: 'x', server: 'y' }] };
  assert.deepEqual(run({ sets: [], includeGeneral: false }, { p1: team }), ['team-acme-platform-9333'], 'a Team set with no member yet still counts');
  assert.deepEqual(run({ sets: [], includeGeneral: false }, { p1: { home: 'acme/platform', required: [] } }), [], 'no mcp.required entry ⇒ no Team set');
});

test('workspace run: members\' own sets, General when any member includes it, only the workspace policy\'s Team set', () => {
  const store = { catalog: [PW, WEB], sets: SETS, projects: { m1: { sets: ['a'], includeGeneral: false }, m2: { sets: ['b'], includeGeneral: false } } };
  const ws = (members, teams = {}) => resolve({ targets: [{ kind: 'workspace', id: 'w', name: 'w', rank: 0, members: members.map((key) => ({ key, name: key })) }], teams, store });
  assert.deepEqual(ids(ws(['m1', 'm2'])), ['a', 'b'], 'no member includes General');
  const withGeneral = ws(['m1', 'm3']);
  assert.deepEqual(ids(withGeneral), ['general', 'a'], 'm3 has no entry ⇒ includes General');
  assert.deepEqual(withGeneral.copies.find((c) => c.name === 'pw').projects, ['m3'], 'General is brought by m3 only');
  const memberTeam = { home: 'acme/billing', required: [{ plugin: 'x', server: 'y' }] };
  const wsTeam = { home: 'acme/platform', required: [{ plugin: 'x', server: 'y' }] };
  assert.deepEqual(ids(ws(['m1', 'm2'], { m1: memberTeam, 'ws:w': wsTeam })), ['a', 'b', 'team-acme-platform-9333'],
    'the workspace policy (a home the members may follow) — never a member\'s own');
  assert.deepEqual(ids(ws(['m1', 'm2'], { m1: memberTeam, 'ws:w': null })), ['a', 'b'], 'no policy home ⇒ no Team set');
});

test('Ask: General always; a project target brings its own Team set, a workspace target the workspace policy\'s', () => {
  const store = { catalog: [PW, WEB], sets: SETS, projects: { p1: { sets: ['a'], includeGeneral: false } } };
  const req = [{ plugin: 'x', server: 'y' }];
  const r = resolve({ surface: 'ask', store, targets: [P('p1', { route: 'pinned' }), { kind: 'workspace', id: 'w', name: 'w', route: 'worktree', rank: 1, members: [{ key: 'p1', name: 'p1' }] }],
    teams: { p1: { home: 'acme/one', required: req }, 'ws:w': { home: 'acme/two', required: req } } });
  assert.deepEqual(ids(r), ['general', 'a', 'team-acme-one-3d1c', 'team-acme-two-3865']);
  assert.deepEqual(ids(resolve({ surface: 'ask', store })), ['general'], 'nothing in play ⇒ General');
});

// ── §5.2, §5.3, §5.7 ─────────────────────────────────────────────────────────────────────────────
const TOK = cat('manual:tok', { type: 'stdio', command: 'srv', env: { T: { field: 'tok' } }, fields: [f('tok', { secret: true, required: true })] });

test('skip reasons 1–5 and 11 in table order, first match wins', () => {
  const plug = (enabled) => cat('plugin:acme/srv', { type: 'stdio', command: 'srv' }, { pluginEnabled: enabled });
  const team = (state, pluginEnabled = true) => resolve({ targets: [P('p1')], teams: { p1: { home: 'acme/platform', required: [{ plugin: 'acme', server: 'srv' }] } },
    store: { catalog: [plug(pluginEnabled)], teams: { 'acme/platform': { id: 'team-acme-platform-9333', slug: 'team-platfor', name: 'Team · acme/platform',
      members: state ? { 'plugin:acme/srv': state } : {} } } } });
  const user = (members, o = {}) => resolve({ targets: [P('p1')], ...o, store: { catalog: [plug(o.pluginEnabled ?? true), PW], sets: GENERAL(...members), ...o.store } });
  const cases = [
    ['missing-server', user([mem('manual:gone')]), 'missing-server'],
    ['plugin-disabled beats off', user([mem('plugin:acme/srv', { enabled: false })], { pluginEnabled: false }), 'plugin-disabled'],
    ['disabled Team member stays and says so', team({ enabled: true, values: {}, seeded: {}, consent: 'h' }, false), 'plugin-disabled'],
    ['never-consented Team member (default state)', team(null), 'needs-consent'],
    ['needs-consent beats off', team({ enabled: false, values: {}, seeded: {}, consent: null }), 'needs-consent'],
    ['consented, switched off', team({ enabled: false, values: {}, seeded: {}, consent: 'h' }), 'off'],
    ['switch off', user([mem('manual:pw', { enabled: false })]), 'off'],
    ['pending (members PUT in flight)', user([mem('manual:pw', { pending: true })]), 'off'],
    ['pending Team member (members PUT in flight)', team({ enabled: true, values: {}, seeded: {}, consent: 'h', pending: true }), 'off'],
    ['off beats opted-out', user([mem('manual:pw', { enabled: false })], { optOut: ['general|manual:pw'] }), 'off'],
    ['opted-out', user([mem('manual:pw')], { optOut: ['general|manual:pw'] }), 'opted-out'],
    ['name-taken', user([mem('manual:pw')], { taken: ['pw', 'pw_w'] }), 'name-taken'],
  ];
  for (const [what, r, reason] of cases) assert.equal(r.skipped[0]?.reason, reason, what);
  assert.equal(team({ enabled: true, values: {}, seeded: {}, consent: 'h' }).copies[0].name, 'srv_team-platfor', 'consented and on ⇒ starts');
});

test('§5.7 order among rows 7–14: missing before name-taken before untested; env-collision before cap', () => {
  const run = (o) => reasons(resolve({ targets: [P('p1')], ...o, store: { catalog: [TOK, PW], sets: GENERAL(mem('manual:tok'), mem('manual:pw')), ...o.store } }));
  assert.deepEqual(run({ taken: ['tok', 'tok_w'] }), ['general|manual:tok:missing:tok'], 'missing:<key> (7) before name-taken (11)');
  const withTok = { secrets: { general: { 'manual:tok': { tok: S('tok-secret-1') } } } };
  assert.deepEqual(run({ taken: ['tok', 'tok_w'], toolNameLimit: 64, store: withTok }),
    ['general|manual:pw:untested', 'general|manual:tok:name-taken'], 'name-taken (11) before untested (12)');
  const two = ['cwu4', 'c10bo'].map((n) => cat(`manual:${n}`, TOK.def));
  const r = resolve({ targets: [P('p1')], copyCap: 1, store: { catalog: two, sets: GENERAL(mem('manual:cwu4'), mem('manual:c10bo')),
    secrets: { general: { 'manual:cwu4': { tok: S('first-secret') }, 'manual:c10bo': { tok: S('second-secret') } } } } });
  assert.deepEqual([names(r), reasons(r)], [[], ['general|manual:c10bo:env-collision', 'general|manual:cwu4:env-collision']], 'env-collision (13) before cap (14)');
});

test('opt-out (pipelines) and chat choices (Ask): per membership, a set switches all its memberships, unknown entries ignored', () => {
  const store = { catalog: [PW, WEB], sets: { ...GENERAL(mem('manual:pw'), mem('manual:web')), a: { name: 'A', slug: 'a', members: [mem('manual:pw')] } },
    projects: { p1: { sets: ['a'] } } };
  const run = (o) => { const r = resolve({ targets: [P('p1')], store, ...o }); return [names(r), reasons(r)]; };
  assert.deepEqual(run({ optOut: ['general|manual:web', 'nope|manual:x'] }), [['pw', 'pw_a'], ['general|manual:web:opted-out']]);
  assert.deepEqual(run({ off: { sets: ['general'], members: [] } }), [['pw', 'pw_a', 'web'], []], 'pipelines ignore chat choices');
  assert.deepEqual(run({ surface: 'ask', optOut: ['a|manual:pw'] })[0], ['pw', 'pw_a', 'web'], 'Ask ignores the run opt-out');
  assert.deepEqual(run({ surface: 'ask', off: { sets: ['general', 'zzz'], members: [] } }),
    [['pw_a'], ['general|manual:pw:chat-off', 'general|manual:web:chat-off']]);
  assert.deepEqual(run({ surface: 'ask', off: { sets: [], members: ['a|manual:pw', 'x|y'] } }), [['pw', 'web'], ['a|manual:pw:chat-off']]);
});

test('no collapse: the same server in two sets runs as two copies; `_w` rename keeps the env name', () => {
  const store = { catalog: [TOK], sets: { ...GENERAL(mem('manual:tok')), a: { name: 'A', slug: 'a', members: [mem('manual:tok')] } },
    projects: { p1: { sets: ['a'] } }, secrets: { general: { 'manual:tok': { tok: S('general-secret') } }, a: { 'manual:tok': { tok: S('a-set-secret') } } } };
  const r = resolve({ targets: [P('p1')], store, taken: ['tok'] });
  assert.deepEqual(names(r), ['tok_a', 'tok_w']);
  assert.deepEqual(r.copies.map((c) => c.renamedFrom), [null, 'tok']);
  assert.deepEqual(r.env, { [secretEnvName('tok', 'tok')]: 'general-secret', [secretEnvName('tok_a', 'tok')]: 'a-set-secret' });
  // a hand-edited slug (`w`, or one another set holds) never gives two started copies one name: the later is name-taken
  const dup = resolve({ targets: [P('p1')], taken: ['pw'], store: { catalog: [PW],
    sets: { ...GENERAL(mem('manual:pw')), a: { name: 'A', slug: 'w', members: [mem('manual:pw')] } }, projects: { p1: { sets: ['a'] } } } });
  assert.deepEqual([names(dup), Object.keys(dup.servers), reasons(dup)], [['pw_w'], ['pw_w'], ['general|manual:pw:name-taken']]);
  // …and the copy that holds the name is the one the cap keeps (keep order), not the first set id: here the worse-ranked
  // set `a` would take `pw_x` and then lose it to the cap, leaving neither copy started
  const byRank = resolve({ surface: 'ask', copyCap: 2, targets: [P('p1', { route: 'pinned', rank: 0 }), P('p2', { route: 'worktree', rank: 1 })],
    store: { catalog: [PW, cat('manual:zzz', PW.def)], projects: { p1: { sets: ['b', 'c', 'd'] }, p2: { sets: ['a'] } }, sets: { ...GENERAL(),
      a: { name: 'A', slug: 'x', members: [mem('manual:pw')] }, b: { name: 'B', slug: 'x', members: [mem('manual:pw')] },
      c: { name: 'C', slug: 'c', members: [mem('manual:zzz')] }, d: { name: 'D', slug: 'd', members: [mem('manual:zzz')] } } } });
  assert.deepEqual([byRank.copies.map((c) => `${c.setId}:${c.name}`), reasons(byRank)],
    [['b:pw_x', 'c:zzz_c'], ['a|manual:pw:name-taken', 'd|manual:zzz:cap']]);
  // …before env-collision: two copies with one final name share its env names too, and one of them still starts
  const twoX = (server, o = {}) => ({ catalog: [TOK, PW], projects: { p1: { sets: ['a', 'b'], includeGeneral: false } }, ...o,
    sets: { ...GENERAL(), a: { name: 'A', slug: 'x', members: [mem(server)] }, b: { name: 'B', slug: 'x', members: [mem(server)] } } });
  const tokDup = resolve({ targets: [P('p1')], store: twoX('manual:tok',
    { secrets: { a: { 'manual:tok': { tok: S('a-set-secret') } }, b: { 'manual:tok': { tok: S('b-set-secret') } } } }) });
  assert.deepEqual([tokDup.copies.map((c) => `${c.setId}:${c.name}`), reasons(tokDup)], [['a:tok_x'], ['b|manual:tok:name-taken']]);
  // …and before untested: under the 64 limit the later copy is name-taken, whatever its Test
  const current = { at: 't', ok: true, tools: [], error: null, fingerprint: testFingerprint({ def: PW.def, code: null, values: {}, secrets: {} }) };
  const pwDup = resolve({ targets: [P('p1')], toolNameLimit: 64, store: twoX('manual:pw', { tests: { 'a|manual:pw': current } }) });
  assert.deepEqual([pwDup.copies.map((c) => `${c.setId}:${c.name}`), reasons(pwDup)], [['a:pw_x'], ['b|manual:pw:name-taken']]);
  // `worca` is reserved (§5.3, §9.2): a hand-edited base `worca` never takes the name of worca's own server
  const reserved = resolve({ surface: 'ask', store: { catalog: [cat('manual:x', PW.def, { base: 'worca' })], sets: GENERAL(mem('manual:x')) } });
  assert.deepEqual([names(reserved), reserved.copies[0].renamedFrom], [['worca_w'], 'worca']);
});

test('Team members: derived from the policy entries; values (policy seeds included) pass the joined-text check', () => {
  const inline = cat('policy:acme/platform/gh', { type: 'stdio', command: 'gh-mcp', args: [{ field: 'host', suffix: '{HOME}' }], fields: [f('host', { required: true })] });
  const state = (values) => ({ 'policy:acme/platform/gh': { enabled: true, values, seeded: values, consent: 'h' } });
  const run = (values) => resolve({ targets: [P('p1')], teams: { p1: { home: 'acme/platform', required: [{ name: 'gh' }] } },
    store: { catalog: [inline], teams: { 'acme/platform': { id: 'team-acme-platform-9333', slug: 'team-platfor', name: 'Team · acme/platform', members: state(values) } } } });
  assert.deepEqual(run({ host: 'gh.acme.io/' }).servers['gh_team-platfor'].args.at(-1), 'gh.acme.io/{HOME}');
  assert.deepEqual(reasons(run({ host: 'gh.acme.io$' })), ['team-acme-platform-9333|policy:acme/platform/gh:unsafe-text'], 'a policy seed ending in $');
});

test('teamMembers: plugin refs and inline names map to ids; not in the catalog ⇒ not a member; a disabled plugin stays; default state off; a malformed entry is none', () => {
  const catalog = [cat('plugin:acme-tools/sentry', {}, { pluginEnabled: false }), cat('policy:acme/platform/github', {})];
  const on = { enabled: true, values: { a: '1' }, seeded: {}, consent: 'h' };
  assert.deepEqual(teamMembers('acme/platform', [
    { plugin: 'acme-tools', server: 'sentry', values: { org: 'x' } }, { name: 'github' }, { name: 'linear' },
    { plugin: 'gone', server: 'x' }, { name: 'github' }, { plugin: 'acme-tools', server: { toString: 0 } }, { name: 7 }, null,
  ], catalog, { 'policy:acme/platform/github': on }), [
    { serverId: 'plugin:acme-tools/sentry', state: { enabled: false, values: {}, seeded: {}, consent: null } },
    { serverId: 'policy:acme/platform/github', state: on },
  ]);
  assert.deepEqual(teamMembers('acme/platform', undefined, catalog, undefined), []);
});

test('a Team set with no persisted record gets a provisional id, slug and name; its copies say so', () => {
  const r = resolve({ targets: [P('p1')], teams: { p1: { home: 'acme/platform', required: [{ name: 'gh' }] } },
    store: { catalog: [cat('policy:acme/platform/gh', { type: 'stdio', command: 'gh' })], sets: { ...GENERAL(), b: { name: 'B', slug: 'team-platfor', members: [] } } } });
  assert.equal(r.skipped[0].reason, 'needs-consent', 'a member of a never-written Team set starts off');
  assert.deepEqual(r.sets.map((s) => [s.id, s.name]), [['general', 'General'], ['team-acme-platform-9333', 'Team · acme/platform']]);
  assert.equal(r.skipped[0].copy, 'gh_team-pl-6513', 'the slug avoids one another set already holds');
  const base = resolve({ targets: [P('p1')], store: { catalog: [cat('manual:pw', PW.def, { provisional: true })], sets: GENERAL(mem('manual:pw')) } });
  assert.equal(base.copies[0].provisional, true, 'a base name not yet persisted');
});

test('env-collision: two survivors with the same env name are both skipped', () => {
  const two = ['cwu4', 'c10bo'].map((n) => cat(`manual:${n}`, TOK.def));
  assert.equal(secretEnvName('cwu4', 'tok'), secretEnvName('c10bo', 'tok'), 'a real 32-bit collision');
  const r = resolve({ targets: [P('p1')], store: { catalog: [...two, PW], sets: GENERAL(mem('manual:cwu4'), mem('manual:c10bo'), mem('manual:pw')),
    secrets: { general: { 'manual:cwu4': { tok: S('first-secret') }, 'manual:c10bo': { tok: S('second-secret') } } } } });
  assert.deepEqual(names(r), ['pw']);
  assert.deepEqual(reasons(r), ['general|manual:c10bo:env-collision', 'general|manual:cwu4:env-collision']);
  assert.deepEqual(r.env, {});
});

test('cap: project sets by target rank (best rank per set), then Team, then General — General dropped first', () => {
  const servers = ['s1', 's2', 's3'].map((n) => cat(`manual:${n}`, PW.def));
  const all = ['s1', 's2', 's3'].map((n) => mem(`manual:${n}`));
  const store = { catalog: [...servers, cat('plugin:x/y', PW.def)],
    sets: { ...GENERAL(...all), pin: { name: 'Pin', slug: 'pin', members: all }, wt: { name: 'Wt', slug: 'wt', members: all } },
    projects: { p1: { sets: ['pin'] }, p2: { sets: ['wt'] }, p3: { sets: ['pin'] } },
    teams: { 'acme/platform': { id: 'team-acme-platform-9333', slug: 'team-platfor', name: 'Team · acme/platform',
      members: { 'plugin:x/y': { enabled: true, values: {}, seeded: {}, consent: 'h' } } } } };
  const teams = { p2: { home: 'acme/platform', required: [{ plugin: 'x', server: 'y' }] } };
  const ask = resolve({ surface: 'ask', store, teams, copyCap: 5,
    targets: [P('p1', { route: 'pinned', rank: 0 }), P('p2', { route: 'worktree', rank: 1 }), P('p3', { route: 'worktree', rank: 2 })] });
  assert.deepEqual(names(ask), ['s1_pin', 's1_wt', 's2_pin', 's2_wt', 's3_pin'], 'Pin (best rank 0) before Wt (rank 1), inside a group by copy name');
  assert.deepEqual(ask.skipped.map((s) => `${s.copy}:${s.reason}`), ['s1:cap', 's2:cap', 's3:cap', 'y_team-platfor:cap', 's3_wt:cap'],
    'skipped is sorted by set id, then server id');
  const run = resolve({ targets: [P('p2')], store, teams, copyCap: 4 });
  assert.deepEqual(names(run), ['s1_wt', 's2_wt', 's3_wt', 'y_team-platfor'], 'pipelines: project sets, then Team, then General');
  assert.deepEqual(run.skipped.map((s) => `${s.copy}:${s.reason}`), ['s1:cap', 's2:cap', 's3:cap']);
});

test('tool names: untested only under the 64 limit; an over-long tool is withheld by its CLI-normalized name, the copy starts', () => {
  const def = { type: 'stdio', command: 'srv', fields: [f('a', { default: 'x' })] };
  const fp = (code) => testFingerprint({ def: { description: '', fields: [], ...def }, code, values: { a: 'x' }, secrets: {} });
  const long = 'list_all_open_issues_assigned_to.me_across_every_project!';
  const run = (limit, test, code = null) => resolve({ targets: [P('p1')], toolNameLimit: limit,
    store: { catalog: [cat('manual:srv', def, { code })], sets: GENERAL(mem('manual:srv')), tests: test ? { 'general|manual:srv': test } : {} } });
  const good = { at: 't', ok: true, tools: ['get', long], error: null, fingerprint: fp(null) };
  assert.deepEqual(reasons(run(64, null)), ['general|manual:srv:untested']);
  assert.deepEqual(reasons(run(64, { ...good, fingerprint: 'stale' })), ['general|manual:srv:untested']);
  assert.deepEqual(reasons(run(64, { ...good, ok: false, tools: [] })), ['general|manual:srv:untested'], 'a failed Test lists no tools');
  assert.deepEqual(reasons(run(64, { ...good, fingerprint: fp('linked') }, 'linked')), ['general|manual:srv:untested'], 'linked ⇒ always stale');
  assert.deepEqual(names(run(128, null)), ['srv'], 'under 128 an untested copy starts');
  const r = run(64, good);
  assert.deepEqual(names(r), ['srv']);
  assert.deepEqual([r.copies[0].untested, run(128, null).copies[0].untested, run(128, { ...good, fingerprint: 'stale' }).copies[0].untested], [false, true, true]);
  assert.deepEqual([r.copies[0].tools, run(128, null).copies[0].tools, run(128, { ...good, fingerprint: 'stale' }).copies[0].tools], [['get', long], null, null], 'tools only when the Test is current');
  const full = `mcp__srv__${long.replace(/[.!]/g, '_')}`;
  assert.ok(full.length > 64 && full.length <= 128);
  assert.deepEqual(r.disallowedTools, [full]);
  assert.deepEqual(r.skippedTools, [{ name: 'srv', tool: long, reason: `tool-name-too-long:${long}` }]);
  assert.deepEqual(run(128, good).disallowedTools, [], `${full.length} chars fit 128`);
});

test('MCP_TIMEOUT: Ask with ≥1 copy gets 15000 unless worca\'s own is an integer ≥1000; none without copies or without a surface default', () => {
  const store = { catalog: [PW], sets: GENERAL(mem('manual:pw')) };
  const t = (o) => resolve({ surface: 'ask', store, mcpTimeoutMs: 15000, ...o }).env.MCP_TIMEOUT;
  assert.equal(t({}), '15000');
  assert.equal(t({ env: { MCP_TIMEOUT: '40000' } }), '40000');
  assert.equal(t({ env: { MCP_TIMEOUT: '500' } }), '15000');
  assert.equal(t({ env: { MCP_TIMEOUT: '1500.5' } }), '15000', 'not an integer');
  assert.equal(t({ store: { catalog: [PW], sets: GENERAL() } }), undefined);
  assert.equal(resolve({ targets: [P('p1')], store, mcpTimeoutMs: null }).env.MCP_TIMEOUT, undefined);
});

test('determinism: shuffled input arrays (ranks kept) give byte-identical output', () => {
  const base = { surface: 'ask', copyCap: 12, mcpTimeoutMs: 15000, store: EXAMPLE, taken: [], off: { sets: [], members: ['shop|manual:postgres-ro', 'billing|x'] },
    targets: [P(BILLING, { route: 'pinned', rank: 0 }), P(SHOP, { route: 'worktree', rank: 1 })], teams: { [BILLING]: TEAM, [SHOP]: TEAM } };
  const rev = (a) => [...a].reverse();
  const shuffled = { ...base, targets: rev(base.targets), off: { sets: [], members: rev(base.off.members) },
    store: { ...EXAMPLE, catalog: rev(EXAMPLE.catalog),
      sets: Object.fromEntries(rev(Object.entries(EXAMPLE.sets)).map(([k, s]) => [k, { ...s, members: rev(s.members) }])) } };
  assert.equal(JSON.stringify(resolve(shuffled)), JSON.stringify(resolve(base)));
  // two Team sets with no persisted record whose slugs clash: named as a write would persist them (homes ascending)
  const gh = cat('plugin:x/gh', PW.def);
  const clash = { surface: 'ask', store: { catalog: [gh], sets: GENERAL() },
    targets: [P('p1', { rank: 0 }), P('p2', { rank: 1 })],
    teams: { p1: { home: 'zeta/platform', required: [{ plugin: 'x', server: 'gh' }] }, p2: { home: 'acme/platform', required: [{ plugin: 'x', server: 'gh' }] } } };
  const a = resolve(clash);
  assert.deepEqual(a.skipped.map((s) => s.copy), ['gh_team-platfor', 'gh_team-pl-042e']);
  assert.equal(JSON.stringify(resolve({ ...clash, targets: rev(clash.targets) })), JSON.stringify(a));
  // one project brought twice at the same rank (pinned and page): its route is picked the same way in any order
  const twice = { surface: 'ask', store: { catalog: [PW, WEB], sets: SETS, projects: { p1: { sets: ['a'] } } },
    targets: [P('p1', { route: 'pinned' }), P('p1', { route: 'page' })] };
  const t1 = resolve(twice);
  assert.deepEqual(t1.sets.find((s) => s.id === 'a').routes, [{ project: 'p1', route: 'page' }]);
  assert.equal(JSON.stringify(resolve({ ...twice, targets: rev(twice.targets) })), JSON.stringify(t1));
});

test('skipReasonText for every §5.7 reason, skipMessage around it, PROBLEM_REASONS (the "yes" column; env-denied: and missing: by prefix)', () => {
  const catalog = [TOK];
  for (const [reason, text, problem] of [
    ['missing-server', 'the server is no longer installed', true],
    ['plugin-disabled', 'plugin disabled', true],
    ['needs-consent', 'turn it on in the team checklist', false],
    ['off', 'off', false],
    ['opted-out', 'opted out for this run', false],
    ['chat-off', 'switched off for this chat', false],
    ['env-denied:GH_TOKEN', '$env variable GH_TOKEN is not an MCP_* name', true],
    ['missing:tok', 'tok not set', true],
    ['unsafe-text', 'a value would form "${" or a plain-text secret (a token, a URL password, a secret-named query parameter) with the text around it', true],
    ['invalid-url', 'its URL is not https (or loopback http), a secret sits outside its path or query or is not URL-safe (letters, digits, . _ ~ -), or it holds a password or a secret-named query parameter in plain text', true],
    ['command-not-found', 'command not found on PATH', true],
    ['win-shim-unsupported', 'PowerShell scripts are not supported — use the package\'s node entry point', true],
    ['win-cmd-metachar', 'an argument holds a character cmd.exe would interpret (& | < > ^ % " !)', true],
    ['name-taken', 'its name and the name with _w are both taken by other MCP servers', true],
    ['untested', 'not tested — run Test so its tool names can be checked for this model', true],
    ['env-collision', 'its secret env name collides with another copy\'s', true],
    ['cap', 'over the MCP server limit for one spawn', true],
  ]) {
    assert.equal(skipReasonText({ serverId: 'manual:tok', reason }, catalog), text, reason);
    assert.equal(isProblem(reason), problem, reason);
  }
  assert.equal(skipMessage({ setName: 'Billing', serverId: 'manual:tok', reason: 'missing:tok' }, catalog), 'tok in Billing skipped: tok not set');
  assert.equal(skipMessage({ setName: 'General', serverId: 'manual:gone', reason: 'missing-server' }, catalog),
    'gone in General skipped: the server is no longer installed', 'an id no longer in the catalog is named by its last segment');
});
