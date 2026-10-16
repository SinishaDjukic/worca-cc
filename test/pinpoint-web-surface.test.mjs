// Pinpoint's `web` surface: the browser extension's selection on a web page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePinpointInput, buildExplainPrompt } from '../src/core/pinpoint.mjs';
import { PINPOINT_ACTIONS } from '../ui/public/pinpoint-model.mjs';

test('web is a known surface and its framing names a web page', () => {
  const v = validatePinpointInput({ action: 'explain', quote: 'rate limit', surface: 'web', source: 'docs.example.com' });
  assert.equal(v.value.surface, 'web');
  assert.match(buildExplainPrompt(v.value), /a web page/);
  assert.match(buildExplainPrompt(v.value), /docs\.example\.com/);
});

test('the web toolbar is Copy · Explain · Alternatives · Send to chat', () => {
  assert.deepEqual(PINPOINT_ACTIONS.web.filter((a) => a[0] !== '|').map((a) => a[0]), ['copy', 'explain', 'alts', 'send']);
});
