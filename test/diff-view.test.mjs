import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitPatchSections, parseFileSection, patchIndex, sectionKey, MAX_FILE_SECTION_BYTES,
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
    + '+x\n'.repeat(Math.ceil(MAX_FILE_SECTION_BYTES / 3));
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
    + '+' + 'x'.repeat(MAX_FILE_SECTION_BYTES + 10) + '\n';
  const f = parseFileSection(splitPatchSections(big)[0].raw);
  assert.equal(f.truncated, true);
  assert.equal(f.hunks.length, 1);
  assert.deepEqual(f.hunks[0].lines, []);
});

test('empty / junk input -> empty sections', () => {
  assert.deepEqual(splitPatchSections(''), []);
  assert.deepEqual(splitPatchSections('not a diff at all\njust text\n'), []);
});
