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

from .config import EngineConfig, Profile, find_profile, load_profile
from .normalize import read_rows
from .runner import run_profile
from .stats import aggregate, aggregate_by_profile


def _default_profile_dirs(target_dir: Path | None) -> list[Path]:
    dirs: list[Path] = []
    if target_dir:
        dirs.append(Path(target_dir) / "profiles")
    dirs.append(Path.cwd() / "profiles")
    # in-tree profiles shipped with worca-bench
    dirs.append(Path(__file__).resolve().parents[1] / "profiles")
    return [d for d in dirs if d.exists()]


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
    # Benchmark cache (HF datasets / repo mirrors): flag wins, else env, else None.
    cache_dir = getattr(args, "cache_dir", None) or os.environ.get("WORCA_BENCH_CACHE")
    summary = run_profile(
        profile, target,
        dry_run=args.dry_run,
        canary_first=not args.no_canary,
        max_instances=args.max_instances,
        keep_work=args.keep_work,
        cache_dir=Path(cache_dir) if cache_dir else None,
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
    p_run.add_argument("--no-canary", action="store_true", help="skip the per-template canary")
    p_run.add_argument("--max-instances", type=int, help="cap instances (smoke runs)")
    p_run.add_argument("--max-parallel", type=int,
                       help="override pipeline parallelism for this run (concurrency.worca)")
    p_run.add_argument("--reps", type=int, help="override the profile's reps for this run")
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
    p_run.set_defaults(func=cmd_run)

    p_list = sub.add_parser("list", help="list available profiles")
    p_list.add_argument("--profiles-dir", help="extra dir to search for profiles")
    p_list.set_defaults(func=cmd_list)

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
