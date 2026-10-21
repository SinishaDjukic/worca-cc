// test/ui-history-detail-diff.test.mjs
// History detail, the Diff tab: file list, patch viewer, windowing and highlighting.
// Shared boot and fixtures: helpers/history-detail-boot.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WINDOW, settle, go, KEY, ROW, DETAIL, ok, fail, bootDetail, openDetail, click, secOf, PATCH,
  diffResults, diffDetail, patchArm, filesOf, fileOf, paneOf, MAX_FILE_SECTION_CODE_UNITS,
  MAX_HIGHLIGHT_INPUT_BYTES,
} from './helpers/history-detail-boot.mjs';
import { checkRows } from './helpers/rows.mjs';

// ---------------------------------------------------------------------------
// Diff tab — file list + patch viewer
// ---------------------------------------------------------------------------

test("Diff tab lists files and renders the selected file's hunks", async () => {
  const ctx = await bootDetail({ detail: diffDetail(diffResults()), arms: patchArm(PATCH) });
  await openDetail(ctx);
  // buildHdDiff auto-selects row 1 through a fire-and-forget async select(), so the
  // pane is still empty on the tick the tab is built.
  await settle(ctx.window);
  const doc = ctx.window.document;

  const rows = filesOf(doc);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].querySelector('.hd-diff-path').textContent, 'a.js');
  assert.equal(rows[0].dataset.path, 'src/a.js');

  const pane = paneOf(doc);
  assert.match(pane.textContent, /@@ -1,2 \+1,2 @@/);
  // ASCII +/- in the patch BODY on purpose: these lines are a verbatim unified
  // diff a user may copy, and a U+2212 yields a patch `git apply` rejects.
  assert.equal(pane.querySelector('.hd-dl-add .hd-dl-code').textContent, '+new');
  assert.equal(pane.querySelector('.hd-dl-del .hd-dl-code').textContent, '-old');
  assert.equal(pane.querySelector('.hd-dl-hunk').textContent, '@@ -1,2 +1,2 @@');

  // The patch is fetched from the /diff twin of historyLogUrl, exactly once.
  const diffCalls = ctx.calls.filter((c) => c.url.endsWith('/diff'));
  assert.equal(diffCalls.length, 1);
  assert.equal(diffCalls[0].url, `/api/history/${KEY}/${ROW.id}/diff`);
});

test('file-list head shows file count and aggregate +/− (U+2212) without double-counting a deleted file', async () => {
  await checkRows([
    { name: 'the file-list head shows the file count and aggregate counts with U+2212', run: async () => {
      const ctx = await bootDetail({ detail: diffDetail(diffResults()), arms: patchArm(PATCH) });
      await openDetail(ctx);
      await settle(ctx.window);
      const head = ctx.window.document.querySelector('#hist-detail .hd-diff-list-head');
      assert.ok(head, 'the file list carries a head');
      assert.match(head.textContent, /1 file changed/);
      assert.match(head.textContent, /\+1/);
      assert.match(head.textContent, /−1/);            // U+2212 in COUNT displays
      assert.doesNotMatch(head.textContent, /-1/);     // never an ASCII hyphen here
    } },
    { name: 'a deleted file counted in filesChanged is not double-counted in the head', run: async () => {
      // 'D' rows live in changedFiles (NEW_STATUS is {A,C}) AND count in filesDeleted,
      // so file count = filesNew + filesChanged — never + filesDeleted.
      const results = diffResults({
        summary: { filesChanged: 2, filesDeleted: 1, linesAdded: 1, linesRemoved: 5 },
        results: {
          changedFiles: [
            { path: 'src/a.js', status: 'M', added: 1, removed: 1 },
            { path: 'src/gone.js', status: 'D', added: 0, removed: 4 },
          ],
        },
      });
      const ctx = await bootDetail({ detail: diffDetail(results), arms: patchArm(PATCH) });
      await openDetail(ctx);
      await settle(ctx.window);
      const doc = ctx.window.document;

      const head = doc.querySelector('#hist-detail .hd-diff-list-head');
      assert.match(head.textContent, /2 files changed/);
      assert.doesNotMatch(head.textContent, /3 files changed/);
      assert.equal(filesOf(doc).length, 2);
      assert.ok(fileOf(doc, 'src/gone.js').classList.contains('deleted'), 'a D row is flagged for the strike-through');
    } },
  ]);
});

test('file in results but missing from the patch shows the no-textual-diff note', async () => {
  // bucketFiles derives the summary from the same arrays (results.mjs:42-52), so a
  // second row has to bump filesChanged too — leaving it at 1 encodes a state the
  // product cannot produce.
  const results = diffResults({
    summary: { filesChanged: 2 },
    results: {
      changedFiles: [
        { path: 'src/a.js', status: 'M', added: 1, removed: 1 },
        { path: 'assets/logo.png', status: 'M', binary: true },
      ],
    },
  });
  const ctx = await bootDetail({ detail: diffDetail(results), arms: patchArm(PATCH) });
  await openDetail(ctx);
  await settle(ctx.window);
  const { window } = ctx;
  const doc = window.document;

  const rows = filesOf(doc);
  assert.equal(rows.length, 2);
  // A binary entry carries {binary:true} and NEVER {added,removed}.
  const binary = fileOf(doc, 'assets/logo.png');
  assert.match(binary.textContent, /binary/);

  click(window, binary);
  await settle(window);
  const pane = paneOf(doc);
  assert.match(pane.textContent, /\(no textual diff for this file\)/);
  assert.equal(pane.querySelector('.hd-dl-add'), null, 'no hunks are rendered for it');
});

test('non-done run (results null) shows the empty state and never fetches /diff', async () => {
  const ctx = await bootDetail({
    detail: { ...DETAIL, results: null, state: { ...DETAIL.state, status: 'stopped' } },
  });
  await openDetail(ctx);
  const { window } = ctx;
  const doc = window.document;

  // No results -> Overview is the default tab; Diff builds on its first click.
  click(window, doc.querySelector('#hist-detail .hd-tab[data-sec="diff"]'));
  await settle(window);

  const empty = doc.querySelector('#hist-detail .hd-diff-empty');
  assert.ok(empty, 'the Diff tab shows the D1 empty state');
  assert.match(empty.textContent, /No diff captured for this run\./);
  assert.match(empty.textContent, /The run has committed no work, or its artifacts have been archived/);
  // The old copy promised diffs only on completion — stopped/errored runs now
  // persist one, so that sentence must be gone.
  assert.doesNotMatch(empty.textContent, /captured when a run completes/);
  assert.equal(doc.querySelector('#hist-detail .hd-diff-file'), null);
  // endsWith, not includes: the diff-comments endpoints contain "/diff" as a
  // substring and are unrelated to the patch.
  assert.ok(ctx.calls.every((c) => !c.url.endsWith('/diff')), 'the patch is never requested');
});

const noticeOf = (doc) => doc.querySelector('#hist-detail .hd-diff-partial');

test('a stopped or errored run with results renders the diff plus the partial-run notice; a done run has no notice', async () => {
  await checkRows([
    { name: 'a stopped run with results renders the diff plus the partial-run notice', run: async () => {
      const ctx = await bootDetail({
        detail: { ...diffDetail(diffResults()), state: { ...DETAIL.state, status: 'stopped' } },
        arms: patchArm(PATCH),
      });
      await openDetail(ctx);
      await settle(ctx.window);
      const doc = ctx.window.document;

      const notice = noticeOf(doc);
      assert.ok(notice, 'the partial-run notice paints');
      assert.match(notice.textContent, /did not finish/);
      assert.match(notice.textContent, /partially written/);
      assert.match(notice.textContent, /cycles that completed/);

      // The diff itself is unaffected — the artifact exists, so the tab is fully live.
      assert.equal(filesOf(doc).length, 1, 'the file list still renders');
      assert.match(paneOf(doc).textContent, /@@ -1,2 \+1,2 @@/);

      // The notice sits ABOVE the diff grid, not after it.
      const grid = doc.querySelector('#hist-detail .hd-diff');
      const rel = notice.compareDocumentPosition(grid);
      assert.ok(rel & ctx.window.Node.DOCUMENT_POSITION_FOLLOWING, 'the notice precedes the grid');
    } },
    { name: 'an errored run with results also renders the partial-run notice', run: async () => {
      const ctx = await bootDetail({
        detail: { ...diffDetail(diffResults()), state: { ...DETAIL.state, status: 'error' } },
        arms: patchArm(PATCH),
      });
      await openDetail(ctx);
      await settle(ctx.window);
      assert.ok(noticeOf(ctx.window.document), 'the notice is keyed off "not done", not off "stopped"');
    } },
    { name: 'a done run renders the diff with no partial-run notice', run: async () => {
      const ctx = await bootDetail({ detail: diffDetail(diffResults()), arms: patchArm(PATCH) });
      await openDetail(ctx);
      await settle(ctx.window);
      assert.equal(noticeOf(ctx.window.document), null, 'a finished run claims nothing about partial work');
    } },
  ]);
});

test('a failing patch fetch degrades to the file list + per-file note and re-arms the Diff tab for a retry', async () => {
  await checkRows([
    { name: 'diff fetch failing (404) degrades to the file list + a per-file note', run: async () => {
      // No `arms`: the shared base already answers /diff with a 404.
      const ctx = await bootDetail({ detail: diffDetail(diffResults()) });
      await openDetail(ctx);
      await settle(ctx.window);
      const doc = ctx.window.document;

      assert.equal(filesOf(doc).length, 1, 'the rows still render');
      const pane = paneOf(doc);
      assert.match(pane.textContent, /src\/a\.js/, 'the pane head still names the file');
      assert.match(pane.textContent, /Could not load the patch/);
      assert.match(pane.textContent, /404/, 'the note names the failure');
    } },
    { name: 'a failed patch fetch re-arms the Diff tab for a retry', run: async () => {
      // The same contract the Logs tab already honors: a memoised SETTLED rejection
      // would brick the pane for the life of the screen, with recovery only through
      // Back + reopen.
      const results = diffResults({
        summary: { filesChanged: 2, linesAdded: 2, linesRemoved: 1 },
        results: {
          changedFiles: [
            { path: 'src/a.js', status: 'M', added: 1, removed: 1 },
            { path: 'src/b.js', status: 'M', added: 1, removed: 0 },
          ],
        },
      });
      const TWO = `${PATCH}diff --git a/src/b.js b/src/b.js
--- a/src/b.js
+++ b/src/b.js
@@ -0,0 +1 @@
+two
`;
      let n = 0;
      const ctx = await bootDetail({
        detail: diffDetail(results),
        arms: (url) => {
          if (!url.endsWith('/diff')) return null;
          n += 1;
          return n === 1
            ? fail(503, { error: 'boom' })
            : Promise.resolve({ ok: true, status: 200, text: async () => TWO });
        },
      });
      await openDetail(ctx);
      await settle(ctx.window);
      const doc = ctx.window.document;
      assert.match(paneOf(doc).textContent, /Could not load the patch: HTTP 503/);

      click(ctx.window, fileOf(doc, 'src/b.js'));
      await settle(ctx.window, 4);
      assert.equal(ctx.calls.filter((c) => c.url.endsWith('/diff')).length, 2, 'the next select refetches');
      assert.match(paneOf(doc).textContent, /\+two/, 'and the retry renders');
      assert.doesNotMatch(paneOf(doc).textContent, /Could not load the patch/,
        'the settled failure does not outlive the fetch that replaced it');
    } },
  ]);
});

test('workspace run groups rows per project and keys sections by project', async () => {
  // A workspace results object is {summary, perProject} with NO top-level file
  // arrays, and its perProject keys are the same strings the patch's `# <key>`
  // markers carry (orchestrator.mjs:3443).
  const WS_RESULTS = {
    summary: {
      filesNew: 0, filesChanged: 2, filesDeleted: 0,
      linesAdded: 2, linesRemoved: 1, blockingIssues: 0, nitpicks: 0,
    },
    perProject: {
      'proj-a-00000001': {
        summary: {}, newFiles: [],
        changedFiles: [{ path: 'a.js', status: 'M', added: 1, removed: 1 }],
      },
      'proj-b-00000002': {
        summary: {}, newFiles: [],
        changedFiles: [{ path: 'a.js', status: 'M', added: 1, removed: 0 }],
      },
    },
  };
  const WS_PATCH = `# proj-a-00000001
diff --git a/a.js b/a.js
--- a/a.js
+++ b/a.js
@@ -1 +1 @@
-one
+alpha

# proj-b-00000002
diff --git a/a.js b/a.js
--- a/a.js
+++ b/a.js
@@ -0,0 +1 @@
+beta
`;
  const ctx = await bootDetail({ detail: diffDetail(WS_RESULTS), arms: patchArm(WS_PATCH) });
  await openDetail(ctx);
  await settle(ctx.window);
  const { window } = ctx;
  const doc = window.document;

  const groups = [...doc.querySelectorAll('#hist-detail .hd-tree-project')];
  assert.deepEqual(groups.map((g) => g.textContent), ['proj-a-00000001', 'proj-b-00000002']);
  const rows = filesOf(doc);
  assert.equal(rows.length, 2, 'the same file name appears once per project');

  // Auto-selection landed on the FIRST project's a.js.
  let pane = paneOf(doc);
  assert.equal(pane.querySelector('.hd-dl-add .hd-dl-code').textContent, '+alpha');
  assert.equal(pane.querySelector('.hd-dl-del .hd-dl-code').textContent, '-one');

  // The second same-named file resolves to the SECOND project's section.
  click(window, fileOf(doc, 'a.js', 'proj-b-00000002'));
  await settle(window);
  pane = paneOf(doc);
  assert.equal(pane.querySelector('.hd-dl-add .hd-dl-code').textContent, '+beta');
  assert.equal(pane.querySelector('.hd-dl-del'), null, 'proj-b removed nothing');
});

test('numbered rows: exact copy cells, accessible gutters, identity data; omitted counts/zero ranges/multiple hunks reset gutters', async () => {
  await checkRows([
    { name: 'numbered rows keep exact copy cells, accessible gutters, identity data, and heading outline', run: async () => {
      const ctx = await bootDetail({ detail: diffDetail(diffResults()), arms: patchArm(PATCH) });
      await openDetail(ctx);
      await settle(ctx.window);
      const doc = ctx.window.document;
      const section = secOf(doc, 'diff');
      assert.equal(section.querySelector('h2.sr-only').textContent, 'Changed files and diff');
      assert.equal(section.querySelector('.hd-diff-pane-head h3').textContent, 'src/a.js');
      assert.equal(section.querySelector('.hd-tree-project'), null, 'single-project trees start at files');

      const [context, deletion, addition] = [...section.querySelectorAll('.hd-dl-row')];
      assert.deepEqual([context.dataset.old, context.dataset.new], ['1', '1']);
      assert.deepEqual([deletion.dataset.old, deletion.dataset.new], ['2', '']);
      assert.deepEqual([addition.dataset.old, addition.dataset.new], ['', '2']);
      assert.equal(context.querySelector('.hd-dl-code').textContent, ' keep');
      assert.equal(deletion.querySelector('.hd-dl-code').textContent, '-old');
      assert.equal(addition.querySelector('.hd-dl-code').textContent, '+new');
      assert.equal(deletion.querySelector('.hd-dl-n-old .sr-only').textContent, 'Old line 2');
      assert.equal(deletion.querySelector('.hd-dl-n-new').getAttribute('aria-hidden'), 'true');
      assert.equal(addition.querySelector('.hd-dl-n-new .hd-dl-n-v').getAttribute('aria-hidden'), 'true');

      for (const item of section.querySelectorAll('.hd-dl-row,.hd-dl-hunk')) {
        assert.ok(item.dataset.fileKey);
        assert.equal(item.dataset.project, '');
        assert.equal(item.dataset.path, 'src/a.js');
        assert.equal(item.dataset.oldPath, 'src/a.js');
        assert.equal(item.dataset.newPath, 'src/a.js');
      }
      assert.equal(section.querySelector('.hd-dl-hunk').classList.contains('hd-dl-row'), false);
    } },
    { name: 'omitted counts, zero ranges, and multiple hunks reset gutter counters', run: async () => {
      const patch = `diff --git a/src/a.js b/src/a.js
--- a/src/a.js
+++ b/src/a.js
@@ -0,0 +1 @@
+first
@@ -9 +20 @@
-gone
+fresh
`;
      const results = diffResults({
        summary: { linesAdded: 2, linesRemoved: 1 },
        results: { changedFiles: [{ path: 'src/a.js', status: 'M', added: 2, removed: 1 }] },
      });
      const ctx = await bootDetail({ detail: diffDetail(results), arms: patchArm(patch) });
      await openDetail(ctx);
      await settle(ctx.window);
      const rows = [...ctx.window.document.querySelectorAll('#hist-detail .hd-dl-row')];
      assert.deepEqual(rows.map((row) => [row.dataset.old, row.dataset.new]), [
        ['', '1'], ['9', ''], ['', '20'],
      ]);
      assert.equal(ctx.window.document.querySelectorAll('#hist-detail .hd-dl-hunk').length, 2);
    } },
  ]);
});

test('plain numbered rows connect before loader completion, then enhance in place', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const languages = [];
  const loader = {
    forLanguage(lang) {
      languages.push(lang);
      return gate;
    },
  };
  const ctx = await bootDetail({
    detail: diffDetail(diffResults()), arms: patchArm(PATCH), hljsLoader: loader,
  });
  await openDetail(ctx);
  await settle(ctx.window);
  const doc = ctx.window.document;
  const row = doc.querySelector('#hist-detail .hd-dl-add');
  const source = row.querySelector('.hd-dl-src');
  const sign = row.querySelector('.hd-dl-sign');
  const oldGutter = row.querySelector('.hd-dl-n-old');
  const newGutter = row.querySelector('.hd-dl-n-new');
  assert.equal(row.isConnected, true);
  assert.equal(source.textContent, 'new');
  assert.equal(source.querySelector('span'), null);
  assert.deepEqual(languages, ['javascript']);

  release({
    lang: 'javascript',
    highlight: (text) => text.replace(/new/g, '<span class="hljs-keyword">new</span>'),
  });
  await settle(ctx.window, 6);
  assert.equal(row.querySelector('.hd-dl-src'), source);
  assert.equal(row.querySelector('.hd-dl-sign'), sign);
  assert.equal(row.querySelector('.hd-dl-n-old'), oldGutter);
  assert.equal(row.querySelector('.hd-dl-n-new'), newGutter);
  assert.ok(source.querySelector('.hljs-keyword'));
  assert.equal(row.querySelector('.hd-dl-code').textContent, '+new');
});

test('unsupported and input-over-limit files never consult the loader', async () => {
  const calls = [];
  const loader = { forLanguage: async (lang) => { calls.push(lang); return null; } };
  const unsupportedResults = diffResults({
    results: { changedFiles: [{ path: 'main.tf', status: 'M', added: 1, removed: 0 }] },
  });
  const unsupportedPatch = `diff --git a/main.tf b/main.tf
--- a/main.tf
+++ b/main.tf
@@ -0,0 +1 @@
+enabled = true
`;
  const unsupported = await bootDetail({
    detail: diffDetail(unsupportedResults), arms: patchArm(unsupportedPatch), hljsLoader: loader,
  });
  await openDetail(unsupported);
  await settle(unsupported.window);

  const huge = 'x'.repeat(MAX_HIGHLIGHT_INPUT_BYTES + 1);
  const overResults = diffResults({
    results: { changedFiles: [{ path: 'big.js', status: 'M', added: 1, removed: 0 }] },
  });
  const overPatch = `diff --git a/big.js b/big.js
--- a/big.js
+++ b/big.js
@@ -0,0 +1 @@
+${huge}
`;
  const over = await bootDetail({
    detail: diffDetail(overResults), arms: patchArm(overPatch), hljsLoader: loader,
  });
  await openDetail(over);
  await settle(over.window);
  assert.deepEqual(calls, []);
});

test('invalid highlighter markup stays plain while a separate valid hunk commits', async () => {
  const patch = `diff --git a/src/a.js b/src/a.js
--- a/src/a.js
+++ b/src/a.js
@@ -0,0 +1 @@
+valid
@@ -0,0 +10 @@
+invalid
`;
  const results = diffResults({
    summary: { linesAdded: 2, linesRemoved: 0 },
    results: { changedFiles: [{ path: 'src/a.js', status: 'M', added: 2, removed: 0 }] },
  });
  const loader = {
    async forLanguage() {
      return {
        lang: 'javascript',
        highlight: (text) => (text === 'valid'
          ? '<span class="hljs-keyword">valid</span>'
          : '<img src=x>'),
      };
    },
  };
  const ctx = await bootDetail({ detail: diffDetail(results), arms: patchArm(patch), hljsLoader: loader });
  await openDetail(ctx);
  await settle(ctx.window, 6);
  const sources = [...ctx.window.document.querySelectorAll('#hist-detail .hd-dl-src')];
  assert.ok(sources[0].querySelector('.hljs-keyword'));
  assert.equal(sources[1].children.length, 0);
  assert.equal(sources[1].textContent, 'invalid');
});

test('CR and empty source rows survive detached highlighted staging exactly', async () => {
  const patch = 'diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n'
    + '@@ -0,0 +1,2 @@\r\n+x\r\n+\r\n';
  const results = diffResults({
    summary: { linesAdded: 2, linesRemoved: 0 },
    results: { changedFiles: [{ path: 'src/a.js', status: 'M', added: 2, removed: 0 }] },
  });
  const loader = { async forLanguage() { return { lang: 'javascript', highlight: (text) => text }; } };
  const ctx = await bootDetail({ detail: diffDetail(results), arms: patchArm(patch), hljsLoader: loader });
  await openDetail(ctx);
  await settle(ctx.window, 6);
  const sources = [...ctx.window.document.querySelectorAll('#hist-detail .hd-dl-src')];
  assert.equal(sources[0].textContent, 'x\r');
  assert.equal(sources[1].textContent, '\r');
});

test('stale highlighter completion cannot mutate the newly selected file', async () => {
  const results = diffResults({
    summary: { filesChanged: 2, linesAdded: 2, linesRemoved: 1 },
    results: {
      changedFiles: [
        { path: 'src/a.js', status: 'M', added: 1, removed: 1 },
        { path: 'src/b.tf', status: 'M', added: 1, removed: 0 },
      ],
    },
  });
  const patch = `${PATCH}diff --git a/src/b.tf b/src/b.tf
--- a/src/b.tf
+++ b/src/b.tf
@@ -0,0 +1 @@
+value = true
`;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const loader = { forLanguage: () => gate };
  const ctx = await bootDetail({ detail: diffDetail(results), arms: patchArm(patch), hljsLoader: loader });
  await openDetail(ctx);
  await settle(ctx.window);
  const doc = ctx.window.document;
  click(ctx.window, fileOf(doc, 'src/b.tf'));
  await settle(ctx.window);
  release({
    lang: 'javascript',
    highlight: (text) => `<span class="hljs-keyword">${text}</span>`,
  });
  await settle(ctx.window, 6);
  assert.equal(paneOf(doc).querySelector('.hd-diff-path').textContent, 'src/b.tf');
  assert.equal(paneOf(doc).querySelector('.hljs-keyword'), null);
  assert.equal(paneOf(doc).querySelector('.hd-dl-code').textContent, '+value = true');
});

test('a patch or highlighter resolving after navigation never touches the new selection or the retired body', async () => {
  await checkRows([
    { name: 'a patch resolving after navigation cannot append a body or start highlighting', run: async () => {
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const loaderCalls = [];
      const ctx = await bootDetail({
        detail: diffDetail(diffResults()),
        arms: (url) => (url.endsWith('/diff')
          ? gate.then(() => ({ ok: true, status: 200, text: async () => PATCH }))
          : null),
        hljsLoader: { async forLanguage(lang) { loaderCalls.push(lang); return null; } },
      });
      await openDetail(ctx);
      const retiredPane = paneOf(ctx.window.document);
      assert.equal(retiredPane.querySelector('.hd-diff-body'), null);
      go(ctx.window, 'new');   // leave Runs: a bare #history would restore this same run (D6)
      await settle(ctx.window);
      release();
      await settle(ctx.window, 6);
      assert.equal(retiredPane.querySelector('.hd-diff-body'), null);
      assert.deepEqual(loaderCalls, []);
    } },
    { name: 'a highlighter resolving after navigation leaves the retired plain body untouched', run: async () => {
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const ctx = await bootDetail({
        detail: diffDetail(diffResults()), arms: patchArm(PATCH),
        hljsLoader: { forLanguage: () => gate },
      });
      await openDetail(ctx);
      await settle(ctx.window);
      const retiredBody = paneOf(ctx.window.document).querySelector('.hd-diff-body');
      assert.ok(retiredBody);
      go(ctx.window, 'new');   // leave Runs: a bare #history would restore this same run (D6)
      await settle(ctx.window);
      release({
        lang: 'javascript',
        highlight: (text) => `<span class="hljs-keyword">${text}</span>`,
      });
      await settle(ctx.window, 6);
      assert.equal(retiredBody.querySelector('.hljs-keyword'), null);
      assert.equal(retiredBody.querySelector('.hd-dl-add .hd-dl-code').textContent, '+new');
    } },
  ]);
});

test('cross-extension rename uses the new path grammar and exposes both identities', async () => {
  const results = diffResults({
    results: {
      changedFiles: [{
        path: 'tools/new.py', from: 'tools/old.ts', status: 'R', added: 1, removed: 1,
      }],
    },
  });
  const patch = `diff --git a/tools/old.ts b/tools/new.py
similarity index 80%
rename from tools/old.ts
rename to tools/new.py
--- a/tools/old.ts
+++ b/tools/new.py
@@ -1 +1 @@
-const answer: number = 41;
+answer = 42
`;
  const calls = [];
  const loader = { async forLanguage(lang) { calls.push(lang); return null; } };
  const ctx = await bootDetail({ detail: diffDetail(results), arms: patchArm(patch), hljsLoader: loader });
  await openDetail(ctx);
  await settle(ctx.window, 5);
  const doc = ctx.window.document;
  assert.deepEqual(calls, ['python']);
  const heading = paneOf(doc).querySelector('h3.hd-diff-path');
  assert.equal(heading.textContent, 'tools/new.py');
  assert.equal(heading.title, 'tools/old.ts → tools/new.py');
  assert.equal(heading.getAttribute('aria-label'), 'Renamed from tools/old.ts to tools/new.py');
  for (const row of paneOf(doc).querySelectorAll('.hd-dl-row')) {
    assert.equal(row.dataset.oldPath, 'tools/old.ts');
    assert.equal(row.dataset.newPath, 'tools/new.py');
  }
});

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
// The Diff tab's size knobs (window.__worcaTestHooks, read once per app.js instance): a
// 50-row window and a 2,000-code-unit parse cap keep the windowing fixtures at ~60 rows.
// The production values stay pinned hook-free (the 5,001-row test below and the cap test).
const WIN = 50;
const SMALL = { diffWindowLines: WIN, maxSectionCodeUnits: 2000 };

test('the production window is 5,000 rows: 5,001 rows connect 5,000 plus a one-line show-more', async () => {
  const N = WINDOW + 1;
  const ctx = await bootDetail({
    detail: diffDetail(addedFileResults('prod.js', N)), arms: patchArm(addedLinesPatch('prod.js', N)),
  });
  await openDetail(ctx);
  await settle(ctx.window, 5);
  const doc = ctx.window.document;
  assert.equal(rowsOf(doc).length, WINDOW);
  assert.match(moreOf(doc).querySelector('.hd-dl-more-hint').textContent, /^5000 of 5001 lines shown$/);
  assert.equal(moreOf(doc).querySelector('button').textContent, 'Show 1 more line');
  // Four-digit numbers widen the gutter past its three-digit floor.
  assert.equal(bodyOf(doc).style.getPropertyValue('--hd-gutter-width'), 'calc(4ch + 16px)');
});

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
