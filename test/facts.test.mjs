import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { collectFacts, fingerprintOf, INSTRUCTION_CANDIDATES, HEAVY_DIRS } from '../src/core/repo-readiness/facts.mjs';

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
  it('detects a git repo with HEAD', () => {
    const dir = gitDir();
    try {
      const f = collectFacts(dir);
      assert.ok(f.isRepo);
      assert.ok(f.headSha && f.headSha.length === 40);
      assert.ok(Array.isArray(f.tracked));
      assert.ok(f.trackedSet instanceof Set);
    } finally { rmRf(dir); }
  });

  it('returns not-a-repo for non-git dirs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'not-repo-'));
    try {
      const f = collectFacts(dir);
      assert.strictEqual(f.isRepo, false);
      assert.strictEqual(f.tracked, null);
    } finally { rmRf(dir); }
  });

  it('collects instruction file status (committed, untracked, modified)', () => {
    const dir = gitDir();
    try {
      writeFileSync(join(dir, 'CLAUDE.md'), 'test');
      execSync('git add CLAUDE.md', { cwd: dir });
      execSync('git commit -m "add CLAUDE"', { cwd: dir, stdio: 'ignore' });
      writeFileSync(join(dir, 'CLAUDE.md'), 'test changed');
      writeFileSync(join(dir, 'AGENTS.md'), 'agents');

      const f = collectFacts(dir);
      assert.strictEqual(f.instructionStatus['CLAUDE.md'], ' M');
      assert.strictEqual(f.instructionStatus['AGENTS.md'], '??');
    } finally { rmRf(dir); }
  });

  it('collects file sizes of instruction candidates', () => {
    const dir = gitDir();
    try {
      writeFileSync(join(dir, 'CLAUDE.md'), 'x'.repeat(1000));
      execSync('git add CLAUDE.md && git commit -m "add" -q', { cwd: dir, stdio: 'ignore' });

      const f = collectFacts(dir);
      assert.ok(f.sizes['CLAUDE.md'] >= 1000);
    } finally { rmRf(dir); }
  });

  it('primes tracked instruction text, bounded by the read cap', () => {
    const dir = gitDir();
    try {
      writeFileSync(join(dir, 'AGENTS.md'), 'y'.repeat(300 * 1024));
      execSync('git add AGENTS.md && git commit -m "add" -q', { cwd: dir, stdio: 'ignore' });

      const f = collectFacts(dir);
      assert.strictEqual(f.texts['AGENTS.md'].length, 256 * 1024);
    } finally { rmRf(dir); }
  });

  it('reads tracked manifests into facts.manifests', () => {
    const dir = gitDir();
    try {
      writeFileSync(join(dir, 'package.json'), '{"scripts":{"test":"echo test"}}');
      writeFileSync(join(dir, 'Makefile'), 'all:\n');
      execSync('git add package.json && git commit -m "add" -q', { cwd: dir, stdio: 'ignore' });

      const f = collectFacts(dir);
      assert.ok(f.manifests['package.json'].includes('test'));
      assert.ok(!('Makefile' in f.manifests), 'untracked manifests are skipped');
    } finally { rmRf(dir); }
  });

  it('detects heavy dirs and git check-ignore status', () => {
    const dir = gitDir();
    try {
      writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
      mkdirSync(join(dir, 'node_modules'));
      writeFileSync(join(dir, 'node_modules', 'file.txt'), 'x');
      mkdirSync(join(dir, 'dist'));
      writeFileSync(join(dir, 'dist', 'a.js'), 'x');

      const f = collectFacts(dir);
      assert.ok(f.heavyPresent.includes('node_modules'));
      assert.strictEqual(f.heavyIgnored['node_modules'], true);
      assert.strictEqual(f.heavyIgnored['dist'], false);
    } finally { rmRf(dir); }
  });

  it('respects timeout', () => {
    const dir = gitDir();
    try {
      const f = collectFacts(dir, { timeoutMs: 1, now: Date.now() });
      assert.ok(f.timedOut);
    } finally { rmRf(dir); }
  });

  it('reports truncated=false for small repos', () => {
    const dir = gitDir();
    try {
      const f = collectFacts(dir);
      assert.strictEqual(f.truncated, false);
    } finally { rmRf(dir); }
  });

  it('never throws for a missing directory', () => {
    const f = collectFacts(join(tmpdir(), 'readiness-does-not-exist-xyz'));
    assert.strictEqual(f.isRepo, false);
  });
});

describe('facts.fingerprintOf', () => {
  it('returns a SHA1 hash', () => {
    const dir = gitDir();
    try {
      const fp = fingerprintOf(collectFacts(dir));
      assert.strictEqual(fp.length, 40);
      assert.ok(/^[0-9a-f]+$/.test(fp));
    } finally { rmRf(dir); }
  });

  it('is stable when nothing changes', () => {
    const dir = gitDir();
    try {
      assert.strictEqual(fingerprintOf(collectFacts(dir)), fingerprintOf(collectFacts(dir)));
    } finally { rmRf(dir); }
  });

  it('changes when HEAD changes', () => {
    const dir = gitDir();
    try {
      const fp1 = fingerprintOf(collectFacts(dir));
      writeFileSync(join(dir, 'newfile'), 'x');
      execSync('git add newfile && git commit -m "new" -q', { cwd: dir, stdio: 'ignore' });
      const fp2 = fingerprintOf(collectFacts(dir));
      assert.notStrictEqual(fp1, fp2);
    } finally { rmRf(dir); }
  });

  it('changes when instruction file porcelain changes', () => {
    const dir = gitDir();
    try {
      const fp1 = fingerprintOf(collectFacts(dir));
      writeFileSync(join(dir, 'CLAUDE.md'), 'new');
      const fp2 = fingerprintOf(collectFacts(dir));
      assert.notStrictEqual(fp1, fp2);
    } finally { rmRf(dir); }
  });

  it('handles a non-repo facts object', () => {
    const dir = mkdtempSync(join(tmpdir(), 'not-repo-'));
    try {
      assert.strictEqual(fingerprintOf(collectFacts(dir)).length, 40);
    } finally { rmRf(dir); }
  });
});

describe('exports', () => {
  it('INSTRUCTION_CANDIDATES is frozen and includes expected files', () => {
    assert.ok(INSTRUCTION_CANDIDATES.includes('CLAUDE.md'));
    assert.ok(INSTRUCTION_CANDIDATES.includes('AGENTS.md'));
    assert.throws(() => { INSTRUCTION_CANDIDATES.push('x'); }, TypeError);
  });

  it('HEAVY_DIRS is frozen and includes node_modules', () => {
    assert.ok(HEAVY_DIRS.includes('node_modules'));
    assert.throws(() => { HEAVY_DIRS.push('x'); }, TypeError);
  });
});
