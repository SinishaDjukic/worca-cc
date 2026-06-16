import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

function row(overrides = {}) {
  return {
    schema_version: 1,
    profile: 'p1',
    benchmark: 'swe-bench-verified',
    instance_id: 'inst-1',
    worca_ref: 'local',
    template: 'builtin:feature',
    rep: 1,
    status: 'graded',
    resolved: true,
    score: 1.0,
    cost_usd: 0.4,
    wall_time_s: 600,
    loop_counters: { implement_test: 1 },
    completed_at: '2026-06-16T10:00:00Z',
    ...overrides,
  };
}

async function withServer(targetDir, opts, fn) {
  const app = createApp({ targetDir, ...opts });
  const server = createServer(app);
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    return await fn(base);
  } finally {
    await new Promise((res) => server.close(res));
  }
}

describe('createApp API', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bench-app-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('GET /api/health returns ok', async () => {
    await withServer(dir, {}, async (base) => {
      const res = await fetch(`${base}/api/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });
  });

  it('GET /api/profiles aggregates results.jsonl', async () => {
    writeFileSync(
      join(dir, 'results.jsonl'),
      [
        JSON.stringify(row({ profile: 'p1', resolved: true })),
        JSON.stringify(row({ profile: 'p1', rep: 2, resolved: false })),
      ].join('\n'),
    );
    await withServer(dir, {}, async (base) => {
      const { ok, profiles } = await (
        await fetch(`${base}/api/profiles`)
      ).json();
      expect(ok).toBe(true);
      expect(profiles).toHaveLength(1);
      expect(profiles[0].name).toBe('p1');
      expect(profiles[0].resolved_rate).toBeCloseTo(0.5);
    });
  });

  it('GET /api/profiles/:name returns aggregate + reps, 404 for unknown', async () => {
    writeFileSync(join(dir, 'results.jsonl'), JSON.stringify(row()));
    await withServer(dir, {}, async (base) => {
      const found = await fetch(`${base}/api/profiles/p1`);
      expect(found.status).toBe(200);
      const body = await found.json();
      expect(body.aggregate.name).toBe('p1');
      expect(body.reps).toHaveLength(1);

      const missing = await fetch(`${base}/api/profiles/nope`);
      expect(missing.status).toBe(404);
    });
  });

  it('GET /api/compare returns side-by-side aggregates', async () => {
    writeFileSync(
      join(dir, 'results.jsonl'),
      [
        JSON.stringify(row({ profile: 'a', resolved: true })),
        JSON.stringify(row({ profile: 'b', resolved: false })),
      ].join('\n'),
    );
    await withServer(dir, {}, async (base) => {
      const { compare } = await (
        await fetch(`${base}/api/compare?profiles=a,b`)
      ).json();
      expect(compare.map((c) => c.name)).toEqual(['a', 'b']);
    });
  });

  it('GET /api/leaderboard returns rows (offline fallback, hermetic)', async () => {
    await withServer(dir, { leaderboardOffline: true }, async (base) => {
      const { ok, rows, benchmark } = await (
        await fetch(`${base}/api/leaderboard?benchmark=swe-bench-verified`)
      ).json();
      expect(ok).toBe(true);
      expect(benchmark).toBe('swe-bench-verified');
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]).toHaveProperty('agent');
      expect(rows[0]).toHaveProperty('source');
    });
  });

  it('POST /api/run launches the runner and returns pid', async () => {
    let captured = null;
    const fakeRun = async (opts) => {
      captured = opts;
      return { pid: 4242 };
    };
    await withServer(dir, { _runBenchmark: fakeRun }, async (base) => {
      const res = await fetch(`${base}/api/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: 'p1' }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, pid: 4242 });
      expect(captured.profile).toBe('p1');
      expect(captured.targetDir).toBe(dir);
    });
  });

  it('POST /api/run rejects a missing profile with 400', async () => {
    await withServer(dir, {}, async (base) => {
      const res = await fetch(`${base}/api/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  it('sets security headers', async () => {
    await withServer(dir, {}, async (base) => {
      const res = await fetch(`${base}/api/health`);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('DENY');
    });
  });
});
