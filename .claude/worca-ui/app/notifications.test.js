/**
 * Unit tests for notification event detector functions.
 */
import { describe, expect, it } from 'vitest';
import {
  detectApprovalNeeded,
  detectLoopLimitWarning,
  detectRunCompleted,
  detectRunFailed,
  detectTestFailures,
} from './notifications.js';

function makeRun(overrides = {}) {
  return {
    id: 'run-1',
    active: true,
    work_request: { title: 'Test Pipeline' },
    stages: {},
    ...overrides,
  };
}

describe('detectRunCompleted', () => {
  it('detects run completion (active→inactive, no errors)', () => {
    const prev = makeRun({ active: true });
    const next = makeRun({
      active: false,
      stages: { plan: { status: 'completed' }, test: { status: 'completed' } },
    });
    const result = detectRunCompleted('run-1', next, prev);
    expect(result).not.toBeNull();
    expect(result.event).toBe('run_completed');
    expect(result.body).toContain('Test Pipeline');
    expect(result.tag).toBe('worca-complete-run-1');
  });

  it('returns null when run has errors', () => {
    const prev = makeRun({ active: true });
    const next = makeRun({
      active: false,
      stages: { plan: { status: 'completed' }, test: { status: 'error' } },
    });
    expect(detectRunCompleted('run-1', next, prev)).toBeNull();
  });

  it('returns null when run is still active', () => {
    const prev = makeRun({ active: true });
    const next = makeRun({ active: true });
    expect(detectRunCompleted('run-1', next, prev)).toBeNull();
  });

  it('returns null with no previous run', () => {
    expect(detectRunCompleted('run-1', makeRun(), null)).toBeNull();
  });
});

describe('detectRunFailed', () => {
  it('detects run failure with stage name', () => {
    const prev = makeRun({ active: true });
    const next = makeRun({
      active: false,
      stages: { plan: { status: 'completed' }, test: { status: 'error' } },
    });
    const result = detectRunFailed('run-1', next, prev);
    expect(result).not.toBeNull();
    expect(result.event).toBe('run_failed');
    expect(result.body).toContain('test');
  });

  it('returns null when no errors', () => {
    const prev = makeRun({ active: true });
    const next = makeRun({
      active: false,
      stages: { plan: { status: 'completed' } },
    });
    expect(detectRunFailed('run-1', next, prev)).toBeNull();
  });

  it('returns null when run is still active', () => {
    const prev = makeRun({ active: true });
    const next = makeRun({
      active: true,
      stages: { plan: { status: 'error' } },
    });
    expect(detectRunFailed('run-1', next, prev)).toBeNull();
  });
});

describe('detectApprovalNeeded', () => {
  it('detects approval needed transition', () => {
    const prev = makeRun({ stages: { plan: { status: 'in_progress' } } });
    const next = makeRun({ stages: { plan: { status: 'waiting_approval' } } });
    const result = detectApprovalNeeded('run-1', next, prev);
    expect(result).not.toBeNull();
    expect(result.event).toBe('approval_needed');
    expect(result.requireInteraction).toBe(true);
    expect(result.body).toContain('plan');
  });

  it('does not re-trigger for same status', () => {
    const prev = makeRun({ stages: { plan: { status: 'waiting_approval' } } });
    const next = makeRun({ stages: { plan: { status: 'waiting_approval' } } });
    expect(detectApprovalNeeded('run-1', next, prev)).toBeNull();
  });

  it('detects approval on first snapshot with PR label', () => {
    const next = makeRun({ stages: { pr: { status: 'waiting_approval' } } });
    const result = detectApprovalNeeded('run-1', next, null);
    expect(result).not.toBeNull();
    expect(result.body).toContain('PR');
  });
});

describe('detectTestFailures', () => {
  it('detects new failed test iteration', () => {
    const prev = makeRun({
      stages: { test: { status: 'in_progress', iterations: [] } },
    });
    const next = makeRun({
      stages: {
        test: { status: 'in_progress', iterations: [{ result: 'failed' }] },
      },
    });
    const result = detectTestFailures('run-1', next, prev);
    expect(result).not.toBeNull();
    expect(result.event).toBe('test_failures');
    expect(result.body).toContain('iteration 1');
  });

  it('does not trigger for passed test', () => {
    const prev = makeRun({
      stages: { test: { status: 'in_progress', iterations: [] } },
    });
    const next = makeRun({
      stages: {
        test: { status: 'in_progress', iterations: [{ result: 'passed' }] },
      },
    });
    expect(detectTestFailures('run-1', next, prev)).toBeNull();
  });

  it('does not trigger when no new iteration', () => {
    const prev = makeRun({
      stages: {
        test: { status: 'in_progress', iterations: [{ result: 'failed' }] },
      },
    });
    const next = makeRun({
      stages: {
        test: { status: 'in_progress', iterations: [{ result: 'failed' }] },
      },
    });
    expect(detectTestFailures('run-1', next, prev)).toBeNull();
  });
});

describe('detectRunCompleted with projectName', () => {
  it('includes project name in body when provided', () => {
    const prev = makeRun({ active: true });
    const next = makeRun({
      active: false,
      stages: { plan: { status: 'completed' } },
    });
    const result = detectRunCompleted('run-1', next, prev, 'my-project');
    expect(result).not.toBeNull();
    expect(result.body).toContain('[my-project]');
    expect(result.body).toContain('Test Pipeline');
  });

  it('omits project name when null', () => {
    const prev = makeRun({ active: true });
    const next = makeRun({
      active: false,
      stages: { plan: { status: 'completed' } },
    });
    const result = detectRunCompleted('run-1', next, prev, null);
    expect(result).not.toBeNull();
    expect(result.body).not.toContain('[');
  });
});

describe('detectRunFailed with projectName', () => {
  it('includes project name in body', () => {
    const prev = makeRun({ active: true });
    const next = makeRun({
      active: false,
      stages: { test: { status: 'error' } },
    });
    const result = detectRunFailed('run-1', next, prev, 'backend');
    expect(result).not.toBeNull();
    expect(result.body).toContain('[backend]');
  });
});

describe('detectApprovalNeeded with projectName', () => {
  it('includes project name in body', () => {
    const prev = makeRun({ stages: { plan: { status: 'in_progress' } } });
    const next = makeRun({ stages: { plan: { status: 'waiting_approval' } } });
    const result = detectApprovalNeeded('run-1', next, prev, 'frontend');
    expect(result).not.toBeNull();
    expect(result.body).toContain('[frontend]');
  });
});

describe('detectTestFailures with projectName', () => {
  it('includes project name in body', () => {
    const prev = makeRun({
      stages: { test: { status: 'in_progress', iterations: [] } },
    });
    const next = makeRun({
      stages: {
        test: { status: 'in_progress', iterations: [{ result: 'failed' }] },
      },
    });
    const result = detectTestFailures('run-1', next, prev, 'api-svc');
    expect(result).not.toBeNull();
    expect(result.body).toContain('[api-svc]');
  });
});

describe('detectLoopLimitWarning', () => {
  it('detects loop limit warning at limit-1', () => {
    const warnedLoops = new Set();
    const settings = { worca: { loops: { implement_test: 3 } } };
    const prev = makeRun();
    const next = makeRun({
      stages: {
        implement: {
          status: 'in_progress',
          iterations: [{ result: 'done' }, { result: 'done' }],
        },
      },
    });
    const result = detectLoopLimitWarning(
      'run-1',
      next,
      prev,
      settings,
      warnedLoops,
    );
    expect(result).not.toBeNull();
    expect(result.event).toBe('loop_limit_warning');
    expect(result.body).toContain('2/3');
  });

  it('does not warn below limit-1', () => {
    const warnedLoops = new Set();
    const settings = { worca: { loops: { implement_test: 3 } } };
    const prev = makeRun();
    const next = makeRun({
      stages: {
        implement: { status: 'in_progress', iterations: [{ result: 'done' }] },
      },
    });
    expect(
      detectLoopLimitWarning('run-1', next, prev, settings, warnedLoops),
    ).toBeNull();
  });

  it('deduplicates warnings per stage per run', () => {
    const warnedLoops = new Set();
    const settings = { worca: { loops: { implement_test: 3 } } };
    const prev = makeRun();
    const next = makeRun({
      stages: {
        implement: {
          status: 'in_progress',
          iterations: [{ result: 'done' }, { result: 'done' }],
        },
      },
    });

    detectLoopLimitWarning('run-1', next, prev, settings, warnedLoops);
    expect(
      detectLoopLimitWarning('run-1', next, prev, settings, warnedLoops),
    ).toBeNull();
  });
});
