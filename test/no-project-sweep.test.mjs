// test/no-project-sweep.test.mjs — P3: the boot sweep moves a no-project run's unharvested work/ into its pipeline dir
// before it reclaims the run root, rescues mounts edited inside work/, keeps a root whose copy failed, and skips a
// root whose harvest lookup threw. run.json is agent-writable: nothing it names reaches past work/, and a work row is
// served only as a real file inside work/.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { sweepRunRoots } from '../src/core/worktree.mjs';
import { writeRunManifest, readRunManifest, removeInjectedPaths, rescueModifiedMounts } from '../src/core/run-manifest.mjs';
import { NO_PROJECT_KEY, noProjectWorkDir } from '../src/core/store.mjs';
import { createPipeline, newPipelineId, listRunArtifacts, runRootSweepLookups, findPipelineRowById, resolveIndexedArtifactForRow } from '../src/core/artifacts.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { assembleRunContext } from '../src/core/run-context.mjs';

useTempHome(after, 'worca-np-sweep-db-');   // the real-lookup row below writes a pipelines row

const ID = 'abcd1234';
async function noProjectRoot(extra = {}) {
  const home = await mkdtemp(join(tmpdir(), 'worca-np-sweep-'));
  const root = join(home, 'runs', ID);
  await mkdir(join(root, 'work'), { recursive: true });
  await writeFile(join(root, 'work', 'a.md'), 'x');
  await writeRunManifest(root, { pipelineId: ID, runRootMode: 'detached', isWorkspace: false, workMode: 'none', members: [], ...extra });
  return { home, root };
}
// statusOf is SYNC (worktree.mjs never awaits it); retainOf / membersOf / pipelineDirOf are awaited.
const lookups = (home, harvestWorkOf) => ({
  worcaHome: home, statusOf: () => 'done', retainOf: async () => null, membersOf: async () => [],
  pipelineDirOf: async () => join(home, 'p'), log: () => {}, harvestWorkOf,
});

test('the boot sweep moves an unharvested work/ before reclaiming; a failed copy keeps the root; a throw touches nothing', async () => {
  const cases = [
    { name: 'harvested then removed', harvest: async () => ({ ok: true, files: [] }), removed: true },
    { name: 'copy failed: kept', harvest: async () => ({ ok: false, error: 'EIO' }), kept: true },
    { name: 'lookup threw: failed', harvest: async () => { throw new Error('db gone'); }, failed: true },
  ];
  for (const c of cases) {
    const { home, root } = await noProjectRoot();
    const calls = [];
    const out = await sweepRunRoots(lookups(home, async (...a) => { calls.push(a); return c.harvest(); }));
    assert.deepEqual(calls, [[ID, root, join(home, 'p')]], c.name);
    assert.equal(out.removed.includes(root), !!c.removed, c.name);
    assert.equal(out.keep.includes(root), !!c.kept, c.name);
    assert.equal(out.failed.includes(root), !!c.failed, c.name);
    await rm(home, { recursive: true, force: true });
  }
});

test('an already harvested work/ is not harvested again', async () => {
  const { home, root } = await noProjectRoot({ workHarvested: { files: 1, bytes: 1, unindexed: 0, at: '2026-10-18T00:00:00.000Z' } });
  const calls = [];
  const out = await sweepRunRoots(lookups(home, async (...a) => { calls.push(a); return { ok: true, files: [] }; }));
  assert.deepEqual(calls, []);
  assert.deepEqual(out.removed, [root]);
  await rm(home, { recursive: true, force: true });
});

test('a skill the agent edited inside work/ is rescued from work/, never from repos/<key> (S71)', async () => {
  const src = await mkdtemp(join(tmpdir(), 'worca-np-sweep-skill-'));
  await writeFile(join(src, 'SKILL.md'), 'v1');
  const { home, root } = await noProjectRoot({ injectedPaths: { [NO_PROJECT_KEY]: [{ path: '.claude/skills/demo', kind: 'skill', source: src }] } });
  await mkdir(join(root, 'work', '.claude', 'skills', 'demo'), { recursive: true });
  await writeFile(join(root, 'work', '.claude', 'skills', 'demo', 'SKILL.md'), 'v2');
  let mountAtHarvest = null;
  const out = await sweepRunRoots(lookups(home, async () => { mountAtHarvest = existsSync(join(root, 'work', '.claude', 'skills', 'demo')); return { ok: true, files: [] }; }));
  assert.equal(await readFile(join(home, 'p', 'stray', NO_PROJECT_KEY, '.claude', 'skills', 'demo', 'SKILL.md'), 'utf8'), 'v2');
  assert.equal(mountAtHarvest, false, 'worca\'s mounts leave work/ before it moves into the pipeline dir (as the live teardown does)');
  assert.ok(out.warnings.some((w) => /agent modified mounted skill `demo`/.test(w)), out.warnings.join('\n'));
  assert.deepEqual(out.removed, [root]);
  await rm(home, { recursive: true, force: true });
  await rm(src, { recursive: true, force: true });
});

test('the real lookup: harvestWorkOf moves work/, indexes work/<rel> rows and stamps workHarvested', async () => {
  const id = newPipelineId();
  const p = await createPipeline(noProjectWorkDir(id), { prompt: 'x', id, projectKey: NO_PROJECT_KEY, workMode: 'none' });
  const root = join(worcaHome(), 'runs', id);
  await mkdir(join(root, 'work'), { recursive: true });
  await writeFile(join(root, 'work', 'a.md'), 'x');
  await writeRunManifest(root, { pipelineId: id, runRootMode: 'detached', isWorkspace: false, workMode: 'none', members: [] });
  const lookups = runRootSweepLookups();
  assert.equal(await lookups.pipelineDirOf(id), p.dir);
  const h = await lookups.harvestWorkOf(id, root, p.dir);
  assert.deepEqual([h.ok, h.files], [true, ['work/a.md']]);
  assert.ok((await listRunArtifacts(id)).some((a) => a.kind === 'work' && a.relPath === 'work/a.md'));
  assert.equal(await readFile(join(p.dir, 'work', 'a.md'), 'utf8'), 'x');
  assert.equal((await readRunManifest(root)).workHarvested.files, 1);
  assert.equal((await lookups.harvestWorkOf(id, root, null)).ok, false, 'no pipeline dir: the root is kept, never reclaimed');
});

test('run.json is agent-writable: an injected path never reaches past its checkout (a .., the checkout itself, a linked parent)', async () => {
  const base = await mkdtemp(join(tmpdir(), 'worca-np-sweep-esc-'));
  const work = join(base, 'runs', ID, 'work');
  await mkdir(join(work, '.claude', 'skills', 'demo'), { recursive: true });
  await writeFile(join(work, '.claude', 'skills', 'demo', 'SKILL.md'), 'mounted');
  await mkdir(join(base, 'victim'), { recursive: true });
  await writeFile(join(base, 'victim', 'precious.txt'), 'keep');
  await removeInjectedPaths(work, [{ path: '../../../victim', kind: 'skill' }, { path: '.', kind: 'skill' }, { path: '.claude/skills/demo', kind: 'skill' }]);
  assert.equal(await readFile(join(base, 'victim', 'precious.txt'), 'utf8'), 'keep', 'a .. never leaves the checkout');
  assert.ok(existsSync(work), 'nor is the checkout itself an entry');
  assert.equal(existsSync(join(work, '.claude')), false, 'its own mount still goes, and the emptied .claude with it');
  const linked = join(base, 'runs', 'beef0000', 'work');
  await mkdir(linked, { recursive: true });
  await mkdir(join(base, 'outside', 'skills', 'demo'), { recursive: true });
  await writeFile(join(base, 'outside', 'skills', 'demo', 'SKILL.md'), 'keep');
  try { await symlink(join(base, 'outside'), join(linked, '.claude')); } catch (e) { if (e.code !== 'EPERM') throw e; }   // Windows without the privilege: skip that half
  await removeInjectedPaths(linked, [{ path: '.claude/skills/demo', kind: 'skill' }], { strict: true });
  assert.equal(await readFile(join(base, 'outside', 'skills', 'demo', 'SKILL.md'), 'utf8'), 'keep', 'strict (no project): a parent swapped for a link is not followed');
  const src = join(base, 'src');
  await mkdir(src);
  await writeFile(join(src, 'SKILL.md'), 'v1');
  const pipelineDir = join(base, 'x', 'p');
  assert.deepEqual(await rescueModifiedMounts({ baseDir: work, pipelineDir, scope: NO_PROJECT_KEY, entries: [{ path: '../../../victim', kind: 'skill', source: src }] }), [], 'never read past the checkout');
  assert.equal(existsSync(join(base, 'x', 'victim')), false);
  assert.deepEqual(await rescueModifiedMounts({ baseDir: join(base, 'victim'), pipelineDir, scope: '../..', entries: [{ path: 'precious.txt', kind: 'skill', source: join(src, 'SKILL.md') }] }), [], 'never write past stray/');
  assert.equal(existsSync(join(base, 'x', 'precious.txt')), false);
  assert.deepEqual(await rescueModifiedMounts({ baseDir: linked, pipelineDir, scope: NO_PROJECT_KEY, strict: true, entries: [{ path: '.claude/skills/demo', kind: 'skill', source: src }] }), [], 'strict: never read through a link');
  // Not strict (a git or folder checkout): a `.claude` the project itself links elsewhere holds worca's mounts too —
  // an edit there is still rescued and the mount still leaves at teardown, as before P3.
  const repo = join(base, 'runs', 'beef0001', 'repos', 'demo-00000001');
  await mkdir(repo, { recursive: true });
  await mkdir(join(base, 'shared', 'skills', 'demo'), { recursive: true });
  await writeFile(join(base, 'shared', 'skills', 'demo', 'SKILL.md'), 'edited');
  let linkedRepo = true;
  try { await symlink(join(base, 'shared'), join(repo, '.claude'), 'junction'); } catch (e) { if (e.code !== 'EPERM') throw e; linkedRepo = false; }
  if (linkedRepo) {
    assert.equal((await rescueModifiedMounts({ baseDir: repo, pipelineDir, scope: 'demo-00000001', entries: [{ path: '.claude/skills/demo', kind: 'skill', source: src }] })).length, 1);
    assert.equal(await readFile(join(pipelineDir, 'stray', 'demo-00000001', '.claude', 'skills', 'demo', 'SKILL.md'), 'utf8'), 'edited');
    await removeInjectedPaths(repo, [{ path: '.claude/skills/demo', kind: 'skill' }, { path: '../../../../victim', kind: 'skill' }]);
    assert.equal(existsSync(join(base, 'shared', 'skills', 'demo')), false, 'a project\'s own linked .claude: worca\'s mount still leaves');
    assert.equal(await readFile(join(base, 'victim', 'precious.txt'), 'utf8'), 'keep', 'a .. never leaves a git checkout either');
  }
  await rm(base, { recursive: true, force: true });
});

test('a resume never prunes a stale skill record past its checkout on run.json\'s word (P3-D19)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-np-sweep-prune-'));
  await mkdir(join(home, 'user'), { recursive: true });
  await mkdir(join(home, 'victim'), { recursive: true });
  await writeFile(join(home, 'victim', 'precious.txt'), 'keep');
  const cases = [
    { id: 'abcd1234', key: NO_PROJECT_KEY, rel: 'work', workMode: 'none', path: '../../../victim' },
    { id: 'abcd1235', key: 'demo-00000001', rel: join('repos', 'demo-00000001'), workMode: 'folder', path: '../../../../victim' },
  ];
  for (const c of cases) {
    const root = join(home, 'runs', c.id);
    const dir = join(root, c.rel);
    await mkdir(dir, { recursive: true });
    await writeRunManifest(root, { pipelineId: c.id, runRootMode: 'detached', isWorkspace: false, workMode: c.workMode, members: [],
      injectedPaths: { [c.key]: [{ kind: 'skill', path: c.path, source: join(home, 'no-such-source') }] } });
    const rc = await assembleRunContext({ runRoot: root, homeDir: join(home, 'user'), projectsRoot: null,
      members: [{ projectKey: c.key, projectName: c.key, projectDir: dir, worktreeDir: dir, workMode: c.workMode }] });
    assert.equal(await readFile(join(home, 'victim', 'precious.txt'), 'utf8'), 'keep', c.workMode);
    assert.equal(rc.warnings.some((w) => w.startsWith('stale skill mount')), false, c.workMode);
  }
  await rm(home, { recursive: true, force: true });
});

test('a resume\'s skill mount never removes an agent\'s own skill in work/, nor anything through a swapped .claude (P3-D19)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-np-sweep-mount-'));
  const projectsRoot = join(home, 'projects');
  await mkdir(join(projectsRoot, '.claude', 'skills', 'rootskill'), { recursive: true });
  await writeFile(join(projectsRoot, '.claude', 'skills', 'rootskill', 'SKILL.md'), '---\nname: rootskill\n---\n');
  const assemble = (root, work) => assembleRunContext({ runRoot: root, homeDir: join(home, 'user'), projectsRoot,
    members: [{ projectKey: NO_PROJECT_KEY, projectName: 'No project', projectDir: work, worktreeDir: work, workMode: 'none' }] });
  // (a) a skill the agent wrote in work/ survives the resume; worca's own mount is re-mounted under its own name, no warning
  const rootA = join(home, 'runs', 'abcd1236');
  const workA = join(rootA, 'work');
  await mkdir(workA, { recursive: true });
  await writeRunManifest(rootA, { pipelineId: 'abcd1236', runRootMode: 'detached', isWorkspace: false, workMode: 'none', members: [] });
  await assemble(rootA, workA);
  await mkdir(join(workA, '.claude', 'skills', 'my-skill'), { recursive: true });
  await writeFile(join(workA, '.claude', 'skills', 'my-skill', 'SKILL.md'), 'the agent\'s work');
  const resumed = await assemble(rootA, workA);
  assert.equal(await readFile(join(workA, '.claude', 'skills', 'my-skill', 'SKILL.md'), 'utf8'), 'the agent\'s work');
  assert.ok(existsSync(join(workA, '.claude', 'skills', 'rootskill', 'SKILL.md')));
  assert.deepEqual(resumed.warnings.filter((w) => /skill/.test(w)), []);
  // (b) work/.claude swapped for a link before the pause: nothing behind it is removed or written
  const rootB = join(home, 'runs', 'abcd1237');
  const workB = join(rootB, 'work');
  await mkdir(workB, { recursive: true });
  await writeRunManifest(rootB, { pipelineId: 'abcd1237', runRootMode: 'detached', isWorkspace: false, workMode: 'none', members: [] });
  const victim = join(home, 'user', '.claude');
  await mkdir(join(victim, 'skills', 'alpha'), { recursive: true });
  await writeFile(join(victim, 'skills', 'alpha', 'SKILL.md'), 'keep');
  let linked = true;
  try { await symlink(victim, join(workB, '.claude'), 'junction'); } catch (e) { if (e.code !== 'EPERM') throw e; linked = false; }   // Windows without the privilege: skip that half
  if (linked) {
    await assemble(rootB, workB);
    assert.equal(await readFile(join(victim, 'skills', 'alpha', 'SKILL.md'), 'utf8'), 'keep', 'the link target keeps its skills');
    assert.equal(existsSync(join(victim, 'skills', 'rootskill')), false, 'nothing is mounted through the link');
  }
  await rm(home, { recursive: true, force: true });
});

test('the boot sweep never deletes past work/ on run.json\'s word', async () => {
  const { home, root } = await noProjectRoot({ injectedPaths: { [NO_PROJECT_KEY]: [{ path: '../../../victim', kind: 'link' }] } });
  await mkdir(join(home, 'victim'), { recursive: true });
  await writeFile(join(home, 'victim', 'precious.txt'), 'keep');
  const out = await sweepRunRoots(lookups(home, async () => ({ ok: true, files: [] })));
  assert.deepEqual(out.removed, [root]);
  assert.equal(await readFile(join(home, 'victim', 'precious.txt'), 'utf8'), 'keep');
  await rm(home, { recursive: true, force: true });
});

test('the boot sweep never rescues or removes through a work/ swapped for a link (P3-D19)', async () => {
  const { home, root } = await noProjectRoot({ injectedPaths: { [NO_PROJECT_KEY]: [{ path: 'p', kind: 'link' }, { path: 'q', kind: 'skill', source: join(tmpdir(), 'worca-np-no-such-source') }] } });
  const outside = join(home, 'outside');
  await mkdir(join(outside, 'p'), { recursive: true });
  await writeFile(join(outside, 'p', 'x'), 'keep');
  await mkdir(join(outside, 'q'), { recursive: true });
  await writeFile(join(outside, 'q', 'SKILL.md'), 'not yours');
  await rename(join(root, 'work'), join(root, 'work.real'));
  try { await symlink(outside, join(root, 'work'), 'junction'); } catch (e) { if (e.code === 'EPERM') { await rm(home, { recursive: true, force: true }); return; } throw e; }
  await sweepRunRoots(lookups(home, async () => ({ ok: true, files: [] })));
  assert.equal(await readFile(join(outside, 'p', 'x'), 'utf8'), 'keep', 'nothing removed through the link');
  assert.equal(existsSync(join(home, 'p', 'stray', NO_PROJECT_KEY)), false, 'nothing rescued through it either');
  await rm(home, { recursive: true, force: true });
});

test('a no-project run\'s strict arms: a .claude inside work/ swapped for a link is never pruned, rescued or removed through (P3-D19)', async () => {
  const outside = async (home) => {
    const o = join(home, 'outside');
    await mkdir(join(o, 'skills', 'demo'), { recursive: true });
    await writeFile(join(o, 'skills', 'demo', 'SKILL.md'), 'not yours');
    return o;
  };
  const entry = (home) => ({ path: join('.claude', 'skills', 'demo'), kind: 'skill', source: join(home, 'no-such-source') });
  // the boot sweep (worktree.mjs sweepRunRoots: strict for a 'none' manifest)
  {
    const { home, root } = await noProjectRoot();
    await writeRunManifest(root, { pipelineId: ID, runRootMode: 'detached', isWorkspace: false, workMode: 'none', members: [], injectedPaths: { [NO_PROJECT_KEY]: [entry(home)] } });
    const o = await outside(home);
    try { await symlink(o, join(root, 'work', '.claude'), 'junction'); } catch (e) { if (e.code === 'EPERM') { await rm(home, { recursive: true, force: true }); return; } throw e; }
    await sweepRunRoots(lookups(home, async () => ({ ok: true, files: [] })));
    assert.equal(await readFile(join(o, 'skills', 'demo', 'SKILL.md'), 'utf8'), 'not yours', 'sweep: nothing removed through work/.claude');
    assert.equal(existsSync(join(home, 'p', 'stray', NO_PROJECT_KEY)), false, 'sweep: nothing rescued through it');
    await rm(home, { recursive: true, force: true });
  }
  // a resume's stale-skill prune (run-context.mjs: strict for a sole 'none' member)
  {
    const { home, root } = await noProjectRoot();
    await writeRunManifest(root, { pipelineId: ID, runRootMode: 'detached', isWorkspace: false, workMode: 'none', members: [], injectedPaths: { [NO_PROJECT_KEY]: [entry(home)] } });
    const o = await outside(home);
    await symlink(o, join(root, 'work', '.claude'), 'junction');
    const work = join(root, 'work');
    await assembleRunContext({ runRoot: root, homeDir: join(home, 'user'), projectsRoot: null,
      members: [{ projectKey: NO_PROJECT_KEY, projectName: 'No project', projectDir: work, worktreeDir: work, workMode: 'none' }] });
    assert.equal(await readFile(join(o, 'skills', 'demo', 'SKILL.md'), 'utf8'), 'not yours', 'prune: nothing removed through work/.claude');
    await rm(home, { recursive: true, force: true });
  }
});

test('a work row is served only as a real file inside work/, never a link planted after the index (P3-D13)', async () => {
  const id = newPipelineId();
  const p = await createPipeline(noProjectWorkDir(id), { prompt: 'x', id, projectKey: NO_PROJECT_KEY, workMode: 'none' });
  const root = join(worcaHome(), 'runs', id);
  await mkdir(join(root, 'work', 'site'), { recursive: true });
  await writeFile(join(root, 'work', 'a.md'), 'mine');
  await writeFile(join(root, 'work', 'site', 'index.html'), '<p>mine</p>');
  await writeRunManifest(root, { pipelineId: id, runRootMode: 'detached', isWorkspace: false, workMode: 'none', members: [] });
  assert.equal((await runRootSweepLookups().harvestWorkOf(id, root, p.dir)).ok, true);
  const row = findPipelineRowById(id);
  assert.equal((await resolveIndexedArtifactForRow(row, 'work/a.md')).text, 'mine');
  assert.equal((await resolveIndexedArtifactForRow(row, 'work/site/index.html')).text, '<p>mine</p>');
  // a process that outlived the run (its cwd moved with work/) swaps files for links after the index
  await mkdir(join(worcaHome(), 'elsewhere'), { recursive: true });
  await writeFile(join(worcaHome(), 'elsewhere', 'index.html'), 'not yours');
  await rm(join(p.dir, 'work', 'a.md'));
  await rm(join(p.dir, 'work', 'site'), { recursive: true });
  try {
    await symlink(join(worcaHome(), 'elsewhere', 'index.html'), join(p.dir, 'work', 'a.md'));
    await symlink(join(worcaHome(), 'elsewhere'), join(p.dir, 'work', 'site'));
  } catch (e) { if (e.code === 'EPERM') return; throw e; }   // Windows without the privilege
  assert.equal(await resolveIndexedArtifactForRow(row, 'work/a.md'), null, 'a file swapped for a link');
  assert.equal(await resolveIndexedArtifactForRow(row, 'work/site/index.html'), null, 'a folder swapped for a link');
});

test('a work file whose name holds a backslash (legal off Windows) opens like any other', { skip: process.platform === 'win32' }, async () => {
  const id = newPipelineId();
  const p = await createPipeline(noProjectWorkDir(id), { prompt: 'odd names', id, projectKey: NO_PROJECT_KEY });
  const work = noProjectWorkDir(id);
  await mkdir(work, { recursive: true });
  await writeFile(join(work, 'a\\b.md'), 'odd');
  const h = await runRootSweepLookups().harvestWorkOf(id, join(work, '..'), p.dir);
  assert.deepEqual(h.files, ['work/a\\b.md']);
  assert.deepEqual(await resolveIndexedArtifactForRow(findPipelineRowById(id), 'work/a\\b.md'), { rel: 'work/a\\b.md', text: 'odd' });
});
