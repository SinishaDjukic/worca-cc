// test/mcp-store-sets.test.mjs — MCP set operations (design §4.2, §4.5): rename, delete (sets first, then
// secrets and tests; id retired), duplicate (secrets first, then sets; Team source → user set), project
// assignments.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshHomes, plain, put, disk, recordWrites } from './helpers/mcp-store-fixtures.mjs';
import { readMcpStore, createSet, renameSet, deleteSet, duplicateSet, setProjectAssignment } from '../src/core/mcp/store.mjs';
import { teamRecord } from '../src/core/mcp/identity.mjs';

freshHomes(after);
const TEAM = 'team-acme-platform-9333';
const PG = 'manual:postgres-ro';
const GH = 'policy:acme/platform/github';
const sec = (value) => ({ value, updatedAt: '2026-09-01T00:00:00.000Z' });
function seed() {
  put('servers', { bases: { 'manual:playwright': 'playwright', [PG]: 'postgres-ro', [GH]: 'github' } });
  put('sets', {
    sets: {
      general: { name: 'General', members: [{ server: 'manual:playwright', enabled: true, values: {} }] },
      billing: { name: 'Billing', slug: 'billing', members: [{ server: PG, enabled: true, values: { database: 'postgresql://readonly@db/billing' } }] },
    },
    teams: { 'acme/platform': { id: TEAM, slug: 'team-platfor', name: 'Team · acme/platform',
      members: { [GH]: { enabled: true, values: { host: 'github.acme.io' }, seeded: {}, consent: 'h1' } } } },
    projects: { 'billing-1a2b3c4d': { sets: ['billing'], includeGeneral: false } },
  });
  put('secrets', { sets: { billing: { [PG]: { password: sec('pw') } }, [TEAM]: { [GH]: { token: sec('tok') } } } });
  put('tests', { tests: { [`billing|${PG}`]: { at: 't', ok: true, tools: ['query'], error: null, fingerprint: 'f' } } });
}

test('renameSet changes only the name; General and Team sets refuse', async () => {
  seed();
  await renameSet('billing', 'Billing EU');
  assert.deepEqual(plain((await readMcpStore()).sets.billing), { name: 'Billing EU', slug: 'billing', members: disk('sets').sets.billing.members });
  await assert.rejects(renameSet('general', 'All'), { status: 400 });
  await assert.rejects(renameSet(TEAM, 'Mine'), { status: 400 });
  await assert.rejects(renameSet('nope', 'X'), { status: 404 });
  await renameSet('billing', 'BILLING EU'); // its own name in another case
  assert.equal(disk('sets').sets.billing.name, 'BILLING EU');
  await createSet('Shop');
  await assert.rejects(renameSet('shop', 'billing eu'), { status: 409 });
});

test('deleteSet: sets first (set, project entries, id retired), then secrets, then tests; the id is never reused', async () => {
  seed();
  const writes = await recordWrites(() => deleteSet('billing'));
  assert.deepEqual(writes.map((w) => w.file), ['sets', 'secrets', 'tests']);
  assert.deepEqual(writes[0].json.retired, ['billing']);
  assert.deepEqual(writes[0].json.projects, { 'billing-1a2b3c4d': { sets: [], includeGeneral: false } });
  assert.deepEqual(Object.keys(writes[1].json.sets), [TEAM]);
  assert.deepEqual(writes[2].json.tests, {});
  assert.equal((await createSet('Billing')).id, 'billing-2');
  await assert.rejects(deleteSet('general'), { status: 400 });
  await assert.rejects(deleteSet(TEAM), { status: 400 });
  await assert.rejects(deleteSet('billing'), { status: 404 });
});

test('duplicateSet: secrets first, then sets; members, values and secrets copied under a new id and slug, tests not', async () => {
  seed();
  let dup;
  const writes = await recordWrites(async () => { dup = await duplicateSet('billing', 'Billing copy'); });
  assert.deepEqual(dup, { id: 'billing-copy', name: 'Billing copy', slug: 'billing-copy' });
  assert.deepEqual(writes.map((w) => w.file), ['secrets', 'sets']);
  const s = await readMcpStore();
  assert.deepEqual(plain(s.sets['billing-copy'].members), plain(s.sets.billing.members));
  assert.deepEqual(plain(s.secrets['billing-copy']), { [PG]: { password: sec('pw') } });
  assert.equal(s.tests[`billing-copy|${PG}`], undefined);
  await assert.rejects(duplicateSet('nope', 'X'), { status: 404 });
  const everyday = await duplicateSet('general', 'Everyday');
  assert.deepEqual(plain((await readMcpStore()).sets[everyday.id].members), [{ server: 'manual:playwright', enabled: true, values: {} }]);
});

test('duplicateSet of a Team set: a user set holding the Team set\'s current members with their values and secrets', async () => {
  seed();
  const team = { home: 'acme/platform', members: [GH, 'plugin:acme-tools/sentry'] };
  const dup = await duplicateSet(TEAM, 'Platform', { team });
  const s = await readMcpStore();
  assert.deepEqual(plain(s.sets[dup.id]), { name: 'Platform', slug: 'platform', members: [
    { server: GH, enabled: true, values: { host: 'github.acme.io' } },
    { server: 'plugin:acme-tools/sentry', enabled: false, values: {} },
  ] });
  assert.deepEqual(plain(s.secrets[dup.id]), { [GH]: { token: sec('tok') } });
  await assert.rejects(duplicateSet(TEAM, 'Again'), { status: 400 });
  await assert.rejects(duplicateSet(TEAM, 'Again', { team: { home: 'other/home', members: [] } }), { status: 404 });
  const provisional = teamRecord('other/home').id; // no teams record yet
  const fresh = await duplicateSet(provisional, 'Other', { team: { home: 'other/home', members: [GH] } });
  assert.deepEqual(plain((await readMcpStore()).sets[fresh.id].members), [{ server: GH, enabled: false, values: {} }]);
  put('sets', { sets: {}, teams: { 'acme/platform': { id: TEAM, slug: 'team-platfor', name: 'Team · acme/platform',
    members: { [GH]: { enabled: true, values: { host: 'old' }, seeded: {}, consent: 'h1', pending: true } } } } });
  const held = await duplicateSet(TEAM, 'Held', { team: { home: 'acme/platform', members: [GH] } });
  assert.equal((await readMcpStore()).sets[held.id].members[0].pending, true, 'an interrupted Team write stays skipped in the copy');
  const twice = await duplicateSet(TEAM, 'Twice', { team: { home: 'acme/platform', members: [GH, GH] } });
  assert.equal(disk('sets').sets[twice.id].members.length, 1, 'a server at most once per set');
});

test('setProjectAssignment: user sets only, deduplicated; includeGeneral a boolean', async () => {
  seed();
  await setProjectAssignment('shop-0badf00d', { sets: ['billing', 'billing'], includeGeneral: true });
  assert.deepEqual(disk('sets').projects['shop-0badf00d'], { sets: ['billing'], includeGeneral: true });
  for (const bad of [{ sets: ['general'], includeGeneral: true }, { sets: [TEAM], includeGeneral: true }, { sets: ['nope'], includeGeneral: true },
    { sets: [], includeGeneral: 'yes' }, { sets: 'billing', includeGeneral: true }]) {
    await assert.rejects(setProjectAssignment('shop-0badf00d', bad), { status: 400 }, JSON.stringify(bad));
  }
  await assert.rejects(setProjectAssignment('Not A Key', { sets: [], includeGeneral: true }), { status: 400 });
  const own = JSON.parse('{"sets":[{"toString":1}],"includeGeneral":true}'); // a JSON body: its own toString is no function
  await assert.rejects(setProjectAssignment('shop-0badf00d', own), { status: 400 });
});

test('a Duplicate that crashed after writing secrets: its orphan secrets never attach to the next set with that id', async () => {
  put('sets', { sets: { billing: { name: 'Billing', slug: 'billing', members: [{ server: PG, enabled: true, values: {} }] } } });
  put('secrets', { sets: { 'billing-copy': { [PG]: { password: sec('stale') } } } });
  const dup = await duplicateSet('billing', 'Billing copy');
  assert.equal(dup.id, 'billing-copy');
  assert.equal((await readMcpStore()).secrets['billing-copy'], undefined);
  assert.deepEqual(disk('secrets').sets, {});
});

// ── secretVault on: deleteSet releases its entries; duplicateSet copies into fresh entries ─────────────────────────
const { vaultOn, vaultOf } = await import('./helpers/mcp-store-fixtures.mjs');
const { isVaultRef } = await import('../src/core/secrets/refs.mjs');
const { putMember } = await import('../src/core/mcp/store.mjs');
const { validateMcpDefinition } = await import('../src/core/mcp/definitions.mjs');
const VDEF = validateMcpDefinition({ type: 'http', url: 'https://mcp.x.dev/mcp', headers: { Authorization: { field: 'token', prefix: 'Bearer ' } },
  fields: [{ key: 'token', secret: true, required: true }] }, { name: 'sentry', source: 'plugin' }).def;
const VS = 'plugin:acme-tools/sentry';

test('flag on: deleteSet leaves no vault entry; duplicateSet gives a different reference to the same value', () => vaultOn(async () => {
  await createSet('Billing');
  await putMember('billing', VS, { secrets: { token: 'tok-dup-0001' } }, { def: VDEF });
  const src = disk('secrets').sets.billing[VS].token.value;
  const copy = await duplicateSet('billing', 'Billing copy');
  const dup = disk('secrets').sets[copy.id][VS].token.value;
  assert.ok(isVaultRef(src) && isVaultRef(dup) && src !== dup);
  const field = `${VS}/token`;
  assert.equal(await vaultOf().resolve(dup, { store: 'mcp', field }), 'tok-dup-0001');
  await deleteSet('billing');
  assert.deepEqual((await vaultOf().list()).map((e) => e.ref), [dup], 'the source entry went with its set; the copy stays');
  await deleteSet(copy.id);
  assert.equal((await vaultOf().list()).length, 0);
}));
