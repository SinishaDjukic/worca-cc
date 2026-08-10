// test/agents-sidecars-v2.test.mjs
// THE drift guard between the shipped builtin sidecars and src/core/graph/
// fixtures.mjs. Every graph test (engine AND UI) builds on FIXTURE_PORTS; this
// file is the only place that proves FIXTURE_PORTS still describes what actually
// ships in agents/. Both sides are meta-only — the synthesized `await` port is
// added by the graph ports layer, above the registry, so neither side carries it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { FIXTURE_PORTS } from '../src/core/graph/fixtures.mjs';
import { implementerBody } from '../src/core/phases.mjs';

const AGENTS_DIR = fileURLToPath(new URL('../agents/', import.meta.url));
const PHASES_SRC = fileURLToPath(new URL('../src/core/phases.mjs', import.meta.url));

/** Builtin layer only: the user/plugin layers are ambient state, and this guard
 *  is about the 11 files in agents/. */
const registry = loadAgentRegistry(AGENTS_DIR, { userAgentsDir: null, includePlugins: false });

// ── the pinned exclusion list ───────────────────────────────────────────────
// Written out in full rather than deleted key-by-key at the comparison site: a
// new capability field on a v2 entry must land in FIXTURE_PORTS or be added here
// DELIBERATELY, otherwise the deep-equal below fails. Drop that discipline and
// the guard rots into a tautology.

/** Retained v1 presentation / registry fields the fixture deliberately omits —
 *  they say nothing about ports or capabilities. `scope` is NOT here: it stays
 *  compared (see SCOPE_DEFAULT). */
const EXCLUDED_PRESENTATION = [
  'key', 'displayName', 'description', 'color', 'icon', 'agentFile',
  'domain', 'order', 'fanOut',
  'asksQuestions', 'questionsLocked', 'questionsDefault',
  'promptHints', 'mockRole',
];

/** Fields the REGISTRY derives or stamps rather than reads from a port table, so
 *  a pure port fixture cannot carry them. */
const EXCLUDED_DERIVED = [
  'metaVersion', 'requiresSkills', 'portSummary',                                     // schema stamp, list default, derived text
  'consumes', 'optionalConsumes', 'produces', 'connectsTo', 'channelDefs', 'uiPhase', // the temporary v1-compat shim
  'origin', 'agentPath', 'descriptionDerived',                                        // stamped by scanLayer
];

const EXCLUDED = new Set([...EXCLUDED_PRESENTATION, ...EXCLUDED_DERIVED]);

/** normalizeMeta ALWAYS materializes `scope`; the fixture states it only where it
 *  is not the default. Materializing the default on the expected side keeps the
 *  field compared — a workspace-only scope leaking onto a project agent (or lost
 *  from a workspace agent) still fails — without excluding it. */
const SCOPE_DEFAULT = 'project';

const compared = (entry) => Object.fromEntries(Object.entries(entry).filter(([k]) => !EXCLUDED.has(k)));
const expected = (key) => ({ scope: SCOPE_DEFAULT, ...FIXTURE_PORTS[key] });

// ── the guard ───────────────────────────────────────────────────────────────

test('agents/ ships exactly the 11 builtins FIXTURE_PORTS describes', () => {
  assert.deepEqual(Object.keys(registry).sort(), Object.keys(FIXTURE_PORTS).sort());
  assert.equal(Object.keys(registry).length, 11);
  assert.ok(Object.values(registry).every((m) => m.metaVersion === 2));
});

test('every builtin entry deep-equals FIXTURE_PORTS on ports + capability fields', () => {
  for (const key of Object.keys(FIXTURE_PORTS)) {
    assert.deepEqual(compared(registry[key]), expected(key), `sidecar drift on "${key}"`);
  }
});

// ── the copied directives ───────────────────────────────────────────────────

/** The three ports whose `directive` had to be copied out of phases.mjs before
 *  the engine swap deletes it. */
const DIRECTIVES = [
  { key: 'planner', side: 'inputs', port: 'revise' },
  { key: 'implementer', side: 'inputs', port: 'fix' },
  { key: 'implementer', side: 'inputs', port: 'task' },
];

const directiveOf = (key, side, port) => registry[key][side].find((p) => p.id === port).directive;

test('no directive placeholder survives in the sidecars or the fixtures', () => {
  for (const { key, side, port } of DIRECTIVES) {
    const text = directiveOf(key, side, port);
    assert.ok(text && text.trim(), `${key}.${port} declares a directive`);
    assert.ok(!text.includes('<verbatim'), `${key}.${port} still holds the copy-me placeholder`);
  }
  assert.ok(!readFileSync(fileURLToPath(new URL('../src/core/graph/fixtures.mjs', import.meta.url)), 'utf8').includes('<verbatim'));
});

test('the copied directives are the verbatim phases.mjs prose', () => {
  // The path lines that followed each arm in v1 are NOT part of the copy: the
  // generic port-io block binds every port to its absolute path now.
  const fix = implementerBody({ mode: 'fix', planPath: '/p/plan.md', reviewPath: '/p/review.md' });
  assert.ok(fix.includes(directiveOf('implementer', 'inputs', 'fix')));
  const slice = implementerBody({ planPath: '/p/plan.md', taskPath: '/p/task.md' });
  assert.ok(slice.includes(directiveOf('implementer', 'inputs', 'task')));

  // The planner's REVISE arm is inline in runPlannerPlan, so it is checked
  // against the source text with the `'a ' + 'b'` concatenation glue joined.
  // This assertion dies together with phases.mjs at the engine swap.
  const prose = readFileSync(PHASES_SRC, 'utf8')
    .replace(/['`]\s*\+\s*\s*['`]/g, '')
    .replace(/\\n/g, '\n');
  assert.ok(prose.includes(directiveOf('planner', 'inputs', 'revise')));
});

// ── pins the drift guard cannot see ─────────────────────────────────────────

/** mockRole is excluded from the deep-equal (the fixture is a port table), so the
 *  writer table is pinned here. EXACT case strings from claude-runner's
 *  MOCK_WRITER_ROLES. */
const MOCK_ROLES = {
  clarify: 'clarify',
  planner: 'planner-plan',
  refiner: 'refiner',
  decomposer: 'decomposer',
  implementer: 'implementer',
  reviewer: 'reviewer',
  planReviewer: 'plan-review',
  workspaceReviewer: 'workspace-reviewer',
  workspaceScanner: 'workspace-scan',
  manualTestsChecklist: 'manual-tests-checklist',
  manualWebUiTesting: 'manual-web-ui-testing',
};

test('every builtin pins its v1 mock writer role', () => {
  for (const [key, role] of Object.entries(MOCK_ROLES)) {
    assert.equal(registry[key].mockRole, role, `${key}.mockRole`);
  }
});

test('⟨f⟩ no builtin declares a `start` port, and `await` is nowhere on disk', () => {
  for (const [key, m] of Object.entries(registry)) {
    for (const side of ['inputs', 'outputs']) {
      for (const p of m[side]) {
        assert.notEqual(p.id, 'start', `${key}.${side} still declares the dead start port`);
        assert.notEqual(p.id, 'await', `${key}.${side} declares the engine-reserved await port`);
      }
    }
  }
});

test('the checklist diff instruction lives in promptHints, unconditionally', () => {
  const hints = registry.manualTestsChecklist.promptHints;
  assert.ok(hints.includes('git diff'), 'the dying bespoke builder\'s diff wording has a home');
  assert.ok(!registry.manualTestsChecklist.inputs.some((p) => p.directive), 'it is not input-gated');
});
