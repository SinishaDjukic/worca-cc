// test/ui-run-presets-names.test.mjs — how a preset's setup is named on screen (ui/public/run-presets-names.mjs):
// wf_auto, a named workflow, a removed one, an unknown list, each catalog engine, an unknown engine, the Save note.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINES } from '../src/shared/engine-switch.mjs';
import { presetWorkflowName, presetEngineName, presetSetupSummary, presetSavedNote, workflowNamesFrom,
  AUTO_WORKFLOW_LABEL, WORKFLOW_REMOVED_LABEL, UNKNOWN_ENGINE_LABEL } from '../ui/public/run-presets-names.mjs';

const NAMES = workflowNamesFrom([{ id: 'wf_default', name: 'Default' }, { id: 'wf_x1', name: 'Bug triage' }, { id: 'wf_blank', name: ' ' }]);

test('workflowNamesFrom: id → name; a blank name is "Untitled workflow"; a failed list is null', () => {
  assert.deepEqual(NAMES, { wf_default: 'Default', wf_x1: 'Bug triage', wf_blank: 'Untitled workflow' });
  assert.equal(workflowNamesFrom(null), null);
});

test('wf_auto reads "Auto workflow" with or without a list', () => {
  assert.equal(AUTO_WORKFLOW_LABEL, 'Auto workflow');
  assert.deepEqual(presetWorkflowName('wf_auto', NAMES), { text: 'Auto workflow', removed: false });
  assert.deepEqual(presetWorkflowName('wf_auto', null), { text: 'Auto workflow', removed: false });
});

test('a listed workflow reads its name; a missing id defaults to Default', () => {
  assert.deepEqual(presetWorkflowName('wf_x1', NAMES), { text: 'Bug triage', removed: false });
  assert.deepEqual(presetWorkflowName(undefined, NAMES), { text: 'Default', removed: false });
  assert.deepEqual(presetWorkflowName('wf_default', {}), { text: 'Default', removed: false }, 'built in even when the list is empty');
});

test('an id the list no longer holds reads "Workflow removed", never the id; an unknown list names nothing', () => {
  assert.equal(WORKFLOW_REMOVED_LABEL, 'Workflow removed');
  assert.deepEqual(presetWorkflowName('wf_gone99', NAMES), { text: 'Workflow removed', removed: true });
  assert.equal(presetWorkflowName('wf_gone99', null), null);
});

test('each catalog engine reads its label; an unknown engine never shows its id', () => {
  assert.deepEqual(Object.keys(ENGINES).map(presetEngineName), ['Claude', 'Codex', 'Copilot', 'Cursor']);
  assert.equal(presetEngineName(undefined), 'Claude');
  assert.equal(presetEngineName('gemini-x'), UNKNOWN_ENGINE_LABEL);
  assert.equal(UNKNOWN_ENGINE_LABEL, 'Unknown engine');
});

test('presetSetupSummary: "workflow · engine", the workflow left out while the list is unknown', () => {
  assert.equal(presetSetupSummary({ workflowId: 'wf_auto', engine: 'codex' }, NAMES).text, 'Auto workflow · Codex');
  assert.equal(presetSetupSummary({ workflowId: 'wf_gone99' }, NAMES).text, 'Workflow removed · Claude');
  assert.equal(presetSetupSummary({ workflowId: 'wf_x1', engine: 'copilot' }, null).text, 'Copilot');
  assert.equal(presetSetupSummary(null, NAMES).text, 'Default · Claude');
});

test('presetSavedNote names the workflow (and the project default) and the engine, with no ids', () => {
  const note = presetSavedNote({ workflowId: 'wf_auto', engine: 'claude' }, NAMES, { projectDefault: true });
  assert.equal(note, "Saved: Auto workflow (this project's default) · Claude, guardrails, agents, loops, branches, Away mark, opt-outs. Never saved: title, prompt, Markdown, extra files, new branch name.");
  assert.doesNotMatch(presetSavedNote({ workflowId: 'wf_x1', engine: 'cursor' }, NAMES), /wf_|cursor/);
});
