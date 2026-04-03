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

    # Only enforce plan requirement inside the worca pipeline
    if not os.environ.get("WORCA_AGENT"):
        return (0, "")

    file_path = tool_input.get("file_path", "")
    _, ext = os.path.splitext(file_path)

    if ext not in SOURCE_EXTENSIONS:
        return (0, "")

    basename = os.path.basename(file_path)
    if any(p in basename for p in ALWAYS_ALLOW_PATTERNS):
        return (0, "")

    plan_file = os.environ.get("WORCA_PLAN_FILE", "MASTER_PLAN.md")
    if not os.path.isabs(plan_file):
        project_root = os.environ.get("WORCA_PROJECT_ROOT", "")
        if project_root:
            plan_file = os.path.join(project_root, plan_file)
    if not os.path.exists(plan_file):
        return (2, "Blocked: no approved plan file found ({}). Create a plan first.".format(plan_file))

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
