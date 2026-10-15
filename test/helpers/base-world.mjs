// test/helpers/base-world.mjs
// Real-git worlds for the base-conflict tests (#620): a bare origin.git, the project clone `a` with a
// feature branch `feat` off `dev`, and a teammate clone `b` that pushes to origin/dev.
// The caller sets HOME / GIT_CONFIG_GLOBAL (user.name/email, init.defaultBranch=dev, commit.gpgsign=false).
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/** `git args` in cwd; throws with stderr on a non-zero exit. → trimmed stdout */
export const g = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

/** The global git config a world needs; write it to the GIT_CONFIG_GLOBAL file. */
export const GITCONFIG = '[user]\n\tname = t\n\temail = t@t\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = dev\n';

let n = 0;
/** origin.git + project clone `a` (feature `feat` off dev) + teammate clone `b`, under `root`. */
export function world(root, { feature = 'feat' } = {}) {
  const dir = join(root, `w${++n}`);
  mkdirSync(dir, { recursive: true });
  g(dir, 'init', '-q', '--bare', 'origin.git');
  g(dir, 'clone', '-q', join(dir, 'origin.git'), 'a');
  const a = join(dir, 'a');
  writeFileSync(join(a, 'f.txt'), 'one\n'); writeFileSync(join(a, 'g.txt'), 'g\n');
  g(a, 'add', '-A'); g(a, 'commit', '-qm', 'init'); g(a, 'push', '-q', 'origin', 'dev');
  g(a, 'branch', feature);
  g(dir, 'clone', '-q', join(dir, 'origin.git'), 'b');
  return { dir, a, b: join(dir, 'b'), feature };
}

/** The teammate commits `file=text` on dev and pushes it to origin (a's checkout is untouched). */
export function teammatePush(w, file, text) {
  writeFileSync(join(w.b, file), text); g(w.b, 'commit', '-qam', `edit ${file}`); g(w.b, 'push', '-q', 'origin', 'dev');
}

/** Commit `file=text` on the feature branch through a throwaway worktree. */
export function commitOnFeat(w, file, text, branch = w.feature || 'feat') {
  const wt = join(w.dir, `wt${++n}`);
  g(w.a, 'worktree', 'add', '-q', wt, branch);
  writeFileSync(join(wt, file), text); g(wt, 'commit', '-qam', `feat ${file}`);
  g(w.a, 'worktree', 'remove', wt);
}

/** Merge origin/dev into the feature branch in a throwaway worktree, resolving every conflict with
 *  `resolve(file)` text (or leaving the markers when `markers` is true), then commit the merge. */
export function mergeBaseOnFeat(w, { resolve = () => 'resolved\n', markers = false, branch = w.feature || 'feat' } = {}) {
  const wt = join(w.dir, `wt${++n}`);
  g(w.a, 'worktree', 'add', '-q', wt, branch);
  g(w.a, 'fetch', '-q', 'origin');
  const r = spawnSync('git', ['merge', '--no-ff', '--no-edit', '-q', 'origin/dev'], { cwd: wt, encoding: 'utf8' });
  if (r.status !== 0) {
    const files = g(wt, 'diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);
    for (const f of files) {
      if (!markers) writeFileSync(join(wt, f), resolve(f));
      g(wt, 'add', f);
    }
    g(wt, 'commit', '-q', '--no-edit');
  }
  g(w.a, 'worktree', 'remove', '--force', wt);
}
