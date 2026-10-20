// src/core/git-free/team-branch.mjs — worca-metrics / worca-policy branch reads and atomic writes through the GitHub
// git-data API (P6 Task 8). Every function answers its errors; none throws.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GIT_MISSING } from '../git-available.mjs';
import { createGithubClient, resolveBranch } from './github.mjs';
import { extractTarGz, isSafeRelPath, ARCHIVE_LIMITS } from './archive.mjs';

export const TEAM_AUTHOR = Object.freeze({ name: 'Worca', email: 'worca@local' });
export const TEAM_FLUSH_BATCH = 200;
const COMPARE_MAX_FILES = 300;
// One contents request per changed file: past this many one archive download is cheaper (and fits the anonymous
// budget of 60 requests an hour that a busy branch would otherwise exhaust on every refresh).
const INCREMENTAL_MAX_FETCHES = 20;
// A team branch keeps one file per run and is never compacted: a snapshot download has no entry cap (the byte caps stay).
let archiveLimits = ARCHIVE_LIMITS;   // _testing lowers the shared caps

/** A two-segment metrics/policy slug is a GitHub repository; a host slug (gitlab.com/…, dev.azure.com/…) is not. */
export function repoOfSlug(slug) {
  const m = /^([a-z0-9][a-z0-9-]*)\/([a-z0-9._-]+)$/i.exec(String(slug ?? ''));
  return m ? { owner: m[1], repo: m[2] } : null;
}

const clientOf = (slug, timeoutMs) => { const r = repoOfSlug(slug); return r ? createGithubClient({ ...r, role: 'write', timeoutMs }) : null; };
const messageOf = (err) => (err && err.message) || String(err);

/** `git ls-remote --heads <origin> <branch>`'s result shape; `timeoutMs` bounds each request (git's ls-remote timeout). */
export async function lsRemoteHttps(slug, branch, { timeoutMs } = {}) {
  const c = clientOf(slug, timeoutMs);
  if (!c) return { ok: false, stdout: '', stderr: GIT_MISSING.message };
  try {
    const sha = await resolveBranch(c, branch);
    if (sha) return { ok: true, stdout: `${sha}\trefs/heads/${branch}\n`, stderr: '' };
    await c.json('GET', '');
    return { ok: true, stdout: '', stderr: '' };
  } catch (err) {
    return { ok: false, stdout: '', stderr: messageOf(err) };
  }
}

/** One file at a commit; a missing file → text null. A symlink answers its target text, as `git show` does — except that
 *  GitHub's contents API answers the FILE a link names when that file is in the repository (worca writes no links). */
export async function readBranchFile(slug, sha, path, { timeoutMs } = {}) {
  const c = clientOf(slug, timeoutMs);
  if (!c) return { ok: false, stderr: GIT_MISSING.message };
  try {
    const f = await c.contents(path, sha);
    if (!f) return { ok: true, text: null };
    return { ok: true, text: f.type === 'symlink' ? f.target : f.bytes.toString('utf8') };
  } catch (err) {
    return { ok: false, stderr: messageOf(err) };
  }
}

const treeEntries = (files) => Object.entries(files).map(([path, content]) => ({ path, mode: '100644', type: 'blob', content }));

export async function createOrphanBranch(slug, branch, { files, message }) {
  const c = clientOf(slug);
  if (!c) return { ok: false, stderr: GIT_MISSING.message };
  try {
    const tree = (await c.json('POST', '/git/trees', { tree: treeEntries(files) })).sha;
    const sha = (await c.json('POST', '/git/commits', { message, tree, parents: [], author: { ...TEAM_AUTHOR, date: new Date().toISOString() } })).sha;
    try {
      await c.json('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha });
    } catch (err) {
      if (err?.code === 'GITHUB_CONFLICT' && /reference already exists/i.test(err.apiMessage || '')) return { ok: false, exists: true };
      throw err;
    }
    return { ok: true, sha };
  } catch (err) {
    return { ok: false, stderr: messageOf(err) };
  }
}

export async function commitFiles(slug, branch, { parent, files, message }) {
  const c = clientOf(slug);
  if (!c) return { ok: false, stderr: GIT_MISSING.message };
  try {
    const baseTree = (await c.json('GET', `/git/commits/${parent}`)).tree.sha;
    const tree = (await c.json('POST', '/git/trees', { base_tree: baseTree, tree: treeEntries(files) })).sha;
    if (tree === baseTree) return { ok: true, sha: parent, unchanged: true };
    const sha = (await c.json('POST', '/git/commits', { message, tree, parents: [parent], author: { ...TEAM_AUTHOR, date: new Date().toISOString() } })).sha;
    try {
      await c.json('PATCH', `/git/refs/heads/${branch}`, { sha, force: false });
    } catch (err) {
      if (err?.code === 'GITHUB_CONFLICT' && /fast.?forward/i.test(err.apiMessage || '')) return { ok: false, conflict: true, stderr: err.message };
      throw err;
    }
    return { ok: true, sha, unchanged: false };
  } catch (err) {
    return { ok: false, stderr: messageOf(err) };
  }
}

// `<dir>@sha` / `<dir>@partial-…`: `@` is in no GitHub owner or repository name, so no other slug's folder is named so.
const shaFile = (dir) => `${dir}@sha`;
const readSha = (dir) => { try { return existsSync(dir) ? readFileSync(shaFile(dir), 'utf8').trim() || null : null; } catch { return null; } };
const localPath = (dir, p) => join(dir, ...p.split('/'));

async function incremental(c, dir, prev, head, keep) {
  let cmp;
  try { cmp = await c.json('GET', `/compare/${prev}...${head}`); } catch { return false; }
  if (cmp?.status !== 'ahead' || !Array.isArray(cmp.files) || cmp.files.length >= COMPARE_MAX_FILES) return false;
  const fetches = cmp.files.filter((f) => f.status !== 'removed' && isSafeRelPath(f.filename) && keep(f.filename)).length;
  if (fetches > INCREMENTAL_MAX_FETCHES) return false;
  // Every changed file is read BEFORE the copy is touched: a GitHub error then leaves it exactly at `prev` (its @sha).
  const ops = [];   // [path, bytes | null = remove], in the compare's order
  for (const f of cmp.files) {
    if (f.status === 'renamed' && f.previous_filename && isSafeRelPath(f.previous_filename) && keep(f.previous_filename)) ops.push([f.previous_filename, null]);
    if (!isSafeRelPath(f.filename) || !keep(f.filename)) continue;
    if (f.status === 'removed') { ops.push([f.filename, null]); continue; }
    const got = await c.contents(f.filename, head);
    // Not a file here — a link (GitHub answers the file an in-repository link names, under that file's own path): no
    // copy, as in a full download (links: false).
    ops.push([f.filename, !got || got.type !== 'file' || (got.path && got.path !== f.filename) ? null : got.bytes]);
  }
  // From here a kill or a local error never leaves a copy that names `prev`: the next sync downloads it whole.
  rmSync(shaFile(dir), { force: true });
  for (const [p, bytes] of ops) {
    const target = localPath(dir, p);
    if (bytes === null) { rmSync(target, { force: true }); continue; }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  return true;
}

/** `<dir>` mirrors the branch's kept files; `<dir>@sha` records the commit it mirrors. */
export async function syncSnapshot(slug, branch, dir, { keep = () => true } = {}) {
  const c = clientOf(slug);
  if (!c) return { ok: false, sha: null, changed: false, stderr: GIT_MISSING.message };
  const ls = await lsRemoteHttps(slug, branch);
  if (!ls.ok) return { ok: false, sha: null, changed: false, stderr: ls.stderr };
  const head = ls.stdout.split('\t')[0].trim();
  if (!head) return { ok: false, sha: null, changed: false, stderr: `couldn't find remote ref refs/heads/${branch}` };
  const prev = readSha(dir);
  if (prev === head) return { ok: true, sha: head, changed: false, stderr: '' };
  try {
    // A local failure applying the update (a kept folder that became a file, EACCES) would fail every later refresh at
    // the same spot: one full download repairs the copy. GitHub's own errors stay errors.
    const applied = prev && await incremental(c, dir, prev, head, keep).catch((err) => { if (String(err?.code ?? '').startsWith('GITHUB_')) throw err; return false; });
    if (!applied) {
      const partial = `${dir}@partial-${randomBytes(4).toString('hex')}`;
      try {
        await extractTarGz(await c.archive(head), partial, { include: keep, links: false, limits: { ...archiveLimits, entries: Infinity } });
        rmSync(shaFile(dir), { force: true });   // a replace that stops halfway is never taken for the old commit's copy
        rmSync(dir, { recursive: true, force: true });
        renameSync(partial, dir);
      } finally {
        rmSync(partial, { recursive: true, force: true });
      }
    }
    writeFileSync(shaFile(dir), `${head}\n`);
    return { ok: true, sha: head, changed: true, stderr: '' };
  } catch (err) {
    return { ok: false, sha: null, changed: false, stderr: messageOf(err) };
  }
}

export const _testing = {
  /** Lower the shared archive caps a snapshot download derives its own from (its entry cap stays lifted). */
  setArchiveLimits(limits) { archiveLimits = limits; },
  reset() { archiveLimits = ARCHIVE_LIMITS; },
};
