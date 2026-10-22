// test/app-update.test.mjs — Settings ▸ About ▸ Updates (#841), the core (src/core/app-update.mjs):
// version order, which version an install should move to, the release notes in between, and the
// policy that decides who may check and who may install. No network, no npm: both are injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  compareVersions, isNewerVersion, pickTarget, releaseNotes, updatePolicy, detectInstallKind,
  registryBase, fetchRegistryInfo, createUpdateChecker, updateInstructions, isGlobalInstall, installVersion,
  DEFAULT_REGISTRY, CHANGELOG_URL,
} from '../src/core/app-update.mjs';
import { checkRows } from './helpers/rows.mjs';

const REPO = 'https://github.com/acme/worca';
const registryAnswer = (latest, rc, versions) => ({
  ok: true, status: 200,
  json: async () => ({ name: '@worca/app', 'dist-tags': { latest, ...(rc ? { rc } : {}) }, versions: Object.fromEntries(versions.map((v) => [v, {}])) }),
});

test('compareVersions follows semver precedence, numeric-aware in prereleases', async () => {
  await checkRows([
    { name: 'core parts compare numerically', run: () => {
      assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
      assert.equal(compareVersions('1.9.9', '1.10.0'), -1);
      assert.equal(compareVersions('2.0.0', '2.0.0'), 0);
    } },
    { name: 'a prerelease sorts below its release, and rc.10 above rc.2', run: () => {
      assert.equal(compareVersions('1.13.0-rc.1', '1.13.0'), -1);
      assert.equal(compareVersions('1.13.0-rc.10', '1.13.0-rc.2'), 1);
      assert.equal(isNewerVersion('1.13.0-rc.2', '1.13.0-rc.1'), true, 'the next RC is newer (the shared plugin helper never orders these)');
    } },
    { name: 'anything that is not an exact version never counts as newer', run: () => {
      assert.equal(isNewerVersion('latest', '1.0.0'), false);
      assert.equal(isNewerVersion('^2.0.0', '1.0.0'), false);
      assert.equal(isNewerVersion('2.0.0', 'abc1234'), false);
    } },
  ]);
});

test('pickTarget: a stable install follows latest, a release candidate the newer of latest and rc', async () => {
  await checkRows([
    { name: 'stable, newer latest', run: () => assert.equal(pickTarget('1.12.0', { latest: '1.13.0', rc: '1.14.0-rc.1' }), '1.13.0') },
    { name: 'stable, current', run: () => assert.equal(pickTarget('1.13.0', { latest: '1.13.0', rc: '1.14.0-rc.1' }), null, 'a stable install is never offered an RC') },
    { name: 'rc, the next rc', run: () => assert.equal(pickTarget('1.13.0-rc.1', { latest: '1.12.0', rc: '1.13.0-rc.2' }), '1.13.0-rc.2') },
    { name: 'rc, its stable is out', run: () => assert.equal(pickTarget('1.13.0-rc.2', { latest: '1.13.0', rc: '1.13.0-rc.2' }), '1.13.0') },
    { name: 'ahead of the registry (a local build)', run: () => assert.equal(pickTarget('9.0.0', { latest: '1.13.0' }), null) },
    { name: 'a malformed dist-tag is ignored', run: () => assert.equal(pickTarget('1.0.0', { latest: 'next; rm -rf /' }), null) },
  ]);
});

test('releaseNotes lists every stable release in between, newest first, plus compare and changelog links', () => {
  const notes = releaseNotes({ current: '1.10.0', target: '1.13.0', repoUrl: REPO,
    versions: ['1.9.0', '1.10.0', '1.11.0', '1.12.0-rc.1', '1.12.0', '1.13.0', '1.14.0-rc.1'] });
  assert.deepEqual(notes.releases.map((r) => r.version), ['1.13.0', '1.12.0', '1.11.0'], 'RCs in between and anything past the target are left out');
  assert.equal(notes.releases[0].url, `${REPO}/releases/tag/worca-app-v1.13.0`);
  assert.equal(notes.compareUrl, `${REPO}/compare/worca-app-v1.10.0...worca-app-v1.13.0`);
  assert.equal(notes.changelogUrl, CHANGELOG_URL);
  assert.equal(notes.more, 0);
  const rc = releaseNotes({ current: '1.13.0-rc.1', target: '1.13.0-rc.2', versions: ['1.13.0-rc.2'], repoUrl: REPO });
  assert.deepEqual(rc.releases.map((r) => r.version), ['1.13.0-rc.2'], 'an RC target lists itself');
  const many = releaseNotes({ current: '1.0.0', target: '1.30.0', versions: Array.from({ length: 30 }, (_, i) => `1.${i + 1}.0`), repoUrl: REPO });
  assert.equal(many.releases.length, 20);
  assert.equal(many.more, 10, 'a long gap says how many more there are instead of listing them all');
});

test('updatePolicy: only a desktop npm -g install may update itself; operators and IT can lock it', async () => {
  await checkRows([
    { name: 'desktop npm install: check on, self-update, auto opt-in', run: () => {
      const p = updatePolicy({ env: {}, deployment: 'local', installKind: 'npm', settings: {} });
      assert.deepEqual(p, { check: true, checkLockedBy: null, apply: 'self', managedBy: null, auto: false, autoAllowed: true });
      assert.equal(updatePolicy({ env: {}, deployment: 'local', installKind: 'npm', settings: { auto: true } }).auto, true);
    } },
    { name: 'hosted (SaaS): managed by the administrator, still told a version exists', run: () => {
      const p = updatePolicy({ env: {}, deployment: 'hosted', installKind: 'npm', settings: { auto: true } });
      assert.equal(p.apply, 'managed'); assert.equal(p.managedBy, 'hosted');
      assert.equal(p.auto, false, 'auto never applies on a hosted instance, whatever is stored');
      assert.equal(p.check, true);
    } },
    { name: 'container: managed (a new version is a new image tag)', run: () => {
      assert.equal(updatePolicy({ env: {}, deployment: 'container', installKind: 'npm' }).managedBy, 'container');
    } },
    { name: 'WORCA_SELF_UPDATE=0: an IT-managed laptop keeps notifications, loses the button', run: () => {
      const p = updatePolicy({ env: { WORCA_SELF_UPDATE: '0' }, deployment: 'local', installKind: 'npm', settings: { auto: true } });
      assert.equal(p.apply, 'managed'); assert.equal(p.managedBy, 'env'); assert.equal(p.auto, false); assert.equal(p.check, true);
    } },
    { name: 'WORCA_UPDATE_CHECK=0: no registry call at all, and the person cannot turn it back on', run: () => {
      const p = updatePolicy({ env: { WORCA_UPDATE_CHECK: 'off' }, deployment: 'local', installKind: 'npm', settings: { check: true, auto: true } });
      assert.equal(p.check, false); assert.equal(p.checkLockedBy, 'env'); assert.equal(p.auto, false);
    } },
    { name: 'the person may turn checks off; auto then has nothing to act on', run: () => {
      const p = updatePolicy({ env: {}, deployment: 'local', installKind: 'npm', settings: { check: false, auto: true } });
      assert.equal(p.check, false); assert.equal(p.checkLockedBy, null); assert.equal(p.auto, false);
    } },
    { name: 'a source checkout or an npx copy is never replaced in place', run: () => {
      assert.equal(updatePolicy({ env: {}, deployment: 'local', installKind: 'source' }).managedBy, 'source');
      assert.equal(updatePolicy({ env: {}, deployment: 'local', installKind: 'npx' }).managedBy, 'npx');
    } },
  ]);
});

test('detectInstallKind reads where the package root sits', () => {
  const none = () => false;
  const g = path.join(path.sep, 'usr', 'lib', 'node_modules', '@worca', 'app');
  assert.equal(detectInstallKind(g, { exists: none }), 'npm');
  assert.equal(detectInstallKind(path.join(path.sep, 'home', 'me', '.npm', '_npx', 'abc', 'node_modules', '@worca', 'app'), { exists: none }), 'npx');
  assert.equal(detectInstallKind(path.join(path.sep, 'src', 'worca'), { exists: (p) => p.endsWith('.git') }), 'source');
  assert.equal(detectInstallKind(path.join(path.sep, 'opt', 'worca'), { exists: none }), 'unknown');
});

test('registryBase: a mirror from WORCA_UPDATE_REGISTRY, never one carrying a credential', () => {
  assert.equal(registryBase({}), DEFAULT_REGISTRY);
  assert.equal(registryBase({ WORCA_UPDATE_REGISTRY: 'https://artifactory.corp/api/npm/npm/' }), 'https://artifactory.corp/api/npm/npm');
  assert.equal(registryBase({ WORCA_UPDATE_REGISTRY: 'https://user:secret@npm.corp' }), DEFAULT_REGISTRY);
  assert.equal(registryBase({ WORCA_UPDATE_REGISTRY: 'file:///etc' }), DEFAULT_REGISTRY);
  assert.equal(registryBase({ WORCA_UPDATE_REGISTRY: 'not a url' }), DEFAULT_REGISTRY);
});

test('fetchRegistryInfo asks for the abbreviated document and sends nothing about the instance', async () => {
  let seen;
  const info = await fetchRegistryInfo({
    env: { WORCA_UPDATE_REGISTRY: 'https://npm.corp' },
    fetchImpl: async (url, init) => { seen = { url, init }; return registryAnswer('1.13.0', null, ['1.12.0', '1.13.0', 'junk']); },
  });
  assert.equal(seen.url, 'https://npm.corp/@worca%2fapp');
  assert.deepEqual(Object.keys(seen.init.headers), ['accept'], 'one Accept header, no identifying headers');
  assert.equal(seen.init.method, undefined, 'a plain GET');
  assert.deepEqual(info.versions, ['1.12.0', '1.13.0']);
  await assert.rejects(fetchRegistryInfo({ env: {}, fetchImpl: async () => ({ ok: false, status: 404 }) }), /404/);
});

test('createUpdateChecker: status, cache, and an apply that installs only the version it offered', async () => {
  let calls = 0;
  let t = 1_000;
  const checker = createUpdateChecker({ current: '1.12.0', repoUrl: REPO, env: {}, now: () => t,
    fetchImpl: async () => { calls += 1; return registryAnswer('1.13.0', '1.14.0-rc.1', ['1.12.0', '1.13.0', '1.14.0-rc.1']); } });
  const self = updatePolicy({ env: {}, deployment: 'local', installKind: 'npm' });
  const before = checker.status({ policy: self, deployment: 'local', installKind: 'npm' });
  assert.equal(before.updateAvailable, false); assert.equal(before.check.checkedAt, null);

  await checker.check();
  await checker.check();
  assert.equal(calls, 1, 'a second check inside the TTL is served from the cache');
  await checker.check({ force: true });
  assert.equal(calls, 1, 'Check now inside a minute of the last answer is served from the cache too');
  t += 61_000;
  await checker.check({ force: true });
  assert.equal(calls, 2, 'after a minute Check now asks again');
  const st = checker.status({ policy: self, deployment: 'local', installKind: 'npm' });
  assert.equal(st.updateAvailable, true); assert.equal(st.target, '1.13.0'); assert.equal(st.latest, '1.13.0');
  assert.deepEqual(st.instructions.steps, ['npm install -g @worca/app@1.13.0', 'worca ui restart'], 'the command pins the version shown');

  const managed = updatePolicy({ env: {}, deployment: 'hosted', installKind: 'npm' });
  await assert.rejects(checker.apply({ version: '1.13.0', policy: managed, root: '/x', runImpl: async () => ({ code: 0 }) }), (e) => e.code === 'MANAGED');
  await assert.rejects(checker.apply({ version: '1.12.5', policy: self, root: '/x', runImpl: async () => ({ code: 0 }) }), (e) => e.code === 'STALE');

  const root = path.join(path.sep, 'g', '@worca', 'app');
  const ran = [];
  const runImpl = async (args) => { ran.push(args); return args[0] === 'root' ? { code: 0, stdout: `${path.join(path.sep, 'g')}\n`, stderr: '' } : { code: 0, stdout: 'added 1 package', stderr: '' }; };
  await assert.rejects(checker.apply({ version: '1.13.0', policy: self, root: path.join(path.sep, 'proj', 'node_modules', '@worca', 'app'), runImpl }), (e) => e.code === 'NOT_GLOBAL',
    'a copy inside a project is not what npm -g would replace');
  const out = await checker.apply({ version: '1.13.0', policy: self, root, runImpl });
  assert.equal(out.version, '1.13.0');
  assert.deepEqual(ran.at(-1), ['install', '-g', '@worca/app@1.13.0']);
  const after = checker.status({ policy: self, deployment: 'local', installKind: 'npm' });
  assert.deepEqual(after.installed && after.installed.version, '1.13.0');
  assert.equal(after.updateAvailable, false, 'installed, waiting for the restart');

  t += 13 * 60 * 60 * 1000;
  await checker.check();
  assert.equal(calls, 3, 'past the TTL it asks again');
});

test('a failed check keeps the last answer and reports the error; checks off hides both', async () => {
  const checker = createUpdateChecker({ current: '1.0.0', env: {}, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await checker.check();
  const on = checker.status({ policy: updatePolicy({ env: {} }), deployment: 'local', installKind: 'npm' });
  assert.equal(on.check.error, 'fetch failed'); assert.equal(on.updateAvailable, false);
  const off = checker.status({ policy: updatePolicy({ env: { WORCA_UPDATE_CHECK: '0' } }), deployment: 'local', installKind: 'npm' });
  assert.equal(off.check.error, null); assert.equal(off.check.enabled, false);
});

test('installVersion refuses anything but an exact version; isGlobalInstall compares real paths', async () => {
  for (const bad of ['latest', '^1.0.0', '1.0.0 && rm -rf /', '', null]) {
    await assert.rejects(installVersion(bad, { runImpl: async () => { throw new Error('must not run'); } }), /exact version/);
  }
  const runImpl = async () => ({ code: 0, stdout: '/usr/lib/node_modules\n', stderr: '' });
  assert.equal(await isGlobalInstall('/usr/lib/node_modules/@worca/app', { runImpl, realpath: (p) => p }), true);
  assert.equal(await isGlobalInstall('/home/me/proj/node_modules/@worca/app', { runImpl, realpath: (p) => p }), false);
});

test('updateInstructions name the owner and the steps per deployment', () => {
  assert.equal(updateInstructions({ deployment: 'hosted', installKind: 'npm', target: '1.13.0' }).who, 'admin');
  assert.deepEqual(updateInstructions({ deployment: 'container', installKind: 'npm', target: '1.13.0' }).steps.at(-1), 'docker compose pull && docker compose up -d');
  assert.deepEqual(updateInstructions({ deployment: 'local', installKind: 'source', target: '1.13.0' }).steps, ['git pull && npm install', 'worca ui restart']);
});
