// test/ask-tools.test.mjs
// P1/T12: the worca MCP tools (ask-worca-design.md §6.4) — pure helpers, handlers
// over fake readers, one temp-home round trip over the real readers, and the
// read-only source scan (§6.1).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';
import { seedPipeline, seedWorkspacePipeline } from './helpers/db-seed.mjs';
import { createAskTools, AskToolError, splitUnifiedDiff, isProtectedBasename, sliceBytes, isByteArtifact } from '../src/core/ask/tools.mjs';
import { viewerKindFor, BINARY_KINDS } from '../src/shared/artifact-kinds.mjs';
import { defaultToolDeps } from '../src/core/ask/tool-deps.mjs';
import { closeDb } from '../src/core/db.mjs';
import { addProject } from '../src/core/projects.mjs';
import { createThread, appendMessage, addAttachment, updateThread } from '../src/core/ask/store.mjs';
import { scopeRefusalText } from '../src/core/ask/scope.mjs';
import { GUARDRAIL_PRESETS } from '../src/core/guardrails.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { redactAskText } from '../src/core/ask/redact.mjs';
import { htmlToText } from '../src/core/ask/html-text.mjs';

useTempHome(after);

const DIFF = [
  'diff --git a/src/app.js b/src/app.js',
  'index 1..2 100644',
  '--- a/src/app.js',
  '+++ b/src/app.js',
  '@@ -1,2 +1,3 @@',
  ' keep',
  '-old line',
  '+new line',
  '+another',
  'diff --git a/config/.env b/config/.env',
  '--- /dev/null',
  '+++ b/config/.env',
  '@@ -0,0 +1 @@',
  '+API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz',
  'diff --git a/docs/notes.md b/docs/notes.md',
  '--- a/docs/notes.md',
  '+++ b/docs/notes.md',
  '@@ -1 +1 @@',
  '-ghp_abcdefghijklmnopqrstuvwxyz0123456789',
  '+clean',
  '',
].join('\n');

test('splitUnifiedDiff: per-file sections, counts, workspace member headers carry the project key', () => {
  const s = splitUnifiedDiff(DIFF);
  assert.deepEqual(s.map((x) => [x.path, x.added, x.removed]), [['src/app.js', 2, 1], ['config/.env', 1, 0], ['docs/notes.md', 1, 1]]);
  assert.equal(s.map((x) => x.text).join(''), DIFF, 'sections concatenate back to the input');
  const ws = splitUnifiedDiff(`# alpha-00000001\n${DIFF}# zeta-00000002\ndiff --git a/z.txt b/z.txt\n+++ b/z.txt\n+z\n`);
  assert.deepEqual(ws.map((x) => [x.path, x.projectKey]), [
    [null, 'alpha-00000001'], ['src/app.js', 'alpha-00000001'], ['config/.env', 'alpha-00000001'], ['docs/notes.md', 'alpha-00000001'],
    [null, 'zeta-00000002'], ['z.txt', 'zeta-00000002'],
  ]);
  assert.deepEqual(splitUnifiedDiff('').length, 0);
  assert.deepEqual(splitUnifiedDiff('just text\n'), [{ path: null, oldPath: null, projectKey: null, member: false, header: false, added: 0, removed: 0, text: 'just text\n' }]);
});

// core.quotePath=true (git's default) C-quotes non-ASCII paths, and quotes each
// side INDEPENDENTLY on a rename. Missing that shape appended the file's body to
// the previous section: its + lines were miscounted AND it escaped the
// protected-path filter, so a `clé.pem` leaked whole.
const QUOTED_DIFF = [
  'diff --git a/README.md b/README.md',
  '--- a/README.md',
  '+++ b/README.md',
  '@@ -1 +1,3 @@',
  ' a',
  '+b',
  '+c',
  'diff --git "a/cl\\303\\251.pem" "b/cl\\303\\251.pem"',
  '--- "a/cl\\303\\251.pem"',
  '+++ "b/cl\\303\\251.pem"',
  '@@ -1 +1,2 @@',
  ' SECRET=hunter2',
  '+MORE=1',
  '',
].join('\n');

test('splitUnifiedDiff: C-quoted paths are unescaped, each side quoted independently', () => {
  const s = splitUnifiedDiff(QUOTED_DIFF);
  assert.deepEqual(s.map((x) => [x.path, x.added, x.removed]), [['README.md', 2, 0], ['clé.pem', 1, 0]],
    'the quoted file starts its own section and README keeps its own counts');
  assert.equal(s.map((x) => x.text).join(''), QUOTED_DIFF, 'sections concatenate back to the input');
  // a rename quotes only the side that needs it
  const ren = splitUnifiedDiff('diff --git a/README.md "b/ren\\303\\245med.md"\nsimilarity index 100%\nrename from README.md\nrename to "ren\\303\\245med.md"\n');
  assert.deepEqual(ren.map((x) => x.path), ['renåmed.md']);
  // every C escape git emits: octal bytes, \t, \" and \\
  const odd = splitUnifiedDiff('diff --git "a/we\\tird \\"q\\\\z.key" "b/we\\tird \\"q\\\\z.key"\n+++ "b/we\\tird \\"q\\\\z.key"\n+x\n');
  assert.deepEqual(odd.map((x) => x.path), ['we\tird "q\\z.key']);
  // a quoted `+++ ` line resolves the path of a section whose HEADER could not be
  // read (headerless sections resolve nothing — see the label-precedence test below)
  assert.deepEqual(splitUnifiedDiff('diff --git !weird!\n+++ "b/caf\\303\\251.env"\n+X=1\n').map((x) => x.path), ['café.env']);
  // git tab-terminates a ---/+++ name that contains a space, so the quotes only
  // close before the tab; an end-anchored match left them in and never unquoted.
  assert.deepEqual(splitUnifiedDiff('diff --git !weird!\n+++ "b/caf\\303\\251 x.env"\t\n+A=1\n').map((x) => x.path), ['café x.env']);
});

// The a/ … b/ prefixes are a git SETTING, not a constant: diff.noprefix,
// diff.mnemonicPrefix (c/ … w/), diff.srcPrefix/dstPrefix and diff.external all
// change or drop them, and they come from the user's own ~/.gitconfig. diffPatch
// now pins them, but patches persisted before that cannot be regenerated, so the
// parser must fail closed rather than glue an unreadable file onto its neighbour.
const NOPREFIX_DIFF = [
  'diff --git aaa.txt aaa.txt',
  '--- a/aaa.txt',
  '+++ aaa.txt',
  '@@ -1 +1,2 @@',
  ' a',
  '+b',
  'diff --git secrets/db.json secrets/db.json',
  '--- /dev/null',
  '+++ secrets/db.json',
  '@@ -0,0 +1 @@',
  '+DB_PASSWORD=hunter2',
  'diff --git zserver.pem zserver.pem',
  '--- /dev/null',
  '+++ zserver.pem',
  '@@ -0,0 +1 @@',
  '+PRIVATE KEY MATERIAL',
  '',
].join('\n');

test('splitUnifiedDiff: every `diff --git ` line starts a section; an unreadable header yields path:null and never absorbs the next file', async () => {
  await checkRows([
    { name: 'splitUnifiedDiff: EVERY `diff --git ` line starts a section, prefixes or not', run: async () => {
      const s = splitUnifiedDiff(NOPREFIX_DIFF);
      assert.deepEqual(s.map((x) => [x.path, x.added, x.removed]),
        [['aaa.txt', 1, 0], ['secrets/db.json', 1, 0], ['zserver.pem', 1, 0]],
        'three sections with their own counts — not one section charging +3 to aaa.txt');
      assert.equal(s.map((x) => x.text).join(''), NOPREFIX_DIFF, 'sections concatenate back to the input');
    } },
    { name: 'splitUnifiedDiff: a header whose path cannot be read yields path:null, and never absorbs the next file', run: async () => {
      const patch = 'diff --git a/ok.md b/ok.md\n+++ b/ok.md\n@@ -0,0 +1 @@\n+fine\n'
        + 'diff --git !weird!\nBinary files differ\nDB_PASSWORD=hunter2\n';
      assert.deepEqual(splitUnifiedDiff(patch).map((x) => [x.path, x.member]), [['ok.md', false], [null, false]]);
      // a member header is a section of its own: an unreadable body cannot ride inside it
      const ws = splitUnifiedDiff('# app-00000001\ndiff --git secrets/db.json secrets/db.json\n+++ secrets/db.json\n+DB_PASSWORD=hunter2\n');
      assert.deepEqual(ws.map((x) => [x.path, x.projectKey, x.member]), [[null, 'app-00000001', true], ['secrets/db.json', 'app-00000001', false]]);
    } },
  ]);
});

// A patch with no `diff --git ` line at all (a legacy external-diff patch, or the
// inner patch of `diff.submodule=diff`) is ONE section, because nothing else starts
// one. Reading its path from the first `--- `/`+++ ` label therefore names the whole
// run after the first file, and every later file — credential files included —
// rides inside it under that harmless name.
const LEGACY_EXTERNAL_DIFF = [
  '--- /tmp/git-blob-1/aaa.txt',
  '+++ /tmp/git-blob-2/aaa.txt',
  '@@ -1 +1 @@',
  '+top changed',
  '--- /tmp/git-blob-3/.env',
  '+++ /tmp/git-blob-4/.env',
  '@@ -1 +1 @@',
  '+A=SK-LIVE-REALSECRET-0001',
  '',
].join('\n');

test('splitUnifiedDiff: header ambiguity — only a diff --git section may take a ---/+++ label, the header is read only when unambiguous, and the section\'s own +++ wins', async () => {
  await checkRows([
    { name: 'splitUnifiedDiff: only a `diff --git ` section may take its path from a `--- `/`+++ ` label', run: async () => {
      assert.deepEqual(splitUnifiedDiff(LEGACY_EXTERNAL_DIFF).map((x) => x.path), [null],
        'one unattributable section — not a section named aaa.txt carrying the .env body');
      // a relative label is no better: with no header the diff TOOL chose the shape, so
      // the label is a claim about a file, not git's own name for the section
      assert.deepEqual(splitUnifiedDiff('--- aaa.txt\n+++ aaa.txt\n@@ -1 +1 @@\n+x\n--- .env\n+++ .env\n+A=SECRET\n')
        .map((x) => x.path), [null]);
      // …while a real header keeps the label precedence of the tests above intact
      assert.deepEqual(splitUnifiedDiff('diff --git !weird!\n+++ "b/caf\\303\\251.env"\n+X=1\n').map((x) => x.path), ['café.env']);
    } },
    { name: 'splitUnifiedDiff: a `diff --git ` header is read only where it is unambiguous', run: async () => {
      // rename out of a directory named `a b`: a lazy first-match read the path as
      // `x.txt "b/we\"ird.pem"`, which matches no guardrail pattern, so the .pem leaked.
      assert.deepEqual(splitUnifiedDiff('diff --git a/a b/x.txt "b/we\\"ird.pem"\n+K=1\n').map((x) => x.path), ['we"ird.pem']);
      // `a/<p> b/<p>`: the separator is fixed by the lengths, so the WHOLE path is read
      // — a last-` b/` cut returned `x.txt` here, and the guardrail patterns that carry
      // a slash (`**/secrets/**`) stopped matching.
      assert.deepEqual(splitUnifiedDiff('diff --git a/dir b/x.txt b/dir b/x.txt\n+K=1\n').map((x) => x.path), ['dir b/x.txt']);
      assert.deepEqual(splitUnifiedDiff('diff --git a/secrets/plan b/creds.json b/secrets/plan b/creds.json\n+K=1\n').map((x) => x.path),
        ['secrets/plan b/creds.json']);
      // a rename is not two equal halves: with ` b/` inside a side the header is a
      // guess, so it yields no path at all (the section is then dropped by get_run_diff)
      assert.deepEqual(splitUnifiedDiff('diff --git a/a b/old.pem b/plain.txt\n+K=1\n').map((x) => x.path), [null]);
      // an ordinary rename has exactly one ` b/` — nothing else can be the separator
      assert.deepEqual(splitUnifiedDiff('diff --git a/old.txt b/new.txt\n+K=1\n').map((x) => x.path), ['new.txt']);
    } },
    { name: 'splitUnifiedDiff: the section`s own `+++ ` line wins over the ambiguous header', run: async () => {
      // git tab-terminates a name that needs it, so `+++ ` is exact where the header
      // is a guess. Before this, the header won whenever it parsed to anything at all.
      const p = 'diff --git a/dir b/x.txt b/dir b/x.txt\n--- a/dir b/x.txt\t\n+++ b/dir b/x.txt\t\n@@ -1 +1 @@\n+K=1\n';
      assert.deepEqual(splitUnifiedDiff(p).map((x) => x.path), ['dir b/x.txt']);
      // …but only the b-side: the a-side is still a rename out of `old.pem`, which
      // get_run_diff drops on the OLD name (see the rename tests below).
      assert.deepEqual(splitUnifiedDiff('diff --git a/a b/old.pem b/plain.txt\n+++ b/plain.txt\n@@ -1 +1 @@\n+K=1\n').map((x) => [x.path, x.oldPath]),
        [['plain.txt', 'a b/old.pem']]);
      // …but only in the extended header: past the first `@@` a `+++ ` line is body
      // content (a diff of a diff), so it can never re-point a section at a safe path.
      const body = splitUnifiedDiff('diff --git a/config/.env b/config/.env\n+++ b/config/.env\n@@ -0,0 +1,2 @@\n+++ b/harmless.md\n+K=1\n');
      assert.deepEqual(body.map((x) => [x.path, x.added]), [['config/.env', 2]], 'and both body lines count as added');
    } },
  ]);
});

// `diffPatch` passes `-M` (git-info.mjs:127), so a rename+edit of a credential file
// is ONE section: the b-side is the harmless new name while the `-`/context lines
// are the old file's content. The old side has to be readable to be filtered.
test('splitUnifiedDiff: a section records its OLD path — `rename from`, then the `--- ` label, then the header a-side', () => {
  const renamed = [
    'diff --git a/config/.env b/config/env.sample',
    'similarity index 95%',
    'rename from config/.env',
    'rename to config/env.sample',
    '--- a/config/.env',
    '+++ b/config/env.sample',
    '@@ -1,2 +1,2 @@',
    '-API_KEY=sk-live-REALSECRET-0001',
    '+API_KEY=xxx',
    '',
  ].join('\n');
  assert.deepEqual(splitUnifiedDiff(renamed).map((x) => [x.path, x.oldPath]), [['config/env.sample', 'config/.env']]);
  // the header is a guess (` b/` inside a side) but the tab-terminated `--- ` label is exact
  assert.deepEqual(splitUnifiedDiff('diff --git a/a b/old.pem b/plain.txt\n--- a/a b/old.pem\t\n+++ b/plain.txt\n@@ -1 +1 @@\n K=1\n')
    .map((x) => [x.path, x.oldPath]), [['plain.txt', 'a b/old.pem']]);
  // …and with neither, the a-side falls out of the header once the `+++ ` line pins the b-side
  assert.deepEqual(splitUnifiedDiff('diff --git a/a b/old.pem b/plain.txt\n+++ b/plain.txt\n@@ -1 +1 @@\n+K=1\n')
    .map((x) => [x.path, x.oldPath]), [['plain.txt', 'a b/old.pem']]);
  // an unambiguous header pins both sides on its own
  assert.deepEqual(splitUnifiedDiff('diff --git a/old.txt b/new.txt\n+K=1\n').map((x) => [x.path, x.oldPath]), [['new.txt', 'old.txt']]);
  assert.deepEqual(splitUnifiedDiff('diff --git a/dir b/x.txt b/dir b/x.txt\n+K=1\n').map((x) => [x.path, x.oldPath]), [['dir b/x.txt', 'dir b/x.txt']]);
  // each side is C-quoted independently, and `rename from` carries no a/ prefix
  assert.deepEqual(splitUnifiedDiff('diff --git "a/cl\\303\\251.pem" b/plain.txt\nrename from "cl\\303\\251.pem"\nrename to plain.txt\n+K=1\n')
    .map((x) => [x.path, x.oldPath]), [['plain.txt', 'clé.pem']]);
  assert.deepEqual(splitUnifiedDiff('diff --git a/README.md "b/ren\\303\\245med.md"\nrename from README.md\n+K=1\n')
    .map((x) => [x.path, x.oldPath]), [['renåmed.md', 'README.md']]);
  // `--- /dev/null` is not a path: an added file keeps the header's own a-side
  assert.deepEqual(splitUnifiedDiff('diff --git a/n.txt b/n.txt\n--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1 @@\n+x\n').map((x) => x.oldPath), ['n.txt']);
  // past the first `@@` a `--- `/`rename from ` line is body content, never a path
  const body = splitUnifiedDiff('diff --git a/a.md b/a.md\n+++ b/a.md\n@@ -1 +1 @@\n--- a/id_rsa\n+rename from id_rsa\n');
  assert.deepEqual(body.map((x) => [x.path, x.oldPath]), [['a.md', 'a.md']]);
  assert.equal(splitUnifiedDiff('just text\n')[0].oldPath, null);
});

test('splitUnifiedDiff: `+`/`-` body lines are counted even when they start `+++`/`---`', () => {
  // only the two extended-header lines are excluded: a removed YAML front-matter
  // `---` and an added `++i;` are real content.
  const s = splitUnifiedDiff('diff --git a/a.md b/a.md\n--- a/a.md\n+++ b/a.md\n@@ -1,2 +1,2 @@\n----\n+++x\n');
  assert.deepEqual(s.map((x) => [x.path, x.added, x.removed]), [['a.md', 1, 1]]);
});

test('isProtectedBasename: the normal-tier patterns (* prefix/suffix), slash patterns match the whole path, ~/ and // skipped', async () => {
  await checkRows([
    { name: 'isProtectedBasename: the seven normal-tier patterns, * prefix/suffix only', run: async () => {
      const pats = GUARDRAIL_PRESETS.normal.protectedPaths;
      for (const hit of ['.env', '.env.local', '.envrc', 'server.pem', 'id_rsa', 'id_ed25519', 'x.key', 'bundle.p12', 'cert.pfx']) {
        assert.ok(isProtectedBasename(hit, pats), hit);
      }
      for (const miss of ['env', 'environment.md', 'key.txt', 'id_rsa.pub', 'README.md', 'pem']) assert.ok(!isProtectedBasename(miss, pats), miss);
      assert.ok(isProtectedBasename('a-secret-b', ['*secret*']));
      assert.ok(!isProtectedBasename('x', []));
      // slash-less patterns match the basename at ANY depth, as the CLI does
      assert.ok(isProtectedBasename('deploy/prod/.env.local', pats));
      assert.ok(isProtectedBasename('certs/server.pem', pats));
      assert.ok(!isProtectedBasename('.env/README.md', pats), 'a protected name as a DIRECTORY does not protect its children');
    } },
    { name: 'isProtectedBasename: slash-containing patterns match the whole path; ~/ and // patterns are skipped', run: async () => {
      const pats = GUARDRAIL_PRESETS.secure.protectedPaths;
      for (const hit of ['.git/config', 'sub/dir/.git/config', 'secrets/db.json', 'app/secrets/deep/x.yml', '.npmrc', 'infra/.netrc',
        'env/main.tfstate', 'env/main.tfstate.backup', 'android/app.keystore', 'x.jks']) {
        assert.ok(isProtectedBasename(hit, pats), hit);
      }
      for (const miss of ['config', 'src/config.js', 'secrets.md', 'src/secretstuff/x.js', 'docs/git/config']) {
        assert.ok(!isProtectedBasename(miss, pats), miss);
      }
      // ~/… and //… are absolute: they can never name a file inside a run diff
      assert.ok(!isProtectedBasename('.ssh/id_rsa.pub', ['~/.ssh/**']));
      assert.ok(!isProtectedBasename('etc/passwd', ['//etc/**']));
      // a trailing-anchor pattern without the **/ prefix anchors at the repo root
      assert.ok(isProtectedBasename('secrets/x', ['secrets/**']));
      assert.ok(!isProtectedBasename('a/secrets/x', ['secrets/**']));
    } },
  ]);
});

test('sliceBytes: pages on byte offsets at a newline, never splits a UTF-8 sequence, and always advances', async () => {
  await checkRows([
    { name: 'sliceBytes: pages on byte offsets, cuts at a newline, never splits a UTF-8 sequence', run: async () => {
      const text = 'line one\nline two\nline three\n';
      const p1 = sliceBytes(text, 0, 12);
      assert.deepEqual(p1, { text: 'line one\n', nextOffset: 9, truncated: true, totalBytes: 29 });
      const p2 = sliceBytes(text, p1.nextOffset, 12);
      assert.deepEqual(p2, { text: 'line two\n', nextOffset: 18, truncated: true, totalBytes: 29 });
      const p3 = sliceBytes(text, p2.nextOffset, 100);
      assert.deepEqual(p3, { text: 'line three\n', nextOffset: 29, truncated: false, totalBytes: 29 });
      assert.deepEqual(sliceBytes(text, 999, 10), { text: '', nextOffset: 29, truncated: false, totalBytes: 29 });
      const utf = 'ééé'; // 6 bytes, no newline
      const u = sliceBytes(utf, 0, 3);
      assert.equal(u.text, 'é', 'backs off to a character boundary');
      assert.equal(u.nextOffset, 2);
      assert.equal(sliceBytes('a'.repeat(10), 0, 4).text, 'aaaa', 'a single long line is cut raw');
    } },
    { name: 'sliceBytes: always advances — the UTF-8 back-off can never return zero progress', run: async () => {
      // maxBytes below the width of the first character used to return nextOffset === offset,
      // so the documented "page until truncated is false" loop never terminated.
      for (const maxBytes of [1, 2, 3]) {
        const p = sliceBytes('😀abc', 0, maxBytes);
        assert.ok(p.nextOffset > 0, `maxBytes ${maxBytes}: nextOffset ${p.nextOffset}`);
        assert.equal(p.text, '😀', 'a whole character is emitted rather than nothing');
      }
      // and the loop as the tool describes it terminates on every window size
      for (const maxBytes of [1, 2, 3, 4, 5]) {
        let off = 0;
        let out = '';
        for (let i = 0; i < 50; i++) {
          const p = sliceBytes('😀é\nab', off, maxBytes);
          out += p.text;
          off = p.nextOffset;
          if (!p.truncated) break;
        }
        assert.equal(out, '😀é\nab', `maxBytes ${maxBytes} pages the whole text`);
      }
    } },
  ]);
});

// ── handlers over fake readers ───────────────────────────────────────────────
const ROW_P = { id: '4e1f2a9b', project_key: 'demo-00000001', workspace_key: null, target: 'project', title: 'Fix login', status: 'done', phase: 'done',
  started_at: '2026-08-20T09:00:00.000Z', updated_at: '2026-08-20T10:00:00.000Z', total_cost_usd: 1.25, prompt: 'Fix the login bug',
  branch: JSON.stringify({ source: 'main', feature: 'worca-cc/fix-login-4e1f2a9b' }), workspace_meta: null, guardrails_id: 'normal', archived_at: null };
const ROW_W = { id: '8c3d12ab', project_key: 'app-00000001', workspace_key: 'wks-team-0000abcd', target: 'workspace', title: 'Rename', status: 'running', phase: 'implement',
  started_at: '2026-08-21T09:00:00.000Z', updated_at: null, total_cost_usd: 0, prompt: 'Rename everywhere',
  branch: JSON.stringify({ source: null, feature: 'worca-cc/rename-8c3d12ab' }),
  workspace_meta: JSON.stringify({ workspaceId: 'wks-team-0000abcd', workspaceName: 'Team', projectKeys: ['app-00000001', 'lib-00000002'], projects: [{ projectKey: 'app-00000001', projectName: 'app', projectDir: '/p/app' }, { projectKey: 'lib-00000002', projectName: 'lib', projectDir: '/p/lib' }] }),
  guardrails_id: 'secure', archived_at: null };
const ROW_A = { ...ROW_P, id: 'aaaaaaaa', title: 'Archived one', archived_at: '2026-08-01T00:00:00.000Z' };
const ROW_B = { ...ROW_P, id: 'bbbbbbbb', project_key: 'other-00000003', title: 'Other project run', status: 'error', total_cost_usd: 0.5 };
const ROW_S = { ...ROW_P, id: 'cccccccc', title: 'Leak ghp_abcdefghijklmnopqrstuvwxyz0123456789', prompt: 'use AKIAIOSFODNN7EXAMPLE please' };
const LITE = [
  { id: '8c3d12ab', title: 'Rename', status: 'running', startedAt: ROW_W.started_at, branch: 'worca-cc/rename-8c3d12ab', sourceBranch: null, guardrailsId: 'secure', totalCostUsd: null, mtime: 0,
    projectKey: 'workspaces/wks-team-0000abcd', projectName: 'app', workspaceName: 'Team', projectDir: '/p/app', target: 'workspace' },
  { id: '4e1f2a9b', title: 'Fix login', status: 'done', startedAt: ROW_P.started_at, branch: 'worca-cc/fix-login-4e1f2a9b', sourceBranch: 'main', guardrailsId: 'normal', totalCostUsd: 1.25, mtime: Date.parse(ROW_P.updated_at),
    projectKey: 'demo-00000001', projectName: 'Demo', projectDir: '/p/demo' },
  { id: 'bbbbbbbb', title: 'Other project run', status: 'error', startedAt: null, branch: null, sourceBranch: null, guardrailsId: null, totalCostUsd: 0.5, mtime: 5,
    projectKey: 'other-00000003', projectName: 'Other', projectDir: '/p/other' },
];
const diffs = new Map([['4e1f2a9b', DIFF], ['8c3d12ab', `# app-00000001\n${DIFF}`]]);
const HTML_PAGE = '<!doctype html><html><head><title>Deploy ghp_abcdefghijklmnopqrstuvwxyz0123456789 notes</title><style>body { color: red }</style>'
  + '<script>window.secret = "never";</script></head><body><h1>Deploy</h1><p>token ghp_abcdefghijklmnopqrstuvwxyz0123456789 here</p>'
  + '<ul><li>first step</li><li>second step</li></ul></body></html>';
const calls = [];
const fake = {
  buildCatalog: async () => ({ projects: [{ key: 'demo-00000001', name: 'Demo', path: '/p/demo' }], workspaces: [{ id: 'wks-team-0000abcd', name: 'Team', projectKeys: ['app-00000001', 'lib-00000002'] }],
    workflows: [{ id: 'wf_default', name: 'Default', domain: 'coding', origin: null, steps: [[{ nodeId: 's0', key: 'planner', displayName: 'Planner', description: '' }]], feedbacks: [] }] }),
  listAllPipelines: async (opts) => { calls.push(['listAllPipelines', opts]); return LITE; },
  lookupPipelineRow: (key, id) => {
    if (key === 'demo-00000001' && id === '4e1f2a9b') return ROW_P;
    if (key === 'workspaces/wks-team-0000abcd' && id === '8c3d12ab') return ROW_W;
    if (key === 'demo-00000001' && id === 'aaaaaaaa') return ROW_A;
    return null;
  },
  findPipelineRowById: (id) => [ROW_P, ROW_W, ROW_A, ROW_B, ROW_S].find((r) => r.id === id) ?? null,
  totalsFor: (row) => ({ cost: row.total_cost_usd > 0 ? row.total_cost_usd : (row.id === '8c3d12ab' ? 0.33 : null), active: null }),
  runStatusLine: () => 'Ready to ship',
  readStoreMeta: (key) => (key === 'demo-00000001' ? { name: 'Demo' } : null),
  readDiffPatch: async (row) => diffs.get(row.id) ?? null,
  hasDiffPatch: async (row) => diffs.has(row.id),
  readAttachment: (id) => (id === 'att_00000001'
    ? { name: 'notes.md', text: 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789 here\nsecond line\n' }
    : id === 'att_00000002'
      ? { name: 'shot.png', kind: 'image', mime: 'image/png', bytes: 2048, path: '/home/ask/ask_00000001/att/att_00000002.png' }
      : id === 'att_00000003'
        ? { name: 'page.html', kind: 'text', mime: 'text/html', text: HTML_PAGE }
        : null),
  htmlToText,
  validateProposal: async (input) => ({ ok: true, card: { echoed: input } }),
  protectedPaths: GUARDRAIL_PRESETS.normal.protectedPaths,
  redact: redactAskText,
  limits: ASK_LIMITS,
};
const tools = createAskTools(fake);

test('list(): forty-five tools with JSON-Schema inputs', () => {
  const defs = tools.list();
  assert.deepEqual(defs.map((d) => d.name), ['list_projects', 'list_branches', 'list_workflows', 'list_runs', 'list_people', 'get_run', 'get_run_diff', 'track_run', 'propose_run', 'propose_workflow', 'read_attachment',
    'list_diff_comments', 'add_diff_comment', 'reply_to_diff_comment', 'resolve_diff_comment', 'delete_diff_comment',
    'open_worktree', 'list_worktrees', 'remove_worktree', 'git',
    'list_run_artifacts', 'read_run_artifact', 'get_run_progress',
    'get_team_metrics', 'list_team_metrics_runs', 'push_team_metrics', 'propose_metrics_change',
    'get_team_policy', 'propose_policy_change', 'get_away_mode', 'set_away_now', 'set_run_away_mode', 'propose_away_mode_change',
    'list_memory', 'read_memory', 'remember', 'forget',
    'list_schedules', 'get_schedule', 'list_schedule_activity', 'preview_schedule', 'propose_schedule_change',
    'pause_schedule', 'resume_schedule', 'skip_next_run', 'mark_schedule_activity_read',
    'list_task_sources', 'find_tasks', 'get_task']);
  for (const d of defs) {
    assert.ok(typeof d.description === 'string' && d.description.length > 20, `${d.name} description`);
    assert.equal(d.inputSchema.type, 'object');
    assert.equal(d.inputSchema.additionalProperties, false);
  }
  assert.deepEqual(tools.list().find((d) => d.name === 'get_run').inputSchema.required, ['id']);
  assert.deepEqual(tools.list().find((d) => d.name === 'propose_run').inputSchema.required, ['brief']);
});

test('Shaper tools: listed only with chatActions and a followed thread; the child\'s refusal is the model\'s result', async () => {
  const { PERSPECTIVE_KEYS } = await import('../src/shared/shape/perspectives.mjs');
  const seen = [];
  const shapeTools = (follows, verdict) => ({ follows: () => follows, check: (kind, input) => { seen.push([kind, input]); return verdict; } });
  const on = { perspectiveKeys: PERSPECTIVE_KEYS, chatActions: {} };
  const names = (deps) => createAskTools({ ...fake, ...deps }).list().map((d) => d.name).filter((n) => n === 'propose_changes' || n === 'route_message');
  assert.deepEqual(names({ ...on, shapeTools: shapeTools(true, { ok: true }) }), ['propose_changes', 'route_message']);
  assert.deepEqual(names({ ...on, shapeTools: shapeTools(false, { ok: true }) }), [], 'a thread that follows nothing');
  assert.deepEqual(names({ perspectiveKeys: PERSPECTIVE_KEYS, shapeTools: shapeTools(true, { ok: true }) }), [], 'no chatActions bundle');
  await assert.rejects(createAskTools({ ...fake, ...on }).call('propose_changes', { pipelineId: 'aaaa0001', request: 'x' }), /propose_changes: unavailable/);
  const ok = await createAskTools({ ...fake, ...on, shapeTools: shapeTools(true, { ok: true }) }).call('propose_changes', { pipelineId: 'aaaa0001', request: 'make it blue' });
  assert.deepEqual([ok.ok, ok.requested], [true, { kind: 'changes', pipelineId: 'aaaa0001', request: 'make it blue' }]);
  const no = await createAskTools({ ...fake, ...on, shapeTools: shapeTools(true, { ok: false, error: 'the run is still going' }) })
    .call('route_message', { featureId: 'f1', text: 'x', guess: 'add', reason: 'r' });
  assert.deepEqual(no, { ok: false, error: 'the run is still going' });
  assert.deepEqual(seen.at(-1), ['route', { featureId: 'f1', text: 'x', guess: 'add', reason: 'r' }]);
});

test('list_projects / list_workflows come from the shared catalog', async () => {
  assert.deepEqual(await tools.call('list_projects', {}), {
    projects: [{ key: 'demo-00000001', name: 'Demo', path: '/p/demo' }],
    workspaces: [{ id: 'wks-team-0000abcd', name: 'Team', projectKeys: ['app-00000001', 'lib-00000002'] }],
  });
  const wfs = await tools.call('list_workflows', {});
  assert.equal(wfs[0].id, 'wf_default');
  assert.equal(wfs[0].steps[0][0].displayName, 'Planner');
});

test('list_runs: scan limit, filters, newest-first, shape per target, limit clamped to 1..100 default 20', async () => {
  await checkRows([
    { name: 'list_runs: scan limit, filters, newest-first order preserved, shape per target, limit clamp', run: async () => {
      calls.length = 0;
      const all = await tools.call('list_runs', {});
      assert.deepEqual(calls[0], ['listAllPipelines', { lite: true, limit: 200 }]);
      assert.deepEqual(all.map((r) => r.id), ['8c3d12ab', '4e1f2a9b', 'bbbbbbbb']);
      assert.deepEqual(all[0], { id: '8c3d12ab', title: 'Rename', target: 'workspace', workspaceId: 'wks-team-0000abcd', workspaceName: 'Team', status: 'running',
        startedAt: ROW_W.started_at, updatedAt: null, branch: 'worca-cc/rename-8c3d12ab', sourceBranch: null, guardrailsId: 'secure', totalCostUsd: null, startedBy: null });
      assert.deepEqual(all[1], { id: '4e1f2a9b', title: 'Fix login', target: 'project', projectKey: 'demo-00000001', projectName: 'Demo', status: 'done',
        startedAt: ROW_P.started_at, updatedAt: '2026-08-20T10:00:00.000Z', branch: 'worca-cc/fix-login-4e1f2a9b', sourceBranch: 'main', guardrailsId: 'normal', totalCostUsd: 1.25, startedBy: null });
      assert.deepEqual((await tools.call('list_runs', { projectKey: 'demo-00000001' })).map((r) => r.id), ['4e1f2a9b']);
      assert.deepEqual((await tools.call('list_runs', { workspaceId: 'wks-team-0000abcd' })).map((r) => r.id), ['8c3d12ab']);
      assert.deepEqual((await tools.call('list_runs', { status: 'ERROR' })).map((r) => r.id), ['bbbbbbbb'], 'status match is case-insensitive');
      assert.deepEqual((await tools.call('list_runs', { query: 'login' })).map((r) => r.id), ['4e1f2a9b'], 'title substring, case-insensitive');
      assert.equal((await tools.call('list_runs', { limit: 1 })).length, 1);
      await assert.rejects(() => tools.call('list_runs', { projectKey: 'a', workspaceId: 'b' }), AskToolError);
      calls.length = 0;
      await tools.call('list_runs', { projectKey: 'demo-00000001' });
      assert.deepEqual(calls[0], ['listAllPipelines', { lite: true, limit: -1 }], 'a keyed query scans every row (a project\'s runs may all be older than the 200 newest)');
    } },
    { name: 'list_runs: limit is clamped to 1..100, default 20 (130-row fake — both bounds observable)', run: async () => {
      const many = Array.from({ length: 130 }, (_, i) => ({ ...LITE[1], id: `r${String(i).padStart(7, '0')}`, title: `Run ${i}`, mtime: 1000 - i }));
      const t = createAskTools({ ...fake, listAllPipelines: async () => many });
      assert.equal((await t.call('list_runs', {})).length, 20, 'default 20');
      assert.equal((await t.call('list_runs', { limit: 1000 })).length, 100, 'clamped DOWN to listRunsMaxLimit (130 rows available)');
      assert.equal((await t.call('list_runs', { limit: 0 })).length, 1, 'clamped up to 1');
      assert.equal((await t.call('list_runs', { limit: -5 })).length, 1);
      assert.equal((await t.call('list_runs', { limit: 3 })).length, 3);
      assert.equal((await t.call('list_runs', { limit: 'abc' })).length, 20, 'non-numeric → default');
      assert.equal((await t.call('list_runs', { query: 'run 2' })).map((r) => r.title).length, 11, 'substring match: Run 2, Run 20..29');
      const leak = createAskTools({ ...fake, listAllPipelines: async () => [{ ...LITE[1], title: 'T ghp_abcdefghijklmnopqrstuvwxyz0123456789' }] });
      assert.equal((await leak.call('list_runs', {}))[0].title, 'T ghp_<redacted>', 'titles redacted');
    } },
  ]);
});

test('get_run: scoped and key-less lookups, project and workspace shapes, archived flag', async () => {
  const p = await tools.call('get_run', { id: '4e1f2a9b', projectKey: 'demo-00000001' });
  assert.deepEqual(p, { id: '4e1f2a9b', title: 'Fix login', target: 'project', project: { key: 'demo-00000001', name: 'Demo' }, workspace: null,
    status: 'done', phase: 'done', statusLine: 'Ready to ship', startedAt: ROW_P.started_at, updatedAt: ROW_P.updated_at, branch: 'worca-cc/fix-login-4e1f2a9b', sourceBranch: 'main',
    guardrailsId: 'normal', prompt: 'Fix the login bug', totalCostUsd: 1.25, hasDiff: true, archived: false, startedBy: null });
  assert.deepEqual(await tools.call('get_run', { id: '4e1f2a9b' }), p, 'key-less lookup finds the same row');
  const w = await tools.call('get_run', { id: '8c3d12ab', workspaceId: 'wks-team-0000abcd' });
  assert.equal(w.target, 'workspace');
  assert.equal(w.project, null);
  assert.deepEqual(w.workspace, { id: 'wks-team-0000abcd', name: 'Team', members: ['app', 'lib'] });
  assert.equal(w.totalCostUsd, 0.33, 'step-sum fallback via totalsFor');
  assert.equal(w.sourceBranch, null);
  const a = await tools.call('get_run', { id: 'aaaaaaaa' });
  assert.equal(a.archived, true);
  assert.equal(a.hasDiff, false, 'archived ⇒ no diff even if a file existed');
  await assert.rejects(() => tools.call('get_run', { id: 'zzzzzzzz' }), { message: 'get_run: run not found' });
  await assert.rejects(() => tools.call('get_run', { id: '4e1f2a9b', projectKey: 'other-00000003' }), { message: 'get_run: run not found' }, 'wrong scope = not found');
  await assert.rejects(() => tools.call('get_run', {}), { message: 'get_run: id is required' });
  const s = await tools.call('get_run', { id: 'cccccccc' });
  assert.equal(s.title, 'Leak ghp_<redacted>', 'titles are redacted before they reach the model');
  assert.equal(s.prompt, 'use AKIA<redacted> please', 'run prompts are untrusted text: redacted');
});

test('track_run: resolves an 8-hex id like get_run (pinned scope first), passes a live UUID through unresolved, needs an id', async () => {
  const r = await tools.call('track_run', { id: '4e1f2a9b' });
  assert.equal(r.ok, true);
  assert.equal(r.tracked.id, '4e1f2a9b');
  assert.equal(r.tracked.title, 'Fix login');
  assert.equal(r.tracked.status, 'done');
  assert.deepEqual(r.tracked.project, { key: 'demo-00000001', name: 'Demo' });
  const ws = await tools.call('track_run', { id: '8c3d12ab', workspaceId: 'wks-team-0000abcd' });
  assert.equal(ws.tracked.workspace.id, 'wks-team-0000abcd');
  await assert.rejects(tools.call('track_run', { id: '4e1f2a9b', projectKey: 'other-00000003' }), /track_run: run not found/);
  await assert.rejects(tools.call('track_run', {}), /track_run: id is required/);
  const uuid = await tools.call('track_run', { id: '0f6e5d4c-1b2a-4c3d-8e9f-0a1b2c3d4e5f' });
  assert.deepEqual(uuid, { ok: true, tracked: { id: '0f6e5d4c-1b2a-4c3d-8e9f-0a1b2c3d4e5f', resolved: false } });
  assert.deepEqual(tools.list().find((d) => d.name === 'track_run').inputSchema.required, ['id']);
});

test('get_run_diff: protected basenames dropped, redaction, path filter, paging, archived/missing', async () => {
  const d = await tools.call('get_run_diff', { id: '4e1f2a9b' });
  assert.equal(d.available, true);
  assert.deepEqual(d.files, [{ path: 'src/app.js', added: 2, removed: 1 }, { path: 'docs/notes.md', added: 1, removed: 1 }], 'config/.env dropped');
  assert.ok(!d.text.includes('.env') && !d.text.includes('sk-ant-'), 'the protected section is gone entirely');
  assert.ok(d.text.includes('-ghp_<redacted>'), 'remaining sections are redacted');
  assert.equal(d.truncated, false);
  assert.equal(d.nextOffset, d.totalBytes);
  const one = await tools.call('get_run_diff', { id: '4e1f2a9b', path: 'docs/notes.md' });
  assert.ok(one.text.startsWith('diff --git a/docs/notes.md'));
  assert.ok(!one.text.includes('src/app.js'));
  assert.equal(one.files.length, 2, 'files always lists every kept section');
  const page = await tools.call('get_run_diff', { id: '4e1f2a9b', maxBytes: 40 });
  assert.equal(page.truncated, true);
  assert.ok(page.text.endsWith('\n'));
  const rest = await tools.call('get_run_diff', { id: '4e1f2a9b', offset: page.nextOffset, maxBytes: 200000 });
  assert.equal(page.text + rest.text, d.text, 'pages concatenate to the whole');
  const ws = await tools.call('get_run_diff', { id: '8c3d12ab', workspaceId: 'wks-team-0000abcd' });
  assert.deepEqual(ws.files[0], { path: 'src/app.js', added: 2, removed: 1, projectKey: 'app-00000001' });
  assert.deepEqual(await tools.call('get_run_diff', { id: 'aaaaaaaa' }), { available: false, files: [], text: '', truncated: false, totalBytes: 0, nextOffset: 0 });
  assert.equal((await tools.call('get_run_diff', { id: 'bbbbbbbb' })).available, false, 'no patch file');
  assert.equal((await tools.call('get_run_diff', { id: '4e1f2a9b', maxBytes: 10_000_000 })).truncated, false, 'maxBytes clamped to 200000, still whole here');
  const tiny = await tools.call('get_run_diff', { id: '4e1f2a9b', maxBytes: 0 });
  assert.equal(tiny.truncated, true, 'maxBytes clamped up to 1');
  assert.ok(tiny.text.length <= 1);
});

test('get_run_diff: a run still in flight reads its live worktree diff (live: true), filtered like any patch, never memoised', async () => {
  const live = [
    'diff --git a/src/limiter.js b/src/limiter.js\nnew file mode 100644\n--- /dev/null\n+++ b/src/limiter.js\n@@ -0,0 +1 @@\n+export const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n',
    'diff --git a/.env b/.env\nnew file mode 100644\n--- /dev/null\n+++ b/.env\n@@ -0,0 +1 @@\n+SECRET=sk-ant-xyz\n',
  ].join('');
  let reads = 0;
  const t = createAskTools({ ...fake, readLiveDiff: async (row) => { reads += 1; return row.id === 'bbbbbbbb' ? live : null; } });
  const d = await t.call('get_run_diff', { id: 'bbbbbbbb' });
  assert.equal(d.available, true, 'no saved patch yet, but the live reader answered');
  assert.equal(d.live, true);
  assert.deepEqual(d.files.map((f) => f.path), ['src/limiter.js'], 'a protected file is dropped from a live diff too');
  assert.ok(d.text.includes('ghp_<redacted>') && !d.text.includes('sk-ant-'), 'and it is redacted');
  await t.call('get_run_diff', { id: 'bbbbbbbb' });
  assert.equal(reads, 2, 'a live diff moves while the run works: read again, never served from the page cache');
  const saved = await t.call('get_run_diff', { id: '4e1f2a9b' });
  assert.equal(saved.live, undefined, 'a saved patch wins; the live reader is only the fallback');
  // Without the host's reader (the classic child), a run with no patch is still "not available".
  assert.equal((await tools.call('get_run_diff', { id: 'bbbbbbbb' })).available, false);
});

test('get_run_diff: a C-quoted protected path is dropped and never counted against its neighbour', async () => {
  const t = createAskTools({ ...fake, readDiffPatch: async () => QUOTED_DIFF });
  const d = await t.call('get_run_diff', { id: '4e1f2a9b' });
  assert.deepEqual(d.files, [{ path: 'README.md', added: 2, removed: 0 }], 'clé.pem matches *.pem and is omitted; README keeps its own 2');
  assert.ok(!d.text.includes('SECRET'), 'the protected file body never reaches the model');
  assert.ok(!d.text.includes('hunter2'));
});

test('get_run_diff: the protected floor is the secure preset, not normal', async () => {
  const secureOnly = ['config/.npmrc', 'infra/.netrc', 'env/main.tfstate', 'app/secrets/db.json', 'sub/.git/config'];
  const patch = `${secureOnly.map((p) => `diff --git a/${p} b/${p}\n--- /dev/null\n+++ b/${p}\n@@ -0,0 +1 @@\n+TOP_SECRET_VALUE\n`).join('')}diff --git a/ok.md b/ok.md\n+++ b/ok.md\n@@ -0,0 +1 @@\n+fine\n`;
  const t = createAskTools({ ...fake, readDiffPatch: async () => patch, protectedPaths: defaultToolDeps({ threadId: 'ask_00000001' }).protectedPaths });
  const d = await t.call('get_run_diff', { id: '4e1f2a9b' });
  assert.deepEqual(d.files.map((f) => f.path), ['ok.md'], 'every secure-tier credential file is omitted');
  assert.ok(!d.text.includes('TOP_SECRET_VALUE'));
});

test('get_run_diff: a prefix-less patch is filtered per file, not swallowed whole', async () => {
  const secure = { ...fake, protectedPaths: defaultToolDeps({ threadId: 'ask_00000001' }).protectedPaths };
  const t = createAskTools({ ...secure, readDiffPatch: async () => NOPREFIX_DIFF });
  const d = await t.call('get_run_diff', { id: '4e1f2a9b' });
  assert.deepEqual(d.files, [{ path: 'aaa.txt', added: 1, removed: 0 }], 'the two credential files are omitted and aaa.txt keeps its own +1');
  assert.ok(!d.text.includes('hunter2'), 'no credential body reaches the model');
  assert.ok(!d.text.includes('PRIVATE KEY MATERIAL'));
});

test('get_run_diff: a section with no resolvable path is dropped, never emitted verbatim', async () => {
  const secure = { ...fake, protectedPaths: defaultToolDeps({ threadId: 'ask_00000001' }).protectedPaths };
  // no `diff --git` line at all (diff.external / GIT_EXTERNAL_DIFF) — the whole
  // patch is one path:null section, and `!(s.path && isProtected…)` used to keep it.
  const external = createAskTools({ ...secure, readDiffPatch: async () => 'external diff of secrets/db.json\nDB_PASSWORD=hunter2\n' });
  const e = await external.call('get_run_diff', { id: '4e1f2a9b' });
  assert.deepEqual(e.files, []);
  assert.equal(e.text, '', 'fail closed: unattributable text is not shown');
  // a member header still survives — it is what scopes the following sections
  const ws = createAskTools({ ...secure, readDiffPatch: async () => '# app-00000001\ndiff --git secrets/db.json secrets/db.json\n+++ secrets/db.json\n+DB_PASSWORD=hunter2\n' });
  const w = await ws.call('get_run_diff', { id: '8c3d12ab', workspaceId: 'wks-team-0000abcd' });
  assert.deepEqual(w.files, []);
  assert.equal(w.text, '# app-00000001\n');
  // …and a MULTI-file external-diff patch cannot buy a path with its first,
  // harmless file and ship the credential file that follows inside that section
  const legacy = createAskTools({ ...secure, readDiffPatch: async () => LEGACY_EXTERNAL_DIFF });
  const l = await legacy.call('get_run_diff', { id: '4e1f2a9b' });
  assert.deepEqual(l.files, []);
  assert.equal(l.text, '', 'fail closed: the harmless file goes too, rather than carrying the .env');
});

test('get_run_diff: a path containing " b/" is matched against the guardrails IN FULL', async () => {
  const secure = { ...fake, protectedPaths: defaultToolDeps({ threadId: 'ask_00000001' }).protectedPaths };
  // `secrets/plan b/creds.json` — a last-` b/` cut parsed it as `creds.json`, which
  // the slash-carrying secrets glob no longer matched, so the body reached the model.
  const patch = 'diff --git a/secrets/plan b/creds.json b/secrets/plan b/creds.json\n'
    + '--- /dev/null\n+++ b/secrets/plan b/creds.json\t\n@@ -0,0 +1 @@\n+DB_PASSWORD=hunter2\n'
    + 'diff --git a/docs/ok.md b/docs/ok.md\n--- a/docs/ok.md\n+++ b/docs/ok.md\n@@ -1 +1 @@\n+fine\n';
  const t = createAskTools({ ...secure, readDiffPatch: async () => patch });
  const r = await t.call('get_run_diff', { id: '4e1f2a9b' });
  assert.deepEqual(r.files.map((f) => f.path), ['docs/ok.md'], 'the protected section is not listed');
  assert.ok(!r.text.includes('hunter2'), 'and its body never ships');
  assert.ok(r.text.startsWith('diff --git a/docs/ok.md'));
  // the same path with no `+++ ` line to fall back on: the header alone still reads it
  const bare = createAskTools({ ...secure, readDiffPatch: async () => 'diff --git a/secrets/plan b/creds.json b/secrets/plan b/creds.json\n+DB_PASSWORD=hunter2\n' });
  const b = await bare.call('get_run_diff', { id: '4e1f2a9b' });
  assert.deepEqual(b.files, []);
  assert.equal(b.text, '');
});

// `diffPatch` passes `-M`, so "turn .env into an example file" — a realistic,
// non-hostile pipeline action — is ONE section named `config/env.sample` whose
// `-`/context lines are the real credentials. Checking only the b-side shipped them.
const RENAME_PATCH = [
  'diff --git a/config/.env b/config/env.sample',
  'similarity index 95%',
  'rename from config/.env',
  'rename to config/env.sample',
  '--- a/config/.env',
  '+++ b/config/env.sample',
  '@@ -1,3 +1,3 @@',
  '-API_KEY=sk-live-REALSECRET-0001',
  '-DB_PASSWORD=hunter2-realpass',
  ' SHARED=keepme',
  '+API_KEY=xxx',
  '+DB_PASSWORD=xxx',
  'diff --git a/docs/ok.md b/docs/ok.md',
  '--- a/docs/ok.md',
  '+++ b/docs/ok.md',
  '@@ -1 +1 @@',
  '+fine',
  '',
].join('\n');

test('get_run_diff renames: out of a credential file is dropped (old lines never ship); a harmless rename ships under its new path', async () => {
  await checkRows([
    { name: 'get_run_diff: a rename OUT OF a credential file is dropped — the old file`s lines never ship', run: async () => {
      for (const [tier, protectedPaths] of [
        ['normal', GUARDRAIL_PRESETS.normal.protectedPaths],
        ['secure', defaultToolDeps({ threadId: 'ask_00000001' }).protectedPaths],
      ]) {
        const t = createAskTools({ ...fake, protectedPaths, readDiffPatch: async () => RENAME_PATCH });
        const d = await t.call('get_run_diff', { id: '4e1f2a9b' });
        assert.deepEqual(d.files.map((f) => f.path), ['docs/ok.md'], `${tier}: the renamed credential file is not listed`);
        for (const secret of ['sk-live-REALSECRET-0001', 'hunter2-realpass', 'config/.env', 'env.sample']) {
          assert.ok(!d.text.includes(secret), `${tier}: ${secret} never reaches the model`);
        }
      }
      // the same shape with no `rename from` / `--- ` line: the a-side still falls out of
      // the header once the `+++ ` line has pinned the b-side exactly
      const bare = createAskTools({ ...fake, protectedPaths: defaultToolDeps({ threadId: 'ask_00000001' }).protectedPaths,
        readDiffPatch: async () => 'diff --git a/a b/old.pem b/plain.txt\n+++ b/plain.txt\n@@ -1 +1 @@\n PRIVATE KEY MATERIAL\n' });
      const b = await bare.call('get_run_diff', { id: '4e1f2a9b' });
      assert.deepEqual(b.files, [], 'a rename out of a .pem is dropped even under its harmless new name');
      assert.equal(b.text, '');
    } },
    { name: 'get_run_diff: a HARMLESS rename still ships, listed under its new path', run: async () => {
      const t = createAskTools({ ...fake,
        readDiffPatch: async () => 'diff --git a/docs/a.md b/docs/b.md\nsimilarity index 90%\nrename from docs/a.md\nrename to docs/b.md\n--- a/docs/a.md\n+++ b/docs/b.md\n@@ -1 +1 @@\n-x\n+y\n' });
      const d = await t.call('get_run_diff', { id: '4e1f2a9b' });
      assert.deepEqual(d.files, [{ path: 'docs/b.md', added: 1, removed: 1 }], 'files[].path is the NEW path');
      assert.ok(d.text.includes('rename from docs/a.md'), 'and the section ships whole');
    } },
  ]);
});

test('read_attachment: thread-scoped reader with redaction and paging, not found; a binary attachment returns metadata + path, never a text slice', async () => {
  await checkRows([
    { name: 'read_attachment: thread-scoped reader, redaction, paging, not found', run: async () => {
      const r = await tools.call('read_attachment', { id: 'att_00000001' });
      assert.equal(r.name, 'notes.md');
      assert.equal(r.text, 'token ghp_<redacted> here\nsecond line\n');
      assert.equal(r.truncated, false);
      assert.equal(r.totalBytes, Buffer.byteLength(r.text));
      const p = await tools.call('read_attachment', { id: 'att_00000001', maxBytes: 5 });
      assert.equal(p.truncated, true);
      await assert.rejects(() => tools.call('read_attachment', { id: 'att_ffffffff' }), { message: 'read_attachment: attachment not found' });
      await assert.rejects(() => tools.call('read_attachment', {}), { message: 'read_attachment: id is required' });
    } },
    { name: 'read_attachment (#398): a binary attachment returns metadata + path, never a text slice', run: async () => {
      const r = await tools.call('read_attachment', { id: 'att_00000002' });
      assert.deepEqual(r, {
        name: 'shot.png', kind: 'image', mime: 'image/png', totalBytes: 2048,
        path: '/home/ask/ask_00000001/att/att_00000002.png',
        note: 'binary attachment: pass `path` to your Read tool to view the content',
      });
      assert.ok(!('text' in r) && !('truncated' in r) && !('nextOffset' in r), 'no sliceBytes fields on a binary read');
    } },
  ]);
});

test('read_attachment as=raw: HTML reads as raw redacted markup by default; `as` is ignored for non-HTML', async () => {
  await checkRows([
    { name: 'read_attachment: an HTML attachment reads as raw markup by default (and with as: "raw"), redacted', run: async () => {
      const r = await tools.call('read_attachment', { id: 'att_00000003' });
      const raw = redactAskText(HTML_PAGE);
      assert.deepEqual(r, { name: 'page.html', kind: 'text', text: raw, truncated: false, totalBytes: Buffer.byteLength(raw), nextOffset: Buffer.byteLength(raw) });
      assert.ok(r.text.includes('<script>window.secret'), 'raw keeps the markup, scripts included');
      assert.ok(!r.text.includes('ghp_abcdefghijklmnopqrstuvwxyz0123456789'), 'redaction applies to raw markup');
      assert.deepEqual(await tools.call('read_attachment', { id: 'att_00000003', as: 'raw' }), r);
    } },
    { name: 'read_attachment: as is ignored for non-HTML attachments', run: async () => {
      assert.deepEqual(await tools.call('read_attachment', { id: 'att_00000001', as: 'text' }), await tools.call('read_attachment', { id: 'att_00000001' }));
      assert.deepEqual(await tools.call('read_attachment', { id: 'att_00000002', as: 'text' }), await tools.call('read_attachment', { id: 'att_00000002' }));
      let converted = 0;
      const t = createAskTools({ ...fake, htmlToText: async () => { converted += 1; return { title: null, text: '', truncated: false }; },
        readAttachment: () => ({ name: 'data.json', kind: 'text', mime: 'application/json', text: '{"a":"<b>x</b>"}' }) });
      const j = await t.call('read_attachment', { id: 'att_00000009', as: 'text' });
      assert.equal(j.text, '{"a":"<b>x</b>"}', 'a JSON body holding markup is returned verbatim');
      assert.equal(converted, 0, 'the converter never runs for a non-HTML mime');
      assert.ok(!('as' in j) && !('title' in j));
    } },
  ]);
});

test('read_attachment as="text": converted, redacted and paged; the converter\'s own truncation is reported as conversionTruncated', async () => {
  await checkRows([
    { name: 'read_attachment: as "text" converts an HTML attachment (scripts/styles stripped, title), then redacts and pages the CONVERTED text', run: async () => {
      const r = await tools.call('read_attachment', { id: 'att_00000003', as: 'text' });
      const expected = '# Deploy\n\ntoken ghp_<redacted> here\n\n- first step\n- second step';
      assert.deepEqual(r, {
        name: 'page.html', kind: 'text', mime: 'text/html', as: 'text', title: 'Deploy ghp_<redacted> notes',
        text: expected, truncated: false, totalBytes: Buffer.byteLength(expected), nextOffset: Buffer.byteLength(expected), conversionTruncated: false,
      });
      assert.ok(!/window\.secret|color: red|<\/?(html|head|title|style|script|body|h1|p|ul|li)\b/.test(r.text), 'no script, no style, no tags');
      // offsets refer to the converted text: paging it back together yields exactly the one-shot read
      let offset = 0; let joined = ''; let pages = 0;
      for (;;) {
        const p = await tools.call('read_attachment', { id: 'att_00000003', as: 'text', offset, maxBytes: 16 });
        assert.equal(p.totalBytes, Buffer.byteLength(expected), 'totalBytes is the converted size, not the markup size');
        joined += p.text; pages += 1; offset = p.nextOffset;
        if (!p.truncated) break;
      }
      assert.ok(pages > 1, 'the small window really paged');
      assert.equal(joined, expected);
      await assert.rejects(() => tools.call('read_attachment', { id: 'att_00000003', as: 'markdown' }), { name: 'AskToolError', message: 'read_attachment: as must be raw or text' });
    } },
    { name: 'read_attachment: the converter\'s own truncation is reported as conversionTruncated', run: async () => {
      const seen = [];
      const t = createAskTools({ ...fake, htmlToText: async (html, baseUrl, opts) => { seen.push({ baseUrl, opts }); return { title: null, text: 'cut short', truncated: true }; } });
      const r = await t.call('read_attachment', { id: 'att_00000003', as: 'text' });
      assert.equal(r.conversionTruncated, true);
      assert.equal(r.truncated, false, 'paging truncation is separate');
      assert.equal(r.title, null);
      assert.equal(seen[0].baseUrl, null, 'no base URL: an attachment has no origin');
      assert.ok(seen[0].opts.maxChars >= ASK_LIMITS.attachment.maxBytesPerFile, 'maxChars covers a full 100 MB text attachment');
    } },
  ]);
});

test('propose_run passes through validateProposal (commentIds untouched); unknown tools and bad input are AskToolErrors', async () => {
  await checkRows([
    { name: 'propose_run passes through validateProposal; unknown tools and bad input are AskToolErrors', run: async () => {
      assert.deepEqual(await tools.call('propose_run', { projectKey: 'demo-00000001', brief: 'b' }), { ok: true, card: { echoed: { projectKey: 'demo-00000001', brief: 'b' } } });
      await assert.rejects(() => tools.call('nope', {}), { name: 'AskToolError', message: 'unknown tool: nope' });
      await assert.rejects(() => tools.call('get_run', 'not-an-object'), AskToolError);
      await assert.rejects(() => tools.call('get_run', { id: 'x', projectKey: 'a', workspaceId: 'b' }), { message: 'get_run: give projectKey OR workspaceId, not both' });
    } },
    { name: 'propose_run accepts commentIds and passes them through untouched', run: async () => {
      assert.deepEqual(await tools.call('propose_run', { projectKey: 'demo-00000001', brief: 'b', commentIds: ['dc_00000001'] }),
        { ok: true, card: { echoed: { projectKey: 'demo-00000001', brief: 'b', commentIds: ['dc_00000001'] } } });
    } },
  ]);
});

test('propose_workspace_change: remove_member takes an optional rescan, and the description says to relay card.recommendation', () => {
  const def = createAskTools({ limits: ASK_LIMITS, workspaceChanges: {} }).list().find((d) => d.name === 'propose_workspace_change');
  assert.ok(def.inputSchema.properties.rescan, 'rescan is in the schema');
  assert.match(def.inputSchema.properties.rescan.description, /none \| partial \| full/);
  assert.deepEqual(def.inputSchema.required, ['kind'], 'rescan stays optional');
  assert.match(def.description, /card\.recommendation \{level, reason\}.*relay it in one or two sentences; the user picks on the card/);
});

test('propose_run hands the thread\'s attachment ledger to the validator', async () => {
  const rows = [{ id: 'att_00000001', name: 'notes.md', bytes: 3, kind: 'text' }];
  const t = createAskTools({ ...fake,
    listAttachments: () => rows,
    validateProposal: async (input, opts) => ({ ok: true, card: { input, opts } }) });
  const r = await t.call('propose_run', { projectKey: 'demo-00000001', brief: 'b', attachmentIds: ['att_00000001'] });
  assert.deepEqual(r.card.opts, { attachments: rows });
  const t2 = createAskTools({ ...fake,
    listAttachments: undefined,
    validateProposal: async (input, opts) => ({ ok: true, card: { opts } }) });
  assert.deepEqual((await t2.call('propose_run', { projectKey: 'demo-00000001', brief: 'b' })).card.opts, { attachments: [] }, 'no dep → empty ledger');
});

test('defaultToolDeps.listAttachments: thread-scoped, empty without a thread, [] on an unreadable DB', async () => {
  await checkRows([
    { name: 'defaultToolDeps.listAttachments is thread-scoped and empty without a thread', run: async () => {
      assert.deepEqual(defaultToolDeps({ threadId: null }).listAttachments(), []);
      assert.equal(typeof defaultToolDeps({ threadId: 'ask_00000001' }).listAttachments, 'function');
    } },
    { name: 'defaultToolDeps.listAttachments degrades to [] on an unreadable DB — never an error the model cannot propose past', run: async () => {
      // Same contract as the sibling pinnedScope dep and the parent path (turn.mjs): the ledger is
      // context for the card, so a locked/corrupt store means "no attachments", not a failed tool call.
      const prev = process.env.WORCA_HOME;
      const blocked = join(mkdtempSync(join(tmpdir(), 'worca-ask-deps-')), 'not-a-dir');
      writeFileSync(blocked, 'x');            // getDb() mkdirSync's the home first: a FILE there throws
      closeDb();                              // drop the handle opened at the temp home
      process.env.WORCA_HOME = blocked;
      try {
        assert.deepEqual(defaultToolDeps({ threadId: 'ask_00000001' }).listAttachments(), []);
      } finally {
        process.env.WORCA_HOME = prev;
        closeDb();                            // the next getDb() reopens against the suite's temp home
      }
    } },
  ]);
});

test('propose_run refuses commentIds from another project and says so', async () => {
  const t = createAskTools({
    ...fake,
    validateProposal: async (input) => ({ ok: true, card: { projectKey: input.projectKey || null, workspaceId: input.workspaceId || null } }),
    comments: { get: (id) => (id === 'dc_1a2b3c4d' ? { id, storeKey: 'other-00000003' } : null) },
  });
  assert.deepEqual(await t.call('propose_run', { projectKey: 'demo-00000001', brief: 'b', commentIds: ['dc_1a2b3c4d'] }),
    { ok: false, errors: ['these diff comments are not from demo-00000001: dc_1a2b3c4d — cite comments from a run of the project this proposal targets'] });
  // Same store, and an id the user already deleted: both pass through.
  const t2 = createAskTools({
    ...fake,
    validateProposal: async (input) => ({ ok: true, card: { projectKey: input.projectKey || null, workspaceId: null } }),
    comments: { get: (id) => (id === 'dc_00000001' ? { id, storeKey: 'demo-00000001' } : null) },
  });
  assert.equal((await t2.call('propose_run', { projectKey: 'demo-00000001', brief: 'b', commentIds: ['dc_00000001', 'dc_deadbeef'] })).ok, true,
    'unknown ids stay tolerated — only a WRONG-target id is an error');
});

test('get_run: carries memory only when the run has a ledger with changes', async () => {
  const withMem = createAskTools({ ...fake, readRunMemory: async (row) => (row.id === '4e1f2a9b' ? { changes: [{ nodeId: 'n', added: [{ scope: 'global', name: 'x' }], modified: [], deleted: [], rejected: [] }], totals: { added: 1, modified: 0, deleted: 0, rejected: 0 } } : null) });
  const a = await withMem.call('get_run', { id: '4e1f2a9b', projectKey: 'demo-00000001' });
  assert.deepEqual(a.memory.totals, { added: 1, modified: 0, deleted: 0, rejected: 0 });
  const b = await withMem.call('get_run', { id: '8c3d12ab' });
  assert.equal('memory' in b, false, 'no ledger ⇒ no key (the row-only shape is unchanged)');
});

// ── real readers on a temp home ──────────────────────────────────────────────
test('temp home: a seeded project run and a seeded workspace run round-trip through the real deps', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'worca-ask-tools-proj-'));
  const [project] = await addProject({ name: 'demo', path: projectDir });
  const seeded = await seedPipeline(projectDir, { title: 'Seeded run', status: 'done', prompt: 'do the thing', branch: { source: 'main', feature: 'worca-cc/seeded' } });
  await writeFile(join(seeded.dir, 'diff-patch.patch'), DIFF, 'utf8');
  const wsDir = mkdtempSync(join(tmpdir(), 'worca-ask-tools-ws-'));
  const members = [{ projectKey: 'team-00000001', projectDir: wsDir, projectName: 'team' }];
  const wsSeed = await seedWorkspacePipeline(wsDir, 'wks-team-0000abcd',
    { title: 'WS run', status: 'done', workspaceId: 'wks-team-0000abcd', workspaceName: 'Team', projectKeys: ['team-00000001'], projects: members }, members);
  await writeFile(join(wsSeed.dir, 'diff-patch.patch'), `# team-00000001\n${DIFF}`, 'utf8');

  const thread = createThread();
  const msg = appendMessage(thread.id, { role: 'user', text: 'x' });
  const att = addAttachment(thread.id, msg.id, { name: 'n.md', text: 'hello' });
  const otherThread = createThread();

  const real = createAskTools(defaultToolDeps({ threadId: thread.id }));
  const projects = await real.call('list_projects', {});
  assert.equal(projects.projects[0].key, project.key);
  const runs = await real.call('list_runs', { projectKey: project.key });
  assert.deepEqual(runs.map((r) => r.id), [seeded.id]);
  assert.equal(typeof runs[0].projectName, 'string');
  assert.equal(runs[0].branch, 'worca-cc/seeded', 'the lite row really carries the feature branch');
  assert.equal(runs[0].sourceBranch, 'main');
  assert.equal(runs[0].status, 'done');
  assert.ok('totalCostUsd' in runs[0] && 'guardrailsId' in runs[0] && 'updatedAt' in runs[0]);
  const run = await real.call('get_run', { id: seeded.id });
  assert.equal(run.prompt, 'do the thing');
  assert.equal(run.project.key, project.key);
  assert.equal(run.branch, 'worca-cc/seeded');
  assert.equal(run.sourceBranch, 'main');
  assert.equal(run.hasDiff, true);
  // Agent memory (§6): the REAL readRunMemory over the run dir's memory.json, through the ONE
  // ledger reader artifacts.mjs exports. No file, and a ledger with no changes, both mean "no key".
  assert.equal('memory' in run, false, 'no ledger ⇒ the row-only shape is unchanged');
  await writeFile(join(seeded.dir, 'memory.json'), JSON.stringify({ mount: '/tmp/x/memory', dirs: [], baseline: {}, changes: [] }), 'utf8');
  assert.equal('memory' in (await real.call('get_run', { id: seeded.id })), false, 'an empty ledger is not a memory section');
  await writeFile(join(seeded.dir, 'memory.json'), JSON.stringify({ mount: '/tmp/x/memory', dirs: [], baseline: {},
    changes: [{ nodeId: 'n_defrag', added: [{ scope: 'global', name: 'style' }], modified: [{ scope: 'project', name: 'conventions' }], deleted: [], rejected: [] }] }), 'utf8');
  const withMemory = await real.call('get_run', { id: seeded.id });
  assert.deepEqual(withMemory.memory.totals, { added: 1, modified: 1, deleted: 0, rejected: 0, failed: 0, proposed: 0 });
  assert.deepEqual(withMemory.memory.changes[0].added, [{ scope: 'global', name: 'style' }]);
  assert.equal('mount' in withMemory.memory, false, 'the mount path never reaches the model');
  const diff = await real.call('get_run_diff', { id: seeded.id, projectKey: project.key });
  assert.deepEqual(diff.files.map((f) => f.path), ['src/app.js', 'docs/notes.md']);
  const wsRun = await real.call('get_run', { id: wsSeed.id, workspaceId: 'wks-team-0000abcd' });
  assert.equal(wsRun.target, 'workspace');
  assert.deepEqual(wsRun.workspace.members, ['team']);
  const wsDiff = await real.call('get_run_diff', { id: wsSeed.id });
  assert.equal(wsDiff.files[0].projectKey, 'team-00000001');
  assert.equal((await real.call('read_attachment', { id: att.id })).text, 'hello');
  // HTML through the real tool-deps: the text branch carries the mime, the converter is injected
  assert.equal(typeof defaultToolDeps({ threadId: null }).htmlToText, 'function');
  const page = addAttachment(thread.id, msg.id, { name: 'page.html', mime: 'text/html', text: '<html><head><title>T</title><script>x()</script></head><body><p>Hi there</p></body></html>' });
  assert.equal(defaultToolDeps({ threadId: thread.id }).readAttachment(page.id).mime, 'text/html');
  const pageText = await real.call('read_attachment', { id: page.id, as: 'text' });
  assert.equal(pageText.text, 'Hi there');
  assert.equal(pageText.title, 'T');
  assert.ok((await real.call('read_attachment', { id: page.id })).text.startsWith('<html>'), 'raw stays the default');
  // #398: a real binary row through the real tool-deps — metadata + the on-disk path
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const bin = addAttachment(thread.id, msg.id, { name: 'shot.png', kind: 'image', mime: 'image/png', data: png });
  const binRead = await real.call('read_attachment', { id: bin.id });
  assert.equal(binRead.kind, 'image');
  assert.equal(binRead.totalBytes, png.length);
  assert.ok(binRead.path.endsWith(`${bin.id}.png`), 'path points at the stored body');
  assert.ok(!('text' in binRead));
  // the row outliving its body (DB-only restore, external cleanup) is the clean
  // not-found, never a path whose Read would fail ENOENT
  unlinkSync(binRead.path);
  await assert.rejects(() => real.call('read_attachment', { id: bin.id }), { message: 'read_attachment: attachment not found' }, 'a binary row without a body is not found');
  const other = createAskTools(defaultToolDeps({ threadId: otherThread.id }));
  await assert.rejects(() => other.call('read_attachment', { id: att.id }), { message: 'read_attachment: attachment not found' }, "another thread's attachment is invisible");
  await assert.rejects(() => other.call('read_attachment', { id: bin.id }), { message: 'read_attachment: attachment not found' }, "another thread's binary attachment is invisible");
  updateThread(thread.id, { context: { pinned: true, projectKey: project.key } });   // P4: propose_run acts only in the chat's project
  const proposal = await real.call('propose_run', { projectKey: project.key, brief: 'Add a badge' });
  assert.equal(proposal.ok, true);
  assert.equal(proposal.card.projectKey, project.key);
});

// ── run-artifact + progress tools over the real readers ──────────────────────
test('list_run_artifacts / read_run_artifact / get_run_progress over real deps', async () => {
  const { recordArtifact, writeDecomposition, listRunArtifacts } = await import('../src/core/artifacts.mjs');
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const projectDir = mkdtempSync(join(tmpdir(), 'worca-ask-art-proj-'));
  await addProject({ name: 'artdemo', path: projectDir });
  const seeded = await seedPipeline(projectDir, { title: 'Art run', status: 'done', phase: 'review' });
  writeFileSync(join(seeded.dir, 'plan.md'), '# Plan\ncover feature X\n');
  mkdirSync(join(seeded.dir, 'extras'), { recursive: true });
  writeFileSync(join(seeded.dir, 'extras', 'notes.txt'), 'hi');
  recordArtifact(seeded.id, 'plan', 'plan.md', { stepKey: 'exec-1', nodeId: 'planner', cycle: 0 });
  recordArtifact(seeded.id, 'extra', 'extras/notes.txt', { stepKey: 'exec-2', nodeId: 'refiner', cycle: 1 });
  // A kit subresource: indexed so the deck viewer can serve it, but never worth a
  // row of the model's budget — the HTTP twin drops these in SQL before the LIMIT.
  recordArtifact(seeded.id, 'deck-asset', 'deck/kit/deck-stage.js', { stepKey: 'exec-3', nodeId: 'builder', cycle: 1 });
  writeDecomposition(seeded.id, [{ ordinal: 0, tasks: [{ id: 't1', title: 'leak ghp_abcdefghijklmnopqrstuvwxyz0123456789', file: 'x', nodeId: 'n' }] }]);

  const thread = createThread();
  const real = createAskTools(defaultToolDeps({ threadId: thread.id }));

  // list_run_artifacts: shape, filter, limit
  const listed = await real.call('list_run_artifacts', { runId: seeded.id });
  const plan = listed.artifacts.find((a) => a.relPath === 'plan.md');
  assert.ok(plan, 'plan.md listed');
  assert.equal(plan.stepKey, 'exec-1');
  assert.equal(plan.nodeId, 'planner');
  assert.equal(plan.cycle, 0);
  assert.equal(typeof plan.bytes, 'number');
  assert.ok('createdAt' in plan);
  assert.equal((await real.call('list_run_artifacts', { runId: seeded.id, kind: 'plan' })).artifacts.length, 1);
  assert.equal((await real.call('list_run_artifacts', { runId: seeded.id, stepKey: 'exec-2' })).artifacts.length, 1);
  // plan + extra above, plus the prompt.md row seedPipeline indexes — nothing transient
  assert.deepEqual(listed.artifacts.map((a) => a.kind).sort(), ['extra', 'plan', 'prompt'],
    'the deck-asset subresource never reaches the model, the way the HTTP twin drops it');
  const capped = await real.call('list_run_artifacts', { runId: seeded.id, limit: 1 });
  assert.equal(capped.artifacts.length, 1);
  assert.equal(capped.truncated, true);

  // Rows come back oldest-first, so the row budget is spent on the OLDEST rows and
  // the ones cut are the newest — on a presentation run, the deliverables. The
  // model got `truncated: true` and no way past it; paging by offset is the way.
  const page1 = await real.call('list_run_artifacts', { runId: seeded.id, limit: 2 });
  assert.equal(page1.artifacts.length, 2);
  assert.equal(page1.truncated, true);
  assert.equal(page1.nextOffset, 2, 'a truncated page says where the next one starts');
  const page2 = await real.call('list_run_artifacts', { runId: seeded.id, limit: 2, offset: page1.nextOffset });
  assert.equal(page2.truncated, false, 'the last page is not truncated');
  assert.equal(page2.nextOffset, undefined, 'and carries no cursor');
  assert.deepEqual(
    [...page1.artifacts, ...page2.artifacts].map((a) => a.relPath).sort(),
    listed.artifacts.map((a) => a.relPath).sort(),
    'paging reaches every row the uncapped list returns',
  );

  // read_run_artifact: indexed read, plus refusal of unindexed / traversing paths
  const read = await real.call('read_run_artifact', { runId: seeded.id, relPath: 'plan.md' });
  assert.match(read.text, /cover feature X/);
  assert.equal(read.relPath, 'plan.md');
  await assert.rejects(() => real.call('read_run_artifact', { runId: seeded.id, relPath: '../escape.md' }),
    { message: 'read_run_artifact: artifact not found' });
  await assert.rejects(() => real.call('read_run_artifact', { runId: seeded.id, relPath: 'nope.md' }),
    { message: 'read_run_artifact: artifact not found' });

  // get_run_progress: shape + free-text redaction of a task title
  const prog = await real.call('get_run_progress', { runId: seeded.id });
  assert.equal(prog.runId, seeded.id);
  assert.equal(prog.status, 'done');
  assert.ok(Array.isArray(prog.phases) && Array.isArray(prog.tasks));
  assert.ok(prog.clarify && Array.isArray(prog.reviews) && Array.isArray(prog.stepQuestions));
  const t1 = prog.tasks.find((t) => t.id === 't1');
  assert.doesNotMatch(t1.title, /ghp_abcdefghijklmnopqrstuvwxyz0123456789/, 'task title redacted');
});

// The one repo guard for the read-only chat tool layer (§6.1): tools.mjs, tool-deps.mjs and every
// src/core/ask/*-deps.mjs / *-proposal.mjs. Each row was a per-module source scan in that module's
// own test file (named in the row); their mcp-stdio wiring regexes are not carried.
test('ask tool layer stays write-free (table-driven source scan over tools.mjs, tool-deps.mjs and every src/core/ask/*-deps.mjs / *-proposal.mjs)', async () => {
  await checkRows([
    { name: 'source scan: tools.mjs issues no writes and never touches db.mjs; tool-deps.mjs only reads', run: () => {
      const src = readFileSync(new URL('../src/core/ask/tools.mjs', import.meta.url), 'utf8');
      assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE)\b/);
      assert.doesNotMatch(src, /from '\.\.\/db\.mjs'|getDb\(|\btx\(/);
      assert.doesNotMatch(src, /node:sqlite/);
      const deps = readFileSync(new URL('../src/core/ask/tool-deps.mjs', import.meta.url), 'utf8');
      assert.doesNotMatch(deps, /\b(INSERT|UPDATE|DELETE)\b/);
      assert.doesNotMatch(deps, /\btx\(|writeStoreMeta|writeState|rmSync|writeFile|mkdir|appendFile|unlink/, 'the real reader bundle never writes');
      assert.match(deps, /import \{ readFile, access \} from 'node:fs\/promises';/, 'fs surface = readFile + access only');
      assert.doesNotMatch(deps, /from 'node:fs'(?!\/promises)/);
    } },
    { name: 'every src/core/ask/*-deps.mjs / *-proposal.mjs: no SQL write verbs and no node:sqlite', run: () => {
      const dir = new URL('../src/core/ask/', import.meta.url);
      const mods = readdirSync(dir).filter((f) => /-(deps|proposal)\.mjs$/.test(f));
      for (const m of ['branch-deps.mjs', 'comment-deps.mjs', 'memory-deps.mjs', 'metrics-deps.mjs', 'metrics-proposal.mjs', 'script-deps.mjs', 'workflow-deps.mjs', 'worktree-deps.mjs']) {
        assert.ok(mods.includes(m), `the scan reaches ${m}`);
      }
      for (const m of mods) {
        const src = readFileSync(new URL(m, dir), 'utf8');
        assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE)\b/, m);
        assert.doesNotMatch(src, /node:sqlite/, m);
      }
    } },
    { name: 'test/ask-branch-tools.test.mjs > read-only pins: no write-tool set names list_branches; branch-deps never writes; mcp-stdio wires it', run: () => {
      const events = readFileSync(new URL('../src/core/ask/events.mjs', import.meta.url), 'utf8');
      for (const m of events.matchAll(/new Set\(\[([\s\S]*?)\]\)/g)) assert.ok(!m[1].includes('list_branches'), m[0]);
      const deps = readFileSync(new URL('../src/core/ask/branch-deps.mjs', import.meta.url), 'utf8');
      assert.doesNotMatch(deps, /fastForward|ensureLocalBranch|syncBaseForRun|syncRepo|update-ref|merge/);
    } },
    { name: 'test/ask-diff-comment-tools.test.mjs > source scan: tools.mjs is still write-free and db-free; comment-deps holds only the comment bundle', run: () => {
      const tools = readFileSync(new URL('../src/core/ask/tools.mjs', import.meta.url), 'utf8');
      assert.doesNotMatch(tools, /\b(INSERT|UPDATE|DELETE)\b/);
      assert.doesNotMatch(tools, /from '\.\.\/db\.mjs'|getDb\(|\btx\(|node:sqlite/);
      assert.equal(tools.split('\n').filter((l) => /^import /.test(l)).length, 0, 'tools.mjs stays import-free');
      const deps = readFileSync(new URL('../src/core/ask/comment-deps.mjs', import.meta.url), 'utf8');
      assert.doesNotMatch(deps, /node:sqlite|from '\.\.\/db\.mjs'/);
      assert.ok(deps.includes("from '../diff-comments.mjs'"), 'writes go through the one mutation module');
    } },
    { name: 'test/ask-memory-tools.test.mjs > source scans: tools.mjs still has no imports and no SQL verbs; memory-deps.mjs is the ONE Ask module that imports the store; the MCP child spreads it', run: () => {
      const tools = readFileSync(new URL('../src/core/ask/tools.mjs', import.meta.url), 'utf8');
      assert.doesNotMatch(tools, /^import /m, 'tools.mjs imports nothing');
      assert.doesNotMatch(tools, /\b(INSERT|UPDATE|DELETE)\b/);
      const deps = readFileSync(new URL('../src/core/ask/memory-deps.mjs', import.meta.url), 'utf8');
      assert.match(deps, /from '\.\.\/memory-store\.mjs'/);
      assert.doesNotMatch(deps, /from 'node:fs/, 'no direct fs — the store owns every write');
      const toolDeps = readFileSync(new URL('../src/core/ask/tool-deps.mjs', import.meta.url), 'utf8');
      assert.doesNotMatch(toolDeps, /memory-store/, 'tool-deps stays store-free');
    } },
    { name: 'test/ask-metrics-tools.test.mjs > source scan: the tools module still issues no writes; the deps bundle is the only file naming the metrics core', run: () => {
      const src = readFileSync(new URL('../src/core/ask/tools.mjs', import.meta.url), 'utf8');
      assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE)\b/);
      assert.doesNotMatch(src, /metrics\/(sync|read)\.mjs|outboxDir|slugDirName|worca-metrics\//, 'no metrics mechanics leak into the tool layer');
      const deps = readFileSync(new URL('../src/core/ask/metrics-deps.mjs', import.meta.url), 'utf8');
      assert.match(deps, /export async function applyMetricsChange/);
      assert.match(deps, /export function defaultMetricsDeps/);
    } },
    { name: 'test/ask-metrics-proposal.test.mjs > source scan: the validator module never writes and never touches the DB or git', run: () => {
      const src = readFileSync(new URL('../src/core/ask/metrics-proposal.mjs', import.meta.url), 'utf8');
      assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE)\b/);
      assert.doesNotMatch(src, /from '\.\.\/db\.mjs'|node:fs|node:child_process|metrics\/sync\.mjs/);
    } },
    { name: 'test/ask-script-tools.test.mjs > source scans: tools.mjs stays import-free and write-free; script-deps.mjs is the ONE Ask module that imports the store and the bench', run: () => {
      const tools = readFileSync(new URL('../src/core/ask/tools.mjs', import.meta.url), 'utf8');
      assert.doesNotMatch(tools, /^import /m, 'tools.mjs imports nothing');
      assert.doesNotMatch(tools, /\b(INSERT|UPDATE|DELETE)\b/);
      assert.doesNotMatch(tools, /script-store|script-bench/, 'the store and the bench are reachable only through deps.scripts');
      const deps = readFileSync(new URL('../src/core/ask/script-deps.mjs', import.meta.url), 'utf8');
      assert.match(deps, /from '\.\.\/script-store\.mjs'/);
      assert.match(deps, /from '\.\.\/script-bench\.mjs'/);
      assert.doesNotMatch(deps, /from 'node:fs/, 'no direct fs — the store owns every write');
      const toolDeps = readFileSync(new URL('../src/core/ask/tool-deps.mjs', import.meta.url), 'utf8');
      assert.doesNotMatch(toolDeps, /script-store|script-bench/, 'tool-deps stays read-only');
    } },
    { name: 'test/ask-workflow-deps.test.mjs > source scan: workflow-deps.mjs never writes (no row writer, no db.mjs, no SQL verbs)', run: () => {
      const src = readFileSync(new URL('../src/core/ask/workflow-deps.mjs', import.meta.url), 'utf8');
      assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE)\b/);
      assert.doesNotMatch(src, /from '\.\.\/db\.mjs'|getDb\(|\btx\(|node:sqlite|writeGraphWorkflow|mintAutoWorkflowId/);
    } },
    { name: 'test/ask-worktree-tools.test.mjs > source scans: tools.mjs still write-free; worktree-deps.mjs holds only the worktree bundle', run: () => {
      const tools = readFileSync(new URL('../src/core/ask/tools.mjs', import.meta.url), 'utf8');
      assert.doesNotMatch(tools, /from '\.\.\/db\.mjs'|getDb\(|\btx\(|node:sqlite/);
      const deps = readFileSync(new URL('../src/core/ask/worktree-deps.mjs', import.meta.url), 'utf8');
      assert.doesNotMatch(deps, /from '\.\.\/db\.mjs'|node:sqlite|writeStoreMeta|writeFile|appendFile|rmSync/);
      for (const m of ['./worktrees.mjs', '../worktree.mjs', './git-allowlist.mjs']) {
        assert.ok(deps.includes(`from '${m}'`), `worktree-deps imports ${m}`);
      }
    } },
  ]);
});

// Review of PR #376: every page re-read the whole diff-patch.patch, re-split it
// into sections and re-redacted every kept section before slicing one window —
// a 5 MB patch at the default page was ~85 full passes. The filtered body is now
// memoised per run for the life of the tools closure (one MCP child = one turn).
test('get_run_diff: paging reuses the parsed/redacted patch — one read per run; a changed row stamp re-reads', async () => {
  let reads = 0;
  const t = createAskTools({ ...fake, readDiffPatch: async (row) => { reads += 1; return diffs.get(row.id) ?? null; } });
  const a = await t.call('get_run_diff', { id: '4e1f2a9b', maxBytes: 40 });
  const b = await t.call('get_run_diff', { id: '4e1f2a9b', offset: a.nextOffset, maxBytes: 40 });
  const c = await t.call('get_run_diff', { id: '4e1f2a9b', path: 'docs/notes.md' });
  assert.equal(reads, 1, 'three pages, one read + parse');
  assert.deepEqual(b.files, a.files);
  assert.ok(c.text.includes('docs/notes.md'));
  assert.ok(!c.text.includes('src/app.js'), 'the path filter still applies from the cache');
  // the whole-body result is byte-identical to an uncached call
  const fresh = createAskTools(fake);
  assert.deepEqual(await t.call('get_run_diff', { id: '4e1f2a9b' }), await fresh.call('get_run_diff', { id: '4e1f2a9b' }));
  assert.equal(reads, 1);
});

// ── #397: the user-pinned scope ──────────────────────────────────────────────

test('#397: an unscoped run id tries the pinned scope first, then falls back everywhere', async () => {
  const hits = [];
  const t = createAskTools({
    ...fake,
    pinnedScope: () => ({ projectKey: 'demo-00000001' }),
    lookupPipelineRow: (key, id) => { hits.push([key, id]); return fake.lookupPipelineRow(key, id); },
  });
  const run = await t.call('get_run', { id: '4e1f2a9b' });
  assert.equal(run.id, '4e1f2a9b');
  assert.deepEqual(hits, [['demo-00000001', '4e1f2a9b']], 'resolved inside the pin, no global search');
  // the pin never hides a run that lives elsewhere — the global fallback still fires
  const other = await t.call('get_run', { id: 'bbbbbbbb' });
  assert.equal(other.id, 'bbbbbbbb');
  // a workspace pin scopes to the workspace store key
  const tw = createAskTools({ ...fake, pinnedScope: () => ({ workspaceId: 'wks-team-0000abcd' }) });
  assert.equal((await tw.call('get_run', { id: '8c3d12ab' })).id, '8c3d12ab');
  // an explicit key always wins over the pin — a wrong one still means not found
  await assert.rejects(t.call('get_run', { id: '4e1f2a9b', projectKey: 'other-00000003' }), /run not found/);
});

test('#397/P4: propose_run takes the chat scope only when nothing is named; a target outside it is refused; no reader = no chat, a failing reader = No project', async () => {
  await checkRows([
    { name: '#397: propose_run defaults its target from the pin ONLY when both keys are absent', run: async () => {
      const t = createAskTools({ ...fake, pinnedScope: () => ({ projectKey: 'demo-00000001' }) });
      const r = await t.call('propose_run', { brief: 'x' });
      assert.equal(r.card.echoed.projectKey, 'demo-00000001', 'the pin fills the missing target');
      const r2 = await t.call('propose_run', { brief: 'x', workspaceId: 'wks-team-0000abcd' });
      assert.deepEqual(r2, { ok: false, errors: [scopeRefusalText({ projectKey: 'demo-00000001' }, { workspaceId: 'wks-team-0000abcd' })] });
      const tw = createAskTools({ ...fake, pinnedScope: () => ({ workspaceId: 'wks-team-0000abcd' }) });
      assert.deepEqual((await tw.call('propose_run', { brief: 'x' })).card.echoed.workspaceId, 'wks-team-0000abcd');
    } },
    { name: '#397: a missing or failing pinnedScope dep means "nothing pinned", never an error', run: async () => {
      const noDep = createAskTools(fake);   // the shared `fake` has no pinnedScope at all
      const card = (await noDep.call('propose_run', { brief: 'x' })).card;
      assert.equal(card.echoed.projectKey, undefined);
      assert.equal(card.echoed.noProject, undefined, 'no chat: nothing filled');
      assert.equal((await noDep.call('get_run', { id: '4e1f2a9b' })).id, '4e1f2a9b');
      const throwing = createAskTools({ ...fake, pinnedScope: () => { throw new Error('db gone'); } });
      const thrown = (await throwing.call('propose_run', { brief: 'x' })).card;
      assert.equal(thrown.echoed.projectKey, undefined);
      assert.equal(thrown.echoed.noProject, true, 'a failing reader is No project');
      assert.equal((await throwing.call('get_run', { id: '4e1f2a9b' })).id, '4e1f2a9b');
    } },
  ]);
});

// list_run_artifacts lists every indexed row, screenshots and PDFs included, and
// read_run_artifact decoded all of them with readFile(…, 'utf8') — so asking for
// a slide render charged up to 200KB of replacement-character mojibake to the
// turn's context. The UI has a raw-bytes route for these; the tool refuses them
// and says where the bytes are instead.
test('read_run_artifact refuses byte kinds and still reads text kinds', async () => {
  await checkRows([
    { name: 'read_run_artifact refuses the byte kinds instead of decoding them as text', run: async () => {
      const tools = createAskTools({
        limits: ASK_LIMITS,
        redact: (t) => t,
        findPipelineRowById: () => ({ id: 'p1' }),
        readRunArtifact: async () => { throw new Error('must not be read'); },
      });
      for (const rel of ['shots/s01.png', 'deck/deck.pdf', 'deck/poppins-400.woff2']) {
        await assert.rejects(
          () => tools.call('read_run_artifact', { runId: 'p1', relPath: rel }),
          (e) => e instanceof AskToolError && /not text/i.test(e.message), rel,
        );
      }
    } },
    { name: 'read_run_artifact still reads the text kinds', run: async () => {
      const tools = createAskTools({
        limits: ASK_LIMITS,
        redact: (t) => t,
        findPipelineRowById: () => ({ id: 'p1' }),
        lookupPipelineRow: () => ({ id: 'p1' }),
        readRunArtifact: async (_row, rel) => ({ rel, text: '# the plan\n' }),
      });
      const out = await tools.call('read_run_artifact', { runId: 'p1', relPath: 'plan.md' });
      assert.equal(out.text, '# the plan\n');
    } },
  ]);
});

// tools.mjs is import-free by contract (two source scans assert it), so its byte
// extensions are restated rather than imported. This pins the two sets together:
// every extension the SHARED table decodes as bytes must be refused here, and
// nothing else may be. An extension added to one side and not the other fails.
test('isByteArtifact agrees with the shared artifact-kind table', () => {
  const exts = [
    'md', 'markdown', 'txt', 'json', 'csv', 'log', 'ndjson', 'diff', 'patch', 'html', 'htm', 'js', 'mjs', 'css',
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf',
    'pptx', 'docx', 'xlsx', 'key', 'zip', 'tar', 'woff2', 'woff', 'ttf', 'otf', 'mp3', 'mp4',
    'xyz', 'gitignore',
  ];
  for (const ext of exts) {
    const rel = `deck/file.${ext}`;
    assert.equal(isByteArtifact(rel), BINARY_KINDS.has(viewerKindFor(rel)), `.${ext}`);
  }
  assert.equal(isByteArtifact('Makefile'), false, 'no extension is not bytes');
  assert.equal(isByteArtifact('shots/S01.PNG'), true, 'the extension match is case-insensitive');
});

// ── Shape it first (spec D9, D12): propose_run's shape/assess fields ride the injected gate ──

test('propose_run: shape and assess exist only with the perspective keys', async () => {
  const { PERSPECTIVE_KEYS } = await import('../src/shared/shape/perspectives.mjs');
  const schemaOf = (deps) => createAskTools({ ...fake, ...deps }).list().find((d) => d.name === 'propose_run').inputSchema;
  const today = schemaOf({});
  assert.deepEqual(Object.keys(today.properties), ['projectKey', 'workspaceId', 'noProject', 'workflowId', 'presetId', 'brief', 'source', 'title', 'guardrailsId', 'tags', 'memoryScope',
    'engine', 'sourceBranch', 'featureBranch', 'sameAsSource', 'note', 'nodes', 'attachmentIds', 'sourceBranchByKey', 'commentIds',
    'when', 'every', 'until', 'count', 'overlap', 'maxFailures', 'after', 'afterPolicy', 'sourceFromPrevious'], 'no deps: today\'s schema');
  assert.deepEqual(today.required, ['brief']);
  await checkRows([
    { name: 'empty perspectiveKeys: no shape fields', run: () => {
      assert.deepEqual(schemaOf({ perspectiveKeys: [] }), today);
    } },
    { name: 'with perspectiveKeys: shape and assess, required unchanged', run: () => {
      const s = schemaOf({ perspectiveKeys: PERSPECTIVE_KEYS });
      assert.deepEqual(s.required, ['brief']);
      assert.equal(s.additionalProperties, false);
      const keys = Object.keys(s.properties);
      assert.deepEqual(keys.slice(keys.indexOf('commentIds'), keys.indexOf('commentIds') + 3), ['commentIds', 'shape', 'assess'], 'right after commentIds');
      assert.equal(s.properties.shape.additionalProperties, false);
      assert.deepEqual(s.properties.shape.properties.perspectives.items.enum, [...PERSPECTIVE_KEYS]);
      assert.deepEqual(s.properties.shape.properties.slices.enum, ['auto', 'off']);
      assert.match(s.properties.shape.properties.slices.description, /2–5 sequential slices/);
      assert.doesNotMatch(s.properties.shape.properties.slices.description, /not available yet/);
      assert.match(s.properties.assess.description, /on every coding run; on a shaped run only `size` is read/);
      assert.equal(s.properties.assess.additionalProperties, false);
      assert.deepEqual(s.properties.assess.required, ['size', 'openDecisions']);
      assert.deepEqual(s.properties.assess.properties.size.enum, ['small', 'medium', 'large']);
      assert.equal(s.properties.assess.properties.openDecisions.maxItems, 6);
      assert.deepEqual(s.properties.assess.properties.perspectives.items.enum, [...PERSPECTIVE_KEYS]);
    } },
    { name: 'defaultToolDeps carries the perspective keys', run: () => {
      const d = defaultToolDeps({ threadId: null });
      assert.ok(Array.isArray(d.perspectiveKeys) && d.perspectiveKeys.length > 0);
      assert.deepEqual([...d.perspectiveKeys], [...PERSPECTIVE_KEYS]);
    } },
  ]);
});

test('an Ask chat with a composer bundle lists the drafts and the graph proposal right after its other tools — never the canvas tools', () => {
  const names = createAskTools({ ...fake, composer: {} }).list().map((d) => d.name);
  assert.deepEqual(names.slice(names.indexOf('get_task') + 1), ['build_workflow', 'draft_agent', 'draft_script', 'get_agent', 'get_workflow']);
  for (const n of ['get_canvas', 'edit_canvas']) assert.equal(names.includes(n), false, n);
  assert.ok(names.includes('propose_run') && names.includes('propose_workflow'), 'Ask keeps its own proposals');
});

test('P3: propose_run { noProject: true } never takes the pinned scope', async () => {
  const t = createAskTools({ ...fake, pinnedScope: () => ({ projectKey: 'demo-00000001' }) });
  const r = await t.call('propose_run', { noProject: true, brief: 'x' });
  assert.equal('projectKey' in r.card.echoed, false, 'the pin is not filled');
  assert.equal('workspaceId' in r.card.echoed, false);
  assert.equal(r.card.echoed.noProject, true);
  const tw = createAskTools({ ...fake, pinnedScope: () => ({ workspaceId: 'wks-team-0000abcd' }) });
  assert.equal('workspaceId' in (await tw.call('propose_run', { noProject: true, brief: 'x' })).card.echoed, false);
  const schema = t.list().find((d) => d.name === 'propose_run');
  assert.equal(schema.inputSchema.properties.noProject.type, 'boolean');
  assert.match(schema.description, /Exactly one of projectKey \/ workspaceId \/ noProject: true \(a run with no project works in its own empty folder: its files are the result; no git, branch or pull request; it cannot be scheduled or chained yet\); omitting all three targets /);   // P4 Task 4 rewrites the rest of the sentence
});

test('P3: propose_run { noProject: true } refuses known diff comments (they belong to a project); unknown ids stay tolerated', async () => {
  const t = createAskTools({
    ...fake,
    validateProposal: async () => ({ ok: true, card: { target: 'none', projectKey: null, workspaceId: null } }),
    comments: { get: (id) => (id === 'dc_1a2b3c4d' ? { id, storeKey: 'demo-00000001' } : null) },
  });
  assert.deepEqual(await t.call('propose_run', { noProject: true, brief: 'b', commentIds: ['dc_1a2b3c4d', 'dc_deadbeef'] }),
    { ok: false, errors: ['a run without a project cannot address diff comments: dc_1a2b3c4d — propose it on the project those comments belong to'] });
  assert.equal((await t.call('propose_run', { noProject: true, brief: 'b', commentIds: ['dc_deadbeef'] })).ok, true);
});

test('P3: get_run and list_runs name a run without a project target "none", with no project key to copy into propose_run', async () => {
  const ROW_N = { ...ROW_P, id: 'dddddddd', project_key: 'no-project-00000000', title: 'Q3 deck', branch: JSON.stringify({ workMode: 'none', runRootMode: 'detached' }) };
  const LITE_N = { ...LITE[1], id: 'dddddddd', title: 'Q3 deck', branch: null, sourceBranch: null, projectKey: 'no-project-00000000', projectName: 'No project', projectDir: '/h/runs/dddddddd/work' };
  const t = createAskTools({ ...fake, findPipelineRowById: (id) => (id === 'dddddddd' ? ROW_N : fake.findPipelineRowById(id)), listAllPipelines: async () => [LITE_N, ...LITE] });
  const g = await t.call('get_run', { id: 'dddddddd' });
  assert.deepEqual([g.target, g.project, g.workspace, g.branch], ['none', null, null, null]);
  const [l] = await t.call('list_runs', {});
  assert.deepEqual(l, { id: 'dddddddd', title: 'Q3 deck', target: 'none', status: 'done', startedAt: ROW_P.started_at, updatedAt: '2026-08-20T10:00:00.000Z',
    branch: null, sourceBranch: null, guardrailsId: 'normal', totalCostUsd: 1.25, startedBy: null });
  assert.deepEqual((await t.call('list_runs', { projectKey: 'no-project-00000000' })).map((r) => r.id), ['dddddddd'], 'the store key still filters');
});

test('show_files: gated by deps.showFiles; validates counts; hands rows through resolveRow', async () => {
  assert.equal(createAskTools(fake).list().some((t) => t.name === 'show_files'), false, 'no bundle, no tool');
  const calls = [];
  const t = createAskTools({ ...fake, showFiles: { show: async (req) => { calls.push(req); await req.rowFor('r_missing').catch((e) => calls.push(e.message)); return { ok: true, items: [] }; } } });
  const def = t.list().find((d) => d.name === 'show_files');
  assert.ok(def && def.inputSchema.additionalProperties === false && def.description.length > 20);
  await assert.rejects(t.call('show_files', {}), /at least one/);
  await assert.rejects(t.call('show_files', { attachmentIds: Array.from({ length: 13 }, (_, i) => `att_${i}`) }), /at most 12/);
  await t.call('show_files', { files: [{ path: '$WORCA_ASK_OUT/a.png' }], caption: 'Home' });
  assert.equal(calls[0].caption, 'Home');
  assert.match(calls[1], /show_files: run not found/);
});

test('defaultToolDeps: list_presets shows a preset naming no guardrails as the install default (V21 wiring)', async () => {
  const { prepare, GUARDRAILS_DEFAULT_META_KEY } = await import('../src/core/db.mjs');
  prepare('INSERT OR REPLACE INTO store_meta (key, kind, data) VALUES (?, ?, ?)').run(GUARDRAILS_DEFAULT_META_KEY, 'setting', JSON.stringify('secure'));
  try {
    const deps = defaultToolDeps({ threadId: 'ask_00000001' });
    assert.equal(deps.defaultGuardrailsId?.(), 'secure');
    const t = createAskTools({ ...deps, pinnedScope: () => null,
      listPresets: () => [{ id: 'rp_aaaaaaaaaaaa', name: 'Bare', scope: { kind: 'global', ref: null }, setup: {} }] });
    assert.equal((await t.call('list_presets', {})).presets[0].guardrailsId, 'secure');
  } finally {
    prepare('DELETE FROM store_meta WHERE key = ?').run(GUARDRAILS_DEFAULT_META_KEY);
  }
});
