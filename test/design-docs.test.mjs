// test/design-docs.test.mjs — docs/design.md: the design flag points at it, it says what Design does today, and it
// promises nothing worca lacks (no Replay, no publishing, no team invites, no paid plan).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { flagByKey } from '../src/shared/flags/registry.mjs';

const text = readFileSync(new URL('../docs/design.md', import.meta.url), 'utf8');
test('the flag points at the page', () => assert.equal(flagByKey('design').docs, 'docs/design.md'));
test('the page says what is true, and nothing worca lacks', () => {
  for (const yes of ['WORCA_FLAGS=design', 'Build fast', 'Decks only', 'WORCA_CHROME', 'cost unknown', 'Statistics', '.git', 'MP4']) assert.ok(text.includes(yes), yes);
  for (const no of [/worca-cc/, /Replay/, /publish to the web/i, /team invite/i, /paid plan/i]) assert.doesNotMatch(text, no);
  assert.match(readFileSync(new URL('../docs/feature-flags.md', import.meta.url), 'utf8'), /\(\[docs\]\(design\.md\)\)/);   // as docs-sessions.test.mjs:73
});
