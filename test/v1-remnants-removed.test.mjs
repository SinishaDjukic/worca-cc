// test/v1-remnants-removed.test.mjs
// The genericity charter, enforced by test instead of by a one-off grep sweep
// (spec §9 kill list). Every symbol below belonged to the v1 channel/step engine
// and has no v2 successor reading it. A regression here means someone re-grew a
// key table, a channel vocabulary, or a phase map that v2 deliberately does not
// have — so the assertion names the v2 replacement rather than just failing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Every .mjs/.js under the given roots, as [repoRelativePath, source] pairs. */
function sources(...roots) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(mjs|js)$/.test(name)) out.push([relative(ROOT, full), readFileSync(full, 'utf8')]);
    }
  };
  for (const r of roots) walk(join(ROOT, r));
  return out;
}

/** Matching lines as [lineNumber, text], 1-indexed. */
function hits(src, token) {
  return src.split('\n')
    .map((text, i) => [i + 1, text])
    .filter(([, text]) => text.includes(token));
}

/** The comment portion of a line: a whole-line `//`/jsdoc line, or the tail of a
 *  trailing `//`. Enough to tell "documented history" from live code. */
function commentPart(text) {
  if (/^\s*(\/\/|\*|\/\*)/.test(text)) return text;
  const at = text.indexOf('//');
  return at === -1 ? '' : text.slice(at);
}

// ── Gate 1: the v1 vocabulary is GONE from src/ and ui/ ───────────────────────

/** Not one occurrence survives, comment or code: these names must not be read,
 *  written, or discussed as live surface anywhere. */
const DEAD = [
  'legacyFields',        // v1 sidecar carry-through
  'BESPOKE_BASE',        // died with channels.mjs
  'connectsTo',          // v1 adjacency; v2 legality is typed ports (canWire)
  'optionalConsumes',    // v1 channel bucket; v2 uses `required` on a port
  'entrySeedChannels',   // v1 entry seeding; v2 seeds from the Task card token
  'CHANNEL_IDS',         // the built-in channel vocabulary itself
  'CHANNEL_ID_LIST',
  'DEFAULT_SPEC',        // the hardcoded per-key channel table
  'STEP_ROLES',
  'AGENT_STEPS',         // boot-time step snapshot; agentSteps() is the live source
  'registryToSteps',
  'LEGACY_LABELS',
  'collectChannelDefs',
  'channelDefs',
  'reviewKindOf',        // superseded by orchestrator verdictKindOf (port filename)
  'resolveAwaitOutType', // Amendment f: the Await node was never created
  'runAwaitExecution',
];

/** Allowed only on COMMENT lines — history worth keeping, surface that is gone. */
const COMMENT_ONLY = ['FANOUT_ELIGIBLE', 'composer-core'];

/** `uiPhase` is live ONLY on the frozen-v1-history path (charter exception (c)):
 *  the DB column round-trip and the legacy stepper renderer. It must never
 *  re-enter the graph engine or a shared client path. */
const UI_PHASE_ALLOWED = new Set([
  'src/core/db.mjs',           // SCHEMA_V3 sub_agents.ui_phase
  'src/core/artifacts.mjs',    // ui_phase column read/write
  'src/core/orchestrator.mjs', // stamps the node key onto the record
  'ui/public/app.js',          // legacyStepRows, the sanctioned renderer
]);

test('the v1 channel/step vocabulary has zero occurrences in src/ and ui/', () => {
  const found = [];
  for (const [file, src] of sources('src', 'ui')) {
    for (const token of DEAD) {
      for (const [line] of hits(src, token)) found.push(`${file}:${line} ${token}`);
    }
  }
  assert.deepEqual(found, [], `v1 vocabulary resurfaced:\n${found.join('\n')}`);
});

test('the dead-surface names that survive are comments quoting history, never code', () => {
  const code = [];
  for (const [file, src] of sources('src', 'ui')) {
    for (const token of COMMENT_ONLY) {
      for (const [line, text] of hits(src, token)) {
        if (!commentPart(text).includes(token)) code.push(`${file}:${line} ${token}`);
      }
    }
  }
  assert.deepEqual(code, [], `dead surface referenced from live code:\n${code.join('\n')}`);
});

test('uiPhase is confined to the DB round-trip and the legacy history renderer', () => {
  const stray = [];
  for (const [file, src] of sources('src', 'ui')) {
    if (UI_PHASE_ALLOWED.has(file)) continue;
    for (const [line] of hits(src, 'uiPhase')) stray.push(`${file}:${line}`);
  }
  assert.deepEqual(stray, [], `uiPhase escaped the legacy path:\n${stray.join('\n')}`);
});

// ── Gate 2/3: Amendment f never created an Await node or a `start` port ───────

test('no await node kind and no merge node kind exist in the graph engine or composer', () => {
  const found = [];
  for (const [file, src] of sources('src/core/graph', 'ui/public/graph')) {
    for (const token of ["kind === 'await'", "kind: 'await'", "'merge'"]) {
      for (const [line] of hits(src, token)) found.push(`${file}:${line} ${token}`);
    }
  }
  assert.deepEqual(found, [], `the Await/Merge nodes must not exist:\n${found.join('\n')}`);
});

test('the v1 checklist `start` port never resurfaces — the await gate replaced it', () => {
  const found = [];
  for (const [file, src] of sources('src', 'ui')) {
    for (const token of ["id: 'start'", "port: 'start'"]) {
      for (const [line] of hits(src, token)) found.push(`${file}:${line} ${token}`);
    }
  }
  assert.deepEqual(found, [], `a start port resurfaced:\n${found.join('\n')}`);
});

// ── Gate 4: agent keys are DATA, never branched on in the engine ──────────────

const AGENT_KEYS = [
  'implementer', 'reviewer', 'planner', 'refiner', 'decomposer', 'workspaceReviewer',
  'manualTestsChecklist', 'manualWebUiTesting', 'planReviewer',
];

test('the engine branches on no agent key — capability meta decides, not identity', () => {
  // The two sanctioned key literals that remain are NOT agent identity:
  //   * phases.mjs `resolveAgentBody(ctx, 'workspaceScanner')` — the scanner is an
  //     off-pipeline builtin driven by runWorkspaceScan, never a graph node
  //     (placeable:false), so it has no node whose key could supply the body.
  //   * orchestrator.mjs `kind === 'clarify'` — the QUESTION-KIND protocol literal
  //     (question vocabulary), which happens to share a spelling with an agent key.
  const ENGINE = [
    'src/core/phases.mjs', 'src/core/orchestrator.mjs', 'src/core/workflows.mjs',
    'src/core/graph/executor.mjs', 'src/core/graph/scheduler.mjs',
    'src/core/graph/validate.mjs', 'src/core/graph/ports.mjs',
  ];
  const found = [];
  for (const file of ENGINE) {
    const src = readFileSync(join(ROOT, file), 'utf8');
    for (const key of AGENT_KEYS) {
      for (const token of [`=== '${key}'`, `'${key}' ===`, `key: '${key}'`]) {
        for (const [line, text] of hits(src, token)) {
          if (commentPart(text).includes(token)) continue;
          found.push(`${file}:${line} ${token}`);
        }
      }
    }
  }
  assert.deepEqual(found, [], `an agent key became control flow again:\n${found.join('\n')}`);
});

// ── The registry no longer decorates metas with the v1 channel view ───────────

test('a loaded agent meta carries no v1 channel fields', async () => {
  const { loadAgentRegistry } = await import('../src/core/agent-registry.mjs');
  const registry = loadAgentRegistry(undefined, { userAgentsDir: null });
  const shimFields = ['consumes', 'optionalConsumes', 'produces', 'connectsTo', 'channelDefs', 'uiPhase'];
  for (const [key, meta] of Object.entries(registry)) {
    for (const field of shimFields) {
      assert.equal(Object.hasOwn(meta, field), false, `${key} must not carry v1 '${field}'`);
    }
    assert.ok(Array.isArray(meta.inputs) && Array.isArray(meta.outputs), `${key} carries v2 ports`);
  }
});

test('agent-registry exports only its v2 surface', async () => {
  const mod = await import('../src/core/agent-registry.mjs');
  for (const gone of ['CHANNEL_ID_LIST', 'collectChannelDefs', 'registryToSteps']) {
    assert.equal(gone in mod, false, `agent-registry must not export ${gone}`);
  }
  for (const kept of ['loadAgentRegistry', 'normalizeMeta', 'validateMetaV2', 'collectDomains']) {
    assert.equal(typeof mod[kept], 'function', `${kept} is live v2 surface`);
  }
});

test('config exposes the live agentSteps() only — no boot-time AGENT_STEPS snapshot', async () => {
  const mod = await import('../src/core/config.mjs');
  assert.equal('AGENT_STEPS' in mod, false, 'the stale boot snapshot is gone');
  assert.equal(typeof mod.agentSteps, 'function');
  const steps = mod.agentSteps();
  assert.ok(steps.length > 0);
  for (const s of steps) {
    assert.equal(typeof s.key, 'string');
    assert.equal(typeof s.label, 'string');
  }
});

test('artifacts exposes no reviewKindOf — the review kind comes from the verdict filename', async () => {
  const mod = await import('../src/core/artifacts.mjs');
  assert.equal('reviewKindOf' in mod, false);
  assert.equal(typeof mod.writeReview, 'function', 'the caller supplies the kind');
});
