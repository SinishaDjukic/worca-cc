// test/stillhet-build.test.mjs — tools/stillhet-build.mjs: the generated Stillhet files, and that the package carries them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { buildStillhet, missingBundles, STILLHET_BUNDLES } from '../tools/stillhet-build.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(ROOT + 'package.json', 'utf8'));

test('buildStillhet writes every bundle, and writing twice gives the same files', async () => {
  const first = await buildStillhet();
  assert.deepEqual(first, STILLHET_BUNDLES);
  assert.deepEqual(missingBundles(), []);
  const bytes = () => STILLHET_BUNDLES.filter((f) => f !== 'components.js').map((f) => readFileSync(ROOT + 'ui/public/stillhet/' + f, 'utf8'));
  const before = bytes();
  await buildStillhet();
  assert.deepEqual(bytes(), before);
  assert.match(readFileSync(ROOT + 'ui/public/stillhet/components.js', 'utf8'), /window\.RailCatalog/);
});

test('missingBundles names an absent file', () => {
  assert.deepEqual(missingBundles('/nonexistent/stillhet/'), STILLHET_BUNDLES);
});

test('prepack chains the extension build and the Stillhet build', () => {
  assert.equal(pkg.scripts.prepack, 'node tools/build-extension.mjs --pack && node tools/stillhet-build.mjs');
  assert.equal(pkg.scripts['stillhet:build'], 'node tools/stillhet-build.mjs');
});

test('npm pack --dry-run lists boot.js and the generated bundles (they are gitignored at the root only)', () => {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  const names = new Set(JSON.parse(out)[0].files.map((f) => f.path));
  for (const f of ['boot.js', 'shell.html', ...STILLHET_BUNDLES]) assert.ok(names.has('ui/public/stillhet/' + f), f);
  assert.ok(existsSync(ROOT + 'ui/public/stillhet/boot.js'));
});
