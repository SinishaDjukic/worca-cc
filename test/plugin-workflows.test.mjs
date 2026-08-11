// test/plugin-workflows.test.mjs
// Plugin workflow templates (spec §9.3): import at install upserts namespaced
// rows (wfp_<name>_<slug>, origin plugin:<name>); user duplicates (origin NULL)
// are separate rows and untouched; removal is guarded by references
// (project_config.active_workflow_id + paused pipelines' resume_point).
// Per-test fresh WORCA_HOME + DB reset, mirroring test/workflows-db.test.mjs.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getDb, _resetForTests } from '../src/core/db.mjs';
import { writeWorkflow, readWorkflow } from '../src/core/workflows.mjs';
import { setActiveWorkflow } from '../src/core/config.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { readPluginsLock, writePluginsLock, pluginDir } from '../src/core/plugins-lock.mjs';
import {
  importPluginWorkflows, removePluginWorkflows, referencedPluginAgents, ReferencedError,
} from '../src/core/plugin-workflows.mjs';

const homes = [];
async function freshHome() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-pwf-'));
  homes.push(dir);
  _resetForTests();
  process.env.WORCA_HOME = dir;
  return dir;
}
beforeEach(freshHome);
after(async () => {
  _resetForTests();
  process.env.WORCA_HOME = join(tmpdir(), 'worca-cc-test-quarantine'); // never the real ~/.worca-cc
  await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true })));
});

/** Installed-plugin layout (versions/<sha7> + current symlink + lock entry) with
 *  ONE agent (key demoAgent) and the given { filename: templateObject } map. */
function installFakePlugin(name, workflows = {}) {
  const versionDir = join(pluginDir(name), 'versions', 'abc1234');
  mkdirSync(join(versionDir, 'agents'), { recursive: true });
  writeFileSync(join(versionDir, 'agents', 'demoAgent.md'), '# demoAgent\n');
  writeFileSync(join(versionDir, 'agents', 'demoAgent.meta.json'), JSON.stringify({
    metaVersion: 2,
    key: 'demoAgent', displayName: 'Demo Agent', agentFile: 'demoAgent.md',
    runnerType: 'producer', order: 50,
    inputs: [{ id: 'task', type: 'md' }],
    outputs: [{ id: 'plan', type: 'md', filename: '{base}.md' }],
  }));
  mkdirSync(join(versionDir, 'workflows'), { recursive: true });
  for (const [file, tpl] of Object.entries(workflows)) {
    writeFileSync(join(versionDir, 'workflows', file), JSON.stringify(tpl));
  }
  symlinkSync(versionDir, join(pluginDir(name), 'current'), 'dir');
  writePluginsLock({ ...readPluginsLock(), [name]: {
    repo: 'https://example.com/p.git', subdir: name, pinnedSha: 'a'.repeat(40),
    version: '0.1.0', enabled: true, installedAt: '2026-07-12T00:00:00.000Z',
  } });
  return versionDir;
}

/** The smallest legal v2 plugin template: task -> demoAgent -> end. V20 and V21
 *  apply to plugin templates too, so both flow cards are mandatory. */
function graphTpl(name = 'Demo Flow', key = 'demoAgent') {
  return {
    name, version: 2, domain: 'general',
    nodes: [
      { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
      { id: 'n_a', kind: 'agent', key, x: 320, y: 200, config: {} },
      { id: 'n_end', kind: 'end', x: 600, y: 200, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_a', port: 'task' } },
      { id: 'w2', from: { node: 'n_a', port: 'plan' }, to: { node: 'n_end', port: 'result' } },
    ],
  };
}
const TPL = graphTpl();

test('importPluginWorkflows inserts v2 rows id wfp_<name>_<slug> with origin plugin:<name>', async () => {
  const versionDir = installFakePlugin('demo', { 'simple.json': TPL });
  const res = await importPluginWorkflows('demo', versionDir);
  assert.deepEqual(res.imported, ['wfp_demo_simple']);
  const row = getDb().prepare('SELECT name, version, origin, graph, steps FROM workflows WHERE id = ?').get('wfp_demo_simple');
  assert.equal(row.origin, 'plugin:demo');
  assert.equal(row.name, 'Demo Flow');
  assert.equal(row.version, 2);
  assert.equal(row.steps, '[]', 'the v1 columns are blanked, exactly like writeWorkflow');
  const graph = JSON.parse(row.graph);
  assert.equal(graph.id, 'wfp_demo_simple', 'rowToTpl asserts graph.id === row id');
  assert.deepEqual(graph.nodes, TPL.nodes);
  assert.deepEqual(graph.wires, TPL.wires);
});

test('an imported plugin template reads back through readWorkflow as a v2 graph', async () => {
  const versionDir = installFakePlugin('demo', { 'simple.json': TPL });
  await importPluginWorkflows('demo', versionDir);
  const tpl = await readWorkflow('wfp_demo_simple');
  assert.ok(tpl, 'a v1 row would have been dropped by rowToTpl');
  assert.equal(tpl.version, 2);
  assert.equal(tpl.origin, 'plugin:demo');
  assert.equal(tpl.nodes.length, 3);
});

test('re-import upserts by id: name/graph update, created_at survives', async () => {
  const versionDir = installFakePlugin('demo', { 'simple.json': TPL });
  await importPluginWorkflows('demo', versionDir);
  const before = getDb().prepare('SELECT created_at FROM workflows WHERE id = ?').get('wfp_demo_simple');
  const next = graphTpl('Demo Flow v2');
  next.nodes.push({ id: 'n_b', kind: 'agent', key: 'demoAgent', x: 320, y: 400, config: {} });
  next.wires.push({ id: 'w3', from: { node: 'n_task', port: 'task' }, to: { node: 'n_b', port: 'task' } });
  await writeFile(join(versionDir, 'workflows', 'simple.json'), JSON.stringify(next));
  const res = await importPluginWorkflows('demo', versionDir);
  assert.deepEqual(res.imported, ['wfp_demo_simple']);
  const row = getDb().prepare('SELECT name, graph, created_at, origin FROM workflows WHERE id = ?').get('wfp_demo_simple');
  assert.equal(row.name, 'Demo Flow v2');
  assert.equal(JSON.parse(row.graph).nodes.length, 4);
  assert.equal(JSON.parse(row.graph).createdAt, before.created_at, 'the graph document keeps the original createdAt too');
  assert.equal(row.origin, 'plugin:demo');
  assert.equal(row.created_at, before.created_at, 'ON CONFLICT never touches created_at');
});

test('a user-duplicated copy (origin NULL) is a separate row, untouched by re-import AND removal', async () => {
  const versionDir = installFakePlugin('demo', { 'simple.json': TPL });
  await importPluginWorkflows('demo', versionDir);
  const dup = await writeWorkflow({ name: 'My Copy', ...graphTpl('My Copy') }); // origin NULL
  await importPluginWorkflows('demo', versionDir);
  const row = getDb().prepare('SELECT name, origin FROM workflows WHERE id = ?').get(dup.id);
  assert.equal(row.name, 'My Copy');
  assert.equal(row.origin, null);
  const removed = await removePluginWorkflows('demo');
  assert.deepEqual(removed, { removed: ['wfp_demo_simple'] });
  assert.ok(getDb().prepare('SELECT 1 FROM workflows WHERE id = ?').get(dup.id), 'user copy survives removal');
});

test('an invalid template (agent key the registry does not know) is skipped with a warning, not thrown', async () => {
  const versionDir = installFakePlugin('demo', { 'bad.json': graphTpl('Bad', 'notShipped'), 'good.json': TPL });
  const warned = []; const orig = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  let res;
  try { res = await importPluginWorkflows('demo', versionDir); } finally { console.warn = orig; }
  assert.deepEqual(res.imported, ['wfp_demo_good']);
  assert.equal(res.skipped.length, 1);
  assert.match(res.skipped[0].errors.join(' '), /V4.*notShipped/);
  assert.ok(warned.some((w) => /bad\.json/.test(w)), warned.join('; '));
});

test('a v1 "steps" template is rejected with a warning naming the port, never imported', async () => {
  const v1 = { name: 'Legacy', version: 1, steps: [[{ id: 's0', key: 'demoAgent' }]], feedbacks: [] };
  const versionDir = installFakePlugin('demo', { 'legacy.json': v1, 'good.json': TPL });
  const warned = []; const orig = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  let res;
  try { res = await importPluginWorkflows('demo', versionDir); } finally { console.warn = orig; }
  assert.deepEqual(res.imported, ['wfp_demo_good']);
  assert.deepEqual(res.skipped.map((s) => s.file), ['legacy.json']);
  assert.match(res.skipped[0].errors.join(' '), /version-2 graph template.*nodes\/wires/);
  assert.ok(warned.some((w) => /legacy\.json/.test(w)), warned.join('; '));
  assert.equal(getDb().prepare('SELECT 1 FROM workflows WHERE id = ?').get('wfp_demo_legacy'), undefined);
});

test('a graph without an end node fails V21 — V20/V21 apply to plugin templates too', async () => {
  const noEnd = graphTpl('No End');
  noEnd.nodes = noEnd.nodes.filter((n) => n.kind !== 'end');
  noEnd.wires = noEnd.wires.filter((w) => w.to.node !== 'n_end');
  const versionDir = installFakePlugin('demo', { 'noend.json': noEnd });
  const orig = console.warn;
  console.warn = () => {};
  let res;
  try { res = await importPluginWorkflows('demo', versionDir); } finally { console.warn = orig; }
  assert.deepEqual(res.imported, []);
  assert.match(res.skipped[0].errors.join(' '), /V21/);
});

test('removePluginWorkflows throws ReferencedError when a project pins the workflow', async () => {
  const versionDir = installFakePlugin('demo', { 'simple.json': TPL });
  await importPluginWorkflows('demo', versionDir);
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-pwf-proj-')); homes.push(proj);
  await setActiveWorkflow(proj, 'wfp_demo_simple'); // config.mjs:465 — writes project_config.active_workflow_id
  await assert.rejects(() => removePluginWorkflows('demo'), (err) => {
    assert.ok(err instanceof ReferencedError);
    assert.match(err.message, /wfp_demo_simple/);
    assert.equal(err.references[0].workflowId, 'wfp_demo_simple');
    return true;
  });
  assert.ok(getDb().prepare('SELECT 1 FROM workflows WHERE id = ?').get('wfp_demo_simple'), 'guard fired: nothing deleted');
});

test('the guard also catches a paused pipeline whose resume_point pins the workflow', async () => {
  const versionDir = installFakePlugin('demo', { 'simple.json': TPL });
  await importPluginWorkflows('demo', versionDir);
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-pwf-proj2-')); homes.push(proj);
  const { id } = await seedPipeline(proj, { status: 'paused' });
  getDb().prepare('UPDATE pipelines SET resume_point = ? WHERE id = ?')
    .run(JSON.stringify({ version: 1, kind: 'boundary', workflowId: 'wfp_demo_simple' }), id);
  await assert.rejects(() => removePluginWorkflows('demo'), ReferencedError);
});

test('but an ARCHIVED pipeline releases the pin — archive must not strand `worca plugin remove`', async () => {
  const versionDir = installFakePlugin('demo', { 'simple.json': TPL });
  await importPluginWorkflows('demo', versionDir);
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-pwf-proj3-')); homes.push(proj);
  const { id } = await seedPipeline(proj, { status: 'paused' });
  getDb().prepare('UPDATE pipelines SET resume_point = ? WHERE id = ?')
    .run(JSON.stringify({ version: 1, kind: 'boundary', workflowId: 'wfp_demo_simple' }), id);
  await assert.rejects(() => removePluginWorkflows('demo'), ReferencedError);
  // History "Archive" soft-deletes the row (archived_at stamped, resume_point kept).
  // It is unresumable and invisible from there on, so the pin must lift — the hard
  // DELETE it replaced used to lift it, and there is no UI escape hatch otherwise.
  getDb().prepare('UPDATE pipelines SET archived_at = ? WHERE id = ?')
    .run(new Date().toISOString(), id);
  assert.deepEqual(await removePluginWorkflows('demo'), { removed: ['wfp_demo_simple'] });
});

test('referencedPluginAgents walks graph.nodes of NON-plugin workflows', async () => {
  installFakePlugin('demo', {});
  // planner is a builtin; demoAgent is the plugin's. Only the latter is a reference.
  const tpl = graphTpl('Uses Demo', 'planner');
  tpl.nodes.push({ id: 'n_b', kind: 'agent', key: 'demoAgent', x: 320, y: 400, config: {} });
  tpl.wires.push({ id: 'w3', from: { node: 'n_task', port: 'task' }, to: { node: 'n_b', port: 'task' } });
  const wf = await writeWorkflow(tpl);
  assert.deepEqual(referencedPluginAgents('demo'), [
    { workflowId: wf.id, name: 'Uses Demo', keys: ['demoAgent'] },
  ]);
  assert.deepEqual(referencedPluginAgents('ghost-plugin'), [], 'unknown plugin: no keys, no refs');
});

test('referencedPluginAgents ignores the plugin\'s OWN imported rows', async () => {
  const versionDir = installFakePlugin('demo', { 'simple.json': TPL });
  await importPluginWorkflows('demo', versionDir);
  assert.deepEqual(referencedPluginAgents('demo'), [], 'origin plugin:demo is not a foreign reference');
});

test('the uninstall guard fires on a user graph using a plugin agent (the V17 regression)', async () => {
  installFakePlugin('demo', {});
  await writeWorkflow(graphTpl('User Graph', 'demoAgent'));
  const refs = referencedPluginAgents('demo');
  assert.equal(refs.length, 1, 'the walk must read the graph column — steps is blanked to [] by every v2 writer');
  assert.deepEqual(refs[0].keys, ['demoAgent']);
});
