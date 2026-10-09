// test/skills-registry-texts.test.mjs — skip and layer texts (skills registry design §4.1, §4.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SKILL_PROBLEM_REASONS, SKILL_LAYER_REASONS, SKILL_HOOKS_TEXT, skillSkipReasonText, skillSkipMessage, skillLayerText, skillHooksIgnoredText,
} from '../src/core/skills-registry/texts.mjs';

test('the reason lists of the contract', () => {
  assert.deepEqual(SKILL_PROBLEM_REASONS, ['missing-skill', 'plugin-disabled', 'invalid-skill', 'name-taken', 'cap']);
  assert.deepEqual(SKILL_LAYER_REASONS, ['sideload-disabled', 'cli-no-plugin-dir', 'engine-no-skill-mount']);
  assert.equal(SKILL_HOOKS_TEXT, "declares hooks — they run shell commands outside Worca's guardrails when the skill is used");
});

test('every §4.2 skip reason has its own words; unknown reasons read as themselves', () => {
  const reasons = ['missing-skill', 'plugin-disabled', 'invalid-skill', 'needs-consent', 'off', 'opted-out', 'chat-off', 'name-taken', 'cap'];
  const texts = reasons.map((reason) => skillSkipReasonText({ reason }));
  assert.equal(new Set(texts).size, reasons.length);
  assert.deepEqual(texts.slice(0, 2), ['the skill is no longer installed', 'plugin disabled']);
  assert.equal(skillSkipReasonText({ reason: 'name-taken' }), 'another skill of this set has the same name');
  assert.equal(skillSkipReasonText({ reason: 'constructor' }), 'constructor');
  assert.equal(skillSkipReasonText({ reason: 'new-thing' }), 'new-thing');
});

test('skip lines name the skill (name, else the id\'s name, else the id) and the set', () => {
  const skip = { setId: 'billing', setName: 'Billing', skillId: 'skill:plugin:acme/deploy-checklist', name: 'deploy-checklist', reason: 'plugin-disabled' };
  assert.equal(skillSkipMessage(skip), 'deploy-checklist in Billing skipped: plugin disabled');
  assert.equal(skillSkipMessage({ ...skip, name: undefined }), 'deploy-checklist in Billing skipped: plugin disabled');
  assert.equal(skillSkipMessage({ ...skip, name: undefined, skillId: 'skill:plugin:acme/Bad', reason: 'missing-skill' }),
    'skill:plugin:acme/Bad in Billing skipped: the skill is no longer installed');
  assert.equal(skillSkipMessage({ setId: 'general', skillId: 'skill:library:notes', reason: 'cap' }), 'notes in general skipped: over the skill limit for one spawn');
});

test('layer reasons: the words after "skills from sets not loaded: " (each surface writes that prefix once)', () => {
  assert.equal(skillLayerText('cli-no-plugin-dir'), 'this Claude Code has no --plugin-dir option');
  assert.match(skillLayerText('sideload-disabled'), /^this machine's managed Claude Code settings .*disableSideloadFlags/);
  assert.equal(skillLayerText('engine-no-skill-mount', 'codex'), "Codex reads skills from the run's .agents/skills mount, and this run has none");
  assert.doesNotMatch(skillLayerText('engine-no-skill-mount', 'cursor'), /this machine|Claude Code/, 'another engine\'s reason names neither');
  assert.equal(skillLayerText('engine-no-skill-mount'), "this engine reads skills from the run's .agents/skills mount, and this run has none");
  assert.equal(skillLayerText('other'), 'other');
  for (const r of SKILL_LAYER_REASONS) assert.doesNotMatch(skillLayerText(r), /not loaded/);
});

test('hooks on another engine: one line naming the mounted skills and the engine', () => {
  assert.equal(skillHooksIgnoredText('codex', ['deploy']), 'set skill deploy declares hooks, which Codex does not run — the skill loads without them');
  assert.equal(skillHooksIgnoredText('cursor', ['a', 'billing-b']), 'set skills a, billing-b declare hooks, which Cursor does not run — the skills load without them');
});
