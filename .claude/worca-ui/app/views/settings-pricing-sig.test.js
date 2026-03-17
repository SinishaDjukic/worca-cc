import { describe, it, expect } from 'vitest';

describe('preferencesTab signature: (preferences, worca, { onThemeToggle, rerender })', () => {
  it('preferencesTab accepts 3 parameters', async () => {
    // preferencesTab is exported as _preferencesTab for testing
    const { _preferencesTab } = await import('./settings.js');

    // Must be exported
    expect(_preferencesTab).toBeDefined();
    expect(typeof _preferencesTab).toBe('function');

    // New signature has 3 parameters: (preferences, worca, { onThemeToggle, rerender })
    expect(_preferencesTab.length).toBe(3);
  });
});
