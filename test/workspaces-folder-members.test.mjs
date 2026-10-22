// test/workspaces-folder-members.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { checkRows } from './helpers/rows.mjs';
import { withNoGit } from './helpers/git-off.mjs';
import { addProject } from '../src/core/projects.mjs';
import { getDb } from '../src/core/db.mjs';
import {
  createWorkspace, readWorkspace, addWorkspaceMembers, checkNewWorkspace, memberWorkMode, scanMemberProblems,
} from '../src/core/workspaces.mjs';

useTempHome(after);
const created = [];
after(() => { for (const d of created) rmSync(d, { recursive: true, force: true }); });
const folder = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `worca-wsf-${tag}-`));
  writeFileSync(join(d, 'notes.txt'), 'n\n');
  created.push(d);
  return d;
};
const repo = () => { const d = templateRepo('wsf', { branch: 'main', user: true, files: { 'a.txt': 'a\n' } }); created.push(d); return d; };

test('git on: registered Folder projects join; the stored kind rides the read; an unregistered plain folder is refused', async () => {
  const g = repo();
  const f1 = folder('a'); const f2 = folder('b'); const plain = folder('plain');
  await addProject({ name: 'Notes A', path: f1 });
  await addProject({ name: 'Notes B', path: f2 });
  await checkRows([
    { name: 'git on: a repo and a Folder project make a workspace; vcs is aligned with projectPaths', run: async () => {
      const read = await readWorkspace((await createWorkspace({ name: 'Mixed', projectPaths: [g, f1] })).id);
      assert.deepEqual(read.projectPaths.map((p, i) => `${p}=${read.vcs[i]}`).sort(), [`${f1}=none`, `${g}=git`].sort());
    } },
    { name: 'git on: memberWorkMode is git for a repo and folder for a Folder project', run: () => {
      assert.equal(memberWorkMode(g), 'git');
      assert.equal(memberWorkMode(f1), 'folder');
    } },
    { name: 'git on: an unregistered plain folder is refused, naming both ways in', run: async () => {
      await assert.rejects(() => createWorkspace({ name: 'Plain', projectPaths: [g, plain] }),
        (e) => e.code === 'BAD_REQUEST' && e.message === `member path is not a git repository or a registered project: ${plain}`);
    } },
    { name: 'git on: adding a Folder project to a workspace is accepted', run: async () => {
      const ws = await createWorkspace({ name: 'Grow', projectPaths: [g, f2] });
      assert.equal((await addWorkspaceMembers(ws.id, [f1])).projectPaths.length, 3);
    } },
    { name: 'git on: a Folder member only has to exist for a scan', run: () => {
      assert.deepEqual(scanMemberProblems([g, f1]), []);
    } },
    { name: 'git on: a registered Git project that lost its .git is refused as not a git repository', run: async () => {
      const lost = repo();
      await addProject({ name: 'Lost', path: lost });
      rmSync(join(lost, '.git'), { recursive: true, force: true });
      await assert.rejects(() => createWorkspace({ name: 'Lost', projectPaths: [g, lost] }),
        (e) => e.code === 'BAD_REQUEST' && e.message === `member path is not a git repository: ${lost}`);
    } },
  ]);
});

test('#693: a git-mode member inside another repository is refused, registered (a legacy row) or not', async () => {
  const g = repo(); const outer = repo();
  const sub = join(outer, 'svc'); mkdirSync(sub);
  await assert.rejects(() => createWorkspace({ name: 'Nested', projectPaths: [g, sub] }),
    (e) => e.code === 'BAD_REQUEST' && /^member .*svc is inside the git repository at /.test(e.message));
  // A Git row registered at the sub-folder before registration refused it (what 1.10.0 could store).
  const legacy = join(outer, 'legacy'); mkdirSync(legacy);
  getDb().prepare("INSERT INTO projects (key, name, path, created_at, vcs) VALUES ('legacy-0000a693', 'legacy693', ?, ?, 'git')").run(legacy, new Date().toISOString());
  await assert.rejects(() => createWorkspace({ name: 'Legacy', projectPaths: [g, legacy] }),
    (e) => e.code === 'BAD_REQUEST' && /^member .*legacy is inside the git repository at /.test(e.message));
});

test('no git on this machine: Folder and orphan Git projects join; an unregistered path is refused without blaming git', async (t) => {
  const f1 = folder('c'); const f2 = folder('d'); const orphan = repo(); const loose = repo();
  await addProject({ name: 'Notes C', path: f1 });
  await addProject({ name: 'Notes D', path: f2 });
  await addProject({ name: 'Orphan', path: orphan });            // stored kind Git: it has .git
  await withNoGit(t);
  await checkRows([
    { name: 'git off: two Folder projects make a workspace', run: async () => {
      assert.deepEqual((await readWorkspace((await createWorkspace({ name: 'Folders', projectPaths: [f1, f2] })).id)).vcs, ['none', 'none']);
    } },
    { name: 'git off: an orphan Git project joins and runs as a folder; its stored kind stays Git', run: async () => {
      const read = await readWorkspace((await createWorkspace({ name: 'Orphans', projectPaths: [orphan, f1] })).id);
      assert.equal(read.vcs[read.projectPaths.indexOf(orphan)], 'git');
      assert.equal(memberWorkMode(orphan), 'folder');
    } },
    { name: 'git off: an unregistered repository is refused as "not a registered project" — never "not a git repository"', run: () => {
      assert.throws(() => checkNewWorkspace({ name: 'Loose', projectPaths: [loose, f2] }),
        (e) => e.code === 'BAD_REQUEST' && e.message === `member path is not a registered project: ${loose}`);
    } },
    { name: 'git off: adding to a workspace refuses an unregistered repository as not registered and accepts a Folder project', run: async () => {
      const ws = await createWorkspace({ name: 'Grow off', projectPaths: [orphan, f2] });
      await assert.rejects(() => addWorkspaceMembers(ws.id, [loose]),
        (e) => e.code === 'BAD_REQUEST' && e.message === `member path is not a registered project: ${loose}`);
      assert.equal((await addWorkspaceMembers(ws.id, [f1])).projectPaths.length, 3);
    } },
    { name: 'git off: a scan only checks that each member exists', run: () => {
      const missing = join(f1, 'gone');
      assert.deepEqual(scanMemberProblems([f1, orphan, missing]), [`${missing} does not exist`]);
    } },
  ]);
});
