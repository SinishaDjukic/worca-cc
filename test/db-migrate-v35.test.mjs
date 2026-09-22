// test/db-migrate-v35.test.mjs
// v35 = Opus 5.5 replaces Opus 5 in PREDEFINED_MODELS — V26's catalog swap
// (test/db-migrate-v26.test.mjs) again. The ladder step moves every stored pin
// on `claude-opus-5` to `claude-opus-5-5` — config_workflow_nodes.model, the
// per-role project_config.steps JSON and node defaults inside workflows.graph —
// and leaves everything else byte-identical.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, SCHEMA_VERSION, _resetForTests } from '../src/core/db.mjs';

useTempHome(after);

const NOW = '2026-09-22T00:00:00.000Z';
const BROKEN = 'not json, but it mentions claude-opus-5';

test('a DB stamped exactly 34 has every claude-opus-5 pin moved to claude-opus-5-5 by the ladder', () => {
  let db = getDb();                       // fresh DB at SCHEMA_VERSION
  assert.ok(SCHEMA_VERSION >= 35, 'the v35 step is on the ladder');

  const node = db.prepare('INSERT INTO config_workflow_nodes (project_key, workflow_id, node_id, model, effort) VALUES (?, ?, ?, ?, ?)');
  node.run('p1', 'wf', 'n_a', 'claude-opus-5', 'max');
  node.run('p1', 'wf', 'n_b', 'Claude-Opus-5', 'xhigh');    // ids compare case-insensitively everywhere in config.mjs
  node.run('p1', 'wf', 'n_c', 'claude-opus-4-8', 'high');   // a sibling Opus: untouched
  node.run('p1', 'wf', 'n_d', 'claude-opus-5-5', 'high');   // already on the successor: untouched
  node.run('p1', 'wf', 'n_e', null, 'high');                 // effort-only row: untouched
  db.prepare('INSERT INTO project_config (project_key, steps, extra) VALUES (?, ?, ?)').run('p1',
    JSON.stringify({
      planner: { model: 'claude-opus-5', effort: 'max' },
      implementer: { model: 'claude-sonnet-5', effort: 'xhigh' },
      reviewer: { subagentModel: 'opus' },                   // the alias enum is NOT a catalog id
    }),
    '{"webUiTesting":true}');
  const wf = db.prepare('INSERT INTO workflows (id, name, version, steps, feedbacks, created_at, updated_at, graph) VALUES (?, ?, 2, ?, ?, ?, ?, ?)');
  wf.run('wf_pinned', 'Pinned', '[]', '[]', NOW, NOW, JSON.stringify({
    nodes: [
      { id: 'n1', kind: 'agent', key: 'planner', config: { model: 'claude-opus-5', effort: 'max' } },
      { id: 'n2', kind: 'agent', key: 'reviewer', config: { model: 'claude-opus-5-5' } },
      { id: 'n3', kind: 'end' },
    ],
    wires: [],
  }));
  wf.run('wf_broken', 'Broken', '[]', '[]', NOW, NOW, BROKEN);

  db.exec('PRAGMA user_version = 34');
  _resetForTests();

  db = getDb();                           // migrate() takes the 34 -> 35 ladder
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);

  const nodes = db.prepare('SELECT node_id, model, effort FROM config_workflow_nodes ORDER BY node_id').all()
    .map(({ node_id, model, effort }) => ({ node_id, model, effort }));
  assert.deepEqual(nodes, [
    { node_id: 'n_a', model: 'claude-opus-5-5', effort: 'max' },
    { node_id: 'n_b', model: 'claude-opus-5-5', effort: 'xhigh' },
    { node_id: 'n_c', model: 'claude-opus-4-8', effort: 'high' },
    { node_id: 'n_d', model: 'claude-opus-5-5', effort: 'high' },
    { node_id: 'n_e', model: null, effort: 'high' },
  ]);

  const p1 = db.prepare('SELECT steps, extra FROM project_config WHERE project_key = ?').get('p1');
  assert.deepEqual(JSON.parse(p1.steps), {
    planner: { model: 'claude-opus-5-5', effort: 'max' },
    implementer: { model: 'claude-sonnet-5', effort: 'xhigh' },
    reviewer: { subagentModel: 'opus' },
  });
  assert.equal(p1.extra, '{"webUiTesting":true}', 'sibling columns are untouched');

  const graph = JSON.parse(db.prepare('SELECT graph FROM workflows WHERE id = ?').get('wf_pinned').graph);
  assert.deepEqual(graph.nodes.map((n) => n.config && n.config.model), ['claude-opus-5-5', 'claude-opus-5-5', undefined]);
  assert.equal(db.prepare('SELECT graph FROM workflows WHERE id = ?').get('wf_broken').graph, BROKEN);
});
