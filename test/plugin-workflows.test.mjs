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
import { writeWorkflow } from '../src/core/workflows.mjs';
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

const TPL = { name: 'Demo Flow', steps: [[{ id: 's0', key: 'demoAgent' }]], feedbacks: [] };

test('importPluginWorkflows inserts rows id wfp_<name>_<slug> with origin plugin:<name>', async () => {
  const versionDir = installFakePlugin('demo', { 'simple.json': TPL });
  const res = await importPluginWorkflows('demo', versionDir);
  assert.deepEqual(res.imported, ['wfp_demo_simple']);
  const row = getDb().prepare('SELECT name, origin, steps FROM workflows WHERE id = ?').get('wfp_demo_simple');
  assert.equal(row.origin, 'plugin:demo');
  assert.equal(row.name, 'Demo Flow');
  assert.deepEqual(JSON.parse(row.steps), TPL.steps);
});

test('re-import upserts by id: name/steps update, created_at survives', async () => {
  const versionDir = installFakePlugin('demo', { 'simple.json': TPL });
  await importPluginWorkflows('demo', versionDir);
  const before = getDb().prepare('SELECT created_at FROM workflows WHERE id = ?').get('wfp_demo_simple');
  const v2 = { name: 'Demo Flow v2', steps: [[{ id: 's0', key: 'demoAgent' }], [{ id: 's1', key: 'demoAgent' }]], feedbacks: [] };
  await writeFile(join(versionDir, 'workflows', 'simple.json'), JSON.stringify(v2));
  const res = await importPluginWorkflows('demo', versionDir);
  assert.deepEqual(res.imported, ['wfp_demo_simple']);
  const row = getDb().prepare('SELECT name, steps, created_at, origin FROM workflows WHERE id = ?').get('wfp_demo_simple');
  assert.equal(row.name, 'Demo Flow v2');
  assert.equal(JSON.parse(row.steps).length, 2);
  assert.equal(row.origin, 'plugin:demo');
  assert.equal(row.created_at, before.created_at, 'ON CONFLICT never touches created_at');
});

test('a user-duplicated copy (origin NULL) is a separate row, untouched by re-import AND removal', async () => {
  const versionDir = installFakePlugin('demo', { 'simple.json': TPL });
  await importPluginWorkflows('demo', versionDir);
  const dup = await writeWorkflow({ name: 'My Copy', steps: TPL.steps, feedbacks: [] }); // origin NULL
  await importPluginWorkflows('demo', versionDir);
  const row = getDb().prepare('SELECT name, origin FROM workflows WHERE id = ?').get(dup.id);
  assert.equal(row.name, 'My Copy');
  assert.equal(row.origin, null);
  const removed = await removePluginWorkflows('demo');
  assert.deepEqual(removed, { removed: ['wfp_demo_simple'] });
  assert.ok(getDb().prepare('SELECT 1 FROM workflows WHERE id = ?').get(dup.id), 'user copy survives removal');
});

test('an invalid template (agent key the registry does not know) is skipped with a warning, not thrown', async () => {
  const bad = { name: 'Bad', steps: [[{ id: 's0', key: 'notShipped' }]], feedbacks: [] };
  const versionDir = installFakePlugin('demo', { 'bad.json': bad, 'good.json': TPL });
  const warned = []; const orig = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  let res;
  try { res = await importPluginWorkflows('demo', versionDir); } finally { console.warn = orig; }
  assert.deepEqual(res.imported, ['wfp_demo_good']);
  assert.equal(res.skipped.length, 1);
  assert.match(res.skipped[0].errors.join(' '), /notShipped/);
  assert.ok(warned.some((w) => /bad\.json/.test(w)), warned.join('; '));
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
