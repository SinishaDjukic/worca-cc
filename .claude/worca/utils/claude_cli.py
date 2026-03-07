"""Wrapper for the claude -p CLI."""

import json
import subprocess
from typing import Optional


def build_command(
    prompt: str,
    agent: str,
    max_turns: int,
    output_format: str = "json",
    json_schema: Optional[str] = None,
    **kwargs,
) -> list[str]:
    """Build the claude CLI command list without executing.

    Useful for inspection and logging.
    """
    cmd = [
        "claude",
        "-p",
        prompt,
        "--agent",
        agent,
        "--max-turns",
        str(max_turns),
        "--output-format",
        output_format,
        "--dangerously-skip-permissions",
        "--no-resume",
    ]
    if json_schema is not None:
        cmd.extend(["--json-schema", json_schema])
    return cmd


def run_agent(
    prompt: str,
    agent: str,
    max_turns: int,
    output_format: str = "json",
    json_schema: Optional[str] = None,
) -> dict:
    """Run a claude agent via the CLI and return parsed JSON output.

    Raises RuntimeError on subprocess failure or JSON parse failure.
    """
    cmd = build_command(
        prompt,
        agent=agent,
        max_turns=max_turns,
        output_format=output_format,
        json_schema=json_schema,
    )
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"claude agent failed: {result.stderr}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Failed to parse JSON output: {e}")
