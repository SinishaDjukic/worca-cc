// test/ui-history-detail-diff-small-window.test.mjs — the History Diff tab's windowing tests of
// test/ui-history-detail-diff.test.mjs: show-more steps one window at a time, a window boundary inside a hunk, and rows
// connected by show-more highlighted. They need a 50-row window and a 2,000-code-unit parse cap, size knobs app.js reads
// once, when it loads, so they live in their own file, booted with them (test/helpers/shared-app-boot.mjs). Shared
// fixtures: helpers/history-detail-boot.mjs.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  settle, ok, openDetail, click, diffResults, diffDetail, patchArm, detailOn, historyFetch,
} from './helpers/history-detail-boot.mjs';
import { checkRows } from './helpers/rows.mjs';
import { useSharedApp } from './helpers/shared-app-boot.mjs';
import { createHljsLoader } from '../ui/public/hljs-loader.mjs';

// The Diff tab's size knobs (window.__worcaTestHooks, read once, when app.js loads): a 50-row window and a 2,000-code-unit
// parse cap keep the windowing fixtures at ~60 rows. app.js takes its highlighter at load too: the file's hands each
// language to the test's own loader (bootDetail's hljsLoader), else to a new real one, as each boot of app.js made.
const WIN = 50;
const SMALL = { diffWindowLines: WIN, maxSectionCodeUnits: 2000 };
let hljs = createHljsLoader();
const app = useSharedApp({ before, beforeEach, after }, {
  fetchHandler: historyFetch(),
  hooks: { ...SMALL, hljsLoader: { forLanguage: (lang) => hljs.forLanguage(lang) } },
});
const openDetailPage = detailOn(app).detail;
const bootDetail = (opts = {}) => {
  hljs = opts.hljsLoader ?? createHljsLoader();
  return openDetailPage(opts);
};
const addedLinesPatch = (path, n, { header = null } = {}) => {
  const lines = Array.from({ length: n }, (_, index) => `+const n${index + 1} = ${index + 1};`);
  return `diff --git a/${path} b/${path}
--- /dev/null
+++ b/${path}
${header || `@@ -0,0 +1,${n} @@`}
${lines.join('\n')}
`;
};
const addedFileResults = (path, n) => diffResults({
  summary: { filesNew: 1, filesChanged: 0, linesAdded: n, linesRemoved: 0 },
  results: { newFiles: [{ path, status: 'A', added: n, removed: 0 }], changedFiles: [] },
});
const bodyOf = (doc) => doc.querySelector('#hist-detail .hd-diff-body');
const rowsOf = (doc) => doc.querySelectorAll('#hist-detail .hd-dl-row');
const moreOf = (doc) => doc.querySelector('#hist-detail .hd-dl-more');

test('a long diff connects one window plus an honest show-more row that steps one window at a time (running total, singular form)', async () => {
  await checkRows([
    { name: 'a long diff connects one window of rows plus an honest show-more row, never a truncation note', run: async () => {
      const N = WIN + 10;
      const ctx = await bootDetail({
        detail: diffDetail(addedFileResults('many.js', N)), arms: patchArm(addedLinesPatch('many.js', N)), hooks: SMALL,
      });
      await openDetail(ctx);
      await settle(ctx.window, 5);
      const doc = ctx.window.document;
      assert.equal(rowsOf(doc).length, WIN);
      assert.equal(doc.querySelectorAll('#hist-detail .hd-dl-hunk').length, 1);
      assert.equal(doc.querySelector('#hist-detail .hd-diff-trunc'), null, 'nothing was dropped, so no truncation note');
      const more = moreOf(doc);
      assert.ok(more, 'the hidden rows are one click away');
      assert.equal(more.classList.contains('hd-dl-row'), false, 'a real grid row, not display:contents');
      assert.equal(more.dataset.path, 'many.js', 'carries the same section identity as every other row');
      assert.match(more.querySelector('.hd-dl-more-hint').textContent, /^50 of 60 lines shown$/);
      const button = more.querySelector('button.hd-dl-more-btn');
      assert.equal(button.type, 'button');
      assert.equal(button.textContent, 'Show 10 more lines');
      assert.equal(more, bodyOf(doc).lastElementChild);
      // The gutter is sized for the WIDEST number in the whole file up front, so
      // expanding never shifts the columns.
      assert.equal(bodyOf(doc).style.getPropertyValue('--hd-gutter-width'), 'calc(3ch + 16px)');

      click(ctx.window, button);
      await settle(ctx.window);
      assert.equal(rowsOf(doc).length, N);
      assert.equal(moreOf(doc), null);
      assert.equal(doc.querySelectorAll('#hist-detail .hd-dl-hunk').length, 1, 'the continued hunk gets no second header');
      const last = [...rowsOf(doc)].at(-1);
      assert.equal(last.dataset.new, String(N));
      assert.equal(last.querySelector('.hd-dl-code').textContent, `+const n${N} = ${N};`);
    } },
    { name: 'show-more steps one window at a time, reporting the running total and the singular form', run: async () => {
      const N = 2 * WIN + 1;
      const ctx = await bootDetail({
        detail: diffDetail(addedFileResults('big.js', N)), arms: patchArm(addedLinesPatch('big.js', N)), hooks: SMALL,
      });
      await openDetail(ctx);
      await settle(ctx.window, 5);
      const doc = ctx.window.document;
      assert.equal(rowsOf(doc).length, WIN);
      assert.equal(moreOf(doc).querySelector('button').textContent, `Show ${WIN} more lines`);

      click(ctx.window, moreOf(doc).querySelector('button'));
      await settle(ctx.window);
      assert.equal(rowsOf(doc).length, 2 * WIN);
      assert.equal(doc.querySelectorAll('#hist-detail .hd-dl-more').length, 1, 'the used control is replaced, not stacked');
      assert.match(moreOf(doc).querySelector('.hd-dl-more-hint').textContent, /^100 of 101 lines shown$/);
      assert.equal(moreOf(doc).querySelector('button').textContent, 'Show 1 more line');

      click(ctx.window, moreOf(doc).querySelector('button'));
      await settle(ctx.window);
      assert.equal(rowsOf(doc).length, N);
      assert.equal(moreOf(doc), null);
    } },
  ]);
});

test('a window boundary inside a hunk continues that hunk; later hunks still get their headers', async () => {
  // hunk 1 fills the window exactly (WIN lines) and hunk 2 follows: the
  // first window must not render hunk 2's header as a dangling last row.
  const first = Array.from({ length: WIN }, (_, i) => `+a${i}`);
  const second = ['+b1', '+b2', '+b3'];
  const patch = `diff --git a/two.js b/two.js
--- a/two.js
+++ b/two.js
@@ -0,0 +1,${first.length} @@
${first.join('\n')}
@@ -10,0 +${first.length + 11},3 @@
${second.join('\n')}
`;
  const ctx = await bootDetail({
    detail: diffDetail(addedFileResults('two.js', first.length + 3)), arms: patchArm(patch), hooks: SMALL,
  });
  await openDetail(ctx);
  await settle(ctx.window, 5);
  const doc = ctx.window.document;
  assert.equal(rowsOf(doc).length, WIN);
  assert.equal(doc.querySelectorAll('#hist-detail .hd-dl-hunk').length, 1);
  assert.equal(moreOf(doc).querySelector('button').textContent, 'Show 3 more lines');
  click(ctx.window, moreOf(doc).querySelector('button'));
  await settle(ctx.window);
  const hunks = [...doc.querySelectorAll('#hist-detail .hd-dl-hunk')];
  assert.equal(hunks.length, 2);
  assert.equal(hunks[1].nextElementSibling.querySelector('.hd-dl-code').textContent, '+b1');
  assert.equal(rowsOf(doc).length, WIN + 3);
});

test('rows connected by show-more are highlighted once both the rows and the highlighter exist', async () => {
  // Hunk 1 is ineligible for highlighting (its header count is wrong, so it
  // stays plain) and fills the first window; hunk 2 is eligible but only
  // connects after a click. Both orders must end with hunk 2 enhanced.
  const bulk = Array.from({ length: WIN + 5 }, (_, i) => `+x${i}`);
  const patch = `diff --git a/src/a.js b/src/a.js
--- a/src/a.js
+++ b/src/a.js
@@ -0,0 +1,2 @@
${bulk.join('\n')}
@@ -1 +1 @@
-old
+valid
`;
  const results = diffResults({
    summary: { linesAdded: bulk.length + 1, linesRemoved: 1 },
    results: { changedFiles: [{ path: 'src/a.js', status: 'M', added: bulk.length + 1, removed: 1 }] },
  });
  const highlighter = {
    lang: 'javascript',
    highlight: (text) => text.replace(/valid/g, '<span class="hljs-keyword">valid</span>'),
  };
  const enhancedSources = (doc) => [...doc.querySelectorAll('#hist-detail .hd-dl-src')]
    .filter((source) => source.querySelector('.hljs-keyword'))
    .map((source) => source.textContent);

  // Order A: the highlighter finishes first, the click comes later.
  const ready = await bootDetail({
    detail: diffDetail(results), arms: patchArm(patch), hooks: SMALL,
    hljsLoader: { async forLanguage() { return highlighter; } },
  });
  await openDetail(ready);
  await settle(ready.window, 6);
  assert.deepEqual(enhancedSources(ready.window.document), []);
  click(ready.window, moreOf(ready.window.document).querySelector('button'));
  await settle(ready.window);
  assert.deepEqual(enhancedSources(ready.window.document), ['valid']);
  assert.equal(rowsOf(ready.window.document).length, bulk.length + 2);

  // Order B: the click lands while the grammar is still loading.
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const late = await bootDetail({
    detail: diffDetail(results), arms: patchArm(patch), hljsLoader: { forLanguage: () => gate }, hooks: SMALL,
  });
  await openDetail(late);
  await settle(late.window, 5);
  click(late.window, moreOf(late.window.document).querySelector('button'));
  await settle(late.window);
  assert.deepEqual(enhancedSources(late.window.document), []);
  release(highlighter);
  await settle(late.window, 6);
  assert.deepEqual(enhancedSources(late.window.document), ['valid']);
  const plain = [...late.window.document.querySelectorAll('#hist-detail .hd-dl-src')][0];
  assert.equal(plain.children.length, 0, 'the ineligible hunk stays plain');
});
