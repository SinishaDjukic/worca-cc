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
} from '../src/core/plugin-config.mjs';

useTempHome(after);

const NAME = 'cfg-plugin';
const SCHEMA = [
  { key: 'token', type: 'text', label: 'Token', secret: true, required: true, default: null, help: null, options: [] },
  { key: 'repo', type: 'text', label: 'Repo', secret: false, required: false, default: 'octo/hello', help: null, options: [] },
];

test('writePluginConfig routes secret fields to secrets.json with mode 0600', () => {
  writePluginConfig(NAME, SCHEMA, { token: 'ghp_abc123', repo: 'acme/api' });
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

test('readPluginConfig merges both files and applies schema defaults', () => {
  assert.deepEqual(readPluginConfig(NAME, SCHEMA), { token: 'ghp_abc123', repo: 'acme/api' });
  writePluginConfig(NAME, SCHEMA, { repo: null }); // null clears -> default surfaces
  assert.equal(readPluginConfig(NAME, SCHEMA).repo, 'octo/hello');
});

test('{"$env":"VAR"} indirection resolves at read time, stored verbatim', () => {
  writePluginConfig(NAME, SCHEMA, { token: { $env: 'WORCA_TEST_TOK' } });
  const onDisk = JSON.parse(readFileSync(join(pluginDataDir(NAME), 'secrets.json'), 'utf8'));
  assert.deepEqual(onDisk.profiles.default.token, { $env: 'WORCA_TEST_TOK' });
  process.env.WORCA_TEST_TOK = 'from-env';
  assert.equal(readPluginConfig(NAME, SCHEMA).token, 'from-env');
  delete process.env.WORCA_TEST_TOK;
  assert.equal(readPluginConfig(NAME, SCHEMA).token, null); // unset env -> null
});

test('redactedConfig replaces secrets with { set: true } markers; never the value', () => {
  writePluginConfig(NAME, SCHEMA, { token: 's3cr3t', repo: 'acme/api' });
  assert.deepEqual(redactedConfig(NAME, SCHEMA), { token: { set: true }, repo: 'acme/api' });
  writePluginConfig(NAME, SCHEMA, { token: null });
  assert.deepEqual(redactedConfig(NAME, SCHEMA).token, { set: false });
});

test('echoed { set: true } marker never clobbers the stored secret', () => {
  writePluginConfig(NAME, SCHEMA, { token: 'keep-me' });
  writePluginConfig(NAME, SCHEMA, { token: { set: true }, repo: 'other/repo' }); // UI round-trip
  assert.equal(readPluginConfig(NAME, SCHEMA).token, 'keep-me');
  assert.equal(readPluginConfig(NAME, SCHEMA).repo, 'other/repo');
});

// ── profiles ──────────────────────────────────────────────────────────────────

test('two profiles hold completely independent config, secrets and state', () => {
  const P = 'multi-plugin';
  writePluginConfig(P, SCHEMA, { token: 'tok-work', repo: 'acme/work' }, 'work');
  writePluginConfig(P, SCHEMA, { token: 'tok-client', repo: 'other/client' }, 'client');
  writePluginState(P, { cursor: 'w1' }, 'work');
  writePluginState(P, { cursor: 'c1' }, 'client');

  assert.deepEqual(readPluginConfig(P, SCHEMA, 'work'), { token: 'tok-work', repo: 'acme/work' });
  assert.deepEqual(readPluginConfig(P, SCHEMA, 'client'), { token: 'tok-client', repo: 'other/client' });
  assert.equal(readPluginState(P, 'work').cursor, 'w1');
  assert.equal(readPluginState(P, 'client').cursor, 'c1');
  // Writing one profile must not disturb the other's file bucket.
  writePluginConfig(P, SCHEMA, { repo: 'acme/changed' }, 'work');
  assert.equal(readPluginConfig(P, SCHEMA, 'client').repo, 'other/client');
  // An unnamed read is the default profile — which has nothing here.
  assert.equal(readPluginConfig(P, SCHEMA).repo, 'octo/hello');
  assert.deepEqual(redactedConfig(P, SCHEMA, 'client'), { token: { set: true }, repo: 'other/client' });
});

test('profile roster: create is idempotent, delete removes the data too', () => {
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

  writePluginConfig(P, SCHEMA, { token: 'gone-soon', repo: 'x/y' }, 'client');
  writePluginState(P, { cursor: 'c' }, 'client');
  deleteProfile(P, 'client');
  assert.deepEqual(listProfileIds(P), ['work']);
  assert.deepEqual(readPluginState(P, 'client'), {}, 'state purged with the profile');
  assert.equal(readPluginConfig(P, SCHEMA, 'client').token, null, 'secret purged with the profile');
  const secrets = JSON.parse(readFileSync(join(pluginDataDir(P), 'secrets.json'), 'utf8'));
  assert.equal('client' in secrets.profiles, false, 'bucket removed, not just emptied');
  if (process.platform !== 'win32') assert.equal(statSync(join(pluginDataDir(P), 'secrets.json')).mode & 0o777, 0o600, 'delete keeps 0600'); // NTFS has no POSIX mode bits
});

test('the roster reserves "default": the shared bucket is never creatable or deletable', () => {
  const P = 'reserved-plugin';
  // "default" backs every profile-less read (chat channels, model secrets,
  // migrated legacy config) — enrolled in the roster it would be one Remove
  // click away from wiping them all.
  assert.throws(() => createProfile(P, DEFAULT_PROFILE), /reserved/);
  assert.throws(() => deleteProfile(P, DEFAULT_PROFILE), /reserved/);
  writePluginConfig(P, SCHEMA, { token: 'shared' }); // profile-less -> default bucket
  assert.equal(readPluginConfig(P, SCHEMA).token, 'shared', 'the shared bucket is intact');
  assert.deepEqual(listProfiles(P), [], 'nothing was enrolled');
});

test('a legacy flat file with a field KEYED "profiles" reads as data, not as the envelope', () => {
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
  writePluginConfig(P, LEGACY_SCHEMA, { baseUrl: 'https://y.test' });
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
