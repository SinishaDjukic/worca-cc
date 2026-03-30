# /// script
# requires-python = ">=3.8"
# ///
"""Run a single work request through the worca-cc pipeline."""
import argparse
import json
import sys
import os
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from worca.orchestrator.work_request import normalize, WorkRequest
from worca.orchestrator.runner import run_pipeline, LoopExhaustedError, PipelineError
from worca.state.status import load_status
from worca.utils.gh_issues import gh_issue_fail


def create_parser():
    """Create the argument parser for the pipeline CLI."""
    parser = argparse.ArgumentParser(description="Run worca-cc pipeline")
    parser.add_argument("--prompt", help="Text prompt for work request")
    parser.add_argument("--source", help="Source reference (gh:issue:42, bd:bd-abc)")
    parser.add_argument("--spec", help="Path to spec file")
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
    parser.add_argument("--skip-preflight", action="store_true",
                        help="Skip the PREFLIGHT stage (useful when environment is known-good)")
    parser.add_argument("--prompt-file",
                        help="Read prompt from file instead of --prompt (for large prompts "
                             "that would exceed ARG_MAX). The file is deleted after reading.")
    parser.add_argument("--worktree", action="store_true",
                        help="Worktree mode: skip branch creation and register in multi-pipeline registry")
    return parser


def build_work_request(args):
    """Validate args and build a WorkRequest with prompt merging.

    Validation:
    - --source and --spec are mutually exclusive
    - At least one of --prompt/--source/--spec/--plan is required

    Prompt merging: when --prompt accompanies a source/spec/plan,
    it is appended as '## Additional Instructions' to the description.
    """
    # Validation: --source and --spec are mutually exclusive
    if args.source and args.spec:
        print("error: --source and --spec are mutually exclusive", file=sys.stderr)
        raise SystemExit(2)

    # Validation: at least one arg required
    if not any([args.prompt, args.source, args.spec, args.plan]):
        print("error: at least one of --prompt, --source, --spec, or --plan is required",
              file=sys.stderr)
        raise SystemExit(2)

    # Normalize: source/spec/plan take priority, prompt-only is fallback
    has_primary = args.source or args.spec or args.plan
    if args.source:
        work_request = normalize("source", args.source)
    elif args.spec:
        work_request = normalize("spec", args.spec)
    elif args.plan:
        work_request = normalize("plan", args.plan)
    else:
        work_request = normalize("prompt", args.prompt)

    # Prompt merging: append as Additional Instructions when prompt
    # accompanies a primary source
    if args.prompt and has_primary:
        if work_request.description:
            work_request.description += f"\n\n## Additional Instructions\n\n{args.prompt}"
        else:
            work_request.description = f"## Additional Instructions\n\n{args.prompt}"

    return work_request


def main():
    parser = create_parser()
    args = parser.parse_args()

    # --prompt-file: read prompt from file and delete it
    if args.prompt_file:
        if args.prompt:
            print("error: --prompt and --prompt-file are mutually exclusive", file=sys.stderr)
            raise SystemExit(2)
        # Validate path is inside the system temp directory
        import tempfile
        real_path = os.path.realpath(args.prompt_file)
        temp_dir = os.path.realpath(tempfile.gettempdir())
        if not real_path.startswith(temp_dir + os.sep):
            print(f"error: --prompt-file must be inside {temp_dir}", file=sys.stderr)
            raise SystemExit(2)
        try:
            with open(args.prompt_file) as f:
                args.prompt = f.read()
        except FileNotFoundError:
            print(f"error: prompt file not found: {args.prompt_file}", file=sys.stderr)
            raise SystemExit(2)
        try:
            os.unlink(args.prompt_file)
        except OSError:
            pass

    if args.resume:
        # Resume: load work_request from existing status.json instead of building from args
        # Check active_run pointer first, then fall back to flat status.json
        active_run_path = os.path.join(args.status_dir, "active_run")
        if os.path.exists(active_run_path):
            active_id = Path(active_run_path).read_text().strip()
            if os.sep in active_id or '/' in active_id or '..' in active_id:
                print(f"error: invalid active_run ID: {active_id}", file=sys.stderr)
                raise SystemExit(2)
            status_file = os.path.join(args.status_dir, "runs", active_id, "status.json")
        else:
            status_file = os.path.join(args.status_dir, "status.json")
        if os.path.exists(status_file):
            existing = load_status(status_file)
            wr = existing.get("work_request", {})
            work_request = WorkRequest(
                source_type=wr.get("source_type", "prompt"),
                title=wr.get("title", "Resumed pipeline"),
                description=wr.get("description", ""),
                source_ref=wr.get("source_ref"),
                priority=wr.get("priority", 2),
                plan_path=wr.get("plan_path"),
            )
        else:
            print(f"error: cannot resume — status file not found: {status_file}", file=sys.stderr)
            raise SystemExit(2)
        plan_file = args.plan
        print(f"Resuming pipeline: {work_request.title}")
    else:
        work_request = build_work_request(args)

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
    if args.worktree:
        print("  Worktree mode: skipping branch creation, registering in multi-pipeline registry")
    if args.skip_preflight:
        print("  Skipping preflight checks")

    try:
        # For resume, always use default .worca/status.json so runner derives
        # worca_dir correctly and finds the run via active_run pointer.
        if args.resume:
            effective_status_path = ".worca/status.json"
        else:
            effective_status_path = os.path.join(args.status_dir, "status.json")
        status = run_pipeline(
            work_request,
            plan_file=plan_file,
            resume=args.resume,
            settings_path=args.settings,
            status_path=effective_status_path,
            msize=args.msize,
            mloops=args.mloops,
            branch=args.branch,
            skip_preflight=args.skip_preflight,
            worktree=args.worktree,
        )
        print(json.dumps(status, indent=2))
    except LoopExhaustedError as e:
        print(f"Loop exhausted: {e}", file=sys.stderr)
        try:
            status = load_status(os.path.join(args.status_dir, "status.json"))
            gh_issue_fail(status, error=str(e))
        except Exception:
            pass
        sys.exit(1)
    except PipelineError as e:
        print(f"Pipeline error: {e}", file=sys.stderr)
        try:
            status = load_status(os.path.join(args.status_dir, "status.json"))
            gh_issue_fail(status, error=str(e))
        except Exception:
            pass
        sys.exit(2)


if __name__ == "__main__":
    main()
