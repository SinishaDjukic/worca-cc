import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContextHeader, EXTENSION_CLIENT_LINE } from '../src/core/ask/prompt.mjs';

test('an extension turn carries the untrusted-page line naming all three page attachments; others do not', () => {
  const h = buildContextHeader({ client: 'browser-extension' });
  assert.ok(h.includes(EXTENSION_CLIENT_LINE));
  for (const f of ['page-context.md', 'page-text.md', 'page-quote.md']) assert.ok(EXTENSION_CLIENT_LINE.includes(f), f);
  assert.ok(!buildContextHeader({}).includes('browser extension'));
  assert.ok(!buildContextHeader({ client: 'something-else' }).includes('browser extension'));
});

test('the line survives clipping of a crowded header', () => {
  // Dropping runs/cards alone would fit; image attachments are never shed, so they force the final hard truncate,
  // and the line must already sit ahead of the clipped tail.
  const atts = Array.from({ length: 8 }, (_, i) => ({ id: `a${i}`, name: 'shot-'.repeat(10) + i + '.png', kind: 'image', mime: 'image/png', bytes: 2048 }));
  const h = buildContextHeader({ client: 'browser-extension', attachments: atts }, { maxChars: 600 });
  assert.ok(h.length <= 600, `clipped: ${h.length}`);
  assert.ok(h.includes(EXTENSION_CLIENT_LINE));
  assert.ok(h.endsWith('[/worca context]'));
});
