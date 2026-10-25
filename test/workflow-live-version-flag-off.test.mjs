// test/workflow-live-version-flag-off.test.mjs — D9: with workflowTests off, runs ignore live_version_no.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeGraphWorkflow, readRunnableWorkflow } from '../src/core/workflows.mjs';
import { insertVersionTx, setLiveVersionTx } from '../src/core/workflow-revisions.mjs';
import { getDb, tx, _resetForTests } from '../src/core/db.mjs';

const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wfoff-'));
_resetForTests(); process.env.WORCA_HOME = dir; delete process.env.WORCA_FLAGS;
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await rm(dir, { recursive: true, force: true }); });

test('flag off: the row runs even with a version in use', async () => {
  await writeGraphWorkflow({ id: 'wf_off', name: 'Off', nodes: [{ id: 'n_task', kind: 'task', config: {} }], wires: [] });
  const row = getDb().prepare('SELECT * FROM workflows WHERE id = ?').get('wf_off');
  tx(() => { setLiveVersionTx('wf_off', insertVersionTx(row, { parts: [], fingerprint: 'f' })); });
  await writeGraphWorkflow({ id: 'wf_off', name: 'Off draft', nodes: [{ id: 'n_task', kind: 'task', config: {} }], wires: [] });
  assert.equal((await readRunnableWorkflow('wf_off')).name, 'Off draft');
});
