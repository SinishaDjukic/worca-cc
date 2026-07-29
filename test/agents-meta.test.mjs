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

test('every prompt agents/*.md is claimed by some meta.agentFile', async () => {
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
});

test('every meta.agentFile points at a real prompt .md that exists', async () => {
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
});

test('every meta has the required fields and a runnable runnerType', async () => {
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
    assert.equal(typeof meta.loopSource, 'boolean', `${file}: loopSource must be a boolean`);
    assert.equal(typeof meta.order, 'number', `${file}: order must be a number`);
  }
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

test('every sidecar declares produces/consumes/connectsTo explicitly', async () => {
  const files = (await readdir(AGENTS_DIR)).filter((x) => x.endsWith('.meta.json'));
  for (const f of files) {
    const m = JSON.parse(await readFile(join(AGENTS_DIR, f), 'utf8'));
    assert.ok(Array.isArray(m.produces), `${f} produces`);
    assert.ok(Array.isArray(m.consumes), `${f} consumes`);
    assert.ok(m.connectsTo === '*' || Array.isArray(m.connectsTo), `${f} connectsTo`);
  }
});

test('requiresSkills, when present, is an array of non-blank strings', async () => {
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
});

test('normalizeMeta exposes requiresSkills (defaulting to []) and filters junk', async () => {
  const { normalizeMeta } = await import('../src/core/agent-registry.mjs');
  assert.deepEqual(normalizeMeta({ key: 'a', order: 1 }).requiresSkills, []);
  assert.deepEqual(
    normalizeMeta({ key: 'b', order: 2, requiresSkills: ['imagegen', ' ', 3, ' x '] }).requiresSkills,
    ['imagegen', 'x'],
  );
});

test('M4: the two workspace agents are paired (md + sidecar) and scope:"workspace-only"', async () => {
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
});

test('M4: a workspace-only sidecar carries the optional scope field on disk', async () => {
  const raw = JSON.parse(await readFile(join(AGENTS_DIR, 'workspaceScanner.meta.json'), 'utf8'));
  assert.equal(raw.scope, 'workspace-only', 'the sidecar declares scope explicitly');
});
