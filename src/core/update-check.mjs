// src/core/update-check.mjs
// "Is this the latest Worca?" (issue #841). Reads the npm `latest` dist-tag of @worca/app and
// compares it with the running version by SemVer precedence. Read-only: nothing here installs,
// updates or restarts anything. The fetcher is injected (createUpdateChecker), so tests and
// mock servers never reach the network; failures are silent and read as 'unknown'. A source
// checkout (isSourceBuild) never asks npm: its package.json version says nothing about the code.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const NPM_DIST_TAGS_URL = 'https://registry.npmjs.org/-/package/@worca%2Fapp/dist-tags';
export const CHANGELOG_URL = 'https://docs.worca.dev/changelog/';
export const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;   // a good answer is reused for 12 hours
export const FAILED_RETRY_MS = 60 * 60 * 1000;          // offline: try again in an hour, not per request
export const MIN_RECHECK_MS = 60 * 1000;                // "Check now" at most once a minute
export const FETCH_TIMEOUT_MS = 5000;

const SEMVER_RE = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** SemVer 2.0 parts, or null for anything else (no trimming: '1.2.3 ' is garbage). */
export function parseVersion(v) {
  if (typeof v !== 'string' || v.length > 64) return null;
  const m = SEMVER_RE.exec(v);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split('.') : [] };
}

/** Canonical text: no leading v, no build metadata. Safe to put in a URL path. */
export function formatVersion(p) {
  return `${p.major}.${p.minor}.${p.patch}${p.pre.length ? `-${p.pre.join('.')}` : ''}`;
}

const sign = (n) => (n < 0 ? -1 : n > 0 ? 1 : 0);
const NUMERIC = /^\d+$/;

/** -1 | 0 | 1 by SemVer precedence (build metadata ignored). Both arguments are parseVersion results. */
export function compareVersions(a, b) {
  for (const k of ['major', 'minor', 'patch']) if (a[k] !== b[k]) return sign(a[k] - b[k]);
  if (!a.pre.length || !b.pre.length) return a.pre.length ? -1 : b.pre.length ? 1 : 0;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    if (i >= a.pre.length) return -1;
    if (i >= b.pre.length) return 1;
    const x = a.pre[i]; const y = b.pre[i];
    const xn = NUMERIC.test(x); const yn = NUMERIC.test(y);
    if (xn && yn) { if (Number(x) !== Number(y)) return sign(Number(x) - Number(y)); continue; }
    if (xn !== yn) return xn ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** 'up-to-date' | 'outdated' | 'ahead' | 'unknown'. A prerelease `latest` is never a newer stable. */
export function versionStatus(current, latest) {
  const c = parseVersion(current); const l = parseVersion(latest);
  if (!c || !l || l.pre.length) return 'unknown';
  const d = compareVersions(c, l);
  return d === 0 ? 'up-to-date' : d < 0 ? 'outdated' : 'ahead';
}

/** The About card's links. Built only from parsed-and-reformatted versions, never raw strings. */
export function releaseLinks({ current, latest, status } = {}, repoUrl = '') {
  const links = { releaseNotes: CHANGELOG_URL, whatsNew: '', compare: '' };
  const c = parseVersion(current); const l = parseVersion(latest);
  if (status !== 'outdated' || !c || !l) return links;
  links.whatsNew = `${CHANGELOG_URL}${formatVersion(l)}/`;
  const repo = typeof repoUrl === 'string' ? repoUrl.replace(/\/+$/, '') : '';
  if (/^https:\/\/[^\s]+$/.test(repo)) links.compare = `${repo}/compare/worca-app-v${formatVersion(c)}...worca-app-v${formatVersion(l)}`;
  return links;
}

/** The npm `latest` dist-tag. Throws on a non-2xx, a timeout, or an answer with no usable version. */
export async function fetchNpmLatest({ fetchImpl = globalThis.fetch, timeoutMs = FETCH_TIMEOUT_MS, url = NPM_DIST_TAGS_URL } = {}) {
  const res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`registry answered ${res.status}`);
  const body = await res.json().catch(() => null);
  const latest = body && typeof body === 'object' ? body.latest : null;
  if (!parseVersion(latest)) throw new Error('registry sent no usable latest version');
  return latest;
}

/**
 * Worca runs from a git checkout, not an npm install: `.git` sits in the package root (a directory in
 * a clone, a file in a worktree). The published package never has one ("files" is an allowlist).
 * WORCA_UPDATE_CHECK_LATEST (the demo / manual-review aid; demos run from source) wins: compare as
 * an install.
 */
export function isSourceBuild(root, env = process.env) {
  if (parseVersion(env.WORCA_UPDATE_CHECK_LATEST)) return false;
  return existsSync(join(root, '.git'));
}

/**
 * One cached check per process.
 * @param {{currentVersion:string, fetchLatest:() => Promise<string>, enabled?:() => boolean,
 *          sourceBuild?:() => boolean, now?:() => number,
 *          intervalMs?:number, failedRetryMs?:number, minRecheckMs?:number}} opts
 */
export function createUpdateChecker({
  currentVersion, fetchLatest, enabled = () => true, sourceBuild = () => false, now = Date.now,
  intervalMs = CHECK_INTERVAL_MS, failedRetryMs = FAILED_RETRY_MS, minRecheckMs = MIN_RECHECK_MS,
}) {
  let cache = null;          // { latest: string|null, checkedAt: ms }; latest null = the last attempt failed
  let inflight = null;
  let generation = 0;        // bumped by clear(): a request started before it never writes the cache

  const snapshot = (on) => {
    const latest = on && cache ? cache.latest : null;
    return {
      current: currentVersion || '',
      latest,
      status: latest ? versionStatus(currentVersion, latest) : 'unknown',
      checkedAt: on && cache ? new Date(cache.checkedAt).toISOString() : null,
      enabled: on,
    };
  };
  const stale = () => !cache || now() - cache.checkedAt >= (cache.latest ? intervalMs : failedRetryMs);
  const attempt = () => {
    if (!inflight) {
      const mine = generation;
      const p = (async () => {
        let latest = null;
        try {
          const v = await fetchLatest();
          const parsed = parseVersion(v);
          latest = parsed ? formatVersion(parsed) : null;
        } catch { /* offline, timeout, refused: silent, reads as unknown */ }
        if (mine === generation) cache = { latest, checkedAt: now() };
      })().finally(() => { if (inflight === p) inflight = null; });
      inflight = p;
    }
    return inflight;
  };
  const clear = () => { generation++; cache = null; inflight = null; };

  return {
    /** @param {{force?: boolean}} [opts] force = "Check now": refetch unless the last attempt is under minRecheckMs old. */
    async status({ force = false } = {}) {
      if (sourceBuild()) return { current: currentVersion || '', latest: null, status: 'source', checkedAt: null, enabled: !!enabled() };
      if (!enabled()) { clear(); return snapshot(false); }
      if (inflight) await inflight;
      else if (stale() || (force && now() - cache.checkedAt >= minRecheckMs)) await attempt();
      return snapshot(true);
    },
    /** Forget the cached answer and drop any request in flight (the check was switched off). */
    clear,
  };
}

// The full registry document: the abbreviated install document has no `time` (publish dates).
export const NPM_PACKUMENT_URL = 'https://registry.npmjs.org/@worca%2Fapp';
// The first release whose `worca ui` supervisor and server speak the update handoff (issue #841).
export const AUTO_RESTART_MIN = '1.14.0';
const VERSIONS_TIMEOUT_MS = 10_000;

/** Canonical text for a version, or null. The only form ever passed to npm or compared. */
export function canonicalVersion(raw) {
  const p = parseVersion(raw);
  return p ? formatVersion(p) : null;
}

/** 'stable' (no prerelease), 'rc' (exactly -rc.N, the release workflow's tag), or null (anything else). */
export function versionChannel(p) {
  if (!p) return null;
  if (!p.pre.length) return 'stable';
  if (p.pre.length === 2 && p.pre[0] === 'rc' && /^\d+$/.test(String(p.pre[1]))) return 'rc';
  return null;
}

/** RCs of 1.14.0 already carry the supervisor, so the prerelease part is ignored for the cut-off. */
export function canAutoRestart(v) {
  const p = parseVersion(v);
  if (!p) return false;
  return compareVersions({ ...p, pre: [] }, parseVersion(AUTO_RESTART_MIN)) >= 0;
}

/** Stable and -rc.N versions from a registry packument, newest first; deprecated and other prereleases dropped. */
export function parseVersionList(doc) {
  if (!doc || typeof doc !== 'object' || !doc.versions || typeof doc.versions !== 'object') {
    throw new Error('registry sent no package document');
  }
  const time = doc.time && typeof doc.time === 'object' ? doc.time : {};
  const rows = [];
  for (const [raw, meta] of Object.entries(doc.versions)) {
    const p = parseVersion(raw);
    const channel = versionChannel(p);
    if (!channel || (meta && meta.deprecated)) continue;
    const at = typeof time[raw] === 'string' && !Number.isNaN(Date.parse(time[raw])) ? new Date(time[raw]).toISOString() : null;
    rows.push({ p, version: formatVersion(p), channel, publishedAt: at });
  }
  rows.sort((a, b) => compareVersions(b.p, a.p));
  const tags = doc['dist-tags'] && typeof doc['dist-tags'] === 'object' ? doc['dist-tags'] : {};
  return {
    distTags: { latest: canonicalVersion(tags.latest), rc: canonicalVersion(tags.rc) },
    versions: rows.map(({ p, ...v }) => v),
  };
}

export async function fetchNpmVersions({ fetchImpl = globalThis.fetch, timeoutMs = VERSIONS_TIMEOUT_MS, url = NPM_PACKUMENT_URL } = {}) {
  const res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`registry answered ${res.status}`);
  const body = await res.json().catch(() => null);
  return parseVersionList(body);
}

/** Mock / WORCA_UPDATE_CHECK_LATEST stand-in: the running version plus the fake latest. */
export function fakeVersionList(current, latest) {
  const vs = [...new Set([current, latest].map(canonicalVersion).filter(Boolean))];
  return parseVersionList({ 'dist-tags': { latest }, versions: Object.fromEntries(vs.map((v) => [v, {}])), time: {} });
}

export function annotateVersions(list, current) {
  const c = parseVersion(current);
  const l = parseVersion(list?.distTags?.latest);
  return (list?.versions || []).map((v) => {
    const p = parseVersion(v.version);
    const d = c ? compareVersions(p, c) : 1;
    return { ...v, relation: d === 0 ? 'current' : d < 0 ? 'older' : 'newer',
      belowLatest: !!(l && compareVersions(p, l) < 0), autoRestart: canAutoRestart(v.version) };
  });
}

export function findListedVersion(list, raw) {
  const v = canonicalVersion(raw);
  return v ? (list?.versions || []).find((x) => x.version === v) || null : null;
}

/** The version list behind a cache: one request at a time, a good list kept 12 h, the last list kept on failure. */
export function createVersionLister({ fetchList, now = Date.now, intervalMs = CHECK_INTERVAL_MS, failedRetryMs = FAILED_RETRY_MS } = {}) {
  let cache = null; let failedAt = 0; let inflight = null;
  function get({ force = false } = {}) {
    const t = now();
    if (!force && cache && t - cache.at < intervalMs) return Promise.resolve(cache.list);
    if (!force && failedAt && t - failedAt < failedRetryMs) return Promise.resolve(cache?.list ?? null);
    if (!inflight) {
      inflight = Promise.resolve().then(fetchList)
        .then((list) => { cache = { list, at: now() }; failedAt = 0; return list; },
          () => { failedAt = now(); return cache?.list ?? null; })
        .finally(() => { inflight = null; });
    }
    return inflight;
  }
  return { get, peek: () => cache?.list ?? null, clear() { cache = null; failedAt = 0; } };
}
