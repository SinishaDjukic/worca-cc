import { describe, expect, it } from 'vitest';

describe('settings.js plan_review stage constants', () => {
  it('STAGE_ORDER contains plan_review between plan and coordinate', async () => {
    const { STAGE_ORDER } = await import('./settings.js');
    expect(STAGE_ORDER).toContain('plan_review');
    const planIdx = STAGE_ORDER.indexOf('plan');
    const reviewIdx = STAGE_ORDER.indexOf('plan_review');
    const coordinateIdx = STAGE_ORDER.indexOf('coordinate');
    expect(reviewIdx).toBeGreaterThan(planIdx);
    expect(reviewIdx).toBeLessThan(coordinateIdx);
  });

  it('STAGE_AGENT_MAP maps plan_review to plan_reviewer', async () => {
    const { STAGE_AGENT_MAP } = await import('./settings.js');
    expect(STAGE_AGENT_MAP.plan_review).toBe('plan_reviewer');
  });

  it('AGENT_NAMES includes plan_reviewer', async () => {
    const { AGENT_NAMES } = await import('./settings.js');
    expect(AGENT_NAMES).toContain('plan_reviewer');
  });
});
