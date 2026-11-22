// test/mcp-store-members.test.mjs — MCP memberships (design §4.2–§4.5): values and secrets write semantics,
// the $env MCP_* rule, URL-safe secrets, the `pending` marker order, Team state, deleteMember, recordTest,
// testFingerprint.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshHomes, plain, put, disk, recordWrites } from './helpers/mcp-store-fixtures.mjs';
import { readMcpStore, createSet, putMember, deleteMember, recordTest, testFingerprint } from '../src/core/mcp/store.mjs';
import { validateMcpDefinition } from '../src/core/mcp/definitions.mjs';

freshHomes(after);
const S = 'plugin:acme-tools/sentry';
const TEAM = 'team-acme-platform-9333';
const def = validateMcpDefinition({
  type: 'http', url: ['https://mcp.x.dev/mcp?api_key=', { field: 'key' }],
  headers: { Authorization: { field: 'token', prefix: 'Bearer ' }, 'X-Org': { field: 'org' } },
  fields: [{ key: 'token', secret: true, required: true }, { key: 'key', secret: true, required: true }, { key: 'org', required: true }],
}, { name: 'sentry', source: 'plugin' }).def;
const status = (n) => ({ status: n });

test('a new member with secrets: base assigned, then sets (pending, old values), secrets, sets (new values)', async () => {
  await createSet('Billing');
  const writes = await recordWrites(() => putMember('billing', S, { values: { org: 'acme' }, secrets: { token: 'tok-1' } }, { def }));
  assert.deepEqual(writes.map((w) => w.file), ['servers', 'sets', 'secrets', 'sets']);
  assert.deepEqual(writes[0].json.bases, { [S]: 'sentry' });
  assert.deepEqual(writes[1].json.sets.billing.members, [{ server: S, enabled: true, values: {}, pending: true }]);
  assert.equal(writes[2].json.sets.billing[S].token.value, 'tok-1');
  assert.deepEqual(writes[3].json.sets.billing.members, [{ server: S, enabled: true, values: { org: 'acme' } }]);
});

test('an existing member: only the file that changes is written; the pending marker only when both change', async () => {
  await createSet('Billing');
  await putMember('billing', S, { values: { org: 'old' }, secrets: { token: 'tok-1' } }, { def });
  assert.deepEqual((await recordWrites(() => putMember('billing', S, { secrets: { token: 'tok-2' } }, { def }))).map((w) => w.file), ['secrets']);
  assert.deepEqual((await recordWrites(() => putMember('billing', S, { enabled: false }, { def }))).map((w) => w.file), ['sets']);
  assert.deepEqual(await recordWrites(() => putMember('billing', S, { values: { org: 'old' }, secrets: { token: { set: true, updatedAt: 'x' }, key: undefined } }, { def })), []);
  const both = await recordWrites(() => putMember('billing', S, { values: { org: 'new' }, secrets: { token: 'tok-3' } }, { def }));
  assert.deepEqual(both.map((w) => w.file), ['sets', 'secrets', 'sets']);
  assert.deepEqual(both[0].json.sets.billing.members[0], { server: S, enabled: false, values: { org: 'old' }, pending: true });
});

test('secrets: null clears, $env stored verbatim, $env only MCP_*, url secrets URL-safe, keys routed by the definition', async () => {
  await createSet('Billing');
  await putMember('billing', S, { secrets: { token: { $env: 'MCP_SENTRY_TOKEN' }, key: 'a.B_c~1-2' } }, { def });
  let sec = (await readMcpStore()).secrets.billing[S];
  assert.deepEqual(plain(sec.token.value), { $env: 'MCP_SENTRY_TOKEN' });
  assert.match(sec.token.updatedAt, /^\d{4}-\d\d-\d\dT/);
  await putMember('billing', S, { secrets: { key: null } }, { def });
  sec = (await readMcpStore()).secrets.billing[S];
  assert.deepEqual(Object.keys(sec), ['token']);
  const refused = [
    { secrets: { token: { $env: 'GITHUB_TOKEN' } } }, { secrets: { token: { $env: 'MCP_lower' } } },
    { secrets: { key: 'has space' } }, { secrets: { key: 'a/b' } }, { secrets: { token: '' } }, { secrets: { token: 5 } }, { secrets: { token: `tok${String.fromCharCode(0)}en` } },
    { secrets: { org: 'x' } }, { values: { token: 'x' } }, { values: { nope: 'x' } },
    { values: { org: 'org ghp_' + 'a'.repeat(36) } }, { values: { org: '{X}' } }, { values: 'x' }, { enabled: 'yes' }, { secrets: 5 }, { secrets: [] },
  ];
  for (const patch of refused) await assert.rejects(putMember('billing', S, patch, { def }), status(400), JSON.stringify(patch));
  await assert.rejects(putMember('billing', S, { values: { org: 'https://x.dev/?token=abc' } }, { def }), { message: 'values.org: looks like a secret — make this field secret' });
  await assert.rejects(putMember('billing', S, {}, {}), status(400));
  await assert.rejects(putMember('nope', S, {}, { def }), status(404));
  await putMember('billing', S, { values: { org: 'acme' } }, { def });
  await putMember('billing', S, { values: { org: null } }, { def });
  assert.deepEqual(plain((await readMcpStore()).sets.billing.members[0].values), {});
});

test('Team sets: the home is required; the first write persists the teams record with the member state and the Team secrets', async () => {
  await assert.rejects(putMember(TEAM, S, { enabled: true }, { def }), status(400));
  await assert.rejects(putMember(TEAM, S, { enabled: true }, { def, team: { home: 'other/home' } }), status(404));
  const writes = await recordWrites(() => putMember(TEAM, S, { enabled: true, values: { org: 'acme' }, secrets: { token: 't' } }, { def, team: { home: 'acme/platform' } }));
  assert.deepEqual(writes.map((w) => w.file), ['servers', 'sets', 'secrets', 'sets']);
  assert.equal(writes[1].json.teams['acme/platform'].members[S].pending, true);
  assert.deepEqual(disk('sets').teams, { 'acme/platform': { id: TEAM, slug: 'team-platfor', name: 'Team · acme/platform',
    members: { [S]: { enabled: true, values: { org: 'acme' }, seeded: {}, consent: null } } } });
  assert.equal(disk('secrets').sets[TEAM][S].token.value, 't');
  await assert.rejects(deleteMember(TEAM, S), status(400));
});

test('deleteMember: sets, then secrets, then tests', async () => {
  await createSet('Billing');
  await putMember('billing', S, { values: { org: 'acme' }, secrets: { token: 't' } }, { def });
  await recordTest('billing', S, { at: 'now', ok: true, tools: ['search'], error: null, fingerprint: 'f' });
  const writes = await recordWrites(() => deleteMember('billing', S));
  assert.deepEqual(writes.map((w) => w.file), ['sets', 'secrets', 'tests']);
  assert.deepEqual(writes[0].json.sets.billing.members, []);
  assert.deepEqual(writes[1].json.sets, {});
  assert.deepEqual(writes[2].json.tests, {});
  await assert.rejects(deleteMember('billing', S), status(404));
  await assert.rejects(deleteMember('nope', S), status(404)); // a stale Settings tab: 404, never a TypeError
});

test('recordTest writes only its own entry, re-read under the lock: a Test finishing after an edit keeps the edit', async () => {
  await createSet('Billing');
  await putMember('billing', S, { values: { org: 'before' } }, { def });
  const result = { at: '2026-09-29T10:00:00.000Z', ok: true, tools: ['search_issues'], error: null, fingerprint: 'abc' };
  await putMember('billing', S, { values: { org: 'after' } }, { def }); // the edit lands while the Test runs
  const writes = await recordWrites(async () => assert.equal(await recordTest('billing', S, result), true));
  assert.deepEqual(writes.map((w) => w.file), ['tests']);
  assert.equal(disk('sets').sets.billing.members[0].values.org, 'after');
  assert.deepEqual(disk('tests').tests, { [`billing|${S}`]: result });
  assert.equal(await recordTest('billing', 'manual:gone', result), false);
  assert.equal(disk('tests').tests[`billing|manual:gone`], undefined);
});

test('testFingerprint: stable over key order; changes with definition, code, values or a secret\'s updatedAt; linked never matches', () => {
  const base = { def, code: '3f9c21a', values: { org: 'acme' }, secrets: { token: 't1' } };
  const fp = testFingerprint(base);
  assert.match(fp, /^[0-9a-f]{16}$/);
  assert.equal(testFingerprint({ ...base, def: JSON.parse(JSON.stringify(def)) }), fp);
  for (const change of [{ def: { ...def, description: 'x' } }, { code: '0000000' }, { code: null }, { values: { org: 'x' } }, { secrets: { token: 't2' } }]) {
    assert.notEqual(testFingerprint({ ...base, ...change }), fp, JSON.stringify(change));
  }
  assert.notEqual(testFingerprint({ ...base, code: 'linked' }), testFingerprint({ ...base, code: 'linked' }));
});

test('a member marked pending by an interrupted write stays pending until its next write clears it', async () => {
  put('sets', { sets: { billing: { name: 'Billing', slug: 'billing', members: [{ server: S, enabled: true, values: { org: 'a' }, pending: true }] } } });
  assert.equal((await readMcpStore()).sets.billing.members[0].pending, true);
  await putMember('billing', S, { values: { org: 'a' } }, { def });
  assert.deepEqual(disk('sets').sets.billing.members[0], { server: S, enabled: true, values: { org: 'a' } });
});

// ── secretVault on (file-backed OS-store fake): secrets are vault references, bound to SERVERID/FIELDKEY ──────────
const { readFileSync: vaultRead } = await import('node:fs');
const { isVaultRef } = await import('../src/core/secrets/refs.mjs');
const { file: storeFile, vaultOn, vaultOf } = await import('./helpers/mcp-store-fixtures.mjs');

test('flag on: a secret is stored as a vault reference, $env verbatim, the echo keeps the reference, a re-save leaves one entry', () => vaultOn(async () => {
  await createSet('Billing');
  await putMember('billing', S, { values: { org: 'acme' }, secrets: { token: 'tok-vault-0001', key: { $env: 'MCP_SENTRY_KEY' } } }, { def });
  const text = vaultRead(storeFile('secrets'), 'utf8');
  assert.ok(!text.includes('tok-vault-0001'));
  const sec = disk('secrets').sets.billing[S];
  assert.ok(isVaultRef(sec.token.value), sec.token.value);
  assert.deepEqual(sec.key.value, { $env: 'MCP_SENTRY_KEY' });
  assert.deepEqual((await vaultOf().list()).map((e) => [e.store, e.field]), [['mcp', `${S}/token`]]);
  await putMember('billing', S, { values: { org: 'beta' }, secrets: { token: { set: true } } }, { def });
  assert.equal(disk('secrets').sets.billing[S].token.value, sec.token.value, 'the echo keeps the reference');
  await putMember('billing', S, { secrets: { token: ` ${sec.token.value} ` } }, { def });
  assert.equal(disk('secrets').sets.billing[S].token.value, sec.token.value, 'a padded echo keeps the trimmed reference');
  assert.equal(await vaultOf().resolve(sec.token.value, { store: 'mcp', field: `${S}/token` }), 'tok-vault-0001', '… and its entry');
  await putMember('billing', S, { secrets: { token: 'tok-vault-0002' } }, { def });
  const next = disk('secrets').sets.billing[S].token.value;
  assert.ok(isVaultRef(next) && next !== sec.token.value);
  const list = await vaultOf().list();
  assert.deepEqual(list.map((e) => e.ref), [next], 'the old entry was released');
  assert.equal(await vaultOf().resolve(next, { store: 'mcp', field: `${S}/token` }), 'tok-vault-0002');
  await putMember('billing', S, { secrets: { token: null } }, { def });
  assert.equal((await vaultOf().list()).length, 0, 'a cleared secret leaves no entry');
}));

test('flag on: an MCP write inside a vault transaction is refused lock-order before it waits', () => vaultOn(async () => {
  await createSet('Billing');
  await vaultOf().transaction(async () => {
    await assert.rejects(putMember('billing', S, { secrets: { token: 'tok-x' } }, { def }), (err) => err.code === 'lock-order');
  });
}));
