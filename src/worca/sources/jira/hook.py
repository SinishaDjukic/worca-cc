"""Worca → Jira write-back hook.

Subscribes to terminal pipeline events via ``worca.hooks`` config and posts a
single aggregated report comment to the originating Jira ticket via the
``jtr`` CLI. Fires once per run on one of:

    pipeline.run.completed
    pipeline.run.failed
    pipeline.run.interrupted
    pipeline.run.cancelled

All other event types (start, pr_created, budget_warning, stage events …) are
no-ops — their data is folded into the terminal report via a scan of
``events.jsonl`` ($WORCA_EVENTS_PATH).

Wire-up in ``.claude/settings.json``::

    "worca": {
      "hooks": {
        "pipeline.run.completed":   ["python -m worca.sources.jira.hook"],
        "pipeline.run.failed":      ["python -m worca.sources.jira.hook"],
        "pipeline.run.interrupted": ["python -m worca.sources.jira.hook"],
        "pipeline.run.cancelled":   ["python -m worca.sources.jira.hook"]
      },
      "sources": {"jira": {"write_back": true}}
    }

Reads the event JSON from stdin. Bails silently (exit 0) for non-Jira
sources, ``write_back: false``, the ``WORCA_JIRA_DISABLED=1`` mute, malformed
events, or non-terminal event types. Posts via
``jtr comment <KEY> -y "<body>"`` with ``cwd=$WORCA_PROJECT_ROOT`` so the
per-repo ``./.jtr/`` config is found even when the pipeline runs inside a
worktree. Never raises — fire-and-forget contract of
``dispatch_shell_hooks``.

Report shape: a human-readable header for ticket readers, followed by a JSON
appendix (``worca-report/v1``) inside a fenced code block for downstream
tooling. Parsers should locate the fenced block whose info-string is
``json worca-report/v1`` and read JSON up to the closing fence.
"""
import json
import os
import subprocess
import sys

from worca.utils.env import get_env
from worca.utils.settings import load_settings


REPORT_SCHEMA = "worca-report/v1"
REPORT_FILENAME = "jira-report.md"

_TERMINAL_EVENTS = {
    "pipeline.run.completed",
    "pipeline.run.failed",
    "pipeline.run.interrupted",
    "pipeline.run.cancelled",
}

_STATUS_BY_EVENT = {
    "pipeline.run.completed": "completed",
    "pipeline.run.failed": "failed",
    "pipeline.run.interrupted": "interrupted",
    "pipeline.run.cancelled": "cancelled",
}

_STATUS_HEADER_GLYPH = {
    "completed": "✅ COMPLETED",
    "failed": "❌ FAILED",
    "interrupted": "⚠ INTERRUPTED",
    "cancelled": "⏹ CANCELLED",
}


def _human_duration(ms) -> str:
    if not isinstance(ms, (int, float)) or ms < 0:
        return "?"
    secs = int(ms) // 1000
    if secs < 60:
        return f"{secs}s"
    mins, s = divmod(secs, 60)
    if mins < 60:
        return f"{mins}m {s}s"
    hours, m = divmod(mins, 60)
    return f"{hours}h {m}m"


def _read_events(events_path) -> list:
    """Read all events from $WORCA_EVENTS_PATH, skipping unparseable lines.

    Returns [] if path is missing or unreadable — callers must handle the
    empty case (the terminal event still carries enough data for a minimal
    report).
    """
    if not events_path or not os.path.isfile(events_path):
        return []
    out = []
    try:
        with open(events_path, "r") as f:
            for line in f:
                try:
                    out.append(json.loads(line))
                except (json.JSONDecodeError, ValueError):
                    continue
    except OSError:
        return []
    return out


def _aggregate(terminal_event: dict, prior_events: list) -> dict:
    """Build the structured report dict from terminal + prior events.

    The terminal event is the one currently on stdin; prior_events is the
    full events.jsonl contents (which may or may not already contain the
    terminal event itself — we ignore the duplicate if it's there).
    """
    payload = terminal_event.get("payload") or {}
    pipeline = terminal_event.get("pipeline") or {}
    wr = pipeline.get("work_request") or {}
    status = _STATUS_BY_EVENT[terminal_event["event_type"]]

    started_at = None
    plan_file = None
    pr = None
    warnings = []

    for ev in prior_events:
        et = ev.get("event_type")
        p = ev.get("payload") or {}
        if et == "pipeline.run.started":
            started_at = p.get("started_at") or started_at
            plan_file = p.get("plan_file") or plan_file
        elif et == "pipeline.git.pr_created":
            pr = {
                "url": p.get("pr_url"),
                "number": p.get("pr_number"),
                "title": p.get("title"),
                "commit_sha": p.get("commit_sha"),
                "source_branch": p.get("source_branch"),
                "target_branch": p.get("target_branch"),
            }
        elif et == "pipeline.cost.budget_warning":
            warnings.append({
                "event": "cost.budget_warning",
                "timestamp": ev.get("timestamp"),
                "total_cost_usd": p.get("total_cost_usd"),
                "budget_usd": p.get("budget_usd"),
                "pct_used": p.get("pct_used"),
            })

    # duration / elapsed key varies per terminal event
    duration_ms = payload.get("duration_ms") or payload.get("elapsed_ms")

    report = {
        "schema": REPORT_SCHEMA,
        "run_id": terminal_event.get("run_id"),
        "status": status,
        "source_ref": wr.get("source_ref"),
        "branch": pipeline.get("branch"),
        "started_at": started_at,
        "finished_at": terminal_event.get("timestamp"),
        "duration_ms": duration_ms,
        "stages_completed": payload.get("stages_completed") or [],
        "cost_usd": payload.get("total_cost_usd"),
        "total_turns": payload.get("total_turns"),
        "total_tokens": payload.get("total_tokens"),
        "plan_file": plan_file,
        "pr": pr,
        "warnings": warnings,
        "termination": _termination_block(status, payload),
    }
    return report


def _termination_block(status: str, payload: dict) -> dict:
    """Per-status breakdown of how the run ended. Empty for completed."""
    if status == "completed":
        return {}
    if status == "failed":
        return {
            "stage": payload.get("failed_stage"),
            "error_type": payload.get("error_type"),
            "error": payload.get("error"),
        }
    if status == "interrupted":
        return {
            "stage": payload.get("interrupted_stage"),
            "source": payload.get("source"),
        }
    if status == "cancelled":
        return {
            "stage": payload.get("cancelled_stage"),
            "source": payload.get("source"),
            "reason": payload.get("reason"),
        }
    return {}


def _render_header(report: dict) -> str:
    """Human-readable preamble — what someone glancing at the ticket sees first."""
    status = report["status"]
    status_label = _STATUS_HEADER_GLYPH[status]
    run_id = report.get("run_id") or "?"
    finished = (report.get("finished_at") or "")[:19].replace("T", " ")
    duration = _human_duration(report.get("duration_ms"))
    cost = report.get("cost_usd")
    cost_s = f"${cost:.4f}" if isinstance(cost, (int, float)) else "?"
    total_tokens = report.get("total_tokens")
    tokens_s = f"{total_tokens:,} tok" if isinstance(total_tokens, int) else "?"

    lines = [
        f"[worca] Pipeline {status_label} · run {run_id} · {finished} UTC",
        "",
        f"  Duration: {duration}",
        f"  Cost:     {cost_s}  ({tokens_s})",
    ]

    stages = report.get("stages_completed") or []
    if stages:
        lines.append(f"  Stages:   {' → '.join(stages)}")

    pr = report.get("pr") or {}
    if pr.get("url"):
        lines.append(f"  PR:       {pr['url']}")

    plan = report.get("plan_file")
    if plan:
        lines.append(f"  Plan:     {plan}")

    term = report.get("termination") or {}
    if status == "failed":
        lines.append(f"  Failure:  stage `{term.get('stage') or '?'}` — "
                     f"{term.get('error') or '?'} ({term.get('error_type') or '?'})")
    elif status == "interrupted":
        lines.append(f"  Halted:   stage `{term.get('stage') or '?'}` — "
                     f"source: {term.get('source') or '?'}")
    elif status == "cancelled":
        bits = [f"stage `{term.get('stage') or '?'}`",
                f"source: {term.get('source') or '?'}"]
        if term.get("reason"):
            bits.append(f"reason: {term['reason']}")
        lines.append(f"  Halted:   {' — '.join(bits)}")

    warnings = report.get("warnings") or []
    if warnings:
        lines.append(f"  Warnings: {len(warnings)} during run "
                     f"(see {REPORT_SCHEMA} appendix for detail)")

    return "\n".join(lines)


def _render_report(report: dict) -> str:
    header = _render_header(report)
    body = json.dumps(report, indent=2, ensure_ascii=False)
    fence_lang = f"json {REPORT_SCHEMA}"
    return f"{header}\n\n```{fence_lang}\n{body}\n```"


def _write_back_enabled(project_root: str) -> bool:
    """Read ``worca.sources.jira.write_back`` from settings; defaults to True.

    Hard override: ``WORCA_JIRA_DISABLED=1`` from the CLI ``--no-jira`` flag
    forces a no-op regardless of settings, so users can mute a single run
    without editing settings.json.
    """
    if os.environ.get("WORCA_JIRA_DISABLED") == "1":
        return False
    try:
        settings = load_settings(
            os.path.join(project_root, ".claude", "settings.json")
        )
    except Exception:
        return True
    flag = (
        settings.get("worca", {})
        .get("sources", {})
        .get("jira", {})
        .get("write_back", True)
    )
    return flag is not False


def _write_report_file(body: str) -> None:
    """Save the rendered report to ``$WORCA_RUN_DIR/jira-report.md``.

    Best-effort and independent of the Jira-write-back mute — the local file
    is the durable artifact even when posting is disabled. Each pipeline run
    has its own ``WORCA_RUN_DIR`` (set by the runner per run_id), so reports
    from different runs never overwrite each other — every run owns its own
    ``jira-report.md`` under its own directory.

    No-op (with stderr warning) when ``WORCA_RUN_DIR`` is unset, e.g. when
    invoking the hook outside a live pipeline run.
    """
    run_dir = os.environ.get("WORCA_RUN_DIR")
    if not run_dir:
        print(
            "[worca.jira.hook] WORCA_RUN_DIR not set; "
            "skipping local report file",
            file=sys.stderr,
        )
        return
    try:
        os.makedirs(run_dir, exist_ok=True)
        path = os.path.join(run_dir, REPORT_FILENAME)
        with open(path, "w") as f:
            f.write(body)
    except OSError as exc:
        print(
            f"[worca.jira.hook] failed to write {REPORT_FILENAME}: {exc}",
            file=sys.stderr,
        )


def _resolve_project_root() -> str:
    root = os.environ.get("WORCA_PROJECT_ROOT")
    if root:
        return root
    fallback = os.getcwd()
    print(
        "[worca.jira.hook] WORCA_PROJECT_ROOT not set; "
        f"falling back to {fallback}",
        file=sys.stderr,
    )
    return fallback


def main(stdin=None) -> int:
    stream = stdin if stdin is not None else sys.stdin
    try:
        event = json.load(stream)
    except (json.JSONDecodeError, ValueError) as exc:
        print(f"[worca.jira.hook] malformed event JSON: {exc}", file=sys.stderr)
        return 0
    if not isinstance(event, dict):
        return 0

    event_type = event.get("event_type", "")
    if event_type not in _TERMINAL_EVENTS:
        return 0

    pipeline = event.get("pipeline") or {}
    wr = pipeline.get("work_request") or {}
    source_ref = wr.get("source_ref") or ""
    if not source_ref.startswith("jtr:"):
        return 0

    project_root = _resolve_project_root()

    try:
        prior = _read_events(os.environ.get("WORCA_EVENTS_PATH"))
        report = _aggregate(event, prior)
        body = _render_report(report)
    except Exception as exc:
        print(f"[worca.jira.hook] report build error: {exc}", file=sys.stderr)
        return 0
    if not body:
        return 0

    # Persist the report locally first — this is independent of the Jira-
    # write-back mute, so users who set --no-jira / write_back: false still
    # get the durable artifact under $WORCA_RUN_DIR/jira-report.md.
    _write_report_file(body)

    if not _write_back_enabled(project_root):
        return 0

    ticket_key = source_ref.split(":", 1)[-1]
    try:
        subprocess.run(
            ["jtr", "comment", ticket_key, "-y", body],
            capture_output=True,
            text=True,
            env=get_env(),
            cwd=project_root,
            check=False,
        )
    except FileNotFoundError:
        print(
            "[worca.jira.hook] `jtr` not found on PATH; skipping comment",
            file=sys.stderr,
        )
    except Exception as exc:
        print(f"[worca.jira.hook] subprocess error: {exc}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
