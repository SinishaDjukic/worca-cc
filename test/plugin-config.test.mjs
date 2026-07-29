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
  assert.deepEqual(secrets, { token: 'ghp_abc123' });
  assert.deepEqual(config, { repo: 'acme/api' });
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
  assert.deepEqual(onDisk.token, { $env: 'WORCA_TEST_TOK' });
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

test('readPluginState defaults to {}; writePluginState shallow-merges atomically', () => {
  assert.deepEqual(readPluginState(NAME), {});
  writePluginState(NAME, { cursor: 'abc', etag: 'W/"1"' });
  writePluginState(NAME, { cursor: 'def' });
  assert.deepEqual(readPluginState(NAME), { cursor: 'def', etag: 'W/"1"' });
  assert.equal(existsSync(join(pluginDataDir(NAME), 'state.json')), true);
  assert.deepEqual(readdirSync(pluginDataDir(NAME)).filter((f) => f.endsWith('.tmp')), []);
});
