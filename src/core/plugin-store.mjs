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
  mkdirSync, rmSync, symlinkSync, renameSync, unlinkSync,
} from 'node:fs';
import { join, resolve, isAbsolute, sep } from 'node:path';
import { WORCA_PLUGIN_APIS } from './plugin-api.mjs';
import { normalizeManifest, validatePluginDir, apiSatisfies, dataContractIssues, apiMismatch } from './plugin-manifest.mjs';
import {
  pluginsRoot, pluginDir, pluginCurrentDir, pluginDataDir, readPluginsLock, writePluginsLock,
  DIR_NAME_RE,
} from './plugins-lock.mjs';
import { addPluginRepo, fetchCandidate, exportVersion, repoCacheDir } from './plugin-repo.mjs';
import {
  importPluginWorkflows, readPluginWorkflows, removePluginWorkflows, referencedPluginAgents,
} from './plugin-workflows.mjs';
import { loadAgentRegistry } from './agent-registry.mjs';
import { pluginModelSecretStatus } from './plugin-models.mjs';
import { referencedPluginModels } from './config.mjs';
import { clearBindingsForPlugin } from './source-bindings.mjs';

const execFileP = promisify(execFile);
const defaultExec = (cmd, args, opts = {}) =>
  execFileP(cmd, args, { maxBuffer: 16 * 1024 * 1024, ...opts });

const IS_WINDOWS = process.platform === 'win32';

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

/** True when the relative path `rel` still resolves INSIDE `dir`. */
function insideDir(dir, rel) {
  if (isAbsolute(rel) || /\\/.test(rel)) return false;
  const root = resolve(dir);
  return resolve(root, rel).startsWith(root + sep);
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
      // Consent must describe the bytes the RUNTIME will read: agent-registry
      // stamps agentPath = join(<layer>/agents, meta.agentFile), so reading
      // `${key}.md` here showed a DECOY for any sidecar naming another file
      // (C-1). Containment is re-checked because this also runs on an
      // unvalidated dir (the pre-install preview); an escaping agentFile falls
      // back to the sibling and validatePluginDir refuses the install anyway.
      let mdFile = `${key}.md`;
      try {
        const af = JSON.parse(readFileSync(join(aDir, f), 'utf8'))?.agentFile;
        if (typeof af === 'string' && af.trim() && insideDir(aDir, af.trim())) mdFile = af.trim();
      } catch { /* unreadable sidecar: fall back to the sibling */ }
      let tools = [];
      try { tools = frontmatterTools(readFileSync(join(aDir, mdFile), 'utf8')); } catch { /* md missing */ }
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

/**
 * Contributions a plugin SHIPS but worca IGNORED, as `[{ file, reason }]` sorted
 * by file (`agents/<sidecar>.meta.json`, `workflows/<template>.json`). The two
 * drop sites — the agent registry and the workflow importer — reach only
 * console.warn on their own, so every reporting surface (install receipt,
 * Plugins card, doctor) was free to claim a contribution that does not exist.
 *
 * Generic by construction: nothing here is keyed on an agent key or a plugin
 * name — the drop reasons are authored at the drop sites and carried verbatim.
 *
 * @param {string} name
 * @param {string} dir  the plugin's current/ (or version) dir
 * @param {{registry?: object, drops?: Array<{origin:string,file:string,reason:string}>,
 *          workflowSkips?: Array<{file:string, errors:string[]}>}} [opts]
 *        registry/drops: reuse ONE registry load across plugins; workflowSkips:
 *        the importer's OWN result, when the caller just ran it.
 * @returns {Array<{file: string, reason: string}>}
 */
export function ignoredContributions(name, dir, opts = {}) {
  const out = [];
  let drops = opts.drops;
  let registry = opts.registry;
  if (!drops) {
    drops = [];
    try { registry = loadAgentRegistry(undefined, { onDrop: (d) => drops.push(d) }); }
    catch { /* no resolvable home: report what the files alone can say */ }
  }
  for (const d of drops) {
    if (d.origin === `plugin:${name}`) out.push({ file: `agents/${d.file}`, reason: d.reason });
  }
  const skips = opts.workflowSkips
    ?? (() => {
      try { return readPluginWorkflows(name, dir, { registry, quiet: true }).skipped; }
      catch { return []; }
    })();
  for (const s of skips) out.push({ file: `workflows/${s.file}`, reason: `invalid template (${s.errors.join('; ')})` });
  return out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/** Declared setup FACTS only (spec §4.1): setup.node -> npm ci (lockfile
 *  required, scripts ignored); setup.python 'pyproject' -> uv sync. */
export async function runSetup(versionDir, manifest, { exec = defaultExec } = {}) {
  const commands = [];
  if (manifest?.setup?.node) {
    if (!existsSync(join(versionDir, 'package-lock.json'))) {
      throw new Error(`setup.node declared but ${join(versionDir, 'package-lock.json')} is missing (npm ci requires a lockfile)`);
    }
    // cwd instead of --prefix so no native path is passed as an argument: on
    // Windows npm is `npm.cmd`, which needs a shell (bare `npm` -> ENOENT, and
    // execFile of a `.cmd` -> EINVAL on modern Node), and shell:true does NOT
    // quote args — a `--prefix C:\…` path would be mangled. With the dir as cwd
    // the only args left are flag literals, safe through the shell.
    await exec('npm', ['ci', '--ignore-scripts', '--omit=dev'],
      { cwd: versionDir, shell: IS_WINDOWS });
    commands.push('npm ci');
  }
  if (manifest?.setup?.python === 'pyproject') {
    await exec('uv', ['sync'], { cwd: versionDir });
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

// rmSync is the wrong primitive for a POSIX path that may be a symlink: it
// stats THROUGH the link, so a link to a directory throws ERR_FS_EISDIR and a
// DANGLING link reads as "already gone" and survives force:true (Node 23).
// unlink removes the link itself; the fallback covers a real directory
// (test fixtures build `current` as a plain dir).
const rmLink = (path) => {
  try { unlinkSync(path); return; } catch (err) {
    if (err.code === 'ENOENT') return;
  }
  rmSync(path, { recursive: true, force: true });
};

/** Atomic swap (§6.1 step 3): write current.tmp symlink, rename(2) over current.
 *  Windows can't create a plain symlink without elevated privileges/Developer
 *  Mode, and can't rename() a directory reparse point over an existing one
 *  (EPERM). It CAN create a directory JUNCTION unprivileged, so there we
 *  remove-then-create a junction in place. A junction needs an ABSOLUTE target
 *  (POSIX keeps the relative "versions/<sha7>" so the link survives a moved
 *  plugin dir); rmSync on a junction drops only the link, never the target. */
function swapCurrent(name, target) {
  const current = pluginCurrentDir(name);
  mkdirSync(pluginDir(name), { recursive: true });
  if (IS_WINDOWS) {
    rmSync(current, { force: true });
    symlinkSync(resolve(pluginDir(name), target), current, 'junction');
    return;
  }
  const tmp = `${current}.tmp`;
  rmLink(tmp);
  symlinkSync(target, tmp);
  renameSync(tmp, current);
}

/** §6.1 step 4: failure before swap+lock landed -> delete the partial version
 *  dir, restore/remove current, tidy now-empty dirs. Prior state untouched. */
function cleanupFailedVersion(name, versionDir, prevCurrent) {
  rmSync(versionDir, { recursive: true, force: true });
  rmLink(`${pluginCurrentDir(name)}.tmp`);
  if (prevCurrent) { try { swapCurrent(name, prevCurrent); } catch { /* best effort */ } }
  else rmLink(pluginCurrentDir(name));
  for (const d of [join(pluginDir(name), 'versions'), pluginDir(name)]) {
    try { if (readdirSync(d).length === 0) rmSync(d, { recursive: true, force: true }); } catch { /* absent */ }
  }
}

/** Problem lines for a refusal message. `level` is a REPORTING axis, not a
 *  cause axis — a plugin whose declared API makes its data problems WARNINGS
 *  must never be refused with an empty body, so fall back to every problem when
 *  no error line exists. */
function refusalLines(problems, prefix = '  - ') {
  const errorsOnly = problems.filter((p) => p.level === 'error');
  return (errorsOnly.length ? errorsOnly : problems).map((p) => `${prefix}${p.message}`);
}

function validated(name, versionDir) {
  const v = validatePluginDir(versionDir);
  if (!v.ok) {
    throw new Error(`plugin "${name}" failed validation:\n${refusalLines(v.problems).join('\n')}`);
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
    let workflowSkips = null;
    try {
      const wf = await importPluginWorkflows(name, versionDir);
      workflowSkips = wf.skipped;
      for (const s of wf.skipped) {
        console.warn(`[plugin-store] ${name}: workflow ${s.file} not imported (${s.errors.join('; ')})`);
      }
    } catch (err) {
      console.warn(`[plugin-store] ${name}: workflow import failed (${err?.message || err}) — plugin installed; re-import via update`);
    }
    // The receipt says what actually landed: `inventory` is what the plugin
    // SHIPS, `ignored` is the subset worca refused to load (spec §9.3 drops).
    const ignored = ignoredContributions(name, versionDir, workflowSkips ? { workflowSkips } : {});
    return { ok: true, inventory, warnings, ignored };
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
    let workflowSkips = null;
    try {
      const wf = await importPluginWorkflows(name, versionDir);
      workflowSkips = wf.skipped;
      for (const s of wf.skipped) {
        console.warn(`[plugin-store] ${name}: workflow ${s.file} not imported (${s.errors.join('; ')})`);
      }
    } catch (err) {
      console.warn(`[plugin-store] ${name}: workflow import failed (${err?.message || err}) — plugin updated; re-import via update`);
    }
    const ignored = ignoredContributions(name, versionDir, workflowSkips ? { workflowSkips } : {});
    return { ok: true, updated: true, inventory, warnings, ignored, ...cand };
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
  // Bindings live in the DB, not in the plugin's data dir, so they would
  // outlive the uninstall: a stale row silently rebinds a project the moment
  // the plugin is reinstalled with a same-named profile — possibly pointing at
  // a different tracker. Cleared HERE (not only in the server's DELETE route)
  // so the CLI's `worca plugin remove` drops them too.
  clearBindingsForPlugin(name);
  rmLink(pluginCurrentDir(name)); // symlink in real installs, a plain dir in test fixtures
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
  // ONE registry load for the whole list: it is the only place that knows which
  // sidecars were dropped, and re-scanning per plugin would be N full scans.
  const drops = [];
  let registry = null;
  try { registry = loadAgentRegistry(undefined, { onDrop: (d) => drops.push(d) }); }
  catch { /* no resolvable home: fall back to the file-derived view */ }
  return Object.keys(lock).sort().map((name) => {
    const e = lock[name] || {};
    const cur = pluginCurrentDir(name);
    const manifest = existsSync(cur) ? readManifestAt(cur) : null; // existsSync follows the symlink
    const inv = manifest ? buildInstallInventory(cur) : null;
    // Read from the raw dir, not the manifest: the mismatch is about the DATA
    // the plugin ships, not about whether its manifest normalized. A plugin
    // whose manifest did not normalize is `broken`, which outranks this.
    const mismatch = manifest
      ? apiMismatch(manifest.engines?.worcaApi ?? '', dataContractIssues(cur))
      : null;
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
      apiMismatch: mismatch,
      contributions: inv
        ? { agents: inv.agents.length, taskSources: inv.taskSources.length, chatChannels: inv.chatChannels.length, models: inv.models.length, skills: inv.skills.length, workflows: inv.workflows.length }
        : { agents: 0, taskSources: 0, chatChannels: 0, models: 0, skills: 0, workflows: 0 },
      // `contributions` counts what the plugin SHIPS (files on disk); `ignored`
      // names the ones worca refused to load, so the card can stop claiming them.
      // A disabled plugin contributes nothing BY CHOICE — its agents are not in the
      // registry, so its templates would misreport V4.
      ignored: manifest && e.enabled !== false ? ignoredContributions(name, cur, { registry, drops }) : [],
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
  // The DATA contract check is ADVISORY, so it lives HERE and never in
  // dirChecks: dirChecks also feeds the install precheck, which THROWS on any
  // failing check, and an outdated data contract must never block an install —
  // the plugin's connector/chat channel still works untouched, worca simply
  // ignores the agents and pipeline templates it ships (spec §9, P7.2).
  if (manifest) {
    const mismatch = apiMismatch(manifest.engines?.worcaApi ?? '', dataContractIssues(cur));
    checks.push({ id: 'agents-api', ok: !mismatch,
      detail: mismatch ? mismatch.message : 'agents and pipeline templates are plugin API 3 (meta v2 + graph templates)' });
  }
  // Same gate as the card: a disabled plugin contributes nothing BY CHOICE — its
  // agents are not in the registry, so its templates would misreport V4 and this
  // check would fail a plugin that is merely switched off.
  if (manifest && entry.enabled !== false) {
    const ignored = ignoredContributions(name, cur);
    c('contributions', ignored.length === 0,
      ignored.length
        ? `${ignored.length} ignored: ${ignored.map((i) => `${i.file} — ${i.reason}`).join('; ')}`
        : 'every shipped contribution loaded');
  }
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
      const { listProfileIds } = await import('./plugin-config.mjs');
      for (const s of manifest.taskSources) {
        // A multi-profile source stores nothing in the implicit default bucket;
        // validating that would flag a fully configured plugin as broken. Check
        // each roster profile instead. An EMPTY roster is not healthy-by-vacuity
        // either: every run of the source is rejected ("profile is required")
        // until one exists, and validating the default bucket instead can even
        // report green off legacy config migrated under 'default' after an
        // upgrade flipped the source to multiProfile — a plugin nothing can run.
        const profiles = s.multiProfile ? listProfileIds(name) : [];
        if (s.multiProfile && !profiles.length) {
          c(`config:${s.id}`, false, 'no profiles yet — create one in Plugins settings (every run is rejected until then)');
          continue;
        }
        for (const profile of profiles.length ? profiles : [undefined]) {
          const id = profile ? `config:${s.id}@${profile}` : `config:${s.id}`;
          try {
            const r = await shim.callSource({ plugin: name, sourceId: s.id, op: 'validateConfig', profile });
            c(id, r?.ok !== false, r?.ok === false ? JSON.stringify(r.errors ?? r) : 'validateConfig ok');
          } catch (err) {
            c(id, false, String(err?.message || err));
          }
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
  if (!v.ok) throw new Error(`cannot link: ${refusalLines(v.problems, '').join('; ')}`);
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
