# /// script
# requires-python = ">=3.8"
# ///
"""Run worca-cc pipeline across multiple project directories in parallel.

Each project gets its own independent pipeline run. A shared guide/spec
file is prepended to the prompt so every agent receives the same
migration instructions while working in its own project codebase.

Usage:
    python .claude/scripts/run_multi_project.py \
        --projects /path/to/svc-a /path/to/svc-b /path/to/svc-c \
        --guide migration-guide.md \
        --prompt "Migrate from Spring Boot 3.2 to 4.0.3"

    python .claude/scripts/run_multi_project.py \
        --projects-file projects.txt \
        --guide migration-guide.md \
        --prompt "Migrate from Spring Boot 3.2 to 4.0.3"
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Directory where worca-cc lives (parent of scripts/)
WORCA_CC_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _ensure_claude_dir(project_dir: str) -> None:
    """Ensure the project has .claude/ with worca pipeline files.

    Creates a symlink from project/.claude -> worca-cc/.claude if the
    project doesn't already have a .claude directory with the pipeline.
    """
    target_claude = os.path.join(project_dir, ".claude")
    pipeline_marker = os.path.join(target_claude, "worca")

    if os.path.exists(pipeline_marker):
        return  # Already has worca pipeline

    if os.path.exists(target_claude):
        # .claude exists but without worca — copy worca-specific dirs into it
        for subdir in ("worca", "agents", "scripts", "hooks", "skills"):
            src = os.path.join(WORCA_CC_ROOT, subdir)
            dst = os.path.join(target_claude, subdir)
            if os.path.isdir(src) and not os.path.exists(dst):
                os.symlink(src, dst)
        # Copy settings.json if missing
        src_settings = os.path.join(WORCA_CC_ROOT, "settings.json")
        dst_settings = os.path.join(target_claude, "settings.json")
        if os.path.isfile(src_settings) and not os.path.exists(dst_settings):
            shutil.copy2(src_settings, dst_settings)
        return

    # No .claude at all — symlink the entire directory
    os.symlink(WORCA_CC_ROOT, target_claude)


def _build_prompt(prompt: str, guide_content: str = None, project_dir: str = None) -> str:
    """Build the full prompt combining guide + user prompt + project context."""
    parts = []
    if guide_content:
        parts.append("## Reference Guide\n\n" + guide_content)
    if project_dir:
        project_name = os.path.basename(os.path.normpath(project_dir))
        parts.append(f"## Target Project\n\nProject: {project_name}\nPath: {project_dir}")
    parts.append("## Task\n\n" + prompt)
    return "\n\n---\n\n".join(parts)


def _run_pipeline_in_project(
    project_dir: str,
    prompt: str,
    msize: int,
    mloops: int,
    settings: str,
    guide_content: str = None,
    plan_file: str = None,
    branch: str = None,
) -> dict:
    """Run a pipeline in a project directory. Returns result dict."""
    # Ensure .claude/ is available in the project
    _ensure_claude_dir(project_dir)

    full_prompt = _build_prompt(prompt, guide_content, project_dir)

    cmd = [
        sys.executable, ".claude/scripts/run_pipeline.py",
        "--prompt", full_prompt,
        "--msize", str(msize),
        "--mloops", str(mloops),
        "--settings", settings,
    ]
    if plan_file:
        cmd.extend(["--plan", plan_file])
    if branch:
        cmd.extend(["--branch", branch])

    env = os.environ.copy()
    env.pop("CLAUDECODE", None)

    project_name = os.path.basename(os.path.normpath(project_dir))
    start_time = time.time()

    result = subprocess.run(
        cmd,
        cwd=project_dir,
        capture_output=True,
        text=True,
        env=env,
    )

    elapsed = time.time() - start_time

    return {
        "project": project_name,
        "project_dir": project_dir,
        "returncode": result.returncode,
        "elapsed_seconds": round(elapsed, 1),
        "stdout": result.stdout[-2000:] if result.stdout else "",
        "stderr": result.stderr[-1000:] if result.stderr else "",
    }


def _read_projects_file(path: str) -> list:
    """Read project directories from a file (one per line, # comments allowed)."""
    projects = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                expanded = os.path.expanduser(line)
                if os.path.isdir(expanded):
                    projects.append(os.path.abspath(expanded))
                else:
                    print(f"Warning: skipping non-existent directory: {line}", file=sys.stderr)
    return projects


def _format_duration(seconds: float) -> str:
    if seconds < 60:
        return f"{seconds:.0f}s"
    m, s = divmod(int(seconds), 60)
    if m < 60:
        return f"{m}m {s}s"
    h, m = divmod(m, 60)
    return f"{h}h {m}m {s}s"


def main():
    parser = argparse.ArgumentParser(
        description="Run worca-cc pipeline across multiple projects in parallel"
    )

    # Project selection
    proj_group = parser.add_mutually_exclusive_group(required=True)
    proj_group.add_argument("--projects", nargs="+",
                            help="Project directory paths")
    proj_group.add_argument("--projects-file",
                            help="File with project paths (one per line)")

    # Work input
    parser.add_argument("--prompt", required=True,
                        help="Prompt describing the work to do in each project")
    parser.add_argument("--guide",
                        help="Path to guide/spec markdown file (shared across all projects)")
    parser.add_argument("--plan",
                        help="Path to pre-made plan file (shared across all projects)")

    # Tuning
    parser.add_argument("--settings", default=".claude/settings.json",
                        help="Path to settings.json (default: .claude/settings.json)")
    parser.add_argument("--msize", type=int, default=1, choices=range(1, 11),
                        metavar="[1-10]",
                        help="Task size multiplier (default: 1)")
    parser.add_argument("--mloops", type=int, default=1, choices=range(1, 11),
                        metavar="[1-10]",
                        help="Loop multiplier (default: 1)")
    parser.add_argument("--max-parallel", type=int, default=5,
                        help="Max concurrent pipelines (default: 5)")
    parser.add_argument("--branch",
                        help="Branch name template (project name appended)")

    # Output
    parser.add_argument("--output-dir", default=".worca-multi",
                        help="Directory for multi-project results (default: .worca-multi)")

    args = parser.parse_args()

    # Resolve project directories
    if args.projects:
        projects = []
        for p in args.projects:
            expanded = os.path.expanduser(p)
            if not os.path.isdir(expanded):
                print(f"Error: not a directory: {p}", file=sys.stderr)
                sys.exit(1)
            projects.append(os.path.abspath(expanded))
    else:
        projects = _read_projects_file(args.projects_file)
        if not projects:
            print("Error: no valid project directories found", file=sys.stderr)
            sys.exit(1)

    # Read guide file if provided
    guide_content = None
    if args.guide:
        guide_path = os.path.abspath(args.guide)
        if not os.path.isfile(guide_path):
            print(f"Error: guide file not found: {args.guide}", file=sys.stderr)
            sys.exit(1)
        with open(guide_path) as f:
            guide_content = f.read()

    # Resolve plan file
    plan_file = None
    if args.plan:
        plan_file = os.path.abspath(args.plan)

    print(f"Multi-project pipeline: {len(projects)} projects, max {args.max_parallel} parallel")
    print(f"  Prompt: {args.prompt[:80]}{'...' if len(args.prompt) > 80 else ''}")
    if guide_content:
        print(f"  Guide: {args.guide} ({len(guide_content)} chars)")
    if args.msize > 1:
        print(f"  Size multiplier: {args.msize}x")
    if args.mloops > 1:
        print(f"  Loop multiplier: {args.mloops}x")
    print()

    for i, p in enumerate(projects, 1):
        print(f"  [{i}] {os.path.basename(p)} -> {p}")
    print()

    # Create output directory
    os.makedirs(args.output_dir, exist_ok=True)

    # Save run manifest
    manifest = {
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "prompt": args.prompt,
        "guide_file": args.guide,
        "projects": [{"name": os.path.basename(p), "path": p} for p in projects],
        "msize": args.msize,
        "mloops": args.mloops,
        "max_parallel": args.max_parallel,
        "results": [],
    }

    # Launch parallel pipelines
    results = []
    start_time = time.time()

    with ProcessPoolExecutor(max_workers=args.max_parallel) as executor:
        futures = {}
        for project_dir in projects:
            project_name = os.path.basename(os.path.normpath(project_dir))
            branch = None
            if args.branch:
                branch = f"{args.branch}/{project_name}"

            future = executor.submit(
                _run_pipeline_in_project,
                project_dir,
                args.prompt,
                args.msize,
                args.mloops,
                args.settings,
                guide_content=guide_content,
                plan_file=plan_file,
                branch=branch,
            )
            futures[future] = (project_dir, project_name)

        for future in as_completed(futures):
            project_dir, project_name = futures[future]
            try:
                result = future.result()
                status = "OK" if result["returncode"] == 0 else "FAILED"
                elapsed = _format_duration(result["elapsed_seconds"])
                print(f"  [{status}] {project_name} ({elapsed})")
                if result["returncode"] != 0 and result["stderr"]:
                    # Show last line of stderr for failed runs
                    last_line = result["stderr"].strip().split("\n")[-1]
                    print(f"         {last_line}")
                results.append(result)
            except Exception as e:
                print(f"  [ERROR] {project_name}: {e}")
                results.append({
                    "project": project_name,
                    "project_dir": project_dir,
                    "returncode": -1,
                    "error": str(e),
                })

    total_elapsed = time.time() - start_time

    # Summary
    succeeded = sum(1 for r in results if r.get("returncode") == 0)
    failed = len(results) - succeeded
    print(f"\nCompleted in {_format_duration(total_elapsed)}: "
          f"{succeeded} succeeded, {failed} failed out of {len(results)} projects")

    # Save results
    manifest["results"] = results
    manifest["completed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    manifest["total_elapsed_seconds"] = round(total_elapsed, 1)
    manifest["succeeded"] = succeeded
    manifest["failed"] = failed

    results_path = os.path.join(args.output_dir, "results.json")
    with open(results_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"Results saved to {results_path}")

    sys.exit(1 if failed > 0 else 0)


if __name__ == "__main__":
    main()
