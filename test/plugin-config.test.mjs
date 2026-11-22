// test/plugin-config.test.mjs — per-plugin config/secrets/state (spec §7.6):
// secret routing to data/secrets.json (0600), $env indirection, redaction
// markers, shallow-merge state, atomic writes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { statSync, readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { pluginDataDir } from '../src/core/plugins-lock.mjs';

import {
  readPluginConfig, writePluginConfig, redactedConfig, readPluginState, writePluginState,
  listProfiles, listProfileIds, createProfile, deleteProfile, isValidProfileId, DEFAULT_PROFILE,
  readTicketUpdates, writeTicketUpdates,
} from '../src/core/plugin-config.mjs';
import { purgePluginData } from '../src/core/plugin-store.mjs';

useTempHome(after);

const NAME = 'cfg-plugin';
const SCHEMA = [
  { key: 'token', type: 'text', label: 'Token', secret: true, required: true, default: null, help: null, options: [] },
  { key: 'repo', type: 'text', label: 'Repo', secret: false, required: false, default: 'octo/hello', help: null, options: [] },
];

test('writePluginConfig routes secret fields to secrets.json with mode 0600', async () => {
  await writePluginConfig(NAME, SCHEMA, { token: 'ghp_abc123', repo: 'acme/api' });
  const dir = pluginDataDir(NAME);
  const secrets = JSON.parse(readFileSync(join(dir, 'secrets.json'), 'utf8'));
  const config = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
  // Every file is a MARKED profile envelope; an unnamed write lands in
  // DEFAULT_PROFILE. The $format marker is what tells an envelope apart from a
  // legacy flat file — no shape heuristic can (state keys are arbitrary).
  assert.deepEqual(secrets, { $format: 'profiles/1', profiles: { default: { token: 'ghp_abc123' } } });
  assert.deepEqual(config, { $format: 'profiles/1', profiles: { default: { repo: 'acme/api' } } });
  if (process.platform !== 'win32') assert.equal(statSync(join(dir, 'secrets.json')).mode & 0o777, 0o600); // NTFS has no POSIX mode bits
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.tmp')), [], 'atomic: no temp litter');
});

test('readPluginConfig merges both files and applies schema defaults', async () => {
  assert.deepEqual(readPluginConfig(NAME, SCHEMA), { token: 'ghp_abc123', repo: 'acme/api' });
  await writePluginConfig(NAME, SCHEMA, { repo: null }); // null clears -> default surfaces
  assert.equal(readPluginConfig(NAME, SCHEMA).repo, 'octo/hello');
});

test('{"$env":"VAR"} indirection resolves at read time, stored verbatim', async () => {
  await writePluginConfig(NAME, SCHEMA, { token: { $env: 'WORCA_TEST_TOK' } });
  const onDisk = JSON.parse(readFileSync(join(pluginDataDir(NAME), 'secrets.json'), 'utf8'));
  assert.deepEqual(onDisk.profiles.default.token, { $env: 'WORCA_TEST_TOK' });
  process.env.WORCA_TEST_TOK = 'from-env';
  assert.equal(readPluginConfig(NAME, SCHEMA).token, 'from-env');
  delete process.env.WORCA_TEST_TOK;
  assert.equal(readPluginConfig(NAME, SCHEMA).token, null); // unset env -> null
});

test('redactedConfig replaces secrets with { set: true } markers; never the value', async () => {
  await writePluginConfig(NAME, SCHEMA, { token: 's3cr3t', repo: 'acme/api' });
  assert.deepEqual(redactedConfig(NAME, SCHEMA), { token: { set: true }, repo: 'acme/api' });
  await writePluginConfig(NAME, SCHEMA, { token: null });
  assert.deepEqual(redactedConfig(NAME, SCHEMA).token, { set: false });
});

test('echoed { set: true } marker never clobbers the stored secret', async () => {
  await writePluginConfig(NAME, SCHEMA, { token: 'keep-me' });
  await writePluginConfig(NAME, SCHEMA, { token: { set: true }, repo: 'other/repo' }); // UI round-trip
  assert.equal(readPluginConfig(NAME, SCHEMA).token, 'keep-me');
  assert.equal(readPluginConfig(NAME, SCHEMA).repo, 'other/repo');
});

// ── profiles ──────────────────────────────────────────────────────────────────

test('two profiles hold completely independent config, secrets and state', async () => {
  const P = 'multi-plugin';
  await writePluginConfig(P, SCHEMA, { token: 'tok-work', repo: 'acme/work' }, 'work');
  await writePluginConfig(P, SCHEMA, { token: 'tok-client', repo: 'other/client' }, 'client');
  writePluginState(P, { cursor: 'w1' }, 'work');
  writePluginState(P, { cursor: 'c1' }, 'client');

  assert.deepEqual(readPluginConfig(P, SCHEMA, 'work'), { token: 'tok-work', repo: 'acme/work' });
  assert.deepEqual(readPluginConfig(P, SCHEMA, 'client'), { token: 'tok-client', repo: 'other/client' });
  assert.equal(readPluginState(P, 'work').cursor, 'w1');
  assert.equal(readPluginState(P, 'client').cursor, 'c1');
  // Writing one profile must not disturb the other's file bucket.
  await writePluginConfig(P, SCHEMA, { repo: 'acme/changed' }, 'work');
  assert.equal(readPluginConfig(P, SCHEMA, 'client').repo, 'other/client');
  // An unnamed read is the default profile — which has nothing here.
  assert.equal(readPluginConfig(P, SCHEMA).repo, 'octo/hello');
  assert.deepEqual(redactedConfig(P, SCHEMA, 'client'), { token: { set: true }, repo: 'other/client' });
});

test('profile roster: create is idempotent, delete removes the data too', async () => {
  const P = 'roster-plugin';
  assert.deepEqual(listProfiles(P), [], 'no profiles until one is created');
  createProfile(P, 'work', 'Work Jira');
  createProfile(P, 'client', 'Client Jira');
  createProfile(P, 'work', 'Work Jira (renamed)'); // repeat id -> label update, no duplicate
  assert.deepEqual(listProfiles(P), [
    { id: 'work', label: 'Work Jira (renamed)' },
    { id: 'client', label: 'Client Jira' },
  ]);
  assert.deepEqual(listProfileIds(P), ['work', 'client']);

  await writePluginConfig(P, SCHEMA, { token: 'gone-soon', repo: 'x/y' }, 'client');
  writePluginState(P, { cursor: 'c' }, 'client');
  await deleteProfile(P, 'client');
  assert.deepEqual(listProfileIds(P), ['work']);
  assert.deepEqual(readPluginState(P, 'client'), {}, 'state purged with the profile');
  assert.equal(readPluginConfig(P, SCHEMA, 'client').token, null, 'secret purged with the profile');
  const secrets = JSON.parse(readFileSync(join(pluginDataDir(P), 'secrets.json'), 'utf8'));
  assert.equal('client' in secrets.profiles, false, 'bucket removed, not just emptied');
  if (process.platform !== 'win32') assert.equal(statSync(join(pluginDataDir(P), 'secrets.json')).mode & 0o777, 0o600, 'delete keeps 0600'); // NTFS has no POSIX mode bits
});

test('the roster reserves "default": the shared bucket is never creatable or deletable', async () => {
  const P = 'reserved-plugin';
  // "default" backs every profile-less read (chat channels, model secrets,
  // migrated legacy config) — enrolled in the roster it would be one Remove
  // click away from wiping them all.
  assert.throws(() => createProfile(P, DEFAULT_PROFILE), /reserved/);
  await assert.rejects(async () => deleteProfile(P, DEFAULT_PROFILE), /reserved/);
  await writePluginConfig(P, SCHEMA, { token: 'shared' }); // profile-less -> default bucket
  assert.equal(readPluginConfig(P, SCHEMA).token, 'shared', 'the shared bucket is intact');
  assert.deepEqual(listProfiles(P), [], 'nothing was enrolled');
});

test('a legacy flat file with a field KEYED "profiles" reads as data, not as the envelope', async () => {
  // A pre-profiles connector may legally declare a configSchema field named
  // "profiles" and store an object (a {"$env":…} ref) under it. Mistaking that
  // for the { profiles: { <id>: {...} } } envelope would silently drop every
  // other stored key — and the next write would persist the loss.
  const P = 'legacy-profiles-key';
  const LEGACY_SCHEMA = [
    { key: 'baseUrl', type: 'text', label: 'Base URL', secret: false },
    { key: 'profiles', type: 'text', label: 'Profiles var', secret: false },
  ];
  mkdirSync(pluginDataDir(P), { recursive: true });
  writeFileSync(join(pluginDataDir(P), 'config.json'),
    JSON.stringify({ baseUrl: 'https://x.test', profiles: { $env: 'WORCA_TEST_PROFILES' } }));

  process.env.WORCA_TEST_PROFILES = 'a,b';
  assert.deepEqual(readPluginConfig(P, LEGACY_SCHEMA), { baseUrl: 'https://x.test', profiles: 'a,b' });
  // A write migrates to the envelope WITHOUT losing either key.
  await writePluginConfig(P, LEGACY_SCHEMA, { baseUrl: 'https://y.test' });
  const onDisk = JSON.parse(readFileSync(join(pluginDataDir(P), 'config.json'), 'utf8'));
  assert.deepEqual(onDisk.profiles.default,
    { baseUrl: 'https://y.test', profiles: { $env: 'WORCA_TEST_PROFILES' } });
  assert.deepEqual(readPluginConfig(P, LEGACY_SCHEMA), { baseUrl: 'https://y.test', profiles: 'a,b' });
  delete process.env.WORCA_TEST_PROFILES;

  // Same when "profiles" is the ONLY key: an env-ref value is no envelope
  // (its key "$env" is not a profile id, its value not a bucket).
  const Q = 'legacy-profiles-only';
  mkdirSync(pluginDataDir(Q), { recursive: true });
  writeFileSync(join(pluginDataDir(Q), 'config.json'),
    JSON.stringify({ profiles: { $env: 'WORCA_TEST_PROFILES' } }));
  process.env.WORCA_TEST_PROFILES = 'kept';
  assert.equal(readPluginConfig(Q, LEGACY_SCHEMA).profiles, 'kept');
  delete process.env.WORCA_TEST_PROFILES;
});

test('legacy state whose lone "profiles" key even LOOKS like the envelope reads as data (the $format marker decides)', () => {
  // ctx.state accepts ARBITRARY keys, so a pre-profiles connector may have
  // legally stored state.set('profiles', { work: {…}, client: {…} }) — a file
  // byte-identical to a shape-recognised envelope. Only the marker written by
  // writeBucket says "envelope"; without it the whole file is the legacy
  // default-profile bag, cursors intact.
  const P = 'legacy-profiles-state';
  mkdirSync(pluginDataDir(P), { recursive: true });
  writeFileSync(join(pluginDataDir(P), 'state.json'),
    JSON.stringify({ profiles: { work: { cursor: 'w9' }, client: { cursor: 'c4' } } }));

  assert.deepEqual(readPluginState(P),
    { profiles: { work: { cursor: 'w9' }, client: { cursor: 'c4' } } },
    'the connector reads back exactly what it stored');
  assert.deepEqual(readPluginState(P, 'work'), {}, 'no phantom "work" bucket is minted');

  // The first write migrates to the MARKED envelope without losing the key…
  writePluginState(P, { etag: 'abc' });
  const onDisk = JSON.parse(readFileSync(join(pluginDataDir(P), 'state.json'), 'utf8'));
  assert.equal(onDisk.$format, 'profiles/1');
  assert.deepEqual(onDisk.profiles.default,
    { profiles: { work: { cursor: 'w9' }, client: { cursor: 'c4' } } , etag: 'abc' });
  // …and the marked envelope round-trips.
  assert.deepEqual(readPluginState(P).etag, 'abc');
  assert.deepEqual(readPluginState(P).profiles.work.cursor, 'w9');
});

test('profile ids are path-safe: traversal and junk are rejected', () => {
  for (const bad of ['../evil', 'a/b', 'UPPER', '', ' ', 'x'.repeat(65), '-lead']) {
    assert.equal(isValidProfileId(bad), false, `${JSON.stringify(bad)} must be rejected`);
  }
  assert.equal(isValidProfileId(DEFAULT_PROFILE), true);
  assert.throws(() => readPluginConfig('any-plugin', SCHEMA, '../escape'), /invalid profile id/);
  assert.throws(() => createProfile('any-plugin', 'a/b'), /invalid profile id/);
});

test('readPluginState defaults to {}; writePluginState shallow-merges atomically', () => {
  assert.deepEqual(readPluginState(NAME), {});
  writePluginState(NAME, { cursor: 'abc', etag: 'W/"1"' });
  writePluginState(NAME, { cursor: 'def' });
  assert.deepEqual(readPluginState(NAME), { cursor: 'def', etag: 'W/"1"' });
  assert.equal(existsSync(join(pluginDataDir(NAME), 'state.json')), true);
  assert.deepEqual(readdirSync(pluginDataDir(NAME)).filter((f) => f.endsWith('.tmp')), []);
});

// ── ticket updates (plans/ticket-updates-design.md §4, D3) ─────────────────────
const TU_REC = { projects: [{ value: 'SHOP', label: 'Shop' }],
  rules: [{ project: '', moment: 'finished', target: { kind: 'category', value: 'done' } }],
  savedAt: '2026-10-29T10:42:00.000Z', savedBy: 'local' };

test('ticket updates: null until saved; one record per profile and source, in the profiles/1 envelope', () => {
  const P = 'tu-plugin';
  assert.equal(readTicketUpdates(P, 'acme', 'jira'), null, 'nothing saved: legacy');
  writeTicketUpdates(P, 'acme', 'jira', TU_REC);
  writeTicketUpdates(P, 'acme', 'other', { ...TU_REC, projects: [] });
  writeTicketUpdates(P, 'beta', 'jira', { ...TU_REC, savedBy: 'ann' });
  assert.deepEqual(readTicketUpdates(P, 'acme', 'jira'), TU_REC);
  assert.deepEqual(readTicketUpdates(P, 'acme', 'other').projects, []);
  assert.equal(readTicketUpdates(P, 'beta', 'jira').savedBy, 'ann');
  assert.equal(readTicketUpdates(P, 'beta', 'other'), null);
  assert.equal(readTicketUpdates(P, undefined, 'jira'), null, 'no profile = the default bucket, empty here');
  const onDisk = JSON.parse(readFileSync(join(pluginDataDir(P), 'ticket-updates.json'), 'utf8'));
  assert.equal(onDisk.$format, 'profiles/1');
  assert.deepEqual(Object.keys(onDisk.profiles).sort(), ['acme', 'beta']);
  assert.deepEqual(Object.keys(onDisk.profiles.acme).sort(), ['jira', 'other']);
  assert.deepEqual(readdirSync(pluginDataDir(P)).filter((f) => f.endsWith('.tmp')), [], 'atomic: no temp litter');
  assert.throws(() => writeTicketUpdates(P, 'acme', '', TU_REC), /task source/);
  assert.throws(() => writeTicketUpdates(P, '../x', 'jira', TU_REC), /invalid profile id/);
  assert.throws(() => writeTicketUpdates(P, 'acme', 'jira', null), /must be an object/);
  assert.equal(readTicketUpdates(P, 'acme', '__proto__'), null, 'own keys only');
});

test("ticket updates: deleteProfile drops that profile's records and keeps the others", async () => {
  const P = 'tu-del';
  createProfile(P, 'acme', 'Acme');
  createProfile(P, 'beta', 'Beta');
  writeTicketUpdates(P, 'acme', 'jira', TU_REC);
  writeTicketUpdates(P, 'beta', 'jira', TU_REC);
  await deleteProfile(P, 'acme');
  assert.equal(readTicketUpdates(P, 'acme', 'jira'), null);
  assert.deepEqual(readTicketUpdates(P, 'beta', 'jira'), TU_REC);
  const onDisk = JSON.parse(readFileSync(join(pluginDataDir(P), 'ticket-updates.json'), 'utf8'));
  assert.deepEqual(Object.keys(onDisk.profiles), ['beta']);
});

test("ticket updates: purge removes the file with the plugin's data", async () => {
  const P = 'tu-orphan';   // not in the lock: purgePluginData's orphan path
  writeTicketUpdates(P, 'acme', 'jira', TU_REC);
  assert.ok(existsSync(join(pluginDataDir(P), 'ticket-updates.json')));
  await purgePluginData(P);
  assert.equal(existsSync(join(pluginDataDir(P), 'ticket-updates.json')), false);
  assert.equal(readTicketUpdates(P, 'acme', 'jira'), null);
});

// ── secretVault on: secrets are vault references bound to NAME/PROFILE/KEY, resolved on read ─────────────────────
const { mkdtempSync: vTmp, rmSync: vRm } = await import('node:fs');
const { tmpdir: vTmpdir } = await import('node:os');
const { fakeVault } = await import('./helpers/vault-on.mjs');
const { isVaultRef, newVaultRef } = await import('../src/core/secrets/refs.mjs');
const VDIR = vTmp(join(vTmpdir(), 'worca-plugin-vault-'));
after(() => vRm(VDIR, { recursive: true, force: true }));
const { vaultOn, vaultOf } = fakeVault(VDIR);
const VP = 'vault-plugin';
const secretsText = (name) => readFileSync(join(pluginDataDir(name), 'secrets.json'), 'utf8');
const bucket = (name, profile = DEFAULT_PROFILE) => JSON.parse(secretsText(name)).profiles[profile];
const pluginEntries = async (prefix) => (await vaultOf().list()).filter((e) => e.store === 'plugin' && !e.droppedAt && e.field.startsWith(prefix));

test('flag on: a secret is a vault reference, read back by readPluginConfig, masked by redactedConfig, kept by the echo', () => vaultOn(async () => {
  await writePluginConfig(VP, SCHEMA, { token: 'ghp-vault-0001', repo: 'acme/api' });
  assert.ok(!secretsText(VP).includes('ghp-vault-0001'));
  const ref = bucket(VP).token;
  assert.ok(isVaultRef(ref), ref);
  assert.deepEqual(readPluginConfig(VP, SCHEMA), { token: 'ghp-vault-0001', repo: 'acme/api' });
  assert.deepEqual(redactedConfig(VP, SCHEMA).token, { set: true });
  await writePluginConfig(VP, SCHEMA, { token: { set: true }, repo: 'acme/other' });
  assert.equal(bucket(VP).token, ref, 'the set-marker keeps the reference');
  await writePluginConfig(VP, SCHEMA, { token: ` ${ref}\n` });
  assert.equal(bucket(VP).token, ref, 'a padded echo keeps the trimmed reference');
  assert.deepEqual((await pluginEntries(`${VP}/`)).map((e) => e.ref), [ref], '… and its entry');
  await writePluginConfig(VP, SCHEMA, { token: 'ghp-vault-0002' });
  const next = bucket(VP).token;
  assert.ok(isVaultRef(next) && next !== ref);
  assert.deepEqual((await pluginEntries(`${VP}/`)).map((e) => e.ref), [next], 'the replaced entry was released');
}));

test('flag on: a {$env} secret is stored verbatim with no entry and reads process.env', () => vaultOn(async () => {
  process.env.WORCA_TEST_VAULT_ENV_TOK = 'from-env-0003';
  try {
    await writePluginConfig('env-vault-plugin', SCHEMA, { token: { $env: 'WORCA_TEST_VAULT_ENV_TOK' } });
    assert.deepEqual(bucket('env-vault-plugin').token, { $env: 'WORCA_TEST_VAULT_ENV_TOK' });
    assert.equal(readPluginConfig('env-vault-plugin', SCHEMA).token, 'from-env-0003');
    assert.equal((await pluginEntries('env-vault-plugin/')).length, 0);
  } finally { delete process.env.WORCA_TEST_VAULT_ENV_TOK; }
}));

test('flag on: a pasted foreign reference is refused VAULT_REF_REFUSED and secrets.json is unchanged', () => vaultOn(async () => {
  await writePluginConfig('ref-plugin', SCHEMA, { token: 'tok-ref-0004' });
  const bytes = secretsText('ref-plugin');
  await assert.rejects(writePluginConfig('ref-plugin', SCHEMA, { token: ` ${newVaultRef()}` }),
    (err) => err.name === 'SettingsVaultError' && err.code === 'VAULT_REF_REFUSED');
  assert.equal(secretsText('ref-plugin'), bytes);
}));

test('flag on: deleteProfile releases that profile\'s entries and keeps the other profile\'s', () => vaultOn(async () => {
  const P2 = 'profiles-vault';
  createProfile(P2, 'work', 'Work');
  createProfile(P2, 'client', 'Client');
  await writePluginConfig(P2, SCHEMA, { token: 'tok-work-0005' }, 'work');
  await writePluginConfig(P2, SCHEMA, { token: 'tok-client-0006' }, 'client');
  assert.equal((await pluginEntries(`${P2}/`)).length, 2);
  await deleteProfile(P2, 'client');
  assert.deepEqual((await pluginEntries(`${P2}/`)).map((e) => e.field), [`${P2}/work/token`]);
  assert.equal(readPluginConfig(P2, SCHEMA, 'work').token, 'tok-work-0005');
  // Past the grace, the plugin's next release (the work token replaced) removes the deleted profile's marked entry.
  const { LOCKLESS_GRACE_MS } = await import('../src/core/secrets/store-vault.mjs');
  const realNow = Date.now;
  Date.now = () => realNow() + LOCKLESS_GRACE_MS + 1;
  try { await writePluginConfig(P2, SCHEMA, { token: 'tok-work-0007' }, 'work'); } finally { Date.now = realNow; }
  assert.deepEqual((await vaultOf().list()).filter((e) => e.field === `${P2}/client/token`), [], 'marked entries included');
}));
