// test/ui-history-detail-diff-section-cap.test.mjs — the History Diff tab test of test/ui-history-detail-diff.test.mjs
// that pins the production section-size cap under a 50-row window. app.js reads its window size once, when it loads
// (window.__worcaTestHooks.diffWindowLines), so this test has an app of its own, booted with that window
// (test/helpers/shared-app-boot.mjs). Shared fixtures: helpers/history-detail-boot.mjs.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  settle, ok, openDetail, diffResults, diffDetail, patchArm, MAX_FILE_SECTION_CODE_UNITS, detailOn, historyFetch,
} from './helpers/history-detail-boot.mjs';
import { useSharedApp } from './helpers/shared-app-boot.mjs';

// The Diff tab's window (a size knob app.js reads once, when it loads): 50 rows keep the render cheap; the parse cap
// stays the production one.
const app = useSharedApp({ before, beforeEach, after }, { fetchHandler: historyFetch(), hooks: { diffWindowLines: 50 } });
const bootDetail = detailOn(app).detail;
const addedFileResults = (path, n) => diffResults({
  summary: { filesNew: 1, filesChanged: 0, linesAdded: n, linesRemoved: 0 },
  results: { newFiles: [{ path, status: 'A', added: n, removed: 0 }], changedFiles: [] },
});
const bodyOf = (doc) => doc.querySelector('#hist-detail .hd-diff-body');
const rowsOf = (doc) => doc.querySelectorAll('#hist-detail .hd-dl-row');
const moreOf = (doc) => doc.querySelector('#hist-detail .hd-dl-more');

test('the section-size cap still reports truncation, after the show-more row', async () => {
  // The PRODUCTION cap (no maxSectionCodeUnits hook: the one hook-free pin of app.js's
  // default). 91 code units per row, so N rows exceed MAX_FILE_SECTION_CODE_UNITS and the
  // parser drops the tail (that loss is real and is said so); a 50-row window keeps the
  // render cheap.
  const W = 50;
  const N = Math.ceil(MAX_FILE_SECTION_CODE_UNITS / 91) + 100;
  const lines = Array.from({ length: N }, () => '+' + 'x'.repeat(89));
  const patch = `diff --git a/huge.txt b/huge.txt
--- /dev/null
+++ b/huge.txt
@@ -0,0 +1,${N} @@
${lines.join('\n')}
`;
  const ctx = await bootDetail({
    detail: diffDetail(addedFileResults('huge.txt', N)), arms: patchArm(patch), hooks: { diffWindowLines: W },
  });
  await openDetail(ctx);
  await settle(ctx.window, 5);
  const doc = ctx.window.document;
  assert.equal(rowsOf(doc).length, W);
  const body = bodyOf(doc);
  const note = body.querySelector('.hd-diff-trunc');
  assert.equal(note.textContent, '(large file, diff truncated)');
  assert.doesNotMatch(note.textContent, /KB/);
  assert.equal(note, body.lastElementChild, 'the note stays the last row');
  assert.equal(note.previousElementSibling, moreOf(doc), 'show-more sits just above it');
  const shown = Number(/^(\d+) of (\d+) lines shown$/.exec(moreOf(doc).querySelector('.hd-dl-more-hint').textContent)[2]);
  assert.ok(shown > 5_000 && shown < N, `the total counts parsed rows only (${shown})`);
});
