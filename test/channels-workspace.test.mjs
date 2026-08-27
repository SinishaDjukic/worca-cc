// test/channels-workspace.test.mjs
// The `workspace` channel arm (M3): a read-only metadata channel carrying the
// frozen description + member set, plus workspaceKey threading into the plan/review
// path allocators so a workspace run's unified artifacts route to the workspace
// store. Pure: the only IO is path STRINGS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posix } from './helpers/posix-path.mjs';
import {
  allocate, bindInputs, publish, legacyFields, CHANNEL_IDS,
} from '../src/core/channels.mjs';

const ALLOC = { projectDir: '/p', pipelineDir: '/pipe', baseName: 'feat', datePrefix: '03-06-26', cycle: 1 };
const WS_KEY = 'wks-demo-1a2b3c4d';

test('CHANNEL_IDS includes workspace (closed M3 set)', () => {
  assert.deepEqual([...CHANNEL_IDS].sort(),
    ['checklist', 'clarify', 'code', 'decomposition', 'plan', 'review', 'userPrompt', 'workspace']);
});

test('allocate(workspace): metadata handle pointing at workspace-description.md', () => {
  const h = allocate('workspace', { ...ALLOC, key: 'planner' });
  assert.equal(h.kind, 'metadata');
  assert.match(posix(h.path), /\/pipe\/workspace-description\.md$/);
});

test('allocate threads workspaceKey into the plan path (routes to the workspace store)', () => {
  const single = allocate('plan', { ...ALLOC, key: 'planner', cycle: 1 });
  const ws = allocate('plan', { ...ALLOC, key: 'planner', cycle: 1, workspaceKey: WS_KEY });
  assert.match(posix(single.path), /\/store\/[^/]+\/plans\/03-06-26-feat\.md$/, 'single-project routes by projectKey');
  assert.match(posix(ws.path), new RegExp(`/store/workspaces/${WS_KEY}/plans/03-06-26-feat\\.md$`),
    'workspace plan routes to the workspace store');
  assert.notEqual(single.path, ws.path);
});

test('allocate threads workspaceKey into the review path (md + json under the workspace store)', () => {
  const ws = allocate('review', { ...ALLOC, key: 'reviewer', workspaceKey: WS_KEY });
  assert.match(posix(ws.mdPath), new RegExp(`/store/workspaces/${WS_KEY}/reviews/03-06-26-feat-impl-review\\.md$`));
  // jsonPath lives in the pipeline dir (per-cycle), unaffected by the store root.
  assert.match(posix(ws.jsonPath), /\/pipe\/impl-review-cycle1\.json$/);
});

test('single-project allocate is byte-identical when no workspaceKey is present', () => {
  // Pin byte-identity: the M3 threading must not move any single-project path.
  const planner = allocate('plan', { ...ALLOC, key: 'planner', cycle: 1 });
  assert.match(posix(planner.path), /\/plans\/03-06-26-feat\.md$/);
  const rev = allocate('review', { ...ALLOC, key: 'reviewer' });
  assert.match(posix(rev.jsonPath), /\/impl-review-cycle1\.json$/);
  assert.match(rev.mdPath, /-feat-impl-review\.md$/);
});

test('bindInputs surfaces the workspace metadata channel', () => {
  const wsHandle = {
    kind: 'metadata',
    workspaceDescription: '# Workspace: Demo',
    projects: [{ projectKey: 'a-1', projectName: 'a' }],
  };
  const bus = { plan: { kind: 'artifact', path: '/x.md' }, workspace: wsHandle };
  const got = bindInputs(['plan', 'workspace'], [], bus);
  assert.equal(got.workspace, wsHandle, 'workspace channel is bound from the bus');
});

test('legacyFields exposes {workspace} on the ctx for a node that consumes it', () => {
  const wsHandle = {
    kind: 'metadata',
    workspaceDescription: '# Workspace: Demo',
    projects: [{ projectKey: 'a-1', projectName: 'a', worktreeDir: '/wt/a', checkpointRef: 'sha-a' }],
  };
  // A planner consuming userPrompt + workspace must see the workspace handle flattened
  // onto the legacy ctx so phases.mjs runners can read ctx.workspace.
  const fields = legacyFields(
    { key: 'planner' },
    { userPrompt: { answers: [] }, workspace: wsHandle },
    { plan: { path: '/v1.md' }, workspace: { kind: 'metadata', path: '/pipe/workspace-description.md' } },
    1, 'feat',
  );
  assert.equal(fields.workspace, wsHandle, 'planner ctx carries the workspace metadata');
});

test('legacyFields workspace exposure is absent for a single-project node', () => {
  const fields = legacyFields(
    { key: 'planner' },
    { userPrompt: { answers: [] } },
    { plan: { path: '/v1.md' } },
    1, 'feat',
  );
  assert.equal(fields.workspace, undefined, 'no workspace input -> no workspace field');
});

// ── §5.8: the workspace BUS channel keeps ABSOLUTE worktree paths ─────────────
// Relativization to `repos/<key>` happens only at RENDER time, in phases.mjs.
// resume() rehydrates member worktrees with existsSync(p.worktreeDir) straight off
// this channel and re-arms teardown from it, so a relative `repos/<key>` here would
// resolve against the SERVER PROCESS's cwd, return false, and hard-fail every
// workspace resume with `worktree missing`. This assertion exists so the natural
// "fix it at the source" refactor cannot land silently.
test('the workspace bus channel worktreeDir values stay ABSOLUTE (never repos/<key>)', async () => {
  const { createOrchestrator } = await import('../src/core/orchestrator.mjs');
  const orch = createOrchestrator({
    workspace: {
      id: 'wks-x', key: 'wks-x', name: 'X', description: '',
      projects: [
        { projectKey: 'a-00000001', projectName: 'a', projectDir: '/real/a' },
        { projectKey: 'b-00000002', projectName: 'b', projectDir: '/real/b' },
      ],
    },
    prompt: 'x', claude: { mock: true },
  });
  // Stand in for _setupRunRoot's registration on a DETACHED workspace run (the only
  // mode where a relative token exists at all).
  orch.runRootMode = 'detached';
  orch.runRoot = '/home/.worca-cc/runs/pid1';
  orch.workDirs.set('a-00000001', '/home/.worca-cc/runs/pid1/repos/a-00000001');
  orch.workDirs.set('b-00000002', '/home/.worca-cc/runs/pid1/repos/b-00000002');
  orch.checkpointRefs = { 'a-00000001': 'sha-a', 'b-00000002': 'sha-b' };

  const ch = orch._workspaceChannel();
  assert.equal(ch.kind, 'metadata');
  for (const p of ch.projects) {
    assert.ok(p.worktreeDir.startsWith('/'), `absolute worktreeDir: ${p.worktreeDir}`);
    assert.doesNotMatch(p.worktreeDir, /^repos\//, 'never the render-only relative token');
    assert.match(p.worktreeDir, new RegExp(`/repos/${p.projectKey}$`));
  }
  // The render-only token lives on the repos ctx, not on the channel.
  const repos = orch._reposCtx();
  assert.deepEqual(repos.map((r) => r.relDir), ['repos/a-00000001', 'repos/b-00000002']);
  assert.deepEqual(repos.map((r) => r.dir), [...orch.workDirs.values()], 'ctx dirs are absolute too');
  assert.deepEqual(repos.map((r) => r.checkpointRef), ['sha-a', 'sha-b']);
});

test('_reposCtx: relDir is null under legacy (the render-only token is detached-only)', async () => {
  const { createOrchestrator } = await import('../src/core/orchestrator.mjs');
  const orch = createOrchestrator({ projectDir: '/real/only', prompt: 'x', claude: { mock: true } });
  orch.runRootMode = 'legacy';
  const key = orch.members[0].projectKey;
  orch.workDirs.set(key, '/real/only/.worca-cc/worktrees/pid1');
  const [only] = orch._reposCtx();
  assert.equal(only.relDir, null, 'no relative token under legacy');
  assert.equal(only.dir, '/real/only/.worca-cc/worktrees/pid1');
  assert.equal(only.graphInstruction, '', 'single mode tolerates an empty instruction');
});

test('publish: a metadata workspace channel is never re-published (CONV-6 preserved)', () => {
  // The workspace channel is read-only metadata seeded once; publish must not fold a
  // node result onto it (it is never in produces for in-pipeline nodes at M3, but the
  // arm must be a no-op even if asked).
  const wsHandle = { kind: 'metadata', workspaceDescription: 'x' };
  const bus = { workspace: wsHandle };
  publish(['workspace'], { anything: true }, { workspace: { kind: 'metadata', path: '/p/desc.md' } }, bus);
  assert.equal(bus.workspace, wsHandle, 'workspace metadata is unchanged by publish');
});
