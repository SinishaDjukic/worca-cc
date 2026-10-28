// src/core/git-free/team-repo.mjs — which GitHub repository a project's team branches live on, without git (P6 Task 7).
// Read from .git/config (stat + read, never a child process) or typed once in the setup dialog (project_config.extra.teamRepo).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gitAvailable, gitMissingError } from '../git-available.mjs';
import { getProjectByPath } from '../projects.mjs';
import { readTeamRepo, writeTeamRepo } from '../config.mjs';
import { parseRemoteUrl } from '../forge.mjs';
import { githubRepoOf, createGithubClient } from './github.mjs';

const badRequest = (message) => Object.assign(new Error(message), { code: 'BAD_REQUEST' });
/** A typed repo exists only for a registered project: read it by the row's key, never projectKey() (git rev-parse with git). */
function typedRepoOf(projectDir) {
  const key = projectDir ? getProjectByPath(projectDir)?.key : null;
  return key ? readTeamRepo(key) : null;
}

/** A regular file of at most 1 MiB, else null (absent): a FIFO or a device (`/dev/zero`) would block the event loop. */
function readSmallFile(p) {
  try {
    const st = statSync(p);
    return st.isFile() && st.size <= 1 << 20 ? readFileSync(p, 'utf8') : null;
  } catch { return null; }
}

function configDirOf(projectDir) {
  const dotGit = join(projectDir, '.git');
  let st;
  try { st = statSync(dotGit); } catch { return null; }
  if (st.isDirectory()) return dotGit;
  const text = readSmallFile(dotGit);
  if (text == null) return null;
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(text);
  if (!m) return null;
  const gitdir = resolve(dirname(dotGit), m[1]);
  const common = readSmallFile(join(gitdir, 'commondir'))?.trim();   // none: the gitdir holds the config
  return common ? resolve(gitdir, common) : gitdir;
}

function parseValue(raw) {
  let out = '';
  let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"') { quoted = !quoted; continue; }
    if (!quoted && (c === ';' || c === '#')) break;
    if (c === '\\' && i + 1 < raw.length) { out += raw[++i]; continue; }
    out += c;
  }
  return out.trim();
}

/** The origin remote's URL from .git/config (pushurl over url) — stat + read only, never runs git. */
export function readOriginUrl(projectDir) {
  if (!projectDir) return null;
  const dir = configDirOf(projectDir);
  if (!dir) return null;
  const text = readSmallFile(join(dir, 'config'));
  if (text == null) return null;
  let inOrigin = false;
  let url = null;
  let pushurl = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const sec = /^\[\s*([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]/.exec(line);
    if (sec) { inOrigin = sec[1].toLowerCase() === 'remote' && sec[2] === 'origin'; continue; }
    if (!inOrigin) continue;
    const kv = /^([A-Za-z][A-Za-z0-9-]*)\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    if (key === 'url') url = parseValue(kv[2]);
    else if (key === 'pushurl') pushurl = parseValue(kv[2]);
  }
  return pushurl || url || null;
}

export function teamRepoState(projectDir) {
  if (projectDir && existsSync(join(projectDir, '.git'))) {
    const url = readOriginUrl(projectDir);
    return url ? { kind: 'origin', url } : { kind: 'git-no-origin' };
  }
  const repo = typedRepoOf(projectDir);
  return repo ? { kind: 'typed', repo } : { kind: 'none' };
}

/** HTTPS transport for the team branches: always without git; with git only a Folder whose team repo was typed. */
export function teamOverHttps(projectDir) {
  return !gitAvailable() || (!!projectDir && !existsSync(join(projectDir, '.git')) && !!typedRepoOf(projectDir));
}

/** A run's one bounded team discovery (policy / metrics prefs never read yet): a Git run, or team branches over HTTPS.
 *  Never a no-project run: all of them share one project key, so one work folder's origin would serve every one. */
export function teamRunDiscover(workMode, projectDir) {
  if (workMode === 'none') return false;
  return workMode === 'git' || teamOverHttps(projectDir) ? 'if-missing' : false;
}

/** projectSlug's shape (metrics/sync.mjs) for the HTTPS transport. */
export function projectSlugHttps(projectDir, { slugFromUrl, fallbackSlug }) {
  const st = teamRepoState(projectDir);
  if (st.kind === 'origin' || st.kind === 'typed') {
    const url = st.kind === 'origin' ? st.url : `https://github.com/${st.repo}`;
    const slug = slugFromUrl(url) || fallbackSlug();
    // The HTTPS transport names the repository by this slug: a name the slug changes (`acme/.github` → `acme/github`,
    // `tools-` → `tools`) would be another repository, so it needs git. A CI token URL (`https://user:token@github.com/…`)
    // is judged without its userinfo, which is never sent: the requests carry worca's own credential, as for every origin.
    const gh = githubRepoOf(url.replace(/^(https?:\/\/)[^@/]*@/i, '$1'));
    const exact = !!gh && `${gh.owner}/${gh.repo}`.toLowerCase() === slug;
    return { slug, hasOrigin: true, originUrl: url, remotesOk: true, ...(exact ? {} : { needsGit: true }) };
  }
  if (st.kind === 'git-no-origin') return { slug: fallbackSlug(), hasOrigin: false, originUrl: null, remotesOk: true };
  return { slug: fallbackSlug(), hasOrigin: false, originUrl: null, remotesOk: false, repoInput: true };
}

/** A repository URL copied from the browser: `www.`, no scheme (`github.com/acme/x`) and a page below the repository
 *  (…/tree/main, …/pull/3) name it too; so does `owner/name.git`. */
const browserRepoUrl = (s) => s.replace(/^(https?:\/\/)?(?:www\.)?(?=github\.com\/)/i, (_, scheme) => scheme || 'https://')
  .replace(/^(https?:\/\/github\.com\/[^/\s]+\/[^/\s]+)\/(?:tree|blob|commits?|pulls?|issues|actions|wiki)(?:\/\S*)?$/i, '$1')
  .replace(/^([^/\s:@]+\/[^/\s]+?)\.git$/i, '$1');

/** Check a typed team repository on GitHub and store it as GitHub spells it. */
export async function setTypedTeamRepo(key, projectDir, raw) {
  const kind = teamRepoState(projectDir).kind;
  if (kind === 'origin' || kind === 'git-no-origin') throw badRequest('this project already names its repository in .git/config');
  if (typeof raw !== 'string') throw badRequest('repo must be a string');
  const typed = raw.trim();
  const gh = githubRepoOf(browserRepoUrl(typed), { shorthand: true });
  if (!gh) {
    // Only another host needs git: a github.com URL that names no single repository is a typing mistake.
    const host = parseRemoteUrl(typed)?.host;
    if (host && !/^(?:www\.)?github\.com$/.test(host)) throw gitMissingError(typed);
    throw badRequest('repo must be owner/name or a github.com URL');
  }
  let info;
  try {
    // Checked with the credential the team branches are written with (a per-repository token may only be the write one).
    info = await createGithubClient({ owner: gh.owner, repo: gh.repo, role: 'write' }).json('GET', '');
  } catch (err) {
    // Named as parsed, never as pasted (a URL may carry a token).
    if (err?.code === 'GITHUB_NOT_FOUND') throw badRequest(`not found on GitHub: ${gh.owner}/${gh.repo}${err.anonymous ? ' (a private repository needs GH_TOKEN)' : ''}`);
    throw err;
  }
  const full = typeof info?.full_name === 'string' && info.full_name ? info.full_name : `${gh.owner}/${gh.repo}`;
  // A name the metrics slug changes would be read and written as another repository (projectSlugHttps): git only.
  const { metricsSlugFromUrl } = await import('../metrics/sync.mjs');   // lazy: metrics/sync.mjs imports this module
  if (metricsSlugFromUrl(`https://github.com/${full}`) !== full.toLowerCase()) throw gitMissingError();
  writeTeamRepo(key, full);
  return full;
}
