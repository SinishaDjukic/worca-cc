import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  expect: {
    timeout: 15000,
  },
  use: {
    screenshot: 'only-on-failure',
    // Avoid hanging on slow external resources (fonts, CDN)
    navigationTimeout: 15000,
    actionTimeout: 15000,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
