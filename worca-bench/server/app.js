// server/app.js
//
// Express app for the worca-bench dashboard. Structure mirrors
// worca-ui/server/app.js: createApp() returns a configured app with security
// headers, JSON body parsing, the JSON API, static asset serving, and a SPA
// catch-all. The app reads benchmark results from a target directory passed in
// via options.targetDir (the runner's --target-dir / WORCA_BENCH_DIR).

import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { activeByProfile, discoverActiveMulti } from './active-runs.js';
import {
  getLeaderboard,
  leaderboardBenchmarks,
  localLeaderboardRows,
} from './leaderboard.js';
import { runBenchmark } from './process-manager.js';
import {
  aggregateByProfile,
  aggregateProfile,
  compareProfiles,
  dedupeReps,
  readProfileDefsMulti,
  readResultsMulti,
} from './results-store.js';
import { clearProfileResults, stopProfileRuns } from './run-control.js';
import {
  addResultDir,
  loadSettings,
  removeResultDir,
  resolveCacheDir,
  resolveResultDirs,
  setCacheDir,
} from './settings-store.js';

/**
 * @param {object} options
 * @param {string} options.targetDir  directory holding results.jsonl + profiles/
 * @param {(opts: object) => Promise<{pid: number}>} [options._runBenchmark]  injectable for tests
 * @returns {import('express').Express}
 */
export function createApp(options = {}) {
  const app = express();
  const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
  const targetDir = options.targetDir || process.cwd();
  const launch = options._runBenchmark || runBenchmark;
  const settingsHome = options.settingsHome;

  // Coerce a request value to a positive integer, else undefined (use default).
  const _posInt = (v) => {
    const n = Number.parseInt(v, 10);
    return Number.isInteger(n) && n >= 1 ? n : undefined;
  };

  // Coerce an engine toggle to a mode string: `true` -> 'structural', a non-empty
  // string -> that mode, anything else -> undefined (engine stays off).
  const _engineMode = (v) => {
    if (v === true) return 'structural';
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };

  // Effective read set = launch dir (always) + configured dirs (settings.json).
  const effectiveDirs = () => resolveResultDirs(targetDir, settingsHome).dirs;
  const readRows = () => readResultsMulti(effectiveDirs());
  const readDefs = () => readProfileDefsMulti(effectiveDirs());
  const readActive = () => discoverActiveMulti(effectiveDirs());

  app.use(express.json());

  // ─── Security headers ──────────────────────────────────────────────────
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  // ─── API ───────────────────────────────────────────────────────────────

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Aggregated per-profile summaries. Surfaces the cheap profile-def fields
  // (benchmark) for profiles that have a YAML definition but no results yet.
  app.get('/api/profiles', (_req, res) => {
    try {
      const rows = readRows();
      const aggregates = aggregateByProfile(rows);
      const known = new Set(aggregates.map((a) => a.name));
      for (const def of readDefs()) {
        if (known.has(def.name)) continue;
        aggregates.push({
          name: def.name,
          benchmark: def.benchmark,
          worca_ref: null,
          worca_version: null,
          template: def.template,
          grade_mode: def.grade_mode,
          reps: 0,
          graded: 0,
          resolved: 0,
          resolved_rate: 0,
          mean_cost_usd: null,
          mean_wall_s: null,
          mean_iterations: null,
          n: 0,
          last_run: null,
        });
      }
      // Fold in live status from in-flight work trees (running profiles surface
      // a current stage before any results.jsonl row exists).
      const active = activeByProfile(readActive());
      for (const agg of aggregates) {
        const run = active.get(agg.name);
        if (run) {
          agg.active = true;
          agg.stage = run.stage;
          agg.phase = run.phase;
          agg.pipeline_status = run.pipeline_status;
          agg.active_kind = run.kind;
        }
      }
      aggregates.sort((a, b) => a.name.localeCompare(b.name));
      res.json({ ok: true, profiles: aggregates });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // One profile: aggregate + the individual reps for the detail table. A
  // profile that has a YAML def but no results yet (reps: 0) is still openable —
  // we synthesize a def-based aggregate so the detail page (and its Run options)
  // render. Only 404 when neither results nor a def exist for the name.
  app.get('/api/profiles/:name', (req, res) => {
    try {
      const name = req.params.name;
      const rows = readRows();
      const reps = rows.filter((r) => (r.profile || '(unknown)') === name);
      const active = readActive().filter((r) => r.profile === name);
      if (reps.length > 0) {
        return res.json({
          ok: true,
          aggregate: aggregateProfile(name, reps),
          reps: dedupeReps(reps), // collapse re-runs in the per-rep table
          active,
        });
      }
      const def = readDefs().find((d) => d.name === name);
      if (!def && active.length === 0) {
        return res.status(404).json({ ok: false, error: 'profile not found' });
      }
      res.json({
        ok: true,
        aggregate: {
          ...aggregateProfile(name, []),
          benchmark: def?.benchmark || null,
          template: def?.template || null,
          grade_mode: def?.grade_mode || null,
          active: active.length > 0,
        },
        reps: [],
        active,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Stop all active runs for a profile (kills the runner process tree).
  app.post('/api/profiles/:name/stop', async (req, res) => {
    try {
      const stopped = await stopProfileRuns(req.params.name);
      res.json({ ok: true, stopped });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Clear a profile's recorded results — refused while it has active runs.
  app.post('/api/profiles/:name/clear', (req, res) => {
    try {
      const active = readActive().filter((r) => r.profile === req.params.name);
      if (active.length > 0) {
        return res.status(409).json({
          ok: false,
          error: 'profile has active runs — stop them first',
        });
      }
      const removed = clearProfileResults(req.params.name, effectiveDirs());
      res.json({ ok: true, removed });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Live in-flight runs (read from worca status.json under work/).
  app.get('/api/active', (_req, res) => {
    try {
      res.json({ ok: true, active: readActive() });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Raw rows — escape hatch for ad-hoc inspection.
  app.get('/api/results', (_req, res) => {
    try {
      res.json({ ok: true, results: readRows() });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Side-by-side config comparison. ?profiles=a,b,c
  app.get('/api/compare', (req, res) => {
    try {
      const names = String(req.query.profiles || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const rows = readRows();
      res.json({ ok: true, compare: compareProfiles(rows, names) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Public cross-agent leaderboard — live fetch + cache + offline fallback (leaderboard.js).
  app.get('/api/leaderboard', async (req, res) => {
    try {
      const benchmark = String(req.query.benchmark || 'swe-bench-verified');
      const localRows = localLeaderboardRows(
        aggregateByProfile(readRows()),
        benchmark,
      );
      res.json({
        ok: true,
        benchmark,
        rows: await getLeaderboard(benchmark, {
          offline: options.leaderboardOffline,
          localRows,
        }),
        benchmarks: leaderboardBenchmarks(),
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Fire-and-forget: spawn the Python runner for a profile.
  app.post('/api/run', async (req, res) => {
    const profile = req.body?.profile;
    if (!profile) {
      return res.status(400).json({ ok: false, error: 'profile is required' });
    }
    try {
      // Find where this profile's YAML lives so a profile authored in a
      // configured (non-primary) dir is still findable by the runner.
      const def = readDefs().find((d) => d.name === profile);
      const { pid } = await launch({
        profile,
        targetDir,
        profilesDir: def?._source_dir,
        reps: _posInt(req.body?.reps),
        maxInstances: _posInt(req.body?.maxInstances),
        cacheDir: resolveCacheDir(settingsHome).dir,
        graphify: _engineMode(req.body?.graphify),
        codeReviewGraph: _engineMode(req.body?.codeReviewGraph),
      });
      res.json({ ok: true, pid });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── Settings: result-dir management (~/.worca-bench/settings.json) ──────

  const settingsPayload = () => {
    const resolved = resolveResultDirs(targetDir, settingsHome);
    return {
      ok: true,
      primary: resolved.primary, // launch --target-dir, always included
      configured: loadSettings(settingsHome).result_dirs,
      effective: resolved.dirs, // what the dashboard actually reads
      cache: resolveCacheDir(settingsHome), // { dir, source } for HF/repo blobs
    };
  };

  app.get('/api/settings', (_req, res) => {
    try {
      res.json(settingsPayload());
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/settings/dirs', (req, res) => {
    const dir = req.body?.dir;
    if (!dir) {
      return res.status(400).json({ ok: false, error: 'dir is required' });
    }
    try {
      addResultDir(dir, settingsHome);
      res.json(settingsPayload());
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.delete('/api/settings/dirs', (req, res) => {
    const dir = req.body?.dir;
    if (!dir) {
      return res.status(400).json({ ok: false, error: 'dir is required' });
    }
    try {
      removeResultDir(dir, settingsHome);
      res.json(settingsPayload());
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Directory browser for the folder picker. Lists immediate subdirectories of
  // ?path (default: home). Dirs only — a low-risk read for a localhost tool.
  app.get('/api/fs/list', (req, res) => {
    try {
      const abs = resolve(req.query.path ? String(req.query.path) : homedir());
      const dirs = readdirSync(abs, { withFileTypes: true })
        .filter((e) => {
          if (!e.name.startsWith('.')) return e.isDirectory();
          return false;
        })
        .map((e) => ({ name: e.name, path: join(abs, e.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const parent = dirname(abs);
      res.json({
        ok: true,
        path: abs,
        parent: parent === abs ? null : parent,
        dirs,
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // Set (body.dir) or clear (empty body.dir) the benchmark cache dir.
  app.post('/api/settings/cache-dir', (req, res) => {
    try {
      setCacheDir(req.body?.dir, settingsHome);
      res.json(settingsPayload());
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // ─── Static + SPA catch-all ────────────────────────────────────────────
  app.use(express.static(appDir));
  app.get('/{*splat}', (_req, res) => {
    res.sendFile('index.html', { root: appDir });
  });

  return app;
}
