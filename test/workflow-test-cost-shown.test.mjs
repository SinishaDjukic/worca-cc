// test/workflow-test-cost-shown.test.mjs — U-T8 fix round: the highest cost shown ("Cost so far") is kept per workflow,
// so a page closed mid-test leaves nothing behind that grows with the number of tests.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import * as store from '../src/core/workflow-tests/store.mjs';
import { progressOf, costShownSize } from '../src/core/workflow-tests/service.mjs';

const homes = [];
beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-wftcost-'));
  homes.push(home); _resetForTests(); process.env.WORCA_HOME = home;
});
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

const start = (wf, ex) => store.createTestRun({ workflowId: wf, a: 1, b: 'draft', aFp: 'fa', bFp: 'fb', exampleIds: [ex.id], tries: 1, capUsd: 50 });
const shown = (wf, run, usd) => progressOf(wf, run.id, { costOf: () => usd }).costUsd;

test('a second test of the same workflow replaces the entry and starts from its own cost; the map stays bounded by the workflows', () => {
  const before = costShownSize();
  const ex = store.createExample('wf_costa', { name: 'A', request: 'Write.', tries: 1 });
  const first = start('wf_costa', ex);
  assert.deepEqual([shown('wf_costa', first, 2), shown('wf_costa', first, 0.5)], [2, 2], 'the highest so far in the first test');
  assert.equal(costShownSize(), before + 1);
  // The first page is closed and never reads the run again: the next test of the workflow takes its place.
  store.updateTestRun(first.id, { status: 'done' });
  const second = start('wf_costa', ex);
  assert.equal(shown('wf_costa', second, 0.3), 0.3, 'its own cost, not the first test\'s peak');
  assert.equal(shown('wf_costa', second, 0.1), 0.3);
  assert.equal(costShownSize(), before + 1, 'one entry for the workflow, not one per test');
  for (let i = 0; i < 5; i += 1) { store.updateTestRun(second.id, { status: 'done' }); const r = start('wf_costa', ex); shown('wf_costa', r, i); }
  assert.equal(costShownSize(), before + 1);
  const exB = store.createExample('wf_costb', { name: 'B', request: 'Write.', tries: 1 });
  shown('wf_costb', start('wf_costb', exB), 1);
  assert.equal(costShownSize(), before + 2, 'one per workflow');
});
