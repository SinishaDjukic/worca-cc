// test/db-migrate-v26.test.mjs
// v26 = Fable 5.1 replaces Fable 5 in PREDEFINED_MODELS. A pin left on the
// retired id would render as "(default model)" in every picker (its option is
// gone) and be rejected on the next write (`unknown model "claude-fable-5"`),
// while the run itself kept passing the old id to `claude --model`. The ladder
// step moves every stored pin to the successor — config_workflow_nodes.model,
// the per-role project_config.steps JSON and node defaults inside
// workflows.graph — and leaves everything else byte-identical.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, SCHEMA_VERSION, _resetForTests } from '../src/core/db.mjs';

useTempHome(after);

const NOW = '2026-09-01T00:00:00.000Z';
const BROKEN = 'not json, but it mentions claude-fable-5';
const WRONG_SHAPE = JSON.stringify({ nodes: 'claude-fable-5' });

test('a DB stamped exactly 25 has every claude-fable-5 pin moved to claude-fable-5-1 by the ladder', () => {
  let db = getDb();                       // fresh DB at SCHEMA_VERSION
  assert.ok(SCHEMA_VERSION >= 26, 'the v26 step is on the ladder');

  // Seed a faithful v25 DB: pins on the retired id beside pins that must not move.
  const node = db.prepare('INSERT INTO config_workflow_nodes (project_key, workflow_id, node_id, model, effort) VALUES (?, ?, ?, ?, ?)');
  node.run('p1', 'wf', 'n_a', 'claude-fable-5', 'max');
  node.run('p1', 'wf', 'n_b', 'Claude-Fable-5', 'xhigh');   // ids compare case-insensitively everywhere in config.mjs
  node.run('p1', 'wf', 'n_c', 'claude-opus-5', 'high');
  node.run('p1', 'wf', 'n_d', 'claude-fable-5-1', 'high');  // already on the successor: untouched
  node.run('p1', 'wf', 'n_e', null, 'high');                 // effort-only row: untouched
  db.prepare('INSERT INTO project_config (project_key, steps, extra) VALUES (?, ?, ?)').run('p1',
    JSON.stringify({
      planner: { model: 'claude-fable-5', effort: 'max' },
      implementer: { model: 'claude-opus-5', effort: 'xhigh' },
      reviewer: { subagentModel: 'fable' },                  // the alias enum is NOT a catalog id
    }),
    '{"webUiTesting":true}');
  db.prepare('INSERT INTO project_config (project_key, steps) VALUES (?, ?)').run('p2', '{"planner":{"model":"claude-fable-5"');  // truncated JSON
  const wf = db.prepare('INSERT INTO workflows (id, name, version, steps, feedbacks, created_at, updated_at, graph) VALUES (?, ?, 2, ?, ?, ?, ?, ?)');
  wf.run('wf_pinned', 'Pinned', '[]', '[]', NOW, NOW, JSON.stringify({
    nodes: [
      { id: 'n1', kind: 'agent', key: 'planner', config: { model: 'claude-fable-5', effort: 'max' } },
      { id: 'n2', kind: 'agent', key: 'reviewer', config: {} },
      { id: 'n3', kind: 'end' },
    ],
    wires: [],
  }));
  wf.run('wf_broken', 'Broken', '[]', '[]', NOW, NOW, BROKEN);
  wf.run('wf_shape', 'Wrong shape', '[]', '[]', NOW, NOW, WRONG_SHAPE);

  db.exec('PRAGMA user_version = 25');
  _resetForTests();

  db = getDb();                           // migrate() takes the 25 -> 26 ladder
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);

  const nodes = db.prepare('SELECT node_id, model, effort FROM config_workflow_nodes ORDER BY node_id').all()
    .map(({ node_id, model, effort }) => ({ node_id, model, effort }));   // plain objects: strict deep-equal checks prototypes
  assert.deepEqual(nodes, [
    { node_id: 'n_a', model: 'claude-fable-5-1', effort: 'max' },
    { node_id: 'n_b', model: 'claude-fable-5-1', effort: 'xhigh' },
    { node_id: 'n_c', model: 'claude-opus-5', effort: 'high' },
    { node_id: 'n_d', model: 'claude-fable-5-1', effort: 'high' },
    { node_id: 'n_e', model: null, effort: 'high' },
  ]);

  const p1 = db.prepare('SELECT steps, extra FROM project_config WHERE project_key = ?').get('p1');
  assert.deepEqual(JSON.parse(p1.steps), {
    planner: { model: 'claude-fable-5-1', effort: 'max' },
    implementer: { model: 'claude-opus-5', effort: 'xhigh' },
    reviewer: { subagentModel: 'fable' },
  });
  assert.equal(p1.extra, '{"webUiTesting":true}', 'sibling columns are untouched');
  assert.equal(db.prepare('SELECT steps FROM project_config WHERE project_key = ?').get('p2').steps,
    '{"planner":{"model":"claude-fable-5"', 'unparseable JSON is left exactly as found, and does not take the ladder down');

  const graph = JSON.parse(db.prepare('SELECT graph FROM workflows WHERE id = ?').get('wf_pinned').graph);
  assert.deepEqual(graph.nodes.map((n) => n.config && n.config.model), ['claude-fable-5-1', undefined, undefined]);
  assert.deepEqual(graph.wires, []);
  assert.equal(db.prepare('SELECT graph FROM workflows WHERE id = ?').get('wf_broken').graph, BROKEN);
  assert.equal(db.prepare('SELECT graph FROM workflows WHERE id = ?').get('wf_shape').graph, WRONG_SHAPE);
});
