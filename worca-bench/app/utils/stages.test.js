import { describe, expect, it } from 'vitest';
import { STAGE_ORDER, sortStagesByOrder, stageLabel } from './stages.js';

describe('stage order', () => {
  it('mirrors the canonical worca pipeline order', () => {
    expect(STAGE_ORDER).toEqual([
      'preflight',
      'plan',
      'plan_review',
      'coordinate',
      'implement',
      'test',
      'review',
      'pr',
      'learn',
    ]);
  });

  it('sorts scrambled stages into canonical order', () => {
    const scrambled = [
      { name: 'pr' },
      { name: 'plan_review' },
      { name: 'preflight' },
      { name: 'plan' },
    ];
    expect(sortStagesByOrder(scrambled).map((s) => s.name)).toEqual([
      'preflight',
      'plan',
      'plan_review',
      'pr',
    ]);
  });

  it('puts unknown stages at the end, preserving known order', () => {
    const stages = [
      { name: 'mystery' },
      { name: 'plan' },
      { name: 'preflight' },
    ];
    expect(sortStagesByOrder(stages).map((s) => s.name)).toEqual([
      'preflight',
      'plan',
      'mystery',
    ]);
  });

  it('tolerates null/undefined', () => {
    expect(sortStagesByOrder(null)).toEqual([]);
    expect(sortStagesByOrder(undefined)).toEqual([]);
  });
});

describe('stageLabel', () => {
  it('title-cases snake_case keys', () => {
    expect(stageLabel('plan_review')).toBe('Plan Review');
    expect(stageLabel('coordinate')).toBe('Coordinate');
    expect(stageLabel('preflight')).toBe('Preflight');
  });

  it('upper-cases known acronyms', () => {
    expect(stageLabel('pr')).toBe('PR');
    expect(stageLabel('crg')).toBe('CRG');
  });

  it('returns empty string for a falsy key', () => {
    expect(stageLabel('')).toBe('');
    expect(stageLabel(undefined)).toBe('');
  });
});
