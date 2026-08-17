// src/core/plugin-store.mjs
// Plugin lifecycle (spec §6): install (consent inventory + atomic symlink swap),
// update (keep previous, GC last 2), uninstall/purge (data/ kept by default),
// enable/disable, list, doctor, dev link. Install NEVER executes plugin-chosen
// code: npm ci --ignore-scripts, no setup-command field, archive exports carry
// no .git. Any failure before the swap+lock lands removes versions/<sha7> and
// leaves prior state untouched (§6.1 step 4).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import {
  existsSync, readdirSync, readFileSync, readlinkSync,
  mkdirSync, rmSync, symlinkSync, renameSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { WORCA_PLUGIN_APIS } from './plugin-api.mjs';
import { normalizeManifest, validatePluginDir, apiSatisfies } from './plugin-manifest.mjs';
import {
  pluginsRoot, pluginDir, pluginCurrentDir, pluginDataDir, readPluginsLock, writePluginsLock,
  DIR_NAME_RE,
} from './plugins-lock.mjs';
import { addPluginRepo, fetchCandidate, exportVersion, repoCacheDir } from './plugin-repo.mjs';
import { importPluginWorkflows, removePluginWorkflows, referencedPluginAgents } from './plugin-workflows.mjs';
import { pluginModelSecretStatus } from './plugin-models.mjs';
import { referencedPluginModels } from './config.mjs';

const execFileP = promisify(execFile);
const defaultExec = (cmd, args, opts = {}) =>
  execFileP(cmd, args, { maxBuffer: 16 * 1024 * 1024, ...opts });

function readManifestAt(dir) {
  try {
    const res = normalizeManifest(JSON.parse(readFileSync(join(dir, 'worca-cc-plugin.json'), 'utf8')), { dir });
    return res.ok ? res.manifest : null;
  } catch {
    return null;
  }
}

function sha256File(file) {
  try { return createHash('sha256').update(readFileSync(file)).digest('hex'); } catch { return null; }
}

/** Private copy of workflows.mjs:66-77 parseFrontmatterTools (module-private there). */
function frontmatterTools(text) {
  const m = /^---\s*\n([\s\S]*?)\n---/.exec(text);
  if (!m) return [];
  const line = m[1].split(/\r?\n/).find((l) => /^tools\s*:/.test(l));
  if (!line) return [];
  return line.replace(/^tools\s*:/, '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** The "Will install" consent inventory (spec §6.1, design §9.4): agents +
 *  their frontmatter tools, sources + their secret fields, models with their
 *  base-URL value VERBATIM (a model env can redirect all API traffic — the
 *  reviewer must see where) + requested model secrets, skills, workflows, npm
 *  dep count from the lockfile, and the exact setup commands that would run. */
export function buildInstallInventory(versionDir) {
  const manifest = readManifestAt(versionDir)
    ?? { taskSources: [], chatChannels: [], models: [], modelSecrets: [], setup: { node: false, python: null } };
  const agents = [];
  const aDir = join(versionDir, 'agents');
  if (existsSync(aDir)) {
    for (const f of readdirSync(aDir).filter((x) => x.endsWith('.meta.json')).sort()) {
      const key = f.slice(0, -'.meta.json'.length);
      let tools = [];
      try { tools = frontmatterTools(readFileSync(join(aDir, `${key}.md`), 'utf8')); } catch { /* md missing */ }
      agents.push({ key, tools });
    }
  }
  const taskSources = (manifest.taskSources || []).map((s) => ({
    id: s.id, displayName: s.displayName,
    secrets: (s.configSchema || []).filter((x) => x.secret).map((x) => x.key),
  }));
  // Channel consent is security-loud by design: a chat channel is remote
  // control of worca-cc (approve gates, stop/pause runs) for anyone holding
  // the bot token or sitting in an allow-listed chat (design §4.6).
  const chatChannels = (manifest.chatChannels || []).map((c) => ({
    id: c.id, displayName: c.displayName, platform: c.platform, ingress: c.ingress,
    inbound: c.capabilities?.inbound !== false, outbound: c.capabilities?.outbound !== false,
    secrets: (c.configSchema || []).filter((x) => x.secret).map((x) => x.key),
  }));
  const models = (manifest.models || []).map((m) => {
    const bu = m.env?.ANTHROPIC_BASE_URL;
    return {
      id: m.id, label: m.label, efforts: m.efforts,
      envKeys: Object.keys(m.env ?? {}),
      baseUrl: typeof bu === 'string' ? bu : bu ? `(from secret "${bu.secret}")` : null,
    };
  });
  const modelSecrets = (manifest.modelSecrets || []).map((f) => ({ key: f.key, label: f.label }));
  const skills = [];
  const sDir = join(versionDir, 'skills');
  if (existsSync(sDir)) {
    for (const d of readdirSync(sDir, { withFileTypes: true })) {
      if (d.isDirectory() && existsSync(join(sDir, d.name, 'SKILL.md'))) skills.push(d.name);
    }
  }
  const workflows = [];
  const wDir = join(versionDir, 'workflows');
  if (existsSync(wDir)) {
    for (const f of readdirSync(wDir).filter((x) => x.endsWith('.json')).sort()) workflows.push(f.slice(0, -5));
  }
  let depCount = null;
  try {
    const lock = JSON.parse(readFileSync(join(versionDir, 'package-lock.json'), 'utf8'));
    depCount = Object.keys(lock.packages || {}).filter((k) => k !== '').length;
  } catch { /* no lockfile */ }
  const setupCommands = [];
  if (manifest.setup?.node) setupCommands.push(`npm ci --prefix ${versionDir} --ignore-scripts --omit=dev`);
  if (manifest.setup?.python === 'pyproject') setupCommands.push(`uv sync --project ${versionDir}`);
  return { agents, taskSources, chatChannels, models, modelSecrets, skills: skills.sort(), workflows, depCount, setupCommands };
}

/** Declared setup FACTS only (spec §4.1): setup.node -> npm ci (lockfile
 *  required, scripts ignored); setup.python 'pyproject' -> uv sync. */
export async function runSetup(versionDir, manifest, { exec = defaultExec } = {}) {
  const commands = [];
  if (manifest?.setup?.node) {
    if (!existsSync(join(versionDir, 'package-lock.json'))) {
      throw new Error(`setup.node declared but ${join(versionDir, 'package-lock.json')} is missing (npm ci requires a lockfile)`);
    }
    await exec('npm', ['ci', '--prefix', versionDir, '--ignore-scripts', '--omit=dev']);
    commands.push('npm ci');
  }
  if (manifest?.setup?.python === 'pyproject') {
    await exec('uv', ['sync', '--project', versionDir]);
    commands.push('uv sync');
  }
  return { commands };
}

/** Doctor checks that run against an arbitrary dir — shared by the install
 *  precheck (new version dir, pre-swap) and doctorPlugin (current/). */
function dirChecks(dir, manifest) {
  const checks = [];
  const c = (id, ok, detail) => checks.push({ id, ok: !!ok, detail });
  c('manifest', !!manifest, manifest ? `plugin "${manifest.name}"` : 'worca-cc-plugin.json missing or invalid');
  if (manifest) {
    const range = manifest.engines?.worcaApi;
    c('api', apiSatisfies(range), range ? `requires "${range}", host APIs [${WORCA_PLUGIN_APIS.join(', ')}]` : 'no engines constraint');
    for (const s of manifest.taskSources || []) c(`module:${s.id}`, existsSync(join(dir, s.module)), s.module);
    for (const ch of manifest.chatChannels || []) c(`channel-module:${ch.id}`, existsSync(join(dir, ch.module)), ch.module);
    if (manifest.setup?.node) c('node-deps', existsSync(join(dir, 'node_modules')), 'node_modules present (setup.node)');
    if (manifest.setup?.python === 'pyproject') c('python-venv', existsSync(join(dir, '.venv')), '.venv present (setup.python)');
  }
  return checks;
}

function currentTarget(name) {
  try { return readlinkSync(pluginCurrentDir(name)); } catch { return null; }
}

/** Atomic swap (§6.1 step 3): write current.tmp symlink, rename(2) over current. */
function swapCurrent(name, target) {
  const current = pluginCurrentDir(name);
  const tmp = `${current}.tmp`;
  rmSync(tmp, { force: true });
  mkdirSync(pluginDir(name), { recursive: true });
  symlinkSync(target, tmp);
  renameSync(tmp, current);
}

/** §6.1 step 4: failure before swap+lock landed -> delete the partial version
 *  dir, restore/remove current, tidy now-empty dirs. Prior state untouched. */
function cleanupFailedVersion(name, versionDir, prevCurrent) {
  rmSync(versionDir, { recursive: true, force: true });
  rmSync(`${pluginCurrentDir(name)}.tmp`, { force: true });
  if (prevCurrent) { try { swapCurrent(name, prevCurrent); } catch { /* best effort */ } }
  else rmSync(pluginCurrentDir(name), { force: true });
  for (const d of [join(pluginDir(name), 'versions'), pluginDir(name)]) {
    try { if (readdirSync(d).length === 0) rmSync(d, { recursive: true, force: true }); } catch { /* absent */ }
  }
}

function validated(name, versionDir) {
  const v = validatePluginDir(versionDir);
  if (!v.ok) {
    const lines = v.problems.filter((p) => p.level === 'error').map((p) => `  - ${p.message}`);
    throw new Error(`plugin "${name}" failed validation:\n${lines.join('\n')}`);
  }
  return v.manifest;
}

function precheck(versionDir, manifest) {
  const bad = dirChecks(versionDir, manifest).filter((x) => !x.ok);
  if (bad.length) {
    throw new Error(`doctor precheck failed: ${bad.map((x) => `${x.id} (${x.detail})`).join('; ')}`);
  }
}

/**
 * Install (spec §6.1): ensure cache -> export pinned sha -> validate -> setup ->
 * doctor precheck -> atomic symlink swap -> lock entry. sha omitted -> repo HEAD.
 * On ANY failure: versions/<sha7> removed, prior state untouched, error rethrown.
 */
export async function installPlugin({ repoUrl, subdir = '', name, sha, marketplace } = {}, { exec = defaultExec } = {}) {
  if (!name) throw new Error('installPlugin: name is required');
  const lock = readPluginsLock();
  if (lock[name]) throw new Error(`plugin "${name}" is already installed`);
  const added = await addPluginRepo(repoUrl, { exec }); // clone-or-fetch the cache
  const pin = sha || added.sha;
  const { versionDir, warnings } = await exportVersion(name, pin, { exec, repoUrl, subdir });
  const prevCurrent = currentTarget(name); // null on first install
  try {
    const manifest = validated(name, versionDir);
    await runSetup(versionDir, manifest, { exec });
    precheck(versionDir, manifest);
    const inventory = buildInstallInventory(versionDir);
    swapCurrent(name, join('versions', pin.slice(0, 7)));
    lock[name] = {
      repo: repoUrl, subdir, pinnedSha: pin,
      version: manifest.version ?? pin.slice(0, 7), // no manifest version -> the SHA is the version (§4.1)
      enabled: true, installedAt: new Date().toISOString(),
      lockfileHash: sha256File(join(versionDir, 'package-lock.json')),
      ...(marketplace ? { marketplace } : {}), // provenance only when it came from one
    };
    writePluginsLock(lock);
    // §6.1(3): workflow template import is the LAST install step (post-swap,
    // post-lock). Own try/catch: an import INFRA failure (DB error) must not
    // reach installPlugin's catch — cleanupFailedVersion would delete the version
    // dir a just-written lock entry points at. The install itself already
    // succeeded; warn and continue (re-import happens on the next update).
    try {
      const wf = await importPluginWorkflows(name, versionDir);
      for (const s of wf.skipped) {
        console.warn(`[plugin-store] ${name}: workflow ${s.file} not imported (${s.errors.join('; ')})`);
      }
    } catch (err) {
      console.warn(`[plugin-store] ${name}: workflow import failed (${err?.message || err}) — plugin installed; re-import via update`);
    }
    return { ok: true, inventory, warnings };
  } catch (err) {
    cleanupFailedVersion(name, versionDir, prevCurrent);
    throw err;
  }
}

/**
 * Update (spec §6.2): fetch candidate; when it differs, export/setup/precheck/
 * swap/lock. Previous version dir kept; GC keeps the last 2 (rollback =
 * re-point the symlink). The confirm preview is fetchCandidate — callers show
 * it BEFORE invoking this.
 */
export async function updatePlugin(name, { exec = defaultExec } = {}) {
  const lock = readPluginsLock();
  const entry = lock[name];
  if (!entry) throw new Error(`plugin "${name}" is not installed`);
  if (entry.linked) throw new Error(`plugin "${name}" is dev-linked — update the working dir instead`);
  const cand = await fetchCandidate(name, { exec });
  if (cand.candidateSha === entry.pinnedSha) return { ok: true, updated: false, ...cand };
  const { versionDir, warnings } = await exportVersion(name, cand.candidateSha, { exec });
  const prevCurrent = currentTarget(name);
  try {
    const manifest = validated(name, versionDir);
    await runSetup(versionDir, manifest, { exec });
    precheck(versionDir, manifest);
    const inventory = buildInstallInventory(versionDir);
    const sha7 = cand.candidateSha.slice(0, 7);
    swapCurrent(name, join('versions', sha7));
    lock[name] = {
      ...entry, pinnedSha: cand.candidateSha,
      version: manifest.version ?? sha7,
      updatedAt: new Date().toISOString(),
      lockfileHash: sha256File(join(versionDir, 'package-lock.json')),
    };
    writePluginsLock(lock);
    gcVersions(name, [sha7, entry.pinnedSha.slice(0, 7)]); // keep current + previous
    // §6.2(3): workflow re-import (upsert) after swap + lock update — same
    // isolation rationale as installPlugin: an import failure must not reach
    // this catch (cleanupFailedVersion would tear down the now-live version).
    try {
      const wf = await importPluginWorkflows(name, versionDir);
      for (const s of wf.skipped) {
        console.warn(`[plugin-store] ${name}: workflow ${s.file} not imported (${s.errors.join('; ')})`);
      }
    } catch (err) {
      console.warn(`[plugin-store] ${name}: workflow import failed (${err?.message || err}) — plugin updated; re-import via update`);
    }
    return { ok: true, updated: true, inventory, warnings, ...cand };
  } catch (err) {
    cleanupFailedVersion(name, versionDir, prevCurrent);
    throw err;
  }
}

function gcVersions(name, keep7) {
  const dir = join(pluginDir(name), 'versions');
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const d of entries) if (!keep7.includes(d)) rmSync(join(dir, d), { recursive: true, force: true });
}

/**
 * Uninstall (spec §6.3). Reference guard + imported-workflow removal live in
 * plugin-workflows.mjs: block when a non-plugin workflow still uses this
 * plugin's agents, then remove the imported rows (which itself throws
 * ReferencedError while a project/paused pipeline pins one).
 * data/ (config+secrets+state) is KEPT unless { purge: true } — never silently
 * retain secrets without saying so (the returned note names the leftover path).
 */
export async function uninstallPlugin(name, { purge = false } = {}) {
  const lock = readPluginsLock();
  const entry = lock[name];
  if (!entry) throw new Error(`plugin "${name}" is not installed`);
  const refs = referencedPluginAgents(name);
  if (refs.length) {
    throw Object.assign(
      new Error(`plugin "${name}" agents are referenced by: ${refs.map((r) => r.name).join(', ')} — remove those references first`),
      // Payload field is `references` — the one name Task 14's 409 handler and
      // Task 18's CLI catch both read (code mirrors deleteAgent, agent-store.mjs:113-118).
      { code: 'REFERENCED', references: refs },
    );
  }
  // Block-with-list model guard (design §9.4): same code/payload contract as
  // the agents guard above. Only ids that would actually stop resolving block —
  // referencedPluginModels applies the shadow/other-plugin/legacy carve-outs.
  const modelRefs = referencedPluginModels(name);
  if (modelRefs.length) {
    const lines = modelRefs.map((r) =>
      `${r.id} (${r.nodes.length + r.steps.length} selection${r.nodes.length + r.steps.length === 1 ? '' : 's'})`);
    throw Object.assign(
      new Error(`plugin "${name}" models are still selected in pipeline configuration: ${lines.join(', ')} — clear those selections (or copy the model to your catalog) first`),
      { code: 'REFERENCED', references: modelRefs },
    );
  }
  await removePluginWorkflows(name); // throws its ReferencedError with the referencing list
  rmSync(pluginCurrentDir(name), { force: true });
  rmSync(join(pluginDir(name), 'versions'), { recursive: true, force: true });
  delete lock[name];
  writePluginsLock(lock);
  // Drop the bare fetch cache only when no other installed plugin shares the repo.
  if (entry.repo && !Object.values(lock).some((e) => e && e.repo === entry.repo)) {
    rmSync(repoCacheDir(entry.repo), { recursive: true, force: true });
  }
  const dataDir = pluginDataDir(name);
  const dataKept = !purge && existsSync(dataDir);
  if (!dataKept) rmSync(pluginDir(name), { recursive: true, force: true });
  return {
    ok: true, dataKept,
    note: dataKept ? `config/secrets/state kept at ${dataDir} — "worca plugin purge ${name}" removes them` : null,
  };
}

/** Leftover data/ dirs from past non-purge uninstalls: dir under pluginsRoot,
 *  valid name, NOT in the lock, data/ present. Sorted; [] when root missing.
 *  Name filter is plugins-lock's DIR_NAME_RE — single-sourced so it can never
 *  disagree with the safeName gate inside pluginDataDir. */
export function listOrphanPluginData() {
  const root = pluginsRoot();
  if (!existsSync(root)) return [];
  const lock = readPluginsLock();
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && DIR_NAME_RE.test(d.name) && !lock[d.name])
    .filter((d) => existsSync(join(root, d.name, 'data')))
    .map((d) => ({ name: d.name, dataDir: pluginDataDir(d.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Purge an ORPHAN's leftovers (spec §6.3 tail). Installed plugins purge via
 *  uninstallPlugin({purge:true}) — refusing here keeps one purge path each. */
export function purgePluginData(name) {
  if (readPluginsLock()[name]) {
    throw Object.assign(
      new Error(`plugin "${name}" is still installed — uninstall with purge instead`),
      { code: 'INSTALLED' },
    );
  }
  // Invalid name -> worca-cc never created a dir for it (safeName gate), so
  // there are no leftovers; same coercion as safeName keeps the two in lockstep.
  if (!DIR_NAME_RE.test(String(name ?? ''))) throw new Error(`plugin "${name}": nothing to purge`);
  const dir = pluginDir(name); // cannot throw: guarded above
  if (!existsSync(dir)) throw new Error(`plugin "${name}": nothing to purge`);
  rmSync(dir, { recursive: true, force: true });
  return { ok: true, name };
}

/** Enable/disable (spec §6.5): lockfile flag only; no file removal. */
export function setPluginEnabled(name, enabled) {
  const lock = readPluginsLock();
  if (!lock[name]) throw new Error(`plugin "${name}" is not installed`);
  lock[name] = { ...lock[name], enabled: !!enabled };
  writePluginsLock(lock);
  return { ok: true, name, enabled: !!enabled };
}

/** Lock + current-manifest merge for the Plugins view / CLI list. */
export function listInstalledPlugins() {
  const lock = readPluginsLock();
  return Object.keys(lock).sort().map((name) => {
    const e = lock[name] || {};
    const cur = pluginCurrentDir(name);
    const manifest = existsSync(cur) ? readManifestAt(cur) : null; // existsSync follows the symlink
    const inv = manifest ? buildInstallInventory(cur) : null;
    return {
      name,
      version: e.version ?? null,
      pinnedSha: e.pinnedSha ?? null,
      repo: e.repo ?? null,
      subdir: e.subdir ?? '',
      marketplace: e.marketplace ?? null, // raw id; name resolution is the API layer's job
      enabled: e.enabled !== false,
      linked: e.linked === true,
      broken: !manifest,
      contributions: inv
        ? { agents: inv.agents.length, taskSources: inv.taskSources.length, chatChannels: inv.chatChannels.length, models: inv.models.length, skills: inv.skills.length, workflows: inv.workflows.length }
        : { agents: 0, taskSources: 0, chatChannels: 0, models: 0, skills: 0, workflows: 0 },
    };
  });
}

/**
 * Doctor (spec §6.4): lock entry, current resolves, manifest + engines still
 * satisfied, modules present, node_modules/.venv when declared, dep-lock hash
 * matches the install stamp, uv on PATH when python. validateConfig ("Test
 * connection") is wired once the shim (Task 11) exists — lazy import, skipped
 * silently until then.
 */
export async function doctorPlugin(name) {
  const checks = [];
  const c = (id, ok, detail) => checks.push({ id, ok: !!ok, detail });
  const entry = readPluginsLock()[name];
  c('installed', !!entry, entry ? 'lockfile entry present' : `no plugins.lock.json entry for "${name}"`);
  if (!entry) return { ok: false, checks };
  const cur = pluginCurrentDir(name);
  const resolves = existsSync(cur);
  c('current', resolves, resolves ? String(currentTarget(name) ?? cur) : 'current symlink missing or dangling');
  if (!resolves) return { ok: false, checks };
  const manifest = readManifestAt(cur);
  checks.push(...dirChecks(cur, manifest));
  if (manifest?.setup?.node && !entry.linked) {
    const h = sha256File(join(cur, 'package-lock.json'));
    c('lock-hash', !entry.lockfileHash || h === entry.lockfileHash,
      entry.lockfileHash ? 'package-lock.json matches the hash stamped at install' : 'no hash stamped (older install)');
  }
  if (manifest?.setup?.python === 'pyproject') {
    let onPath = true;
    try { await defaultExec('uv', ['--version']); } catch { onPath = false; }
    c('uv', onPath, onPath ? 'uv on PATH' : 'uv not found on PATH (required by setup.python)');
  }
  if (entry.linked) c('linked', true, 'dev-linked plugin — pin/hash checks reduced');
  for (const s of pluginModelSecretStatus(name)) {
    c(`model-secret:${s.key}`, s.set,
      s.set ? `"${s.label}" set` : `model secret "${s.key}" is not set — configure it under Model secrets`);
  }
  if (manifest && (manifest.taskSources || []).length) {
    let shim = null;
    try { shim = await import('./plugin-shim.mjs'); } // Task 11 module — may not exist yet
    catch (err) { if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err; }
    if (shim) {
      for (const s of manifest.taskSources) {
        try {
          const r = await shim.callSource({ plugin: name, sourceId: s.id, op: 'validateConfig' });
          c(`config:${s.id}`, r?.ok !== false, r?.ok === false ? JSON.stringify(r.errors ?? r) : 'validateConfig ok');
        } catch (err) {
          c(`config:${s.id}`, false, String(err?.message || err));
        }
      }
    }
  }
  return { ok: checks.every((x) => x.ok), checks };
}

/** Dev mode (spec §6.6): current -> absolute working dir; lock { linked: true }. */
export function linkPlugin(name, absDir) {
  const dir = resolve(absDir);
  const v = validatePluginDir(dir);
  if (!v.ok) {
    const lines = v.problems.filter((p) => p.level === 'error').map((p) => p.message);
    throw new Error(`cannot link: ${lines.join('; ')}`);
  }
  if (v.manifest.name !== name) {
    throw new Error(`manifest name "${v.manifest.name}" does not match "${name}"`);
  }
  const lock = readPluginsLock();
  swapCurrent(name, dir); // absolute target; atomic like any other swap
  lock[name] = {
    repo: null, subdir: '', pinnedSha: null,
    version: v.manifest.version ?? 'dev', enabled: true,
    installedAt: new Date().toISOString(), linked: true,
  };
  writePluginsLock(lock);
  return { ok: true, name, dir };
}
