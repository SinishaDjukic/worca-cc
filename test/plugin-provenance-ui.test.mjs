// test/plugin-provenance-ui.test.mjs — provenance helpers (spec §11): workflow-picker
// labels for plugin-origin workflows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workflowPickerLabel } from '../ui/public/results-view.mjs';

test('workflowPickerLabel suffixes plugin origin and flags disabled plugins', () => {
  assert.equal(workflowPickerLabel({ name: 'My Flow', origin: null }, ['gh']), 'My Flow');
  assert.equal(workflowPickerLabel({ name: 'Triage', origin: 'plugin:gh' }, ['gh']), 'Triage [plugin: gh]');
  assert.equal(workflowPickerLabel({ name: 'Triage', origin: 'plugin:gh' }, []), 'Triage [plugin: gh, disabled]');
});
