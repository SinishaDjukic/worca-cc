# P2 refinement — APPLY REPORT (v2 plan written)

**File written (the ONLY file touched):**
`/Users/denislavprinov/Develop/worca-cc/docs/superpowers/plans/2026-08-26-node-graph-v2-P2-shared-core-sidecars-schema-store-v2.md`

v1 (`…-schema-store.md`) is byte-identical to its pre-run state (mtime still 01:11, md5 `977b29a58d4c6c8a3b969aead501b819`). No git command was run beyond `git status --porcelain` (read-only). No `npm test`/`npm ci` in the repo.

| metric | v1 | v2 |
|---|---|---|
| lines | 5252 | 5763 (+511) |
| bytes | 310 674 | 356 036 |
| fenced-block delimiters (`^```{3}`) | — | **234** (even ⇒ balanced) |
| diff | — | 131 lines removed / 642 added |
| fenced blocks | — | 117 |

---

## 1. Ledger (edit id · status · note)

### Plan-killers / mechanical (P2-M*)

| id | status | note |
|---|---|---|
| P2-M1 | **subsumed** | `KINDS.includes` already applied by xplan P2-E1 (verified at the V3 line); superseded by P2-C1, which ADDS the Task 0 shape probe. |
| P2-M2 | **subsumed** | same fix as P2-C2 / D3 — applied once, as `!!(w.config && …)`. |
| P2-M3 | **subsumed** | the xplan A1 edits (E5–E13) already deep-copy the template and rewrite `node.key` to the RESOLVED key before `agentsByKey` is built, so `portsFn` and the template agree. Residual kept: the B4 workspace test now pins the loop set AND the wire map (see P2-C24). |
| P2-M4 | applied | Task 0 Step 4: "verify `maxNodes: 80` / `maxWires: 200`, do not add" + the full P1 LIMITS literal. Verified against the clone: P1 ships exactly `{80,200,8,2,8,20,80}`. |
| P2-M5 | applied (merged with C17/D5) | see P2-C17 below. |
| P2-M6 | applied | V2 message → `` `node id ${JSON.stringify(id)} must match ${NODE_ID_RE}` ``; rule-table row → `/^n_[a-z0-9]{1,32}$/`. |
| P2-M7 | applied | V3 table row → `agent, task, end, and, or, combine` + the note that the list is `[...KINDS].join(', ')`, not alphabetical. |
| P2-M8 | applied | `PORT_TYPES` dropped from Task 3's Consumes line (merged with M16). |
| P2-M9 | applied | `flowPorts` now opens with `if (!FLOW_KINDS.includes(kind)) return undefined;`; the Interfaces line states it. |
| P2-M10 | applied | Task 7 note → "`PORT_TYPES` is a frozen ARRAY in P1; the spread is a defensive copy and stays". |
| P2-M11 | applied (= C7) | local `PORT_ID_RE` deleted, imported from `constants.mjs`. No Task 7 test expected `in_1`/`in-1` VALID (checked), and no builtin/flow port id contains `_`/`-` (checked all 11 fragments). |
| P2-M12 | applied | `WIRE_HIT_TOL 6` is now attributed to spec §7.4, "the prototype hit-tests ports only". |
| P2-M13 | applied | "second test" → "**third** test (`ui/public leaves the static root only into src/shared…`, `:46`)"; verified against the clone's `test/shared-graph-purity.test.mjs` (3 tests at `:21/:28/:46`). |
| P2-M14 | applied (= D4) | the four real mock suites listed (`ls test \| grep mock`), with "there is no `test/mock-runner.test.mjs`". |
| P2-M15 | applied | Task 9 header names the three deliberate deltas vs the old branch (decomposer `artifactKind`, implementer reorder + plan directive, `{diffInstruction}`), "the other **8** are byte-identical". |
| P2-M16 | applied | Task 3 Consumes: V1 reads `maxNodes`/`maxWires`, V12 reads `minArity`/`maxArity` (per C14); `maxPortsPerSide` is `gatePorts`'; `maxCycles`/`maxNameLen` reserved for P5. |
| P2-M17 | applied | B2 gains "One text for an unknown id, everywhere" — `assertRunnableWorkflow` and `resolveGraph` both throw `unknown workflowId "<id>"`; "do not reintroduce `workflow not found: <id>`". |
| P2-M18 | applied | B5 Step 2 note: dev's handler is `async (_req, res)` and the replacement MUST rename `_req` → `req`. |
| P2-M19 | applied | `agent-store.mjs:53` → `:54` (verified: `export async function createAgent` is at `:54`). |
| P2-M20 | applied | `agent-registry.mjs:189-249` → `:189-248`; Task 7's never-borrow anchor `:29` → `:28` + the real line quoted; Task 10's `agent-store.mjs:86-110` → `:97-99` with the three real lines. All verified against dev. |
| P2-M21 | applied | `INCREMENTAL_COLUMNS :732-745`→`:732-742`; ladder `:1051-1073`→`:1049-1073` + the `:1072`/`:1073` tail spelled out; maps `db.mjs:725-760`→`:732-766`; `:845`→`schemaGaps :814`, `repairSchemaGaps :834`, `reconcileSchema :855`. All verified. |
| P2-M22 | applied | `EXPECTED_TABLES :74-92` → `:74-93` (18 entries), title `:120`, length assertion `:126`. Verified. |
| P2-M23 | applied | `plugin-workflows.mjs:150-178` → `:150-179` + the byte-exact SQL at `:166`. Verified. |

### Critique fixes (P2-C*)

| id | status | note |
|---|---|---|
| P2-C1 (F1) | applied | xplan E1 verified applied; Task 0 Step 4 gains the array-shape probe for `KINDS`/`PORT_TYPES`/`FLOW_KINDS`. |
| P2-C2 (F2=D3) | applied | `const budgeted = !!(w.config && w.config.maxCycles !== undefined);` + a comment explaining `assert/strict.equal === strictEqual`. |
| P2-C3 (F3=D2) | applied | Task 10's pin → the SIX-key list incl. `implementer`; prose "Exactly SIX"; Files line updated; the implementer hint STAYS in Task 9; Q&A entry added. |
| P2-C4 (F4=D6) | applied | catalog ids everywhere a SETTER runs: B3 `claude-sonnet-5`; B4 override `claude-opus-5` + `max`, legacy `claude-opus-4-8`, defaults patch `{claude-sonnet-5, medium}`; B6 `claude-sonnet-5`. All three ids + `max` verified in `config.mjs:66-74`. Template `node.config` literals (`tpl-model`, `high`) left as-is. |
| P2-C5 (F5=D9) | applied | B5's `w3` is now `n_task.task → n_end.result` (a distinct pair into an already-wired input) so `errors[0].code === 'V7'`; the deepEqual identity assertion is kept. |
| P2-C6 (F6=D10=S6) | applied | `assertRunnableWorkflow` becomes an injected dep of `createProposalValidator` (default = real import); the plan now spells out the dep list, the `@param` update, the fake in `test/ask-proposal.test.mjs`'s `deps`, AND the new `{version:2}` case; the false "stays green" claim replaced. |
| P2-C7 (F7) | applied (= M11) | strict `/^[a-z][A-Za-z0-9]{0,31}$/` imported; Q&A records adj-f2 §3 / base §5's `_-` wording as superseded. |
| P2-C8 (F8) | applied (= M6) | + Q&A recording P1's `n_`-prefixed id space as a deliberate deviation from base spec V2. |
| P2-C9 (F9) | applied | every manifest cell gets `config: { ...(node.config \|\| {}) }`; `manifestTemplate` restores it verbatim (arity/awaitAll special cases dropped); the fixture's Task card gains `planStoreSeed: true`; the head test pins `plan.config`/`n_task.config`/`n_or.config`; the round-trip test asserts config survives for EVERY node. Q&A: spec §5.8 gains `config` (additive). |
| P2-C10 (F10) | applied | Task 9's commit step gains the 11-agent `## Ports` sentence + why nothing pins those bytes. |
| P2-C11 (F11) | applied | `origin = COALESCE(excluded.origin, workflows.origin)`; the return re-reads `origin`; a new test `a re-save that omits origin keeps it`. |
| P2-C12 (F12) | applied | v2 `POST /api/workflows` runs `nodeDefaultsError` over the 4 tunables BEFORE `validateGraph` → 400; a new test pins `unknown model "nope"` + "nothing was written". |
| P2-C13 (F13) | applied | V9 → `if (n.kind !== 'agent' \|\| !metaOf(n.id)) continue;` + rule-table row rescoped; a fixture proves an unwired `n_and.in2` reports ONCE (V12 only). |
| P2-C14 (F14) | applied | V12 arity uses `limits.minArity`/`limits.maxArity`; message `…needs an integer arity between 2 and 8 (got …)`; the `arity: 1` case uses the loose regex, a new `arity: 99` case pins the upper bound; rule-table row updated. |
| P2-C15 (F15) | applied | all seven fixture additions (a)–(g) landed INSIDE the existing rule tests, plus the S1/S3 V18 cases and the de-vacuumed V9 loop assertion (`REG.impl.fix` is now `required: true, loop: true`). Task 3 Step 3 gains a 9-item fine-grained mutation list. |
| P2-C16 (F16) | applied | (a) "insert the fragment immediately after the `"key": "<key>",` line" (verified: line 2 in all 11 sidecars); (b) a 4-row anchor table for the `.md` insertions — see DEVIATION 1; (c) the placeholder loop replaced with `if (!(k in raw)) { bad += 1; console.log(f, 'lost v1 field', k); }` over 5 v1 keys. |
| P2-C17 (F17+M5) | applied | one sweep command in BOTH places, `Expected BEFORE` = the two prose comment lines verbatim, `Expected AFTER` = empty (B1 Step 4 rewrites them to `17 -> 23`). See DEVIATION 2 for the `grep -v` ordering. |
| P2-C18 (F18) | applied | B7's three `POST /api/run` calls use a per-call `mkdtemp('worca-cc-run-')` project dir + `mock: true`, with their own `after` cleanup; the comment says never to pass `homeDir`. |
| P2-C19 (F19) | applied | `uiPhase = UI_PHASE[node.key] \|\| (typeof meta?.uiPhase === 'string' && meta.uiPhase) \|\| node.key`; pinned behaviourally in the head test (a custom key with `uiPhase:'review'`). |
| P2-C20 (F20) | applied | condition checked (`grep -rn "delete or edit those first" test/` is empty) ⇒ the REFERENCED message gains " (archived rows count)". |
| P2-C21 (F21) | applied | geometry prose lists BOTH 0-input deviations; the test pins `portAnchor(bare, agentPorts(0,1),'await','in').y === 89` and `agentPorts(1,1) → 122`. Both values were MEASURED against P1's real `geometry.mjs`. |
| P2-C22 (F22) | applied | Task 3's fixture comment → "Task 10 Step 4 … seed drift guard, Task 13"; Task 13 → "add beside P1's imports at the TOP". |
| P2-C23 (F24) | applied | Task 7 gains "One INTENTIONAL divergence from v1 leniency" on `runnerType`, plus a Q&A entry. |
| P2-C24 (seam 9) | applied | `g.loops.loopWireIds.size >= 1` → `assert.deepEqual([...].sort(), ['w5'])` **for the B4 fixture's actual loop set** — see DEVIATION 3 — plus `assert.deepEqual(g.wires, { w5: { maxCycles: 4 } })`. |
| F23, F25 | note only | no edit (as instructed). |
| Provenance | applied | the `> **v2 (refined 2026-08-27, Session A):** …` line sits directly under the title. |

### Dry-run deviations + survivors

| id | status | note |
|---|---|---|
| D1/D2/D3/D6/D9/D10 | applied once | = C1/C3/C2/C4/C5/C6. |
| D4 | applied | = M14. |
| D5 | applied | = C17. |
| D7 | applied | B4's import block rewritten with `readWorkflow`; the now-redundant "(add `readWorkflow` to the import list.)" parenthetical removed. |
| D8a | applied | the §D8a preamble embedded VERBATIM (mkdtemp prefix `worca-cc-wfgraphapi-`, `useTempHome(after)`, `let homeDir, srv, base, prevHome`, the `before`/`after` pair, all five imports) + an order-dependence comment; the "copy it verbatim" tail sentence removed. |
| D8b | applied | the same preamble for `test/run-workflow-gate.test.mjs` (prefix `worca-cc-rungate-`), plus the missing `api()` helper, merged with C18's project-dir recipe. |
| D11 | applied | B3 Step 2 gains numbered edit 5 (`test/run-config.test.mjs:96` → `{ nodes: {}, wires: {}, feedbacks: {} }`), the file is added to B3's **Files** line, and the verification command list. |
| S1 | applied | V18 exemption (a): `n_two` with a task-sourced `plan` + a clarify-sourced `task`. |
| S2 | applied once (= F15 a) | V18 exemption (c): `n_plan.plan → n_impl.await`. **Adapted** — see DEVIATION 4. |
| S3 | applied | V18 exemption (d): an OR valve whose always-typed `out` feeds the loop input `impl.fix`. |
| S4 / S5 | applied once (= F15 b/c) | V19 `end.result` and `agent.await` exemptions. |
| S6 | applied once (merged with C6) | the `propose_run refuses a graph template` case in `test/ask-proposal.test.mjs`. |
| S7 | applied | a `spawnSync` CLI case in `run-workflow-gate.test.mjs` (graph row AND archived row ⇒ exit 2 + the `worca: …` stderr). **Adapted** — see DEVIATION 5. |
| S8 | applied | the deleteAgent test now archives `wf_uses` and asserts the refusal STILL fires with `/archived rows count/`. |
| S9 | applied | a `referencedPluginAgents('demo')` case that plants a plugin sidecar under `pluginCurrentDir('demo')/agents`. **Adapted** — see DEVIATION 6. |
| S10/S11 | applied | the source-regex test is REPLACED by a behavioural jsdom test appended to `test/ui-composer.test.mjs`, calling `window.__np.buildNodeConfigRows/buildFeedbackRows` and `window.__composerRenderList`. **Adapted** — see DEVIATION 7. |

### Applier-initiated (not in the manifest; each is recorded here)

| id | note |
|---|---|
| APPLIER-1 | Renamed the two LOCAL `Set`s `ARITY_KINDS` → `ARITY_SET` (validate.mjs, template.mjs) and `CAPTION_KINDS` → `CAPTION_SET` (geometry.mjs). They are not P1 constants, but `ARITY_KINDS.has(...)` reads exactly like the F1 bug and made the mandated `grep 'KINDS.has'` sweep un-cleanable. 6 occurrences; all three affected modules re-extracted and re-run green afterwards. |
| APPLIER-2 | Two PROSE lines that quoted the literal `KINDS.has` (the Task 0 probe comment and mutation line 1) reworded to keep the meaning without the token, so the sweep is clean. |
| APPLIER-3 | The graph-manifest fixture's `model: 'sonnet'` → `'claude-sonnet-5'` (3 spots, incl. two assertions). Pure-unit fixture, no catalog involved — changed so the plan contains NO invented model id anywhere and the `'sonnet'` sweep is clean. |
| APPLIER-4 | Manifest cell `config: { ...cfg }` → `config: { ...(node.config \|\| {}) }` (identical value; `cfg` is `node.config \|\| {}`) so the mandated `config: { ...(node.config` grep hits the manifest builder, not only `resolveGraph`. |
| APPLIER-5 | Task B10 Step 5's handoff sentence pointed at the **v1** filename; repointed at `-v2.md` with "the v1 file beside it is superseded". |
| APPLIER-6 | Task 10's Expected line said "6 net-new tests"; corrected to "6 test blocks written, NET +5" (4 added − 1 rewritten + 2), which is what the +97 breakdown assumes. |

---

## 2. Adaptations / deviations from the manifest text (7)

1. **P2-C16(b), decomposer anchor.** The manifest offered the critique's first option ("after line 7 before `# Your role`"). I took the critique's SECOND option instead: the block goes after the `# Your role` paragraph (`:10-13`), before `## Draft vertical slices` (`:15`). Reason: `agents/worca-cc-decomposer.md` opens with an H1 at `:8` (verified), so inserting an H2 above it contradicts the plan's own rule ("right after the intro paragraph, before the next `##` heading") and would put `## Ports` above the role statement. F16(b) explicitly authorises either wording. All four anchors are given as a table with the quoted heading AND the line number, verified against dev.
2. **P2-M5/C17, sweep command ordering.** The manifest's command is `grep -rn -A1 … | sed -E 's/^[^:]+[:-][0-9]+[:-]//' | grep -w 22`. That is correct BEFORE B1, but AFTER B1 the new `test/db-migrate-v23.test.mjs` deliberately stamps `PRAGMA user_version = 22` three times, and once the `sed` has stripped the prefix there is no filename left to filter on — the "AFTER: empty" expectation would be impossible. I kept the mandated `sed` literal verbatim and moved `grep -v db-migrate-v23` **before** it. Both hits were measured on dev: raw sweep = 6 lines (2 real comments + 4 line-number false positives), sed-stripped sweep = exactly the 2 comment lines.
3. **P2-C24, the loop-set literal.** The manifest suggested `['w12','w15','w5']` (that is `wf_full`'s loop set) "or the fixture's actual loop set — the applier computes it". Task B4's test does not use `wf_full`; it uses its local `GRAPH()` fixture whose only loop wire is `w5`. I pinned `['w5']` (which is also exactly what the critique's seam recommendation 9 asks for) and added `assert.deepEqual(g.wires, { w5: { maxCycles: 4 } })` as the M3 residual.
4. **S2 / F15(a), the await fixture's source.** F15(a) proposed wiring `n_task.task → n_impl.await`. That would NOT kill the mutation: with exemption (c) removed, exemption (a) (task-sourced) still skips the port, so the test stays green. I used `n_plan.plan → n_impl.await` (an agent source, `when: 'always'`) instead. **Measured**: with (c) removed the suite goes `pass 22 / fail 1`; with F15(a)'s wording it would have stayed 23/23.
5. **S7, the CLI invocation.** The dry-run wrote `node src/cli/worca-cc.mjs run --workflow …`. There is no `run` subcommand — `SUBCOMMANDS` (`worca-cc.mjs:1459`) is `add/list/remove/resume/doctor/plugin/marketplace/config` and a bare invocation IS the run path, so a stray `run` token would be parsed as the prompt. The test uses the `test/cli-branch-flags.test.mjs:52-56` recipe (`[CLI, '--project', dir, '--prompt', 'x', '--mock', '--yes', '--workflow', id]`) against a temp project dir, and the plan says why.
6. **S9, `pluginCurrentDir`'s home.** The dry-run's snippet used `workflowsUsingKeys('demo', new Set([...]))`, which does not exist on dev. The real export is `referencedPluginAgents(name)` (`plugin-workflows.mjs:150`), and `pluginCurrentDir` lives in `src/core/plugins-lock.mjs:26`, not in `plugin-workflows.mjs` — the plan now imports it from there and says so.
7. **S10/S11, where the behavioural test lives.** The dry-run said "`ui-composer.test.mjs` already boots jsdom and can call the functions directly". `buildNodeConfigRows`/`buildFeedbackRows` are on `window.__np` (`app.js:2879-2882`) but `composerRenderList` is NOT exported anywhere, so B9's implementation step now also adds one line to the existing `window.__composer` hook (`window.__composerRenderList = composerRenderList;`, same convention as its two neighbours). The test is APPENDED to `test/ui-composer.test.mjs` (which owns `boot()`), not to the new `graph-row-consumers.test.mjs`; the count table accounts for it as `test/ui-composer.test.mjs +1`.

Also worth flagging for the wave-2 executor: **P2-C12's `pick(...)`** does not exist in `ui/server.mjs` (the only `pick` there is a local closure at `:3988`). The plan spells the same thing out inline with `TUNABLES` + `Object.fromEntries`, which is what `nodeDefaultsError(raw, models, where)` actually needs (it reads only `raw.model`/`raw.effort`).

---

## 3. Recount table (`test(` blocks per new/modified file, after all edits)

### P2a — **+97** (unchanged from the v1 dry-run: every sharpened fixture rides inside an existing `test(` block)

| file | tests | vs v1 dry-run |
|---|---|---|
| test/graph-ports.test.mjs | 8 | = |
| test/graph-loops.test.mjs | 7 | = |
| test/graph-validate.test.mjs | 23 | = |
| test/graph-template.test.mjs | 10 | = |
| test/graph-geometry.test.mjs | 10 | = |
| test/graph-layout.test.mjs | 5 | = |
| test/graph-thumbnail.test.mjs | 2 | = |
| test/graph-agent-meta.test.mjs | 11 | = |
| test/mock-writer-roles.test.mjs | 2 | = |
| test/agent-registry-schema-v2.test.mjs | +3 (4 written − 1 rewritten away) | = |
| test/graph-registry-ports.test.mjs | 2 | = |
| test/graph-manifest.test.mjs | 9 | = |
| test/shared-graph-single-source.test.mjs | 2 | = |
| test/graph-seed-templates.test.mjs | +3 | = |
| **P2a total** | **97** | **= 97** |

### P2b — **+42** (was +37; five new tests)

| file | tests | vs v1 dry-run |
|---|---|---|
| test/db-migrate-v23.test.mjs | 4 | = |
| test/workflows-graph-rows.test.mjs | 7 | **+1** (C11 origin) |
| test/config-wire-cycles.test.mjs | 4 | = |
| test/workflows-resolve-graph.test.mjs | 7 | = |
| test/api-workflows-graph.test.mjs | 9 (B5 6 + B6 3) | **+1** (C12 catalog) |
| test/run-workflow-gate.test.mjs | 4 | **+1** (S7 CLI gate) |
| test/ask-proposal.test.mjs | +1 | **+1** (C6/S6) |
| test/ask-catalog-graph.test.mjs | 3 | = |
| test/graph-row-consumers.test.mjs | 2 | = (regex test replaced by S9) |
| test/ui-composer.test.mjs | +1 | **+1** (S10/S11) |
| **P2b total** | **42** | **= 37 + 5** |

Gates written into the plan (both marked *re-measured in the wave-2 execution; write the printed number*):
- Task 0 Step 6 BASELINE: dry-run 3760 on dev, **3810** with P1 v2.
- **Task 14 (P2a gate): `ℹ pass BASELINE + 97` / `ℹ fail 0`, projecting to 3907.**
- Task B0 Step 4 BASELINE-B = Task 14's number (projects to 3907).
- **Task B10 (P2b gate): `ℹ pass BASELINE-B + 42` / `ℹ fail 0`, projecting to 3949; both halves in one run = BASELINE + 139.**

Every per-task `Expected` now uses `ℹ pass N` / `ℹ fail 0` (Node ≥ 22 `spec` reporter). All four `npm test 2>&1 | tail -5` sites (Task 0 Step 6, Task 14 Step 1, Task B0 Step 4, Task B10 Step 1) is now `npm test 2>&1 | grep -E '^ℹ (tests|pass|fail) '` with the reason inline.

---

## 4. Verification greps on the v2 file

**MUST BE EMPTY — all five empty:**

```
grep -n '# pass\|# fail' F                                                     -> (empty)
grep -nE 'TBD|TODO|see spec|see the spec|adapt as needed|similar to Task|<!--END-->' F  -> (empty)
grep -n 'KINDS.has\|FLOW_KINDS.has\|Boot preamble: COPY\|Boot preamble: copy\|maxNodes: 60' F -> (empty)
grep -n "'sonnet'\|'override-model'\|'legacy-model'\|effort: 'low'\|effort:'low'" F     -> (empty)
grep -n "409" F                                                                -> (empty)
```

**MUST BE NON-EMPTY — all twelve non-empty:**

| pattern | hits |
|---|---|
| `KINDS.includes` | 4 |
| `'implementer', 'manualTestsChecklist'` | 1 |
| `Boolean(w.config` \| `!!(w.config` | 1 |
| `must match ${NODE_ID_RE}` | 1 |
| `import { PORT_TYPES, MAX_PORTS_PER_SIDE, PORT_ID_RE }` | 1 |
| `COALESCE(excluded.origin` | 2 |
| `nodeDefaultsError` | 4 |
| `config: { ...(node.config` | 2 |
| `worca-cc-wfgraphapi-` | 1 |
| `run-config.test.mjs` | 5 |
| `v2 (refined 2026-08-27` | 1 |
| `sed -E 's/^[^:]+[:-][0-9]+[:-]//'` | 2 |

Extra consistency sweeps (all clean): no `five builtins` / `Exactly five`; no `workflow not found` except the "do not reintroduce" warning; no `integer arity >= 2`; no `PASS — N tests passing`.

---

## 5. `node --check` + `JSON.parse` results

**`node --check` — 36/36 OK** (every whole-file `js` block extracted to `scratchpad/p2-apply/check/`):

modules: `ports.mjs, loops.mjs, validate.mjs (3 blocks joined), template.mjs, geometry.mjs, layout.mjs, thumbnail.mjs, agent-meta.mjs, manifest.mjs, registry-ports.mjs, test/helpers/graph-ports.mjs, ui/public/graph/model.mjs`
tests: `graph-ports, graph-loops, graph-validate (2 blocks joined), graph-template, graph-geometry, graph-layout, graph-thumbnail, graph-agent-meta, mock-writer-roles, agent-registry-schema-v2 additions, graph-registry-ports, graph-manifest, shared-graph-single-source, graph-seed-templates additions, db-migrate-v23, workflows-graph-rows, config-wire-cycles, workflows-resolve-graph, api-workflows-graph (B5+B6 joined), run-workflow-gate, ask-proposal addition, ask-catalog-graph, graph-row-consumers, ui-composer addition`

**`JSON.parse` — 11/11 OK.** Each Task 9 fragment was wrapped as `{ <fragment minus its trailing comma> }` and parsed:

```
clarify              metaVersion,mockRole,inputs,outputs
planner              metaVersion,mockRole,workspaceFanOut,workspaceStrategy,inputs,outputs
refiner              metaVersion,mockRole,promptHints,wantsRequest,workspaceFanOut,workspaceStrategy,verdict,inputs,outputs
planReviewer         metaVersion,mockRole,promptHints,wantsRequest,workspaceFanOut,workspaceStrategy,verdict,inputs,outputs
decomposer           metaVersion,mockRole,inputs,outputs
implementer          metaVersion,mockRole,sideEffect,workspaceFanOut,workspaceStrategy,promptHints,inputs,outputs
reviewer             metaVersion,mockRole,wantsRequest,workspaceStrategy,verdict,inputs,outputs
workspaceReviewer    metaVersion,mockRole,workspaceVariantOf,promptHints,workspaceFanOut,workspaceStrategy,verdict,inputs,outputs
manualTestsChecklist metaVersion,mockRole,promptHints,inputs,outputs
manualWebUiTesting   metaVersion,mockRole,promptHints,verdict,inputs,outputs
workspaceScanner     metaVersion,mockRole,placeable,inputs,outputs
```
(Every fragment ends with a trailing comma, as C16(a)'s "insert after the `"key":` line" instruction requires.)

---

## 6. Empirical verification (beyond syntax)

The nine pure P2a modules were extracted into `scratchpad/p2-apply/tree/` on top of P1's real `constants.mjs`/`verdict.mjs` (from the dry-run clone at `9c937e61`) and RUN:

| suite | result |
|---|---|
| graph-ports | `ℹ pass 8 / ℹ fail 0` |
| graph-loops | `ℹ pass 7 / ℹ fail 0` |
| graph-validate | `ℹ pass 23 / ℹ fail 0` |
| graph-template | `ℹ pass 10 / ℹ fail 0` |
| graph-geometry | `ℹ pass 10 / ℹ fail 0` |
| graph-layout | `ℹ pass 5 / ℹ fail 0` |
| graph-thumbnail | `ℹ pass 2 / ℹ fail 0` |
| graph-agent-meta | `ℹ pass 11 / ℹ fail 0` (with the STRICT imported `PORT_ID_RE`) |
| graph-manifest | `ℹ pass 9 / ℹ fail 0` |
| **total** | **85 / 85, fail 0** |

**Mutation audit of the sharpened `graph-validate` suite — all 13 mutations now RED** (each was applied to `validate.mjs`, measured, then reverted):

| mutation | result |
|---|---|
| `KINDS.includes` → `KINDS.has` (F1) | pass 1 / fail 22 |
| V5: drop the two `metaOf(...)` guards | pass 22 / fail 1 |
| V7: iterate `liveWires` instead of `wires` | pass 22 / fail 1 |
| V9: drop `n.kind !== 'agent'` | pass 22 / fail 1 |
| V9: drop `inp.loop \|\| isLoopInput(...)` | pass 22 / fail 1 |
| V11: `!metaOf(id) → return false` | pass 22 / fail 1 |
| V15: drop `metaOf(n.id) &&` from the entry filter | pass 22 / fail 1 |
| V18: drop (c) await skip | pass 22 / fail 1 |
| V18: drop (a) task-source skip | pass 22 / fail 1 |
| V18: drop (d) loop skip | pass 22 / fail 1 |
| V19: drop the `end`/`result` exemption | pass 22 / fail 1 |
| V19: drop the `agent`/`await` exemption | pass 22 / fail 1 |
| V12: drop the `arity > limits.maxArity` bound | pass 22 / fail 1 |

All **seven F15 survivors are dead**, and the V9 loop-exemption assertion is no longer vacuous.

**Manifest mutations (C9/C19) — all RED:**

| mutation | result |
|---|---|
| `manifestTemplate` back to the `{arity, awaitAll}` rebuild | pass 8 / fail 1 (`n_task config survives`) |
| + drop the cell's `config` too | pass 7 / fail 2 |
| drop the `meta.uiPhase` fallback | pass 8 / fail 1 |

**Geometry:** `portAnchor(bare, agentPorts(0,1), 'await','in').y === 89` and `agentPorts(1,1) → 122` were computed from P1's real `geometry.mjs`, not asserted from the critique text.

**Repo facts re-verified by hand** (dev @ `e6968e15`): `agent-registry.mjs` `normalizeMeta` `:189-248`, `DEFAULT_AGENTS_DIR` `:28`; `agent-store.mjs` `createAgent :54`, the three merge lines `:97-99`, the REFERENCED throw `:137` (unpinned by any test); `plugin-workflows.mjs` `referencedPluginAgents :150-179`, SQL `:166`; `plugins-lock.mjs` `pluginCurrentDir :26`; `db.mjs` `INCREMENTAL_COLUMNS :732-742`, `INCREMENTAL_TABLES :752-766`, `schemaGaps :814`, `repairSchemaGaps :834`, `reconcileSchema :855`, ladder `:1049-1073`; `db.test.mjs` `EXPECTED_TABLES :74-93` (18), title `:120`, length `:126`; `config.mjs` catalog ids `claude-opus-5 :66`, `claude-opus-4-8 :68`, `claude-sonnet-5 :74` (all with `max`); `model-env.mjs EFFORTS :18`; `ui/server.mjs` `nodeDefaultsError :3102`, `app.get('/api/workflows', async (_req, res)` `:3116`, v1 catalog loop `:3150-3156`; `app.js` `window.__np` `:2879`, `window.__composer` `:1973`; `worca-cc.mjs` `SUBCOMMANDS :1459` (no `run`), `fail() :165`; `proposal.mjs createProposalValidator :54-61`, workflow block `:104-106`; `ask-proposal.test.mjs deps :15-31`; the four real `*mock*` suites; `shared-graph-purity.test.mjs` has 3 tests (`:21/:28/:46`); P1's `constants.mjs` `PORT_ID_RE :82` strict + `LIMITS :86-94` = `{80,200,8,2,8,20,80}`.
