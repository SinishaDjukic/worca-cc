import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerFileRenderer, fileRendererFor, filePreviewOf, _resetFileRenderers, FALLBACK_FILE_RENDERER } from '../ui/public/chat/file-renderers.mjs';

beforeEach(() => _resetFileRenderers());

test('file renderers: kind lookup, last registration wins, custom match, junk ignored, unknown kind -> fallback', () => {
  registerFileRenderer('image', { preview: 'image', label: 'Image' });
  registerFileRenderer('image', { preview: 'image', label: 'Picture' });
  registerFileRenderer('', { preview: 'image' });
  registerFileRenderer('bad', { preview: 'nope' });
  registerFileRenderer('notebook', { preview: 'json', match: (it) => /\.ipynb$/.test(it.name) });
  assert.equal(fileRendererFor({ kind: 'image', name: 'a.png' }).label, 'Picture');
  assert.equal(fileRendererFor({ kind: 'bad', name: 'x' }), FALLBACK_FILE_RENDERER);
  assert.equal(fileRendererFor({ kind: 'text', name: 'a.ipynb' }).kind, 'notebook');
  assert.equal(filePreviewOf({ kind: 'zip', name: 'a.zip' }), 'none');
});

test('file renderers: a preview answer outside the allowed set (html, c4, junk) becomes none — nothing can frame a file', () => {
  registerFileRenderer('page', { preview: () => 'html' });
  registerFileRenderer('boom', { preview: () => { throw new Error('x'); } });
  assert.equal(filePreviewOf({ kind: 'page', name: 'p.html' }), 'none');
  assert.equal(filePreviewOf({ kind: 'boom', name: 'b' }), 'none');
});
