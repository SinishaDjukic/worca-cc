import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { evaluateReadiness, readinessEnabled } from '../src/core/repo-readiness/evaluate.mjs';

function gitDir() {
  const dir = mkdtempSync(join(tmpdir(), 'eval-'));
  execSync('git init -q && git config user.email "t@t" && git config user.name "T" && git commit --allow-empty -m "init" -q', { cwd: dir, stdio: 'ignore' });
  return dir;
}

function rmRf(dir) {
  execSync('rm -rf ' + dir, { stdio: 'ignore' });
}

function withEnv(value, fn) {
  const orig = process.env.WORCA_READINESS;
  try {
    if (value === undefined) delete process.env.WORCA_READINESS;
    else process.env.WORCA_READINESS = value;
    return fn();
  } finally {
    if (orig === undefined) delete process.env.WORCA_READINESS;
    else process.env.WORCA_READINESS = orig;
  }
}

describe('readinessEnabled', () => {
  it('returns true by default', () => {
    withEnv(undefined, () => assert.strictEqual(readinessEnabled(), true));
  });

  it('returns false when WORCA_READINESS=0 or false', () => {
    withEnv('0', () => assert.strictEqual(readinessEnabled(), false));
    withEnv('false', () => assert.strictEqual(readinessEnabled(), false));
    withEnv('FALSE', () => assert.strictEqual(readinessEnabled(), false));
  });

  it('returns true for other values', () => {
    withEnv('1', () => assert.strictEqual(readinessEnabled(), true));
  });
});

describe('evaluateReadiness', () => {
  it('returns a report object with proper shape', async () => {
    const dir = gitDir();
    try {
      const report = await evaluateReadiness({ dir, projectKey: 'test' });

      assert.ok(report);
      assert.strictEqual(report.catalogVersion, 1);
      assert.ok(typeof report.engines === 'object');
      assert.ok(Array.isArray(report.checks));

      assert.ok(report.engines.claude);
      assert.ok(report.engines.codex);
      assert.ok(report.engines.copilot);
      assert.ok(report.engines.cursor);
    } finally { rmRf(dir); }
  });

  it('computes proper engine levels', async () => {
    const dir = gitDir();
    try {
      writeFileSync(join(dir, 'package.json'), '{"scripts":{"test":"jest"}}');
      execSync('git add . && git commit -m "x" -q', { cwd: dir, stdio: 'ignore' });

      const report = await evaluateReadiness({ dir, projectKey: 'test' });

      for (const eng of Object.values(report.engines)) {
        assert.ok(['ready', 'partial', 'not-ready', 'unknown'].includes(eng.level));
        assert.ok(Array.isArray(eng.failing));
      }
    } finally { rmRf(dir); }
  });

  it('returns checks array with all engine checks', async () => {
    const dir = gitDir();
    try {
      const report = await evaluateReadiness({ dir, projectKey: 'test' });

      assert.ok(report.checks.length > 0);
      for (const row of report.checks) {
        assert.ok(typeof row.id === 'string');
        assert.ok(typeof row.title === 'string');
        assert.ok(['blocker', 'warn', 'info'].includes(row.severity));
        assert.ok(['pass', 'fail', 'skip', 'error', 'ignored'].includes(row.status));
        assert.ok(typeof row.fix === 'string');
      }
    } finally { rmRf(dir); }
  });

  it('respects ignore list', async () => {
    const dir = gitDir();
    try {
      writeFileSync(join(dir, 'package.json'), '{}');
      execSync('git add . && git commit -m "x" -q', { cwd: dir, stdio: 'ignore' });

      const r1 = await evaluateReadiness({ dir, projectKey: 'test', ignore: [] });
      const failing1 = r1.engines.claude?.failing || [];

      const r2 = await evaluateReadiness({ dir, projectKey: 'test', ignore: ['commands.test'] });
      const failing2 = r2.engines.claude?.failing || [];

      assert.ok(failing1.length >= failing2.length);
      assert.ok(!failing2.includes('commands.test'));
    } finally { rmRf(dir); }
  });

  it('never throws and reports unknown levels for a missing folder', async () => {
    const report = await evaluateReadiness({ dir: '/nonexistent/path' });
    assert.ok(report);
    assert.strictEqual(report.catalogVersion, 1);
    for (const eng of Object.values(report.engines)) assert.strictEqual(eng.level, 'unknown');
  });

  it('never throws when called with no arguments', async () => {
    const report = await evaluateReadiness();
    assert.strictEqual(report.catalogVersion, 1);
    assert.ok(Array.isArray(report.checks));
  });

  it('handles timeout gracefully', async () => {
    const dir = gitDir();
    try {
      const report = await evaluateReadiness({ dir, projectKey: 'test', timeoutMs: 1 });
      assert.ok(report);
      assert.strictEqual(report.catalogVersion, 1);
    } finally { rmRf(dir); }
  });

  it('accepts primaryEngine', async () => {
    const dir = gitDir();
    try {
      const report = await evaluateReadiness({ dir, projectKey: 'test', primaryEngine: 'claude' });
      assert.ok(report.engines.claude);
    } finally { rmRf(dir); }
  });
});
