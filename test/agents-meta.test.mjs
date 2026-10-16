// test/agents-meta.test.mjs
// Guards the "drop two files to add an agent" invariant documented in
// docs/ADDING-AGENTS.md: every agents/<key>.meta.json names a runnable
// runnerType and (when agentFile is set) points at a real prompt .md, and
// every agents/*.md prompt is claimed by exactly one meta sidecar. If this
// ever fails, an agent was added without its pair — see docs/ADDING-AGENTS.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { effectiveAllowedTools } from '../src/core/phases.mjs';
import { toolsForMeta } from '../src/core/graph/executor.mjs';
import { checkRows } from './helpers/rows.mjs';
import { GRAPH_DEFAULT_WORKFLOW, GRAPH_PR_FIX_WORKFLOW, GRAPH_MEMORY_DEFRAG_WORKFLOW, GRAPH_WORKSPACE_SCAN_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';
import { GRAPH_ARCHITECTURE_WORKFLOW } from '../src/core/graph/architecture-workflow.mjs';
import { GRAPH_PRESENTATION_WORKFLOW } from '../src/core/graph/presentation-workflow.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { RECIPE_SHAPES } from '../src/core/auto/recipes.mjs';

const AGENTS_DIR = fileURLToPath(new URL('../agents/', import.meta.url));
const RUNNER_TYPES = new Set(['producer', 'verifier', 'clarifier']);

async function listAgents() {
  const names = await readdir(AGENTS_DIR);
  return {
    metas: names.filter((n) => n.endsWith('.meta.json')),
    // Only prompt markdown — never count a .meta.json as a prompt.
    prompts: names.filter((n) => n.endsWith('.md') && !n.endsWith('.meta.json')),
  };
}

test('agents/*.md prompts and meta.agentFile sidecars pair one-to-one', async () => {
  await checkRows([
    { name: 'every prompt agents/*.md is claimed by some meta.agentFile', run: async () => {
      const { prompts } = await listAgents();
      const registry = loadAgentRegistry(AGENTS_DIR);
      const claimed = new Set(
        Object.values(registry).map((m) => m.agentFile).filter(Boolean),
      );
      const orphans = prompts.filter((p) => !claimed.has(p));
      assert.deepEqual(
        orphans,
        [],
        `prompt(s) with no sibling meta.json: ${orphans.join(', ')} — add agents/<key>.meta.json (see docs/ADDING-AGENTS.md)`,
      );
    } },
    { name: 'every meta.agentFile points at a real prompt .md that exists', run: async () => {
      const { prompts } = await listAgents();
      const present = new Set(prompts);
      const registry = loadAgentRegistry(AGENTS_DIR);
      for (const meta of Object.values(registry)) {
        if (meta.agentFile == null) continue; // palette-only agents may omit a prompt
        assert.ok(
          present.has(meta.agentFile),
          `meta "${meta.key}" names agentFile "${meta.agentFile}" but that file is missing in agents/`,
        );
      }
    } },
  ]);
});

test('every shipped sidecar: required fields, runnable runnerType, v2 typed ports, no v1 wiring, well-formed requiresSkills', async () => {
  await checkRows([
    { name: 'every meta has the required fields and a runnable runnerType', run: async () => {
      const { metas } = await listAgents();
      assert.ok(metas.length >= 6, 'expected at least the 6 shipped agent metas');
      for (const file of metas) {
        const raw = await readFile(join(AGENTS_DIR, file), 'utf8');
        const meta = JSON.parse(raw);
        // key must match the filename stem (agents/<key>.meta.json).
        assert.equal(`${meta.key}.meta.json`, file, `meta.key must equal the file stem for ${file}`);
        for (const field of ['key', 'displayName', 'description', 'color', 'icon', 'runnerType', 'order']) {
          assert.ok(meta[field] != null && meta[field] !== '', `${file}: missing "${field}"`);
        }
        assert.ok(RUNNER_TYPES.has(meta.runnerType), `${file}: runnerType "${meta.runnerType}" must be producer|verifier|clarifier`);
        assert.equal(meta.metaVersion, 2, `${file}: must be a meta v2 sidecar`);
        assert.equal(typeof meta.order, 'number', `${file}: order must be a number`);
      }
    } },
    { name: 'shipped sidecars have progressStage exactly as specified', run: async () => {
      const expect = {
        clarify: 'plan', planner: 'plan', refiner: 'plan', planReviewer: 'plan',
        architect: 'plan', architectSetup: 'plan',
        decomposer: 'build', implementer: 'build',
        reviewer: 'review', workspaceReviewer: 'review',
        manualTestsChecklist: 'review', manualWebUiTesting: 'review',
      };
      const { metas } = await listAgents();
      for (const file of metas) {
        const meta = JSON.parse(await readFile(join(AGENTS_DIR, file), 'utf8'));
        if (expect[meta.key]) assert.equal(meta.progressStage, expect[meta.key], `${meta.key} has progressStage=${expect[meta.key]}`);
        else assert.equal('progressStage' in meta, false, `${meta.key} has no progressStage`);
      }
    } },
    { name: 'every agent of the staged workflows, seed templates and Auto recipes resolves to a staged sidecar', run: async () => {
      const stageOf = {};
      for (const f of (await listAgents()).metas) {
        const m = JSON.parse(await readFile(join(AGENTS_DIR, f), 'utf8'));
        stageOf[m.key] = m.progressStage;
      }
      const keysOf = (wf) => wf.nodes.filter((n) => n.kind === 'agent').map((n) => n.key);
      const recipeKeys = RECIPE_SHAPES.flatMap((r) => r.shape.stages.flatMap((st) => (st.parallel || [st]).map((x) => x.agent)));
      const sets = [['wf_default', keysOf(GRAPH_DEFAULT_WORKFLOW)], ['wf_pr_fix', keysOf(GRAPH_PR_FIX_WORKFLOW)],
        ['wf_architecture_c4', keysOf(GRAPH_ARCHITECTURE_WORKFLOW)], ['recipes', recipeKeys],
        ...SEED_TEMPLATES.map((t) => [t.id, keysOf(t)])];
      for (const [name, keys] of sets) {
        assert.ok(keys.length, `${name} has agents`);
        for (const k of keys) assert.ok(['plan', 'build', 'review'].includes(stageOf[k]), `${name}: ${k} has a progressStage`);
      }
    } },
    { name: 'memory defrag, workspace scan and presentation workflows have no staged agent', run: async () => {
      const stageOf = {};
      for (const f of (await listAgents()).metas) {
        const m = JSON.parse(await readFile(join(AGENTS_DIR, f), 'utf8'));
        stageOf[m.key] = m.progressStage;
      }
      for (const wf of [GRAPH_MEMORY_DEFRAG_WORKFLOW, GRAPH_WORKSPACE_SCAN_WORKFLOW, GRAPH_PRESENTATION_WORKFLOW]) {
        for (const n of wf.nodes.filter((x) => x.kind === 'agent')) assert.equal(stageOf[n.key], undefined, `${wf.id}: ${n.key} is unstaged`);
      }
    } },
    { name: 'every sidecar declares its typed ports, and NO v1 wiring field', run: async () => {
      const files = (await readdir(AGENTS_DIR)).filter((x) => x.endsWith('.meta.json'));
      for (const f of files) {
        const m = JSON.parse(await readFile(join(AGENTS_DIR, f), 'utf8'));
        assert.ok(Array.isArray(m.inputs), `${f} inputs`);
        assert.ok(Array.isArray(m.outputs), `${f} outputs`);
        for (const k of ['consumes', 'optionalConsumes', 'produces', 'connectsTo', 'loopSource', 'uiPhase', 'channelDefs']) {
          assert.ok(!(k in m), `${f}: the v1 wiring field "${k}" must be gone`);
        }
      }
    } },
    { name: 'requiresSkills, when present, is an array of non-blank strings', run: async () => {
      const files = (await readdir(AGENTS_DIR)).filter((x) => x.endsWith('.meta.json'));
      for (const f of files) {
        const m = JSON.parse(await readFile(join(AGENTS_DIR, f), 'utf8'));
        if (m.requiresSkills === undefined) continue; // optional: absent is fine
        assert.ok(Array.isArray(m.requiresSkills), `${f}: requiresSkills must be an array when present`);
        for (const s of m.requiresSkills) {
          assert.equal(typeof s, 'string', `${f}: requiresSkills entries must be strings`);
          assert.ok(s.trim().length > 0, `${f}: requiresSkills entries must be non-blank`);
        }
      }
    } },
  ]);
});

test('loadAgentRegistry returns the 6 shipped agents keyed by key, sorted by order', async () => {
  const registry = loadAgentRegistry(AGENTS_DIR);
  const keys = Object.keys(registry);
  for (const k of ['planner', 'refiner', 'implementer', 'reviewer', 'manualTestsChecklist', 'manualWebUiTesting']) {
    assert.ok(keys.includes(k), `registry missing "${k}"`);
  }
  const orders = keys.map((k) => registry[k].order);
  const sorted = [...orders].sort((a, b) => a - b);
  assert.deepEqual(orders, sorted, 'loadAgentRegistry must return entries sorted by .order');
});

test('normalizeMeta exposes requiresSkills (defaulting to []) and filters junk', async () => {
  const { normalizeMeta } = await import('../src/core/agent-registry.mjs');
  assert.deepEqual(normalizeMeta({ key: 'a', order: 1 }).requiresSkills, []);
  assert.deepEqual(
    normalizeMeta({ key: 'b', order: 2, requiresSkills: ['imagegen', ' ', 3, ' x '] }).requiresSkills,
    ['imagegen', 'x'],
  );
});

test('M4: workspace scanner and reviewer are paired and workspace-only (registry and on disk)', async () => {
  await checkRows([
    { name: 'M4: the scanner and the reviewer are paired (md + sidecar) and scope:"workspace-only"', run: async () => {
      const { prompts } = await listAgents();
      const registry = loadAgentRegistry(AGENTS_DIR);
      for (const key of ['workspaceScanner', 'workspaceReviewer']) {
        assert.ok(registry[key], `${key} present in the registry`);
        assert.equal(registry[key].scope, 'workspace-only', `${key} is workspace-only`);
        assert.ok(registry[key].agentFile, `${key} names an agentFile`);
        assert.ok(prompts.includes(registry[key].agentFile), `${key} prompt .md exists`);
      }
      // The pair files exist by their canonical names.
      assert.ok(prompts.includes('worca-cc-workspace-scanner.md'));
      assert.ok(prompts.includes('worca-cc-workspace-reviewer.md'));
    } },
    { name: 'M4: a workspace-only sidecar carries the optional scope field on disk', run: async () => {
      const raw = JSON.parse(await readFile(join(AGENTS_DIR, 'workspaceScanner.meta.json'), 'utf8'));
      assert.equal(raw.scope, 'workspace-only', 'the sidecar declares scope explicitly');
    } },
  ]);
});

test('the shipped defragmenter is a memory agent: no Bash, no Skill, no MultiEdit anywhere in its spawn', async () => {
  // effectiveAllowedTools UNIONS the .md frontmatter onto the base set, so the `tools:` line can
  // only ADD: the sidecar's sideEffect is the only thing that keeps Bash away from this agent.
  const meta = JSON.parse(await readFile(join(AGENTS_DIR, 'memoryDefragmenter.meta.json'), 'utf8'));
  assert.equal(meta.sideEffect, 'memory', 'the sidecar is what selects MEMORY_TOOLS');
  const body = await readFile(join(AGENTS_DIR, 'worca-cc-memory-defragmenter.md'), 'utf8');
  const declared = (body.match(/^tools:\s*(.+)$/m)?.[1] || '').split(',').map((t) => t.trim());
  const tools = effectiveAllowedTools(toolsForMeta(meta), declared, false);
  assert.deepEqual(tools, ['Read', 'Write', 'Edit', 'Glob', 'Grep']);
  for (const banned of ['Bash', 'Skill', 'MultiEdit', 'Task', 'Agent']) assert.ok(!tools.includes(banned), banned);
});
