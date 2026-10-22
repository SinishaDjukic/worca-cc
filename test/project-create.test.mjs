// test/project-create.test.mjs — src/core/project-create.mjs: the New name rule, create (with and without Use git),
// add a folder with Use git, the folder probe. Nothing is created on any refusal. Real git (WORCA_GIT=1).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join, basename, dirname } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir as makeGitDir } from './helpers/git-dir.mjs';
import { checkRows } from './helpers/rows.mjs';
import { _testing as gitTesting } from '../src/core/git-available.mjs';
import { listProjects, addProject, displayPath } from '../src/core/projects.mjs';
import { onboardingStatus } from '../src/core/onboarding.mjs';
import { noProjectWorkDir } from '../src/core/store.mjs';
import { checkFolderName, folderNameFor, createProject, addProjectFolder, probeFolder, countFiles, ProjectAddError, runGitInit } from '../src/core/project-create.mjs';

useTempHome(after, 'worca-cc-pcreate-');
const made = [];                                                  // every temp folder this file makes; removed in after()
const keep = (d) => { made.push(d); return d; };
const ROOT = keep(mkdtempSync(join(tmpdir(), 'worca-pcreate-root-')));
const tmp = (p) => keep(mkdtempSync(join(tmpdir(), `worca-pcreate-${p}-`)));
const gitDir = (tag) => keep(makeGitDir(tag));
const outcome = async (p) => { try { await p; return 'ok'; } catch (e) { return e instanceof ProjectAddError ? `${e.code}: ${e.message}` : `other: ${e.message}`; } };
const SEP = 'the name must be one folder name, without / or \\';
const HOLDS = 'INVALID: this folder holds worca\'s data or projects folder; Use git here would put every project inside one repository';
const CHARS = 'the name cannot contain < > : " | ? * or control characters';
const CJK = String.fromCodePoint(0x754c);                         // 3 UTF-8 bytes
const EMOJI = String.fromCodePoint(0x1f600);                      // 2 UTF-16 units, 4 UTF-8 bytes
before(() => { process.env.WORCA_GIT = '1'; gitTesting.reset(); });
after(() => { gitTesting.reset(); for (const d of made) rmSync(d, { recursive: true, force: true, maxRetries: 3 }); });

test('checkFolderName: one portable folder name, trimmed; refusals name the rule', () => {
  for (const [raw, msg] of [
    ['', 'a project name is required'], ['   ', 'a project name is required'],
    ['x'.repeat(101), 'the name may be up to 100 characters'],
    ['../x', SEP], ['a/b', SEP], ['a\\b', SEP],
    ['..', 'the name cannot start with a dot'], ['.hidden', 'the name cannot start with a dot'],
    ['a:b', CHARS], ['what?', CHARS], ['tab\there', CHARS],
    ['site.', 'the name cannot end with a dot'],
    ['CON', '"CON" is a reserved name on Windows'], ['nul.txt', '"nul.txt" is a reserved name on Windows'],
    ['Com1', '"Com1" is a reserved name on Windows'], ['lpt9', '"lpt9" is a reserved name on Windows'],
    ['COM¹', '"COM¹" is a reserved name on Windows'],
    ['CON .txt', '"CON .txt" is a reserved name on Windows'], ['conin$', '"conin$" is a reserved name on Windows'],
    [CJK.repeat(86), 'the name is too long for a folder'],
    ['a' + String.fromCharCode(0x202e) + 'b', CHARS], ['a' + String.fromCharCode(0x85) + 'b', CHARS], ['a' + String.fromCharCode(0xd800) + 'b', CHARS],
  ]) assert.throws(() => checkFolderName(raw), (e) => e instanceof ProjectAddError && e.code === 'INVALID' && e.message === msg, JSON.stringify(raw));
  assert.equal(checkFolderName('  landing-page  '), 'landing-page');
  assert.equal(checkFolderName('Tax papers 2026'), 'Tax papers 2026');
  assert.equal(checkFolderName('console'), 'console', 'only the exact device names are reserved');
  assert.equal(checkFolderName('Проект'), 'Проект');
  assert.equal(checkFolderName(EMOJI.repeat(51)), EMOJI.repeat(51), '100 code points, not UTF-16 units');
  assert.equal(checkFolderName(CJK.repeat(85)), CJK.repeat(85), '255 UTF-8 bytes: the folder-name limit of ext4 / APFS');
});

test('folderNameFor: lowercase, each run of spaces one _; the New name rule still applies', () => {
  assert.equal(folderNameFor('Worca Presentation'), 'worca_presentation');
  assert.equal(folderNameFor('  Tax   papers 2026 '), 'tax_papers_2026', 'trimmed; a run of spaces is one _');
  assert.equal(folderNameFor('Q3' + String.fromCharCode(0xa0) + 'Plan' + String.fromCharCode(0x3000) + 'B'), 'q3_plan_b', 'any Unicode space');
  assert.equal(folderNameFor('landing-page'), 'landing-page');
  assert.equal(folderNameFor('Проект Едно'), 'проект_едно');
  assert.throws(() => folderNameFor('a/b'), (e) => e instanceof ProjectAddError && e.code === 'INVALID' && e.message === SEP);
  const grows = CJK.repeat(80) + 'İ'.repeat(7);                    // 254 UTF-8 bytes; lowercase 261 (İ is 2 bytes, i̇ is 3)
  assert.equal(checkFolderName(grows), grows);
  assert.throws(() => folderNameFor(grows), (e) => e instanceof ProjectAddError && e.message === 'the name is too long for a folder',
    'lowercase can grow the bytes: the folder name is checked too');
});

test('createProject: a folder under the projects root, Folder kind; useGit runs git init once; refusals create nothing', async () => {
  await checkRows([
    { name: 'no git: a plain folder, vcs none, the projects root made on first use', run: async () => {
      const root = join(ROOT, 'fresh-root');
      const out = await createProject({ name: 'site' }, { projectsRoot: root });
      assert.equal(out.project.path, join(root, 'site'));
      assert.equal(out.project.vcs, 'none');
      assert.equal(existsSync(join(root, 'site', '.git')), false);
      assert.ok((await listProjects()).some((p) => p.name === 'site' && p.vcs === 'none'));
    } },
    { name: 'the folder is the lowercase name with _ for spaces; the project keeps the name as typed', run: async () => {
      const out = await createProject({ name: 'Worca Presentation' }, { projectsRoot: ROOT });
      assert.equal(out.project.path, join(ROOT, 'worca_presentation'));
      assert.equal(out.project.name, 'Worca Presentation');
      assert.equal(existsSync(join(ROOT, 'worca_presentation')), true);
      assert.deepEqual(await createProject({ name: 'Board Deck', dryRun: true }, { projectsRoot: ROOT }),
        { dryRun: true, root: ROOT, path: join(ROOT, 'board_deck'), name: 'Board Deck', displayPath: displayPath(join(ROOT, 'board_deck')) },
        'the dry run (the dialog\'s Location, the Ask card) shows the same folder');
      assert.equal(await outcome(createProject({ name: 'worca  presentation' }, { projectsRoot: ROOT })),
        `EXISTS: ${join(ROOT, 'worca_presentation')} is already registered as "Worca Presentation"; pick another name`,
        'another name with the same folder is refused, naming the folder and the project holding it');
      mkdirSync(join(ROOT, 'old_notes'));
      assert.equal(await outcome(createProject({ name: 'Old Notes' }, { projectsRoot: ROOT })),
        `EXISTS: ${join(ROOT, 'old_notes')} already exists; pick another name`, 'a folder on disk with that folder name');
    } },
    { name: 'useGit: git init once, vcs git', run: async () => {
      const out = await createProject({ name: 'gitsite', useGit: true }, { projectsRoot: ROOT });
      assert.equal(out.project.vcs, 'git');
      assert.equal(existsSync(join(ROOT, 'gitsite', '.git', 'HEAD')), true);
    } },
    { name: 'dry run: the location, nothing created or registered', run: async () => {
      assert.deepEqual(await createProject({ name: ' later ', dryRun: true }, { projectsRoot: ROOT }),
        { dryRun: true, root: ROOT, path: join(ROOT, 'later'), name: 'later', displayPath: displayPath(join(ROOT, 'later')) });
      assert.equal(existsSync(join(ROOT, 'later')), false);
      assert.equal((await listProjects()).some((p) => p.name === 'later'), false);
    } },
    { name: 'refusals create nothing: bad name, registered name, a folder in any case, git missing, inside a repository', run: async () => {
      const at = (input, deps = {}) => outcome(createProject(input, { projectsRoot: ROOT, ...deps }));
      assert.equal(await at({ name: '../x' }), `INVALID: ${SEP}`);
      assert.equal(await at({ name: 'SITE' }), 'EXISTS: a project named "site" already exists', 'the registered spelling names it');
      mkdirSync(join(ROOT, 'Taken'));
      assert.equal(await at({ name: 'taken' }), `EXISTS: ${join(ROOT, 'Taken')} already exists; pick another name`);
      assert.equal(await at({ name: 'nogit', useGit: true }, { gitAvailable: () => false }), 'GIT_MISSING: git is not installed on this machine');
      const enc = (partOf) => () => ({ repoRoot: '/r', partOf });
      assert.equal(await at({ name: 'nested' }, { enclosingRepo: enc('mono') }), 'NESTED_IN_REPO: Part of mono');
      assert.equal(await at({ name: 'nested' }, { enclosingRepo: enc(null) }), 'NESTED_IN_REPO: Inside a git repository');
      assert.equal(await at({ name: 'nested-git', useGit: true }, { enclosingRepo: enc(null), gitInit: async () => ({ ok: true, stderr: '' }) }), 'ok', 'Use git makes it its own repository');
      for (const n of ['x', 'nogit', 'nested']) assert.equal(existsSync(join(ROOT, n)), false, n);
      const repoRoot = gitDir('pcreate-reporoot');               // a projects root that is itself a repository top
      assert.equal(await outcome(createProject({ name: 'inner' }, { projectsRoot: repoRoot })), 'NESTED_IN_REPO: Inside a git repository');
      assert.equal(existsSync(join(repoRoot, 'inner')), false);
      assert.equal(await outcome(createProject({ name: 'inner', dryRun: true }, { projectsRoot: repoRoot })), 'NESTED_IN_REPO: Inside a git repository',
        'judged before any mkdir: a dry run refuses too');
      const nfd = 'Cafe' + String.fromCharCode(0x301);           // macOS stores NFD; the compare is NFC + lowercase
      mkdirSync(join(ROOT, nfd));
      assert.equal(await at({ name: 'caf' + String.fromCharCode(0xe9) }), `EXISTS: ${join(ROOT, nfd)} already exists; pick another name`);
    } },
    { name: 'a failed git init removes the new folder; a failed registration removes it too', run: async () => {
      assert.equal(await outcome(createProject({ name: 'initfail', useGit: true }, { projectsRoot: ROOT, gitInit: async () => ({ ok: false, stderr: 'fatal: boom\n' }) })),
        'FAILED: git init failed: fatal: boom');
      assert.equal(existsSync(join(ROOT, 'initfail')), false);
      assert.equal(await outcome(createProject({ name: 'regfail' }, { projectsRoot: ROOT, addProject: async () => { throw new Error('this project path is already registered'); } })),
        'EXISTS: this project path is already registered');
      assert.equal(existsSync(join(ROOT, 'regfail')), false);
    } },
    { name: 'a registered path whose folder is gone: refused before any mkdir, the dry run (the Ask card) too', run: async () => {
      await addProject({ name: 'ghost-row', path: join(ROOT, 'ghost') });
      const GHOST = `EXISTS: ${join(ROOT, 'ghost')} is already registered as "ghost-row"; pick another name`;
      assert.equal(await outcome(createProject({ name: 'ghost', dryRun: true }, { projectsRoot: ROOT })), GHOST);
      assert.equal(await outcome(createProject({ name: 'ghost' }, { projectsRoot: ROOT })), GHOST);
      assert.equal(existsSync(join(ROOT, 'ghost')), false);
    } },
  ]);
});

test('addProjectFolder: Use git on a no-git folder runs git init once and stores Git; refusals touch nothing', async () => {
  await checkRows([
    { name: 'useGit on a plain folder: .git made, files untouched, vcs git', run: async () => {
      const dir = tmp('plain'); writeFileSync(join(dir, 'a.txt'), 'x');
      const out = await addProjectFolder({ name: 'plain', path: dir, useGit: true });
      assert.equal(out.project.vcs, 'git');
      assert.equal(existsSync(join(dir, '.git', 'HEAD')), true);
      assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'x');
    } },
    { name: 'a folder that already has git: added as Git, no git init', run: async () => {
      let inits = 0;
      const out = await addProjectFolder({ name: 'has', path: gitDir('pcreate-has'), useGit: true }, { gitInit: async () => { inits += 1; return { ok: true, stderr: '' }; } });
      assert.equal(inits, 0); assert.equal(out.project.vcs, 'git');
    } },
    { name: 'useGit off: a Folder project; the name defaults to the folder name', run: async () => {
      const dir = tmp('off');
      const out = await addProjectFolder({ path: dir });
      assert.equal(out.project.name, basename(dir)); assert.equal(out.project.vcs, 'none');
      assert.equal(existsSync(join(dir, '.git')), false);
    } },
    { name: 'dry run: name, path and the kind it would get; no .git', run: async () => {
      const dir = tmp('dry');
      assert.deepEqual(await addProjectFolder({ name: 'dry', path: dir, useGit: true, dryRun: true }), { dryRun: true, name: 'dry', path: dir, vcs: 'git', displayPath: displayPath(dir) });
      assert.equal(existsSync(join(dir, '.git')), false);
    } },
    { name: 'refusals: missing, a file, a registered name or path, git missing, inside a repository (registered or not)', run: async () => {
      const dir = tmp('ref'); writeFileSync(join(dir, 'f.txt'), '');
      assert.equal(await outcome(addProjectFolder({ name: 'm', path: join(dir, 'nope'), useGit: true })), 'INVALID: folder does not exist');
      assert.equal(await outcome(addProjectFolder({ name: 'f', path: join(dir, 'f.txt'), useGit: true })), 'INVALID: path is not a directory');
      assert.equal(await outcome(addProjectFolder({ name: 'PLAIN', path: dir, useGit: true })), 'EXISTS: a project named "PLAIN" already exists');
      const taken = tmp('taken'); await addProject({ name: 'taken-a', path: taken });
      let inits = 0;
      const counting = { gitInit: async () => { inits += 1; return { ok: true, stderr: '' }; } };
      assert.equal(await outcome(addProjectFolder({ name: 'taken-b', path: taken, useGit: true }, counting)), 'EXISTS: this project path is already registered');
      assert.equal(inits, 0, 'refused before any git init');
      assert.equal(await outcome(addProjectFolder({ name: 'g', path: dir, useGit: true }, { gitAvailable: () => false })), 'GIT_MISSING: git is not installed on this machine');
      const mono = gitDir('pcreate-mono-a'); const docs = join(mono, 'docs'); mkdirSync(docs);
      assert.equal(await outcome(addProjectFolder({ name: 'docs', path: docs, useGit: true })), 'NESTED_IN_REPO: Inside a git repository');
      await addProject({ name: 'mono-a', path: mono });
      assert.equal(await outcome(addProjectFolder({ name: 'docs', path: docs })), 'NESTED_IN_REPO: Part of mono-a');
      assert.equal(existsSync(join(dir, '.git')), false); assert.equal(existsSync(join(docs, '.git')), false);
    } },
    { name: 'a run\'s work folder is refused before any git init; the dry run (the Ask card) refuses too', run: async () => {
      const work = noProjectWorkDir('abcd1234'); mkdirSync(work, { recursive: true });
      let inits = 0;
      const counting = { gitInit: async () => { inits += 1; return { ok: true, stderr: '' }; } };
      const NOPROJ = 'INVALID: this folder belongs to a run without a project';
      assert.equal(await outcome(addProjectFolder({ name: 'w', path: work, useGit: true, dryRun: true }, counting)), NOPROJ);
      assert.equal(await outcome(addProjectFolder({ name: 'w', path: work, useGit: true }, counting)), NOPROJ);
      assert.equal(inits, 0, 'refused before any git init');
      assert.equal(existsSync(join(work, '.git')), false);
    } },
    { name: 'Use git never runs on a folder holding worca\'s own folders (the Worca home or the projects root)', run: async () => {
      const base = process.env.WORCA_HOME;                         // useTempHome: the Worca home is <base>/.worca-cc
      assert.equal(await outcome(addProjectFolder({ name: 'wh', path: base, useGit: true })), HOLDS);
      assert.equal(await outcome(addProjectFolder({ name: 'wh', path: base, useGit: true, dryRun: true })), HOLDS, 'the dry run (the Ask card) refuses too');
      const outer = tmp('outer');                                   // a projects root that does not exist yet, below it
      assert.equal(await outcome(addProjectFolder({ name: 'outer', path: outer, useGit: true }, { projectsRoot: join(outer, 'projects') })), HOLDS);
      const upper = join(dirname(base), basename(base).toUpperCase());
      if (existsSync(upper)) {                                      // a case-insensitive volume (macOS, Windows): the same folder
        assert.equal(await outcome(addProjectFolder({ name: 'wh', path: upper, useGit: true })), HOLDS, 'the letter case as typed does not matter');
      }
      const realDir = tmp('linked'); const link = join(tmp('link'), 'to'); symlinkSync(realDir, link, 'junction');
      assert.equal(await outcome(addProjectFolder({ name: 'linked', path: realDir, useGit: true }, { projectsRoot: join(link, 'projects') })), HOLDS,
        'a projects root that does not exist yet, configured through a link');
      const firm = join('/System/Volumes/Data', realpathSync(base));  // macOS firmlink: the same folder, a path realpath keeps
      if (process.platform === 'darwin' && existsSync(firm)) {
        assert.equal(await outcome(addProjectFolder({ name: 'wh', path: firm, useGit: true })), HOLDS, 'a path realpath does not map back');
      }
      assert.equal(existsSync(join(base, '.git')), false); assert.equal(existsSync(join(outer, '.git')), false); assert.equal(existsSync(join(realDir, '.git')), false);
      assert.equal((await addProjectFolder({ name: 'outer', path: outer }, { projectsRoot: join(outer, 'projects') })).project.vcs, 'none', 'without Use git it is a plain add');
    } },
    { name: 'two Use git adds of one folder at once: one git init, the second refused as registered, the .git stays', run: async () => {
      const dir = tmp('twice');
      let inits = 0;
      const gitInit = async (d) => { inits += 1; await new Promise((r) => setTimeout(r, 30)); return runGitInit(d); };
      const outs = await Promise.all(['twice-a', 'twice-b'].map((name) => outcome(addProjectFolder({ name, path: dir, useGit: true }, { gitInit }))));
      assert.deepEqual(outs.sort(), ['EXISTS: this project path is already registered', 'ok']);
      assert.equal(inits, 1, 'the second add waits for the first and never runs git init');
      assert.equal(existsSync(join(dir, '.git', 'HEAD')), true, 'the registered Git project keeps its .git');
      assert.equal((await listProjects()).find((p) => p.path === dir)?.vcs, 'git');
      const plain = tmp('plainfirst');                               // a plain add (no lock) registers it as a Folder mid-way
      const first = { gitInit: async (d) => { await addProject({ name: 'plain-first', path: d }); return runGitInit(d); } };
      assert.equal(await outcome(addProjectFolder({ name: 'git-second', path: plain, useGit: true }, first)), 'EXISTS: this project path is already registered');
      assert.equal(existsSync(join(plain, '.git')), false, 'the .git this call made is removed: the project there is a Folder');
      assert.equal((await listProjects()).find((p) => p.path === plain)?.vcs, 'none');
    } },
    { name: 'a failed registration removes the .git it made', run: async () => {
      const dir = tmp('regfail');
      assert.equal(await outcome(addProjectFolder({ name: 'rf', path: dir, useGit: true }, { addProject: async () => { throw new Error('boom'); } })), 'INVALID: boom');
      assert.equal(existsSync(join(dir, '.git')), false);
    } },
    { name: 'a failed registration of a folder that already has git never removes its .git (Use git on or off)', run: async () => {
      for (const useGit of [true, false]) {
        const dir = gitDir(`pcreate-keepgit-${useGit}`);
        assert.equal(await outcome(addProjectFolder({ name: `kg-${useGit}`, path: dir, useGit }, { addProject: async () => { throw new Error('boom'); } })), 'INVALID: boom');
        assert.equal(existsSync(join(dir, '.git', 'HEAD')), true, `useGit ${useGit}: the user's .git stays`);
      }
    } },
    { name: 'a failed git init removes the half-made .git and nothing else', run: async () => {
      const dir = tmp('initfail'); writeFileSync(join(dir, 'a.txt'), 'x');
      const gitInit = async (d) => { mkdirSync(join(d, '.git')); writeFileSync(join(d, '.git', 'HEAD'), 'ref: refs/heads/x\n'); return { ok: false, stderr: 'fatal: boom\n' }; };
      assert.equal(await outcome(addProjectFolder({ name: 'if', path: dir, useGit: true }, { gitInit })), 'FAILED: git init failed: fatal: boom');
      assert.equal(existsSync(join(dir, '.git')), false);
      assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'x', 'the user\'s files stay');
      assert.equal((await listProjects()).some((p) => p.path === dir), false);
    } },
  ]);
});

test('probeFolder / countFiles: kind, file count, the R8 chips; .git never counted', async () => {
  const plain = tmp('probe'); writeFileSync(join(plain, 'a.txt'), 'x'); mkdirSync(join(plain, 'sub'));
  writeFileSync(join(plain, 'sub', 'b.txt'), 'y'); writeFileSync(join(plain, 'sub', 'c.txt'), 'z');
  const none = { exists: true, isDir: true, vcs: 'none', files: 3, filesCapped: false, insideRepo: false, partOf: null };
  assert.deepEqual(await probeFolder(plain), { path: plain, ...none });
  const repo = gitDir('pcreate-probe');
  assert.deepEqual(await probeFolder(repo), { path: repo, exists: true, isDir: true, vcs: 'git', files: null, filesCapped: false, insideRepo: false, partOf: null });
  const mono = gitDir('pcreate-mono-p'); mkdirSync(join(mono, 'docs')); await addProject({ name: 'mono-p', path: mono });
  assert.deepEqual(await probeFolder(join(mono, 'docs')), { path: join(mono, 'docs'), exists: true, isDir: true, vcs: 'none', files: null, filesCapped: false, insideRepo: true, partOf: 'mono-p', repoRoot: realpathSync(mono) });
  assert.deepEqual(await probeFolder(join(mono, 'docs'), { gitAvailable: () => false }),
    { path: join(mono, 'docs'), exists: true, isDir: true, vcs: 'none', files: null, filesCapped: false, insideRepo: true, partOf: 'mono-p', repoRoot: realpathSync(mono) }, 'no git: the stat-only walk still finds the repository (S53)');
  // #693: a repository an older worca git-inited inside it: Git, not refused, with the fix text and the root.
  const made = join(mono, 'made'); mkdirSync(made);
  for (const a of [['init', '-q'], ['config', 'user.email', 'orchestrator@local']]) spawnSync('git', a, { cwd: made });
  const pm = await probeFolder(made);
  assert.deepEqual([pm.vcs, pm.insideRepo, pm.partOf, pm.repoRoot], ['git', false, 'mono-p', realpathSync(mono)]);
  assert.match(pm.nestedHint, /An older Worca created it\./);
  const gone = { exists: false, isDir: false, vcs: null, files: null, filesCapped: false, insideRepo: false, partOf: null };
  assert.deepEqual(await probeFolder(join(plain, 'nope')), { path: join(plain, 'nope'), ...gone });
  assert.deepEqual(await probeFolder(join(plain, 'a.txt')), { path: join(plain, 'a.txt'), ...gone, exists: true });
  assert.equal(await outcome(probeFolder('  ')), 'INVALID: path is required');
  const many = tmp('many'); for (let i = 0; i < 5; i++) writeFileSync(join(many, `f${i}`), '');
  assert.deepEqual(await countFiles(many, { cap: 3 }), { n: 3, capped: true });
  assert.deepEqual(await countFiles(repo), { n: 0, capped: false }, '.git is never counted');
  const holder = tmp('holder'); symlinkSync(many, join(holder, 'link'), 'junction');
  assert.deepEqual(await countFiles(holder), { n: 1, capped: false }, 'a link or junction counts as one file, never followed');
  assert.deepEqual(await countFiles(plain, { maxDirs: 1 }), { n: 1, capped: true }, 'past maxDirs folders the count stops');
});

test('a created project ticks the onboarding "project" step', async () => {
  assert.equal((await onboardingStatus()).steps.project, true);
});
