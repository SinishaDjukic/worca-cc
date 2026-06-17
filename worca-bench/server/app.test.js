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

  it('POST /api/run forwards graphify + code-review-graph engine modes', async () => {
    let captured = null;
    const fakeRun = async (opts) => {
      captured = opts;
      return { pid: 9 };
    };
    await withServer(dir, { _runBenchmark: fakeRun }, async (base) => {
      await fetch(`${base}/api/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // `true` coerces to the default mode; a string passes through.
        body: JSON.stringify({
          profile: 'p1',
          graphify: true,
          codeReviewGraph: 'structural',
        }),
      });
      expect(captured.graphify).toBe('structural');
      expect(captured.codeReviewGraph).toBe('structural');
    });
  });

  it('POST /api/regrade forwards profile/instance/mode to the regrader', async () => {
    let captured = null;
    const fakeRegrade = async (opts) => {
      captured = opts;
      return { pid: 77 };
    };
    await withServer(dir, { _runRegrade: fakeRegrade }, async (base) => {
      const res = await fetch(`${base}/api/regrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: 'p1',
          instance: 'astropy__astropy-12907',
          mode: 'sb-cli',
        }),
      });
      const data = await res.json();
      expect(data).toEqual({ ok: true, pid: 77 });
      expect(captured.profile).toBe('p1');
      expect(captured.instance).toBe('astropy__astropy-12907');
      expect(captured.mode).toBe('sb-cli');
    });
  });

  it('POST /api/run forwards browser secrets to the launcher', async () => {
    let captured = null;
    const fakeRun = async (opts) => {
      captured = opts;
      return { pid: 21 };
    };
    await withServer(dir, { _runBenchmark: fakeRun }, async (base) => {
      await fetch(`${base}/api/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: 'p1',
          secrets: { SWEBENCH_API_KEY: 'swb', MODAL_TOKEN_ID: 'mid' },
        }),
      });
      expect(captured.secrets).toEqual({
        SWEBENCH_API_KEY: 'swb',
        MODAL_TOKEN_ID: 'mid',
      });
    });
  });

  it('POST /api/regrade forwards mode + secrets to the regrader', async () => {
    let captured = null;
    const fakeRegrade = async (opts) => {
      captured = opts;
      return { pid: 22 };
    };
    await withServer(dir, { _runRegrade: fakeRegrade }, async (base) => {
      await fetch(`${base}/api/regrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: 'p1',
          instance: 'astropy__astropy-12907',
          mode: 'modal',
          secrets: { MODAL_TOKEN_ID: 'mid', MODAL_TOKEN_SECRET: 'msec' },
        }),
      });
      expect(captured.mode).toBe('modal');
      expect(captured.secrets).toEqual({
        MODAL_TOKEN_ID: 'mid',
        MODAL_TOKEN_SECRET: 'msec',
      });
    });
  });

  it('POST /api/regrade supports a whole-profile sequential sweep (no instance)', async () => {
    let captured = null;
    const fakeRegrade = async (opts) => {
      captured = opts;
      return { pid: 88 };
    };
    await withServer(dir, { _runRegrade: fakeRegrade }, async (base) => {
      const res = await fetch(`${base}/api/regrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: 'p1',
          mode: 'modal',
          sequential: true,
          secrets: { MODAL_TOKEN_ID: 'mid', MODAL_TOKEN_SECRET: 'msec' },
        }),
      });
      expect((await res.json()).ok).toBe(true);
      expect(captured.instance).toBeUndefined();
      expect(captured.mode).toBe('modal');
      expect(captured.sequential).toBe(true);
      expect(captured.secrets.MODAL_TOKEN_ID).toBe('mid');
    });
  });

  // Write a regrade heartbeat under <dir>/runs/<profile>/regrade-status.json.
  function seedRegradeHeartbeat(targetDir, profile, hb) {
    const d = join(targetDir, 'runs', profile);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'regrade-status.json'), JSON.stringify(hb));
  }

  it('GET /api/profiles/:name includes a live regrade heartbeat', async () => {
    writeFileSync(join(dir, 'results.jsonl'), `${JSON.stringify(row())}\n`);
    seedRegradeHeartbeat(dir, 'p1', {
      profile: 'p1',
      mode: 'modal',
      pid: process.pid,
      total: 20,
      done: 7,
      current: 'astropy__astropy-14539',
      counts: { graded: 7, resolved: 4, error: 0 },
      status: 'running',
    });
    await withServer(dir, {}, async (base) => {
      const data = await (await fetch(`${base}/api/profiles/p1`)).json();
      expect(data.regrade.active).toBe(true);
      expect(data.regrade.done).toBe(7);
      expect(data.regrade.current).toBe('astropy__astropy-14539');
    });
  });

  it('POST /api/regrade returns 409 when a sweep is already running', async () => {
    let launched = false;
    const fakeRegrade = async () => {
      launched = true;
      return { pid: 1 };
    };
    seedRegradeHeartbeat(dir, 'p1', {
      profile: 'p1',
      pid: process.pid,
      status: 'running',
      total: 20,
      done: 1,
    });
    await withServer(dir, { _runRegrade: fakeRegrade }, async (base) => {
      const res = await fetch(`${base}/api/regrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: 'p1', mode: 'modal' }),
      });
      expect(res.status).toBe(409);
      expect(launched).toBe(false); // never spawned a second sweep
    });
  });

  it('POST /api/profiles/:name/regrade/stop stops a tracked sweep', async () => {
    // Implausible pid → stopRegrade finds the heartbeat but kills nothing real.
    seedRegradeHeartbeat(dir, 'p1', {
      profile: 'p1',
      pid: 2147483000,
      status: 'running',
    });
    await withServer(dir, {}, async (base) => {
      const res = await fetch(`${base}/api/profiles/p1/regrade/stop`, {
        method: 'POST',
      });
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.stopped).toBe(1);
    });
  });

  it('POST /api/regrade rejects a bad instance id and bad mode', async () => {
    await withServer(
      dir,
      { _runRegrade: async () => ({ pid: 1 }) },
      async (base) => {
        const bad = await fetch(`${base}/api/regrade`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile: 'p1', instance: 'a; rm -rf /' }),
        });
        expect(bad.status).toBe(400);
        const badMode = await fetch(`${base}/api/regrade`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile: 'p1', mode: 'evil' }),
        });
        expect(badMode.status).toBe(400);
      },
    );
  });

  it('POST /api/regrade requires a profile', async () => {
    await withServer(
      dir,
      { _runRegrade: async () => ({ pid: 1 }) },
      async (base) => {
        const res = await fetch(`${base}/api/regrade`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
      },
    );
  });

  it('POST /api/run maps canary:false to noCanary (default keeps canary on)', async () => {
    let captured = null;
    const fakeRun = async (opts) => {
      captured = opts;
      return { pid: 10 };
    };
    await withServer(dir, { _runBenchmark: fakeRun }, async (base) => {
      // Explicit opt-out disables the canary.
      await fetch(`${base}/api/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: 'p1', canary: false }),
      });
      expect(captured.noCanary).toBe(true);

      // Omitted (or true) leaves the canary on.
      await fetch(`${base}/api/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: 'p1' }),
      });
      expect(captured.noCanary).toBe(false);
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

  it('POST /api/profiles/:name/stop returns 0 when nothing is running', async () => {
    await withServer(dir, {}, async (base) => {
      const res = await fetch(`${base}/api/profiles/p1/stop`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, stopped: 0 });
    });
  });

  it('POST /api/profiles/:name/clear drops that profile rows', async () => {
    writeFileSync(
      join(dir, 'results.jsonl'),
      `${JSON.stringify(row({ profile: 'p1' }))}\n${JSON.stringify(row({ profile: 'p2' }))}\n`,
    );
    await withServer(dir, {}, async (base) => {
      const res = await fetch(`${base}/api/profiles/p1/clear`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      expect((await res.json()).removed).toBe(1);
      // p1 gone from the aggregate, p2 stays.
      const { profiles } = await (await fetch(`${base}/api/profiles`)).json();
      expect(profiles.map((p) => p.name)).toEqual(['p2']);
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
