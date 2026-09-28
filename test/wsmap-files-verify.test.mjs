// test/wsmap-files-verify.test.mjs — file listing, containment, safe reads, evidence verification (wsmap P1).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { SKIP_DIRS, isTestPath, listMemberFiles, resolveInside, readText, gitOutput } from '../src/core/workspace-map/files.mjs';
import { createFileCache, verifyFact } from '../src/core/workspace-map/verify.mjs';
import { makeRepos } from './helpers/wsmap-p1-repos.mjs';

const ws = await makeRepos({
  web: {
    'src/api.ts': "import x from 'y';\n\nexport const a = 1;\n\nconst url = '/invoices/' + id;\nfetch(url);\n\n// end\n",
    'src/api.test.ts': 'test()\n',
    'graphify-out/graph.json': '{}',
    'node_modules/dep/index.js': 'x',
    '.gitignore': 'ignored.txt\n',
    'README.md': '# Web\n',
    'bin.dat': Buffer.from([1, 2, 0, 3]),
    'big.txt': 'x'.repeat(100),
  },
});
const plain = await makeRepos({ loose: { 'a.txt': 'hello\n', 'build/out.js': 'x', 'sub/b.txt': 'b\n' } }, { git: false });
const odd = await makeRepos({ 'my app ü': { 'src/größe.ts': "export const q = 'x';\n", 'a b.txt': 'x\n' } });
const cased = await makeRepos({ c: { 'Node_Modules/dep/index.js': 'x\n', 'Bin/tool.txt': 'x\n', 'src/a.ts': 'x\n' } });
after(async () => { await ws.cleanup(); await plain.cleanup(); await odd.cleanup(); await cased.cleanup(); });
const web = ws.members[0].dir;

test('SKIP_DIRS and isTestPath', () => {
  assert.ok(Object.isFrozen(SKIP_DIRS));
  for (const d of ['.git', 'node_modules', 'graphify-out', '.worca-cc', 'DerivedData']) assert.ok(SKIP_DIRS.includes(d), d);
  for (const p of ['test/a.js', 'src/__tests__/x.ts', 'a/spec/b.rb', 'e2e/x.ts', 'src/fixtures/a.json', 'x.test.ts', 'x.spec.js', 'pkg/a_test.go',
    'src/FooTest.java', 'FooTests.cs', 'tests/test_x.py', 'app/src/androidTest/X.kt', 'shop/tests.py', 'test.py', 'Tests/Unit/x.cs',
    'Spec/models/user_spec.rb', 'MyApp.Tests/Services/Billing.cs', 'Acme.Billing.Test/x.cs']) assert.equal(isTestPath(p), true, p);
  for (const p of ['src/api.ts', 'testing.md', 'src/contest.ts', 'latest/x.js', 'shop/contests.py', 'src/Contest/x.ts', 'src/testsuite.py']) {
    assert.equal(isTestPath(p), false, p);
  }
  // An API contract under spec/ or specs/, or named *.spec.*, is what a member provides — not a test.
  for (const p of ['specs/openapi.yaml', 'api/spec/openapi.yaml', 'spec/swagger.json', 'openapi.spec.json', 'api.spec.yaml',
    'contracts/specs/asyncapi.yaml', 'schema/specs/schema.graphql', 'spec/billing.proto']) assert.equal(isTestPath(p), false, p);
  for (const p of ['spec/models/user_spec.rb', 'src/app.spec.ts', 'specs/helpers.js', 'test/fixtures/openapi.yaml', 'e2e/specs/flow.json']) {
    assert.equal(isTestPath(p), true, p);
  }
});

test('listMemberFiles: git ls-files (+ untracked, minus ignored) without SKIP_DIRS, sorted', async () => {
  await writeFile(join(web, 'new.ts'), 'x');
  await writeFile(join(web, 'ignored.txt'), 'x');
  const r = await listMemberFiles(web);
  assert.equal(r.via, 'git');
  assert.equal(r.truncated, false);
  assert.deepEqual(r.files, ['.gitignore', 'README.md', 'big.txt', 'bin.dat', 'new.ts', 'src/api.test.ts', 'src/api.ts']);
  const capped = await listMemberFiles(web, { maxFiles: 2 });
  assert.deepEqual(capped, { files: ['.gitignore', 'README.md'], truncated: true, via: 'git' });
});

test('SKIP_DIRS fold case where the file system does (win32, darwin)', async () => {
  const { files } = await listMemberFiles(cased.members[0].dir);
  const folds = process.platform === 'win32' || process.platform === 'darwin';
  assert.deepEqual(files, folds ? ['src/a.ts'] : ['Bin/tool.txt', 'Node_Modules/dep/index.js', 'src/a.ts']);
});

test('listMemberFiles: bounded fs walk when the dir is not a git repo; missing dir → empty', async () => {
  const r = await listMemberFiles(plain.members[0].dir);
  assert.equal(r.via, 'walk');
  assert.deepEqual(r.files, ['a.txt', 'sub/b.txt']);
  assert.deepEqual((await listMemberFiles(join(plain.root, 'nope'))).files, []);
});

test('checkouts and files with spaces and non-ASCII names list and read (no shell anywhere) (review focus)', async () => {
  const dir = odd.members[0].dir;
  const r = await listMemberFiles(dir);
  assert.equal(r.via, 'git');
  assert.deepEqual(r.files.map((f) => f.normalize('NFC')), ['a b.txt', 'src/größe.ts'.normalize('NFC')]);
  assert.equal(await readText(dir, r.files[1]), "export const q = 'x';\n");
  assert.equal((await verifyFact(dir, { file: r.files[1], line: 1, match: "q = 'x'" }, { cache: createFileCache() })).ok, true);
});

test('resolveInside refuses every escape (killer: member-root escape)', () => {
  assert.equal(resolveInside(web, 'src/api.ts'), join(web, 'src', 'api.ts'));
  for (const bad of ['.', '../x', 'src/../../x', '..\\x', '/etc/passwd', '\\\\server\\share', 'C:\\Windows\\x', 'c:/x', 'src/Z:/x', 'a/c:x',
    'src\\D:\\x', '', '  ', 'a\0b', null]) {
    assert.equal(resolveInside(web, bad), null, JSON.stringify(bad));
  }
  assert.equal(resolveInside(web, '..env'), join(web, '..env'), 'a name starting with two dots is inside');
  assert.equal(resolveInside(web, '..foo/x'), join(web, '..foo', 'x'));
});

test('readText: text only — missing, oversized, binary and symlinked files are null', async () => {
  assert.match(await readText(web, 'src/api.ts'), /fetch\(url\)/);
  assert.equal(await readText(web, 'nope.ts'), null);
  assert.equal(await readText(web, 'bin.dat'), null);
  assert.equal(await readText(web, 'big.txt', { maxBytes: 10 }), null);
  assert.equal(await readText(web, '../web/src/api.ts'), null);
  if (process.platform !== 'win32') {
    await symlink('/etc/hosts', join(web, 'link.txt'));
    assert.equal(await readText(web, 'link.txt'), null, 'a symlink is never followed out of the member');
    await symlink(join(web, 'src', 'api.ts'), join(web, 'inner-link.ts'));
    assert.equal(await readText(web, 'inner-link.ts'), null, 'nor at all (lstat): even one that points inside the member');
    await symlink('/etc', join(web, 'etc-link'));
    assert.equal(await readText(web, 'etc-link/hosts'), null, 'nor is a symlinked directory');
    assert.equal((await verifyFact(web, { file: 'etc-link/hosts', line: 1, match: 'localhost' }, { cache: createFileCache() })).reason, 'unreadable');
    // The member's real root resolved once (extract, the candidate scan) guards exactly the same way.
    const realRoot = await realpath(web);
    assert.equal(await readText(web, 'etc-link/hosts', { realRoot }), null, 'with a precomputed real root too');
    assert.match(await readText(web, 'src/api.ts', { realRoot }), /fetch\(url\)/);
  }
});

test('gitOutput: stdout on success, null on failure', async () => {
  assert.match(await gitOutput(web, ['rev-parse', 'HEAD']), /^[0-9a-f]{40}\s*$/);
  assert.equal(await gitOutput(plain.members[0].dir, ['rev-parse', 'HEAD']), null);
});

test('gitOutput / listMemberFiles: a bad dir is null / empty (never the process cwd); GIT_DIR never redirects git', async () => {
  assert.equal(await gitOutput(undefined, ['rev-parse', 'HEAD']), null);
  assert.equal(await gitOutput('', ['rev-parse', 'HEAD']), null);
  assert.deepEqual(await listMemberFiles(undefined), { files: [], truncated: false, via: 'walk' });
  const want = (await listMemberFiles(web)).files;
  const head = (await gitOutput(web, ['rev-parse', 'HEAD'])).trim();
  assert.ok(want.includes('src/api.ts'));
  const saved = process.env.GIT_DIR;
  process.env.GIT_DIR = join(odd.members[0].dir, '.git');
  try {
    assert.deepEqual((await listMemberFiles(web)).files, want, 'the member is listed, not the GIT_DIR repository');
    assert.equal((await gitOutput(web, ['rev-parse', 'HEAD'])).trim(), head);
  } finally {
    if (saved === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = saved;
  }
});

test('verifyFact: exact line, window, whole-file re-anchor, case-insensitive (killer: evidence re-anchor)', async () => {
  const cache = createFileCache();
  const f = { file: 'src/api.ts', match: "'/invoices/' + id" };
  assert.deepEqual(await verifyFact(web, { ...f, line: 5 }, { cache }), { ok: true, fact: { ...f, line: 5, lineCorrected: false } });
  assert.equal((await verifyFact(web, { ...f, line: 7 }, { cache })).fact.line, 5, 'inside the ±3 window');
  const far = await verifyFact(web, { ...f, line: 40 }, { cache });
  assert.deepEqual([far.ok, far.fact.line, far.fact.lineCorrected], [true, 5, true], 'whole-file re-anchor');
  const ci = await verifyFact(web, { file: 'src/api.ts', line: 1, match: 'FETCH(URL)' }, { cache });
  assert.deepEqual([ci.ok, ci.fact.line], [true, 6]);
  const ws2 = await verifyFact(web, { file: 'src/api.ts', line: 5, match: "const   url =\t'/invoices/'" }, { cache });
  assert.equal(ws2.ok, true, 'whitespace is collapsed on both sides');
  assert.equal((await verifyFact(web, { ...f, file: './src//api.ts', line: 5 }, { cache })).fact.file, 'src/api.ts', 'the member-relative POSIX path');
});

test('verifyFact: the window hit nearest the cited line wins; a case-exact hit beats a case-folded one (killer: re-anchor order)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wsmap-'));
  try {
    await writeFile(join(dir, 'dup.ts'), 'Emit(x)\nemit(x)\na\nb\nc\nd\nemit(x)\n');
    const cache = createFileCache();
    const near = await verifyFact(dir, { file: 'dup.ts', line: 8, match: 'emit(x)' }, { cache });
    assert.deepEqual([near.fact.line, near.fact.lineCorrected], [7, true], 'the ±3 window (line 7) before the whole file (line 2)');
    const far = await verifyFact(dir, { file: 'dup.ts', line: 40, match: 'emit(x)' }, { cache });
    assert.equal(far.fact.line, 2, 'the case-exact whole-file hit (line 2) before the case-folded one (line 1)');
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('verifyFact: every failure has its reason', async () => {
  const cache = createFileCache();
  const r = (fact) => verifyFact(web, fact, { cache }).then((x) => x.reason);
  assert.equal(await r({ file: '../x', line: 1, match: 'x' }), 'bad path');
  assert.equal(await r({ file: 'gone.ts', line: 1, match: 'x' }), 'missing file');
  assert.equal(await r({ file: 'bin.dat', line: 1, match: 'x' }), 'unreadable');
  assert.equal(await r({ file: 'src/api.ts', line: 0, match: 'x' }), 'bad line');
  assert.equal(await r({ file: 'src/api.ts', line: 1, match: '   ' }), 'empty match');
  assert.equal(await r({ file: 'src/api.ts', line: 1, match: 'nowhere to be found' }), 'match not found');
  await writeFile(join(web, 'k.pem'), '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq\n-----END PRIVATE KEY-----\n');
  assert.equal(await r({ file: 'k.pem', line: 2, match: 'MIIEvQIBADANBgkq' }), 'match not found', 'a PEM body is never evidence');
  assert.equal(await r({ file: 'k.pem', line: 2, match: '***' }), 'empty match', 'redaction marks alone are no evidence');
});

test('one shared cache verifies the same file per member: nested members never borrow each other\'s answer', async () => {
  if (process.platform === 'win32') return; // symlinks need elevation there
  const root = await mkdtemp(join(tmpdir(), 'worca-cc-wsmap-'));
  try {
    const mono = join(root, 'mono');
    const b = join(mono, 'packages', 'b');
    await mkdir(b, { recursive: true });
    await writeFile(join(mono, 'shared.txt'), 'shared line\n');
    await symlink(mono, join(b, 'up'));
    const fact = (file) => ({ file, line: 1, match: 'shared line' });
    for (const first of ['b', 'mono']) {
      const cache = createFileCache();
      const run = { b: () => verifyFact(b, fact('up/shared.txt'), { cache }), mono: () => verifyFact(mono, fact('packages/b/up/shared.txt'), { cache }) };
      const r1 = await run[first]();
      const r2 = await run[first === 'b' ? 'mono' : 'b']();
      const byMember = first === 'b' ? { b: r1, mono: r2 } : { mono: r1, b: r2 };
      assert.deepEqual([byMember.mono.ok, byMember.b.reason], [true, 'unreadable'], `${first} verified first`);
    }
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('createFileCache: reads a file once, evicts least recently used', async () => {
  const cache = createFileCache({ maxEntries: 1 });
  const p = join(web, 'src', 'api.ts');
  const first = cache.lines(p);
  assert.equal(cache.lines(p), first, 'same promise while cached');
  cache.lines(join(web, 'README.md'));
  assert.notEqual(cache.lines(p), first, 'evicted by README.md, so read again');
  assert.deepEqual(await cache.lines(join(web, 'README.md')), ['# Web', '']);
});

test('an agent-written file of 200 000 segments never throws: resolveInside and verifyFact stay total (probe D)', async () => {
  // checkSurvey / checkUsage cap no file length; a RangeError here emptied the whole catalog (its catch-all).
  const file = 'a/'.repeat(200000) + 'x.ts';
  assert.equal(typeof resolveInside(web, file), 'string');
  assert.deepEqual(await verifyFact(web, { file, line: 1, match: 'x' }), { ok: false, reason: 'missing file' });
  assert.equal(resolveInside(web, 'src//./api.ts'), join(web, 'src', 'api.ts'), 'segments still joined');
});

test('over the file cap the shallowest files win: a monorepo keeps its root manifest (listMemberFiles)', async () => {
  const mono = await makeRepos({ m: { 'package.json': '{}\n', 'apps/a/x.ts': 'x\n', 'apps/b/y.ts': 'y\n', 'libs/z.ts': 'z\n' } });
  try {
    assert.deepEqual(await listMemberFiles(mono.members[0].dir, { maxFiles: 2 }), { files: ['libs/z.ts', 'package.json'], truncated: true, via: 'git' });
  } finally {
    await mono.cleanup();
  }
});
