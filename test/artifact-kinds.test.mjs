import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';
import {
  viewerKindFor, mimeForPath, BINARY_KINDS, RAW_KINDS, classifyExtension, TEXT_EXTENSIONS, BINARY_EXTENSIONS,
  isBrowsableKind,
} from '../src/shared/artifact-kinds.mjs';

test('viewerKindFor: one case per extension family, dotfiles and unknowns fall to text', () => {
  const cases = {
    'plan.md': 'markdown', 'a/b/notes.markdown': 'markdown', 'clarify.json': 'json', 'diff-patch.patch': 'diff', 'x.diff': 'diff',
    'live-log.ndjson': 'text', 'deck/deck.html': 'html', 'x.HTM': 'html', 'shots/s01.png': 'image', 'a.jpg': 'image', 'a.jpeg': 'image',
    'a.gif': 'image', 'a.webp': 'image', 'logo.svg': 'image', 'out.pdf': 'pdf', 'deck.pptx': 'binary', 'a.docx': 'binary', 'a.xlsx': 'binary',
    'a.key': 'binary', 'a.zip': 'binary', 'a.tar': 'binary', 'deck/deck-stage.js': 'text', 'deck/font.woff2': 'binary', 'deck/font.otf': 'binary',
    '.gitignore': 'text', 'Makefile': 'text', 'weird.xyz': 'text', '': 'text',
  };
  for (const [p, k] of Object.entries(cases)) assert.equal(viewerKindFor(p), k, p);
});

test('mimeForPath covers documents and every deck media type, which are treated as bytes', async () => {
  await checkRows([
    { name: 'mimeForPath', run: async () => {
      assert.equal(mimeForPath('deck/deck.html'), 'text/html; charset=utf-8');
      assert.equal(mimeForPath('s.png'), 'image/png');
      assert.equal(mimeForPath('deck/deck-stage.js'), 'text/javascript; charset=utf-8');
      assert.equal(mimeForPath('d.pptx'), 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      assert.equal(mimeForPath('deck/font.otf'), 'font/otf');
      assert.equal(mimeForPath('x.unknown'), null);
    } },
    // ROUND 3, F2. The deck bundlers were widened to match img|audio|video|source and
    // their MIME tables gained the media types; these three artifact-side tables were
    // not. An .m4a/.wav/.ogg/.webm/.avif a deck references then had no mime (the raw
    // route answers 415, so the framed deck/deck.html preview renders without its
    // voiceover, clip or artwork while the bundle embeds all three) and no binary
    // kind (so read_run_artifact UTF-8-decodes the bytes — the exact case its guard
    // exists for).
    { name: 'every media type a deck can reference has a mime and is treated as bytes', run: async () => {
      const expected = {
        'narration.mp3': 'audio/mpeg', 'narration.m4a': 'audio/mp4', 'narration.wav': 'audio/wav',
        'narration.ogg': 'audio/ogg', 'clip.mp4': 'video/mp4', 'clip.webm': 'video/webm',
        'art.avif': 'image/avif',
      };
      for (const [name, mime] of Object.entries(expected)) {
        assert.equal(mimeForPath(name), mime, `${name} has no Content-Type, so the raw route 415s`);
        assert.equal(BINARY_KINDS.has(viewerKindFor(name)), true, `${name} would be decoded as UTF-8 text`);
        assert.equal(RAW_KINDS.has(viewerKindFor(name)), true, `${name} cannot be streamed by the raw route`);
      }
    } },
  ]);
});

test('the Ask allowlist is unchanged by the promotion', () => {
  assert.deepEqual(TEXT_EXTENSIONS, ['.md', '.markdown', '.txt', '.json', '.csv', '.log', '.html', '.htm', '.xml']);
  assert.deepEqual(BINARY_EXTENSIONS, ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf']);
  assert.deepEqual(classifyExtension('.html'), { kind: 'text', mime: 'text/html' }, 'html is an Ask TEXT attachment (dev) — the viewer still renders it as html');
  assert.equal(viewerKindFor('deck/deck.html'), 'html');
  assert.deepEqual(classifyExtension('.PNG'), { kind: 'image', mime: 'image/png' });
  assert.equal(viewerKindFor('data/feed.xml'), 'text', 'an XML attachment opens in the viewer as text');
  assert.equal(mimeForPath('data/feed.xml'), 'application/xml');
});

test('isBrowsableKind hides transient markers and the subresources an artifact loads', () => {
  for (const k of ['deck', 'deck-shot', 'plan', 'review', 'prompt', 'result', 'extra']) {
    assert.equal(isBrowsableKind(k), true, k);
  }
  // Transient run markers (their file is gone or is not a single file) and the
  // kit/font/proof files deck.html pulls in: indexed so the raw route resolves
  // them, never a row a human is asked to browse.
  // Every kind run-harness._artifact refuses to INDEX must be non-browsable, or
  // the viewer offers a row that resolves against nothing. `clarify` is emitted
  // by both clarify sidecars and lives in the clarify table, not in a file.
  for (const k of ['pipeline', 'clarify', 'live-log', 'questions', 'deck-asset']) {
    assert.equal(isBrowsableKind(k), false, k);
  }
  assert.equal(isBrowsableKind(''), true, 'an unknown kind stays browsable');
});

// Chat P5: the popup viewer plays media inline, so media is no longer a download-only `binary` kind — the raw route
// keys `attachment` on `binary`. The kinds stay byte kinds (never UTF-8 decoded) and raw-streamable.
test('media plays inline: audio and video viewer kinds, avif is an image, fonts stay binary', () => {
  for (const p of ['n.mp3', 'n.m4a', 'n.wav', 'n.ogg', 'deck/NARRATION.MP3']) assert.equal(viewerKindFor(p), 'audio', p);
  for (const p of ['c.mp4', 'c.webm']) assert.equal(viewerKindFor(p), 'video', p);
  assert.equal(viewerKindFor('art.avif'), 'image');
  for (const p of ['f.woff2', 'f.woff', 'f.ttf', 'f.otf', 'deck.pptx', 'a.zip']) assert.equal(viewerKindFor(p), 'binary', p);
  for (const k of ['audio', 'video']) {
    assert.equal(BINARY_KINDS.has(k), true, `${k} must never be decoded as text`);
    assert.equal(RAW_KINDS.has(k), true, `${k} must stream from the raw route`);
  }
  assert.equal(mimeForPath('n.ogg'), 'audio/ogg', 'the players get the right Content-Type');
});
