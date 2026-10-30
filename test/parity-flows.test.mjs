// test/parity-flows.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGES, FLOWS, chromePath, DONE_WORDS, FlowError, flowError } from '../tools/parity/flows.mjs';

test('the 9 main pages with their hashes and views', () => {
  const seed = { projectKey: 'k1', pipelineId: 'p1', runId: 'r1', threadId: 't1', heldRunId: 'r2' };
  assert.deepEqual(PAGES.map((p) => [p.name, p.hash(seed), p.view]), [
    ['chat-home', '#chat/new', 'chat'], ['chat-thread', '#chat/t1', 'chat'], ['new-run', '#new', 'new'],
    ['runs', '#runs', 'runs'], ['live-run', '#running/r2', 'runs'], ['history', '#history/k1/p1', 'runs'],
    ['settings', '#settings', 'settings'], ['labs', '#settings/experimental', 'settings'], ['stats', '#stats', 'stats']]);
});

test('the 5 flows', () => {
  assert.deepEqual(FLOWS.map((f) => f.name), ['open-pages', 'chat-send', 'run-finish', 'setting-persists', 'labs-flag']);
});

test('DONE_WORDS are the History words for a finished run', () => {
  assert.ok(DONE_WORDS.includes('Ready to ship'));
  assert.equal(DONE_WORDS.includes('Needs you'), false);
});

test('flowError keeps our own reasons and drops foreign message text (no page data in a snapshot)', () => {
  const canary = 'parity-canary-7f3e';
  const pw = Object.assign(new Error(`locator.waitFor: Timeout 30000ms exceeded. waiting for text "${canary}"`), { name: 'TimeoutError' });
  const page = { parityErrors: ['GET /api/x -> 500'], parityPageErrors: 2 };
  const r = flowError(pw, page);
  assert.deepEqual(r, { error: 'TimeoutError in locator.waitFor', apiErrors: ['GET /api/x -> 500'], pageErrors: 2 });
  assert.equal(JSON.stringify(flowError(new Error(canary))).includes(canary), false);
  assert.equal(flowError(new FlowError('live run handed off before capture')).error, 'live run handed off before capture');
});

test('chromePath prefers CHROME_BIN and fails with a hint', () => {
  assert.equal(chromePath({ CHROME_BIN: '/x/chrome' }, () => true), '/x/chrome');
  assert.throws(() => chromePath({}, () => false), /set CHROME_BIN/);
});
