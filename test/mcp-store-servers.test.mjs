// test/mcp-store-servers.test.mjs — manual definitions, removal everywhere, field migration (design §4.6),
// base assignment and the Team-state writers the team-policy consent actions use (§11.2).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshHomes, plain, put, disk, recordWrites } from './helpers/mcp-store-fixtures.mjs';
import {
  readMcpStore, addManualServer, addManualServers, editManualServer, removeServerEverywhere, migrateServerFields, assignBases,
  setTeamState, putPolicyServer, forgetTeamState, putMember, deleteSet, duplicateSet,
} from '../src/core/mcp/store.mjs';
import { validateMcpDefinition, defDigest } from '../src/core/mcp/definitions.mjs';

freshHomes(after);
const TEAM = 'team-acme-platform-9333';
const PG_RAW = {
  type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres', { field: 'database' }],
  env: { PGPASSWORD: { field: 'password' } },
  fields: [{ key: 'database', label: 'Database URL', required: true }, { key: 'password', label: 'Password', secret: true, required: true }],
  description: 'Read-only replica of the app database',
};
const sec = (value) => ({ value, updatedAt: 't' });
function seedMembers(server) {
  put('sets', {
    sets: {
      billing: { name: 'Billing', slug: 'billing', members: [{ server, enabled: true, values: { database: 'postgresql://ro@db/b', other: 'x' } }] },
      shop: { name: 'Shop', slug: 'shop', members: [{ server, enabled: true, values: { database: 'postgresql://ro@db/s' } }] },
    },
    teams: { 'acme/platform': { id: TEAM, slug: 'team-platfor', name: 'Team · acme/platform',
      members: { [server]: { enabled: true, values: { database: 'd' }, seeded: { database: 'd' }, consent: 'h' } } } },
  });
  put('secrets', { sets: { billing: { [server]: { password: sec('pw1') } }, [TEAM]: { [server]: { password: sec('pw2') } } } });
  put('tests', { tests: { [`billing|${server}`]: { ok: true }, [`shop|${server}`]: { ok: true }, [`${TEAM}|${server}`]: { ok: true } } });
}

test('addManualServer: validated, stored normalized, base assigned; refuses a base, a catalog name or an existing server', async () => {
  const def = await addManualServer('postgres-ro', PG_RAW);
  assert.deepEqual(plain(def), plain(validateMcpDefinition(PG_RAW, { name: 'postgres-ro', source: 'manual' }).def));
  assert.deepEqual(disk('servers').manual['postgres-ro'], plain(def));
  assert.equal(disk('servers').bases['manual:postgres-ro'], 'postgres-ro');
  await assert.rejects(addManualServer('bad', { ...PG_RAW, command: './x' }), (e) => e.status === 400 && e.errors.some((m) => /command/.test(m)));
  put('servers', { ...disk('servers'), bases: { ...disk('servers').bases, 'plugin:gone/jira': 'jira' } });
  await assert.rejects(addManualServer('jira', PG_RAW), { status: 409 });
  await assert.rejects(addManualServer('sentry', PG_RAW, { catalogNames: ['sentry'] }), { status: 409 });
  await assert.rejects(addManualServer('postgres-ro', PG_RAW), { status: 409 });
});

test('addManualServers: every name is checked first, then the whole list is written in one servers write; any refusal writes none', async () => {
  await addManualServer('postgres-ro', PG_RAW);
  put('servers', { ...disk('servers'), bases: { ...disk('servers').bases, 'plugin:gone/jira': 'jira' } });
  const before = JSON.stringify(disk('servers'));
  // The second name is taken: by a stored server, a catalog name, another id's base, or the list itself.
  await assert.rejects(addManualServers([{ name: 'fresh-a', def: PG_RAW }, { name: 'postgres-ro', def: PG_RAW }]), { status: 409 });
  await assert.rejects(addManualServers([{ name: 'fresh-a', def: PG_RAW }, { name: 'sentry', def: PG_RAW }], { catalogNames: ['sentry'] }), { status: 409 });
  await assert.rejects(addManualServers([{ name: 'fresh-a', def: PG_RAW }, { name: 'jira', def: PG_RAW }]), { status: 409 });
  await assert.rejects(addManualServers([{ name: 'fresh-a', def: PG_RAW }, { name: 'fresh-a', def: PG_RAW }]), { status: 409 });
  await assert.rejects(addManualServers([{ name: 'fresh-a', def: PG_RAW }, { name: 'bad', def: { ...PG_RAW, command: './x' } }]), { status: 400 });
  await assert.rejects(addManualServers([]), { status: 400 });
  assert.equal(JSON.stringify(disk('servers')), before);
  const writes = await recordWrites(() => addManualServers([{ name: 'fresh-a', def: PG_RAW }, { name: 'fresh-b', def: PG_RAW }]));
  assert.deepEqual(writes.map((w) => w.file), ['servers']);
  const s = disk('servers');
  assert.deepEqual(Object.keys(s.manual).filter((k) => k.startsWith('fresh-')), ['fresh-a', 'fresh-b']);
  assert.deepEqual([s.bases['manual:fresh-a'], s.bases['manual:fresh-b']], ['fresh-a', 'fresh-b']);
});

test('editManualServer: the name stays; a type switch migrates every membership — sets, then secrets, then the definition', async () => {
  const id = 'manual:postgres-ro';
  await addManualServer('postgres-ro', PG_RAW);
  seedMembers(id);
  const next = { type: 'http', url: 'https://pg.internal/mcp', headers: { 'X-Db': { field: 'database' }, 'X-Org': { field: 'org' } },
    fields: [{ key: 'database', secret: true, required: true }, { key: 'org', required: true }] };
  const writes = await recordWrites(() => editManualServer('postgres-ro', next));
  assert.deepEqual(writes.map((w) => w.file), ['sets', 'secrets', 'servers']);
  const s = await readMcpStore();
  assert.equal(s.manual['postgres-ro'].type, 'http');
  assert.deepEqual(plain(s.sets.billing.members[0].values), {}); // database flipped to secret; other gone
  assert.deepEqual(plain(s.teams['acme/platform'].members[id]), { enabled: true, values: {}, seeded: {}, consent: 'h' });
  assert.deepEqual(plain(s.secrets), {}); // password gone
  await assert.rejects(editManualServer('nope', next), { status: 404 });
  await assert.rejects(editManualServer('postgres-ro', { type: 'http' }), { status: 400 });
});

test('migrateServerFields: a key is kept only while it exists with the same secret flag, in every set incl. Team', async () => {
  const id = 'plugin:acme-tools/pg';
  seedMembers(id);
  const newDef = validateMcpDefinition({ ...PG_RAW, fields: [{ key: 'database', required: true }, { key: 'password', secret: true }, { key: 'extra', required: true }] },
    { name: 'pg', source: 'plugin' }).def;
  const writes = await recordWrites(() => migrateServerFields(id, validateMcpDefinition(PG_RAW, { name: 'pg', source: 'plugin' }).def, newDef));
  assert.deepEqual(writes.map((w) => w.file), ['sets']); // only `other` (gone) dropped; secrets unchanged
  const s = await readMcpStore();
  assert.deepEqual(plain(s.sets.billing.members[0].values), { database: 'postgresql://ro@db/b' });
  assert.equal(s.secrets.billing[id].password.value, 'pw1');
  const flipped = validateMcpDefinition({ ...PG_RAW, args: [], env: { PGDATABASE: { field: 'database' } },
    fields: [{ key: 'database', secret: true, required: true }, { key: 'password' }] }, { name: 'pg', source: 'plugin' }).def;
  await migrateServerFields(id, newDef, flipped);
  const t = await readMcpStore();
  assert.deepEqual(plain(t.sets.billing.members[0].values), {});
  assert.deepEqual(plain(t.teams['acme/platform'].members[id].seeded), {});
  assert.deepEqual(plain(t.secrets), {});
});

test('removeServerEverywhere: memberships, Team state, secrets, tests, then the definition; bases stay', async () => {
  const id = 'manual:postgres-ro';
  await addManualServer('postgres-ro', PG_RAW);
  seedMembers(id);
  const writes = await recordWrites(() => removeServerEverywhere(id));
  assert.deepEqual(writes.map((w) => w.file), ['sets', 'secrets', 'tests', 'servers']);
  const s = await readMcpStore();
  assert.deepEqual([s.sets.billing.members, s.sets.shop.members].map(plain), [[], []]);
  assert.deepEqual(plain(s.teams['acme/platform'].members), {});
  assert.deepEqual([plain(s.secrets), plain(s.tests), plain(s.manual)], [{}, {}, {}]);
  assert.equal(s.bases[id], 'postgres-ro');
  await addManualServer('postgres-ro', PG_RAW); // the same id may come back under its own base
  assert.equal(disk('servers').bases[id], 'postgres-ro');
  await putPolicyServer('acme/platform/github', { def: validateMcpDefinition(PG_RAW, { name: 'github', source: 'policy' }).def, hash: 'h' });
  await removeServerEverywhere('policy:acme/platform/github');
  assert.deepEqual(plain((await readMcpStore()).policy), {});
});

test('editManualServer with a stale expect is refused under the lock', async () => {
  await addManualServer('postgres-ro', PG_RAW);
  const before = defDigest((await readMcpStore()).manual['postgres-ro']);
  const first = { ...PG_RAW, description: 'first edit' };
  await editManualServer('postgres-ro', first);
  const next = { ...PG_RAW, description: 'second edit' };
  await assert.rejects(editManualServer('postgres-ro', next, { expect: before }), { status: 409, message: /postgres-ro changed since this card was made/ });
  assert.equal((await readMcpStore()).manual['postgres-ro'].description, 'first edit');
  const current = defDigest((await readMcpStore()).manual['postgres-ro']);
  await editManualServer('postgres-ro', next, { expect: current });
  assert.equal((await readMcpStore()).manual['postgres-ro'].description, 'second edit');
});

test('removeServerEverywhere with a stale expect is refused', async () => {
  await addManualServer('postgres-ro', PG_RAW);
  const before = defDigest((await readMcpStore()).manual['postgres-ro']);
  await editManualServer('postgres-ro', { ...PG_RAW, description: 'changed' });
  await assert.rejects(removeServerEverywhere('manual:postgres-ro', { expect: before }), { status: 409, message: /postgres-ro changed since this card was made/ });
  assert.ok((await readMcpStore()).manual['postgres-ro']);
  await assert.rejects(removeServerEverywhere('plugin:p/x', { expect: 'x' }), { status: 404 });
  const current = defDigest((await readMcpStore()).manual['postgres-ro']);
  await removeServerEverywhere('manual:postgres-ro', { expect: current });
  assert.equal((await readMcpStore()).manual['postgres-ro'], undefined);
});

test('assignBases persists only new names, in arrival order, and the Team records of the homes given', async () => {
  put('servers', { bases: { 'manual:linear': 'linear' } });
  assert.deepEqual(plain(await assignBases(['policy:acme/platform/linear', 'manual:linear', 'plugin:acme-tools/sentry'])),
    { 'plugin:acme-tools/sentry': 'sentry', 'policy:acme/platform/linear': 'platform-linear' });
  assert.deepEqual(await recordWrites(() => assignBases(['manual:linear'])), []);
  await assignBases([], { homes: ['acme/platform'] });
  await assignBases([], { homes: ['other/platform', 'acme/platform'] });
  const teams = disk('sets').teams;
  assert.deepEqual(teams['acme/platform'], { id: TEAM, slug: 'team-platfor', name: 'Team · acme/platform', members: {} });
  assert.match(teams['other/platform'].slug, /^team-pl-[0-9a-f]{4}$/); // the persisted team-platfor is taken
});

test('setTeamState and putPolicyServer: the P7 consent writes', async () => {
  put('servers', { manual: {}, bases: { 'manual:linear': 'linear' } });
  const def = validateMcpDefinition(PG_RAW, { name: 'linear', source: 'policy' }).def;
  await putPolicyServer('acme/platform/linear', { def, hash: 'abc' });
  const sv = disk('servers');
  assert.deepEqual({ ...sv.policy['acme/platform/linear'], installedAt: 'x' }, { def: plain(def), hash: 'abc', installedAt: 'x' });
  assert.equal(sv.bases['policy:acme/platform/linear'], 'platform-linear');
  await setTeamState('acme/platform', 'policy:acme/platform/linear', { consent: 'abc', values: { database: 'd' }, seeded: { database: 'd' } });
  await setTeamState('acme/platform', 'policy:acme/platform/linear', { enabled: true });
  assert.deepEqual(disk('sets').teams['acme/platform'], { id: TEAM, slug: 'team-platfor', name: 'Team · acme/platform',
    members: { 'policy:acme/platform/linear': { enabled: true, values: { database: 'd' }, seeded: { database: 'd' }, consent: 'abc' } } });
});

test('setTeamState and a Team Duplicate persist the base of a server id that has none (§4.4: every locked write)', async () => {
  const X = 'plugin:x/github';
  await setTeamState('acme/platform', X, { enabled: true, consent: 'h' });
  assert.equal(disk('servers').bases[X], 'github', 'Turn on pins the name the member runs under');
  put('servers', { bases: {} });
  await duplicateSet(TEAM, 'Mine', { team: { home: 'acme/platform', members: [X] } });
  assert.equal(disk('servers').bases[X], 'github', 'and so does a copy of the member');
});

test('forgetTeamState: one server (record kept) or the whole home (record dropped) — state, the Team set\'s secrets and tests', async () => {
  const a = 'policy:acme/platform/a';
  const b = 'policy:acme/platform/b';
  put('sets', { sets: {}, teams: { 'acme/platform': { id: TEAM, slug: 'team-platfor', name: 'Team · acme/platform', members: {
    [a]: { enabled: true, values: {}, seeded: {}, consent: 'h' }, [b]: { enabled: false, values: {}, seeded: {}, consent: null } } } } });
  put('secrets', { sets: { [TEAM]: { [a]: { token: sec('1') }, [b]: { token: sec('2') } } } });
  put('tests', { tests: { [`${TEAM}|${a}`]: { ok: true }, [`${TEAM}|${b}`]: { ok: true } } });
  await forgetTeamState('acme/platform', [a]);
  let s = await readMcpStore();
  assert.deepEqual(Object.keys(s.teams['acme/platform'].members), [b]);
  assert.deepEqual(Object.keys(s.secrets[TEAM]), [b]);
  assert.deepEqual(Object.keys(s.tests), [`${TEAM}|${b}`]);
  await assert.rejects(forgetTeamState('acme/platform', b), { status: 400 }); // one id as text would match by substring
  await forgetTeamState('acme/platform');
  s = await readMcpStore();
  assert.deepEqual([plain(s.teams), plain(s.secrets), plain(s.tests)], [{}, {}, {}]);
  await forgetTeamState('nobody/here');
});

test('hand edits below the top level never make a locked write throw', async () => {
  const id = 'plugin:acme-tools/pg';
  const def = validateMcpDefinition(PG_RAW, { name: 'pg', source: 'plugin' }).def;
  put('sets', {
    sets: { billing: { name: 'Billing', slug: 'billing', members: [{ server: id, enabled: true, values: 'oops' }] } },
    teams: { 'acme/platform': { id: TEAM, slug: 'team-platfor', name: 'Team · acme/platform', members: { [id]: 'bad' } } },
    projects: { 'billing-1a2b3c4d': null },
  });
  put('secrets', { sets: { billing: { [id]: 'x' } } });
  await migrateServerFields(id, def, def);
  await setTeamState('acme/platform', id, { enabled: true });
  await putMember('billing', id, { values: { database: 'postgresql://ro@db/b' }, secrets: { password: 'pw' } }, { def });
  await deleteSet('billing');
  const s = await readMcpStore();
  assert.deepEqual(plain(s.teams['acme/platform'].members[id]), { enabled: true, values: {}, seeded: {}, consent: null });
  assert.deepEqual([plain(s.projects), s.retired, plain(s.secrets)], [{}, ['billing'], {}]);
});
