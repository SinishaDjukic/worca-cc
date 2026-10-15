import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { collectFacts } from '../src/core/repo-readiness/facts.mjs';
import { DECLARED_ENGINES } from '../src/core/repo-readiness/engines.mjs';
import { evaluateReadiness, readinessEnabled } from '../src/core/repo-readiness/evaluate.mjs';
import { getCachedOrEvaluate } from '../src/core/repo-readiness/cache.mjs';
import { listEngines } from '../src/core/engines/index.mjs';
import { CLAUDE_INSTRUCTION_FILES } from '../src/core/engines/claude.mjs';
import { CODEX_INSTRUCTION_FILES } from '../src/core/engines/codex.mjs';
import { COPILOT_INSTRUCTION_FILES } from '../src/core/engines/copilot.mjs';
import { CURSOR_INSTRUCTION_FILES } from '../src/core/engines/cursor.mjs';

const LEVELS = ['ready', 'partial', 'not-ready', 'unknown'];

function gitDir() {
  const dir = mkdtempSync(join(tmpdir(), 'int-'));
  execSync('git init -q && git config user.email "t@t" && git config user.name "T" && git commit --allow-empty -m "init" -q', { cwd: dir, stdio: 'ignore' });
  return dir;
}

function commitAll(dir) {
  execSync('git add . && git commit -m "x" -q', { cwd: dir, stdio: 'ignore' });
}

function rmRf(dir) {
  rmSync(dir, { recursive: true, force: true });
}

describe('readiness integration', () => {
  it('full pipeline: facts → checks → engines → evaluate', async () => {
    const dir = gitDir();
    try {
      writeFileSync(join(dir, 'package.json'), '{"scripts":{"test":"jest"}}');
      commitAll(dir);

      const facts = collectFacts(dir);
      assert.ok(facts.isRepo);
      assert.ok(facts.headSha);

      const report = await evaluateReadiness({ dir, projectKey: 'int-pipeline' });
      assert.equal(report.catalogVersion, 2);
      assert.ok(report.engines);
      assert.ok(Array.isArray(report.checks));

      for (const eng of Object.values(report.engines)) assert.ok(LEVELS.includes(eng.level));
      for (const name of DECLARED_ENGINES) assert.ok(name in report.engines);
    } finally { rmRf(dir); }
  });

  it('cache serves the same evaluation while the fingerprint is unchanged', async () => {
    const dir = gitDir();
    try {
      const r1 = await getCachedOrEvaluate({ dir, projectKey: 'int-cache' });
      const r2 = await getCachedOrEvaluate({ dir, projectKey: 'int-cache' });
      assert.deepStrictEqual(r1, r2);
    } finally { rmRf(dir); }
  });

  it('ignore list removes a check from the failing set', async () => {
    const dir = gitDir();
    try {
      writeFileSync(join(dir, 'package.json'), '{}');
      commitAll(dir);

      const r1 = await evaluateReadiness({ dir, projectKey: 'int-ignore', ignore: [] });
      const r2 = await evaluateReadiness({ dir, projectKey: 'int-ignore', ignore: ['commands.test'] });

      assert.ok(r1.repository.failing.includes('commands.test'));
      assert.ok(!r2.repository.failing.includes('commands.test'));
      assert.ok(r2.checks.some((r) => r.id === 'commands.test' && r.status === 'ignored'));
    } finally { rmRf(dir); }
  });

  it('engine instruction-file constants are non-empty except cursor', () => {
    assert.ok(CLAUDE_INSTRUCTION_FILES.length > 0);
    assert.ok(CODEX_INSTRUCTION_FILES.length > 0);
    assert.ok(COPILOT_INSTRUCTION_FILES.length > 0);
    assert.equal(CURSOR_INSTRUCTION_FILES.length, 0);
  });

  it('every non-mock engine has a declared source entry', () => {
    const declared = new Set(DECLARED_ENGINES);
    for (const { name } of listEngines()) {
      if (name === 'mock') continue;
      assert.ok(declared.has(name), `Engine ${name} not in DECLARED_ENGINES`);
    }
  });

  it('kill switch disables evaluation', () => {
    assert.equal(readinessEnabled({ WORCA_READINESS: '0' }), false);
    assert.equal(readinessEnabled({ WORCA_READINESS: 'false' }), false);
    assert.equal(readinessEnabled({}), true);
  });

  it('report format matches spec (catalogVersion, engines, checks)', async () => {
    const dir = gitDir();
    try {
      const report = await evaluateReadiness({ dir, projectKey: 'int-format' });

      assert.equal(report.catalogVersion, 2);
      assert.equal(typeof report.engines, 'object');
      assert.ok(Array.isArray(report.checks));

      for (const row of report.checks) {
        assert.equal(typeof row.id, 'string');
        assert.equal(typeof row.title, 'string');
        assert.ok(['blocker', 'warn', 'info'].includes(row.severity));
        assert.ok(['pass', 'fail', 'skip', 'error', 'ignored'].includes(row.status));
        assert.equal(typeof row.fix, 'string');
        assert.ok(row.scope === 'repository' ? row.engine === undefined : typeof row.engine === 'string');
      }

      for (const eng of Object.values(report.engines)) {
        assert.ok(LEVELS.includes(eng.level));
        assert.ok(Array.isArray(eng.failing));
      }
    } finally { rmRf(dir); }
  });

  it('tiny timeout still yields a report', async () => {
    const dir = gitDir();
    try {
      const report = await evaluateReadiness({ dir, projectKey: 'int-timeout', timeoutMs: 1 });
      assert.ok(report);
      assert.ok(report.engines);
    } finally { rmRf(dir); }
  });

  it('non-existent dir does not throw', async () => {
    const report = await evaluateReadiness({ dir: '/nonexistent/path', projectKey: 'int-missing' });
    assert.ok(report);
    assert.ok(report.engines);
  });
});
