// test/workflow-code-graph.test.mjs — a workflow's `codeGraph: false` opt-out (skip the per-run
// graphify build) survives the store and the JSON share format; absent stays absent.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { writeGraphWorkflow, readWorkflow } from '../src/core/workflows.mjs';
import { exportGraphJson } from '../src/core/workflow-share.mjs';

useTempHome(after);

const graph = (extra = {}) => ({
  name: 'Quick fix', version: 2, domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_end', kind: 'end', x: 200, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_end', port: 'result' } }],
  ...extra,
});

test('codeGraph:false round-trips through save, read and JSON export; a re-save without it clears it', async () => {
  const saved = await writeGraphWorkflow(graph({ codeGraph: false }));
  assert.equal(saved.codeGraph, false);
  assert.equal((await readWorkflow(saved.id)).codeGraph, false);
  assert.equal((await exportGraphJson(saved.id)).codeGraph, false);

  await writeGraphWorkflow(graph({ id: saved.id }));
  const plain = await readWorkflow(saved.id);
  assert.equal('codeGraph' in plain, false);
  assert.equal('codeGraph' in await exportGraphJson(saved.id), false);
});
