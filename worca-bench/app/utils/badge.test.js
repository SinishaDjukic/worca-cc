import { describe, expect, it } from 'vitest';
import { OUTCOME_VARIANT, outcomeOf, variantFor } from './badge.js';

describe('outcomeOf', () => {
  it('maps a graded+resolved row to resolved', () => {
    expect(outcomeOf({ status: 'graded', resolved: true })).toBe('resolved');
  });

  it('maps a graded+unresolved row to unresolved', () => {
    expect(outcomeOf({ status: 'graded', resolved: false, score: 0 })).toBe(
      'unresolved',
    );
  });

  it('maps a partial score to partial', () => {
    expect(outcomeOf({ status: 'graded', resolved: false, score: 0.5 })).toBe(
      'partial',
    );
  });

  it('maps error / skipped straight through', () => {
    expect(outcomeOf({ status: 'error' })).toBe('error');
    expect(outcomeOf({ status: 'skipped' })).toBe('skipped');
  });

  // Regression: a completed grade must win over a stale pipeline_status from the
  // original agent run's telemetry (regrade updates the verdict, not that field).
  // Previously this rendered as "running" forever after a regrade.
  it('ignores a stale pipeline_status:running on a graded row', () => {
    expect(
      outcomeOf({
        status: 'graded',
        resolved: false,
        score: 0,
        pipeline_status: 'running',
        grade_mode: 'modal',
      }),
    ).toBe('unresolved');
    expect(
      outcomeOf({
        status: 'graded',
        resolved: true,
        pipeline_status: 'running',
      }),
    ).toBe('resolved');
  });

  it('still surfaces a genuinely non-terminal row as running', () => {
    expect(outcomeOf({ status: 'running' })).toBe('running');
    expect(outcomeOf({ pipeline_status: 'running' })).toBe('running');
  });

  it('every outcome has a known badge variant', () => {
    for (const o of [
      'resolved',
      'unresolved',
      'partial',
      'error',
      'skipped',
      'running',
      'unknown',
    ]) {
      expect(OUTCOME_VARIANT[o]).toBeTruthy();
    }
    expect(variantFor('resolved')).toBe('success');
  });
});
