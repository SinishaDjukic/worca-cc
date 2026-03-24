# /// script
# requires-python = ">=3.8"
# ///
"""Run a single work request through the worca-cc pipeline."""
import argparse
import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from worca.orchestrator.work_request import normalize
from worca.orchestrator.runner import run_pipeline, LoopExhaustedError, PipelineError


def main():
    parser = argparse.ArgumentParser(description="Run worca-cc pipeline")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--prompt", help="Text prompt for work request")
    group.add_argument("--source", help="Source reference (gh:issue:42, bd:bd-abc)")
    group.add_argument("--spec", help="Path to spec file")
    parser.add_argument("--settings", default=".claude/settings.json",
                        help="Path to settings.json")
    parser.add_argument("--status-dir", default=".worca",
                        help="Directory for pipeline status files")
    parser.add_argument("--msize", type=int, default=1, choices=range(1, 11),
                        metavar="[1-10]",
                        help="Task size multiplier for max_turns per stage (default: 1)")
    parser.add_argument("--mloops", type=int, default=1, choices=range(1, 11),
                        metavar="[1-10]",
                        help="Loop multiplier for max loop iterations (default: 1)")
    parser.add_argument("--plan", help="Path to pre-made plan file (skips PLAN stage)")
    parser.add_argument("--resume", action="store_true",
                        help="Resume a previous run from status.json instead of starting fresh")
    parser.add_argument("--branch", help="Use an existing branch instead of creating a new one")
    parser.add_argument("--project-dir",
                        help="Run pipeline in this project directory instead of cwd")
    parser.add_argument("--guide",
                        help="Path to guide/spec markdown file (prepended to prompt)")

    args = parser.parse_args()

    # Change to project directory if specified
    if args.project_dir:
        project_dir = os.path.abspath(args.project_dir)
        if not os.path.isdir(project_dir):
            print(f"Error: not a directory: {args.project_dir}", file=sys.stderr)
            sys.exit(1)
        os.chdir(project_dir)

    # Read and prepend guide file if specified
    guide_content = None
    if args.guide:
        guide_path = os.path.abspath(args.guide) if not os.path.isabs(args.guide) else args.guide
        if not os.path.isfile(guide_path):
            print(f"Error: guide file not found: {args.guide}", file=sys.stderr)
            sys.exit(1)
        with open(guide_path) as f:
            guide_content = f.read()

    # Normalize input to WorkRequest
    if args.prompt:
        work_request = normalize("prompt", args.prompt)
        # When --plan is also provided, read the plan file as the description
        if args.plan and os.path.isfile(args.plan):
            with open(args.plan) as f:
                work_request.description = f.read()
    elif args.spec:
        work_request = normalize("spec", args.spec)
    elif args.source:
        work_request = normalize("source", args.source)

    # Prepend guide content to work request description
    if guide_content:
        if work_request.description:
            work_request.description = (
                "## Reference Guide\n\n" + guide_content
                + "\n\n---\n\n## Task\n\n" + work_request.description
            )
        else:
            work_request.description = (
                "## Reference Guide\n\n" + guide_content
                + "\n\n---\n\n## Task\n\n" + work_request.title
            )

    # Resolve plan: explicit --plan wins, then auto-detected from issue body
    plan_file = args.plan or work_request.plan_path

    print(f"Starting pipeline: {work_request.title}")
    if plan_file and args.plan:
        print(f"  Pre-made plan: {plan_file} (skipping PLAN stage)")
    elif plan_file:
        print(f"  Auto-detected plan from issue: {plan_file} (skipping PLAN stage)")
    if args.msize > 1:
        print(f"  Size multiplier: {args.msize}x turns")
    if args.mloops > 1:
        print(f"  Loop multiplier: {args.mloops}x loops")
    if args.branch:
        print(f"  Using existing branch: {args.branch}")

    try:
        status = run_pipeline(
            work_request,
            plan_file=plan_file,
            resume=args.resume,
            settings_path=args.settings,
            status_path=os.path.join(args.status_dir, "status.json"),
            msize=args.msize,
            mloops=args.mloops,
            branch=args.branch,
        )
        print(json.dumps(status, indent=2))
    except LoopExhaustedError as e:
        print(f"Loop exhausted: {e}", file=sys.stderr)
        sys.exit(1)
    except PipelineError as e:
        print(f"Pipeline error: {e}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
