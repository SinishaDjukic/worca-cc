// test/api-mcp.test.mjs — /api/mcp/* CRUD (spec §12): definitions, sets, duplicate, memberships,
// projects; id validation, refused body keys, null-prototype maps, secrets never in responses.
// Boots the real express app (imported => no port bind) against a sandboxed WORCA_HOME.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { appServer } from './helpers/app-server.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { fileURLToPath } from 'node:url';
import { readMcpStore, putPolicyServer, putMember } from '../src/core/mcp/store.mjs';
import { teamRecord } from '../src/core/mcp/identity.mjs';

useTempHome(after);

let srv, base;
const JSONH = { 'Content-Type': 'application/json' };
const call = async (method, p, b) => {
  const r = await fetch(`${base}${p}`, { method, ...(b !== undefined ? { headers: JSONH, body: JSON.stringify(b) } : {}) });
  const text = await r.text();
  return { status: r.status, text, body: text ? JSON.parse(text) : null };
};
const enc = encodeURIComponent;
const FIXTURE = fileURLToPath(new URL('./fixtures/mcp/stdio-server.mjs', import.meta.url));
const until = async (fn, ms = 10000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await new Promise((r) => setTimeout(r, 50))) { const v = await fn(); if (v) return v; }
  throw new Error('timed out');
};
const PG = { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres', { field: 'database' }],
  env: { PGPASSWORD: { field: 'password' } },
  fields: [{ key: 'database', label: 'Database URL', required: true }, { key: 'password', label: 'Password', secret: true, required: true }],
  description: 'Read-only replica' };

before(async () => {
  const { app } = await import('../ui/server.mjs');
  srv = appServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => { if (srv) await new Promise((r) => srv.close(r)); });

test('manual definitions: add, validate, refused keys, name taken, edit, plugin/policy refused', async () => {
  let r = await call('POST', '/api/mcp/servers', { name: 'postgres-ro', ...PG });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.id, 'manual:postgres-ro');
  r = await call('POST', '/api/mcp/servers', { name: 'postgres-ro', ...PG });
  assert.equal(r.status, 409);
  for (const k of ['hash', 'bases', 'consent', 'seeded']) {
    r = await call('POST', '/api/mcp/servers', { name: 'other', ...PG, [k]: 'x' });
    assert.equal(r.status, 400, k);
    assert.match(r.body.error, new RegExp(k));
  }
  r = await call('POST', '/api/mcp/servers/validate', { name: 'postgres-ro', ...PG, args: [{ field: 'password' }] });
  assert.equal(r.status, 200);
  assert.ok(r.body.errors.some((e) => /taken/.test(e)), 'the name check runs for a new server');
  assert.ok(r.body.errors.some((e) => /secret/.test(e)), 'a secret field cannot be an argument');
  r = await call('POST', '/api/mcp/servers/validate?edit=1', { name: 'postgres-ro', ...PG });
  assert.deepEqual(r.body.errors, [], 'Edit skips the name check');
  r = await call('PUT', `/api/mcp/servers/${enc('manual:postgres-ro')}`, { ...PG, description: 'Replica' });
  assert.equal(r.status, 200, r.text);
  assert.equal((await readMcpStore()).manual['postgres-ro'].description, 'Replica');
  r = await call('PUT', `/api/mcp/servers/${enc('manual:nope')}`, PG);
  assert.equal(r.status, 404);
  await putPolicyServer('acme/platform/github', { def: { ...PG, fields: [] , args: ['-y', 'gh'], env: {} }, hash: 'h' });
  for (const id of ['plugin:acme-tools/sentry', 'policy:acme/platform/github']) {
    r = await call('PUT', `/api/mcp/servers/${enc(id)}`, PG);
    assert.equal(r.status, 400, id);
  }
  r = await call('DELETE', `/api/mcp/servers/${enc('plugin:acme-tools/sentry')}`);
  assert.equal(r.status, 400, 'a plugin server leaves with its plugin');
  assert.equal((await call('DELETE', `/api/mcp/servers/${enc('manual:ghost')}`)).status, 404);
  r = await call('PUT', `/api/mcp/servers/${enc('manual:Bad Name')}`, PG);
  assert.equal(r.status, 400);
  const cat = await call('GET', '/api/mcp/servers');
  assert.deepEqual(cat.body.servers.map((s) => s.id), ['manual:postgres-ro', 'policy:acme/platform/github']);
});

test('sets: create, list, rename, General and Team refuse rename/delete, bad ids 400, 404s', async () => {
  let r = await call('POST', '/api/mcp/sets', { name: 'Billing' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.id, 'billing');
  r = await call('GET', '/api/mcp/sets');
  assert.deepEqual(r.body.sets.map((s) => s.id), ['general', 'billing']);
  r = await call('PUT', '/api/mcp/sets/billing', { name: 'Billing EU' });
  assert.equal(r.status, 200);
  for (const id of ['general', 'team-acme-platform-9333']) {
    assert.equal((await call('PUT', `/api/mcp/sets/${id}`, { name: 'X' })).status, 400, id);
    assert.equal((await call('DELETE', `/api/mcp/sets/${id}`)).status, 400, id);
  }
  assert.equal((await call('GET', '/api/mcp/sets/Bad_Id')).status, 400);
  assert.equal((await call('GET', '/api/mcp/sets/missing')).status, 404);
  assert.equal((await call('POST', '/api/mcp/sets', { name: 42 })).status, 400);
});

test('memberships: add, secrets never echoed, echo marker ignored, unknown server 404, Team DELETE refused', async () => {
  let r = await call('PUT', `/api/mcp/sets/billing/members/${enc('manual:postgres-ro')}`,
    { enabled: true, values: { database: 'postgresql://ro@db/billing' }, secrets: { password: 'pw-billing-12345' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.text.includes('pw-billing-12345'), false);
  r = await call('PUT', `/api/mcp/sets/billing/members/${enc('manual:postgres-ro')}`, { secrets: { password: { set: true } } });
  assert.equal(r.status, 200);
  const snap = await readMcpStore();
  assert.equal(snap.secrets.billing['manual:postgres-ro'].password.value, 'pw-billing-12345', 'the { set: true } echo keeps the secret');
  r = await call('GET', '/api/mcp/sets/billing');
  assert.equal(r.status, 200);
  assert.equal(r.text.includes('pw-billing-12345'), false, 'a secret value never leaves');
  assert.equal(r.body.members[0].fields.find((f) => f.key === 'password').state.set, true);
  r = await call('PUT', `/api/mcp/sets/billing/members/${enc('manual:ghost')}`, { enabled: true });
  assert.equal(r.status, 404);
  r = await call('PUT', `/api/mcp/sets/billing/members/${enc('manual:postgres-ro')}`, { enabled: 'yes' });
  assert.equal(r.status, 400);
  r = await call('PUT', `/api/mcp/sets/billing/members/${enc('manual:postgres-ro')}`, { secrets: { password: 7 } });
  assert.equal(r.status, 400);
  r = await call('PUT', `/api/mcp/sets/billing/members/${enc('manual:postgres-ro')}`, { values: { database: 5 } });
  assert.equal(r.status, 400);
  r = await call('DELETE', `/api/mcp/sets/team-acme-platform-9333/members/${enc('manual:postgres-ro')}`);
  assert.equal(r.status, 409);
});

test('a field key named like an Object.prototype member is plain data (own-property lookups)', async () => {
  let r = await call('POST', '/api/mcp/servers', { name: 'odd', type: 'stdio', command: 'npx', args: ['-y', 'odd', { field: 'constructor' }],
    fields: [{ key: 'constructor', label: 'Ctor', required: false }], description: 'odd' });
  assert.equal(r.status, 200, r.text);
  r = await call('PUT', `/api/mcp/sets/billing/members/${enc('manual:odd')}`, { enabled: true });
  assert.equal(r.status, 200, r.text);
  r = await call('GET', '/api/mcp/sets/billing');
  assert.equal(r.body.members.find((m) => m.serverId === 'manual:odd').fields[0].value, '', 'no inherited "constructor" value');
  r = await call('PUT', `/api/mcp/sets/billing/members/${enc('manual:odd')}`, { values: { constructor: 'x' } });
  assert.equal(r.status, 200, r.text);
  r = await call('GET', '/api/mcp/sets/billing');
  assert.equal(r.body.members.find((m) => m.serverId === 'manual:odd').fields[0].value, 'x');
  assert.equal((await call('DELETE', `/api/mcp/servers/${enc('manual:odd')}`)).status, 200);
});

test('duplicate copies members, values and secrets under a new id; the response carries no secret', async () => {
  const r = await call('POST', '/api/mcp/sets/billing/duplicate', { name: 'Shop' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.id, 'shop');
  assert.equal(r.text.includes('pw-billing-12345'), false, 'the response carries no secret');
  const snap = await readMcpStore();
  assert.equal(snap.sets.shop.members[0].server, 'manual:postgres-ro');
  assert.equal(snap.secrets.shop['manual:postgres-ro'].password.value, 'pw-billing-12345');
});

test('projects: assignment round trip, bad key 400, bad body 400, unknown set 400', async () => {
  const key = 'billing-1a2b3c4d';
  let r = await call('GET', `/api/mcp/projects/${key}`);
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.sets, r.body.includeGeneral, r.body.none], [[], true, false]);
  r = await call('PUT', `/api/mcp/projects/${key}`, { sets: ['billing'], includeGeneral: false });
  assert.equal(r.status, 200, r.text);
  r = await call('GET', `/api/mcp/projects/${key}`);
  assert.deepEqual(r.body.sets.map((s) => s.id), ['billing']);
  assert.equal(r.body.includeGeneral, false);
  assert.equal((await call('GET', '/api/mcp/projects/NOT_A_KEY')).status, 400);
  assert.equal((await call('PUT', `/api/mcp/projects/${key}`, { sets: 'billing', includeGeneral: true })).status, 400);
  assert.equal((await call('PUT', `/api/mcp/projects/${key}`, { sets: ['nope'], includeGeneral: true })).status, 400);
});

test('removing a manual server takes it out of every set with its secrets', async () => {
  const r = await call('DELETE', `/api/mcp/servers/${enc('manual:postgres-ro')}`);
  assert.equal(r.status, 200, r.text);
  const snap = await readMcpStore();
  assert.deepEqual(snap.sets.billing.members, []);
  assert.equal(snap.secrets.billing?.['manual:postgres-ro'], undefined);
  const v = await call('POST', '/api/mcp/servers/validate', { name: 'postgres-ro', ...PG });
  assert.deepEqual(v.body.errors, [], 'its own base stays reserved for it: the name can be added again, as P1 allows');
  assert.equal((await call('DELETE', '/api/mcp/sets/shop')).status, 200);
});

test('Team sets: members PUT runs the §11.2 locks; Duplicate needs a live Team set; a policy server no cached home requires is retired; bad member ids 400', async () => {
  let r = await call('POST', '/api/mcp/servers', { name: 'tm', type: 'stdio', command: 'npx', args: ['-y', 'tm'], env: {}, fields: [], description: 'tm' });
  assert.equal(r.status, 200, r.text);
  const { id } = teamRecord('old/home');   // persisted below; no cached home follows it, so it is greyed with no members
  await putMember(id, 'manual:tm', { values: {} }, { team: { home: 'old/home' }, def: (await readMcpStore()).manual.tm });
  r = await call('PUT', `/api/mcp/sets/${id}/members/${enc('manual:tm')}`, { enabled: true });
  assert.deepEqual([r.status, r.body.error], [409, 'Team set members come from team policy and cannot be added here']);
  assert.equal((await call('POST', `/api/mcp/sets/${id}/duplicate`, { name: 'Old copy' })).status, 404);
  assert.equal((await call('DELETE', `/api/mcp/servers/${enc('policy:acme/platform/github')}`)).status, 200, 'retired: Remove deletes it');
  assert.equal((await call('PUT', `/api/mcp/sets/billing/members/${enc('manual:Bad Name')}`, {})).status, 400);
});

test('Test route: runs and returns the result; a refusal answers 400/409 with its reason', async () => {
  await call('POST', '/api/mcp/sets', { name: 'Probe' });
  let r = await call('POST', '/api/mcp/servers', { name: 'fx', type: 'stdio', command: process.execPath, args: [FIXTURE, 'ok'],
    env: { FIXTURE_TOKEN: { field: 'token' } }, fields: [{ key: 'token', label: 'API token', secret: true, required: true }], description: 'fx' });
  assert.equal(r.status, 200, r.text);
  r = await call('PUT', `/api/mcp/sets/probe/members/${enc('manual:fx')}`, { enabled: true });
  assert.equal(r.status, 200);
  r = await call('POST', `/api/mcp/sets/probe/members/${enc('manual:fx')}/test`);
  assert.deepEqual([r.status, r.body.error], [400, 'fill in API token']);
  assert.equal((await readMcpStore()).tests['probe|manual:fx'], undefined, 'an incomplete Save starts no background Test');
  r = await call('POST', `/api/mcp/sets/probe/members/${enc('manual:fx')}/test`.replace('probe', 'Bad_Id'));
  assert.equal(r.status, 400);
});

test('background Test: a complete Save and a manual Edit definition each re-test the membership; off starts nothing', async () => {
  let r = await call('PUT', `/api/mcp/sets/probe/members/${enc('manual:fx')}`, { secrets: { token: 'tok-abcdefgh' } });
  assert.equal(r.status, 200);
  const first = await until(async () => (await readMcpStore()).tests['probe|manual:fx']);
  assert.equal(first.ok, true, first.error);
  r = await call('PUT', `/api/mcp/servers/${enc('manual:fx')}`, { type: 'stdio', command: process.execPath, args: [FIXTURE, 'ok'],
    env: { FIXTURE_TOKEN: { field: 'token' } }, fields: [{ key: 'token', label: 'API token', secret: true, required: true }], description: 'fx v2' });
  assert.equal(r.status, 200, r.text);
  const second = await until(async () => { const t = (await readMcpStore()).tests['probe|manual:fx']; return t.at !== first.at && t; });
  r = await call('PUT', `/api/mcp/sets/probe/members/${enc('manual:fx')}`, { enabled: false });
  assert.equal(r.status, 200);
  r = await call('PUT', `/api/mcp/sets/probe/members/${enc('manual:fx')}`, { secrets: { token: 'tok-ijklmnop' } });
  assert.equal(r.status, 200);
  r = await call('PUT', `/api/mcp/servers/${enc('manual:fx')}`, { type: 'stdio', command: process.execPath, args: [FIXTURE, 'ok'],
    env: { FIXTURE_TOKEN: { field: 'token' } }, fields: [{ key: 'token', label: 'API token', secret: true, required: true }], description: 'fx v3' });
  assert.equal(r.status, 200, r.text);
  await new Promise((done) => setTimeout(done, 1500));
  assert.equal((await readMcpStore()).tests['probe|manual:fx'].at, second.at,
    'switching a membership off, a Save while it is off and an Edit definition (or a plugin update) start no Test of it');
  r = await call('PUT', `/api/mcp/sets/billing/members/${enc('manual:fx')}`, { secrets: { token: 'tok-qrstuvwx' } });
  assert.equal(r.status, 200, r.text);
  const added = await until(async () => (await readMcpStore()).tests['billing|manual:fx']);
  assert.equal(added.ok, true, 'a membership a Save adds starts on (P1 putMember), so it is tested');
});

test('flag on: a pasted foreign vault reference is refused 400 VAULT_REF_REFUSED and secrets.json is unchanged', async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { writeFakeState } = await import('./helpers/os-store-fake.mjs');
  const { newVaultRef } = await import('../src/core/secrets/refs.mjs');
  const { mcpDir } = await import('../src/core/mcp/store.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'worca-api-mcp-vault-'));
  writeFakeState(join(dir, 'state.json'), { state: 'available' });
  const keep = { WORCA_FLAGS: process.env.WORCA_FLAGS, WORCA_TEST_OS_STORE: process.env.WORCA_TEST_OS_STORE };
  Object.assign(process.env, { WORCA_FLAGS: 'secretVault', WORCA_TEST_OS_STORE: join(dir, 'state.json') });
  try {
    let r = await call('POST', '/api/mcp/servers', { name: 'vref', ...PG });
    assert.equal(r.status, 200, r.text);
    const path = `/api/mcp/sets/general/members/${enc('manual:vref')}`;
    r = await call('PUT', path, { enabled: true, values: { database: 'postgresql://ro@db/v' }, secrets: { password: 'pw-vref-0001' } });
    assert.equal(r.status, 200, r.text);
    const bytes = readFileSync(join(mcpDir(), 'secrets.json'));
    r = await call('PUT', path, { secrets: { password: newVaultRef() } });
    assert.equal(r.status, 400, r.text);
    assert.equal(r.body.code, 'VAULT_REF_REFUSED');
    assert.match(r.body.error, /^The secret was not saved: /);
    assert.ok(!r.text.includes('worca:vault:'));
    assert.ok(readFileSync(join(mcpDir(), 'secrets.json')).equals(bytes));
  } finally {
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an fs failure writing the MCP store answers 500 with its code and no home path', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  const { chmodSync } = await import('node:fs');
  const { mcpDir } = await import('../src/core/mcp/store.mjs');
  chmodSync(mcpDir(), 0o500);   // read-only: the atomic write's temp file cannot be created
  try {
    const r = await call('POST', '/api/mcp/sets', { name: 'Readonly' });
    assert.equal(r.status, 500, r.text);
    assert.match(r.body.error, /^the MCP data could not be read or saved \(EACCES\)$/);
    assert.ok(!r.text.includes(process.env.WORCA_HOME), r.text);
  } finally { chmodSync(mcpDir(), 0o700); }
});
