"""PostToolUse hook: Escalating strike system for test failures.

Reads JSON from stdin with tool_name, tool_input, and exit_code.
Exit code 0 = allow (with optional warning), exit code 2 = block.

Strike state is persisted to {WORCA_RUN_DIR}/test_gate_strikes.json when
the WORCA_RUN_DIR env var is set. Falls back to in-memory state otherwise.
"""
import json
import os
import sys
import tempfile

_state = {"strikes": 0}

_STATE_FILENAME = "test_gate_strikes.json"


def _state_file_path():
    """Return the path to the file-backed state file, or None."""
    run_dir = os.environ.get("WORCA_RUN_DIR")
    if not run_dir:
        return None
    return os.path.join(run_dir, _STATE_FILENAME)


def _read_strikes():
    """Read the current strike count from file or in-memory state."""
    path = _state_file_path()
    if path is None:
        return _state["strikes"]
    try:
        with open(path, "r") as f:
            data = json.load(f)
        return data.get("strikes", 0)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return 0


def _write_strikes(count):
    """Write the strike count to file (atomic) and in-memory state."""
    _state["strikes"] = count
    path = _state_file_path()
    if path is None:
        return
    # Atomic write: write to temp file in same directory, then rename
    dir_name = os.path.dirname(path)
    os.makedirs(dir_name, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=dir_name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump({"strikes": count}, f)
        os.replace(tmp_path, path)
    except Exception:
        # Clean up temp file on failure
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def check_test_gate(tool_name: str, tool_input: dict, exit_code: int) -> tuple:
    """Check if repeated test failures should block further progress.

    Returns (exit_code, reason) where exit_code 0 = allow, 2 = block.
    """
    if tool_name != "Bash":
        return (0, "")

    command = tool_input.get("command", "")
    if "pytest" not in command:
        return (0, "")

    if exit_code == 0:
        _write_strikes(0)
        return (0, "")

    strikes = _read_strikes() + 1
    _write_strikes(strikes)

    if strikes == 1:
        return (0, "Warning: test failure (strike 1). Fix before continuing.")

    return (2, "Blocked: {} consecutive test failures. Fix tests before proceeding.".format(
        strikes
    ))


def main():
    data = json.load(sys.stdin)
    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {})
    tool_exit_code = data.get("exit_code", 0)
    code, reason = check_test_gate(tool_name, tool_input, tool_exit_code)
    if code != 0:
        print(reason, file=sys.stderr)
    elif reason:
        print(reason, file=sys.stderr)
    sys.exit(code)


if __name__ == "__main__":
    main()
