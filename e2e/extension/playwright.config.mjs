import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { specIgnores } from '../../tools/quarantine.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.mjs$/,
  testIgnore: specIgnores(ROOT, process.env), // quarantined specs (test/quarantine.json) run in quarantine.yml only
  timeout: 120_000,   // v8: headroom for update-linux under amd64 emulation on Apple Silicon
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  outputDir: 'test-results',
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}-{platform}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' } },
  use: { trace: 'retain-on-failure' },
});
