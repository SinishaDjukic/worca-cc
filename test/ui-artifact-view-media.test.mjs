// test/ui-artifact-view-media.test.mjs
// The DOM half of the typed artifact viewer, under the ONE public contract:
// async renderArtifact(artifact, mount, deps). jsdom pins the two security
// invariants the module owns — (a) the html iframe carries sandbox="allow-scripts"
// and NEVER allow-same-origin (the two together let the framed page reach its own
// frame element and strip the sandbox attribute), and (b) every text kind goes
// through textContent, never innerHTML.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderArtifact, rawArtifactUrl, groupArtifactsByKind } from '../ui/public/artifact-view-media.mjs';
import { checkRows } from './helpers/rows.mjs';

// The real mount shape: app.js's showViewerHost() puts a <div class="artifact-view">
// inside <div id="viewer-body">, and renderArtifact renders into that host.
const mountIn = () => new JSDOM(
  '<!doctype html><body><div id="viewer-body"><div class="artifact-view"></div></div></body>',
  { url: 'http://localhost:4317/' },
).window.document.querySelector('#viewer-body .artifact-view');

test('html renders in an iframe sandboxed to allow-scripts ONLY', async () => {
  const mount = mountIn();
  await renderArtifact(
    { kind: 'webui', relPath: 'deck/deck.html', url: '/api/runs/abc/artifact-raw/deck/deck.html' },
    mount,
  );
  const frame = mount.querySelector('iframe');
  assert.ok(frame);
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts');
  assert.doesNotMatch(frame.getAttribute('sandbox'), /allow-same-origin/);
  assert.equal(frame.getAttribute('src'), '/api/runs/abc/artifact-raw/deck/deck.html');
  assert.equal(frame.getAttribute('referrerpolicy'), 'no-referrer');
});

test('byte kinds: image <img> (zoom toggle), pdf <embed>, binary download link only', async () => {
  await checkRows([
    { name: 'image renders an <img> against the raw url and toggles natural size on click', run: async () => {
      const mount = mountIn();
      await renderArtifact({ kind: 'extra', relPath: 'shots/s01.png', url: '/x/s01.png' }, mount);
      const img = mount.querySelector('img');
      assert.equal(img.getAttribute('src'), '/x/s01.png');
      assert.equal(img.getAttribute('alt'), 'shots/s01.png');
      assert.ok(mount.classList.contains('kind-image'), 'the mount carries the class style.css keys on');
      img.dispatchEvent(new (mount.ownerDocument.defaultView.Event)('click', { bubbles: true }));
      assert.ok(mount.classList.contains('zoomed'));
    } },
    { name: 'pdf renders <embed type="application/pdf">; binary offers a download link only', run: async () => {
      const pdf = mountIn();
      await renderArtifact({ kind: 'extra', relPath: 'a.pdf', url: '/p' }, pdf);
      assert.equal(pdf.querySelector('embed').getAttribute('type'), 'application/pdf');
      const bin = mountIn();
      await renderArtifact({ kind: 'extra', relPath: 'deck.pptx', url: '/b' }, bin);
      assert.equal(bin.querySelector('iframe, img, embed'), null);
      assert.equal(bin.querySelector('a').getAttribute('download'), 'deck.pptx');
    } },
  ]);
});

test('text kinds render a <pre> with textContent (never innerHTML)', async () => {
  const j = mountIn();
  await renderArtifact({ kind: 'questions', relPath: 'a.json', text: '{"a":1}' }, j);
  assert.equal(j.querySelector('pre.artifact-json').textContent, '{\n  "a": 1\n}');
  const t = mountIn();
  await renderArtifact({ kind: 'extra', relPath: 'x', text: '<b>raw</b>' }, t);
  assert.equal(t.querySelector('pre.artifact-text').textContent, '<b>raw</b>');
  assert.equal(t.querySelector('b'), null, 'the markup stayed text, it was never parsed into nodes');
});

test('markdown without a loadMarkdown seam degrades to plaintext, never innerHTML', async () => {
  const mount = mountIn();
  await renderArtifact({ kind: 'plan', relPath: 'plans/p.md', text: '# <img src=x onerror=1>' }, mount);
  assert.equal(mount.querySelector('pre.artifact-text').textContent, '# <img src=x onerror=1>');
  assert.equal(mount.querySelector('img'), null);
});

test('diff colours +/-/@@ lines, uncapped — one span per line, no truncation tail', async () => {
  const mount = mountIn();
  const lines = Array.from({ length: 500 }, (_, i) => (i % 2 ? `+add ${i}` : `-del ${i}`));
  await renderArtifact({ kind: 'result', relPath: 'r.diff', text: lines.join('\n') }, mount);
  const pre = mount.querySelector('pre.artifact-diff');
  assert.equal(pre.querySelectorAll('.artifact-diff-line').length, 500, 'every line rendered');
  assert.ok(pre.querySelector('.artifact-diff-line.add'));
  assert.ok(pre.querySelector('.artifact-diff-line.del'));
  assert.doesNotMatch(pre.textContent, /more lines|truncated/i, 'no row cap, no truncation notice');
});

test('a byte kind with no url degrades to the download stub, never src=""', async () => {
  const mount = mountIn();
  await renderArtifact({ kind: 'extra', relPath: 'shots/s01.png' }, mount);
  assert.equal(mount.querySelector('img'), null);
  assert.ok(mount.querySelector('a[download]'));
});

test('rawArtifactUrl encodes each segment', () => {
  assert.equal(rawArtifactUrl('/api/runs/abc', 'deck/a b.html'), '/api/runs/abc/artifact-raw/deck/a%20b.html');
});

test('groupArtifactsByKind: first-appearance order, collapse strictly above threshold, empty in/out', async () => {
  await checkRows([
    { name: 'groupArtifactsByKind keeps kinds in first-appearance order and flags the bulky one', run: async () => {
      const shots = Array.from({ length: 6 }, (_, i) => ({ kind: 'deck-shot', relPath: `shots/s0${i + 1}.png` }));
      const groups = groupArtifactsByKind([
        { kind: 'deck-audit', relPath: 'deck-audit-cycle1.md' },
        ...shots,
        { kind: 'deck-audit', relPath: 'deck-audit-cycle2.md' },
      ], { threshold: 5 });
      assert.deepEqual(groups.map((g) => [g.kind, g.collapsed, g.items.length]),
        [['deck-audit', false, 2], ['deck-shot', true, 6]]);
      assert.equal(groups[1].items[0].relPath, 'shots/s01.png', 'members keep their arrival order');
    } },
    { name: 'groupArtifactsByKind leaves a kind exactly at the threshold flat', run: async () => {
      const five = Array.from({ length: 5 }, (_, i) => ({ kind: 'deck-shot', relPath: `shots/s0${i + 1}.png` }));
      assert.equal(groupArtifactsByKind(five, { threshold: 5 })[0].collapsed, false);
      assert.equal(groupArtifactsByKind([...five, { kind: 'deck-shot', relPath: 'shots/s06.png' }], { threshold: 5 })[0].collapsed, true);
    } },
    { name: 'groupArtifactsByKind on an empty list is an empty list', run: async () => {
      assert.deepEqual(groupArtifactsByKind([]), []);
      assert.deepEqual(groupArtifactsByKind(), []);
    } },
  ]);
});

test('audio and video play inline from the raw route; without a url they degrade to the download stub', async () => {
  const a = mountIn();
  await renderArtifact({ kind: 'deck-asset', relPath: 'deck/narration.mp3', url: '/x/n.mp3' }, a);
  const audio = a.querySelector('audio');
  assert.ok(audio, 'an <audio> player');
  assert.equal(audio.getAttribute('src'), '/x/n.mp3');
  assert.ok(audio.hasAttribute('controls'), 'the browser\'s own controls');
  assert.equal(audio.getAttribute('preload'), 'metadata', 'never pulls the whole file up front');
  assert.ok(a.classList.contains('kind-audio'));
  const v = mountIn();
  await renderArtifact({ kind: 'extra', relPath: 'clips/c.webm', url: '/x/c.webm' }, v);
  const video = v.querySelector('video');
  assert.ok(video && video.hasAttribute('controls') && video.hasAttribute('playsinline'));
  assert.equal(video.getAttribute('src'), '/x/c.webm');
  assert.ok(v.classList.contains('kind-video'));
  const none = mountIn();
  await renderArtifact({ kind: 'extra', relPath: 'clips/c.mp4' }, none);
  assert.equal(none.querySelector('video'), null, 'never src=""');
  assert.ok(none.querySelector('a[download]'));
});

test('the video player preloads metadata only too, and both players are named for assistive tech by the file name alone', async () => {
  const v = mountIn();
  await renderArtifact({ kind: 'extra', relPath: 'clips/c.webm', url: '/x/c.webm' }, v);
  assert.equal(v.querySelector('video').getAttribute('preload'), 'metadata');
  assert.equal(v.querySelector('video').getAttribute('aria-label'), 'c.webm');
  const a = mountIn();
  await renderArtifact({ kind: 'deck-asset', relPath: 'deck/narration.mp3', url: '/x/n.mp3' }, a);
  assert.equal(a.querySelector('audio').getAttribute('aria-label'), 'narration.mp3');
  const w = mountIn();
  await renderArtifact({ kind: 'deck-asset', relPath: 'C:\\Users\\me\\run\\deck\\narration.mp3', url: '/x/n.mp3' }, w);
  assert.equal(w.querySelector('audio').getAttribute('aria-label'), 'narration.mp3', 'a Windows path names the file, not the home directory');
});

test('a video player is named by the file alone on a Windows path; a path with no file name falls back to "audio" / "video"', async () => {
  const w = mountIn();
  await renderArtifact({ kind: 'clip', relPath: 'C:\\Users\\me\\run\\media\\c.webm', url: '/x/c.webm' }, w);
  assert.equal(w.querySelector('video').getAttribute('aria-label'), 'c.webm');
  const { renderAudio, renderVideo } = await import('../ui/public/artifact-view-media.mjs');
  const a = mountIn();
  assert.equal(renderAudio('/x/a', '', a).getAttribute('aria-label'), 'audio');
  const v = mountIn();
  assert.equal(renderVideo('/x/v', 'media/', v).getAttribute('aria-label'), 'video');
});
