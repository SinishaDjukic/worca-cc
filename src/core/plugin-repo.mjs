// src/core/plugin-repo.mjs
// Git plumbing for the plugin store (spec §4.3, §6.1-6.2): bare fetch cache,
// manifest discovery at tree depth 0/1, update candidate preview, and
// git-archive export of a pinned SHA. All git/tar via execFile — injectable as
// opts.exec for tests: async (cmd, args, opts?) => { stdout, stderr }.
// The cache lives at <pluginsRoot>/.cache/<slug>.git — NEVER on any execution
// path; exports contain no .git, so repo hooks are inert (spec §8).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pluginsRoot, pluginDir, readPluginsLock } from './plugins-lock.mjs';
import { normalizeManifest, findEscapingSymlinks } from './plugin-manifest.mjs';

const execFileP = promisify(execFile);
const defaultExec = (cmd, args, opts = {}) =>
  execFileP(cmd, args, { maxBuffer: 16 * 1024 * 1024, ...opts });

/** Bare-cache path for a repo URL: <pluginsRoot>/.cache/<slug>.git. */
export function repoCacheDir(repoUrl) {
  const slug = String(repoUrl)
    .replace(/^[a-z+]+:\/\//i, '')
    .replace(/\.git$/i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'repo';
  return join(pluginsRoot(), '.cache', `${slug}.git`);
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

/**
 * `worca plugin add`: clone/refresh the bare cache, then scan the HEAD tree
 * for worca-cc-plugin.json at depth 0 and 1 (spec §4.3).
 * @returns {{repoUrl:string, sha:string, discovered:Array<{name,subdir,manifest}>, warnings:string[]}}
 */
export async function addPluginRepo(repoUrl, { exec = defaultExec } = {}) {
  // `owner/repo` shorthand -> GitHub URL (spec §4.3) — only when it is not a
  // real local path (local fixture repos in tests stay untouched).
  if (/^[\w.-]+\/[\w.-]+$/.test(repoUrl) && !existsSync(repoUrl)) {
    repoUrl = `https://github.com/${repoUrl}`;
  }
  const cache = await ensureCache(repoUrl, exec);
  const sha = (await gitDir(cache, ['rev-parse', 'HEAD'], exec)).trim();
  const paths = (await gitDir(cache, ['ls-tree', '-r', '--name-only', sha], exec))
    .split('\n').map((s) => s.trim()).filter(Boolean)
    .filter((p) => p === 'worca-cc-plugin.json' || /^[^/]+\/worca-cc-plugin\.json$/.test(p));
  const discovered = [];
  const warnings = [];
  for (const p of paths) {
    const subdir = p === 'worca-cc-plugin.json' ? '' : p.slice(0, -'/worca-cc-plugin.json'.length);
    let raw;
    try {
      raw = JSON.parse(await gitDir(cache, ['show', `${sha}:${p}`], exec));
    } catch {
      warnings.push(`${p}: invalid JSON — skipped`);
      continue;
    }
    const res = normalizeManifest(raw, { dir: subdir || '.' });
    if (!res.ok) { warnings.push(...res.errors); continue; }
    discovered.push({ name: res.manifest.name, subdir, manifest: res.manifest });
  }
  return { repoUrl, sha, discovered, warnings };
}

/** `<sourceId>.<key>` for every secret configSchema field of a manifest. */
function manifestSecretKeys(manifest) {
  return (manifest?.taskSources || []).flatMap((s) =>
    (s.configSchema || []).filter((f) => f && f.secret === true).map((f) => `${s.id}.${f.key}`));
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
async function computeManifestDelta(cache, entry, pinnedSha, candidateSha, exec) {
  const pin = await showManifest(cache, pinnedSha, entry.subdir, exec);
  const cand = await showManifest(cache, candidateSha, entry.subdir, exec);
  const pinSecrets = manifestSecretKeys(pin);
  const candSecrets = manifestSecretKeys(cand);
  const pinIds = (pin?.taskSources || []).map((s) => s.id);
  const candIds = (cand?.taskSources || []).map((s) => s.id);
  const scope = entry.subdir ? `${entry.subdir}/agents` : 'agents';
  let newAgents = [];
  try {
    const status = await gitDir(cache, ['diff', '--name-status', pinnedSha, candidateSha, '--', scope], exec);
    newAgents = status.split('\n')
      .filter((l) => l.startsWith('A') && l.endsWith('.meta.json'))
      .map((l) => l.split('\t').pop().split('/').pop().replace(/\.meta\.json$/, ''));
  } catch { newAgents = []; }
  return {
    newSecrets: candSecrets.filter((k) => !pinSecrets.includes(k)),
    newTaskSources: candIds.filter((id) => !pinIds.includes(id)),
    newAgents,
    setupChanged: JSON.stringify(pin?.setup ?? null) !== JSON.stringify(cand?.setup ?? null),
  };
}

/**
 * Update preview (spec §6.2): fetch, then report commits + diffstat + the
 * manifest delta between the pinned SHA and the new HEAD; { fullDiff: true }
 * additionally returns the complete diff text ("full diff on demand").
 * Read-only; performing the update is Task 5's updatePlugin.
 */
export async function fetchCandidate(name, { exec = defaultExec, fullDiff = false } = {}) {
  const entry = readPluginsLock()[name];
  if (!entry || !entry.repo) throw new Error(`plugin "${name}" is not installed from a repo`);
  const cache = await ensureCache(entry.repo, exec);
  const candidateSha = (await gitDir(cache, ['rev-parse', 'HEAD'], exec)).trim();
  const pinnedSha = entry.pinnedSha;
  let commits = [];
  let diffstat = '';
  let diffFull = '';
  let manifestDelta = { newSecrets: [], newTaskSources: [], newAgents: [], setupChanged: false };
  if (candidateSha !== pinnedSha) {
    const log = await gitDir(cache, ['log', '--format=%H%x09%s', `${pinnedSha}..${candidateSha}`], exec);
    commits = log.split('\n').filter(Boolean).map((l) => {
      const i = l.indexOf('\t');
      return { sha: l.slice(0, i), subject: l.slice(i + 1) };
    });
    const scope = entry.subdir ? ['--', entry.subdir] : [];
    diffstat = (await gitDir(cache, ['diff', '--stat', pinnedSha, candidateSha, ...scope], exec)).trim();
    if (fullDiff) diffFull = (await gitDir(cache, ['diff', pinnedSha, candidateSha, ...scope], exec)).trim();
    manifestDelta = await computeManifestDelta(cache, entry, pinnedSha, candidateSha, exec);
  }
  return { pinnedSha, candidateSha, commits, diffstat, diffFull, manifestDelta };
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
  const cache = existsSync(repoCacheDir(repo)) ? repoCacheDir(repo) : await ensureCache(repo, exec);
  const versionDir = join(pluginDir(name), 'versions', sha.slice(0, 7));
  rmSync(versionDir, { recursive: true, force: true }); // re-export = fresh dir
  mkdirSync(versionDir, { recursive: true });
  const scratch = await mkdtemp(join(tmpdir(), 'worca-cc-export-'));
  const tarFile = join(scratch, 'export.tar');
  try {
    await gitDir(cache, ['archive', '--format=tar', '-o', tarFile, ...(sub ? [sha, sub] : [sha])], exec);
    const strip = sub ? ['--strip-components', String(sub.split('/').length)] : [];
    await exec('tar', ['-xf', tarFile, '-C', versionDir, ...strip]);
  } catch (err) {
    rmSync(versionDir, { recursive: true, force: true });
    throw err;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  const warnings = [];
  for (const rel of findEscapingSymlinks(versionDir)) {
    rmSync(join(versionDir, rel), { force: true });
    warnings.push(`removed symlink escaping the export dir: ${rel}`);
  }
  return { versionDir, warnings };
}
