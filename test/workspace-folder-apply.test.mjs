// test/workspace-folder-apply.test.mjs — the workspace arms of folderMemberTarget, writeChangesRecord, releaseFolderMember,
// rollupChanges, History, folderApplyRetainFor, archive and terminalTargets, over seeded workspace rows and a hand-built
// run root (no harness).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { checkRows } from './helpers/rows.mjs';
import { seedWorkspacePipeline } from './helpers/db-seed.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { copyFolder, writeFolderManifest, scanChanges, buildChangesPatch, writeChangesFiles } from '../src/core/folder-copy.mjs';
import { writeRunManifest, readRunManifest } from '../src/core/run-manifest.mjs';
import { folderMemberTarget, writeChangesRecord, FolderApplyError } from '../src/core/folder-apply.mjs';
import { folderMemberFiles, releaseFolderMember, rollupChanges } from '../src/core/folder-members.mjs';
import { folderApplyRetainFor, folderFacts, findPipelineRowById, readPipelineStateById } from '../src/core/artifacts.mjs';
import { terminalTargets } from '../src/core/terminal/context.mjs';
import { archivePipeline, discardRetainedWorktrees } from '../src/core/pipeline-delete.mjs';
import { checkoutRun, discardCheckout } from '../src/core/checkout.mjs';

let srv, base, home;
const env0 = { WORCA_HOME: process.env.WORCA_HOME, WORCA_MOCK: process.env.WORCA_MOCK };
const created = [];
before(async () => {
  home = mkdtempSync(join(tmpdir(), 'worca-wsfa-home-'));
  Object.assign(process.env, { WORCA_HOME: home, WORCA_MOCK: '1' });
  _resetForTests();
  const mod = await import('../ui/server.mjs');
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  await new Promise((r) => srv.close(r));
  for (const [k, v] of Object.entries(env0)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  _resetForTests();
  for (const d of [...created, home]) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
});
const get = (p) => fetch(`${base}${p}`);
const post = (p, body = {}) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const folder = (tag) => { const d = mkdtempSync(join(tmpdir(), `worca-wsfa-${tag}-`)); writeFileSync(join(d, 'notes.txt'), 'n\n'); created.push(d); return d; };
const row = (id) => getDb().prepare('SELECT * FROM pipelines WHERE id = ?').get(id);
const meta = (id) => JSON.parse(row(id).workspace_meta);

/** A finished workspace run as Task 2's harness leaves it: per Folder member a copy with 2 added files, its manifest /
 *  changes under <pipelineDir>/members/<key>/, the records in workspace_meta.branches, run.json retaining the copies. */
async function seedRun({ folders, gitMember = null, status = 'done', commitFailedWt = null }) {
  const projects = [...folders.map((d) => ({ projectDir: d, projectKey: projectKey(d), projectName: d.split('/').pop(), workMode: 'folder' })),
    ...(gitMember ? [{ projectDir: gitMember, projectKey: projectKey(gitMember), projectName: gitMember.split('/').pop() }] : [])]
    .sort((a, b) => (a.projectKey < b.projectKey ? -1 : 1));
  const wk = 'wks-fold-0000abcd';
  const { id, dir } = await seedWorkspacePipeline(projects[0].projectDir, wk, { status, phase: status, projects, branches: {} }, projects);
  const runRoot = join(worcaHome(), 'runs', id);
  const branches = {}; const retainMembers = [];
  for (const p of projects) {
    if (p.workMode !== 'folder') { branches[p.projectKey] = { source: 'main', feature: 'worca-cc/x', ...(commitFailedWt ? { worktreeDir: commitFailedWt, commitFailed: { code: 'X', message: 'm' } } : {}) }; continue; }
    const copyDir = join(runRoot, 'repos', p.projectKey);
    const files = folderMemberFiles(dir, p.projectKey);
    mkdirSync(files.dir, { recursive: true });
    const { manifest } = await copyFolder(p.projectDir, copyDir);
    await writeFolderManifest(files.manifest, manifest);
    mkdirSync(join(copyDir, 'src'), { recursive: true }); mkdirSync(join(copyDir, 'test'), { recursive: true });
    writeFileSync(join(copyDir, 'src', 'feature.mjs'), 'export const x = 1;\n');
    writeFileSync(join(copyDir, 'test', 'feature.test.mjs'), 'ok\n');
    const scan = await scanChanges(copyDir, manifest, { realRoot: p.projectDir });
    const { patch } = await buildChangesPatch({ realRoot: p.projectDir, copyDir, manifest, files: scan.files });
    await writeChangesFiles(files, { version: 1, root: p.projectDir, state: 'pending', files: scan.files, counts: scan.counts }, patch);
    branches[p.projectKey] = { workMode: 'folder', runRootMode: 'detached', copyDir, realDir: p.projectDir, changes: { state: 'pending', counts: scan.counts } };
    retainMembers.push({ projectKey: p.projectKey, copyDir, reason: 'folder-apply', at: 't' });
  }
  if (commitFailedWt) retainMembers.push({ projectKey: gitMember && projectKey(gitMember), worktreeDir: commitFailedWt, branch: 'b', step: 's', message: 'm', at: 't' });
  const allFolder = !gitMember;
  const wm = { workspaceId: wk, workspaceName: 'WS', workspaceDescription: '', projectKeys: projects.map((p) => p.projectKey), projects,
    checkpointRefs: {}, branches, runRootMode: 'detached', ...(allFolder ? { workMode: 'folder' } : {}) };
  const primary = branches[projects[0].projectKey];
  getDb().prepare('UPDATE pipelines SET workspace_meta = ?, branch = ? WHERE id = ?').run(JSON.stringify(wm), JSON.stringify(primary), id);
  await writeRunManifest(runRoot, { pipelineId: id, runRootMode: 'detached', isWorkspace: true, ...(allFolder ? { workMode: 'folder' } : {}),
    members: [], retain: retainMembers.length ? { reason: commitFailedWt ? 'commit_failed' : 'folder-apply', at: 't', members: retainMembers } : null });
  return { id, dir, runRoot, projects, keys: projects.map((p) => p.projectKey) };
}

test('folderMemberTarget / writeChangesRecord / rollupChanges / folderFacts / retain / terminal (units)', async () => {
  const f1 = folder('u1'); const f2 = folder('u2'); const g = folder('ugit');
  const mixed = await seedRun({ folders: [f1], gitMember: g });
  const kf = projectKey(f1); const kg = projectKey(g);
  await checkRows([
    { name: 'target: a MIXED workspace state (no workMode) takes the workspace arm; blank / unknown / git member refused', run: () => {
      const st = readPipelineStateById(mixed.id);
      assert.equal(st.workMode ?? 'git', 'git');
      const bad = (k, status, code, msg) => assert.throws(() => folderMemberTarget(st, k, mixed.dir),
        (e) => e instanceof FolderApplyError && e.status === status && e.code === code && e.message === msg);
      bad(null, 400, 'BAD_MEMBER', 'memberKey is required for a workspace run');
      bad('  ', 400, 'BAD_MEMBER', 'memberKey is required for a workspace run');
      bad('x'.repeat(100), 400, 'BAD_MEMBER', `unknown workspace member: ${'x'.repeat(80)}`);
      bad(kg, 409, 'NOT_FOLDER_RUN', 'This run does not work on a copy.');
      const t = folderMemberTarget(st, kf, mixed.dir);
      assert.equal(t.realDir, f1);
      assert.equal(t.copyDir, join(mixed.runRoot, 'repos', kf));
      assert.equal(t.files.changes, join(mixed.dir, 'members', kf, 'changes.json'));
      assert.equal(t.memberKey, kf);
      assert.equal(t.pipelineId, mixed.id);
    } },
    { name: 'target: a mixed workspace whose PRIMARY is the Git member (branch mirror = git) still reaches the Folder member', run: () => {
      const st = { id: 'abcd1234', target: 'workspace', projectKey: 'a-git-00000001', branch: { source: 'main', feature: 'worca-cc/x' },
        projects: [{ projectKey: 'a-git-00000001', projectDir: '/r/a' }, { projectKey: 'b-notes-00000002', projectDir: '/r/b', projectName: 'b', workMode: 'folder' }],
        branches: { 'a-git-00000001': { source: 'main', feature: 'worca-cc/x' }, 'b-notes-00000002': { workMode: 'folder', copyDir: '/w/runs/abcd1234/repos/b-notes-00000002', realDir: '/r/b' } } };
      const t = folderMemberTarget(st, 'b-notes-00000002', '/p');
      assert.deepEqual([t.realDir, t.copyDir, t.files.changes, t.memberKey, t.memberName, t.pipelineId],
        ['/r/b', '/w/runs/abcd1234/repos/b-notes-00000002', '/p/members/b-notes-00000002/changes.json', 'b-notes-00000002', 'b', 'abcd1234']);
      assert.throws(() => folderMemberTarget(st, '', '/p'), { status: 400, message: 'memberKey is required for a workspace run' });
    } },
    { name: 'single-project arm unchanged', run: () => {
      assert.throws(() => folderMemberTarget({ id: 'abcd1234', projectKey: 'p-00000001', branch: {} }, null, '/x'), { code: 'NOT_FOLDER_RUN' });
      assert.equal(folderMemberTarget({ id: 'abcd1234', projectKey: 'p-00000001', workMode: 'folder', branch: { copyDir: '/c' } }, null, '/x').files.changes, '/x/changes.json');
    } },
    { name: 'writeChangesRecord: the member record only; the primary mirror only when the member is the primary', run: () => {
      const before = meta(mixed.id);
      const primaryKey = before.projects[0].projectKey;
      writeChangesRecord(mixed.id, { state: 'applied', appliedAt: 'A' }, { memberKey: kf });
      const after = meta(mixed.id);
      assert.deepEqual(after.branches[kf].changes, { ...before.branches[kf].changes, state: 'applied', appliedAt: 'A' });
      assert.deepEqual(after.branches[kg], before.branches[kg]);
      const br = JSON.parse(row(mixed.id).branch);
      if (primaryKey === kf) assert.equal(br.changes.state, 'applied'); else assert.equal(br.changes, undefined);
      writeChangesRecord(mixed.id, { state: 'pending' }, { memberKey: kf });
      writeChangesRecord(mixed.id, { state: 'x' }, { memberKey: 'nope-00000000' });   // unknown: no write, no throw
      assert.deepEqual(meta(mixed.id).branches[kg], before.branches[kg]);
      assert.equal(meta(mixed.id).branches[kf].changes.state, 'pending');
      assert.deepEqual(Object.keys(meta(mixed.id).branches).sort(), Object.keys(before.branches).sort());
    } },
    { name: 'rollupChanges', run: () => {
      assert.equal(rollupChanges([]), null);
      const c = (state, a) => ({ state, counts: { added: a, modified: 1, deleted: 0 } });
      assert.deepEqual(rollupChanges([c('applied', 2), c('discarded', 3)]), { state: 'applied', counts: { added: 5, modified: 2, deleted: 0 } });
      assert.deepEqual(rollupChanges([c('applied', 2), c('pending', 1)]).state, 'pending');
      assert.deepEqual(rollupChanges([c('discarded', 2), c('discarded', 1)]).state, 'discarded');
    } },
    { name: 'folderFacts / folderApplyRetainFor on a MIXED row: changes rollup, no workMode; the Folder member retained', run: () => {
      assert.deepEqual(folderFacts(row(mixed.id)), { changes: { state: 'pending', counts: { added: 2, modified: 0, deleted: 0 } } });
      assert.deepEqual(folderApplyRetainFor(row(mixed.id)), { reason: 'folder-apply', members: [{ projectKey: kf, copyDir: join(mixed.runRoot, 'repos', kf) }] });
      assert.equal(readPipelineStateById(mixed.id).changes.state, 'pending');
    } },
    { name: 'terminalTargets: the mixed run\'s Folder member opens in its copy; the Git member needs a checkout', run: () => {
      const t = terminalTargets(row(mixed.id));
      const by = Object.fromEntries(t.members.map((m) => [m.projectKey, m]));
      assert.deepEqual([by[kf].state, by[kf].cwd], ['worktree', join(mixed.runRoot, 'repos', kf)]);
      assert.equal(by[kg].state, 'needs-checkout');
    } },
  ]);
});

test('routes + releaseFolderMember + history + archive on an all-Folder workspace row', async () => {
  const f1 = folder('r1'); const f2 = folder('r2');
  const run = await seedRun({ folders: [f1, f2] });
  const { id, runRoot } = run; const k1 = projectKey(f1), k2 = projectKey(f2);
  await checkRows([
    { name: 'no memberKey -> 400', run: async () => {
      const r = await get(`/api/runs/${id}/changes`);
      assert.equal(r.status, 400); assert.equal((await r.json()).error, 'memberKey is required for a workspace run');
    } },
    { name: 'unknown member -> 400', run: async () => {
      const r = await get(`/api/runs/${id}/changes?memberKey=nope-00000000`);
      assert.equal(r.status, 400); assert.equal((await r.json()).error, 'unknown workspace member: nope-00000000');
    } },
    { name: 'each member its own pending Changes; the patch route', run: async () => {
      for (const k of [k1, k2]) {
        const j = await (await get(`/api/runs/${id}/changes?memberKey=${k}`)).json();
        assert.equal(j.state, 'pending'); assert.deepEqual(j.counts, { added: 2, modified: 0, deleted: 0 });
        const p = await get(`/api/runs/${id}/changes/patch?memberKey=${k}`);
        assert.equal(p.status, 200); assert.match(await p.text(), /feature\.mjs/);
      }
    } },
    { name: 'apply-plan targets the member folder', run: async () => {
      const j = await (await get(`/api/runs/${id}/apply-plan?memberKey=${k1}`)).json();
      assert.equal(j.target, f1); assert.deepEqual(j.add, ['src/feature.mjs', 'test/feature.test.mjs']);
      assert.deepEqual([j.update, j.delete, j.skipped], [[], [], []]);
    } },
    { name: 'Apply one member: its folder gets the files, its copy goes, the run root stays', run: async () => {
      assert.deepEqual(await (await post(`/api/runs/${id}/apply?memberKey=${k1}`)).json(), { applied: 2, skipped: [] });
      assert.ok(existsSync(join(f1, 'src', 'feature.mjs')));
      assert.deepEqual(readdirSync(f2), ['notes.txt']);
      assert.ok(!existsSync(join(runRoot, 'repos', k1)));
      assert.ok(existsSync(join(runRoot, 'repos', k2)));
      assert.deepEqual((await readRunManifest(runRoot)).retain.members.map((m) => m.projectKey), [k2]);
      assert.equal((await (await get(`/api/runs/${id}/changes?memberKey=${k1}`)).json()).state, 'applied');
      assert.equal(meta(id).branches[k1].changes.state, 'applied');
      const again = await post(`/api/runs/${id}/apply?memberKey=${k1}`);
      assert.equal(again.status, 409); assert.equal((await again.json()).code, 'CHANGES_SETTLED');
    } },
    { name: 'Discard the last member: its folder untouched, the run root removed, run.json kept in the pipeline dir', run: async () => {
      assert.deepEqual(await (await post(`/api/runs/${id}/discard?memberKey=${k2}`)).json(), { ok: true });
      assert.deepEqual(readdirSync(f2), ['notes.txt']);
      assert.ok(!existsSync(runRoot));
      assert.equal(JSON.parse(readFileSync(join(run.dir, 'run.json'), 'utf8')).retain, null);
      const primary = meta(id).projects[0].projectKey;
      assert.equal(JSON.parse(row(id).branch).changes.state, primary === k1 ? 'applied' : 'discarded', 'the scalar mirror follows the primary member');
    } },
    { name: 'History: members carry workMode + changes; the row rolls them up', run: async () => {
      const h = (await (await get('/api/history')).json()).pipelines.find((p) => p.id === id);
      assert.deepEqual(h.members.map((m) => [m.memberKey, m.workMode, m.changes.state, m.affected]).sort(),
        [[k1, 'folder', 'applied', true], [k2, 'folder', 'discarded', true]].sort());
      assert.deepEqual(h.changes, { state: 'applied', counts: { added: 4, modified: 0, deleted: 0 } });
      assert.equal(h.workMode, 'folder');
    } },
  ]);
});

test('releaseFolderMember keeps the root for a commit-failed Git member; refuses junk keys', async () => {
  const f1 = folder('c1'); const g = folder('cg');
  const wt = mkdtempSync(join(tmpdir(), 'worca-wsfa-wt-')); created.push(wt);
  const run = await seedRun({ folders: [f1], gitMember: g, commitFailedWt: wt });
  const k1 = projectKey(f1);
  assert.deepEqual(await releaseFolderMember({ worcaHome: worcaHome(), pipelineId: run.id, pipelineDir: run.dir, memberKey: '../x' }), { removed: false, runRootRemoved: false });
  assert.deepEqual(await releaseFolderMember({ worcaHome: worcaHome(), pipelineId: '../..', pipelineDir: run.dir, memberKey: k1 }), { removed: false, runRootRemoved: false });
  assert.deepEqual(await releaseFolderMember({ worcaHome: worcaHome(), pipelineId: run.id, pipelineDir: run.dir, memberKey: k1 }), { removed: true, runRootRemoved: false });
  assert.ok(existsSync(run.runRoot));
  const man = await readRunManifest(run.runRoot);
  assert.equal(man.retain.reason, 'commit_failed');
  assert.deepEqual(man.retain.members.map((m) => m.worktreeDir || m.copyDir), [wt]);
});

test('releaseFolderMember never removes through a link planted at repos/ or runs/<id> (unit + the Discard route)', async () => {
  const linkDir = (target, at) => symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');
  /** A victim folder holding `<sub>/<key>/sentinel.txt` (the predictable store-dir shape), outside the run root. */
  const victim = (key, sub = '') => {
    const v = mkdtempSync(join(tmpdir(), 'worca-wsfa-victim-')); created.push(v);
    mkdirSync(join(v, sub, key), { recursive: true }); writeFileSync(join(v, sub, key, 'sentinel.txt'), 'keep\n');
    return v;
  };
  await checkRows([
    { name: 'unit: repos/ swapped for a link to a folder holding <key>/ — the target survives, the link goes with the root', run: async () => {
      const f1 = folder('l1'); const run = await seedRun({ folders: [f1] }); const k1 = projectKey(f1);
      const v = victim(k1);
      renameSync(join(run.runRoot, 'repos'), join(run.runRoot, 'repos.moved')); linkDir(v, join(run.runRoot, 'repos'));
      const r = await releaseFolderMember({ worcaHome: worcaHome(), pipelineId: run.id, pipelineDir: run.dir, memberKey: k1 });
      assert.ok(existsSync(join(v, k1, 'sentinel.txt')), 'the link target must survive');
      assert.deepEqual(r, { removed: false, runRootRemoved: true });
      assert.ok(!existsSync(run.runRoot));
    } },
    { name: 'unit: runs/<id> swapped for a link to a folder holding repos/<key>/ — the target survives', run: async () => {
      const f1 = folder('l2'); const run = await seedRun({ folders: [f1] }); const k1 = projectKey(f1);
      const v = victim(k1, 'repos');
      renameSync(run.runRoot, `${run.runRoot}.moved`); created.push(`${run.runRoot}.moved`); linkDir(v, run.runRoot);
      await releaseFolderMember({ worcaHome: worcaHome(), pipelineId: run.id, pipelineDir: run.dir, memberKey: k1 });
      assert.ok(existsSync(join(v, 'repos', k1, 'sentinel.txt')), 'the link target must survive');
    } },
    { name: 'route: Discard one member through a planted repos/ link — 200, the target survives', run: async () => {
      const f1 = folder('l3'); const run = await seedRun({ folders: [f1] }); const k1 = projectKey(f1);
      const v = victim(k1);
      renameSync(join(run.runRoot, 'repos'), join(run.runRoot, 'repos.moved')); linkDir(v, join(run.runRoot, 'repos'));
      const r = await post(`/api/runs/${run.id}/discard?memberKey=${k1}`);
      assert.equal(r.status, 200, await r.clone().text());
      assert.ok(existsSync(join(v, k1, 'sentinel.txt')), 'the link target must survive');
      assert.deepEqual(readdirSync(f1), ['notes.txt']);
    } },
  ]);
});

test('releaseFolderMember: the run root stays while the DB lists another pending copy; a failed copy removal still leaves retain', async () => {
  await checkRows([
    { name: 'route: run.json lost its retain (crash before teardown wrote it) — Apply A keeps the root, then B applies', run: async () => {
      const f1 = folder('d1'); const f2 = folder('d2');
      const run = await seedRun({ folders: [f1, f2] }); const [ka, kb] = run.keys;
      const [fa, fb] = ka === projectKey(f1) ? [f1, f2] : [f2, f1];
      await writeRunManifest(run.runRoot, { pipelineId: run.id, runRootMode: 'detached', isWorkspace: true, workMode: 'folder', members: [], retain: null });
      assert.deepEqual(await (await post(`/api/runs/${run.id}/apply?memberKey=${ka}`)).json(), { applied: 2, skipped: [] });
      assert.ok(existsSync(join(fa, 'src', 'feature.mjs')));
      assert.ok(existsSync(join(run.runRoot, 'repos', kb)), "the other member's copy must survive");
      assert.deepEqual(await (await post(`/api/runs/${run.id}/apply?memberKey=${kb}`)).json(), { applied: 2, skipped: [] });
      assert.ok(existsSync(join(fb, 'src', 'feature.mjs')));
      assert.ok(!existsSync(run.runRoot));
    } },
    { name: 'unit: pendingMembers naming only the released member itself does not keep the root', run: async () => {
      const f1 = folder('d3'); const run = await seedRun({ folders: [f1] }); const k1 = projectKey(f1);
      const r = await releaseFolderMember({ worcaHome: worcaHome(), pipelineId: run.id, pipelineDir: run.dir, memberKey: k1,
        pendingMembers: [{ projectKey: k1, copyDir: join(run.runRoot, 'repos', k1) }] });
      assert.deepEqual(r, { removed: true, runRootRemoved: true });
    } },
    { name: 'unit: the copy cannot be removed — the member still leaves retain, the other keeps the root', run: async () => {
      if (process.platform === 'win32' || process.getuid?.() === 0) return;   // a 0555 folder blocks removal only for a non-root POSIX user
      const f1 = folder('d4'); const f2 = folder('d5');
      const run = await seedRun({ folders: [f1, f2] }); const [ka, kb] = run.keys;
      const repos = join(run.runRoot, 'repos');
      chmodSync(repos, 0o555);
      try {
        const r = await releaseFolderMember({ worcaHome: worcaHome(), pipelineId: run.id, pipelineDir: run.dir, memberKey: ka });
        assert.deepEqual(r, { removed: false, runRootRemoved: false });
      } finally { chmodSync(repos, 0o755); }
      assert.deepEqual((await readRunManifest(run.runRoot)).retain.members.map((m) => m.projectKey), [kb]);
    } },
  ]);
});

test('archive: every pending Folder member of a workspace row is discarded (no nested tx), one audit line each', async () => {
  const f1 = folder('a1'); const f2 = folder('a2');
  const run = await seedRun({ folders: [f1, f2] });
  const r = await post(`/api/runs/${run.id}/discard?memberKey=${projectKey(f1)}`);
  assert.equal(r.status, 200);
  const rep = await archivePipeline({ workspaceKey: 'wks-fold-0000abcd', id: run.id });
  assert.equal(rep.archived, true, JSON.stringify(rep));
  const b = meta(run.id).branches;
  assert.deepEqual([b[projectKey(f1)].changes.state, b[projectKey(f2)].changes.state], ['discarded', 'discarded']);
  const lines = getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ?').all(run.id).map((x) => x.text).filter((t) => /archived/.test(t));
  assert.deepEqual(lines, [`Discarded the run's changes (archived); \`${f2}\` was not touched.`]);
  assert.ok(!existsSync(run.runRoot));
  assert.deepEqual(readdirSync(f2), ['notes.txt']);
});

test('Archive of a mixed workspace run closes the run\'s terminals first while a Folder member\'s copy is pending (it goes with the run root)', async () => {
  const { _testing: T } = await import('../ui/server.mjs');
  const f1 = folder('t1'); const g = folder('tg');
  const run = await seedRun({ folders: [f1], gitMember: g });
  const copy = join(run.runRoot, 'repos', projectKey(f1));
  assert.equal(JSON.parse(row(run.id).workspace_meta).workMode, undefined, 'a mixed row has no run-level workMode');
  const seen = []; const orig = T.terminals.closeWhere;
  T.terminals.closeWhere = function (pred, ...rest) { if (pred({ runId: run.id, member: null })) seen.push(existsSync(copy)); return orig.call(this, pred, ...rest); };
  let r;
  try { r = await fetch(`${base}/api/runs/${run.id}?workspaceId=wks-fold-0000abcd`, { method: 'DELETE' }); } finally { T.terminals.closeWhere = orig; }
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(seen, [true], 'closed while the copy still existed');
  assert.equal(existsSync(copy), false);
});

/** A real repository for a mixed run's Git member (its seeded record names the branch worca-cc/x). */
const gitRepo = (tag) => { const d = templateRepo(`wsfa-${tag}`, { branch: 'main', user: true, files: { 'seed.txt': 'seed\n' } }); created.push(d); return d; };

test('Discard the checkout of a mixed run\'s Git member keeps the run root while its Folder member\'s Changes wait', async () => {
  const f1 = folder('k1'); const g = gitRepo('co');
  spawnSync('git', ['branch', 'worca-cc/x'], { cwd: g });
  const run = await seedRun({ folders: [f1], gitMember: g });
  const kf = projectKey(f1), kg = projectKey(g);
  const copy = join(run.runRoot, 'repos', kf);
  const co = await checkoutRun({ id: run.id, members: [kg] });
  assert.deepEqual(co.members.map((m) => [m.projectKey, m.state]), [[kg, 'checked-out']]);
  assert.deepEqual((await discardCheckout({ id: run.id, members: [kg] })).removed, [kg]);
  assert.ok(existsSync(copy), 'the pending Folder copy went with the Git member\'s checkout');
  assert.deepEqual((await readRunManifest(run.runRoot)).retain.members.map((m) => m.projectKey), [kf]);
  const r = await post(`/api/runs/${run.id}/apply?memberKey=${kf}`);
  assert.equal(r.status, 200, await r.clone().text());
  assert.ok(existsSync(join(f1, 'src', 'feature.mjs')));
  assert.ok(!existsSync(run.runRoot), 'the run root goes with the last member');
});

test('Discard worktree of a commit-failed Git member keeps the run root while a Folder member\'s Changes wait', async () => {
  const f1 = folder('d1'); const g = gitRepo('cf');
  const parent = mkdtempSync(join(tmpdir(), 'worca-wsfa-cfwt-')); created.push(parent);
  const wt = join(parent, 'wt');
  const add = spawnSync('git', ['worktree', 'add', '-q', '-b', 'worca-cc/x', wt], { cwd: g, encoding: 'utf8' });
  assert.equal(add.status, 0, add.stderr);
  writeFileSync(join(wt, 'left.txt'), 'uncommitted\n');
  const run = await seedRun({ folders: [f1], gitMember: g, commitFailedWt: wt });
  const kf = projectKey(f1);
  const copy = join(run.runRoot, 'repos', kf);
  const rep = await discardRetainedWorktrees({ workspaceKey: 'wks-fold-0000abcd', id: run.id });
  assert.ok(existsSync(copy), 'the pending Folder copy went with the Git member\'s retained worktree');
  assert.deepEqual([rep.discarded, rep.remaining, rep.runRoot, existsSync(wt)], [true, 0, null, false], JSON.stringify(rep));
  const r = await post(`/api/runs/${run.id}/apply?memberKey=${kf}`);
  assert.equal(r.status, 200, await r.clone().text());
  assert.ok(!existsSync(run.runRoot), 'the run root goes with the last member');
});

test('Apply of a mixed run\'s Folder member closes only that member\'s terminals', async () => {
  const { _testing: T } = await import('../ui/server.mjs');
  const f1 = folder('s1'); const g = folder('sg');
  const run = await seedRun({ folders: [f1], gitMember: g });
  const kf = projectKey(f1), kg = projectKey(g);
  const sessions = [{ runId: run.id, member: kg }, { runId: run.id, member: kf }];
  const closed = []; const orig = T.terminals.closeWhere;
  T.terminals.closeWhere = function (pred, ...rest) { for (const x of sessions) if (pred(x)) closed.push(x.member); return orig.call(this, pred, ...rest); };
  let r;
  try { r = await post(`/api/runs/${run.id}/apply?memberKey=${kf}`); } finally { T.terminals.closeWhere = orig; }
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(closed, [kf], 'the Git member\'s terminal stays open');
});

test('History: a Git member carries no workMode key (an all-Git workspace row stays what it was before P5)', async () => {
  const g1 = folder('h1'); const g2 = folder('h2'); const f1 = folder('hf');
  const allGit = await seedRun({ folders: [], gitMember: g1 });
  const mixed = await seedRun({ folders: [f1], gitMember: g2 });
  const rows = (await (await get('/api/history')).json()).pipelines;
  const modes = (id) => rows.find((p) => p.id === id).members.map((m) => [m.memberKey, 'workMode' in m ? m.workMode : '(no key)']).sort();
  assert.deepEqual(modes(allGit.id), [[projectKey(g1), '(no key)']]);
  assert.deepEqual(modes(mixed.id), [[projectKey(f1), 'folder'], [projectKey(g2), '(no key)']].sort());
});

test('A refused Archive of a mixed run (its Git member checked out, or its commit-failed work kept) closes no terminal', async () => {
  const { _testing: T } = await import('../ui/server.mjs');
  const archive = async (run) => {
    const closed = []; const orig = T.terminals.closeWhere;
    T.terminals.closeWhere = function (pred, ...rest) { for (const m of run.keys) if (pred({ runId: run.id, member: m })) closed.push(m); return orig.call(this, pred, ...rest); };
    let r;
    try { r = await fetch(`${base}/api/runs/${run.id}?workspaceId=wks-fold-0000abcd`, { method: 'DELETE' }); } finally { T.terminals.closeWhere = orig; }
    return [r.status, (await r.json()).error, closed];
  };
  await checkRows([
    { name: 'the Git member is checked out: 409, no terminal closed, the Folder copy stays', run: async () => {
      const f1 = folder('rc1'); const g = gitRepo('rco');
      spawnSync('git', ['branch', 'worca-cc/x'], { cwd: g });
      const run = await seedRun({ folders: [f1], gitMember: g });
      await checkoutRun({ id: run.id, members: [projectKey(g)] });
      assert.deepEqual(await archive(run), [409, 'cannot archive while the run is checked out; discard the checkout first', []]);
      assert.ok(existsSync(join(run.runRoot, 'repos', projectKey(f1))));
    } },
    { name: 'the Git member\'s commit-failed work is kept: 409, no terminal closed', run: async () => {
      const f1 = folder('rf1'); const g = gitRepo('rcf');
      const parent = mkdtempSync(join(tmpdir(), 'worca-wsfa-rfwt-')); created.push(parent);
      const wt = join(parent, 'wt');
      const add = spawnSync('git', ['worktree', 'add', '-q', '-b', 'worca-cc/x', wt], { cwd: g, encoding: 'utf8' });
      assert.equal(add.status, 0, add.stderr);
      const run = await seedRun({ folders: [f1], gitMember: g, commitFailedWt: wt });
      assert.deepEqual(await archive(run),
        [409, 'cannot archive while retained uncommitted work exists; recover it or discard the worktree first', []]);
    } },
    { name: 'run.json still retains the Git member\'s commit-failed worktree (the DB stamp never landed): 409, no terminal closed', run: async () => {
      const f1 = folder('rm1'); const g = gitRepo('rmo');
      const parent = mkdtempSync(join(tmpdir(), 'worca-wsfa-rmwt-')); created.push(parent);
      const wt = join(parent, 'wt');
      const add = spawnSync('git', ['worktree', 'add', '-q', '-b', 'worca-cc/x', wt], { cwd: g, encoding: 'utf8' });
      assert.equal(add.status, 0, add.stderr);
      const run = await seedRun({ folders: [f1], gitMember: g, commitFailedWt: wt });
      const wm = meta(run.id);
      wm.branches[projectKey(g)] = { source: 'main', feature: 'worca-cc/x' };     // teardown's last-chance DB stamp never landed
      getDb().prepare('UPDATE pipelines SET workspace_meta = ?, branch = ? WHERE id = ?').run(JSON.stringify(wm), JSON.stringify(wm.branches[run.keys[0]]), run.id);
      assert.deepEqual(await archive(run),
        [409, 'cannot archive while retained uncommitted work exists; recover it or discard the worktree first', []]);
    } },
  ]);
});
