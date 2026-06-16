# worca-bench

Config-evaluation harness for worca pipelines (**W-075**). Measures whether one
pipeline configuration (per-agent model/effort, template, worca version) beats another
on real coding benchmarks — **SWE-bench Verified** and **Commit0** — joining the
benchmark's correctness oracle with worca's native cost/token/iteration telemetry.

It is a **version-agnostic orchestrator**: it never imports worca. For each experiment
it provisions an isolated venv, `pip install`s the requested worca ref, and shells out
to that venv's pipeline — so you can compare any branch/tag/commit/version in one run.

## Layout

```
worca_bench/            # headless Python engine (the runner)
  cli.py                # worca-bench run | list | stats
  runner.py             # per-rep lifecycle + sweep + canary
  venvs.py              # worca ref provisioning (req 1)
  worca_install.py      # worca init + 3-layer settings seed (req 5 portability)
  templates.py          # tier:name resolution (req 2)
  launcher.py           # spawn run_pipeline (real or mock Claude)
  harvest.py            # source-only diff + telemetry parse
  normalize.py          # results.jsonl rows (req 4)
  stats.py              # aggregate by profile
  plugins/{swebench,commit0}.py
app/  server/  bin/     # worca-ui-style dashboard (lit-html + Shoelace + Express)
profiles/               # example experiment definitions (req 5)
```

## Quick start

```bash
pip install -e worca-bench            # or: pip install -e ".[dev]" from worca-bench/

# Smoke a profile for free with the mock Claude (no API spend, deterministic):
#   set mock: true in the profile, grade.mode: stub
worca-bench run --profile swebench-feature-opus --target-dir ./out --dry-run
worca-bench run --profile swebench-feature-opus --target-dir ./out --max-instances 1

worca-bench list                       # available profiles
worca-bench stats --target-dir ./out   # aggregate results.jsonl

# Dashboard (worca-ui stack):
cd worca-bench && npm install && npm run build
node bin/worca-bench-ui.js --target-dir ../out      # http://127.0.0.1:3500
```

## How a rep runs (per instance × rep)

1. **Resolve worca env** — venv per ref, cached (`local` uses the current env for tests/dev).
2. **Materialize** the base tree (clone @ base_commit; Commit0 skeleton).
3. **Install worca** — `worca init` + minimal settings overlay (model aliases; secrets to
   `settings.local.json`); the template carries the experiment.
4. **Launch** the pipeline hermetically (`--claude-md-mode none --skip-preflight`, `pr.defer`).
5. **Harvest** a source-only diff (excludes `.claude/`, `.worca/`, `MASTER_PLAN.md`, gold tests)
   + telemetry from `status.json`.
6. **Grade** — `stub` (plumbing), `sb-cli`/`modal`/`local-docker` (SWE-bench), `local-docker` (Commit0).
7. **Normalize** → append one row to `<target-dir>/results.jsonl`; archive artifacts.

A **canary** runs each template once before the sweep and skips configs a worca version
rejects (fail-fast). The **Commit0 leakage guard** fails any rep whose diff touches a
gold-test path.

## `--target-dir` contract (CLI writes, dashboard reads)

```
<target-dir>/
  cache/{repos,venvs,commit0}/      results.jsonl        # dashboard source of truth
  runs/<profile>/<instance>/repN/   predictions/<profile>.jsonl
```

## Testing

```bash
cd worca-bench && python -m pytest tests/ -q          # unit + mock-Claude e2e
cd worca-bench && python -m pytest -m "not live_worca" # unit only (no worca spawn)
cd worca-bench && npx vitest run && npx playwright test --workers=1
```

The e2e (`tests/test_e2e_mock.py`) spawns a **real** worca pipeline driven by the repo's
mock Claude — free and deterministic. It self-skips if the worca-cc source repo isn't found.

See `docs/plans/W-075-worca-bench.md` for the full design.
