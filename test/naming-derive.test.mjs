import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveBranchName, uniqueBranch, legacyBranchHint, mockSuggestion } from '../src/core/naming.mjs';
import { suggestBranchName } from '../src/core/worktree.mjs';

test('flag off: deriveBranchName is exactly suggestBranchName', () => {
  const off = { flagEnabled: () => false };
  for (const a of [{ prompt: 'Fix the login bug', pipelineId: 'a1b2c3d4e5' }, { title: 'A/B Testing', prompt: '' }, {}]) {
    assert.equal(deriveBranchName(a, off), suggestBranchName(a));
  }
});
test('flag on: pattern, first type, ticket, no model', () => {
  const on = { flagEnabled: () => true, settings: () => ({ pattern: '{type}/{ticket}-{slug}', types: ['chore', 'fix'], addRunId: false }) };
  assert.equal(deriveBranchName({ prompt: 'Rate limiter', ticket: 'PROJ-123', pipelineId: 'a1b2c3d4' }, on), 'chore/proj-123-rate-limiter');
});
test('flag on: addRunId appends the short id', () => {
  const on = { flagEnabled: () => true, settings: () => ({ pattern: '{type}/{slug}', types: ['feat'], addRunId: true }) };
  assert.equal(deriveBranchName({ prompt: 'Rate limiter', pipelineId: 'a1b2c3d4e5' }, on), 'feat/rate-limiter-a1b2c3d4');
});
test('uniqueBranch appends the short id only on a collision', async () => {
  assert.equal(await uniqueBranch('/x', 'fix/a', 'a1b2c3d4e5', async () => ['main']), 'fix/a');
  assert.equal(await uniqueBranch('/x', 'fix/a', 'a1b2c3d4e5', async () => ['fix/a']), 'fix/a-a1b2c3d4');
});
test('legacyBranchHint is today\'s name without the id; mockSuggestion spawns nothing', () => {
  assert.equal(legacyBranchHint('Safari SSO redirect', ''), suggestBranchName({ prompt: 'Safari SSO redirect' }).replace(/-run$/, ''));
  const m = mockSuggestion('Safari SSO redirect loop', { types: ['feat', 'fix'], pattern: '{type}/{slug}', addRunId: false });
  assert.equal(m.source, 'model'); assert.match(m.branch, /^feat\//);
});
