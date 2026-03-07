"""PreToolUse safety gates for worca governance.

Reads JSON from stdin with tool_name and tool_input.
Exit code 0 = allow, exit code 2 = block (print reason to stderr).
"""
import json
import re
import sys
import os


def _is_rm_rf(command: str) -> bool:
    """Check if a command contains rm with both -r and -f flags."""
    # Tokenize roughly to find rm invocations
    # Match patterns: rm -rf, rm -fr, rm -r -f, rm -f -r, etc.
    # We look for "rm" followed by flags that include both r and f
    tokens = command.split()
    if "rm" not in tokens:
        return False

    rm_index = tokens.index("rm")
    flags_after_rm = []
    for token in tokens[rm_index + 1:]:
        if token.startswith("-"):
            flags_after_rm.append(token)
        else:
            break

    # Collect all individual flag characters
    all_flags = set()
    for flag_token in flags_after_rm:
        if flag_token.startswith("--"):
            # Long flags like --recursive, --force
            long_flag = flag_token[2:]
            if long_flag == "recursive":
                all_flags.add("r")
            elif long_flag == "force":
                all_flags.add("f")
        else:
            # Short flags like -rf, -r, -f
            for ch in flag_token[1:]:
                all_flags.add(ch)

    return "r" in all_flags and "f" in all_flags


def _is_force_push(command: str) -> bool:
    """Check if command is a git push with --force or -f."""
    tokens = command.split()
    if "git" not in tokens:
        return False
    git_idx = tokens.index("git")
    remaining = tokens[git_idx + 1:]
    if not remaining or remaining[0] != "push":
        return False
    push_args = remaining[1:]
    for arg in push_args:
        if arg == "--force" or arg.startswith("--force-"):
            return True
        if arg.startswith("-") and not arg.startswith("--"):
            if "f" in arg[1:]:
                return True
    return False


def _is_git_commit(command: str) -> bool:
    """Check if command contains git commit."""
    return "git commit" in command


def check_guard(tool_name: str, tool_input: dict) -> tuple:
    """Check if tool use should be blocked.

    Returns (exit_code, reason) where exit_code 0 = allow, 2 = block.
    """
    command = tool_input.get("command", "")
    file_path = tool_input.get("file_path", "")

    # Block rm -rf
    if tool_name == "Bash" and _is_rm_rf(command):
        return (2, "Blocked: rm with recursive+force flags is not allowed.")

    # Block .env access via Write/Edit
    if tool_name in ("Write", "Edit"):
        basename = os.path.basename(file_path)
        if basename == ".env":
            return (2, "Blocked: writing to .env files is not allowed. Use .env.sample or .env.example instead.")

    # Block force push
    if tool_name == "Bash" and _is_force_push(command):
        return (2, "Blocked: git push --force is not allowed.")

    # Block commits when not Guardian
    if tool_name == "Bash" and _is_git_commit(command):
        agent = os.environ.get("WORCA_AGENT")
        if agent is not None and agent != "guardian":
            return (2, "Blocked: only the guardian agent may commit. Current agent: {}.".format(agent))

    # Allow everything else
    return (0, "")


def main():
    data = json.load(sys.stdin)
    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {})
    code, reason = check_guard(tool_name, tool_input)
    if code != 0:
        print(reason, file=sys.stderr)
    sys.exit(code)


if __name__ == "__main__":
    main()
