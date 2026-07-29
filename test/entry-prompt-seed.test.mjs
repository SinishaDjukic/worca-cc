import test from 'node:test';
import assert from 'node:assert/strict';
import {
  entrySeedChannels,
  renderPromptArtifact,
  renderAttachmentsBlock,
} from '../src/core/channels.mjs';

// Minimal resolved-node specs (match DEFAULT_SPEC in agent-registry.mjs).
const N = {
  planner:     { key: 'planner',     consumes: ['userPrompt'],     produces: ['plan'] },
  refiner:     { key: 'refiner',     consumes: ['plan'],           produces: ['plan', 'review'] },
  implementer: { key: 'implementer', consumes: ['plan', 'review'], optionalConsumes: ['review'], produces: ['code'] },
  reviewer:    { key: 'reviewer',    consumes: ['plan', 'code'],   produces: ['review'] },
  webui:       { key: 'manualWebUiTesting', consumes: ['checklist', 'code'], produces: ['review'] },
};
const steps = (...rows) => rows.map((r) => r.map((k) => N[k]));

test('planner-first (default) seeds nothing — zero behavior drift', () => {
  assert.deepEqual(entrySeedChannels(steps(['planner'], ['refiner'], ['implementer'], ['reviewer'])), []);
});

test('implementer-first seeds plan (required, never produced upstream)', () => {
  assert.deepEqual(entrySeedChannels(steps(['implementer'], ['reviewer'])), ['plan']);
});

test('refiner-first seeds plan even though the refiner also produces plan', () => {
  assert.deepEqual(entrySeedChannels(steps(['refiner'], ['implementer'], ['reviewer'])), ['plan']);
});

test('implementer + web-ui seeds plan AND checklist', () => {
  assert.deepEqual(entrySeedChannels(steps(['implementer'], ['webui'])), ['plan', 'checklist']);
});

test('reviewer-alone seeds plan but not code (code is the standing worktree)', () => {
  assert.deepEqual(entrySeedChannels(steps(['reviewer'])), ['plan']);
});

test('an optional materializable channel is never seeded', () => {
  const optionalPlan = [[{ key: 'x', consumes: ['plan'], optionalConsumes: ['plan'], produces: [] }]];
  assert.deepEqual(entrySeedChannels(optionalPlan), []);
});

test('renderPromptArtifact embeds the request and lists attachments', () => {
  const md = renderPromptArtifact('BUILD THE THING', [{ name: 'spec.md', path: '/pipe/extras/spec.md' }]);
  assert.match(md, /No upstream agent produced this artifact/);
  assert.match(md, /## Original request/);
  assert.match(md, /BUILD THE THING/);
  assert.match(md, /## Attached files/);
  assert.match(md, /\/pipe\/extras\/spec\.md/);
});

test('renderPromptArtifact omits the attachments section when there are none', () => {
  assert.doesNotMatch(renderPromptArtifact('X', []), /## Attached files/);
});

test('renderAttachmentsBlock is the single source for the attachments list', () => {
  assert.equal(renderAttachmentsBlock([]), '');
  const block = renderAttachmentsBlock([{ name: 'a.txt', path: '/pipe/extras/a.txt' }]);
  assert.match(block, /## Attached files/);
  assert.match(block, /- `\/pipe\/extras\/a\.txt` \(a\.txt\)/);
});
