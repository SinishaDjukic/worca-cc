// test/fs-browse.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, parse } from 'node:path';
import { listFolders } from '../src/core/fs-browse.mjs';
import { checkRows } from './helpers/rows.mjs';

let root;
let hasLink = false;
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'worca-cc-fsbrowse-'));
  await mkdir(join(root, 'beta'));
  await mkdir(join(root, 'Alpha'));
  await mkdir(join(root, '.hidden'));
  await writeFile(join(root, 'file.txt'), 'x');
  try { await symlink(join(root, 'beta'), join(root, 'link-to-beta'), 'dir'); hasLink = true; } catch { /* fs without symlink perms */ }
});
after(async () => { await rm(root, { recursive: true, force: true }); });

function withHome(dir, fn) {
  const prevH = process.env.HOME, prevU = process.env.USERPROFILE;
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  return Promise.resolve(fn()).finally(() => {
    if (prevH === undefined) delete process.env.HOME; else process.env.HOME = prevH;
    if (prevU === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevU;
  });
}

test('lists visible directories (symlinked ones included), case-insensitively sorted', async () => {
  await checkRows([
    { name: 'lists only visible directories, case-insensitively sorted', run: async () => {
      const out = await listFolders(root);
      const names = out.dirs.map((d) => d.name);
      assert.ok(names.includes('Alpha') && names.includes('beta'));
      assert.ok(!names.includes('.hidden'), 'dotfolders are hidden');
      assert.ok(!names.includes('file.txt'), 'files are excluded');
      const sorted = [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      assert.deepEqual(names, sorted);
      assert.equal(out.path, root);
      assert.equal(out.parent, dirname(root));
      for (const d of out.dirs) assert.equal(d.path, join(root, d.name));
    } },
    { name: 'symlinked directories are listed', run: async () => {
      // A fs without symlink permission has no link to list; everywhere else it must be there.
      if (!hasLink) return;
      const out = await listFolders(root);
      assert.ok(out.dirs.map((d) => d.name).includes('link-to-beta'), 'a symlinked directory is listed');
    } },
  ]);
});

function withProjectsRoot(dir, fn) {
  const prev = process.env.WORCA_PROJECTS_ROOT;
  process.env.WORCA_PROJECTS_ROOT = dir;
  return Promise.resolve(fn()).finally(() => {
    if (prev === undefined) delete process.env.WORCA_PROJECTS_ROOT; else process.env.WORCA_PROJECTS_ROOT = prev;
  });
}

test('empty input opens the projects root when it exists, else the OS home', async () => {
  await checkRows([
    { name: 'empty input lists the home directory', run: () => withHome(root, async () => {
      const out = await listFolders('');
      assert.equal(out.path, root);
      assert.equal(out.home, root);
    }) },
    { name: 'empty input opens at the projects root; home stays the OS home', run: () => withHome(root, () =>
      withProjectsRoot(join(root, 'beta'), async () => {
        const out = await listFolders('');
        assert.equal(out.path, join(root, 'beta'));
        assert.equal(out.home, root);
      })) },
    { name: 'empty input falls back to home when the projects root does not exist', run: () => withHome(root, () =>
      withProjectsRoot(join(root, 'no-such-dir'), async () => {
        const out = await listFolders('');
        assert.equal(out.path, root);
      })) },
    { name: 'empty input lists home even when the default projects folder exists (only a configured root is a start)', run: () => withHome(root, async () => {
      const prev = process.env.WORCA_HOME;
      process.env.WORCA_HOME = root;
      const def = join(root, '.worca-cc', 'projects');
      await mkdir(def, { recursive: true });
      try { assert.equal((await listFolders('')).path, root); }
      finally { if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev; await rm(join(root, '.worca-cc'), { recursive: true, force: true }); }
    }) },
  ]);
});

test('tilde input expands to home', () => withHome(root, async () => {
  const out = await listFolders('~/beta');
  assert.equal(out.path, join(root, 'beta'));
}));

test('parent is null at the filesystem root', async () => {
  const fsRoot = parse(root).root;
  const out = await listFolders(fsRoot);
  assert.equal(out.parent, null);
});

test('nonexistent and non-directory paths throw BAD_REQUEST', async () => {
  await assert.rejects(() => listFolders(join(root, 'nope')), (e) => e.code === 'BAD_REQUEST');
  await assert.rejects(() => listFolders(join(root, 'file.txt')), (e) => e.code === 'BAD_REQUEST');
});

// Limited listing (a hosted Worca with the terminal and actions off; src/core/fs-scope.mjs):
// roots are real paths, and every path is checked after symlinks and `..` are resolved.
test('limited listing stays inside the allowed roots', async () => {
  const { realRoots } = await import('../src/core/fs-scope.mjs');
  const base = await realpath(await mkdtemp(join(tmpdir(), 'worca-cc-fsscope-')));
  try {
    const projects = join(base, 'projects');
    const data = join(base, 'data');
    const outside = join(base, 'outside');
    await mkdir(join(projects, 'app'), { recursive: true });
    await mkdir(join(data, 'worca'), { recursive: true });
    await mkdir(join(outside, 'secret'), { recursive: true });
    let linked = false;
    try { await symlink(outside, join(projects, 'escape'), 'dir'); linked = true; } catch { /* no symlink perms */ }
    const roots = await realRoots([projects, data, join(projects, 'app'), join(base, 'missing')]);
    const outsideErr = (e) => e.code === 'FS_OUTSIDE_ALLOWED' && /WORCA_TERMINAL_REMOTE=1/.test(e.message);
    await withProjectsRoot(projects, () => checkRows([
      { name: 'roots: real, existing, nested ones folded into their parent', run: () => {
        assert.deepEqual(roots, [projects, data]);
      } },
      { name: 'blank input opens the projects root, flagged limited with its roots', run: async () => {
        const out = await listFolders('', { roots });
        assert.equal(out.path, projects);
        assert.equal(out.home, projects);
        assert.equal(out.limited, true);
        assert.deepEqual(out.roots, roots);
        assert.equal(out.parent, null, 'Up stops at a root');
      } },
      { name: 'a folder inside a root lists, with its parent', run: async () => {
        const out = await listFolders(join(projects, 'app'), { roots });
        assert.equal(out.path, join(projects, 'app'));
        assert.equal(out.parent, projects);
        assert.deepEqual((await listFolders(data, { roots })).dirs.map((d) => d.name), ['worca']);
      } },
      { name: 'a folder outside every root is refused', run: async () => {
        await assert.rejects(() => listFolders(outside, { roots }), outsideErr);
        await assert.rejects(() => listFolders(base, { roots }), outsideErr);
        await assert.rejects(() => listFolders('/', { roots }), outsideErr);
      } },
      { name: 'a `..` escape is refused', run: async () => {
        await assert.rejects(() => listFolders(join(projects, '..', 'outside'), { roots }), outsideErr);
        await assert.rejects(() => listFolders(`${projects}/app/../../outside/secret`, { roots }), outsideErr);
      } },
      { name: 'a missing path outside answers outside (no existence leak); a missing path inside answers BAD_REQUEST', run: async () => {
        await assert.rejects(() => listFolders(join(outside, 'nope'), { roots }), outsideErr);
        await assert.rejects(() => listFolders(join(projects, 'nope'), { roots }), (e) => e.code === 'BAD_REQUEST');
      } },
      { name: 'a symlink out of a root is refused and not listed', run: async () => {
        if (!linked) return;
        await assert.rejects(() => listFolders(join(projects, 'escape'), { roots }), outsideErr);
        await assert.rejects(() => listFolders(join(projects, 'escape', 'secret'), { roots }), outsideErr);
        assert.ok(!(await listFolders(projects, { roots })).dirs.some((d) => d.name === 'escape'));
        assert.ok((await listFolders(projects)).dirs.some((d) => d.name === 'escape'), 'unlimited listing still shows it');
      } },
    ]));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('limited roots: the filesystem root and one-segment folders are never roots; hidden folders count as outside', async () => {
  const { realRoots, checkInside, isBroadRoot } = await import('../src/core/fs-scope.mjs');
  const base = await realpath(await mkdtemp(join(tmpdir(), 'worca-cc-fsscope2-')));
  try {
    const projects = join(base, 'projects');
    const home = join(base, 'worca', '.worca-cc');
    await mkdir(join(projects, 'app', '.git'), { recursive: true });
    await mkdir(join(projects, '.secret', 'inner'), { recursive: true });
    await mkdir(join(home, 'store'), { recursive: true });
    const fsRoot = parse(base).root;
    const oneSeg = join(fsRoot, base.slice(fsRoot.length).split(/[\\/]/)[0]);
    const skipped = [];
    const roots = await realRoots([fsRoot, oneSeg, projects, home], { onSkip: (c) => skipped.push(c) });
    const outsideErr = (e) => e.code === 'FS_OUTSIDE_ALLOWED';
    await withProjectsRoot(projects, () => checkRows([
      { name: 'broad candidates are skipped and reported', run: () => {
        assert.deepEqual(roots, [projects, home]);
        assert.deepEqual(skipped, [fsRoot, oneSeg]);
        for (const p of ['/', '/home', '/usr', '/root', 'C:\\', 'C:\\Users']) assert.equal(isBroadRoot(p), true, p);
        for (const p of ['/home/worca', '/data/projects', 'C:\\Users\\me']) assert.equal(isBroadRoot(p), false, p);
      } },
      { name: 'a hidden folder below a root is outside (existing or not)', run: async () => {
        assert.equal((await checkInside(join(projects, '.secret'), roots)).inside, false);
        assert.equal((await checkInside(join(projects, '.secret', 'inner'), roots)).inside, false);
        assert.equal((await checkInside(join(projects, 'app', '.git'), roots)).inside, false);
        assert.equal((await checkInside(join(projects, 'app', '.ssh-missing'), roots)).inside, false);
        await assert.rejects(() => listFolders(join(projects, '.secret'), { roots }), outsideErr);
      } },
      { name: 'a root whose own name is hidden (the Worca home .worca-cc) still lists', run: async () => {
        assert.equal((await checkInside(join(home, 'store'), roots)).inside, true);
        assert.deepEqual((await listFolders(home, { roots })).dirs.map((d) => d.name), ['store']);
      } },
    ]));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
