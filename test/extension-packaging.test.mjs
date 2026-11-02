// test/extension-packaging.test.mjs — the @worca/app package carries the BUILT browser extension
// (extension/dist/{chrome,edge,firefox}/) and nothing else of it: no source, no E2E suite, no *-test build, no zip.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkPackFiles, packJsonPaths } from '../tools/check-pack.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const npm = (args, cwd) => spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' });

test('files lists exactly the three built extension folders, never source, e2e, *-test or zips', () => {
  const ext = PKG.files.filter((f) => /^(extension|e2e)\b/.test(f));
  assert.deepEqual(ext, ['extension/dist/chrome/', 'extension/dist/edge/', 'extension/dist/firefox/']);
  assert.ok(!PKG.files.includes('tools/build-extension.mjs'));
  assert.equal(PKG.scripts.prepack, 'node tools/build-extension.mjs --pack', 'npm pack/publish build the production extension');
  assert.match(readFileSync(join(ROOT, '.gitignore'), 'utf8'), /^extension\/dist\/$/m, 'builds stay out of git');
});

test('checkPackFiles accepts the three builds and flags everything else', () => {
  const good = ['src/x.mjs', ...['chrome', 'edge', 'firefox'].flatMap((b) => [`extension/dist/${b}/manifest.json`, `extension/dist/${b}/sidebar.js`])];
  assert.deepEqual(checkPackFiles(good, { requireExtension: true }), []);
  assert.equal(checkPackFiles(['extension/dist/chrome-test/manifest.json']).length, 1);
  assert.equal(checkPackFiles(['extension/src/background.mjs']).length, 1);
  assert.equal(checkPackFiles(['extension/dist/worca-chrome-1.0.0.zip']).length, 1);
  assert.equal(checkPackFiles(['e2e/extension/sidebar.spec.mjs']).length, 1);
  assert.match(checkPackFiles(['src/x.mjs'], { requireExtension: true }).join('\n'), /missing extension\/dist\/chrome\/manifest\.json/);
});

// Hermetic: a throwaway package with this repo's real `files` list and .gitignore, and every kind of extension file.
// Proves npm itself (not just our checker) packs the three builds despite .gitignore and leaves the rest out.
const tmp = mkdtempSync(join(tmpdir(), 'worca-pack-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
test('npm pack --dry-run, real files list: the three builds in, source / *-test / zips / e2e out', () => {
  const put = (p, s = 'x') => { mkdirSync(dirname(join(tmp, p)), { recursive: true }); writeFileSync(join(tmp, p), s); };
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'pack-probe', version: '1.0.0', files: PKG.files }));
  writeFileSync(join(tmp, '.gitignore'), readFileSync(join(ROOT, '.gitignore'), 'utf8'));
  for (const b of ['chrome', 'edge', 'firefox']) { put(`extension/dist/${b}/manifest.json`, '{}'); put(`extension/dist/${b}/sidebar.js`); }
  put('extension/dist/chrome-test/manifest.json', '{}');
  put('extension/dist/worca-chrome-1.0.0.zip');
  put('extension/src/background.mjs');
  put('extension/icons/worca-16.png');
  put('e2e/extension/sidebar.spec.mjs');
  put('src/a.mjs');
  const r = npm(['pack', '--dry-run', '--json', '--ignore-scripts'], tmp);
  assert.equal(r.status, 0, r.stderr);
  const paths = packJsonPaths(r.stdout);
  assert.deepEqual(checkPackFiles(paths, { requireExtension: true }), []);
  assert.ok(paths.includes('extension/dist/edge/sidebar.js'));
  assert.ok(!paths.some((p) => p.startsWith('extension/dist/chrome-test/')));
});

test('this checkout: npm pack --dry-run carries no extension source, *-test build, zip or e2e file', () => {
  // --ignore-scripts: no prepack build here (that is CI's and npm publish's job); whatever extension/dist holds
  // locally — a chrome-test from e2e:extension, zips from ext:zip — must still stay out.
  const r = npm(['pack', '--dry-run', '--json', '--ignore-scripts'], ROOT);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(checkPackFiles(packJsonPaths(r.stdout)), []);
});

test('the release workflow publishes with devDependencies (esbuild for prepack) and checks the packed extension', () => {
  const yml = readFileSync(join(ROOT, '.github/workflows/release-npm-app.yml'), 'utf8');
  assert.doesNotMatch(yml, /--omit=dev|NODE_ENV:\s*production/);
  assert.match(yml, /node tools\/build-extension\.mjs --pack/);
  assert.match(yml, /node tools\/check-pack\.mjs --require-extension/);
  assert.match(yml, /npm run ext:zip/);
  for (const b of ['chrome', 'edge', 'firefox']) assert.match(yml, new RegExp(`worca-${b}-\\$VERSION\\.zip`));
  assert.doesNotMatch(yml, /--notes-file/, 'the release body is the generated notes alone');
  assert.match(yml, /--notes-start-tag "\$PREV"/, 'counted from the previous stable release, not the last RC');
});

test('the Playwright image tag in CI and in update-linux equals the pinned @playwright/test (v6)', () => {
  const v = PKG.devDependencies['@playwright/test'];
  assert.match(v, /^\d+\.\d+\.\d+$/, '@playwright/test is pinned exactly');
  const tag = `mcr.microsoft.com/playwright:v${v}-noble`;
  const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  assert.ok(ci.includes(tag), 'ci.yml extension-e2e image');
  // V22: a tag can be re-pushed; CI pulls the image by digest too (an @playwright/test bump fails the line above,
  // so the tag and its digest move together, by hand: dependabot.yml's docker entry reads /docker only).
  assert.match(ci, new RegExp(`image: ${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@sha256:[0-9a-f]{64}\\s`), 'ci.yml pins the image by digest');
  assert.ok(PKG.scripts['e2e:extension:update-linux'].includes(tag), 'update-linux image');
});
