// Add a project by cloning a repository into the projects folder (docs/deploy-railway.md).
// On a hosted worca this replaces a `railway ssh` session: the clone runs in the server,
// as the server's user, with the read credential for that one command
// (host-credentials.mjs#gitEnvFor: GitHub's token or App, or the Azure DevOps PAT), and lands in a NEW folder directly under the
// projects root. Registration is the ordinary add-project step.
//
//   URLs     https only; no credentials inside the URL (use the token variables); Azure DevOps
//            spellings fold to https://dev.azure.com/org/project/_git/repo
//   allow    WORCA_CLONE_ALLOW, e.g. "github.com/acme/*,dev.azure.com/org/project/*"; unset = any
//   where    <projects root>/<name>; name defaults to the repository name, is sanitised,
//            and an existing folder is refused, never overwritten
//   size     --filter=blob:none (partial clone), a timeout (default 10 minutes), and a
//            failed clone removes its folder
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { githubEnv } from './github-credentials.mjs';
import { gitEnvFor } from './host-credentials.mjs';
import { isAzureHost, parseAzurePath } from '../shared/azure-remote.mjs';

export const CLONE_TIMEOUT_MS = 10 * 60_000;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SEG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const BRANCH_RE = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[A-Za-z0-9._\/-]{1,200}(?<![./])$/;
const AZ_ORG_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,49}$/;
// Azure project/repo names: up to 64 chars, no control chars or \ / : * ? " < > | ; # $ { } , + = [ ], no leading . or _.
const AZ_NAME_RE = /^(?![._])[^\\/:*?"<>|;#${},+=[\]\u0000-\u001f]{1,64}$/u;
const folderFrom = (s) => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 100) || 'repo';

/** A clone refusal: `code` is one of invalid | not-allowed | exists | auth-failed | not-found | timeout | failed. */
export class CloneError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** WORCA_CLONE_ALLOW -> lowercased, percent-decoded patterns of any depth ("host/a/*", "host/a/b/c"). */
export function parseCloneAllow(value) {
  const dec = (x) => { try { return decodeURIComponent(x); } catch { return x; } };
  return String(value || '').split(',').map((s) => dec(s.trim()).toLowerCase().replace(/\/+$/, '')).filter(Boolean);
}

/** True when host/owner/repo matches an allow entry ("host/path/*" or "host/path/repo", any depth). Empty list = any. */
export function cloneAllowed(allow, { host, owner, repo }) {
  if (!allow.length) return true;
  const full = `${host}/${owner}/${repo}`.toLowerCase();
  return allow.some((p) => (p.endsWith('/*') ? full.startsWith(p.slice(0, -1)) : full === p));
}

/**
 * Validate a clone request. Pure (besides existsSync on the target). Returns
 * { url, host, owner, repo, name, dir, branch } (Azure adds org and project; owner is "org/project") or throws CloneError('invalid'|'not-allowed'|'exists').
 */
export function planClone({ url, branch = null, name = null } = {}, { projectsRoot, env = process.env, exists = existsSync } = {}) {
  if (typeof url !== 'string' || !url.trim()) throw new CloneError('invalid', 'a repository URL is required');
  let u;
  try { u = new URL(url.trim()); } catch { throw new CloneError('invalid', 'not a valid URL'); }
  if (u.protocol !== 'https:') throw new CloneError('invalid', 'only https:// repository URLs are supported');
  const azure = isAzureHost(u.hostname);
  // Azure's "Clone" button puts the org as a user ("https://acme@dev.azure.com/…"): a user alone is dropped.
  if (u.password || (u.username && !azure)) {
    throw new CloneError('invalid', `the URL contains credentials; remove them and set ${azure ? 'WORCA_ADO_TOKEN' : 'the GitHub token or App variables'} where worca is deployed`);
  }
  if (u.search || u.hash) throw new CloneError('invalid', 'the URL must not have a query or fragment');
  if (u.port) throw new CloneError('invalid', 'the URL must not name a port');
  const segs = u.pathname.replace(/\/+$/, '').replace(/\.git$/i, '').split('/').filter(Boolean);
  let host; let owner; let repo; let extra = {}; let canonical;
  if (azure) {
    const az = parseAzurePath(u.hostname.toLowerCase(), segs);
    if (!az || !AZ_ORG_RE.test(az.org) || !AZ_NAME_RE.test(az.project) || !AZ_NAME_RE.test(az.repo)) {
      throw new CloneError('invalid', 'the URL must name one repository, like https://dev.azure.com/org/project/_git/repo');
    }
    ({ host, owner, repo } = az);
    extra = { org: az.org, project: az.project };
    const e = encodeURIComponent;
    canonical = `https://dev.azure.com/${e(az.org)}/${e(az.project)}/_git/${e(az.repo)}`;
  } else {
    host = u.hostname.toLowerCase();
    if (segs.length !== 2 || !segs.every((s) => SEG_RE.test(s))) {
      throw new CloneError('invalid', 'the URL must name one repository, like https://github.com/owner/repo');
    }
    [owner, repo] = segs;
    canonical = `https://${host}/${owner}/${repo}.git`;
  }
  if (!cloneAllowed(parseCloneAllow(env.WORCA_CLONE_ALLOW), { host, owner, repo })) {
    throw new CloneError('not-allowed', `${host}/${owner}/${repo} is not in WORCA_CLONE_ALLOW`);
  }
  if (branch != null && branch !== '' && (typeof branch !== 'string' || !BRANCH_RE.test(branch.trim()))) {
    throw new CloneError('invalid', 'not a valid branch name');
  }
  const folder = name == null || name === '' ? (azure ? folderFrom(repo) : repo) : String(name).trim();
  if (!NAME_RE.test(folder) || folder === '.' || folder === '..') {
    throw new CloneError('invalid', 'the folder name may use letters, digits, ".", "_" and "-" (up to 100)');
  }
  if (!projectsRoot) throw new CloneError('invalid', 'no projects folder is configured');
  const root = resolve(projectsRoot);
  const dir = join(root, folder);
  if (!dir.startsWith(root + sep)) throw new CloneError('invalid', 'the folder must be directly under the projects folder');
  if (exists(dir)) throw new CloneError('exists', `${dir} already exists; pick another folder name`);
  return {
    url: canonical, host, ...extra, owner, repo, name: folder, dir,
    branch: branch ? branch.trim() : null,
  };
}

function classify(stderr, host = 'github.com') {
  const s = String(stderr || '');
  if (/Authentication failed|could not read Username|terminal prompts disabled|403/i.test(s)) {
    return new CloneError('auth-failed', isAzureHost(host)
      ? 'Azure DevOps refused the credential: check WORCA_ADO_TOKEN (Code: Read) and that it can see this repository'
      : 'GitHub refused the credential: check the token or that the App is installed on this repository');
  }
  if (/Remote branch .* not found/i.test(s)) return new CloneError('not-found', 'that branch does not exist');
  if (/Repository not found|not found|404/i.test(s)) {
    return new CloneError('not-found', 'repository not found, or the credential cannot see it');
  }
  const last = s.trim().split('\n').filter(Boolean).pop() || 'git clone failed';
  return new CloneError('failed', last.replace(/https:\/\/[^@\s]+@/g, 'https://'));
}

/** Run `git clone` for a plan. Resolves the plan; rejects with CloneError after removing the folder. */
export async function runClone(plan, { timeoutMs = CLONE_TIMEOUT_MS, credential = githubEnv, spawnImpl = spawn } = {}) {
  // Each host gets ITS read credential for this one command (gitEnvFor); GitHub keeps the injectable seam.
  const cred = await gitEnvFor('read', plan.url, { githubEnvImpl: credential });
  if (cred.error) throw new CloneError('auth-failed', cred.error);
  const args = ['clone', '--filter=blob:none', ...(plan.branch ? ['--branch', plan.branch] : []), '--', plan.url, plan.dir];
  const env = { ...cred.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '', LC_ALL: 'C' };
  const { code, stderr, timedOut } = await new Promise((done) => {
    let err = '';
    let child;
    try { child = spawnImpl('git', args, { env, stdio: ['ignore', 'ignore', 'pipe'] }); }
    catch (e) { done({ code: -1, stderr: e.message, timedOut: false }); return; }
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } done({ code: -1, stderr: err, timedOut: true }); }, timeoutMs);
    child.stderr?.on('data', (b) => { if (err.length < 64_000) err += b.toString(); });
    child.on('error', (e) => { clearTimeout(timer); done({ code: -1, stderr: err || e.message, timedOut: false }); });
    child.on('close', (c) => { clearTimeout(timer); done({ code: c ?? -1, stderr: err, timedOut: false }); });
  });
  if (code === 0) return plan;
  await rm(plan.dir, { recursive: true, force: true }).catch(() => {});
  if (timedOut) throw new CloneError('timeout', `the clone took longer than ${Math.round(timeoutMs / 60_000)} minutes`);
  throw classify(stderr, plan.host);
}

/**
 * Plan, clone, register: the one path the API, the CLI and Ask Worca's card share. The
 * project name (= folder name) is checked against registered projects BEFORE cloning, so
 * a clash never leaves a stray folder. Resolves { project, plan }; rejects with CloneError.
 */
export async function cloneProject(req, { projectsRoot, env = process.env, listProjects, addProject, run = runClone } = {}) {
  const plan = planClone(req, { projectsRoot, env });
  const existing = await listProjects();
  if (existing.some((p) => p && typeof p.name === 'string' && p.name.toLowerCase() === plan.name.toLowerCase())) {
    throw new CloneError('exists', `a project named "${plan.name}" already exists; pick another folder name`);
  }
  await run(plan);
  try {
    const projects = await addProject({ name: plan.name, path: plan.dir });
    return { project: projects.find((p) => p.path === plan.dir) || { name: plan.name, path: plan.dir }, plan };
  } catch (e) {
    await rm(plan.dir, { recursive: true, force: true }).catch(() => {});
    throw new CloneError('failed', e.message);
  }
}
