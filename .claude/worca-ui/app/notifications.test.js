/**
 * Unit tests for notification event detector functions.
 * These are pure functions that take run state and return notification descriptors.
 */

import {
  detectRunCompleted,
  detectRunFailed,
  detectApprovalNeeded,
  detectTestFailures,
  detectLoopLimitWarning,
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

// --- detectRunCompleted ---

console.log('--- detectRunCompleted ---');

{
  const prev = makeRun({ active: true });
  const next = makeRun({ active: false, stages: { plan: { status: 'completed' }, test: { status: 'completed' } } });
  const result = detectRunCompleted('run-1', next, prev);
  console.assert(result !== null, 'should detect run completed');
  console.assert(result.event === 'run_completed', 'event should be run_completed');
  console.assert(result.body.includes('Test Pipeline'), 'body should include run title');
  console.assert(result.tag === 'worca-complete-run-1', 'tag should include runId');
  console.log('PASS: detects run completion');
}

{
  const prev = makeRun({ active: true });
  const next = makeRun({ active: false, stages: { plan: { status: 'completed' }, test: { status: 'error' } } });
  const result = detectRunCompleted('run-1', next, prev);
  console.assert(result === null, 'should not detect completed when errors exist');
  console.log('PASS: returns null when run has errors');
}

{
  const prev = makeRun({ active: true });
  const next = makeRun({ active: true });
  const result = detectRunCompleted('run-1', next, prev);
  console.assert(result === null, 'should not detect completed when still active');
  console.log('PASS: returns null when run is still active');
}

{
  const result = detectRunCompleted('run-1', makeRun(), null);
  console.assert(result === null, 'should return null when no previous run');
  console.log('PASS: returns null with no previous run');
}

// --- detectRunFailed ---

console.log('\n--- detectRunFailed ---');

{
  const prev = makeRun({ active: true });
  const next = makeRun({ active: false, stages: { plan: { status: 'completed' }, test: { status: 'error' } } });
  const result = detectRunFailed('run-1', next, prev);
  console.assert(result !== null, 'should detect run failure');
  console.assert(result.event === 'run_failed', 'event should be run_failed');
  console.assert(result.body.includes('test'), 'body should include failed stage name');
  console.log('PASS: detects run failure with stage name');
}

{
  const prev = makeRun({ active: true });
  const next = makeRun({ active: false, stages: { plan: { status: 'completed' } } });
  const result = detectRunFailed('run-1', next, prev);
  console.assert(result === null, 'should not detect failure when no errors');
  console.log('PASS: returns null when no errors');
}

// --- detectApprovalNeeded ---

console.log('\n--- detectApprovalNeeded ---');

{
  const prev = makeRun({ stages: { plan: { status: 'in_progress' } } });
  const next = makeRun({ stages: { plan: { status: 'waiting_approval' } } });
  const result = detectApprovalNeeded('run-1', next, prev);
  console.assert(result !== null, 'should detect approval needed');
  console.assert(result.event === 'approval_needed', 'event should be approval_needed');
  console.assert(result.requireInteraction === true, 'should require interaction');
  console.assert(result.body.includes('plan'), 'body should include stage name');
  console.log('PASS: detects approval needed transition');
}

{
  const prev = makeRun({ stages: { plan: { status: 'waiting_approval' } } });
  const next = makeRun({ stages: { plan: { status: 'waiting_approval' } } });
  const result = detectApprovalNeeded('run-1', next, prev);
  console.assert(result === null, 'should not re-trigger when already waiting');
  console.log('PASS: does not re-trigger for same status');
}

{
  const next = makeRun({ stages: { pr: { status: 'waiting_approval' } } });
  const result = detectApprovalNeeded('run-1', next, null);
  console.assert(result !== null, 'should detect approval on first snapshot');
  console.assert(result.body.includes('PR'), 'body should show PR for pr stage');
  console.log('PASS: detects approval on first snapshot, PR label');
}

// --- detectTestFailures ---

console.log('\n--- detectTestFailures ---');

{
  const prev = makeRun({ stages: { test: { status: 'in_progress', iterations: [] } } });
  const next = makeRun({ stages: { test: { status: 'in_progress', iterations: [{ result: 'failed' }] } } });
  const result = detectTestFailures('run-1', next, prev);
  console.assert(result !== null, 'should detect test failure');
  console.assert(result.event === 'test_failures', 'event should be test_failures');
  console.assert(result.body.includes('iteration 1'), 'body should include iteration number');
  console.log('PASS: detects new failed test iteration');
}

{
  const prev = makeRun({ stages: { test: { status: 'in_progress', iterations: [] } } });
  const next = makeRun({ stages: { test: { status: 'in_progress', iterations: [{ result: 'passed' }] } } });
  const result = detectTestFailures('run-1', next, prev);
  console.assert(result === null, 'should not trigger for passed test');
  console.log('PASS: does not trigger for passed test');
}

{
  const prev = makeRun({ stages: { test: { status: 'in_progress', iterations: [{ result: 'failed' }] } } });
  const next = makeRun({ stages: { test: { status: 'in_progress', iterations: [{ result: 'failed' }] } } });
  const result = detectTestFailures('run-1', next, prev);
  console.assert(result === null, 'should not trigger when iteration count unchanged');
  console.log('PASS: does not trigger when no new iteration');
}

// --- detectLoopLimitWarning ---

console.log('\n--- detectLoopLimitWarning ---');

{
  const warnedLoops = new Set();
  const settings = { worca: { loops: { implement_test: 3 } } };
  const prev = makeRun();
  const next = makeRun({ stages: { implement: { status: 'in_progress', iterations: [{ result: 'done' }, { result: 'done' }] } } });
  const result = detectLoopLimitWarning('run-1', next, prev, settings, warnedLoops);
  console.assert(result !== null, 'should detect loop limit warning at limit-1');
  console.assert(result.event === 'loop_limit_warning', 'event should be loop_limit_warning');
  console.assert(result.body.includes('2/3'), 'body should show count/limit');
  console.log('PASS: detects loop limit warning at limit-1');
}

{
  const warnedLoops = new Set();
  const settings = { worca: { loops: { implement_test: 3 } } };
  const prev = makeRun();
  const next = makeRun({ stages: { implement: { status: 'in_progress', iterations: [{ result: 'done' }] } } });
  const result = detectLoopLimitWarning('run-1', next, prev, settings, warnedLoops);
  console.assert(result === null, 'should not warn below limit-1');
  console.log('PASS: does not warn below limit-1');
}

{
  const warnedLoops = new Set();
  const settings = { worca: { loops: { implement_test: 3 } } };
  const prev = makeRun();
  const next = makeRun({ stages: { implement: { status: 'in_progress', iterations: [{ result: 'done' }, { result: 'done' }] } } });

  detectLoopLimitWarning('run-1', next, prev, settings, warnedLoops);
  const second = detectLoopLimitWarning('run-1', next, prev, settings, warnedLoops);
  console.assert(second === null, 'should not warn twice for same stage');
  console.log('PASS: deduplicates warnings per stage per run');
}

console.log('\nAll notification detector tests passed.');
