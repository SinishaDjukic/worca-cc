// test/wsmap-scan-readonly-members.test.mjs
// A Workspace scan is READ-ONLY (scan D5): its setup never `git init`s or commits a member. A member
// that is not the top folder of its own git repository (a folder inside a monorepo), or a repository
// with no commit, stops the scan at setup with the read-only error — on the first run and again when
// the paused scan resumes (the setup replay) — and leaves every tree byte-identical. Any other
// workspace run still gets its own repository there (C2). The finalize files the workspace under the
// id the launch froze (scan D3): a member whose repository root moved while the scan ran fails the
// save instead of creating the workspace under another id. The members worca users really have — a
// linked worktree and a submodule checkout (their `.git` is a FILE), a path reached through a symlink
// — pass the launch check and the setup, and a scan over them runs to done without a write.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { createOrchestratorFor } from '../src/core/engine-select.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { projectKey } from '../src/core/store.mjs';
import { workspaceKey, readWorkspace } from '../src/core/workspaces.mjs';
import * as workspaces from '../src/core/workspaces.mjs';
import { WORKSPACE_SCAN_WORKFLOW_ID } from '../src/core/graph/builtin-workflows.mjs';
import { finalizeWorkspaceScan, WORKSPACE_SCAN_OUTPUT_FILE } from '../src/core/workspace-scan-run.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
const prevRunRoot = process.env.WORCA_RUN_ROOT;
beforeEach(() => { process.env.WORCA_RUN_ROOT = 'detached'; });
after(() => {
  if (prevRunRoot === undefined) delete process.env.WORCA_RUN_ROOT;
  else process.env.WORCA_RUN_ROOT = prevRunRoot;
});
const created = [];
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true, maxRetries: 3 }))));

const git = (dir, ...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
/** A throwaway repo holding `files` (posix relative paths), committed unless `commit` is false. */
async function repo(label, files, { commit = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), `worca-cc-wsro-${label}-`));
  created.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(dir, ...rel.split('/'));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, text);
  }
  if (commit) { git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'init'); }
  return dir;
}
/** Everything a scan could change in a tree: each file's bytes (a `.git` only as present), the
 *  status, every commit on every ref, every ref. `.git` internals are not hashed: git status may
 *  refresh the index's stat cache. */
function treeState(dir) {
  const files = [];
  const walk = (abs, rel) => {
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.name === '.git') { files.push(`${rel}.git`); continue; }
      if (e.isDirectory()) walk(join(abs, e.name), `${rel}${e.name}/`);
      else files.push(`${rel}${e.name} ${createHash('sha1').update(readFileSync(join(abs, e.name))).digest('hex')}`);
    }
  };
  walk(dir, '');
  const out = (...args) => git(dir, ...args).stdout;
  return { files: files.sort(), status: out('status', '--porcelain=v1', '--untracked-files=all'),
    log: out('log', '--all', '--format=%H %s'), refs: out('for-each-ref', '--format=%(refname) %(objectname)') };
}
/** The opts the server builds for a scan (scan D3): the synthetic target keyed by workspaceKey. */
function scanOpts(dirs, name, workflowId = WORKSPACE_SCAN_WORKFLOW_ID) {
  const id = workspaceKey({ name, projectPaths: dirs });
  const projects = dirs
    .map((d) => ({ projectDir: d, projectKey: projectKey(d), projectName: basename(d), branch: { source: 'main' } }))
    .sort((a, b) => (a.projectKey < b.projectKey ? -1 : a.projectKey > b.projectKey ? 1 : 0));
  return {
    workspace: { id, key: id, name, description: '', projects },
    branch: { source: 'main' }, workflowId, prompt: `Scan the interconnections of the workspace "${name}".`, auto: true, claude: { mock: true },
  };
}

test('a member inside another repository stops the scan at setup: no repository created, both trees byte-identical, the resume refuses again', async () => {
  const mono = await repo('mono', { 'README.md': '# mono\n', 'packages/api/package.json': '{"name":"@acme/api"}\n', 'packages/api/src/server.js': "app.get('/users/:id', h);\n" });
  const sub = join(mono, 'packages', 'api');
  const other = await repo('other', { 'package.json': '{"name":"other"}\n' });
  const before = [treeState(mono), treeState(other)];
  const opts = scanOpts([sub, other], 'Nested Scan');
  const orch = createOrchestrator(opts);
  const res = await orch.run();
  assert.equal(res.status, 'paused', JSON.stringify(res));
  assert.match(orch.getState().pauseDetail || '', /read-only workspace scan: .*api is not its own git repository/);
  assert.ok(!existsSync(join(sub, '.git')), 'no repository was created inside the monorepo');
  assert.deepEqual([treeState(mono), treeState(other)], before, 'both trees byte-identical');
  assert.equal(await readWorkspace(opts.workspace.id), null, 'nothing saved');

  // The paused scan resumes into the setup replay (_replaySetup), which refuses the same way.
  const saved = readPipelineForResume(orch.state.id);
  const meta = JSON.parse(saved.row.workspace_meta);
  const again = await createOrchestratorFor({
    projectDir: meta.projects[0].projectDir,
    workspace: { id: meta.workspaceId, key: saved.row.workspace_key, name: meta.workspaceName, description: '', projects: meta.projects },
    claude: { mock: true }, auto: true, resume: saved,
  });
  const res2 = await again.resume();
  assert.equal(res2.status, 'paused', JSON.stringify(res2));
  assert.match(again.getState().pauseDetail || '', /read-only workspace scan: .*api is not its own git repository/);
  assert.ok(!existsSync(join(sub, '.git')), 'the resume created no repository either');
  assert.deepEqual([treeState(mono), treeState(other)], before, 'still byte-identical after the resume');
});

test('a repository with no commit stops the scan at setup: nothing is committed, untracked files stay untracked', async () => {
  const fresh = await repo('fresh', { 'package.json': '{"name":"fresh"}\n', 'notes/private-todo.txt': 'my notes\n' }, { commit: false });
  const other = await repo('other', { 'package.json': '{"name":"other"}\n' });
  const before = [treeState(fresh), treeState(other)];
  const orch = createOrchestrator(scanOpts([fresh, other], 'Fresh Scan'));
  const res = await orch.run();
  assert.equal(res.status, 'paused', JSON.stringify(res));
  assert.match(orch.getState().pauseDetail || '', /read-only workspace scan: .*fresh-.* has no commit/);
  assert.equal(git(fresh, 'rev-parse', '--verify', '-q', 'HEAD').status, 1, 'still no commit');
  assert.deepEqual([treeState(fresh), treeState(other)], before, 'both trees byte-identical');
});

test('the setup check is scan-only: another workspace run still gives a nested member its own repository (C2)', async () => {
  const mono = await repo('mono', { 'README.md': '# mono\n', 'svc/app.txt': 'app\n' });
  const sub = join(mono, 'svc');
  const other = await repo('other', { 'a.txt': 'a\n' });
  const scan = createOrchestrator(scanOpts([sub, other], 'Scan Only'));
  await assert.rejects(() => scan._ensureGitCheckpointFor(sub), /read-only workspace scan: .*svc is not its own git repository/);
  assert.ok(!existsSync(join(sub, '.git')));
  const normal = createOrchestrator(scanOpts([sub, other], 'Normal Run', 'wf_default'));
  assert.match(await normal._ensureGitCheckpointFor(sub), /^[0-9a-f]{40}$/);
  assert.ok(existsSync(join(sub, '.git')), 'C2: a non-scan run isolates the nested member in its own repository');
});

test('finalize files the workspace under the frozen id: a member whose repository root moved fails the save and creates nothing', async () => {
  const mono = await repo('mono', { 'README.md': '# mono\n', 'svc/app.txt': 'app\n' });
  const sub = join(mono, 'svc');
  const other = await repo('other', { 'a.txt': 'a\n' });
  const frozen = workspaceKey({ name: 'Moved Root', projectPaths: [sub, other] });   // the launch: svc keys under the monorepo root
  git(sub, 'init', '-q', '-b', 'main');                                              // ...then svc became its own repository
  git(sub, 'config', 'user.email', 't@t');
  git(sub, 'config', 'user.name', 't');
  git(sub, 'add', '-A');
  git(sub, 'commit', '-qm', 'own');
  const now = workspaceKey({ name: 'Moved Root', projectPaths: [sub, other] });
  assert.notEqual(now, frozen, 'precondition: the project set keys differently now');
  const pipelineDir = await mkdtemp(join(tmpdir(), 'worca-cc-wsro-run-'));
  created.push(pipelineDir);
  await writeFile(join(pipelineDir, WORKSPACE_SCAN_OUTPUT_FILE), '# Workspace: Moved Root\n## Overview\nTwo services.\n');
  const res = await finalizeWorkspaceScan({ workspaceId: frozen, name: 'Moved Root', projectPaths: [sub, other], pipelineDir });
  assert.equal(res.outcome, 'failed', JSON.stringify(res));
  assert.equal(res.code, 'ID_MISMATCH');
  assert.equal(res.workspaceId, frozen);
  assert.ok(res.error.includes(frozen) && res.error.includes(now), res.error);
  assert.equal(await readWorkspace(frozen), null);
  assert.equal(await readWorkspace(now), null, 'never created under another id');
});

test('members worca users really have pass both checks: a linked worktree and a submodule (.git is a file), a path through a symlink — setup proceeds, the scan ends done, nothing written', async () => {
  const { scanMemberProblems } = workspaces;
  assert.equal(typeof scanMemberProblems, 'function', 'workspaces.mjs exports scanMemberProblems');
  const main = await repo('main', { 'package.json': '{"name":"main"}\n' });
  const wtParent = await mkdtemp(join(tmpdir(), 'worca-cc-wsro-wt-'));
  created.push(wtParent);
  const wt = join(wtParent, 'wt');
  git(main, 'worktree', 'add', '-q', '-b', 'feature', wt);
  const target = await repo('target', { 'a.txt': 'a\n' });
  const linkParent = await mkdtemp(join(tmpdir(), 'worca-cc-wsro-link-'));
  created.push(linkParent);
  const link = join(linkParent, 'link');
  await symlink(target, link, 'junction');   // Windows: a junction (no privilege needed); the type is ignored elsewhere
  const lib = await repo('lib', { 'lib.txt': 'lib\n' });
  const sup = await repo('super', { 'README.md': '# super\n' });
  git(sup, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', pathToFileURL(lib).href, 'vendor/lib');
  git(sup, 'commit', '-qm', 'add lib');
  const sub = join(sup, 'vendor', 'lib');
  assert.ok(statSync(join(wt, '.git')).isFile() && statSync(join(sub, '.git')).isFile() && lstatSync(link).isSymbolicLink(), 'precondition: two .git files and a link');
  const members = [wt, link, sub];
  assert.deepEqual(scanMemberProblems(members), [], 'the launch check accepts all three');
  const trees = [main, wt, target, sup, sub];
  const before = trees.map((d) => treeState(d));
  const scan = createOrchestrator(scanOpts(members, 'Real Members'));
  for (const dir of members) {
    assert.equal(await scan._ensureGitCheckpointFor(dir), git(dir, 'rev-parse', 'HEAD').stdout.trim(), `setup proceeds on ${basename(dir)}'s own HEAD`);
  }
  const res = await scan.run();
  assert.equal(res.status, 'done', JSON.stringify({ res, pauseDetail: scan.getState().pauseDetail }));
  // A failed finalize (ID_MISMATCH included) also ends the run `done`: the workspace must really be saved.
  assert.equal(scan.getState().workspaceScan?.outcome, 'created', JSON.stringify(scan.getState().workspaceScan));
  assert.deepEqual(trees.map((d) => treeState(d)), before, 'every tree byte-identical after the scan');
});
