// test/ask-workflow-deps.test.mjs — the propose_workflow dependency bundle: the REAL P1 pipeline offline.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { addProject, worcaHome } from '../src/core/projects.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { mockShapeFor, RECIPE_SHAPES } from '../src/core/auto/recipes.mjs';
import { REG, MODELS, WEB_TASK, proposalFor } from './helpers/auto-proposal-fixture.mjs';
import {
  defaultWorkflowDeps, revalidateWorkflowProposal, proposalSummary, applyTunables, workflowEventPrompt, workflowNoticeText,
} from '../src/core/ask/workflow-deps.mjs';
import { checkRows } from './helpers/rows.mjs';

useTempHome(after);
process.env.WORCA_MOCK = '1';                      // classifyTask takes its mock arm: deterministic, no spawn
after(() => { delete process.env.WORCA_MOCK; });

// ≥ 80 chars, no heading, none of recipes.mjs WEB_RE's words ⇒ the `prompt` recipe ⇒ isomorphic to the built-in Default.
const PLAIN_TASK = 'Refactor the auth module so that sessions expire after thirty minutes and refresh tokens rotate on every use.';
const project = async (name) => (await addProject({ name, path: mkdtempSync(join(tmpdir(), 'worca-wfdeps-')) })).find((p) => p.name === name);

test('propose (task mode): unknown project throws; a known one runs fingerprint → mock classifier → assembler → matcher; a plain prompt is the built-in Default\'s twin', async () => {
  await checkRows([
    { name: 'propose (task mode): unknown project throws; a known one runs fingerprint → mock classifier → assembler → matcher and returns the shape', run: async () => {
      const deps = defaultWorkflowDeps({ threadId: null });
      await assert.rejects(() => deps.workflow.propose({ mode: 'task', task: WEB_TASK, projectKey: 'nope-00000000' }), /unknown projectKey "nope-00000000"/);
      const p = await project('wfdeps');
      const out = await deps.workflow.propose({ mode: 'task', task: WEB_TASK, projectKey: p.key, note: 'why this', thenRun: true });
      assert.equal(out.ok, true); assert.equal(out.mode, 'task'); assert.equal(out.projectKey, p.key); assert.equal(out.projectName, 'wfdeps');
      assert.ok(Array.isArray(out.shape.stages) && out.shape.stages.length >= 4, 'the mock classifier picked the web recipe');
      assert.equal(out.match, null, 'a fresh home holds no seed rows and the web recipe is not the Default (db.mjs:1299)');
      assert.match(out.summary, /^stages: .+ → .+/); assert.match(out.summary, /loops: .+\(max \d+ cycles\)/);
      assert.equal(out.note, 'why this', 'note goes through cleanText'); assert.equal(out.thenRun, true);
      assert.equal(out.costUsd, 0); assert.match(out.fingerprint, /^top-level:/);
      assert.ok(out.shape.signals.some((s) => /agent cards read$/.test(s)), 'the classifier\'s cards signal survives');
      // Write the FULL-NO-Decompose seed (what an upgraded home holds) ⇒ the same text now finds its twin (D8: reuse over clutter).
      const seed = SEED_TEMPLATES.find((t) => t.id === 'wf_full-no-decompose');
      await writeGraphWorkflow({ id: seed.id, name: seed.name, domain: seed.domain, nodes: seed.nodes, wires: seed.wires, createdAt: seed.createdAt });
      const again = await deps.workflow.propose({ mode: 'task', task: WEB_TASK, projectKey: p.key });
      assert.deepEqual(again.match, { id: 'wf_full-no-decompose', name: 'FULL-NO-Decompose' });
    } },
    { name: 'propose (task mode): a plain prompt is the built-in Default\'s twin', run: async () => {
      const deps = defaultWorkflowDeps({ threadId: null });
      const p = await project('wfplain');
      const out = await deps.workflow.propose({ mode: 'task', task: PLAIN_TASK, projectKey: p.key });
      assert.deepEqual(out.match, { id: 'wf_default', name: 'Default' });
      assert.equal(out.shape.taskKind, 'prompt');
    } },
  ]);
});

test('propose (task mode) checkouts: none under mock; off mock the classifier runs in a throwaway auto-look checkout removed after', async () => {
  await checkRows([
    { name: 'propose (task mode) under mock never creates a repo-look checkout, even for a git project', run: async () => {
      const deps = defaultWorkflowDeps({ threadId: null });
      const p = (await addProject({ name: 'wflook', path: gitDir('wflook') })).find((x) => x.name === 'wflook');
      await deps.workflow.propose({ mode: 'task', task: PLAIN_TASK, projectKey: p.key });
      const askTmp = join(worcaHome(), 'tmp', 'ask');
      const entries = existsSync(askTmp) ? readdirSync(askTmp) : [];
      assert.ok(!entries.some((n) => n.startsWith('auto-look-')), `no auto-look-* under ${askTmp}: ${entries.join(', ')}`);
      const reg = join(p.path, '.git', 'worktrees');
      assert.ok(!existsSync(reg) || readdirSync(reg).length === 0, 'no worktree registered on the project');
    } },
    { name: 'propose (task mode) off mock: the classifier runs inside a throwaway auto-look checkout that is gone after the call', run: async () => {
      delete process.env.WORCA_MOCK;                       // the injected seam below never spawns; only the checkout is real
      try {
        const seen = [];
        const deps = defaultWorkflowDeps({ classify: async (input) => { seen.push({ ...input, existed: existsSync(input.cwd) }); return { shape: mockShapeFor(PLAIN_TASK), warnings: [], costUsd: 0 }; } });
        const p = (await addProject({ name: 'wflook2', path: gitDir('wflook2') })).find((x) => x.name === 'wflook2');
        const out = await deps.workflow.propose({ mode: 'task', task: PLAIN_TASK, projectKey: p.key });
        assert.equal(out.ok, true);
        assert.equal(seen.length, 1);
        assert.equal(seen[0].repoLook, true, 'the look is on');
        assert.ok(seen[0].cwd.startsWith(join(worcaHome(), 'tmp', 'ask', 'auto-look-')), seen[0].cwd);
        assert.equal(seen[0].existed, true, 'the checkout exists during the call');
        assert.equal(existsSync(seen[0].cwd), false, 'and is removed after it');
        const reg = join(p.path, '.git', 'worktrees');
        assert.ok(!existsSync(reg) || readdirSync(reg).length === 0, 'and unregistered from the project');
      } finally { process.env.WORCA_MOCK = '1'; }
    } },
  ]);
});

test('propose (shape mode): a hand-authored shape is normalized (unknown models dropped with a warning, name override wins); an unassemblable shape throws with the issues', async () => {
  await checkRows([
    { name: 'propose (shape mode): a hand-authored shape is normalized, unknown models are dropped with a warning, the name override wins', run: async () => {
      const deps = defaultWorkflowDeps({ threadId: null });
      const p = await project('wfshape');
      const shape = mockShapeFor('rename a symbol');                 // the trivial recipe: implementer only (no twin in a fresh home)
      shape.stages[0].model = 'claude-nonexistent-9'; shape.stages[0].effort = 'high';
      const out = await deps.workflow.propose({ mode: 'shape', shape, name: 'Tiny fix', projectKey: p.key });
      assert.equal(out.name, 'Tiny fix');
      assert.ok(out.warnings.some((w) => /unknown model "claude-nonexistent-9"/.test(w)), out.warnings.join(' | '));
      assert.equal(out.shape.stages[0].tunables.model, undefined, 'the bad model is dropped, the stage stays');
      assert.equal(out.match, null);
    } },
    { name: 'propose (shape mode): an unassemblable shape throws with the assembler\'s issues', run: async () => {
      const deps = defaultWorkflowDeps({ threadId: null });
      const p = await project('wfbad');
      await assert.rejects(() => deps.workflow.propose({ mode: 'shape', shape: { name: 'x', stages: [{ agent: 'no-such-agent' }] }, projectKey: p.key }), /invalid workflow shape/);
    } },
  ]);
});

test('revalidate twin/manifest/project; proposalSummary vocabulary and applyTunables', async () => {
  await checkRows([
    { name: 'revalidate: no twin ⇒ match null and the reserved id on the manifest; a row written later becomes the twin; project resolved (or null); ignoredProjectOverrides=false without a project', run: async () => {
      // The plan-partial recipe (planner → refiner⟳ → implementer ⇄ reviewer) matches neither the Default nor any seed.
      const shape = () => JSON.parse(JSON.stringify(RECIPE_SHAPES.find((r) => r.id === 'plan-partial').shape));
      const built = await revalidateWorkflowProposal({ shape: shape(), models: MODELS, registry: REG });
      assert.equal(built.match, null);
      assert.equal(built.project, null, 'no projectKey ⇒ no project');
      assert.equal(built.proposal.manifest.template.id, 'wf_auto', 'an unmatched proposal carries the reserved id until Save mints one');
      const row = await writeGraphWorkflow({ ...built.template, id: 'wf_twin', name: 'Twin', domain: 'coding', origin: 'auto' });
      const p = await project('wfreval');
      const again = await revalidateWorkflowProposal({ shape: shape(), projectKey: p.key, models: MODELS, registry: REG });
      assert.deepEqual(again.match, { id: row.id, name: 'Twin' });
      assert.deepEqual(again.project, { key: p.key, name: 'wfreval', path: p.path }, 'the parent learns the project NAME here (the mock child never knows it — v4)');
      assert.equal(again.proposal.manifest.template.id, 'wf_twin');
      assert.equal(again.proposal.ignoredProjectOverrides, false, 'a project with no saved overrides for the twin');
      assert.equal((await revalidateWorkflowProposal({ shape: shape(), projectKey: 'nope-00000000', models: MODELS, registry: REG })).project, null, 'an unknown key resolves to null, never throws');
      // Deterministic: re-assembling the NORMALIZED shape the card carries yields the same template (Save re-derives it).
      const twice = await revalidateWorkflowProposal({ shape: built.shape, models: MODELS, registry: REG });
      assert.deepEqual(twice.template.nodes.map((n) => [n.id, n.kind, n.key]), built.template.nodes.map((n) => [n.id, n.kind, n.key]));
    } },
    { name: 'proposalSummary uses the CLI vocabulary; applyTunables bakes accepted tunables into node config and clears with ""', run: async () => {
      const p = proposalFor();
      const s = proposalSummary(p);
      assert.match(s, /^stages: /); assert.ok(s.includes('(claude-sonnet-5 · medium)'), s); assert.ok(s.includes('loops: '), s);
      const id = p.order[1];
      const tpl = applyTunables({ nodes: [{ id, kind: 'agent', key: 'k', config: { model: 'a', effort: 'high' } }, { id: 'n_task', kind: 'task', config: {} }] }, { [id]: { model: 'claude-opus-5-5', effort: '' }, n_task: { model: 'x' } });
      assert.deepEqual(tpl.nodes[0].config, { model: 'claude-opus-5-5' });
      assert.deepEqual(tpl.nodes[1].config, {}, 'non-agent nodes are never touched');
    } },
  ]);
});

test('propose (task mode): a classifier failure resolves {ok:false} WITH the spend; a shape the assembler rejects after the one retry too; the child signal reaches the classifier', async () => {
  // v7 (PD2): ClassifierError.costUsd = what the failed attempts already cost (classify.mjs:18-29); v6 rethrew it and the four cost sinks never saw it.
  const { ClassifierError } = await import('../src/core/auto/classify.mjs');
  const p = await project('wffail');
  const timeout = defaultWorkflowDeps({ classify: async () => { throw new ClassifierError('CLASSIFIER_TIMEOUT', 'no reply after 90s', [], { costUsd: 0.03 }); } });
  const out = await timeout.workflow.propose({ mode: 'task', task: WEB_TASK, projectKey: p.key });
  assert.deepEqual(out, { ok: false, mode: 'task', projectKey: p.key, projectName: 'wffail', workspaceId: null, workspaceName: null, error:'the workflow classifier timed out: no reply after 90s', costUsd: 0.03 });
  // Two billed replies whose shape the REAL assembler rejects (unknown agent) ⇒ one retry with the issues as feedback, then {ok:false} carrying BOTH costs.
  const seen = [];
  const bad = defaultWorkflowDeps({ classify: async (input) => { seen.push(input); return { shape: { name: 'x', stages: [{ agent: 'no-such-agent' }] }, warnings: [], costUsd: 0.02 }; } });
  const twice = await bad.workflow.propose({ mode: 'task', task: WEB_TASK, projectKey: p.key });
  assert.equal(seen.length, 2, 'exactly one retry (as _autoRound)');
  assert.match(seen[1].feedback[0], /could not be assembled: .*unknown agent "no-such-agent"/);
  assert.equal(twice.ok, false); assert.match(twice.error, /^invalid workflow shape: unknown agent "no-such-agent"/); assert.equal(twice.costUsd, 0.04);
  // Shape mode spends nothing ⇒ still throws (the model gets tool-error text); an unknown project throws before any spend.
  await assert.rejects(() => bad.workflow.propose({ mode: 'shape', shape: { name: 'x', stages: [{ agent: 'no-such-agent' }] }, projectKey: p.key }), /invalid workflow shape/);
  // The bundle's signal (mcp-stdio main() aborts it when stdin closes) is what the classifier gets unless the call carries its own.
  const ctrl = new AbortController();
  const rec = defaultWorkflowDeps({ signal: ctrl.signal, classify: async (input) => { seen.push(input); return { shape: mockShapeFor(PLAIN_TASK), warnings: [], costUsd: 0 }; } });
  await rec.workflow.propose({ mode: 'task', task: PLAIN_TASK, projectKey: p.key });
  assert.equal(seen.at(-1).signal, ctrl.signal, 'the child lifetime signal is threaded into classifyTask');
});

test('workspace target: propose resolves the workspace, revalidate builds a workspace proposal, input errors throw before any spend', async () => {
  const { createWorkspace } = await import('../src/core/workspaces.mjs');
  const { ClassifierError } = await import('../src/core/auto/classify.mjs');
  const ws = await createWorkspace({ name: 'Wf Team', description: 'two services', projectPaths: [gitDir('wfws-a'), gitDir('wfws-b')] });
  const keys = ws.projectKeys.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  await checkRows([
    { name: 'workspaceTarget: members sorted by projectKey (code unit), named by basename; null for no/unknown id', run: async () => {
      const { workspaceTarget } = await import('../src/core/ask/workflow-deps.mjs');
      const t = await workspaceTarget(ws.id);
      assert.equal(t.id, ws.id); assert.equal(t.name, 'Wf Team'); assert.equal(t.description, 'two services');
      assert.deepEqual(t.members.map((m) => m.projectKey), keys);
      for (const m of t.members) { assert.ok(ws.projectPaths.includes(m.projectDir)); assert.ok(m.projectDir.endsWith(m.projectName)); }
      assert.equal(await workspaceTarget('nope-00000000'), null);
      assert.equal(await workspaceTarget(''), null);
    } },
    { name: 'propose (task mode, workspace) under mock: a workspace fingerprint + descriptor reach the classifier, no look; the result names the workspace', run: async () => {
      const seen = [];
      const deps = defaultWorkflowDeps({ classify: async (input) => { seen.push(input); return { shape: mockShapeFor(PLAIN_TASK), warnings: [], costUsd: 0 }; } });
      const out = await deps.workflow.propose({ mode: 'task', task: PLAIN_TASK, workspaceId: ws.id });
      assert.equal(out.ok, true);
      assert.equal(out.workspaceId, ws.id); assert.equal(out.workspaceName, 'Wf Team');
      assert.equal(out.projectKey, null); assert.equal(out.projectName, null);
      assert.match(out.fingerprint, /^workspace: Wf Team — 2 projects/);
      assert.equal(seen.length, 1);
      assert.match(seen[0].fingerprint, /^workspace: /);
      assert.equal(seen[0].repoLook, false); assert.equal(seen[0].cwd, join(worcaHome(), 'tmp', 'ask'));
      assert.equal(seen[0].workspace.name, 'Wf Team');
      assert.deepEqual(seen[0].workspace.members.map((m) => [m.projectKey, m.checkout]), keys.map((k) => [k, null]));
    } },
    { name: 'propose (task mode, workspace) off mock: the classifier runs at the look root with one checkout per member, removed after', run: async () => {
      delete process.env.WORCA_MOCK;
      try {
        const seen = [];
        const deps = defaultWorkflowDeps({ classify: async (input) => {
          seen.push({ ...input, existed: input.workspace.members.map((m) => m.checkout && existsSync(join(input.cwd, m.checkout))) });
          return { shape: mockShapeFor(PLAIN_TASK), warnings: [], costUsd: 0 };
        } });
        const out = await deps.workflow.propose({ mode: 'task', task: PLAIN_TASK, workspaceId: ws.id });
        assert.equal(out.ok, true);
        assert.equal(seen[0].repoLook, true);
        assert.ok(seen[0].cwd.startsWith(join(worcaHome(), 'tmp', 'ask', 'auto-look-')), seen[0].cwd);
        assert.deepEqual(seen[0].workspace.members.map((m) => m.checkout), keys.map((k) => `./repos/${k}`));
        assert.deepEqual(seen[0].existed, [true, true], 'each member checkout exists during the call');
        assert.equal(existsSync(seen[0].cwd), false, 'and the look root is gone after it');
      } finally { process.env.WORCA_MOCK = '1'; }
    } },
    { name: 'propose (shape mode, workspace): assembles without a classifier call and returns workspaceId/workspaceName', run: async () => {
      let calls = 0;
      const deps = defaultWorkflowDeps({ classify: async () => { calls += 1; throw new Error('never'); } });
      const out = await deps.workflow.propose({ mode: 'shape', shape: mockShapeFor('rename a symbol'), workspaceId: ws.id });
      assert.equal(calls, 0);
      assert.equal(out.ok, true); assert.equal(out.workspaceId, ws.id); assert.equal(out.workspaceName, 'Wf Team'); assert.equal(out.projectKey, null);
    } },
    { name: 'propose: an unknown workspaceId and both ids throw before any classify call', run: async () => {
      let calls = 0;
      const deps = defaultWorkflowDeps({ classify: async () => { calls += 1; return { shape: mockShapeFor(PLAIN_TASK), warnings: [], costUsd: 0 }; } });
      await assert.rejects(() => deps.workflow.propose({ mode: 'task', task: PLAIN_TASK, workspaceId: 'nope-ws' }), /^Error: unknown workspace "nope-ws" — list_projects names the workspaces$/);
      const p = await project('wfboth');
      await assert.rejects(() => deps.workflow.propose({ mode: 'task', task: PLAIN_TASK, projectKey: p.key, workspaceId: ws.id }), /give projectKey or workspaceId, not both/);
      assert.equal(calls, 0);
    } },
    { name: 'propose (task mode, workspace): a ClassifierError resolves {ok:false, costUsd, workspaceId, workspaceName}', run: async () => {
      const deps = defaultWorkflowDeps({ classify: async () => { throw new ClassifierError('CLASSIFIER_TIMEOUT', 'no reply after 90s', [], { costUsd: 0.03 }); } });
      const out = await deps.workflow.propose({ mode: 'task', task: PLAIN_TASK, workspaceId: ws.id });
      assert.deepEqual(out, { ok: false, mode: 'task', workspaceId: ws.id, workspaceName: 'Wf Team', projectKey: null, projectName: null, error: 'the workflow classifier timed out: no reply after 90s', costUsd: 0.03 });
    } },
    { name: 'revalidate({workspaceId}): returns the workspace and a proposal targeting it; an unknown id resolves to a project proposal', run: async () => {
      const r = await revalidateWorkflowProposal({ shape: mockShapeFor(PLAIN_TASK), workspaceId: ws.id, models: MODELS, registry: REG });
      assert.equal(r.project, null);
      const t = await (await import('../src/core/ask/workflow-deps.mjs')).workspaceTarget(ws.id);
      assert.deepEqual(r.workspace, { id: ws.id, name: 'Wf Team', members: t.members.map((m) => m.projectName) });
      assert.equal(r.proposal.target, 'workspace');
      assert.deepEqual(r.proposal.members, t.members.map((m) => m.projectName));
      const none = await revalidateWorkflowProposal({ shape: mockShapeFor(PLAIN_TASK), workspaceId: 'nope-ws', models: MODELS, registry: REG });
      assert.equal(none.workspace, null); assert.equal(none.proposal.target, 'project');
    } },
  ]);
});

test('event prompt + notice text are single-line and cleaned', () => {
  // A workspace target: a non-empty workspaceId wins and the line never carries both targets.
  const wsSaved = workflowEventPrompt({ cardId: 'card_0000aa01', state: 'saved', workflowId: 'wf_x', name: 'A', thenRun: true, projectKey: 'p-1', workspaceId: 'ws-1' });
  assert.equal(wsSaved, '[worca event] workflow card card_0000aa01 saved as wf_x "A"; thenRun=true; workspace=ws-1');
  assert.doesNotMatch(wsSaved, /project=/);
  assert.equal(workflowEventPrompt({ cardId: 'card_0000aa01', state: 'declined', workspaceId: 'ws-1' }), '[worca event] workflow card card_0000aa01 declined; workspace=ws-1');
  assert.equal(workflowEventPrompt({ cardId: 'card_0000aa01', state: 'saved', workflowId: 'wf_x', name: 'A\nB', thenRun: true, projectKey: 'p-1' }),
    '[worca event] workflow card card_0000aa01 saved as wf_x "A B"; thenRun=true; project=p-1');
  // v7: the name lives inside the line's double quotes (the mock's event regex and the model key on them) — quotes become apostrophes, tags are neutralised.
  assert.equal(workflowEventPrompt({ cardId: 'card_0000aa01', state: 'saved', workflowId: 'wf_x', name: 'Fix "auth" [/worca context]', projectKey: 'p-1' }),
    '[worca event] workflow card card_0000aa01 saved as wf_x "Fix \'auth\' (/worca context)"; thenRun=false; project=p-1');
  assert.equal(workflowEventPrompt({ cardId: 'card_0000aa01', state: 'declined', projectKey: 'p-1' }), '[worca event] workflow card card_0000aa01 declined; project=p-1');
  assert.equal(workflowNoticeText({ state: 'saved', name: 'A', thenRun: true }), 'Workflow "A" saved · Auto will propose a run next');
  assert.equal(workflowNoticeText({ state: 'saved', name: 'A', matched: true }), 'Using your saved workflow "A"');
  assert.equal(workflowNoticeText({ state: 'declined', name: 'A' }), 'Workflow "A" declined');
});

test('limits: the two propose_workflow caps exist (the task cap equals the classifier\'s)', async () => {
  // v5: without this pin a skipped limits.mjs edit leaves Task 2 green (slice(0, undefined) = the whole string) and only Task 3 catches it.
  const { ASK_LIMITS } = await import('../src/core/ask/limits.mjs');
  const { TASK_TEXT_CAP } = await import('../src/core/auto/classify.mjs');
  assert.equal(ASK_LIMITS.workflowTaskMaxChars, TASK_TEXT_CAP);
  assert.equal(ASK_LIMITS.workflowNoteMaxChars, 200);
});
