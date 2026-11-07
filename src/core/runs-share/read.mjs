// src/core/runs-share/read.mjs — teammates' runs from the `worca-runs` branch (run sharing s2).
// Read without a checkout: one fetch of the branch per project per TTL (callers join one in-flight read), then
// `ls-tree -r -z -l` and `cat-file blob` of the entries that pass the path, mode and size checks. Every record passes
// slice 1's `sanitizeRecord` and must sit at the path its own keys name. The keys this machine publishes under are
// dropped on every answer. The only ref this module changes is refs/remotes/origin/worca-runs (D1); it writes no file
// and no pref. Everything on the branch is written by anyone with push access, so every byte is treated as hostile.
import { listProjects } from '../projects.mjs';
import { readRunsSharePrefs } from '../config.mjs';
import { runGit, fetchTeamBranch, MISSING_REMOTE_REF } from '../metrics/sync.mjs';
import { personKey as personKeyOf, PERSON_KEY_RE } from '../metrics/record.mjs';
import { FETCH_TTL_MS, FETCH_FAIL_TTL_MS } from '../metrics/read.mjs';
import { mapWithCap } from '../fanout.mjs';
import { sanitizeRecord, RECORD_MAX_BYTES } from './record.mjs';
import { RUNS_BRANCH, RUNS_REMOTE_REF } from './branch.mjs';
import { runsShareStartError, shareErrorText } from './publish.mjs';

export const TEAM_RUNS_FETCH_TTL_MS = FETCH_TTL_MS;
export const TEAM_RUNS_FAIL_TTL_MS = FETCH_FAIL_TTL_MS;
/** A running record without an update for this long is stale (the publisher's keep-alive is 10 minutes). */
export const TEAM_RUN_STALE_MS = 1_200_000;
export const MAX_TEAM_RECORDS = 500;
export const TEAM_PATH_RE = /^runs\/([0-9a-f]{16})\/([0-9a-f]{8})\.json$/;

const FETCH_TIMEOUT_MS = 30_000;
const BLOB_CACHE_MAX = 2000;
const READ_FAILED = 'Could not read the worca-runs branch.';
const START_STATES = { NO_GIT: 'git-missing', FOLDER_PROJECT: 'not-git', NO_ORIGIN: 'no-origin' };
const LIVE = new Set(['running', 'pausing']);

let clockNow = () => Date.now();
let fetchImpl = fetchTeamBranch;
let gitOverride = null;
let maxRecords = MAX_TEAM_RECORDS;
let projectsImpl = listProjects;

/** projectKey → { state, error, tip, records, truncated, okAt, failAt, fetchedAt, inflight } */
const cache = new Map();
/** blob sha → { rec } | { bad: 'json'|'schema' } (content-addressed: never stale). */
const blobs = new Map();

const gitOf = () => gitOverride || runGit;
const warn = (text) => { try { console.warn(`run sharing: ${text}`); } catch { /* never throws */ } };

/** Every key this machine publishes under for the project (D8). Never creates a key; never throws. */
export async function myPersonKeys(projectKey, projectDir, { git = gitOf() } = {}) {
  const keys = new Set();
  try {
    const prefs = readRunsSharePrefs(projectKey) || {};
    if (typeof prefs.machineKey === 'string' && PERSON_KEY_RE.test(prefs.machineKey)) keys.add(prefs.machineKey);
  } catch { /* the keys found so far */ }
  // The git-user key is mine whatever the attribution is now: records published under it before a switch to `none`
  // are still mine. This is a local read and publishes nothing.
  try {
    const r = await git(projectDir, ['config', 'user.email'], { timeoutMs: 10_000 });
    const email = r.ok ? r.stdout.trim() : '';
    const pk = email ? personKeyOf(email) : null;
    if (pk) keys.add(pk);
  } catch { /* the keys found so far */ }
  return keys;
}

/** `ls-tree -r -z -l` output → entries; a size of `-` (not a blob) is NaN. */
export function parseTreeListing(stdout) {
  const out = [];
  for (const item of String(stdout || '').split('\0')) {
    if (!item) continue;
    const tab = item.indexOf('\t');
    if (tab < 0) continue;
    const [mode, type, sha, size] = item.slice(0, tab).trim().split(/\s+/);
    out.push({ mode, type, sha, size: size === '-' ? NaN : Number(size), path: item.slice(tab + 1) });
  }
  return out;
}

function rememberBlob(sha, value) {
  blobs.set(sha, value);
  while (blobs.size > BLOB_CACHE_MAX) blobs.delete(blobs.keys().next().value);
}

/**
 * The valid records at `tip` (D4–D7), in `ls-tree` order, at most `max`. Own keys are NOT dropped here.
 * @throws {Error} on a failed ls-tree or cat-file (the caller answers read-failed)
 */
export async function readTeamRecords(projectDir, tip, { git = gitOf(), max = maxRecords } = {}) {
  const dropped = { path: 0, mode: 0, size: 0, json: 0, schema: 0, mismatch: 0 };
  const ls = await git(projectDir, ['ls-tree', '-r', '-z', '-l', tip, '--', 'runs/']);
  if (!ls.ok) throw Object.assign(new Error('ls-tree failed'), { stderr: ls.stderr });
  const records = [];
  let counted = 0;
  let truncated = false;
  for (const e of parseTreeListing(ls.stdout)) {
    const m = TEAM_PATH_RE.exec(e.path);
    if (!m) { dropped.path++; continue; }
    if (e.mode !== '100644' || e.type !== 'blob') { dropped.mode++; continue; }
    if (!Number.isFinite(e.size) || e.size > RECORD_MAX_BYTES) { dropped.size++; continue; }
    if (counted >= max) { truncated = true; break; }
    counted++;
    let hit = blobs.get(e.sha);
    if (!hit) {
      const r = await git(projectDir, ['cat-file', 'blob', e.sha]);
      if (!r.ok) throw Object.assign(new Error('cat-file failed'), { stderr: r.stderr });
      let obj;
      try { obj = JSON.parse(r.stdout); } catch { obj = undefined; }
      if (obj === undefined) hit = { bad: 'json' };
      else { const rec = sanitizeRecord(obj); hit = rec ? { rec } : { bad: 'schema' }; }
      rememberBlob(e.sha, hit);
    }
    if (hit.bad) { dropped[hit.bad]++; continue; }
    if (hit.rec.personKey !== m[1] || hit.rec.runId !== m[2]) { dropped.mismatch++; continue; }
    records.push(hit.rec);
  }
  return { records, dropped, truncated };
}

/** The wire row (D14): the record minus `v`, plus where it came from and whether it went quiet. */
export function teamRunRow(rec, project, now) {
  const upd = Date.parse(rec.updatedAt);
  return {
    local: false,
    projectKey: project.key,
    projectName: project.name,
    runId: rec.runId,
    personKey: rec.personKey,
    startedBy: rec.startedBy,
    workflowId: rec.workflowId,
    status: rec.status,
    phase: rec.phase,
    stage: rec.stage,
    progress: rec.progress,
    costUsd: rec.costUsd,
    prUrl: rec.prUrl,
    startedAt: rec.startedAt,
    updatedAt: rec.updatedAt,
    finishedAt: rec.finishedAt,
    stale: LIVE.has(rec.status) && Number.isFinite(upd) && now - upd > TEAM_RUN_STALE_MS,
  };
}

function entryOf(key) {
  let e = cache.get(key);
  if (!e) {
    e = { state: null, error: null, tip: null, records: [], truncated: false, okAt: null, failAt: null, fetchedAt: null, inflight: null };
    cache.set(key, e);
  }
  return e;
}

function fresh(e, now) {
  if (e.failAt != null && (e.okAt == null || e.failAt >= e.okAt)) return now - e.failAt < TEAM_RUNS_FAIL_TTL_MS;
  return e.okAt != null && now - e.okAt < TEAM_RUNS_FETCH_TTL_MS;
}

const failed = (e, state, error, now) => { e.state = state; e.error = error; e.failAt = now; };

async function refreshEntry(e, { key, path }) {
  const git = gitOf();
  const now = clockNow();
  try {
    const startErr = await runsShareStartError(path);
    if (startErr) {
      Object.assign(e, { state: START_STATES[startErr.code] || 'not-git', error: null, tip: null, records: [], truncated: false, okAt: now });
      return;
    }
    const f = await fetchImpl(path, RUNS_BRANCH, { timeoutMs: FETCH_TIMEOUT_MS });
    if (!f.ok) {
      if (MISSING_REMOTE_REF.test(f.stderr || '')) {
        const d = await git(path, ['update-ref', '-d', RUNS_REMOTE_REF]);
        if (!d.ok) throw Object.assign(new Error('update-ref failed'), { stderr: d.stderr });
        Object.assign(e, { state: 'no-branch', error: null, tip: null, records: [], truncated: false, okAt: now, fetchedAt: new Date(now).toISOString() });
        return;
      }
      failed(e, 'fetch-failed', shareErrorText(f.stderr), now);
      return;
    }
    const rp = await git(path, ['rev-parse', '--verify', '--quiet', RUNS_REMOTE_REF]);
    const tip = rp.ok ? rp.stdout.trim() : '';
    if (!tip) throw Object.assign(new Error('rev-parse failed'), { stderr: rp.stderr });
    if (tip !== e.tip) {
      const read = await readTeamRecords(path, tip, { git, max: maxRecords });
      const d = read.dropped;
      if (Object.values(d).some(Boolean)) warn(`${key}: dropped ${Object.entries(d).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ')}`);
      Object.assign(e, { tip, records: read.records, truncated: read.truncated });
    }
    Object.assign(e, { state: 'ok', error: null, okAt: now, fetchedAt: new Date(now).toISOString() });
  } catch (err) {
    warn(`${key}: read failed: ${String(err?.stderr || err?.message || err).trim().split('\n')[0]}`);
    failed(e, 'read-failed', READ_FAILED, now);
  }
}

/**
 * One project's teammates' runs: from the cache inside the TTL, else after one fetch that concurrent callers join.
 * Never rejects. `refresh` is internal (no route exposes it).
 */
export async function readProjectTeamRuns(project, { refresh = false } = {}) {
  const e = entryOf(project.key);
  if (!e.inflight && (refresh || !fresh(e, clockNow()))) {
    const run = refreshEntry(e, project);
    e.inflight = run;
    run.finally(() => { if (e.inflight === run) e.inflight = null; });
  }
  if (e.inflight) await e.inflight;
  const mine = await myPersonKeys(project.key, project.path);
  const now = clockNow();
  return {
    key: project.key,
    state: e.state,
    rows: e.records.filter((r) => !mine.has(r.personKey)).map((r) => teamRunRow(r, project, now)),
    error: e.error,
    truncated: e.truncated,
    fetchedAt: e.fetchedAt,
  };
}

/** Teammates' runs of every eligible project (D10), newest update first. One project's failure is its own state. */
export async function listTeamRuns({ projectKey = null, concurrency = 4 } = {}) {
  const all = await projectsImpl();
  const list = projectKey ? all.filter((p) => p.key === projectKey) : all;
  const results = await mapWithCap(list, concurrency, (p) => {
    if (!p.exists || p.vcs !== 'git') {
      return { key: p.key, state: 'not-git', rows: [], error: null, truncated: false, fetchedAt: null };
    }
    return readProjectTeamRuns(p);
  });
  const rows = results.flatMap((r) => r.rows).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return {
    rows,
    projects: results.map((r, i) => ({ key: r.key, name: list[i].name, state: r.state, error: r.error, truncated: r.truncated, fetchedAt: r.fetchedAt })),
  };
}

export const _testing = {
  setClock(fn) { clockNow = fn || (() => Date.now()); },
  setFetch(fn) { fetchImpl = fn || fetchTeamBranch; },
  setGit(fn) { gitOverride = fn || null; },
  setMax(n) { maxRecords = n; },
  setProjects(fn) { projectsImpl = fn || listProjects; },
  reset() {
    cache.clear();
    blobs.clear();
    clockNow = () => Date.now();
    fetchImpl = fetchTeamBranch;
    gitOverride = null;
    maxRecords = MAX_TEAM_RECORDS;
    projectsImpl = listProjects;
  },
};
