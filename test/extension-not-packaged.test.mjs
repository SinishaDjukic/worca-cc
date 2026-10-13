import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
test('the extension and its E2E suite are not in the @worca/app package (Clarify: distribution)', () => {
  const files = PKG.files;
  assert.ok(!files.some((f) => /^(extension|e2e)\b/.test(f)));
  assert.ok(!files.includes('tools/build-extension.mjs'));
});

test('the Playwright image tag in CI and in update-linux equals the pinned @playwright/test (v6)', () => {
  const v = PKG.devDependencies['@playwright/test'];
  assert.match(v, /^\d+\.\d+\.\d+$/, '@playwright/test is pinned exactly');
  const tag = `mcr.microsoft.com/playwright:v${v}-noble`;
  assert.ok(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8').includes(tag), 'ci.yml extension-e2e image');
  assert.ok(PKG.scripts['e2e:extension:update-linux'].includes(tag), 'update-linux image');
});
