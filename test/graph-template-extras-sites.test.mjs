// test/graph-template-extras-sites.test.mjs — session membership and settings survive every copy of a template.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { writeGraphWorkflow, readWorkflow, setWorkflowNodeDefaults } from '../src/core/workflows.mjs';
import { exportGraphJson, importGraphWorkflow } from '../src/core/workflow-share.mjs';
import { readPluginWorkflows } from '../src/core/plugin-workflows.mjs';
import { buildGraphManifest, manifestTemplate } from '../src/shared/graph/manifest.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { realRegistryIndex, realScriptIndex } from './helpers/graph-ports.mjs';
import { getDb } from '../src/core/db.mjs';

useTempHome(after);
const SID = 's_k3f9a2b1';
const SETTINGS = { [SID]: { label: 'Build and review', hostEffort: 'low' } };
function grouped() {
  const t = structuredClone(SEED_TEMPLATES.find((s) => s.id === 'wf_quick-fix'));   // SEED_TEMPLATES is deep-frozen
  for (const id of ['n_impl', 'n_review']) t.nodes.find((n) => n.id === id).config.session = SID;
  return { ...t, sessions: structuredClone(SETTINGS), codeGraph: false };
}
const member = (t, id) => t.nodes.find((n) => n.id === id).config.session;

test('DB write and read keep membership, settings and codeGraph', async () => {
  await writeGraphWorkflow({ ...grouped(), id: 'wf_sess_db', name: 'Sess DB' });
  const r = await readWorkflow('wf_sess_db');
  assert.equal(member(r, 'n_impl'), SID);
  assert.deepEqual(r.sessions, SETTINGS);
  assert.equal(r.codeGraph, false);
});

test('setWorkflowNodeDefaults keeps sessions and codeGraph (it dropped codeGraph before)', async () => {
  await writeGraphWorkflow({ ...grouped(), id: 'wf_sess_def', name: 'Sess Def' });
  await setWorkflowNodeDefaults('wf_sess_def', { n_impl: { model: 'claude-opus-5-5' } });
  const r = await readWorkflow('wf_sess_def');
  assert.equal(member(r, 'n_impl'), SID, 'session is topology, not a tunable');
  assert.equal(r.nodes.find((n) => n.id === 'n_impl').config.model, 'claude-opus-5-5');
  assert.deepEqual(r.sessions, SETTINGS);
  assert.equal(r.codeGraph, false);
});

test('export then import keeps membership and settings', async () => {
  await writeGraphWorkflow({ ...grouped(), id: 'wf_sess_exp', name: 'Sess Exp' });
  const json = await exportGraphJson('wf_sess_exp');
  assert.deepEqual(json.sessions, SETTINGS);
  assert.equal(json.codeGraph, false);
  const { workflow } = await importGraphWorkflow(json, { name: 'Sess Imported', registry: realRegistryIndex() });
  assert.equal(member(workflow, 'n_review'), SID);
  assert.deepEqual(workflow.sessions, SETTINGS);
  assert.deepEqual((await readWorkflow(workflow.id)).sessions, SETTINGS);
});

test('import refuses a 5-member session with V26', async () => {
  await writeGraphWorkflow({ ...grouped(), id: 'wf_sess_five', name: 'Sess Five' });
  const five = await exportGraphJson('wf_sess_five');
  five.nodes.push(...['a', 'b', 'c'].map((s, i) => ({ id: `n_x${s}`, kind: 'agent', key: 'reviewer', x: 1500 + i * 300, y: 198, config: { session: SID } })));
  // importGraphWorkflow throws err('invalid graph', 'INVALID_GRAPH', { errors }): the codes live on e.errors, not in the message.
  await assert.rejects(importGraphWorkflow(five, { name: 'Five', registry: realRegistryIndex() }),
    (e) => e.code === 'INVALID_GRAPH' && e.errors.some((i) => i.code === 'V26' && i.sessionId === SID));
});

test('plugin workflows/*.json keep sessions and codeGraph', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-sess-plugin-'));
  mkdirSync(join(dir, 'workflows'));
  const { id, ...body } = grouped();
  writeFileSync(join(dir, 'workflows', 'sess.json'), JSON.stringify({ ...body, name: 'Sess Plugin' }));
  const { ready, skipped } = readPluginWorkflows('p', dir, { registry: realRegistryIndex(), scripts: realScriptIndex(), quiet: true });
  assert.deepEqual(skipped, []);
  assert.deepEqual(ready[0].graph.sessions, SETTINGS);
  assert.equal(ready[0].graph.codeGraph, false);
});

test('the run manifest carries sessions and manifestTemplate restores them (the only copy a resumed run has)', () => {
  const m = buildGraphManifest(grouped(), realRegistryIndex());
  assert.deepEqual(m.sessions, SETTINGS);
  assert.equal(m.codeGraph, false);
  assert.equal('canvas' in m, false);
  const back = manifestTemplate(m);
  assert.deepEqual(back.sessions, SETTINGS);
  assert.equal(member(back, 'n_impl'), SID);
  assert.equal('sessions' in manifestTemplate(buildGraphManifest(structuredClone(SEED_TEMPLATES.find((s) => s.id === 'wf_quick-fix')), realRegistryIndex())), false, 'ungrouped manifests are unchanged');
});

test('REVIEW FOCUS 4 — an older worca that saves the row without `sessions` keeps membership; settings fall back', async () => {
  await writeGraphWorkflow({ ...grouped(), id: 'wf_sess_old', name: 'Sess Old' });
  const row = getDb().prepare('SELECT graph FROM workflows WHERE id = ?').get('wf_sess_old');
  const g = JSON.parse(row.graph);
  delete g.sessions;                                   // what an older writer's {nodes, wires, canvas?} copy does
  getDb().prepare('UPDATE workflows SET graph = ? WHERE id = ?').run(JSON.stringify(g), 'wf_sess_old');
  const r = await readWorkflow('wf_sess_old');
  assert.equal(member(r, 'n_impl'), SID);
  assert.equal(member(r, 'n_review'), SID);
  assert.equal(r.sessions, undefined);
});

test('REVIEW FOCUS 4 — the seed refresh of a pristine seed row keeps membership, settings and codeGraph', async () => {
  const { mergeShippedSeed } = await import('../src/core/db.mjs');
  const seedT = SEED_TEMPLATES.find((s) => s.id === 'wf_quick-fix');
  const stored = { nodes: structuredClone(seedT.nodes), wires: structuredClone(seedT.wires).slice(0, -1), codeGraph: false,
    sessions: structuredClone(SETTINGS), canvas: { x: 40, y: 12, scale: 0.8 } };
  for (const id of ['n_impl', 'n_review']) stored.nodes.find((n) => n.id === id).config.session = SID;
  stored.nodes.find((n) => n.id === 'n_task').config.session = SID;             // not an agent in the shipped shape: not carried
  const out = mergeShippedSeed(stored, seedT);                                  // the pure merge refreshShippedSeed writes
  assert.equal(out.nodes.find((n) => n.id === 'n_impl').config.session, SID);
  assert.equal('session' in out.nodes.find((n) => n.id === 'n_task').config, false);
  assert.deepEqual(out.sessions, SETTINGS);
  assert.equal(out.codeGraph, false);
  assert.deepEqual(out.canvas, { x: 40, y: 12, scale: 0.8 }, 'the stored viewport is kept verbatim (db-migrate-v41 pins it)');
  assert.deepEqual(Object.keys(mergeShippedSeed({ nodes: structuredClone(seedT.nodes), wires: [] }, seedT)), ['nodes', 'wires'], 'an ungrouped row writes the same keys as before');
});

test('guard: no copy site spells the extras by hand any more', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  for (const rel of ['src/core/workflows.mjs', 'src/core/workflow-share.mjs', 'src/core/plugin-workflows.mjs', 'src/shared/graph/manifest.mjs', 'src/core/db.mjs']) {
    const src = readFileSync(join(root, rel), 'utf8');
    assert.doesNotMatch(src, /codeGraph === false/, `${rel} spells codeGraph by hand`);
    assert.match(src, /pickTemplateExtras/, `${rel} uses the picker`);
  }
});
