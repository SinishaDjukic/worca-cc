// test/stillhet-import-guard.test.mjs — Stillhet code never imports a dev screen module or reaches dev's DOM.
// The real tree must be clean; each violation kind is seeded to prove the guard goes red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardStillhet, scanText, ALLOWED_IDS, KNOWN_CAPTURE_READERS } from '../tools/stillhet-import-guard.mjs';

const opts = { devIds: new Set(['topnav', 'app', 'toast']), ownIds: new Set(['rail-strip']), captureReaders: {} };
const scan = (text, file = 'ui/public/stillhet/shell/x.js') => scanText(text, file, opts);
const kinds = (text, file) => scan(text, file).map((v) => v.kind);

test('the real tree has no violation', () => {
  assert.deepEqual(guardStillhet(), []);
});

test('an import of a dev screen module is a violation, in every form', () => {
  assert.deepEqual(kinds("import { x } from '../../app.js';"), ['import']);
  assert.deepEqual(kinds("const m = await import('../../chat-client.mjs');"), ['import']);
  assert.deepEqual(kinds("importScripts('../../app.js');"), ['import']);
  assert.deepEqual(kinds('<script src="/app.js"></script>'), ['import']);
  assert.deepEqual(kinds('<link rel="stylesheet" href="/style-extra.css">'), ['import']);
});

test('the allowed targets pass: the design system, fonts, assets, Stillhet itself and the two engine files', () => {
  assert.deepEqual(kinds("import { button } from '../../design-system/components/index.mjs';"), []);
  assert.deepEqual(kinds("import { createGraphView } from '../../graph/view.mjs';", 'ui/public/stillhet/graph/graph-entry.mjs'), []);
  assert.deepEqual(kinds("import { autoLayout } from '../../../../src/shared/graph/layout.mjs';", 'ui/public/stillhet/graph/graph-entry.mjs'), []);
  assert.deepEqual(kinds('<script src="/stillhet/boot.js"></script><link rel="x" href="/fonts/a.woff2">'), []);
  assert.deepEqual(kinds("import 'node:fs';"), []);
});

test('reaching an id of dev\'s shell is a violation; an id Stillhet draws itself, and the allowed words, are not', () => {
  assert.deepEqual(kinds("document.getElementById('topnav')"), ['dev-dom']);
  assert.deepEqual(kinds("el.closest('#topnav .x')"), ['dev-dom']);
  assert.deepEqual(kinds("document.getElementById('rail-strip')"), []);
  assert.ok('app' in ALLOWED_IDS && 'toast' in ALLOWED_IDS);
  assert.deepEqual(kinds("document.getElementById('app'); document.querySelector('#toast')"), []);
  for (const [id, reason] of Object.entries(ALLOWED_IDS)) assert.ok(reason.length > 10, `${id} needs a reason`);
});

test('window.Today and cloning a dev node are violations; no file is a known reader', () => {
  assert.deepEqual(kinds('const T = window.Today;'), ['capture']);
  assert.deepEqual(kinds("document.getElementById('topnav').cloneNode(true)"), ['dev-dom', 'capture']);
  assert.deepEqual(kinds("document.getElementById('rail-strip').cloneNode(true)"), []);
  assert.deepEqual(KNOWN_CAPTURE_READERS, {}, 'there is no named exception');
});

test('a fetch of a dev HTML fragment is a violation', () => {
  assert.deepEqual(kinds("fetch('/views/x.html')"), ['fragment']);
  assert.deepEqual(kinds("fetch('/api/flags')"), []);
});
