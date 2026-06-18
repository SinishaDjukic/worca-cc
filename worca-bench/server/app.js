// server/app.js
//
// Express app for the worca-bench dashboard. Structure mirrors
// worca-ui/server/app.js: createApp() returns a configured app with security
// headers, JSON body parsing, the JSON API, static asset serving, and a SPA
// catch-all. The app reads benchmark results from a target directory passed in
// via options.targetDir (the runner's --target-dir / WORCA_BENCH_DIR).

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import {
  findAction,
  patchAction,
  pidAlive,
  readActions,
} from './actions-store.js';
import {
  activeByProfile,
  discoverActiveMulti,
  discoverRegradesMulti,
} from './active-runs.js';
import {
  getLeaderboard,
  leaderboardBenchmarks,
  localLeaderboardRows,
} from './leaderboard.js';
import { runBenchmark, runRegrade } from './process-manager.js';
import {
  aggregateByProfile,
  aggregateProfile,
  compareProfiles,
  dedupeReps,
  readProfileDefsMulti,
  readResultsMulti,
  srcHash,
} from './results-store.js';
import {
  clearProfileResults,
  stopPidTree,
  stopProfileRuns,
  stopRegrade,
} from './run-control.js';
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
  const regrade = options._runRegrade || runRegrade;
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

  // In-memory spawn overlay for the Activity dock. The CLI is the authoritative
  // ledger writer (it records its own lifecycle to actions.jsonl), but it takes
  // ~1s to boot before it can write — so on spawn we remember the pid here to (a)
  // show an instant 'starting' row and (b) catch a crash-on-boot (pid dies before
  // the CLI records anything). Pruned once the CLI's record appears (matched by
  // pid) or it ages out. Not persisted — it only covers the brief boot window.
  const pendingSpawns = new Map();
  const SPAWN_GRACE_MS = 30_000;
  const notePendingSpawn = (pid, kind, profile) => {
    if (Number.isInteger(pid)) {
      pendingSpawns.set(pid, {
        type: kind,
        profile,
        source_dir: targetDir,
        started_at: new Date().toISOString(),
      });
    }
  };

  // Effective read set = launch dir (always) + configured dirs (settings.json).
  const effectiveDirs = () => resolveResultDirs(targetDir, settingsHome).dirs;
  const readRows = () => readResultsMulti(effectiveDirs());
  const readDefs = () => readProfileDefsMulti(effectiveDirs());
  const readActive = () => discoverActiveMulti(effectiveDirs());
  const readRegrades = () => discoverRegradesMulti(effectiveDirs());
  // The latest regrade heartbeat for one profile (scoped by src when given).
  const regradeFor = (name, src) =>
    readRegrades().find((r) => r.profile === name && (!src || r.src === src)) ||
    null;

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
      const known = new Set(aggregates.map((a) => `${a.src}::${a.name}`));
      for (const def of readDefs()) {
        // def._source_dir is <dir>/profiles; the result-dir src is its parent.
        const dir = dirname(def._source_dir);
        const src = srcHash(dir);
        if (known.has(`${src}::${def.name}`)) continue;
        known.add(`${src}::${def.name}`);
        aggregates.push({
          name: def.name,
          src,
          source_dir: dir,
          source_label: basename(dir),
          benchmark: def.benchmark,
          worca_ref: null,
          worca_version: null,
          template: def.template,
          grade_mode: def.grade_mode,
          canary: def.canary,
          max_parallel: def.max_parallel,
          graphify: def.graphify,
          code_review_graph: def.code_review_graph,
          preflight: def.preflight,
          timeout: def.timeout,
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
      const regradeMap = new Map();
      for (const r of readRegrades()) {
        if (r.active) regradeMap.set(`${r.src}::${r.profile}`, r);
      }
      for (const agg of aggregates) {
        const run = active.get(`${agg.src}::${agg.name}`);
        if (run) {
          agg.active = true;
          agg.stage = run.stage;
          agg.phase = run.phase;
          agg.pipeline_status = run.pipeline_status;
          agg.active_kind = run.kind;
        }
        const rg = regradeMap.get(`${agg.src}::${agg.name}`);
        if (rg) {
          agg.regrade = {
            done: rg.done,
            total: rg.total,
            mode: rg.mode,
            current: rg.current,
          };
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
      // Optional src scopes to one result dir (same name can exist in several).
      const src = req.query.src ? String(req.query.src) : null;
      const matchSrc = (dir) => !src || srcHash(dir) === src;
      const rows = readRows().filter(
        (r) => (r.profile || '(unknown)') === name && matchSrc(r._source_dir),
      );
      const active = readActive().filter(
        (r) => r.profile === name && (!src || r.src === src),
      );
      // The selected-instance count lives in the YAML def, not in results rows;
      // look it up regardless of whether the profile has run yet.
      const def = readDefs().find(
        (d) => d.name === name && matchSrc(dirname(d._source_dir)),
      );
      const instanceCount = def ? (def.instance_count ?? null) : null;
      if (rows.length > 0) {
        return res.json({
          ok: true,
          aggregate: {
            ...aggregateProfile(name, rows),
            instance_count: instanceCount,
            // config-only fields (never in results rows) — read from the profile def
            // so the run-options panel can seed its defaults from the profile.
            canary: def?.canary ?? null,
            max_parallel: def?.max_parallel ?? null,
            graphify: def?.graphify ?? null,
            code_review_graph: def?.code_review_graph ?? null,
            preflight: def?.preflight ?? null,
            timeout: def?.timeout ?? null,
          },
          reps: dedupeReps(rows), // collapse re-runs in the per-rep table
          active,
          regrade: regradeFor(name, src),
        });
      }
      if (!def && active.length === 0) {
        return res.status(404).json({ ok: false, error: 'profile not found' });
      }
      const defDir = def ? dirname(def._source_dir) : null;
      res.json({
        ok: true,
        aggregate: {
          ...aggregateProfile(name, []),
          src: def ? srcHash(defDir) : src,
          source_dir: defDir,
          source_label: defDir ? basename(defDir) : null,
          benchmark: def?.benchmark || null,
          template: def?.template || null,
          grade_mode: def?.grade_mode || null,
          canary: def?.canary ?? null,
          max_parallel: def?.max_parallel ?? null,
          graphify: def?.graphify ?? null,
          code_review_graph: def?.code_review_graph ?? null,
          preflight: def?.preflight ?? null,
          timeout: def?.timeout ?? null,
          instance_count: instanceCount,
          active: active.length > 0,
        },
        reps: [],
        active,
        regrade: regradeFor(name, src),
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Reject anything that isn't a safe profile-name identifier.
  const _badName = (name) => !/^[A-Za-z0-9_.-]+$/.test(name);

  // Stop all active runs for a profile (kills the runner process tree).
  app.post('/api/profiles/:name/stop', async (req, res) => {
    if (_badName(req.params.name)) {
      return res.status(400).json({ ok: false, error: 'invalid profile name' });
    }
    try {
      const stopped = await stopProfileRuns(req.params.name);
      res.json({ ok: true, stopped });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Clear a profile's recorded results — refused while it has active runs.
  app.post('/api/profiles/:name/clear', (req, res) => {
    if (_badName(req.params.name)) {
      return res.status(400).json({ ok: false, error: 'invalid profile name' });
    }
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
        maxParallel: _posInt(req.body?.maxParallel),
        // Canary override: an explicit boolean from the UI toggle is authoritative
        // (overrides the profile's canary flag); omit to leave the profile default.
        canary:
          typeof req.body?.canary === 'boolean' ? req.body.canary : undefined,
        cacheDir: resolveCacheDir(settingsHome).dir,
        graphify: _engineMode(req.body?.graphify),
        codeReviewGraph: _engineMode(req.body?.codeReviewGraph),
        // Preflight on/off (only when an explicit boolean is sent) + CLAUDE.md
        // load mode (allowlisted; ignored otherwise).
        preflight:
          typeof req.body?.preflight === 'boolean'
            ? req.body.preflight
            : undefined,
        claudeMdMode: ['none', 'project', 'project+local', 'all'].includes(
          req.body?.claudeMdMode,
        )
          ? req.body.claudeMdMode
          : undefined,
        // Grader backend override (allowlisted; ignored otherwise). Defaults to
        // the profile's own grade.mode when omitted.
        gradeMode: ['stub', 'sb-cli', 'local-docker', 'modal'].includes(
          req.body?.gradeMode,
        )
          ? req.body.gradeMode
          : undefined,
        // Per-build timeout override (seconds). A non-negative integer is
        // authoritative (0 = no limit); omit to use the profile's own value.
        timeout:
          typeof req.body?.timeout === 'number' &&
          Number.isInteger(req.body.timeout) &&
          req.body.timeout >= 0
            ? req.body.timeout
            : undefined,
        // Grader credentials forwarded from the browser; the launcher allowlists
        // and merges them into the runner's env (never persisted server-side).
        secrets: req.body?.secrets,
      });
      // The spawned CLI records its own lifecycle to actions.jsonl; note the pid
      // so the dock shows an instant 'starting' row during the CLI's boot window.
      notePendingSpawn(pid, 'run', profile);
      res.json({ ok: true, pid });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Fire-and-forget: re-grade a profile's saved diffs (no pipeline re-run).
  app.post('/api/regrade', async (req, res) => {
    const profile = req.body?.profile;
    if (!profile) {
      return res.status(400).json({ ok: false, error: 'profile is required' });
    }
    if (_badName(profile)) {
      return res.status(400).json({ ok: false, error: 'invalid profile name' });
    }
    const instance = req.body?.instance;
    if (instance != null && _badName(instance)) {
      return res.status(400).json({ ok: false, error: 'invalid instance id' });
    }
    const mode = req.body?.mode;
    if (
      mode != null &&
      !['sb-cli', 'local-docker', 'modal', 'stub'].includes(mode)
    ) {
      return res.status(400).json({ ok: false, error: 'invalid grade mode' });
    }
    // Refuse a second sweep while one is live — two processes racing the same
    // results.jsonl would clobber each other's verdicts.
    if (readRegrades().some((r) => r.profile === profile && r.active)) {
      return res.status(409).json({
        ok: false,
        error: 'a regrade is already running for this profile',
      });
    }
    try {
      const def = readDefs().find((d) => d.name === profile);
      const { pid } = await regrade({
        profile,
        targetDir,
        profilesDir: def?._source_dir,
        instance: instance || undefined,
        mode: mode || undefined,
        onlyErrors: req.body?.onlyErrors === true,
        sequential: req.body?.sequential === true,
        logPath: join(targetDir, 'runs', profile, 'regrade.log'),
        secrets: req.body?.secrets,
      });
      // The spawned regrade CLI records its own lifecycle; note the pid for the
      // instant 'starting' row during boot.
      notePendingSpawn(pid, 'regrade', profile);
      res.json({ ok: true, pid });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── Actions ledger (Activity dock) ─────────────────────────────────────
  // Persistent, reload-surviving list of Run/Regrade launches with lifecycle +
  // derived progress. Reconciles dead pids to a terminal state on read.
  app.get('/api/actions', (_req, res) => {
    try {
      const actions = readActions(targetDir); // dead pids reconciled to terminal
      const rows = readRows();
      const regrades = readRegrades();
      const defs = readDefs();
      // src is backfilled here (the CLI records source_dir, not src, to avoid a
      // JS/Python hash mismatch). Progress is whatever the CLI wrote; only when a
      // record predates progress-writing do we derive it from results/heartbeats.
      const enriched = actions.map((a) => {
        const src = a.src ?? (a.source_dir ? srcHash(a.source_dir) : null);
        if (a.progress) return { ...a, src };
        if (a.type === 'run') {
          const since = a.started_at || '';
          const mine = rows.filter(
            (r) => r.profile === a.profile && (r.completed_at || '') >= since,
          );
          const done = mine.filter((r) =>
            ['graded', 'error', 'skipped'].includes(r.status),
          ).length;
          const errors = mine.filter((r) => r.status === 'error').length;
          const def = defs.find((d) => d.name === a.profile);
          return {
            ...a,
            src,
            progress: {
              unit: 'instances',
              done,
              errors,
              total: def?.instance_count ?? null,
            },
          };
        }
        const rg = regrades.find((r) => r.profile === a.profile);
        if (rg) {
          return {
            ...a,
            src,
            progress: {
              unit: 'regraded',
              done: rg.done,
              total: rg.total,
              errors: rg.counts?.error ?? 0,
            },
          };
        }
        return { ...a, src, progress: null };
      });

      // Overlay the spawn map for the boot window: a pid not yet in the ledger is
      // either still booting (→ instant 'starting' row) or crashed before
      // recording (→ synthetic 'failed'). Prune once the CLI takes over (its
      // record carries the same pid) or after the grace window.
      const ledgerPids = new Set(actions.map((a) => a.pid).filter(Boolean));
      const now = Date.now();
      for (const [pid, sp] of pendingSpawns) {
        if (ledgerPids.has(pid)) {
          pendingSpawns.delete(pid); // CLI recorded it — drop the placeholder
          continue;
        }
        const ageMs = now - Date.parse(sp.started_at);
        const alive = pidAlive(pid);
        const base = {
          id: `pending-${pid}`,
          type: sp.type,
          profile: sp.profile,
          src: srcHash(sp.source_dir),
          pid,
          started_at: sp.started_at,
        };
        if (alive) {
          enriched.unshift({ ...base, status: 'running', progress: null });
          if (ageMs > SPAWN_GRACE_MS) pendingSpawns.delete(pid); // CLI never recorded
        } else {
          if (ageMs < SPAWN_GRACE_MS) {
            enriched.unshift({
              ...base,
              status: 'failed',
              error: 'launch failed — process exited before recording',
              ended_at: new Date().toISOString(),
              progress: null,
            });
          }
          pendingSpawns.delete(pid);
        }
      }
      enriched.sort((x, y) =>
        (y.started_at || '').localeCompare(x.started_at || ''),
      );
      res.json({ ok: true, actions: enriched });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Stop one action by id: SIGTERM→SIGKILL its runner tree, mark it stopped.
  app.post('/api/actions/:id/stop', async (req, res) => {
    try {
      const a = findAction(targetDir, req.params.id);
      if (a) {
        const stopped = await stopPidTree(a.pid);
        patchAction(targetDir, a.id, {
          status: 'stopped',
          ended_at: new Date().toISOString(),
        });
        return res.json({ ok: true, stopped });
      }
      // A still-booting action exists only as a `pending-<pid>` overlay row (the
      // CLI hasn't written its ledger record yet) — stop it by pid directly.
      const m = /^pending-(\d+)$/.exec(req.params.id);
      if (m) {
        const pid = Number(m[1]);
        const stopped = await stopPidTree(pid);
        pendingSpawns.delete(pid);
        return res.json({ ok: true, stopped });
      }
      return res.status(404).json({ ok: false, error: 'action not found' });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── Per-profile human notes (stored alongside results) ─────────────────
  // Free-text notes saved at <targetDir>/notes/<profile>.md so they persist with
  // the run data and survive reloads. Capped to keep a localhost tool sane.
  const NOTES_CAP = 200_000;
  const notesPath = (name) => join(targetDir, 'notes', `${name}.md`);

  app.get('/api/profiles/:name/notes', (req, res) => {
    if (_badName(req.params.name)) {
      return res.status(400).json({ ok: false, error: 'invalid profile name' });
    }
    try {
      const f = notesPath(req.params.name);
      const notes = existsSync(f) ? readFileSync(f, 'utf8') : '';
      res.json({ ok: true, notes });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.put('/api/profiles/:name/notes', (req, res) => {
    if (_badName(req.params.name)) {
      return res.status(400).json({ ok: false, error: 'invalid profile name' });
    }
    const notes = typeof req.body?.notes === 'string' ? req.body.notes : '';
    if (notes.length > NOTES_CAP) {
      return res.status(413).json({ ok: false, error: 'notes too large' });
    }
    try {
      mkdirSync(join(targetDir, 'notes'), { recursive: true });
      writeFileSync(notesPath(req.params.name), notes);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Stop an in-flight regrade sweep for a profile (kills the runner tree).
  app.post('/api/profiles/:name/regrade/stop', async (req, res) => {
    if (_badName(req.params.name)) {
      return res.status(400).json({ ok: false, error: 'invalid profile name' });
    }
    try {
      const stopped = await stopRegrade(req.params.name, effectiveDirs());
      res.json({ ok: true, stopped });
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
