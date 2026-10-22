import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPattern, renderBranch, normalizeType, patternProblem, sanitizeRef, DEFAULT_TYPES } from '../src/shared/naming/pattern.mjs';
import { sanitizeBranchName } from '../src/core/worktree.mjs';

test('default pattern renders type/slug', () => {
  assert.equal(renderPattern('{type}/{slug}', { type: 'fix', slug: 'safari-sso-redirect-loop' }), 'fix/safari-sso-redirect-loop');
});
test('an empty ticket leaves no dangling separator', () => {
  assert.equal(renderPattern('{type}/{ticket}-{slug}', { type: 'feat', slug: 'x-y' }), 'feat/x-y');
  assert.equal(renderPattern('{type}/{ticket}-{slug}', { type: 'feat', ticket: 'PROJ-123', slug: 'x-y' }), 'feat/proj-123-x-y');
});
test('a long slug is cut so the id survives within 80 chars', () => {
  const out = renderPattern('{type}/{slug}-{id}', { type: 'feat', slug: 'a'.repeat(200), id: 'a1b2c3d4' });
  assert.ok(out.length <= 80 && out.endsWith('-a1b2c3d4') && out.startsWith('feat/'));
});
test('type validation: unknown or hostile type becomes the first type', () => {
  assert.equal(normalizeType('FIX', DEFAULT_TYPES), 'fix');
  assert.equal(normalizeType('hotfix; rm -rf', DEFAULT_TYPES), 'feat');
  assert.equal(normalizeType('', ['chore', 'fix']), 'chore');
});
test('the run id: {id} always renders, the switch appends only without {id}', () => {
  assert.equal(renderBranch({ pattern: '{type}/{slug}', addRunId: true }, { type: 'fix', slug: 'a', id: 'a1b2c3d4' }), 'fix/a-a1b2c3d4');
  assert.equal(renderBranch({ pattern: '{type}/{slug}', addRunId: false }, { type: 'fix', slug: 'a', id: 'a1b2c3d4' }), 'fix/a');
  assert.equal(renderBranch({ pattern: '{id}/{slug}', addRunId: true }, { slug: 'a', id: 'a1b2c3d4' }), 'a1b2c3d4/a');
});
test('patternProblem rejects unknown placeholders and a missing {slug}', () => {
  assert.match(patternProblem('{type}/{nope}-{slug}'), /unknown placeholder/);
  assert.match(patternProblem('{type}/x'), /\{slug\}/);
  assert.equal(patternProblem('{type}/{slug}'), null);
});
test('sanitizeRef matches the core gate', () => {
  for (const s of ['Fix/Café  Bug!', '--a//b__c..', 'x'.repeat(120)]) assert.equal(sanitizeRef(s), sanitizeBranchName(s));
});
