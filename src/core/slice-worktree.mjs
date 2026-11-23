// What a finished decomposition task changed in a git work tree, and whether that work is
// still there when the run resumes.
//
// A resume skips a task that finished in the earlier attempt (scheduler runSlice). Its edits
// are only in the working tree: nothing is staged until the whole step finishes, so a
// `git checkout .`, `git reset --hard` or `git stash` during the pause takes them away while
// the task row still says `done`. To catch that, each finished task records, per member work
// tree, the paths that changed while it ran with their content before and after. On resume a
// task runs again when one of its paths is back at content it had EARLIER in the run (some
// finished task's "before"). A path the user changed to something new while the run was
// paused is a deliberate edit and does not make the task run again.
//
// A file a task CREATED counts as reverted when it is gone or EMPTY: the run marks new files
// intent-to-add (run-harness _stageWorkingTree), and `git checkout .` restores such a file to
// the empty content its index entry holds instead of deleting it.
//
// Every tree is written through a throwaway copy of the work tree's index, so the run's own
// index (and its intent-to-add entries) is never touched and two parallel tasks never race
// for the index lock.
import { copyFile, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { randomBytes } from 'node:crypto';

/** What an absent path reads as (git prints all zeros, 40 or 64 of them, in diff-tree output). */
export const ABSENT = 'absent';
const absentOr = (id) => (/^0+$/.test(id) ? ABSENT : id);
/** The empty blob, SHA-1 and SHA-256: what `git checkout .` leaves in a file that was intent-to-add. */
const EMPTY_BLOBS = ['e69de29bb2d1d6434b8b29ae775ad8c2e48c5391', '473a0f4c3be8a93681a267e3b1e9a7dcda1185436fe141f7749120a303721813'];

/**
 * The tree `git add -A` would stage for `dir` right now, as a tree id; null when git fails.
 * @param {(args:string[], opts?:object) => Promise<{ok:boolean, stdout:string}>} git runs git in `dir`
 * @param {string} dir the work tree
 * @param {string[]} excludes `:(exclude)path` pathspecs (the run's own injected files)
 */
export async function worktreeTree(git, dir, excludes = []) {
  const idx = await git(['rev-parse', '--git-path', 'index']);
  if (!idx.ok || !idx.stdout.trim()) return null;
  const real = idx.stdout.trim();
  const realPath = isAbsolute(real) ? real : join(dir, real);
  const tmp = `${realPath}.worca-slice-${randomBytes(6).toString('hex')}`;
  try {
    // A copy keeps git's stat cache, so only files that changed are hashed again. No index yet: git starts empty.
    await copyFile(realPath, tmp).catch((err) => { if (err?.code !== 'ENOENT') throw err; });
    const env = { GIT_INDEX_FILE: tmp };
    const add = await git(excludes.length ? ['add', '-A', '--', '.', ...excludes] : ['add', '-A'], { env });
    if (!add.ok) return null;
    const tree = await git(['write-tree'], { env });
    return tree.ok && tree.stdout.trim() ? tree.stdout.trim() : null;
  } catch {
    return null;
  } finally {
    await rm(tmp, { force: true }).catch(() => {});
  }
}

/**
 * The paths that differ between two trees: `[[path, beforeId, afterId], ...]` (ABSENT for a
 * path one side lacks); null when git fails.
 */
export async function treeChanges(git, before, after) {
  if (before === after) return [];
  const res = await git(['diff-tree', '-r', '-z', '--no-renames', before, after]);
  if (!res.ok) return null;
  // -z: ":<mode> <mode> <before> <after> <status>\0<path>\0" per path.
  const parts = res.stdout.split('\0');
  const out = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const meta = parts[i].replace(/^:/, '').split(' ');
    if (meta.length < 5) break;
    out.push([parts[i + 1], absentOr(meta[2]), absentOr(meta[3])]);
  }
  return out;
}

/** Each of `paths` in `tree` → its object id (a path the tree lacks is not in the map); null when git fails. */
export async function idsAt(git, tree, paths) {
  if (!paths.length) return new Map();
  const res = await git(['--literal-pathspecs', 'ls-tree', '-r', '-z', '--full-tree', tree, '--', ...paths]);
  if (!res.ok) return null;
  const ids = new Map();
  for (const line of res.stdout.split('\0')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const [, , id] = line.slice(0, tab).split(' ');
    ids.set(line.slice(tab + 1), id);
  }
  return ids;
}

/**
 * Whether a finished task's work is gone: one of its changed paths now holds content that path
 * had before some finished task changed it (and not the content this task left).
 * @param {Record<string, Array<[string,string,string]>>} changes this task's changes per member key
 * @param {Map<string, Map<string, Set<string>>>} earlier per member key, path → every "before" id the finished tasks recorded
 * @param {Map<string, Map<string, string>>} current per member key, path → its id now (absent paths missing)
 */
export function workLost(changes, earlier, current) {
  for (const [key, list] of Object.entries(changes || {})) {
    for (const [path, , after] of list) {
      const now = current.get(key)?.get(path) ?? ABSENT;
      if (now !== absentOr(after) && earlier.get(key)?.get(path)?.has(now)) return true;
    }
  }
  return false;
}

/** Per member key, path → the set of "before" ids over every row's `worktree` changes (a created
 *  file's "before" is absent, and an emptied file reads as that too). */
export function earlierContents(rows) {
  const earlier = new Map();
  for (const row of rows) {
    for (const [key, list] of Object.entries(row.worktree || {})) {
      if (!earlier.has(key)) earlier.set(key, new Map());
      const paths = earlier.get(key);
      for (const [path, recorded] of list) {
        const before = absentOr(recorded);
        if (!paths.has(path)) paths.set(path, new Set());
        paths.get(path).add(before);
        if (before === ABSENT) for (const id of EMPTY_BLOBS) paths.get(path).add(id);
      }
    }
  }
  return earlier;
}
