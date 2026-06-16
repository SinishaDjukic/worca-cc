import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
  // Isolate settings under the per-test temp dir so the suite never reads (or
  // is perturbed by) the developer's real ~/.worca-bench/settings.json.
  const app = createApp({
    targetDir,
    settingsHome: join(targetDir, '.worca-bench-home'),
    ...opts,
  });
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

  it('GET /api/settings exposes the resolved cache dir', async () => {
    await withServer(dir, {}, async (base) => {
      const data = await (await fetch(`${base}/api/settings`)).json();
      expect(data.cache).toBeTruthy();
      expect(typeof data.cache.dir).toBe('string');
      expect(['settings', 'env', 'default']).toContain(data.cache.source);
    });
  });

  it('POST /api/settings/cache-dir sets then clears the cache dir', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'bench-cache-'));
    await withServer(dir, {}, async (base) => {
      let res = await fetch(`${base}/api/settings/cache-dir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: cacheDir }),
      });
      let data = await res.json();
      expect(data.cache.source).toBe('settings');
      expect(data.cache.dir).toBe(cacheDir);
      // empty value resets to default
      res = await fetch(`${base}/api/settings/cache-dir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: '' }),
      });
      data = await res.json();
      expect(data.cache.source).toBe('default');
    });
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('POST /api/run forwards the resolved cacheDir to the launcher', async () => {
    let captured = null;
    const fakeRun = async (opts) => {
      captured = opts;
      return { pid: 8 };
    };
    await withServer(dir, { _runBenchmark: fakeRun }, async (base) => {
      await fetch(`${base}/api/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: 'p1' }),
      });
      expect(typeof captured.cacheDir).toBe('string');
      expect(captured.cacheDir.length).toBeGreaterThan(0);
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

  it('GET /api/profiles/:name opens a def-only profile (no results yet)', async () => {
    mkdirSync(join(dir, 'profiles'), { recursive: true });
    writeFileSync(
      join(dir, 'profiles', 'fresh.yaml'),
      'name: fresh\nbenchmark: swe-bench-verified\n',
    );
    await withServer(dir, {}, async (base) => {
      const res = await fetch(`${base}/api/profiles/fresh`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.aggregate.name).toBe('fresh');
      expect(body.aggregate.benchmark).toBe('swe-bench-verified');
      expect(body.aggregate.reps).toBe(0);
      expect(body.reps).toEqual([]);
    });
  });

  it('GET /api/profiles/:name 404s when neither results nor a def exist', async () => {
    await withServer(dir, {}, async (base) => {
      const res = await fetch(`${base}/api/profiles/ghost`);
      expect(res.status).toBe(404);
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

  it('POST /api/run passes --profiles-dir for a YAML-defined profile', async () => {
    // A profile authored as a YAML def (no results yet) must be findable by the
    // runner via its source dir.
    mkdirSync(join(dir, 'profiles'), { recursive: true });
    writeFileSync(
      join(dir, 'profiles', 'authored.yaml'),
      'name: authored\nbenchmark: swe-bench-verified\n',
    );
    let captured = null;
    const fakeRun = async (opts) => {
      captured = opts;
      return { pid: 7 };
    };
    await withServer(dir, { _runBenchmark: fakeRun }, async (base) => {
      const res = await fetch(`${base}/api/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: 'authored' }),
      });
      expect(res.status).toBe(200);
      expect(captured.profile).toBe('authored');
      expect(captured.profilesDir).toBe(join(dir, 'profiles'));
    });
  });

  it('POST /api/run forwards reps + maxInstances overrides (coerced)', async () => {
    let captured = null;
    const fakeRun = async (opts) => {
      captured = opts;
      return { pid: 5 };
    };
    await withServer(dir, { _runBenchmark: fakeRun }, async (base) => {
      await fetch(`${base}/api/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: 'p1', reps: '4', maxInstances: 2 }),
      });
      expect(captured.reps).toBe(4); // string coerced to int
      expect(captured.maxInstances).toBe(2);
    });
  });

  it('POST /api/run drops invalid overrides (undefined, not 0/NaN)', async () => {
    let captured = null;
    const fakeRun = async (opts) => {
      captured = opts;
      return { pid: 6 };
    };
    await withServer(dir, { _runBenchmark: fakeRun }, async (base) => {
      await fetch(`${base}/api/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: 'p1', reps: 0, maxInstances: 'abc' }),
      });
      expect(captured.reps).toBeUndefined();
      expect(captured.maxInstances).toBeUndefined();
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

  it('GET /api/fs/list lists subdirectories of a path', async () => {
    mkdirSync(join(dir, 'sub-a'), { recursive: true });
    mkdirSync(join(dir, 'sub-b'), { recursive: true });
    mkdirSync(join(dir, '.hidden'), { recursive: true });
    writeFileSync(join(dir, 'a-file.txt'), 'x');
    await withServer(dir, {}, async (base) => {
      const data = await (
        await fetch(`${base}/api/fs/list?path=${encodeURIComponent(dir)}`)
      ).json();
      expect(data.ok).toBe(true);
      expect(data.path).toBe(dir);
      expect(data.parent).toBe(dirname(dir));
      const names = data.dirs.map((d) => d.name);
      expect(names).toContain('sub-a');
      expect(names).toContain('sub-b');
      expect(names).not.toContain('.hidden'); // dotfiles hidden
      expect(names).not.toContain('a-file.txt'); // files excluded
    });
  });

  it('GET /api/fs/list 400s on a non-existent path', async () => {
    await withServer(dir, {}, async (base) => {
      const res = await fetch(
        `${base}/api/fs/list?path=${encodeURIComponent('/no/such/path/here')}`,
      );
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
