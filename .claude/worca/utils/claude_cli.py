"""Wrapper for the claude -p CLI."""

import json
import os
import signal
import subprocess
import sys
import threading
from typing import Optional

from worca.utils.env import get_env

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
    output_format: str = "json",
    json_schema: Optional[str] = None,
    **kwargs,
) -> list[str]:
    """Build the claude CLI command list without executing.

    Args:
        prompt: The prompt to send to the agent.
        agent: Path to the agent .md file (e.g. ".claude/agents/core/planner.md").
        output_format: Output format ("text", "json", "stream-json").
        json_schema: Inline JSON schema string for structured output, or path
                     to a .json file (will be read and inlined).
    """
    cmd = [
        "claude",
        "-p",
        prompt,
        "--agent",
        agent,
        "--output-format",
        output_format,
        "--no-session-persistence",
        "--dangerously-skip-permissions",
    ]
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
    return cmd


def run_agent(
    prompt: str,
    agent: str,
    max_turns: int = 0,
    output_format: str = "json",
    json_schema: Optional[str] = None,
    log_path: Optional[str] = None,
) -> dict:
    """Run a claude agent via the CLI and return parsed JSON output.

    Note: max_turns is accepted for API compatibility but not passed to the CLI
    (claude -p does not support --max-turns). Use --max-budget-usd for cost control.

    Args:
        log_path: If provided, tee stderr to this file for UI log streaming.

    Raises RuntimeError on subprocess failure or JSON parse failure.
    """
    cmd = build_command(
        prompt,
        agent=agent,
        output_format=output_format,
        json_schema=json_schema,
    )

    global _current_proc

    if log_path:
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, env=get_env(), start_new_session=True,
        )
    else:
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=sys.stderr,
            text=True, env=get_env(), start_new_session=True,
        )

    with _proc_lock:
        _current_proc = proc

    try:
        if log_path:
            def _tee_stderr():
                with open(log_path, "w") as lf:
                    for line in proc.stderr:
                        sys.stderr.write(line)
                        sys.stderr.flush()
                        lf.write(line)
                        lf.flush()

            t = threading.Thread(target=_tee_stderr, daemon=True)
            t.start()
            stdout = proc.stdout.read()
            t.join()
        else:
            stdout = proc.stdout.read()

        proc.wait()
    finally:
        with _proc_lock:
            _current_proc = None

    if proc.returncode < 0:
        raise InterruptedError(f"claude agent killed by signal {-proc.returncode}")
    if proc.returncode != 0:
        raise RuntimeError(f"claude agent failed (exit code {proc.returncode})")
    try:
        return json.loads(stdout)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Failed to parse JSON output: {e}\nRaw output: {stdout[:500]}")
