import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Exclude Playwright e2e tests from Vitest runs.
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    environmentMatchGlobs: [['app/**/*.test.js', 'jsdom']],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage-out',
      include: ['app/**/*.js', 'server/**/*.js', 'bin/**/*.js'],
      exclude: [
        '**/*.test.js',
        'app/main.bundle.js',
        'app/main.bundle.js.map',
        'app/vendor/**',
        'scripts/**',
        'e2e/**',
      ],
    },
  },
});
