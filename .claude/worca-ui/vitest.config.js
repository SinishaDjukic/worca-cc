import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Exclude Playwright e2e tests from Vitest runs
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
});
