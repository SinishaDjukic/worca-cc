// test/ask-chat-context.test.mjs — worca Chat R4 on the server: the Chat page's context ({view:'chat'} plus the run its
// panel shows) passes validateClientContext as it is, earns no page chip, and names its view in the [worca context]
// block. It pins acceptance that already holds at c45cc012 (VIEW_RE is a slug), so no server change is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateClientContext, buildContextHeader } from '../src/core/ask/prompt.mjs';
import { contextEntries, PAGE_LABELS } from '../src/core/ask/contexts.mjs';

test('the Chat context validates alone and with the panel run', () => {
  assert.deepEqual(validateClientContext({ view: 'chat', pinned: false, timeZone: 'Europe/Sofia' }),
    { ok: true, context: { view: 'chat', pinned: false, timeZone: 'Europe/Sofia' } });
  const withRun = { view: 'chat', runId: '0f0f0f0f-0000-4000-8000-000000000001', pipelineId: 'aaaa1111', projectDir: '/repos/proj', runPage: 'logs', pinned: false };
  assert.deepEqual(validateClientContext(withRun), { ok: true, context: withRun });
});

test('a Chat page earns no page chip', () => {
  assert.equal(Object.hasOwn(PAGE_LABELS, 'chat'), false);
  assert.deepEqual(contextEntries({ view: 'chat' }, { view: 'chat' }), []);
});

test('the context block names the view', () => {
  assert.match(buildContextHeader({ view: 'chat' }), /^view: chat$/m);
});
