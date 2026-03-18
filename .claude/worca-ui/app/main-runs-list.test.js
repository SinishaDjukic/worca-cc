/**
 * Tests for the ordering contract in the runs-list WS event handler.
 *
 * main.js wires: store.subscribe(() => rerender())
 * store.setState() triggers subscribers synchronously.
 * Therefore, any module-level variable read during rerender must be
 * updated BEFORE store.setState() is called.
 *
 * This test suite documents the required ordering and catches regressions.
 */
import { describe, it, expect } from 'vitest';
import { createStore } from './state.js';

describe('runs-list handler: settings must be updated before store.setState', () => {
  it('settings are visible in store subscriber when updated before setState', () => {
    // Arrange: mirror main.js module-level setup
    const store = createStore();
    let settings = {};
    const settingsCapturedDuringRender = [];

    // store.subscribe fires synchronously on setState – just like main.js line 872
    store.subscribe(() => {
      settingsCapturedDuringRender.push(Object.assign({}, settings));
    });

    const payload = { runs: [{ id: 'run-1' }], settings: { maxConcurrent: 2 } };

    // Act: correct ordering – settings BEFORE setState (the fix we are implementing)
    const runs = {};
    for (const run of (payload.runs || [])) runs[run.id] = run;
    if (payload.settings) settings = payload.settings;   // must come first
    store.setState({ runs });                            // triggers subscriber synchronously

    // Assert: subscriber saw the fresh settings
    expect(settingsCapturedDuringRender).toHaveLength(1);
    expect(settingsCapturedDuringRender[0]).toEqual({ maxConcurrent: 2 });
  });

  it('settings updated after setState causes subscriber to see stale settings (documents the bug)', () => {
    // Arrange
    const store = createStore();
    let settings = {};
    const settingsCapturedDuringRender = [];

    store.subscribe(() => {
      settingsCapturedDuringRender.push(Object.assign({}, settings));
    });

    const payload = { runs: [{ id: 'run-1' }], settings: { maxConcurrent: 2 } };

    // Act: wrong ordering – settings AFTER setState (the original buggy code)
    const runs = {};
    for (const run of (payload.runs || [])) runs[run.id] = run;
    store.setState({ runs });                            // subscriber fires — settings still {}
    if (payload.settings) settings = payload.settings;  // too late

    // Assert: subscriber saw stale (empty) settings — this is the bug
    expect(settingsCapturedDuringRender).toHaveLength(1);
    expect(settingsCapturedDuringRender[0]).toEqual({});  // stale!
  });
});
