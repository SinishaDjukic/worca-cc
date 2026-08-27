# P2 dry-run + mutation audit — executed report

Clone: `/private/tmp/claude-501/-Users-denislavprinov-Develop-worca-cc/ea320046-44d4-4f4c-b84b-0707426277b2/scratchpad/clones/p2`
Branch: `worca-cc/node-graph-v2-p2` off dev `e6968e15`.
Plans read from the FROZEN snapshots in `scratchpad/v1-snapshots/` (the repo copies were
edited in place mid-run by the cross-plan contract pass; the snapshots are byte-identical
to the text this dry-run started from: P1 150698 B, P2 306729 B).

Environment note: this macOS box has NO `timeout`/`gtimeout` binary. Every test/node
command was wrapped in an equivalent shell watchdog
(`scratchpad/tmo.sh <secs> <cmd...>`, kill -9 on expiry). No servers, browsers or
non-exiting processes were started.

---

## §0 — P1 prerequisite deviations

P1 was executed IN FULL in the clone as the prerequisite. **It ran green end-to-end
at 3805/3805, exactly BASELINE (3760) + 45 as Task 11 predicts.** No task had to be
skipped, and the harness-move task's line-count/member-count assertions all held —
so P2's Task 0 sentinel for `RunHarness` IS met.

Only three cosmetic mismatches, none blocking, none requiring a plan edit to execute:

**(P1-a) Task 2 Step 6 — oracle test count is 156, not "126 + 43" (=169).**
The gate the step actually states (`Expected: # fail 0`) was met. The parenthetical
reference number is stale. Plan-ready fix — in P1 Task 2 Step 6 replace:
> `Expected: # fail 0` (measured: 126 + 43 passing across these files with the split applied).

with:
> `Expected: # fail 0` (measured 2026-08-27 on a clone of dev `e6968e15`: **156** passing across these ten files with the split applied).

**(P1-b) Task 8 Step 1 anchor — `app.use('/vendor', …)` 404 tail is at `:766` and
`express.static(PUBLIC_DIR…)` at `:771` on dev, as written; but the plan's prose says
"ends `:769`". The verbatim anchor text matched exactly once, so the insert was
unambiguous. No fix needed beyond the prose number.

**(P1-c) Task 11 Step 4 (manual browser verification) was NOT performed** — the
dry-run brief forbids servers/browsers. Everything else in Task 11 was run.
Task 11's other greps all pass: `grep -c "_phase(" src/core/orchestrator.mjs` → `0`;
`grep -rn "from '/src/shared" ui/ src/ test/ | wc -l` → `0`.

Nothing in P1 needed a code change to run as written. The extraction script assembles
from the plan's six code fences in the stated order (constants, scan/cut, S1–S11, S12,
assembly) and printed EXACTLY the predicted
`run-harness.mjs 2693 lines; orchestrator.mjs 1780 lines`.
Task 9's `git show origin/worca-cc/v2-orchestrator-bfb6a0ed:…` path worked and produced
files of exactly the stated sizes (49 / 318 lines); Task 9 Step 4 printed the predicted
`wf_full:11/17 wf_no-clarify:9/13 …` string verbatim.

---

## §1 — Per-task execution log (P2a, Tasks 0–14)

Format: predicted (`Expected:`) → actual, with the decisive output line.

### Task 0 — branch, deps, sentinels, baseline
- Step 1 `git rev-parse --abbrev-ref HEAD` → `worca-cc/node-graph-v2-p2`. OK.
- Step 2 `node_modules` present (clone was `npm ci`'d). OK.
- Step 3 predecessor sentinel → printed **`P1-OK`**. As predicted.
- Step 4 constants contract → no `MISSING` lines; `LIMITS` printed
  `{"maxNodes":80,"maxWires":200,"maxPortsPerSide":8,"minArity":2,"maxArity":8,"maxCycles":20,"maxNameLen":80}`.
  Both `maxNodes` and `maxWires` are finite, so the step's fallback ("ADD them … 60/120")
  was NOT needed.
- Step 5 old branch: `git rev-parse --verify origin/worca-cc/v2-orchestrator-bfb6a0ed` →
  `0e6cee6f…`. Available.
- Step 6 **BASELINE = 3760/3760, fail 0** (this is dev's number; after P1 the working
  baseline for P2 is **3805**).

### Task 1 — `src/shared/graph/ports.mjs`
- Step 1 RED: `ERR_MODULE_NOT_FOUND` for `ports.mjs`. As predicted.
- Step 2 GREEN: `Expected: PASS — 8 tests passing` → `tests 11 / pass 11 / fail 0`
  for `graph-ports` + `shared-graph-purity` together, i.e. **8 + 3**. Exactly as predicted.
- Step 3 committed. The plan's hedge ("if `gatePorts` returns a bare array, adapt this
  one call site") was NOT needed — P1's `gatePorts` returns `{inputs, outputs}`.

### Task 2 — `src/shared/graph/loops.mjs`
- Step 1 RED: `ERR_MODULE_NOT_FOUND`. As predicted.
- Step 2 GREEN: `tests 7 / pass 7 / fail 0`.
- Step 3 committed.

### Task 3 — `src/shared/graph/validate.mjs` (V1–V21) — **ONE BLOCKING DEVIATION**
- Step 1 RED: module missing. As predicted.
- Step 2 first run: `tests 23 / pass 1 / fail 22`, every failure
  **`TypeError: KINDS.has is not a function`**. See §2 D1. After the one-line fix:
  `tests 23 / pass 23 / fail 0`.
- Step 3 mutation audit (the plan's own step): all 21 rules bite. See §3.
- Step 4 committed.

### Task 4 — `src/shared/graph/template.mjs`
- `Expected: PASS — 10 tests passing` → 10 passing (measured jointly with Task 5:
  `tests 20 / pass 20 / fail 0`). As predicted.

### Task 5 — `src/shared/graph/geometry.mjs`
- `Expected: PASS — 10 tests passing` → 10 passing. As predicted.

### Task 6 — `layout.mjs` + `thumbnail.mjs`
- `Expected: PASS — 7 tests passing` (5 layout + 2 thumbnail) → `tests 7 / pass 7 / fail 0`.
  As predicted.

### Task 7 — `src/shared/graph/agent-meta.mjs`
- `Expected: PASS — 11 tests passing` → `tests 11 / pass 11 / fail 0`. As predicted.

### Task 8 — `MOCK_WRITER_ROLES`
- Anchors: `const MOCK_FANOUT_ROLES = new Set([` at `:849` (plan says `:849` ✓);
  the two switch arms at `:1066` / `:1075` (plan says `:1065-1105` — off by one, harmless,
  the verbatim case text matched once each).
- Step 2 `Expected: PASS — 2 tests passing` → 2 passing. Together with every `mock*`
  suite: `tests 23 / pass 23 / fail 0`.
- **Note:** the step names `test/mock-runner.test.mjs test/mock-graphify.test.mjs`;
  NEITHER FILE EXISTS. The step's own fallback ("run `ls test | grep mock` and run them
  all") is what works: the five real files are `claude-runner-ask-mock`,
  `mock-writer-roles`, `skill-mock`, `subagent-mock`, `workspace-mock`. See §2 D4.

### Task 9 — dual-shape sidecars (22 files)
- Step 1 applied: 11 JSON key blocks + 11 `## Ports` markdown blocks.
  **Placement note (not a deviation, but the plan does not state it):** the JSON blocks
  are given with a 2-space indent AND a trailing comma, so the only insertion point that
  needs zero comma surgery is immediately after the object's opening `{`. That is what
  was done; existing keys keep their relative order, satisfying "no reordering".
- Step 2 → printed **`ALL 11 VALID`**. Exactly as predicted.
- Step 3 → `22 files changed, 209 insertions(+), 38 deletions(-)`;
  `git diff agents/ | grep -c '^-## Inputs (from the task prompt)'` → **7**;
  removed lines inside `agents/*.meta.json` → **0** (no v1 JSON key lost). As predicted.
- Step 4 committed.

### Task 10 — registry merge + `registryPortsFn` — **ONE BLOCKING DEVIATION**
- Anchors: `normalizeMeta` at `:189` ✓, the deleted backward-compat block at `:90-99` ✓,
  imports at `:11-16` ✓.
- Step 1 RED then Step 2/3/4 implemented.
- First run: `tests 11 / pass 10 / fail 1` — the promptHints pin expected FIVE builtins
  but SIX carry hints, because **Task 9's own `implementer.meta.json` block adds
  `promptHints`**. Plan-internal contradiction. See §2 D2. After the fix:
  `tests 11 / pass 11 / fail 0` (`Expected: PASS — 6 tests passing` for the new ones ✓).
- Step 4 regressions: the seven named suites → `tests 41 / pass 41 / fail 0`.
- Step 5 `grep -n "res.json({ agents" ui/server.mjs` → `3928:` (plan says `:3913`;
  the line moved because P1 inserted the `/src/shared` mount above it). The assertion
  the step makes — "objects pass through; no field list to update" — HOLDS: the handler
  is `res.json({ agents, channels: collectChannelIds(all) })`, unchanged.
- Step 6 committed.

### Task 11 — `src/shared/graph/manifest.mjs`
- `Expected: PASS — 9 tests passing` → 9 passing (measured in the Task 11–13 batch).

### Task 12 — `ui/public/graph/model.mjs` + single-source guard
- `Expected: PASS — 2 tests passing` → 2 passing; `shared-graph-purity` and
  `api-shared-static` stayed green in the same run, as the step requires.

### Task 13 — seed drift guard — **ONE BLOCKING DEVIATION**
- `Expected: PASS — 3 new tests passing`. First run: `tests 31 / pass 30 / fail 1` —
  `wf_full.w1 budget placement`, `actual: undefined, expected: false`. The assertion is
  written `w.config && w.config.maxCycles !== undefined`, which short-circuits to
  `undefined` (not `false`) for the seed wires that carry no `config` key at all, and
  `assert/strict`'s `equal` is `strictEqual`. See §2 D3. After the fix:
  `tests 31 / pass 31 / fail 0`.
- Importantly, the guard's REAL job passed on the first try: all 8 seed graphs validate
  0 errors / 0 warnings against the REAL Task 9 sidecars. No sidecar/seed drift.

### Task 14 — P2a full suite
- `Expected: BASELINE + 97 passing, 0 failing`. Actual: **3902 / 3902, fail 0**.
  With the P1-inclusive baseline 3805, that is 3805 + 97 — the predicted delta EXACTLY.
- Step 2 purity + static guards: green (run with Tasks 11–13).

---

## §1b — Per-task execution log (P2b, Tasks B0–B10)

### Task B0 — entry check
- Step 3 P2a sentinel → printed **`P2a-OK`**.
- Step 4 BASELINE-B = **3902** (the same run as Task 14; the halves were executed
  back-to-back in one clone, so P2a's total IS P2b's baseline).

### Task B1 — DB V23
- Anchors verified: `SCHEMA_VERSION = 22` at `:56` ✓, `INCREMENTAL_COLUMNS` at `:732` ✓,
  `INCREMENTAL_TABLES` at `:752` ✓, `if (current < 22) applySchemaV22(db);` in the ladder ✓.
- Step 1 RED: `Expected values to be strictly equal: 22 !== 23` — VERBATIM as predicted.
- Step 4 version-pin sweep: **NOT empty, and cannot be** — see §2 D5. The two prose
  comments the plan names were updated; the tightened sweep is genuinely empty.
- Step 5 → `tests 66 / pass 66 / fail 0` (4 new + the five named suites).
  `test/db-pause-schema.test.mjs` (which pins a version) also re-checked green.

### Task B2 — v2 workflow rows
- Anchors: `rowToTpl :206` ✓, `readRaw :221` ✓, `readWorkflow :277` ✓,
  `listWorkflows :287` ✓, `resolveWorkflow :371` ✓.
- `Expected: PASS — 6 tests passing` → `tests 6 / pass 6 / fail 0`.
- Regressions (5 named suites) → `tests 82 / pass 82 / fail 0`.
- **Editing note:** the plan gives `writeGraphWorkflow` and
  `readWorkflow`/`listWorkflows`/`assertRunnableWorkflow` in ONE fence with the three
  read functions interleaved. Splicing that fence wholesale duplicates
  `listWorkflows`' body. Insert `writeGraphWorkflow` beside `writeWorkflow` and
  `assertRunnableWorkflow` after `listWorkflows` as SEPARATE edits.

### Task B3 — per-wire budgets — **ONE DEVIATION**
- Anchors: `ensure :553` ✓, `setFeedbackCycles :674` ✓, `resetWorkflowConfig :701` ✓,
  `resolveRunConfig :747` ✓.
- First run: `tests 54 / pass 53 / fail 1` — `Error: unknown model "sonnet"`.
  See §2 D6. After the fix: `tests 54 / pass 54 / fail 0`
  (`Expected: PASS — 4 tests passing` ✓, plus the four named suites).

### Task B4 — `resolveGraph` — **THREE DEVIATIONS in one test**
- First run: `tests 7 / pass 4 / fail 3` —
  `unknown model "override-model"`, `unknown model "legacy-model"`,
  `ReferenceError: readWorkflow is not defined`. See §2 D6, D7, D8.
  After the fixes: `tests 7 / pass 7 / fail 0` (`Expected: PASS — 7 tests passing` ✓).

### Task B5 — `/api/workflows` v2 — **TWO DEVIATIONS**
- Anchors: `GET /api/workflows :3131` (plan `:3116`), `GET /api/workflows/:id :3141`
  (plan `:3126`), `POST /api/workflows :3151` (plan `:3136`) — all +15, because P1's
  `/src/shared` mount added 15 lines above. Verbatim anchor text matched once each.
- Step 1's boot preamble is a PLACEHOLDER ("COPY the before/after block of
  test/api-workflows.test.mjs verbatim") — resolved text in §2 D8a.
- After lifting: `tests 24 / pass 23 / fail 1` — `'V6' !== 'V7'`. See §2 D9.
  Final: `tests 24 / pass 24 / fail 0` (`Expected: PASS — 5 tests passing` ✓).

### Task B6 — `/api/config` wires
- Anchor: the `feedbacks` block at `:2784` (plan says PATCH /api/config `:2751`).
- `Expected: PASS — 3 tests passing` → `tests 19 / pass 19 / fail 0`
  (3 new + `config-api` unchanged).

### Task B7 — one runnable gate — **TWO DEVIATIONS**
- Anchors: server `readWorkflow(workflowId)` check at `:1080` (plan `:1062`),
  CLI `const orch = createOrchestrator({` at `:1526` ✓ (there are TWO — `:809`
  is `cmdResume`; the plan's `:1526` is the run path and is the one to patch),
  proposal `:104-106` ✓.
- Failures: the test file carries the SAME unresolved boot-preamble placeholder
  (§2 D8b), and the proposal change breaks the deps injection seam (§2 D10).
  After both fixes: `tests 3 / pass 3 / fail 0` (`Expected: PASS — 3` ✓),
  `ask-proposal` 5/5, and the 11 suites that POST /api/run → `tests 143 / pass 143`.

### Task B8 — Ask `shapeWorkflow`
- `Expected: PASS — 3 tests passing` → 3 passing; all 42 `test/ask-*.test.mjs`
  → `tests 424 / pass 424 / fail 0`.

### Task B9 — v1 consumers tolerate graph rows
- Anchors: `agent-store :133` ✓, `plugin-workflows :165-178` ✓,
  `buildNodeConfigRows :2669` ✓, `buildFeedbackRows :2813` ✓,
  `composerRenderList :2561` ✓ — every one EXACT.
- `Expected: PASS — 2 tests passing` → `tests 44 / pass 44 / fail 0`
  (2 new + the four named suites).

---

## §2 — Deviations / placeholder resolutions (plan-ready text)

Ten changes were needed. **D1, D2, D3, D6, D7, D8, D8a, D8b, D9, D10 are BLOCKING**
(the plan as written does not run without them). D4 and D5 are prose/command fixes.

### D1 — Task 3 Step 2: `KINDS.has()` on P1's frozen ARRAY  (BLOCKING)
`validate.mjs`'s V2/V3 kind check calls `KINDS.has(n.kind)`, but P1's `constants.mjs`
exports `KINDS` as `Object.freeze([...])` — an Array. Every one of the 23 tests dies
with `TypeError: KINDS.has is not a function` (`pass 1 / fail 22`).

In Task 3 Step 2's first implementation block (rule **V3**), replace:
```js
      if (!KINDS.has(n.kind)) {
```
with:
```js
      if (!KINDS.includes(n.kind)) {
```
(`ARITY_KINDS` in the same file is a locally-declared `new Set([...])` and is correct
as written — do not touch it. Nothing else in the tree calls `.has` on a P1 array
constant: `grep -n "KINDS\.has\|PORT_TYPES\.has\|FLOW_KINDS\.has" src/shared/graph/*.mjs`
returns nothing after this fix.)

### D2 — Task 10 Step 1: the promptHints pin says FIVE, Task 9 makes it SIX  (BLOCKING)
Task 9's `agents/implementer.meta.json` block adds
`"promptHints": "Work inside the project directory (your cwd). Commit nothing; just edit files and tests.",`
so six builtins carry hints, not five. The plan's own assertion then fails with
`actual: ['implementer','manualTestsChecklist','manualWebUiTesting','planReviewer','refiner','workspaceReviewer']`.

In Task 10 Step 1's appended test, replace:
```js
  // Exactly five builtins carry prompt hints; the other six stay empty (this
  // replaces the old "promptHints === '' for all 11" pin).
  assert.deepEqual(Object.values(reg).filter((m) => m.promptHints).map((m) => m.key).sort(),
    ['manualTestsChecklist', 'manualWebUiTesting', 'planReviewer', 'refiner', 'workspaceReviewer']);
```
with:
```js
  // Exactly six builtins carry prompt hints; the other five stay empty (this
  // replaces the old "promptHints === '' for all 11" pin).
  assert.deepEqual(Object.values(reg).filter((m) => m.promptHints).map((m) => m.key).sort(),
    ['implementer', 'manualTestsChecklist', 'manualWebUiTesting', 'planReviewer', 'refiner', 'workspaceReviewer']);
```

### D3 — Task 13 Step 1: `w.config && …` is `undefined`, not `false`  (BLOCKING)
Seed wires that are not loop wires carry NO `config` key, so `w.config && …`
short-circuits to `undefined`; `assert/strict`'s `equal` is `strictEqual`, so it
fails `actual: undefined, expected: false` on `wf_full.w1`.

In Task 13 Step 1's appended test, replace:
```js
      const budgeted = w.config && w.config.maxCycles !== undefined;
```
with:
```js
      const budgeted = w.config?.maxCycles !== undefined;
```

### D4 — Task 8 Step 2: the named mock suites do not exist  (prose)
`test/mock-runner.test.mjs` and `test/mock-graphify.test.mjs` are not in the tree.
Replace the Expected line's file list with the real five:
> `node --test test/mock-writer-roles.test.mjs test/claude-runner-ask-mock.test.mjs test/skill-mock.test.mjs test/subagent-mock.test.mjs test/workspace-mock.test.mjs`
> `Expected: # fail 0` (measured 2026-08-27: 23 passing).

### D5 — Task B1 Step 4 / B10 Step 2: the version-pin sweep can never be empty  (command)
`grep -rn -A1 "user_version" test/*.mjs | grep -w 22` also matches grep's OWN
line/context prefixes (`test/subagent-migration-v6.test.mjs-22-`, `…v7.test.mjs:22:`,
`…v8.test.mjs:22:`, `test/db-pause-schema.test.mjs:22:`) — four false hits that have
nothing to do with a schema pin. Replace the command in BOTH places with one that
matches the pin itself:
```bash
grep -rn "user_version *= *22\|user_version, 22\|user_version === 22" test/*.mjs | grep -v db-migrate-v23
```
`Expected: empty output` (verified empty after the two prose comments are updated).

### D6 — Tasks B3 & B4: the tests use model ids and an effort the catalog does not have  (BLOCKING)
`setNodeModel`/`setStep` validate `model` against `listModels()` and `effort` against
the model's own `efforts` list (`src/core/config.mjs:628-635`). The plan uses
`'sonnet'`, `'override-model'`, `'legacy-model'` — none is a catalog id — and
`effort: 'low'`, which NO shipped model supports (every entry is a subset of
`medium|high|xhigh|max`). `sanitizeNodeDefaults` likewise drops `'low'`.

**Task B3 Step 1** — in `test/config-wire-cycles.test.mjs`, replace both occurrences of
`{ model: 'sonnet' }` with `{ model: 'claude-opus-4-8' }` (the id
`test/config.test.mjs` already uses):
```js
  await setNodeModel(projectDir, 'wf_g', 'n_plan', { model: 'claude-opus-4-8' });
  ...
  assert.deepEqual(cfg.workflows.wf_g.nodes.n_plan, { model: 'claude-opus-4-8' });
```

**Task B4 Step 1** — in `test/workflows-resolve-graph.test.mjs`:
`'override-model'` → `'claude-opus-4-8'`, `'legacy-model'` → `'claude-sonnet-5'`, and
both `effort: 'low'` → `effort: 'medium'`:
```js
  await setNodeModel(projectDir, id, 'n_plan', { model: 'claude-opus-4-8', effort: 'medium' });
  assert.equal((await resolveGraph(projectDir, id, REG())).nodes.n_plan.effort, 'medium');
  ...
  const updated = await setWorkflowNodeDefaults(id, { n_plan: { model: 'm2', effort: 'medium' }, n_impl: { fanOut: true } });
  assert.deepEqual(updated.nodes.find((n) => n.id === 'n_plan').config, { model: 'm2', effort: 'medium' });
```
(`config: { model: 'tpl-model', effort: 'high' }` on the RAW template node stays as
written — raw template config is not validated, only the overlay setters are.
`model: 'm2'` inside `setWorkflowNodeDefaults` also stays — `sanitizeNodeDefaults`
does not check the model catalog, only EFFORTS membership.)

### D7 — Task B4 Step 1: `readWorkflow` used but not imported  (BLOCKING)
Line ~111 calls `workflowNodeDefaults(await readWorkflow(id))`, but the import list
omits it → `ReferenceError: readWorkflow is not defined`. Replace the import with:
```js
import {
  writeGraphWorkflow, readWorkflow, resolveGraph, workspaceVariants, workflowNodeDefaults,
  setWorkflowNodeDefaults,
} from '../src/core/workflows.mjs';
```

### D8a — Task B5 Step 1: the boot-preamble PLACEHOLDER, resolved  (BLOCKING)
The plan leaves a comment where the harness must go, and the file then dies with
`ReferenceError: base is not defined` in all five tests. Replace the head of
`test/api-workflows-graph.test.mjs` (everything from the first `import` through the
`// Boot preamble: COPY the before/after block …` comment) with this — lifted verbatim
from `test/api-workflows.test.mjs:1-36`, only the mkdtemp prefix changed:
```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, prepare } from '../src/core/db.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { registryPortsFn } from '../src/core/graph/registry-ports.mjs';
import { validateGraph } from '../src/shared/graph/validate.mjs';

// Outer isolation that outlives the per-suite before/after (see
// test/api-workflows.test.mjs — this preamble is lifted from it verbatim).
useTempHome(after);

let homeDir, srv, base, prevHome;

before(async () => {
  // Redirect the global ~/.worca-cc (workflow store) into a sandbox.
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wfgraphapi-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1'; // keep /api/run offline
  const { app } = await import('../ui/server.mjs'); // imported => no port bind
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  await rm(homeDir, { recursive: true, force: true });
});
```
(the plan's own `const api = …` helper follows unchanged.)

### D8b — Task B7 Step 1: the same placeholder, plus a missing `api()` helper  (BLOCKING)
`test/run-workflow-gate.test.mjs` says only
`// Boot preamble: copy test/api-workflows.test.mjs's before/after (WORCA_MOCK=1).`
and then uses BOTH `api(...)` and `homeDir`. Replace its head with the D8a block
(mkdtemp prefix `'worca-cc-rungate-'`, drop the three graph-only imports, keep
`getDb, prepare` and `writeGraphWorkflow`) AND append the helper the file needs:
```js
const api = async (method, path, body) => {
  const res = await fetch(`${base}${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};
```

### D9 — Task B5 Step 1: the 422 fixture trips V6 before V7  (BLOCKING)
The `bad` fixture appends a wire with the SAME endpoints as `w1`
(`n_task.task -> n_plan.task`, only the id differs), so it is a duplicate PAIR: V6
("duplicate wire …") fires and, rules running in numeric order, lands at
`errors[0]`. `errors[0].code` is `'V6'`, not `'V7'`. Note the test's real headline —
the byte-for-byte `deepEqual` of the server's issues against the shared validator's —
PASSES; only the order-dependent pin is wrong. Replace:
```js
  assert.equal(r.body.errors[0].code, 'V7');
```
with an order-independent pin that still names the rule under test:
```js
  assert.ok(r.body.errors.some((e) => e.code === 'V7'), 'the single-wire rule fired');
```

### D10 — Task B7 Step 2: the proposal change bypasses the deps injection seam  (BLOCKING)
`createProposalValidator({ readWorkflow })` (`src/core/ask/proposal.mjs:54-61`) is an
injection seam, and `test/ask-proposal.test.mjs:27` injects a fake `readWorkflow`
returning `wf_review`. The plan's snippet calls the module-level
`assertRunnableWorkflow` DIRECTLY, so the fake is bypassed and the real (empty) DB
answers — `happy workspace card …` fails with
`{"ok":false,"errors":["unknown workflowId \"wf_review\""]}`.
Route the gate through the INJECTED reader instead (and do NOT import
`assertRunnableWorkflow` here). Replace the plan's `src/core/ask/proposal.mjs` block with:
```js
    const workflowId = str(inp.workflowId) || 'wf_default';
    // The runnable gate, routed through the INJECTED readWorkflow so the deps
    // seam (createProposalValidator({ readWorkflow })) still works: a live row
    // passes, an archived row reads back only with includeArchived, and a v2
    // row is refused with assertRunnableWorkflow's own sentence.
    const wf = await readWorkflow(workflowId);
    if (!wf) {
      const archived = await readWorkflow(workflowId, { includeArchived: true });
      errors.push(archived
        ? `workflow "${workflowId}" was archived by the v2 upgrade (v1 template, not runnable) `
          + '— pick a v2 pipeline or rebuild it in the Composer'
        : PROPOSAL_ERRORS.unknownWorkflow(workflowId));
    }
    if (wf && wf.version === 2) errors.push('template is a graph — runs on the graph engine (not available yet)');
```
(If the ONE-gate property matters more than the seam, the alternative is to add
`assertRunnableWorkflow = realAssertRunnableWorkflow` to `createProposalValidator`'s
destructured deps AND update `test/ask-proposal.test.mjs` to inject it too — a bigger
change that this dry-run did not take.)

### D11 — Task B3 Step 2.4 breaks a shape pin the plan never lists  (BLOCKING, full-suite-only)
Adding `wires` to `resolveRunConfig`'s return breaks
`test/run-config.test.mjs:96`, which deep-equals the WHOLE object:
`assert.deepEqual(resolved, { nodes: {}, feedbacks: {} })`.
**Task B3's Step 2 Expected line names only `config.test.mjs`, `config-db.test.mjs`,
`config-api.test.mjs`, `config-questions.test.mjs`** — `run-config.test.mjs` is not
among them, so a per-file executor passes B3 and the break only surfaces in Task B10's
full suite (`pass 3938 / fail 1`), eight tasks later. Add to Task B3 Step 2 a fifth
numbered edit:

> 5. `test/run-config.test.mjs:96` deep-equals the WHOLE `resolveRunConfig` return, so
>    the new key must be added there too — replace
>    `assert.deepEqual(resolved, { nodes: {}, feedbacks: {} });` with
>    `assert.deepEqual(resolved, { nodes: {}, wires: {}, feedbacks: {} });`

and extend the Step 2 Expected line's suite list to
`node --test test/config.test.mjs test/config-db.test.mjs test/config-api.test.mjs test/config-questions.test.mjs test/run-config.test.mjs`.

---

## §3 — Mutation audit

Every mutation was applied ALONE and reverted with `git checkout -- <file>` before the
next. `RED` = the named test file(s) failed (the rule is pinned). `GREEN` = **SURVIVOR**.
Coverage: at least one mutation per NEW test file, and one per V-rule.

### 3a — the V1–V21 rule table (`test/graph-validate.test.mjs`)
Method: insert `return;` as the first statement of each rule's `check` body.

| # | mutation | result |
|---|---|---|
| V1 … V21 | neutralize each rule's `check` body, one at a time | **all 21 RED** (fail 1, except V7 and V12 → fail 2) |

No rule survived deletion. Additional per-rule mutations:

| mutation | result | note |
|---|---|---|
| V15 level `W`→`E` | RED (fail 2) | |
| V16 level `W`→`E` | RED (fail 2) | |
| V17 level `W`→`E` | RED (fail 2) | |
| V18 level `W`→`E` | RED (fail 2) | |
| V19 level `W`→`E` | RED (fail 2) | |
| V1 message reworded (`add('REWORDED V1 MESSAGE')`) | RED (fail 3) | messages are pinned |
| **V18 exemption (a)** — drop `if (nodeById.get(w.from.node)?.kind === 'task') continue;` | **GREEN — SURVIVOR** | |
| V18 exemption (b) — drop `if (inp.type === 'void') continue;` | RED (fail 2) | |
| **V18 exemption (c)** — drop `if (inp.id === AWAIT_PORT_ID \|\| inp.synthetic) continue;` | **GREEN — SURVIVOR** | |
| **V18 exemption (d)** — drop `if (inp.loop \|\| isLoopInput(...)) continue;` | **GREEN — SURVIVOR** | |
| V19 exemption — drop `isLoopInput` | RED (fail 2) | |
| V19 exemption — drop the and/or `inK` carve-out | RED (fail 1) | |
| **V19 exemption** — drop `target.kind === 'end' && w.to.port === 'result'` | **GREEN — SURVIVOR** | |
| **V19 exemption** — drop `target.kind === 'agent' && w.to.port === AWAIT_PORT_ID` | **GREEN — SURVIVOR** | |

### 3b — the pure shared core

| # | test file | mutation | result |
|---|---|---|---|
| M1 | graph-ports | `portsOf` no longer appends `AWAIT_PORT` to agent inputs | RED (2) |
| M2 | graph-ports, graph-validate | `resolveOrOutType` returns `null` always (OR resolution broken) | RED (1) |
| M3 | graph-loops, graph-seed-templates | `classifyLoops` ignores `when:'blocking'` (every SCC wire is a loop wire) | RED (4) |
| M4 | graph-geometry/layout/thumbnail | `NODE_W` 220 → 221 (off-by-one) | RED (5) |
| M5 | graph-geometry/layout/thumbnail | `ROW_H` 24 → 25 (off-by-one) | RED (6) |
| M6 | graph-geometry | `SNAP` 11 → 12 (off-by-one) | RED (2) |
| M7 | graph-template | `canWire` always returns `{ ok: true }` | RED (3) |
| M8 | graph-layout, ask-catalog-graph | `rankNodes` collapses to one flat rank | RED (6) |
| M9 | graph-thumbnail | `thumbnailSvg` returns `'<svg></svg>'` | RED (2) |
| M10 | graph-agent-meta, agent-registry-schema-v2 | drop the `metaVersion: 2` stamp from the normalized meta | RED (1) |
| M11 | graph-agent-meta | accept a sidecar whose `metaVersion !== 2` | RED (1) |
| M12 | graph-manifest | agent `uiPhase` falls back to `node.kind` (UI_PHASE map ignored) | RED (1) |
| M19 | shared-graph-single-source | `model.mjs` re-exports a WRAPPER of `classifyLoops` (identity broken) | RED (1) |

### 3c — sidecars, registry, seeds

| # | test file | mutation | result |
|---|---|---|---|
| M13 | mock-writer-roles, agent-registry-schema-v2 | remove `'agent-gen'` from `MOCK_WRITER_ROLES` | RED (2) |
| M14 | agent-registry-schema-v2, graph-registry-ports, graph-seed-templates | `normalizeMeta` skips the meta v2 merge entirely | RED (5) |
| M15 | agent-registry-schema-v2 | an INVALID v2 sidecar is loaded instead of skipped (`return null` removed) | RED (1) |
| M16 | graph-seed-templates, agent-registry-schema-v2 | drop `reviewer`'s `pass` (clean) output port (renamed) | RED (1) |
| M17 | agent-registry-schema-v2, graph-seed-templates | rename `implementer`'s first input so `fix` is no longer first (A3 order) | RED (3) |
| M18 | agent-registry-schema-v2, workflows-resolve-graph | `workspaceReviewer` loses `workspaceVariantOf` | RED (2) |
| M20 | graph-seed-templates | remove `wf_full` w5's `config.maxCycles` (budget off a loop wire) | RED (2) |
| M21 | graph-seed-templates | wire `wf_full` w2 into a port no sidecar declares | RED (1) |
| M46 | graph-registry-ports, graph-seed-templates | `registryPortsFn` ignores the registry (`() => undefined`) | RED (2) |

### 3d — schema, store, API, Ask, consumers (P2b)

| # | test file | mutation | result |
|---|---|---|---|
| M22 | db-migrate-v23, db | drop `workflows.graph` from `INCREMENTAL_COLUMNS` | RED (1) |
| M23 | db-migrate-v23, db | drop `workflows.archived_at` from `INCREMENTAL_COLUMNS` | RED (3) |
| M24 | db-migrate-v23 | drop `pipeline_steps.exec_result` from `INCREMENTAL_COLUMNS` | RED (1) |
| M25 | db-migrate-v23, db | drop `config_workflow_wires` from `INCREMENTAL_TABLES` | RED (4) |
| M26 | workflows-graph-rows, api-workflows-graph, run-workflow-gate | `readWorkflow` returns ARCHIVED rows (drop the `archived_at` guard) | RED (4) |
| M27 | (same three) | change the ARCHIVED user-facing text (`was archived by the v2 upgrade` → `was retired`) | RED (3) |
| M28 | workflows-graph-rows, api-workflows-graph | `listWorkflows` stops hiding archived rows | RED (2) |
| M29 | workflows-graph-rows | `resolveWorkflow` no longer refuses a v2 row | RED (1) |
| M30 | api-workflows-graph | **skip the 422 branch** (an invalid graph saves) | RED (1) |
| M31 | api-workflows-graph | `?archived=1` stops filtering to archived rows | RED (1) |
| M32 | run-workflow-gate | `POST /api/run` drops the v2 409 refusal | RED (1) |
| M33 | api-workflows-graph | `PATCH /api/config` ignores the `wires` key | RED (2) |
| M34 | config-wire-cycles | `setWireCycles` stops clamping to `>= 1` | RED (2) |
| M35 | config-wire-cycles | `resetWorkflowConfig` no longer clears `config_workflow_wires` | RED (1) |
| M36 | ask-catalog-graph, ask-catalog | `shapeWorkflow` drops its v2 arm | RED (2) |
| **M37** | ask-proposal, run-workflow-gate | **Ask proposal drops the v2 graph refusal** | **GREEN — SURVIVOR** |
| **M38** | run-workflow-gate | **the CLI `--workflow` runnable gate is removed entirely** | **GREEN — SURVIVOR** |
| M39 | graph-row-consumers, agent-store | `agent-store` stops walking v2 `graph.nodes` | RED (1) |
| **M40** | graph-row-consumers, agent-store | **`agent-store` drops `{ includeArchived: true }` from the ref scan** | **GREEN — SURVIVOR** |
| **M41** | graph-row-consumers, plugin-workflows | **`plugin-workflows` stops walking `graph.nodes`** | **GREEN — SURVIVOR** |
| M45 | run-config, config-wire-cycles, workflows-resolve-graph | `resolveRunConfig` drops the `wires` map | RED (9) |

### 3e — guard-test vacuity probes

The brief asks specifically about guards that pass for the wrong reason.

| # | probe | result |
|---|---|---|
| — | `test/shared-graph-purity.test.mjs` (P1): inject `src/shared/graph/mutant.mjs` importing `node:path` | RED — the guard bites, and its test 1 ("the shared core is not empty") makes an empty walk impossible |
| — | `test/api-shared-static.test.mjs` (P1): delete the `/src/shared` 404 tail | RED — 404 test fails with `text/html` |
| — | `test/graph-row-consumers.test.mjs` "…guard against v2 rows": `fn(name)` = `src.slice(indexOf, indexOf+900)`; a MISSING function yields `''` and `assert.match('', …)` fails, so it is NOT vacuous at lookup | OK |
| **M43** | **but** neuter the guard's condition while keeping the text: `if (false && workflow.version === 2) return [];` | **GREEN — SURVIVOR (vacuous)** |
| **M44** | same for the composer: `filter((w) => w \|\| w.version !== 2)` | **GREEN — SURVIVOR (vacuous)** |

`assert.doesNotThrow`-around-jsdom-dispatch and helper-defaults-inject-the-claim were
looked for and NOT found in P2's new tests — no P2 test wraps a jsdom dispatch in
`doesNotThrow`, and `test/helpers/graph-ports.mjs` reads the REAL `agents/` directory
(`realAgentMetas()`/`realPortsFn()`), so it cannot inject the property under test
(proved by M16/M17/M21, which all bite through that helper).

### 3f — SURVIVORS, with the assertion each one needs

**S1 — V18 exemption (a): task-sourced inputs.** Removing
`if (nodeById.get(w.from.node)?.kind === 'task') continue;` changes nothing.
Add to the V18 test:
```js
// A task-sourced payload input is EXEMPT: the task card fires once, so it can
// never double-fire. Two always-sourced inputs, one of them from the task -> no warning.
const t = ok(); t.nodes.push(A('n_two', 'implementer'));
t.wires.push(W('wA', 'n_task', 'task', 'n_two', 'plan'), W('wB', 'n_plan', 'plan', 'n_two', 'task'));
assert.deepEqual(warningsOf(t).filter((w) => w.code === 'V18'), [], 'a task source is exempt (a)');
```

**S2 — V18 exemption (c): the synthesized await gate.** Removing the
`inp.id === AWAIT_PORT_ID || inp.synthetic` skip changes nothing, because no fixture
wires `await` alongside another always-sourced payload input. Add a case that wires ONE
payload input plus `await` and asserts NO V18 warning (with the exemption removed that
node would count 2 and warn).

**S3 — V18 exemption (d): loop inputs.** Same shape — add a node with one plain
always-sourced input plus a WIRED `loop: true` input and assert no V18.

**S4 — V19 exemption: `end.result`.** Removing
`if (target.kind === 'end' && w.to.port === 'result') continue;` changes nothing.
Add: wire a `when:'blocking'` output straight into `n_end.result` and assert
`warnings` carries no V19 (this is exactly what seed `w10` does, so it also guards the
seeds).

**S5 — V19 exemption: `agent.await`.** Add: wire a blocking output into an agent's
synthesized `await` port and assert no V19.

**S6 — Task B7: the Ask proposal's graph refusal is unpinned.** `test/run-workflow-gate.test.mjs`
covers only the SERVER arm. Add to it (or to `test/ask-proposal.test.mjs`):
```js
test('propose_run refuses a graph template', async () => {
  const validate = createProposalValidator({
    readWorkflow: async (id) => (id === 'wf_g' ? { id, name: 'G', version: 2, nodes: [], wires: [] } : null),
  });
  const r = await validate({ projectDir: repo, prompt: 'x', workflowId: 'wf_g' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('template is a graph — runs on the graph engine (not available yet)'));
});
```

**S7 — Task B7: the CLI `--workflow` gate is unpinned.** Deleting the whole
`if (flags.workflow) { … }` block leaves every suite green. Add a spawn-based case to
`test/run-workflow-gate.test.mjs` (the repo already spawns the CLI elsewhere):
run `node src/cli/worca-cc.mjs run --workflow wf_graph …` against a temp `WORCA_HOME`
holding a v2 row and assert exit code 2 and stderr matching
`/worca: template is a graph — runs on the graph engine \(not available yet\)/`.

**S8 — Task B9: `agent-store`'s `{ includeArchived: true }` is unpinned.** The B9 test
writes a LIVE graph row, so the option is never exercised. Extend it: archive the row
(`UPDATE workflows SET archived_at = ...`) and assert `deleteAgent` STILL rejects with
`REFERENCED` — that is the only thing the option buys.

**S9 — Task B9: `plugin-workflows`' graph walk is unpinned.** B9's test only covers
`agent-store`. Add a case that writes a v2 row referencing a plugin agent key and
asserts the conflict scan reports it:
```js
const rows = workflowsUsingKeys('demo', new Set(['docsy']));
assert.deepEqual(rows, [{ workflowId: 'wf_uses', name: 'Uses Docsy', keys: ['docsy'] }]);
```

**S10 / S11 — Task B9: the three `ui/public/app.js` guards are pinned by SOURCE REGEX
only, so they are vacuous.** `if (false && workflow.version === 2) return [];` and
`filter((w) => w || w.version !== 2)` both keep the suite green. Replace the regex test
with a behavioral one — `ui-composer.test.mjs` already boots jsdom and can call the
functions directly:
```js
assert.deepEqual(buildNodeConfigRows({ id: 'wf_g', version: 2, nodes: [], wires: [] }, {}, {}), []);
assert.deepEqual(buildFeedbackRows({ id: 'wf_g', version: 2, nodes: [], wires: [] }, {}, {}), []);
// and for the composer: seed composer.saved with a v2 row, call composerRenderList(),
// then assert the rendered list has no entry for it AND composer.saved dropped it.
```

---

## §4 — Counts

| point | tests | source |
|---|---|---|
| **BASELINE** (dev `e6968e15`) | **3760 / 3760, fail 0** | P1 Task 0 Step 5 — matches the plan's own reference measurement exactly |
| after **P1** (all 12 tasks) | **3805 / 3805, fail 0** | P1 Task 11 Step 1 — BASELINE + **45**, the predicted delta EXACTLY |
| **P2a total** (Tasks 0–14) | **3902 / 3902, fail 0** | P2 Task 14 — 3805 + **97**, the predicted delta EXACTLY |
| **P2b total** (Tasks B0–B10) | **3939 / 3939, fail 0** | P2 Task B10 — 3902 + **37**, the predicted delta EXACTLY |
| tests added by P2 (both halves) | **134** | 97 + 37; matches B10's "if you executed both halves in one run, the total is BASELINE + 134" |
| tests added by P1 + P2 vs dev | **179** | 3939 − 3760 |

Every delta the two plans predict was hit on the nose. Note the ONE caveat: the P2b
total is 3939 only AFTER deviation **D11** (`test/run-config.test.mjs`) is applied —
without it the run is `pass 3938 / fail 1`, and the test COUNT is still 3939.

Per-task counts observed (new tests only): graph-ports 8, graph-loops 7,
graph-validate 23, graph-template 10, graph-geometry 10, graph-layout 5,
graph-thumbnail 2, graph-agent-meta 11, mock-writer-roles 2,
agent-registry-schema-v2 +3, graph-registry-ports 2, graph-manifest 9,
shared-graph-single-source 2, graph-seed-templates +3 (= 97);
db-migrate-v23 4, workflows-graph-rows 6, config-wire-cycles 4,
workflows-resolve-graph 7, api-workflows-graph 5 + 3, run-workflow-gate 3,
ask-catalog-graph 3, graph-row-consumers 2 (= 37).

---

## §5 — Clone end state

```
$ git log --oneline
9c937e61 worca: Node-graph v2 P2 — P2b green (schema + store)
36d9737e worca: Node-graph v2 P2 — run-config shape pin gains the wires map
f405ca2e worca: Node-graph v2 P2 — v1 consumers tolerate graph rows
34b8e91a worca: Node-graph v2 P2 — Ask catalog understands graph templates
785143f2 worca: Node-graph v2 P2 — one runnable-workflow gate for every run path
441a08db worca: Node-graph v2 P2 — /api/config carries per-wire budgets
85ca89ed worca: Node-graph v2 P2 — /api/workflows accepts and validates v2 graphs
8aa4dbb0 worca: Node-graph v2 P2 — resolveGraph, workspace variants and v2 node defaults
f1fdc10c worca: Node-graph v2 P2 — per-wire cycle budgets
80d4f503 worca: Node-graph v2 P2 — v2 workflow rows, archiving and the runnable gate
718b0b5d worca: Node-graph v2 P2 — DB v23 additive schema
5a30a653 worca: Node-graph v2 P2 — P2a green (shared core + sidecars)
5b293a35 worca: Node-graph v2 P2 — seed drift guard against the real sidecars
bceb9f8f worca: Node-graph v2 P2 — browser re-export door and the single-source guard
f226423e worca: Node-graph v2 P2 — graph manifest v2 with the v1 shim cells
b632e30e worca: Node-graph v2 P2 — registry merges meta v2 and exposes registryPortsFn
70744ecb worca: Node-graph v2 P2 — dual-shape meta v2 sidecars for the 11 builtins
8f28a8f8 worca: Node-graph v2 P2 — export the mock writer role vocabulary
6deb4507 worca: Node-graph v2 P2 — shared agent meta v2 normalizer
3b78bd4f worca: Node-graph v2 P2 — auto-layout and thumbnails
2331a8e3 worca: Node-graph v2 P2 — shared geometry
f5a0257b worca: Node-graph v2 P2 — template model and drop legality
62be2eb5 worca: Node-graph v2 P2 — shared graph validator (V1-V21)
da6cf22b worca: Node-graph v2 P2 — loop classification and launch order
109fb26a worca: Node-graph v2 P2 — shared ports layer
7236abce worca: Node-graph v2 P1 — seed template structural invariants
bb2f901c worca: Node-graph v2 P1 — the 8 shipping graphs as frozen constants
9c3077e3 worca: Node-graph v2 P1 — serve the shared graph core at /src/shared
334741b2 worca: Node-graph v2 P1 — shared-core purity guard
44dd6d35 worca: Node-graph v2 P1 — move the verdict helpers into the shared core
bf6bd1fc worca: Node-graph v2 P1 — shared graph constants
259424dd worca: Node-graph v2 P1 — engine-select module
d5842999 worca: Node-graph v2 P1 — run-harness hook contract test
492b8b35 worca: Node-graph v2 P1 — split the run harness out of the orchestrator
bfffa31f worca: Node-graph v2 P1 — collectRequiredSkills accepts a key set
e6968e15 Collapse Ring Amount to Whole Thousands (#391)
fba3bc6f Worca cc/ask chat offer full models menu 82bc868b (#390)
343a258b Visual refinment
fda9b1ff worca: Include Plugin Models In Ask Chat Picker
def81e28 fix: remove plugin symlinks with unlink, not rmSync (#388)

$ git status --short
(clean)
```
