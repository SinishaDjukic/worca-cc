// test/workflow-export-use.test.mjs — D17 (plans/workflow-tests-plan.md): every export path takes `use`,
// 'draft' (the default: today's behaviour) or a version number, and exports exactly that. The fixture is one
// workflow whose version 1 has a user agent the draft has since dropped, and whose draft has another name.
// No flag: an explicit version number needs none (runnableOf).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { createV2Agent } from './helpers/export-fixtures.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { createVersion } from '../src/core/workflow-versions.mjs';
import { exportGraphJson, isExportUse } from '../src/core/workflow-share.mjs';
import { planExport, exportWorkflowPlugin } from '../src/core/workflow-export.mjs';

useTempHome(after);
const dirs = [];
const tmp = async (p = 'wf-exp-use-') => { const d = await mkdtemp(join(tmpdir(), p)); dirs.push(d); return d; };
after(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

const ID = 'wf_export-use';
const task = { id: 'n_task', kind: 'task', x: 0, y: 100, config: {} };
const plan = { id: 'n_plan', kind: 'agent', key: 'planner', x: 120, y: 100, config: {} };
const shared = { id: 'n_shared', kind: 'agent', key: 'sharedAgent', x: 240, y: 100, config: {} };
const end = { id: 'n_end', kind: 'end', x: 360, y: 100, config: {} };
const wire = (id, a, ap, b, bp) => ({ id, from: { node: a, port: ap }, to: { node: b, port: bp } });

before(async () => {
  await createV2Agent({ key: 'sharedAgent', displayName: 'Shared Agent', description: 'only version 1 uses it',
    runnerType: 'producer', order: 50, markdown: '---\nname: sharedAgent\n---\n# Shared Agent\n' });
  await writeGraphWorkflow({ id: ID, name: 'Export Use', domain: 'coding', nodes: [task, plan, shared, end],
    wires: [wire('w1', 'n_task', 'task', 'n_plan', 'task'), wire('w2', 'n_plan', 'plan', 'n_shared', 'task'),
      wire('w3', 'n_shared', 'out', 'n_end', 'result')] });
  assert.equal((await createVersion(ID, { note: 'First version for the team' })).versionNo, 1);
  // The draft drops the user agent and is renamed.
  await writeGraphWorkflow({ id: ID, name: 'Export Use Draft', domain: 'coding', nodes: [task, plan, end],
    wires: [wire('w1', 'n_task', 'task', 'n_plan', 'task'), wire('w2', 'n_plan', 'plan', 'n_end', 'result')] });
});

const nodeIds = (g) => g.nodes.map((n) => n.id);

test('exportGraphJson: use n exports version n; the default and "draft" export the stored row', async () => {
  const v1 = await exportGraphJson(ID, { use: 1 });
  assert.deepEqual(Object.keys(v1), ['version', 'name', 'domain', 'nodes', 'wires'], 'the same unstamped shape, no versionNo or id');
  assert.equal(v1.name, 'Export Use');
  assert.deepEqual(nodeIds(v1), ['n_task', 'n_plan', 'n_shared', 'n_end']);
  assert.equal(v1.wires.length, 3);
  for (const draft of [await exportGraphJson(ID), await exportGraphJson(ID, {}), await exportGraphJson(ID, { use: 'draft' })]) {
    assert.equal(draft.name, 'Export Use Draft');
    assert.deepEqual(nodeIds(draft), ['n_task', 'n_plan', 'n_end']);
  }
});

test('exportGraphJson: a bad use is BAD_REQUEST, a version that does not exist NOT_FOUND, an unknown workflow still NOT_FOUND', async () => {
  for (const use of ['abc', 0, -1, 1.5, '1', 'live', null]) {
    await assert.rejects(exportGraphJson(ID, { use }), { code: 'BAD_REQUEST' }, `use ${JSON.stringify(use)}`);
  }
  await assert.rejects(exportGraphJson(ID, { use: 9 }), { code: 'NOT_FOUND' });
  await assert.rejects(exportGraphJson('wf_nope'), { code: 'NOT_FOUND' });
});

test('isExportUse: the one D17 rule — \'draft\' or a positive integer, nothing else (not \'live\')', () => {
  for (const ok of ['draft', 1, 2, 40]) assert.equal(isExportUse(ok), true, JSON.stringify(ok));
  for (const bad of ['live', 'abc', '1', 0, -1, 1.5, null, undefined, true, NaN, Infinity]) assert.equal(isExportUse(bad), false, String(bad));
});

test('Claude Code skill: planExport({ use: 1 }) builds from version 1, the default from the draft', async () => {
  const has = (p, re) => [...p.created, ...p.updated, ...p.noop].some((f) => re.test(f.split(sep).join('/')));
  const v1 = await planExport({ workflowId: ID, destination: 'project', projectDir: await tmp(), use: 1 });
  assert.ok(has(v1, /\/agents\/[^/]*sharedAgent[^/]*\.md$/i), 'version 1 dispatches the user agent');
  const draft = await planExport({ workflowId: ID, destination: 'project', projectDir: await tmp() });
  assert.equal(has(draft, /sharedAgent/i), false, 'the draft no longer has that agent');
  await assert.rejects(planExport({ workflowId: ID, destination: 'project', projectDir: await tmp(), use: 9 }), { code: 'NOT_FOUND' });
  for (const use of ['live', 'abc', 0]) {
    await assert.rejects(planExport({ workflowId: ID, destination: 'project', projectDir: await tmp(), use }), { code: 'BAD_REQUEST' });
  }
});

test('Claude Code skill: the skill (its slug, its command) is the workflow\'s, whatever version is exported', async () => {
  // Version 1 is named "Export Use", the draft "Export Use Draft": exporting v1 updates the same skill.
  const has = (p, re) => [...p.created, ...p.updated, ...p.noop].some((f) => re.test(f.split(sep).join('/')));
  for (const use of [1, 'draft', undefined]) {
    const plan = await planExport({ workflowId: ID, destination: 'project', projectDir: await tmp(), ...(use === undefined ? {} : { use }) });
    assert.ok(has(plan, /\/skills\/export-use-draft\/SKILL\.md$/), `use ${use}: the stored workflow's name`);
    assert.equal(has(plan, /\/skills\/export-use\/SKILL\.md$/), false, `use ${use}: never a second skill named after the version`);
  }
  const named = await planExport({ workflowId: ID, destination: 'project', projectDir: await tmp(), use: 1, slug: 'mine' });
  assert.ok(has(named, /\/skills\/mine\/SKILL\.md$/), 'a typed slug still wins');
});

test('Worca plugin: use 1 bundles version 1 (its agent, its graph); the slug stays the workflow id\'s', async () => {
  const rel = (dir, p) => p.slice(dir.length + 1).split(sep).join('/');
  const dir1 = join(await tmp(), 'use-one');
  const dry = await exportWorkflowPlugin({ workflowId: ID, targetDir: dir1, dryRun: true, use: 1 });
  assert.equal(dry.slug, 'export-use');
  assert.ok(dry.created.map((p) => rel(dir1, p)).includes('agents/sharedAgent.md'), dry.created.join('\n'));
  const draftDir = join(await tmp(), 'use-draft');
  const dryDraft = await exportWorkflowPlugin({ workflowId: ID, targetDir: draftDir, dryRun: true });
  assert.equal(dryDraft.slug, 'export-use');
  assert.equal(dryDraft.created.map((p) => rel(draftDir, p)).includes('agents/sharedAgent.md'), false);

  const r = await exportWorkflowPlugin({ workflowId: ID, targetDir: dir1, use: 1 });
  assert.equal(r.validation.ok, true, JSON.stringify(r.validation.problems));
  const written = JSON.parse(await readFile(join(dir1, 'workflows', 'export-use.json'), 'utf8'));
  assert.deepEqual(written, await exportGraphJson(ID, { use: 1 }), 'exactly the version\'s JSON share payload');
  const manifest = JSON.parse(await readFile(join(dir1, 'worca-cc-plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'use-one', 'the plugin name is the folder\'s, never the version\'s');
  assert.equal(manifest.worca.exports['export-use'].name, 'Export Use Draft', 'the export entry names the workflow itself');
  assert.equal(manifest.description, 'Workflows shared from Worca — Export Use Draft');
  for (const use of ['abc', 'live']) {
    await assert.rejects(exportWorkflowPlugin({ workflowId: ID, targetDir: join(await tmp(), 'x'), dryRun: true, use }), { code: 'BAD_REQUEST' });
  }
});
