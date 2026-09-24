// src/core/metrics/prs.mjs
// Pull-request states for the delivery timeline (docs/team-metrics.md "Timeline"). A run record
// is written when the run ends, before its PR exists, so the merge is joined in at read time from
// three sources, most trusted first:
//   1. PR event files on the worca-metrics branch (`.worca-metrics/prs/<number>.json`), written
//      by the optional GitHub Action (docs/team-metrics-pr-events.md);
//   2. the GitHub CLI: one batched GraphQL query per 30 branches, cached in
//      ~/.worca-cc/metrics/pr-cache.json (a merged PR is never asked about again);
//   3. this machine's own pipelines table (pr_url / pr_state, no dates).
// Every source is optional. Without gh and without the Action the page still renders; the
// status block says which source was missing so the page can explain the gap. Never throws.
import { execFile } from 'node:child_process';
import { lstat, readdir, readFile, realpath, mkdir, writeFile, rename } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { METRICS_DIR, metricsRoot, worktreePath } from './sync.mjs';
import { prepare } from '../db.mjs';

export const PR_EVENTS_DIR = 'prs';
export const MAX_EVENT_FILE_BYTES = 64 * 1024;
export const GH_BATCH = 30;
export const MAX_LOOKUPS = 600;               // per request: the page asks for the window it shows
export const OPEN_TTL_MS = 10 * 60_000;       // an open PR (or none yet) is re-asked after this
export const NONE_OLD_TTL_MS = 24 * 3_600_000; // …or after a day, once the run is a month old
export const GH_STATUS_TTL_MS = 5 * 60_000;
const DAY = 86_400_000;
const STATES = new Set(['OPEN', 'MERGED', 'CLOSED']);

function defaultRun(cmd, args, { timeout = 30_000 } = {}) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
        resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || err?.message || ''), code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, missing: err?.code === 'ENOENT' });
      });
    } catch (err) { resolve({ ok: false, stdout: '', stderr: String(err?.message || err), code: -1, missing: err?.code === 'ENOENT' }); }
  });
}

let _run = defaultRun;
let _now = () => Date.now();
let _ghStatus = null;          // { state, detail, at }

const isoOrNull = (v) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);
const lower = (s) => String(s || '').toLowerCase();
/** github.com slugs are exactly "owner/repo"; every other host keeps its host segment. */
export const isGithubSlug = (slug) => typeof slug === 'string' && /^[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(slug);

/** "https://github.com/o/r/pull/12" → { repo: 'o/r', number: 12 } | null */
export function parsePrUrl(url) {
  const m = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/i.exec(String(url || ''));
  return m ? { repo: `${m[1]}/${m[2]}`, number: Number(m[3]) } : null;
}

/** One PR event file (v1) → a normalised PR, or null when it is not one. */
export function parsePrEvent(text) {
  let v;
  try { v = JSON.parse(text); } catch { return null; }
  if (!v || typeof v !== 'object' || v.v !== 1 || v.kind !== 'pr') return null;
  if (typeof v.repo !== 'string' || !Number.isInteger(v.number) || typeof v.head !== 'string') return null;
  const state = String(v.state || '').toUpperCase();
  if (!STATES.has(state)) return null;
  return {
    repo: v.repo, number: v.number, url: typeof v.url === 'string' ? v.url : null,
    title: typeof v.title === 'string' ? v.title.slice(0, 200) : null,
    head: v.head, base: typeof v.base === 'string' ? v.base : null, state,
    author: typeof v.author === 'string' && v.author ? v.author.slice(0, 100) : null,
    authorName: typeof v.authorName === 'string' && v.authorName ? v.authorName.slice(0, 200) : null,
    authorKey: typeof v.authorKey === 'string' && /^[0-9a-f]{16}$/.test(v.authorKey) ? v.authorKey : null,
    createdAt: isoOrNull(v.createdAt), mergedAt: isoOrNull(v.mergedAt), closedAt: isoOrNull(v.closedAt),
    updatedAt: isoOrNull(v.updatedAt), via: 'action',
  };
}

/** Every PR event under a metrics worktree. Same guards as the run records (read.mjs). */
export async function readPrEventsFromDir(dir) {
  const out = [];
  for (const p of [join(dir, METRICS_DIR), join(dir, METRICS_DIR, PR_EVENTS_DIR)]) {
    const st = await lstat(p).catch(() => null);
    if (!st || !st.isDirectory()) return out;
  }
  const root = join(dir, METRICS_DIR, PR_EVENTS_DIR);
  const rootReal = await realpath(root).catch(() => null);
  if (!rootReal) return out;
  let ents;
  try { ents = await readdir(root, { withFileTypes: true }); } catch { return out; }
  for (const d of ents) {
    if (!d.isFile() || !/^\d+\.json$/.test(d.name)) continue;
    const p = join(root, d.name);
    const st = await lstat(p).catch(() => null);
    const real = st ? await realpath(p).catch(() => null) : null;
    if (!st || !st.isFile() || st.size > MAX_EVENT_FILE_BYTES || !real || !real.startsWith(rootReal + sep)) continue;
    const ev = parsePrEvent(await readFile(p, 'utf8').catch(() => ''));
    if (ev) out.push(ev);
  }
  return out;
}

// ---- gh ------------------------------------------------------------------------------------

/** 'ok' | 'missing' (no gh on PATH) | 'unauthenticated'. Memoised for a few minutes. */
export async function ghStatus() {
  const now = _now();
  if (_ghStatus && now - _ghStatus.at < GH_STATUS_TTL_MS) return _ghStatus;
  const r = await _run('gh', ['auth', 'status', '--hostname', 'github.com'], { timeout: 15_000 });
  const state = r.ok ? 'ok' : r.missing ? 'missing' : 'unauthenticated';
  _ghStatus = { state, detail: r.ok ? null : String(r.stderr || '').trim().split('\n')[0] || null, at: now };
  return _ghStatus;
}

const gqlString = (s) => JSON.stringify(String(s));
const PR_FIELDS = 'number url title state createdAt mergedAt closedAt headRefName baseRefName';

/** One GraphQL document for up to GH_BATCH {repo, branch} lookups, aliased q0…qN. */
export function buildBranchQuery(lookups) {
  const parts = lookups.map((l, i) => {
    const [owner, name] = l.repo.split('/');
    return `q${i}: repository(owner: ${gqlString(owner)}, name: ${gqlString(name)}) { pullRequests(headRefName: ${gqlString(l.branch)}, first: 5, orderBy: {field: CREATED_AT, direction: DESC}) { nodes { ${PR_FIELDS} } } }`;
  });
  return `query {\n${parts.join('\n')}\n}`;
}

function fromGhNode(repo, n) {
  if (!n || !Number.isInteger(n.number) || !STATES.has(n.state)) return null;
  return { repo, number: n.number, url: n.url || null, title: n.title || null, head: n.headRefName || null, base: n.baseRefName || null, state: n.state, createdAt: isoOrNull(n.createdAt), mergedAt: isoOrNull(n.mergedAt), closedAt: isoOrNull(n.closedAt), via: 'gh' };
}

/**
 * @returns {Promise<{results: Map<string, object[]>, error: string|null}>} key "repo#branch"
 *   (lower-cased repo) → PRs. A lookup GitHub could not answer (no access, unknown repo) is
 *   left out, so it is asked again next time rather than cached as "no PR".
 */
export async function lookupBranchesViaGh(lookups) {
  const results = new Map();
  let error = null;
  for (let i = 0; i < lookups.length; i += GH_BATCH) {
    const batch = lookups.slice(i, i + GH_BATCH);
    const r = await _run('gh', ['api', 'graphql', '-f', `query=${buildBranchQuery(batch)}`], { timeout: 30_000 });
    let body = null;
    try { body = JSON.parse(r.stdout || 'null'); } catch { body = null; }
    // gh exits non-zero when ANY alias errors (an unknown repo), but still prints the partial data.
    if (!body || typeof body !== 'object' || !body.data) { error ||= String(r.stderr || 'gh api graphql failed').trim().split('\n')[0]; continue; }
    batch.forEach((l, j) => {
      const repoNode = body.data[`q${j}`];
      if (!repoNode) return;
      const nodes = Array.isArray(repoNode.pullRequests?.nodes) ? repoNode.pullRequests.nodes : [];
      results.set(`${lower(l.repo)}#${l.branch}`, nodes.map((n) => fromGhNode(l.repo, n)).filter(Boolean));
    });
  }
  return { results, error };
}

// ---- cache ---------------------------------------------------------------------------------

export function cachePath() { return join(metricsRoot(), 'pr-cache.json'); }

async function loadCache() {
  try {
    const v = JSON.parse(await readFile(cachePath(), 'utf8'));
    return v && v.v === 1 && v.entries && typeof v.entries === 'object' ? v : { v: 1, entries: {} };
  } catch { return { v: 1, entries: {} }; }
}

async function saveCache(cache) {
  try {
    await mkdir(metricsRoot(), { recursive: true });
    const tmp = `${cachePath()}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(cache));
    await rename(tmp, cachePath());
  } catch { /* a cache that cannot be written is only slower next time */ }
}

/** A cached answer is final once a PR merged; otherwise it is re-asked after a TTL. */
export function cacheFresh(entry, { now = _now(), runEndedMs = null } = {}) {
  if (!entry || !Array.isArray(entry.prs) || !Number.isFinite(entry.checkedAt)) return false;
  if (entry.prs.some((p) => p.state === 'MERGED')) return true;
  const old = runEndedMs != null && now - runEndedMs > 30 * DAY;
  const ttl = entry.prs.length === 0 && old ? NONE_OLD_TTL_MS : entry.prs.every((p) => p.state === 'CLOSED') && entry.prs.length ? NONE_OLD_TTL_MS : OPEN_TTL_MS;
  return now - entry.checkedAt < ttl;
}

// ---- local pipelines -----------------------------------------------------------------------

function localPrs(ids) {
  const out = new Map();
  if (!ids.length) return out;
  try {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const rows = prepare(`SELECT id, pr_url, pr_number, pr_state FROM pipelines WHERE pr_url IS NOT NULL AND id IN (${chunk.map(() => '?').join(',')})`).all(...chunk);
      for (const row of rows) {
        const parsed = parsePrUrl(row.pr_url);
        const state = STATES.has(String(row.pr_state || '').toUpperCase()) ? String(row.pr_state).toUpperCase() : 'OPEN';
        out.set(row.id, { repo: parsed?.repo || null, number: row.pr_number ?? parsed?.number ?? null, url: row.pr_url, title: null, state, createdAt: null, mergedAt: null, closedAt: null, via: 'local' });
      }
    }
  } catch { /* no DB (a CLI-less reader): skip */ }
  return out;
}

// ---- resolve -------------------------------------------------------------------------------

const RANK = { OPEN: 0, CLOSED: 1, MERGED: 2 };
const VIA_RANK = { local: 1, gh: 2, action: 3 };
/** The better of two answers for one PR: a more final state, then a more trusted source. */
function better(a, b) {
  if (!a) return b;
  if (RANK[b.state] !== RANK[a.state]) return RANK[b.state] > RANK[a.state] ? b : a;
  return (VIA_RANK[b.via] ?? 0) >= (VIA_RANK[a.via] ?? 0) ? { ...a, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v != null)) } : a;
}

function sanitizeLookup(x) {
  if (!x || typeof x.id !== 'string' || !x.id || x.id.length > 64) return null;
  const repos = Array.isArray(x.repos) ? x.repos.filter((r) => typeof r === 'string' && r && r.length <= 200).slice(0, 20) : [];
  const branch = typeof x.branch === 'string' && x.branch && x.branch.length <= 255 ? x.branch : null;
  const pr = x.pr && typeof x.pr === 'object' ? { url: typeof x.pr.url === 'string' ? x.pr.url : null, number: Number.isInteger(x.pr.number) ? x.pr.number : null } : null;
  const endedMs = typeof x.endedAt === 'string' ? Date.parse(x.endedAt) : NaN;
  return { id: x.id, repos, branch, pr, endedMs: Number.isFinite(endedMs) ? endedMs : null };
}

/**
 * @param {object} p
 * @param {object[]} p.runs      [{ id, repos, branch, pr, endedAt }] from prLookupFor() (shared/timeline).
 * @param {string[]} p.sinks     metrics slugs whose worktrees may hold PR events.
 * @param {boolean} [p.useGh]
 * @returns {Promise<{ prs: Object<string, object[]|null>, status: object }>}
 */
export async function resolveRunPrs({ runs = [], sinks = [], useGh = true } = {}) {
  const now = _now();
  const lookups = runs.map(sanitizeLookup).filter(Boolean).slice(0, MAX_LOOKUPS);
  const status = { gh: 'unused', ghDetail: null, ghError: null, actionRepos: [], unsupportedRepos: [], checked: 0 };

  // 1. Action events, indexed by repo#branch and repo#number.
  const byBranch = new Map();
  const byNumber = new Map();
  const actionRepos = new Set();
  for (const slug of sinks) {
    let dir;
    try { dir = worktreePath(slug); } catch { continue; }
    for (const ev of await readPrEventsFromDir(dir)) {
      const repo = lower(ev.repo);
      actionRepos.add(repo);
      const bk = `${repo}#${ev.head}`;
      if (!byBranch.has(bk)) byBranch.set(bk, []);
      byBranch.get(bk).push(ev);
      byNumber.set(`${repo}#${ev.number}`, ev);
    }
  }
  status.actionRepos = [...actionRepos];

  // 2. Local pipelines (this machine's own runs).
  const local = localPrs(lookups.map((l) => l.id));

  // 3. gh, for the repo#branch pairs the Action has not answered.
  const cache = await loadCache();
  const need = new Map();   // key → { repo, branch, endedMs }
  const unsupported = new Set();
  for (const l of lookups) {
    if (!l.branch) continue;
    for (const repo of l.repos) {
      const key = `${lower(repo)}#${l.branch}`;
      if (byBranch.has(key)) continue;
      if (!isGithubSlug(repo)) { if (!actionRepos.has(lower(repo))) unsupported.add(repo); continue; }
      if (cacheFresh(cache.entries[key], { now, runEndedMs: l.endedMs })) continue;
      const prev = need.get(key);
      if (!prev || (l.endedMs ?? 0) > (prev.endedMs ?? 0)) need.set(key, { repo, branch: l.branch, endedMs: l.endedMs });
    }
  }
  status.unsupportedRepos = [...unsupported];
  if (useGh && need.size) {
    const gh = await ghStatus();
    status.gh = gh.state;
    status.ghDetail = gh.detail;
    if (gh.state === 'ok') {
      const { results, error } = await lookupBranchesViaGh([...need.values()]);
      status.ghError = error;
      status.checked = results.size;
      for (const [key, prs] of results) cache.entries[key] = { prs, checkedAt: now };
      if (results.size) await saveCache(cache);
    }
  }

  // Join per run.
  const prs = {};
  for (const l of lookups) {
    const found = new Map();   // repo#number → pr
    let known = false;
    const add = (p) => {
      if (!p) return;
      const k = `${lower(p.repo)}#${p.number ?? p.url}`;
      found.set(k, better(found.get(k), p));
    };
    // The record's own `pr` carries no state, so on its own it proves nothing about a merge:
    // it only helps to find the PR's event when the Action has written one.
    if (l.pr) {
      const parsed = parsePrUrl(l.pr.url);
      const repo = parsed?.repo || l.repos[0] || null;
      const number = l.pr.number ?? parsed?.number ?? null;
      const ev = repo && number != null ? byNumber.get(`${lower(repo)}#${number}`) : null;
      if (ev) { add(ev); known = true; }
    }
    if (local.has(l.id)) add(local.get(l.id));
    if (l.branch) {
      for (const repo of l.repos) {
        const key = `${lower(repo)}#${l.branch}`;
        const evs = byBranch.get(key);
        const cached = cache.entries[key];
        if (evs) { known = true; evs.forEach(add); }
        else if (cached && Array.isArray(cached.prs)) { known = true; cached.prs.forEach((p) => add({ ...p, via: 'gh' })); }
      }
    }
    // A PR known only from this machine's table is still a real PR, but "no PR" is only claimed
    // when the Action or GitHub actually answered for the run's branch.
    prs[l.id] = found.size ? [...found.values()] : known ? [] : null;
  }
  return { prs, status };
}

export const MAX_LISTED_EVENTS = 5000;

/**
 * Every PR the Action recorded for the scope's repositories whose life overlaps [from, to): the
 * Timeline shows the ones no recorded run points at as work done outside Worca. Only the
 * Action's files can answer this — gh is asked per branch, never "list everything".
 * @param {object} p
 * @param {string[]} p.sinks  metrics slugs whose worktrees hold the events.
 * @param {string[]} p.repos  the scope's repositories (slugs); events of other repos are dropped.
 * @returns {Promise<{ prs: object[], truncated: boolean, actionRepos: string[] }>}
 */
export async function listPrEvents({ sinks = [], repos = [], from = null, to = null } = {}) {
  const now = _now();
  const want = new Set(repos.map(lower));
  const lo = Number.isFinite(from) ? from : -Infinity;
  const hi = Number.isFinite(to) ? to : Infinity;
  const seen = new Set();
  const out = [];
  const actionRepos = new Set();
  for (const slug of sinks) {
    let dir;
    try { dir = worktreePath(slug); } catch { continue; }
    for (const ev of await readPrEventsFromDir(dir)) {
      const repo = lower(ev.repo);
      if (want.size && !want.has(repo)) continue;
      actionRepos.add(repo);
      const key = `${repo}#${ev.number}`;
      if (seen.has(key)) continue;
      const start = Date.parse(ev.createdAt ?? '');
      const end = Date.parse(ev.mergedAt ?? ev.closedAt ?? '') || now;
      if (!Number.isFinite(start) || start >= hi || end < lo) continue;
      seen.add(key);
      out.push(ev);
    }
  }
  out.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return { prs: out.slice(0, MAX_LISTED_EVENTS), truncated: out.length > MAX_LISTED_EVENTS, actionRepos: [...actionRepos] };
}

// ---- the GitHub Action ---------------------------------------------------------------------

export const PR_WORKFLOW_PATH = '.github/workflows/worca-metrics-pr-events.yml';
export const PR_WORKFLOW_TEMPLATE = new URL('./pr-events-workflow.yml', import.meta.url);

export async function prWorkflowText() { return readFile(PR_WORKFLOW_TEMPLATE, 'utf8'); }

/**
 * Write the PR-events workflow into a project (`worca metrics pr-workflow`). Never overwrites a
 * file that differs unless `force`: the team may have edited it.
 * @returns {Promise<{ path: string, status: 'created'|'updated'|'unchanged'|'differs' }>}
 */
export async function installPrWorkflow(projectDir, { force = false } = {}) {
  const text = await prWorkflowText();
  const path = join(projectDir, ...PR_WORKFLOW_PATH.split('/'));
  const current = await readFile(path, 'utf8').catch(() => null);
  if (current === text) return { path, status: 'unchanged' };
  if (current != null && !force) return { path, status: 'differs' };
  await mkdir(join(projectDir, '.github', 'workflows'), { recursive: true });
  await writeFile(path, text);
  return { path, status: current == null ? 'created' : 'updated' };
}

export const _testing = {
  setRunner(fn) { _run = typeof fn === 'function' ? fn : defaultRun; _ghStatus = null; },
  setNow(fn) { _now = typeof fn === 'function' ? fn : () => Date.now(); },
  reset() { _run = defaultRun; _now = () => Date.now(); _ghStatus = null; },
};
