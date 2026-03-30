import { describe, expect, it } from 'vitest';

describe('preferencesTab signature: (preferences, { onThemeToggle })', () => {
  it('preferencesTab accepts 2 parameters', async () => {
    // preferencesTab is exported as _preferencesTab for testing
    const { _preferencesTab } = await import('./settings.js');

    // Must be exported
    expect(_preferencesTab).toBeDefined();
    expect(typeof _preferencesTab).toBe('function');

    // New signature has 2 parameters: (preferences, { onThemeToggle })
    expect(_preferencesTab.length).toBe(2);
  });
});
