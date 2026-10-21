// src/core/marketplaces.mjs
// Persisted plugin-marketplace registry (marketplace spec §4.2): a git repo
// (URL, owner/repo, or local path) registered as a discovery source, with a
// cached discovery snapshot so the Plugins view renders with zero network.
// File conventions mirror plugins-lock.mjs: reads never throw, writes are
// temp+rename atomic, unknown keys survive read-modify-write.
// Installed plugins do NOT depend on this registry — the lock's own
// repo/subdir/pinnedSha provenance keeps update/uninstall working after a
// marketplace is removed (spec §4.5).

import {
  existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, rmSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pluginsRoot, readPluginsLock } from './plugins-lock.mjs';
import { addPluginRepo, repoCacheDir, repoSlug, removeSnapshotRoot } from './plugin-repo.mjs';
import { inventoryFromCache } from './plugin-inventory.mjs';
import { gitAvailable, gitMissingError } from './git-available.mjs';
import { githubRepoOf } from './git-free/github.mjs';

export function marketplacesFile() { return join(pluginsRoot(), 'marketplaces.json'); }

/** Without git only a GitHub marketplace can be read (over HTTPS, P6); every other source needs git. */
export function marketplaceNeedsGit(url) { return !gitAvailable() && !githubRepoOf(url); }

/** owner/repo -> GitHub URL (unless a real local path); URLs lose trailing /
 *  and .git; local paths resolve to absolute. null for empty input. */
export function normalizeMarketplaceUrl(input) {
  let s = String(input ?? '').trim();
  if (!s) return null;
  if (/^[\w.-]+\/[\w.-]+$/.test(s) && !existsSync(s)) s = `https://github.com/${s}`;
  // The lookbehind tries each run of slashes once: a megabyte of them costs one pass (a bare \/+$ is quadratic).
  if (/^[a-z+]+:\/\//i.test(s)) return s.replace(/(?<!\/)\/+$/, '').replace(/\.git$/i, '');
  // scp-style git remote ([user@]host:path) — a git URL, never a local path.
  if (/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:(?!\/)/.test(s)) return s.replace(/(?<!\/)\/+$/, '').replace(/\.git$/i, '');
  return resolve(s);
}

// normalizeMarketplaceUrl is idempotent (C2), so hashing the normalized url is
// stable even when addMarketplace has already normalized before calling.
export function marketplaceId(url) { return repoSlug(normalizeMarketplaceUrl(url) ?? String(url)); }

/** A readable name for a marketplace whose manifest gives none (G6): owner/repo on GitHub; the last two path
 *  segments of another git URL (query, fragment, a trailing `.git` and an Azure `_git` segment dropped), its host
 *  when it has no path; else the local folder's name (a `file://` URL is a local path). Never a URL credential or
 *  port; '' for none. Pure; `/` and `\` both separate (Mac, Linux, Windows). */
export function marketplaceDisplayName(url) {
  const s = typeof url === 'string' ? url.trim() : '';   // a hand-edited non-string url reads as none, never a throw
  if (!s) return '';
  const gh = githubRepoOf(s);
  if (gh) return `${gh.owner}/${gh.repo}`;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\/([^/]*)/i.exec(s);
  const scp = scheme ? null : /^[A-Za-z0-9._-]+@([A-Za-z0-9._-]+):(?!\/)/.exec(s);
  if (scp || (scheme && scheme[1].toLowerCase() !== 'file')) {
    let rest = s.slice((scheme || scp)[0].length);
    let host = scheme ? scheme[2].replace(/^[\s\S]*@/, '') : scp[1];   // userinfo goes first: a raw # or ? in a password stays hidden
    const q = host.search(/[?#]/);
    if (q >= 0) { host = host.slice(0, q); rest = ''; }   // a query or fragment right after the host: there is no path
    const segs = rest.replace(/[?#][\s\S]*$/, '').replace(/\.git\/*$/i, '').split('/').filter((x) => x && x !== '_git');
    if (segs.length) return segs.slice(-2).join('/');
    return scheme ? host.replace(/:\d*$/, '') : host;   // no path: the host alone
  }
  const last = (scheme ? s.slice(scheme[0].length) : s).split(/[\\/]+/).filter(Boolean).at(-1);
  return last ? (last.replace(/\.git$/i, '') || last) : (scheme ? '' : s);   // file://host with no path: no folder to name
}

/** An entry as readers see it (never written back): a name an older worca left as the hashed id, or none, reads as
 *  marketplaceDisplayName(url). */
export function presentMarketplace(e) {
  return { ...e, name: e.name && e.name !== e.id ? e.name : (marketplaceDisplayName(e.url) || e.id), lastError: e.lastError ?? null,
    plugins: (Array.isArray(e.plugins) ? e.plugins : []).map((p) => (Array.isArray(p?.notes) ? p : { ...p, notes: [] })) };
}

/** Missing/corrupt/non-object -> empty state. Entries not normalized on read. */
export function readMarketplaces() {
  try {
    const v = JSON.parse(readFileSync(marketplacesFile(), 'utf8'));
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return {
        ...v, // unknown keys survive read-modify-write; normalized fields below win
        seededBuiltin: v.seededBuiltin === true,
        marketplaces: v.marketplaces && typeof v.marketplaces === 'object' && !Array.isArray(v.marketplaces)
          ? Object.assign(Object.create(null), v.marketplaces) : Object.create(null),
      };
    }
  } catch { /* fall through */ }
  return { seededBuiltin: false, marketplaces: Object.create(null) };
}

export function writeMarketplaces(state) {
  const file = marketplacesFile();
  mkdirSync(pluginsRoot(), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(state ?? { seededBuiltin: false, marketplaces: {} }, null, 2) + '\n', 'utf8');
  renameSync(tmp, file);
  return state;
}

// relTimeCore(iso, now) -> "just now"/"5m ago"/"3h ago"/"2d ago"/ISO date. Pure;
// mirrors plugins-view.mjs relTime so core has no DOM dependency (C4).
function relTimeCore(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return String(iso || 'unknown');
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); if (d < 30) return `${d}d ago`;
  return String(iso).slice(0, 10);
}

/** Reduce a multi-line git failure to its first `fatal:` line; map the empty-repo
 *  case to plain language. Avoids leaking the internal .cache path into the UI. */
function firstFatal(err) {
  const raw = String(err?.stderr || err?.message || err || '');
  if (/unknown revision|ambiguous argument 'HEAD'/.test(raw)) return 'repository has no commits yet';
  return raw.split('\n').map((l) => l.trim()).find((l) => l.startsWith('fatal:'))?.replace(/^fatal:\s*/, '')
    || (raw.split('\n')[0] || 'unknown error');
}

/** `scheme://user:pass@host` -> `scheme://***@host`: everything up to the LAST `@` before the host goes, so a raw
 *  `@` in a password keeps no tail. Linear on any input (a URL typed into the add box can be megabytes long). */
export function redactUserinfo(text) {
  return String(text ?? '').replace(/:\/\/[^\s/]*@/g, '://***@');
}

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Error text a person may see (lastError.message, the add job's `error`): its first line, at most 300 characters,
 *  URL userinfo masked, and worca's own plugin folder shown as `<worca cache>` — a `.cache` folder name spells the
 *  source URL, credentials included (`\` and `/` spellings: git on Windows prints either). */
export function safeErrorText(text) {
  let s = redactUserinfo(String(text ?? '').split('\n')[0].trim());
  const root = pluginsRoot();
  for (const r of new Set([root, root.replace(/\\/g, '/')])) s = s.replace(new RegExp(`${reEsc(r)}[^\\s'"]*`, 'g'), '<worca cache>');
  return s.length > 300 ? `${s.slice(0, 299)}…` : s;
}

// git's words for a source it could not reach: network, auth, a missing or non-repository origin.
const UNREACHABLE_GIT = /unable to access|could not resolve host|repository '[^']*' (?:not found|does not exist)|does not appear to be a git repository|could not read from remote repository|could not read (?:username|password)|authentication failed|terminal prompts disabled|permission denied \(publickey|host key verification failed|connection (?:refused|timed out|reset)|network is unreachable|remote error: (?:access denied|repository not (?:found|exported))/i;
const GITHUB_UNREACHABLE = new Set(['GITHUB_NETWORK', 'GITHUB_NOT_FOUND', 'GITHUB_AUTH', 'GITHUB_FORBIDDEN', 'GITHUB_RATE_LIMITED']);

/** A failed sync as `{ message, code, at }` (G12): UNREACHABLE for an HTTP status (GitHub's 5xx too), a timeout, the
 *  network, auth or a missing repository, else SYNC_FAILED. The message is short and safe to show (safeErrorText). */
export function syncErrorOf(err, at = new Date().toISOString()) {
  let message;
  let code;
  if (typeof err?.code === 'string' && err.code.startsWith('GITHUB_')) {
    message = err.message;
    code = GITHUB_UNREACHABLE.has(err.code) || (err.code === 'GITHUB_HTTP' && err.status >= 500) ? 'UNREACHABLE' : 'SYNC_FAILED';
  } else if (err?.killed) {   // execFile's 120 s timeout: no stderr, and its message is the whole command line
    message = 'timed out';
    code = 'UNREACHABLE';
  } else {
    const raw = String(err?.stderr || err?.message || err || '');
    const status = /returned error: (\d{3})/.exec(raw)?.[1];
    message = status ? `HTTP ${status}` : firstFatal(err).replace(/^unable to access '[^']*': /, '');
    code = status || UNREACHABLE_GIT.test(raw) ? 'UNREACHABLE' : 'SYNC_FAILED';
  }
  return { message: safeErrorText(message), code, at };
}

/** Discovery + per-plugin consent inventories -> fresh snapshot on the entry.
 *  Failure keeps the previous snapshot and records a warning (stale-but-usable). */
async function syncEntry(entry, { exec, onProgress = () => {} } = {}) {
  try {
    onProgress({ phase: 'fetching' });
    const found = await addPluginRepo(entry.url, { ...(exec ? { exec } : {}), ...(entry.ref ? { ref: entry.ref } : {}), onProgress });
    const plugins = [];
    const total = found.discovered.length;
    onProgress({ phase: 'checking', done: 0, total, plugin: null });
    for (const [i, d] of found.discovered.entries()) {
      plugins.push({
        name: d.name,
        subdir: d.subdir,
        description: d.manifest.description ?? '',
        version: d.manifest.version ?? null,
        inventory: await inventoryFromCache(found.repoUrl, found.sha, d.subdir, ...(exec ? [{ exec }] : [])),
        notes: d.warnings || [],
      });
      onProgress({ phase: 'checking', done: i + 1, total, plugin: d.name });
    }
    if (found.marketplace) {
      entry.name = found.marketplace.name;
      entry.description = found.marketplace.description;
    } else if (!entry.name || entry.name === entry.id) entry.name = marketplaceDisplayName(entry.url);
    entry.lastSync = { sha: found.sha, at: new Date().toISOString() };
    entry.plugins = plugins;
    entry.warnings = found.warnings;
    delete entry.lastError;
  } catch (err) {
    const when = entry.lastSync ? `last sync ${relTimeCore(entry.lastSync.at)}` : 'never synced';
    const msg = firstFatal(err);
    entry.warnings = [`${when}; refresh failed: ${msg}`,
      ...(entry.warnings || []).filter((w) => !/refresh failed:/.test(w))];
    entry.lastError = syncErrorOf(err);
  }
  return entry;
}

/** EXISTS naming the marketplace the url already is (G5): `existing: { id, name }`, name as readers see it. */
function existsError(norm, id, entry) {
  return Object.assign(new Error(`marketplace already added: ${norm}`), { code: 'EXISTS', existing: { id, name: presentMarketplace(entry).name } });
}

/** The refusals an add makes before any git work, in order: BAD_REQUEST, PLUGIN_FOLDER (+ dir), EXISTS (+ existing),
 *  GIT_MISSING. No network, no git. -> { url: <normalized>, id } */
export function checkMarketplaceAdd(url) {
  const norm = normalizeMarketplaceUrl(url);
  if (!norm) throw Object.assign(new Error('marketplace url is required'), { code: 'BAD_REQUEST' });
  // A plain PLUGIN folder — a worca-cc-plugin.json, no marketplace manifest, and
  // NOT a git repository (a git repo whose root is a plugin IS a marketplace:
  // the fallback scan discovers it at depth 0) — is not a marketplace. It is the
  // natural thing to paste after `worca workflow export --format plugin`. Say
  // so, name the fix, and carry the dir so the server route can link it on the
  // user's behalf (code PLUGIN_FOLDER).
  if (!/^[a-z+]+:\/\//i.test(norm) && !/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:/.test(norm)
    && existsSync(join(norm, 'worca-cc-plugin.json')) && !existsSync(join(norm, 'worca-cc-marketplace.json'))
    && (!existsSync(join(norm, '.git')) || !gitAvailable())) { // without git a local folder can only be linked
    throw Object.assign(
      new Error(`${norm} is a single plugin folder, not a marketplace — link it instead: worca plugin link ${norm}`),
      { code: 'PLUGIN_FOLDER', dir: norm });
  }
  const id = marketplaceId(norm);
  const cur = readMarketplaces().marketplaces[id];
  if (cur) throw existsError(norm, id, cur); // cheap pre-check: fail before any git work
  if (marketplaceNeedsGit(norm)) throw gitMissingError();
  return { url: norm, id };
}

/** Register + immediately sync. Throws EXISTS on a duplicate (normalized) url.
 *  A first-sync failure throws WITHOUT recording — a typo'd url never leaves a
 *  junk entry (spec §4.2). The insert RE-READS the registry after the long git
 *  sync (B8) — inserting into the pre-sync snapshot would resurrect entries
 *  removed meanwhile and drop concurrent adds (lost update). `onProgress` hears
 *  resolving, fetching, reading, checking (per plugin) and saved; a listener that
 *  throws never breaks the add. */
export async function addMarketplace(url, { exec, onProgress } = {}) {
  const { url: norm, id } = checkMarketplaceAdd(url);
  const emit = (p) => { try { onProgress?.(p); } catch { /* a listener never breaks the add */ } };
  emit({ phase: 'resolving', resolvedUrl: norm });
  const entry = {
    id, url: norm, name: marketplaceDisplayName(norm), description: '',
    addedAt: new Date().toISOString(), lastSync: null, plugins: [], warnings: [],
  };
  await syncEntry(entry, { exec, onProgress: emit });
  if (!entry.lastSync) {
    // C8: drop the orphan bare cache the failed clone left — but never a cache an
    // installed plugin still shares (transient failures must not evict it).
    dropCacheUnlessInstalled(norm);
    throw Object.assign(new Error(entry.warnings[0] || `could not read ${norm}`), { code: 'BAD_REQUEST', syncError: entry.lastError });
  }
  const state = readMarketplaces(); // B8: LATEST state, not the pre-sync snapshot
  if (state.marketplaces[id]) throw existsError(norm, id, state.marketplaces[id]);
  state.marketplaces[id] = entry;
  writeMarketplaces(state);
  emit({ phase: 'saved' });
  return presentMarketplace(entry);
}

/** Read-modify-write the LATEST state, one entry only — so a long git sync can't
 *  clobber a concurrent remove/add. Drops the write if the entry vanished. */
function mutateEntry(id, apply) {
  const state = readMarketplaces();
  if (!Object.hasOwn(state.marketplaces, id)) return null;
  apply(state.marketplaces[id]);
  writeMarketplaces(state);
  return state.marketplaces[id];
}

export async function syncMarketplace(id, { exec } = {}) {
  const cur = readMarketplaces().marketplaces[id];
  if (!cur) throw Object.assign(new Error(`marketplace "${id}" not found`), { code: 'NOT_FOUND' });
  if (marketplaceNeedsGit(cur.url)) throw gitMissingError();   // a source off GitHub without git: Needs git
  const clone = { ...cur, plugins: [...(cur.plugins || [])], warnings: [...(cur.warnings || [])] };
  await syncEntry(clone, { exec });
  const saved = mutateEntry(id, (e) => {
    Object.assign(e, { name: clone.name, description: clone.description, lastSync: clone.lastSync, plugins: clone.plugins, warnings: clone.warnings });
    if (clone.lastError) e.lastError = clone.lastError; else delete e.lastError;
  });
  if (!saved) throw Object.assign(new Error(`marketplace "${id}" not found`), { code: 'NOT_FOUND' });
  return presentMarketplace(saved);
}

/** Sequential, per-entry tolerant: a dead repo (sync warning) AND an entry removed
 *  mid-refresh (NOT_FOUND) both leave the others intact. */
export async function refreshAllMarketplaces({ exec } = {}) {
  const out = [];
  for (const id of Object.keys(readMarketplaces().marketplaces).sort()) {
    try { out.push(await syncMarketplace(id, { exec })); }
    catch (err) {
      // A source off GitHub without git stays as stored (listed with needsGit) until git is back.
      if (err?.code === 'GIT_MISSING') { const kept = readMarketplaces().marketplaces[id]; if (kept) out.push(presentMarketplace(kept)); continue; }
      if (err?.code !== 'NOT_FOUND') throw err;
    }
  }
  return out;
}

/** Remove the registry entry + snapshot. Installed plugins are untouched; the
 *  bare cache goes only when no plugins.lock.json entry shares the repo. */
export function removeMarketplace(id) {
  const state = readMarketplaces();
  const entry = state.marketplaces[id];
  if (!entry) throw Object.assign(new Error(`marketplace "${id}" not found`), { code: 'NOT_FOUND' });
  delete state.marketplaces[id];
  writeMarketplaces(state);
  dropCacheUnlessInstalled(entry.url);
  return { ok: true, id };
}

/** Delete a repo's bare cache unless a plugins.lock.json entry still installs from it. */
function dropCacheUnlessInstalled(url) {
  const inUse = Object.values(readPluginsLock()).some((e) =>
    e && e.repo && (e.repo === url || normalizeMarketplaceUrl(e.repo) === url));
  if (!inUse) {
    rmSync(repoCacheDir(url), { recursive: true, force: true });
    removeSnapshotRoot(url); // the snapshots read without git (P6): renamed aside, then removed
  }
}

export function listMarketplaces() {
  const state = readMarketplaces();
  return Object.values(state.marketplaces).map(presentMarketplace)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** Install-source resolution (spec §4.10): explicit --repo > lock provenance >
 *  unique snapshot match > {candidates} on ambiguity > null. */
export function resolveInstallSource(name, { repo } = {}) {
  if (repo) return { repoUrl: normalizeMarketplaceUrl(repo), subdir: null, sha: null, marketplace: null };
  const lockEntry = readPluginsLock()[name];
  if (lockEntry && lockEntry.repo) {
    return { repoUrl: lockEntry.repo, subdir: lockEntry.subdir ?? null, sha: null, marketplace: lockEntry.marketplace ?? null };
  }
  const hits = [];
  for (const m of listMarketplaces()) {
    for (const p of m.plugins || []) {
      if (p.name === name) {
        hits.push({ repoUrl: m.url, subdir: p.subdir, sha: m.lastSync ? m.lastSync.sha : null, marketplace: m.id });
      }
    }
  }
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) return { candidates: hits };
  return null;
}

export const BUILTIN_MARKETPLACE_REF = 'dev';

/** Where the builtin marketplace lives: this package's GitHub repository (package.json
 *  `repository`) on BUILTIN_MARKETPLACE_REF — the default branch lags the releases — so npm and
 *  container installs get it too. WORCA_BUILTIN_MARKETPLACE (a URL or local path) replaces it,
 *  followed at its HEAD: tests and unpushed plugins use a checkout. null when neither is known. */
export function builtinMarketplaceSource(env = process.env) {
  const override = String(env.WORCA_BUILTIN_MARKETPLACE ?? '').trim();
  if (override) return { url: normalizeMarketplaceUrl(override), ref: null };
  try {
    const pkg = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'), 'utf8'));
    const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
    const url = typeof repo === 'string' ? normalizeMarketplaceUrl(repo.replace(/^git\+/, '')) : null;
    return url ? { url, ref: BUILTIN_MARKETPLACE_REF } : null;
  } catch { return null; }
}

/** Builtin seed (spec §4.2): register `source` as the builtin marketplace. NO git operations —
 *  lastSync:null; the first sync happens via the Plugins view's background refresh or an explicit
 *  `worca marketplace refresh`. A builtin with another url or branch (an older worca's local
 *  checkout, a changed WORCA_BUILTIN_MARKETPLACE) is replaced; the same repo added by hand becomes
 *  the builtin. seededBuiltin is set only on success, so a removed builtin never auto-returns. */
export function seedBuiltinMarketplace({ source = builtinMarketplaceSource() } = {}) {
  if (!source?.url) return { seeded: false, reason: 'no-source' };
  const state = readMarketplaces();
  const ref = source.ref ?? null;
  const id = marketplaceId(source.url);
  const old = Object.values(state.marketplaces).find((m) => m && m.builtin === true);
  if (!old && state.seededBuiltin) return { seeded: false, reason: 'already-seeded' };
  if (old && old.id === id && (old.ref ?? null) === ref) return { seeded: false, reason: 'already-seeded' };
  const replaced = old && old.id !== id ? old.id : null;
  if (replaced) delete state.marketplaces[replaced];
  const prev = state.marketplaces[id];
  const sameBranch = !!prev && (prev.ref ?? null) === ref;
  const entry = {
    ...(prev ?? { id, url: source.url, name: 'Worca CC Official', description: '', addedAt: new Date().toISOString(), warnings: [] }),
    builtin: true,
    lastSync: sameBranch ? prev.lastSync : null,
    plugins: sameBranch ? prev.plugins : [],
  };
  if (ref) entry.ref = ref; else delete entry.ref;
  if (!sameBranch) delete entry.lastError;   // a new branch has not failed yet
  state.marketplaces[id] = entry;
  state.seededBuiltin = true;
  writeMarketplaces(state);
  if (replaced) dropCacheUnlessInstalled(old.url);
  return { seeded: true, id, ...(replaced ? { replaced } : {}) };
}
