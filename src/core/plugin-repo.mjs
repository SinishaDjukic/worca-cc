// src/core/plugin-repo.mjs
// Git plumbing for the plugin store (spec §4.1, §4.3, §6.1-6.2): bare fetch
// cache, manifest discovery (a root worca-cc-marketplace.json when present, else
// tree depth 0/1), update candidate preview, and git-archive export of a pinned
// SHA. All git/tar via execFile — injectable as opts.exec for tests:
// async (cmd, args, opts?) => { stdout, stderr }.
// The cache lives at <pluginsRoot>/.cache/<slug>.git — NEVER on any execution
// path; exports contain no .git, so repo hooks are inert (spec §8).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, existsSync, renameSync, rmSync, unlinkSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pluginsRoot, pluginVersionDir, readPluginsLock } from './plugins-lock.mjs';
import { normalizeManifest, findEscapingSymlinks } from './plugin-manifest.mjs';
import { githubEnv } from './github-credentials.mjs';
import { withAzureToken, readAzureCredentials } from './azure-credentials.mjs';
import { withBitbucketToken, readBitbucketCredentials } from './bitbucket-credentials.mjs';
import { mcpUpdatePreview } from './mcp/plugin-lifecycle.mjs';
import { gitAvailable } from './git-available.mjs';
import { accessChanges } from '../shared/plugin-access.mjs';

// Without git a GitHub repository is read over HTTPS (P6). Lazy: plugin-store.mjs imports this module statically and
// git-free/plugin-repo.mjs imports both, so the git path never loads git-free/ (and no import cycle forms at load).
const httpsRepo = () => import('./git-free/plugin-repo.mjs');

const execFileP = promisify(execFile);

/** worca's own read credential for plugin repo git calls: GitHub (helper answers github.com) + Azure (dev.azure.com, *.visualstudio.com) + Bitbucket (bitbucket.org). */
export async function pluginGitEnv() {
  const { env } = await githubEnv('read');
  const bb = readBitbucketCredentials();
  return withBitbucketToken(withAzureToken(env, readAzureCredentials().read), bb.read, bb.kind || undefined);
}

const defaultExec = async (cmd, args, opts = {}) => {
  // The read credentials for this call (a fresh App token in App mode; the Azure helper when a PAT is set).
  const env = await pluginGitEnv();
  return execFileP(cmd, args, {
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
    killSignal: 'SIGKILL',
    env: { ...env, GIT_TERMINAL_PROMPT: '0', ...(cmd === 'git' ? { LC_ALL: 'C' } : {}) },   // git's errors in English: syncErrorOf reads them
    ...opts,
  });
};

/** Filesystem slug for a repo URL — shared by the bare-cache dir and marketplace
 *  ids. Injective: a readable prefix plus an 8-hex digest of the EXACT input, so
 *  distinct urls (http vs https, /a/b vs /a-b, unicode, .git.git) never collide
 *  onto one id/cache dir. */
export function repoSlug(repoUrl) {
  const s = String(repoUrl);
  const readable = s
    .replace(/^[a-z+]+:\/\//i, '').replace(/\.git$/i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|(?<!-)-+$/g, '')   // the lookbehind keeps a long run of dashes linear
    .slice(0, 80) || 'repo';
  return `${readable}-${createHash('sha1').update(s).digest('hex').slice(0, 8)}`;
}

/** Bare-cache path for a repo URL: <pluginsRoot>/.cache/<slug>.git. */
export function repoCacheDir(repoUrl) {
  return join(pluginsRoot(), '.cache', `${repoSlug(repoUrl)}.git`);
}

/** Snapshot root for a repo URL read without git (P6): <pluginsRoot>/.cache/<slug>.tree/<sha>. */
export function repoSnapshotRoot(repoUrl) {
  return join(pluginsRoot(), '.cache', `${repoSlug(repoUrl)}.tree`);
}

/** Remove a repo URL's snapshots (P6). The root is renamed aside first: a removal cut short (a killed process, a file in
 *  use) leaves `<root>.trash-<hex>`, which nothing reads — never a half-removed `<sha>` folder beside its meta file.
 *  Best effort: a root that cannot be renamed (EPERM, EBUSY) stays whole, and the uninstall or removal that asked,
 *  past its lock or registry write, never fails on it. */
export function removeSnapshotRoot(repoUrl) {
  const root = repoSnapshotRoot(repoUrl);
  const trash = `${root}.trash-${randomBytes(4).toString('hex')}`;
  try { renameSync(root, trash); } catch { return; }
  try { rmSync(trash, { recursive: true, force: true }); } catch { /* left aside: nothing reads it */ }
}

/** Validate a raw worca-cc-marketplace.json (spec §4.1). Paths are repo-relative
 *  dirs, any depth: no absolute, no '..'/'.' segments, no backslashes, no empties. */
export function parseMarketplaceManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['not a JSON object'] };
  }
  const structural = []; // whole-file problems -> ok:false (caller falls back to the scan)
  if (typeof raw.name !== 'string' || !raw.name.trim()) structural.push('"name" is required');
  if (!Array.isArray(raw.plugins)) structural.push('"plugins" must be an array of repo-relative dirs');
  if (structural.length) return { ok: false, errors: structural };
  const warnings = []; // per-entry problems -> skipped entries, manifest still authoritative
  const plugins = [];
  for (const d of raw.plugins) {
    // Segment charset is deliberately strict: it blocks '..'/absolute paths AND
    // any segment beginning with '-', which would otherwise be parsed as a git
    // option when the subdir is passed as a positional to `git archive`/`ls-tree`
    // (see the `--` pathspec guards in fetchCandidate/exportVersion). '=' is
    // outside the class, so `--output=/x` is rejected on both counts.
    if (typeof d !== 'string' || !d.trim() || d.includes('\\') || d.startsWith('/')
        || d.split('/').some((seg) =>
          !/^[A-Za-z0-9._-]+$/.test(seg) || seg === '.' || seg === '..' || seg.startsWith('-'))) {
      warnings.push(`invalid plugin path ${JSON.stringify(d)} — skipped`);
      continue;
    }
    plugins.push(d.replace(/\/+$/, ''));
  }
  return {
    ok: true,
    name: raw.name.trim(),
    description: typeof raw.description === 'string' ? raw.description.trim() : '',
    plugins,
    warnings,
  };
}

async function gitDir(cache, args, exec) {
  const { stdout } = await exec('git', ['--git-dir', cache, ...args]);
  return stdout;
}

/** Clone the bare cache if absent, else fetch all heads (explicit refspec —
 *  clone --bare configures no fetch refspec). */
async function ensureCache(repoUrl, exec) {
  const cache = repoCacheDir(repoUrl);
  if (!existsSync(cache)) {
    mkdirSync(dirname(cache), { recursive: true });
    await exec('git', ['clone', '--quiet', '--bare', repoUrl, cache]);
  } else {
    await gitDir(cache, ['fetch', '--quiet', 'origin', '+refs/heads/*:refs/heads/*', '--prune'], exec);
  }
  return cache;
}

/** The commit a repo is followed at: its HEAD (the remote's default branch), or the tip of
 *  branch `ref` (a marketplace that tracks one, spec §4.2; recorded in the lock for updates). */
async function tipSha(cache, ref, exec) {
  if (!ref) return (await gitDir(cache, ['rev-parse', 'HEAD'], exec)).trim();
  const bad = () => new Error(`branch "${ref}" not found`);
  if (!/^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref)) throw bad();
  try { return (await gitDir(cache, ['rev-parse', '--verify', '--quiet', `refs/heads/${ref}^{commit}`], exec)).trim(); } catch { throw bad(); }
}

/**
 * Discovery at one commit of any git dir — worca's bare cache (addPluginRepo) or a checkout's
 * real git dir (marketplace-publish.mjs checks the commit it is about to push, #717). The rules a
 * marketplace sync applies, unchanged: a root worca-cc-marketplace.json, when present and
 * structurally valid, is AUTHORITATIVE; else the depth 0-1 scan; committed files only; the
 * engines gate (normalizeManifest); first name wins.
 * @returns {Promise<{sha:string, discovered:Array<{name,subdir,manifest}>, warnings:string[],
 *   marketplace:{name:string, description:string}|null}>}
 */
export async function discoverAtCommit(gitDirPath, sha, { exec = defaultExec } = {}) {
  const allPaths = (await gitDir(gitDirPath, ['ls-tree', '-r', '--name-only', sha], exec))
    .split('\n').map((s) => s.trim()).filter(Boolean);
  return { sha, ...(await discoverPlugins(allPaths, (p) => gitDir(gitDirPath, ['show', `${sha}:${p}`], exec))) };
}

/**
 * Discovery over a commit's file list (spec §4.1, §4.3): `allPaths` = every file path of the commit, `readText(path)`
 * = that file's text (git's `show`; a snapshot read without git, P6). Pure apart from readText.
 * @returns {Promise<{discovered:Array<{name,subdir,manifest}>, warnings:string[], marketplace:{name:string, description:string}|null}>}
 */
export async function discoverPlugins(allPaths, readText) {
  const warnings = [];
  let marketplace = null;
  let manifestPaths = null; // null -> fall back to the depth 0-1 scan
  if (allPaths.includes('worca-cc-marketplace.json')) {
    let mp = null;
    try {
      mp = parseMarketplaceManifest(JSON.parse(await readText('worca-cc-marketplace.json')));
    } catch {
      mp = { ok: false, errors: ['invalid JSON'] };
    }
    if (mp.ok) {
      marketplace = { name: mp.name, description: mp.description };
      warnings.push(...(mp.warnings || []).map((w) => `worca-cc-marketplace.json: ${w}`));
      manifestPaths = [];
      for (const dir of mp.plugins) {
        const p = `${dir}/worca-cc-plugin.json`;
        if (!allPaths.includes(p)) {
          warnings.push(`worca-cc-marketplace.json: ${dir}/worca-cc-plugin.json not found in repo — skipped`);
          continue;
        }
        manifestPaths.push(p);
      }
    } else {
      warnings.push(`worca-cc-marketplace.json: ${mp.errors.join('; ')} — falling back to depth 0-1 scan`);
    }
  }
  if (manifestPaths === null) {
    manifestPaths = allPaths
      .filter((p) => p === 'worca-cc-plugin.json' || /^[^/]+\/worca-cc-plugin\.json$/.test(p));
  }
  const discovered = [];
  const seenNames = new Set();
  for (const p of manifestPaths) {
    const subdir = p === 'worca-cc-plugin.json' ? '' : p.slice(0, -'/worca-cc-plugin.json'.length);
    let raw;
    try {
      raw = JSON.parse(await readText(p));
    } catch {
      warnings.push(`${p}: invalid JSON — skipped`);
      continue;
    }
    const res = normalizeManifest(raw, { dir: subdir || '.' });
    if (!res.ok) { warnings.push(...res.errors); continue; }
    // Degraded-but-usable manifests (e.g. a reserved model-env key stripped)
    // stay discoverable; the notice still reaches the marketplace panel.
    warnings.push(...res.warnings);
    if (seenNames.has(res.manifest.name)) {
      warnings.push(`${p}: duplicate plugin name "${res.manifest.name}" — first entry wins, skipped`);
      continue;
    }
    seenNames.add(res.manifest.name);
    discovered.push({ name: res.manifest.name, subdir, manifest: res.manifest, warnings: res.warnings });
  }
  return { discovered, warnings, marketplace };
}

/**
 * `worca plugin add`: clone/refresh the bare cache, then discover plugins in the
 * HEAD tree (or branch `ref`'s) — see discoverAtCommit for the rules. Without git (P6) the
 * repo is read over HTTPS instead (git-free/plugin-repo.mjs).
 * @returns {{repoUrl:string, sha:string, discovered:Array<{name,subdir,manifest}>,
 *   warnings:string[], marketplace:{name:string, description:string}|null}}
 */
export async function addPluginRepo(repoUrl, { exec = defaultExec, ref = null, onProgress = null } = {}) {
  // `owner/repo` shorthand -> GitHub URL (spec §4.3) — only when it is not a
  // real local path (local fixture repos in tests stay untouched).
  if (/^[\w.-]+\/[\w.-]+$/.test(repoUrl) && !existsSync(repoUrl)) {
    repoUrl = `https://github.com/${repoUrl}`;
  }
  if (!gitAvailable()) return (await httpsRepo()).addPluginRepoHttps(repoUrl, { ref, onProgress });
  const cache = await ensureCache(repoUrl, exec);
  const sha = await tipSha(cache, ref, exec);
  onProgress?.({ phase: 'reading', sha });
  return { repoUrl, ...(await discoverAtCommit(cache, sha, { exec })) };
}

/** `<sourceId>.<key>` for every secret configSchema field of a manifest. */
function manifestSecretKeys(manifest) {
  return (manifest?.taskSources || []).flatMap((s) =>
    (s.configSchema || []).filter((f) => f && f.secret === true).map((f) => `${s.id}.${f.key}`));
}

/** `<channelId>.<key>` for every secret configSchema field of a manifest's chat channels. */
function manifestChannelSecretKeys(manifest) {
  return (manifest?.chatChannels || []).flatMap((c) =>
    (c.configSchema || []).filter((f) => f && f.secret === true).map((f) => `${c.id}.${f.key}`));
}

/** Normalized models/modelSecrets view of a RAW manifest ({} on any failure —
 *  a manifest invalid to THIS host contributes no models here either). */
function manifestModels(raw) {
  if (!raw) return { models: [], modelSecrets: [] };
  const r = normalizeManifest(raw);
  return r.ok ? { models: r.manifest.models, modelSecrets: r.manifest.modelSecrets } : { models: [], modelSecrets: [] };
}

/** Honoured MCP servers of a RAW manifest under its own negotiated API ({} on
 *  any failure, and below API 5 — normalizeManifest strips the block). */
export function manifestMcp(raw) {
  const r = raw ? normalizeManifest(raw) : null;
  return r && r.ok ? r.manifest.mcpServers : {};
}

/**
 * A plugin's `skills/` at `sha` (its `subdir` in the repo), exported into `<scratch>/<side>` the way exportVersion
 * exports a version (git archive → tar; an escaping symlink is dropped). When a link sits under `skills/` (or `skills`
 * is one), the whole plugin is exported instead: such a link may reach the rest of the plugin, which the catalog
 * follows, so the preview must read the same tree. `<scratch>/<side>` stays empty when that commit ships no `skills/`.
 * Read-only: the update preview compares the pinned and the candidate skills (skills registry spec §5); nothing runs.
 */
async function exportSkillsAt(cache, sha, subdir, scratch, side, exec) {
  const dest = join(scratch, side);
  mkdirSync(dest, { recursive: true });
  // `skills` in any case: a case-insensitive file system (macOS, Windows) reads `Skills/` as `skills/`, and so does the
  // catalog — git's pathspec does not, so the plugin root's entries are listed and matched by name.
  const top = (await gitDir(cache, ['ls-tree', '-z', '--name-only', sha, ...(subdir ? ['--', `${subdir}/`] : [])], exec)).split('\0');
  const scopes = top.filter((p) => p && p.slice(p.lastIndexOf('/') + 1).toLowerCase() === 'skills');
  if (!scopes.length) return dest;
  const listed = (await gitDir(cache, ['ls-tree', '-r', sha, '--', ...scopes], exec)).trim();
  if (!listed) return dest;
  const linked = listed.split('\n').some((l) => l.startsWith('120000 '));
  const paths = linked ? (subdir ? [subdir] : []) : scopes;
  const tar = join(scratch, `${side}.tar`);
  await gitDir(cache, ['-c', 'core.autocrlf=false', 'archive', '--format=tar', '-o', tar, sha, ...(paths.length ? ['--', ...paths] : [])], exec);
  const strip = subdir ? ['--strip-components', String(subdir.split('/').length)] : [];
  // exportVersion's Windows tar rule: a relative archive name (cwd) and a forward-slashed -C.
  await exec('tar', ['-xf', `${side}.tar`, '-C', dest.replace(/\\/g, '/'), ...strip], { cwd: scratch });
  rmSync(tar, { force: true });
  for (const rel of findEscapingSymlinks(dest)) unlinkSync(join(dest, rel));
  return dest;
}

async function showManifest(cache, sha, subdir, exec) {
  const p = subdir ? `${subdir}/worca-cc-plugin.json` : 'worca-cc-plugin.json';
  try { return JSON.parse(await gitDir(cache, ['show', `${sha}:${p}`], exec)); } catch { return null; }
}

/**
 * Update-review manifest delta (spec §6.2): newly requested secrets, new task
 * sources, new agents (added agents/<key>.meta.json files), setup changes —
 * the red-highlight inputs that turn a malicious update into a human review event.
 */
async function computeManifestDelta(name, cache, entry, pinnedSha, candidateSha, exec) {
  const pin = await showManifest(cache, pinnedSha, entry.subdir, exec);
  const cand = await showManifest(cache, candidateSha, entry.subdir, exec);
  // A malformed manifest throws here, before any further git command, as the derivations did inline.
  assembleManifestDelta({ pin, cand, newAgents: [], lifecycle: {} });
  const scope = entry.subdir ? `${entry.subdir}/agents` : 'agents';
  let newAgents = [];
  try {
    const status = await gitDir(cache, ['diff', '--name-status', pinnedSha, candidateSha, '--', scope], exec);
    newAgents = status.split('\n')
      .filter((l) => l.startsWith('A') && l.endsWith('.meta.json'))
      .map((l) => l.split('\t').pop().split('/').pop().replace(/\.meta\.json$/, ''));
  } catch { newAgents = []; }
  // Skills (skills registry §5): both sides' skills/ exported to a scratch dir, compared, then removed.
  const scratch = await mkdtemp(join(tmpdir(), 'worca-cc-skills-'));
  let lifecycle;
  try {
    const pinDir = await exportSkillsAt(cache, pinnedSha, entry.subdir, scratch, 'pin', exec);
    const candDir = await exportSkillsAt(cache, candidateSha, entry.subdir, scratch, 'cand', exec);
    lifecycle = await mcpUpdatePreview(name, manifestMcp(pin), manifestMcp(cand), { pinDir, candDir });
  } finally {
    // A path past PATH_MAX (a deep tree a candidate may ship) defeats fs.rm (ENAMETOOLONG); `rm -rf` walks it by
    // directory handle. A cleanup failure never hides the preview, or the error that ended it.
    await rm(scratch, { recursive: true, force: true })
      .catch(() => (process.platform === 'win32' ? null : exec('rm', ['-rf', scratch])))
      .catch(() => {});
  }
  return { manifestDelta: assembleManifestDelta({ pin, cand, newAgents, lifecycle }), version: manifestVersion(cand) };
}

/** The update-review manifest delta from both sides' RAW manifests, the added agents and the MCP/skills preview
 *  (pure; shared with the HTTPS preview, P6). */
export function assembleManifestDelta({ pin, cand, newAgents, lifecycle }) {
  const pinSecrets = manifestSecretKeys(pin);
  const candSecrets = manifestSecretKeys(cand);
  const pinIds = (pin?.taskSources || []).map((s) => s.id);
  const candIds = (cand?.taskSources || []).map((s) => s.id);
  const pinCh = (pin?.chatChannels || []).map((c) => c.id);
  const candCh = (cand?.chatChannels || []).map((c) => c.id);
  const pinChSecrets = manifestChannelSecretKeys(pin);
  const candChSecrets = manifestChannelSecretKeys(cand);
  // Model delta (design §9.4): env changes — a base-URL swap redirects ALL API
  // traffic for that model — are the red-highlight review inputs.
  const pinM = manifestModels(pin);
  const candM = manifestModels(cand);
  const byLc = (list) => new Map(list.map((m) => [m.id.toLowerCase(), m]));
  const pinModels = byLc(pinM.models);
  const candModels = byLc(candM.models);
  const envOf = (m) => JSON.stringify(m.env ?? {});
  return {
    newSecrets: candSecrets.filter((k) => !pinSecrets.includes(k)),
    newTaskSources: candIds.filter((id) => !pinIds.includes(id)),
    newChatChannels: candCh.filter((id) => !pinCh.includes(id)),
    newChannelSecrets: candChSecrets.filter((k) => !pinChSecrets.includes(k)),
    newAgents,
    setupChanged: JSON.stringify(pin?.setup ?? null) !== JSON.stringify(cand?.setup ?? null),
    newModels: [...candModels.values()].filter((m) => !pinModels.has(m.id.toLowerCase())).map((m) => m.id),
    removedModels: [...pinModels.values()].filter((m) => !candModels.has(m.id.toLowerCase())).map((m) => m.id),
    envChangedModels: [...candModels.values()]
      .filter((m) => pinModels.has(m.id.toLowerCase()) && envOf(pinModels.get(m.id.toLowerCase())) !== envOf(m))
      .map((m) => m.id),
    newModelSecrets: candM.modelSecrets.map((f) => f.key)
      .filter((k) => !pinM.modelSecrets.some((f) => f.key === k)),
    // MCP servers (registry §4.6) and skills (skills registry §5): new/removed/changed names + the red lines.
    ...lifecycle,
  };
}

/** The manifest delta of a candidate equal to the pin: every key, nothing new (shared with the HTTPS preview). */
export function emptyManifestDelta() {
  return {
    newSecrets: [], newTaskSources: [], newChatChannels: [], newChannelSecrets: [], newAgents: [], setupChanged: false,
    newModels: [], removedModels: [], envChangedModels: [], newModelSecrets: [],
    newMcpServers: [], removedMcpServers: [], changedMcpServers: [], mcpLines: [],
    newSkills: [], removedSkills: [], changedSkills: [], skillLines: [],
  };
}

/** A RAW manifest's version as normalizeManifest reads it (trimmed, non-empty), else null — also for no manifest. */
export function manifestVersion(raw) {
  return typeof raw?.version === 'string' && raw.version.trim() ? raw.version.trim() : null;
}

/** The update preview both paths return (CONTRACT §1.4): the versions, when it was read and the new access ride at the
 *  top level, beside the manifest delta they are read from (an equal candidate keeps the installed version). */
export function finishPreview({ entry, pinnedSha, candidateSha, candidateVersion, commits, diffstat, diffFull, manifestDelta }) {
  return {
    pinnedSha, candidateSha,
    pinnedVersion: entry.version ?? null,
    candidateVersion: candidateSha === pinnedSha ? entry.version ?? null : candidateVersion,
    previewedAt: new Date().toISOString(),
    commits, diffstat, diffFull, manifestDelta,
    access: accessChanges(manifestDelta),
  };
}

/**
 * Update preview (spec §6.2): fetch, then report commits + diffstat + the
 * manifest delta between the pinned SHA and the new HEAD (the lock's `ref` branch tip when set); { fullDiff: true }
 * additionally returns the complete diff text ("full diff on demand").
 * Read-only; performing the update is Task 5's updatePlugin.
 */
export async function fetchCandidate(name, { exec = defaultExec, fullDiff = false } = {}) {
  const entry = readPluginsLock()[name];
  if (!entry || !entry.repo) throw new Error(`plugin "${name}" is not installed from a repo`);
  if (!gitAvailable()) return (await httpsRepo()).fetchCandidateHttps(name, { fullDiff });
  const cache = await ensureCache(entry.repo, exec);
  const candidateSha = await tipSha(cache, entry.ref, exec);
  const pinnedSha = entry.pinnedSha;
  let commits = [];
  let diffstat = '';
  let diffFull = '';
  let manifestDelta = emptyManifestDelta();
  let candidateVersion = null;
  if (candidateSha !== pinnedSha) {
    // The plugin folder's commits only (a root plugin: the whole repository), as the diffstat below is scoped.
    const scope = entry.subdir ? ['--', entry.subdir] : [];
    const log = await gitDir(cache, ['log', '--format=%H%x09%s', `${pinnedSha}..${candidateSha}`, ...scope], exec);
    commits = log.split('\n').filter(Boolean).map((l) => {
      const i = l.indexOf('\t');
      return { sha: l.slice(0, i), subject: l.slice(i + 1) };
    });
    diffstat = (await gitDir(cache, ['diff', '--stat', pinnedSha, candidateSha, ...scope], exec)).trim();
    if (fullDiff) diffFull = (await gitDir(cache, ['diff', pinnedSha, candidateSha, ...scope], exec)).trim();
    ({ manifestDelta, version: candidateVersion } = await computeManifestDelta(name, cache, entry, pinnedSha, candidateSha, exec));
  }
  return finishPreview({ entry, pinnedSha, candidateSha, candidateVersion, commits, diffstat, diffFull, manifestDelta });
}

/**
 * Export a pinned SHA to `${pluginDir(name)}/versions/<sha7>` via git archive ->
 * tar extraction (no .git inside, spec §6.1). Symlinks escaping the export dir
 * are DELETED post-extraction (git archive preserves symlinks) and reported.
 * opts.repoUrl/opts.subdir override the lock entry — required on FIRST install,
 * when no lock entry exists yet (Task 5 passes them explicitly).
 * @returns {Promise<{versionDir:string, warnings:string[]}>}
 */
export async function exportVersion(name, sha, { exec = defaultExec, repoUrl, subdir } = {}) {
  const entry = readPluginsLock()[name] || {};
  const repo = repoUrl ?? entry.repo;
  const sub = subdir ?? entry.subdir ?? '';
  if (!repo) throw new Error(`plugin "${name}": no repo known (pass { repoUrl } on first install)`);
  const versionDir = pluginVersionDir(name, sha); // refuses a pin that would leave versions/, before any read or write
  if (!gitAvailable()) return (await httpsRepo()).exportVersionHttps(name, sha, { repoUrl: repo, subdir: sub });
  const cache = existsSync(repoCacheDir(repo)) ? repoCacheDir(repo) : await ensureCache(repo, exec);
  rmSync(versionDir, { recursive: true, force: true }); // re-export = fresh dir
  mkdirSync(versionDir, { recursive: true });
  const scratch = await mkdtemp(join(tmpdir(), 'worca-cc-export-'));
  const tarFile = join(scratch, 'export.tar');
  try {
    await gitDir(cache, ['-c', 'core.autocrlf=false', 'archive', '--format=tar', '-o', tarFile, ...(sub ? [sha, '--', sub] : [sha])], exec);
    const strip = sub ? ['--strip-components', String(sub.split('/').length)] : [];
    // Windows GNU tar (shipped by Git for Windows) mishandles native paths two
    // ways: a colon in the `-f` value is read as a `host:path` remote spec ("cannot
    // connect to C:"), and backslash separators are not understood at all. So pass
    // the archive as a RELATIVE name resolved against cwd, and give `-C` a
    // forward-slashed path. On POSIX the replace is a no-op.
    await exec('tar', ['-xf', 'export.tar', '-C', versionDir.replace(/\\/g, '/'), ...strip],
      { cwd: scratch });
  } catch (err) {
    rmSync(versionDir, { recursive: true, force: true });
    throw err;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  const warnings = [];
  for (const rel of findEscapingSymlinks(versionDir)) {
    // unlink, not rmSync: rmSync stats THROUGH the link, so a link to a
    // directory throws ERR_FS_EISDIR and a dangling one (the common escaping
    // case) reads as "already gone" and survives force:true (Node 23).
    unlinkSync(join(versionDir, rel));
    warnings.push(`removed symlink escaping the export dir: ${rel}`);
  }
  return { versionDir, warnings };
}
