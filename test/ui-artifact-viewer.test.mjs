// test/ui-artifact-viewer.test.mjs — the artifact popup's pieces over plain data (no app.js): the pure helpers
// (artifacts/common.mjs), the preview renderers (artifacts/preview.mjs) and the modal (artifacts/viewer.mjs).
// Untrusted text must reach the DOM as textContent or as rowsFromHtml-validated hljs spans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { checkRows } from './helpers/rows.mjs';
import {
  previewKindFor, parseDelimited, midTruncate, formatBytes, baseName, displayPath, CSV_MAX_ROWS,
} from '../ui/public/artifacts/common.mjs';
import { renderPreview } from '../ui/public/artifacts/preview.mjs';

const mountIn = () => new JSDOM('<!doctype html><body><div class="artifact-view" id="m"></div></body>',
  { url: 'http://localhost:4317/' }).window.document.getElementById('m');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** A stand-in for hljs-loader: every non-empty line becomes one keyword span (escaped like hljs escapes). */
function fakeLoader() {
  const asked = [];
  return {
    asked,
    forLanguage: async (lang) => {
      asked.push(lang);
      return { lang, highlight: (text) => String(text).split('\n').map((l) => (l ? `<span class="hljs-keyword">${esc(l)}</span>` : '')).join('\n') };
    },
  };
}

test('previewKindFor: the existing chain\'s answer, widened with code, csv and none', () => {
  const cases = [
    ['plan', 'plans/plan.md', 'markdown'], [null, 'a.json', 'json'], [null, 'x.patch', 'diff'],
    [null, 'src/app.py', 'code'], [null, 'deck/deck-stage.js', 'code'], [null, 'Makefile', 'code'],
    [null, 'notes.txt', 'text'], [null, 'run.log', 'text'], [null, 'data.csv', 'csv'], [null, 'data.TSV', 'csv'],
    [null, 'shot.png', 'image'], [null, 'logo.svg', 'image'], [null, 'art.avif', 'image'], [null, 'out.pdf', 'pdf'],
    [null, 'deck/deck.html', 'html'], [null, 'model.c4', 'c4'], [null, 'n.mp3', 'audio'], [null, 'c.mp4', 'video'],
    [null, 'deck.pptx', 'none'], [null, 'f.woff2', 'none'], ['plan', 'PLAN', 'markdown'], [null, 'PLAN', 'text'],
    // An extension naming a table, a language or a byte format beats the kind; a kind still decides for the rest.
    ['result', 'out/data.csv', 'csv'], ['result', 'tools/x.py', 'code'], ['review', 'dist/a.tar.gz', 'none'],
    ['plan', 'notes.txt', 'markdown'], ['result', 'RESULT', 'diff'],
    [null, 'clip.mov', 'none'], [null, 'a.flac', 'none'], [null, 'bundle.tar.gz', 'none'],
  ];
  for (const [kind, rel, want] of cases) assert.equal(previewKindFor(kind, rel), want, `${kind} ${rel}`);
});

test('helpers: a long name is cut in the middle, sizes are compact, paths never show a home directory', () => {
  const long = `${'a'.repeat(60)}.md`;
  const cut = midTruncate(long);
  assert.equal(cut.length, 44);
  assert.ok(cut.includes('…') && cut.endsWith('.md'), cut);
  assert.equal(midTruncate('plan.md'), 'plan.md');
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(26 * 1024 * 1024), '26.0 MB');
  assert.equal(baseName('C:\\Users\\me\\run\\plan.md'), 'plan.md');
  assert.equal(baseName('a/b/c.md'), 'c.md');
  assert.equal(displayPath('/Users/me/.worca-cc/run/deck/deck.html'), 'deck.html');
  assert.equal(displayPath('\\\\server\\share\\x.md'), 'x.md');
  assert.equal(displayPath('deck/deck.html'), 'deck/deck.html');
});

test('parseDelimited reads quoted CSV and TSV and refuses what is not a small table', () => {
  assert.deepEqual(parseDelimited('a,b\r\n1,"x, ""y"""\n'), [['a', 'b'], ['1', 'x, "y"']]);
  assert.deepEqual(parseDelimited('a\tb\n1\t2', '\t'), [['a', 'b'], ['1', '2']]);
  assert.equal(parseDelimited('a,"open\n'), null, 'an unclosed quote');
  assert.equal(parseDelimited(Array.from({ length: CSV_MAX_ROWS + 1 }, (_, i) => String(i)).join('\n')), null, 'too many rows');
  assert.equal(parseDelimited(Array.from({ length: 51 }, (_, i) => `c${i}`).join(',')), null, 'too many columns');
});

test('code is highlighted through the hljs loader inside the caps; past them, or with no loader, it stays text', async () => {
  const loader = fakeLoader();
  const m = mountIn();
  await renderPreview({ kind: null, relPath: 'src/app.py', text: 'def f():\n  return "<b>"' }, m, { hljsLoader: loader });
  const pre = m.querySelector('pre.apv-code');
  assert.ok(m.classList.contains('kind-code'));
  assert.deepEqual(loader.asked, ['python']);
  assert.equal(pre.querySelectorAll('span.hljs-keyword').length, 2, 'one span per line');
  assert.equal(pre.textContent, 'def f():\n  return "<b>"', 'the text is unchanged');
  assert.equal(pre.querySelector('b'), null, 'markup in the source stays text');

  const big = mountIn();
  const many = Array.from({ length: 3001 }, (_, i) => `x = ${i}`).join('\n');
  const loader2 = fakeLoader();
  await renderPreview({ kind: null, relPath: 'big.py', text: many }, big, { hljsLoader: loader2 });
  assert.deepEqual(loader2.asked, [], 'past the row cap the grammar is never even loaded');
  assert.equal(big.querySelector('span'), null);

  const plain = mountIn();
  await renderPreview({ kind: null, relPath: 'src/app.py', text: 'x = 1' }, plain, {});
  assert.equal(plain.querySelector('pre.apv-code').textContent, 'x = 1', 'no loader: plain text');

  const lossy = mountIn();
  const dropsOne = { forLanguage: async () => ({ highlight: (text) => String(text).split('\n').map((l) => (l ? `<span class="hljs-keyword">${esc(l.slice(1))}</span>` : '')).join('\n') }) };
  await renderPreview({ kind: null, relPath: 'src/app.py', text: 'x = 1' }, lossy, { hljsLoader: dropsOne });
  assert.equal(lossy.querySelector('pre.apv-code').textContent, 'x = 1', 'spans that do not spell the source fall back to it');
  assert.equal(lossy.querySelector('span'), null);
});

test('json is pretty-printed and highlighted; csv is a table when small and text when not', async () => {
  const j = mountIn();
  const loader = fakeLoader();
  await renderPreview({ kind: 'review', relPath: 'review.json', text: '{"a":1}' }, j, { hljsLoader: loader });
  assert.deepEqual(loader.asked, ['json']);
  assert.equal(j.querySelector('pre.artifact-json').textContent, '{\n  "a": 1\n}');
  assert.ok(j.querySelector('pre.artifact-json span.hljs-keyword'));

  const c = mountIn();
  await renderPreview({ kind: null, relPath: 'data/t.csv', text: 'name,score\nada,"1,5"\n' }, c, {});
  assert.ok(c.classList.contains('kind-csv'));
  assert.deepEqual([...c.querySelectorAll('thead th')].map((x) => x.textContent), ['name', 'score']);
  assert.deepEqual([...c.querySelectorAll('tbody td')].map((x) => x.textContent), ['ada', '1,5']);

  const t = mountIn();
  await renderPreview({ kind: null, relPath: 'data/t.csv', text: 'a,"open\n' }, t, {});
  assert.ok(t.classList.contains('kind-text'), 'not a table: plain text');
  assert.equal(t.querySelector('pre.artifact-text').textContent, 'a,"open\n');
});

test('everything else goes through the existing chain: markdown without its bundle is text, html is sandboxed, media plays', async () => {
  const md = mountIn();
  await renderPreview({ kind: 'plan', relPath: 'plans/p.md', text: '# <img src=x onerror=1>' }, md, {});
  assert.equal(md.querySelector('pre.artifact-text').textContent, '# <img src=x onerror=1>');
  assert.equal(md.querySelector('img'), null);
  const html = mountIn();
  await renderPreview({ kind: 'deck', relPath: 'deck/deck.html', url: '/raw/deck/deck.html' }, html, {});
  assert.equal(html.querySelector('iframe').getAttribute('sandbox'), 'allow-scripts');
  const v = mountIn();
  await renderPreview({ kind: 'clip', relPath: 'media/c.webm', url: '/raw/media/c.webm' }, v, {});
  assert.ok(v.querySelector('video[controls]'));
  assert.ok(v.classList.contains('kind-video'));
});

test('a name is cut by code points: one that fits in 44 is never cut, and the head never ends inside a character', () => {
  const fits = `${'a'.repeat(30)}${String.fromCodePoint(0x1F600).repeat(10)}.md`;     // 43 characters, 53 UTF-16 units
  assert.equal(midTruncate(fits), fits);
  const cut = midTruncate(`b${String.fromCodePoint(0x1F600).repeat(50)}.md`);
  assert.equal(cut.toWellFormed(), cut, 'no lone surrogate before the ellipsis');
  assert.ok(cut.endsWith('.md') && cut.includes('…'), cut);
});

test('previewKindFor: a bare file name a language knows (Makefile) is no extension, so a kind still decides', () => {
  assert.equal(previewKindFor('plan', 'Makefile'), 'markdown');
  assert.equal(previewKindFor(null, 'Makefile'), 'code');
});

// ── the modal (artifacts/viewer.mjs) ─────────────────────────────────────────
const { openArtifactViewer } = await import('../ui/public/artifacts/viewer.mjs');

const URLS = { text: (rel) => `/t?rel=${encodeURIComponent(rel)}`, raw: (rel) => `/raw/${rel}`, download: (rel) => `/raw/${rel}?download=1` };
/** A page with an opener button; `respond(url, method)` → {status, body} | null (null = 200 {}); may be async. */
function page(respond = () => null) {
  const dom = new JSDOM('<!doctype html><body><button id="opener" data-focus-key="row:1">open</button></body>',
    { url: 'http://localhost:4317/' });
  const win = dom.window;
  const doc = win.document;
  const calls = [];
  const fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push(`${method} ${url}`);
    const r = (await respond(String(url), method)) || { status: 200, body: {} };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
  const open = (o) => openArtifactViewer({ doc, win, fetch, urls: URLS, ...o });
  return { win, doc, calls, open, opener: doc.getElementById('opener') };
}
const tick = async (win, n = 8) => { for (let i = 0; i < n; i += 1) await new Promise((r) => win.setTimeout(r, 0)); };
const press = (win, el, key, extra = {}) => el.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }));
const tap = (win, el, detail = 1) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, detail }));
// A press and its release on the same node (a click on the backdrop has to start there too).
const pressTap = (win, el, detail = 1) => { el.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, cancelable: true, detail })); tap(win, el, detail); };

test('the viewer opens as a modal: the file, its step · cycle · size, focus inside, the text preview', async () => {
  const p = page((url) => (url.startsWith('/t?') ? { status: 200, body: { rel: 'plans/notes.txt', text: 'hello' } } : null));
  p.opener.focus();
  const v = p.open({ artifact: { kind: 'notes', relPath: 'plans/notes.txt', bytes: 2048, nodeId: 'n1', cycle: 2 }, meta: { step: 'Planner', cycle: 2 } });
  await v.ready;
  const root = p.doc.querySelector('.apv');
  assert.equal(root.getAttribute('role'), 'dialog');
  assert.equal(root.getAttribute('aria-modal'), 'true');
  const title = root.querySelector('.apv-title');
  assert.equal(root.getAttribute('aria-labelledby'), title.id);
  assert.equal(title.textContent, 'notes.txt');
  assert.equal(title.title, 'plans/notes.txt');
  assert.equal(root.querySelector('.apv-meta').textContent, 'Planner · cycle 2 · 2.0 KB');
  assert.ok(root.contains(p.doc.activeElement), 'focus moved into the dialog');
  assert.equal(root.querySelector('.apv-stage pre.artifact-text').textContent, 'hello');
  assert.deepEqual(p.calls, ['GET /t?rel=plans%2Fnotes.txt']);
  assert.equal(root.querySelector('.apv-prev').hidden, true, 'one file: no ←/→');
  assert.equal(p.doc.querySelector('#viewer-card'), null, 'its own element, not the old #viewer-card');
  assert.equal(root.parentElement, p.doc.body, 'body-level: above any panel or page it was opened from');
  assert.equal(p.doc.querySelector('.viewer-modal:not(.hidden)'), root, 'every "a dialog owns Escape" check sees it');
});

test('Esc, the backdrop and Close dismiss it, unload the preview and hand focus back; the page never sees the Esc', async () => {
  const p = page();
  let seen = 0;
  p.doc.addEventListener('keydown', () => { seen += 1; }, true);     // like the run pages' capture-phase handlers
  const html = { kind: 'deck', relPath: 'deck/deck.html' };
  p.opener.focus();
  await p.open({ artifact: html }).ready;
  assert.ok(p.doc.querySelector('.apv iframe'), 'a framed deck is mounted');
  press(p.win, p.doc.activeElement, 'Escape');
  assert.equal(p.doc.querySelector('.apv'), null, 'Esc closed it — the frame went with its node');
  assert.equal(p.doc.activeElement, p.opener, 'focus is back on the opener');
  assert.equal(seen, 0, 'Escape never reached a document listener');

  await p.open({ artifact: html }).ready;
  const root = p.doc.querySelector('.apv');
  tap(p.win, root.querySelector('.apv-card'));
  assert.ok(p.doc.querySelector('.apv'), 'a click inside the card keeps it');
  pressTap(p.win, root, 2);
  assert.ok(p.doc.querySelector('.apv'), 'the second press of a double click does not close it');
  root.querySelector('.apv-card').dispatchEvent(new p.win.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  tap(p.win, root);
  assert.ok(p.doc.querySelector('.apv'), 'a selection dragged out of the card (pressed inside, released on the overlay) keeps it');
  pressTap(p.win, root);
  assert.equal(p.doc.querySelector('.apv'), null, 'the backdrop closes it');

  await p.open({ artifact: html }).ready;
  tap(p.win, p.doc.querySelector('.apv .apv-close'));
  assert.equal(p.doc.querySelector('.apv'), null, 'Close closes it');
});

test('←/→ and the arrow buttons step through the list, disabled at its ends', async () => {
  const bodies = { 'a.md': 'A', 'b.txt': 'B', 'c.json': '{"c":1}' };
  const p = page((url, method) => {
    if (method !== 'GET' || !url.startsWith('/t?')) return null;
    const rel = decodeURIComponent(url.split('rel=')[1] || '');
    return { status: 200, body: { rel, text: bodies[rel] } };
  });
  const list = [{ kind: 'x', relPath: 'a.md' }, { kind: 'x', relPath: 'b.txt' }, { kind: 'x', relPath: 'c.json' }];
  await p.open({ artifact: list[1], list }).ready;
  const root = p.doc.querySelector('.apv');
  assert.equal(root.querySelector('.apv-pos').textContent, '2 / 3');
  assert.equal(root.querySelector('.apv-prev').disabled, false);
  press(p.win, p.doc.activeElement, 'ArrowRight');
  await tick(p.win);
  assert.equal(root.querySelector('.apv-title').textContent, 'c.json');
  assert.equal(root.querySelector('.apv-next').disabled, true, 'the last file');
  assert.match(root.querySelector('.apv-stage').textContent, /"c": 1/, 'its own preview');
  tap(p.win, root.querySelector('.apv-prev'));
  tap(p.win, root.querySelector('.apv-prev'));
  await tick(p.win);
  assert.equal(root.querySelector('.apv-title').textContent, 'a.md');
  assert.equal(root.querySelector('.apv-prev').disabled, true, 'the first file');
  assert.equal(root.querySelector('.apv-pos').textContent, '1 / 3');
});

test('a preview still loading never paints over the file shown after it', async () => {
  let release;
  const slow = new Promise((r) => { release = r; });
  const p = page(async (url) => {
    if (url.includes('slow.txt')) { await slow; return { status: 200, body: { rel: 'slow.txt', text: 'SLOW' } }; }
    return url.startsWith('/t?') ? { status: 200, body: { rel: 'fast.txt', text: 'FAST' } } : null;
  });
  const list = [{ kind: 'x', relPath: 'slow.txt' }, { kind: 'x', relPath: 'fast.txt' }];
  p.open({ artifact: list[0], list });
  press(p.win, p.doc.activeElement, 'ArrowRight');
  await tick(p.win);
  release();
  await tick(p.win);
  assert.equal(p.doc.querySelector('.apv .apv-title').textContent, 'fast.txt');
  assert.equal(p.doc.querySelector('.apv .apv-stage').textContent, 'FAST');
});

test('Download probes the download URL, then saves through a detached <a download>; a failure is said in the viewer', async () => {
  const p = page((url, method) => {
    if (url === '/raw/gone.md?download=1') return method === 'HEAD' ? { status: 404, body: {} } : { status: 404, body: { error: 'artifact not found' } };
    return url.startsWith('/t?') ? { status: 200, body: { rel: 'x', text: 'x' } } : null;
  });
  const saved = [];
  p.win.HTMLAnchorElement.prototype.click = function () { saved.push([this.getAttribute('href'), this.getAttribute('download')]); };
  await p.open({ artifact: { kind: 'review', relPath: 'reviews/report.md' } }).ready;
  tap(p.win, p.doc.querySelector('.apv .apv-dl'));
  await tick(p.win);
  assert.ok(p.calls.includes('HEAD /raw/reviews/report.md?download=1'), p.calls.join(' | '));
  assert.deepEqual(saved, [['/raw/reviews/report.md?download=1', 'report.md']]);
  assert.equal(p.doc.querySelector('a[download]'), null, 'the anchor is gone again');

  await p.open({ artifact: { kind: 'review', relPath: 'gone.md' } }).ready;
  tap(p.win, p.doc.querySelector('.apv .apv-dl'));
  await tick(p.win);
  const note = p.doc.querySelector('.apv .apv-note');
  assert.equal(note.hidden, false);
  assert.equal(note.textContent, 'Download failed: File not found');
  assert.equal(saved.length, 1, 'nothing saved for a file that is gone');
});

test('Full screen fills the window without the Fullscreen API, asks the browser when it has one, and toggles back', async () => {
  const p = page();
  await p.open({ artifact: { kind: 'deck', relPath: 'deck/deck.pdf' } }).ready;
  const root = p.doc.querySelector('.apv');
  const btn = root.querySelector('.apv-full');
  tap(p.win, btn);
  assert.ok(root.classList.contains('is-full'), 'jsdom has no Fullscreen API: the CSS fill');
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  assert.equal(btn.getAttribute('aria-label'), 'Exit full screen');
  tap(p.win, btn);
  assert.equal(root.classList.contains('is-full'), false);
  assert.equal(btn.getAttribute('aria-label'), 'Full screen');
  const asked = [];
  p.win.HTMLElement.prototype.requestFullscreen = function () { asked.push(this.className); return Promise.resolve(); };
  tap(p.win, btn);
  assert.deepEqual(asked, ['apv-card'], 'the card asks the browser for the screen');
});

test('no preview → the full-window info view with the facts and Download; 413/415 land there too; 404 is an error', async () => {
  await checkRows([
    { name: 'an opaque document opens the info view without fetching anything', run: async () => {
      const p = page();
      await p.open({ artifact: { kind: 'deck', relPath: 'deck/deck.pptx', bytes: 5 * 1024 * 1024, nodeId: 'n1', cycle: 1 },
        metaFor: () => ({ step: 'Builder', cycle: 1 }) }).ready;
      const root = p.doc.querySelector('.apv');
      assert.ok(root.classList.contains('is-info'));
      assert.equal(root.querySelector('.apv-info-note').textContent, 'No preview for this file type');
      const facts = Object.fromEntries([...root.querySelectorAll('.apv-facts dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]));
      assert.deepEqual(facts, { Kind: 'deck', Size: '5.0 MB', Step: 'Builder', Cycle: '1', Path: 'deck/deck.pptx' });
      assert.ok(root.querySelector('.apv-info-dl'), 'Download is offered');
      assert.deepEqual(p.calls, []);
    } },
    { name: 'a 413 or 415 from the raw route opens the info view', run: async () => {
      for (const [status, note] of [[413, 'Too large to preview'], [415, 'No preview for this file type']]) {
        const p = page((url) => (url.startsWith('/raw/') ? { status, body: { error: 'x' } } : null));
        await p.open({ artifact: { kind: 'shot', relPath: 'shots/s1.png' } }).ready;
        assert.equal(p.doc.querySelector('.apv .apv-info-note').textContent, note, String(status));
      }
    } },
    { name: 'a 404 is an error inside the viewer, raw route and text route alike', run: async () => {
      const raw = page((url) => (url.startsWith('/raw/') ? { status: 404, body: { error: 'artifact not found' } } : null));
      await raw.open({ artifact: { kind: 'shot', relPath: 'shots/gone.png' } }).ready;
      assert.equal(raw.doc.querySelector('.apv .apv-error').textContent, 'File not found');
      assert.equal(raw.doc.querySelector('.apv img'), null, 'no broken image');
      const txt = page((url) => (url.startsWith('/t?') ? { status: 404, body: { error: 'artifact not found' } } : null));
      await txt.open({ artifact: { kind: 'plan', relPath: 'plans/gone.md' } }).ready;
      assert.equal(txt.doc.querySelector('.apv .apv-error').textContent, 'File not found');
    } },
    { name: 'any other failure says its status in worca\'s words, never the server\'s message', run: async () => {
      const p = page((url) => (url.startsWith('/t?') ? { status: 500, body: { error: 'EACCES: /Users/me/.worca-cc/runs/plan.md' } } : null));
      await p.open({ artifact: { kind: 'plan', relPath: 'plans/p.md' } }).ready;
      assert.equal(p.doc.querySelector('.apv .apv-error').textContent, 'Could not load (HTTP 500)');
    } },
    { name: 'a text file past the preview ceiling opens the info view without fetching it', run: async () => {
      const p = page();
      await p.open({ artifact: { kind: 'log', relPath: 'big.log', bytes: 3 * 1024 * 1024 } }).ready;
      assert.equal(p.doc.querySelector('.apv .apv-info-note').textContent, 'Too large to preview');
      assert.deepEqual(p.calls, []);
    } },
    { name: 'a long video has no client ceiling either: it plays (the route streams media at any size)', run: async () => {
      const p = page();
      await p.open({ artifact: { kind: 'clip', relPath: 'media/long.mp4', bytes: 300 * 1024 * 1024 } }).ready;
      assert.ok(p.doc.querySelector('.apv video[controls]'), 'the player, not the info view');
      assert.equal(p.doc.querySelector('.apv').classList.contains('is-info'), false);
    } },
  ]);
});

test('raw previews mount their element; a second viewer replaces the first; Tab stays inside; a route change closes it', async () => {
  const p = page();
  await p.open({ artifact: { kind: 'deck', relPath: 'deck/deck.html' } }).ready;
  assert.equal(p.doc.querySelector('.apv iframe').getAttribute('sandbox'), 'allow-scripts');
  assert.ok(p.calls.includes('HEAD /raw/deck/deck.html'), 'probed before framing');
  await p.open({ artifact: { kind: 'deck-asset', relPath: 'media/n.mp3' } }).ready;
  assert.equal(p.doc.querySelectorAll('.apv').length, 1, 'one viewer');
  const audio = p.doc.querySelector('.apv audio');
  assert.ok(audio && audio.hasAttribute('controls'));
  assert.equal(audio.getAttribute('src'), '/raw/media/n.mp3');

  await p.open({ artifact: { kind: 'x', relPath: 'notes.txt' } }).ready;
  const card = p.doc.querySelector('.apv .apv-card');
  const dl = card.querySelector('.apv-dl');
  const close = card.querySelector('.apv-close');
  const stage = card.querySelector('.apv-body');
  assert.equal(stage.tabIndex, 0, 'the preview is a Tab stop: the keyboard scrolls it');
  assert.equal(stage.getAttribute('role'), 'region');
  close.focus();
  press(p.win, close, 'Tab');
  assert.equal(p.doc.activeElement, close, 'Close is not the last stop: the browser moves on to the preview');
  stage.focus();
  press(p.win, stage, 'Tab');
  assert.equal(p.doc.activeElement, dl, 'Tab from the last stop wraps to the first');
  press(p.win, dl, 'Tab', { shiftKey: true });
  assert.equal(p.doc.activeElement, stage, 'Shift+Tab from the first wraps to the last');

  p.win.history.replaceState(null, '', '#runs');
  p.win.dispatchEvent(new p.win.Event('hashchange'));
  assert.equal(p.doc.querySelector('.apv'), null, 'navigating away closes it');
});

test('a hash rewrite in the same place keeps the popup; another view, another run\'s page or another run in the Chat panel closes it', async () => {
  const p = page();
  const go = (hash) => { p.win.history.replaceState(null, '', hash); p.win.dispatchEvent(new p.win.Event('hashchange')); };
  p.win.history.replaceState(null, '', '#chat/new/run/r1/artifacts');
  await p.open({ artifact: { kind: 'x', relPath: 'notes.txt' } }).ready;
  go('#chat/ask_00000001/run/r1/logs');
  assert.ok(p.doc.querySelector('.apv'), 'the chat got its id and the panel changed tab: still the same place');
  go('#chat/ask_00000001/run/r2');
  assert.equal(p.doc.querySelector('.apv'), null, 'another run in the panel closes it');

  p.win.history.replaceState(null, '', '#running/r1/details/artifacts');
  await p.open({ artifact: { kind: 'x', relPath: 'notes.txt' } }).ready;
  go('#running/r1/details/logs');
  assert.ok(p.doc.querySelector('.apv'), 'a tab hop on the run page keeps it');
  go('#running/r1');
  assert.ok(p.doc.querySelector('.apv'), 'a Back to the run\'s glance keeps it');
  go('#running/r2/details/artifacts');
  assert.equal(p.doc.querySelector('.apv'), null, 'another run\'s page closes it (a Back to the run before)');

  p.win.history.replaceState(null, '', '#history/proj-1/p1/details/artifacts');
  await p.open({ artifact: { kind: 'x', relPath: 'notes.txt' } }).ready;
  go('#history/proj-1/p1');
  assert.ok(p.doc.querySelector('.apv'), 'History: the same run\'s glance keeps it');
  go('#history/proj-1/p2/details/artifacts');
  assert.equal(p.doc.querySelector('.apv'), null, 'History: another run\'s page closes it');

  p.win.history.replaceState(null, '', '#running/r1/details/artifacts');
  await p.open({ artifact: { kind: 'x', relPath: 'notes.txt' } }).ready;
  go('#workflows');
  assert.equal(p.doc.querySelector('.apv'), null, 'another view closes it');
});

test('←/→ step only from the dialog or its header (inside the preview they scroll wide code); a dialog over the popup owns the keys', async () => {
  const p = page((url, method) => (method === 'GET' && url.startsWith('/t?') ? { status: 200, body: { rel: 'x', text: 'a very wide line' } } : null));
  const list = [{ kind: 'x', relPath: 'a.txt' }, { kind: 'x', relPath: 'b.txt' }];
  await p.open({ artifact: list[0], list }).ready;
  const root = p.doc.querySelector('.apv');
  const inside = new p.win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
  root.querySelector('.apv-stage pre').dispatchEvent(inside);
  assert.equal(root.querySelector('.apv-title').textContent, 'a.txt', 'inside the preview the arrows are the preview\'s');
  assert.equal(inside.defaultPrevented, false, 'so a wide line still scrolls');
  press(p.win, root.querySelector('.apv-dl'), 'ArrowRight');
  await tick(p.win);
  assert.equal(root.querySelector('.apv-title').textContent, 'b.txt', 'from a header control they step');

  const confirm = p.doc.createElement('div');
  confirm.id = 'confirm-modal';
  confirm.className = 'viewer-modal';
  p.doc.body.appendChild(confirm);
  press(p.win, p.doc.activeElement, 'Escape');
  assert.ok(p.doc.querySelector('.apv'), 'a confirm dialog over the popup owns Escape');
  confirm.classList.add('hidden');
  press(p.win, p.doc.activeElement, 'Escape');
  assert.equal(p.doc.querySelector('.apv'), null, 'once it is gone, Escape is the popup\'s again');
});

test('focus: the element now holding the opener\'s key, the FIRST opener under a replacing viewer, pulled back into the popup unless a dialog stacked over it took it', async () => {
  await checkRows([
    { name: 'the opener was repainted away: focus goes to the element now holding its focus key', run: async () => {
      const p = page();
      p.opener.focus();
      const v = p.open({ artifact: { kind: 'x', relPath: 'n.txt' } });
      await v.ready;
      const fresh = p.doc.createElement('button');
      fresh.dataset.focusKey = 'row:1';
      p.opener.replaceWith(fresh);
      v.close();
      assert.equal(p.doc.activeElement, fresh);
    } },
    { name: 'a viewer opened over another hands focus back to the first opener', run: async () => {
      const p = page();
      p.opener.removeAttribute('data-focus-key');            // no key fallback: only the inherited opener restores it
      p.opener.focus();
      await p.open({ artifact: { kind: 'x', relPath: 'a.txt' } }).ready;
      const v2 = p.open({ artifact: { kind: 'x', relPath: 'b.txt' } });
      await v2.ready;
      v2.close();
      assert.equal(p.doc.activeElement, p.opener);
    } },
    { name: 'focus that lands outside the popup is pulled back into it', run: async () => {
      const p = page();
      const other = p.doc.createElement('button');
      p.doc.body.appendChild(other);
      p.opener.focus();
      await p.open({ artifact: { kind: 'x', relPath: 'a.txt' } }).ready;
      other.focus();
      assert.ok(p.doc.querySelector('.apv').contains(p.doc.activeElement));
    } },
    { name: 'a confirm dialog stacked over the popup keeps the focus it takes', run: async () => {
      const p = page();
      await p.open({ artifact: { kind: 'x', relPath: 'a.txt' } }).ready;
      const confirm = p.doc.createElement('div');
      confirm.id = 'confirm-modal';
      confirm.className = 'viewer-modal';
      const ok = p.doc.createElement('button');
      confirm.appendChild(ok);
      p.doc.body.appendChild(confirm);
      ok.focus();
      assert.equal(p.doc.activeElement, ok);
    } },
  ]);
});

test('a slow answer for the file left behind never changes the file shown now: a late 413, a late download failure', async () => {
  let release;
  const slow = new Promise((r) => { release = r; });
  const p = page(async (url) => {
    if (url === '/raw/a.png' || url === '/raw/a.png?download=1') { await slow; return { status: 413, body: { error: 'too large' } }; }
    return url.startsWith('/t?') ? { status: 200, body: { text: 'B' } } : null;
  });
  const list = [{ kind: 'x', relPath: 'a.png' }, { kind: 'x', relPath: 'b.txt' }];
  p.open({ artifact: list[0], list });
  tap(p.win, p.doc.querySelector('.apv .apv-dl'));
  press(p.win, p.doc.activeElement, 'ArrowRight');
  await tick(p.win);
  release();
  await tick(p.win);
  const root = p.doc.querySelector('.apv');
  assert.equal(root.querySelector('.apv-title').textContent, 'b.txt');
  assert.equal(root.classList.contains('is-info'), false, 'the stale 413 left the next file alone');
  assert.equal(root.querySelector('.apv-note').hidden, true, 'and so did the stale download failure');
});

test('the --hd-syntax-* tokens are in the :root token block, so highlighted code is coloured wherever it sits', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css.slice(css.indexOf(':root{'), css.indexOf('/* ---------- base reset')), /--hd-syntax-comment:/);
});

// ── refine cycle 2: behaviours the popup claims that the rows above did not pin ──

test('the info view\'s own Download saves the file; ←/→ to a previewable file drops the info layout and the last file\'s download note', async () => {
  const p = page((url) => {
    if (url === '/raw/gone.zip?download=1') return { status: 404, body: {} };
    return url.startsWith('/t?') ? { status: 200, body: { text: 'C' } } : null;
  });
  const saved = [];
  p.win.HTMLAnchorElement.prototype.click = function () { saved.push(this.getAttribute('href')); };
  const list = [{ kind: 'deck', relPath: 'deck/a.pptx' }, { kind: 'x', relPath: 'gone.zip' }, { kind: 'x', relPath: 'c.txt' }];
  await p.open({ artifact: list[0], list }).ready;
  const root = p.doc.querySelector('.apv');
  tap(p.win, root.querySelector('.apv-info-dl'));
  await tick(p.win);
  assert.deepEqual(saved, ['/raw/deck/a.pptx?download=1'], 'the info view\'s button saves the file');
  press(p.win, p.doc.activeElement, 'ArrowRight');
  await tick(p.win);
  tap(p.win, root.querySelector('.apv-info-dl'));
  await tick(p.win);
  assert.equal(root.querySelector('.apv-note').hidden, false);
  assert.equal(root.querySelector('.apv-note').textContent, 'Download failed: File not found');
  press(p.win, p.doc.activeElement, 'ArrowRight');
  await tick(p.win);
  assert.equal(root.querySelector('.apv-title').textContent, 'c.txt');
  assert.equal(root.classList.contains('is-info'), false, 'a previewable file is not shown on the full-window info layout');
  assert.equal(root.querySelector('.apv-note').hidden, true, 'the last file\'s download failure stays with that file');
  assert.equal(root.querySelector('.apv-stage pre.artifact-text').textContent, 'C');
});

test('Full screen toggles back to aria-pressed=false and its own title; leaving the browser\'s full screen (Esc) returns the popup to its card', async () => {
  const p = page();
  await p.open({ artifact: { kind: 'x', relPath: 'notes.txt' } }).ready;
  const root = p.doc.querySelector('.apv');
  const btn = root.querySelector('.apv-full');
  tap(p.win, btn);
  assert.equal(btn.title, 'Exit full screen');
  tap(p.win, btn);
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
  assert.equal(btn.title, 'Full screen');
  let fsEl = null;
  Object.defineProperty(p.doc, 'fullscreenElement', { configurable: true, get: () => fsEl });
  p.win.HTMLElement.prototype.requestFullscreen = function () { fsEl = this; return Promise.resolve(); };
  tap(p.win, btn);
  assert.equal(fsEl, root.querySelector('.apv-card'));
  fsEl = null;                                            // the browser's own Esc: no keydown reaches the page
  p.doc.dispatchEvent(new p.win.Event('fullscreenchange'));
  assert.equal(root.classList.contains('is-full'), false, 'the window fill follows the browser out');
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
  assert.equal(btn.getAttribute('aria-label'), 'Full screen');
});

test('Tab never wraps onto a disabled arrow at an end of the list; Shift+Tab from the dialog itself goes to the last stop', async () => {
  const p = page((url) => (url.startsWith('/t?') ? { status: 200, body: { text: 'x' } } : null));
  const list = [{ kind: 'x', relPath: 'a.txt' }, { kind: 'x', relPath: 'b.txt' }];
  await p.open({ artifact: list[0], list }).ready;
  const card = p.doc.querySelector('.apv .apv-card');
  const stage = card.querySelector('.apv-body');
  assert.equal(p.doc.activeElement, card, 'the dialog holds the focus on open');
  press(p.win, card, 'Tab', { shiftKey: true });
  assert.equal(p.doc.activeElement, stage, 'Shift+Tab from the dialog: the last stop');
  press(p.win, stage, 'Tab');
  assert.equal(p.doc.activeElement, card.querySelector('.apv-next'), 'the first ENABLED stop: Previous is disabled on the first file');
});

test('Tab out of a framed preview (its keys never reach the page) lands on the wrap-around stop and goes round to the first control', async () => {
  const p = page();
  await p.open({ artifact: { kind: 'deck', relPath: 'deck/deck.html' } }).ready;
  const card = p.doc.querySelector('.apv .apv-card');
  const wrap = card.querySelector('.apv-wrap');
  assert.equal(wrap.tabIndex, 0, 'after the preview, a stop of its own');
  assert.equal(wrap.previousElementSibling, card.querySelector('.apv-body'));
  wrap.focus();
  assert.equal(p.doc.activeElement, card.querySelector('.apv-dl'), 'one file: Download is the first control');
  const frame = card.querySelector('iframe');
  frame.focus();
  press(p.win, frame, 'Tab');
  assert.equal(p.doc.activeElement, card.querySelector('.apv-dl'), 'the trap\'s last stop is the frame, never the wrap stop');
});

test('a Stop warning or a native <dialog> stacked over the popup owns Escape and keeps the focus it takes', async () => {
  const stackers = {
    'the Stop warning': (doc) => { const d = doc.createElement('div'); d.id = 'stop-modal'; d.className = 'viewer-modal'; return d; },
    'a native <dialog open>': (doc) => { const d = doc.createElement('dialog'); d.setAttribute('open', ''); return d; },
  };
  await checkRows(Object.entries(stackers).map(([name, make]) => ({ name, run: async () => {
    const p = page();
    await p.open({ artifact: { kind: 'x', relPath: 'a.txt' } }).ready;
    const over = make(p.doc);
    const ok = p.doc.createElement('button');
    over.appendChild(ok);
    p.doc.body.appendChild(over);
    ok.focus();
    assert.equal(p.doc.activeElement, ok, 'the focus keeper leaves it there');
    press(p.win, ok, 'Escape');
    assert.ok(p.doc.querySelector('.apv'), 'its Escape is not the popup\'s');
  } })));
});

test('an arrow with Alt, Ctrl, Meta or Shift is the browser\'s (Back, word and selection moves), never a file step', async () => {
  const p = page((url) => (url.startsWith('/t?') ? { status: 200, body: { text: 'x' } } : null));
  const list = [{ kind: 'x', relPath: 'a.txt' }, { kind: 'x', relPath: 'b.txt' }];
  await p.open({ artifact: list[0], list }).ready;
  const card = p.doc.querySelector('.apv .apv-card');
  for (const mod of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
    const e = new p.win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true, [mod]: true });
    card.dispatchEvent(e);
    await tick(p.win);
    assert.equal(p.doc.querySelector('.apv .apv-title').textContent, 'a.txt', mod);
    assert.equal(e.defaultPrevented, false, mod);
  }
});

test('the info view, the title tooltip and a player\'s label never show a home directory, POSIX or Windows', async () => {
  assert.equal(displayPath('C:\\Users\\me\\.worca-cc\\run\\plan.md'), 'plan.md');
  for (const path of ['/Users/me/.worca-cc/runs/p/run1/deck/deck.pptx', 'C:\\Users\\me\\.worca-cc\\runs\\p\\run1\\deck\\deck.pptx']) {
    const p = page();
    await p.open({ artifact: { kind: 'deck', path } }).ready;
    const root = p.doc.querySelector('.apv');
    const facts = Object.fromEntries([...root.querySelectorAll('.apv-facts dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]));
    assert.equal(facts.Path, 'deck.pptx', path);
    assert.equal(root.querySelector('.apv-title').title, 'deck.pptx', path);
  }
  const v = page();
  await v.open({ artifact: { kind: 'clip', path: 'C:\\Users\\me\\.worca-cc\\runs\\p\\run1\\media\\c.webm' } }).ready;
  assert.equal(v.doc.querySelector('.apv video').getAttribute('aria-label'), 'c.webm');
  const img = page();
  await img.open({ artifact: { kind: 'shot', path: '/Users/me/.worca-cc/runs/p/run1/shots/s1.png' } }).ready;
  assert.equal(img.doc.querySelector('.apv img').getAttribute('alt'), 's1.png', 'an image\'s alt text too');
});

test('a raw preview whose request fails outright says "Could not load", never a broken frame', async () => {
  const p = page((url) => { if (url.startsWith('/raw/')) throw new Error('offline'); return null; });
  await p.open({ artifact: { kind: 'shot', relPath: 'shots/s1.png' } }).ready;
  assert.equal(p.doc.querySelector('.apv .apv-error').textContent, 'Could not load');
  assert.equal(p.doc.querySelector('.apv img'), null);
});

test('the opened file is found in the list by its path when the caller hands an equal copy', async () => {
  const p = page((url) => (url.startsWith('/t?') ? { status: 200, body: { text: 'x' } } : null));
  const list = [{ kind: 'x', relPath: 'a.txt' }, { kind: 'x', relPath: 'b.txt' }, { kind: 'x', relPath: 'c.txt' }];
  await p.open({ artifact: { ...list[1] }, list }).ready;
  assert.equal(p.doc.querySelector('.apv .apv-pos').textContent, '2 / 3');
});

test('tsv is a table split on tabs; a csv past its byte cap and code past the highlight byte cap stay plain text', async () => {
  const { CSV_MAX_BYTES } = await import('../ui/public/artifacts/common.mjs');
  const { MAX_HIGHLIGHT_INPUT_BYTES } = await import('../ui/public/syntax-highlight.mjs');
  assert.ok(parseDelimited(Array.from({ length: CSV_MAX_ROWS }, (_, i) => String(i)).join('\n')), 'exactly at the row cap: still a table');
  const t = mountIn();
  await renderPreview({ kind: null, relPath: 'data/t.tsv', text: 'a\tb\n1\t2\n' }, t, {});
  assert.deepEqual([...t.querySelectorAll('thead th')].map((x) => x.textContent), ['a', 'b']);
  assert.deepEqual([...t.querySelectorAll('tbody td')].map((x) => x.textContent), ['1', '2']);
  assert.equal(t.querySelector('thead th').getAttribute('scope'), 'col');
  const big = mountIn();
  await renderPreview({ kind: null, relPath: 'data/big.csv', text: `h1,h2\n${'x'.repeat(CSV_MAX_BYTES)},y\n` }, big, {});
  assert.ok(big.classList.contains('kind-text'), 'two rows, but past the byte cap: text');
  assert.equal(big.querySelector('table'), null);
  const loader = fakeLoader();
  const min = mountIn();
  await renderPreview({ kind: null, relPath: 'dist/app.min.js', text: `var a=${'1'.repeat(MAX_HIGHLIGHT_INPUT_BYTES)};` }, min, { hljsLoader: loader });
  assert.deepEqual(loader.asked, [], 'one huge line: the grammar is never loaded');
  assert.equal(min.querySelector('span'), null);
});

test('a row with no size (a live run\'s row) is sized by a HEAD on the download form before its text is pulled', async () => {
  await checkRows([
    { name: 'past the 2 MB text ceiling: the info view, the size in the header, no GET', run: async () => {
      const p = page();
      const headOf = (n) => async (url, opts = {}) => {
        p.calls.push(`${opts.method || 'GET'} ${url}`);
        return { ok: true, status: 200, headers: { get: (k) => (k.toLowerCase() === 'content-length' ? String(n) : null) }, json: async () => ({}) };
      };
      await openArtifactViewer({ doc: p.doc, win: p.win, fetch: headOf(3 * 1024 * 1024), urls: URLS, artifact: { kind: 'log', relPath: 'logs/big.log' } }).ready;
      const root = p.doc.querySelector('.apv');
      assert.equal(root.querySelector('.apv-info-note').textContent, 'Too large to preview');
      assert.equal(root.querySelector('.apv-meta').textContent, '3.0 MB', 'the size the HEAD found');
      assert.deepEqual(p.calls, ['HEAD /raw/logs/big.log?download=1'], 'the whole file is never pulled');
    } },
    { name: 'inside the ceiling it previews; a row that carries its size is never probed', run: async () => {
      const p = page((url, method) => (method === 'GET' && url.startsWith('/t?') ? { status: 200, body: { text: 'ok' } } : null));
      await p.open({ artifact: { kind: 'log', relPath: 'logs/small.log' } }).ready;
      assert.deepEqual(p.calls, ['HEAD /raw/logs/small.log?download=1', 'GET /t?rel=logs%2Fsmall.log']);
      assert.equal(p.doc.querySelector('.apv .apv-stage pre').textContent, 'ok');
      const q = page((url, method) => (method === 'GET' && url.startsWith('/t?') ? { status: 200, body: { text: 'ok' } } : null));
      await q.open({ artifact: { kind: 'log', relPath: 'logs/small.log', bytes: 2 } }).ready;
      assert.deepEqual(q.calls, ['GET /t?rel=logs%2Fsmall.log']);
    } },
  ]);
});

test('bytes no kind table names (a NUL in the text) and a text route that refuses (413/415) open the info view; a player that cannot play says so', async () => {
  await checkRows([
    { name: 'decoded bytes are not a preview', run: async () => {
      const p = page((url, method) => (method === 'GET' && url.startsWith('/t?') ? { status: 200, body: { text: `PK${String.fromCharCode(0)}junk` } } : null));
      await p.open({ artifact: { kind: 'model', relPath: 'out/model.pkl', bytes: 12 } }).ready;
      const root = p.doc.querySelector('.apv');
      assert.ok(root.classList.contains('is-info'));
      assert.equal(root.querySelector('.apv-info-note').textContent, 'No preview for this file type');
      assert.equal(root.querySelector('pre'), null, 'no page of junk');
    } },
    { name: 'a 413 or 415 from the text route', run: async () => {
      for (const [status, note] of [[413, 'Too large to preview'], [415, 'No preview for this file type']]) {
        const p = page((url, method) => (method === 'GET' && url.startsWith('/t?') ? { status, body: { error: 'x' } } : null));
        await p.open({ artifact: { kind: 'plan', relPath: 'plans/p.md', bytes: 10 } }).ready;
        assert.equal(p.doc.querySelector('.apv .apv-info-note').textContent, note, String(status));
      }
    } },
    { name: 'a media file the browser cannot decode', run: async () => {
      const p = page();
      await p.open({ artifact: { kind: 'clip', relPath: 'media/c.mp4' } }).ready;
      const video = p.doc.querySelector('.apv video');
      assert.ok(video);
      video.dispatchEvent(new p.win.Event('error'));
      const root = p.doc.querySelector('.apv');
      assert.ok(root.classList.contains('is-info'), 'not a dead black player');
      assert.equal(root.querySelector('.apv-info-note').textContent, 'No preview for this file type');
      assert.ok(root.querySelector('.apv-info-dl'), 'Download is still offered');
    } },
  ]);
});

test('closing after the opener was repainted away with no focus key: its twin in the nearest ancestor left, else that ancestor\'s first stop — never <body>', async () => {
  await checkRows([
    { name: 'the same line, repainted', run: async () => {
      const p = page();
      const pane = p.doc.createElement('div');
      pane.innerHTML = '<a class="log-artifact" href="#">first.md</a><a class="log-artifact" href="#">result.diff</a>';
      p.doc.body.appendChild(pane);
      pane.lastElementChild.focus();
      const v = p.open({ artifact: { kind: 'x', relPath: 'result.diff' } });
      await v.ready;
      pane.innerHTML = '<a class="log-artifact" href="#">first.md</a><a class="log-artifact" href="#">result.diff</a>';
      v.close();
      assert.equal(p.doc.activeElement, pane.lastElementChild, 'the repainted twin');
    } },
    { name: 'gone for good', run: async () => {
      const p = page();
      const pane = p.doc.createElement('div');
      pane.innerHTML = '<button>older</button><a class="chip" href="#">plan.md</a>';
      p.doc.body.appendChild(pane);
      pane.querySelector('.chip').focus();
      const v = p.open({ artifact: { kind: 'x', relPath: 'plan.md' } });
      await v.ready;
      pane.querySelector('.chip').remove();
      v.close();
      assert.equal(p.doc.activeElement, pane.querySelector('button'), 'the first stop left in its pane');
    } },
  ]);
});

// ── killer rows for v3's new lines (review cycle 3) ──────────────────────────
/** A fetch whose HEAD answers `head(url)` → {ok, status, length} | Error, and whose GETs answer `get(url)` → {status, body}. */
function headFetch(p, head, get = () => ({ status: 200, body: { text: 'ok' } })) {
  return async (url, opts = {}) => {
    const method = opts.method || 'GET';
    p.calls.push(`${method} ${url}`);
    if (method === 'HEAD') {
      const h = await head(String(url));
      if (h instanceof Error) throw h;
      return { ok: h.ok, status: h.status, headers: { get: (k) => (k.toLowerCase() === 'content-length' && h.length != null ? String(h.length) : null) }, json: async () => ({}) };
    }
    const r = await get(String(url));
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
}

test('a HEAD that fails sizes nothing: never the error body\'s length, never "0 B"; an empty meta line is hidden', async () => {
  await checkRows([
    { name: 'a 404 HEAD that carries a Content-Length', run: async () => {
      const p = page();
      await openArtifactViewer({ doc: p.doc, win: p.win, fetch: headFetch(p, () => ({ ok: false, status: 404, length: 31 })), urls: URLS, artifact: { kind: 'log', relPath: 'logs/a.log' } }).ready;
      const meta = p.doc.querySelector('.apv .apv-meta');
      assert.equal(meta.textContent, '');
      assert.equal(meta.hidden, true);
      assert.equal(p.doc.querySelector('.apv .apv-stage pre').textContent, 'ok');
    } },
    { name: 'a HEAD that throws', run: async () => {
      const p = page();
      await openArtifactViewer({ doc: p.doc, win: p.win, fetch: headFetch(p, () => new Error('offline')), urls: URLS, artifact: { kind: 'log', relPath: 'logs/a.log' } }).ready;
      assert.equal(p.doc.querySelector('.apv .apv-meta').textContent, '');
      assert.equal(p.doc.querySelector('.apv .apv-stage pre').textContent, 'ok');
    } },
  ]);
});

test('the info view of a row sized by the HEAD lists that size; a NUL past the first 8 KB is still text', async () => {
  const p = page();
  await openArtifactViewer({ doc: p.doc, win: p.win, fetch: headFetch(p, () => ({ ok: true, status: 200, length: 3 * 1024 * 1024 })), urls: URLS, artifact: { kind: 'log', relPath: 'logs/big.log' } }).ready;
  const facts = Object.fromEntries([...p.doc.querySelectorAll('.apv .apv-facts dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]));
  assert.equal(facts.Size, '3.0 MB');
  const late = `${'a'.repeat(9000)}${String.fromCharCode(0)}tail`;
  const q = page((url, method) => (method === 'GET' && url.startsWith('/t?') ? { status: 200, body: { text: late } } : null));
  await q.open({ artifact: { kind: 'log', relPath: 'logs/late.log', bytes: late.length } }).ready;
  assert.equal(q.doc.querySelector('.apv').classList.contains('is-info'), false);
  assert.equal(q.doc.querySelector('.apv .apv-stage pre').textContent, late);
});

test('a size still being asked for the file left behind never lands on the file shown now', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const p = page();
  const fetch = headFetch(p, async (url) => {
    if (url.includes('big.log')) { await gate; return { ok: true, status: 200, length: 3 * 1024 * 1024 }; }
    return { ok: true, status: 200, length: 1 };
  }, () => ({ status: 200, body: { text: 'B' } }));
  const list = [{ kind: 'log', relPath: 'logs/big.log' }, { kind: 'x', relPath: 'b.txt', bytes: 1 }];
  openArtifactViewer({ doc: p.doc, win: p.win, fetch, urls: URLS, artifact: list[0], list, metaFor: (a) => ({ step: a.relPath === 'b.txt' ? 'Tester' : 'Builder' }) });
  press(p.win, p.doc.activeElement, 'ArrowRight');
  await tick(p.win);
  release();
  await tick(p.win);
  const root = p.doc.querySelector('.apv');
  assert.equal(root.querySelector('.apv-title').textContent, 'b.txt');
  assert.equal(root.querySelector('.apv-meta').textContent, 'Tester · 1 B', 'the old file\'s step and size never come back');
  assert.equal(root.classList.contains('is-info'), false, 'nor its "Too large" layout');
  assert.equal(root.querySelector('.apv-stage').textContent, 'B');
});

test('an audio file the browser cannot decode opens the info view too; a late error from a player left behind changes nothing', async () => {
  await checkRows([
    { name: 'audio', run: async () => {
      const p = page();
      await p.open({ artifact: { kind: 'narration', relPath: 'deck/n.mp3' } }).ready;
      p.doc.querySelector('.apv audio').dispatchEvent(new p.win.Event('error'));
      const root = p.doc.querySelector('.apv');
      assert.ok(root.classList.contains('is-info'));
      assert.equal(root.querySelector('.apv-info-note').textContent, 'No preview for this file type');
    } },
    { name: 'a stale player', run: async () => {
      const p = page((url, method) => (method === 'GET' && url.startsWith('/t?') ? { status: 200, body: { text: 'T' } } : null));
      const list = [{ kind: 'clip', relPath: 'media/c.mp4' }, { kind: 'x', relPath: 'b.txt', bytes: 1 }];
      await p.open({ artifact: list[0], list }).ready;
      const video = p.doc.querySelector('.apv video');
      press(p.win, p.doc.activeElement, 'ArrowRight');
      await tick(p.win);
      video.dispatchEvent(new p.win.Event('error'));
      const root = p.doc.querySelector('.apv');
      assert.equal(root.classList.contains('is-info'), false);
      assert.equal(root.querySelector('.apv-stage').textContent, 'T');
    } },
  ]);
});

test('a c4 preview\'s label never shows a home directory, Windows paths included', async () => {
  const p = page((url, method) => (method === 'GET' && url.startsWith('/t?') ? { status: 200, body: { text: 'specification {}' } } : null));
  p.win.dagre = {};
  p.win.customElements.define('worca-c4', class extends p.win.HTMLElement { load() {} });
  await p.open({ artifact: { kind: 'c4', path: 'C:\\Users\\me\\.worca-cc\\runs\\p\\r1\\arch\\model.c4', bytes: 16 } }).ready;
  assert.equal(p.doc.querySelector('.apv worca-c4').getAttribute('aria-label'), 'C4 diagram: model.c4');
});

test('closing after a repaint, more cases: a replacing viewer keeps the first opener\'s pane; the twin matches tag, class AND text; the nearest pane still on the page', async () => {
  const twinRun = (html, pick, repaint) => async () => {
    const p = page();
    const wrap = p.doc.createElement('div');
    wrap.innerHTML = html;
    p.doc.body.appendChild(wrap);
    pick(wrap).focus();
    const v = p.open({ artifact: { kind: 'x', relPath: 'plan.md' } });
    await v.ready;
    const want = repaint(wrap);
    v.close();
    assert.equal(p.doc.activeElement, want);
  };
  await checkRows([
    { name: 'a viewer that replaced another', run: async () => {
      const p = page();
      const pane = p.doc.createElement('div');
      const html = '<button>older</button><a class="log-artifact" href="#">first.md</a><a class="log-artifact" href="#">result.diff</a>';
      pane.innerHTML = html;
      p.doc.body.appendChild(pane);
      pane.lastElementChild.focus();
      await p.open({ artifact: { kind: 'x', relPath: 'result.diff' } }).ready;
      const v2 = p.open({ artifact: { kind: 'x', relPath: 'first.md' } });
      await v2.ready;
      pane.innerHTML = html;
      v2.close();
      assert.equal(p.doc.activeElement, pane.lastElementChild, 'the first opener\'s twin, found in ITS pane');
    } },
    { name: 'tag, class and text', run: twinRun(
      '<div class="pane"><button class="log-artifact">plan.md</button><a class="chip" href="#">plan.md</a><a class="log-artifact" href="#">plan.md</a></div>',
      (w) => w.querySelector('a.log-artifact'),
      (w) => { const pane = w.querySelector('.pane'); pane.innerHTML = pane.innerHTML; return pane.querySelector('a.log-artifact'); }) },
    { name: 'the line\'s own wrapper went with it', run: twinRun(
      '<div class="pane"><div class="line"><a class="log-artifact" href="#">a.md</a></div><div class="line"><a class="log-artifact" href="#">plan.md</a></div></div>',
      (w) => w.querySelectorAll('a')[1],
      (w) => { const pane = w.querySelector('.pane'); pane.innerHTML = pane.innerHTML; return pane.querySelectorAll('a')[1]; }) },
    { name: 'the NEAREST pane, not the first twin on the page', run: twinRun(
      '<div class="pane a"><a class="log-artifact" href="#">plan.md</a></div><div class="pane b"><a class="log-artifact" href="#">plan.md</a></div>',
      (w) => w.querySelector('.b a'),
      (w) => { const pane = w.querySelector('.b'); pane.innerHTML = pane.innerHTML; return pane.querySelector('a'); }) },
    { name: 'the keyed element wins even when its text changed', run: async () => {
      const p = page();
      const pane = p.doc.createElement('div');
      pane.innerHTML = '<button>other</button><button data-focus-key="f:k|plan.md">plan.md 2.0 KB</button>';
      p.doc.body.appendChild(pane);
      pane.lastElementChild.focus();
      const v = p.open({ artifact: { kind: 'x', relPath: 'plan.md' } });
      await v.ready;
      pane.innerHTML = '<button>other</button><button data-focus-key="f:k|plan.md">plan.md 2.1 KB</button>';
      v.close();
      assert.equal(p.doc.activeElement, pane.lastElementChild);
    } },
    { name: 'the first stop skips disabled and hidden ones, without scrolling the page', run: async () => {
      const p = page();
      const pane = p.doc.createElement('div');
      pane.innerHTML = '<button disabled>a</button><div hidden><button>b</button></div><button class="c">c</button><a class="chip" href="#">plan.md</a>';
      p.doc.body.appendChild(pane);
      pane.querySelector('.chip').focus();
      const v = p.open({ artifact: { kind: 'x', relPath: 'plan.md' } });
      await v.ready;
      pane.querySelector('.chip').remove();
      const c = pane.querySelector('.c');
      const seen = [];
      const own = c.focus;
      c.focus = function focus(o) { seen.push(o); return own.call(this, o); };
      v.close();
      assert.equal(p.doc.activeElement, c);
      assert.deepEqual(seen, [{ preventScroll: true }]);
    } },
    { name: 'an opener with no pane left at all: close() still closes, without throwing', run: async () => {
      const p = page();
      const b = p.doc.createElement('button');
      b.textContent = 'x';
      p.doc.body.appendChild(b);
      b.focus();
      const v = p.open({ artifact: { kind: 'x', relPath: 'plan.md' } });
      await v.ready;
      b.remove();
      assert.doesNotThrow(() => v.close());
      assert.equal(p.doc.querySelector('.apv'), null);
    } },
  ]);
});

// ── defects found in review cycle 3 (failing before the fix) ─────────────────
test('stepping onto an end of the list with the arrow BUTTON keeps the focus in the popup (a browser drops a disabled control\'s focus to <body>)', async () => {
  const p = page((url) => (url.startsWith('/t?') ? { status: 200, body: { text: 'x' } } : null));
  const list = [{ kind: 'x', relPath: 'a.txt', bytes: 1 }, { kind: 'x', relPath: 'b.txt', bytes: 1 }];
  await p.open({ artifact: list[0], list }).ready;
  const next = p.doc.querySelector('.apv .apv-next');
  next.focus();
  tap(p.win, next);
  await tick(p.win);
  assert.equal(next.disabled, true);
  assert.equal(p.doc.activeElement, p.doc.querySelector('.apv .apv-prev'), 'the other arrow, never the disabled one');
});

test('closing after a repaint: of several identical lines (a file a log names once per cycle) the one that was opened', async () => {
  const p = page();
  const pane = p.doc.createElement('div');
  const html = '<a class="log-artifact" href="#">plan.md</a><a class="log-artifact" href="#">plan.md</a><a class="log-artifact" href="#">plan.md</a>';
  pane.innerHTML = html;
  p.doc.body.appendChild(pane);
  pane.children[1].focus();
  const v = p.open({ artifact: { kind: 'x', relPath: 'plan.md' } });
  await v.ready;
  pane.innerHTML = html;
  v.close();
  assert.equal([...pane.children].indexOf(p.doc.activeElement), 1);
});

test('closing after a repaint: the opener\'s focus key is looked up around the opener first, never in another (hidden) screen', async () => {
  const p = page();
  p.doc.body.insertAdjacentHTML('beforeend', '<section id="rd" class="hidden"><button data-focus-key="f:n:a|plan.md">plan.md</button></section>'
    + '<section id="hd"><div class="pane"><button data-focus-key="f:n:a|plan.md">plan.md</button></div></section>');
  p.doc.querySelector('#hd button').focus();
  const v = p.open({ artifact: { kind: 'x', relPath: 'plan.md' } });
  await v.ready;
  p.doc.querySelector('#hd .pane').innerHTML = '<button data-focus-key="f:n:a|plan.md">plan.md 1 B</button>';
  v.close();
  assert.equal(p.doc.activeElement, p.doc.querySelector('#hd button'));
});

test('a double click on Download saves the file once', async () => {
  const p = page((url) => (url.startsWith('/t?') ? { status: 200, body: { text: 'x' } } : null));
  await p.open({ artifact: { kind: 'x', relPath: 'a.txt', bytes: 1 } }).ready;
  p.calls.length = 0;
  const b = p.doc.querySelector('.apv .apv-dl');
  tap(p.win, b, 1);
  tap(p.win, b, 2);
  await tick(p.win);
  assert.deepEqual(p.calls, ['HEAD /raw/a.txt?download=1']);
});

test('a cut name never splits a character in two; a csv saved with a byte-order mark reads its quoted header', () => {
  const name = `${'a'.repeat(25)}${String.fromCodePoint(0x1F600).repeat(20)}.png`;
  const cut = midTruncate(name);
  assert.ok(cut.endsWith('.png') && cut.includes('…'), cut);
  assert.equal(cut.toWellFormed(), cut, 'no lone surrogate');
  assert.ok(Array.from(cut).length <= 44);
  assert.deepEqual(parseDelimited(`${String.fromCharCode(0xFEFF)}"Name","Age"\r\n"Ann",3\r\n`), [['Name', 'Age'], ['Ann', '3']]);
});

test('Tab reaches the controls a preview keeps in a shadow root (the c4 viewer\'s stage, View select, Zoom and Download JPEG)', async () => {
  const p = page((url, method) => (method === 'GET' && url.startsWith('/t?') ? { status: 200, body: { text: 'specification {}' } } : null));
  p.win.dagre = {};
  if (!p.win.customElements.get('worca-c4')) p.win.customElements.define('worca-c4', class extends p.win.HTMLElement {
    load() {
      const r = this.attachShadow({ mode: 'open' });
      r.innerHTML = '<div class="stage" tabindex="0"><select aria-label="View"><option>v</option></select><button aria-label="Zoom in">+</button></div>';
    }
  });
  await p.open({ artifact: { kind: 'c4', relPath: 'arch/model.c4', bytes: 16 } }).ready;
  const card = p.doc.querySelector('.apv .apv-card');
  const shadow = card.querySelector('worca-c4').shadowRoot;
  const tab = (el, shiftKey = false) => { const e = new p.win.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, composed: true, shiftKey }); el.dispatchEvent(e); return e; };
  const body = card.querySelector('.apv-body');
  body.focus();
  assert.equal(tab(body).defaultPrevented, false, 'Tab from the preview region goes on into the diagram');
  const zoom = shadow.querySelector('button');
  zoom.focus();
  tab(zoom);
  assert.equal(p.doc.activeElement, card.querySelector('.apv-dl'), 'past the diagram\'s last control: round to the first');
  tab(p.doc.activeElement, true);
  assert.equal(shadow.activeElement, zoom, 'Shift+Tab from the first control: the diagram\'s last one');
});

// ── refine cycle 3 ──
test('the info view\'s Download keeps its name when a narrow screen hides its text', async () => {
  const p = page();
  await p.open({ artifact: { kind: 'deck', relPath: 'deck/deck.pptx', bytes: 9 } }).ready;
  assert.equal(p.doc.querySelector('.apv .apv-info-dl').getAttribute('aria-label'), 'Download');
});

test('a pdf is framed from the raw route in an <embed>', async () => {
  const p = page();
  await p.open({ artifact: { kind: 'deck', relPath: 'deck/deck.pdf', bytes: 9 } }).ready;
  assert.equal(p.doc.querySelector('.apv embed').getAttribute('src'), '/raw/deck/deck.pdf');
  assert.ok(p.calls.includes('HEAD /raw/deck/deck.pdf'), 'probed before framing');
});

test('closing after a repaint: a pane left with no control at all hands the focus to the next ancestor up, never <body>', async () => {
  const p = page();
  const sec = p.doc.createElement('section');
  sec.innerHTML = '<input class="log-search" aria-label="Filter"><div class="log"><div class="log-line"><a class="log-artifact" href="#">a.md</a></div></div>';
  p.doc.body.appendChild(sec);
  sec.querySelector('.log-artifact').focus();
  const v = p.open({ artifact: { kind: 'x', relPath: 'a.md' } });
  await v.ready;
  sec.querySelector('.log').replaceChildren();          // the log's filter now shows nothing
  v.close();
  assert.equal(p.doc.activeElement, sec.querySelector('.log-search'));
});

test('CONTRACT §7 `meta` names the opened file even when the list holds an equal copy of it', async () => {
  const p = page();
  const list = [{ kind: 'x', relPath: 'a.md', bytes: 1 }, { kind: 'x', relPath: 'b.md', bytes: 1 }];
  await p.open({ artifact: { kind: 'x', relPath: 'b.md', bytes: 1 }, list, meta: { step: 'Planner', cycle: 2 } }).ready;
  const root = p.doc.querySelector('.apv');
  assert.equal(root.querySelector('.apv-pos').textContent, '2 / 2');
  assert.equal(root.querySelector('.apv-meta').textContent, 'Planner · cycle 2 · 1 B');
});

test('UTF-16 text (a byte-order mark; Windows PowerShell writes it) previews as text; other bytes with a NUL do not, and cost no extra request', async () => {
  const NUL = String.fromCharCode(0);
  const FFFD = String.fromCharCode(0xfffd);
  const run = async (text, bytes) => {
    const p = page();
    const fetch = async (url, opts = {}) => {
      const method = opts.method || 'GET';
      p.calls.push(`${method} ${url}`);
      if (url.startsWith('/t?')) return { ok: true, status: 200, json: async () => ({ text }) };
      return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => Uint8Array.from(bytes).buffer };
    };
    await openArtifactViewer({ doc: p.doc, win: p.win, fetch, urls: URLS, artifact: { kind: 'log', relPath: 'out/run.txt', bytes: bytes.length } }).ready;
    return p;
  };
  const le = await run(`${FFFD}${FFFD}H${NUL}i${NUL}`, [0xff, 0xfe, 0x48, 0, 0x69, 0]);
  assert.equal(le.doc.querySelector('.apv .apv-stage pre').textContent, 'Hi', 'UTF-16LE');
  assert.deepEqual(le.calls, ['GET /t?rel=out%2Frun.txt', 'GET /raw/out/run.txt?download=1'], 'the bytes from the download form');
  const be = await run(`${FFFD}${FFFD}${NUL}H${NUL}i`, [0xfe, 0xff, 0, 0x48, 0, 0x69]);
  assert.equal(be.doc.querySelector('.apv .apv-stage pre').textContent, 'Hi', 'UTF-16BE');
  const junk = await run(`${FFFD}${FFFD}${NUL}x`, [0x80, 0x81, 0, 0x78]);
  assert.equal(junk.doc.querySelector('.apv .apv-info-note').textContent, 'No preview for this file type', 'no mark: bytes');
  const pkl = await run(`${FFFD}${String.fromCharCode(4)}${NUL}x`, [0x80, 4, 0, 0x78]);
  assert.equal(pkl.doc.querySelector('.apv .apv-info-note').textContent, 'No preview for this file type');
  assert.deepEqual(pkl.calls, ['GET /t?rel=out%2Frun.txt'], 'bytes that cannot be UTF-16 are never fetched twice');
});

test('the HEAD that clears an image also sizes a row that came without one', async () => {
  const p = page();
  const fetch = async (url, opts = {}) => {
    p.calls.push(`${opts.method || 'GET'} ${url}`);
    return { ok: true, status: 200, headers: { get: (k) => (k.toLowerCase() === 'content-length' ? '2048' : null) }, json: async () => ({}) };
  };
  await openArtifactViewer({ doc: p.doc, win: p.win, fetch, urls: URLS, artifact: { kind: 'shot', relPath: 'shots/s1.png' }, meta: { step: 'Audit' } }).ready;
  assert.equal(p.doc.querySelector('.apv .apv-meta').textContent, 'Audit · 2.0 KB');
  assert.deepEqual(p.calls, ['HEAD /raw/shots/s1.png'], 'one request');
});

test('routeKeyOf reads the run after the thread id, whatever the thread is called; a run page is its run', async () => {
  const { routeKeyOf } = await import('../ui/public/artifacts/viewer.mjs');
  const at = (hash) => routeKeyOf({ location: { hash } });
  assert.equal(at('#chat/run/run/r1/logs'), 'chat|r1');
  assert.notEqual(at('#chat/run/run/r1'), at('#chat/run/run/r2'));
  assert.equal(at('#chat/ask_00000001/run/r1/artifacts'), 'chat|r1');
  assert.equal(at('#running/r1/details/artifacts'), 'running|r1');
  assert.equal(at('#running/r1'), at('#running/r1/details/logs'), 'a run page is its run: the glance and every Details tab');
  assert.notEqual(at('#running/r1'), at('#running/r2'));
  assert.equal(at('#history/proj-1/p1/details/artifacts'), 'history|proj-1/p1');
  assert.equal(at('#history/proj-1/p1'), at('#history/proj-1/p1/details'));
  assert.equal(at('#history/workspaces/wks-1/r9/details/diff'), 'history|workspaces/wks-1/r9');
  assert.notEqual(at('#history/workspaces/wks-1/r9'), at('#history/workspaces/wks-2/r9'), 'a workspace run is keyed by its workspace too');
  assert.equal(at('#workflows/wf_1'), 'workflows', 'any other page is its view');
});

// ── refine cycle 4 ──
test('closing after a Back hid the opener\'s screen: a focus that does not take is skipped — where the page put the focus, else the next control that takes it', async () => {
  await checkRows([
    { name: 'the page focused its new screen\'s title while the popup was open', run: async () => {
      const p = page();
      p.doc.body.insertAdjacentHTML('beforeend', '<main><h1 class="title" tabindex="-1">Run</h1><section class="details"><button class="row" data-focus-key="f:n:a|plan.md">plan.md</button></section></main>');
      const row = p.doc.querySelector('.row');
      row.focus();
      const v = p.open({ artifact: { kind: 'x', relPath: 'plan.md' } });
      await v.ready;
      p.doc.querySelector('.details').hidden = true;              // Back to the glance: Details is hidden, the row with it
      row.focus = () => {};                                         // and a browser will not focus it there
      const h1 = p.doc.querySelector('.title');
      h1.focus();                                                   // the route change focuses the glance's title
      assert.ok(p.doc.querySelector('.apv').contains(p.doc.activeElement), 'the popup keeps the focus while it is open');
      v.close();
      assert.equal(p.doc.activeElement, h1);
    } },
    { name: 'nothing focused by the page: the first control that takes the focus, past one that does not', run: async () => {
      const p = page();
      p.doc.body.insertAdjacentHTML('beforeend', '<main><button class="back">Back</button><button class="next">Logs</button><section class="details"><button class="row">plan.md</button></section></main>');
      const row = p.doc.querySelector('.row');
      row.focus();
      const v = p.open({ artifact: { kind: 'x', relPath: 'plan.md' } });
      await v.ready;
      p.doc.querySelector('.details').hidden = true;
      row.focus = () => {};
      p.doc.querySelector('.back').focus = () => {};               // a back link the layout hides: refused too
      v.close();
      assert.equal(p.doc.activeElement, p.doc.querySelector('.next'));
    } },
    { name: 'a row repainted under its focus key wins over where the page put the focus', run: async () => {
      const p = page();
      p.doc.body.insertAdjacentHTML('beforeend', '<main><input class="answer"><section class="list"><button class="row" data-focus-key="f:n:a|plan.md">plan.md</button></section></main>');
      p.doc.querySelector('.row').focus();
      const v = p.open({ artifact: { kind: 'x', relPath: 'plan.md' } });
      await v.ready;
      p.doc.querySelector('.answer').focus();                       // a live frame focuses a new question's field
      const fresh = p.doc.createElement('button');
      fresh.dataset.focusKey = 'f:n:a|plan.md';
      p.doc.querySelector('.row').replaceWith(fresh);              // and repaints the list the popup was opened from
      v.close();
      assert.equal(p.doc.activeElement, fresh, 'the reader\'s own row');
    } },
  ]);
});

test('Tab from a control in the middle of a preview\'s shadow root goes on to the next one, never back to the header', async () => {
  const p = page((url, method) => (method === 'GET' && url.startsWith('/t?') ? { status: 200, body: { text: 'specification {}' } } : null));
  p.win.dagre = {};
  if (!p.win.customElements.get('worca-c4')) p.win.customElements.define('worca-c4', class extends p.win.HTMLElement {
    load() {
      const r = this.attachShadow({ mode: 'open' });
      r.innerHTML = '<div class="stage" tabindex="0"><select aria-label="View"><option>v</option></select><button aria-label="Zoom in">+</button></div>';
    }
  });
  await p.open({ artifact: { kind: 'c4', relPath: 'arch/model.c4', bytes: 16 } }).ready;
  const shadow = p.doc.querySelector('.apv worca-c4').shadowRoot;
  const select = shadow.querySelector('select');
  select.focus();
  const e = new p.win.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, composed: true });
  select.dispatchEvent(e);
  assert.equal(e.defaultPrevented, false, 'the browser moves on to Zoom');
  assert.equal(shadow.activeElement, select, 'the trap did not pull the focus up to the header');
});

test('Shift+Tab from the first control reaches a preview\'s trailing select (a select, input or textarea is a Tab stop)', async () => {
  const p = page((url, method) => (method === 'GET' && url.startsWith('/t?') ? { status: 200, body: { text: 'specification {}' } } : null));
  p.win.dagre = {};
  if (!p.win.customElements.get('worca-c4')) p.win.customElements.define('worca-c4', class extends p.win.HTMLElement {
    load() {
      const r = this.attachShadow({ mode: 'open' });
      r.innerHTML = '<div class="stage" tabindex="0"><button aria-label="Zoom in">+</button><select aria-label="View"><option>v</option></select></div>';
    }
  });
  await p.open({ artifact: { kind: 'c4', relPath: 'arch/model.c4', bytes: 16 } }).ready;
  const shadow = p.doc.querySelector('.apv worca-c4').shadowRoot;
  const first = p.doc.querySelector('.apv .apv-dl');
  first.focus();
  first.dispatchEvent(new p.win.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, composed: true, shiftKey: true }));
  assert.equal(shadow.activeElement, shadow.querySelector('select'));
});

test('stepping onto the START of the list with the Previous BUTTON hands the focus to Next', async () => {
  const p = page((url) => (url.startsWith('/t?') ? { status: 200, body: { text: 'x' } } : null));
  const list = [{ kind: 'x', relPath: 'a.txt', bytes: 1 }, { kind: 'x', relPath: 'b.txt', bytes: 1 }];
  await p.open({ artifact: list[1], list }).ready;
  const prev = p.doc.querySelector('.apv .apv-prev');
  prev.focus();
  tap(p.win, prev);
  await tick(p.win);
  assert.equal(prev.disabled, true);
  assert.equal(p.doc.activeElement, p.doc.querySelector('.apv .apv-next'));
});

test('an empty Content-Length sizes nothing (never "0 B")', async () => {
  const p = page();
  await openArtifactViewer({ doc: p.doc, win: p.win, fetch: headFetch(p, () => ({ ok: true, status: 200, length: '' })), urls: URLS, artifact: { kind: 'log', relPath: 'logs/a.log' } }).ready;
  assert.equal(p.doc.querySelector('.apv .apv-meta').textContent, '');
});

test('only text that STARTS with the two U+FFFD of a UTF-16 mark is fetched again, and only FF FE / FE FF is that mark', async () => {
  const NUL = String.fromCharCode(0);
  const FFFD = String.fromCharCode(0xfffd);
  const run = async (text, bytes) => {
    const p = page();
    const fetch = async (url, opts = {}) => {
      p.calls.push(`${opts.method || 'GET'} ${url}`);
      if (url.startsWith('/t?')) return { ok: true, status: 200, json: async () => ({ text }) };
      return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => Uint8Array.from(bytes).buffer };
    };
    await openArtifactViewer({ doc: p.doc, win: p.win, fetch, urls: URLS, artifact: { kind: 'log', relPath: 'out/run.txt', bytes: bytes.length } }).ready;
    return p;
  };
  const late = await run(`x${FFFD}${NUL}y`, [0x78, 0x80, 0, 0x79]);
  assert.deepEqual(late.calls, ['GET /t?rel=out%2Frun.txt'], 'a U+FFFD that is not the first character: no second request');
  const half = await run(`${FFFD}${FFFD}${NUL}x`, [0xff, 0x80, 0, 0x78]);
  const note = half.doc.querySelector('.apv .apv-info-note');
  assert.equal(note && note.textContent, 'No preview for this file type', 'FF alone is no byte-order mark');
});

test('a UTF-16 check still running for the file left behind never turns the file shown now into the info view', async () => {
  const NUL = String.fromCharCode(0);
  const FFFD = String.fromCharCode(0xfffd);
  const p = page();
  let release;
  const held = new Promise((r) => { release = r; });
  const fetch = async (url, opts = {}) => {
    p.calls.push(`${opts.method || 'GET'} ${url}`);
    if (url === '/t?rel=a.txt') return { ok: true, status: 200, json: async () => ({ text: `${FFFD}${FFFD}${NUL}x` }) };
    if (url.startsWith('/t?')) return { ok: true, status: 200, json: async () => ({ text: 'plain' }) };
    await held;
    return { ok: true, status: 200, arrayBuffer: async () => Uint8Array.from([0x80, 0x81, 0, 0x78]).buffer };
  };
  const list = [{ kind: 'x', relPath: 'a.txt', bytes: 4 }, { kind: 'x', relPath: 'b.txt', bytes: 5 }];
  const v = openArtifactViewer({ doc: p.doc, win: p.win, fetch, urls: URLS, artifact: list[0], list });
  await tick(p.win);
  const root = p.doc.querySelector('.apv');
  press(p.win, root.querySelector('.apv-card'), 'ArrowRight');
  await tick(p.win);
  assert.equal(root.querySelector('.apv-stage pre').textContent, 'plain');
  release();
  await v.ready;
  await tick(p.win);
  assert.equal(root.classList.contains('is-info'), false, 'b.txt keeps its text layout');
  assert.equal(root.querySelector('.apv-stage pre').textContent, 'plain');
});

test('a double click on the info view\'s Download saves the file once', async () => {
  const p = page();
  await p.open({ artifact: { kind: 'deck', relPath: 'deck/deck.pptx', bytes: 9 } }).ready;
  p.calls.length = 0;
  const b = p.doc.querySelector('.apv .apv-info-dl');
  tap(p.win, b, 1);
  tap(p.win, b, 2);
  await tick(p.win);
  assert.deepEqual(p.calls, ['HEAD /raw/deck/deck.pptx?download=1']);
});

test('closing after the opener\'s row went: the same focus key inside a [hidden] box is no target; the opener\'s pane is', async () => {
  const p = page();
  p.doc.body.insertAdjacentHTML('beforeend', '<div hidden><button data-focus-key="f:n:a|plan.md">plan.md</button></div>'
    + '<div class="pane"><button class="other">other</button><button data-focus-key="f:n:a|plan.md">plan.md</button></div>');
  p.doc.querySelector('.pane [data-focus-key]').focus();
  const v = p.open({ artifact: { kind: 'x', relPath: 'plan.md' } });
  await v.ready;
  p.doc.querySelector('.pane [data-focus-key]').remove();
  v.close();
  assert.equal(p.doc.activeElement, p.doc.querySelector('.pane .other'));
});

test('closing after a repaint that left fewer identical lines than the one opened: the last of them, without throwing', async () => {
  const p = page();
  const pane = p.doc.createElement('div');
  const line = '<a class="log-artifact" href="#">plan.md</a>';
  pane.innerHTML = line.repeat(3);
  p.doc.body.appendChild(pane);
  pane.children[2].focus();
  const v = p.open({ artifact: { kind: 'x', relPath: 'plan.md' } });
  await v.ready;
  pane.innerHTML = line.repeat(2);
  assert.doesNotThrow(() => v.close());
  assert.equal(p.doc.activeElement, pane.lastElementChild);
});

test('closing after a repaint: of several identical lines, each in its own line wrapper, the one that was opened', async () => {
  const p = page();
  const pane = p.doc.createElement('div');
  const html = '<div class="log-line"><a class="log-artifact" href="#">plan.md</a></div>'.repeat(3);
  pane.innerHTML = html;
  p.doc.body.appendChild(pane);
  pane.children[1].firstElementChild.focus();
  const v = p.open({ artifact: { kind: 'x', relPath: 'plan.md' } });
  await v.ready;
  pane.innerHTML = html;
  v.close();
  assert.equal(p.doc.activeElement, pane.children[1].firstElementChild);
});

test('closing a viewer that replaced another, after a repaint: still the identical line that was opened first', async () => {
  const p = page();
  const pane = p.doc.createElement('div');
  const html = '<a class="log-artifact" href="#">plan.md</a>'.repeat(3);
  pane.innerHTML = html;
  p.doc.body.appendChild(pane);
  pane.children[2].focus();
  await p.open({ artifact: { kind: 'x', relPath: 'plan.md' } }).ready;
  const v2 = p.open({ artifact: { kind: 'x', relPath: 'b.md' } });
  await v2.ready;
  pane.innerHTML = html;
  v2.close();
  assert.equal([...pane.children].indexOf(p.doc.activeElement), 2);
});

test('a pinned previewKind (the chat files card): html source as highlighted code, never a frame; a JSON body in out.txt as json', async () => {
  const p = page((url) => (url.startsWith('/t?rel=att_1') ? { status: 200, body: { text: '<script>x</script>' } }
    : url.startsWith('/t?rel=att_2') ? { status: 200, body: { text: '{"a":1}' } } : null));
  await p.open({ artifact: { relPath: 'att_1/page.html', bytes: 18, previewKind: 'code' }, deps: { hljsLoader: fakeLoader() } }).ready;
  const pre = p.doc.querySelector('.apv-stage pre.apv-code');
  assert.ok(pre, 'code view');
  assert.equal(pre.textContent, '<script>x</script>');
  assert.equal(p.doc.querySelector('.apv iframe, .apv script'), null, 'nothing framed, nothing run');
  assert.ok(p.calls.includes('GET /t?rel=att_1%2Fpage.html'), 'text route, not raw');
  await p.open({ artifact: { relPath: 'att_2/out.txt', bytes: 7, previewKind: 'json' } }).ready;
  assert.equal(p.doc.querySelector('.apv-stage pre.artifact-json').textContent, '{\n  "a": 1\n}');
});

test('a pinned image is drawn through <img> from the raw route, even under a name that would frame (svg saved as .html)', async () => {
  const p = page();
  await p.open({ artifact: { relPath: 'att_3/logo.svg', bytes: 300, previewKind: 'image' } }).ready;
  assert.equal(p.doc.querySelector('.apv-stage img').getAttribute('src'), '/raw/att_3/logo.svg');
  await p.open({ artifact: { relPath: 'att_4/page.html', bytes: 300, previewKind: 'image' } }).ready;
  assert.equal(p.doc.querySelector('.apv iframe'), null);
  assert.equal(p.doc.querySelector('.apv-stage img').getAttribute('src'), '/raw/att_4/page.html');
  const m = mountIn();
  await renderPreview({ relPath: 'att_5/page.html', text: '<b>x</b>', previewKind: 'text' }, m, {});
  assert.equal(m.querySelector('iframe'), null);
  assert.equal(m.querySelector('pre.artifact-text').textContent, '<b>x</b>');
});

test('a pinned html (or c4, or junk) view is never framed: the renderer reads it as text, the viewer as no preview', async () => {
  const m = mountIn();
  await renderPreview({ relPath: 'att_6/page.html', text: '<b>x</b>', url: '/raw/att_6/page.html', previewKind: 'html' }, m, {});
  assert.equal(m.querySelector('iframe'), null);
  assert.equal(m.querySelector('pre.artifact-text').textContent, '<b>x</b>');
  const p = page();
  await p.open({ artifact: { relPath: 'att_6/page.html', bytes: 8, previewKind: 'html' } }).ready;
  assert.equal(p.doc.querySelector('.apv iframe'), null);
  assert.ok(!p.calls.some((c) => c.includes('/raw/att_6')), 'never fetched as raw bytes');
});
