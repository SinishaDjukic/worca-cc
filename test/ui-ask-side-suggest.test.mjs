// test/ui-ask-side-suggest.test.mjs — Ask worca beside the page (Task 5): the side column's empty state per page (L10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sideSuggestions } from '../ui/public/ask-side-suggest.mjs';

const ASK_WORCA = { heading: 'Ask worca', items: ['What needs me?', "What's ready to ship?"] };

test('a run, by its status', () => {
  assert.deepEqual(sideSuggestions({ view: 'history-detail' }, { runStatus: 'stopped' }),
    { heading: 'Ask about this run', items: ['Why did it stop?', 'What did it change?', 'Start a run after this one'] });
  assert.deepEqual(sideSuggestions({ view: 'running' }, { runStatus: 'failed' }).items[0], 'Why did it stop?');
  assert.deepEqual(sideSuggestions({ view: 'running' }, { runStatus: 'paused' }).items, ['What does it need from me?', 'What did it change so far?']);
  assert.deepEqual(sideSuggestions({ view: 'running' }, { runStatus: 'running' }).items, ['What is it doing now?', 'What did it change so far?']);
  assert.deepEqual(sideSuggestions({ view: 'running' }, { runStatus: 'done' }).items, ['What did it change?', 'Is it ready to ship?', 'Start a run after this one']);
});

test("a run by the statuses app.js gives it: error, interrupted and canceled stopped; pausing waits; starting runs", () => {
  for (const s of ['error', 'interrupted', 'canceled']) assert.equal(sideSuggestions({ view: 'running' }, { runStatus: s }).items[0], 'Why did it stop?', s);
  assert.equal(sideSuggestions({ view: 'running' }, { runStatus: 'pausing' }).items[0], 'What does it need from me?');
  assert.equal(sideSuggestions({ view: 'history-detail' }, { runStatus: 'starting' }).items[0], 'What is it doing now?');
  const a = sideSuggestions({ view: 'marketplace' });
  a.items.push('x');
  assert.equal(sideSuggestions({ view: 'marketplace' }).items.length, 2, 'the Ask worca list is a fresh copy too');
});

test('a run on its Diff with a file open leads with the file', () => {
  assert.deepEqual(sideSuggestions({ view: 'running' }, { runStatus: 'done', diffPath: 'a.mjs' }).items,
    ['Explain the changes in this file', 'What did it change?', 'Is it ready to ship?', 'Start a run after this one']);
});

test('list and detail pages', () => {
  assert.deepEqual(sideSuggestions({ view: 'runs' }), { heading: 'Ask about your runs', items: ["What's ready to ship?", 'What needs me?'] });
  assert.deepEqual(sideSuggestions({ view: 'schedules' }).items, ['Is anything scheduled right now?', 'Schedule a run every night']);
  assert.deepEqual(sideSuggestions({ view: 'projects' }).items, ['Which projects have Team metrics off?', 'Which projects are behind origin?']);
  assert.deepEqual(sideSuggestions({ view: 'project-detail', pageProjectKey: 'demo-00000001' }).heading, 'Ask about this project');
  assert.deepEqual(sideSuggestions({ view: 'workspaces', pageWorkspaceId: 'wks-havn-649ebfe7' }),
    { heading: 'Ask about this workspace', items: ['What ran here this week?', 'Which members have Team metrics off?'] });
  assert.deepEqual(sideSuggestions({ view: 'stats' }).heading, 'Ask about spending');
  assert.deepEqual(sideSuggestions({ view: 'team-metrics' }).items, ['Why did spend jump?', 'Who ran the most this month?']);
  assert.deepEqual(sideSuggestions({ view: 'team-policy' }).items, ['What does this policy allow?']);
});

test('everything else, and no context: Ask worca', () => {
  for (const c of [{ view: 'marketplace' }, { view: 'workspaces' }, {}, null]) assert.deepEqual(sideSuggestions(c), ASK_WORCA);
  const a = sideSuggestions({ view: 'runs' });
  a.items.push('x');
  assert.deepEqual(sideSuggestions({ view: 'runs' }).items.length, 2, 'a fresh list each call');
});
