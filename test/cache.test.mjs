import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import {
  cache, getCachedOrEvaluate, readinessSummary, _setEvaluateForTest,
} from '../src/core/repo-readiness/cache.mjs';
import { evaluateReadiness as realEvaluate } from '../src/core/repo-readiness/evaluate.mjs';

function gitDir() {
  const dir = mkdtempSync(join(tmpdir(), 'cache-'));
  execSync('git init -q && git config user.email "t@t" && git config user.name "T" && git commit --allow-empty -m "init" -q', { cwd: dir, stdio: 'ignore' });
  return dir;
}

function rmRf(dir) {
  rmSync(dir, { recursive: true, force: true });
}

function commitAll(dir) {
  execSync('git add . && git commit -m "x" -q', { cwd: dir, stdio: 'ignore' });
}

describe('getCachedOrEvaluate', () => {
  it('returns a report on first call', async () => {
    const dir = gitDir();
    try {
      const report = await getCachedOrEvaluate({ dir, projectKey: 'cache-first' });
      assert.ok(report);
      assert.ok(report.engines);
      assert.ok(Array.isArray(report.checks));
    } finally { rmRf(dir); }
  });

  it('returns the cached report on a second call if the fingerprint is unchanged', async () => {
    const dir = gitDir();
    try {
      const r1 = await getCachedOrEvaluate({ dir, projectKey: 'cache-hit' });
      const r2 = await getCachedOrEvaluate({ dir, projectKey: 'cache-hit' });
      assert.deepStrictEqual(r1, r2);
    } finally { rmRf(dir); }
  });

  it('re-evaluates if the fingerprint changes (commit)', async () => {
    const dir = gitDir();
    try {
      const r1 = await getCachedOrEvaluate({ dir, projectKey: 'cache-miss' });
      writeFileSync(join(dir, 'CLAUDE.md'), 'test');
      commitAll(dir);
      const r2 = await getCachedOrEvaluate({ dir, projectKey: 'cache-miss' });
      assert.notDeepStrictEqual(r1.engines.claude, r2.engines.claude);
    } finally { rmRf(dir); }
  });

  it('force re-evaluates past an unchanged fingerprint and refreshes the cached entry', async () => {
    const dir = gitDir();
    try {
      let calls = 0;
      _setEvaluateForTest(async (o) => { calls++; return realEvaluate(o); });
      try {
        await getCachedOrEvaluate({ dir, projectKey: 'cache-force' });
        const r2 = await getCachedOrEvaluate({ dir, projectKey: 'cache-force', force: true });
        assert.equal(calls, 2);
        const r3 = await getCachedOrEvaluate({ dir, projectKey: 'cache-force' });
        assert.equal(calls, 2);
        assert.equal(r3.checkedAt, r2.checkedAt, 'the forced report is what the cache now serves');
      } finally { _setEvaluateForTest(null); }
    } finally { rmRf(dir); }
  });

  it('re-evaluates if the ignore list changes', async () => {
    const dir = gitDir();
    try {
      const r1 = await getCachedOrEvaluate({ dir, projectKey: 'cache-ignore' });
      const r2 = await getCachedOrEvaluate({ dir, projectKey: 'cache-ignore', ignore: ['git.repo'] });
      assert.notEqual(r1.checks.find((c) => c.id === 'git.repo').status, 'ignored');
      assert.equal(r2.checks.find((c) => c.id === 'git.repo').status, 'ignored');
    } finally { rmRf(dir); }
  });

  it('dedupes concurrent requests for the same key', async () => {
    const dir = gitDir();
    let calls = 0;
    _setEvaluateForTest(async (o) => { calls++; return realEvaluate(o); });
    try {
      const [r1, r2] = await Promise.all([
        getCachedOrEvaluate({ dir, projectKey: 'cache-dedupe' }),
        getCachedOrEvaluate({ dir, projectKey: 'cache-dedupe' }),
      ]);
      assert.equal(calls, 1);
      assert.deepStrictEqual(r1, r2);
    } finally { _setEvaluateForTest(null); rmRf(dir); }
  });

  it('emits changed when a level or failing set changes, not otherwise', async () => {
    const dir = gitDir();
    const changed = [];
    const onChanged = (ev) => changed.push(ev);
    cache.on('changed', onChanged);
    try {
      const key = 'cache-changed';
      const r1 = await getCachedOrEvaluate({ dir, projectKey: key });
      assert.deepEqual(changed, [], 'first evaluation has no previous report to differ from');

      // Unchanged fingerprint → cache hit → no event.
      await getCachedOrEvaluate({ dir, projectKey: key });
      assert.deepEqual(changed, []);

      // Adding instruction files changes the failing set of at least one engine.
      writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n');
      writeFileSync(join(dir, 'CLAUDE.md'), '# Claude\n');
      commitAll(dir);
      const r2 = await getCachedOrEvaluate({ dir, projectKey: key });
      const differs = JSON.stringify(r1.engines) !== JSON.stringify(r2.engines);
      assert.strictEqual(changed.length, differs ? 1 : 0);
      if (differs) assert.deepEqual(changed[0], { projectKey: key });

      // A new commit that leaves levels and failing sets alone → no further event.
      const before = changed.length;
      writeFileSync(join(dir, 'other.txt'), 'x');
      commitAll(dir);
      const r3 = await getCachedOrEvaluate({ dir, projectKey: key });
      assert.strictEqual(JSON.stringify(r2.engines), JSON.stringify(r3.engines));
      assert.strictEqual(changed.length, before);
    } finally { cache.off('changed', onChanged); rmRf(dir); }
  });
});

describe('readinessSummary', () => {
  it('returns null for an uncached key', () => {
    assert.strictEqual(readinessSummary('nonexistent-key'), null);
  });

  it('summarizes the last built report: level and counts, no primaryEngine', async () => {
    const dir = gitDir();
    try {
      const report = await getCachedOrEvaluate({ dir, projectKey: 'cache-summary' });
      const summary = readinessSummary('cache-summary');
      assert.equal(summary.level, report.level);
      assert.equal(summary.failingCount, report.counts.mustFix + report.counts.shouldFix);
      assert.deepEqual(Object.keys(summary).sort(), ['applicable', 'failingCount', 'level', 'mustFix', 'passed', 'shouldFix']);
    } finally { rmRf(dir); }
  });
});

describe('final report on read', () => {
  it('builds the final report on every read: a usage change needs no re-evaluation', async () => {
    const dir = gitDir();
    writeFileSync(join(dir, 'CLAUDE.md'), '# c\n');
    commitAll(dir);
    let calls = 0;
    _setEvaluateForTest(async (o) => { calls++; return realEvaluate(o); });
    const changed = [];
    const onChanged = (ev) => changed.push(ev);
    cache.on('changed', onChanged);
    try {
      const usageA = () => ({ runEngine: 'claude', history: {}, settings: {} });
      const usageB = () => ({ runEngine: 'claude', history: {}, settings: { codex: 'used' } });
      const a = await getCachedOrEvaluate({ dir, projectKey: 'k-usage', usage: usageA });
      const b = await getCachedOrEvaluate({ dir, projectKey: 'k-usage', usage: usageB });
      assert.equal(calls, 1);
      assert.equal(a.engines.codex.level, 'unused');
      assert.equal(b.engines.codex.level, 'not-ready');
      assert.equal(readinessSummary('k-usage').level, 'not-ready');
      assert.ok(a.checkedAt && a.checkedAt === b.checkedAt, 'checkedAt is the evaluation time, not the read time');
      assert.deepEqual(changed, [{ projectKey: 'k-usage' }], 'a usage change that moves the result emits changed');
    } finally { cache.off('changed', onChanged); _setEvaluateForTest(null); rmRf(dir); }
  });
});
