// test/plugin-config.test.mjs — per-plugin config/secrets/state (spec §7.6):
// secret routing to data/secrets.json (0600), $env indirection, redaction
// markers, shallow-merge state, atomic writes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { statSync, readFileSync, readdirSync, existsSync } from 'node:fs';
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
  // Every file is profile-keyed; an unnamed write lands in DEFAULT_PROFILE.
  assert.deepEqual(secrets, { profiles: { default: { token: 'ghp_abc123' } } });
  assert.deepEqual(config, { profiles: { default: { repo: 'acme/api' } } });
  assert.equal(statSync(join(dir, 'secrets.json')).mode & 0o777, 0o600);
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
  assert.equal(statSync(join(pluginDataDir(P), 'secrets.json')).mode & 0o777, 0o600, 'delete keeps 0600');
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
