import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPromptArtifact, renderAttachmentsBlock } from '../src/core/phases.mjs';

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
