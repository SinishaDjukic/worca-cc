// test/v1-remnants-removed.test.mjs
// The v2 break's tripwire: the v1 engine's vocabulary must never reappear in
// shipping code. Each pattern below killed a concrete thing (spec §11); the
// allowlist names the ONE sanctioned reader of each survivor.
//
// COMMENTS ARE STRIPPED BEFORE MATCHING. Every pattern here names a v1 SYMBOL,
// and prose that merely mentions one ("the v1 FANOUT_ELIGIBLE key list") is
// documentation, not a remnant. Matching raw text produced 20+ false positives
// on a correctly-finished P8b (measured 2026-08-28).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { posix } from './helpers/posix-path.mjs';

const ROOTS = ['src', 'ui'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor']);

function files() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      if (SKIP_DIRS.has(e)) continue;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(mjs|js|json|css|html)$/.test(e)) out.push(posix(p));   // allowlists are POSIX-shaped
    }
  };
  for (const r of ROOTS) walk(r);
  return out;
}

/** Blank out line and block comments, preserving line count. Strings that look
 *  like comments are rare in this tree and only ever cause a MISS, never a
 *  false positive, so the guard stays sound. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

// [pattern, why, allowlist of paths that may still match]
const BANNED = [
  // db.mjs:254 is a SQL comment inside a DDL template literal (stripComments
  // only understands JS comments), describing a column that outlives the builder.
  [/\bbuildStepperManifest\b/, 'the v1 stepper manifest builder', ['src/core/db.mjs']],
  [/\brewriteStepperForDecomposition\b/, 'the decomposition manifest rewrite', []],
  [/\bresolveWorkflow\b/, 'the v1 topology resolver', []],
  [/\bCLIENT_DEFAULT_STEPPER\b|\bnormalizePhase\b|\blocateInManifest\b|\badvanceRun\b|\bbuildRunGraph\b|\brunStatusOf\b/,
    'the v1 client stepper + column painter', []],
  // The v1 sidecar vocabulary, as a FIELD (`consumes:`) — never as a bare word.
  // `src/cli/render.mjs` defines a v2 helper literally named `loopSource(ev,…)`;
  // a bare \bloopSource\b would flag it forever. `uiPhase` is NOT here: the
  // RUNTIME attribution field survives (the sub_agents.ui_phase column). Only
  // the SIDECAR key dies, and test/agents-meta.test.mjs is what pins that.
  // The workspace interconnection map (src/{shared,core}/workspace-map/) has a field of its OWN
  // named `consumes` — a member's consumed boundary facts (map spec §5.1), not the v1 sidecar
  // field — so both folders are exempt as DIRECTORY prefixes (entries ending in '/').
  [/\b(consumes|optionalConsumes|produces|connectsTo|loopSource)\s*:/,
    'a v1 sidecar wiring field', ['src/shared/workspace-map/', 'src/core/workspace-map/']],
  [/\bCHANNEL_IDS\b|\bPRESEEDED_CHANNELS\b|\bentrySeedChannels\b|\bvalidateWorkflow\b/,
    'the v1 channel / validator vocabulary', []],
  // The retired coexistence alias. db.mjs is the ONE sanctioned reader: V24's
  // fold has to NAME the id it folds, and that migration is permanent — an
  // upgraded DB can be re-reconciled on any later launch. The client's save-as
  // guard no longer mentions it (the reserved ids are the built-ins: `wf_default`,
  // `wf_auto`, `wf_memory_defrag`).
  [/\bwf_default_v2\b/, 'the coexistence alias', ['src/core/db.mjs']],
  // Emitter AND listener: the CLI's `orch.on('phase', …)` is a remnant too.
  [/(_emit|\.on|\.once)\(\s*['"]phase['"]/, 'the phase event (emitter or listener)', []],
  [/EVENT_NAMES\s*=\s*\[[^\]]*['"]phase['"]/, 'phase in EVENT_NAMES', []],
  [/\bwriteWorkflow\b/, 'the v1 template writer outside workflows.mjs', ['src/core/workflows.mjs']],
  [/\brunners\.mjs\b|\bchannels\.mjs\b|\bworkflow-validator\.mjs\b/, 'a deleted module', []],
];

/** An allowlist entry is an exact POSIX path, or a directory prefix when it ends in '/'. */
const allowed = (f, allow) => allow.some((a) => (a.endsWith('/') ? f.startsWith(a) : a === f));

/** [[path, text]] → one "path: why (re)" line per banned pattern matching outside its allowlist. */
function remnantHits(entries) {
  const hits = [];
  for (const [f, raw] of entries) {
    const text = stripComments(raw);
    for (const [re, why, allow] of BANNED) {
      if (allowed(f, allow)) continue;
      if (re.test(text)) hits.push(`${f}: ${why} (${re})`);
    }
  }
  return hits;
}

test('no v1 engine remnant survives in src/ or ui/', () => {
  const hits = remnantHits(files().map((f) => [f, readFileSync(f, 'utf8')]));
  assert.deepEqual(hits, [], `v1 remnants found:\n${hits.join('\n')}`);
});

// Agent keys are DATA, never control flow: the engine is generic (spec §1).
const AGENT_KEYS = ['planner', 'refiner', 'implementer', 'reviewer', 'decomposer',
  'planReviewer', 'manualTestsChecklist', 'manualWebUiTesting', 'workspaceReviewer', 'memoryDefragmenter'];
// 'clarify' is NOT in the list: it is also an artifact kind, a question kind and
// a DB table name, and `run-harness.mjs` branches on all three.
const KEY_ALLOW = new Set([
  'src/core/agent-registry.mjs',   // LEGACY_LABELS: per-builtin display labels (data)
  'src/core/engines/mock.mjs',     // MOCK_WRITER_ROLES: the offline mock's role table
  'src/core/graph/seed-templates.mjs',
  'src/core/graph/builtin-workflows.mjs',
  'src/core/auto/recipes.mjs',   // Auto recipes: prompt + mock data (D23 — the ONE Auto module that may name agents)
]);

test('no agent-key literal drives engine or UI control flow', () => {
  const hits = [];
  for (const f of files()) {
    if (KEY_ALLOW.has(f) || !/^src\/core\/(graph|orchestrator|run-harness|auto)|^src\/shared\/graph\/(assemble|isomorphic|flow-layout)|^ui\/public\/(graph|auto-proposal)/.test(f)) continue;
    const text = stripComments(readFileSync(f, 'utf8'));
    for (const k of AGENT_KEYS) {
      if (new RegExp(`['"\`]${k}['"\`]`).test(text)) hits.push(`${f}: hardcodes agent key "${k}"`);
    }
  }
  assert.deepEqual(hits, [], hits.join('\n'));
});
