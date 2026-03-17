import { describe, it, expect } from 'vitest';

describe('Pricing Editor constants and readPricingFromDom', () => {
  it('exports PRICING_MODELS with opus and sonnet', async () => {
    const { PRICING_MODELS } = await import('./settings.js');
    expect(PRICING_MODELS).toEqual(['opus', 'sonnet']);
  });

  it('exports PRICING_FIELDS with 4 cost columns', async () => {
    const { PRICING_FIELDS } = await import('./settings.js');
    expect(PRICING_FIELDS).toHaveLength(4);
    const keys = PRICING_FIELDS.map(f => f.key);
    expect(keys).toContain('input_per_mtok');
    expect(keys).toContain('output_per_mtok');
    expect(keys).toContain('cache_write_per_mtok');
    expect(keys).toContain('cache_read_per_mtok');
    // Each field has a label
    for (const f of PRICING_FIELDS) {
      expect(typeof f.label).toBe('string');
      expect(f.label.length).toBeGreaterThan(0);
    }
  });

  it('exports DEFAULT_PRICING with correct structure', async () => {
    const { DEFAULT_PRICING } = await import('./settings.js');
    expect(DEFAULT_PRICING.models.opus).toBeDefined();
    expect(DEFAULT_PRICING.models.sonnet).toBeDefined();
    expect(DEFAULT_PRICING.currency).toBe('USD');
    expect(typeof DEFAULT_PRICING.last_updated).toBe('string');
    // Opus costs
    expect(DEFAULT_PRICING.models.opus.input_per_mtok).toBe(15);
    expect(DEFAULT_PRICING.models.opus.output_per_mtok).toBe(75);
    // Sonnet costs
    expect(DEFAULT_PRICING.models.sonnet.input_per_mtok).toBe(3);
    expect(DEFAULT_PRICING.models.sonnet.output_per_mtok).toBe(15);
  });

  it('exports readPricingFromDom as a function', async () => {
    const { readPricingFromDom } = await import('./settings.js');
    expect(typeof readPricingFromDom).toBe('function');
  });
});
