// test/ask-workflow-tool.test.mjs — the propose_workflow handler over a fake deps.workflow (spec §8.1, plan PD1/PD17).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAskTools, AskToolError } from '../src/core/ask/tools.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { redactAskText } from '../src/core/ask/redact.mjs';

function fakeTools({ pin = { projectKey: 'demo-00000001' }, propose = null } = {}) {
  const calls = [];
  const tools = createAskTools({
    buildCatalog: async () => ({ projects: [], workspaces: [], workflows: [] }),
    validateProposal: async () => ({ ok: true, card: {} }),
    pinnedScope: () => pin,
    redact: redactAskText, limits: ASK_LIMITS,
    workflow: { propose: propose || (async (o) => { calls.push(o); return { ok: true, mode: o.mode, name: 'N', match: null, warnings: [], summary: 's', shape: { stages: [] }, costUsd: 0, fingerprint: '', note: o.note, thenRun: o.thenRun, projectKey: o.projectKey, projectName: 'Demo' }; }) },
  });
  return { tools, calls };
}

test('propose_workflow: the def is advertised with the documented input keys and no required list', () => {
  const d = fakeTools().tools.list().find((x) => x.name === 'propose_workflow');
  assert.ok(d && d.description.length > 40);
  assert.deepEqual(Object.keys(d.inputSchema.properties).sort(), ['name', 'note', 'projectKey', 'shape', 'task', 'thenRun']);
  assert.equal(d.inputSchema.required, undefined, 'exactly-one-of task|shape is a handler rule, not a schema one (SCHEMA.obj omits an empty required list)');
  assert.equal(d.inputSchema.additionalProperties, false);
});

test('propose_workflow: exactly one of task | shape; projectKey defaults to the pinned PROJECT; clips name/note; thenRun is a strict boolean', async () => {
  const { tools, calls } = fakeTools();
  await assert.rejects(() => tools.call('propose_workflow', {}), { name: 'AskToolError', message: 'propose_workflow: give exactly one of task / shape' });
  await assert.rejects(() => tools.call('propose_workflow', { task: 't', shape: { stages: [] } }), { message: 'propose_workflow: give exactly one of task / shape' });
  const out = await tools.call('propose_workflow', { task: '  fix the login bug  ', name: 'x'.repeat(80), note: 'n'.repeat(300), thenRun: 'yes' });
  assert.equal(out.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, 'task'); assert.equal(calls[0].task, 'fix the login bug'); assert.equal(calls[0].projectKey, 'demo-00000001');
  assert.equal(calls[0].name.length, 60); assert.equal(calls[0].note.length, ASK_LIMITS.workflowNoteMaxChars); assert.equal(calls[0].thenRun, false);
  await tools.call('propose_workflow', { shape: { name: 'S', stages: [{ agent: 'a' }] }, projectKey: 'other-00000002', thenRun: true });
  assert.equal(calls[1].mode, 'shape'); assert.equal(calls[1].projectKey, 'other-00000002'); assert.equal(calls[1].thenRun, true);
  assert.deepEqual(calls[1].shape, { name: 'S', stages: [{ agent: 'a' }] });
});

test('propose_workflow: no pinned project ⇒ projectKey is required (a pinned workspace does not count, D19); an over-long task is refused', async () => {
  const none = fakeTools({ pin: null });
  await assert.rejects(() => none.tools.call('propose_workflow', { task: 't' }), /projectKey is required — no project is pinned/);
  const ws = fakeTools({ pin: { workspaceId: 'wks-team-0000abcd' } });
  await assert.rejects(() => ws.tools.call('propose_workflow', { task: 't' }), /projectKey is required/);
  await assert.rejects(() => fakeTools().tools.call('propose_workflow', { task: 'x'.repeat(ASK_LIMITS.workflowTaskMaxChars + 1) }), /task is longer than 32000 chars/);
});

test('propose_workflow: deps failures surface as AskToolError text the model can act on (never a JSON-RPC error)', async () => {
  const boom = fakeTools({ propose: async () => { throw new Error('invalid workflow shape: stage "s1": unknown agent "e2e-tester"'); } });
  await assert.rejects(() => boom.tools.call('propose_workflow', { task: 't' }), { name: 'AskToolError', message: 'propose_workflow: invalid workflow shape: stage "s1": unknown agent "e2e-tester"' });
  const t = createAskTools({ buildCatalog: async () => ({}), validateProposal: async () => ({}), pinnedScope: () => ({ projectKey: 'p' }), redact: redactAskText, limits: ASK_LIMITS });
  await assert.rejects(() => t.call('propose_workflow', { task: 't' }), { message: 'propose_workflow: unavailable' }, 'no workflow deps ⇒ a clean tool error');
});
