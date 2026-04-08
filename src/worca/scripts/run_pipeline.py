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
    parser.add_argument("--template", help="Template ID to apply before running")
    parser.add_argument("--param", action="append", metavar="KEY=VALUE",
                        help="Template parameter override (repeatable)")
    return parser


def _parse_params(param_list):
    """Parse a list of KEY=VALUE strings into a dict.

    Raises SystemExit(2) if any item lacks an '=' separator.
    Returns {} when param_list is None or empty.
    """
    if not param_list:
        return {}
    result = {}
    for item in param_list:
        if "=" not in item:
            print(f"error: --param must be KEY=VALUE format, got: {item!r}", file=sys.stderr)
            raise SystemExit(2)
        key, _, value = item.partition("=")
        result[key] = value
    return result


def _make_template_resolver(settings_path: str):
    """Create a TemplateResolver with standard tier dirs relative to settings_path."""
    from worca.orchestrator.templates import TemplateResolver
    builtin_dir = Path(__file__).parent.parent / "templates"
    # settings_path is typically .claude/settings.json; project root is two levels up
    project_root = Path(settings_path).resolve().parent.parent
    project_dir = project_root / ".claude" / "templates"
    user_dir = Path.home() / ".worca" / "templates"
    return TemplateResolver(builtin_dir, project_dir, user_dir)


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

    # Template application: resolve, deep-merge config, prepare temp settings file
    _template_id = args.template
    _params = {}
    _merged_settings = None
    _temp_settings_path = None
    _resolver = None

    if _template_id:
        import tempfile
        from worca.orchestrator.templates import TemplateError

        _params = _parse_params(args.param or [])

        try:
            with open(args.settings) as f:
                _current_settings = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            _current_settings = {}

        _current_worca = _current_settings.get("worca", {})
        _resolver = _make_template_resolver(args.settings)

        try:
            _merged_worca = _resolver.apply(_template_id, _current_worca, _params)
        except TemplateError as e:
            print(f"error: template '{_template_id}': {e}", file=sys.stderr)
            raise SystemExit(2)

        # If template has an agents/ dir, store it in settings for overlay use
        _tmpl = _resolver.get(_template_id)
        if _tmpl and _tmpl.agents_dir:
            _merged_worca["_template_agents_dir"] = _tmpl.agents_dir

        _merged_settings = {**_current_settings, "worca": _merged_worca}
        _tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
        json.dump(_merged_settings, _tmp, indent=2)
        _tmp.close()
        _temp_settings_path = _tmp.name

        print(f"  Template: {_template_id}")

    effective_settings_path = _temp_settings_path if _template_id else args.settings

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
            settings_path=effective_settings_path,
            status_path=effective_status_path,
            msize=args.msize,
            mloops=args.mloops,
            branch=args.branch,
            skip_preflight=args.skip_preflight,
            worktree=args.worktree,
        )

        # Snapshot template to run dir and write merged settings for traceability
        if _template_id and _resolver and status.get("run_id"):
            run_dir = os.path.join(args.status_dir, "runs", status["run_id"])
            try:
                _resolver.snapshot_to_run(_template_id, run_dir, _params)
            except Exception as snap_err:
                print(f"warning: template snapshot failed: {snap_err}", file=sys.stderr)
            if _merged_settings:
                try:
                    Path(run_dir, "settings.json").write_text(
                        json.dumps(_merged_settings, indent=2)
                    )
                except OSError:
                    pass

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
    finally:
        if _temp_settings_path:
            try:
                os.unlink(_temp_settings_path)
            except OSError:
                pass


if __name__ == "__main__":
    main()
