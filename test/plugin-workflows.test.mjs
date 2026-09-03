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
import { writeWorkflow, writeGraphWorkflow, readWorkflow } from '../src/core/workflows.mjs';
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
  // 'junction' on Windows (a plain/dir symlink needs elevated privileges there);
  // versionDir is absolute, as junctions require. Mirrors plugin-store's swap.
  symlinkSync(versionDir, join(pluginDir(name), 'current'), process.platform === 'win32' ? 'junction' : 'dir');
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
  const row = getDb().prepare(
    'SELECT name, version, origin, domain, graph, steps, feedbacks, archived_at FROM workflows WHERE id = ?',
  ).get('wfp_demo_simple');
  assert.equal(row.origin, 'plugin:demo');
  assert.equal(row.name, 'Demo Flow');
  assert.equal(row.version, 2);
  assert.equal(row.domain, 'general');
  assert.equal(row.steps, '[]', 'the v1 columns are blanked');
  assert.equal(row.feedbacks, '[]');
  assert.equal(row.archived_at, null);
  const graph = JSON.parse(row.graph);
  assert.deepEqual(Object.keys(graph).sort(), ['nodes', 'wires'], 'graph holds nodes/wires only');
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
  const renamed = { ...graphTpl('Demo Flow v2'), domain: 'coding' };
  await writeFile(join(versionDir, 'workflows', 'simple.json'), JSON.stringify(renamed));
  await importPluginWorkflows('demo', versionDir);
  const row = getDb().prepare('SELECT name, domain, created_at FROM workflows WHERE id = ?').get('wfp_demo_simple');
  assert.equal(row.name, 'Demo Flow v2');
  assert.equal(row.domain, 'coding');
  assert.equal(row.created_at, before.created_at);
});

test('re-import UN-ARCHIVES a row the v2 upgrade had archived', async () => {
  const versionDir = installFakePlugin('demo', { 'simple.json': TPL });
  await importPluginWorkflows('demo', versionDir);
  getDb().prepare("UPDATE workflows SET archived_at = '2026-08-26T00:00:00.000Z' WHERE id = ?").run('wfp_demo_simple');
  await importPluginWorkflows('demo', versionDir);
  assert.equal(getDb().prepare('SELECT archived_at FROM workflows WHERE id = ?').get('wfp_demo_simple').archived_at, null);
});

test('a v1 "steps" template is rejected with a warning naming the port, never imported', async () => {
  const versionDir = installFakePlugin('demo', {
    'legacy.json': { name: 'Legacy', version: 1, steps: [[{ id: 's0', key: 'demoAgent' }]], feedbacks: [] },
  });
  const res = await importPluginWorkflows('demo', versionDir);
  assert.deepEqual(res.imported, []);
  assert.equal(res.skipped.length, 1);
  assert.match(res.skipped[0].errors[0], /not a version-2 graph template/);
  assert.equal(getDb().prepare('SELECT id FROM workflows WHERE id = ?').get('wfp_demo_legacy'), undefined);
});

test('a graph without an end node fails V21 — V20/V21 apply to plugin templates too', async () => {
  const noEnd = graphTpl();
  noEnd.nodes = noEnd.nodes.filter((n) => n.kind !== 'end');
  noEnd.wires = noEnd.wires.filter((w) => w.to.node !== 'n_end');
  const versionDir = installFakePlugin('demo', { 'no-end.json': noEnd });
  const res = await importPluginWorkflows('demo', versionDir);
  assert.deepEqual(res.imported, []);
  assert.match(res.skipped[0].errors.join('; '), /^V21: /);
});

test('an invalid template (agent key the registry does not know) is skipped with a warning, not thrown', async () => {
  const versionDir = installFakePlugin('demo', { 'ghost.json': graphTpl('Ghost', 'noSuchAgent') });
  const res = await importPluginWorkflows('demo', versionDir);
  assert.deepEqual(res.imported, []);
  assert.equal(res.skipped.length, 1);
  assert.match(res.skipped[0].errors.join('; '), /V4|noSuchAgent/);
});

test('a user-duplicated copy (origin NULL) is a separate row, untouched by re-import AND removal', async () => {
  const versionDir = installFakePlugin('demo', { 'simple.json': TPL });
  await importPluginWorkflows('demo', versionDir);
  await writeGraphWorkflow({ id: 'wf_my-copy', name: 'My Copy', domain: 'general', nodes: TPL.nodes, wires: TPL.wires });
  await importPluginWorkflows('demo', versionDir);
  await removePluginWorkflows('demo');
  const mine = getDb().prepare('SELECT origin FROM workflows WHERE id = ?').get('wf_my-copy');
  assert.ok(mine && mine.origin === null);
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

test('referencedPluginAgents finds this plugin\'s keys inside NON-plugin workflows', async () => {
  installFakePlugin('demo', {});
  const wf = await writeWorkflow({
    name: 'Uses Demo',
    steps: [[{ id: 's0', key: 'planner' }], [{ id: 's1', key: 'demoAgent' }]],
    feedbacks: [],
  });
  assert.deepEqual(referencedPluginAgents('demo'), [
    { workflowId: wf.id, name: 'Uses Demo', keys: ['demoAgent'] },
  ]);
  assert.deepEqual(referencedPluginAgents('ghost-plugin'), [], 'unknown plugin: no keys, no refs');
});

test('referencedPluginAgents walks graph.nodes of NON-plugin workflows', async () => {
  const versionDir = installFakePlugin('demo', {});
  await writeGraphWorkflow({ id: 'wf_mine', name: 'Mine', domain: 'general', nodes: TPL.nodes, wires: TPL.wires });
  const refs = referencedPluginAgents('demo');
  assert.deepEqual(refs, [{ workflowId: 'wf_mine', name: 'Mine', keys: ['demoAgent'] }]);
  void versionDir;
});

test('only kind:"agent" nodes count — a flow card carrying a stray key does not', async () => {
  // Guards the kind narrowing: a task/end/gate card never names an agent, so a
  // key-only walk would pin an agent no pipeline actually runs and would block
  // `worca plugin remove` forever.
  installFakePlugin('demo', {});
  await writeGraphWorkflow({
    id: 'wf_flowonly', name: 'Flow Only', domain: 'general',
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {}, key: 'demoAgent' },
      { id: 'n_end', kind: 'end', x: 400, y: 0, config: {}, key: 'demoAgent' },
    ],
    wires: [],
  });
  assert.deepEqual(referencedPluginAgents('demo'), []);
});

test('referencedPluginAgents ignores the plugin\'s OWN imported rows', async () => {
  const versionDir = installFakePlugin('demo', { 'simple.json': TPL });
  await importPluginWorkflows('demo', versionDir);
  assert.deepEqual(referencedPluginAgents('demo'), []);
});

// Disabling a plugin withdraws its agents/skills/sources; its workflow templates
// follow (#421 review): hidden from the list (the composer, the New Pipeline
// picker, Ask's catalog all read listWorkflows) and refused by the run gate with
// a coded error naming the fix. Re-enabling brings them back untouched.
test('a disabled plugin\'s workflows are hidden from the list and refused by the run gate; enabling restores them', async () => {
  const versionDir = installFakePlugin('demo', { 'simple.json': TPL });
  await importPluginWorkflows('demo', versionDir);
  await writeGraphWorkflow({ ...graphTpl('Mine', 'demoAgent'), name: 'Mine' });   // a user row stays visible throughout
  const { listWorkflows, assertRunnableWorkflow } = await import('../src/core/workflows.mjs');
  assert.ok((await listWorkflows()).some((w) => w.id === 'wfp_demo_simple'), 'precondition: listed while enabled');

  writePluginsLock({ ...readPluginsLock(), demo: { ...readPluginsLock().demo, enabled: false } });
  const visible = (await listWorkflows()).map((w) => w.id);
  assert.ok(!visible.includes('wfp_demo_simple'), 'hidden while the plugin is disabled');
  assert.ok(visible.includes('wf_mine'), 'the user row is untouched');
  assert.ok((await listWorkflows({ includeDisabled: true })).some((w) => w.id === 'wfp_demo_simple'), 'includeDisabled lifts the filter');
  await assert.rejects(assertRunnableWorkflow('wfp_demo_simple'), (e) => {
    assert.equal(e.code, 'PLUGIN_DISABLED');
    assert.match(e.message, /plugin "demo", which is disabled/);
    assert.match(e.message, /worca plugin enable demo/);
    return true;
  });
  assert.ok(await readWorkflow('wfp_demo_simple'), 'the row itself is still there (nothing deleted)');

  writePluginsLock({ ...readPluginsLock(), demo: { ...readPluginsLock().demo, enabled: true } });
  assert.ok((await listWorkflows()).some((w) => w.id === 'wfp_demo_simple'), 'back after enabling');
  assert.equal((await assertRunnableWorkflow('wfp_demo_simple', { checkGraph: false })).id, 'wfp_demo_simple');
});
