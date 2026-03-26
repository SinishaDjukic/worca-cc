"""Wrapper for the claude -p CLI with stream-json support.

Uses --output-format stream-json --verbose to get real-time NDJSON events
from the claude CLI. Each event is written to a log file for UI streaming.
The final 'result' event contains the structured output (same as --output-format json).
"""

import json
import os
import signal
import subprocess
import sys
import tempfile
import threading
from typing import Optional, Callable

from worca.utils.env import get_env

# Linux ARG_MAX is typically 2 MiB but total argv+envp must fit.
# Use a conservative 128 KiB threshold for the prompt argument.
_ARG_INLINE_LIMIT = 128 * 1024  # bytes

# Track the currently running subprocess so it can be terminated on signal.
_current_proc = None
_proc_lock = threading.Lock()


def terminate_current():
    """Terminate the currently running claude subprocess, if any.

    Sends SIGTERM to the process group so child processes are also killed.
    """
    with _proc_lock:
        proc = _current_proc
    if proc is None:
        return
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except (ProcessLookupError, OSError):
        pass


def build_command(
    prompt: str,
    agent: str,
    output_format: str = "stream-json",
    json_schema: Optional[str] = None,
    model: Optional[str] = None,
    **kwargs,
) -> tuple[list[str], Optional[str]]:
    """Build the claude CLI command list without executing.

    When the prompt exceeds 128 KiB it is written to a temporary file and
    the CLI argument becomes a short instruction to read that file.  This
    avoids ``[Errno 7] Argument list too long`` (E2BIG) errors.

    Args:
        prompt: The prompt to send to the agent.
        agent: Path to the agent .md file (e.g. ".claude/agents/core/planner.md").
        output_format: Output format ("text", "json", "stream-json").
        json_schema: Inline JSON schema string for structured output, or path
                     to a .json file (will be read and inlined).
        model: Model shorthand or full ID (e.g. "sonnet", "opus", "claude-sonnet-4-6").

    Returns:
        A (cmd, prompt_file) tuple. ``prompt_file`` is the path to a temp
        file containing the full prompt when offloaded, or None when the
        prompt is passed inline. The caller must delete the temp file after
        the subprocess finishes.
    """
    prompt_file = None
    if len(prompt.encode("utf-8", errors="replace")) > _ARG_INLINE_LIMIT:
        fd, prompt_file = tempfile.mkstemp(prefix="worca_prompt_", suffix=".md")
        with os.fdopen(fd, "w") as f:
            f.write(prompt)
        cli_prompt = (
            f"Read the file at {prompt_file} and follow ALL instructions in it. "
            f"That file IS your full prompt — process it exactly as written."
        )
    else:
        cli_prompt = prompt

    cmd = [
        "claude",
        "-p",
        cli_prompt,
        "--agent",
        agent,
        "--output-format",
        output_format,
        "--no-session-persistence",
        "--dangerously-skip-permissions",
        "--disallowedTools", "Skill,EnterPlanMode,EnterWorktree,TodoWrite",
    ]
    if model:
        cmd.extend(["--model", model])
    if output_format == "stream-json":
        cmd.append("--verbose")
    if json_schema is not None:
        # If it looks like a file path, read its contents
        schema_str = json_schema
        if json_schema.endswith(".json"):
            try:
                with open(json_schema) as f:
                    schema_str = f.read().strip()
            except FileNotFoundError:
                pass  # Use the raw string as-is
        cmd.extend(["--json-schema", schema_str])
    return cmd, prompt_file


def _format_log_line(event: dict) -> Optional[str]:
    """Convert a stream-json event into a human-readable log line.

    Returns None for events that shouldn't be logged (system hooks, etc.).
    """
    etype = event.get("type", "")
    subtype = event.get("subtype", "")

    if etype == "system":
        if subtype == "init":
            model = event.get("model", "?")
            return f"[init] model={model}"
        # Skip hook events — noisy
        return None

    if etype == "assistant":
        msg = event.get("message", {})
        content_blocks = msg.get("content", [])
        parts = []
        for block in content_blocks:
            if block.get("type") == "text":
                text = block.get("text", "").strip()
                if text:
                    parts.append(text)
            elif block.get("type") == "tool_use":
                tool = block.get("name", "?")
                inp = block.get("input", {})
                # Summarize tool input
                if tool == "Read":
                    detail = inp.get("file_path", "")
                elif tool == "Write":
                    detail = inp.get("file_path", "")
                elif tool == "Edit":
                    detail = inp.get("file_path", "")
                elif tool == "Bash":
                    detail = inp.get("command", "")[:120]
                elif tool == "Grep":
                    detail = inp.get("pattern", "")
                elif tool == "Glob":
                    detail = inp.get("pattern", "")
                elif tool == "Agent":
                    detail = inp.get("description", "")
                else:
                    detail = ""
                parts.append(f"[tool:{tool}] {detail}")
            elif block.get("type") == "tool_result":
                # Tool results in assistant messages — skip detail
                pass
        if parts:
            return " | ".join(parts)
        return None

    if etype == "user":
        # User messages contain tool results
        content = event.get("content", [])
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "tool_result":
                    tool_id = block.get("tool_use_id", "")[:8]
                    is_error = block.get("is_error", False)
                    status = "ERROR" if is_error else "ok"
                    return f"[result:{status}] {tool_id}"
        return None

    if etype == "result":
        cost = event.get("total_cost_usd", 0)
        turns = event.get("num_turns", 0)
        duration = event.get("duration_ms", 0)
        return f"[done] turns={turns} cost=${cost:.3f} duration={duration / 1000:.1f}s"

    return None


def process_stream(
    stdout,
    log_file=None,
    on_event: Optional[Callable[[dict], None]] = None,
) -> dict:
    """Read NDJSON events from stdout and return the result event.

    Args:
        stdout: File-like object yielding lines of NDJSON.
        log_file: Open file to write human-readable log lines to.
        on_event: Optional callback invoked for each parsed event.

    Returns the parsed result event dict, or raises RuntimeError if not found.
    The result event will have ``_resolved_model`` set from the system.init
    event if the result event does not already contain a ``model`` field.
    """
    result_event = None
    resolved_model = None

    for raw_line in stdout:
        line = raw_line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            # Not valid JSON — write raw to log
            if log_file:
                log_file.write(raw_line if isinstance(raw_line, str) else raw_line.decode())
                log_file.flush()
            continue

        if on_event:
            on_event(event)

        # Capture model from system.init event
        if event.get("type") == "system" and event.get("subtype") == "init":
            resolved_model = event.get("model")

        # Write human-readable summary to log
        if log_file:
            log_line = _format_log_line(event)
            if log_line:
                log_file.write(log_line + "\n")
                log_file.flush()

        if event.get("type") == "result":
            result_event = event

    if result_event is None:
        raise RuntimeError("No result event found in stream-json output")

    # Attach resolved model to result event if not already present
    if resolved_model and "model" not in result_event:
        result_event["_resolved_model"] = resolved_model

    return result_event


def run_agent(
    prompt: str,
    agent: str,
    max_turns: int = 0,
    output_format: str = "stream-json",
    json_schema: Optional[str] = None,
    model: Optional[str] = None,
    log_path: Optional[str] = None,
    on_event: Optional[Callable[[dict], None]] = None,
) -> dict:
    """Run a claude agent via the CLI and return parsed JSON output.

    Uses stream-json format to get real-time events. The final result event
    is returned (same structure as --output-format json).

    Note: max_turns is accepted for API compatibility but not passed to the CLI
    (claude -p does not support --max-turns). Use --max-budget-usd for cost control.

    Args:
        model: Model shorthand or full ID to pass via --model flag.
        log_path: If provided, write human-readable event summaries to this file.
        on_event: Optional callback invoked for each stream-json event.

    Raises RuntimeError on subprocess failure or missing result.
    """
    cmd, prompt_file = build_command(
        prompt,
        agent=agent,
        output_format=output_format,
        json_schema=json_schema,
        model=model,
    )

    global _current_proc

    # Extract agent name from path so hooks can enforce role-based restrictions
    agent_name = os.path.splitext(os.path.basename(agent))[0]

    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, env=get_env(WORCA_AGENT=agent_name), start_new_session=True,
    )

    with _proc_lock:
        _current_proc = proc

    try:
        log_file = None
        if log_path:
            os.makedirs(os.path.dirname(log_path), exist_ok=True)
            log_file = open(log_path, "w")

        # Tee stderr to console in background
        def _tee_stderr():
            for line in proc.stderr:
                sys.stderr.write(line)
                sys.stderr.flush()

        stderr_thread = threading.Thread(target=_tee_stderr, daemon=True)
        stderr_thread.start()

        # Process stdout stream events
        result_event = process_stream(
            proc.stdout,
            log_file=log_file,
            on_event=on_event,
        )

        stderr_thread.join(timeout=5)
        proc.wait()

        if log_file:
            log_file.close()
            log_file = None

    finally:
        with _proc_lock:
            _current_proc = None
        if log_file:
            log_file.close()
        # Clean up the temporary prompt file if one was created
        if prompt_file:
            try:
                os.unlink(prompt_file)
            except OSError:
                pass

    if proc.returncode < 0:
        raise InterruptedError(f"claude agent killed by signal {-proc.returncode}")
    if proc.returncode != 0:
        error_msg = result_event.get("result", "") if result_event else ""
        raise RuntimeError(
            f"claude agent failed (exit code {proc.returncode})"
            + (f": {error_msg[:500]}" if error_msg else "")
        )

    return result_event
