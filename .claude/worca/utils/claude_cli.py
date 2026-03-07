"""Wrapper for the claude -p CLI."""

import json
import subprocess
from typing import Optional


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
) -> dict:
    """Run a claude agent via the CLI and return parsed JSON output.

    Note: max_turns is accepted for API compatibility but not passed to the CLI
    (claude -p does not support --max-turns). Use --max-budget-usd for cost control.

    Raises RuntimeError on subprocess failure or JSON parse failure.
    """
    cmd = build_command(
        prompt,
        agent=agent,
        output_format=output_format,
        json_schema=json_schema,
    )
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"claude agent failed: {result.stderr}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Failed to parse JSON output: {e}\nRaw output: {result.stdout[:500]}")
