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
  // the SIDECAR key dies, and the agents/ test below is what pins that.
  [/\b(consumes|optionalConsumes|produces|connectsTo|loopSource)\s*:/,
    'a v1 sidecar wiring field', []],
  [/\bCHANNEL_IDS\b|\bPRESEEDED_CHANNELS\b|\bentrySeedChannels\b|\bvalidateWorkflow\b/,
    'the v1 channel / validator vocabulary', []],
  // The retired coexistence alias. db.mjs is the ONE sanctioned reader: V24's
  // fold has to NAME the id it folds, and that migration is permanent — an
  // upgraded DB can be re-reconciled on any later launch. The client's save-as
  // guard no longer mentions it (there is one reserved id left, `wf_default`).
  [/\bwf_default_v2\b/, 'the coexistence alias', ['src/core/db.mjs']],
  // Emitter AND listener: the CLI's `orch.on('phase', …)` is a remnant too.
  [/(_emit|\.on|\.once)\(\s*['"]phase['"]/, 'the phase event (emitter or listener)', []],
  [/EVENT_NAMES\s*=\s*\[[^\]]*['"]phase['"]/, 'phase in EVENT_NAMES', []],
  [/\bwriteWorkflow\b/, 'the v1 template writer outside workflows.mjs', ['src/core/workflows.mjs']],
  [/\brunners\.mjs\b|\bchannels\.mjs\b|\bworkflow-validator\.mjs\b/, 'a deleted module', []],
];

test('no v1 engine remnant survives in src/ or ui/', () => {
  const hits = [];
  for (const f of files()) {
    const text = stripComments(readFileSync(f, 'utf8'));
    for (const [re, why, allow] of BANNED) {
      if (allow.includes(f)) continue;
      if (re.test(text)) hits.push(`${f}: ${why} (${re})`);
    }
  }
  assert.deepEqual(hits, [], `v1 remnants found:\n${hits.join('\n')}`);
});

// The 11 builtin sidecars live OUTSIDE src/ and ui/, so the sweep above cannot
// see them — Task 16's deletions need their own assertion.
test('no builtin agent sidecar carries a v1 wiring field', () => {
  const bad = [];
  for (const f of readdirSync('agents').filter((n) => n.endsWith('.meta.json'))) {
    const m = JSON.parse(readFileSync(join('agents', f), 'utf8'));
    for (const k of ['consumes', 'optionalConsumes', 'produces', 'connectsTo', 'loopSource', 'uiPhase']) {
      if (k in m) bad.push(`agents/${f}: ${k}`);
    }
    if (m.metaVersion !== 2 || !m.inputs || !m.outputs) bad.push(`agents/${f}: not meta v2`);
  }
  assert.deepEqual(bad, []);
});

// Agent keys are DATA, never control flow: the engine is generic (spec §1).
const AGENT_KEYS = ['planner', 'refiner', 'implementer', 'reviewer', 'decomposer',
  'planReviewer', 'manualTestsChecklist', 'manualWebUiTesting', 'workspaceReviewer'];
// 'clarify' is NOT in the list: it is also an artifact kind, a question kind and
// a DB table name, and `run-harness.mjs` branches on all three.
const KEY_ALLOW = new Set([
  'src/core/agent-registry.mjs',   // LEGACY_LABELS: per-builtin display labels (data)
  'src/core/claude-runner.mjs',    // MOCK_WRITER_ROLES: the offline mock's role table
  'src/core/graph/seed-templates.mjs',
  'src/core/graph/builtin-workflows.mjs',
]);

test('no agent-key literal drives engine or UI control flow', () => {
  const hits = [];
  for (const f of files()) {
    if (KEY_ALLOW.has(f) || !/^src\/core\/(graph|orchestrator|run-harness)|^ui\/public\/graph/.test(f)) continue;
    const text = stripComments(readFileSync(f, 'utf8'));
    for (const k of AGENT_KEYS) {
      if (new RegExp(`['"\`]${k}['"\`]`).test(text)) hits.push(`${f}: hardcodes agent key "${k}"`);
    }
  }
  assert.deepEqual(hits, [], hits.join('\n'));
});

// ── the two sanctioned survivors, pinned rather than banned ─────────────────
// 1. ui/server.mjs's EVENT_NAMES: the pattern above bans `'phase'` INSIDE the
//    literal, which only fires if someone re-adds it. Pin the literal itself so
//    a rename cannot silently retire the check.
test("ui/server.mjs's EVENT_NAMES is the v2 list and never carries 'phase'", () => {
  const src = readFileSync('ui/server.mjs', 'utf8');
  const m = /^const EVENT_NAMES = (\[[^\]]*\]);/m.exec(src);
  assert.ok(m, 'EVENT_NAMES is still declared as a literal array');
  const names = JSON.parse(m[1].replace(/'/g, '"'));
  assert.equal(names.includes('phase'), false, 'the v1 phase event left the wire vocabulary');
  assert.ok(names.includes('exec'), 'exec is the execution vocabulary');
  assert.deepEqual(names, ['exec', 'token', 'log', 'question', 'artifact', 'state',
    'done', 'error', 'subagent', 'stepskills', 'stepgraphify', 'title']);
});

// 2. migrate-fs-to-db.mjs is the ONE module that still WRITES a v1-shaped
//    workflows row (the pre-DB filesystem import). It is sanctioned because
//    reconcileAfterFsImport archives everything it creates — so pin BOTH halves:
//    remove the archive and the writer stops being sanctioned.
test('the fs-import v1 row writer is the only one left, and its rows are archived', () => {
  const src = readFileSync('src/core/migrate-fs-to-db.mjs', 'utf8');
  assert.match(src, /INSERT OR IGNORE INTO workflows \(id,name,version,steps,feedbacks,/,
    'the fs-import writer is still the v1-shaped INSERT this test sanctions');
  // The archive pass lives in db.mjs (P8a Task 6), NOT in the writer's own file.
  assert.match(readFileSync('src/core/db.mjs', 'utf8'),
    /function reconcileAfterFsImport|export function reconcileV1Workflows/,
    'the reconcile pass that archives what this writer creates is still wired in');
  // Nobody else writes a v1-SHAPED row. `feedbacks` alone is not the tell —
  // workflows.mjs and plugin-workflows.mjs name it as a COLUMN while writing
  // GRAPH rows (they also name `graph`). The v1 shape is the column list with
  // steps+feedbacks and NO graph column.
  // FINDING (measured): `writeWorkflow` in src/core/workflows.mjs is the OTHER
  // live v1-row writer and it has ZERO production callers — ui/server.mjs was
  // its last one and P8a Task 8 dropped the import. It survives only because
  // test call sites still write v1 rows through it. Deleting it — and porting
  // those — is the last piece of the kill list; this allowlist entry is what
  // makes that debt visible instead of silent.
  const V1_WRITER_ALLOW = new Set(['src/core/migrate-fs-to-db.mjs', 'src/core/workflows.mjs']);
  const v1Insert = /INSERT[^;]{0,40}INTO workflows \(([^)]*)\)/g;
  for (const f of files()) {
    if (V1_WRITER_ALLOW.has(f)) continue;
    const text = stripComments(readFileSync(f, 'utf8'));
    for (const m of text.matchAll(v1Insert)) {
      const cols = m[1].replace(/\s+/g, '');
      const v1Shaped = cols.includes('steps,feedbacks') && !cols.includes('graph');
      assert.equal(v1Shaped, false, `${f} writes a v1-shaped workflows row: (${cols})`);
    }
  }
});
