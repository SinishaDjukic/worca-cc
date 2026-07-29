// test/plugins-lock.test.mjs — plugin path helpers + plugins.lock.json IO (spec §5).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import {
  pluginsRoot, pluginDir, pluginCurrentDir, pluginDataDir, pluginsLockFile,
  readPluginsLock, writePluginsLock,
} from '../src/core/plugins-lock.mjs';

useTempHome(after);

test('path helpers hang off worcaHome()/plugins', () => {
  assert.equal(pluginsRoot(), join(worcaHome(), 'plugins'));
  assert.equal(pluginDir('github-source'), join(pluginsRoot(), 'github-source'));
  assert.equal(pluginCurrentDir('github-source'), join(pluginsRoot(), 'github-source', 'current'));
  assert.equal(pluginDataDir('github-source'), join(pluginsRoot(), 'github-source', 'data'));
  assert.equal(pluginsLockFile(), join(pluginsRoot(), 'plugins.lock.json'));
});

test('pluginDir rejects names that could escape the plugins root', () => {
  assert.throws(() => pluginDir('../evil'), /invalid plugin name/);
  assert.throws(() => pluginDir('a/b'), /invalid plugin name/);
  assert.throws(() => pluginDir(''), /invalid plugin name/);
});

test('readPluginsLock: missing file -> {}; corrupt/non-object -> {}', () => {
  assert.deepEqual(readPluginsLock(), {});
  mkdirSync(pluginsRoot(), { recursive: true });
  writeFileSync(pluginsLockFile(), '{oops');
  assert.deepEqual(readPluginsLock(), {});
  writeFileSync(pluginsLockFile(), '[1,2]');
  assert.deepEqual(readPluginsLock(), {});
});

test('round-trip preserves entries INCLUDING unknown keys', () => {
  const lock = {
    'github-source': {
      repo: 'https://github.com/denislavprinov/maestro-plugins', subdir: 'github-source',
      pinnedSha: 'a'.repeat(40), version: '0.1.0', enabled: true,
      installedAt: '2026-07-12T10:00:00Z',
      futureField: { keep: 'me' }, // written by a newer worca-cc version — must survive
    },
  };
  writePluginsLock(lock);
  assert.deepEqual(readPluginsLock(), lock);
});

test('writePluginsLock is temp+rename atomic: no .tmp litter, valid JSON on disk', () => {
  writePluginsLock({ a: { enabled: false } });
  const files = readdirSync(pluginsRoot());
  assert.deepEqual(files.filter((f) => f.endsWith('.tmp')), []); // temp file renamed away
  assert.ok(files.includes('plugins.lock.json'));
  assert.deepEqual(JSON.parse(readFileSync(pluginsLockFile(), 'utf8')), { a: { enabled: false } });
  assert.equal(existsSync(pluginsLockFile()), true);
});
