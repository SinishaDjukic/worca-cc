// test/ui-run-rerun.test.mjs — the pure half of Rerun (ui/public/run-rerun.mjs): the menu gate, the prefill the New run
// form opens with, the notes under it and the "Rerun of …" link model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rerunGate, rerunPrefill, rerunNotes, rerunLinkModel } from '../ui/public/run-rerun.mjs';

const ENDED = ['done', 'stopped', 'error'];
const STORED = ['created', 'starting', 'running', 'pausing', 'paused', 'interrupted', 'done', 'stopped', 'error'];

test('rerunGate: enabled for an ended run that is not live, disabled with a reason otherwise', () => {
  for (const status of STORED) {
    const g = rerunGate({ status, live: false, hasRecord: true });
    assert.equal(g.offered, true);
    if (ENDED.includes(status)) {
      assert.equal(g.disabled, false, status);
      assert.equal(g.reason, '');
      assert.equal(g.hint, '');
    } else {
      assert.equal(g.disabled, true, status);
      assert.match(g.reason, /^Rerun is available once the run has ended\./);
      assert.equal(g.hint, 'after it ends');
    }
  }
  for (const status of ENDED) assert.equal(rerunGate({ status, live: true, hasRecord: true }).disabled, true, `${status} while live`);
});

test('rerunGate: interrupted and paused point at Resume; no record means not offered', () => {
  for (const status of ['interrupted', 'paused']) assert.match(rerunGate({ status, live: false, hasRecord: true }).reason, /Use Resume to continue it\.$/);
  assert.doesNotMatch(rerunGate({ status: 'running', live: true, hasRecord: true }).reason, /Resume/);
  assert.equal(rerunGate({ status: 'done', live: false, hasRecord: false }).offered, false);
});

const PAYLOAD = {
  runId: 'abc12345', label: 'Fix login',
  prompt: 'fix login', title: 'Fix login',
  target: { kind: 'project', ref: 'api-12345678', projectDir: '/a/api', workspaceId: null },
  setup: { workflowId: 'wf_default', engine: 'claude', guardrailsId: 'g1', sourceBranch: 'dev', sameAsSource: false, tags: ['t'], mock: true, nightMode: true },
  broken: [{ item: 'model', ref: 'n_plan', message: 'gone', reset: true }],
  extras: [{ name: 'a.md', available: true }, { name: 'gone.md', available: false }, { name: 'big.bin', available: true }],
  extrasLost: false,
};

test('rerunPrefill maps the payload onto the form prefill and leaves out files that were not fetched', () => {
  const p = rerunPrefill(PAYLOAD, [{ name: 'a.md', dataBase64: 'QQ==' }, { name: 'big.bin', error: 'too-large' }]);
  assert.equal(p.prompt, 'fix login');
  assert.equal(p.title, 'Fix login');
  assert.equal(p.target, 'project');
  assert.equal(p.projectDir, '/a/api');
  assert.equal(p.workspaceId, undefined);
  assert.equal(p.workflowId, 'wf_default');
  assert.equal(p.guardrailsId, 'g1');
  assert.equal(p.engine, 'claude');
  assert.equal(p.sourceBranch, 'dev');
  assert.equal(p.sameAsSource, false);
  assert.deepEqual(p.tags, ['t']);
  assert.deepEqual(p.extras, [{ name: 'a.md', dataBase64: 'QQ==' }]);
  assert.deepEqual(p.rerun, { runId: 'abc12345', label: 'Fix login', setup: PAYLOAD.setup, broken: PAYLOAD.broken, missing: ['gone.md', 'big.bin'], extrasLost: false, restored: [], lost: [] });
});

test('rerunPrefill: a workspace target sets workspaceId; a gone project leaves the target empty; no setup means null', () => {
  const ws = rerunPrefill({ ...PAYLOAD, target: { kind: 'workspace', ref: 'ws_1', projectDir: null, workspaceId: 'ws_1' } }, []);
  assert.equal(ws.target, 'workspace');
  assert.equal(ws.workspaceId, 'ws_1');
  assert.equal(ws.projectDir, undefined);
  const gone = rerunPrefill({ ...PAYLOAD, target: { kind: 'project', ref: 'api-12345678', projectDir: null, workspaceId: null } }, []);
  assert.equal(gone.projectDir, undefined);
  assert.equal(gone.workspaceId, undefined);
  const bare = rerunPrefill({ ...PAYLOAD, setup: null }, []);
  assert.equal(bare.workflowId, undefined);
  assert.equal(bare.rerun.setup, null);
  assert.equal(bare.prompt, 'fix login');
});

test('rerunPrefill: a run with no recorded setup gets the workflow and guardrails it recorded elsewhere, and names what is gone', () => {
  const p = rerunPrefill({ ...PAYLOAD, setup: null, recovered: { workflowId: 'wf_production-sanity-check', guardrailsId: 'normal' }, lost: [] }, []);
  assert.equal(p.workflowId, 'wf_production-sanity-check');
  assert.equal(p.guardrailsId, 'normal');
  assert.equal(p.engine, undefined, 'nothing else is guessed');
  assert.equal(p.rerun.setup, null, 'the form still holds no setup: budgets and agents stay the target defaults');
  assert.deepEqual([p.rerun.restored, p.rerun.lost], [['workflow', 'guardrail set'], []]);
  const gone = rerunPrefill({ ...PAYLOAD, setup: null, recovered: { guardrailsId: 'normal' }, lost: ['workflow "Old check"'] }, []);
  assert.equal(gone.workflowId, undefined);
  assert.deepEqual([gone.rerun.restored, gone.rerun.lost], [['guardrail set'], ['workflow "Old check"']]);
  // A recorded setup wins: a stray recovered block is ignored.
  const full = rerunPrefill({ ...PAYLOAD, recovered: { workflowId: 'wf_other' }, lost: ['x'] }, []);
  assert.deepEqual([full.workflowId, full.rerun.restored, full.rerun.lost], ['wf_default', [], []]);
});

test('rerunNotes: missing files by name, the archive note and the unrecorded-settings note', () => {
  assert.deepEqual(rerunNotes({ missing: [], extrasLost: false, setupMissing: false }), []);
  assert.deepEqual(rerunNotes({ missing: ['a.md', 'b.md'], extrasLost: false, setupMissing: false }),
    ['Not attached (no longer available or too large): a.md, b.md']);
  assert.deepEqual(rerunNotes({ missing: [], extrasLost: true, setupMissing: false }),
    ['Files attached to the earlier run were removed when it was archived']);
  assert.deepEqual(rerunNotes({ missing: [], extrasLost: false, setupMissing: true }),
    ['Settings of the earlier run were not recorded; defaults used.']);
  assert.deepEqual(rerunNotes({ setupMissing: true, restored: ['workflow', 'guardrail set'] }),
    ['Settings of the earlier run were not recorded; its workflow and guardrail set were restored, other settings are defaults.']);
  assert.deepEqual(rerunNotes({ setupMissing: true, restored: ['guardrail set'], lost: ['workflow "Old check"'] }),
    ['Settings of the earlier run were not recorded; its guardrail set was restored, other settings are defaults.',
      'No longer available, defaults used instead: workflow "Old check"']);
});

test('rerunLinkModel: a link while the source exists, plain text once it is gone', () => {
  assert.deepEqual(rerunLinkModel({ id: 'abc12345', key: 'api-12345678', title: 'Fix login', exists: true }),
    { text: 'Rerun of Fix login', href: '#history/api-12345678/abc12345' });
  assert.deepEqual(rerunLinkModel({ id: 'abc12345', key: 'workspaces/wk1', title: '', exists: true }),
    { text: 'Rerun of abc12345', href: '#history/workspaces/wk1/abc12345' });
  assert.deepEqual(rerunLinkModel({ id: 'abc12345', key: 'api-12345678', title: 'Fix login', exists: false }),
    { text: 'Copied from a run that no longer exists', href: null });
  assert.equal(rerunLinkModel(null), null);
});
