// test/agent-store.test.mjs — user-agent CRUD over <WORCA_HOME>/.worca-cc/agents.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  listAgents, readAgent, createAgent, updateAgent, deleteAgent,
  keyFromName, userAgentsDir, AGENT_KEY_RE,
} from '../src/core/agent-store.mjs';
import { writeWorkflow, writeGraphWorkflow } from '../src/core/workflows.mjs';

useTempHome(after);

const MD = '# Agent: Docs Writer\n\nYou write docs.\n';
const META = {
  metaVersion: 2, displayName: 'Docs Writer', description: 'writes docs', color: 'green',
  runnerType: 'producer', order: 42,
  inputs: [{ id: 'plan', type: 'md' }],
  outputs: [{ id: 'review', type: 'md', filename: 'docs-review.md' }],
};

test('keyFromName: lower-camel slug', () => {
  assert.equal(keyFromName('API Docs Writer'), 'apiDocsWriter');
  assert.equal(keyFromName('  plan!! '), 'plan');
  assert.equal(keyFromName(''), '');
});

test('createAgent writes the <key>.md + <key>.meta.json pair and lists with origin:user', async () => {
  const { meta, markdown } = await createAgent({ meta: META, markdown: MD });
  assert.equal(meta.key, 'docsWriter');
  assert.equal(meta.origin, 'user');
  assert.equal(meta.agentFile, 'docsWriter.md');
  assert.equal(markdown, MD);
  const onDisk = JSON.parse(await readFile(join(userAgentsDir(), 'docsWriter.meta.json'), 'utf8'));
  assert.equal(onDisk.key, 'docsWriter');
  assert.equal(await readFile(join(userAgentsDir(), 'docsWriter.md'), 'utf8'), MD);
  const all = await listAgents();
  const mine = all.find((m) => m.key === 'docsWriter');
  assert.ok(mine && mine.origin === 'user');
  assert.equal(all.find((m) => m.key === 'planner').origin, 'builtin');
});

test('createAgent rejects a builtin-key collision and an empty markdown', async () => {
  await assert.rejects(
    () => createAgent({ meta: { ...META, key: 'planner' }, markdown: MD }),
    (e) => e.code === 'BUILTIN');
  await assert.rejects(
    () => createAgent({ meta: { ...META, displayName: 'Empty Body' }, markdown: '   ' }),
    (e) => e.code === 'BAD_REQUEST');
  await assert.rejects( // duplicate user key
    () => createAgent({ meta: META, markdown: MD }),
    (e) => e.code === 'DUPLICATE');
});

test('readAgent returns {meta, markdown} for user AND builtin agents', async () => {
  const user = await readAgent('docsWriter');
  assert.equal(user.markdown, MD);
  const builtin = await readAgent('planner');
  assert.equal(builtin.meta.origin, 'builtin');
  assert.match(builtin.markdown, /\w/); // agents/worca-cc-planner.md body loaded
  assert.equal(await readAgent('nope'), null);
});

test('updateAgent edits meta + markdown for user agents; built-ins are 409-coded', async () => {
  const upd = await updateAgent('docsWriter', {
    meta: { ...META, displayName: 'Docs Writer v2' }, markdown: MD + 'More.\n',
  });
  assert.equal(upd.meta.displayName, 'Docs Writer v2');
  assert.equal(upd.meta.key, 'docsWriter'); // key immutable
  assert.equal((await readAgent('docsWriter')).markdown, MD + 'More.\n');
  await assert.rejects(() => updateAgent('planner', { meta: META }), (e) => e.code === 'BUILTIN');
  await assert.rejects(() => updateAgent('ghost', { meta: META }), (e) => e.code === 'NOT_FOUND');
});

test('deleteAgent: 409-coded while referenced by a saved workflow, then removes the pair', async () => {
  const wf = await writeWorkflow({
    name: 'Uses Docs', steps: [[{ id: 's0_0', key: 'docsWriter' }]], feedbacks: [],
  });
  await assert.rejects(() => deleteAgent('docsWriter'), (e) => e.code === 'REFERENCED');
  const { deleteWorkflow } = await import('../src/core/workflows.mjs');
  await deleteWorkflow(wf.id);
  assert.deepEqual(await deleteAgent('docsWriter'), { ok: true });
  assert.equal(await readAgent('docsWriter'), null);
  await assert.rejects(() => deleteAgent('planner'), (e) => e.code === 'BUILTIN');
});

test('AGENT_KEY_RE forecloses path traversal', () => {
  assert.equal(AGENT_KEY_RE.test('../etc'), false);
  assert.equal(AGENT_KEY_RE.test('a/b'), false);
  assert.equal(AGENT_KEY_RE.test('docsWriter'), true);
});

// NOTE: this file is SEQUENTIAL and stateful — the deleteAgent test above
// removed docsWriter, so the gate tests re-create what they need.

test('createAgent 400s with the meta v2 rule text, one rule per broken field', async () => {
  const cases = [
    [{ ...META, metaVersion: undefined, displayName: 'No Version' }, /sidecar requires metaVersion 2/],
    [{ ...META, displayName: 'No Out', outputs: [] }, /at least one output port is required/],
    [{ ...META, displayName: 'Await In', inputs: [{ id: 'await', type: 'md' }] },
      /port id "await" is reserved \u2014 the engine synthesizes the await gate port on every agent node/],
    [{ ...META, displayName: 'Bad Id', inputs: [{ id: 'Plan Two', type: 'md' }] }, /bad port id "Plan Two"/],
    [{ ...META, displayName: 'Dup Id', inputs: [{ id: 'plan', type: 'md' }, { id: 'plan', type: 'json' }] },
      /duplicate port id "plan"/],
    [{ ...META, displayName: 'Too Many', inputs: Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, type: 'md' })) },
      /at most 8 ports per side \(got 9\)/],
    [{ ...META, displayName: 'No Name', outputs: [{ id: 'review', type: 'md' }] },
      /md outputs require a filename template/],
    [{ ...META, displayName: 'Pathy', outputs: [{ id: 'review', type: 'md', filename: 'sub/review.md' }] },
      /must be a plain basename/],
    [{ ...META, displayName: 'Bad Token', outputs: [{ id: 'review', type: 'md', filename: 'r-{nope}.md' }] },
      /uses unknown token\(s\) \{nope\}/],
    [{ ...META, displayName: 'Void Store', outputs: [{ id: 'pass', type: 'void', store: 'run' }] },
      /void ports carry no filename or store/],
    [{ ...META, displayName: 'Verifier', runnerType: 'verifier' }, /runnerType "verifier" requires verdict: \{ filename \}/],
    [{ ...META, displayName: 'Clarifier', runnerType: 'clarifier' }, /runnerType "clarifier" requires at least one json output port/],
    [{ ...META, displayName: 'Blocking', outputs: [{ id: 'review', type: 'md', when: 'blocking', filename: 'r.md' }] },
      /when "blocking" requires the agent to declare verdict: \{ filename \}/],
    [{ ...META, displayName: 'Expands', inputs: [{ id: 'plan', type: 'md', expands: true }] },
      /expands is only legal on json inputs/],
    [{ ...META, displayName: 'As Void', inputs: [{ id: 'plan', type: 'void', as: 'file' }] },
      /as "file" requires a non-void port \(got void\)/],
    [{ ...META, displayName: 'Side', sideEffect: 'yes' }, /sideEffect must be "code" when present/],
    [{ ...META, displayName: 'Strategy', workspaceStrategy: 'wander' }, /workspaceStrategy must be one of explore, task, review/],
    [{ ...META, displayName: 'Variant', workspaceVariantOf: 'reviewer' }, /workspaceVariantOf requires scope "workspace-only"/],
  ];
  for (const [meta, re] of cases) {
    await assert.rejects(() => createAgent({ meta, markdown: MD }), (e) => {
      assert.equal(e.code, 'BAD_REQUEST', `${meta.displayName}: wrong code ${e.code}`);
      assert.match(e.message, re);
      return true;
    }, `${meta.displayName} must be rejected`);
    assert.equal(await readAgent(keyFromName(meta.displayName)), null, 'nothing is written on a rejection');
  }
});

test('updateAgent applies the same gate, and a clean v2 meta still round-trips', async () => {
  await createAgent({ meta: META, markdown: MD });   // re-create docsWriter
  await assert.rejects(
    () => updateAgent('docsWriter', { meta: { ...META, outputs: [] } }),
    (e) => e.code === 'BAD_REQUEST' && /at least one output port is required/.test(e.message));
  const kept = await readAgent('docsWriter');
  assert.deepEqual(kept.meta.outputs.map((p) => p.id), ['review'], 'the rejected save changed nothing');
  const upd = await updateAgent('docsWriter', {
    meta: { ...META, outputs: [{ id: 'review', type: 'md', filename: 'docs-review-v2.md' }] },
  });
  assert.equal(upd.meta.outputs[0].filename, 'docs-review-v2.md');
  assert.equal(upd.meta.metaVersion, 2);
});

test('a complete v2 PUT CLEARS the optional capability surface', async () => {
  // agent-store merges {...existing, ...raw}, so without the V2_CLEARABLE delete
  // every one of these is a ONE-WAY switch: the editor omits a capability when
  // it is off, and the omitted key would keep its stored value forever.
  await updateAgent('docsWriter', { meta: { ...META,
    sideEffect: 'code', placeable: false, scope: 'workspace-only',
    promptHints: 'be terse', requiresSkills: ['mock-skill'], domain: 'coding' } });
  const on = await readAgent('docsWriter');
  assert.equal(on.meta.sideEffect, 'code');
  assert.equal(on.meta.placeable, false);
  assert.equal(on.meta.scope, 'workspace-only');
  // Now save the SAME agent with all of them off (i.e. absent) — exactly what
  // agentFormRead emits when the boxes are cleared.
  const off = await updateAgent('docsWriter', { meta: { ...META } });
  assert.equal(off.meta.sideEffect, undefined, 'sideEffect can be turned OFF');
  assert.equal(off.meta.placeable, undefined, 'placeable:false can be undone');
  assert.equal(off.meta.scope, 'project', 'scope falls back to its default');
  assert.equal(off.meta.promptHints, '');
  assert.deepEqual(off.meta.requiresSkills, []);
  assert.equal(off.meta.domain, 'general');
  // …and a markdown-only PUT still MERGES: it must not clear anything.
  await updateAgent('docsWriter', { meta: { ...META, sideEffect: 'code' } });
  const md = await updateAgent('docsWriter', { markdown: `${MD}\nmore\n` });
  assert.equal(md.meta.sideEffect, 'code', 'a body-only save never touches the capabilities');
  // …and so does a PARTIAL meta PUT — one that does NOT declare metaVersion 2.
  // This is what separates the `metaVersion === 2` gate from a bare `if (rawMeta)`:
  // with the latter, any partial edit would silently wipe every capability.
  const partial = await updateAgent('docsWriter', { meta: { description: 'partial edit' } });
  assert.equal(partial.meta.sideEffect, 'code', 'a partial meta save never clears the capabilities');
  assert.equal(partial.meta.description, 'partial edit');
});

test('an unknown mockRole is a warning, not a 400', async () => {
  const { meta } = await createAgent({
    meta: { ...META, displayName: 'Mocky', mockRole: 'no-such-role' }, markdown: MD,
  });
  assert.equal(meta.mockRole, undefined, 'dropped by the registry');
  await deleteAgent('mocky');
});

test('deleteAgent refuses while a v2 GRAPH or a workspace variant points at the key', async () => {
  await createAgent({ meta: { ...META, displayName: 'Used Agent' }, markdown: MD });
  await writeGraphWorkflow({
    id: 'wf_uses', name: 'Uses It', domain: 'general',
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_a', kind: 'agent', key: 'usedAgent', x: 200, y: 0, config: {} },
      { id: 'n_end', kind: 'end', x: 400, y: 0, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_a', port: 'plan' } },
      { id: 'w2', from: { node: 'n_a', port: 'review' }, to: { node: 'n_end', port: 'result' } },
    ],
  });
  await assert.rejects(() => deleteAgent('usedAgent'), (e) => e.code === 'REFERENCED' && /Uses It/.test(e.message));

  // Only kind:'agent' nodes count. A flow card carrying a stray `key` names no
  // agent, so a key-only walk would make an unused agent permanently undeletable.
  await createAgent({ meta: { ...META, displayName: 'Free Agent' }, markdown: MD });
  await writeGraphWorkflow({
    id: 'wf_flowonly', name: 'Flow Only', domain: 'general',
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {}, key: 'freeAgent' },
      { id: 'n_end', kind: 'end', x: 400, y: 0, config: {}, key: 'freeAgent' },
    ],
    wires: [],
  });
  assert.deepEqual(await deleteAgent('freeAgent'), { ok: true }, 'a flow-card key is not a reference');

  await createAgent({
    meta: { ...META, displayName: 'Variant Agent', scope: 'workspace-only', workspaceVariantOf: 'docsWriter' },
    markdown: MD,
  });
  await assert.rejects(() => deleteAgent('docsWriter'),
    (e) => e.code === 'REFERENCED' && /variantAgent/.test(e.message));
});

// ── MAJ-15 (store half): a port change that strands a saved wire WARNS, never 409s.
// A 409 would make renaming a port impossible — no saved template can reference the
// new port before it exists — so the refusal lives on the run path
// (assertRunnableWorkflow, INVALID_GRAPH) and the editor gets a heads-up here.
test('updateAgent reports the saved pipelines a port change strands, and still saves', async () => {
  await createAgent({
    meta: { ...META, key: 'portee', displayName: 'Portee' },
    markdown: '# Portee\n\nbody\n',
  });
  const clean = await updateAgent('portee', { meta: { ...META, key: 'portee', displayName: 'Portee 2' } });
  assert.deepEqual(clean.warnings, [], 'nothing saved references it yet');
  await writeGraphWorkflow({
    id: 'wf_portee', name: 'Portee Flow', domain: 'general',
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_p', kind: 'agent', key: 'portee', x: 200, y: 0, config: {} },
      { id: 'n_end', kind: 'end', x: 400, y: 0, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_p', port: 'plan' } },
      { id: 'w2', from: { node: 'n_p', port: 'review' }, to: { node: 'n_end', port: 'result' } },
    ],
  });
  const still = await updateAgent('portee', { meta: { ...META, key: 'portee', description: 'same ports' } });
  assert.deepEqual(still.warnings, [], 'an edit that keeps the ports strands nothing');
  const renamed = await updateAgent('portee', {
    meta: {
      ...META, key: 'portee',
      inputs: [{ id: 'brief', type: 'md' }],
      outputs: [{ id: 'verdictOut', type: 'md', filename: 'docs-review.md' }],
    },
  });
  assert.equal(renamed.meta.outputs[0].id, 'verdictOut', 'the rename is SAVED, not refused');
  assert.deepEqual(renamed.warnings, [
    'saved pipelines reference a removed port: Portee Flow (n_p.plan), Portee Flow (n_p.review)',
  ]);
});

// ── MIN-19: a base-agent port edit must not strand its workspace variant ───────
// resolveGraph refuses a workspace run whose variant's port SIGNATURE drifted from
// its base (workflows.mjs portSignature), and the drift happened in the Agents
// view minutes earlier: a run-start failure disconnected from its cause. A variant
// is BY DEFINITION the same ports with a different workspace strategy, so the edit
// propagates. The variant keeps every field the signature deliberately excludes
// (`as`, filename, store) — that is what a variant is allowed to differ in.
const VBASE = {
  metaVersion: 2, displayName: 'Base Guy', runnerType: 'producer', order: 42,
  inputs: [{ id: 'plan', type: 'md' }],
  outputs: [{ id: 'review', type: 'md', filename: 'r.md' }],
};

test('updateAgent propagates a base port change into its workspace variants', async () => {
  const { resolveGraph, writeGraphWorkflow } = await import('../src/core/workflows.mjs');
  const { loadAgentRegistry } = await import('../src/core/agent-registry.mjs');
  await createAgent({ meta: { ...VBASE, key: 'baseGuy' }, markdown: '# b\n\ntext\n' });
  // The variant's own description is EMPTY and its .md carries one, so the registry
  // resolves a DERIVED blurb (descriptionDerived) that no write path may persist.
  await createAgent({
    meta: {
      ...VBASE, key: 'baseGuyWs', displayName: 'Base Guy WS', description: '',
      scope: 'workspace-only', workspaceVariantOf: 'baseGuy',
      outputs: [{ id: 'review', type: 'md', filename: 'ws-r.md', store: 'project' }],
    },
    markdown: '---\ndescription: from md\n---\n# b\n',
  });
  await writeGraphWorkflow({
    id: 'wf_variant', name: 'V', domain: 'general',
    nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_a', kind: 'agent', key: 'baseGuy', x: 200, y: 0, config: {} },
      { id: 'n_end', kind: 'end', x: 400, y: 0, config: {} }],
    wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_a', port: 'plan' } },
      { id: 'w2', from: { node: 'n_a', port: 'review' }, to: { node: 'n_end', port: 'result' } }],
  });
  const wsResolve = async () => (await resolveGraph(process.cwd(), 'wf_variant', loadAgentRegistry(), undefined,
    { isWorkspace: true })).nodes.n_a.key;
  assert.equal(await wsResolve(), 'baseGuyWs', 'baseline: the variant substitutes');

  const out = await updateAgent('baseGuy', {
    meta: {
      ...VBASE, key: 'baseGuy',
      inputs: [{ id: 'plan', type: 'md' }, { id: 'extra', type: 'json', required: false }],
    },
  });
  assert.deepEqual(out.updatedVariants, ['baseGuyWs']);
  assert.deepEqual(out.warnings, []);
  const reg = loadAgentRegistry();
  assert.deepEqual(reg.baseGuyWs.inputs.map((p) => p.id), ['plan', 'extra'], 'the new port reached the variant');
  assert.equal(reg.baseGuyWs.outputs[0].filename, 'ws-r.md', 'the variant keeps its OWN filename');
  assert.equal(reg.baseGuyWs.outputs[0].store, 'project', 'and its own store');
  assert.equal(reg.baseGuyWs.scope, 'workspace-only');
  assert.equal(reg.baseGuyWs.workspaceVariantOf, 'baseGuy');
  assert.equal(reg.baseGuyWs.displayName, 'Base Guy WS', 'identity fields are the variant’s own');
  assert.equal(reg.baseGuyWs.description, 'from md', 'the registry still RESOLVES the .md blurb');
  assert.equal(JSON.parse(await readFile(join(userAgentsDir(), 'baseGuyWs.meta.json'), 'utf8')).description, '',
    'a derived blurb is never baked into the rewritten sidecar');
  assert.equal(await wsResolve(), 'baseGuyWs', 'the workspace run resolves again');
});

test('a base with no variants reports an empty updatedVariants list', async () => {
  await createAgent({ meta: { ...VBASE, key: 'lonelyBase' }, markdown: '# b\n\ntext\n' });
  const out = await updateAgent('lonelyBase', {
    meta: { ...VBASE, key: 'lonelyBase', outputs: [{ id: 'other', type: 'md', filename: 'o.md' }] },
  });
  assert.deepEqual(out.updatedVariants, []);
});
