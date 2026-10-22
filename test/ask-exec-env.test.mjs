// Execution environment in worca Chat (docs/e2b.md): propose_run's `execEnv`, its validation (the same rule the
// run start and New pipeline apply: a remote backend takes single-project runs of a git project on the remote engines
// only), the chat's settings (run.execEnv + the E2B limits) and the rule that tells the chat when to name one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { createProposalValidator, PROPOSAL_ERRORS } from '../src/core/ask/proposal.mjs';
import { createAskTools } from '../src/core/ask/tools.mjs';
import { createSettingsRegistry } from '../src/core/ask/settings-registry.mjs';
import { ASK_SYSTEM_RULES, codexSystemRules } from '../src/core/ask/prompt.mjs';
import { SETTINGS_POST_KEYS } from '../src/core/settings.mjs';

const dirA = '/p/alpha';
const deps = {
  listProjects: async () => [{ key: 'demo-00000001', name: 'Demo', path: '/p/demo', exists: true }],
  readWorkspace: async (id) => (id === 'wks-team-0000abcd'
    ? { id, name: 'Team', description: '', projectPaths: [dirA, '/p/demo'], projectKeys: ['alpha-00000001', 'demo-00000001'], exists: [true, true] } : null),
  readWorkflow: async (id) => (id === 'wf_default' ? { id, name: 'Default' } : null),
  assertRunnableWorkflow: async (id) => { if (id !== 'wf_default') throw new Error(`unknown workflowId "${id}"`); return { id, name: 'Default' }; },
  readGuardrailSet: async (id) => (['normal', 'secure'].includes(id) ? { id } : null),
  isGitRepo: () => true,
  pathExists: () => true,
  resolveEngine: () => 'claude',
};
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.card; };
const errs = (r) => { assert.equal(r.ok, false); return r.errors; };
const P = { projectKey: 'demo-00000001', brief: 'x' };

test('propose_run execEnv: omitted keeps the card shape, a known environment rides the card, an unknown one is refused', async () => {
  const { validateProposal } = createProposalValidator(deps);
  assert.equal('execEnv' in ok(await validateProposal(P)), false);
  assert.equal(ok(await validateProposal({ ...P, execEnv: 'E2B ' })).execEnv, 'e2b');
  // An explicit local is a real pick: it keeps a saved remote default off this one run.
  assert.equal(ok(await validateProposal({ ...P, execEnv: 'local' })).execEnv, 'local');
  assert.equal('execEnv' in ok(await validateProposal({ ...P, execEnv: '' })), false);
  assert.deepEqual(errs(await validateProposal({ ...P, execEnv: 'docker' })), [PROPOSAL_ERRORS.unknownExecEnv('docker')]);
  assert.match(PROPOSAL_ERRORS.unknownExecEnv('docker'), /one of local, e2b/);
});

test('propose_run execEnv: a remote environment takes single-project runs of a git project on any remote engine, as the run start does', async () => {
  await checkRows([
    { name: 'a workspace target', run: async () => {
      const { validateProposal } = createProposalValidator(deps);
      assert.deepEqual(errs(await validateProposal({ workspaceId: 'wks-team-0000abcd', brief: 'x', execEnv: 'e2b' })), [PROPOSAL_ERRORS.execEnvRefused('e2b', 'a workspace run')]);
      assert.equal(ok(await validateProposal({ workspaceId: 'wks-team-0000abcd', brief: 'x', execEnv: 'local' })).execEnv, 'local');
    } },
    { name: 'an engine the proposal names', run: async () => {
      const { validateProposal } = createProposalValidator(deps);
      assert.equal(ok(await validateProposal({ ...P, engine: 'codex', execEnv: 'e2b' })).execEnv, 'e2b');
      assert.equal(ok(await validateProposal({ ...P, engine: 'claude', execEnv: 'e2b' })).execEnv, 'e2b');
    } },
    { name: 'the default engine the run would take', run: async () => {
      const seen = [];
      const { validateProposal } = createProposalValidator({ ...deps, resolveEngine: (scope) => { seen.push(scope); return 'cursor'; } });
      assert.equal(ok(await validateProposal({ ...P, execEnv: 'e2b' })).execEnv, 'e2b');
      assert.deepEqual(seen, [{ projectDir: '/p/demo' }]);
      // A local pick never asks.
      seen.length = 0;
      ok(await validateProposal({ ...P, execEnv: 'local' }));
      assert.deepEqual(seen, []);
    } },
  ]);
  assert.match(PROPOSAL_ERRORS.execEnvRefused('e2b', 'a workspace run'), /E2B sandbox cannot take a workspace run/);
});

test('propose_run schema: execEnv lists the registered environments and says when to name one', () => {
  const tool = createAskTools({ limits: ASK_LIMITS, redact: (s) => s, models: {} }).list().find((t) => t.name === 'propose_run');
  const prop = tool.inputSchema.properties.execEnv;
  assert.equal(prop.type, 'string');
  assert.match(prop.description, /local \| e2b/);
  assert.match(prop.description, /only when the user asks/i);
});

test('the chat rule names execEnv: when to give one, what it needs, where the default lives (both engines)', () => {
  const claude = ASK_SYSTEM_RULES;
  assert.match(claude, /execEnv "e2b"/);
  assert.match(claude, /Settings › Runs › Execution environment/);
  assert.match(claude, /never on your own/);
  assert.match(codexSystemRules(), /execEnv "e2b"/);
});

function registry({ settings = {} } = {}) {
  const s = { ...settings };
  const bodies = [];
  const reg = createSettingsRegistry({
    readSettings: () => s,
    projectSettingIds: () => ['run.execEnv'],
    resolveSetting: () => ({ value: 'local', source: 'default', layers: { project: undefined, user: undefined, team: undefined, default: 'local' } }),
    assertProjectSettingsPatch: (patch) => Object.entries(patch).map(([id, value]) => ({ entry: { id }, value })),
    projects: async () => [{ key: 'demo-00000001', name: 'Demo', path: '/p/demo' }],
    applyUser: async (body) => { bodies.push(body); for (const [k, v] of Object.entries(body)) { if (v === null || v === '') delete s[k]; else s[k] = v; } },
    applyProject: async () => {},
  });
  return { reg, s, bodies };
}

test('chat settings: run.execEnv and the E2B limits are listed, checked and written as the Settings page writes them', async () => {
  await checkRows([
    { name: 'listed under Runs with their defaults', run: async () => {
      const { reg } = registry();
      const rows = (await reg.list({ scope: 'user' })).settings;
      const row = (id) => rows.find((r) => r.id === id);
      for (const id of ['run.execEnv', 'e2bMaxSandboxes', 'e2bMaxWaitMin']) assert.ok(row(id), id);
      assert.equal(row('run.execEnv').label, 'Execution environment for new runs');
      assert.equal(row('run.execEnv').group, 'Runs');
      assert.match(row('run.execEnv').value, /Local/);
    } },
    { name: 'apply writes the execEnv key, a Revert writes it back', run: async () => {
      const { reg, bodies } = registry();
      const r = await reg.apply({ id: 'run.execEnv', scope: 'user', value: 'e2b' });
      assert.deepEqual(bodies, [{ execEnv: 'e2b' }]);
      assert.equal(r.card.before, 'Local (default)');
      assert.equal(r.card.after, 'E2B sandbox');
      assert.deepEqual(r.card.raw, { before: null, after: 'e2b' });
    } },
    { name: 'an E2B limit', run: async () => {
      const { reg, bodies } = registry();
      const r = await reg.apply({ id: 'e2bMaxSandboxes', scope: 'user', value: 2 });
      assert.deepEqual(bodies, [{ e2bMaxSandboxes: 2 }]);
      assert.equal(r.card.before, '4 (default)');
      assert.equal(r.card.after, '2');
      const w = await registry().reg.apply({ id: 'e2bMaxWaitMin', scope: 'user', value: 120 });
      assert.equal(w.card.before, '4 h (default)');
      assert.equal(w.card.after, '2 h');
    } },
    { name: 'refusals are the setters\' own words', run: async () => {
      const { reg } = registry();
      assert.match((await reg.check({ id: 'run.execEnv', value: 'docker' })).error, /execEnv must be one of local \| e2b/);
      assert.match((await reg.check({ id: 'e2bMaxSandboxes', value: 0 })).error, /e2bMaxSandboxes must be a whole number in 1–64/);
      assert.match((await reg.check({ id: 'e2bMaxWaitMin', value: 2 })).error, /e2bMaxWaitMin must be a whole number in 5–1440/);
    } },
    { name: 'every new setting writes one known POST key', run: async () => {
      const { reg } = registry();
      for (const def of reg.defsFor('user').filter((d) => ['run.execEnv', 'e2bMaxSandboxes', 'e2bMaxWaitMin'].includes(d.id))) {
        for (const unit of [null, def.put(null, def.get(null))]) {
          const keys = Object.keys(def.body(unit));
          assert.equal(keys.length, 1, def.id);
          assert.ok(SETTINGS_POST_KEYS.includes(keys[0]), `${def.id} → ${keys[0]}`);
        }
      }
    } },
    { name: 'the project override carries the user setting\'s label and choices', run: async () => {
      const { reg } = registry();
      const row = (await reg.list({ scope: 'project', projectKey: 'demo-00000001' })).settings.find((r) => r.id === 'run.execEnv');
      assert.equal(row.label, 'Execution environment for new runs');
      assert.match(row.allowed, /"local" \| "e2b"/);
    } },
  ]);
});
