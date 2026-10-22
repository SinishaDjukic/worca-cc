// test/helpers/e2b-fixture.mjs
// A git repo on a worca run branch (dirty + untracked files, the self-ignoring memory mount, a
// symlinked skill), a pipeline dir, a store plans dir and a run root — the host side of an
// E2bExecEnv. `makeEnvOpts` builds the env's options against the loopback fake SDK.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });

/** `tmp(prefix)` makes a temp dir removed by `cleanup()`. */
export function scratchDirs() {
  const dirs = [];
  return {
    tmp: (p) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; },
    cleanup: () => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })),
  };
}

export function fixture(tmp) {
  const repo = tmp('worca-e2b-repo-');
  git(repo, 'init', '-q', '-b', 'main'); git(repo, 'config', 'user.email', 't@t'); git(repo, 'config', 'user.name', 't');
  writeFileSync(join(repo, 'a.txt'), 'one\n'); writeFileSync(join(repo, 'gone.txt'), 'x\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'base');
  git(repo, 'checkout', '-qb', 'worca/feat');
  writeFileSync(join(repo, 'a.txt'), 'one\ndirty\n');                 // dirty tracked
  writeFileSync(join(repo, 'new.txt'), 'untracked\n');                // untracked
  mkdirSync(join(repo, '.claude', 'rules', 'worca'), { recursive: true });
  writeFileSync(join(repo, '.claude', 'rules', 'worca', '.gitignore'), '*\n');   // the memory mount ignores itself
  writeFileSync(join(repo, '.claude', 'rules', 'worca', 'm.md'), 'memory\n');  // injected
  const skillSrc = tmp('worca-e2b-skill-'); writeFileSync(join(skillSrc, 'SKILL.md'), 'skill\n');
  mkdirSync(join(repo, '.claude', 'skills'), { recursive: true });
  symlinkSync(skillSrc, join(repo, '.claude', 'skills', 's'));                // skillMount 'symlink' (not ignored)
  const pipelineDir = tmp('worca-e2b-pipe-'); writeFileSync(join(pipelineDir, 'task.md'), 'task\n');
  const plans = tmp('worca-e2b-plans-');
  const runRoot = tmp('worca-e2b-runroot-'); writeFileSync(join(runRoot, 'CLAUDE.md'), '# run root\n');
  return { repo, pipelineDir, plans, runRoot };
}

export const makeEnvOpts = (tmp, sdk, f, extra = {}) => ({ sdk, conn: { opts: {}, template: 'worca-agent' }, worktreeDir: f.repo,
  pipelineDir: f.pipelineDir, storeRoots: [f.plans], mcpConfigPath: null, injected: ['.claude/rules/worca', '.claude/skills/s'],
  refreshPaths: ['.claude/rules/worca'], syncExcludes: ['.claude/rules/worca', '.claude/skills/s'],
  supportFiles: [join(f.runRoot, 'CLAUDE.md')],
  metadata: { worca: '1', worcaRunId: 'r1' }, scratchDir: tmp('worca-e2b-scratch-'), log: () => {}, ...extra });
