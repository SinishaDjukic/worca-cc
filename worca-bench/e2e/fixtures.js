/**
 * Playwright fixtures for worca-bench. Spins up an isolated dashboard server
 * on a random port backed by a temp target-dir seeded with a results.jsonl
 * fixture. Mirrors worca-ui/e2e/fixtures.js startServer pattern.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';

function row(overrides = {}) {
  return {
    schema_version: 1,
    profile: 'p1',
    benchmark: 'swe-bench-verified',
    instance_id: 'astropy__astropy-12907',
    worca_ref: 'local',
    template: 'builtin:feature',
    rep: 1,
    run_id: 'r1',
    status: 'graded',
    resolved: true,
    score: 1.0,
    cost_usd: 0.42,
    wall_time_s: 612,
    loop_counters: { implement_test: 2, pr_changes: 0 },
    completed_at: '2026-06-16T10:00:00Z',
    ...overrides,
  };
}

/** The default seeded fixture: two profiles so Compare is exercised. */
export const FIXTURE_ROWS = [
  row({ profile: 'smoke-feature-opus', rep: 1, resolved: true }),
  row({ profile: 'smoke-feature-opus', rep: 2, resolved: false, score: 0.0 }),
  row({
    profile: 'smoke-quickfix-sonnet',
    rep: 1,
    resolved: true,
    cost_usd: 0.12,
  }),
];

/**
 * Start an isolated worca-bench server on a random port.
 *
 * @param {object[]} [rows] results rows to seed (defaults to FIXTURE_ROWS)
 * @returns {Promise<{ url: string, port: number, targetDir: string, close: () => Promise<void> }>}
 */
export async function startServer(rows = FIXTURE_ROWS) {
  const targetDir = join(
    tmpdir(),
    `worca-bench-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(
    join(targetDir, 'results.jsonl'),
    `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`,
  );

  const app = createApp({
    targetDir,
    // Don't actually spawn python in e2e — stub the launcher.
    _runBenchmark: async () => ({ pid: 1 }),
  });
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    targetDir,
    close: () =>
      new Promise((resolve) => server.close(resolve)).finally(() =>
        rmSync(targetDir, { recursive: true, force: true }),
      ),
  };
}
