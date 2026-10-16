// test/diagram-pipeline.test.mjs
// The Diagram → Plan workflow: the V59 seed validates against the shipped sidecars, and a mock
// run with a compressed draw.io attachment goes Task → Clarify → Interpret → Refine → Implement
// → Review → End, with the decoded sibling beside the attachment.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { deflateRawSync } from 'node:zlib';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../src/core/db.mjs';
import { assertRunnableWorkflow } from '../src/core/workflows.mjs';
import { GRAPH_DIAGRAM_WORKFLOW, DIAGRAM_WORKFLOW_ID } from '../src/core/graph/diagram-workflow.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

useTempHome(after);

test('V59 seeds wf_diagram_plan on a fresh DB, and it validates against the shipped sidecars', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  const row = db.prepare('SELECT * FROM workflows WHERE id = ?').get(DIAGRAM_WORKFLOW_ID);
  assert.ok(row, 'seeded');
  assert.equal(row.name, 'Diagram → Plan');
  assert.equal(row.domain, 'coding');
  const graph = JSON.parse(row.graph);
  assert.deepEqual(graph.nodes.map((n) => n.id), GRAPH_DIAGRAM_WORKFLOW.nodes.map((n) => n.id));
  assert.equal(graph.nodes.find((n) => n.id === 'n_interpret').key, 'diagramInterpreter');
  assertRunnableWorkflow({ id: row.id, version: 2, nodes: graph.nodes, wires: graph.wires });
  db.close();
});

test('the seed is one-shot: a user who deleted wf_diagram_plan does not get it back on a later bump', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.prepare('DELETE FROM workflows WHERE id = ?').run(DIAGRAM_WORKFLOW_ID);
  db.exec('PRAGMA user_version = 59');
  migrate(db);
  assert.equal(db.prepare('SELECT 1 FROM workflows WHERE id = ?').get(DIAGRAM_WORKFLOW_ID), undefined);
  db.close();
});

test('wf_diagram_plan runs offline end to end on a compressed draw.io attachment', { timeout: 120000 }, async () => {
  const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="2" value="Validate order" vertex="1" parent="0"/></root></mxGraphModel>';
  const src = mkdtempSync(join(tmpdir(), 'diagram-run-'));
  const drawio = join(src, 'order.drawio');
  writeFileSync(drawio, `<mxfile><diagram name="Page-1">${deflateRawSync(Buffer.from(encodeURIComponent(xml))).toString('base64')}</diagram></mxfile>`);

  const orch = createOrchestrator({
    projectDir: gitDir('diagram'), workflowId: DIAGRAM_WORKFLOW_ID, prompt: 'implement the attached flow',
    extras: [drawio], claude: { mock: true }, auto: true,
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  const st = orch.getState();
  assert.equal(st.endReached, true);
  const ran = new Set(st.steps.map((s) => s.nodeId).filter(Boolean));
  for (const n of ['n_clarify', 'n_interpret', 'n_refine', 'n_impl', 'n_review']) assert.ok(ran.has(n), `${n} ran`);
  assert.ok(existsSync(join(orch.pipeline.dir, 'extras', 'order.drawio.decoded.xml')), 'decoded sibling attached');
});
