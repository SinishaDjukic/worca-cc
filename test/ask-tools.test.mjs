// test/ask-tools.test.mjs
// P1/T12: the worca MCP tools (ask-worca-design.md §6.4) — pure helpers, handlers
// over fake readers, one temp-home round trip over the real readers, and the
// read-only source scan (§6.1).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline, seedWorkspacePipeline } from './helpers/db-seed.mjs';
import { createAskTools, AskToolError, splitUnifiedDiff, isProtectedBasename, sliceBytes } from '../src/core/ask/tools.mjs';
import { defaultToolDeps } from '../src/core/ask/tool-deps.mjs';
import { addProject } from '../src/core/projects.mjs';
import { createThread, appendMessage, addAttachment } from '../src/core/ask/store.mjs';
import { GUARDRAIL_PRESETS } from '../src/core/guardrails.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { redactAskText } from '../src/core/ask/redact.mjs';

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

test('splitUnifiedDiff: EVERY `diff --git ` line starts a section, prefixes or not', () => {
  const s = splitUnifiedDiff(NOPREFIX_DIFF);
  assert.deepEqual(s.map((x) => [x.path, x.added, x.removed]),
    [['aaa.txt', 1, 0], ['secrets/db.json', 1, 0], ['zserver.pem', 1, 0]],
    'three sections with their own counts — not one section charging +3 to aaa.txt');
  assert.equal(s.map((x) => x.text).join(''), NOPREFIX_DIFF, 'sections concatenate back to the input');
});

test('splitUnifiedDiff: a header whose path cannot be read yields path:null, and never absorbs the next file', () => {
  const patch = 'diff --git a/ok.md b/ok.md\n+++ b/ok.md\n@@ -0,0 +1 @@\n+fine\n'
    + 'diff --git !weird!\nBinary files differ\nDB_PASSWORD=hunter2\n';
  assert.deepEqual(splitUnifiedDiff(patch).map((x) => [x.path, x.member]), [['ok.md', false], [null, false]]);
  // a member header is a section of its own: an unreadable body cannot ride inside it
  const ws = splitUnifiedDiff('# app-00000001\ndiff --git secrets/db.json secrets/db.json\n+++ secrets/db.json\n+DB_PASSWORD=hunter2\n');
  assert.deepEqual(ws.map((x) => [x.path, x.projectKey, x.member]), [[null, 'app-00000001', true], ['secrets/db.json', 'app-00000001', false]]);
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

test('splitUnifiedDiff: only a `diff --git ` section may take its path from a `--- `/`+++ ` label', () => {
  assert.deepEqual(splitUnifiedDiff(LEGACY_EXTERNAL_DIFF).map((x) => x.path), [null],
    'one unattributable section — not a section named aaa.txt carrying the .env body');
  // a relative label is no better: with no header the diff TOOL chose the shape, so
  // the label is a claim about a file, not git's own name for the section
  assert.deepEqual(splitUnifiedDiff('--- aaa.txt\n+++ aaa.txt\n@@ -1 +1 @@\n+x\n--- .env\n+++ .env\n+A=SECRET\n')
    .map((x) => x.path), [null]);
  // …while a real header keeps the label precedence of the tests above intact
  assert.deepEqual(splitUnifiedDiff('diff --git !weird!\n+++ "b/caf\\303\\251.env"\n+X=1\n').map((x) => x.path), ['café.env']);
});

test('splitUnifiedDiff: a `diff --git ` header is read only where it is unambiguous', () => {
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
});

test('splitUnifiedDiff: the section`s own `+++ ` line wins over the ambiguous header', () => {
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

test('isProtectedBasename: the seven normal-tier patterns, * prefix/suffix only', () => {
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
});

test('isProtectedBasename: slash-containing patterns match the whole path; ~/ and // patterns are skipped', () => {
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
});

test('sliceBytes: pages on byte offsets, cuts at a newline, never splits a UTF-8 sequence', () => {
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
});

test('sliceBytes: always advances — the UTF-8 back-off can never return zero progress', () => {
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
  readStoreMeta: (key) => (key === 'demo-00000001' ? { name: 'Demo' } : null),
  readDiffPatch: async (row) => diffs.get(row.id) ?? null,
  hasDiffPatch: async (row) => diffs.has(row.id),
  readAttachment: (id) => (id === 'att_00000001' ? { name: 'notes.md', text: 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789 here\nsecond line\n' } : null),
  validateProposal: async (input) => ({ ok: true, card: { echoed: input } }),
  protectedPaths: GUARDRAIL_PRESETS.normal.protectedPaths,
  redact: redactAskText,
  limits: ASK_LIMITS,
};
const tools = createAskTools(fake);

test('list(): fifteen tools with JSON-Schema inputs', () => {
  const defs = tools.list();
  assert.deepEqual(defs.map((d) => d.name), ['list_projects', 'list_workflows', 'list_runs', 'get_run', 'get_run_diff', 'propose_run', 'read_attachment',
    'list_diff_comments', 'add_diff_comment', 'resolve_diff_comment', 'delete_diff_comment',
    'open_worktree', 'list_worktrees', 'remove_worktree', 'git']);
  for (const d of defs) {
    assert.ok(typeof d.description === 'string' && d.description.length > 20, `${d.name} description`);
    assert.equal(d.inputSchema.type, 'object');
    assert.equal(d.inputSchema.additionalProperties, false);
  }
  assert.deepEqual(tools.list().find((d) => d.name === 'get_run').inputSchema.required, ['id']);
  assert.deepEqual(tools.list().find((d) => d.name === 'propose_run').inputSchema.required, ['brief']);
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

test('list_runs: scan limit, filters, newest-first order preserved, shape per target, limit clamp', async () => {
  calls.length = 0;
  const all = await tools.call('list_runs', {});
  assert.deepEqual(calls[0], ['listAllPipelines', { lite: true, limit: 200 }]);
  assert.deepEqual(all.map((r) => r.id), ['8c3d12ab', '4e1f2a9b', 'bbbbbbbb']);
  assert.deepEqual(all[0], { id: '8c3d12ab', title: 'Rename', target: 'workspace', workspaceId: 'wks-team-0000abcd', workspaceName: 'Team', status: 'running',
    startedAt: ROW_W.started_at, updatedAt: null, branch: 'worca-cc/rename-8c3d12ab', sourceBranch: null, guardrailsId: 'secure', totalCostUsd: null });
  assert.deepEqual(all[1], { id: '4e1f2a9b', title: 'Fix login', target: 'project', projectKey: 'demo-00000001', projectName: 'Demo', status: 'done',
    startedAt: ROW_P.started_at, updatedAt: '2026-08-20T10:00:00.000Z', branch: 'worca-cc/fix-login-4e1f2a9b', sourceBranch: 'main', guardrailsId: 'normal', totalCostUsd: 1.25 });
  assert.deepEqual((await tools.call('list_runs', { projectKey: 'demo-00000001' })).map((r) => r.id), ['4e1f2a9b']);
  assert.deepEqual((await tools.call('list_runs', { workspaceId: 'wks-team-0000abcd' })).map((r) => r.id), ['8c3d12ab']);
  assert.deepEqual((await tools.call('list_runs', { status: 'ERROR' })).map((r) => r.id), ['bbbbbbbb'], 'status match is case-insensitive');
  assert.deepEqual((await tools.call('list_runs', { query: 'login' })).map((r) => r.id), ['4e1f2a9b'], 'title substring, case-insensitive');
  assert.equal((await tools.call('list_runs', { limit: 1 })).length, 1);
  await assert.rejects(() => tools.call('list_runs', { projectKey: 'a', workspaceId: 'b' }), AskToolError);
  calls.length = 0;
  await tools.call('list_runs', { projectKey: 'demo-00000001' });
  assert.deepEqual(calls[0], ['listAllPipelines', { lite: true, limit: -1 }], 'a keyed query scans every row (a project\'s runs may all be older than the 200 newest)');
});

test('list_runs: limit is clamped to 1..100, default 20 (130-row fake — both bounds observable)', async () => {
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
});

test('get_run: scoped and key-less lookups, project and workspace shapes, archived flag', async () => {
  const p = await tools.call('get_run', { id: '4e1f2a9b', projectKey: 'demo-00000001' });
  assert.deepEqual(p, { id: '4e1f2a9b', title: 'Fix login', target: 'project', project: { key: 'demo-00000001', name: 'Demo' }, workspace: null,
    status: 'done', phase: 'done', startedAt: ROW_P.started_at, updatedAt: ROW_P.updated_at, branch: 'worca-cc/fix-login-4e1f2a9b', sourceBranch: 'main',
    guardrailsId: 'normal', prompt: 'Fix the login bug', totalCostUsd: 1.25, hasDiff: true, archived: false });
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

test('get_run_diff: a rename OUT OF a credential file is dropped — the old file`s lines never ship', async () => {
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
});

test('get_run_diff: a HARMLESS rename still ships, listed under its new path', async () => {
  const t = createAskTools({ ...fake,
    readDiffPatch: async () => 'diff --git a/docs/a.md b/docs/b.md\nsimilarity index 90%\nrename from docs/a.md\nrename to docs/b.md\n--- a/docs/a.md\n+++ b/docs/b.md\n@@ -1 +1 @@\n-x\n+y\n' });
  const d = await t.call('get_run_diff', { id: '4e1f2a9b' });
  assert.deepEqual(d.files, [{ path: 'docs/b.md', added: 1, removed: 1 }], 'files[].path is the NEW path');
  assert.ok(d.text.includes('rename from docs/a.md'), 'and the section ships whole');
});

test('read_attachment: thread-scoped reader, redaction, paging, not found', async () => {
  const r = await tools.call('read_attachment', { id: 'att_00000001' });
  assert.equal(r.name, 'notes.md');
  assert.equal(r.text, 'token ghp_<redacted> here\nsecond line\n');
  assert.equal(r.truncated, false);
  assert.equal(r.totalBytes, Buffer.byteLength(r.text));
  const p = await tools.call('read_attachment', { id: 'att_00000001', maxBytes: 5 });
  assert.equal(p.truncated, true);
  await assert.rejects(() => tools.call('read_attachment', { id: 'att_ffffffff' }), { message: 'read_attachment: attachment not found' });
  await assert.rejects(() => tools.call('read_attachment', {}), { message: 'read_attachment: id is required' });
});

test('propose_run passes through validateProposal; unknown tools and bad input are AskToolErrors', async () => {
  assert.deepEqual(await tools.call('propose_run', { projectKey: 'demo-00000001', brief: 'b' }), { ok: true, card: { echoed: { projectKey: 'demo-00000001', brief: 'b' } } });
  await assert.rejects(() => tools.call('nope', {}), { name: 'AskToolError', message: 'unknown tool: nope' });
  await assert.rejects(() => tools.call('get_run', 'not-an-object'), AskToolError);
  await assert.rejects(() => tools.call('get_run', { id: 'x', projectKey: 'a', workspaceId: 'b' }), { message: 'get_run: give projectKey OR workspaceId, not both' });
});

test('propose_run accepts commentIds and passes them through untouched', async () => {
  assert.deepEqual(await tools.call('propose_run', { projectKey: 'demo-00000001', brief: 'b', commentIds: ['dc_00000001'] }),
    { ok: true, card: { echoed: { projectKey: 'demo-00000001', brief: 'b', commentIds: ['dc_00000001'] } } });
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
  const diff = await real.call('get_run_diff', { id: seeded.id, projectKey: project.key });
  assert.deepEqual(diff.files.map((f) => f.path), ['src/app.js', 'docs/notes.md']);
  const wsRun = await real.call('get_run', { id: wsSeed.id, workspaceId: 'wks-team-0000abcd' });
  assert.equal(wsRun.target, 'workspace');
  assert.deepEqual(wsRun.workspace.members, ['team']);
  const wsDiff = await real.call('get_run_diff', { id: wsSeed.id });
  assert.equal(wsDiff.files[0].projectKey, 'team-00000001');
  assert.equal((await real.call('read_attachment', { id: att.id })).text, 'hello');
  const other = createAskTools(defaultToolDeps({ threadId: otherThread.id }));
  await assert.rejects(() => other.call('read_attachment', { id: att.id }), { message: 'read_attachment: attachment not found' }, "another thread's attachment is invisible");
  const proposal = await real.call('propose_run', { projectKey: project.key, brief: 'Add a badge' });
  assert.equal(proposal.ok, true);
  assert.equal(proposal.card.projectKey, project.key);
});

test('source scan: tools.mjs issues no writes and never touches db.mjs; tool-deps.mjs only reads', () => {
  const src = readFileSync(new URL('../src/core/ask/tools.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE)\b/);
  assert.doesNotMatch(src, /from '\.\.\/db\.mjs'|getDb\(|\btx\(/);
  assert.doesNotMatch(src, /node:sqlite/);
  const deps = readFileSync(new URL('../src/core/ask/tool-deps.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(deps, /\b(INSERT|UPDATE|DELETE)\b/);
  assert.doesNotMatch(deps, /\btx\(|writeStoreMeta|writeState|rmSync|writeFile|mkdir|appendFile|unlink/, 'the real reader bundle never writes');
  assert.match(deps, /import \{ readFile, access \} from 'node:fs\/promises';/, 'fs surface = readFile + access only');
  assert.doesNotMatch(deps, /from 'node:fs'(?!\/promises)/);
});
