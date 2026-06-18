"""worca-bench CLI (W-075).

    worca-bench run    --profile NAME --target-dir DIR [--dry-run] [--no-canary]
    worca-bench list   [--profiles-dir DIR]
    worca-bench stats  --target-dir DIR [--profile NAME]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .config import EngineConfig, GradeConfig, Profile, find_profile, load_profile
from .normalize import read_rows, rewrite_rows
from .runner import _artifacts_rel, _now, run_profile
from .stats import aggregate, aggregate_by_profile


def _default_profile_dirs(target_dir: Path | None) -> list[Path]:
    dirs: list[Path] = []
    if target_dir:
        dirs.append(Path(target_dir) / "profiles")
    dirs.append(Path.cwd() / "profiles")
    # in-tree profiles shipped with worca-bench
    dirs.append(Path(__file__).resolve().parents[1] / "profiles")
    return [d for d in dirs if d.exists()]


# CLI flag → secret env-var name. These let an operator pass grader credentials
# at launch instead of exporting them; the dashboard server forwards the same
# values (held only in the browser) via the subprocess env, never argv.
_SECRET_FLAGS = {
    "swebench_api_key": "SWEBENCH_API_KEY",
    "modal_token_id": "MODAL_TOKEN_ID",
    "modal_token_secret": "MODAL_TOKEN_SECRET",
}


def _add_secret_flags(p: argparse.ArgumentParser) -> None:
    p.add_argument("--swebench-api-key", metavar="KEY",
                   help="sb-cli (hosted SWE-bench) API key; overrides $SWEBENCH_API_KEY")
    p.add_argument("--modal-token-id", metavar="ID",
                   help="Modal token id; overrides $MODAL_TOKEN_ID")
    p.add_argument("--modal-token-secret", metavar="SECRET",
                   help="Modal token secret; overrides $MODAL_TOKEN_SECRET")


def _cli_secret_env(args: argparse.Namespace) -> dict[str, str]:
    """Secrets supplied as CLI flags (None when absent), keyed by env-var name."""
    return {
        env: getattr(args, attr)
        for attr, env in _SECRET_FLAGS.items()
        if getattr(args, attr, None)
    }


def _resolve_profile(name_or_path: str, target_dir: Path | None,
                     profiles_dir: str | None) -> Profile:
    p = Path(name_or_path)
    if p.exists():
        return load_profile(p)
    search = []
    if profiles_dir:
        search.append(Path(profiles_dir))
    search.extend(_default_profile_dirs(target_dir))
    return find_profile(name_or_path, search)


def cmd_run(args: argparse.Namespace) -> int:
    target = Path(args.target_dir)
    profile = _resolve_profile(args.profile, target, args.profiles_dir)
    # Per-run override of the profile's reps (e.g. from the UI launch controls).
    reps_override = getattr(args, "reps", None)
    if reps_override is not None:
        if reps_override < 1:
            print("--reps must be >= 1", file=sys.stderr)
            return 2
        profile.reps = reps_override
    # Per-run override of worca-pipeline parallelism (UI "Max parallel" control,
    # maps to concurrency.worca — the ThreadPoolExecutor width in the runner).
    parallel_override = getattr(args, "max_parallel", None)
    if parallel_override is not None:
        if parallel_override < 1:
            print("--max-parallel must be >= 1", file=sys.stderr)
            return 2
        profile.concurrency.worca = parallel_override
    # Code-graph engines: a CLI flag enables the engine (and sets its mode),
    # overriding the profile. Absent flag => leave the profile's setting (off by
    # default). graphify mode is validated; CRG mode passes through.
    gfx = getattr(args, "graphify", None)
    if gfx is not None:
        if gfx not in ("structural", "full"):
            print("--graphify mode must be 'structural' or 'full'", file=sys.stderr)
            return 2
        profile.graphify = EngineConfig(enabled=True, mode=gfx)
    crg = getattr(args, "code_review_graph", None)
    if crg is not None:
        profile.code_review_graph = EngineConfig(enabled=True, mode=crg)
    # Preflight on/off override (UI Run option). Preflight is where graphify/CRG
    # graphs build, so an engine sweep needs it ON; the hermetic default is OFF.
    pf = getattr(args, "preflight", None)
    if pf is not None:
        profile.skip_preflight = (pf == "off")
    # CLAUDE.md load mode override (UI dropdown; default hermetic 'none').
    cmm = getattr(args, "claude_md_mode", None)
    if cmm is not None:
        profile.claude_md_mode = cmm
    # Canary on/off override (UI Run option). The profile's `canary` flag is the
    # default; an explicit `--canary on|off` overrides it, and `--no-canary` is a
    # back-compat alias for off. This is resolved into `canary_first` below.
    canary = profile.canary
    cf = getattr(args, "canary", None)
    if cf is not None:
        canary = (cf == "on")
    if getattr(args, "no_canary", False):
        canary = False
    # Grade backend override (UI Run options dropdown). Absent => profile default.
    # Validated against the benchmark's supported set (commit0 has no sb-cli).
    gm = getattr(args, "grade_mode", None)
    if gm is not None:
        from .config import valid_grade_modes
        allowed = valid_grade_modes(profile.benchmark)
        if gm not in allowed:
            print(f"--grade-mode {gm!r} is not valid for benchmark "
                  f"{profile.benchmark!r}; use one of {sorted(allowed)}",
                  file=sys.stderr)
            return 2
        profile.grade.mode = gm
    # Per-build timeout override (UI Run option / CLI). A non-negative int wins over
    # the profile; 0 (or any non-positive) means no limit (unbounded build).
    to = getattr(args, "timeout", None)
    if to is not None:
        profile.timeout = to if to > 0 else None
    # Benchmark cache (HF datasets / repo mirrors): flag wins, else env, else None.
    cache_dir = getattr(args, "cache_dir", None) or os.environ.get("WORCA_BENCH_CACHE")
    # Grader credentials: environment + CLI-flag overlay (allowlist-enforced).
    from .worca_install import collect_secret_env
    secret_env = collect_secret_env(extra=_cli_secret_env(args))

    # Activity-dock ledger: the CLI owns its own lifecycle so a run launched from
    # the CLI / cron / CI shows up in the dock just like a UI-launched one. The
    # source dir (= the result dir) lets the server backfill `src`. Skipped for
    # dry-run (nothing actually executes).
    from . import actions
    action_id = None
    if not args.dry_run:
        action_id = actions.start(
            target, kind="run", profile=profile.name, source_dir=target,
            params={
                "reps": profile.reps,
                "max_instances": args.max_instances,
                "timeout": profile.timeout,
            },
        )

    def _progress(*, done, total, errors):
        actions.progress(target, action_id, done=done, total=total, errors=errors)

    try:
        summary = run_profile(
            profile, target,
            dry_run=args.dry_run,
            canary_first=canary,
            max_instances=args.max_instances,
            keep_work=args.keep_work,
            cache_dir=Path(cache_dir) if cache_dir else None,
            secret_env=secret_env,
            progress_cb=(_progress if action_id else None),
        )
    except BaseException as e:  # noqa: BLE001 - record terminal state then re-raise
        if action_id:
            actions.finish(target, action_id, status="failed", error=str(e))
        raise
    if action_id:
        actions.finish(
            target, action_id, status="completed",
            progress={
                "unit": "instances", "done": len(summary.results),
                "total": summary.reps_total, "errors": summary.reps_error,
            },
        )
    if args.dry_run:
        print(f"[dry-run] profile={summary.profile} worca={summary.worca_ref} "
              f"reps={summary.reps_total}")
    else:
        print(json.dumps(summary.as_dict(), indent=2))
        if summary.incompatible_templates:
            print("\nincompatible templates (skipped):", file=sys.stderr)
            for t, why in summary.incompatible_templates.items():
                print(f"  {t}: {why}", file=sys.stderr)
    return 0


def cmd_list(args: argparse.Namespace) -> int:
    dirs = []
    if args.profiles_dir:
        dirs.append(Path(args.profiles_dir))
    dirs.extend(_default_profile_dirs(None))
    seen: set[str] = set()
    for d in dirs:
        for f in sorted(d.glob("*.y*ml")):
            try:
                prof = load_profile(f)
            except Exception as e:  # noqa: BLE001
                print(f"  ! {f.name}: {e}", file=sys.stderr)
                continue
            if prof.name in seen:
                continue
            seen.add(prof.name)
            print(f"  {prof.name:30s} {prof.benchmark:20s} reps={prof.reps} "
                  f"worca={prof.worca.ref} template={prof.template}")
    if not seen:
        print("(no profiles found)")
    return 0


def cmd_regrade(args: argparse.Namespace) -> int:
    """Re-grade saved diffs for a profile without re-running the pipeline.

    Reads each rep's persisted ``diff.patch`` from its artifacts dir, grades it
    with the chosen backend (``--mode``, default = the profile's grade mode), and
    rewrites the matching ``results.jsonl`` rows in place. Decouples grading from
    the expensive agent run so a grading-env failure (or a backend switch, e.g.
    local-docker → sb-cli) never costs another pipeline.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    from .plugins import get_plugin
    from .plugins.base import GradeResult, Instance, Prepared
    from .regrade_status import write_status
    from .worca_install import collect_secret_env

    target = Path(args.target_dir)
    profile = _resolve_profile(args.profile, target, args.profiles_dir)
    mode = args.mode or profile.grade.mode
    grade_cfg = GradeConfig(mode=mode, options=dict(profile.grade.options))
    plugin = get_plugin(profile)
    secret_env = collect_secret_env(extra=_cli_secret_env(args))

    rows = read_rows(target)
    sel = [r for r in rows if r.get("profile") == profile.name]
    if args.only_errors:
        sel = [r for r in sel if r.get("status") == "error"]
    if args.instance:
        want = set(args.instance)
        sel = [r for r in sel if r.get("instance_id") in want]
    if not sel:
        print("no matching rows to regrade", file=sys.stderr)
        return 1

    # Full instances carry the per-benchmark grading metadata a bare Instance(id=)
    # lacks — notably the commit0 config block (base_dir/config_file), local_repo, and
    # gold_test_paths, without which commit0 grading errors ("needs the 'commit0'
    # config block"). Enrich from the instances_file when the profile has one (commit0
    # always does; SWE-bench may). No file => bare instance, since id-keyed graders
    # (SWE-bench sb-cli/docker) need only the id.
    instances_by_id: dict[str, Instance] = {}
    if profile.selection.instances_file:
        try:
            instances_by_id = {i.id: i for i in plugin.load_instances(profile)}
        except Exception:  # noqa: BLE001 - never let instance-load failure abort regrade
            instances_by_id = {}

    def _regrade_one(row: dict):
        iid = row["instance_id"]
        rep = row.get("rep")
        art = row.get("artifacts_dir") or _artifacts_rel(profile.name, iid, rep)
        diff_path = target / art / "diff.patch"
        if not diff_path.exists():
            return iid, rep, GradeResult(status="error",
                                         detail=f"no diff.patch at {diff_path}")
        diff = diff_path.read_text(encoding="utf-8")
        inst = instances_by_id.get(iid) or Instance(id=iid, prompt="")
        try:
            gr = plugin.grade(inst, diff, target, target, grade_cfg,
                              prepared=Prepared(base_commit=""), secret_env=secret_env)
        except Exception as e:  # noqa: BLE001 - one rep failing must not kill regrade
            gr = GradeResult(status="error", detail=f"regrade error: {e}")
        return iid, rep, gr

    # Sequential mode grades one rep at a time — used by the dashboard "Regrade
    # All" so a 20-instance Modal sweep doesn't fire 20 harness builds at once.
    workers = 1 if getattr(args, "sequential", False) else max(1, profile.concurrency.grade)
    total = len(sel)
    counts = {"graded": 0, "resolved": 0, "error": 0}
    started = _now()

    # Activity-dock ledger (CLI-first): the regrade records its own lifecycle so a
    # CLI/cron-launched sweep shows up in the dock too. The regrade-status.json
    # heartbeat below still powers the per-profile detail block.
    from . import actions
    action_id = actions.start(
        target, kind="regrade", profile=profile.name, source_dir=target,
        params={"mode": mode, "instance": getattr(args, "instance", None),
                "only_errors": bool(getattr(args, "only_errors", False))},
    )

    def _hb(done: int, current: str | None, status: str = "running") -> None:
        # Best-effort progress heartbeat — never let a status-write failure abort
        # an in-flight (expensive) grade.
        try:
            write_status(target, profile.name, mode=mode, total=total, done=done,
                         current=current, counts=counts, status=status,
                         started_at=started, updated_at=_now())
        except OSError:
            pass
        if status == "running":
            actions.progress(target, action_id, done=done, total=total,
                             errors=counts["error"], unit="regraded")

    def _record(gr: GradeResult) -> None:
        if gr.status == "graded":
            counts["graded"] += 1
            if gr.resolved:
                counts["resolved"] += 1
        else:
            counts["error"] += 1

    def _print_one(iid: str, rep, gr: GradeResult) -> None:
        if gr.status == "graded":
            print(f"  {iid} rep{rep}: graded resolved={gr.resolved}", flush=True)
        else:
            print(f"  {iid} rep{rep}: {gr.status} ({(gr.detail or '')[:80]})", flush=True)

    def _apply(iid: str, rep, gr: GradeResult) -> None:
        # Write THIS row immediately so the dashboard reflects progress as it
        # happens (and a mid-sweep crash never loses completed verdicts).
        when = _now()

        def _m(row: dict) -> bool:
            if (row.get("profile") != profile.name
                    or row.get("instance_id") != iid or row.get("rep") != rep):
                return False
            row["status"] = gr.status
            row["resolved"] = gr.resolved
            row["score"] = gr.score
            row["error"] = gr.detail if gr.status == "error" else None
            row["grade_mode"] = mode
            row["grade_detail"] = gr.detail
            row["report_path"] = gr.report_path
            row["regraded_at"] = when
            row["graded_at"] = when
            return True

        rewrite_rows(target, _m)

    try:
        if workers == 1:
            _hb(0, sel[0]["instance_id"])
            for i, row in enumerate(sel):
                iid, rep = row["instance_id"], row.get("rep")
                _hb(i, iid)  # i completed; now grading iid
                _iid, _rep, gr = _regrade_one(row)
                _record(gr)
                _apply(iid, rep, gr)
                _print_one(iid, rep, gr)
        else:
            _hb(0, None)
            done = 0
            with ThreadPoolExecutor(max_workers=workers) as ex:
                futs = [ex.submit(_regrade_one, r) for r in sel]
                for fut in as_completed(futs):
                    iid, rep, gr = fut.result()
                    _record(gr)
                    _apply(iid, rep, gr)
                    done += 1
                    _hb(done, None)
                    _print_one(iid, rep, gr)
        _hb(total, None, status="done")
    except BaseException as e:  # noqa: BLE001 - record terminal state then re-raise
        _hb(counts["graded"] + counts["error"], None, status="error")
        actions.finish(target, action_id, status="failed", error=str(e))
        raise
    actions.finish(
        target, action_id, status="completed",
        progress={"unit": "regraded", "done": total, "total": total,
                  "errors": counts["error"]},
    )

    print(f"\nregraded {total} rows via {mode}: {counts['graded']} graded "
          f"({counts['resolved']} resolved), {counts['error']} error")
    return 0


def cmd_commit0_gen(args: argparse.Namespace) -> int:
    """Set up a Commit0 split and write its instances file (the input a commit0
    profile's ``selection.instances_file`` points at)."""
    from .commit0_gen import generate_instances

    base_dir = Path(args.base_dir)
    out_path = Path(args.out)
    records = generate_instances(
        args.split,
        base_dir=base_dir,
        out_path=out_path,
        config_file=Path(args.config_file) if args.config_file else None,
        dataset_name=args.dataset_name,
        dataset_split=args.dataset_split,
        base_branch=args.base_branch,
        run_setup=not args.skip_setup,
    )
    print(json.dumps({"instances": len(records), "out": str(out_path),
                      "libs": [r["lib"] for r in records]}, indent=2))
    return 0


def cmd_stats(args: argparse.Namespace) -> int:
    rows = read_rows(Path(args.target_dir))
    if args.profile:
        rows = [r for r in rows if r.get("profile") == args.profile]
        print(json.dumps({args.profile: aggregate(rows)}, indent=2))
    else:
        print(json.dumps(aggregate_by_profile(rows), indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="worca-bench", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_run = sub.add_parser("run", help="run a profile")
    p_run.add_argument("--profile", required=True, help="profile name or path")
    p_run.add_argument("--target-dir", required=True, help="dir for clones/results/artifacts")
    p_run.add_argument("--profiles-dir", help="extra dir to search for profiles")
    p_run.add_argument("--dry-run", action="store_true", help="resolve + plan, do not run")
    p_run.add_argument(
        "--canary", choices=["on", "off"],
        help="run the per-template canary or skip it; overrides the profile's canary flag")
    p_run.add_argument("--no-canary", action="store_true",
                       help="back-compat alias for --canary off")
    p_run.add_argument("--max-instances", type=int, help="cap instances (smoke runs)")
    p_run.add_argument("--max-parallel", type=int,
                       help="override pipeline parallelism for this run (concurrency.worca)")
    p_run.add_argument("--reps", type=int, help="override the profile's reps for this run")
    p_run.add_argument(
        "--timeout", type=int, metavar="SECONDS",
        help="per-instance build timeout in seconds (0 = no limit); overrides the profile")
    p_run.add_argument("--cache-dir", help="benchmark cache dir (HF datasets / repo mirrors)")
    p_run.add_argument(
        "--graphify", nargs="?", const="structural", metavar="MODE",
        help="enable graphify (mode: structural|full; default structural)",
    )
    p_run.add_argument(
        "--code-review-graph", "--crg", nargs="?", const="structural", metavar="MODE",
        dest="code_review_graph",
        help="enable code-review-graph (mode passthrough; default structural)",
    )
    p_run.add_argument("--keep-work", action="store_true", help="keep per-rep worktrees")
    p_run.add_argument(
        "--preflight", choices=["on", "off"],
        help="run preflight (builds graphify/CRG graphs) or skip it; overrides the profile")
    p_run.add_argument(
        "--claude-md-mode", dest="claude_md_mode",
        choices=["none", "project", "project+local", "all"],
        help="CLAUDE.md load mode for the run; overrides the profile")
    p_run.add_argument(
        "--grade-mode", dest="grade_mode",
        choices=["stub", "sb-cli", "local-docker", "modal"],
        help="grade backend for the run; overrides the profile's grade.mode")
    _add_secret_flags(p_run)
    p_run.set_defaults(func=cmd_run)

    p_list = sub.add_parser("list", help="list available profiles")
    p_list.add_argument("--profiles-dir", help="extra dir to search for profiles")
    p_list.set_defaults(func=cmd_list)

    p_regrade = sub.add_parser(
        "regrade", help="re-grade saved diffs for a profile (no pipeline re-run)")
    p_regrade.add_argument("--profile", required=True, help="profile name or path")
    p_regrade.add_argument("--target-dir", required=True, help="dir holding results/runs")
    p_regrade.add_argument("--profiles-dir", help="extra dir to search for profiles")
    p_regrade.add_argument(
        "--mode", choices=["sb-cli", "local-docker", "modal", "stub"],
        help="grade backend (default: the profile's grade mode)")
    p_regrade.add_argument(
        "--only-errors", action="store_true",
        help="re-grade only rows currently marked error (e.g. stranded by a grading-env failure)")
    p_regrade.add_argument(
        "--instance", action="append", metavar="ID",
        help="limit to specific instance id(s); repeatable")
    p_regrade.add_argument(
        "--sequential", action="store_true",
        help="grade one rep at a time (ignore concurrency.grade) — e.g. a whole-profile Modal sweep")
    _add_secret_flags(p_regrade)
    p_regrade.set_defaults(func=cmd_regrade)

    p_c0 = sub.add_parser(
        "commit0-gen",
        help="set up a Commit0 split and write its instances file (for a commit0 profile)")
    p_c0.add_argument("split", help="Commit0 split or single library name (e.g. wcwidth, lite, all)")
    p_c0.add_argument("--base-dir", required=True, help="dir to clone Commit0 repos into")
    p_c0.add_argument("--out", required=True, help="path to write the instances JSON")
    p_c0.add_argument("--config-file", help="commit0 dot-file path (default: <base-dir>/../.commit0.yaml)")
    p_c0.add_argument("--dataset-name", default="wentingzhao/commit0_combined",
                      help="HuggingFace dataset name")
    p_c0.add_argument("--dataset-split", default="test", help="HuggingFace dataset split")
    p_c0.add_argument("--base-branch", default="commit0",
                      help="skeleton branch commit0 setup checks out (default: commit0)")
    p_c0.add_argument("--skip-setup", action="store_true",
                      help="skip `commit0 setup` (repos already cloned under --base-dir)")
    p_c0.set_defaults(func=cmd_commit0_gen)

    p_stats = sub.add_parser("stats", help="aggregate results.jsonl")
    p_stats.add_argument("--target-dir", required=True)
    p_stats.add_argument("--profile", help="limit to one profile")
    p_stats.set_defaults(func=cmd_stats)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
