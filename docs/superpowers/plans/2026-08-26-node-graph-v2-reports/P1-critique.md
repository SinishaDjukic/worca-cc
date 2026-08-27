# P1 critique — adversarial + spec-conformance (Fable 5, max effort, 2026-08-27)

Plan reviewed: the frozen snapshot `scratchpad/v1-snapshots/2026-08-26-node-graph-v2-P1-harness-split-foundations.md` (byte-identical to the live plan at review time; the cross-plan pass's P1-E1..E8 were NOT yet applied — where a finding interacts with them it says so). Spec: `docs/superpowers/specs/2026-08-26-node-graph-v2-rebuild-design.md` §2/§3/§5.1/§5.2/§5.6/§5.7/§10.2/§12/§13/§16, adj-a §1, adj-b, adj-e §3. Prior reports (P1-anchors, P1-dryrun) are NOT repeated; the cross-plan sheet `reports/xplan-manifest.md` §A was read and the seam list at the end is aligned to it (A17/A18/A27/A28/A30 named explicitly).

Method: read dev `src/core/orchestrator.mjs` @ e6968e15 (constructor, run(), resume(), the helper tail) and the P1 clone (`scratchpad/clones/p1` @ 97b0501b) side by side; wrote an xref script (`scratchpad/critique-p1-xref.mjs`) that maps every `this.<member>(` call and `this.<field>` read in both post-split files to its owner and to the constructor's field set; a second script (`critique-p1-p4calls.mjs`) does the same for every `this.*` in P4's code blocks against the P1 harness surface; two throwaway git worktrees off the clone (`scratchpad/critique-p1/wt`, `wt2`, node_modules linked, fresh WORCA_HOME) ran three mutations the dry-run did not: S7 (`_enginePrePausePoint()` -> null) over the FULL suite, S9 (`memberWorktrees` -> []) over the workspace suites, and the FB pairing swap under a new pin. Two probe test files (`scratchpad/critique-p1/run-harness-hooks-extra.test.mjs`, `graph-seed-templates-extra.test.mjs`) were run green on the clone and red under the mutants; their code is the fix text below. No repo file was touched; nothing committed; worktrees removed at the end.

## 0. Empirical results this critique adds

| probe | result |
|---|---|
| S7 mutant (`this.state.resumePoint = this._enginePrePausePoint();` -> `= null;`), FULL suite | **3805 / 3805 green — SURVIVOR** (`scratchpad/critique-p1/s7-full.log`); the plan's 7-test hooks file also stays 7/7 (it records `calls.prePause` but never asserts it) |
| S9 mutant (`for (const p of rehydrated.memberWorktrees)` -> `for (const p of [])`), workspace suites | RED x2 in `test/orchestrator-workspace.test.mjs` (the two detached pause->resume tests) — the workspace resume leg IS covered |
| harness xref: `this.<m>(` calls in `run-harness.mjs` not defined there | exactly the 6 hooks + `emit` — the base never calls a v1-only/SHARED member |
| harness xref: `this.<field>` reads not assigned in the base constructor | none (`registry`, `extrasFiles`, `stepModels`, `agentPrompts`, `_pauseGate`, `_resumeNodeSessions`, `_subAgentLabels`, `_subAgentFallbackSeq` are all base-constructor fields) |
| v1 vocabulary (`plan.`, `stepIndex`, `bus`, `uiPhase`, `stepCycle`, `_dispatch`, `feedbacks`, `channelDefs`, `_runners`, `FANOUT_ELIGIBLE`) in harness CODE lines | 4 hits, all inert: two constructor comments (`:339-340`), `_log`'s `attr.stepIndex` event field (`:2542`), an artifact-kind comment (`:2571`); 18 comment-only mentions |
| v1 residue (`orchestrator.mjs` after split): `this.<m>(` calls resolved by the base | 19 members, all present on `RunHarness` (`_reposCtx _workspaceChannel _collectExtras _checkAbort _checkPause _checkCostLimits _persist _stageWorkingTree _emit getState _log pause _recover _artifact _enqueueAsk _ask _writeClarifyAnswers _clockResume _clockPause`) + `_preflightAgentKeys` from v1 `_engineRun` |
| P4 plan `this.*` calls vs the P1 harness | 19 resolve on the harness, 28 are P4's own; 3 resolve NOWHERE until P4 Task 1 hoists them (`_onAgentEvent _subAgentTransition _upsertSubAgent`) — see F6 |
| `channelDefs` readers on dev | `run`, `resume`, `_bindNodeIo` only — the resume-side relocation into v1 `_engineRun` is safe (nothing between `:945` and `_dispatch` reads it) |
| `buildStepperManifest` tolerance | `workflows.mjs:476 const meta = reg[node.key] || {}` — running it BEFORE the §9.4 gate (the S1 reorder) cannot throw or differ |
| `appendAudit(dir, undefined)` | `artifacts.mjs:930 String(markdownLine ?? '').trim()` -> inserts an EMPTY `pipeline_events` row (no throw) — see F1 |
| tests pinning the audit lines | `grep -rn "Workflow: \*\*" test/` -> 0; `grep -rn "resumed\*\*" test/` -> 0 (S5 AND S10 are both unpinned; the dry-run found only S5/M40) |
| P4 Task 1 hoist vs `_testing` | `orchestrator.mjs:4369 export const _testing = { SKILLS_MAX, skillLabel, mergeSkills }` (imported by `test/skill-capture.test.mjs`); P4 Task 1 Step 4/5 moves+deletes those three helpers and never mentions `_testing` — see F6 |

## 1. Spec conformance, section by section (requirement -> task / GAP; deviations with verdict)

| spec requirement | plan | verdict |
|---|---|---|
| §2 P1 row: harness + 6 hooks, `Orchestrator extends RunHarness` byte-identical | Task 2 (script), Task 3 (contract test) | met (oracle 3760->3762 green) |
| §2: `engine-select.mjs` returns v1 for everything; no call-site change | Task 4 | met |
| §2: `skills.mjs:113` accepts a key set | Task 1 | met (+ M36 survivor fix from the dry-run still pending) |
| §2/§3: `/src/shared` mount + 404 tail + `api-shared-static` test | Task 8 | met; mount text byte-equal to spec §3 / adj-b; test adds traversal + SPA cases (good) |
| §3: `constants.mjs` export list | Task 5 | met; `LIMITS` keys / `gatePorts.required` / id regexes are planner defaults — accepted by xplan A30/C141/C142/C144; A27 adds `BOOKEND_EXECUTION_IDS` (P1-E1..E5) |
| §3: `verdict.mjs` = five names MOVED from `protocol.mjs:244-259`, re-exported | Task 6 | met; spec's line range names only two functions but its export list names all five — moving `SEVERITIES/BLOCKING/normalizeSeverity` (`:15-24`) is required for the two movers to be pure. justified |
| §3 purity rules + adj-b §5 guard | Task 7 | met; test 1 (anti-vacuity) is an improvement over adj-b's code |
| §3 import convention (relative only; depth = `..` count) | Global Constraints | met (nothing in `ui/public` imports shared yet — P5) |
| §5.1 HARNESS/V1-ONLY/SHARED sets | Task 2 lists | met with two documented deviations: `_phase` -> harness (Q&A P1-b; forced: all 4 call sites are bookends, `cost-tracking`/`duration-tracking` call it directly) — **justified**; `_preflightAgentKeys` -> harness with an iterable (P1-f; spec §5.1 hook 1 itself says the base calls it) — **justified**, resolves the spec's own contradiction |
| §5.1 hook 1 `{manifest, agentKeys}` | + `workflow:{id,name}` (P1-c) | **justified** (audit line needs it) — but see F1: the base does not validate it and P4 as written omits it (xplan A17 now binds P4) |
| §5.1 hook 2 `_engineRun({resume})` | + `rehydrated` (P1-e) | justified (v1 needs the frozen plan); A17 accepted |
| §5.1 hook 4 `{checkpointRef, memberWorktrees, plan?}` | + `audit?` (P1-d) | **contract as written is wrong**: JSDoc says optional, base consumes unconditionally -> empty audit row when absent — F1 |
| §5.1 hook 5 `_bookend` emits phase + `_recordStep` for both engines | base `_bookend -> _phase` | met |
| §5.1 hook 6 runner ctor hook | `_initRunners(opts)` at the `:306` position | met |
| §5.1 "module-level helpers `:3980`..EOF move with their callers" | 16 move (9 exported), 20 stay | justified (a helper moves iff a harness member uses it; verified by the xref: 0 dangling on either side) |
| §5.1 oracle: 16 `orchestrator-*` + pause-resume-e2e + server-pause-resume + dispatcher + orchestrator-questions UNCHANGED | Task 2 Step 6/7 | met |
| §5.1 new `run-harness-hooks.test.mjs`: "pre-pause point, rehydrate contract, bookends" | Task 3: rehydrate + bookends covered; **pre-pause point NOT covered** | **GAP** — F2 (mutation survives the full suite) |
| §5.2 selector/factory semantics; resume point wins; async; `Orchestrator.resume` keeps `!== 1` | Task 4 + v1 `_engineRehydrate` | met (`!== 1` lives in the v1 hook — same position `:820`, still outside the try) |
| §5.2 `'wf_default'` ctor default untouched | Task 2 (P1-h) | met |
| §5.6/§5.4 what `GraphOrchestrator` needs from the base | see §0 table | met except the 3 telemetry members P4 hoists itself (A18) |
| §10.2 seeds VERBATIM + structural pins (counts, one Task/End, OR valve x3, `reviewer.pass -> checklist.await`, no `start`) | Task 9/10 | met, byte-identical to the old branch |
| §10.2 "`FB_WIRE_MAP` … asserted equal to the dynamic (from,to) resolver" | Task 10: set-equality + self-resolution only | **partial**: the fb_N pairing is not asserted (dry-run survivor (c)); P1-E6 pins `wf_clarify-implement` by convention (A28) — F8 adds the pin the data actually supports (wf_default vs the REAL v1 `DEFAULT_WORKFLOW`) |
| §10.2 "migration uses the static maps only" vs snapshot Q&A P1-q "V24 resolves dynamically … static map only as a fallback" | contradicted the spec | fixed by P1-E7/E8 (A28); no further action |
| §12 test-file names (`graph-<module>`, `run-harness-hooks`, `engine-select`, `graph-seed-templates`, `shared-graph-purity`, `api-shared-static`) | all match | met |
| §13 risk 1 "land it alone" | Task 2 lands alone, ends green | met for P1; **A18 makes P4 re-cut live v1 code** (see seam S2) |
| §16 Task 0 conventions (no branch creation in a pipeline; `npm ci`; old-branch fetch; baseline; sentinel) | Task 0 | met (`git merge-base --is-ancestor e6968e15 HEAD` as the P1 sentinel is the right substitute); branch name `worca-cc/node-graph-v2-p1` vs §16 `P<n>` — cosmetic |
| §16 self-contained plan (no `docs/superpowers` at execution) | seeds + script embedded in full | met (embedded seeds diffed byte-identical by the anchor check) |
| §16 Q&A "never invented answers" | P1-c..P1-n are labelled "planner default" | acceptable — they are now adjudicated (xplan C133-C149) |

## 2. The harness split itself

**Partition.** Correct. Every HARNESS member's outbound calls resolve inside the harness or to the six hooks; every field it touches is initialised by the base constructor (xref, §0). The one member whose NAME suggests v1 (`_workspaceChannel :2752`) is a pure roster projection of `members/workDirs/checkpointRefs/toolInstructions` — no `channels.mjs` import, correctly harness. `_checkCostLimits` (harness) is called only by v1 `_dispatch` today and by P4's `_execute` tomorrow — right side. `_recordStep`/`_phase`/clocks on the base with `key = cycle ? phase#cycle : phase` is what P8's `_recordStep(executionId, 0, …)` bookend rewrite relies on (A27) — consistent.

**Shells.** `run()`/`resume()` do what dev does for v1 in the same order, with exactly two reorderings, both safe but only one disclosed: (1) `collectChannelDefs` on resume now runs inside v1 `_engineRun`, i.e. AFTER `_assembleContext`/`_recordRunWarning` — disclosed; safe (readers = `run`, `resume`, `_bindNodeIo`); (2) `buildStepperManifest(plan, registry)` now runs INSIDE `_resolveTopology`, i.e. BEFORE the §9.4 gate instead of after — undisclosed; safe because `workflows.mjs:476` tolerates unknown keys, but the S1 comment "hard-fail BEFORE the stepper snapshot" is now false (F7). The `_bookend` sites, `_persist`/`state` emits, audit lines and the error/pause/stop branches are untouched (dry-run's multiset diff + my read of `:474-1076` agree). One semantic nit: the `rp.bus?.workspace?.projects` read moved from inside the try to the `:820` position — corrupt-point-only (F11).

**Seam completeness.** Twelve seams (S1-S12), all text-keyed and asserted; no v1 vocabulary survives in harness code (§0). The remaining v1 traces are comments — worth a sweep when P8 deletes `_phase`, not now.

**What P4 needs from the base.** Everything P4's code blocks call resolves on the harness (19 members) except the telemetry trio P4 hoists in its own Task 1 (A18). P4's hook implementations, however, do NOT satisfy P1's extended contract as written (`_resolveTopology` returns `{manifest, agentKeys}` — P4 plan `:541`; `_engineRehydrate` returns no `audit` — `:1792-1820`); xplan A17/A37 direct P4 to comply (P4-E5/E18). P1's job is to make the base fail LOUDLY and pin the lines (F1).

**Should the telemetry block / `_recordCost` / `_artifact(kind,path,attr)` / `_log` executionId move in P1?** My analysis says the MOVE (not the signature edits) belongs in P1, and xplan A18 decided otherwise. Evidence for the P1 side, stated once (seam S2), not re-decided: (a) the block is harness-pure — its `this.*` set is `state, _log, _upsertSubAgent, _subAgentTransition, _persist, pipeline, _subAgentLabels, _emit, claude, _costUnreliableWarned, projectDir, getState, _subAgentFallbackSeq` + the reducers themselves; (b) P1's script already encodes the rule that makes such a move safe ("a helper moves iff a harness member uses it; helpers used by both sides are exported"), and P4 Task 1 lacks that rule: it moves `SKILLS_MAX/skillLabel/mergeSkills` and deletes them from `orchestrator.mjs` while `export const _testing = { SKILLS_MAX, skillLabel, mergeSkills }` (`:4369`, imported by `test/skill-capture.test.mjs`) stays there -> ReferenceError at module load -> `orchestrator.mjs` unloadable (F6); (c) spec §13 risk 1 says land the cut alone — A18 schedules a second cut of the live engine in P4. The `_log`/`_artifact` signature extensions are NOT moves and belong in P4 either way (they carry P4's tests). If A18 stands, P4 Task 1 needs the `_testing` fix and P1-E8's P1-r line should name it.

## 3. Findings

### F1 — CRITICAL — the hook contract is wrong as written: `audit?` optional but consumed unconditionally; `workflow` required but never validated; neither audit line is pinned
**Location:** Task 2 `BASE_HOOKS` (script copy, the one that lands) JSDoc of `_engineRehydrate`/`_resolveTopology`; seams S5 and S10; Task 3 tests 4 and 6.
**Problem:** `_engineRehydrate`'s JSDoc says `audit?:string` while the S10 replacement is `await appendAudit(this.pipeline.dir, rehydrated.audit);` — with the field absent, `artifacts.mjs:930` turns `undefined` into `''` and INSERTS AN EMPTY `pipeline_events` ROW. `_resolveTopology`'s JSDoc requires `workflow:{id,name}` but the S5 replacement dereferences `topology.workflow.name` with no check — an engine that omits it dies with `TypeError: Cannot read properties of undefined (reading 'name')` AFTER createPipeline/worktree/graphify, inside the try, as status `error`. Both are exactly what P4 does today (`_resolveTopology` returns `{ manifest, agentKeys }`, `_engineRehydrate` returns `{checkpointRef, memberWorktrees, plan:null}`); xplan A17/A37 now bind P4, but the base must not depend on a neighbour reading a JSDoc correctly. Neither audit line is pinned by any test (`grep` in §0) — the dry-run's M40 covers S5 only; S10 is equally unpinned.
**Fix (plan-ready):**
1. In the script's `BASE_HOOKS`, replace the two `@returns` lines:
   `@returns {Promise<{manifest:object, agentKeys:Set<string>, workflow:{id:string,name:string}}>}` -> add the sentence `All three fields are REQUIRED; the shell throws a named error when one is missing.`
   `plan?:object|null, audit?:string}}` -> `plan?:object|null, audit:string}} — audit is REQUIRED (the shell writes it verbatim as the resume audit line).`
2. S1 replacement gains one line after `const topology = await this._resolveTopology(registry);`:
   `if (!topology?.manifest || !topology.agentKeys || !topology.workflow?.id) throw new Error('engine hook contract: _resolveTopology must return { manifest, agentKeys, workflow:{id,name} }');`
   and S8 gains, after `const rehydrated = this._engineRehydrate(rp);`:
   `if (!rehydrated || typeof rehydrated.audit !== 'string' || !Array.isArray(rehydrated.memberWorktrees)) throw new Error('engine hook contract: _engineRehydrate must return { checkpointRef, memberWorktrees:[], audit }');`
   (v1 always satisfies both; the added lines are non-moved seam text and belong in Step 5's allowed list.)
3. Task 3: import `getDb` alongside `_resetForTests`, add the helper
   `const auditOf = (id) => getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ? ORDER BY id').all(id).map((r) => r.text).join('\n');`
   and append to test 4: `assert.match(auditOf(orch.pipeline.id), /Workflow: \*\*Stub\*\* \(wf_stub\)\./, 'the audit line comes from topology.workflow');`
   and to test 6: `assert.match(auditOf(p.id), /Pipeline \*\*resumed\*\* \(stub\)\./, 'the resume audit line is the rehydrate bag\'s');`
   Add one contract test: a stub whose `_resolveTopology` returns `{ manifest, agentKeys }` -> `run()` resolves `{status:'error', error:/engine hook contract: _resolveTopology/}` and `calls.engineRun.length === 0`.
   Mutations to add to Step 3: (e) S5 prints `topology.workflow.id` where the name goes -> test 4 red; (f) S10 writes a literal instead of `rehydrated.audit` -> test 6 red. (Both assertions verified green on the clone: `scratchpad/critique-p1/run-harness-hooks-extra.test.mjs` tests 2-3.)
4. Task 3 test count 7 -> 8 (+1 contract test); propagate to Task 6 Step 5 / Task 11.

### F2 — MAJOR — seam S7 (`_enginePrePausePoint`) has zero coverage: the mutation survives the FULL suite
**Location:** Task 2 seam S7; Task 3 (`calls.prePause` is counted but never asserted); spec §5.1 names "pre-pause point" as a hooks-test item.
**Evidence:** `this.state.resumePoint = this._enginePrePausePoint();` -> `= null;` : 3805/3805 green (`scratchpad/critique-p1/s7-full.log`), 7/7 in the hooks file. Every existing pause test pauses INSIDE a node (`orchestrator-pause.test.mjs:28`, `orchestrator-workspace.test.mjs:598/:735`, `pause-resume-e2e`), so v1's own pre-dispatch boundary branch (`:727-736` on dev) was never covered either — the split inherits a blind spot on the one seam whose whole job is "what does a resume point look like before the engine ran".
**Fix (plan-ready)** — add to `test/run-harness-hooks.test.mjs` (verified: RED under the mutant with `actual: 0, expected: 1`; GREEN on the clone). The stub's `_engineRun` gains `this._checkPause();` as its first line ("exactly what v1's dispatcher does on entry: honour a pause requested during preflight"), then:
```js
test('run(): a pause requested during preflight lands on _enginePrePausePoint and is what resume() will read back', async () => {
  const dir = await makeRepo();
  const orch = new StubEngine({ projectDir: dir, prompt: 'demo', claude: { mock: true }, auto: true });
  orch.on('phase', (p) => { if (p.phase === 'preflight' && p.status === 'done') assert.equal(orch.pause(), true); });
  const res = await orch.run();
  assert.equal(res.status, 'paused');
  assert.equal(orch.calls.prePause, 1, 'the engine decided the pre-engine resume point');
  assert.deepEqual(orch.state.resumePoint, { version: 99, kind: 'stub-boundary' });
  const row = getDb().prepare('SELECT status, resume_point FROM pipelines WHERE id = ?').get(orch.state.id);
  assert.equal(row.status, 'paused');
  assert.equal(JSON.parse(row.resume_point).kind, 'stub-boundary', 'persisted through _completePaused');
});
```
Add mutation (g) to Step 3: S7 -> `= null` must turn this test red. Hooks file count +1 (8 -> 9 with F1). Optional but recommended for v1 itself: the same scenario on `createOrchestrator` (pause from the `preflight:done` phase event, expect `rp.kind === 'boundary'`, `rp.stepIndex === 0`, `rp.plan === null`, then `resume()` -> done) in `test/orchestrator-pause.test.mjs` — it pins the v1 hook body, which P8 deletes with the engine.

### F3 — MAJOR — the extraction script's DOCUMENT order is not its execution order; assembling in document order silently drops S12
**Location:** Task 2 Step 1: the S12 block (`S12_FROM/S12_TO` + `body = once(body, S12_FROM, S12_TO)`) is printed AFTER the block that ends with the two `writeFileSync` calls; only a prose note ("Order inside the script: … then S12, then the EXPORTED/assembly block last") says otherwise.
**Problem:** a zero-context implementer who concatenates the five fenced blocks as printed gets a script that writes both files and THEN edits `body`. No `die` fires (the S12 anchor matches the still-unwritten body), Step 2 prints the expected line counts +0, Step 3 `node --check` passes, Step 4/5 look right; the first signal is Step 6 (`test/preflight-missing-agent.test.mjs` red, because `_preflightAgentKeys(plan)` iterating `plan?.steps` of a Set silently gates nothing) — one full re-derive cycle lost, and a reviewer skimming Step 5's zebra diff would not notice a missing 17-line seam.
**Fix:** move the S12 block physically before the `// The helpers v1 still needs become named exports` block (so document order == execution order), keep the note, and add a post-condition guard immediately before the two writes:
```js
harness.includes('  _preflightAgentKeys(agentKeys) {') || die('S12 not applied — script blocks out of order');
harness.includes('this._preflightAgentKeys(topology.agentKeys);') || die('S1 not applied');
```
(Both strings exist only when the seams landed; the check costs nothing and turns a silent miss into a `split:` abort, which the plan already tells the implementer never to loosen.)

### F4 — MAJOR — `_engineRehydrate` runs BEFORE any state is rehydrated and OUTSIDE the shell's try, and the contract does not say so; P4 built on the opposite assumption
**Location:** seam S8 (the `:820` position: before `try {`, before `this.state.*`/`this.pipeline`/`logWriter.bind`/`stepModels`/`workflowId`/guardrails are restored); `BASE_HOOKS` JSDoc of `_engineRehydrate`.
**Problem:** the position is RIGHT for v1 (a foreign version must reject `resume()` without touching the row — dev semantics at `:820`), but it is an invisible constraint: P4's `_engineRehydrate` (P4 plan `:1792-1820`) reads `this.state.stepper` (still `null` there), stamps `this.state.stepper = manifest` (overwritten two lines later by the shell's `this.state.stepper = safeParse(row.stepper)`), and runs the §9.4 preflight there — so a plugin disabled while a v2 run sat paused makes `resume()` REJECT (server `ui/server.mjs:1618` marks the entry `error`, the row stays `paused`, no audit, no `done` event), whereas v1 runs the same gate inside `_engineRun` (S10 position) and lands as status `error` with audit + `done`. Also the hook is called synchronously (`const rehydrated = this._engineRehydrate(rp);`), so P4 had to invent a deferred `this._hydratePrompts` promise awaited later.
**Fix (P1, doc + one token):** JSDoc for `_engineRehydrate` in the script's `BASE_HOOKS`: `Called at the position of dev's version gate: BEFORE the shell has rehydrated any state (state.*, pipeline, logWriter, stepModels, workflowId, guardrails are NOT restored yet) and OUTSIDE the shell's try — a throw here rejects resume() without touching the row. Keep it pure: read rp, decide whether the point is yours, return the bag. Engine restoration that needs state/registry/pipeline (manifest adoption, prompt hydration, the §9.4 re-preflight) belongs in _engineRun({resume, rehydrated}), which runs inside the try after everything is restored — exactly where v1 does its re-preflight.` And make the call `const rehydrated = await this._engineRehydrate(rp);` (a sync v1 return is awaited unchanged; `resume()` is already async; the Task 3 `assert.throws` on the base stays valid because the base throws synchronously) so engines may be async. Seam flag S3 for the adjudicator (P4 restructures Task 6 accordingly).

### F5 — MAJOR — after the cross-plan edits the plan's own count gates contradict each other
**Location:** P1-E4 sets Task 5 to `# pass 10`; Task 6 Step 5 still says `BASELINE + 28` "(… Task 5: 9 …)" and "the total must be BASELINE plus exactly those 28"; Task 11 Step 1 still says `BASELINE + 45` with "Task 5 → 9" and "3803/3803 … final 3805".
**Problem:** the plan tells the executor the delta "must be … exactly" — a zero-context implementer STOPs at Task 6 on +29 vs +28. (xplan §D7 defers this to the dry-run, but the numbers are gates in the text.)
**Fix:** Task 6 Step 5 -> `BASELINE + 29` (Task 5: 10); Task 11 Step 1 -> `BASELINE + 46` and "Task 5 → 10", reference "3806"; then add this critique's tests: Task 3 +2 (F1 contract test, F2 pre-pause test) and Task 10 +1 (F8) -> Task 6 Step 5 `+31`, Task 11 `+49` (final reference 3809 on a 3760 baseline). Re-measure in the v2 dry-run and write what it prints.

### F6 — MAJOR (cross-plan; P1 side is one Q&A sentence) — P4's telemetry hoist as written makes `orchestrator.mjs` fail to load
**Location:** xplan A18 / P1-E8 (`P1-r`) vs P4 Task 1 Steps 4-5.
**Evidence:** dev `orchestrator.mjs:4369 export const _testing = { SKILLS_MAX, skillLabel, mergeSkills };` (imported by `test/skill-capture.test.mjs`); P4 Task 1 Step 4 moves `SKILLS_MAX :4182`, `skillLabel :4206`, `mergeSkills :4285` to `run-harness.mjs` as "private to the block", Step 4b's export list does not include them, Step 5 deletes them from `orchestrator.mjs` — the surviving `_testing` line then references three unbound identifiers -> `ReferenceError` at module evaluation -> every importer of `orchestrator.mjs` (53 test files, the server, the CLI) breaks, not just skill-capture. P1's script avoids exactly this class of bug by rule ("used by both sides -> move + export") — which is the substance of my A18 dissent (seam S2).
**Fix (P1):** P1-E8's `P1-r` gains: `The move must treat SKILLS_MAX, skillLabel and mergeSkills as "used by both sides" (orchestrator.mjs:4369 _testing, imported by test/skill-capture.test.mjs): export them from run-harness.mjs and import them back, or move _testing with them.` **Fix (P4, for the adjudicator):** Task 1 Step 4b list += `SKILLS_MAX`, `skillLabel`, `mergeSkills`; Step 5 adds `import { SKILLS_MAX, skillLabel, mergeSkills } from './run-harness.mjs'` for `_testing`; Step 6's oracle adds `test/skill-capture.test.mjs`.

### F7 — MINOR — an undisclosed (harmless) reorder and a now-false comment at S1
`buildStepperManifest(plan, registry)` moved inside v1 `_resolveTopology`, so it now runs BEFORE `_preflightAgentKeys` instead of after. Harmless (`workflows.mjs:476 reg[node.key] || {}`), but the plan's byte-identical narrative should list it next to the `collectChannelDefs` relocation, and the S1 comment must change from `hard-fail BEFORE the stepper snapshot / createPipeline / worktree` to `hard-fail BEFORE the stepper is STAMPED / createPipeline / worktree (the manifest is built inside the hook, which tolerates unknown keys)`.

### F8 — MINOR — pin the fb pairing the data actually supports (beyond P1-E6)
P1-E6 pins `wf_clarify-implement` by convention. Two stronger pins cost 25 lines and were verified on the clone (`scratchpad/critique-p1/graph-seed-templates-extra.test.mjs`: green; RED under the survivor-(c) swap): (1) `wf_default`'s two maps derived from the REAL v1 `DEFAULT_WORKFLOW` (`workflows.mjs:91-108`: node ids `s_clarify/s0_0..s3_0`, feedbacks `fb_refine s1_0->s1_0`, `fb_review s3_0->s2_0`) — `NODE_ID_MAP.wf_default` keys == its node ids with matching agent keys, and each feedback resolves through `resolveWireId(v2, nodeMap[fb.from], nodeMap[fb.to])` to `FB_WIRE_MAP.wf_default[fb.id]`; (2) every other seed's `fb_N` pinned by LOOP ROLE (`refine` = refiner self-loop, `review` = reviewer->implementer, `webui` = webui->implementer) via an `EXPECTED_FB` table with `wf_clarify-implement: { fb_0: 'review', fb_1: 'refine' }` marked as the A28 convention. Add as Task 10 test 11 (`import { DEFAULT_WORKFLOW } from '../src/core/workflows.mjs'`).

### F9 — MINOR — `test/api-shared-static.test.mjs` walks EVERY file under `src/shared` (no extension filter)
A Finder `.DS_Store` (gitignored — `.gitignore:2` — hence invisible to CI but common on the user's macOS) is walked, `express.static` ignores dotfiles by default, the tail answers 404 and test 1 fails on that machine; any future non-JS file (`README.md`, a `.json` fixture) fails the `/javascript/` assertion. Fix: `e.isDirectory() ? walk(p, out) : /\.mjs$/.test(e.name) && out.push(p)` (mirror the purity test's filter).

### F10 — MINOR — the purity guard's token regexes scan comments (the plan even bans the bare word "document" in comments)
`\b(window|document|navigator|localStorage)\b` and `\bprocess\.` will bite ordinary prose ("the task document.", "the process."), and P2 adds nine files. Fix: scan a comment-stripped copy for the token rules (keep the specifier scan on the raw source): `const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');` and run the `[label, re]` loop over `code`. Drop the "also never as a bare word in a comment" sentence from Global Constraints.

### F11 — MINOR — v1 `_engineRehydrate` moved a `.map` over `rp.bus?.workspace?.projects` out of the try
A truthy non-array `projects` in a corrupted point now throws `TypeError` from `.map` OUTSIDE the try (dev: the `for…of` TypeError landed INSIDE the try -> status `error`). Corrupt-point-only; either guard with `Array.isArray(rp.bus?.workspace?.projects) ? … : []` or accept and note it in the deviation list.

### F12 — MINOR — three hand-run traps
(a) Task 2 Step 4 "`git status --porcelain` must list exactly two entries" fails in the main checkout (dev carries `PR_DESCRIPTION.md`, `marketing/`, `worca-showcase.html` untracked) -> say "exactly two entries under `src/`"; (b) Task 11 Step 3 `git diff e6968e15 -- ui/public/ index.html`: `index.html` is `ui/public/index.html`, the root pathspec is a no-op -> drop it; (c) Task 0 branch `worca-cc/node-graph-v2-p1` vs §16's `P<n>` -> `P1` (the sentinels are exports, so it is cosmetic).

### F13 — MINOR — two copies of `BASE_HOOKS`/`V1_HOOKS` (prose + script) already drifted (anchor rows 37/38)
Keep ONE: the script's constants are what land; upgrade the script's `BASE_HOOKS` JSDoc to the prose's richer text (`manifest -> state.stepper (the UI snapshot); agentKeys -> the §9.4 preflight gate + the skills gate; workflow -> the run's audit line`, the "P8 turns these into `exec` rows" note, the 3-line `_initRunners` comment) plus F1/F4's sentences, and replace the prose blocks with "the hook text is the script's `BASE_HOOKS`/`V1_HOOKS` — do not retype".

### F14 — MINOR — stale old-branch comments beyond "V17"
`builtin-workflows.mjs` header: "`fixtures.mjs` re-exports it as FIXTURE_DEFAULT" — no such file exists in the rebuild. Byte-identity keeps it in P1; add it to the P8 comment-correction list (P1-p) so it is not forgotten.

### F15 — MINOR — `createOrchestratorFor` vs `selectEngine` on `resumePoint.version === null`
`selectEngine` treats `null` as absent (falls back to the template), the factory's `resumePointVersion === undefined && opts.workflowId` skips the row read for `null` -> `templateVersion` undefined -> v1. Same answer today, different reasoning; use `resumePointVersion == null` in the factory.

### F16 — MINOR (note only; A30 accepted) — `WIRE_ID_RE = /^w_?[a-z0-9]{1,32}$/` admits any `w…` token (`wire1`, `whatever`)
`/^w(?:_[a-z0-9]{1,32}|[0-9]{1,3})$/` admits exactly the minted (`w_` + 8 base36) and seed (`w1`..`w17`) shapes. Optional.

## 4. Test quality beyond the dry-run's audit
- `calls.prePause` (F2) and `calls.rehydrate`'s `memberWorktrees` are the only stub outputs the hooks test never checks; everything else is asserted. No tautologies found in Tasks 3/4/5/6/10 beyond the dry-run's three survivors. Ordering: `beforeEach(_resetForTests)` + `useTempHome(after)` registered before the dirs cleanup — correct; tests are independent.
- Task 7 test 3 stays vacuous until P5 (known); its `statSync` throws a plain error (not an assertion) on a dangling relative specifier — acceptable.
- Task 10: `'key' in n === (kind === 'agent')`, V7 single-wire, End/checklist/OR pins are real (S-a/S-b/S-d red); the fb pairing was the only unpinned datum (E6 + F8).
- Reporter text `ℹ pass N` (anchor row 30) still applies to every `Expected:` line, including the ones E4 rewrote.

## 5. Executability by a zero-context implementer
Task 0 is right for a pipeline (no branch creation; lineage check as the sentinel). The plan is self-contained (script + seeds embedded, byte-identical). Blocking traps: F3 (block order), F5 (count gates), the known D-1 (`--color-moved` command). Non-blocking: F12, F13. No placeholders, no "see spec", no undefined symbols; the two additions in F1/F2 need `getDb` imported in Task 3.

## 6. v1 safety
No behaviour change found beyond the two disclosed/undisclosed reorders (safe, §2) and F11 (corrupt points). `ui/public` untouched (`git diff e6968e15 -- ui/public/` empty on the clone). The workspace-resume `memberWorktrees` leg is covered by the oracle (S9 red x2); `_checkCostLimits`, `_phase`, `_recordStep`, `_preflightAgentKeys` sit on the base with unchanged bodies/keys; the `collectChannelDefs` relocation is safe by reader analysis. The pre-dispatch pause branch (S7) is the one v1 path with no test on dev either — F2 closes it for the base shell.

## Verdict
**Executable after fixes: YES.** CRITICAL: **F1** (hook contract as written — `audit?` optional-but-consumed, `workflow` unvalidated, both audit seams unpinned). Must-fix before execution: F1, F2, F3, F5; F4/F6 are one-paragraph doc fixes on the P1 side whose real payload is for P4 (seams S2/S3). Everything else is minor.

## Seam recommendations for the adjudicator (aligned to xplan §A)
- **S1 (A17 — agree, tighten):** `workflow:{id,name}` and `audit:string` are REQUIRED, validated at the seam with a named `engine hook contract:` error (F1). P4-E5/E18 must land; the base must not rely on it.
- **S2 (A18 — dissent, with evidence, not re-deciding):** the block is harness-pure (its `this.*` set in §2), P1's script already has the "both-sides helper -> export" rule P4 lacks, and P4 Task 1 as written unbinds `_testing` (`orchestrator.mjs:4369`) -> `orchestrator.mjs` unloadable (F6). If A18 stands, P4 Task 1 needs the three exports + import-back + `test/skill-capture.test.mjs` in its oracle, and P1-r should name it. Either owner, the `_log`/`_artifact` signature edits stay in P4.
- **S3 (`_engineRehydrate` placement):** contract text per F4 (pre-rehydration, outside the try, pure; restoration goes to `_engineRun`) + `await` allowance in the base. P4 Task 6 must move manifest adoption, prompt hydration and the §9.4 re-preflight into `_engineRun` — otherwise v2's "plugin disabled while paused" rejects instead of erroring like v1, and P4's `this.state.stepper` fallback/stamp is dead code. Relates to xplan D4.
- **S4 (A27):** fine; P1-E1..E5 are consistent with `_bookend(name, status)`. Fold the count shifts (F5) into E4's neighbours.
- **S5 (A28):** agree; add F8's real-data pin for `wf_default` and the by-role table — P3's fixtures then have something non-circular to agree with.
- **S6 (A30):** agree (arrays); F16 is optional tightening only.
- **S7 (A17 `_initRunners`):** P4-E4 should implement `_initRunners(opts)` rather than assign `this._runners` after `super()` (as its Task 3 constructor does), or both — harmless either way, but the sheet says the former.

Artifacts: `scratchpad/critique-p1/{run-harness-hooks-extra.test.mjs, graph-seed-templates-extra.test.mjs, s7-full.log}`, `scratchpad/critique-p1-xref.mjs`, `scratchpad/critique-p1-p4calls.mjs`. Probe worktrees removed; clone `p1` left at 97b0501b, untouched.
