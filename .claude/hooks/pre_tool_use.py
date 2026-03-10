# /// script
# requires-python = ">=3.8"
# ///
"""PreToolUse hook: runs guard and plan_check."""
import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

try:
    from worca.hooks.guard import check_guard
    from worca.hooks.plan_check import check_plan
except ImportError:
    # Worca package not available — allow all operations
    sys.exit(0)


def _needs_cwd_fix(tool_name, tool_input):
    """Check if this Bash command needs a project root cd prefix.

    Returns the modified command string, or None if no fix needed.
    When WORCA_PROJECT_ROOT is set (by the pipeline runner), every Bash
    command is prefixed with `cd $root &&` so that agent `cd` commands
    cannot permanently shift the working directory and break subsequent
    commands and hooks.
    """
    if tool_name != "Bash":
        return None
    project_root = os.environ.get("WORCA_PROJECT_ROOT")
    if not project_root:
        return None
    command = tool_input.get("command", "")
    if not command:
        return None
    # Don't double-prefix if already starts with cd to the project root
    if command.startswith(f"cd {project_root}"):
        return None
    return f"cd {project_root} && {command}"


def _fix_bd_create_external_ref(tool_name, tool_input):
    """Auto-inject --external-ref into bd create commands when missing.

    When WORCA_RUN_ID is set (pipeline is running), any `bd create` command
    that lacks --external-ref gets it appended automatically. This ensures
    beads issues are linked to their pipeline run regardless of LLM compliance.

    Returns the modified command string, or None if no fix needed.
    """
    if tool_name != "Bash":
        return None
    run_id = os.environ.get("WORCA_RUN_ID")
    if not run_id:
        return None
    command = tool_input.get("command", "")
    if "bd create" not in command:
        return None
    if "--external-ref" in command:
        return None
    # Append --external-ref to each bd create invocation in the command
    return command.replace("bd create", f'bd create --external-ref="worca:{run_id}"')


def main():
    data = json.load(sys.stdin)
    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {})

    command_modified = False

    # Check if we need to fix the cwd for this command
    fixed_command = _needs_cwd_fix(tool_name, tool_input)
    if fixed_command is not None:
        tool_input["command"] = fixed_command
        command_modified = True

    # Auto-inject --external-ref into bd create commands
    ref_fixed = _fix_bd_create_external_ref(tool_name, tool_input)
    if ref_fixed is not None:
        tool_input["command"] = ref_fixed
        command_modified = True

    # Guard check first
    code, reason = check_guard(tool_name, tool_input)
    if code != 0:
        print(reason, file=sys.stderr)
        sys.exit(code)

    # Plan check second
    code, reason = check_plan(tool_name, tool_input)
    if code != 0:
        print(reason, file=sys.stderr)
        sys.exit(code)

    # If we modified the command, output the updated input via hook protocol
    if command_modified:
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "allow",
                "updatedInput": {"command": tool_input["command"]},
            }
        }))

    sys.exit(0)


if __name__ == "__main__":
    main()
