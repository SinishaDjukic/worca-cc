import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import {
  cache, getCachedOrEvaluate, readinessSummary,
} from '../src/core/repo-readiness/cache.mjs';

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
      assert.strictEqual(r1, r2);
    } finally { rmRf(dir); }
  });

  it('re-evaluates if the fingerprint changes (commit)', async () => {
    const dir = gitDir();
    try {
      const r1 = await getCachedOrEvaluate({ dir, projectKey: 'cache-miss' });
      writeFileSync(join(dir, 'CLAUDE.md'), 'test');
      commitAll(dir);
      const r2 = await getCachedOrEvaluate({ dir, projectKey: 'cache-miss' });
      assert.notStrictEqual(r1, r2);
    } finally { rmRf(dir); }
  });

  it('force re-evaluates past an unchanged fingerprint and refreshes the cached entry', async () => {
    const dir = gitDir();
    try {
      const r1 = await getCachedOrEvaluate({ dir, projectKey: 'cache-force' });
      const r2 = await getCachedOrEvaluate({ dir, projectKey: 'cache-force', force: true });
      assert.notStrictEqual(r1, r2);
      const r3 = await getCachedOrEvaluate({ dir, projectKey: 'cache-force' });
      assert.strictEqual(r3, r2, 'the forced report is what the cache now serves');
    } finally { rmRf(dir); }
  });

  it('re-evaluates if the ignore list changes', async () => {
    const dir = gitDir();
    try {
      const r1 = await getCachedOrEvaluate({ dir, projectKey: 'cache-ignore' });
      const r2 = await getCachedOrEvaluate({ dir, projectKey: 'cache-ignore', ignore: ['git.repo'] });
      assert.notStrictEqual(r1, r2);
    } finally { rmRf(dir); }
  });

  it('dedupes concurrent requests for the same key', async () => {
    const dir = gitDir();
    try {
      const p1 = getCachedOrEvaluate({ dir, projectKey: 'cache-dedupe' });
      const p2 = getCachedOrEvaluate({ dir, projectKey: 'cache-dedupe' });
      assert.strictEqual(p1, p2);
      assert.strictEqual(await p1, await p2);
    } finally { rmRf(dir); }
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
      assert.notStrictEqual(r2, r3);
      assert.strictEqual(JSON.stringify(r2.engines), JSON.stringify(r3.engines));
      assert.strictEqual(changed.length, before);
    } finally { cache.off('changed', onChanged); rmRf(dir); }
  });
});

describe('readinessSummary', () => {
  it('returns null for an uncached key', () => {
    assert.strictEqual(readinessSummary('nonexistent-key'), null);
  });

  it('returns {level, primaryEngine, failingCount} for a cached key', async () => {
    const dir = gitDir();
    try {
      const report = await getCachedOrEvaluate({ dir, projectKey: 'cache-summary', primaryEngine: 'claude' });
      const summary = readinessSummary('cache-summary');
      assert.ok(summary);
      assert.ok(['ready', 'partial', 'not-ready', 'unknown'].includes(summary.level));
      assert.strictEqual(summary.level, report.engines.claude.level);
      assert.strictEqual(summary.failingCount, report.engines.claude.failing.length);
      assert.strictEqual(summary.primaryEngine, 'claude');
    } finally { rmRf(dir); }
  });

  it('reports unknown when the primary engine is not in the report', async () => {
    const dir = gitDir();
    try {
      await getCachedOrEvaluate({ dir, projectKey: 'cache-noengine', primaryEngine: 'nope' });
      assert.deepEqual(readinessSummary('cache-noengine'), { level: 'unknown', primaryEngine: 'nope', failingCount: 0 });
    } finally { rmRf(dir); }
  });
});
