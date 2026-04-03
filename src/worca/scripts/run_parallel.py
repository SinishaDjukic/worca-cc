# /// script
# requires-python = ">=3.8"
# ///
"""Run multiple work requests in parallel using git worktrees.

Each request gets its own worktree and branch, running an independent
pipeline instance. All pipelines execute concurrently.

Usage:
    python .claude/scripts/run_parallel.py \
        --prompts "Add auth" "Add search" "Add dashboard" \
        --msize 2 --mloops 2

    python .claude/scripts/run_parallel.py \
        --sources gh:issue:1 gh:issue:2 gh:issue:3
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor, as_completed

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from worca.orchestrator.work_request import normalize
from worca.utils.claude_cli import _ARG_INLINE_LIMIT


def _slugify(title: str) -> str:
    """Convert a title to a filesystem-safe slug."""
    name = title.lower().strip()
    name = re.sub(r'[^a-z0-9\-]', '-', name)
    name = re.sub(r'-+', '-', name)
    return name.strip('-')[:30]


def _create_worktree(base_dir: str, slug: str, branch: str) -> str:
    """Create a git worktree and return its path."""
    worktree_path = os.path.join(base_dir, slug)
    if os.path.exists(worktree_path):
        return worktree_path  # reuse existing

    result = subprocess.run(
        ["git", "worktree", "add", "-b", branch, worktree_path],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        # Branch may already exist, try without -b
        result = subprocess.run(
            ["git", "worktree", "add", worktree_path, branch],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(f"Failed to create worktree: {result.stderr}")
    return worktree_path


def _run_pipeline_in_worktree(
    worktree_path: str,
    prompt: str,
    msize: int,
    mloops: int,
    settings: str,
) -> dict:
    """Run a pipeline in a worktree subprocess. Returns result dict."""
    prompt_file = None
    cmd = [sys.executable, ".claude/scripts/run_pipeline.py"]

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
        # Safety net: run_pipeline.py deletes the file after reading, but
        # if it crashes before that point this ensures cleanup.  The second
        # unlink is a no-op (OSError caught) — intentional double-delete.
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


def _cleanup_worktree(worktree_path: str) -> None:
    """Remove a git worktree."""
    subprocess.run(
        ["git", "worktree", "remove", worktree_path, "--force"],
        capture_output=True, text=True,
    )


def main():
    parser = argparse.ArgumentParser(
        description="Run multiple worca-cc pipelines in parallel using git worktrees"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--prompts", nargs="+", help="Text prompts for work requests")
    group.add_argument("--sources", nargs="+",
                       help="Source references (gh:issue:42, bd:bd-abc)")
    parser.add_argument("--settings", default=".claude/settings.json",
                        help="Path to settings.json")
    parser.add_argument("--msize", type=int, default=1, choices=range(1, 11),
                        metavar="[1-10]",
                        help="Task size multiplier for max_turns (default: 1)")
    parser.add_argument("--mloops", type=int, default=1, choices=range(1, 11),
                        metavar="[1-10]",
                        help="Loop multiplier for max iterations (default: 1)")
    parser.add_argument("--worktree-dir", default=".worktrees",
                        help="Directory for worktrees (default: .worktrees)")
    parser.add_argument("--max-parallel", type=int, default=5,
                        help="Max concurrent pipelines (default: 5)")
    parser.add_argument("--cleanup", action="store_true",
                        help="Remove worktrees after completion")

    args = parser.parse_args()

    # Build work request list
    if args.prompts:
        items = [(p, normalize("prompt", p)) for p in args.prompts]
    else:
        items = [(s, normalize("source", s)) for s in args.sources]

    print(f"Launching {len(items)} parallel pipelines (max {args.max_parallel} concurrent)")
    if args.msize > 1:
        print(f"  Size multiplier: {args.msize}x turns")
    if args.mloops > 1:
        print(f"  Loop multiplier: {args.mloops}x loops")

    # Create worktrees
    os.makedirs(args.worktree_dir, exist_ok=True)
    worktrees = []
    for raw_input, wr in items:
        slug = _slugify(wr.title)
        branch = f"worca/{slug}"
        worktree_path = _create_worktree(args.worktree_dir, slug, branch)
        worktrees.append((worktree_path, raw_input, wr))
        print(f"  Created: {worktree_path} -> {branch}")

    # Launch parallel pipelines
    results = []
    start_time = time.time()

    with ProcessPoolExecutor(max_workers=args.max_parallel) as executor:
        futures = {}
        for worktree_path, raw_input, wr in worktrees:
            prompt = wr.description or wr.title
            future = executor.submit(
                _run_pipeline_in_worktree,
                worktree_path,
                prompt,
                args.msize,
                args.mloops,
                args.settings,
            )
            futures[future] = (worktree_path, wr.title)

        for future in as_completed(futures):
            worktree_path, title = futures[future]
            try:
                result = future.result()
                status = "OK" if result["returncode"] == 0 else "FAILED"
                print(f"  [{status}] {title}")
                results.append(result)
            except Exception as e:
                print(f"  [ERROR] {title}: {e}")
                results.append({
                    "worktree": worktree_path,
                    "prompt": title,
                    "returncode": -1,
                    "error": str(e),
                })

    elapsed = time.time() - start_time

    # Summary
    succeeded = sum(1 for r in results if r.get("returncode") == 0)
    failed = len(results) - succeeded
    print(f"\nCompleted in {elapsed:.0f}s: {succeeded} succeeded, {failed} failed")

    # Save summary
    summary_path = os.path.join(args.worktree_dir, "parallel-results.json")
    with open(summary_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"Results saved to {summary_path}")

    # Cleanup if requested
    if args.cleanup:
        print("Cleaning up worktrees...")
        for worktree_path, _, _ in worktrees:
            _cleanup_worktree(worktree_path)
            print(f"  Removed: {worktree_path}")

    sys.exit(1 if failed > 0 else 0)


if __name__ == "__main__":
    main()
