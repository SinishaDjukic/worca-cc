// test/diff-anchor.test.mjs
// The ONE anchor resolver behind POST …/comments and add_diff_comment. Pure: it
// takes patch text, so no home and no DB — the test/diff-view.test.mjs shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAnchor, hunkContext, patchMembers, AnchorError } from '../src/core/diff-anchor.mjs';

const SIMPLE = `diff --git a/src/a.js b/src/a.js
--- a/src/a.js
+++ b/src/a.js
@@ -1,3 +1,4 @@
 keep
-old
+new
+added
 line3
`;

const WS = `# proj-a-00000001
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

test('patchMembers: markers only, in order, deduped', () => {
  assert.deepEqual(patchMembers(SIMPLE), []);
  assert.deepEqual(patchMembers(WS), ['proj-a-00000001', 'proj-b-00000002']);
});

test('resolveAnchor: add/ctx anchor on the new side, del on the old side', () => {
  assert.deepEqual(resolveAnchor(SIMPLE, { path: 'src/a.js', side: 'new', line: 2 }),
    { project: null, path: 'src/a.js', oldPath: 'src/a.js', side: 'new', line: 2, lineText: 'new' });
  assert.equal(resolveAnchor(SIMPLE, { path: 'src/a.js', side: 'new', line: 3 }).lineText, 'added');
  assert.equal(resolveAnchor(SIMPLE, { path: 'src/a.js', side: 'old', line: 2 }).lineText, 'old', 'the deleted row');
  assert.equal(resolveAnchor(SIMPLE, { path: 'src/a.js', side: 'old', line: 1 }).lineText, 'keep', 'a ctx row has both sides');
  assert.equal(resolveAnchor(SIMPLE, { path: 'src/a.js', side: 'new', line: 1 }).lineText, 'keep');
  assert.equal(resolveAnchor(SIMPLE, { path: 'src/a.js', side: 'new', line: 4 }).lineText, 'line3',
    'the trailing ctx row is newNo 4 (old 3) — the +1 the hunk header promises');
});

test('resolveAnchor: every refusal is an AnchorError with an actionable message', () => {
  const bad = (input, re) => assert.throws(() => resolveAnchor(SIMPLE, input), (e) => {
    assert.equal(e.name, 'AnchorError');
    assert.match(e.message, re);
    return true;
  }, JSON.stringify(input));
  bad({ path: 'nope.js', side: 'new', line: 1 }, /not a file of this run's diff/);
  bad({ path: 'src/a.js', side: 'sideways', line: 1 }, /side must be/);
  bad({ path: 'src/a.js', side: 'new', line: 0 }, /positive integer/);
  bad({ path: 'src/a.js', side: 'new', line: 99 }, /no new-side line 99/);
  bad({ path: 'src/a.js', side: 'old', line: 4 }, /no old-side line 4/);
  bad({ path: '', side: 'new', line: 1 }, /path is required/);
  bad({ path: 'src/a.js', side: 'new', line: 1, project: 'proj-a-00000001' }, /single project/);
});

test('resolveAnchor: an ADDED row has no old-side number', () => {
  // '+new' is newNo 2 with oldNo null; old-side 2 is the DELETED row, and there is
  // no old-side row whose number is 4 at all.
  assert.equal(resolveAnchor(SIMPLE, { path: 'src/a.js', side: 'old', line: 2 }).lineText, 'old');
  assert.throws(() => resolveAnchor(SIMPLE, { path: 'src/a.js', side: 'old', line: 4 }), /no old-side line 4/);
});

test('resolveAnchor: a workspace patch REQUIRES the member and never infers it', () => {
  assert.throws(() => resolveAnchor(WS, { path: 'a.js', side: 'new', line: 1 }),
    /workspace run.*proj-a-00000001, proj-b-00000002/);
  assert.throws(() => resolveAnchor(WS, { path: 'a.js', side: 'new', line: 1, project: 'ghost-00000003' }),
    /unknown member project/);
  assert.equal(resolveAnchor(WS, { path: 'a.js', side: 'new', line: 1, project: 'proj-a-00000001' }).lineText, 'alpha');
  assert.equal(resolveAnchor(WS, { path: 'a.js', side: 'new', line: 1, project: 'proj-b-00000002' }).lineText, 'beta');
});

// A DISTINCT fixture, not a `WS.replace(...)` of the `diff --git` line: splitPatchSections
// takes `path` from the `+++ b/…` header (diff-view.mjs:69-71) and only falls back to the
// `diff --git` header when `path` is still null (:85). Rewriting the header alone would leave
// member b's section keyed on a.js, resolveAnchor would find it, and the assert.throws below
// could never fire.
const WS_SPLIT = `# proj-a-00000001
diff --git a/a.js b/a.js
--- a/a.js
+++ b/a.js
@@ -1 +1 @@
-one
+alpha

# proj-b-00000002
diff --git a/b.js b/b.js
--- a/b.js
+++ b/b.js
@@ -0,0 +1 @@
+beta
`;

test('resolveAnchor: a member that does not hold the path names the ones that do', () => {
  assert.equal(resolveAnchor(WS_SPLIT, { path: 'b.js', side: 'new', line: 1, project: 'proj-b-00000002' }).lineText,
    'beta', 'precondition: member b really holds b.js and NOT a.js');
  assert.throws(() => resolveAnchor(WS_SPLIT, { path: 'a.js', side: 'new', line: 1, project: 'proj-b-00000002' }),
    /is in: proj-a-00000001/);
});

test('resolveAnchor: binary and hunk-less sections are refused', () => {
  // splitPatchSections falls back to the "diff --git" header for the path
  // (diff-view.mjs:85), so a binary section IS in patchIndex — the refusal comes
  // from parseFileSection's `binary` flag, not from a missing section.
  const bin = 'diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n';
  assert.throws(() => resolveAnchor(bin, { path: 'x.png', side: 'new', line: 1 }), /no textual diff/);
});

test('resolveAnchor: a protected path is refused on BOTH rename sides', () => {
  const renamed = `diff --git a/config/.env b/config/env.sample
similarity index 90%
rename from config/.env
rename to config/env.sample
--- a/config/.env
+++ b/config/env.sample
@@ -1 +1 @@
-SECRET=1
+SECRET=changeme
`;
  assert.throws(() => resolveAnchor(renamed, { path: 'config/env.sample', side: 'new', line: 1 }),
    /protected path/, 'blocked on the OLD name even though the new name is innocent');
});

test('resolveAnchor: a row past the 500k parse cap fails exactly as it fails to render', () => {
  // The cap slices the RAW TEXT before parsing (diff-view.mjs:116-129), so the
  // hunk survives but its tail rows are gone. Early lines still resolve.
  const filler = Array.from({ length: 60_000 }, (_, i) => ` line ${i} ${'x'.repeat(10)}`).join('\n');
  const big = `diff --git a/big.txt b/big.txt\n--- a/big.txt\n+++ b/big.txt\n@@ -1,60000 +1,60000 @@\n${filler}\n`;
  assert.ok(big.length > 500_000, 'fixture really is over the cap');
  assert.doesNotThrow(() => resolveAnchor(big, { path: 'big.txt', side: 'new', line: 1 }));
  assert.throws(() => resolveAnchor(big, { path: 'big.txt', side: 'new', line: 59_999 }), /no new-side line/);
});

// Real `git -c core.quotePath=false diff -M -l0 --no-color --no-ext-diff
// --submodule=short --src-prefix=a/ --dst-prefix=b/` output for a file named
// `old<TAB>secret.pem` renamed to `plain.txt`. quotePath=false does NOT stop this:
// git C-quotes any name holding '"', '\', a tab or a control byte regardless, and
// patches persisted before the pin (git-info.mjs:127) quote every non-ASCII name.
const QUOTED_RENAME = `diff --git "a/old\\tsecret.pem" b/plain.txt
similarity index 63%
rename from "old\\tsecret.pem"
rename to plain.txt
index 1781c2d..e9005ee 100644
--- "a/old\\tsecret.pem"
+++ b/plain.txt
@@ -1,3 +1,3 @@
 AAA
 SECRET=hunter2
-CCC
+CCC-edited
`;

// Both sides quoted: the section is keyed on the quoted literal, so only a caller
// that already holds that string can name it.
const QUOTED_BOTH = `diff --git "a/tab\\tname.pem" "b/tab\\tname.pem"
index 04ec35a..d455f7f 100644
--- "a/tab\\tname.pem"
+++ "b/tab\\tname.pem"
@@ -1,3 +1,3 @@
 x
-y
+yy
 z
`;

test('resolveAnchor: a C-quoted path is refused — the floor cannot read it, so it fails CLOSED', () => {
  // splitPatchSections keeps `"old\tsecret.pem"` verbatim (diff-view.mjs:72-73,
  // 105-109), so isProtectedBasename tests the QUOTED string against `*.pem` and
  // says no. get_run_diff has no such hole (splitUnifiedDiff un-C-quotes), and the
  // new name is the plain, browser-listed `plain.txt` — so without this refusal a
  // comment on old-side 2 persists `SECRET=hunter2` as its line_text.
  assert.throws(() => resolveAnchor(QUOTED_RENAME, { path: 'plain.txt', side: 'old', line: 2 }),
    (e) => {
      assert.equal(e.name, 'AnchorError');
      assert.match(e.message, /git-quoted name/);
      assert.doesNotMatch(e.message, /hunter2/, 'the refusal never echoes the row it refused');
      return true;
    });
  // …and on the new side of the same section, which renders under an innocent name.
  assert.throws(() => resolveAnchor(QUOTED_RENAME, { path: 'plain.txt', side: 'new', line: 3 }), /git-quoted name/);
  // Both sides quoted: refused under the quoted literal too, never resolved.
  assert.throws(() => resolveAnchor(QUOTED_BOTH, { path: '"b/tab\\tname.pem"', side: 'new', line: 2 }), /git-quoted name/);
  // The REAL name is simply absent — the pre-existing behaviour, unchanged.
  assert.throws(() => resolveAnchor(QUOTED_BOTH, { path: 'tab\tname.pem', side: 'new', line: 2 }),
    /is not a file of this run's diff/);
});

test('hunkContext: `radius` rows either side, clipped at the hunk edges, with side markers', () => {
  assert.deepEqual(hunkContext(SIMPLE, { path: 'src/a.js', side: 'new', line: 2 }, 1),
    ['-old', '+new', '+added']);
  // radius 3 around index 3 of a 5-row hunk clips to the whole hunk.
  assert.deepEqual(hunkContext(SIMPLE, { path: 'src/a.js', side: 'new', line: 3 }, 3),
    [' keep', '-old', '+new', '+added', ' line3']);
  assert.deepEqual(hunkContext('not a patch', { path: 'x', side: 'new', line: 1 }), []);
  assert.deepEqual(hunkContext(SIMPLE, { path: 'src/a.js', side: 'new', line: 99 }, 3), [],
    'an unresolvable anchor yields no context, never a guess');
});

test('resolveAnchor: past the parse cap the refusal says CAP, not "no such line"', () => {
  const filler = Array.from({ length: 60_000 }, (_, i) => ` line ${i} ${'x'.repeat(10)}`).join('\n');
  const big = `diff --git a/big.txt b/big.txt\n--- a/big.txt\n+++ b/big.txt\n@@ -1,60000 +1,60000 @@\n${filler}\n`;
  assert.ok(big.length > 500_000, 'fixture really is over the cap');
  assert.throws(() => resolveAnchor(big, { path: 'big.txt', side: 'new', line: 59_999 }), (e) => {
    assert.match(e.message, /first 500000 characters/, 'names the cap that actually stopped the read');
    assert.match(e.message, /get_run_diff can page to it/, 'and says the row may still be readable there');
    return true;
  });
  // A line inside the parsed range that genuinely does not exist keeps the plain
  // message — the cap is only mentioned when the cap is the reason.
  const short = `diff --git a/s.txt b/s.txt\n--- a/s.txt\n+++ b/s.txt\n@@ -1,1 +1,1 @@\n-a\n+b\n`;
  assert.throws(() => resolveAnchor(short, { path: 's.txt', side: 'new', line: 9 }),
    (e) => { assert.match(e.message, /has no new-side line 9 in this run's diff$/); return true; });
});

test('resolveAnchor: the "holders" hint never names a member whose section is guarded', () => {
  const ws = `# alpha-00000001
diff --git a/.env b/.env
--- a/.env
+++ b/.env
@@ -1 +1 @@
-TOKEN=old
+TOKEN=new

# beta-00000002
diff --git a/b.js b/b.js
--- a/b.js
+++ b/b.js
@@ -0,0 +1 @@
+beta
`;
  assert.throws(() => resolveAnchor(ws, { project: 'beta-00000002', path: '.env', side: 'new', line: 1 }), (e) => {
    assert.match(e.message, /is not a file of this run's diff/, 'no existence oracle for a file get_run_diff never lists');
    assert.doesNotMatch(e.message, /alpha-00000001/, 'and the owning member is not named either');
    return true;
  });
  // The hint still fires for a member holding an ordinary file.
  assert.throws(() => resolveAnchor(ws, { project: 'alpha-00000001', path: 'b.js', side: 'new', line: 1 }),
    /is in: beta-00000002/);
});

test('resolveAnchor: a fractional line is refused, not silently truncated', () => {
  for (const line of [3.9, '3.9', 2.5, 1.0000001]) {
    assert.throws(() => resolveAnchor(SIMPLE, { path: 'src/a.js', side: 'new', line }),
      /line must be a positive integer/, JSON.stringify(line));
  }
  // Integer-valued strings and floats still resolve — only the fraction is new.
  assert.equal(resolveAnchor(SIMPLE, { path: 'src/a.js', side: 'new', line: '2' }).lineText, 'new');
  assert.equal(resolveAnchor(SIMPLE, { path: 'src/a.js', side: 'new', line: 2.0 }).lineText, 'new');
});
