# Findings for later plans (recorded during P1/P2 refinement, Session A 2026-08-27) — append as "## Known issues (Session A)" to each plan before Sessions D…I refine them

## P4 (graph-orchestrator-dispatch)
- F6 (P1 critique): Task 1's telemetry hoist moves+deletes `SKILLS_MAX`, `skillLabel`, `mergeSkills` from `orchestrator.mjs` while `export const _testing = { SKILLS_MAX, skillLabel, mergeSkills }` (`orchestrator.mjs:4369`, imported by `test/skill-capture.test.mjs`) stays → ReferenceError at module load → every importer of `orchestrator.mjs` breaks. Fix: Step 4b export list += the three; Step 5 `import { SKILLS_MAX, skillLabel, mergeSkills } from './run-harness.mjs'` for `_testing` (or move `_testing` with them); Step 6 oracle += `test/skill-capture.test.mjs`.
- F4 / xplan seam S3 + §D4: `_engineRehydrate` runs BEFORE any state is rehydrated and OUTSIDE the shell's try (dev `:820` position; P1 v2 documents + validates it and `await`s it). P4 Task 6 must move manifest adoption, prompt hydration and the §9.4 re-preflight into `_engineRun({resume, rehydrated})` (inside the try, after restoration); `_engineRehydrate` stays pure (read `rp`, decide, return `{checkpointRef, memberWorktrees, plan?, audit}` with `audit` REQUIRED: `Pipeline **resumed** (graph snapshot at seq ${rp.snapshot?.seq ?? 0}).`). `resume` in `_engineRun` is the resume POINT (object), not a boolean.
- P1 v2 validates the hook contracts at the seams: `_resolveTopology` must return `{manifest, agentKeys, workflow:{id,name}}` (else `engine hook contract: _resolveTopology …` error before `_engineRun`); `_engineRehydrate` must return a string `audit` and an array `memberWorktrees`.
- xplan §D5: `resolvedFromManifest` returns live metas in `agentsByKey` — add a resume test that a changed sidecar cannot alter port identity.
- `_initRunners(opts)` is the constructor seam (P1 A17) — implement it rather than assigning `this._runners` after `super()`.

## P6 (run-monitor-v2-cli)
- xplan §D1: Task 3's ~95-line view-code block is a labelled REFERENCE copy of P5's implementation — delete or collapse to the Interfaces block.

## P5 (composer-v2)
- xplan §D2: composer wire hit-testing must call geometry's `hitWire(a, b, pt, {loop, tol})` (spec §7.2) rather than re-sampling the cached `d`, or justify in Q&A.
- xplan §D3: the band/chrome/badge fast paths assume Task 1's `h(tag, cls, text)` helper semantics and per-loop-wire badge hosts — dry-run must confirm.
- xplan §D7: Task 2 expected count +2 (re-measure).

## P7 (agents-view-agent-gen-plugin-api-3)
- xplan §D6: `test/plugin-manifest.test.mjs` deepEqual on `apiMismatch()` must tolerate the new `message` field.

## P3 (engine-no-callers)
- P2 refinement: `manualTestsChecklist.promptHints` carries a `{diffInstruction}` token (single-project value reproduces dev bytes; the detached-workspace arm cannot come from the same template) — Task 9's parity pins + sidecar-repair allowance must cover it.

## P4 (from the P2 critique / seam recs)
- F9: manifest cells now carry `config: {...node.config}` verbatim and `manifestTemplate` restores it — `resolvedFromManifest` must read `mn.config` (not `{ arity: mn.arity }`); A1's `nodes[id].config` then has one source on fresh and resume paths (spec §5.8 shape gains `config`, additive).
- A20/E6: `resolveGraph`'s not-found text is now `unknown workflowId "<id>"` — `_resolveTopology`'s error mapping should expect it.
- Shim cells (A19, measured): the OR card lands in cell 1 beside Task on `wf_full`/`wf_provided-plan`/`wf_full-no-decompose` (both in-wires are loop wires) — v1 painters draw a `key:null` OR chip there until P6.
## P6
- same shim-cell note as P4 (OR chip in cell 1) for `paintGraphFor`'s v1 arm expectations.
## P3
- P2 keeps the implementer `promptHints` ("Work inside the project directory (your cwd). Commit nothing; just edit files and tests.") — Task 9's parity pin must consume it from the sidecar, not re-add it in `baseInstruction`.
- `PORT_ID_RE` canonical = P1's strict lowerCamel regex (no `_`/`-`); adj-f2 §2/§3 texts saying otherwise are superseded — P7's editor hint must say lowerCamel only.
