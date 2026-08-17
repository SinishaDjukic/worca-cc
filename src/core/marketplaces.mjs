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
import { addPluginRepo, repoCacheDir, repoSlug } from './plugin-repo.mjs';
import { inventoryFromCache } from './plugin-inventory.mjs';

export function marketplacesFile() { return join(pluginsRoot(), 'marketplaces.json'); }

/** owner/repo -> GitHub URL (unless a real local path); URLs lose trailing /
 *  and .git; local paths resolve to absolute. null for empty input. */
export function normalizeMarketplaceUrl(input) {
  let s = String(input ?? '').trim();
  if (!s) return null;
  if (/^[\w.-]+\/[\w.-]+$/.test(s) && !existsSync(s)) s = `https://github.com/${s}`;
  if (/^[a-z+]+:\/\//i.test(s)) return s.replace(/\/+$/, '').replace(/\.git$/i, '');
  // scp-style git remote ([user@]host:path) — a git URL, never a local path.
  if (/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:(?!\/)/.test(s)) return s.replace(/\/+$/, '').replace(/\.git$/i, '');
  return resolve(s);
}

// normalizeMarketplaceUrl is idempotent (C2), so hashing the normalized url is
// stable even when addMarketplace has already normalized before calling.
export function marketplaceId(url) { return repoSlug(normalizeMarketplaceUrl(url) ?? String(url)); }

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

/** Discovery + per-plugin consent inventories -> fresh snapshot on the entry.
 *  Failure keeps the previous snapshot and records a warning (stale-but-usable). */
async function syncEntry(entry, { exec } = {}) {
  try {
    const found = await addPluginRepo(entry.url, ...(exec ? [{ exec }] : []));
    const plugins = [];
    for (const d of found.discovered) {
      plugins.push({
        name: d.name,
        subdir: d.subdir,
        description: d.manifest.description ?? '',
        version: d.manifest.version ?? null,
        inventory: await inventoryFromCache(found.repoUrl, found.sha, d.subdir, ...(exec ? [{ exec }] : [])),
      });
    }
    if (found.marketplace) {
      entry.name = found.marketplace.name;
      entry.description = found.marketplace.description;
    }
    entry.lastSync = { sha: found.sha, at: new Date().toISOString() };
    entry.plugins = plugins;
    entry.warnings = found.warnings;
  } catch (err) {
    const when = entry.lastSync ? `last sync ${relTimeCore(entry.lastSync.at)}` : 'never synced';
    const msg = firstFatal(err);
    entry.warnings = [`${when}; refresh failed: ${msg}`,
      ...(entry.warnings || []).filter((w) => !/refresh failed:/.test(w))];
  }
  return entry;
}

/** Register + immediately sync. Throws EXISTS on a duplicate (normalized) url.
 *  A first-sync failure throws WITHOUT recording — a typo'd url never leaves a
 *  junk entry (spec §4.2). The insert RE-READS the registry after the long git
 *  sync (B8) — inserting into the pre-sync snapshot would resurrect entries
 *  removed meanwhile and drop concurrent adds (lost update). */
export async function addMarketplace(url, { exec } = {}) {
  const norm = normalizeMarketplaceUrl(url);
  if (!norm) throw Object.assign(new Error('marketplace url is required'), { code: 'BAD_REQUEST' });
  const id = marketplaceId(norm);
  if (readMarketplaces().marketplaces[id]) { // cheap pre-check: fail before any git work
    throw Object.assign(new Error(`marketplace already added: ${norm}`), { code: 'EXISTS' });
  }
  const entry = {
    id, url: norm, name: id, description: '',
    addedAt: new Date().toISOString(), lastSync: null, plugins: [], warnings: [],
  };
  await syncEntry(entry, { exec });
  if (!entry.lastSync) {
    // C8: drop the orphan bare cache the failed clone left — but never a cache an
    // installed plugin still shares (transient failures must not evict it).
    const inUse = Object.values(readPluginsLock()).some((e) =>
      e && e.repo && (e.repo === norm || normalizeMarketplaceUrl(e.repo) === norm));
    if (!inUse) rmSync(repoCacheDir(norm), { recursive: true, force: true });
    throw Object.assign(new Error(entry.warnings[0] || `could not read ${norm}`), { code: 'BAD_REQUEST' });
  }
  const state = readMarketplaces(); // B8: LATEST state, not the pre-sync snapshot
  if (state.marketplaces[id]) {
    throw Object.assign(new Error(`marketplace already added: ${norm}`), { code: 'EXISTS' });
  }
  state.marketplaces[id] = entry;
  writeMarketplaces(state);
  return entry;
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
  const clone = { ...cur, plugins: [...(cur.plugins || [])], warnings: [...(cur.warnings || [])] };
  await syncEntry(clone, { exec });
  const saved = mutateEntry(id, (e) => Object.assign(e, {
    name: clone.name, description: clone.description, lastSync: clone.lastSync,
    plugins: clone.plugins, warnings: clone.warnings,
  }));
  if (!saved) throw Object.assign(new Error(`marketplace "${id}" not found`), { code: 'NOT_FOUND' });
  return saved;
}

/** Sequential, per-entry tolerant: a dead repo (sync warning) AND an entry removed
 *  mid-refresh (NOT_FOUND) both leave the others intact. */
export async function refreshAllMarketplaces({ exec } = {}) {
  const out = [];
  for (const id of Object.keys(readMarketplaces().marketplaces).sort()) {
    try { out.push(await syncMarketplace(id, { exec })); }
    catch (err) { if (err?.code !== 'NOT_FOUND') throw err; }
  }
  return out;
}

/** Remove the registry entry + snapshot. Installed plugins are untouched; the
 *  bare cache goes only when no plugins.lock.json entry shares the repo. */
export function removeMarketplace(id) {
  const state = readMarketplaces();
  const entry = state.marketplaces[id];
  if (!entry) throw Object.assign(new Error(`marketplace "${id}" not found`), { code: 'NOT_FOUND' });
  const inUse = Object.values(readPluginsLock()).some((e) =>
    e && e.repo && (e.repo === entry.url || normalizeMarketplaceUrl(e.repo) === entry.url));
  delete state.marketplaces[id];
  writeMarketplaces(state);
  if (!inUse) rmSync(repoCacheDir(entry.url), { recursive: true, force: true });
  return { ok: true, id };
}

export function listMarketplaces() {
  const state = readMarketplaces();
  return Object.values(state.marketplaces)
    .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
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

/** The checkout the host code runs from: two dirs above src/core/. Only a real
 *  marketplace checkout counts (must have worca-cc-marketplace.json + .git) —
 *  an npm-dist install without either returns null and seeding is skipped. */
export function hostRepoRoot() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  return existsSync(join(root, 'worca-cc-marketplace.json')) && existsSync(join(root, '.git'))
    ? root : null;
}

/** First-run builtin seed (spec §4.2): register the host checkout as a
 *  local-path marketplace. NO git operations — plugins:[] / lastSync:null; the
 *  first sync happens via the Plugins view's background refresh or an explicit
 *  `worca marketplace refresh`. seededBuiltin is set only on success, so a
 *  removed builtin never auto-returns, while a non-checkout host stays eligible
 *  to seed on a later run from a real checkout. */
export function seedBuiltinMarketplace({ rootDir = hostRepoRoot() } = {}) {
  const state = readMarketplaces();
  if (state.seededBuiltin) return { seeded: false, reason: 'already-seeded' };
  // Same contract as hostRepoRoot for an INJECTED rootDir too: a real checkout must
  // carry both the manifest and .git, else this is an npm-dist dir — skip (E7).
  if (!rootDir || !existsSync(join(rootDir, 'worca-cc-marketplace.json')) || !existsSync(join(rootDir, '.git'))) {
    return { seeded: false, reason: 'no-host-checkout' };
  }
  const url = resolve(rootDir);
  const id = marketplaceId(url);
  let name = 'Worca CC Official';
  let description = '';
  try {
    const raw = JSON.parse(readFileSync(join(rootDir, 'worca-cc-marketplace.json'), 'utf8'));
    if (typeof raw?.name === 'string' && raw.name.trim()) name = raw.name.trim();
    if (typeof raw?.description === 'string') description = raw.description.trim();
  } catch { /* keep defaults */ }
  if (!state.marketplaces[id]) {
    state.marketplaces[id] = {
      id, url, name, description, builtin: true,
      addedAt: new Date().toISOString(), lastSync: null, plugins: [], warnings: [],
    };
  }
  state.seededBuiltin = true;
  writeMarketplaces(state);
  return { seeded: true, id };
}
