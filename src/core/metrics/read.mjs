// src/core/metrics/read.mjs
// Team metrics read side (§4.9): fetch (rate-limited) → reset --hard → glob → parse → filter.
import { readdir, readFile, lstat, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { listProjects } from '../projects.mjs';
import { listWorkspaces, readWorkspace, WORKSPACE_KEY_RE } from '../workspaces.mjs';
import {
  METRICS_DIR, REMOTE_REF, ensureWorktree, fetchMetricsBranch, runGit, withSlugLock, worktreePath, pushHint,
  resolveProjectSink, discoverProject, listOutbox, projectMetricsStatus, workspaceMetricsStatus, recordsLocally,
} from './sync.mjs';
import { readTeamMetricsPrefs } from '../config.mjs';
import { projectKey } from '../store.mjs';
import { parseRecordLine } from '../../shared/team-metrics/aggregate.mjs';

export {
  aggregate, resolveRange, weekStartMs, parseRecordLine, toCsv, safeHttpUrl, RANGES, GROUP_BYS, CSV_COLUMNS,
} from '../../shared/team-metrics/aggregate.mjs';

export const FETCH_TTL_MS = 60_000;
export const FETCH_FAIL_TTL_MS = 15_000;          // offline: retry soon, but not on every request
export const MAX_RECORD_FILE_BYTES = 8 * 1024 * 1024;
export const PROJECT_KEY_RE = /^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/;   // server.mjs imports this (one source)

let _now = () => Date.now();
const _lastFetch = new Map();   // slug → ms of the last successful fetch (implicit or forced)
const _lastForced = new Map();  // slug → ms of the last refresh=1 fetch
const _lastFetchFail = new Map(); // slug → ms of the last failed fetch

/** "project:<projectKey>" | "workspace:<wks-…>" → {kind, id} | null */
export function parseScopeParam(s) {
  const m = /^(project|workspace):(.+)$/.exec(String(s || ''));
  if (!m) return null;
  if (m[1] === 'project' && !PROJECT_KEY_RE.test(m[2])) return null;
  if (m[1] === 'workspace' && !WORKSPACE_KEY_RE.test(m[2])) return null;
  return { kind: m[1], id: m[2] };
}

/** Parse every .worca-metrics/runs/**\/*.jsonl under a worktree. Malformed/unknown-v counted, never fatal. */
export async function readRecordsFromDir(dir) {
  const out = { records: [], files: 0, malformed: 0, unknownV: 0 };
  // A committed symlink AT .worca-metrics or .worca-metrics/runs would make readdir walk its target
  // (→ $HOME, → /) and read any *.jsonl there. lstat: isDirectory() is false for a symlink.
  for (const p of [join(dir, METRICS_DIR), join(dir, METRICS_DIR, 'runs')]) {
    const st = await lstat(p).catch(() => null);
    if (!st || !st.isDirectory()) return out;
  }
  const root = join(dir, METRICS_DIR, 'runs');
  const rootReal = await realpath(root).catch(() => null);
  if (!rootReal) return out;
  let ents;
  try { ents = await readdir(root, { recursive: true, withFileTypes: true }); } catch { return out; }
  for (const d of ents) {
    if (!d.name.endsWith('.jsonl')) continue;
    out.files += 1;
    // The branch is writable by anyone with push access: a committed symlink (→ /dev/zero, → a
    // local secret) must never be followed, and a huge file must not stall the slug lock.
    // Dirent.isFile() is false for symlinks; lstat re-checks and gives the size. The realpath
    // containment check also covers a symlinked directory INSIDE runs/ (e.g. runs/2026 → /outside):
    // lstat only inspects the last component, and readdirSync({recursive}) does walk such a link.
    const p = join(d.parentPath ?? d.path, d.name);
    const st = d.isFile() ? await lstat(p).catch(() => null) : null;
    const real = st ? await realpath(p).catch(() => null) : null;
    if (!st || !st.isFile() || st.size > MAX_RECORD_FILE_BYTES || !real || !real.startsWith(rootReal + sep)) { out.malformed += 1; continue; }
    let text;
    try { text = await readFile(p, 'utf8'); } catch { out.malformed += 1; continue; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const p = parseRecordLine(line);
      if (p.record) out.records.push(p.record);
      else if (p.unknownV) out.unknownV += 1;
      else out.malformed += 1;
    }
  }
  return out;
}

/** §4.9 rate limit: implicit fetch ≤ 1/60 s per slug; refresh=1 forces one, throttled to 1/60 s per slug. */
export function fetchDecision(slug, { refresh = false, now = _now() } = {}) {
  const sinceFetch = now - (_lastFetch.get(slug) ?? -Infinity);
  const sinceFail = now - (_lastFetchFail.get(slug) ?? -Infinity);
  if (!refresh) return { fetch: sinceFetch >= FETCH_TTL_MS && sinceFail >= FETCH_FAIL_TTL_MS, limited: false, retryInMs: 0 };
  const sinceForced = now - (_lastForced.get(slug) ?? -Infinity);
  if (sinceForced >= FETCH_TTL_MS) return { fetch: true, forced: true, limited: false, retryInMs: 0 };
  // Throttled: fall back to the implicit rule INCLUDING the failed-fetch TTL. Offline, _lastFetch is
  // never set, so without it every throttled Refresh ran a (≤120 s, slug-locked) fetch anyway.
  return { fetch: sinceFetch >= FETCH_TTL_MS && sinceFail >= FETCH_FAIL_TTL_MS, limited: true, retryInMs: FETCH_TTL_MS - sinceForced };
}

/** Test seam for the fetch bookkeeping readSink does (a forced attempt and a failure). */
export function noteFetch(slug, { forced = false, ok = true, now = _now() } = {}) {
  if (forced) _lastForced.set(slug, now);
  if (ok) { _lastFetch.set(slug, now); _lastFetchFail.delete(slug); } else _lastFetchFail.set(slug, now);
}

async function readSink(slug, projectDir, { refresh }) {
  return withSlugLock(slug, async () => {
    // ensureWorktree runs its OWN fetch (≤120 s) when the worktree does not exist yet, before
    // fetchDecision is consulted. Offline that made every GET — and every throttled refresh=1 —
    // pay a full fetch under the slug lock while reporting nothing. Consult the throttle first.
    const pre = fetchDecision(slug, { refresh, now: _now() });
    const hadWorktree = existsSync(worktreePath(slug));
    if (!hadWorktree && !pre.fetch) {
      throw Object.assign(new Error(`the ${slug} metrics branch has not been fetched yet; retrying shortly`), { code: 'FETCH_FAILED' });
    }
    let dir;
    try { dir = await ensureWorktree(slug, projectDir); }
    catch (err) { if (err?.code === 'FETCH_FAILED') noteFetch(slug, { forced: !!pre.forced, ok: false }); throw err; }
    // ensureWorktree runs its OWN fetch when it has to create the worktree. Book that fetch here,
    // before re-deciding: otherwise the very first refresh=1 for a slug fetched TWICE under the
    // slug lock (once inside ensureWorktree, then again because _lastForced was still unset) —
    // doubling the worst-case latency of the exact path the throttle exists to bound.
    const now = _now();
    if (!hadWorktree) noteFetch(slug, { forced: !!pre.forced, ok: true, now });
    const decision = fetchDecision(slug, { refresh, now });
    let fetchError = null;
    if (decision.fetch) {
      const f = await fetchMetricsBranch(dir);
      // A forced attempt counts even if it fails (flood guard).
      noteFetch(slug, { forced: !!decision.forced, ok: f.ok, now });
      if (f.ok) {
        await runGit(dir, ['reset', '--hard', REMOTE_REF]);
        await runGit(dir, ['clean', '-fdq']);
      } else {
        fetchError = String(f.stderr || '').trim(); // offline: serve what the worktree has
      }
    }
    const parsed = await readRecordsFromDir(dir);
    return { ...parsed, decision, fetchError, fetchedAt: _lastFetch.has(slug) ? new Date(_lastFetch.get(slug)).toISOString() : null };
  });
}

function syncFor(slug, prefs, pending) {
  const lastError = prefs?.lastError ?? null;
  const lastErrorCode = prefs?.lastErrorCode ?? null;
  return {
    slug, pending,
    lastSyncAt: prefs?.lastSyncAt ?? null,
    lastError,
    lastErrorCode,
    // §4.7: "the chip shows the git stderr AND a hint to exempt worca-metrics".
    hint: lastErrorCode === 'PUSH_REJECTED' ? pushHint(lastError) : null,
  };
}

/**
 * @returns {Promise<{scope, records, stats:{files,malformed,unknownV}, sinks:string[], sync:object[],
 *                    refresh:{requested,fetched,limited,retryInMs}, fetchError:string|null}>}
 */
export async function readScope(scope, { refresh = false } = {}) {
  const sources = [];
  let meta;
  if (scope.kind === 'project') {
    const p = (await listProjects()).find((x) => x.key === scope.id);
    if (!p) throw Object.assign(new Error(`unknown project ${scope.id}`), { code: 'NOT_FOUND' });
    const sink = await resolveProjectSink(p.path);
    if (!sink.ok) {
      const code = sink.reason === 'delegate-invalid' ? 'DELEGATE_INVALID' : 'NOT_ENABLED';
      throw Object.assign(new Error(sink.detail || `team metrics are not enabled for ${p.name}`), { code });
    }
    const ownSlug = sink.from;
    sources.push({ slug: sink.slug, projectDir: sink.projectDir, keep: (r) => r.target?.kind === 'project' && r.target.project === ownSlug });
    meta = { kind: 'project', id: p.key, name: p.name, slug: ownSlug, recordedIn: sink.delegated ? sink.slug : null };
  } else {
    const ws = await readWorkspace(scope.id);
    if (!ws) throw Object.assign(new Error(`unknown workspace ${scope.id}`), { code: 'NOT_FOUND' });
    const name = ws.name.toLowerCase();
    for (const path of ws.projectPaths) {
      const prefs = (await discoverProject(path).catch(() => null)) || readTeamMetricsPrefs(projectKey(path));
      if (!recordsLocally(prefs)) continue;      // only members that record locally (config read, not a marker)
      sources.push({ slug: prefs.slug, projectDir: path, keep: (r) => r.target?.kind === 'workspace' && String(r.target.workspace || '').toLowerCase() === name });
    }
    if (!sources.length) throw Object.assign(new Error(`no member of ${ws.name} records team metrics`), { code: 'NOT_ENABLED' });
    const homePrefs = ws.metricsProject ? readTeamMetricsPrefs(projectKey(ws.metricsProject)) : null;
    meta = { kind: 'workspace', id: ws.id, name: ws.name, home: homePrefs?.slug ?? null, sources: sources.map((s) => s.slug) };
  }
  const seen = new Set();
  const records = [];
  const stats = { files: 0, malformed: 0, unknownV: 0 };
  const sync = [];
  const refreshInfo = { requested: !!refresh, fetched: false, limited: false, retryInMs: 0 };
  let fetchError = null;
  for (const src of sources) {
    let r;
    try {
      r = await readSink(src.slug, src.projectDir, { refresh });
    } catch (err) {
      // One unreachable member (no worktree yet + offline, lock timeout) must not fail the whole
      // workspace page: report it in the chip and keep reading the others. A project scope has a
      // single source, so it still surfaces the error.
      if (sources.length === 1) throw err;
      fetchError ||= `${src.slug}: ${err?.stderr || err?.message || err}`;
      sync.push({ ...syncFor(src.slug, readTeamMetricsPrefs(projectKey(src.projectDir)), (await listOutbox(src.slug)).length), fetchedAt: null, error: String(err?.message || err) });
      continue;
    }
    stats.files += r.files; stats.malformed += r.malformed; stats.unknownV += r.unknownV;
    refreshInfo.fetched ||= r.decision.fetch;
    if (r.decision.limited) { refreshInfo.limited = true; refreshInfo.retryInMs = Math.max(refreshInfo.retryInMs, r.decision.retryInMs); }
    fetchError ||= r.fetchError;
    for (const rec of r.records) {
      if (!src.keep(rec) || seen.has(rec.id)) continue;
      seen.add(rec.id);
      records.push(rec);
    }
    sync.push({ ...syncFor(src.slug, readTeamMetricsPrefs(projectKey(src.projectDir)), (await listOutbox(src.slug)).length), fetchedAt: r.fetchedAt });
  }
  return { scope: meta, records, stats, sinks: sources.map((s) => s.slug), sync, refresh: refreshInfo, fetchError };
}

/** Scope list + Projects/Workspaces status in one call (Scope select, Projects cells, ws cards, Stats hint). */
export async function listScopes({ discover = false } = {}) {
  const recordsBySink = new Map();
  const projects = [];
  for (const p of await listProjects()) projects.push(await projectMetricsStatus(p, { discover, recordsBySink }));
  const workspaces = [];
  for (const w of await listWorkspaces()) workspaces.push(await workspaceMetricsStatus(w, { discover }));
  const scopes = {
    projects: projects.filter((s) => s.enabled && s.delegateState !== 'invalid' && !s.blocked)
      .map((s) => ({ id: `project:${s.key}`, label: s.slug, name: s.name, recordedIn: s.delegateState === 'ok' ? s.sinkSlug : null })),
    workspaces: workspaces.filter((w) => w.home.state === 'ok')
      .map((w) => ({ id: `workspace:${w.id}`, label: w.name, home: w.home.slug })),
  };
  return { projects, workspaces, scopes, anyEnabled: scopes.projects.length + scopes.workspaces.length > 0 };
}

export const _testing = {
  setNow(fn) { _now = fn; },
  reset() { _now = () => Date.now(); _lastFetch.clear(); _lastForced.clear(); _lastFetchFail.clear(); },
};
