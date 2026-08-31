import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, prepare } from '../src/core/db.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { deleteAgent, createAgent } from '../src/core/agent-store.mjs';
import { referencedPluginAgents } from '../src/core/plugin-workflows.mjs';
import { pluginCurrentDir } from '../src/core/plugins-lock.mjs';

useTempHome(after);

test('deleteAgent refuses when a GRAPH row references the agent', async () => {
  await createAgent({ meta: { key: 'docsy', displayName: 'Docsy', runnerType: 'producer', metaVersion: 2,
    inputs: [{ id: 'plan', type: 'md' }], outputs: [{ id: 'notes', type: 'md', filename: 'n.md' }] },
    markdown: '# Docsy\n' });   // createAgent({ meta, markdown }) — agent-store.mjs:54
  await writeGraphWorkflow({ id: 'wf_uses', name: 'Uses Docsy',
    nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_d', kind: 'agent', key: 'docsy', x: 300, y: 0, config: {} },
      { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
    wires: [] });
  await assert.rejects(() => deleteAgent('docsy'), (e) => {
    assert.equal(e.code, 'REFERENCED');
    assert.match(e.message, /Uses Docsy/);
    return true;
  });
  // `{ includeArchived: true }` is the whole point of the option: an agent held
  // only by an ARCHIVED (unrunnable) template must STILL refuse to delete, or
  // un-archiving later resurrects a broken graph. Drop the option and this half
  // goes green with a deleted agent.
  getDb();
  prepare('UPDATE workflows SET archived_at = ? WHERE id = ?').run('2026-08-27T00:00:00Z', 'wf_uses');
  await assert.rejects(() => deleteAgent('docsy'), (e) => {
    assert.equal(e.code, 'REFERENCED');
    assert.match(e.message, /archived rows count/);
    return true;
  });
});

test('referencedPluginAgents finds a key used only inside a v2 row', async () => {
  // The conflict scan reads `steps`; a plugin agent placed ONLY on a graph node
  // is invisible to it until the SQL selects `graph` and the walk covers nodes[].
  const dir = join(pluginCurrentDir('demo'), 'agents');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'docsy.meta.json'), JSON.stringify({ key: 'docsy' }), 'utf8');
  const rows = referencedPluginAgents('demo');
  assert.deepEqual(rows, [{ workflowId: 'wf_uses', name: 'Uses Docsy', keys: ['docsy'] }]);
});
