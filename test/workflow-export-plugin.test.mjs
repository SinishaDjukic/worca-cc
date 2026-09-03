// test/workflow-export-plugin.test.mjs
// Export to plugin (issue #421): a saved workflow + the USER agents it uses +
// the non-bundle skills they require become a plugin folder that validates,
// links and reimports on a recipient. Built-ins are never copied, a bundle
// skill is skipped, another plugin's agent is refused, and a re-export is
// deterministic (all-no-op with --keep-version, patch-bump on a change).
// Tests share ONE temp home and run in file order (node:test is sequential).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { createV2Agent } from './helpers/export-fixtures.mjs';
import { exportWorkflowPlugin } from '../src/core/workflow-export.mjs';
import { exportGraphJson } from '../src/core/workflow-share.mjs';
import { validatePluginDir } from '../src/core/plugin-manifest.mjs';
import { readPluginWorkflows } from '../src/core/plugin-workflows.mjs';
import { linkPlugin } from '../src/core/plugin-store.mjs';
import { userAgentsDir } from '../src/core/agent-store.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { readWorkflow, writeGraphWorkflow } from '../src/core/workflows.mjs';

useTempHome(after);

const dirs = [];
const tmp = async (p = 'wf-exp-plg-') => { const d = await mkdtemp(join(tmpdir(), p)); dirs.push(d); return d; };
after(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });

const GLOBAL_SKILL_MD = '---\nname: shared-skill\ndescription: a global skill the shared agent needs\n---\n\nGlobal skill body.\n';
const BUNDLE_SKILL_MD = '---\nname: bundled-skill\ndescription: ships with Worca\n---\n\nBundle body.\n';

// global skills live at <HOME>/.claude/skills; the bundle is a fixture repoRoot.
let prevHome, repoRoot, workflowId;
before(async () => {
  prevHome = process.env.HOME;
  const home = await tmp('wf-exp-plg-home-');
  process.env.HOME = home;
  await mkdir(join(home, '.claude', 'skills', 'shared-skill'), { recursive: true });
  await writeFile(join(home, '.claude', 'skills', 'shared-skill', 'SKILL.md'), GLOBAL_SKILL_MD, 'utf8');
  repoRoot = await tmp('wf-exp-plg-bundle-');
  await mkdir(join(repoRoot, 'skills', 'bundled-skill'), { recursive: true });
  await writeFile(join(repoRoot, 'skills', 'bundled-skill', 'SKILL.md'), BUNDLE_SKILL_MD, 'utf8');
  await createV2Agent({
    key: 'sharedAgent', displayName: 'Shared Agent', description: 'a user agent to bundle',
    runnerType: 'producer', order: 50, requiresSkills: ['shared-skill', 'bundled-skill'],
    markdown: '---\nname: sharedAgent\n---\n# Shared Agent\n\nUses shared-skill.\n',
  });
  // Hand-built (not writeKeyGraph): the exporter runs the FULL validator over
  // the stored row before sharing it, and V2 pins node ids to /^n_[a-z0-9]+$/.
  const tpl = await writeGraphWorkflow({
    name: 'Shared Flow', domain: 'coding',
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 100, config: {} },
      { id: 'n_plan', kind: 'agent', key: 'planner', x: 120, y: 100, config: {} },
      { id: 'n_shared', kind: 'agent', key: 'sharedAgent', x: 240, y: 100, config: {} },
      { id: 'n_end', kind: 'end', x: 360, y: 100, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
      { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_shared', port: 'task' } },
      { id: 'w3', from: { node: 'n_shared', port: 'out' }, to: { node: 'n_end', port: 'result' } },
    ],
  });
  workflowId = tpl.id;                                              // wf_shared-flow
});
after(() => { if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome; });

let pluginDir;                                                      // <tmp>/my-shared-plugin

test('dry-run classifies every intended file and writes nothing', async () => {
  pluginDir = join(await tmp(), 'my-shared-plugin');
  const plan = await exportWorkflowPlugin({ workflowId, targetDir: pluginDir, dryRun: true, repoRoot });
  assert.equal(plan.name, 'my-shared-plugin', 'name defaults to the folder basename');
  assert.equal(plan.slug, 'shared-flow', 'slug derives from the id, wf_ stripped');
  assert.equal(plan.version, '0.1.0');
  const rel = (p) => p.slice(pluginDir.length + 1).split('\\').join('/');
  assert.deepEqual(plan.created.map(rel).sort(), [
    'agents/sharedAgent.md', 'agents/sharedAgent.meta.json',
    'skills/shared-skill/SKILL.md', 'worca-cc-plugin.json', 'workflows/shared-flow.json',
  ]);
  assert.deepEqual(plan.updated, []);
  assert.deepEqual(plan.noop, []);
  assert.equal(plan.skipped.length, 1);
  assert.match(plan.skipped[0].reason, /bundled-skill.*ships with Worca \(bundle\)/);
  assert.ok(plan.warnings.some((w) => /built-in agent\(s\) not bundled.*planner/.test(w)), plan.warnings.join('\n'));
  assert.deepEqual(plan.written, []);
  assert.equal(plan.validation, null);
  assert.equal(existsSync(pluginDir), false, 'dry-run creates nothing');
});

test('apply writes the folder: unstamped graph, byte-identical agent pair, global skill; no built-in, no bundle skill', async () => {
  const r = await exportWorkflowPlugin({ workflowId, targetDir: pluginDir, repoRoot });
  assert.equal(r.written.length, 5, r.written.join('\n'));
  assert.equal(r.validation.ok, true, JSON.stringify(r.validation.problems));

  const graph = JSON.parse(await readFile(join(pluginDir, 'workflows', 'shared-flow.json'), 'utf8'));
  assert.deepEqual(graph, await exportGraphJson(workflowId), 'exactly the JSON share payload');
  assert.equal('_worca' in graph, false);

  const srcDir = userAgentsDir();
  assert.equal(await readFile(join(pluginDir, 'agents', 'sharedAgent.md'), 'utf8'), await readFile(join(srcDir, 'sharedAgent.md'), 'utf8'));
  assert.equal(await readFile(join(pluginDir, 'agents', 'sharedAgent.meta.json'), 'utf8'), await readFile(join(srcDir, 'sharedAgent.meta.json'), 'utf8'));
  assert.equal(existsSync(join(pluginDir, 'agents', 'planner.md')), false, 'built-ins are never bundled');
  assert.equal(existsSync(join(pluginDir, 'agents', 'planner.meta.json')), false);

  assert.equal(await readFile(join(pluginDir, 'skills', 'shared-skill', 'SKILL.md'), 'utf8'), GLOBAL_SKILL_MD);
  assert.equal(existsSync(join(pluginDir, 'skills', 'bundled-skill')), false, 'a Worca-shipped skill is not bundled');

  const manifest = JSON.parse(await readFile(join(pluginDir, 'worca-cc-plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'my-shared-plugin');
  assert.equal(manifest.version, '0.1.0');
  assert.deepEqual(manifest.engines, { 'worca-cc-api': '>=3 <4' });
  assert.equal(manifest.worca.exports['shared-flow'].workflowId, workflowId);
  assert.equal(manifest.worca.exports['shared-flow'].name, 'Shared Flow');

  // The recipient's gates: validatePluginDir (link) and readPluginWorkflows (import).
  const v = validatePluginDir(pluginDir, { strict: true });
  assert.equal(v.ok, true, v.problems.map((p) => p.message).join('\n'));
  const { ready, skipped } = readPluginWorkflows('my-shared-plugin', pluginDir, { quiet: true });
  assert.deepEqual(skipped, []);
  assert.equal(ready.length, 1);
  assert.equal(ready[0].id, 'wfp_my-shared-plugin_shared-flow');
  assert.equal(ready[0].rowName, 'Shared Flow');
});

test('re-export of an unchanged workflow is an all-no-op and keeps the version', async () => {
  const r = await exportWorkflowPlugin({ workflowId, targetDir: pluginDir, repoRoot });
  assert.deepEqual(r.created, []);
  assert.deepEqual(r.updated, []);
  assert.deepEqual(r.written, []);
  assert.equal(r.noop.length, 5, r.noop.join('\n'));
  assert.equal(r.version, '0.1.0', 'nothing changed => no bump');
});

test('a changed workflow updates the JSON in place, bumps the patch version, and never touches the skill dir', async () => {
  const skillPath = join(pluginDir, 'skills', 'shared-skill', 'SKILL.md');
  await writeFile(skillPath, GLOBAL_SKILL_MD + '\nrecipient-side edit\n', 'utf8');
  const tpl = await readWorkflow(workflowId);
  await writeGraphWorkflow({ ...tpl, name: 'Shared Flow v2' });
  const r = await exportWorkflowPlugin({ workflowId, targetDir: pluginDir, repoRoot });
  const rel = (p) => p.slice(pluginDir.length + 1).split('\\').join('/');
  assert.deepEqual(r.updated.map(rel).sort(), ['worca-cc-plugin.json', 'workflows/shared-flow.json'], 'same filename: the recipient row updates in place');
  assert.deepEqual(r.created, []);
  assert.equal(r.version, '0.1.1');
  assert.equal(await readFile(skillPath, 'utf8'), GLOBAL_SKILL_MD + '\nrecipient-side edit\n', 'an existing skill dir is left alone');
  const manifest = JSON.parse(await readFile(join(pluginDir, 'worca-cc-plugin.json'), 'utf8'));
  assert.equal(manifest.version, '0.1.1');
  assert.equal(manifest.worca.exports['shared-flow'].name, 'Shared Flow v2');
  // keepVersion: the next change lands without a bump.
  await writeGraphWorkflow({ ...(await readWorkflow(workflowId)), name: 'Shared Flow v3' });
  const kept = await exportWorkflowPlugin({ workflowId, targetDir: pluginDir, repoRoot, keepVersion: true });
  assert.equal(kept.version, '0.1.1');
  assert.ok(kept.updated.length >= 1);
});

test('manifest identity: an existing name is adopted, an explicit mismatch is CONFLICT, a bad name is BAD_REQUEST', async () => {
  // Same folder, no --name: the manifest's name wins over the basename (they agree here).
  const adopt = await exportWorkflowPlugin({ workflowId, targetDir: pluginDir, repoRoot, dryRun: true });
  assert.equal(adopt.name, 'my-shared-plugin');
  await assert.rejects(exportWorkflowPlugin({ workflowId, targetDir: pluginDir, pluginName: 'other-name', repoRoot }),
    (e) => e.code === 'CONFLICT' && /pass --name my-shared-plugin/.test(e.message));
  await assert.rejects(exportWorkflowPlugin({ workflowId, targetDir: join(await tmp(), 'Not_Kebab'), repoRoot }),
    (e) => e.code === 'BAD_REQUEST' && /kebab-case/.test(e.message));
  // Folder basename differs from the manifest: still adopted when no --name is passed.
  const other = join(await tmp(), 'some-other-folder');
  await mkdir(other, { recursive: true });
  await writeFile(join(other, 'worca-cc-plugin.json'), JSON.stringify({ name: 'kept-name', version: '2.0.0', engines: { 'worca-cc-api': '>=3 <4' } }) + '\n');
  const r = await exportWorkflowPlugin({ workflowId, targetDir: other, repoRoot, dryRun: true });
  assert.equal(r.name, 'kept-name');
  assert.equal(r.version, '2.0.1', 'a fresh export into an existing plugin is a change => bump');
  await assert.rejects(exportWorkflowPlugin({ workflowId: 'wf_nope', targetDir: other, repoRoot }), (e) => e.code === 'NOT_FOUND');
});

test('round trip: the recipient links the folder, the workflow row and the agent arrive as plugin-owned', async () => {
  // A recipient does not have the user agent. The store's deleteAgent refuses
  // (the saved workflow references it), so drop the pair from the user layer
  // directly — exactly the state a recipient's home is in.
  const srcDir = userAgentsDir();
  await rm(join(srcDir, 'sharedAgent.md'), { force: true });
  await rm(join(srcDir, 'sharedAgent.meta.json'), { force: true });
  assert.equal(loadAgentRegistry().sharedAgent, undefined);
  const linked = await linkPlugin('my-shared-plugin', pluginDir);
  assert.deepEqual(linked.workflows.imported, ['wfp_my-shared-plugin_shared-flow']);
  assert.deepEqual(linked.workflows.skipped, []);
  const row = await readWorkflow('wfp_my-shared-plugin_shared-flow');
  assert.equal(row.origin, 'plugin:my-shared-plugin');
  assert.equal(row.name, 'Shared Flow v3');
  assert.deepEqual(row.nodes, (await exportGraphJson(workflowId)).nodes);
  const meta = loadAgentRegistry().sharedAgent;
  assert.equal(meta && meta.origin, 'plugin:my-shared-plugin');
});

test('another plugin\'s agent is refused — bundling it would create two owners', async () => {
  // The exporter's own workflow now references sharedAgent through the LINKED plugin.
  await assert.rejects(exportWorkflowPlugin({ workflowId, targetDir: join(await tmp(), 'second-plugin'), repoRoot }),
    (e) => e.code === 'UNSUPPORTED' && /"sharedAgent" \(owned by plugin "my-shared-plugin"\)/.test(e.message));
});

test('a stranded workflow (deleted agent) is INVALID_GRAPH with the unknown-agent summary', async () => {
  const tpl = await readWorkflow(workflowId);
  const nodes = tpl.nodes.map((n) => (n.key === 'sharedAgent' ? { ...n, key: 'vanishedAgent' } : n));
  const stranded = await writeGraphWorkflow({ name: 'Stranded', domain: tpl.domain, nodes, wires: tpl.wires });
  await assert.rejects(exportWorkflowPlugin({ workflowId: stranded.id, targetDir: join(await tmp(), 'stranded-plugin'), repoRoot }),
    (e) => e.code === 'INVALID_GRAPH' && /1 agent not installed here \(vanishedAgent\)/.test(e.message) && !!e.summary);
});
