import { describe, it, expect } from 'vitest';
import { validateSettingsPayload } from './settings-validator.js';

describe('validateSettingsPayload — plan_path_template', () => {
  it('accepts a valid plan_path_template string', () => {
    const result = validateSettingsPayload({
      worca: { plan_path_template: 'docs/plans/{timestamp}-{title_slug}.md' }
    });
    expect(result.valid).toBe(true);
  });

  it('rejects non-string plan_path_template', () => {
    const result = validateSettingsPayload({
      worca: { plan_path_template: 123 }
    });
    expect(result.valid).toBe(false);
    expect(result.details).toContainEqual(expect.stringContaining('plan_path_template'));
  });

  it('rejects empty string plan_path_template', () => {
    const result = validateSettingsPayload({
      worca: { plan_path_template: '' }
    });
    expect(result.valid).toBe(false);
    expect(result.details).toContainEqual(expect.stringContaining('plan_path_template'));
  });

  it('rejects plan_path_template exceeding 500 characters', () => {
    const result = validateSettingsPayload({
      worca: { plan_path_template: 'a'.repeat(501) }
    });
    expect(result.valid).toBe(false);
    expect(result.details).toContainEqual(expect.stringContaining('plan_path_template'));
  });

  it('accepts plan_path_template of exactly 500 characters', () => {
    const result = validateSettingsPayload({
      worca: { plan_path_template: 'a'.repeat(500) }
    });
    expect(result.valid).toBe(true);
  });
});

describe('validateSettingsPayload — defaults', () => {
  it('accepts valid defaults with msize and mloops integers 1-10', () => {
    const result = validateSettingsPayload({
      worca: { defaults: { msize: 3, mloops: 5 } }
    });
    expect(result.valid).toBe(true);
  });

  it('accepts defaults at boundary values (1 and 10)', () => {
    expect(validateSettingsPayload({ worca: { defaults: { msize: 1, mloops: 10 } } }).valid).toBe(true);
    expect(validateSettingsPayload({ worca: { defaults: { msize: 10, mloops: 1 } } }).valid).toBe(true);
  });

  it('rejects non-object defaults', () => {
    const result = validateSettingsPayload({ worca: { defaults: 'bad' } });
    expect(result.valid).toBe(false);
    expect(result.details).toContainEqual(expect.stringContaining('defaults must be an object'));
  });

  it('rejects array defaults', () => {
    const result = validateSettingsPayload({ worca: { defaults: [1, 2] } });
    expect(result.valid).toBe(false);
    expect(result.details).toContainEqual(expect.stringContaining('defaults must be an object'));
  });

  it('rejects msize below 1', () => {
    const result = validateSettingsPayload({ worca: { defaults: { msize: 0 } } });
    expect(result.valid).toBe(false);
    expect(result.details).toContainEqual(expect.stringContaining('msize'));
  });

  it('rejects msize above 10', () => {
    const result = validateSettingsPayload({ worca: { defaults: { msize: 11 } } });
    expect(result.valid).toBe(false);
    expect(result.details).toContainEqual(expect.stringContaining('msize'));
  });

  it('rejects non-integer msize', () => {
    const result = validateSettingsPayload({ worca: { defaults: { msize: 2.5 } } });
    expect(result.valid).toBe(false);
    expect(result.details).toContainEqual(expect.stringContaining('msize'));
  });

  it('rejects mloops below 1', () => {
    const result = validateSettingsPayload({ worca: { defaults: { mloops: 0 } } });
    expect(result.valid).toBe(false);
    expect(result.details).toContainEqual(expect.stringContaining('mloops'));
  });

  it('rejects mloops above 10', () => {
    const result = validateSettingsPayload({ worca: { defaults: { mloops: 11 } } });
    expect(result.valid).toBe(false);
    expect(result.details).toContainEqual(expect.stringContaining('mloops'));
  });

  it('rejects non-integer mloops', () => {
    const result = validateSettingsPayload({ worca: { defaults: { mloops: 3.7 } } });
    expect(result.valid).toBe(false);
    expect(result.details).toContainEqual(expect.stringContaining('mloops'));
  });

  it('accepts defaults with only msize', () => {
    const result = validateSettingsPayload({ worca: { defaults: { msize: 5 } } });
    expect(result.valid).toBe(true);
  });

  it('accepts defaults with only mloops', () => {
    const result = validateSettingsPayload({ worca: { defaults: { mloops: 3 } } });
    expect(result.valid).toBe(true);
  });
});

describe('validateSettingsPayload — pricing', () => {
  it('accepts valid pricing with all model fields', () => {
    const result = validateSettingsPayload({
      worca: {
        pricing: {
          models: {
            opus: { input_per_mtok: 15, output_per_mtok: 75, cache_write_per_mtok: 18.75, cache_read_per_mtok: 1.5 },
            sonnet: { input_per_mtok: 3, output_per_mtok: 15, cache_write_per_mtok: 3.75, cache_read_per_mtok: 0.3 },
          },
          currency: 'USD',
          last_updated: '2025-05-01',
        }
      }
    });
    expect(result.valid).toBe(true);
  });

  it('rejects non-object pricing', () => {
    const result = validateSettingsPayload({ worca: { pricing: 'bad' } });
    expect(result.valid).toBe(false);
    expect(result.details).toContainEqual(expect.stringContaining('pricing must be an object'));
  });

  it('rejects array pricing', () => {
    const result = validateSettingsPayload({ worca: { pricing: [1] } });
    expect(result.valid).toBe(false);
    expect(result.details).toContainEqual(expect.stringContaining('pricing must be an object'));
  });

  it('rejects non-object pricing.models', () => {
    const result = validateSettingsPayload({ worca: { pricing: { models: 'bad' } } });
    expect(result.valid).toBe(false);
    expect(result.details).toContainEqual(expect.stringContaining('pricing.models must be an object'));
  });

  it('rejects unknown model names', () => {
    const result = validateSettingsPayload({
      worca: { pricing: { models: { gpt4: { input_per_mtok: 1 } } } }
    });
    expect(result.valid).toBe(false);
    expect(result.details).toContainEqual(expect.stringContaining('Unknown pricing model'));
  });

  it('rejects negative cost values', () => {
    const result = validateSettingsPayload({
      worca: { pricing: { models: { opus: { input_per_mtok: -1 } } } }
    });
    expect(result.valid).toBe(false);
    expect(result.details).toContainEqual(expect.stringContaining('non-negative'));
  });

  it('rejects non-number cost values', () => {
    const result = validateSettingsPayload({
      worca: { pricing: { models: { opus: { input_per_mtok: 'free' } } } }
    });
    expect(result.valid).toBe(false);
    expect(result.details).toContainEqual(expect.stringContaining('non-negative'));
  });

  it('rejects Infinity cost values', () => {
    const result = validateSettingsPayload({
      worca: { pricing: { models: { opus: { output_per_mtok: Infinity } } } }
    });
    expect(result.valid).toBe(false);
    expect(result.details).toContainEqual(expect.stringContaining('non-negative'));
  });

  it('rejects NaN cost values', () => {
    const result = validateSettingsPayload({
      worca: { pricing: { models: { opus: { output_per_mtok: NaN } } } }
    });
    expect(result.valid).toBe(false);
    expect(result.details).toContainEqual(expect.stringContaining('non-negative'));
  });

  it('accepts zero cost values', () => {
    const result = validateSettingsPayload({
      worca: { pricing: { models: { opus: { input_per_mtok: 0 } } } }
    });
    expect(result.valid).toBe(true);
  });

  it('rejects unknown cost field keys', () => {
    const result = validateSettingsPayload({
      worca: { pricing: { models: { opus: { unknown_field: 5 } } } }
    });
    expect(result.valid).toBe(false);
    expect(result.details).toContainEqual(expect.stringContaining('Unknown pricing field'));
  });

  it('rejects non-string currency', () => {
    const result = validateSettingsPayload({
      worca: { pricing: { currency: 123 } }
    });
    expect(result.valid).toBe(false);
    expect(result.details).toContainEqual(expect.stringContaining('currency'));
  });

  it('rejects non-string last_updated', () => {
    const result = validateSettingsPayload({
      worca: { pricing: { last_updated: 42 } }
    });
    expect(result.valid).toBe(false);
    expect(result.details).toContainEqual(expect.stringContaining('last_updated'));
  });

  it('accepts pricing with only models (no currency/last_updated)', () => {
    const result = validateSettingsPayload({
      worca: { pricing: { models: { opus: { input_per_mtok: 15 } } } }
    });
    expect(result.valid).toBe(true);
  });

  it('accepts pricing with only currency and last_updated (no models)', () => {
    const result = validateSettingsPayload({
      worca: { pricing: { currency: 'EUR', last_updated: '2026-01-01' } }
    });
    expect(result.valid).toBe(true);
  });
});
