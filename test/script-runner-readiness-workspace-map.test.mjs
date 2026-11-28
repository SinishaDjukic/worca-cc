// test/script-runner-readiness-workspace-map.test.mjs — a workspace run's readiness view (api.readiness)
// carries the workspace's reviewed map at the top level (`workspaceMap`, beside `members`): the stored
// edges with the Map tab's overrides applied, the description and the merged graph file. Read in the parent.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { sampleMap, DISPLAYS } from './helpers/wsmap-stored.mjs';
import { runScriptExecution } from '../src/core/graph/script-runner.mjs';
import { normalizeScriptMeta } from '../src/shared/graph/script-meta.mjs';
import { workspaceStorePath } from '../src/core/store.mjs';
import { gitState } from '../src/core/git-available.mjs';
import {
  createWorkspace, readWorkspace, saveWorkspaceScanResult, setWorkspaceEdgeState, addWorkspaceManualEdge,
} from '../src/core/workspaces.mjs';

delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK;
useTempHome(after);
await gitState({ fresh: true });   // members are unregistered git repositories: createWorkspace needs git known
const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true, maxRetries: 3 }); });

const repo = () => { const d = templateRepo('rwmap', { branch: 'main', user: true, files: { 'CLAUDE.md': '# x\n' } }); scratch.push(d); return d; };
let seq = 0;

async function workspaceRun({ withMap }) {
  const a = repo(); const b = repo();
  const ws = await createWorkspace({ name: `Readiness WS ${++seq}`, projectPaths: [a, b] });
  const [ka, kb] = ws.projectKeys;
  let ids = null;
  if (withMap) {
    const sample = sampleMap({ keys: [ka, kb], names: ws.projectPaths.map((p) => basename(p)), name: ws.name });
    ids = sample.ids;
    await saveWorkspaceScanResult(ws.id, { map: sample.map, synthesis: sample.synthesis });
  }
  const { meta } = normalizeScriptMeta({ metaVersion: 2, key: 'probe', runtime: 'node', file: 'prog.mjs', inputs: [], outputs: [], readiness: true });
  const pipelineDir = tmp('rwmap-pipe-');
  const file = join(tmp('rwmap-prog-'), 'prog.mjs');
  writeFileSync(file, 'export default (api) => ({ summary: JSON.stringify({ keys: Object.keys(api.readiness.members || {}), workspaceMap: api.readiness.workspaceMap }) });\n');
  const ctx = {
    node: { id: 'n', kind: 'script', key: 'probe' }, executionId: 'x:n:1', ordinal: 1, cycle: 1, pipelineDir, pipelineId: 'p1',
    projectDir: a, runCtx: { pipelineDir, projectDir: a }, runRoot: tmp('rwmap-root-'), ports: { inputs: [], outputs: [] }, outputs: {},
    verdict: null, bindings: {}, trigger: {}, script: { meta, runtime: 'node', file, params: {}, timeoutMs: 30000 }, claudeOpts: {},
    workspace: { workspaceId: ws.id, workspaceName: ws.name,
      projects: [{ projectKey: ka, projectDir: a, worktreeDir: a }, { projectKey: kb, projectDir: b, worktreeDir: b }] },
    repos: [{ projectKey: ka, dir: a }, { projectKey: kb, dir: b }],
  };
  return { ws, ka, kb, ids, pipelineDir, run: async () => JSON.parse((await runScriptExecution(ctx)).summary) };
}

test('a workspace run\'s view carries the map\'s non-rejected edges with overrides applied', async () => {
  const { ws, ka, kb, ids, pipelineDir, run } = await workspaceRun({ withMap: true });
  await setWorkspaceEdgeState(ws.id, ids.http, 'rejected');
  await setWorkspaceEdgeState(ws.id, ids.topic, 'confirmed');
  await addWorkspaceManualEdge(ws.id, { from: kb, to: ka, kind: 'db', display: 'shared orders table' });

  const before = await run();
  assert.deepEqual(before.keys.sort(), [ka, kb].sort(), 'members stay beside the map');
  const wm = before.workspaceMap;
  assert.ok(wm, 'workspaceMap is present');
  const hows = wm.edges.map((e) => e.how);
  assert.equal(hows.includes(DISPLAYS.http), false, 'a rejected edge is left out');
  assert.ok(hows.includes(DISPLAYS.topic), 'a confirmed edge is in');
  assert.ok(hows.includes(DISPLAYS.pkg), 'an unreviewed edge is in');
  assert.equal(wm.edges.length, 3);
  const manual = wm.edges.find((e) => e.how === 'shared orders table');
  assert.deepEqual(manual, { from: kb, to: ka, kind: 'db', how: 'shared orders table', confidence: 'manual' });
  const topic = wm.edges.find((e) => e.how === DISPLAYS.topic);
  assert.deepEqual(topic, { from: ka, to: kb, kind: 'topic', how: DISPLAYS.topic, confidence: 'verified' });
  assert.equal(wm.description, (await readWorkspace(ws.id)).description);
  assert.equal(wm.graphPath, null, 'no merged graph file yet');

  const graph = join(workspaceStorePath(ws.id), 'workspace-graph.json');
  mkdirSync(workspaceStorePath(ws.id), { recursive: true });
  writeFileSync(graph, '{"nodes":[],"links":[]}\n');
  const snap = (await run()).workspaceMap.graphPath;
  assert.notEqual(snap, graph, 'graphPath points at the run\'s own copy, not the store');
  assert.ok(snap.startsWith(pipelineDir), 'the copy lives in the pipeline directory');
  assert.equal(readFileSync(snap, 'utf8'), '{"nodes":[],"links":[]}\n');
});

test('the copy is made once: a later Re-scan\'s graph does not reach a run already holding one', async () => {
  const { ws, pipelineDir, run } = await workspaceRun({ withMap: true });
  const graph = join(workspaceStorePath(ws.id), 'workspace-graph.json');
  mkdirSync(workspaceStorePath(ws.id), { recursive: true });
  writeFileSync(graph, '{"nodes":["old"],"links":[]}\n');
  const first = (await run()).workspaceMap.graphPath;
  writeFileSync(graph, '{"nodes":["new"],"links":[]}\n');   // a Re-scan replaced the stored graph mid-run
  const second = (await run()).workspaceMap.graphPath;
  assert.equal(second, first, 'the second build reuses the copy');
  assert.ok(first.startsWith(pipelineDir));
  assert.match(readFileSync(second, 'utf8'), /old/);
});

test('no graph in the store means no graphPath', async () => {
  const { run } = await workspaceRun({ withMap: true });
  assert.equal((await run()).workspaceMap.graphPath, null);
});

test('a workspace without a map has workspaceMap null', async () => {
  const { ka, kb, run } = await workspaceRun({ withMap: false });
  const v = await run();
  assert.deepEqual(v.keys.sort(), [ka, kb].sort());
  assert.equal(v.workspaceMap, null);
});
