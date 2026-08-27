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
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, rmSync, unlinkSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pluginsRoot, pluginDir, readPluginsLock } from './plugins-lock.mjs';
import { normalizeManifest, findEscapingSymlinks } from './plugin-manifest.mjs';

const execFileP = promisify(execFile);
const defaultExec = (cmd, args, opts = {}) =>
  execFileP(cmd, args, {
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
    killSignal: 'SIGKILL',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    ...opts,
  });

/** Filesystem slug for a repo URL — shared by the bare-cache dir and marketplace
 *  ids. Injective: a readable prefix plus an 8-hex digest of the EXACT input, so
 *  distinct urls (http vs https, /a/b vs /a-b, unicode, .git.git) never collide
 *  onto one id/cache dir. */
export function repoSlug(repoUrl) {
  const s = String(repoUrl);
  const readable = s
    .replace(/^[a-z+]+:\/\//i, '').replace(/\.git$/i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'repo';
  return `${readable}-${createHash('sha1').update(s).digest('hex').slice(0, 8)}`;
}

/** Bare-cache path for a repo URL: <pluginsRoot>/.cache/<slug>.git. */
export function repoCacheDir(repoUrl) {
  return join(pluginsRoot(), '.cache', `${repoSlug(repoUrl)}.git`);
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

/**
 * `worca plugin add`: clone/refresh the bare cache, then discover plugins in the
 * HEAD tree. A root worca-cc-marketplace.json (spec §4.1), when present and
 * structurally valid, is AUTHORITATIVE — its listed dirs (any depth) are the only
 * candidates, even when the list is empty. Without one, the depth 0/1 scan of
 * spec §4.3 applies unchanged.
 * @returns {{repoUrl:string, sha:string, discovered:Array<{name,subdir,manifest}>,
 *   warnings:string[], marketplace:{name:string, description:string}|null}}
 */
export async function addPluginRepo(repoUrl, { exec = defaultExec } = {}) {
  // `owner/repo` shorthand -> GitHub URL (spec §4.3) — only when it is not a
  // real local path (local fixture repos in tests stay untouched).
  if (/^[\w.-]+\/[\w.-]+$/.test(repoUrl) && !existsSync(repoUrl)) {
    repoUrl = `https://github.com/${repoUrl}`;
  }
  const cache = await ensureCache(repoUrl, exec);
  const sha = (await gitDir(cache, ['rev-parse', 'HEAD'], exec)).trim();
  const allPaths = (await gitDir(cache, ['ls-tree', '-r', '--name-only', sha], exec))
    .split('\n').map((s) => s.trim()).filter(Boolean);
  const warnings = [];
  let marketplace = null;
  let manifestPaths = null; // null -> fall back to the depth 0-1 scan
  if (allPaths.includes('worca-cc-marketplace.json')) {
    let mp = null;
    try {
      mp = parseMarketplaceManifest(JSON.parse(await gitDir(cache, ['show', `${sha}:worca-cc-marketplace.json`], exec)));
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
      raw = JSON.parse(await gitDir(cache, ['show', `${sha}:${p}`], exec));
    } catch {
      warnings.push(`${p}: invalid JSON — skipped`);
      continue;
    }
    const res = normalizeManifest(raw, { dir: subdir || '.' });
    if (!res.ok) { warnings.push(...res.errors); continue; }
    if (seenNames.has(res.manifest.name)) {
      warnings.push(`${p}: duplicate plugin name "${res.manifest.name}" — first entry wins, skipped`);
      continue;
    }
    seenNames.add(res.manifest.name);
    discovered.push({ name: res.manifest.name, subdir, manifest: res.manifest });
  }
  return { repoUrl, sha, discovered, warnings, marketplace };
}

/** `<sourceId>.<key>` for every secret configSchema field of a manifest. */
function manifestSecretKeys(manifest) {
  return (manifest?.taskSources || []).flatMap((s) =>
    (s.configSchema || []).filter((f) => f && f.secret === true).map((f) => `${s.id}.${f.key}`));
}

/** Normalized models/modelSecrets view of a RAW manifest ({} on any failure —
 *  a manifest invalid to THIS host contributes no models here either). */
function manifestModels(raw) {
  if (!raw) return { models: [], modelSecrets: [] };
  const r = normalizeManifest(raw);
  return r.ok ? { models: r.manifest.models, modelSecrets: r.manifest.modelSecrets } : { models: [], modelSecrets: [] };
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
    newAgents,
    setupChanged: JSON.stringify(pin?.setup ?? null) !== JSON.stringify(cand?.setup ?? null),
    newModels: [...candModels.values()].filter((m) => !pinModels.has(m.id.toLowerCase())).map((m) => m.id),
    removedModels: [...pinModels.values()].filter((m) => !candModels.has(m.id.toLowerCase())).map((m) => m.id),
    envChangedModels: [...candModels.values()]
      .filter((m) => pinModels.has(m.id.toLowerCase()) && envOf(pinModels.get(m.id.toLowerCase())) !== envOf(m))
      .map((m) => m.id),
    newModelSecrets: candM.modelSecrets.map((f) => f.key)
      .filter((k) => !pinM.modelSecrets.some((f) => f.key === k)),
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
  let manifestDelta = {
    newSecrets: [], newTaskSources: [], newAgents: [], setupChanged: false,
    newModels: [], removedModels: [], envChangedModels: [], newModelSecrets: [],
  };
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
