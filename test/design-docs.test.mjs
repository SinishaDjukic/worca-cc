// test/design-docs.test.mjs — docs/design.md: the design flag points at it, it says what Design does today, and it
// promises nothing worca lacks (no Replay, no publishing, no team invites, no paid plan).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { flagByKey } from '../src/shared/flags/registry.mjs';

const text = readFileSync(new URL('../docs/design.md', import.meta.url), 'utf8');
test('the flag points at the page', () => assert.equal(flagByKey('design').docs, 'docs/design.md'));
test('the page says what is true, and nothing worca lacks', () => {
  for (const yes of ['WORCA_FLAGS=-design', 'Build fast', 'Decks and documents only', 'WORCA_CHROME', 'cost unknown', 'Statistics', '.git', 'MP4', 'Look source:', 'A4']) assert.ok(text.includes(yes), yes);
  assert.equal(text.includes('reads `Decks only`'), false, 'the old note is gone');
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
// Design pictures: made pictures in What the agents can use, Cost, Where files live and Hosted, each whole.
test('the page describes made pictures', () => {
  const flat = text.replace(/\s+/g, ' ');
  for (const sentence of [
    "**Made pictures.** When an image service is set up (see [Image generation](image-generation.md)) and the design's **Pictures** switch is on, the lead can have a picture made that no file gives: a scene, a mood, a texture, an illustration.",
    "- **Pictures:** each made picture books what the service's answer says it cost, else the **Price per picture** you set, to its round. It counts toward the same limits, and a round that reaches one pauses. A picture that is not made costs nothing.",
    '| `made/` | A copy of each made picture by its ask, so the chat shows what each ask made; never exported, and agents cannot open it |',
    "- **Made pictures** use the server's one image service key; each picture counts in its round's cost.",
  ]) assert.ok(flat.includes(sentence), sentence);
});
// Design sound: docs/sound.md (at most 60 lines) names the Providers row, the files and the two list prices; the Design
// page and the docs index link it. It names no assistant model or session (it may name `eleven_multilingual_v2`, so
// never a bare "model"), and neither page says "with no sound". docs/design.md already names models: pin its click sentence.
test('docs/sound.md says where the key, the money and the files go, and the Design page links it', () => {
  const page = readFileSync(new URL('../docs/sound.md', import.meta.url), 'utf8');
  assert.match(page, /Providers › \**Sound \(Design\)/);
  for (const yes of ['assets/sound/', '$0.08', '$0.15']) assert.ok(page.includes(yes), yes);
  assert.ok(page.trimEnd().split('\n').length <= 60, 'at most 60 lines');
  assert.doesNotMatch(page, /claude|opus|sonnet|haiku|fable|session/i);
  assert.match(text, /\]\(sound\.md\)/);
  assert.match(readFileSync(new URL('../docs/README.md', import.meta.url), 'utf8'), /\]\(sound\.md\)/);
  for (const doc of [page, text]) assert.doesNotMatch(doc, /with no sound/);
  const sentence = 'A film with sound starts when you click it or press Space, because a browser plays no sound before one.';
  assert.ok(text.replace(/\s+/g, ' ').includes(sentence), sentence);
});
