# Run-folder artifacts — design

Status: approved 2026-09-08 (derived from the 2026-09-03 plan; decisions D1–D15 locked).
Base: dev @ 7b188b2c + 115ee556 "Per-step artifacts" (cherry-picked).

## §1 Goal

Every file a pipeline execution produces lands inside the run folder, under one
step folder per execution, is indexed with its node/cycle attribution, and is
served safely to the UI Artifacts tab, the per-node "Artifacts (N)" affordance
and the Ask Worca artifact tools. The project store's `plans/` and `reviews/`
directories receive no new files.

## §2 Layout

```
<store>/<key>/pipelines/<runDir>/
  prompt.md, task.md, live-log.ndjson, results.json, diff-patch.patch   (engine root files, unchanged)
  questions-x-<node>-c<N>-r<R>.json                                       (unchanged)
  steps/
    <safe(nodeId)>-c<ordinal>[-<safe(sliceId)>]/                           (D2, flat, one per execution)
      <allocated outputs>  <verdict json>  <anything the agent wrote>
      tasks/p<phase>-t<n>-<slug>.md                                        (the decomposer's execution only)
```

- **D1** Every allocated output, every verdict, the combine card's markdown, a
  `planStoreSeed` task card's plan and every extra file an agent writes live in
  the run folder under `steps/`. Nothing new is written to `<store>/<key>/plans`
  or `reviews`.
- **D2** `stepDirName = safe(nodeId) + '-c' + ordinal + (slice ? '-' + safe(sliceId) : '')`,
  `safe = s => String(s).replace(/[^A-Za-z0-9_-]/g, '_')`. `stepDirOf(node, ordinal, runCtx)`
  = `join(runCtx.pipelineDir, 'steps', stepDirName)`. Pure: allocation, the prompt,
  the mock markers and the scan all derive it; nothing is stored.
- **D3** Filenames carry kind + version/cycle, never the run base name or the
  date: `plan{vsuffix}.md`, `<kind>-review-cycle{cycle}.md`, verdicts
  `<stem>-cycle{cycle}.json`, `decomposition.json`, `manual-tests-checklist.md`,
  `clarify.json`, `combine.md`, `tasks/<p>-<t>-<slug>.md`. `{base}` remains a
  supported template token for third-party sidecars; no builtin uses it.

## §3 Allocation

- **D4** A port's `store` property is accepted (the composer still validates
  `run | project`) and ignored: every output resolves under the step folder with
  `store: 'run'`.
- **D5** The duplicate-key (`<nodeId>-`) and slice (`<sliceId>-`) filename
  prefixes are removed; the folder is the discriminator.
- The `{vsuffix}` counter is unchanged: run-global, one tick per distinct
  template per execution, persisted in the resume point, consumed at 1 by
  `planStoreSeed`. `planFileName(v)` = `plan.md` / `plan-vN.md`.
- The combine card allocates `<stepDir>/combine.md`; the decomposition's task
  files live in `<stepDir>/tasks` of the execution that writes the manifest
  (**D10**, see §6.4).

## §4 The verdict

- **D6** After an execution, the verdict file is indexed as kind `verdict`
  (attribution `{ stepKey: executionId, nodeId, cycle: ordinal }`), BEFORE the
  scan, and only when `result.verdict` exists and is not `missing`. It stays in
  the step folder under its rendered basename (`{cycle}` renders), so
  `_verdictKind` keeps mapping `impl-review` → `impl` etc.

## §5 The allocation table (builtin sidecars)

| agent key | port / verdict | file in `steps/<node>-cN/` |
|---|---|---|
| planner | plan | `plan{vsuffix}.md` |
| refiner | plan / revise (one file), verdict | `plan{vsuffix}.md`, `refine-review-cycle{cycle}.json` |
| planReviewer | review, verdict | `plan-review-cycle{cycle}.md`, `plan-review-cycle{cycle}.json` |
| reviewer | review, verdict | `impl-review-cycle{cycle}.md`, `impl-review-cycle{cycle}.json` |
| workspaceReviewer | review, verdict | `ws-review-cycle{cycle}.md`, `ws-review-cycle{cycle}.json` |
| manualWebUiTesting | review, verdict | `webui-review-cycle{cycle}.md`, `webui-review-cycle{cycle}.json` |
| manualTestsChecklist | checklist | `manual-tests-checklist.md` |
| decomposer | tasks | `decomposition.json` + `tasks/…` |
| clarify | answers | `clarify.json` |
| workspaceScanner | workspace | `workspace-description.md` |
| implementer | (void) | nothing allocated; extras only |
| combine card | out | `combine.md` |
| task card + planStoreSeed | task | `plan{vsuffix}.md` (consumes version 1) |

`allocateVerdict` = `{ path: join(stepDirOf(...), render(ports.verdict.filename)) }`.

## §6 Recording

### §6.1 The scan (D7)
After the allocated outputs and the verdict are recorded, the orchestrator scans
the execution's step folder (`src/core/step-scan.mjs`): recursive, depth ≤ 8,
≤ 50 files (one warning, the rest dropped), dot-files and dot-dirs skipped,
`dirent.isFile()` only (symlinks neither listed nor descended), files > 5 MB
skipped with one warning per file. Kinds are FORMAT-only from the extension:
`markdown | json | diff | image | binary | text` — never a semantic kind. The
rel path is run-dir-relative and `/`-joined. Dedupe is kind-agnostic on rel
path against every row the run has indexed so far. Only the step folder is
scanned — never the run root; flow cards are not scanned. Warnings become
run-log lines.

### §6.2 Order and attribution
`allocated outputs (port set) → verdict (port null) → scanned rows (port null)`,
all with `{ stepKey: executionId, nodeId, cycle: ordinal }`.

### §6.3 Flow cards (D8)
The combine card's `combine.md` is indexed as kind `combine`; a `planStoreSeed`
task card's plan as kind `plan`. Only outputs whose path is under
`<runDir>/steps/` and exist on disk are recorded; AND/OR/End record nothing;
no scan.

### §6.4 Task files (D9, D10)
**D9** Every agent prompt's Ports block ends with a `### Step folder` section
naming the folder and instructing the agent to keep every extra file inside it.
**D10** The decomposition contract names `<stepDir>/tasks` as the task dir. A
manifest `file` may be absolute or run-dir-relative but MUST resolve inside the
run folder (lexical `resolve` + `startsWith(root + sep)`); an escaping path
fails the expansion with `"<node>: task \"<id>\" file resolves outside the run
folder: <file>"`.

### §6.5 Live list dedupe
The live UI list (`r.artifacts`) dedupes on `(stepKey, path)` — a resumed
execution re-emits its allocated outputs.

## §7 The read path (D11)
`resolveIndexedArtifactForRow(row, rel)` selects the row as before (exact, else
longest suffix; `..` rows refused), then for each base (run dir, store root):
realpath both, refuse (`null`) a real path outside the base — never fall
through to the next base; stat before reading; a directory is `null`; kinds in
`BINARY_KINDS = {image, binary}` answer `{ rel, bytes, binary: true }`; files
above `ARTIFACT_READ_MAX_BYTES = 2 MiB` answer `{ rel, bytes, tooLarge: true }`;
else `{ rel, text }`. Routes: 415 / 413 with `{ error, rel, bytes }`, 200, 404.
`GET /api/runs/:id/artifacts` fetches `limit + 1` rows and reports `truncated`.
Ask's `read_run_artifact` throws `AskToolError` for binary / too-large. The
viewer never fetches a binary kind and shows the route's message with the size.

## §8 Windows
Folder segments are `[A-Za-z0-9_-]`; every stored rel path and every warning
path is `/`-joined (`split(sep).join('/')`); realpaths compare with the native
`sep`; no shell; symlink tests skip on `win32`; sparse files via `truncate`.

## §9 The mock (D13)
`markersFor` always emits `MOCK_STEP_DIR: <stepDir>`. Test-only
`WORCA_MOCK_EXTRA_FILES="rel=text;rel=text"` writes those files into
`MOCK_STEP_DIR` after the role side effects (a `..` rel is ignored). The mock
decomposer writes absolute `file` paths under `MOCK_TASKS_DIR`.

## §10 Tests
New: `graph-step-dir`, `graph-executor-steps`, `step-scan`, `mock-step-files`,
`orchestrator-step-artifacts`, `artifacts-read-guard`, `api-run-artifact-guard`,
`ask-tools-artifact-guard`, `ui-run-artifacts-steps`. Updated: `graph-executor`,
`graph-prompt-parity` (+ snapshots), `mock-graph`, `orchestrator-graph`,
`persist-roundtrip`, `artifacts-store`, `artifact-view`, `ui-history-detail`,
the seed-trace goldens. Browser proof: `scripts/verify-artifacts-cdp.mjs`.

## §11 Rollout (D12, D14, D15)
- **D12** Old runs are untouched: no migration, no re-index; `planPath` /
  `reviewPath` stay exported for the migrator, pipeline-delete and old tests;
  `ensureArtifactDirs` creates only `pipelines/`; old store-root rows keep
  resolving through the store-root base.
- **D14** Goldens regenerate as deliberate, reviewed changes: prompt snapshots
  when the prompt contract lands, seed traces LAST.
- **D15** The engine names no agent key; branching on flow KIND (`combine`,
  `task`) is engine-owned and allowed.
- Baseline `npm test` on dev @ 7b188b2c + 115ee556: 4762 pass / 0 fail
  (measured 2026-09-08). After this feature: 4801 pass / 0 fail (+39). Run it
  with `WORCA_HOST_PID` unset: the worca app server exports that variable and
  `test/host-guard-wiring.test.mjs` asserts a spawned child never sees it, so an
  inherited value reddens one case for environmental reasons alone.
