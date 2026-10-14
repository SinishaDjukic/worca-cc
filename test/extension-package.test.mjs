// test/extension-package.test.mjs — src/core/extension-package.mjs: where the packaged extension builds are, their
// version, install steps and the GET /api/extension/install body.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extensionBuilds, extensionInstallInfo, installSteps, releaseZipUrl, PACKAGE_ROOT, EXTENSION_BROWSERS } from '../src/core/extension-package.mjs';

const root = mkdtempSync(join(tmpdir(), 'worca-extpkg-'));
after(() => rmSync(root, { recursive: true, force: true }));
writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.12.0-rc.1' }));
const build = (b, manifest) => { mkdirSync(join(root, 'extension/dist', b), { recursive: true }); writeFileSync(join(root, 'extension/dist', b, 'manifest.json'), JSON.stringify(manifest)); };

test('PACKAGE_ROOT is the package root (holds package.json and src/)', () => {
  assert.equal(PACKAGE_ROOT, fileURLToPath(new URL('..', import.meta.url)));
});

test('no build: every browser absent, paths still under <root>/extension/dist', () => {
  const r = extensionBuilds({ root });
  assert.equal(r.version, '1.12.0-rc.1');
  assert.deepEqual(r.builds.map((b) => [b.browser, b.present, b.path]), EXTENSION_BROWSERS.map((b) => [b, false, join(root, 'extension', 'dist', b)]));
});

test('a built folder is present with its manifest version (version_name wins)', () => {
  build('chrome', { version: '1.12.0', version_name: '1.12.0-rc.1' });
  build('firefox', { version: '1.12.0' });
  const by = Object.fromEntries(extensionBuilds({ root }).builds.map((b) => [b.browser, b]));
  assert.deepEqual([by.chrome.present, by.chrome.version], [true, '1.12.0-rc.1']);
  assert.deepEqual([by.firefox.present, by.firefox.version], [true, '1.12.0']);
  assert.equal(by.edge.present, false);
});

test('install info: steps per browser, release zip URLs, no server paths in remote mode', () => {
  const local = extensionInstallInfo({ root, repoUrl: 'https://github.com/acme/worca', releaseUrl: 'https://github.com/acme/worca/releases/tag/worca-app-v1.12.0-rc.1' });
  assert.equal(local.buildCommand, 'npm run ext:build');
  assert.equal(local.builds[0].downloadUrl, 'https://github.com/acme/worca/releases/download/worca-app-v1.12.0-rc.1/worca-chrome-1.12.0-rc.1.zip');
  assert.ok(local.builds.every((b) => b.path && b.steps.length === 3));
  assert.match(installSteps('firefox').join(' '), /unsigned/);
  const remote = extensionInstallInfo({ root, remoteMode: true });
  assert.equal(remote.remoteMode, true);
  assert.ok(remote.builds.every((b) => b.path === null));
  assert.equal(releaseZipUrl('', '1.0.0', 'edge'), '');
});
