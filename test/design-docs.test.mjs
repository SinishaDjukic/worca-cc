// test/design-docs.test.mjs — docs/design.md: the design flag points at it, it says what Design does today, and it
// promises nothing worca lacks (no Replay, no publishing, no team invites, no paid plan).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { flagByKey } from '../src/shared/flags/registry.mjs';

const text = readFileSync(new URL('../docs/design.md', import.meta.url), 'utf8');
test('the flag points at the page', () => assert.equal(flagByKey('design').docs, 'docs/design.md'));
test('the page says what is true, and nothing worca lacks', () => {
  for (const yes of ['WORCA_FLAGS=-design', 'Build fast', 'Decks only', 'WORCA_CHROME', 'cost unknown', 'Statistics', '.git', 'MP4']) assert.ok(text.includes(yes), yes);
  for (const no of [/worca-cc/, /Replay/, /publish to the web/i, /team invite/i, /paid plan/i]) assert.doesNotMatch(text, no);
  assert.match(readFileSync(new URL('../docs/feature-flags.md', import.meta.url), 'utf8'), /\(\[docs\]\(design\.md\)\)/);   // as docs-sessions.test.mjs:73
});
// Design P8: whole sentences, so a word already on the page (Build fast, `up to 12`) cannot stand in for them.
test('the page describes the gate and hosted truthfully', () => {
  const flat = text.replace(/\s+/g, ' ');
  for (const sentence of [
    "Every other engine needs **Allow unguarded** when a design is created, once, because it cannot be held to worca's rules.",
    '**Goose** cannot be used: it cannot be held to one folder or kept from running commands, so it has no **Allow unguarded**.',
    '**Build fast** runs at most 6 agents at once there, and its label reads `up to 6`.',
    'Across all builds, at most 24 agents run at once on one worca, and `WORCA_DESIGN_MAX_AGENTS` (a whole number from 1 up) sets that number.',
    '`WORCA_DESIGN_PREVIEW_INLINE=0` turns this off, and `1` turns it on anywhere.',
  ]) assert.ok(flat.includes(sentence), sentence);
  assert.doesNotMatch(text, /In Labs/);
  assert.doesNotMatch(text, /Builds run on Claude for now/);
});
