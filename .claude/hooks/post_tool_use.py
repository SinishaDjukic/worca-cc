# /// script
# requires-python = ">=3.8"
# ///
"""PostToolUse hook: runs test_gate and links bd create to pipeline runs."""
import json
import re
import subprocess
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

try:
    from worca.hooks.test_gate import check_test_gate
except ImportError:
    sys.exit(0)


def _link_bd_create_to_run(tool_name, tool_input, tool_response):
    """After a successful bd create, add a run label to link it to the current run.

    When WORCA_RUN_ID is set (pipeline is running), any successful `bd create`
    output is parsed for the issue ID, then `bd label add` tags it with
    ``run:<run_id>`` so multiple beads can share the same run reference.
    """
    if tool_name != "Bash":
        return
    run_id = os.environ.get("WORCA_RUN_ID")
    if not run_id:
        return
    command = tool_input.get("command", "")
    if "bd create" not in command:
        return
    stdout = tool_response.get("stdout", "")
    exit_code = tool_response.get("exit_code", 1)
    if exit_code != 0:
        return
    # Match all created issue IDs (may be multiple in chained commands)
    for match in re.finditer(r"Created issue:\s+(\S+)", stdout):
        issue_id = match.group(1)
        subprocess.run(
            ["bd", "label", "add", issue_id, f"run:{run_id}"],
            capture_output=True, text=True
        )


def main():
    data = json.load(sys.stdin)
    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {})
    tool_response = data.get("tool_response", {})

    # Link bd create issues to the current pipeline run
    _link_bd_create_to_run(tool_name, tool_input, tool_response)

    # Test gate check
    exit_code = tool_response.get("exit_code", data.get("exit_code", 0))
    code, reason = check_test_gate(tool_name, tool_input, exit_code)
    if code != 0:
        print(reason, file=sys.stderr)
    elif reason:
        print(reason, file=sys.stderr)
    sys.exit(code)


if __name__ == "__main__":
    main()
