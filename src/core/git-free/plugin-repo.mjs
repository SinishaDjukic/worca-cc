// src/core/git-free/plugin-repo.mjs — plugin repositories without git (P6): a per-commit snapshot of a GitHub
// repository's plugin folders (tree listing + one archive), and the HTTPS twins of addPluginRepo / inventoryFromCache.
// Reached only through lazy imports from plugin-repo.mjs / plugin-inventory.mjs when gitAvailable() is false.
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { wholeFileHunk, PATCH_MAX_EDIT_LENGTH, PATCH_DIFF_TIMEOUT_MS } from '../folder-copy.mjs';
import { gitMissingError } from '../git-available.mjs';
import { repoSnapshotRoot, discoverPlugins, assembleManifestDelta, manifestMcp, emptyManifestDelta, manifestVersion, finishPreview } from '../plugin-repo.mjs';
import { buildInstallInventory } from '../plugin-store.mjs';
import { findEscapingSymlinks } from '../plugin-manifest.mjs';
import { readPluginsLock, pluginVersionDir } from '../plugins-lock.mjs';
import { mcpUpdatePreview } from '../mcp/plugin-lifecycle.mjs';
import { extractTarGz, ARCHIVE_LIMITS } from './archive.mjs';
import { createGithubClient, resolveCommit, resolveBranch, githubRepoOf, GithubError } from './github.mjs';
import { isSafeRelPath } from './archive.mjs';

const KEEP_SNAPSHOTS = 3;
// plugin-repo.mjs tipSha's branch rule, verbatim (a ref outside it is "not found" there too).
const BRANCH_RE = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const SHA_RE = /^[0-9a-f]{40}$/;

/** The GitHub repository of a plugin source, or GIT_MISSING (a source off github.com needs git; a Bitbucket one says so). */
export function githubPluginRepo(url) {
  const r = githubRepoOf(url);
  if (!r) throw gitMissingError(url);
  return r;
}

const clientFor = (url) => createGithubClient({ ...githubPluginRepo(url), role: 'read' });
const metaFile = (root, sha) => join(root, `${sha}.meta.json`);
// A plugin's subdir is a folder of the repository ('' = its root): git archive refuses one outside it (`..`), and a
// `.`, `..` or empty segment would name another folder of the snapshot — or a local one.
const nativeJoin = (dir, rel) => {
  if (rel && !isSafeRelPath(rel)) throw Object.assign(new Error('invalid subdir'), { code: 'BAD_REQUEST' });
  return rel ? join(dir, ...rel.split('/')) : dir;
};

/** The listing of a snapshot: { paths, linksSkipped, linksEscaping } (written beside the folder, never inside the repository's tree). */
export function snapshotMeta(repoUrl, sha) {
  try { return { linksEscaping: [], ...JSON.parse(readFileSync(metaFile(repoSnapshotRoot(repoUrl), sha), 'utf8')) }; } catch { return { paths: [], linksSkipped: [], linksEscaping: [] }; }
}

// The commit a name (a tag, a branch, an abbreviated sha) last resolved to, per snapshot root: a lock pin may be such a
// name (`worca plugin install --ref v1`), and prune keeps the folder of the commit it names.
const revsFile = (root) => join(root, '.revs.json');
const readRevs = (root) => { try { return new Map(Object.entries(JSON.parse(readFileSync(revsFile(root), 'utf8')))); } catch { return new Map(); } };
function recordRev(root, rev, sha) {
  const revs = readRevs(root);
  if (revs.get(rev) === sha) return;
  revs.set(rev, sha);
  try {
    mkdirSync(root, { recursive: true });
    const tmp = `${revsFile(root)}.${randomBytes(4).toString('hex')}`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(revs)));
    renameSync(tmp, revsFile(root));
  } catch { /* unwritable: that folder is then kept only while among the newest */ }
}

function prune(root, keep) {
  let list;
  try { list = readdirSync(root, { withFileTypes: true }); } catch { return; }
  // A folder an overlapping prune removed since the listing is skipped (ENOENT).
  const shas = list.filter((e) => e.isDirectory() && SHA_RE.test(e.name))
    .map((e) => { try { return { name: e.name, t: statSync(join(root, e.name)).mtimeMs }; } catch { return null; } }).filter(Boolean)
    .sort((a, b) => b.t - a.t || (a.name === keep ? -1 : 1));
  // A commit an installed plugin is pinned to stays too: its update preview diffs the plugin folder against it. A pin
  // naming the commit by a tag, a branch or an abbreviated sha keeps the folder that name last resolved to.
  const revs = readRevs(root);
  const pinned = new Set(Object.values(readPluginsLock()).filter((e) => e?.repo && repoSnapshotRoot(e.repo) === root)
    .map((e) => (SHA_RE.test(e.pinnedSha) ? e.pinnedSha : revs.get(e.pinnedSha))));
  for (const { name } of shas.slice(KEEP_SNAPSHOTS)) {
    if (name === keep || pinned.has(name)) continue;
    // The meta file first: a removal cut short (a killed process, a file in use) leaves a folder without it, which is
    // never read as a snapshot (pluginSnapshot rebuilds it) and goes with a later prune — the read that pruned goes on.
    try {
      rmSync(metaFile(root, name), { force: true });
      rmSync(join(root, name), { recursive: true, force: true });
    } catch { /* a later prune retries */ }
  }
}

/** The snapshot folder of the commit `rev` names (its plugin folders + the marketplace file), built once. `rev` is a
 *  commit sha, or a tag / branch name (`worca plugin install --ref`): the folder is named by the commit, never the name. */
export async function pluginSnapshot(repoUrl, rev) {
  const root = repoSnapshotRoot(repoUrl);
  const c = clientFor(repoUrl);
  let sha = rev;
  if (!SHA_RE.test(rev)) {
    if (!BRANCH_RE.test(rev)) throw new Error(`branch "${rev}" not found`);
    sha = await resolveCommit(c, rev);
    recordRev(root, rev, sha);
  }
  const dest = join(root, sha);
  if (existsSync(dest) && existsSync(metaFile(root, sha))) return dest;
  // A folder without its meta file is a removal cut short (prune removes the meta first): never reused — the rename
  // below would take it for a concurrent build's folder.
  rmSync(dest, { recursive: true, force: true });
  const tree = await c.json('GET', `/git/trees/${sha}?recursive=1`);
  if (tree.truncated) throw new GithubError('GITHUB_HTTP', 'the repository is too large to read without git');
  const paths = tree.tree.filter((e) => e.type !== 'tree').map((e) => e.path);
  const dirs = paths.filter((p) => p === 'worca-cc-plugin.json' || p.endsWith('/worca-cc-plugin.json'))
    .map((p) => (p === 'worca-cc-plugin.json' ? '' : p.slice(0, -'/worca-cc-plugin.json'.length)));
  mkdirSync(root, { recursive: true });
  const partial = join(root, `.partial-${randomBytes(4).toString('hex')}`);
  try {
    const r = await extractTarGz(await c.archive(sha), partial, {
      include: (p) => p === 'worca-cc-marketplace.json' || dirs.some((d) => d === '' || p === d || p.startsWith(`${d}/`)),
      limits: ARCHIVE_LIMITS,
    });
    // A link escaping the repository never lands (extractTarGz skips it: `linksEscaping`); one escaping only its plugin
    // folder stays in the snapshot (worca's cache, never an execution path): every consumer reads a COPY that drops it
    // relative to ITS root — exportVersionHttps reports both kinds exactly as exportVersion does.
    const below = (why) => r.skipped.filter((s) => s.why === why).map((s) => s.path.slice(s.path.indexOf('/') + 1));
    const linksSkipped = below('windows-link');
    const linksEscaping = below('escaping-link');
    const tmpMeta = `${metaFile(root, sha)}.${randomBytes(4).toString('hex')}`;
    writeFileSync(tmpMeta, JSON.stringify({ paths, linksSkipped, linksEscaping }));
    renameSync(tmpMeta, metaFile(root, sha));
    try { renameSync(partial, dest); } catch (e) { if (!existsSync(dest)) throw e; rmSync(partial, { recursive: true, force: true }); }
  } catch (e) {
    rmSync(partial, { recursive: true, force: true });
    throw e?.code === 'TOO_LARGE' ? new GithubError('GITHUB_HTTP', 'the repository is too large to read without git') : e;
  }
  prune(root, sha);
  return dest;
}

/** addPluginRepo without git: same result shape, read from the commit's snapshot. */
export async function addPluginRepoHttps(repoUrl, { ref = null, onProgress = null } = {}) {
  const c = clientFor(repoUrl);
  let sha;
  if (ref) {
    const bad = () => new Error(`branch "${ref}" not found`);
    if (!BRANCH_RE.test(ref)) throw bad();
    sha = await resolveBranch(c, ref);
    if (!sha) throw bad();
  } else {
    sha = await resolveCommit(c, null);
  }
  const snap = await pluginSnapshot(repoUrl, sha);
  onProgress?.({ phase: 'reading', sha });
  const { paths } = snapshotMeta(repoUrl, sha);
  // git's `show` hands a committed symlink's target text, never the file it points at: refuse links the same way.
  const readText = async (p) => {
    const f = nativeJoin(snap, p);
    if (lstatSync(f).isSymbolicLink()) throw new Error(`${p}: a symlink`);
    return readFile(f, 'utf8');
  };
  return { repoUrl, sha, ...(await discoverPlugins(paths, readText)) };
}

/** inventoryFromCache without git: the consent inventory of `subdir` at `sha`, from the snapshot. */
export async function inventoryHttps(repoUrl, sha, subdir) {
  const snap = await pluginSnapshot(repoUrl, sha);
  const tmp = await mkdtemp(join(tmpdir(), 'worca-cc-consent-'));
  try {
    // A folder with no manifest at that commit is not in the snapshot (it holds plugin folders only): nothing to list.
    const src = nativeJoin(snap, subdir);
    if (existsSync(src)) cpSync(src, tmp, { recursive: true, verbatimSymlinks: true });
    for (const rel of findEscapingSymlinks(tmp)) rmSync(join(tmp, rel), { force: true });
    const inv = buildInstallInventory(tmp);
    if (Array.isArray(inv.setupCommands)) {
      inv.setupCommands = inv.setupCommands.map((cmd) => String(cmd).split(tmp).join('<plugin-dir>'));
    }
    return inv;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** exportVersion without git: `versions/<sha7>` = the plugin folder of the commit's snapshot (no .git). */
export async function exportVersionHttps(name, sha, { repoUrl, subdir = '' } = {}) {
  const versionDir = pluginVersionDir(name, sha); // refuses a pin that would leave versions/, before any read or write
  githubPluginRepo(repoUrl);
  const snap = await pluginSnapshot(repoUrl, sha);
  rmSync(versionDir, { recursive: true, force: true }); // re-export = fresh dir
  mkdirSync(versionDir, { recursive: true });
  try {
    // A folder with no manifest at that commit is not in the snapshot: the export stays empty, and validation refuses it
    // with git's own text (`worca-cc-plugin.json: missing`).
    const src = nativeJoin(snap, subdir);
    if (existsSync(src)) cpSync(src, versionDir, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
  } catch (err) {
    rmSync(versionDir, { recursive: true, force: true });
    throw err;
  }
  const escaping = [];
  for (const rel of findEscapingSymlinks(versionDir)) {
    unlinkSync(join(versionDir, rel));
    escaping.push(rel);
  }
  // Links escaping the whole repository never reached the snapshot; git archive wrote them and exportVersion removed them.
  const meta = snapshotMeta(repoUrl, basename(snap));
  for (const p of meta.linksEscaping) if (!subdir || p.startsWith(`${subdir}/`)) escaping.push(subdir ? p.slice(subdir.length + 1) : p);
  const warnings = escaping.sort().map((rel) => `removed symlink escaping the export dir: ${rel}`);
  if (process.platform === 'win32') {
    for (const p of meta.linksSkipped) {
      if (!subdir || p.startsWith(`${subdir}/`)) warnings.push(`skipped symlink ${subdir ? p.slice(subdir.length + 1) : p} (Windows)`);
    }
  }
  return { versionDir, warnings };
}

const readManifestRaw = (dir) => {
  const f = join(dir, 'worca-cc-plugin.json');
  try { return lstatSync(f).isSymbolicLink() ? null : JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
};

/** git's `%s`: the first paragraph of a commit message, its lines joined by spaces. */
function commitSubject(message) {
  const lines = String(message ?? '').split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const out = [];
  for (; i < lines.length && lines[i].trim(); i++) out.push(lines[i].replace(/\s+$/, ''));
  return out.join(' ');
}

/** Every file and symlink below `dir`: POSIX rel path → { mode, bytes } (a link's bytes are its target, as git stores it). */
function treeEntries(dir) {
  const out = new Map();
  const walk = (abs, rel) => {
    let list;
    try { list = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const a = join(abs, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) out.set(r, { mode: '120000', bytes: Buffer.from(readlinkSync(a)) });
      else if (e.isDirectory()) walk(a, r);
      else if (e.isFile()) out.set(r, { mode: statSync(a).mode & 0o111 ? '100755' : '100644', bytes: readFileSync(a) });
    }
  };
  walk(dir, '');
  return out;
}

// The update review's jsdiff budget for all its files together: each file gets what is left of it (at most
// PATCH_DIFF_TIMEOUT_MS), diffed in a worker thread (diff-worker.mjs) while the loop yields before each file, so N large
// files never block the server and diff for at most this long. A file past it is one whole-file hunk, as a file past
// jsdiff's own budget is.
const REVIEW_DIFF_BUDGET_MS = 2_000;
let reviewBudgetMs = REVIEW_DIFF_BUDGET_MS;
const nextTurn = () => new Promise((r) => setImmediate(r));
let reviewYield = nextTurn;

/** One review's diff worker, started at its first text diff: diff() resolves to jsdiff's hunk lines, or null past its
 *  edit/time budget; close() stops the worker. */
function reviewDiffer() {
  let worker = null;
  return {
    diff(oldText, newText, timeout) {
      worker ??= new Worker(new URL('./diff-worker.mjs', import.meta.url));
      const w = worker;
      return new Promise((resolve, reject) => {
        const settle = (fn, v) => { w.off('message', onMessage).off('error', onError).off('exit', onExit); fn(v); };
        const onMessage = (hunk) => settle(resolve, hunk);
        const onError = (err) => settle(reject, err);
        const onExit = (code) => settle(reject, new Error(`the update review's diff worker exited (${code})`));
        w.on('message', onMessage).on('error', onError).on('exit', onExit);
        w.postMessage({ oldText, newText, options: { context: 3, maxEditLength: PATCH_MAX_EDIT_LENGTH, timeout } });
      });
    },
    close() { worker?.terminate().catch(() => {}); },
  };
}
const isBinary = (buf) => buf.subarray(0, 8000).includes(0);   // git's rule: a NUL in the first 8000 bytes

/** The changed paths between two plugin folders, in git's path order: { filename, status, oldMode, newMode, additions,
 *  deletions, changes, binary?, oldSize?, newSize?, hunk?, before?, after? } (filename carries the subdir, as git's does).
 *  A text diff past jsdiff's edit/time budget, or past the review's (REVIEW_DIFF_BUDGET_MS), is one whole-file hunk, as
 *  Folder runs' patches are (folder-copy.mjs). */
async function treeChanges(pinRoot, candRoot, subdir) {
  const a = treeEntries(pinRoot);
  const b = treeEntries(candRoot);
  const prefix = subdir ? `${subdir}/` : '';
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => Buffer.compare(Buffer.from(x), Buffer.from(y)));
  const out = [];
  const deadline = Date.now() + reviewBudgetMs;
  const differ = reviewDiffer();
  try {
    for (const p of paths) {
      const x = a.get(p);
      const y = b.get(p);
      if (x && y && x.mode === y.mode && x.bytes.equals(y.bytes)) continue;
      const before = x?.bytes ?? Buffer.alloc(0);
      const after = y?.bytes ?? Buffer.alloc(0);
      const f = { filename: prefix + p, status: !x ? 'added' : !y ? 'removed' : 'modified', oldMode: x?.mode ?? null, newMode: y?.mode ?? null, before, after };
      if (isBinary(before) || isBinary(after)) {
        out.push({ ...f, binary: true, oldSize: before.length, newSize: after.length, additions: 0, deletions: 0, changes: 0 });
        continue;
      }
      const [oldText, newText] = [before.toString('utf8'), after.toString('utf8')];
      await reviewYield();   // the server answers other requests between two files' diffs
      const left = Math.min(PATCH_DIFF_TIMEOUT_MS, deadline - Date.now());
      // A spent budget takes the timeout fallback at once (jsdiff would still split both texts into lines first).
      const hunk = (left > 0 ? await differ.diff(oldText, newText, left) : null) ?? wholeFileHunk(oldText, newText);
      let additions = 0;
      let deletions = 0;
      for (const l of hunk) { if (l[0] === '+') additions++; else if (l[0] === '-') deletions++; }
      out.push({ ...f, additions, deletions, changes: additions + deletions, hunk });
    }
  } finally {
    differ.close();
  }
  return out;
}

/** git log <pin>..<cand> -- <subdir> without git: compare's range (newest first) kept to the commits GitHub lists for the
 *  folder from the candidate. Pages of 100, at most 3 (compare itself stops at 250), until every commit of the range is
 *  found, a page is short, or a page holds none of them (a merged branch's older commits, and a range compare cut short,
 *  sit past the first older one).
 *  A root plugin is the whole repository: the range as it is. */
async function scopeCommits(c, candidateSha, subdir, range) {
  if (!subdir || !range.length) return range;
  const inRange = new Set(range.map((x) => x.sha));
  const touched = new Set();
  for (let page = 1; page <= 3; page++) {
    const rows = await c.json('GET', `/commits?sha=${candidateSha}&path=${encodeURIComponent(subdir)}&per_page=100&page=${page}`);
    if (!Array.isArray(rows)) return range;   // not a commit list: scope nothing rather than hide a commit
    const hits = rows.filter((r) => inRange.has(r?.sha));
    for (const r of hits) touched.add(r.sha);
    if (touched.size === inRange.size || rows.length < 100 || !hits.length) break;
  }
  return range.filter((x) => touched.has(x.sha));
}

/** fetchCandidate without git. GitHub's compare gives the commit list only (at most 250 commits; 404 when a rewritten
 *  history shares no commit with the pin). What the review shows and flags — the diffstat, the full diff, the new agents,
 *  the manifest delta — is read from the two commits' snapshots, as git reads the two trees: no compare cap (300 files),
 *  merge base or rename report can hide a change in the plugin folder. */
export async function fetchCandidateHttps(name, { fullDiff = false } = {}) {
  const entry = readPluginsLock()[name];
  if (!entry || !entry.repo) throw new Error(`plugin "${name}" is not installed from a repo`);
  const c = clientFor(entry.repo);
  let candidateSha;
  if (entry.ref) {
    const bad = () => new Error(`branch "${entry.ref}" not found`);
    if (!BRANCH_RE.test(entry.ref)) throw bad();
    candidateSha = await resolveBranch(c, entry.ref);
    if (!candidateSha) throw bad();
  } else {
    candidateSha = await resolveCommit(c, null);
  }
  const pinnedSha = entry.pinnedSha;
  const subdir = entry.subdir || '';
  let commits = [];
  let diffstat = '';
  let diffFull = '';
  let manifestDelta = emptyManifestDelta();
  let candidateVersion = null;
  if (candidateSha !== pinnedSha) {
    let cmp = null;
    try { cmp = await c.json('GET', `/compare/${pinnedSha}...${candidateSha}`); } catch (err) { if (err.code !== 'GITHUB_NOT_FOUND') throw err; }
    const range = (cmp?.commits || []).slice().reverse().map((x) => ({ sha: x.sha, subject: commitSubject(x.commit?.message) }));
    commits = await scopeCommits(c, candidateSha, subdir, range);
    // The pinned commit's snapshot stays while a plugin is pinned to it (prune); one installed with git is fetched once.
    const pinRoot = nativeJoin(await pluginSnapshot(entry.repo, pinnedSha), subdir);
    const candRoot = nativeJoin(await pluginSnapshot(entry.repo, candidateSha), subdir);
    // A snapshot holds only folders with a manifest at that commit — and always its root: the listing says whether the
    // plugin's own manifest is there.
    const manifestPath = subdir ? `${subdir}/worca-cc-plugin.json` : 'worca-cc-plugin.json';
    if (!snapshotMeta(entry.repo, candidateSha).paths.includes(manifestPath)) throw Object.assign(new Error(`plugin "${name}": ${subdir || 'the repository root'} has no worca-cc-plugin.json at ${candidateSha.slice(0, 7)}`), { code: 'BAD_REQUEST' });
    // Both sides read the way exportSkillsAt exports them: a scratch copy of the plugin folder without escaping links. Both
    // are copied, and both trees read, before the review's first yield: another read of this repository (a marketplace
    // refresh, another plugin's preview, the CLI) may prune the candidate's folder meanwhile — prune keeps pins, not it.
    const scratch = mkdtempSync(join(tmpdir(), 'worca-cc-skills-'));
    try {
      const side = (src, name_) => {
        const d = join(scratch, name_);
        cpSync(src, d, { recursive: true, verbatimSymlinks: true });
        for (const rel of findEscapingSymlinks(d)) unlinkSync(join(d, rel));
        return d;
      };
      const candDir = side(candRoot, 'cand');
      const pinDir = side(pinRoot, 'pin');
      const changes = await treeChanges(pinRoot, candRoot, subdir);   // reads both trees before it first yields
      diffstat = formatDiffstat(changes).trim();   // git diff --stat output is trimmed on the git path too
      diffFull = fullDiff ? formatPatch(changes) : '';
      // git diff --name-status -- <subdir>/agents: an added *.meta.json is a new agent; an exact rename (R) is not.
      const agents = subdir ? `${subdir}/agents/` : 'agents/';
      const metas = (status) => changes.filter((f) => f.status === status && f.filename.startsWith(agents) && f.filename.endsWith('.meta.json'));
      const gone = metas('removed');
      const newAgents = metas('added').filter((f) => !gone.some((g) => g.before.equals(f.after)))
        .map((f) => f.filename.split('/').pop().replace(/\.meta\.json$/, ''));
      const pin = readManifestRaw(pinDir);
      const cand = readManifestRaw(candDir);
      candidateVersion = manifestVersion(cand);
      const lifecycle = await mcpUpdatePreview(name, manifestMcp(pin), manifestMcp(cand), { pinDir, candDir });
      manifestDelta = assembleManifestDelta({ pin, cand, newAgents, lifecycle });
    } finally {
      await rm(scratch, { recursive: true, force: true }).catch(() => {});
    }
  }
  return finishPreview({ entry, pinnedSha, candidateSha, candidateVersion, commits, diffstat, diffFull, manifestDelta });
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// git's C quoting of a shown path (core.quotepath on, git's default; worca's git calls keep it): a name holding a
// control character, DEL, `"`, `\` or a byte past ASCII prints as "…" with \a \b \t \n \v \f \r \" \\ or \ooo (octal),
// so a newline cannot forge a row and no escape sequence reaches a terminal. Only the display: matching uses the raw name.
const C_ESCAPES = new Map([[0x07, 'a'], [0x08, 'b'], [0x09, 't'], [0x0a, 'n'], [0x0b, 'v'], [0x0c, 'f'], [0x0d, 'r'], [0x22, '"'], [0x5c, '\\']]);
function quotePath(name) {
  const bytes = Buffer.from(name);
  if (!bytes.some((b) => b < 0x20 || b >= 0x7f || C_ESCAPES.has(b))) return name;
  let out = '';
  for (const b of bytes) out += C_ESCAPES.has(b) ? `\\${C_ESCAPES.get(b)}` : b < 0x20 || b >= 0x7f ? `\\${b.toString(8).padStart(3, '0')}` : String.fromCharCode(b);
  return `"${out}"`;
}

/** git's `diff --stat` rows and summary (bars scaled to 50 columns by the largest change; a binary row says `Bin`). */
export function formatDiffstat(files) {
  if (!files.length) return '';
  const names = files.map((f) => quotePath(f.filename));
  const w = Math.max(...names.map((n) => n.length));
  const cw = Math.max(...files.map((f) => (f.binary ? 3 : String(f.changes).length)));
  const max = Math.max(...files.map((f) => f.changes));
  const scale = max > 50 ? 50 / max : 1;
  const rows = files.map((f, i) => {
    if (f.binary) return ` ${names[i].padEnd(w)} | ${'Bin'.padStart(cw)} ${f.oldSize} -> ${f.newSize} bytes`;
    const bar = '+'.repeat(Math.round(f.additions * scale)) + '-'.repeat(Math.round(f.deletions * scale));
    return ` ${names[i].padEnd(w)} | ${String(f.changes).padStart(cw)}${f.changes ? ` ${bar}` : ''}`;
  });
  const add = files.reduce((n, f) => n + f.additions, 0);
  const del = files.reduce((n, f) => n + f.deletions, 0);
  let sum = ` ${plural(files.length, 'file changed', 'files changed')}`;
  if (add || !del) sum += `, ${plural(add, 'insertion(+)', 'insertions(+)')}`;
  if (del || !add) sum += `, ${plural(del, 'deletion(-)', 'deletions(-)')}`;
  return [...rows, sum].join('\n');
}

/** git's unified diff of treeChanges() rows (headers, mode lines, hunks; a binary file says so). Names are C-quoted as
 *  git quotes them (`"a/…"`), and a ---/+++ line whose name holds a space ends with a tab, as git's does. */
export function formatPatch(files) {
  const tab = (label) => (label.includes(' ') ? '\t' : '');
  return files.map((f) => {
    const [qa, qb] = [quotePath(`a/${f.filename}`), quotePath(`b/${f.filename}`)];
    const a = f.status === 'added' ? '/dev/null' : qa;
    const b = f.status === 'removed' ? '/dev/null' : qb;
    const head = [`diff --git ${qa} ${qb}`];
    if (f.status === 'added') head.push(`new file mode ${f.newMode}`);
    else if (f.status === 'removed') head.push(`deleted file mode ${f.oldMode}`);
    else if (f.oldMode !== f.newMode) head.push(`old mode ${f.oldMode}`, `new mode ${f.newMode}`);
    if (f.binary) return [...head, `Binary files ${a} and ${b} differ`].join('\n');
    if (!f.hunk?.length) return head.join('\n');
    return [...head, `--- ${a}${tab(a)}`, `+++ ${b}${tab(b)}`, ...f.hunk].join('\n');
  }).join('\n');
}

export const _testing = {
  /** The review's diff budget in ms (null: the default). */
  setReviewBudget(ms) { reviewBudgetMs = ms ?? REVIEW_DIFF_BUDGET_MS; },
  /** What the review awaits between two files' diffs (null: the next turn of the event loop). */
  setReviewYield(fn) { reviewYield = fn ?? nextTurn; },
};
