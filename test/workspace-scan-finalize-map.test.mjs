// test/workspace-scan-finalize-map.test.mjs
// finalizeWorkspaceScan with the scan's structured outputs (workspace-map.json + synthesis.json
// in the run folder): the map is stored, the description is re-rendered with the workspace's
// stored overrides (they survive every re-scan), the synthesis is stored redacted (D21), the
// merged graph is copied into the workspace store (never through a symlink; written aside and
// renamed, with a direct-copy fallback) and named on the description's last line; without a map
// it behaves as before.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rename, rm, symlink, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { sampleMap, DISPLAYS } from './helpers/wsmap-stored.mjs';
import { projectKey, workspaceStorePath } from '../src/core/store.mjs';
import {
  createWorkspace, readWorkspace, workspaceKey, updateWorkspace, readWorkspaceMap,
  setWorkspaceEdgeState, addWorkspaceManualEdge,
} from '../src/core/workspaces.mjs';
import {
  finalizeWorkspaceScan, readScanMap, adoptGraphFile, WORKSPACE_SCAN_OUTPUT_FILE, WORKSPACE_MAP_FILE,
  WORKSPACE_SYNTHESIS_FILE, WORKSPACE_GRAPH_FILE,
} from '../src/core/workspace-scan-run.mjs';
import { renderWorkspaceDescription } from '../src/shared/workspace-map/render.mjs';

useTempHome(after);
const created = [];
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true, maxRetries: 3 }))));

async function freshRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wsmap-'));
  created.push(dir);
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'README.md'), '# hi\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
  return dir;
}
/** Member keys + names exactly as the workspace will list them (sorted by projectKey). */
function membersOf(paths) {
  const sorted = [...paths].sort((x, y) => (projectKey(x) < projectKey(y) ? -1 : 1));
  return { keys: sorted.map((p) => projectKey(p)), names: sorted.map((p) => basename(p)) };
}
/** A run folder holding what a v3 scan writes: the render's markdown (rendered WITHOUT
 *  overrides, as the render script does), the map, the synthesis, optionally the merged graph. */
async function runFolder({ name, map, synthesis, graphJson = null, markdown = true }) {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wsmap-pl-'));
  created.push(dir);
  if (markdown) await writeFile(join(dir, WORKSPACE_SCAN_OUTPUT_FILE), renderWorkspaceDescription({ name, map, synthesis, budget: 300 }));
  if (map) await writeFile(join(dir, WORKSPACE_MAP_FILE), JSON.stringify(map));
  if (synthesis) await writeFile(join(dir, WORKSPACE_SYNTHESIS_FILE), JSON.stringify(synthesis));
  if (graphJson) await writeFile(join(dir, 'workspace-graph.json'), graphJson);
  return dir;
}

test('a first scan with a map creates the workspace and stores map + synthesis, origin generated', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const { keys, names } = membersOf([a, b]);
  const { map, synthesis } = sampleMap({ keys, names, name: 'Mapped' });
  const id = workspaceKey({ name: 'Mapped', projectPaths: [a, b] });
  const res = await finalizeWorkspaceScan({ workspaceId: id, name: 'Mapped', projectPaths: [a, b], pipelineDir: await runFolder({ name: 'Mapped', map, synthesis }) });
  assert.deepEqual(res, { outcome: 'created', workspaceId: id });
  const stored = await readWorkspaceMap(id);
  assert.deepEqual(stored.map, map);
  assert.equal(stored.synthesis.overview, synthesis.overview);
  assert.equal(stored.descriptionOrigin, 'generated');
  const ws = await readWorkspace(id);
  for (const d of Object.values(DISPLAYS)) assert.ok(ws.description.includes(d), d);
  assert.equal(ws.mapSummary.edges, 3);
});

test('a map without workspace-scan.md still saves (the description is rendered from the map)', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const { keys, names } = membersOf([a, b]);
  const { map, synthesis } = sampleMap({ keys, names, name: 'No Markdown' });
  const id = workspaceKey({ name: 'No Markdown', projectPaths: [a, b] });
  const res = await finalizeWorkspaceScan({ workspaceId: id, name: 'No Markdown', projectPaths: [a, b], pipelineDir: await runFolder({ name: 'No Markdown', map, synthesis, markdown: false }) });
  assert.equal(res.outcome, 'created');
  assert.match((await readWorkspace(id)).description, /^# Workspace: No Markdown/);
});

test('a re-scan keeps the overrides and re-applies them: a rejected edge stays out of the new description', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = await createWorkspace({ name: 'Rescan Map', projectPaths: [a, b] });
  const { map, synthesis, ids } = sampleMap({ keys: ws.projectKeys, names: ws.projectPaths.map((p) => basename(p)), name: ws.name });
  await finalizeWorkspaceScan({ workspaceId: ws.id, name: ws.name, projectPaths: [a, b], pipelineDir: await runFolder({ name: ws.name, map, synthesis }) });
  await setWorkspaceEdgeState(ws.id, ids.http, 'rejected');
  const manual = await addWorkspaceManualEdge(ws.id, { from: ws.projectKeys[1], to: ws.projectKeys[0], kind: 'db', display: 'table zz_audit' });

  // The next scan finds the same edges; its markdown (rendered without overrides) still lists the rejected one.
  const folder = await runFolder({ name: ws.name, map: { ...map, runId: 'run00002' }, synthesis });
  assert.ok((await readFile(join(folder, WORKSPACE_SCAN_OUTPUT_FILE), 'utf8')).includes(DISPLAYS.http), 'precondition');
  const res = await finalizeWorkspaceScan({ workspaceId: ws.id, name: ws.name, projectPaths: [a, b], pipelineDir: folder });
  assert.deepEqual(res, { outcome: 'updated', workspaceId: ws.id });
  const stored = await readWorkspaceMap(ws.id);
  assert.equal(stored.map.runId, 'run00002');
  assert.equal(stored.overrides.edges[ids.http].state, 'rejected', 'finalize never touches the overrides');
  assert.equal(stored.overrides.manual[0].id, manual.edge.id);
  const text = (await readWorkspace(ws.id)).description;
  assert.ok(!text.includes(DISPLAYS.http), 'the rejected edge is re-applied');
  assert.ok(text.includes('table zz_audit'), 'the manual edge is re-applied');
});

test('a re-scan replaces a hand-edited description (D7) and marks it generated again', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = await createWorkspace({ name: 'Hand Edit', projectPaths: [a, b] });
  const { map, synthesis } = sampleMap({ keys: ws.projectKeys, names: ws.projectPaths.map((p) => basename(p)), name: ws.name });
  await updateWorkspace(ws.id, { description: 'my own words' });
  assert.equal((await readWorkspaceMap(ws.id)).descriptionOrigin, 'edited');
  await finalizeWorkspaceScan({ workspaceId: ws.id, name: ws.name, projectPaths: [a, b], pipelineDir: await runFolder({ name: ws.name, map, synthesis }) });
  const after_ = await readWorkspace(ws.id);
  assert.equal(after_.descriptionOrigin, 'generated');
  assert.ok(after_.description.includes(DISPLAYS.topic));
});

test('the merged graph is copied into the workspace store and named on the description\'s last line', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = await createWorkspace({ name: 'Graphed', projectPaths: [a, b] });
  const graph = { mode: 'full', file: 'workspace-graph.json', nodes: 4, bridges: 1 };
  const { map, synthesis } = sampleMap({ keys: ws.projectKeys, names: ws.projectPaths.map((p) => basename(p)), name: ws.name, graph });
  const body = JSON.stringify({ nodes: [{ id: 'a::x' }], links: [] });
  await finalizeWorkspaceScan({ workspaceId: ws.id, name: ws.name, projectPaths: [a, b], pipelineDir: await runFolder({ name: ws.name, map, synthesis, graphJson: body }) });
  const dest = join(workspaceStorePath(ws.id), WORKSPACE_GRAPH_FILE);
  assert.equal(await readFile(dest, 'utf8'), body);
  assert.equal(existsSync(`${dest}.tmp`), false, 'the temp copy never outlives the call');
  const stored = await readWorkspaceMap(ws.id);
  assert.deepEqual(stored.map.graph, { ...graph, file: dest });
  const lines = (await readWorkspace(ws.id)).description.trimEnd().split(/\r?\n/);
  assert.equal(lines.at(-1), `Cross-project graph: ${dest} — graphify query "<question>" --graph "${dest}"`);

  // A re-scan whose graph file went missing: no line, file null, mode kept, the stale copy removed.
  await finalizeWorkspaceScan({ workspaceId: ws.id, name: ws.name, projectPaths: [a, b], pipelineDir: await runFolder({ name: ws.name, map, synthesis }) });
  const again = await readWorkspaceMap(ws.id);
  assert.deepEqual(again.map.graph, { ...graph, file: null });
  assert.doesNotMatch((await readWorkspace(ws.id)).description, /Cross-project graph:/);
  assert.equal(existsSync(dest), false);
});

test('a graph file name that is a path is never followed', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = await createWorkspace({ name: 'Traversal', projectPaths: [a, b] });
  const outside = await mkdtemp(join(tmpdir(), 'worca-cc-wsmap-out-'));
  created.push(outside);
  await writeFile(join(outside, 'secret.json'), '{"secret":true}');
  const folder = await runFolder({ name: ws.name, map: null, synthesis: null, markdown: false });
  const rel = join('..', basename(outside), 'secret.json');
  const { map, synthesis } = sampleMap({ keys: ws.projectKeys, name: ws.name, graph: { mode: 'full', file: rel, nodes: 1, bridges: 0 } });
  await writeFile(join(folder, WORKSPACE_MAP_FILE), JSON.stringify(map));
  await writeFile(join(folder, WORKSPACE_SYNTHESIS_FILE), JSON.stringify(synthesis));
  await finalizeWorkspaceScan({ workspaceId: ws.id, name: ws.name, projectPaths: [a, b], pipelineDir: folder });
  assert.equal((await readWorkspaceMap(ws.id)).map.graph.file, null);
  assert.equal(existsSync(join(workspaceStorePath(ws.id), WORKSPACE_GRAPH_FILE)), false);
});

test('a graph file that is a symlink is never followed', async (t) => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = await createWorkspace({ name: 'Symlinked', projectPaths: [a, b] });
  const outside = await mkdtemp(join(tmpdir(), 'worca-cc-wsmap-out-'));
  created.push(outside);
  await writeFile(join(outside, 'secret.json'), '{"secret":true}');
  const graph = { mode: 'full', file: WORKSPACE_GRAPH_FILE, nodes: 1, bridges: 0 };
  const { map, synthesis } = sampleMap({ keys: ws.projectKeys, name: ws.name, graph });
  const folder = await runFolder({ name: ws.name, map, synthesis });
  try { await symlink(join(outside, 'secret.json'), join(folder, WORKSPACE_GRAPH_FILE)); } catch { t.skip('symlinks need privileges here'); return; }
  await finalizeWorkspaceScan({ workspaceId: ws.id, name: ws.name, projectPaths: [a, b], pipelineDir: folder });
  assert.equal((await readWorkspaceMap(ws.id)).map.graph.file, null);
  assert.equal(existsSync(join(workspaceStorePath(ws.id), WORKSPACE_GRAPH_FILE)), false);
});

test('the graph copy is written aside and renamed; a refused rename falls back to a direct copy; a failed copy leaves no graph', async () => {
  const pipelineDir = await mkdtemp(join(tmpdir(), 'worca-cc-wsmap-pl-'));
  created.push(pipelineDir);
  const body = '{"nodes":[],"links":[]}';
  await writeFile(join(pipelineDir, WORKSPACE_GRAPH_FILE), body);
  const map = { members: [], edges: [], graph: { mode: 'full', file: WORKSPACE_GRAPH_FILE, nodes: 0, bridges: 0 } };
  const storeDir = async () => {
    const d = await mkdtemp(join(tmpdir(), 'worca-cc-wsmap-st-'));
    created.push(d);
    return join(d, 'ws');
  };

  // The normal path: a copy beside the old one, renamed over it — a reader never sees half a file.
  const normal = await storeDir();
  const renames = [];
  const out = await adoptGraphFile(map, {
    pipelineDir, storeDir: normal, renameFile: async (from, to) => { renames.push([from, to]); await rename(from, to); },
  });
  const dest = join(normal, WORKSPACE_GRAPH_FILE);
  assert.deepEqual(renames, [[`${dest}.tmp`, dest]]);
  assert.equal(out.graph.file, dest);
  assert.equal(await readFile(dest, 'utf8'), body);

  // A reader holds the old copy open (Windows refuses the rename): a direct copy still lands.
  const held = await storeDir();
  const refuse = async () => { throw Object.assign(new Error('resource busy'), { code: 'EBUSY' }); };
  const fallback = await adoptGraphFile(map, { pipelineDir, storeDir: held, renameFile: refuse });
  const heldDest = join(held, WORKSPACE_GRAPH_FILE);
  assert.equal(fallback.graph.file, heldDest);
  assert.equal(await readFile(heldDest, 'utf8'), body);
  assert.equal(existsSync(`${heldDest}.tmp`), false, 'the temp copy never outlives the call');

  // Nothing can be written (a directory sits where the copy goes): no throw, no graph, mode kept.
  const blocked = await storeDir();
  await mkdir(join(blocked, WORKSPACE_GRAPH_FILE), { recursive: true });
  const none = await adoptGraphFile(map, { pipelineDir, storeDir: blocked });
  assert.deepEqual(none.graph, { ...map.graph, file: null });
  assert.equal(existsSync(join(blocked, `${WORKSPACE_GRAPH_FILE}.tmp`)), false);
});

test('readScanMap tolerates a missing run folder or a missing or broken map / synthesis', async () => {
  const empty = await runFolder({ name: 'x', map: null, synthesis: null, markdown: false });
  assert.equal(await readScanMap(empty), null);
  assert.equal(await readScanMap(undefined), null, 'no run folder: no map, never a throw');
  await writeFile(join(empty, WORKSPACE_MAP_FILE), '{"members": [');
  assert.equal(await readScanMap(empty), null);
  await writeFile(join(empty, WORKSPACE_MAP_FILE), JSON.stringify({ members: [], edges: [] }));
  await writeFile(join(empty, WORKSPACE_SYNTHESIS_FILE), 'nope');
  assert.deepEqual(await readScanMap(empty), { map: { members: [], edges: [] }, synthesis: null });
});

test('without a map finalize behaves as before: the markdown is saved (marked generated); nothing -> failed', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = await createWorkspace({ name: 'Prose Scan', projectPaths: [a, b], description: 'old' });
  const folder = await runFolder({ name: ws.name, map: null, synthesis: null, markdown: false });
  await writeFile(join(folder, WORKSPACE_SCAN_OUTPUT_FILE), '# Workspace: Prose Scan\nprose\n');
  assert.equal((await finalizeWorkspaceScan({ workspaceId: ws.id, name: ws.name, projectPaths: [a, b], pipelineDir: folder })).outcome, 'updated');
  const after_ = await readWorkspace(ws.id);
  assert.equal(after_.description, '# Workspace: Prose Scan\nprose');
  assert.equal(after_.descriptionOrigin, 'generated');
  assert.equal(after_.mapSummary, null);
  const none = await runFolder({ name: 'x', map: null, synthesis: null, markdown: false });
  const failed = await finalizeWorkspaceScan({ workspaceId: ws.id, name: ws.name, projectPaths: [a, b], pipelineDir: none });
  assert.equal(failed.outcome, 'failed');
  assert.match(failed.error, /no description/);
  const noFolder = await finalizeWorkspaceScan({ workspaceId: ws.id, name: ws.name, projectPaths: [a, b], pipelineDir: undefined });
  assert.equal(noFolder.outcome, 'failed', 'never a throw, even without a run folder');
});

test('a credential the synthesizer quoted never reaches map_json or the description (D21)', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = await createWorkspace({ name: 'Secret Synth', projectPaths: [a, b] });
  const { map } = sampleMap({ keys: ws.projectKeys, names: ws.projectPaths.map((p) => basename(p)), name: ws.name });
  const synthesis = {
    version: 1, overview: 'Billing reads DATABASE_URL=postgres://app:s3cr3t@db:5432/billing at boot.',
    roles: {}, coordination: ['Rotate API_TOKEN=abc123 first.'], orderNotes: '',
  };
  await finalizeWorkspaceScan({ workspaceId: ws.id, name: ws.name, projectPaths: [a, b], pipelineDir: await runFolder({ name: ws.name, map, synthesis }) });
  const stored = await readWorkspaceMap(ws.id);
  const everything = JSON.stringify(stored) + (await readWorkspace(ws.id)).description;
  assert.ok(!everything.includes('s3cr3t') && !everything.includes('abc123'), everything);
  assert.match(stored.synthesis.overview, /postgres:\/\/\*\*\*@db:5432\/billing/);
  assert.deepEqual(stored.synthesis.coordination, ['Rotate API_TOKEN=*** first.']);
});
