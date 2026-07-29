// test/artifacts-store.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artifactPaths, ensureArtifactDirs, createPipeline, planPath, reviewPath, readStoreMeta } from '../src/core/artifacts.mjs';
import { projectKey, storeRoot, workspaceStorePath } from '../src/core/store.mjs';
import { _resetForTests, getDb } from '../src/core/db.mjs';

test('artifactPaths resolves into the store, not the project dir', async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-ah-'));
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-proj-'));
  const prev = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;
  try {
    const p = artifactPaths(proj);
    const expectRoot = join(storeRoot(), projectKey(proj));
    assert.equal(p.root, expectRoot);
    assert.equal(p.plans, join(expectRoot, 'plans'));
    assert.ok(!p.root.startsWith(proj), 'must NOT live under the project dir');
  } finally { if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev; }
});

test('ensureArtifactDirs creates dirs + writes+returns project meta once (store_meta)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-ah2-'));
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-proj2-'));
  const prev = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;
  _resetForTests(); // reopen the DB singleton against this temp home
  try {
    const p = await ensureArtifactDirs(proj);
    await stat(p.pipelines); // throws if missing
    assert.equal(p.meta.key, projectKey(proj), 'ensureArtifactDirs returns the meta object');
    // Meta now lives in the store_meta table, not a meta.json file.
    const onDisk = readStoreMeta(projectKey(proj));
    assert.equal(onDisk.key, projectKey(proj));
    assert.ok(onDisk.firstSeenAt);
    const first = onDisk.firstSeenAt;
    const p2 = await ensureArtifactDirs(proj); // re-run
    assert.equal(p2.meta.firstSeenAt, first, 'firstSeenAt is preserved on re-run');
  } finally {
    _resetForTests();
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});

test('createPipeline stamps projectKey + projectName into the pipelines row', async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-ah3-'));
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-proj3-'));
  const prev = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;
  _resetForTests();
  try {
    const { id } = await createPipeline(proj, { prompt: 'demo task', title: 'Demo' });
    // State now persists to the pipelines row (was state.json).
    const row = getDb().prepare('SELECT * FROM pipelines WHERE id = ?').get(id);
    assert.equal(row.project_key, projectKey(proj));
    // projectName lives in store_meta (not a pipelines column).
    assert.ok(typeof readStoreMeta(projectKey(proj)).name === 'string' && readStoreMeta(projectKey(proj)).name.length > 0);
    // Back-compat: a single-project pipeline has NO workspace discriminator/fields.
    assert.equal(row.target, 'project');
    assert.equal(row.workspace_key, null);
    assert.equal(row.workspace_meta, null);
  } finally {
    _resetForTests();
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});

// ---- Workspace-keyed artifact routing (opt-in; single-project paths unchanged) ----

const WKEY = 'wks-demo-12345678';

test('artifactPaths routes to store/workspaces/<key> when a workspaceKey is given', async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-wsp-'));
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-wsp-proj-'));
  const prev = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;
  try {
    const ws = artifactPaths(proj, WKEY);
    const expectRoot = workspaceStorePath(WKEY);
    assert.equal(ws.root, expectRoot);
    assert.equal(ws.plans, join(expectRoot, 'plans'));
    assert.equal(ws.reviews, join(expectRoot, 'reviews'));
    assert.equal(ws.pipelines, join(expectRoot, 'pipelines'));
    // Absent the key, byte-identical to the legacy project path.
    const proj2 = artifactPaths(proj);
    assert.equal(proj2.root, join(storeRoot(), projectKey(proj)));
    assert.notEqual(ws.root, proj2.root);
  } finally { if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev; }
});

test('planPath/reviewPath thread the optional workspaceKey into the workspace store', async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-wpp-'));
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-wpp-proj-'));
  const prev = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;
  try {
    const pp = planPath(proj, 'feat', 1, '03-06-26', WKEY);
    assert.equal(pp, join(workspaceStorePath(WKEY), 'plans', '03-06-26-feat.md'));
    const rp = reviewPath(proj, 'feat', '03-06-26', 'impl-review', WKEY);
    assert.equal(rp, join(workspaceStorePath(WKEY), 'reviews', '03-06-26-feat-impl-review.md'));
    // Legacy single-project signatures still resolve under the project key.
    assert.match(planPath(proj, 'feat', 1, '03-06-26'), new RegExp(`${projectKey(proj)}/plans/03-06-26-feat\\.md$`));
  } finally { if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev; }
});

test('ensureArtifactDirs writes the workspace meta shape under store/workspaces/<key> (store_meta)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-wmeta-'));
  const a = await mkdtemp(join(tmpdir(), 'worca-cc-wmeta-a-'));
  const b = await mkdtemp(join(tmpdir(), 'worca-cc-wmeta-b-'));
  const prev = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;
  _resetForTests(); // reopen the DB singleton against this temp home
  try {
    const p = await ensureArtifactDirs(a, WKEY, {
      workspaceId: WKEY,
      workspaceName: 'Demo WS',
      projects: [
        { projectKey: projectKey(a), projectDir: a, projectName: 'a' },
        { projectKey: projectKey(b), projectDir: b, projectName: 'b' },
      ],
    });
    assert.equal(p.root, workspaceStorePath(WKEY));
    await stat(p.pipelines); // throws if missing
    // Workspace meta now lives in store_meta keyed by the workspace key.
    const meta = readStoreMeta(WKEY);
    assert.equal(meta.key, WKEY);
    assert.equal(meta.id, WKEY);
    assert.equal(meta.name, 'Demo WS');
    assert.ok(Array.isArray(meta.projectKeys) && meta.projectKeys.length === 2);
    assert.ok(Array.isArray(meta.projectPaths) && meta.projectPaths.length === 2);
    assert.ok(meta.firstSeenAt);
    // The project-shape `path` field must NOT leak into a workspace meta.
    assert.equal(meta.path, undefined);
  } finally {
    _resetForTests();
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});

test('createPipeline (workspace opts) stamps the workspace_meta superset + workspace-description.md', async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-wpipe-'));
  const a = await mkdtemp(join(tmpdir(), 'worca-cc-wpipe-a-'));
  const b = await mkdtemp(join(tmpdir(), 'worca-cc-wpipe-b-'));
  const prev = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;
  _resetForTests();
  try {
    const projects = [
      { projectKey: projectKey(a), projectDir: a, projectName: 'a' },
      { projectKey: projectKey(b), projectDir: b, projectName: 'b' },
    ].sort((x, y) => (x.projectKey < y.projectKey ? -1 : 1));
    const { id, dir } = await createPipeline(projects[0].projectDir, {
      prompt: 'add pagination',
      title: 'add pagination',
      workspaceKey: WKEY,
      workspaceId: WKEY,
      workspaceName: 'Demo WS',
      workspaceDescription: '# Workspace: Demo\nlots of detail',
      projects,
    });
    // Lives in the workspace store, not under any project key.
    assert.ok(dir.startsWith(join(workspaceStorePath(WKEY), 'pipelines')), 'pipeline dir under workspace store');

    // State now persists to the pipelines row; the workspace superset collapses
    // into the workspace_meta JSON column.
    const row = getDb().prepare('SELECT * FROM pipelines WHERE id = ?').get(id);
    assert.equal(row.target, 'workspace');
    assert.equal(row.workspace_key, WKEY);
    const wm = JSON.parse(row.workspace_meta);
    assert.equal(wm.workspaceId, WKEY);
    assert.equal(wm.workspaceName, 'Demo WS');
    assert.equal(wm.workspaceDescription, '# Workspace: Demo\nlots of detail');
    assert.deepEqual(wm.projectKeys, projects.map((p) => p.projectKey));
    assert.equal(wm.projects.length, 2);
    assert.deepEqual(wm.checkpointRefs, {});
    assert.deepEqual(wm.branches, {});

    // Frozen description snapshot file present and matching (still written for humans).
    const wd = await readFile(join(dir, 'workspace-description.md'), 'utf8');
    assert.equal(wd, '# Workspace: Demo\nlots of detail');
  } finally {
    _resetForTests();
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});

test('createPipeline freezes the FULL description verbatim (no cap)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-wcap-'));
  const a = await mkdtemp(join(tmpdir(), 'worca-cc-wcap-a-'));
  const b = await mkdtemp(join(tmpdir(), 'worca-cc-wcap-b-'));
  const prev = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;
  _resetForTests();
  try {
    const big = 'x'.repeat(5000);
    const projects = [
      { projectKey: projectKey(a), projectDir: a, projectName: 'a' },
      { projectKey: projectKey(b), projectDir: b, projectName: 'b' },
    ].sort((x, y) => (x.projectKey < y.projectKey ? -1 : 1));
    const { id, dir } = await createPipeline(projects[0].projectDir, {
      prompt: 'task', workspaceKey: WKEY, workspaceId: WKEY, workspaceName: 'Cap',
      workspaceDescription: big, projects,
    });
    const wm = JSON.parse(getDb().prepare('SELECT workspace_meta FROM pipelines WHERE id = ?').get(id).workspace_meta);
    assert.equal(wm.workspaceDescription.length, 5000, 'frozen copy stores the full text');
    assert.ok(!wm.workspaceDescription.endsWith('…'), 'no truncation ellipsis');
    const wd = await readFile(join(dir, 'workspace-description.md'), 'utf8');
    assert.equal(wd.length, 5000, 'on-disk snapshot is the full text');
  } finally {
    _resetForTests();
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});
