import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitPatchSections, parseFileSection, patchIndex, sectionKey, hunkRange,
  MAX_FILE_SECTION_CODE_UNITS, MAX_FILE_SECTION_RENDER_ITEMS,
} from '../ui/public/diff-view.mjs';

const SIMPLE = `diff --git a/src/a.js b/src/a.js
index 111..222 100644
--- a/src/a.js
+++ b/src/a.js
@@ -1,3 +1,4 @@ top
 line1
-old
+new
+added
 line3
`;

test('splitPatchSections: one modified file', () => {
  const s = splitPatchSections(SIMPLE);
  assert.equal(s.length, 1);
  assert.equal(s[0].path, 'src/a.js');
  assert.equal(s[0].oldPath, 'src/a.js');
  assert.equal(s[0].project, null);
  assert.ok(s[0].raw.startsWith('diff --git'));
});

test('parseFileSection: hunks + line kinds', () => {
  const f = parseFileSection(splitPatchSections(SIMPLE)[0].raw);
  assert.equal(f.binary, false);
  assert.equal(f.truncated, false);
  assert.equal(f.hunks.length, 1);
  assert.equal(f.hunks[0].header, '@@ -1,3 +1,4 @@ top');
  assert.deepEqual(f.hunks[0].lines.map((l) => l.kind), ['ctx', 'del', 'add', 'add', 'ctx']);
  assert.equal(f.hunks[0].lines[1].text, 'old');
});

test('new + deleted files resolve path from the surviving side', () => {
  const txt = `diff --git a/gone.txt b/gone.txt
deleted file mode 100644
--- a/gone.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
diff --git a/fresh.txt b/fresh.txt
new file mode 100644
--- /dev/null
+++ b/fresh.txt
@@ -0,0 +1 @@
+hi
`;
  const s = splitPatchSections(txt);
  assert.equal(s[0].path, 'gone.txt');   // +++ is /dev/null -> old side
  assert.equal(s[1].path, 'fresh.txt');
});

test('rename keeps both paths', () => {
  const txt = `diff --git a/old-name.js b/new-name.js
similarity index 90%
rename from old-name.js
rename to new-name.js
--- a/old-name.js
+++ b/new-name.js
@@ -1 +1 @@
-x
+y
`;
  const [f] = splitPatchSections(txt);
  assert.equal(f.path, 'new-name.js');
  assert.equal(f.oldPath, 'old-name.js');
});

test('binary section is flagged, has no hunks, and STILL resolves a path', () => {
  const txt = `diff --git a/img.png b/img.png
index 111..222 100644
Binary files a/img.png and b/img.png differ
`;
  const [s] = splitPatchSections(txt);
  assert.equal(s.path, 'img.png', 'path falls back to the "diff --git" header');
  assert.ok(patchIndex([s]).get(sectionKey(null, 'img.png')), 'and is therefore indexable');
  const f = parseFileSection(s.raw);
  assert.equal(f.binary, true);
  assert.equal(f.hunks.length, 0);
});

test('mode-only section (no ---/+++ at all) still resolves a path', () => {
  const txt = `diff --git a/run.sh b/run.sh
old mode 100644
new mode 100755
`;
  const [s] = splitPatchSections(txt);
  assert.equal(s.path, 'run.sh');
  assert.equal(parseFileSection(s.raw).hunks.length, 0);
});

test('workspace "# <projectKey>" markers scope the project + separate sections', () => {
  // TWO blank lines before the second marker, not one. `git diff` output ends in
  // '\n' and orchestrator.mjs:3443 joins members with '\n\n', so the REAL seam is
  // `+y\n` + `\n\n` + `# proj-beta…` — three consecutive newlines. Modelling only
  // one blank line leaves the trailing-'' pop untested at the shape it exists for.
  const txt = `# proj-alpha-12345678
diff --git a/a.js b/a.js
--- a/a.js
+++ b/a.js
@@ -1 +1 @@
-x
+y


# proj-beta-87654321
diff --git a/a.js b/a.js
--- a/a.js
+++ b/a.js
@@ -1 +1 @@
-p
+q
`;
  const s = splitPatchSections(txt);
  assert.equal(s.length, 2);
  assert.equal(s[0].project, 'proj-alpha-12345678');
  assert.equal(s[1].project, 'proj-beta-87654321');
  const idx = patchIndex(s);
  assert.ok(idx.get(sectionKey('proj-alpha-12345678', 'a.js')));
  assert.ok(idx.get(sectionKey('proj-beta-87654321', 'a.js')));
  assert.notEqual(idx.get(sectionKey('proj-alpha-12345678', 'a.js')),
                  idx.get(sectionKey('proj-beta-87654321', 'a.js')));
  // the blank line from the '\n\n' member join must not become a phantom ctx row
  const f = parseFileSection(s[0].raw);
  assert.equal(f.hunks[0].lines.length, 2);
});

test('empty member patch (bare "# key" line) is tolerated', () => {
  const s = splitPatchSections(
    '# proj-alpha-12345678\n\n# proj-beta-87654321\ndiff --git a/b.js b/b.js\n--- a/b.js\n+++ b/b.js\n@@ -1 +1 @@\n-x\n+y\n');
  assert.equal(s.length, 1);
  assert.equal(s[0].project, 'proj-beta-87654321');
});

test('oversized section is truncated at a line boundary and flagged', () => {
  const big = 'diff --git a/big.txt b/big.txt\n--- a/big.txt\n+++ b/big.txt\n@@ -1,1 +1,1 @@\n'
    + '+x\n'.repeat(Math.ceil(MAX_FILE_SECTION_CODE_UNITS / 3));
  const f = parseFileSection(splitPatchSections(big)[0].raw);
  assert.equal(f.truncated, true);
  assert.ok(f.hunks.length >= 1);
  assert.ok(f.hunks[0].lines.every((l) => l.text === 'x'), 'no half-line at the cut');
});

test('one line longer than the cap -> truncated hunk with ZERO lines (no crash)', () => {
  // The only newline at or before the cap is the one ending the @@ header, so the
  // snap yields a hunk with an empty `lines` array. Pinned so no painter or test
  // ever assumes `truncated === true` implies at least one line (Task 6 iterates
  // hunk.lines, so it renders the header + the truncation note and nothing else).
  const big = 'diff --git a/one.txt b/one.txt\n--- a/one.txt\n+++ b/one.txt\n@@ -1 +1 @@\n'
    + '+' + 'x'.repeat(MAX_FILE_SECTION_CODE_UNITS + 10) + '\n';
  const f = parseFileSection(splitPatchSections(big)[0].raw);
  assert.equal(f.truncated, true);
  assert.equal(f.hunks.length, 1);
  assert.deepEqual(f.hunks[0].lines, []);
});

test('empty / junk input -> empty sections', () => {
  assert.deepEqual(splitPatchSections(''), []);
  assert.deepEqual(splitPatchSections('not a diff at all\njust text\n'), []);
});

test('hunkRange accepts unified headers and rejects unsafe or combined ranges', () => {
  assert.deepEqual(hunkRange('@@ -4,2 +9,3 @@ label'), {
    oldStart: 4, oldCount: 2, newStart: 9, newCount: 3,
  });
  assert.deepEqual(hunkRange('@@ -7 +8 @@\r'), {
    oldStart: 7, oldCount: 1, newStart: 8, newCount: 1,
  });
  assert.deepEqual(hunkRange('@@ -0,0 +0,0 @@'), {
    oldStart: 0, oldCount: 0, newStart: 0, newCount: 0,
  });
  assert.equal(hunkRange('@@ -0 +1 @@'), null);
  assert.equal(hunkRange('@@@ -1,1 -1,1 +1,1 @@@'), null);
  assert.equal(hunkRange(`@@ -${Number.MAX_SAFE_INTEGER},2 +1 @@`), null);
  assert.equal(hunkRange('@@ -9007199254740992 +1 @@'), null);
});

test('parser numbers both sides locally, resets hunks, and preserves CR source', () => {
  const parsed = parseFileSection([
    '@@ -2,3 +8,3 @@',
    ' context',
    '-old',
    '+new',
    ' tail',
    '\\ No newline at end of file',
    '@@ -20 +30 @@',
    '-gone\r',
    '+fresh\r',
  ].join('\n'));
  assert.deepEqual(parsed.hunks[0].lines, [
    { kind: 'ctx', text: 'context', oldNo: 2, newNo: 8 },
    { kind: 'del', text: 'old', oldNo: 3, newNo: null },
    { kind: 'add', text: 'new', oldNo: null, newNo: 9 },
    { kind: 'ctx', text: 'tail', oldNo: 4, newNo: 10 },
  ]);
  assert.deepEqual(parsed.hunks[1].lines, [
    { kind: 'del', text: 'gone\r', oldNo: 20, newNo: null },
    { kind: 'add', text: 'fresh\r', oldNo: null, newNo: 30 },
  ]);
});

test('malformed ranges have a stable null shape and never invent line numbers', () => {
  const parsed = parseFileSection('@@@ -1,1 -1,1 +1,1 @@@\n line\n-extra\n+extra');
  const hunk = parsed.hunks[0];
  assert.deepEqual(
    { oldStart: hunk.oldStart, oldCount: hunk.oldCount, newStart: hunk.newStart, newCount: hunk.newCount },
    { oldStart: null, oldCount: null, newStart: null, newCount: null },
  );
  assert.ok(hunk.lines.every((line) => line.oldNo === null && line.newNo === null));
});

test('declared side counts prevent overlong bodies from receiving extra numbers', () => {
  const parsed = parseFileSection('@@ -1 +1 @@\n one\n unexpected');
  assert.deepEqual(parsed.hunks[0].lines.map(({ oldNo, newNo }) => [oldNo, newNo]), [
    [1, 1], [null, null],
  ]);
});

test('render item cap stops on a row boundary and never exceeds the cap', () => {
  const lines = ['@@ -0,0 +1,6000 @@'];
  for (let i = 0; i < MAX_FILE_SECTION_RENDER_ITEMS; i += 1) lines.push(`+${i}`);
  const parsed = parseFileSection(lines.join('\n'));
  assert.equal(parsed.truncated, true);
  const retained = parsed.hunks.length + parsed.hunks.reduce((n, hunk) => n + hunk.lines.length, 0);
  assert.equal(retained, MAX_FILE_SECTION_RENDER_ITEMS);
  assert.equal(parsed.hunks[0].lines.at(-1).newNo, MAX_FILE_SECTION_RENDER_ITEMS - 1);
});

test('section cap is deliberately measured in UTF-16 code units', () => {
  const source = '😀'.repeat(Math.ceil(MAX_FILE_SECTION_CODE_UNITS / 2) + 10);
  const parsed = parseFileSection(`@@ -0,0 +1 @@\n+${source}`);
  assert.equal(parsed.truncated, true);
  if (parsed.hunks[0]?.lines[0]) {
    const text = parsed.hunks[0].lines[0].text;
    assert.ok(!/[\uD800-\uDBFF]$/.test(text), 'a mid-line cut never leaves a lone high surrogate');
  }
});
