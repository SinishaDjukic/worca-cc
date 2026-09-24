// src/core/metrics/sync.mjs
// Team metrics write side + discovery (team-metrics-design.md §4.5–§4.8).
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, writeFile, rename, rm, copyFile, stat } from 'node:fs/promises';
import { join, dirname, basename, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { worcaHome, listProjects } from '../projects.mjs';
import { projectKey, canonicalProjectRoot } from '../store.mjs';
import { listRemotes, parseRemoteUrl } from '../git-info.mjs';
import { githubEnv, readGithubCredentials, stripGithubCredentials } from '../github-credentials.mjs';

const NETWORK_GIT = new Set(['fetch', 'push', 'ls-remote', 'clone', 'pull']);

/** "owner/name" of origin on github.com, only in App mode (the one mode that needs it). */
async function originRepo(cwd) {
  if (readGithubCredentials().mode !== 'app' || !cwd) return null;
  try {
    const url = await new Promise((ok) => execFile('git', ['remote', 'get-url', 'origin'], { cwd, timeout: 10_000 }, (e, out) => ok(e ? '' : String(out).trim())));
    const p = parseRemoteUrl(url);
    return p && p.host === 'github.com' ? `${p.owner}/${p.repo}` : null;
  } catch { return null; }
}
import { readTeamMetricsPrefs, writeTeamMetricsPrefs } from '../config.mjs';
import { readWorkspace, listWorkspaces, isGitRepo } from '../workspaces.mjs';
import { withLock } from './lock.mjs';
import { writeRunLedger, readRunLedger, sweepRunLedger } from './ledger.mjs';
import { matchesWorkspace } from '../../shared/team-metrics/workspace-match.mjs';

export const METRICS_BRANCH = 'worca-metrics';
export const METRICS_DIR = '.worca-metrics';
export const REMOTE_REF = `refs/remotes/origin/${METRICS_BRANCH}`;
export const FETCH_REFSPEC = `+refs/heads/${METRICS_BRANCH}:${REMOTE_REF}`;
export const DISCOVERY_TTL_MS = 60 * 60_000;
export const OUTBOX_RETENTION_MS = 30 * 24 * 60 * 60_000;
export const MAX_PUSH_ATTEMPTS = 5;
export const PROTECTION_HINT = `exempt \`${METRICS_BRANCH}\` from branch protection in the repository rules — Worca pushes to it directly, without a pull request`;
export const MIN_GIT = '2.31'; // --path-format=absolute (prune), init -b in tests; documented in docs/team-metrics.md
const README_TEXT = `# worca-metrics\n\nThis branch is written by Worca team metrics. Each file under \`.worca-metrics/runs/\` is one finished pipeline run (one JSON line). Do not edit it by hand and do not merge it into other branches. To stop recording for the whole team, delete this branch: \`git push origin --delete ${METRICS_BRANCH}\`.\n`;

export const metricsEvents = new EventEmitter();
const emit = (slug, action, extra = {}) => metricsEvents.emit('changed', { slug, action, ...extra });

// ---- paths ------------------------------------------------------------------
export function metricsRoot() { return join(worcaHome(), 'metrics'); }

/** Separator for "/" in directory names. `~` never occurs in a slug segment ([a-z0-9._-]),
 *  so "acme/my__repo" → "acme~my__repo" decodes back unambiguously and never nests. */
const SLUG_SEP = '~';

/** "acme/billing-api" → "acme~billing-api" (one directory level). */
export function slugDirName(slug) {
  const segs = String(slug || '').toLowerCase().split('/');
  if (!segs.length || segs.some((s) => !/^[a-z0-9._-]+$/.test(s) || s === '.' || s === '..')) {
    throw Object.assign(new Error(`invalid metrics slug: ${slug}`), { code: 'BAD_REQUEST' });
  }
  return segs.join(SLUG_SEP);
}
export function slugFromDirName(name) { return String(name).split(SLUG_SEP).join('/'); }
export function worktreePath(slug) { return join(metricsRoot(), 'repos', slugDirName(slug)); }
export function outboxDir(slug) { return join(metricsRoot(), 'outbox', slugDirName(slug)); }
/** Empty hooks directory: metrics git commands must never run the project's hooks (decision 26). */
export function noHooksDir() { return join(metricsRoot(), 'no-hooks'); }

// ---- git ----------------------------------------------------------------------
// Env that must never leak into metrics git calls (e.g. when Worca itself runs under a git hook).
const STRIP_ENV = [
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR', 'GIT_PREFIX',
  // The identity must come from `git config` or the Worca fallback, never from the ambient
  // environment: these beat `-c user.name=…`, so under attribution:'none' a shell/CI that exports
  // GIT_AUTHOR_NAME stamped the developer's real name onto the shared branch (verified).
  'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_AUTHOR_DATE',
  'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_COMMITTER_DATE',
];

/** Applied to EVERY metrics git call (decision 33): no project hooks (reference-transaction fires on
 *  fetch/reset too), no signing prompts. A hooksPath that does not exist yet simply has no hooks. */
function hookFreeArgs() {
  let dir;
  try { dir = noHooksDir(); } catch { return ['-c', 'commit.gpgsign=false', '-c', 'push.gpgSign=false']; } // no worcaHome (bare unit test): nothing to write anyway
  return ['-c', `core.hooksPath=${dir}`, '-c', 'commit.gpgsign=false', '-c', 'push.gpgSign=false'];
}

async function defaultGit(cwd, args, { timeoutMs = 60_000, env = null } = {}) {
  // The write credential (it reads too): metrics and policy branches are fetched and pushed.
  // In App mode a fresh token per call; a failed mint degrades to no credential (git then
  // reports the auth failure the sync already handles) and is logged once per call.
  // Local commands (commit, worktree, read-tree…) get no credential at all.
  let base;
  if (NETWORK_GIT.has(args[0])) {
    const cred = await githubEnv('write', { repo: await originRepo(cwd) });
    if (cred.error) console.warn(`[worca] metrics/policy git ${args[0]}: ${cred.error}`);
    base = cred.env;
  } else {
    base = stripGithubCredentials(process.env);
  }
  for (const k of STRIP_ENV) delete base[k];
  return new Promise((done) => {
    execFile('git', [...hookFreeArgs(), ...args], {
      cwd, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 32 * 1024 * 1024,
      // Non-interactive and untranslated (isNonFastForward/pushHint parse stderr); same hardening as worktree.mjs ASK_GIT_ENV.
      env: {
        // No GIT_SSH_COMMAND override: it would silently beat the user's core.sshCommand (agents, keys).
        // A passphrase prompt is bounded by the per-command timeout instead.
        ...base, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', GIT_ASKPASS: '', SSH_ASKPASS: '',
        ...(env || {}),
      },
    }, (err, stdout, stderr) => done({
      ok: !err,
      code: err ? (typeof err.code === 'number' ? err.code : -1) : 0,
      stdout: String(stdout || ''),
      stderr: String(stderr || '') || (err ? String(err.message) : ''),
    }));
  });
}
let _git = defaultGit;
export function runGit(cwd, args, opts) { return _git(cwd, args, opts); }

function metricsError(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}
const firstLine = (s) => String(s || '').trim().split('\n').find(Boolean) || '';

// ---- identity -----------------------------------------------------------------
/** One slug segment → the slug alphabet. Percent-escapes are decoded first ("My%20Repo" → "my-repo"). */
function slugSegment(x) {
  let d;
  try { d = decodeURIComponent(x); } catch { d = x; }
  return d.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[.-]+|-+$/g, '') || '_';
}

/**
 * Machine- AND protocol-independent metrics identity from a remote URL (§4.3, decision 35).
 * github.com keeps the familiar "owner/repo"; every other host keeps `host` + the FULL repo path.
 * `remoteRepoSlug` keeps only the last two segments off github.com, which collides
 * (gitlab.com/g1/sub/api vs g2/sub/api → both "gitlab.com/sub/api") and mangles Azure DevOps
 * ("dev.azure.com/_git/api" for every repo named api, in every org).
 * @returns {string|null} null when the URL has no usable repo path (caller falls back to the basename)
 */
export function metricsSlugFromUrl(url) {
  const parsed = parseRemoteUrl(url);
  if (!parsed) return null;
  const s = String(url).trim();
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?[^/:]+(?::\d+)?\/(.+)$/i.exec(s) || /^(?:[^@/\s]+@)?[^:/\s]+:(.+)$/.exec(s);
  let segs = (m ? m[1] : '').replace(/\/+$/, '').replace(/\.git$/i, '').split('/').filter(Boolean);
  let host = String(parsed.host || '').toLowerCase();
  // ssh and https spellings of the same Azure repo must give the same slug.
  if (host === 'ssh.dev.azure.com' || host === 'vs-ssh.visualstudio.com') { host = 'dev.azure.com'; if (segs[0] === 'v3') segs = segs.slice(1); }
  segs = segs.filter((x) => x !== '_git');                         // Azure DevOps https
  if (segs[0] === 'scm' && segs.length > 2) segs = segs.slice(1);  // Bitbucket Server https
  segs = segs.map(slugSegment);
  if (segs.length < 2) return null;
  return host === 'github.com' ? segs.slice(-2).join('/') : [slugSegment(host), ...segs].join('/');
}

/** "owner/repo" (github) or "host/…/repo" from origin, else basename of the canonical root (§4.3). */
export async function projectSlug(projectDir) {
  const r = await listRemotes(projectDir);
  const origin = r.ok ? r.remotes.find((x) => x.name === 'origin') : null;
  const url = origin?.pushUrl || origin?.fetchUrl || null;
  // Basename fallback may hold spaces/unicode: sanitize so slugDirName never throws.
  const fallback = slugSegment(basename(canonicalProjectRoot(projectDir))) || 'project';
  // Never trust an unsanitized hosted slug: "dev.azure.com/org/My%20Project/_git/My Repo" would
  // make slugDirName throw BAD_REQUEST, and every record for that project would be dropped.
  const slug = (url && metricsSlugFromUrl(url)) || fallback;
  return { slug, hasOrigin: !!origin, originUrl: origin?.fetchUrl ?? null, remotesOk: r.ok };
}

export async function gitUserName(dir) {
  const r = await _git(dir, ['config', 'user.name'], { timeoutMs: 10_000 });
  return r.ok ? r.stdout.trim() || null : null;
}

/** `-c` identity args for metrics commits (§4.5: git user, or Worca under attribution:none).
 *  A name without an email would make `git commit` fail, so both must be set to use the git user.
 *  Exported for the team-policy branch (policy/sync.mjs), which commits under the same rules. */
export async function identityArgs(dir, attribution) {
  if (attribution !== 'none' && await gitUserName(dir)) {
    const email = await _git(dir, ['config', 'user.email'], { timeoutMs: 10_000 });
    if (email.ok && email.stdout.trim()) return [];
  }
  return ['-c', 'user.name=Worca', '-c', 'user.email=worca@local'];
}

const normAttribution = (a) => (a === 'none' ? 'none' : 'git-user');
const iso = (ms) => new Date(ms).toISOString();

// ---- discovery (§4.6) ---------------------------------------------------------------
// Two fetches of the SAME repository can collide on refs/remotes/origin/worca-metrics: discovery
// fetches outside the slug lock (background tick, page open, POST /discover, validateDelegateTarget,
// readScope, the CLI) while a flush fetches inside it. Observed: "cannot lock ref
// 'refs/remotes/origin/worca-metrics': is at … but expected …" (git 2.50) and "fetching ref … failed:
// incorrect old value provided" (git 2.53) — the flush then aborted with records ready to push.
const LOCAL_REF_RACE = /cannot lock ref|incorrect old value provided|unable to update local ref|Unable to create '[^']*\.lock'/;

export async function fetchMetricsBranch(dir, { timeoutMs = 120_000 } = {}) {
  let r;
  for (let i = 0; i < 3; i++) {
    // --no-write-fetch-head (git ≥ 2.29, below MIN_GIT): a metrics fetch must not overwrite the
    // developer's .git/FETCH_HEAD, which a concurrent `git pull` in the project reads (§4.5
    // "invisible to the project's tooling").
    r = await _git(dir, ['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', 'origin', FETCH_REFSPEC], { timeoutMs });
    if (r.ok || !LOCAL_REF_RACE.test(r.stderr)) return r;
    await new Promise((res) => setTimeout(res, 50 + Math.floor(Math.random() * 200)));
  }
  return r;
}

async function readRemoteConfig(dir) {
  const r = await _git(dir, ['show', `${REMOTE_REF}:${METRICS_DIR}/config.json`], { timeoutMs: 10_000 });
  if (!r.ok) return null;
  try {
    const c = JSON.parse(r.stdout);
    if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
    // Anyone with push access can hand-edit this file. A non-string delegateTo threw
    // ("prefs.config.delegateTo.toLowerCase is not a function") out of workspaceMetricsStatus
    // and 500'd GET /api/team-metrics/scopes, i.e. the whole page (verified with delegateTo: 42).
    if (c.delegateTo != null && typeof c.delegateTo !== 'string') delete c.delegateTo;
    if (c.attribution != null && typeof c.attribution !== 'string') delete c.attribution;
    return c;
  } catch { return null; }
}

/**
 * `git ls-remote --heads origin worca-metrics`, cached in project_config.extra.teamMetrics.
 * Network failure keeps the previous `enabled` verdict (offline ≠ disabled).
 */
export async function discoverProject(projectDir, { force = false, now = Date.now(), lsTimeoutMs = 20_000, fetchTimeoutMs = 120_000 } = {}) {
  const key = projectKey(projectDir);
  const prev = readTeamMetricsPrefs(key) || {};
  if (!force && prev.checkedAt && now - Date.parse(prev.checkedAt) < DISCOVERY_TTL_MS) return prev;
  // A missing directory (unmounted drive, moved checkout) is "unknown", not "no origin":
  // never overwrite a cached enabled=true with it, and never create a junk config row.
  if (!existsSync(projectDir)) return readTeamMetricsPrefs(key);
  const { slug, hasOrigin, remotesOk, originUrl } = await projectSlug(projectDir);
  // "github.com/acme/billing-api" for the Enable dialog (board 5); never includes credentials.
  const originDisplay = originUrl ? String(originUrl).replace(/^[a-z+]+:\/\//i, '').replace(/^[^@/]*@/, '').replace(/:(?!\d)/, '/').replace(/\.git$/, '') : null;
  if (!remotesOk) return prev.checkedAt ? prev : null;
  // Two discoveries of one project can overlap (fire-and-forget on project add vs Enable's forced
  // one, or the background tick): the one that started later wins; an older result never overwrites it.
  const write = (patch) => {
    const cur = readTeamMetricsPrefs(key);
    if (cur?.checkedAt && Date.parse(cur.checkedAt) > now) return cur;
    return writeTeamMetricsPrefs(key, patch);
  };
  if (!hasOrigin) {
    // disabledAt starts the §4.7 retention clock. Without it, an outbox for a project whose origin
    // was removed is kept forever and every flush reports BRANCH_MISSING for ever.
    return write({
      enabled: false, hasOrigin: false, remote: null, slug, originDisplay: null, config: null,
      configKnown: false, headSha: null, checkedAt: iso(now), disabledAt: prev.disabledAt ?? iso(now),
    });
  }
  const ls = await _git(projectDir, ['ls-remote', '--heads', 'origin', `refs/heads/${METRICS_BRANCH}`], { timeoutMs: lsTimeoutMs });
  if (!ls.ok) {
    // Offline ≠ disabled: keep the previous verdict. checkedAt is NOT advanced, so the next
    // trigger (flush, page open, hourly tick) retries instead of waiting an hour.
    return write({ hasOrigin: true, remote: 'origin', slug, lastDiscoveryError: firstLine(ls.stderr), lastDiscoveryAt: iso(now) });
  }
  const sha = ls.stdout.trim().split(/\s+/)[0] || null;
  if (!sha) {
    const next = write({
      enabled: false, hasOrigin: true, remote: 'origin', slug, headSha: null, config: null, configKnown: false,
      checkedAt: iso(now), lastDiscoveryError: null,
      disabledAt: prev.enabled ? iso(now) : (prev.disabledAt ?? null),
    });
    if (prev.enabled) emit(slug, 'disabled');
    return next;
  }
  let config = prev.config ?? null;
  let headSha = prev.headSha ?? null;
  if (sha !== prev.headSha || !prev.configKnown) {
    const f = await fetchMetricsBranch(projectDir, { timeoutMs: fetchTimeoutMs });
    if (!f.ok) {
      // Decision 32: the branch exists but its config.json could not be read. Keep the old
      // headSha + checkedAt (the next trigger refetches, so a stale config is never pinned) and
      // never claim a config we have not read at all. A config read for an earlier head stays
      // usable meanwhile: heads move on every teammate's flush, configs almost never do, and
      // dropping it would silently skip every run recorded while offline.
      const next = write({
        enabled: true, hasOrigin: true, remote: 'origin', slug, originDisplay, disabledAt: null,
        configKnown: !!prev.configKnown,
        lastDiscoveryError: firstLine(f.stderr), lastDiscoveryAt: iso(now),
      });
      if (!prev.enabled) emit(slug, 'discovered');
      return next;
    }
    config = await readRemoteConfig(projectDir);
    headSha = sha;
  }
  const next = write({
    enabled: true, hasOrigin: true, remote: 'origin', slug, originDisplay, headSha, config, configKnown: true,
    checkedAt: iso(now), lastDiscoveryError: null, disabledAt: null,
  });
  if (!prev.enabled) emit(slug, 'discovered');
  return next;
}

/** Enabled, config actually read, and not a delegation marker (decision 32). */
export const recordsLocally = (prefs) => !!prefs?.enabled && !!prefs.configKnown && !prefs.config?.delegateTo;

/** Every registered project plus every workspace metrics home (homes may be unregistered paths). */
export async function discoverAll({ force = false } = {}) {
  const paths = new Set((await listProjects()).filter((p) => p.exists).map((p) => p.path));
  for (const w of await listWorkspaces()) if (w.metricsProject) paths.add(w.metricsProject);
  const out = [];
  for (const p of paths) {
    try { out.push({ path: p, prefs: await discoverProject(p, { force }) }); }
    catch (err) { out.push({ path: p, error: String(err?.message || err) }); }
  }
  return out;
}

const isStale = (prefs) => !prefs?.checkedAt || Date.now() - Date.parse(prefs.checkedAt) >= DISCOVERY_TTL_MS;

/**
 * discover: true        → rediscover when the cache is older than DISCOVERY_TTL_MS
 *           false       → cache only (UI status calls)
 *           'if-missing'→ cache only, unless there is no cache entry at all; then one bounded
 *                         discovery (10 s ls-remote, 15 s fetch). Used by the terminal hook
 *                         (decision 25) so a run's `done` never waits on the network.
 */
export const DISCOVERY_RETRY_MS = 5 * 60_000;

async function prefsFor(projectDir, { discover = true } = {}) {
  let prefs = readTeamMetricsPrefs(projectKey(projectDir));
  if (discover === 'if-missing') {
    // A FAILED first discovery writes lastDiscoveryAt but no checkedAt, so keying only off
    // checkedAt made every terminal hook pay 10 s ls-remote + 15 s fetch while offline —
    // exactly what decision 25 forbids. A recent failed attempt counts as "tried".
    const triedRecently = prefs?.checkedAt
      || (prefs?.lastDiscoveryAt && Date.now() - Date.parse(prefs.lastDiscoveryAt) < DISCOVERY_RETRY_MS);
    if (!triedRecently) prefs = await discoverProject(projectDir, { lsTimeoutMs: 10_000, fetchTimeoutMs: 15_000 }).catch(() => prefs);
  } else if (discover && isStale(prefs)) {
    prefs = await discoverProject(projectDir).catch(() => prefs);
  }
  return prefs;
}

/** First registered, existing project whose (cached or computed) slug matches. */
export async function findLocalProjectBySlug(slug) {
  const want = String(slug || '').toLowerCase();
  for (const p of await listProjects()) {
    if (!p.exists) continue;
    const cached = readTeamMetricsPrefs(p.key)?.slug;
    const s = cached || (await projectSlug(p.path)).slug;
    if (s === want) return p;
  }
  return null;
}

/**
 * A local git checkout for `slug` that can own the metrics worktree: a registered project,
 * else a workspace member / metrics home (homes need not be registered projects, so a
 * workspace-run outbox must still find its repository). Used by flush and read.
 * @returns {Promise<{key:string, path:string, name:string}|null>}
 */
export async function findLocalRepoBySlug(slug) {
  const p = await findLocalProjectBySlug(slug);
  if (p) return p;
  const want = String(slug || '').toLowerCase();
  const seen = new Set();
  for (const w of await listWorkspaces()) {
    for (const path of [w.metricsProject, ...(w.projectPaths || [])]) {
      if (!path || seen.has(path) || !existsSync(path)) continue;
      seen.add(path);
      const key = projectKey(path);
      const s = readTeamMetricsPrefs(key)?.slug || (await projectSlug(path)).slug;
      if (s === want) return { key, path, name: basename(path) };
    }
  }
  return null;
}

export function setRecordMyRuns(projectDir, record) {
  const next = writeTeamMetricsPrefs(projectKey(projectDir), { record: record !== false });
  emit(next.slug || null, 'record-toggled');
  return next;
}

// ---- resolver (§4.5 step 1, §4.6b, §4.8) --------------------------------------
function invalidDelegate(code, detail) {
  return { ok: false, reason: 'delegate-invalid', code, detail };
}

/**
 * Where a single-project run on `projectDir` is recorded.
 * @returns {Promise<{ok:true, slug, projectDir, attribution, record, delegated, from}
 *                  | {ok:false, reason:'no-origin'|'not-enabled'|'delegate-invalid', code?, detail?}>}
 */
export async function resolveProjectSink(projectDir, { discover = true } = {}) {
  const own = await prefsFor(projectDir, { discover });
  if (own?.hasOrigin === false) return { ok: false, reason: 'no-origin' };
  if (!own?.enabled) return { ok: false, reason: 'not-enabled' };
  // Decision 32: an unread config could be a delegation marker — never route onto it.
  if (!own.configKnown) return { ok: false, reason: 'not-enabled', code: 'CONFIG_UNKNOWN', detail: 'the worca-metrics branch exists but could not be fetched yet' };
  const record = own.record !== false;
  const delegateTo = own.config?.delegateTo ? String(own.config.delegateTo).toLowerCase() : null;
  if (!delegateTo) {
    return { ok: true, slug: own.slug, projectDir, attribution: normAttribution(own.config?.attribution), record, delegated: false, from: own.slug };
  }
  if (delegateTo === own.slug) return invalidDelegate('DELEGATE_SELF', `${own.slug} delegates to itself`);
  // Registered project OR workspace member/home (decision 11 / 28): a home need not be registered.
  const target = await findLocalRepoBySlug(delegateTo);
  if (!target) return invalidDelegate('DELEGATE_UNKNOWN', `points at ${delegateTo}, which is not a project in Worca on this machine`);
  const t = await prefsFor(target.path, { discover });
  if (!t?.enabled) return invalidDelegate('DELEGATE_DANGLING', `points at ${delegateTo}, which no longer records`);
  if (!t.configKnown) return invalidDelegate('DELEGATE_UNKNOWN_CONFIG', `points at ${delegateTo}, whose branch could not be fetched yet`);
  if (t.config?.delegateTo) return invalidDelegate('DELEGATE_CHAIN', `points at ${delegateTo}, which itself delegates to ${t.config.delegateTo} (no chains)`);
  return { ok: true, slug: t.slug, projectDir: target.path, attribution: normAttribution(t.config?.attribution), record, delegated: true, from: own.slug };
}

const samePath = (a, b) => {
  if (!a || !b) return false;
  if (resolve(a) === resolve(b)) return true;
  try { return canonicalProjectRoot(a) === canonicalProjectRoot(b); } catch { return false; }
};

/** Where a workspace run is recorded: its local metrics home, which must record locally (§4.8). */
export async function resolveWorkspaceSink(workspaceId, { discover = true } = {}) {
  const ws = workspaceId ? await readWorkspace(workspaceId) : null;
  if (!ws) return { ok: false, reason: 'not-enabled' };
  if (!ws.metricsProject) return { ok: false, reason: 'no-home' };
  if (!ws.projectPaths.some((p) => samePath(p, ws.metricsProject))) {
    return { ok: false, reason: 'home-stale', code: 'HOME_NOT_MEMBER', detail: 'the metrics home is no longer a workspace member' };
  }
  const home = await prefsFor(ws.metricsProject, { discover });
  if (!home?.enabled) return { ok: false, reason: 'home-stale', code: 'HOME_BRANCH_MISSING', detail: 'branch missing on origin' };
  if (!home.configKnown) return { ok: false, reason: 'home-stale', code: 'HOME_CONFIG_UNKNOWN', detail: 'branch not fetched yet' };
  if (home.config?.delegateTo) return { ok: false, reason: 'home-stale', code: 'HOME_DELEGATES', detail: `the home delegates to ${home.config.delegateTo}; a home must record locally` };
  return {
    ok: true, slug: home.slug, projectDir: ws.metricsProject, attribution: normAttribution(home.config?.attribution),
    record: home.record !== false, delegated: false, from: home.slug, workspace: ws,
  };
}

// ---- worktree, enable/join, delegation marker (§5.7) --------------------------
/** git worktree of the project repo at metrics/repos/<slug>, detached at origin/worca-metrics.
 *  A corrupted checkout is removed and recreated (§4.7 — it holds nothing not on the remote/outbox). */
export async function ensureWorktree(slug, projectDir) {
  const dir = worktreePath(slug);
  if (existsSync(dir)) {
    const top = await _git(dir, ['rev-parse', '--show-toplevel'], { timeoutMs: 10_000 });
    let healthy = false;
    // .native on both sides: JS realpathSync keeps the caller's case, git reports the on-disk case
    // (a WORCA_HOME spelled with different case / 8.3 names would otherwise recreate it on every flush).
    try { healthy = top.ok && realpathSync.native(top.stdout.trim()) === realpathSync.native(dir); } catch { healthy = false; }
    if (healthy) return dir;
    await removeWorktreeDir(dir, projectDir);
    emit(slug, 'worktree-recreated');
  }
  await mkdir(dirname(dir), { recursive: true });
  const f = await fetchMetricsBranch(projectDir);
  if (!f.ok) throw metricsError('FETCH_FAILED', firstLine(f.stderr) || 'git fetch failed', { stderr: f.stderr });
  // defaultGit already disables hooks (a failing post-checkout would otherwise fail `worktree add`).
  let add = await _git(projectDir, ['worktree', 'add', '--detach', '--force', dir, REMOTE_REF]);
  if (!add.ok) {
    // A half-created directory from the first attempt makes the retry fail with "already exists".
    await rm(dir, { recursive: true, force: true, maxRetries: 10 });
    await _git(projectDir, ['worktree', 'prune']);
    add = await _git(projectDir, ['worktree', 'add', '--detach', '--force', dir, REMOTE_REF]);
    if (!add.ok) throw metricsError('WORKTREE_FAILED', firstLine(add.stderr), { stderr: add.stderr });
  }
  return dir;
}

async function removeWorktreeDir(dir, projectDir) {
  if (projectDir) await _git(projectDir, ['worktree', 'remove', '--force', dir]);
  await rm(dir, { recursive: true, force: true, maxRetries: 10 });
  if (projectDir) await _git(projectDir, ['worktree', 'prune']);
}

/** Build a parentless commit holding `files` ({relPath: content}) in projectDir's object store.
 *  Exported for the team-policy branch (policy/sync.mjs): same orphan-branch enable recipe. */
export async function orphanCommit(projectDir, files, message, attribution) {
  const gitDir = (await _git(projectDir, ['rev-parse', '--absolute-git-dir'])).stdout.trim();
  await mkdir(join(metricsRoot(), 'tmp'), { recursive: true });
  const stage = await mkdtemp(join(metricsRoot(), 'tmp', 'enable-'));
  const env = { GIT_DIR: gitDir, GIT_WORK_TREE: stage, GIT_INDEX_FILE: `${stage}.index` };
  try {
    for (const [rel, content] of Object.entries(files)) {
      await mkdir(dirname(join(stage, rel)), { recursive: true });
      await writeFile(join(stage, rel), content, 'utf8');
    }
    const must = async (args) => {
      const r = await _git(stage, args, { env });
      if (!r.ok) throw metricsError('COMMIT_FAILED', firstLine(r.stderr), { stderr: r.stderr });
      return r.stdout.trim();
    };
    // -f: $GIT_DIR/info/exclude and the user's global excludes apply to this index too.
    await must(['add', '-A', '-f', '.']);
    const tree = await must(['write-tree']);
    return await must([...(await identityArgs(projectDir, attribution)), 'commit-tree', tree, '-m', message]);
  } finally {
    await rm(stage, { recursive: true, force: true });
    await rm(`${stage}.index`, { force: true });
  }
}

export function isNonFastForward(stderr) {
  const s = String(stderr || '');
  return /\[rejected\][^\n]*\((fetch first|non-fast-forward)\)/.test(s)
    || /Updates were rejected because the (remote contains work|tip of your current branch is behind)/.test(s)
    // A concurrent server-side ref update. The wording depends on the SERVER's git (all three
    // observed against real bare origins; the retry never fired with only the first form):
    //   GitHub:      "[remote rejected] … (cannot lock ref '…': is at X but expected Y)"
    //   git ≤ 2.50:  "remote: error: cannot lock ref '…': is at X but expected Y"
    //                + " ! [remote rejected] HEAD -> worca-metrics (failed to update ref)"
    //   git ≥ 2.51:  "[remote rejected] … (incorrect old value provided)"
    || /\[remote rejected\][^\n]*\((cannot lock ref|failed to update ref|incorrect old value provided)/.test(s)
    || /cannot lock ref [^\n]*is at [0-9a-f]+ but expected/.test(s);
}

/** Exported: the page's sync chip must show the same §4.7 hint the Projects cell does. */
export function pushHint(stderr) {
  // GH006 = protected branch, GH013 = repository rulesets, GL-HOOK-ERR = GitLab, pre-receive = bare/self-hosted.
  return /protected|hook declined|pre-receive|GH006|GH013|rule violation|push declined|GL-HOOK|denied/i.test(String(stderr || '')) ? PROTECTION_HINT : null;
}

/** @returns {Promise<{slug:string, attribution:'git-user'|'none'}>} the validated delegate. */
async function validateDelegateTarget(delegateTo, ownSlug) {
  const want = String(delegateTo || '').toLowerCase();
  if (!want) throw metricsError('BAD_REQUEST', 'delegateTo is required');
  if (want === ownSlug) throw metricsError('DELEGATE_INVALID', 'a project cannot delegate to itself');
  const target = await findLocalRepoBySlug(want); // registered project or workspace member/home (decision 11)
  if (!target) throw metricsError('DELEGATE_INVALID', `${want} is not a project in Worca on this machine`);
  const t = (await discoverProject(target.path, { force: true }).catch(() => null)) || {};
  if (!t.enabled) throw metricsError('DELEGATE_INVALID', `${want} does not record team metrics`);
  if (!t.configKnown) throw metricsError('FETCH_FAILED', `could not read the ${METRICS_BRANCH} branch of ${want}; try again`);
  if (t.config?.delegateTo) throw metricsError('DELEGATE_INVALID', `${want} delegates to ${t.config.delegateTo}; pick a project that records locally`);
  // §4.6b "attribution follows the delegate": the marker commit is made under the SINK's policy.
  return { slug: want, attribution: normAttribution(t.config?.attribution) };
}

/**
 * POST /api/projects/:key/team-metrics/enable (§4.6, §4.6b).
 * mode 'here'     → create orphan branch with README + config {attribution}; or join if it exists.
 * mode 'delegate' → create a marker branch {delegateTo}; or join; with change:true rewrite an existing marker.
 * @returns {Promise<{action:'created'|'joined'|'changed', slug:string, config:object|null}>}
 */
export async function enableTeamMetrics(projectDir, { mode = 'here', attribution = 'git-user', delegateTo = null, change = false, now = new Date() } = {}) {
  if (mode !== 'here' && mode !== 'delegate') throw metricsError('BAD_REQUEST', `mode must be "here" or "delegate"`);
  const { slug, hasOrigin } = await projectSlug(projectDir);
  if (!hasOrigin) throw metricsError('NO_ORIGIN', 'this project has no origin remote — team metrics push to origin, so there is nowhere to record');
  const delegate = mode === 'delegate' ? await validateDelegateTarget(delegateTo, slug) : null;
  const target = delegate?.slug ?? null;
  // §4.6b: "attribution follows the delegate". A marker branch is committed under the DELEGATE's
  // policy, not the caller's default — otherwise, on a team whose sink chose attribution:'none',
  // every member's marker still carried the developer's real git name, and "Route all members"
  // (which passes no attribution at all) did it for the whole workspace in one click.
  const attr = mode === 'delegate' ? delegate.attribution : normAttribution(attribution);
  const user = await gitUserName(projectDir);
  const config = mode === 'delegate'
    // enabledBy follows the same policy as the commit identity (decision 13): anonymising the
    // marker's author while leaving the developer's name in its JSON body would defeat the point.
    ? { schema: 1, enabledAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'), enabledBy: attr === 'none' ? null : user, delegateTo: target }
    : { schema: 1, enabledAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'), enabledBy: attr === 'none' ? null : user, attribution: attr, notes: '' };

  const result = await withSlugLock(slug, async () => {
    const ls = await _git(projectDir, ['ls-remote', '--heads', 'origin', `refs/heads/${METRICS_BRANCH}`], { timeoutMs: 20_000 });
    if (!ls.ok) throw metricsError('REMOTE_UNREACHABLE', firstLine(ls.stderr), { stderr: ls.stderr });
    if (ls.stdout.trim()) {
      if (change && mode === 'delegate') return rewriteDelegation(slug, projectDir, config, attr);
      await ensureWorktree(slug, projectDir);
      return { action: 'joined' };
    }
    const commit = await orphanCommit(projectDir, {
      'README.md': README_TEXT,
      [`${METRICS_DIR}/config.json`]: JSON.stringify(config, null, 2) + '\n',
    }, mode === 'delegate' ? `metrics: delegate to ${target}` : 'metrics: enable team metrics', attr);
    const push = await _git(projectDir, ['push', '--no-verify', 'origin', `${commit}:refs/heads/${METRICS_BRANCH}`], { timeoutMs: 120_000 });
    if (!push.ok) {
      if (isNonFastForward(push.stderr)) { await ensureWorktree(slug, projectDir); return { action: 'joined' }; } // a teammate won the race
      throw metricsError('PUSH_REJECTED', firstLine(push.stderr), { stderr: push.stderr, hint: pushHint(push.stderr) });
    }
    await ensureWorktree(slug, projectDir);
    return { action: 'created' };
  });
  const prefs = (await discoverProject(projectDir, { force: true }).catch(() => null)) || {};
  emit(slug, result.action);
  return { action: result.action, slug, config: prefs.config ?? null };
}

/** Rewrite .worca-metrics/config.json on an existing marker branch (the "Change…" action). */
async function rewriteDelegation(slug, projectDir, config, attr = 'git-user') {
  const dir = await ensureWorktree(slug, projectDir);
  for (let attempt = 1; attempt <= MAX_PUSH_ATTEMPTS; attempt++) {
    const f = await fetchMetricsBranch(dir);
    if (!f.ok) throw metricsError('FETCH_FAILED', firstLine(f.stderr), { stderr: f.stderr });
    const reset = await _git(dir, ['reset', '--hard', REMOTE_REF]);
    if (!reset.ok) throw metricsError('WORKTREE_FAILED', firstLine(reset.stderr), { stderr: reset.stderr });
    const cur = await readFile(join(dir, METRICS_DIR, 'config.json'), 'utf8').then(JSON.parse).catch(() => ({}));
    if (!cur.delegateTo) throw metricsError('DELEGATE_INVALID', 'this project records locally; its branch is not a delegation marker');
    if (String(cur.delegateTo).toLowerCase() === config.delegateTo) return { action: 'changed' }; // already points there: nothing to commit
    await writeFile(join(dir, METRICS_DIR, 'config.json'), JSON.stringify({ ...cur, enabledAt: config.enabledAt, enabledBy: config.enabledBy, delegateTo: config.delegateTo }, null, 2) + '\n');
    await _git(dir, ['add', '-A', '-f', METRICS_DIR]);   // single segment: no separator to normalise
    // Same policy as enableTeamMetrics: the marker commit follows the DELEGATE's attribution,
    // which enableTeamMetrics already validated and passes in as `attr`.
    const c = await _git(dir, [...(await identityArgs(projectDir, attr)), 'commit', '-q', '--no-verify', '-m', `metrics: delegate to ${config.delegateTo}`]);
    if (!c.ok) throw metricsError('COMMIT_FAILED', firstLine(c.stderr), { stderr: c.stderr });
    const push = await _git(dir, ['push', '--no-verify', 'origin', `HEAD:refs/heads/${METRICS_BRANCH}`], { timeoutMs: 120_000 });
    if (push.ok) return { action: 'changed' };
    if (!isNonFastForward(push.stderr)) throw metricsError('PUSH_REJECTED', firstLine(push.stderr), { stderr: push.stderr, hint: pushHint(push.stderr) });
  }
  throw metricsError('PUSH_RETRIES_EXHAUSTED', 'the worca-metrics branch kept moving; try again');
}

// ---- outbox, per-slug queue + lock, flush, retention, prune (§5.8) ------------
const OUTBOX_FILE_RE = /^(\d{8}T\d{6}Z)-([A-Za-z0-9._-]{1,64})\.jsonl$/;

/**
 * "2026-09-15T14:30:12Z" + id → "20260915T143012Z-<id>.jsonl"
 *
 * The name is (startedAt, runId), so a run recorded once as `stopped` and again as `done` after a
 * resume lands on the SAME path and the second flush rewrites that one file. That is deliberate
 * (plan decision 37):
 * the last terminal state of a run is the true one, one run stays one line, and the branch keeps
 * one path per run (§4.5). It is the single exception to "records are immutable" (design §7, plan decision 37), which is
 * about not back-filling PR state and cost corrections. If `startedAt` differs between the two
 * records, both files exist and the reader keeps the first by `id` (§7.3 `seen`).
 */
export function recordFileName(record) {
  // Normalise to UTC first: a `…+02:00` stamp survives the [-:] strip as `20260915T163012+0200`,
  // fails OUTBOX_FILE_RE and throws BAD_REQUEST — i.e. the record is silently dropped. Step 3
  // always feeds toISOString(), so this only makes the invariant hold by construction.
  const src = record.startedAt || record.recordedAt;
  const ms = Date.parse(src);
  const iso = Number.isFinite(ms) ? new Date(ms).toISOString() : String(src);
  const ts = iso.replace(/[-:]/g, '').replace(/\.\d+/, '');
  const name = `${ts}-${String(record.id).replace(/[^A-Za-z0-9._-]/g, '-')}.jsonl`;
  if (!OUTBOX_FILE_RE.test(name)) throw metricsError('BAD_REQUEST', `cannot name a record file for ${record.id}`);
  return name;
}

/** .worca-metrics/runs/YYYY/MM/<name> (month by startedAt UTC, §4.2). */
export function runFilePath(name) {
  return join(METRICS_DIR, 'runs', name.slice(0, 4), name.slice(4, 6), name);
}

/** Durability point (§4.5): atomic write of one JSON line into the slug's outbox. */
export async function writeOutbox(slug, record) {
  const dir = outboxDir(slug);
  await mkdir(dir, { recursive: true });
  const name = recordFileName(record);
  const tmp = join(dir, `.${name}.${randomBytes(4).toString('hex')}.tmp`);
  await writeFile(tmp, JSON.stringify(record) + '\n', 'utf8');
  await rename(tmp, join(dir, name));
  return name;
}

export async function listOutbox(slug) {
  try { return (await readdir(outboxDir(slug))).filter((n) => OUTBOX_FILE_RE.test(n)).sort(); }
  catch { return []; }
}

/** Every slug with an outbox directory (encoded names decoded back). */
export async function listOutboxSlugs() {
  try {
    const names = await readdir(join(metricsRoot(), 'outbox'), { withFileTypes: true });
    return names.filter((d) => d.isDirectory()).map((d) => slugFromDirName(d.name));
  } catch { return []; }
}

const runIdOf = (name) => OUTBOX_FILE_RE.exec(name)?.[2] ?? null;

// In-process serialization per slug, then the cross-process lock file (§4.5).
const _queues = new Map();
export function withSlugLock(slug, fn) {
  const lockFile = join(outboxDir(slug), '.lock');
  const prev = _queues.get(lockFile) || Promise.resolve();
  const run = prev.catch(() => {}).then(() => withLock(lockFile, fn));
  const tail = run.catch(() => {});
  _queues.set(lockFile, tail);
  tail.then(() => { if (_queues.get(lockFile) === tail) _queues.delete(lockFile); });
  return run;
}

export function backoffMs(attempt, random = Math.random) {
  const base = 250 * 2 ** (attempt - 1);
  return Math.round(base / 2 + random() * base);
}

const _lastFailedAt = new Map(); // slug → ms of the last failed flush (page-open throttle)
export const PAGE_OPEN_FLUSH_BACKOFF_MS = 60_000;

function recordFailure(ownerKey, slug, code, stderr, pending) {
  _lastFailedAt.set(slug, Date.now());
  const hint = code === 'PUSH_REJECTED' ? pushHint(stderr) : null;
  if (ownerKey) writeTeamMetricsPrefs(ownerKey, { lastError: String(stderr || code).trim(), lastErrorCode: code, lastErrorAt: new Date().toISOString() });
  emit(slug, 'flush-failed', { code });
  return { ok: false, slug, code, stderr: String(stderr || ''), hint, pending, pushed: 0 };
}

/** §4.7: once the branch is gone, the outbox is retained for 30 days from the moment discovery
 *  saw it disappear (`prefs.disabledAt`), then dropped with a log line. */
async function dropExpired(slug, files, now, prefs) {
  const disabledMs = Date.parse(prefs?.disabledAt ?? '');
  if (!Number.isFinite(disabledMs) || now - disabledMs <= OUTBOX_RETENTION_MS) return files;
  const kept = [];
  for (const name of files) {
    const p = join(outboxDir(slug), name);
    const st = await stat(p).catch(() => null);
    // A record written AFTER the deletion (a teammate's stale cache) gets its own 30 days.
    if (st && now - Math.max(st.mtimeMs, disabledMs) > OUTBOX_RETENTION_MS) {
      await rm(p, { force: true });
      console.warn(`[worca] team metrics: dropped ${name} from the ${slug} outbox — the ${METRICS_BRANCH} branch is gone and the record is older than 30 days`);
      const id = runIdOf(name);
      if (id) writeRunLedger(id, { state: 'skipped', slug, reason: 'expired', detail: 'branch deleted; outbox retention elapsed' });
    } else kept.push(name);
  }
  return kept;
}

/**
 * Flush one slug's outbox (§4.5): fetch → reset --hard origin/worca-metrics → copy → commit → push,
 * retrying ≤ MAX_PUSH_ATTEMPTS with jittered backoff on non-fast-forward. Never throws.
 * @param {{hooks?:{beforePush?:Function}, sleep?:Function, random?:Function, now?:number}} [opts]
 */
export async function flushSlug(slug, { hooks: testHooks = {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), random = Math.random, now = Date.now() } = {}) {
  try {
    return await withSlugLock(slug, async () => {
      let files = await listOutbox(slug);
      if (!files.length) {
        // Nothing left to push: a stale lastError (e.g. the files were flushed by the CLI) must not
        // keep the Projects cell on "Retry" forever.
        const owner = await findLocalRepoBySlug(slug).catch(() => null);
        if (owner && readTeamMetricsPrefs(projectKey(owner.path))?.lastError) {
          writeTeamMetricsPrefs(projectKey(owner.path), { lastError: null, lastErrorCode: null, lastErrorAt: null });
        }
        return { ok: true, slug, pushed: 0, pending: 0 };
      }
      const owner = await findLocalRepoBySlug(slug); // registered project OR workspace member/home (decision 28)
      if (!owner) return recordFailure(null, slug, 'NO_LOCAL_PROJECT', `no local checkout of ${slug} is known to Worca on this machine`, files.length);
      const ownerKey = projectKey(owner.path);
      const prefs = (await discoverProject(owner.path).catch(() => null)) || readTeamMetricsPrefs(ownerKey);
      if (prefs && prefs.enabled === false) {
        files = await dropExpired(slug, files, now, prefs);
        return recordFailure(ownerKey, slug, 'BRANCH_MISSING', `origin has no ${METRICS_BRANCH} branch any more`, files.length);
      }
      // Decision 32 / §4.6b: a delegation marker never holds run files — e.g. the old sink became a
      // marker while records were queued, or its config is still unread. Keep the outbox and report.
      if (prefs?.config?.delegateTo) {
        return recordFailure(ownerKey, slug, 'SINK_DELEGATES', `${slug} now delegates to ${prefs.config.delegateTo}; a delegation marker never holds run files`, files.length);
      }
      if (prefs && prefs.enabled && !prefs.configKnown) {
        return recordFailure(ownerKey, slug, 'FETCH_FAILED', prefs.lastDiscoveryError || `could not read the ${METRICS_BRANCH} config of ${slug}`, files.length);
      }
      let dir;
      try { dir = await ensureWorktree(slug, owner.path); }
      catch (err) { return recordFailure(ownerKey, slug, err.code || 'WORKTREE_FAILED', err.stderr || err.message, files.length); }
      const identity = await identityArgs(owner.path, normAttribution(prefs?.config?.attribution));

      for (let attempt = 1; attempt <= MAX_PUSH_ATTEMPTS; attempt++) {
        const f = await fetchMetricsBranch(dir);
        if (!f.ok) {
          // The branch is gone on origin. The cached verdict can be up to an hour old (the
          // discover above is TTL-gated), so refresh it now: otherwise §4.7's 30-day retention
          // clock (prefs.disabledAt) starts late and the cell shows a raw git error instead of
          // "branch missing" (verified with a fresh cache after a branch deletion).
          if (/couldn't find remote ref|no such ref|not our ref/i.test(f.stderr)) {
            const fresh = (await discoverProject(owner.path, { force: true }).catch(() => null)) || {};
            if (fresh.enabled === false) {
              files = await dropExpired(slug, files, now, fresh);
              return recordFailure(ownerKey, slug, 'BRANCH_MISSING', `origin has no ${METRICS_BRANCH} branch any more`, files.length);
            }
          }
          return recordFailure(ownerKey, slug, 'FETCH_FAILED', f.stderr, files.length);
        }
        const reset = await _git(dir, ['reset', '--hard', REMOTE_REF]);
        if (!reset.ok) {
          await removeWorktreeDir(dir, owner.path); // recreated on the next trigger (§4.7)
          return recordFailure(ownerKey, slug, 'WORKTREE_FAILED', reset.stderr, files.length);
        }
        await _git(dir, ['clean', '-fdq']);
        for (const name of files) {
          const dest = join(dir, runFilePath(name));
          await mkdir(dirname(dest), { recursive: true });
          await copyFile(join(outboxDir(slug), name), dest);
        }
        // -f: info/exclude (shared by every worktree) or a global excludes file matching *.jsonl
        // would otherwise drop the records silently — and the clean-tree branch below would
        // then delete them from the outbox as "already pushed" (data loss).
        // posix pathspec: join() yields `.worca-metrics\\runs` on win32, which git does not match.
        const add = await _git(dir, ['add', '-A', '-f', `${METRICS_DIR}/runs`]);
        if (!add.ok) return recordFailure(ownerKey, slug, 'COMMIT_FAILED', add.stderr, files.length);
        const status = await _git(dir, ['status', '--porcelain']);
        if (status.ok && !status.stdout.trim()) {
          // Nothing to commit: only trust it if every file really is in HEAD (an earlier push whose cleanup failed).
          const missing = [];
          for (const name of files) {
            const inHead = await _git(dir, ['cat-file', '-e', `HEAD:${runFilePath(name).split('\\').join('/')}`]);
            if (!inHead.ok) missing.push(name);
          }
          if (missing.length) return recordFailure(ownerKey, slug, 'COMMIT_FAILED', `git did not stage ${missing.length} record file(s): ${missing[0]}`, files.length);
          await finishFlushed(slug, files, ownerKey);
          return { ok: true, slug, pushed: 0, pending: 0, attempts: attempt };
        }
        const commit = await _git(dir, [...identity, 'commit', '-q', '--no-verify', '-m', `metrics: ${files.length} run(s)`]);
        if (!commit.ok) return recordFailure(ownerKey, slug, 'COMMIT_FAILED', commit.stderr, files.length);
        if (testHooks.beforePush) await testHooks.beforePush({ attempt, dir });
        const push = await _git(dir, ['push', '--no-verify', 'origin', `HEAD:refs/heads/${METRICS_BRANCH}`], { timeoutMs: 120_000 });
        if (push.ok) {
          await finishFlushed(slug, files, ownerKey);
          return { ok: true, slug, pushed: files.length, pending: 0, attempts: attempt };
        }
        if (!isNonFastForward(push.stderr)) return recordFailure(ownerKey, slug, 'PUSH_REJECTED', push.stderr, files.length);
        if (attempt === MAX_PUSH_ATTEMPTS) return recordFailure(ownerKey, slug, 'PUSH_RETRIES_EXHAUSTED', push.stderr, files.length);
        await sleep(backoffMs(attempt, random));
      }
      return recordFailure(ownerKey, slug, 'PUSH_RETRIES_EXHAUSTED', '', files.length); // unreachable
    });
  } catch (err) {
    return { ok: false, slug, code: err?.code || 'FLUSH_FAILED', stderr: String(err?.message || err), hint: null, pending: (await listOutbox(slug)).length, pushed: 0 };
  }
}

async function finishFlushed(slug, files, ownerKey) {
  _lastFailedAt.delete(slug);
  for (const name of files) {
    await rm(join(outboxDir(slug), name), { force: true });
    const id = runIdOf(name);
    if (id) writeRunLedger(id, { state: 'recorded', slug });
  }
  writeTeamMetricsPrefs(ownerKey, { lastSyncAt: new Date().toISOString(), lastError: null, lastErrorCode: null, lastErrorAt: null });
  emit(slug, 'flushed', { count: files.length });
}

export async function flushAll(opts) {
  const out = [];
  for (const slug of await listOutboxSlugs()) {
    if ((await listOutbox(slug)).length) out.push(await flushSlug(slug, opts));
  }
  return out;
}

/** Flush whatever a project's runs are recorded into (its own slug or its delegate). */
export async function flushProject(projectDir, opts) {
  const sink = await resolveProjectSink(projectDir);
  if (!sink.ok) return { ok: false, slug: null, code: sink.reason.toUpperCase().replace(/-/g, '_'), stderr: sink.detail || sink.reason, pending: 0, pushed: 0 };
  return flushSlug(sink.slug, opts);
}

// Coalesced background flushes (after every record; on server start; page open; Push now).
const _scheduled = new Map();
const _inflight = new Set();
export function scheduleFlush(slug, opts = {}) {
  // Page-open trigger backs off after a recent failure (see "Page-open flush throttle" in §5.9).
  if (opts.reason === 'page-open' && Date.now() - (_lastFailedAt.get(slug) ?? -Infinity) < PAGE_OPEN_FLUSH_BACKOFF_MS) return null;
  if (_scheduled.has(slug)) return _scheduled.get(slug);
  const p = new Promise((r) => setImmediate(r))
    .then(() => { _scheduled.delete(slug); return flushSlug(slug, opts); });
  _scheduled.set(slug, p);
  _inflight.add(p);
  // `void p.catch(...)`: the promise returned by a bare `.finally()` is discarded, so any future
  // throw between `_scheduled.delete` and flushSlug's own try would surface as an unhandled
  // rejection in the UI server process. flushSlug never rejects today; this keeps it that way.
  void p.catch(() => {}).finally(() => _inflight.delete(p));
  return p;
}

/** Await in-flight flushes (CLI before exit). Resolves after `timeoutMs` regardless. */
export async function drainFlushes({ timeoutMs = 30_000 } = {}) {
  if (!_inflight.size) return;
  await Promise.race([
    Promise.allSettled([..._inflight]),
    new Promise((r) => setTimeout(r, timeoutMs).unref?.()),
  ]);
}

/** Periodic outbox retention for slugs whose branch the team deleted (§4.7). */
export async function sweepOutboxRetention({ now = Date.now() } = {}) {
  for (const slug of await listOutboxSlugs()) {
    const owner = await findLocalRepoBySlug(slug).catch(() => null);
    const prefs = owner ? readTeamMetricsPrefs(projectKey(owner.path)) : null;
    if (prefs && prefs.enabled === false) await withSlugLock(slug, async () => dropExpired(slug, await listOutbox(slug), now, prefs));
  }
}

/**
 * removeProject hook: drop metrics worktrees that belong to this project's repository (§4.5).
 * Matches by the worktree's `.git` file (`gitdir: <common>/worktrees/<name>`), which still works
 * when the project directory is already gone. Each removal holds the slug lock, so it never
 * pulls a worktree out from under a running flush or read.
 */
export async function pruneMetricsWorktreesFor(projectPath) {
  const reposDir = join(metricsRoot(), 'repos');
  if (!existsSync(reposDir)) return [];
  const common = await _git(projectPath, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const want = common.ok ? safeReal(common.stdout.trim()) : safeReal(join(projectPath, '.git'));
  const removed = [];
  for (const name of await readdir(reposDir)) {
    const dir = join(reposDir, name);
    const gitFile = await readFile(join(dir, '.git'), 'utf8').catch(() => '');
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(gitFile);
    const worktreeGitDir = m ? resolve(dir, m[1]) : null;
    // <common>/worktrees/<name> → <common>
    const owned = worktreeGitDir && safeReal(dirname(dirname(worktreeGitDir))) === want;
    if (!owned) continue;
    // try/catch per entry: withSlugLock -> outboxDir -> slugDirName throws BAD_REQUEST for any
    // metrics/repos/ entry whose name is not a valid slug, and one stray directory must not abort
    // the prune for every other worktree of this repository.
    try {
      const slug = slugFromDirName(name);
      await withSlugLock(slug, async () => {
        await removeWorktreeDir(dir, common.ok ? projectPath : null);
        // The DB row for the removed project is already gone (removeProject deletes it before
        // calling this), so findLocalRepoBySlug(slug) now reflects the post-removal state: it
        // still finds another local checkout of the same slug (a second clone, or a workspace
        // member/home) if one exists. Only drop the outbox when nothing can push it any more —
        // otherwise queued records that are still pushable would be silently lost.
        const owner = await findLocalRepoBySlug(slug).catch(() => null);
        if (owner) return;
        for (const file of await listOutbox(slug)) {
          console.warn(`[worca] team metrics: dropped ${file} from the ${slug} outbox — the project that owned its worktree was removed and no local checkout can push it any more`);
          const id = runIdOf(file);
          if (id) writeRunLedger(id, { state: 'skipped', slug, reason: 'project-removed' });
        }
        await rm(outboxDir(slug), { recursive: true, force: true, maxRetries: 10 });
      });
      removed.push(dir);
    } catch (err) {
      console.warn(`[worca] team metrics: could not prune ${dir}: ${err?.message || err}`);
    }
  }
  return removed;
}
/** realpath of the longest existing prefix + the missing tail. git writes `gitdir:` realpath'd
 *  (/private/var/… on macOS), so a deleted clone under /var/… must still compare equal. */
function safeReal(p) {
  let cur = resolve(p);
  const tail = [];
  for (;;) {
    try { return join(realpathSync.native(cur), ...tail); } catch { /* walk up */ }
    const up = dirname(cur);
    if (up === cur) return resolve(p);
    tail.unshift(basename(cur));
    cur = up;
  }
}

// ---- scan, route, status, background, test seam (§5.9) ------------------------
async function countRuns(slug) {
  // Local worktree only (no fetch): cheap status counts for cards. read.mjs owns parsing.
  const { readRecordsFromDir } = await import('./read.mjs');
  const dir = worktreePath(slug);
  if (!existsSync(dir)) return null;
  return (await readRecordsFromDir(dir)).records;
}

/** Status for the Projects page cell and the scope list (§4.11). */
export async function projectMetricsStatus(p, { discover = false, recordsBySink = new Map() } = {}) {
  const prefs = await prefsFor(p.path, { discover }) || {};
  const status = {
    key: p.key, name: p.name, path: p.path, exists: p.exists,
    slug: prefs.slug ?? null, hasOrigin: prefs.hasOrigin ?? null, enabled: !!prefs.enabled,
    enabledAt: prefs.config?.enabledAt ?? null, attribution: prefs.config?.delegateTo ? null : (prefs.enabled ? normAttribution(prefs.config?.attribution) : null),
    delegateTo: prefs.config?.delegateTo ?? null, delegateState: null, delegateDetail: null, delegateCode: null, blocked: null,
    origin: prefs.originDisplay ?? null,
    recordsLocally: recordsLocally(prefs),
    record: prefs.record !== false, pending: 0, runs: null,
    lastSyncAt: prefs.lastSyncAt ?? null, lastError: prefs.lastError ?? null, lastErrorCode: prefs.lastErrorCode ?? null,
    lastErrorHint: prefs.lastErrorCode === 'PUSH_REJECTED' ? pushHint(prefs.lastError) : null,
    checkedAt: prefs.checkedAt ?? null, sinkSlug: null,
  };
  // Undiscovered project (no prefs row yet): settle `hasOrigin` now rather than leaving
  // it null, which made the cell read "Off" and offer "Set up team metrics…" to folders
  // that can never record — a non-git folder (no origin to push to; the workspace scan
  // refuses it) or a git repo without an origin remote (setup would fail NO_ORIGIN).
  // Only undiscovered projects pay for these git spawns; discovered ones carry the
  // answer in prefs.
  if (status.hasOrigin == null && p.exists) {
    if (!isGitRepo(p.path)) { status.hasOrigin = false; status.noGit = true; }
    else {
      const { hasOrigin, slug } = await projectSlug(p.path);
      status.hasOrigin = hasOrigin;
      if (status.slug == null) status.slug = slug;
    }
  }
  if (!status.enabled || !p.exists) return status;
  const sink = await resolveProjectSink(p.path, { discover });
  if (!sink.ok) {
    // Only a delegation problem is a delegate problem: a CONFIG_UNKNOWN project does not delegate,
    // and calling it delegateState:'invalid' made the cell render plain "On" (projectTmState needs
    // delegateTo) while its runs were being skipped. `blocked` is what the cell and listScopes use.
    status.delegateState = sink.reason === 'delegate-invalid' ? 'invalid' : null;
    status.delegateDetail = sink.detail ?? null;
    status.delegateCode = sink.code ?? null;
    status.blocked = sink.code || sink.reason;
    return status;
  }
  status.blocked = null;
  if (sink.delegated) status.delegateState = 'ok';
  status.sinkSlug = sink.slug;
  status.pending = (await listOutbox(sink.slug)).length;
  // A promise in the memo: statuses are built a few at a time (listScopes), and two projects on
  // one sink must share a single read of its worktree.
  if (!recordsBySink.has(sink.slug)) recordsBySink.set(sink.slug, countRuns(sink.slug));
  const recs = await recordsBySink.get(sink.slug);
  status.runs = recs ? recs.filter((r) => r.target?.kind === 'project' && r.target.project === status.slug).length : null;
  if (sink.delegated) {
    const t = readTeamMetricsPrefs(projectKey(sink.projectDir));
    if (t?.lastError) { status.lastError = t.lastError; status.lastErrorCode = t.lastErrorCode; status.lastErrorHint = t.lastErrorCode === 'PUSH_REJECTED' ? pushHint(t.lastError) : null; }
  }
  return status;
}

/** POST /api/workspaces/metrics-scan (§4.8): per member, does origin/worca-metrics exist? */
export async function scanMembers(projectPaths) {
  const members = [];
  for (const path of projectPaths) {
    const prefs = (await discoverProject(path, { force: true }).catch((err) => ({ hasOrigin: null, lastDiscoveryError: String(err?.message || err) })))
      || { hasOrigin: null, lastDiscoveryError: 'could not read this repository' };
    const recs = recordsLocally(prefs) ? await countRuns(prefs.slug) : null;
    members.push({
      // hasOrigin is strictly true only when discovery saw an origin (an error is not "has origin").
      path, key: projectKey(path), slug: prefs.slug ?? basename(path), hasOrigin: prefs.hasOrigin === true,
      enabled: !!prefs.enabled, delegateTo: prefs.config?.delegateTo ?? null,
      recordsLocally: recordsLocally(prefs),
      enabledAt: prefs.config?.enabledAt ?? null,
      workspaceRuns: recs ? recs.filter((r) => r.target?.kind === 'workspace').length : null,
      error: prefs.lastDiscoveryError ?? null,
    });
  }
  return { members };
}

/**
 * The metrics home a new workspace gets without being asked: the ONE member that already
 * records locally, or null (none, several, or the scan could not run — e.g. a member that
 * is not a git repository). The workspace card's "Choose…" covers every other case, so the
 * create wizard no longer carries a team-metrics step. `scan` is injectable for tests.
 */
export async function autoMetricsHome(projectPaths, { scan = scanMembers } = {}) {
  let members;
  try { ({ members } = await scan(projectPaths)); } catch { return null; }
  const recording = (members || []).filter((m) => m.hasOrigin && m.recordsLocally && !m.error);
  return recording.length === 1 ? recording[0].path : null;
}

/** Workspace card status: home state + member routing summary (§4.8, §4.6b). */
export async function workspaceMetricsStatus(ws, { discover = false } = {}) {
  const members = [];
  const homeSlug = ws.metricsProject ? (await prefsFor(ws.metricsProject, { discover }))?.slug ?? null : null;
  for (const path of ws.projectPaths) {
    const prefs = await prefsFor(path, { discover }) || {};
    const isHome = !!ws.metricsProject && samePath(path, ws.metricsProject);
    let state; let reason = null;
    // recordsOn: the repository whose worca-metrics branch receives this project's runs (its
    // own slug, the home's, or a delegation target); null when nothing is recorded.
    let recordsOn = null;
    if (isHome) { state = 'home'; recordsOn = prefs.slug ?? null; }
    else if (prefs.hasOrigin === false) { state = 'not-recording'; reason = 'no origin remote'; }
    else if (prefs.config?.delegateTo && prefs.config.delegateTo.toLowerCase() === homeSlug) { state = 'routed'; recordsOn = homeSlug; }
    else if (prefs.enabled) { state = 'records-elsewhere'; reason = prefs.config?.delegateTo ? `delegates to ${prefs.config.delegateTo}` : 'records on its own branch'; recordsOn = prefs.config?.delegateTo ?? prefs.slug ?? null; }
    else { state = 'not-recording'; reason = 'no worca-metrics branch'; }
    members.push({ path, slug: prefs.slug ?? basename(path), state, reason, recordsOn });
  }
  let home = { state: 'unset', path: null, slug: null, runs: null, detail: null };
  if (ws.metricsProject) {
    const sink = await resolveWorkspaceSink(ws.id, { discover });
    // `record`: the home project's own "Include my runs" switch — it is what decides whether
    // THIS machine's workspace runs are written (docs/team-metrics.md, "Include my runs").
    home = { path: ws.metricsProject, slug: homeSlug ?? basename(ws.metricsProject), runs: null, detail: sink.ok ? null : sink.detail, state: sink.ok ? 'ok' : 'stale', code: sink.ok ? null : sink.code,
      record: readTeamMetricsPrefs(projectKey(ws.metricsProject))?.record !== false };
    if (sink.ok) {
      const recs = await countRuns(sink.slug);
      home.runs = recs ? recs.filter((r) => matchesWorkspace(r.target, ws)).length : null;
      home.pending = (await listOutbox(sink.slug)).length;
    }
  }
  const count = (s) => members.filter((m) => m.state === s).length;
  return {
    id: ws.id, name: ws.name, projectPaths: ws.projectPaths, home, members,
    counts: { recordsHere: count('home'), routed: count('routed'), notRecording: count('not-recording') + count('records-elsewhere') },
  };
}

/** Workspace card "Route all members to the metrics home" (§4.6b): one marker push per member. */
export async function routeWorkspaceMembers(workspaceId) {
  const sink = await resolveWorkspaceSink(workspaceId);
  if (!sink.ok) throw metricsError('NOT_ENABLED', sink.detail || 'this workspace has no valid metrics home');
  const results = [];
  for (const path of sink.workspace.projectPaths) {
    if (samePath(path, sink.projectDir)) continue;
    const prefs = (await discoverProject(path, { force: true }).catch(() => null)) || {}; // null: unreadable repo
    const slug = prefs.slug ?? basename(path);
    if (prefs.hasOrigin === false) { results.push({ path, slug, result: 'skipped', reason: 'no origin remote' }); continue; }
    if (prefs.enabled) {
      results.push({ path, slug, result: 'skipped', reason: prefs.config?.delegateTo ? `already delegates to ${prefs.config.delegateTo}` : 'already records on its own branch' });
      continue;
    }
    try {
      await enableTeamMetrics(path, { mode: 'delegate', delegateTo: sink.slug });
      results.push({ path, slug, result: 'routed' });
    } catch (err) {
      results.push({ path, slug, result: 'failed', code: err.code || 'ERROR', error: err.message, stderr: err.stderr || null, hint: err.hint || null });
    }
  }
  return { home: sink.slug, results };
}

/** UI server: discovery + flush on start, then hourly (§4.5, §4.6). Returns a stop function. */
export function startTeamMetricsBackground({ log = (m) => console.warn(m) } = {}) {
  const tick = async (force) => {
    try { await discoverAll({ force }); } catch (err) { log(`[worca-ui] team metrics discovery: ${err?.message || err}`); }
    try { await sweepOutboxRetention(); } catch { /* best-effort */ }
    try { sweepRunLedger(); } catch { /* best-effort: one file per run would otherwise accumulate forever */ }
    try { for (const slug of await listOutboxSlugs()) if ((await listOutbox(slug)).length) scheduleFlush(slug); }
    catch (err) { log(`[worca-ui] team metrics flush: ${err?.message || err}`); }
  };
  tick(true);
  // Half the TTL: a tick exactly one TTL after the last check finds checkedAt just under the TTL
  // and skips, which would make "hourly" discovery run every two hours.
  const timer = setInterval(() => tick(false), DISCOVERY_TTL_MS / 2);
  timer.unref?.();
  return () => clearInterval(timer);
}

export { readRunLedger };

export const _testing = {
  setGit(fn) { _git = fn; },
  reset() { _git = defaultGit; _queues.clear(); _scheduled.clear(); _lastFailedAt.clear(); },
  defaultGit,
};
