// src/core/marketplace-publish.mjs
// Export → Worca plugin → Marketplace (#717). Builds the plugin in a scratch clone of a
// registered GitHub / Azure DevOps marketplace, lists it in worca-cc-marketplace.json, validates
// it (lint, shipped script cases, .gitignore, the marketplace's OWN discovery on the new commit),
// then pushes ONE commit to worca/plugin/<name> — on a fork when the credential cannot push — and
// opens (or reuses) the pull request. Never pushes to the base branch; never writes the stored
// marketplace URL (userinfo) anywhere: the clone URL is rebuilt from its parsed parts.
// Every git/forge call goes through `_deps` (tests: local bare repos + a scripted forge).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, sep } from 'node:path';
import { listMarketplaces } from './marketplaces.mjs';
import { discoverAtCommit, parseMarketplaceManifest } from './plugin-repo.mjs';
import { exportWorkflowPlugin } from './workflow-export.mjs';
import { readWorkflow } from './workflows.mjs';
import { exportContentOf } from './workflow-share.mjs';
import { PLUGIN_NAME_RE } from './plugin-manifest.mjs';
import { runPluginScriptCases } from './plugin-script-cases.mjs';
import { parseRemoteUrl, forgeOf, remoteRepoSlug, FORGE_LABEL } from './forge.mjs';
import { gitEnvFor, stripHostCredentials, isTrackerTokenKey } from './host-credentials.mjs';
import { readAzureCredentials, AZURE_DEVOPS_CREDENTIAL_KEYS } from './azure-credentials.mjs';
import { GITHUB_CREDENTIAL_KEYS } from './github-credentials.mjs';
import { parseCloneAllow, cloneAllowed } from './clone-project.mjs';
import { hasTokenShape } from './mcp-secrets.mjs';
import { createPr, editPrBody, ghRepoAccess, ghForkRepo, prProviderFor } from './git-info.mjs';
import { hookFreeArgs, isSafeBranchName, scrubGitText, classifyFetchError } from './git-sync.mjs';
import { prAttributionFooter } from './identity.mjs';

export const INDEX_FILE = 'worca-cc-marketplace.json';
export const BRANCH_PREFIX = 'worca/plugin/';

const err = (message, code, extra = {}) => Object.assign(new Error(message), { code, ...extra });

/** worca/plugin/<name>: one branch — and so one pull request — per plugin. */
export function pluginBranchName(name) { return `${BRANCH_PREFIX}${name}`; }

/** plugins/<name> when the marketplace has an index; <name> at the root otherwise (discovery scans depth 0-1 only). */
export function pluginSubdir(name, hasIndex) { return hasIndex ? `plugins/${name}` : name; }

/** A kebab-case plugin name from free text (the pipeline name when none is typed); '' when none can be made. */
export function derivePluginName(raw) {
  const s = String(raw || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '');
  return PLUGIN_NAME_RE.test(s) ? s : '';
}

/**
 * The PR target of a marketplace entry, or null when it cannot take one: only github.com and Azure
 * DevOps remotes (a local folder, file://, GHE or another host has no PR API worca drives — D6).
 * `cloneUrl` is REBUILT from the parsed parts (D7). Pure.
 */
export function publishTargetOf(entry) {
  if (!entry || typeof entry.url !== 'string') return null;
  const parsed = parseRemoteUrl(entry.url);
  const forge = forgeOf(parsed);
  if (!forge) return null;
  const enc = encodeURIComponent;
  const cloneUrl = forge === 'github'
    ? `https://github.com/${parsed.owner}/${parsed.repo}.git`
    : `https://dev.azure.com/${enc(parsed.org)}/${enc(parsed.project)}/_git/${enc(parsed.repo)}`;
  return {
    id: entry.id, name: entry.name || entry.id,
    ref: typeof entry.ref === 'string' && entry.ref ? entry.ref : null,
    forge, label: FORGE_LABEL[forge], parsed, slug: remoteRepoSlug(parsed), cloneUrl,
    webUrl: cloneUrl.replace(/\.git$/, ''),
  };
}

/**
 * Why marketplace `entry` cannot take a pull request from this Worca, or null. Not a github.com /
 * Azure DevOps remote (D6), or outside WORCA_CLONE_ALLOW when the deployment sets it (D17: the
 * same rule a hosted project clone applies, clone-project.mjs). Pure.
 */
export function publishRefusal(entry, { env = process.env } = {}) {
  const t = publishTargetOf(entry);
  if (!t) return 'not a GitHub or Azure DevOps repository';
  const { host, owner, repo } = t.parsed;                 // Azure: owner = "org/project", decoded
  if (!cloneAllowed(parseCloneAllow(env.WORCA_CLONE_ALLOW), { host, owner, repo })) return `${host}/${owner}/${repo} is not in WORCA_CLONE_ALLOW`;
  return null;
}

/** Registered marketplaces split into PR targets and the rest (with why). No network. */
export function listPublishTargets(entries = listMarketplaces(), { env = process.env } = {}) {
  const targets = [];
  const skipped = [];
  for (const m of entries) {
    const reason = publishRefusal(m, { env });
    if (reason) { skipped.push({ id: m.id, name: m.name || m.id, reason }); continue; }
    const t = publishTargetOf(m);
    targets.push({ id: t.id, name: t.name, forge: t.forge, label: t.label, repo: t.slug, ref: t.ref, url: t.webUrl });
  }
  return { targets, skipped };
}

/**
 * The folder plugin `name` goes to: `subdir` (pluginSubdir's default), unless the marketplace's own
 * discovery lists the same name in another folder — then THAT folder, so a plugin kept at e.g.
 * `tools/<name>` is updated in place (renaming it would fork the plugin's identity). The same name at
 * the repository root (a marketplace that IS one plugin, no index) → CONFLICT: exporting into the
 * root would rewrite the repository itself. Pure; the caller runs this BEFORE the symlink guard and
 * every read, so the guard covers the folder the export really writes into.
 */
export function placementSubdir({ name, subdir, discovered }) {
  const elsewhere = discovered.find((d) => d.name === name && d.subdir !== subdir);
  if (!elsewhere) return subdir;
  if (elsewhere.subdir === '') {
    throw err(`plugin "${name}" already lives at the repository root of this marketplace — Worca does not export into a repository root; pick another plugin name`, 'CONFLICT');
  }
  return elsewhere.subdir;
}

/**
 * Where plugin `name` goes and whether that is an update (#717 §3-4): `{ subdir, update }` with
 * `subdir` resolved by placementSubdir (the default folder, or the one discovery already lists the
 * name at — an update in place; the root → CONFLICT). `folderManifestName` is the manifest read from
 * THAT folder: a folder holding another plugin (or an unreadable manifest), or a folder (or file)
 * that is not a plugin → CONFLICT; an index the marketplace's own discovery would ignore →
 * MARKETPLACE_INVALID. Idempotent over its own result. Pure.
 */
export function placePlugin({ name, subdir, paths, index, discovered, folderManifestName }) {
  if (index.present && !index.ok) {
    throw err(`${INDEX_FILE} in this marketplace is invalid (${(index.errors || []).join('; ')}) — fix it there first`, 'MARKETPLACE_INVALID');
  }
  const target = placementSubdir({ name, subdir, discovered });
  const hasManifest = paths.includes(`${target}/worca-cc-plugin.json`);
  if (hasManifest && folderManifestName !== name) {
    throw err(`${target}/ holds plugin "${folderManifestName ?? '(unreadable manifest)'}" — pick another plugin name`, 'CONFLICT');
  }
  if (!hasManifest && (paths.includes(target) || paths.some((p) => p.startsWith(`${target}/`)))) {
    throw err(`${target} already exists and is not a Worca plugin — pick another plugin name`, 'CONFLICT');
  }
  return { subdir: target, update: hasManifest };
}

/**
 * `git ls-tree -r -z HEAD` → { paths, symlinks }: every committed file, and those of them that are
 * symbolic links (mode 120000). `-z`: NUL-separated and unquoted (a non-ASCII name would otherwise
 * come back C-quoted). Each row is `<mode> SP <type> SP <sha> TAB <path>`. Pure.
 */
export function parseLsTree(text) {
  const paths = [];
  const symlinks = [];
  for (const row of String(text || '').split('\0')) {
    const tab = row.indexOf('\t');
    if (tab < 0) continue;
    const path = row.slice(tab + 1);
    paths.push(path);
    if (row.startsWith('120000 ')) symlinks.push(path);
  }
  return { paths, symlinks };
}

/**
 * A marketplace is someone else's repository: a committed symlink checks out as a real one, and every
 * mkdir / file write / index rewrite after it follows the link out of the scratch clone. Refuse —
 * before anything is read or written — when one sits at the index file, at or above the plugin
 * folder (an ancestor shows up in the tree as ONE blob path, never as `plugins/…`), or inside it.
 * The same distrust plugin-repo's install path applies (exportSkillsAt, findEscapingSymlinks). Pure.
 */
export function assertNoSymlinkOnPath(symlinks, subdir) {
  const parts = subdir.split('/');
  const onPath = new Set([INDEX_FILE, ...parts.map((_, i) => parts.slice(0, i + 1).join('/'))]);
  const hit = symlinks.find((p) => onPath.has(p) || p.startsWith(`${subdir}/`));
  if (hit) throw err(`${hit} is a symbolic link in this marketplace — Worca will not write through it; replace it with a real file or folder there first`, 'MARKETPLACE_INVALID');
}

/** Append `subdir` to the index's `plugins` (others, other keys and the file's indent untouched;
 *  trailing newline). Idempotent. Pure. → { text, changed } */
export function addToIndex(text, subdir) {
  const raw = JSON.parse(text);
  if (raw.plugins.some((p) => typeof p === 'string' && p.replace(/\/+$/, '') === subdir)) return { text, changed: false };
  const indent = /^[ \t]+(?=")/m.exec(text)?.[0] || 2;
  return { text: JSON.stringify({ ...raw, plugins: [...raw.plugins, subdir] }, null, indent) + '\n', changed: true };
}

/** `update` = the folder already held this plugin at the base (placePlugin). Versions may be null
 *  (a hand-authored manifest without one) — never print "vnull". */
export function buildPrTitle({ name, update, oldVersion, newVersion }) {
  if (!update) return newVersion ? `Add plugin ${name} v${newVersion}` : `Add plugin ${name}`;
  if (oldVersion && newVersion && oldVersion !== newVersion) return `Update plugin ${name} ${oldVersion} → ${newVersion}`;
  if (oldVersion && oldVersion === newVersion) return `Update plugin ${name} (list it in the marketplace index)`;   // index-only PR
  return `Update plugin ${name}`;
}

/** D18: the version, worded once for the PR body, the CLI and the done screen — never "null". Pure. */
export function describeVersion({ update, oldVersion, newVersion }) {
  if (!update) return `new, ${newVersion || 'unversioned'}`;
  if (oldVersion && newVersion && oldVersion !== newVersion) return `${oldVersion} → ${newVersion}`;
  return `${newVersion || oldVersion || 'unversioned'} (unchanged)`;
}

const USERINFO_URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i;
const PRIVATE_KEY_RE = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/;
const MAX_SCAN_BYTES = 2 * 1024 * 1024;

/**
 * D15: the staged plugin files that hold a credential — a token shape (mcp-secrets hasTokenShape,
 * linear on untrusted text), a PEM private key, a URL with userinfo, or the exact value of a
 * credential this Worca holds (≥ 8 chars; shorter ones would match ordinary text).
 * → [{ rel, kind }] — never the value. Pure.
 */
export function findCredentialLeaks(files, liveValues = []) {
  const values = [...new Set(liveValues.filter((v) => typeof v === 'string' && v.length >= 8))];
  const hits = [];
  for (const { rel, text } of files) {
    if (typeof text !== 'string') continue;
    if (values.some((v) => text.includes(v))) hits.push({ rel, kind: 'a credential this Worca uses' });
    else if (hasTokenShape(text)) hits.push({ rel, kind: 'a token-shaped string' });
    else if (PRIVATE_KEY_RE.test(text)) hits.push({ rel, kind: 'a private key' });
    else if (USERINFO_URL_RE.test(text)) hits.push({ rel, kind: 'a URL with a user name and password' });
  }
  return hits;
}

const KINDS = [['workflows', 'Workflows'], ['agents', 'Agents'], ['scripts', 'Scripts'], ['skills', 'Skills']];

/** [label, rels[]] groups of plugin files by top folder; anything else (the manifest) is "Manifest". */
function groupByKind(paths, subdir) {
  const groups = new Map([...KINDS.map(([, label]) => [label, []]), ['Manifest', []]]);
  for (const p of paths) {
    const rest = p.slice(subdir.length + 1);
    const label = (KINDS.find(([k]) => k === rest.split('/')[0]) || [null, 'Manifest'])[1];
    groups.get(label).push(rest);
  }
  return [...groups].filter(([, list]) => list.length);
}

/**
 * The generated PR description (#717 §6). Repo-relative paths, names and versions only — never a
 * local path, URL or credential. Azure trims it to 4,000 chars itself (pr/azure.mjs fitDescription).
 */
export function buildPrBody({ name, subdir, update, oldVersion, newVersion, workflow, created, updated, builtins = [], skippedSkills = [], indexAdded, validation, startedBy = null }) {
  const L = ['## Plugin', '', `- **Name:** \`${name}\``,
    `- **Version:** ${describeVersion({ update, oldVersion, newVersion })}`,
    `- **Folder:** \`${subdir}/\``];
  if (workflow) L.push(`- **Workflow:** ${workflow}`);
  for (const [title, list] of [['Created', created], ['Updated', updated]]) {
    if (!list.length) continue;
    L.push('', `## ${title}`, '');
    for (const [label, rels] of groupByKind(list, subdir)) L.push(`- **${label}:** ${rels.map((r) => `\`${r}\``).join(', ')}`);
  }
  if (indexAdded) L.push('', '## Marketplace index', '', `- \`${INDEX_FILE}\`: adds \`${subdir}\` to \`plugins\``);
  if (builtins.length || skippedSkills.length) {
    L.push('', '## Left out (they ship with every Worca)', '');
    if (builtins.length) L.push(`- **Built-in agents/scripts:** ${builtins.join(', ')}`);
    if (skippedSkills.length) L.push(`- **Built-in skills:** ${skippedSkills.join(', ')}`);
  }
  L.push('', '## Validation', '', `- Plugin lint: ${validation.lint}`, `- Shipped script cases: ${validation.cases}`,
    `- Marketplace discovery: ${validation.discovery}`);
  return L.join('\n') + prAttributionFooter(startedBy);
}

const execFileP = promisify(execFile);
const GIT_TIMEOUT_MS = 120_000;
// Never from the ambient env: a hook/CI GIT_DIR would retarget the repo; GIT_AUTHOR_* beat -c user.* (D14).
const STRIP_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR', 'GIT_PREFIX',
  'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_AUTHOR_DATE', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_COMMITTER_DATE'];

/**
 * git in `cwd` → { ok, stdout, stderr, code }. Never throws. `env` is the full env for a network
 * call (a gitEnvFor result: the token rides a credential helper, never argv or the URL); local calls
 * get every host credential stripped. Hook-free (git-sync hookFreeArgs) and unsigned.
 */
function defaultGit(cwd, args, { env = null, timeoutMs = GIT_TIMEOUT_MS } = {}) {
  const base = { ...(env || stripHostCredentials(process.env)) };
  for (const k of STRIP_ENV) delete base[k];
  const argv = [...hookFreeArgs(), '-c', 'commit.gpgsign=false', '-c', 'push.gpgSign=false', ...args];
  return new Promise((done) => {
    execFile('git', argv, {
      cwd, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 32 * 1024 * 1024,
      env: { ...base, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '', GIT_PAGER: 'cat' },
    }, (e, stdout, stderr) => done({
      ok: !e, code: e ? (typeof e.code === 'number' ? e.code : -1) : 0,
      stdout: String(stdout || ''), stderr: String(stderr || '') || (e ? String(e.message) : ''),
    }));
  });
}

/** plugin-repo's discovery over the scratch clone: local commands only, no credential. */
const localExec = (cmd, args) => execFileP(cmd, args, {
  maxBuffer: 16 * 1024 * 1024, timeout: 60_000, killSignal: 'SIGKILL',
  env: { ...stripHostCredentials(process.env), GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
});

const DEFAULT_DEPS = Object.freeze({
  git: defaultGit,
  /** {env, error} for a network git call against a HOSTED url (role read|write) — Ship it?'s path (D1). */
  gitEnv: (role, url) => gitEnvFor(role, url),
  /** The URL git actually talks to for a hosted URL: itself (tests map it to a local bare repo). */
  transport: (url) => url,
  access: (target) => (target.forge === 'github' ? ghRepoAccess({ repo: target.slug }) : Promise.resolve({ ok: true, canPush: null })),
  fork: (target) => ghForkRepo({ repo: target.slug }),
  providerAvailable: (target) => prProviderFor(target.parsed).available(),
  createPr,
  editPrBody,
  runCases: (dir) => runPluginScriptCases(dir),
  discover: (gitDirPath, sha) => discoverAtCommit(gitDirPath, sha, { exec: localExec }),
});
let _deps = DEFAULT_DEPS;
export const _testing = {
  defaultGit,
  setDeps(over) { _deps = { ...DEFAULT_DEPS, ...over }; },
  reset() { _deps = DEFAULT_DEPS; },
};

async function mustGit(d, cwd, args, scrub, opts) {
  const r = await d.git(cwd, args, opts);
  if (!r.ok) {
    const verb = args.find((a, i) => !a.startsWith('-') && args[i - 1] !== '-c') || 'git';
    throw err(`git ${verb} failed: ${scrub(r.stderr)}`, 'GIT_FAILED');
  }
  return r.stdout.trim();
}

/** Run `fn`; a throw keeps its .code (and .problems/.errors) but its message is scrubbed — an
 *  exportWorkflowPlugin / discovery error names scratch paths (`${dir} is plugin …`, git stderr). */
async function scrubbed(scrub, fn) {
  try { return await fn(); } catch (e) {
    const out = err(scrub(e && e.message ? e.message : String(e)), (e && e.code && typeof e.code === 'string') ? e.code : 'GIT_FAILED');
    if (Array.isArray(e?.problems)) out.problems = e.problems;
    if (Array.isArray(e?.errors)) out.errors = e.errors;
    throw out;
  }
}

// D15: the token-VALUED credential variables (an App id, installation id or key-file path is not a secret
// and would match ordinary numbers/paths). WORCA_GIT_TOKEN / GH_TOKEN carry a minted or push-as-me token.
const TOKEN_ENV_KEYS = [...GITHUB_CREDENTIAL_KEYS, ...AZURE_DEVOPS_CREDENTIAL_KEYS, 'WORCA_ADO_BOARDS_TOKEN']
  .filter((k) => !/_APP_ID$|_INSTALLATION_ID$|_KEY_FILE$/.test(k));
/** D15: the credential VALUES this Worca holds (never logged; only compared). */
function liveCredentialValues(...envs) {
  const az = readAzureCredentials();
  const trackers = (e) => Object.keys(e || {}).filter(isTrackerTokenKey).map((k) => e[k]);   // WORCA_JIRA_TOKEN(_*)
  return [...[process.env, ...envs].flatMap((e) => [...TOKEN_ENV_KEYS.map((k) => e && e[k]), ...trackers(e)]), az.read, az.write]
    .filter((v) => typeof v === 'string' && v);
}

/** D15/D16: the staged plugin files — {rel, status} from the index vs the base, text when scannable.
 *  `-z`: NUL-separated and unquoted (a non-ASCII name would otherwise come back C-quoted, fail the
 *  read and go unscanned). With --name-status -z each row is `<status>\0<path>\0`. */
async function stagedFiles(d, repo, baseSha, subdir, scrub) {
  const diff = await d.git(repo, ['diff', '--cached', '-z', '--name-status', '--no-renames', baseSha, '--', subdir]);
  if (!diff.ok) throw err(`git diff failed: ${scrub(diff.stderr)}`, 'GIT_FAILED');
  const parts = diff.stdout.split('\0');                  // NOT trimmed: a path may end in a space
  const rows = [];
  for (let i = 0; i + 1 < parts.length; i += 2) if (parts[i]) rows.push({ status: parts[i][0], rel: parts[i + 1] });
  for (const r of rows) {
    if (r.status === 'D') continue;
    try {
      const buf = await readFile(join(repo, ...r.rel.split('/')));
      if (buf.length <= MAX_SCAN_BYTES && !buf.includes(0)) r.text = buf.toString('utf8');
    } catch { /* unreadable: nothing to scan */ }
  }
  return rows;
}

async function readJsonOrNull(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

async function readIndex(repo, paths) {
  if (!paths.includes(INDEX_FILE)) return { present: false, ok: true, text: null };
  const text = await readFile(join(repo, INDEX_FILE), 'utf8');
  let mp;
  try { mp = parseMarketplaceManifest(JSON.parse(text)); } catch (e) { return { present: true, ok: false, errors: [`invalid JSON (${e.message})`], text }; }
  return mp.ok ? { present: true, ok: true, text } : { present: true, ok: false, errors: mp.errors, text };
}

/** The remote's default branch: `ls-remote --symref <url> HEAD` (the bare plugin cache's HEAD is
 *  frozen at clone time — never read it for this). */
async function remoteDefaultBranch(d, cwd, url, env, scrub) {
  const r = await d.git(cwd, ['ls-remote', '--symref', url, 'HEAD'], { env });
  const m = /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/m.exec(r.stdout || '');
  if (!r.ok || !m) throw err(`could not read the marketplace's default branch: ${scrub(r.stderr) || 'the remote reports no HEAD'}`, 'GIT_FAILED');
  return m[1];
}

async function identityArgs(d, repo) {
  const n = await d.git(repo, ['config', 'user.name']);
  const e = await d.git(repo, ['config', 'user.email']);
  return n.ok && n.stdout.trim() && e.ok && e.stdout.trim() ? [] : ['-c', 'user.name=Worca', '-c', 'user.email=worca@local'];
}

/** No push access: a GitHub fork (created or found); Azure DevOps cannot take a cross-repo PR (D5). */
async function forkTarget(d, target, scrub) {
  if (target.forge !== 'github') {
    throw err(`no push access to ${target.slug}, and ${target.label} pull requests cannot come from a fork — ask for push access to the marketplace`, 'FORK_FAILED');
  }
  const f = await d.fork(target);
  if (!f.ok) throw err(`no push access to ${target.slug}, and forking it failed: ${scrub(f.error)}`, 'FORK_FAILED');
  return { realUrl: `https://github.com/${f.slug}.git`, fork: { ...f, parsed: { host: 'github.com', owner: f.owner, repo: f.repo } } };
}

/**
 * Put `sha` on `branch` of the push remote (D9): skipped when its tip already has this tree; else
 * --force-with-lease against the tip seen (empty = must not exist), so a stale branch from a merged
 * or closed PR is replaced and a concurrent push is never clobbered.
 * → { ok:true, pushed } | { ok:false, kind, error }
 */
async function pushOnce(d, repo, push, branch, sha, scrub) {
  const cred = await d.gitEnv('write', push.realUrl);
  if (cred.error) return { ok: false, kind: 'auth', error: scrub(cred.error) };
  const url = d.transport(push.realUrl);
  const ls = await d.git(repo, ['ls-remote', url, `refs/heads/${branch}`], { env: cred.env });
  if (!ls.ok) return { ok: false, kind: classifyFetchError(ls.stderr), error: scrub(ls.stderr) };
  const tip = (ls.stdout.trim().split(/\s+/)[0] || '');
  if (tip) {
    const f = await d.git(repo, ['fetch', '--quiet', '--no-tags', url, `refs/heads/${branch}`], { env: cred.env });
    if (f.ok) {
      const mine = await d.git(repo, ['rev-parse', `${sha}^{tree}`]);
      const theirs = await d.git(repo, ['rev-parse', `${tip}^{tree}`]);
      if (mine.ok && theirs.ok && mine.stdout.trim() === theirs.stdout.trim()) return { ok: true, pushed: false };
    }
  }
  const r = await d.git(repo, ['push', '--quiet', '--no-verify', `--force-with-lease=refs/heads/${branch}:${tip}`, url, `${sha}:refs/heads/${branch}`], { env: cred.env });
  if (!r.ok) return { ok: false, kind: classifyFetchError(r.stderr), error: scrub(r.stderr) };
  return { ok: true, pushed: true };
}

/**
 * Export workflow `workflowId` as plugin `pluginName` into marketplace `marketplaceId` through a PR.
 * status: 'dry-run' | 'unchanged' (the base already has it — no PR) | 'up-to-date' (the open PR's
 * branch already has it) | 'opened' | 'updated' (pushed to the open PR's branch).
 * Errors (err.code): BAD_REQUEST | NOT_FOUND | UNSUPPORTED | CONFLICT | MARKETPLACE_INVALID |
 * VALIDATION_FAILED (+ .problems) | DISCOVERY_FAILED | GIT_FAILED | FORK_FAILED | PUSH_FAILED |
 * PR_FAILED, plus every exportWorkflowPlugin code. Nothing is pushed before every check passed.
 * `use` (D17): what is exported, 'draft' (the default) or a saved version number.
 */
export async function exportWorkflowToMarketplace({ workflowId, marketplaceId, pluginName, draft = false, dryRun = false, startedBy = null, repoRoot, use = 'draft' } = {}) {
  const d = _deps;
  if (!workflowId || typeof workflowId !== 'string') throw err('workflowId is required', 'BAD_REQUEST');
  if (!marketplaceId || typeof marketplaceId !== 'string') throw err('marketplaceId is required', 'BAD_REQUEST');
  const entry = listMarketplaces().find((m) => m.id === marketplaceId);
  if (!entry) throw err(`marketplace not found: ${marketplaceId}`, 'NOT_FOUND');
  const refusal = publishRefusal(entry);
  if (refusal) throw err(`marketplace "${entry.name || entry.id}" cannot take a pull request from this Worca: ${refusal}`, 'UNSUPPORTED');
  const target = publishTargetOf(entry);
  // D17: `use` picks the content only; the plugin name and its PR branch come from the stored workflow.
  const tpl = await readWorkflow(workflowId);
  if (!exportContentOf(tpl, use)) throw err(`workflow not found: ${workflowId}`, 'NOT_FOUND');
  const asked = typeof pluginName === 'string' ? pluginName.trim() : '';
  const name = asked || derivePluginName(tpl.name);
  if (!name || !PLUGIN_NAME_RE.test(name) || name.length > 64) {
    throw err(`plugin name must be kebab-case — lowercase letters, digits and hyphens, starting with a letter (got "${asked || tpl.name}")`, 'BAD_REQUEST');
  }
  const branch = pluginBranchName(name);
  if (target.ref && !isSafeBranchName(target.ref)) throw err(`the marketplace tracks an unusable branch name "${target.ref}"`, 'BAD_REQUEST');
  if (!dryRun) {
    const avail = await d.providerAvailable(target);
    if (!avail.ok) throw err(`cannot create a ${target.label} PR here: ${avail.reason}`, 'UNSUPPORTED');
  }

  const work = await mkdtemp(join(tmpdir(), 'worca-mkt-publish-'));
  let realWork = work;
  try { realWork = realpathSync(work); } catch { /* keep work */ }
  const scrub = (s) => scrubGitText(String(s ?? '').split(realWork).join('<scratch>').split(work).join('<scratch>'));
  const repo = join(work, 'repo');
  try {
    // 1. Base branch + a fresh single-branch clone of it (D8).
    const read = await d.gitEnv('read', target.cloneUrl);
    if (read.error) throw err(`no credential for ${target.slug}: ${scrub(read.error)}`, 'GIT_FAILED');
    const remote = d.transport(target.cloneUrl);
    const base = target.ref || await remoteDefaultBranch(d, work, remote, read.env, scrub);
    if (!isSafeBranchName(base)) throw err(`unusable base branch name "${base}"`, 'GIT_FAILED');
    // core.symlinks=false (persisted in the clone): should a committed link slip past the check below, it is a plain file there, never a link to follow.
    const cl = await d.git(work, ['clone', '--quiet', '--no-tags', '--single-branch', '-c', 'core.symlinks=false', '--branch', base, remote, repo], { env: read.env });
    if (!cl.ok) throw err(`could not clone ${target.slug} (${base}): ${scrub(cl.stderr)}`, 'GIT_FAILED');
    const baseSha = await mustGit(d, repo, ['rev-parse', 'HEAD'], scrub);
    const gitDirAbs = await mustGit(d, repo, ['rev-parse', '--absolute-git-dir'], scrub);

    // 2. Placement, by the marketplace's own discovery at the base. discoverAtCommit reads the commit
    //    through git (ls-tree, show), never the checkout, so it runs before the symlink guard; the
    //    guard then covers the RESOLVED folder — the default one, or the one the plugin already lives in.
    const lsTree = await d.git(repo, ['ls-tree', '-r', '-z', 'HEAD']);
    if (!lsTree.ok) throw err(`git ls-tree failed: ${scrub(lsTree.stderr)}`, 'GIT_FAILED');
    const { paths, symlinks } = parseLsTree(lsTree.stdout);
    const atBase = await scrubbed(scrub, () => d.discover(gitDirAbs, baseSha));
    const subdir = placementSubdir({ name, subdir: pluginSubdir(name, paths.includes(INDEX_FILE)), discovered: atBase.discovered });
    assertNoSymlinkOnPath(symlinks, subdir);                // before ANY read of, or write into, the checkout
    const index = await readIndex(repo, paths);
    const pluginDir = join(repo, ...subdir.split('/'));
    const folderManifest = await readJsonOrNull(join(pluginDir, 'worca-cc-plugin.json'));
    const { update } = placePlugin({ name, subdir, paths, index, discovered: atBase.discovered,
      folderManifestName: folderManifest && typeof folderManifest.name === 'string' ? folderManifest.name : null });
    const oldVersion = update && typeof folderManifest.version === 'string' ? folderManifest.version : null;

    // 3. Branch + the export itself (the clone is scratch: even a dry run applies here).
    await mustGit(d, repo, ['checkout', '-q', '-b', branch], scrub);
    const plan = await scrubbed(scrub, () => exportWorkflowPlugin({ workflowId, targetDir: pluginDir, pluginName: name, repoRoot, use }));
    const manifestPath = join(pluginDir, 'worca-cc-plugin.json');
    const rel = (p) => relative(repo, p).split(sep).join('/');
    const contentChanged = [...plan.created, ...plan.updated].some((p) => p !== manifestPath);

    // 4. The index entry (index present only; without one the depth-1 scan finds <name>/).
    let indexAdded = false;
    if (index.present) {
      const next = addToIndex(index.text, subdir);
      if (next.changed) { await writeFile(join(repo, INDEX_FILE), next.text, 'utf8'); indexAdded = true; }
    }
    const result = {
      status: null,
      marketplace: { id: target.id, name: target.name, forge: target.forge, repo: target.slug, url: target.webUrl },
      name, subdir, branch, base, update, oldVersion, newVersion: plan.version,
      versionText: describeVersion({ update, oldVersion, newVersion: plan.version }),
      files: {
        created: plan.created.map(rel), updated: plan.updated.map(rel), noop: plan.noop.map(rel),
        skipped: plan.skipped.map((s) => ({ path: rel(s.path), reason: s.reason })),
      },
      index: { present: index.present, added: indexAdded },
      warnings: plan.warnings.map(scrub),
      validation: null, title: null, body: null,
      pushTo: null, fork: null, prUrl: null, existed: false, draft: false,
    };
    if (!contentChanged && !indexAdded) {
      const v = oldVersion ?? plan.version;
      return { ...result, status: 'unchanged', newVersion: v, versionText: v || 'unversioned' };
    }

    // 5. Validation — every check before anything leaves this machine.
    if (contentChanged && oldVersion && plan.version === oldVersion) {
      throw err(`the plugin's version "${oldVersion}" was not bumped (it is not plain x.y.z) — set a plain x.y.z version in the marketplace first`, 'VALIDATION_FAILED');
    }
    const lint = plan.validation || { ok: false, problems: [{ level: 'error', message: 'not validated' }] };
    const problems = lint.problems.map((p) => ({ level: p.level, message: scrub(p.message) }));
    if (!lint.ok) {
      throw err(`the plugin does not validate: ${problems.filter((p) => p.level === 'error').map((p) => p.message).join('; ')}`, 'VALIDATION_FAILED', { problems });
    }
    const cases = await d.runCases(pluginDir);
    if (cases.failed || cases.stopped || (cases.problems || []).length) {
      const failed = cases.scripts.flatMap((s) => s.cases.filter((k) => !k.pass).map((k) => `${s.key}/${k.name || k.caseId}`));
      throw err(`shipped script cases failed: ${[...failed, ...(cases.problems || []).map(scrub)].join('; ') || 'stopped'}`, 'VALIDATION_FAILED');
    }
    await mustGit(d, repo, ['add', '-A', '--', subdir, ...(indexAdded ? [INDEX_FILE] : [])], scrub);
    const ignored = (await mustGit(d, repo, ['ls-files', '--others', '--ignored', '--exclude-standard', '--', subdir], scrub)).split('\n').filter(Boolean);
    if (ignored.length) {
      throw err(`the marketplace's .gitignore drops ${ignored.slice(0, 5).join(', ')}${ignored.length > 5 ? ', …' : ''} — the plugin would ship without them`, 'VALIDATION_FAILED');
    }
    // D15: no credential in any staged plugin file. The write env is read here (not only at push
    // time) so a push-as-me token is compared too; a dry run, which never pushes, skips that call.
    const staged = await stagedFiles(d, repo, baseSha, subdir, scrub);
    const writeEnv = dryRun ? null : await d.gitEnv('write', target.cloneUrl);
    const leaks = findCredentialLeaks(staged.filter((f) => f.text !== undefined), liveCredentialValues(read.env, writeEnv?.env));
    if (leaks.length) {
      throw err(`the plugin would publish a credential — ${leaks.map((l) => `${l.rel} holds ${l.kind}`).join('; ')}. `
        + 'Remove it from the agent/script/skill and export again', 'VALIDATION_FAILED');
    }

    // 6. ONE commit, then the marketplace's own discovery on it.
    const title = buildPrTitle({ name, update, oldVersion, newVersion: plan.version });
    await mustGit(d, repo, [...await identityArgs(d, repo), 'commit', '-q', '--no-verify', '-m', title], scrub);
    const sha = await mustGit(d, repo, ['rev-parse', 'HEAD'], scrub);
    const after = await scrubbed(scrub, () => d.discover(gitDirAbs, sha));
    const found = after.discovered.find((p) => p.name === name && p.subdir === subdir);
    if (!found || found.manifest.version !== plan.version) {
      const why = after.warnings.filter((w) => w.includes(subdir) || w.includes(`"${name}"`)).map(scrub);
      throw err(`the marketplace's discovery does not find plugin "${name}" at ${subdir}/ v${plan.version} on the new commit`
        + (found ? ` (it reads v${found.manifest.version})` : '') + (why.length ? `: ${why.join('; ')}` : ''), 'DISCOVERY_FAILED');
    }
    const casesText = cases.passed + cases.failed + cases.unchecked
      ? `${cases.passed} passed${cases.unchecked ? `, ${cases.unchecked} unchecked` : ''}` : 'no cases shipped';
    const warnCount = problems.filter((p) => p.level === 'warn').length;
    result.validation = {
      lint: warnCount ? `passed with ${warnCount} warning(s)` : 'passed',
      cases: casesText,
      discovery: `finds ${name} v${plan.version} at ${subdir}/`,
    };
    result.title = title;
    result.body = buildPrBody({
      name, subdir, update, oldVersion, newVersion: plan.version, workflow: tpl.name,
      // D16: what the commit really changes (a copied skill folder's every file included)
      created: staged.filter((f) => f.status === 'A').map((f) => f.rel),
      updated: staged.filter((f) => f.status === 'M').map((f) => f.rel),
      builtins: [...(plan.builtins?.agents || []), ...(plan.builtins?.scripts || [])],
      skippedSkills: plan.skipped.map((s) => basename(dirname(s.path))),
      indexAdded, validation: result.validation, startedBy,
    });

    // 7. Dry run stops here: no fork, no push, no PR.
    const access = await d.access(target);
    if (dryRun) {
      const pushTo = !access.ok ? 'unknown' : access.canPush === false ? 'fork' : 'marketplace';
      return { ...result, status: 'dry-run', pushTo, draft: draft === true };
    }
    if (!access.ok) throw err(`could not check push access to ${target.slug}: ${scrub(access.error)}`, 'GIT_FAILED');

    // 8. Push: the marketplace, or a fork when the credential cannot push (or, unknown, was refused).
    //    Azure access is always unknown (no probe): its auth refusal reaches forkTarget too, which
    //    answers FORK_FAILED "cannot come from a fork" (D5) instead of a bare PUSH_FAILED.
    let push = { realUrl: target.cloneUrl, fork: null };
    if (access.canPush === false) push = await forkTarget(d, target, scrub);
    let pushed = await pushOnce(d, repo, push, branch, sha, scrub);
    if (!pushed.ok && pushed.kind === 'auth' && access.canPush === null && !push.fork) {
      push = await forkTarget(d, target, scrub);
      pushed = await pushOnce(d, repo, push, branch, sha, scrub);
    }
    if (!pushed.ok) throw err(`git push to ${push.fork ? push.fork.slug : target.slug} failed: ${pushed.error}`, 'PUSH_FAILED');

    // 9. The PR — new, or the one already open for this branch (createPr recovers it on "already exists").
    const pr = await d.createPr({
      projectDir: repo, base, head: branch, title, body: result.body, repo: target.slug,
      headOwner: push.fork ? push.fork.owner : null, draft: draft === true,
      baseRemote: target.parsed, pushRemote: push.fork ? push.fork.parsed : target.parsed,
    });
    if (!pr.ok) throw err(`${target.label} pull request failed: ${scrub(pr.error)}`, 'PR_FAILED');
    if (pr.existed && pushed.pushed) {
      if (target.forge === 'github') {
        const e = await d.editPrBody({ projectDir: repo, prUrl: pr.url, body: result.body });
        if (!e.ok) result.warnings.push(`the pull request's description was not refreshed: ${scrub(e.error)}`);
      } else {
        result.warnings.push('Azure DevOps: the existing pull request\'s description was not refreshed');
      }
    }
    const status = !pr.existed ? 'opened' : pushed.pushed ? 'updated' : 'up-to-date';
    return {
      ...result, status, prUrl: pr.url, existed: !!pr.existed, draft: draft === true && !pr.existed,
      pushTo: push.fork ? 'fork' : 'marketplace', fork: push.fork ? { repo: push.fork.slug } : null,
    };
  } finally {
    await rm(work, { recursive: true, force: true, maxRetries: 3 });
  }
}
