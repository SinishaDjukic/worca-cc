"""Session lifecycle hooks: SessionStart, PreCompact, SessionEnd.

Reads JSON from stdin with an event field.
- session_start: gathers git context, runs bd prime, prints context to stdout.
- pre_compact: runs bd prime, prints output to stdout.
- session_end: logs summary to stderr, cleans up temp files.
"""

import json
import os
import shutil
import subprocess
import sys

try:
    from worca.utils.env import get_env
except ImportError:
    def get_env(**kw):
        return None


def handle_session_start() -> str:
    """Get git context and run bd prime. Returns context string."""
    env = get_env()
    # Get git context
    branch_result = subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"], capture_output=True, text=True, env=env
    )
    branch = branch_result.stdout.strip() if branch_result.returncode == 0 else "unknown"

    status_result = subprocess.run(["git", "status", "--short"], capture_output=True, text=True, env=env)
    status = status_result.stdout.strip() if status_result.returncode == 0 else ""

    # Run bd prime
    subprocess.run(["bd", "prime"], capture_output=True, text=True, env=env)

    context = f"Branch: {branch}"
    if status:
        context += f"\nModified files:\n{status}"
    return context


def handle_pre_compact() -> str:
    """Run bd prime and return its output."""
    result = subprocess.run(["bd", "prime"], capture_output=True, text=True, env=get_env())
    return result.stdout.strip() if result.returncode == 0 else ""


def handle_session_end() -> None:
    """Log session summary and clean up temp files."""
    print("Session ended.", file=sys.stderr)
    tmp_dir = ".worca/tmp"
    if os.path.isdir(tmp_dir):
        shutil.rmtree(tmp_dir)


def main():
    data = json.load(sys.stdin)
    event = data.get("event", "")
    if event == "session_start":
        context = handle_session_start()
        print(context)
    elif event == "pre_compact":
        output = handle_pre_compact()
        print(output)
    elif event == "session_end":
        handle_session_end()


if __name__ == "__main__":
    main()
