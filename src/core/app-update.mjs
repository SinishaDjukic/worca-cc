// src/core/app-update.mjs
// Settings ▸ About: "is this the latest Worca, what changed since, and how do I get it" (issue #841).
//
// Three separate questions, answered separately, because they have different owners:
//
//   1. CHECK   may this instance ask the npm registry which version is current?
//              A plain GET of the package's dist-tags. Nothing about the instance travels
//              with it (no id, no version, no usage). Off with WORCA_UPDATE_CHECK=0 (an
//              air-gapped or egress-locked network), or from Settings when the operator
//              left it to the person. WORCA_UPDATE_REGISTRY points it at an internal
//              mirror (Artifactory, Nexus, Verdaccio), so a corporate network can check
//              without reaching registry.npmjs.org.
//   2. NOTES   what changed between the running version and the newest one: the release
//              tags in between (each links to its GitHub release), the compare view, and
//              the docs changelog. Links only; the browser opens them.
//   3. APPLY   may THIS PROCESS replace its own code? Only a desktop install the person
//              owns and npm installed globally ('self'). Everything else is 'managed':
//                container  the code lives in the image. Changing it in place is lost on
//                           the next restart and breaks "this tag is what runs". A new
//                           version is a new image tag, pulled by whoever runs compose.
//                hosted     people reach it through an identity proxy and do not own it.
//                           Its operator upgrades by changing the image tag (staged,
//                           rollback-able, audited), never a visitor's button.
//                source     a git checkout updates with git, on the developer's terms.
//                npx        each `npx @worca/app@x` already picks its version.
//              WORCA_SELF_UPDATE=0 makes a desktop install 'managed' too: the managed
//              laptop case, where IT pins and ships versions (MDM, Intune, Jamf, a
//              golden image) and a user-initiated npm -g would fight that rollout.
//
// Automatic install is opt-in (off by default), stable releases only, only where APPLY
// is 'self', and only while nothing is running; it never restarts the server itself
// while a run or a chat turn could be in flight (the server decides when it is idle).
//
// The registry call and the install are injected (`fetchImpl`, `runImpl`) so the tests
// never touch the network or npm.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const UPDATE_CHECK_ENV = 'WORCA_UPDATE_CHECK';
export const SELF_UPDATE_ENV = 'WORCA_SELF_UPDATE';
export const UPDATE_REGISTRY_ENV = 'WORCA_UPDATE_REGISTRY';
export const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
export const CHANGELOG_URL = 'https://docs.worca.dev/changelog';
export const PACKAGE_NAME = '@worca/app';
/** How long a registry answer is trusted before the next background check. */
export const CHECK_TTL_MS = 12 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 10_000;
/** A forced check (Check now) inside this window is served from the cache: on a shared instance
 *  every signed-in person can press it, and the registry should not see each press. */
const MIN_FORCE_INTERVAL_MS = 60_000;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
/** The release workflow's tag prefix (.github/workflows/release-npm-app.yml). */
const TAG_PREFIX = 'worca-app-v';
/** A version npm may install: digits and dots, an optional -prerelease. Never a range or a tag. */
const EXACT_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
/** How many in-between releases the card lists before it says "and N more". */
const MAX_LISTED = 20;

const off = (v) => /^(0|false|no|off)$/i.test(String(v ?? '').trim());
const isPrerelease = (v) => /^[^+-]*-/.test(String(v || ''));

/**
 * How this copy of Worca was installed, from where its package root sits.
 *   'source'  a git checkout (package root holds .git)
 *   'npx'     npm's exec cache (…/_npx/…/node_modules/@worca/app)
 *   'npm'     any other node_modules/@worca/app (global or a project's; apply checks which)
 *   'unknown' anything else (a tarball unpacked by hand, a vendored copy)
 */
export function detectInstallKind(root, { exists = fs.existsSync } = {}) {
  const r = path.resolve(String(root || ''));
  if (exists(path.join(r, '.git'))) return 'source';
  const parts = r.split(path.sep);
  const n = parts.length;
  if (n >= 3 && parts[n - 1] === 'app' && parts[n - 2] === '@worca' && parts[n - 3] === 'node_modules') {
    return parts.includes('_npx') ? 'npx' : 'npm';
  }
  return 'unknown';
}

/**
 * Who may do what here. Pure: env, the deployment (deployment.mjs) and the install kind.
 * @param {{ env?: object, deployment?: 'local'|'container'|'hosted', installKind?: string, settings?: { check?: boolean, auto?: boolean } }} o
 * @returns {{ check: boolean, checkLockedBy: 'env'|null, apply: 'self'|'managed', managedBy: string|null, auto: boolean, autoAllowed: boolean }}
 *   managedBy names why the button is not offered: 'env' | 'container' | 'hosted' | 'source' | 'npx' | 'unknown'.
 */
export function updatePolicy({ env = process.env, deployment = 'local', installKind = 'npm', settings = {} } = {}) {
  const checkLocked = off(env[UPDATE_CHECK_ENV]);
  const check = !checkLocked && settings.check !== false;
  let managedBy = null;
  if (deployment === 'hosted') managedBy = 'hosted';
  else if (deployment === 'container') managedBy = 'container';
  else if (off(env[SELF_UPDATE_ENV])) managedBy = 'env';
  else if (installKind !== 'npm') managedBy = installKind;
  const apply = managedBy ? 'managed' : 'self';
  // Automatic install rides on both: it needs the check (to know) and 'self' (to act).
  const autoAllowed = apply === 'self' && check;
  return { check, checkLockedBy: checkLocked ? 'env' : null, apply, managedBy, auto: autoAllowed && settings.auto === true, autoAllowed };
}

/** The registry base (no trailing slash): WORCA_UPDATE_REGISTRY, else npmjs. Only http(s). */
export function registryBase(env = process.env) {
  const raw = String(env[UPDATE_REGISTRY_ENV] || '').trim();
  if (!raw) return DEFAULT_REGISTRY;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return DEFAULT_REGISTRY;
    if (u.username || u.password) return DEFAULT_REGISTRY;   // never echo a credential into a status payload
    return u.href.replace(/\/+$/, '');
  } catch {
    return DEFAULT_REGISTRY;
  }
}

/**
 * Ask the registry for the package's dist-tags and versions (the abbreviated document:
 * no readmes, no per-version manifests beyond what npm install itself needs).
 * @returns {Promise<{ distTags: Record<string,string>, versions: string[] }>}
 * @throws {Error} on a network error, a timeout, a non-2xx answer or an unusable body
 */
export async function fetchRegistryInfo({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = CHECK_TIMEOUT_MS } = {}) {
  const url = `${registryBase(env)}/${PACKAGE_NAME.replace('/', '%2f')}`;
  const res = await fetchImpl(url, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res || !res.ok) throw new Error(`the registry answered ${res ? res.status : 'nothing'}`);
  const body = await res.json();
  const distTags = body && typeof body['dist-tags'] === 'object' && body['dist-tags'] ? body['dist-tags'] : null;
  if (!distTags || typeof distTags.latest !== 'string') throw new Error('the registry answer has no latest version');
  const versions = body.versions && typeof body.versions === 'object' ? Object.keys(body.versions) : [];
  return { distTags, versions: versions.filter((v) => EXACT_VERSION_RE.test(v)) };
}

/**
 * Semver precedence (semver.org §11) over EXACT_VERSION_RE strings: major.minor.patch
 * numerically, a prerelease below its release, prerelease identifiers numeric-aware
 * (rc.2 < rc.10). Anything that is not such a version sorts below every version.
 */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0;
  for (let i = 0; i < 3; i++) if (pa.core[i] !== pb.core[i]) return pa.core[i] > pb.core[i] ? 1 : -1;
  if (!pa.pre.length || !pb.pre.length) return pa.pre.length === pb.pre.length ? 0 : (pa.pre.length ? -1 : 1);
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) > Number(y) ? 1 : -1;
    if (nx !== ny) return nx ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

function parseVersion(v) {
  if (typeof v !== 'string' || !EXACT_VERSION_RE.test(v)) return null;
  const [core, ...rest] = v.split('-');
  return { core: core.split('.').map(Number), pre: rest.length ? rest.join('-').split('.') : [] };
}

/** `candidate` is strictly newer than `installed`. */
export const isNewerVersion = (candidate, installed) => !!parseVersion(candidate) && !!parseVersion(installed) && compareVersions(candidate, installed) > 0;

/**
 * The newest version this instance should move to, or null when it is current.
 * A stable install follows `latest`. A release candidate follows the newer of `latest`
 * and `rc`: whoever opted into an RC wants the next RC, and the stable it becomes.
 */
export function pickTarget(current, distTags = {}) {
  const candidates = [distTags.latest];
  if (isPrerelease(current)) candidates.push(distTags.rc);
  let best = null;
  for (const c of candidates) {
    if (typeof c !== 'string' || !EXACT_VERSION_RE.test(c)) continue;
    if (!isNewerVersion(c, current)) continue;
    if (!best || isNewerVersion(c, best)) best = c;
  }
  return best;
}

/** GitHub release page of one version. */
export const releaseTagUrl = (repoUrl, version) => (repoUrl ? `${repoUrl}/releases/tag/${TAG_PREFIX}${version}` : '');

/**
 * The release notes between `current` (exclusive) and `target` (inclusive): stable
 * releases, plus the target itself when it is an RC. Newest first.
 */
export function releaseNotes({ current, target, versions = [], repoUrl = '' }) {
  if (!target) return { releases: [], more: 0, compareUrl: '', changelogUrl: CHANGELOG_URL };
  const between = [...new Set(versions)]
    .filter((v) => (v === target || !isPrerelease(v)) && isNewerVersion(v, current) && !isNewerVersion(v, target))
    .sort((a, b) => compareVersions(b, a));
  if (!between.includes(target)) between.unshift(target);
  const listed = between.slice(0, MAX_LISTED);
  return {
    releases: listed.map((version) => ({ version, url: releaseTagUrl(repoUrl, version) })),
    more: between.length - listed.length,
    compareUrl: repoUrl ? `${repoUrl}/compare/${TAG_PREFIX}${current}...${TAG_PREFIX}${target}` : '',
    changelogUrl: CHANGELOG_URL,
  };
}

/**
 * The exact steps that update this kind of install, for the card's "How to update" line
 * and for the managed cases where the card cannot do it. `target` is pinned on purpose:
 * the command installs the version the card showed, not whatever `latest` is by then.
 */
export function updateInstructions({ deployment, installKind, target }) {
  const v = target || 'latest';
  if (deployment === 'hosted') {
    return { who: 'admin', steps: [`Your administrator upgrades this instance by deploying the ${v} image tag.`] };
  }
  if (deployment === 'container') {
    return { who: 'operator', steps: [`Set WORCA_TAG=${v} in .env (or keep latest)`, 'docker compose pull && docker compose up -d'] };
  }
  if (installKind === 'source') return { who: 'you', steps: ['git pull && npm install', 'worca ui restart'] };
  if (installKind === 'npx') return { who: 'you', steps: [`npx ${PACKAGE_NAME}@${v}`] };
  return { who: 'you', steps: [`npm install -g ${PACKAGE_NAME}@${v}`, 'worca ui restart'] };
}

/** `npm root -g`, trimmed. The injected runner answers { code, stdout, stderr }. */
export async function npmGlobalRoot({ runImpl = runNpm } = {}) {
  const r = await runImpl(['root', '-g'], { timeoutMs: 30_000 });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || 'npm root -g failed').trim().slice(-400));
  return r.stdout.trim();
}

/**
 * Is `root` the global install npm would replace? A copy inside some project's
 * node_modules is that project's dependency, and `npm install -g` would not touch it.
 */
export async function isGlobalInstall(root, { runImpl = runNpm, realpath = fs.realpathSync } = {}) {
  const g = await npmGlobalRoot({ runImpl });
  const norm = (p) => { try { return realpath(p); } catch { return path.resolve(p); } };
  return norm(path.join(g, ...PACKAGE_NAME.split('/'))) === norm(root);
}

/**
 * npm install -g @worca/app@<version>. The version must be an exact one the registry
 * listed; the spec is never a range, a tag or anything a shell could read.
 * @returns {Promise<{ ok: boolean, output: string }>}
 */
export async function installVersion(version, { runImpl = runNpm } = {}) {
  if (!EXACT_VERSION_RE.test(String(version || ''))) throw new Error(`not an exact version: ${JSON.stringify(version)}`);
  const r = await runImpl(['install', '-g', `${PACKAGE_NAME}@${version}`], { timeoutMs: INSTALL_TIMEOUT_MS });
  const output = `${r.stdout || ''}${r.stderr || ''}`.trim().slice(-4000);
  return { ok: r.code === 0, output };
}

/** Spawn npm with fixed arguments. Windows reaches npm through its .cmd shim, so it needs a shell. */
export function runNpm(args, { timeoutMs = INSTALL_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn('npm', args, { shell: process.platform === 'win32', windowsHide: true, timeout: timeoutMs, env: process.env });
    } catch (err) {
      resolve({ code: 1, stdout: '', stderr: err?.message || String(err) });
      return;
    }
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });
    child.on('error', (err) => resolve({ code: 1, stdout, stderr: stderr + (err?.message || String(err)) }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/**
 * The update checker the server holds: one cached registry answer, a status payload for
 * GET /api/app/update, and the apply step. Stateless about the policy: the caller
 * passes the current one in, so a Settings change applies on the next call.
 */
export function createUpdateChecker({ current, repoUrl = '', env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  let cache = null;        // { checkedAt, distTags, versions } | null
  let lastError = null;    // { at, message } | null
  let inFlight = null;
  let installing = null;   // { version, startedAt } while npm runs
  let installed = null;    // { version, at } after a successful install (restart pending)

  async function check({ force = false } = {}) {
    if (cache && now() - cache.checkedAt < (force ? MIN_FORCE_INTERVAL_MS : CHECK_TTL_MS)) return cache;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const info = await fetchRegistryInfo({ env, fetchImpl });
        cache = { checkedAt: now(), ...info };
        lastError = null;
      } catch (err) {
        lastError = { at: now(), message: err?.name === 'TimeoutError' ? 'the registry did not answer in time' : (err?.message || String(err)) };
      } finally {
        inFlight = null;
      }
      return cache;
    })();
    return inFlight;
  }

  function status({ policy, deployment, installKind }) {
    const target = policy.check && cache ? pickTarget(current, cache.distTags) : null;
    return {
      current,
      channel: isPrerelease(current) ? 'rc' : 'stable',
      check: { enabled: policy.check, lockedBy: policy.checkLockedBy, registry: registryBase(env), checkedAt: cache ? new Date(cache.checkedAt).toISOString() : null, error: policy.check && lastError ? lastError.message : null },
      latest: policy.check && cache ? (cache.distTags.latest || null) : null,
      updateAvailable: !!target && !(installed && installed.version === target),
      target,
      notes: releaseNotes({ current, target, versions: cache ? cache.versions : [], repoUrl }),
      apply: policy.apply,
      managedBy: policy.managedBy,
      auto: { enabled: policy.auto, allowed: policy.autoAllowed },
      instructions: updateInstructions({ deployment, installKind, target }),
      installing: installing ? { ...installing } : null,
      installed: installed ? { ...installed } : null,
    };
  }

  /** Install `target` (must be what the current check offers). Throws a coded error the route maps. */
  async function apply({ version, policy, root, runImpl = runNpm }) {
    const fail = (code, message) => Object.assign(new Error(message), { code });
    if (policy.apply !== 'self') throw fail('MANAGED', 'Updates on this instance are managed outside Worca');
    if (installing) throw fail('BUSY', `Already installing ${installing.version}`);
    const target = cache ? pickTarget(current, cache.distTags) : null;
    if (!target) throw fail('NO_UPDATE', 'There is no newer version to install — check again first');
    if (version && version !== target) throw fail('STALE', `The newest version is now ${target}, not ${version} — check again`);
    installing = { version: target, startedAt: new Date(now()).toISOString() };
    try {
      if (!(await isGlobalInstall(root, { runImpl }))) {
        throw fail('NOT_GLOBAL', 'This copy is not the one `npm install -g` updates — update it the way it was installed');
      }
      const r = await installVersion(target, { runImpl });
      if (!r.ok) throw fail('INSTALL_FAILED', r.output || 'npm install failed');
      installed = { version: target, at: new Date(now()).toISOString() };
      return { version: target, output: r.output };
    } finally {
      installing = null;
    }
  }

  return { check, status, apply, get pendingRestart() { return installed; } };
}
