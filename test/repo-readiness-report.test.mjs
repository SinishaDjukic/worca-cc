import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, summaryOf } from '../src/core/repo-readiness/report.mjs';

const row = (id, scope, severity, status, engine) => ({ id, title: id, scope, severity, status, fix: 'f', ...(engine ? { engine } : {}) });
const base = {
  catalogVersion: 2,
  checks: [
    row('git.repo', 'repository', 'blocker', 'pass'),
    row('commands.test', 'repository', 'warn', 'pass'),
    row('commands.build', 'repository', 'info', 'fail'),
    row('deps.lockfile', 'repository', 'warn', 'skip'),
    row('instructions.present', 'tool', 'blocker', 'pass', 'claude'),
    row('instructions.size', 'tool', 'warn', 'pass', 'claude'),
    row('instructions.present', 'tool', 'blocker', 'fail', 'codex'),
    row('instructions.committed', 'tool', 'warn', 'skip', 'codex'),
  ],
  repository: { level: 'ready', failing: ['commands.build'] },
  engines: { claude: { level: 'ready', failing: [] }, codex: { level: 'not-ready', failing: ['instructions.present'] } },
};
const usage = (codexUsed) => ({
  claude: { used: true, setting: 'detect', detected: true, reasons: [{ kind: 'run-engine', text: 'runs use it' }] },
  codex: { used: codexUsed, setting: codexUsed ? 'used' : 'detect', detected: false, reasons: codexUsed ? [{ kind: 'setting', text: 'set by you' }] : [] },
});

describe('buildReport', () => {
  it('fresh project: an unused tool never turns the chip red', () => {
    const r = buildReport(base, usage(false));
    assert.equal(r.level, 'ready');
    assert.equal(r.engines.codex.level, 'unused');
    assert.deepEqual(r.counts, { mustFix: 0, shouldFix: 0, passed: 4, applicable: 5 });   // info failing counts as applicable, not as a problem
    assert.deepEqual(summaryOf(r), { level: 'ready', failingCount: 0, mustFix: 0, shouldFix: 0, passed: 4, applicable: 5 });
  });

  it('a used tool with a blocker makes the project not-ready and counts once', () => {
    const r = buildReport(base, usage(true));
    assert.equal(r.level, 'not-ready');
    assert.equal(r.engines.codex.level, 'not-ready');
    assert.deepEqual(r.counts, { mustFix: 1, shouldFix: 0, passed: 4, applicable: 6 });
  });

  it('unknown anywhere among the judged makes the project unknown', () => {
    const r = buildReport({ ...base, repository: { level: 'unknown', failing: [] } }, usage(false));
    assert.equal(r.level, 'unknown');
  });

  it('passes the first detection signal through as detectedReason', () => {
    const u = usage(false);
    u.codex.signals = [{ kind: 'history', text: 'used in 2 runs' }];
    assert.equal(buildReport(base, u).engines.codex.detectedReason, 'used in 2 runs');
  });

  it('a locked engine is never used', () => {
    const locked = { ...base, engines: { ...base.engines, codex: { level: 'unknown', failing: [], locked: 'broker on' } } };
    const r = buildReport(locked, usage(true));
    assert.equal(r.engines.codex.used, false);
    assert.equal(r.engines.codex.level, 'locked');
    assert.equal(r.level, 'ready');
  });
});
