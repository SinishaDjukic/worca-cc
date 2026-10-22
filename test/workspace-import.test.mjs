// test/workspace-import.test.mjs
// Unit tests for src/core/workspace-import.mjs: the JSONC reader, the .code-workspace parser, the
// pasted-list parser, and importCandidates over real throwaway repositories (a repository, a folder
// inside one, a folder of repositories, a worktree, a submodule, no commit, missing and non-git paths).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, statSync, readdirSync, rmSync, existsSync, chmodSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import {
  parseJsonc, codeWorkspaceFolders, parsePathList, importCandidates, IMPORT_SOURCES, IMPORT_MAX_CANDIDATES,
  IMPORT_SCAN_MAX_DIRS, CODE_WORKSPACE_MAX_BYTES,
} from '../src/core/workspace-import.mjs';
import { projectKey } from '../src/core/store.mjs';
import { scanMemberProblems } from '../src/core/workspaces.mjs';

useTempHome(after);
const created = [];
after(() => { for (const d of created) rmSync(d, { recursive: true, force: true }); });
const tmp = (tag) => { const d = mkdtempSync(join(tmpdir(), `worca-cc-wsimp-${tag}-`)); created.push(d); return d; };
// A committed repository (with a file, so .git/index exists) copied into `into`.
const repo = (into) => templateRepo('wsimp', { files: { 'README.md': '# hi\n' }, into });
const mono = (into) => templateRepo('wsimp-mono', { files: { 'packages/api/index.js': 'x\n', 'packages/web/index.js': 'x\n' }, into });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

test('parseJsonc: comments and trailing commas outside strings; strings kept whole; BOM; errors throw', async () => {
  await checkRows([
    { name: 'line and block comments, trailing commas in objects and arrays', run: () => {
      assert.deepEqual(parseJsonc('{\n // c\n "a": 1, /* b */ "b": [1, 2,],\n}'), { a: 1, b: [1, 2] });
    } },
    { name: 'comment- and comma-like text inside strings stays', run: () => {
      assert.deepEqual(parseJsonc('{"u": "file:///x//y", "s": "/* no */", "t": "a,]", "q": "say \\"//hi\\"",}'),
        { u: 'file:///x//y', s: '/* no */', t: 'a,]', q: 'say "//hi"' });
    } },
    { name: 'a leading BOM is dropped', run: () => {
      assert.deepEqual(parseJsonc('\uFEFF{"folders": []}'), { folders: [] });
    } },
    { name: 'an unterminated block comment and bad JSON throw SyntaxError', run: () => {
      assert.throws(() => parseJsonc('{"a": 1 /* open'), SyntaxError);
      assert.throws(() => parseJsonc('{"a": }'), SyntaxError);
    } },
  ]);
});

test('codeWorkspaceFolders: relative paths resolve against the file, absolute stay, names trim, file: URIs read, remote URIs and empty files are problems', () => {
  const file = join('/ws', 'Acme Platform.code-workspace');
  const r = codeWorkspaceFolders(`{
    "folders": [
      { "path": "alpha", "name": " Alpha Service " },
      { "path": "../beta" },
      { "path": "." },
      { "path": "/abs/gamma" },
      { "uri": "file:///abs/delta" },
      { "uri": "file:///abs/epsilon/" },
      { "uri": "vscode-remote://ssh-remote+box/srv/app", "name": "App" },
      { "name": "no path" },
    ],
  }`, file);
  assert.equal(r.workspaceName, 'Acme Platform');
  assert.deepEqual(r.rows, [
    { name: 'Alpha Service', path: join('/ws', 'alpha') },
    { name: undefined, path: join('/', 'beta') },
    { name: undefined, path: '/ws' },
    { name: undefined, path: '/abs/gamma' },
    { name: undefined, path: '/abs/delta' },
    { name: undefined, path: '/abs/epsilon' },   // no trailing slash: addProjects stores the path without one
    { name: 'App', path: 'vscode-remote://ssh-remote+box/srv/app', problem: 'A remote folder (vscode-remote): only folders on this machine can join' },
  ]);
  assert.deepEqual(codeWorkspaceFolders('{"folders": []}', file), { problem: 'Lists no folders' });
  assert.deepEqual(codeWorkspaceFolders('{"folders": [{ "name": "no path" }, 7]}', file), { problem: 'Lists no folders' });
  assert.match(codeWorkspaceFolders('{"folders": [', file).problem, /^Cannot read this \.code-workspace file: /);
});

test('parsePathList: one path per line; blanks and # lines skipped; quotes, file:// and Terminal escapes undone; duplicates collapse; stops past max', () => {
  assert.deepEqual(parsePathList(`# my repos\n\n  /a/one  \n"/a/two words"\n'/a/three'\nfile:///a/four%20x\n/a/My\\ Repo\n/a/one\n~/dev/x\r\n`),
    ['/a/one', '/a/two words', '/a/three', '/a/four x', '/a/My Repo', '~/dev/x']);
  assert.deepEqual(parsePathList('/a/app\\ \\(old\\)\n~/x\\ y'), ['/a/app (old)', '~/x y']);
  assert.deepEqual(parsePathList('/a\n/b\n/a\n/c\n/d', 2), ['/a', '/b', '/c'], 'it stops once it holds more than max');
});

test('IMPORT_SOURCES: a .code-workspace file, then a repository, then a folder of repositories (a repository is never scanned as a parent)', () => {
  assert.deepEqual(IMPORT_SOURCES.map((s) => s.id), ['code-workspace', 'repo', 'parent-folder']);
});

test('importCandidates: a folder inside a repository becomes its top folder, merged with the repository itself', async () => {
  const m = mono(join(tmp('mono'), 'mono'));
  const r = await importCandidates([join(m, 'packages', 'api'), m, join(m, 'packages', 'web')]);
  assert.equal(r.workspaceName, null);
  assert.equal(r.truncated, false);
  assert.equal(r.candidates.length, 1, 'one repository, one row');
  const [row] = r.candidates;
  assert.equal(row.status, 'new');
  assert.equal(realpathSync(row.path), realpathSync(m));
  assert.equal(row.name, 'mono', 'a lifted row is named after the repository, not the subfolder');
  assert.equal(row.key, projectKey(m));
  assert.deepEqual(row.liftedFrom, [join(m, 'packages', 'api'), join(m, 'packages', 'web')]);
});

test('importCandidates: a folder of repositories lists the repositories in it (two levels on request), never hidden folders, node_modules or repositories inside a repository', async () => {
  const parent = tmp('parent');
  const a = repo(join(parent, 'alpha'));
  repo(join(parent, 'beta'));
  mkdirSync(join(parent, 'notes'));
  repo(join(parent, '.hidden'));
  repo(join(parent, 'node_modules', 'dep'));
  repo(join(parent, 'group', 'gamma'));
  repo(join(a, 'nested'));
  const names = (r) => r.candidates.map((c) => basename(c.path));
  await checkRows([
    { name: 'depth 1: the direct subfolders that are repositories', run: async () => {
      const r = await importCandidates([parent]);
      assert.deepEqual(names(r), ['alpha', 'beta']);
      assert.ok(r.candidates.every((c) => c.status === 'new'));
    } },
    { name: 'depth 2: one level further down too', run: async () => {
      assert.deepEqual(names(await importCandidates([parent], { depth: 2 })), ['alpha', 'beta', 'gamma']);
    } },
    { name: 'a folder with no repositories in it is one problem row', run: async () => {
      const r = await importCandidates([join(parent, 'notes')]);
      assert.deepEqual(r.candidates.map((c) => [c.status, c.problem]), [['problem', 'Not a git repository, and none directly inside']]);
    } },
    { name: 'a folder inside a repository that holds repositories (an umbrella repository) lists them; the umbrella itself stays one row', run: async () => {
      const umb = repo(join(tmp('umbrella'), 'umbrella'));
      repo(join(umb, 'services', 'api'));
      repo(join(umb, 'services', 'web'));
      const r = await importCandidates([join(umb, 'services')]);
      assert.deepEqual(r.candidates.map((c) => [basename(c.path), c.status]), [['api', 'new'], ['web', 'new']]);
      assert.deepEqual((await importCandidates([umb])).candidates.map((c) => [basename(c.path), c.status]), [['umbrella', 'new']]);
    } },
    { name: 'two levels deep also applies to a folder inside a repository: its repositories one level further down are listed', run: async () => {
      const umb = repo(join(tmp('umbrella2'), 'umbrella'));
      repo(join(umb, 'services', 'team', 'api'));
      const deep = await importCandidates([join(umb, 'services')], { depth: 2 });
      assert.deepEqual(deep.candidates.map((c) => [basename(c.path), c.status]), [['api', 'new']]);
      const shallow = await importCandidates([join(umb, 'services')]);
      assert.deepEqual(shallow.candidates.map((c) => [basename(c.path), c.status]), [['umbrella', 'new']], 'one level: services holds no repository directly, so it stands for the umbrella');
    } },
  ]);
});

test('importCandidates: each path that cannot join says why', async () => {
  const root = tmp('problems');
  const plain = join(root, 'plain');
  mkdirSync(plain);
  const fresh = templateRepo('wsimp-fresh', { commit: false, into: join(root, 'fresh') });
  const file = join(root, 'notes.txt');
  writeFileSync(file, 'x');
  const sup = repo(join(root, 'sup'));
  const child = repo(join(root, 'child-src'));
  const add = git(sup, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', child, 'child');
  assert.equal(add.status, 0, add.stderr);
  const r = await importCandidates([join(root, 'missing'), file, plain, fresh, 'relative/path', '~nobody-wsimp/x', join(sup, 'child')]);
  assert.deepEqual(r.candidates.map((c) => [c.status, c.problem]), [
    ['problem', 'Does not exist'],
    ['problem', 'Not a folder or a .code-workspace file'],
    ['problem', 'Not a git repository, and none directly inside'],
    ['problem', 'Has no commit yet'],
    ['problem', 'Not a full path: start it with / or ~/'],
    ['problem', 'Not a full path: start it with / or ~/'],
    ['problem', `A git submodule of ${realpathSync(sup)}: submodules cannot join a workspace yet`],
  ]);
});

test("importCandidates: a folder of the repository's own submodules stands for the repository", async () => {
  const root = tmp('subfolder');
  const sup = repo(join(root, 'sup'));
  const child = repo(join(root, 'child-src'));
  const add = git(sup, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', child, 'vendor/child');
  assert.equal(add.status, 0, add.stderr);
  const r = await importCandidates([join(sup, 'vendor')]);
  assert.deepEqual(r.candidates.map((c) => [basename(c.path), c.status]), [['sup', 'new']]);
});

// A case-insensitive disk (macOS and Windows by default) opens /VAR/… as /var/….
const CASE_INSENSITIVE = existsSync(tmpdir().toUpperCase());
test('importCandidates: a registered project is found whichever side carries another letter case, also through a symlink', { skip: !CASE_INSENSITIVE && 'case-sensitive disk' }, async () => {
  const raw = tmp('case');   // macOS: /var/…, a symlink to /private/var/…
  const root = realpathSync(raw);
  const a = repo(join(root, 'CaseRepo'));
  const row = (c) => [c.status, c.path, c.name, c.key];
  await checkRows([
    { name: "stored in the disk's case: a path typed in another case finds it", run: async () => {
      const project = { key: projectKey(a), name: 'Case Repo', path: a };
      const r = await importCandidates([join(root, 'caserepo'), join(raw, 'CASErepo')], { projects: [project] });
      assert.deepEqual(r.candidates.map(row), [['registered', a, 'Case Repo', project.key]]);
    } },
    { name: 'stored in another case than the disk: the disk spelling and the stored spelling find it, as one row with its own path and key', run: async () => {
      const stored = join(root, 'CASEREPO');
      const project = { key: projectKey(stored), name: 'Case Repo', path: stored };
      const r = await importCandidates([a, stored, join(raw, 'caseREPO')], { projects: [project] });
      assert.deepEqual(r.candidates.map(row), [['registered', stored, 'Case Repo', project.key]]);
    } },
  ]);
});

test('importCandidates: a folder or file that cannot be read says so, also when a .code-workspace file lists it', { skip: (process.platform === 'win32' || process.getuid?.() === 0) && 'needs POSIX permissions as a non-root user' }, async () => {
  const root = tmp('locked');
  const locked = join(root, 'locked');
  mkdirSync(locked);
  const shut = repo(join(root, 'shut'));                 // a repository its own mode closes
  const inner = repo(join(root, 'closed', 'inner'));     // a repository in a folder that cannot be searched
  const listing = join(root, 'listing.code-workspace');
  writeFileSync(listing, JSON.stringify({ folders: [{ path: shut }, { path: inner }] }));
  const sealed = join(root, 'sealed.code-workspace');
  writeFileSync(sealed, '{"folders": []}');
  const modes = [[locked, 0o000], [shut, 0o000], [join(root, 'closed'), 0o600], [sealed, 0o000]];
  for (const [p, mode] of modes) chmodSync(p, mode);
  try {
    const r = await importCandidates([locked, listing, sealed]);
    assert.deepEqual(r.candidates.map((c) => [c.path, c.status, c.problem]), [
      [locked, 'problem', 'Cannot be read: permission denied'],
      [shut, 'problem', 'Cannot be read: permission denied'],
      [inner, 'problem', 'Cannot be read: permission denied'],
      [sealed, 'problem', 'Cannot be read: permission denied'],
    ]);
  } finally {
    for (const [p] of modes) chmodSync(p, 0o755);   // or the after() cleanup cannot remove them
  }
});

test('importCandidates: a registered repository is reused, also through its worktree; a registered folder that cannot be a member is a problem', async () => {
  const root = tmp('registered');
  const a = repo(join(root, 'alpha'));
  const wt = join(root, 'alpha-wt');
  const add = git(a, 'worktree', 'add', '-q', '-b', 'wsimp-wt', wt);
  assert.equal(add.status, 0, add.stderr);
  const m = mono(join(root, 'mono'));
  const projects = [
    { key: projectKey(a), name: 'Alpha', path: a },
    { key: projectKey(join(m, 'packages', 'api')), name: 'Mono API', path: join(m, 'packages', 'api') },
  ];
  const r = await importCandidates([wt, m], { projects });
  assert.deepEqual(r.candidates.map((c) => [c.status, c.path, c.name]), [
    ['registered', a, 'Alpha'],
    ['problem', m, 'mono'],
  ]);
  assert.match(r.candidates[1].problem, /^Already the project "Mono API" \(.+\), which is not the top folder of its own git repository$/);
});

test('importCandidates: a .code-workspace file lists its folders and names the workspace', async () => {
  const root = tmp('codews');
  repo(join(root, 'alpha'));
  const b = repo(join(root, 'nested', 'beta'));
  const file = join(root, 'Acme Platform.code-workspace');
  writeFileSync(file, `{
    // folders VS Code shows
    "folders": [
      { "path": "alpha", "name": "Alpha Service" },
      { "path": ${JSON.stringify(b)} },        /* absolute */
      { "path": "./alpha" },                   // the same folder again: merged
      { "path": "ghost" },
      { "uri": "vscode-remote://ssh-remote+box/srv/app" },
    ],
  }`);
  const r = await importCandidates([file]);
  assert.equal(r.workspaceName, 'Acme Platform');
  assert.deepEqual(r.candidates.map((c) => [c.status, c.name, c.problem]), [
    ['new', 'Alpha Service', null],
    ['new', 'beta', null],
    ['problem', 'ghost', 'Does not exist'],
    ['problem', 'app', 'A remote folder (vscode-remote): only folders on this machine can join'],
  ]);
});

test('importCandidates: past IMPORT_MAX_CANDIDATES rows the answer is cut and says so', async () => {
  const file = join(tmp('many'), 'many.code-workspace');
  writeFileSync(file, JSON.stringify({ folders: Array.from({ length: IMPORT_MAX_CANDIDATES + 1 }, (_, i) => ({ path: `missing-${i}` })) }));
  const r = await importCandidates([file]);
  assert.equal(r.truncated, true);
  assert.equal(r.candidates.length, IMPORT_MAX_CANDIDATES);
});

test('importCandidates: the parent-folder search of one request stops past IMPORT_SCAN_MAX_DIRS folders, in all, and says so only where it stopped', async () => {
  const root = tmp('budget');
  const big = join(root, 'big');
  for (let i = 0; i <= IMPORT_SCAN_MAX_DIRS; i += 1) mkdirSync(join(big, `d${i}`), { recursive: true });
  const later = join(root, 'later');
  repo(join(later, 'alpha'));
  const flat = join(root, 'flat');
  mkdirSync(flat);
  writeFileSync(join(flat, 'notes.txt'), 'x');
  const r = await importCandidates([big, later, flat]);
  assert.equal(r.truncated, true);
  assert.deepEqual(r.candidates.map((c) => [c.path, c.status, c.problem]), [
    [big, 'problem', 'The search stopped early: too many folders'],
    [later, 'problem', 'The search stopped early: too many folders'],   // the budget is the request's: spent, it searches nothing
    [flat, 'problem', 'Not a git repository, and none directly inside'],   // no folder in it, so nothing was cut
  ]);
});

test('importCandidates: a .code-workspace file past CODE_WORKSPACE_MAX_BYTES is never read', async () => {
  const file = join(tmp('huge'), 'huge.code-workspace');
  writeFileSync(file, '');
  truncateSync(file, CODE_WORKSPACE_MAX_BYTES + 1);   // sparse: no megabyte written
  const r = await importCandidates([file]);
  assert.deepEqual(r.candidates.map((c) => [c.path, c.status, c.problem]), [[file, 'problem', 'Too large for a .code-workspace file']]);
});

test('importCandidates writes nothing into the folders it reads, and every row it offers passes the scan launch check', async () => {
  const parent = tmp('readonly');
  const a = repo(join(parent, 'alpha'));
  const m = mono(join(parent, 'mono'));
  const snapshot = (dir) => JSON.stringify([readdirSync(dir).sort(), readdirSync(join(dir, '.git')).sort(), statSync(join(dir, '.git', 'index')).mtimeMs]);
  const before = [snapshot(a), snapshot(m)];
  const r = await importCandidates([parent, join(m, 'packages', 'web')], { depth: 2 });
  assert.deepEqual([snapshot(a), snapshot(m)], before);
  const offered = r.candidates.filter((c) => c.status !== 'problem').map((c) => c.path);
  assert.equal(offered.length, 2);
  assert.deepEqual(scanMemberProblems(offered), [], 'what the import offers, the scan accepts');
});
