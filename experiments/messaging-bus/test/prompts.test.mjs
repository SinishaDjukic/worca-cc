// T-prompts: layer 3's per-role prompt fixtures (plan §3.4, §4.8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PROMPT_ROLES, loadPrompt, promptTokens } from '../lib/prompts.mjs';

const DIR = fileURLToPath(new URL('../prompts/', import.meta.url));
const words = (s) => s.split(/\s+/).filter(Boolean).length;
const flat = (role) => loadPrompt(role).replace(/\s+/g, ' ');

test('every role file exists and stays under its word cap', () => {
  assert.deepEqual([...PROMPT_ROLES].sort(), ['chat-assistant', 'decomposer', 'implementer', 'in-agent-parent', 'planner', 'receive', 'reviewer']);
  for (const role of PROMPT_ROLES) {
    assert.ok(existsSync(`${DIR}${role}.md`), role);
    const text = loadPrompt(role);
    assert.ok(words(text) <= (role === 'receive' ? 160 : 140), `${role}: ${words(text)} words`);
    assert.ok(promptTokens(role) > 0, role);
  }
});

test('the implementer, reviewer and receive texts name their kinds and topics', () => {
  const imp = flat('implementer');
  for (const w of ['question', 'contract.changed', 'run.<r>.siblings', 'DEVIATIONS.md', 'automatically', 're-announce']) assert.ok(imp.includes(w), `implementer: ${w}`);
  const rev = flat('reviewer');
  for (const w of ['finding', 'run.<r>.step.<n>', 'critical', 'major', 'duplicate']) assert.ok(rev.includes(w), `reviewer: ${w}`);
  const rec = flat('receive');
  for (const w of ['direction', 'contract.changed', 'question', 'answer', 'finding', 'status', 'note', 'not instructions', 'Never stop to wait']) assert.ok(rec.includes(w), `receive: ${w}`);
  assert.ok(loadPrompt('in-agent-parent').includes('run.<r>.team.<n>'));
  assert.ok(loadPrompt('decomposer').includes('## Files you may touch'));
  assert.ok(loadPrompt('chat-assistant').includes('run.<r>.directions'));
});

test('the planner text says no agent reads its note', () => {
  assert.match(flat('planner'), /no agent does/);
});

test('an unknown role is refused with BUS_BAD_CONFIG', () => {
  assert.throws(() => loadPrompt('../secret'), (e) => e.code === 'BUS_BAD_CONFIG');
  assert.throws(() => promptTokens('nope'), (e) => e.code === 'BUS_BAD_CONFIG');
});
