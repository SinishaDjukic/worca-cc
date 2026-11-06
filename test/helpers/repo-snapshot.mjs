// test/helpers/repo-snapshot.mjs — workflow tests 3a ("the person's repository is only read"): everything git keeps for a
// repository, as one string. Compare it before and after: a new ref, worktree entry, object, config line, reflog line or
// working-tree change shows up. The index is left out: git refreshes its stat cache on reads (GIT_OPTIONAL_LOCKS=0 keeps
// this helper from doing it, but other reads may).
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', env });

function files(dir, base, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) files(p, base, out);
    else out.push(`${relative(base, p).replaceAll('\\', '/')} ${statSync(p).size}`);
  }
  return out;
}

export function repoSnapshot(dir) {
  const gitDir = join(dir, '.git');
  return JSON.stringify({
    refs: git(dir, ['for-each-ref', '--format=%(refname) %(objectname)']),
    worktrees: git(dir, ['worktree', 'list', '--porcelain']),
    status: git(dir, ['status', '--porcelain=v1', '--untracked-files=all']),
    stash: git(dir, ['stash', 'list']),
    files: files(gitDir, gitDir).filter((f) => !/^index /.test(f)).sort(),
  }, null, 1);
}
