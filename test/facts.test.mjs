import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { collectFacts, fingerprintOf, quickFingerprint, INSTRUCTION_CANDIDATES, HEAVY_DIRS } from '../src/core/repo-readiness/facts.mjs';

function gitDir() {
  const dir = mkdtempSync(join(tmpdir(), 'readiness-'));
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@test"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'ignore' });
  execSync('git config commit.gpgsign false', { cwd: dir, stdio: 'ignore' });
  execSync('git commit --allow-empty -m "init"', { cwd: dir, stdio: 'ignore' });
  return dir;
}

function rmRf(dir) {
  rmSync(dir, { recursive: true, force: true });
}

describe('facts.collectFacts', () => {
  it('detects a git repo with HEAD', async () => {
    const dir = gitDir();
    try {
      const f = await collectFacts(dir);
      assert.ok(f.isRepo);
      assert.ok(f.headSha && f.headSha.length === 40);
      assert.ok(Array.isArray(f.tracked));
      assert.ok(f.trackedSet instanceof Set);
    } finally { rmRf(dir); }
  });

  it('returns not-a-repo for non-git dirs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'not-repo-'));
    try {
      const f = await collectFacts(dir);
      assert.strictEqual(f.isRepo, false);
      assert.strictEqual(f.tracked, null);
    } finally { rmRf(dir); }
  });

  it('collects instruction file status (committed, untracked, modified)', async () => {
    const dir = gitDir();
    try {
      writeFileSync(join(dir, 'CLAUDE.md'), 'test');
      execSync('git add CLAUDE.md', { cwd: dir });
      execSync('git commit -m "add CLAUDE"', { cwd: dir, stdio: 'ignore' });
      writeFileSync(join(dir, 'CLAUDE.md'), 'test changed');
      writeFileSync(join(dir, 'AGENTS.md'), 'agents');

      const f = await collectFacts(dir);
      assert.strictEqual(f.instructionStatus['CLAUDE.md'], ' M');
      assert.strictEqual(f.instructionStatus['AGENTS.md'], '??');
    } finally { rmRf(dir); }
  });

  it('collects file sizes of instruction candidates', async () => {
    const dir = gitDir();
    try {
      writeFileSync(join(dir, 'CLAUDE.md'), 'x'.repeat(1000));
      execSync('git add CLAUDE.md && git commit -m "add" -q', { cwd: dir, stdio: 'ignore' });

      const f = await collectFacts(dir);
      assert.ok(f.sizes['CLAUDE.md'] >= 1000);
    } finally { rmRf(dir); }
  });

  it('primes tracked instruction text, bounded by the read cap', async () => {
    const dir = gitDir();
    try {
      writeFileSync(join(dir, 'AGENTS.md'), 'y'.repeat(300 * 1024));
      execSync('git add AGENTS.md && git commit -m "add" -q', { cwd: dir, stdio: 'ignore' });

      const f = await collectFacts(dir);
      assert.strictEqual(f.texts['AGENTS.md'].length, 256 * 1024);
    } finally { rmRf(dir); }
  });

  it('reads tracked manifests into facts.manifests', async () => {
    const dir = gitDir();
    try {
      writeFileSync(join(dir, 'package.json'), '{"scripts":{"test":"echo test"}}');
      writeFileSync(join(dir, 'Makefile'), 'all:\n');
      execSync('git add package.json && git commit -m "add" -q', { cwd: dir, stdio: 'ignore' });

      const f = await collectFacts(dir);
      assert.ok(f.manifests['package.json'].includes('test'));
      assert.ok(!('Makefile' in f.manifests), 'untracked manifests are skipped');
    } finally { rmRf(dir); }
  });

  it('detects heavy dirs and git check-ignore status', async () => {
    const dir = gitDir();
    try {
      writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
      mkdirSync(join(dir, 'node_modules'));
      writeFileSync(join(dir, 'node_modules', 'file.txt'), 'x');
      mkdirSync(join(dir, 'dist'));
      writeFileSync(join(dir, 'dist', 'a.js'), 'x');

      const f = await collectFacts(dir);
      assert.ok(f.heavyPresent.includes('node_modules'));
      assert.strictEqual(f.heavyIgnored['node_modules'], true);
      assert.strictEqual(f.heavyIgnored['dist'], false);
    } finally { rmRf(dir); }
  });

  it('respects timeout', async () => {
    const dir = gitDir();
    try {
      const f = await collectFacts(dir, { timeoutMs: 1, now: Date.now() });
      assert.ok(f.timedOut);
    } finally { rmRf(dir); }
  });

  it('reports truncated=false for small repos', async () => {
    const dir = gitDir();
    try {
      const f = await collectFacts(dir);
      assert.strictEqual(f.truncated, false);
    } finally { rmRf(dir); }
  });

  it('never throws for a missing directory', async () => {
    const f = await collectFacts(join(tmpdir(), 'readiness-does-not-exist-xyz'));
    assert.strictEqual(f.isRepo, false);
  });
});

describe('facts.fingerprintOf', () => {
  it('returns a SHA1 hash', async () => {
    const dir = gitDir();
    try {
      const fp = fingerprintOf(await collectFacts(dir));
      assert.strictEqual(fp.length, 40);
      assert.ok(/^[0-9a-f]+$/.test(fp));
    } finally { rmRf(dir); }
  });

  it('is stable when nothing changes', async () => {
    const dir = gitDir();
    try {
      assert.strictEqual(fingerprintOf(await collectFacts(dir)), fingerprintOf(await collectFacts(dir)));
    } finally { rmRf(dir); }
  });

  it('changes when HEAD changes', async () => {
    const dir = gitDir();
    try {
      const fp1 = fingerprintOf(await collectFacts(dir));
      writeFileSync(join(dir, 'newfile'), 'x');
      execSync('git add newfile && git commit -m "new" -q', { cwd: dir, stdio: 'ignore' });
      const fp2 = fingerprintOf(await collectFacts(dir));
      assert.notStrictEqual(fp1, fp2);
    } finally { rmRf(dir); }
  });

  it('changes when instruction file porcelain changes', async () => {
    const dir = gitDir();
    try {
      const fp1 = fingerprintOf(await collectFacts(dir));
      writeFileSync(join(dir, 'CLAUDE.md'), 'new');
      const fp2 = fingerprintOf(await collectFacts(dir));
      assert.notStrictEqual(fp1, fp2);
    } finally { rmRf(dir); }
  });

  it('handles a non-repo facts object', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'not-repo-'));
    try {
      assert.strictEqual(fingerprintOf(await collectFacts(dir)).length, 40);
    } finally { rmRf(dir); }
  });
});

describe('exports', () => {
  it('INSTRUCTION_CANDIDATES is frozen and includes expected files', async () => {
    assert.ok(INSTRUCTION_CANDIDATES.includes('CLAUDE.md'));
    assert.ok(INSTRUCTION_CANDIDATES.includes('AGENTS.md'));
    assert.ok(INSTRUCTION_CANDIDATES.includes('GEMINI.md'));
    assert.throws(() => { INSTRUCTION_CANDIDATES.push('x'); }, TypeError);
  });

  it('HEAVY_DIRS is frozen and includes node_modules', async () => {
    assert.ok(HEAVY_DIRS.includes('node_modules'));
    assert.throws(() => { HEAVY_DIRS.push('x'); }, TypeError);
  });
});

describe('facts.quickFingerprint', () => {
  it('equals fingerprintOf(collectFacts) without collecting the rest: clean, modified, untracked, not a repo', async () => {
    const dir = gitDir();
    const plain = mkdtempSync(join(tmpdir(), 'qfp-'));
    try {
      assert.equal(await quickFingerprint(dir), fingerprintOf(await collectFacts(dir)));
      writeFileSync(join(dir, 'CLAUDE.md'), '# c');
      assert.equal(await quickFingerprint(dir), fingerprintOf(await collectFacts(dir)), 'untracked');
      execSync('git add -A && git commit -qm c', { cwd: dir, stdio: 'ignore' });
      writeFileSync(join(dir, 'CLAUDE.md'), '# changed');
      assert.equal(await quickFingerprint(dir), fingerprintOf(await collectFacts(dir)), 'modified');
      assert.equal(await quickFingerprint(plain), fingerprintOf(await collectFacts(plain)), 'not a repo');
    } finally { rmRf(dir); rmRf(plain); }
  });
});

// Security G2: every git call in a project goes through guardedGitEnv (src/core/git-guard.mjs). `git status` refreshes the
// index, which runs core.fsmonitor; the check runs right after a run, when an agent could have written .git/config.
describe('facts: git calls are async and guarded', () => {
  const POSIX = { skip: process.platform === 'win32' ? 'the planted command is a POSIX shell script' : false };

  it('collectFacts returns a promise: git never blocks the server', () => {
    const dir = gitDir();
    try {
      const p = collectFacts(dir);
      assert.ok(p instanceof Promise);
      return p;
    } finally { rmRf(dir); }
  });

  it('collectFacts and quickFingerprint run no planted core.fsmonitor', POSIX, async () => {
    const dir = gitDir();
    const mark = join(dir, '..', `${dir.split('/').pop()}.fsmonitor-ran`);
    const script = join(dir, '..', `${dir.split('/').pop()}.fsmonitor.sh`);
    try {
      writeFileSync(script, `#!/bin/sh\necho ran >> '${mark}'\nexit 0\n`);
      chmodSync(script, 0o755);
      writeFileSync(join(dir, 'AGENTS.md'), '# a');
      execSync('git add AGENTS.md && git commit -q -m a', { cwd: dir, stdio: 'ignore' });
      execSync(`git config core.fsmonitor '${script}'`, { cwd: dir, stdio: 'ignore' });
      writeFileSync(join(dir, 'AGENTS.md'), '# changed');
      const f = await collectFacts(dir);
      assert.equal(f.isRepo, true);
      assert.equal(f.instructionStatus['AGENTS.md'], ' M', 'status still read');
      await quickFingerprint(dir);
      assert.equal(existsSync(mark), false, 'core.fsmonitor ran');
    } finally { rmRf(dir); rmSync(script, { force: true }); rmSync(mark, { force: true }); }
  });

  it('a config the guard refuses gives an error, never "not a git repo"', async () => {
    const dir = gitDir();
    try {
      execSync('git config core.gitProxy evil-proxy', { cwd: dir, stdio: 'ignore' });   // first-wins: the guard refuses it
      const f = await collectFacts(dir);
      assert.ok(f.error, 'the refusal is recorded');
      assert.equal(f.timedOut, false);
      const { evaluateReadiness } = await import('../src/core/repo-readiness/evaluate.mjs');
      const r = await evaluateReadiness({ dir });
      assert.equal(r.repository.level, 'unknown');
      assert.equal(r.checks.find((c) => c.id === 'git.repo')?.status === 'fail', false, 'not reported as "not a git repo"');
    } finally { rmRf(dir); }
  });

});

// A Folder project (vcs 'none', or no git installed) runs on a copy of the folder: worca never runs git in it.
describe('facts: a Folder project runs no git', () => {
  const POSIX = { skip: process.platform === 'win32' ? 'the git shim is a POSIX shell script' : false };
  function withGitShim(fn) {
    const shim = mkdtempSync(join(tmpdir(), 'readiness-gitshim-'));
    const log = join(shim, 'calls.tsv');
    const real = execSync('command -v git', { encoding: 'utf8' }).trim();
    writeFileSync(join(shim, 'git'), `#!/bin/sh\nprintf '%s\\t%s\\n' "$PWD" "$*" >> '${log}'\nexec '${real}' "$@"\n`, { mode: 0o755 });
    const prev = process.env.PATH; process.env.PATH = `${shim}:${prev}`;
    const calls = () => (existsSync(log) ? execSync(`cat '${log}'`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean) : []);
    return Promise.resolve(fn(calls)).finally(() => { process.env.PATH = prev; rmSync(shim, { recursive: true, force: true }); });
  }

  it('collectFacts and quickFingerprint in folder mode spawn no git, and still read the instruction files', POSIX, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'readiness-folder-'));
    try {
      writeFileSync(join(dir, 'CLAUDE.md'), '# c');
      writeFileSync(join(dir, 'package.json'), '{"scripts":{"test":"node --test"}}');
      await withGitShim(async (calls) => {
        const f = await collectFacts(dir, { folder: true });
        const fp1 = await quickFingerprint(dir, { folder: true });
        writeFileSync(join(dir, 'CLAUDE.md'), '# changed, longer');
        const fp2 = await quickFingerprint(dir, { folder: true });
        assert.deepEqual(calls(), [], 'no git spawned');
        assert.equal(f.folder, true);
        assert.equal(f.isRepo, false);
        assert.equal(f.sizes['CLAUDE.md'], 3);
        assert.ok(f.manifests['package.json']);
        assert.notEqual(fp1, fp2, 'an instruction file edit moves the folder fingerprint');
      });
    } finally { rmRf(dir); }
  });
});
