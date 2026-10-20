// test/ask-scope-gate.test.mjs — P4 (CONTRACT §4): project-bound acting tools act only on the chat's scope.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';
import { createAskTools } from '../src/core/ask/tools.mjs';
import { scopeRefusalText as refuse } from '../src/core/ask/scope.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';

const AA = 'aa-0000aaaa'; const BB = 'bb-0000bbbb'; const CC = 'cc-0000cccc'; const WS = 'wks-ab-0000abcd';
const CATALOG = { projects: [AA, BB, CC].map((key) => ({ key, name: key.slice(0, 2), path: `/p/${key}` })), workspaces: [{ id: WS, name: 'AB', projectKeys: [AA, BB] }], workflows: [] };
const P = (projectKey) => ({ projectKey });

function gated(scope, { chat = true } = {}) {
  const seen = [];
  const ok = (type) => async (input) => { seen.push([type, input]); return { ok: true, card: { type } }; };
  const tools = createAskTools({
    limits: ASK_LIMITS, redact: (s) => s, buildCatalog: async () => CATALOG,
    ...(chat ? { pinnedScope: () => scope } : {}),
    validateProposal: ok('run'),
    workflow: { propose: async (o) => { seen.push(['workflow', o]); return { ok: true, mode: o.mode }; } },
    memory: { projectByKey: async (key) => ({ key, name: key, path: `/p/${key}` }), list: async (s) => { seen.push(['list', s]); return []; },
      read: async () => null, remember: async (s) => { seen.push(['remember', s]); return { created: true, bytes: 1 }; }, forget: async () => true },
    metrics: { validateChange: ok('metrics') }, policy: { validateChange: ok('policy') }, away: { validateChange: ok('away') },
    actions: { validateChange: ok('actions') }, workspaceChanges: { validateChange: ok('workspace') },
    chatActions: { settings: { check: async (r) => { seen.push(['setting', r]); return { ok: true, def: { id: r.id, scope: r.scope }, project: r.projectKey ? { key: r.projectKey } : null, value: r.value, before: { text: 'a' }, after: { text: 'b' } }; } } },
  });
  return { tools, seen };
}

test('the scope gate: acting tools refuse a project or workspace outside the chat scope; nothing named takes the scope (No project → noProject for propose_run); reads stay open; no reader = no chat = no gate', async () => {
  await checkRows([
    { name: 'propose_run in No project: nothing named → noProject:true; a named project is refused, never validated', run: async () => {
      const { tools, seen } = gated(null);
      assert.deepEqual(await tools.call('propose_run', { brief: 'x' }), { ok: true, card: { type: 'run' } });
      assert.deepEqual(seen[0], ['run', { brief: 'x', noProject: true }]);
      assert.deepEqual(await tools.call('propose_run', { brief: 'x', projectKey: AA }), { ok: false, errors: [refuse(null, P(AA))] });
      assert.equal(seen.length, 1);
    } },
    { name: 'propose_run in a project chat: nothing named → the project; noProject:true passes; another project or a workspace is refused', run: async () => {
      const { tools, seen } = gated(P(AA));
      await tools.call('propose_run', { brief: 'x' });
      await tools.call('propose_run', { brief: 'x', noProject: true });
      assert.deepEqual(seen.map((s) => s[1]), [{ brief: 'x', projectKey: AA }, { brief: 'x', noProject: true }]);
      await tools.call('propose_run', { brief: 'x', noProject: true, projectKey: BB });
      assert.deepEqual(seen[2], ['run', { brief: 'x', noProject: true, projectKey: BB }], 'noProject plus a key skips the gate: validateProposal answers tooManyTargets');
      await tools.call('propose_away_mode_change', { level: 'user', projectKey: BB, set: {} });
      assert.equal(seen[3][0], 'away', 'a user-level Away change names no project target');
      assert.deepEqual(await tools.call('propose_run', { brief: 'x', projectKey: BB }), { ok: false, errors: [refuse(P(AA), P(BB))] });
      assert.deepEqual(await tools.call('propose_run', { brief: 'x', workspaceId: WS }), { ok: false, errors: [refuse(P(AA), { workspaceId: WS })] });
    } },
    { name: 'a workspace chat: the workspace and its member projects are in scope; any other project is not', run: async () => {
      const { tools, seen } = gated({ workspaceId: WS });
      await tools.call('propose_run', { brief: 'x', projectKey: BB });
      assert.deepEqual(seen[0], ['run', { brief: 'x', projectKey: BB }]);
      assert.deepEqual(await tools.call('propose_run', { brief: 'x', projectKey: CC }), { ok: false, errors: [refuse({ workspaceId: WS }, P(CC))] });
    } },
    { name: 'every other acting tool: a target outside the scope is refused in its own shape, and the core is never reached', run: async () => {
      const { tools, seen } = gated(P(AA));
      const out = refuse(P(AA), P(BB));
      assert.deepEqual(await tools.call('propose_metrics_change', { kind: 'record', projectKey: BB, record: false }), { ok: false, errors: [out] });
      assert.deepEqual(await tools.call('propose_policy_change', { kind: 'edit', projectKey: BB }), { ok: false, errors: [out] });
      assert.deepEqual(await tools.call('propose_away_mode_change', { level: 'project', projectKey: BB, set: { enabled: true } }), { ok: false, errors: [out] });
      assert.deepEqual(await tools.call('propose_actions_change', { kind: 'project', projectKey: BB, actions: [] }), { ok: false, errors: [out] });
      assert.deepEqual(await tools.call('propose_actions_change', { kind: 'stacks', workspaceId: WS, stacks: [] }), { ok: false, errors: [refuse(P(AA), { workspaceId: WS })] });
      assert.deepEqual(await tools.call('propose_workspace_change', { kind: 'rename', workspaceId: WS, name: 'X' }), { ok: false, errors: [refuse(P(AA), { workspaceId: WS })] });
      assert.deepEqual(await tools.call('change_setting', { id: 'theme', scope: 'project', projectKey: BB, value: 'dark' }), { ok: false, error: out });
      await assert.rejects(tools.call('remember', { scope: 'project', projectKey: BB, name: 'n', body: 'b' }), { name: 'AskToolError', message: `remember: ${out}` });
      await assert.rejects(tools.call('forget', { scope: 'project', projectKey: BB, name: 'n' }), { name: 'AskToolError', message: `forget: ${out}` });
      await assert.rejects(tools.call('propose_workflow', { task: 't', projectKey: BB }), { name: 'AskToolError', message: `propose_workflow: ${out}` });
      assert.deepEqual(seen, []);
    } },
    { name: 'No project, nothing named: memory writes and propose_workflow say there is no project; a workspace create and global memory are no target', run: async () => {
      const { tools, seen } = gated(null);
      await assert.rejects(tools.call('remember', { scope: 'project', name: 'n', body: 'b' }), { message: `remember: ${refuse(null)}` });
      await assert.rejects(tools.call('propose_workflow', { task: 't' }), { message: `propose_workflow: ${refuse(null)}. For work that belongs to no project, call propose_run with noProject: true and a saved workflow instead` });
      await tools.call('propose_workspace_change', { kind: 'create', name: 'X', projectKeys: [AA, BB] });
      await tools.call('remember', { scope: 'global', name: 'g', body: 'b' });
      assert.deepEqual(seen.map((s) => s[0]), ['workspace', 'remember']);
    } },
    { name: 'reads stay open: list_memory on another project, in No project and in a project chat', run: async () => {
      for (const scope of [null, P(AA)]) {
        const { tools, seen } = gated(scope);
        assert.deepEqual(await tools.call('list_memory', { scope: 'project', projectKey: BB }), { project: { projectKey: BB, files: [] } });
        assert.deepEqual(seen[0], ['list', { kind: 'project', projectKey: BB }]);
      }
    } },
    { name: 'no scope reader = no chat: nothing is filled and nothing refused (unit fakes, reader-only hosts)', run: async () => {
      const { tools, seen } = gated(null, { chat: false });
      await tools.call('propose_run', { brief: 'x', projectKey: BB });
      await tools.call('propose_run', { brief: 'x' });
      assert.deepEqual(seen.map((s) => s[1]), [{ brief: 'x', projectKey: BB }, { brief: 'x' }]);
    } },
  ]);
});

test('Workflows composer threads (U9): a workspace or No project scope keeps test_script in a scratch folder; propose_scope_switch is not a composer tool', async () => {
  const bench = [];
  const scripts = { enabled: true, test: async (o) => { bench.push(o); return { ok: true, result: { status: 'clean' } }; } };
  for (const scope of [{ workspaceId: WS }, null]) {
    const t = createAskTools({ limits: ASK_LIMITS, redact: (s) => s, askMode: 'composer', composer: {}, pinnedScope: () => scope, scripts, scopeSwitch: { validate: async () => ({ ok: true }) } });
    assert.equal((await t.call('test_script', { key: 'k', cwd: 'project' })).ok, false);
    assert.ok(!t.list().some((d) => d.name === 'propose_scope_switch'));
  }
  assert.equal(bench.length, 0, 'a refused cwd never reaches the bench');
});
