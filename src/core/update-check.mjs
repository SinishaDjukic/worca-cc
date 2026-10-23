// src/core/update-check.mjs
// "Is this the latest Worca?" (issue #841). Reads the npm `latest` dist-tag of @worca/app and
// compares it with the running version by SemVer precedence. Read-only: nothing here installs,
// updates or restarts anything. The fetcher is injected (createUpdateChecker), so tests and
// mock servers never reach the network; failures are silent and read as 'unknown'.

export const NPM_DIST_TAGS_URL = 'https://registry.npmjs.org/-/package/@worca%2Fapp/dist-tags';
export const CHANGELOG_URL = 'https://docs.worca.dev/changelog/';
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;   // a good answer is reused for a day
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
 * One cached check per process.
 * @param {{currentVersion:string, fetchLatest:() => Promise<string>, enabled?:() => boolean, now?:() => number,
 *          intervalMs?:number, failedRetryMs?:number, minRecheckMs?:number}} opts
 */
export function createUpdateChecker({
  currentVersion, fetchLatest, enabled = () => true, now = Date.now,
  intervalMs = CHECK_INTERVAL_MS, failedRetryMs = FAILED_RETRY_MS, minRecheckMs = MIN_RECHECK_MS,
}) {
  let cache = null;          // { latest: string|null, checkedAt: ms }; latest null = the last attempt failed
  let inflight = null;

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
      inflight = (async () => {
        let latest = null;
        try {
          const v = await fetchLatest();
          const p = parseVersion(v);
          latest = p ? formatVersion(p) : null;
        } catch { /* offline, timeout, refused: silent, reads as unknown */ }
        cache = { latest, checkedAt: now() };
      })().finally(() => { inflight = null; });
    }
    return inflight;
  };

  return {
    /** @param {{force?: boolean}} [opts] force = "Check now": refetch unless the last attempt is under minRecheckMs old. */
    async status({ force = false } = {}) {
      if (!enabled()) return snapshot(false);
      if (inflight) await inflight;
      else if (stale() || (force && now() - cache.checkedAt >= minRecheckMs)) await attempt();
      return snapshot(true);
    },
    /** Tests only: forget the cached answer. */
    reset() { cache = null; },
  };
}
