# W-075: worca-bench — config evaluation harness + dashboard

**Status:** Draft
**Priority:** P2
**Area:** cc
**Date:** 2026-06-16
**Depends on:** None

## Problem

worca's pipeline behaviour is governed by per-agent model and effort choices in templates
(`src/worca/templates/*/template.json` → `config.agents.<agent>.{model,effort,max_turns}`),
but there is **no objective way to measure whether one configuration is better than another**.
Today the only feedback loops are unit/integration tests with a deterministic mock Claude
(`tests/mock_claude/mock_claude.py`) — which validate *plumbing*, not model quality. There is no
golden-task corpus, no correctness oracle, and no cross-config comparison framework (confirmed: a
repo survey found "no existing eval/benchmark harness"). As a result, decisions like "Sonnet-at-high
vs Opus-at-medium for the implementer" are made on intuition, and there is no regression guard against
a template change quietly degrading task success or inflating cost.

## Proposal

Add a standalone **`worca-bench/`** subsystem at the repo root: a headless Python CLI runner that
evaluates any worca version/branch/commit against external coding benchmarks (**SWE-bench Verified**
and **Commit0**), plus a **worca-ui-style dashboard** (lit-html + Shoelace + esbuild + Express) for
launching runs and visualising results. The runner installs the pinned worca version into each cloned
benchmark repo, runs the pipeline hermetically, extracts a source-only diff, grades it with the
benchmark's own hidden-test oracle, and joins the verdict with worca's native cost/token/iteration
telemetry. Experiments are defined as reusable **profiles**; results land as append-only `results.jsonl`
under a caller-supplied `--target-dir`, which the dashboard renders.

## Design

### 1. Core principle — the runner never imports worca

- **Current state:** all worca tooling (`tests/`, `worca-ui/server/process-manager.js`) either imports
  `worca` or shells out to a single installed copy.
- **Obstacle:** requirement (1) is "evaluate *different* worca versions in one harness." A runner that
  `import worca`'d could only ever test its own installed version.
- **Resolution:** `worca-bench` is a **version-agnostic orchestrator**. For each experiment it
  provisions an isolated venv, `pip install`s the requested worca ref into it, and shells out to that
  venv's `worca` / `python -m worca.scripts.run_pipeline`. No `worca_bench` module imports `worca`.

This mirrors the existing worca-ui ↔ pipeline contract: `worca-ui/server/process-manager.js` spawns
`run_pipeline.py` as a subprocess and reads `.worca/runs/<id>/`. `worca-bench` reuses that paradigm —
the CLI is the engine, the app spawns it and reads its on-disk output.

### 2. Per-rep lifecycle (the install-into-cloned-repo flow)

For each `(instance, template, rep)` tuple the runner executes seven steps:

```
1. RESOLVE WORCA ENV   (cached by ref-hash, built once, reused)
   python -m venv  <target>/cache/venvs/<ref-hash>
   <venv>/bin/pip install "git+https://github.com/SinishaDjukic/worca-cc@<ref>"
   #   <ref> = branch | tag | commit-sha            → requirement (1)
   #   released: pip install "worca-cc==X.Y.Z"       (confirm PyPI dist name during Phase 1)

2. MATERIALIZE BASE TREE
   SWE-bench: from cached bare clone of <repo>, `git worktree add <wt> <base_commit>`
   Commit0:   `commit0 setup lite` once → repos/<lib>; copy skeleton into <wt>

3. INSTALL WORCA INTO THE TREE
   cd <wt> && <venv>/bin/worca init .          # writes .claude/worca/ (gitignored)
   seed .claude/settings.json        ← model aliases + governance + custom template (if any)
   seed .claude/settings.local.json  ← ANTHROPIC_API_KEY / per-model env (gitignored secrets)
   canary launch (see §5) on first use of each (version, template) combo

4. LAUNCH PIPELINE
   <venv>/bin/python -m worca.scripts.run_pipeline \
       --prompt "<problem_statement | commit0 spec>" \
       --template <tier:name> \                # requirement (2)
       --claude-md-mode none \                 # hermetic
       --skip-preflight \
       --run-id <profile>__<instance>__rep<N>
   # template/profile sets pr.defer:true → guardian commits locally, no PR/remote needed

5. HARVEST
   patch:     git -C <wt> diff <base> HEAD -- . ':(exclude).claude' ':(exclude).worca' <test-excludes>
   telemetry: cp <wt>/.worca/runs/<run_id>/{status.json,events.jsonl} → runs/<profile>/<instance>/repN/

6. GRADE   (batched — see §6)

7. NORMALIZE → append one row to results.jsonl ; archive artifacts ; rm worktree
```

Non-obvious constraints carried from the worca contract:

- **`worca init` copies the runtime from the *installed* package** (per dogfooding notes in CLAUDE.md),
  which is exactly why the per-version venv is mandatory — a `PYTHONPATH` shadow would not refresh the
  `.claude/worca/` runtime the pipeline executes.
- **worca scaffolding must not leak into the patch.** worca writes `.claude/` and `.worca/` into the
  tree. They should be gitignored by `init`, but the harvest diff also excludes them via `':(exclude)'`
  pathspec (belt-and-suspenders), or grading breaks.
- **The `claude` CLI is separate** — an npm/binary install, version-independent of the worca package,
  must be present + authed on the host. Only the worca *package* is version-pinned.

### 3. Grading — source-only diff on a pristine tree (unifying both benchmarks)

The agent's patch is **source-only**; the harness supplies the tests. One mental model, two plugins.

**SWE-bench Verified** (`plugins/swebench.py`):
- Materialize `git clone <repo> && git checkout <base_commit>`; `problem_statement` → the prompt
  (exclude `hints_text` for a clean eval).
- `FAIL_TO_PASS` tests arrive via `test_patch` only at grade time — never in worca's tree (clean by
  construction).
- Emit `predictions.jsonl`: `{instance_id, model_name_or_path, model_patch}`.
- Grade via **sb-cli** (zero local Docker) by default, or local `swebench.harness.run_evaluation`
  / `--modal`. Read `resolved` per instance.

**Commit0** (`plugins/commit0.py`) — the contamination decision:
- **Hide the gold tests during the run.** From `commit0 get-tests <lib>`, stash the gold-test paths out
  of worca's worktree before launch. worca sees stubs + docstrings + spec only; its TDD tester writes
  its own throwaway tests.
- **Feed the spec as a `--guide`** (normative authority) — extract the Commit0 spec PDF to text.
- **Extract a source-only diff** (exclude gold-test paths + worca's own test files).
- **Grade on a pristine checkout:** apply the source-only diff onto a fresh skeleton containing the gold
  tests → `commit0 test <lib> --branch <name>` (local Docker backend, not the Modal default). Parse the
  per-repo pass-rate (partial credit).
- **Leakage guard:** if the extracted diff touches any gold-test path, **fail the rep and log it** —
  that is reward-hacking/contamination and must be surfaced, not averaged in.
- **Optional `--allow-test-visibility`** research mode (default off) to measure the contamination gap
  once. All reported numbers use hidden.

### 4. Profiles (requirement 5)

A profile is the full reproducible experiment spec, versioned in-repo under `worca-bench/profiles/`:

```yaml
# profiles/smoke-feature-opus.yaml
name: smoke-feature-opus
benchmark: swe-bench-verified          # | commit0-lite
worca: { ref: "master" }               # branch | tag | commit | "0.58.0"
selection:
  instance_ids: [astropy__astropy-12907, django__django-11099]   # explicit
  # — or — sample: { n: 40, stratify_by: repo, seed: 13 }
template: builtin:feature               # tier:name           → requirement (2)
template_map:                           # optional per-suite override
  "django__*": project:django-tuned
reps: 5                                 # → requirement (3)
grade: { mode: sb-cli }                 # sb-cli | modal | local-docker
concurrency: { worca: 8, grade: 4 }
settings_ref: shared/models.json        # model aliases reused across profiles
```

`worca-bench run --profile smoke-feature-opus --target-dir <dir>`.

### 5. Settings-schema portability across worca versions (the second decision)

Three-layer config that minimises the version-specific surface, anchored by worca's own template-strip
rules (CLAUDE.md): when a template is in play, `worca.agents/stages/flow/loops/circuit_breaker/effort/
governance.dispatch` are **owned by the template** — exactly the schema-volatile keys.

1. **Base — version self-seeds.** Run the pinned version's own `worca init .`; never hand-author the
   full settings file.
2. **Overlay — only cross-template keys.** Inject `worca.models` (aliases) into `settings.json` and
   secrets into `settings.local.json`. The one version-sensitive bit (alias format string vs `{id,env}`,
   W-051-era) is handled by tiny **version-keyed overlays** under `worca_bench/overlays/<range>.json`.
3. **Template — carries the experiment.** The `tier:name` template holds agents/models/effort/stages/
   loops/`pr.defer`, authored for the target version.

Guards:
- **Canary before sweep.** For each `(version, template)` combo, a 1-instance launch validates the
  config loads — worca fails loud at launch and fingerprints the flow into `status.json` (W-070). A
  canary that never reaches a valid `status.json` ⇒ skip/flag that combo instead of burning the matrix.
- **Pin a supported-version floor** (~W-051/W-070 era) and record the **resolved effective config**
  (worca persists `work_request` + flow fingerprint in `status.json`) into each results row.

### 6. Telemetry capture + normalized record (requirement 4)

worca already persists everything needed in `status.json`
(`.stages.<stage>.iterations[N].{cost_usd,token_usage,effort,duration_ms,duration_api_ms,model,outcome}`,
top-level `loop_counters`) and `events.jsonl`. The runner archives those raw, then flattens **one row
per rep** for the dashboard:

```jsonc
{ "profile": "smoke-feature-opus", "benchmark": "swe-bench-verified",
  "instance_id": "astropy__astropy-12907",
  "worca_ref": "master@<sha>", "template": "builtin:feature", "rep": 3,
  "resolved": true,                          // SWE-bench bool / Commit0 pass-rate
  "cost_usd": 0.42,
  "tokens": { "input": 0, "output": 0, "by_stage": {}, "by_model": {} },
  "wall_time_s": 612, "api_time_s": 540,
  "loop_counters": { "implement_test": 2, "pr_changes": 0 },
  "stage_outcomes": { "plan": "...", "review": "approve", "pr": "success" },
  "api_retries": 1,
  "grader_report": "runs/<profile>/<instance>/rep3/grader-report.json" }
```

Append-only `results.jsonl` is the dashboard's source of truth (loads into DuckDB/pandas trivially);
raw artifacts live under `runs/<profile>/<instance>/repN/` for drill-down.

### 7. `--target-dir` on-disk contract

The CLI writes everything under `--target-dir`; the app reads from there and can spawn the CLI.

```
<target-dir>/
  cache/  repos/<repo>.git        # bare clones, shared across instances/reps
          venvs/<ref-hash>/       # pinned worca installs (req 1; reuse across reps, req 3)
          commit0/repos/<lib>/
  runs/<profile>/<instance>/repN/  diff.patch  status.json  events.jsonl  grader-report.json
  predictions/<profile>.jsonl
  results.jsonl                   # normalized rows — dashboard source of truth
```

### 8. Dashboard app (worca-ui parity)

`worca-bench/app/` (lit-html + Shoelace + esbuild) + `worca-bench/server/` (Express) mirror the
`worca-ui/app` + `worca-ui/server` structure. Every worca-ui discipline applies and is carried over:

- **lit-html** templates (heed the `attr="val"${expr}` element-binding gotcha that silently drops
  ChildParts); **Shoelace** components.
- The **badge-color-language** (`worca-ui/docs/badge-color-language.md`) and **card-layout**
  (`worca-ui/docs/card-layout.md`) specs — profile/result cards follow the 4-section `.run-card` pattern
  + a per-domain variant map (no inline `variant="success"`).
- `npm run build` (esbuild) + `biome` lint + `vitest`/playwright; the npm **`files` allowlist** check on
  every new `server/`/`app/` path.
- **Views:** profile list → run detail → compare (config-vs-config) → leaderboard.
- **Server:** `app.js` serves the app + reads `target-dir`; `process-manager.js` spawns the CLI (direct
  analogue of worca-ui's pipeline spawn); `leaderboard.js` (Phase 4) pulls public **swebench.com** and
  **commit-0.github.io/analysis** results, normalised into the `results.jsonl` shape for cross-agent
  comparison.

### 9. Grading runs in phases (efficiency + restartability)

- **Phase A (run):** execute all worca reps → collect `predictions.jsonl` + per-rep telemetry. High
  concurrency, Claude-API-bound (I/O-light).
- **Phase B (grade):** one batched grader call (sb-cli submit / `commit0 evaluate`).
- **Phase C (join):** merge grader verdict into the normalized rows.

Re-grading without re-running is cheap; a single flaky rep can be re-run by id.

## Implementation Plan

### Phase 1: CLI engine + SWE-bench via sb-cli (prove the install-into-clone loop)
**Files:** `worca-bench/pyproject.toml`, `worca_bench/{cli,runner,venvs,materialize,worca_install,harvest}.py`,
`worca_bench/plugins/swebench.py`, `worca_bench/profiles.py`, `worca_bench/overlays/`
**Tasks:**
1. Scaffold `worca-bench/` standalone package (console script `worca-bench`), excluded from the shipped worca wheel.
2. Implement venv ref-provisioning (`git+...@ref`, cached by ref-hash) + canary launch.
3. Implement materialize (bare-clone cache → per-rep worktree) + `worca init` + 3-layer settings seed.
4. Implement `run_pipeline` launch (hermetic flags) + source-only diff harvest + telemetry copy.
5. SWE-bench plugin: `predictions.jsonl` + sb-cli submit/get-report → `resolved`.
6. Prove end-to-end on 2–3 instances; validate the harness with `--predictions_path gold` first.

### Phase 2: Normalize + Commit0 plugin
**Files:** `worca_bench/normalize.py`, `worca_bench/plugins/commit0.py`
**Tasks:**
1. Normalized `results.jsonl` row writer joining grader verdict + status.json telemetry.
2. Commit0 plugin: stash gold tests, spec-as-guide, source-only diff, grade-on-pristine, pass-rate, leakage guard.
3. Profile `sample`/`stratify_by` selection; `template_map` per-suite resolution.

### Phase 3: Dashboard app + server
**Files:** `worca-bench/app/**`, `worca-bench/server/{app,process-manager}.js`, `worca-bench/package.json`
**Tasks:**
1. Express server reading `--target-dir`; spawn-the-CLI launch path.
2. lit-html + Shoelace views (profile list, run detail, compare) per badge/card specs; esbuild build.
3. vitest + a minimal playwright e2e; npm `files` allowlist verification.

### Phase 4: Online leaderboard comparison
**Files:** `worca-bench/server/leaderboard.js`, compare view
**Tasks:**
1. Pull + normalise swebench.com and commit-0 analysis results.
2. Cross-agent compare view (your configs vs public leaderboard).

### Files Changed Summary

| File | Change |
|------|--------|
| `worca-bench/pyproject.toml` | New standalone package + `worca-bench` console script |
| `worca_bench/*.py` | CLI, runner, venv provisioning, materialize, install, harvest, normalize, profiles |
| `worca_bench/plugins/{swebench,commit0}.py` | Two grader plugins |
| `worca_bench/overlays/*.json` | Version-keyed settings overlays |
| `worca-bench/profiles/*.yaml` | Experiment definitions |
| `worca-bench/app/**`, `worca-bench/server/**` | Dashboard (worca-ui stack) |
| `.gitignore` | Ignore default target-dir artifacts if checked-in locally |
| `CLAUDE.md` | New "## Config Evaluation (worca-bench)" section |

## Considerations

- **Cost.** A full 9-stage pipeline per instance is 10–50× a single-agent submission. Default to fixed
  ~30–50-instance subsets, 3–5 reps; shake out the adapter on SWE-bench Lite / a 5-instance smoke first.
- **Host arch.** Neither benchmark grades reliably on macOS/Apple Silicon. worca runs (API-bound) run
  anywhere; SWE-bench + Commit0 grading uses x86-Linux Docker — or sidesteps it via sb-cli/Modal.
- **Settings portability** is the main tax on testing old versions; mitigated by the 3-layer config +
  canary + a pinned version floor (§5).
- **Contamination** handled by hidden-tests + source-only-diff-on-pristine + the leakage guard (§3).
- **Breaking changes:** none — `worca-bench/` is additive and standalone; it does not modify the
  pipeline, hooks, or the shipped wheel.
- **Migration:** none.
- **Governance:** the runner shells out to worca as an external process; it is not a pipeline agent and
  bypasses no governance. Secrets stay in `settings.local.json`, never inlined.

## Test Plan

### Unit Tests
| Layer | Test | Validates |
|-------|------|-----------|
| Python | `test_venvs_caches_by_ref` | Same ref reuses venv; different ref rebuilds |
| Python | `test_harvest_excludes_worca_scaffolding` | Diff omits `.claude/`/`.worca/` |
| Python | `test_commit0_leakage_guard_fails_on_test_edit` | Rep fails if diff touches gold-test path |
| Python | `test_settings_overlay_minimal_seed` | Only model aliases + secrets injected |
| Python | `test_normalize_row_schema` | Row carries cost/tokens/loops/outcome/resolved |
| Python | `test_profile_sample_stratify_deterministic` | Same seed ⇒ same instance set |
| JS (vitest) | `compare-view.test.js` | Config-vs-config aggregation renders |

### Integration / E2E Tests
- Mock-Claude SWE-bench instance: full lifecycle (materialize → init → run → diff → predictions →
  stub grader) produces a valid `results.jsonl` row — **free, deterministic plumbing check**.
- Canary path: a deliberately incompatible `(version, template)` combo is flagged + skipped, not run.
- Playwright: dashboard loads a fixture `target-dir`, renders profile list + run detail.

### Existing Tests to Update
- None expected — additive subsystem. Add a CI job (or doc note) for the `worca-bench` package so its
  tests run; do not couple it to the main `worca` test matrix (different install model).

## Files to Create/Modify

| Path | Action |
|------|--------|
| `worca-bench/pyproject.toml` | Create |
| `worca-bench/worca_bench/{cli,runner,venvs,materialize,worca_install,harvest,normalize,profiles}.py` | Create |
| `worca-bench/worca_bench/plugins/{swebench,commit0}.py` | Create |
| `worca-bench/worca_bench/overlays/*.json` | Create |
| `worca-bench/profiles/*.yaml` | Create |
| `worca-bench/app/**`, `worca-bench/server/**`, `worca-bench/package.json` | Create |
| `CLAUDE.md` | Add worca-bench section |
| `.gitignore` | Ignore local target-dir artifacts |

## Out of Scope

- **SWE-Lancer, Multi-SWE-bench, and private workspace/feature corpora** — deliberately deferred;
  SWE-Lancer in particular is a separate heavy-infra go/no-go (TB disk, full-app-boot + Playwright).
- **Automated config *search*/optimization** (grid/Bayesian sweeps). worca-bench measures and compares;
  it does not auto-tune templates. A sweep driver can sit on top later.
- **Per-stage credit attribution beyond ablation** — the benchmark emits one score per run; attributing
  a win to a specific agent's knob is done by ablation profiles, not by decomposing the score.
- **Hosting/publishing the dashboard** — it runs locally like worca-ui; no deployment target.
