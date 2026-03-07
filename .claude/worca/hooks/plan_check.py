"""PreToolUse hook: Block source file writes when no approved MASTER_PLAN.md exists.

Reads JSON from stdin with tool_name and tool_input.
Exit code 0 = allow, exit code 2 = block (print reason to stderr).
"""
import json
import sys
import os

SOURCE_EXTENSIONS = {
    ".py", ".js", ".ts", ".jsx", ".tsx", ".go", ".rs",
    ".java", ".rb", ".c", ".cpp", ".h",
}

ALWAYS_ALLOW_PATTERNS = {"test_", "_test.", ".test.", "spec_", "_spec."}


def check_plan(tool_name: str, tool_input: dict) -> tuple:
    """Check if a source file write should be blocked due to missing plan.

    Returns (exit_code, reason) where exit_code 0 = allow, 2 = block.
    """
    if tool_name not in ("Write", "Edit"):
        return (0, "")

    file_path = tool_input.get("file_path", "")
    _, ext = os.path.splitext(file_path)

    if ext not in SOURCE_EXTENSIONS:
        return (0, "")

    basename = os.path.basename(file_path)
    if any(p in basename for p in ALWAYS_ALLOW_PATTERNS):
        return (0, "")

    if not os.path.exists("MASTER_PLAN.md"):
        return (2, "Blocked: no approved MASTER_PLAN.md found. Create a plan first.")

    return (0, "")


def main():
    data = json.load(sys.stdin)
    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {})
    code, reason = check_plan(tool_name, tool_input)
    if code != 0:
        print(reason, file=sys.stderr)
    sys.exit(code)


if __name__ == "__main__":
    main()
