"""PreToolUse safety gates for worca governance.

Reads JSON from stdin with tool_name and tool_input.
Exit code 0 = allow, exit code 2 = block (print reason to stderr).
"""
import json
import re
import sys
import os


def _extract_actual_command(command: str) -> str:
    """Extract the actual command, stripping any cd prefix added by hooks.

    The pre_tool_use hook prepends 'cd /project/root && ' to every Bash
    command when WORCA_PROJECT_ROOT is set.  Detection functions need to
    inspect the real command, not the cd wrapper.
    """
    if "&&" in command:
        return command.split("&&", 1)[1].strip()
    return command.strip()


_SAFE_COMMAND_PREFIXES = ("bd ", "bd\t")


def _is_safe_command(command: str) -> bool:
    """Check if command is a safe CLI tool that should bypass all detection.

    Safe commands are tools like bd (beads issue tracker) whose arguments
    contain natural language that must not be pattern-matched as shell
    operations.
    """
    actual = _extract_actual_command(command)
    return any(actual.startswith(p) for p in _SAFE_COMMAND_PREFIXES)


def _is_rm_rf(command: str) -> bool:
    """Check if a command contains rm with both -r and -f flags."""
    if _is_safe_command(command):
        return False
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
    if _is_safe_command(command):
        return False
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
    if _is_safe_command(command):
        return False
    return "git commit" in command


def _is_test_command(command: str) -> bool:
    """Check if command runs tests."""
    if _is_safe_command(command):
        return False
    test_patterns = [
        "pytest", "python -m pytest", "npm test", "npm run test",
        "yarn test", "cargo test", "go test",
    ]
    cmd_lower = command.lower()
    return any(p in cmd_lower for p in test_patterns)


def _is_file_write_via_bash(command: str) -> bool:
    """Detect Bash commands that write files, bypassing Write/Edit tools.

    Catches patterns like: cat > file, echo > file, tee file,
    python3 -c "open(f,'w')", heredocs writing files, sed -i, etc.
    """
    if _is_safe_command(command):
        return False

    # Shell redirection: > or >> to a file
    # Match: cat > file, echo > file, printf > file, etc.
    if re.search(r'(?<!\|)\s*>\s*[^\s|&;]', command):
        return True

    # Heredoc writes: << 'EOF' or <<EOF combined with > or cat >
    if re.search(r'<<\s*[\'"]?\w+[\'"]?', command) and ">" in command:
        return True

    # tee command (writes to files)
    if re.search(r'\btee\b', command):
        return True

    # sed -i (in-place edit)
    if re.search(r'\bsed\b.*\s-i', command):
        return True

    # python/python3 with file write patterns
    if re.search(r'\bpython[3]?\b', command):
        if re.search(r'open\s*\(.*["\']w["\']', command) or \
           re.search(r'\.write\s*\(', command) or \
           re.search(r'\.writelines\s*\(', command) or \
           re.search(r'pathlib.*write_', command):
            return True

    # cp or mv (can overwrite files)
    if re.search(r'\b(cp|mv)\b', command):
        return True

    # dd command
    if re.search(r'\bdd\b.*\bof=', command):
        return True

    return False


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

    # Role-based restrictions (only enforced when WORCA_AGENT is set)
    agent = os.environ.get("WORCA_AGENT")
    if agent is not None:
        # Planner may only write the plan file
        if tool_name in ("Write", "Edit") and agent == "planner":
            plan_file = os.environ.get("WORCA_PLAN_FILE")
            if plan_file:
                allowed = os.path.abspath(plan_file)
                target = os.path.abspath(file_path)
                if target != allowed:
                    return (2, "Blocked: planner agent may only write {}, not {}.".format(plan_file, file_path))
            else:
                basename = os.path.basename(file_path)
                if basename != "MASTER_PLAN.md" and not re.match(r'^plan-\d{3}\.md$', basename):
                    return (2, "Blocked: planner agent may only write MASTER_PLAN.md or plan-NNN.md, not {}.".format(basename))

        # Read-only agents: coordinator, tester, and plan_reviewer may not write files
        read_only_agents = ("coordinator", "tester", "plan_reviewer")
        if agent in read_only_agents:
            if tool_name in ("Write", "Edit"):
                return (2, "Blocked: {} agent is read-only — may not write files.".format(agent))
            if tool_name == "Bash" and _is_file_write_via_bash(command):
                return (2, "Blocked: {} agent is read-only — file writes via Bash are not allowed.".format(agent))

        # Planner, Coordinator, and PlanReviewer may not run tests
        if tool_name == "Bash" and agent in ("planner", "coordinator", "plan_reviewer"):
            if _is_test_command(command):
                return (2, "Blocked: {} agent may not run tests.".format(agent))

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
