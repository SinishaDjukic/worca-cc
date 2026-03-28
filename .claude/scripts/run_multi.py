# /// script
# requires-python = ">=3.8"
# ///
"""Run multiple work requests in parallel using git worktrees.

Each request gets its own worktree with isolated .worca/ and .beads/ directories.
Pipelines are tracked in the registry for monitoring.

Usage:
    python .claude/scripts/run_multi.py \
        --requests "Add auth" "Add search" \
        --max-parallel 3

    python .claude/scripts/run_multi.py \
        --sources gh:issue:1 gh:issue:2
"""
import argparse
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from worca.orchestrator.registry import (
    deregister_pipeline,
    reconcile_stale,
    register_pipeline,
    update_pipeline,
)
from worca.orchestrator.work_request import normalize
from worca.utils.claude_cli import _ARG_INLINE_LIMIT
from worca.utils.git import (
    create_pipeline_worktree,
    init_worktree_beads,
    remove_pipeline_worktree,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _generate_run_id() -> str:
    """Generate a unique run ID.

    Format: YYYYMMDD-HHMMSS-mmm-xxxx  (same scheme as runner.py).
    """
    now = datetime.now(timezone.utc)
    millis = now.microsecond // 1000
    suffix = secrets.token_hex(2)
    return f"{now.strftime('%Y%m%d-%H%M%S')}-{millis:03d}-{suffix}"


def _slugify(title: str) -> str:
    """Convert a title to a filesystem-safe slug."""
    name = title.lower().strip()
    name = re.sub(r"[^a-z0-9\-]", "-", name)
    name = re.sub(r"-+", "-", name)
    return name.strip("-")[:30]


def _load_parallel_settings(settings_path: str) -> dict:
    """Load worca.parallel settings, returning dict with defaults."""
    defaults = {
        "max_concurrent_pipelines": 3,
        "default_base_branch": "main",
        "cleanup_policy": "on-success",
        "worktree_base_dir": ".worktrees",
    }
    try:
        with open(settings_path) as f:
            settings = json.load(f)
        parallel = settings.get("worca", {}).get("parallel", {})
        defaults.update(parallel)
    except (OSError, json.JSONDecodeError):
        pass
    return defaults


# ---------------------------------------------------------------------------
# Subprocess worker
# ---------------------------------------------------------------------------


def _run_pipeline_in_worktree(
    worktree_path: str,
    prompt: str,
    msize: int,
    mloops: int,
    settings: str,
) -> dict:
    """Run a pipeline in a worktree subprocess. Returns result dict."""
    prompt_file = None
    cmd = [sys.executable, ".claude/scripts/run_pipeline.py", "--worktree"]

    if len(prompt.encode("utf-8", errors="replace")) > _ARG_INLINE_LIMIT:
        fd, prompt_file = tempfile.mkstemp(prefix="worca_prompt_", suffix=".md")
        with os.fdopen(fd, "w") as f:
            f.write(prompt)
        cmd.extend(["--prompt-file", prompt_file])
    else:
        cmd.extend(["--prompt", prompt])

    cmd.extend([
        "--msize", str(msize),
        "--mloops", str(mloops),
        "--settings", settings,
    ])

    env = os.environ.copy()
    env.pop("CLAUDECODE", None)  # prevent nested session detection

    try:
        result = subprocess.run(
            cmd,
            cwd=worktree_path,
            capture_output=True,
            text=True,
            env=env,
        )
    finally:
        if prompt_file:
            try:
                os.unlink(prompt_file)
            except OSError:
                pass

    return {
        "worktree": worktree_path,
        "prompt": prompt,
        "returncode": result.returncode,
        "stdout": result.stdout[-2000:] if result.stdout else "",
        "stderr": result.stderr[-1000:] if result.stderr else "",
    }


# ---------------------------------------------------------------------------
# Results persistence
# ---------------------------------------------------------------------------


def _save_results(results: list[dict], elapsed: float) -> str:
    """Save results to .worca/multi/results-{timestamp}.json. Returns path."""
    results_dir = os.path.join(".worca", "multi")
    os.makedirs(results_dir, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = os.path.join(results_dir, f"results-{timestamp}.json")

    payload = {
        "timestamp": timestamp,
        "elapsed_seconds": round(elapsed, 1),
        "total": len(results),
        "succeeded": sum(1 for r in results if r.get("returncode") == 0),
        "failed": sum(1 for r in results if r.get("returncode") != 0),
        "pipelines": results,
    }
    with open(path, "w") as f:
        json.dump(payload, f, indent=2)
        f.write("\n")
    return path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def create_parser() -> argparse.ArgumentParser:
    """Build the argument parser for run_multi."""
    parser = argparse.ArgumentParser(
        description="Run multiple worca-cc pipelines in parallel using git worktrees"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--requests", nargs="+",
        help="Text prompts for work requests",
    )
    group.add_argument(
        "--sources", nargs="+",
        help="Source references (gh:issue:42, bd:bd-abc)",
    )

    parser.add_argument(
        "--max-parallel", type=int, default=None,
        help="Max concurrent pipelines (default: from settings or 3)",
    )
    parser.add_argument(
        "--base-branch", type=str, default=None,
        help="Base branch for worktrees (default: from settings or 'main')",
    )
    parser.add_argument(
        "--cleanup",
        choices=["on-success", "always", "never"],
        default=None,
        help="Cleanup policy for worktrees (default: from settings or 'on-success')",
    )
    parser.add_argument(
        "--msize", type=int, default=1, choices=range(1, 11),
        metavar="[1-10]",
        help="Task size multiplier for max_turns (default: 1)",
    )
    parser.add_argument(
        "--mloops", type=int, default=1, choices=range(1, 11),
        metavar="[1-10]",
        help="Loop multiplier for max iterations (default: 1)",
    )
    parser.add_argument(
        "--settings", default=".claude/settings.json",
        help="Path to settings.json",
    )
    return parser


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    """Entry point. Returns exit code (0 = all succeeded, 1 = some failed)."""
    parser = create_parser()
    args = parser.parse_args(argv)

    # Load settings for defaults
    parallel_settings = _load_parallel_settings(args.settings)

    max_parallel = args.max_parallel or parallel_settings["max_concurrent_pipelines"]
    base_branch = args.base_branch or parallel_settings["default_base_branch"]
    cleanup_policy = args.cleanup or parallel_settings["cleanup_policy"]

    # 1. Reconcile stale pipelines from previous runs
    stale = reconcile_stale()
    if stale:
        print(f"Reconciled {len(stale)} stale pipeline(s): {', '.join(stale)}")

    # 2. Normalize work requests
    if args.requests:
        items = [(p, normalize("prompt", p)) for p in args.requests]
    else:
        items = [(s, normalize("source", s)) for s in args.sources]

    print(f"Launching {len(items)} parallel pipeline(s) (max {max_parallel} concurrent)")
    if args.msize > 1:
        print(f"  Size multiplier: {args.msize}x turns")
    if args.mloops > 1:
        print(f"  Loop multiplier: {args.mloops}x loops")
    print(f"  Base branch: {base_branch}")
    print(f"  Cleanup policy: {cleanup_policy}")

    # 3. Create worktrees and register pipelines
    pipelines = []  # list of dicts with run_id, worktree_path, title, prompt
    for raw_input, wr in items:
        run_id = _generate_run_id()
        slug = _slugify(wr.title)
        worktree_path = create_pipeline_worktree(run_id, slug, base_branch)
        if not worktree_path:
            print(f"  FAILED to create worktree for: {wr.title}", file=sys.stderr)
            continue

        # Init beads in the worktree
        init_worktree_beads(worktree_path)

        prompt = wr.description or wr.title
        pipeline_info = {
            "run_id": run_id,
            "worktree_path": worktree_path,
            "title": wr.title,
            "prompt": prompt,
        }

        # Register in multi-pipeline registry
        register_pipeline(
            run_id=run_id,
            worktree_path=worktree_path,
            title=wr.title,
            pid=os.getpid(),
        )

        pipelines.append(pipeline_info)
        print(f"  Created: {worktree_path} (run_id={run_id})")

    if not pipelines:
        print("No pipelines to run.", file=sys.stderr)
        return 1

    # 4. Launch parallel pipelines
    results = []
    start_time = time.time()

    with ThreadPoolExecutor(max_workers=max_parallel) as executor:
        futures = {}
        for pi in pipelines:
            future = executor.submit(
                _run_pipeline_in_worktree,
                pi["worktree_path"],
                pi["prompt"],
                args.msize,
                args.mloops,
                args.settings,
            )
            futures[future] = pi

        for future in as_completed(futures):
            pi = futures[future]
            try:
                result = future.result()
                rc = result["returncode"]
                status = "OK" if rc == 0 else "FAILED"
                print(f"  [{status}] {pi['title']}")

                # Update registry
                reg_status = "succeeded" if rc == 0 else "failed"
                update_pipeline(pi["run_id"], status=reg_status)

                result["run_id"] = pi["run_id"]
                result["title"] = pi["title"]
                result["worktree"] = pi["worktree_path"]
                results.append(result)

            except Exception as e:
                print(f"  [ERROR] {pi['title']}: {e}")
                update_pipeline(pi["run_id"], status="failed")
                results.append({
                    "run_id": pi["run_id"],
                    "worktree": pi["worktree_path"],
                    "title": pi["title"],
                    "prompt": pi["prompt"],
                    "returncode": -1,
                    "error": str(e),
                })

    elapsed = time.time() - start_time

    # 5. Summary
    succeeded = sum(1 for r in results if r.get("returncode") == 0)
    failed = len(results) - succeeded
    print(f"\nCompleted in {elapsed:.0f}s: {succeeded} succeeded, {failed} failed")

    # Print summary table
    print(f"\n{'Title':<40} {'Status':<10} {'Run ID'}")
    print("-" * 80)
    for r in results:
        status = "OK" if r.get("returncode") == 0 else "FAILED"
        title = r.get("title", r.get("prompt", "???"))[:38]
        run_id = r.get("run_id", "???")
        print(f"  {title:<38} {status:<10} {run_id}")

    # 6. Apply cleanup policy
    for r in results:
        worktree_path = r.get("worktree", "")
        run_id = r.get("run_id", "")
        rc = r.get("returncode", -1)

        should_remove = False
        if cleanup_policy == "always":
            should_remove = True
        elif cleanup_policy == "on-success" and rc == 0:
            should_remove = True
        # "never" -> never remove

        if should_remove and worktree_path:
            if remove_pipeline_worktree(worktree_path):
                deregister_pipeline(run_id)
                print(f"  Cleaned up: {worktree_path}")
            else:
                print(f"  Failed to clean up: {worktree_path}")

    # 7. Save results
    results_path = _save_results(results, elapsed)
    print(f"\nResults saved to {results_path}")

    return 1 if failed > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
