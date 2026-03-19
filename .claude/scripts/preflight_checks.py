#!/usr/bin/env python3
"""Standalone preflight environment validation script.

No worca imports. Runs checks sequentially and outputs JSON to stdout.

Exit codes:
  0 = all checks pass (warnings are OK)
  1 = one or more failures
  2 = script crashed
"""

import json
import os
import shutil
import subprocess
import sys


CORE_AGENT_TEMPLATES = [
    "planner.md",
    "coordinator.md",
    "implementer.md",
    "tester.md",
    "guardian.md",
]


# ---------------------------------------------------------------------------
# Always-fail checks (required by pipeline)
# ---------------------------------------------------------------------------

def check_claude_cli():
    """claude CLI is installed and responds to --version."""
    if not shutil.which("claude"):
        return "fail", "claude CLI not found in PATH"
    try:
        result = subprocess.run(
            ["claude", "--version"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            version = (result.stdout.strip() or result.stderr.strip() or "unknown").splitlines()[0]
            return "pass", f"claude CLI {version}"
        return "fail", f"claude --version exited with code {result.returncode}"
    except subprocess.TimeoutExpired:
        return "fail", "claude --version timed out after 10s"
    except Exception as exc:
        return "fail", f"claude CLI check error: {exc}"


def check_git_repo():
    """We're inside a git repository."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            return "pass", "inside git repository"
        return "fail", "not inside a git repository"
    except Exception as exc:
        return "fail", f"git check error: {exc}"


def check_bd_cli():
    """bd CLI is installed."""
    if shutil.which("bd"):
        return "pass", "bd CLI found in PATH"
    return "fail", "bd command not found in PATH"


def check_settings_json(settings_path=".claude/settings.json"):
    """.claude/settings.json exists, is valid JSON, and has a 'worca' key."""
    if not os.path.exists(settings_path):
        return "fail", f"{settings_path} not found"
    try:
        with open(settings_path) as f:
            data = json.load(f)
        if "worca" not in data:
            return "fail", f"{settings_path} missing 'worca' key"
        return "pass", f"{settings_path} is valid"
    except json.JSONDecodeError as exc:
        return "fail", f"{settings_path} invalid JSON: {exc}"


def check_agent_templates(core_dir=".claude/agents/core"):
    """All 5 core agent .md files are present."""
    missing = [
        name for name in CORE_AGENT_TEMPLATES
        if not os.path.exists(os.path.join(core_dir, name))
    ]
    if missing:
        return "fail", f"missing agent templates in {core_dir}: {', '.join(missing)}"
    return "pass", f"all {len(CORE_AGENT_TEMPLATES)} core agent templates present"


def check_disk_space():
    """At least 1GB free disk space."""
    try:
        stat = shutil.disk_usage(".")
        free_gb = stat.free / (1024 ** 3)
        if free_gb < 1.0:
            return "fail", f"only {free_gb:.1f}GB free disk space (need at least 1GB)"
        return "pass", f"{free_gb:.1f}GB free disk space"
    except Exception as exc:
        return "fail", f"disk space check error: {exc}"


# ---------------------------------------------------------------------------
# Warn-by-default checks (language/tool-specific, opt-in to require)
# ---------------------------------------------------------------------------

def check_gh_cli():
    """gh CLI is installed (optional)."""
    if shutil.which("gh"):
        return "pass", "gh CLI found in PATH"
    return "warn", "gh not found in PATH (optional)"


def check_python_available():
    """python3 or python is available (optional)."""
    for name in ("python3", "python"):
        if shutil.which(name):
            return "pass", f"{name} found in PATH"
    return "warn", "python not found in PATH (optional)"


def check_test_runner():
    """pytest is available (optional)."""
    if shutil.which("pytest"):
        return "pass", "pytest found in PATH"
    return "warn", "pytest not found in PATH (optional)"


def check_node_available():
    """node is available (optional)."""
    if shutil.which("node"):
        return "pass", "node found in PATH"
    return "warn", "node not found in PATH (optional)"


# ---------------------------------------------------------------------------
# Check registry
# ---------------------------------------------------------------------------

ALWAYS_FAIL_CHECKS = [
    ("claude_cli", check_claude_cli),
    ("git_repo", check_git_repo),
    ("bd_cli", check_bd_cli),
    ("settings_json", check_settings_json),
    ("agent_templates", check_agent_templates),
    ("disk_space", check_disk_space),
]

WARN_CHECKS = [
    ("gh_cli", check_gh_cli),
    ("python_available", check_python_available),
    ("test_runner", check_test_runner),
    ("node_available", check_node_available),
]


# ---------------------------------------------------------------------------
# Core logic
# ---------------------------------------------------------------------------

def read_required_checks(settings_path=".claude/settings.json"):
    """Return list of check names promoted from warn to fail via settings."""
    try:
        with open(settings_path) as f:
            data = json.load(f)
        return data.get("worca", {}).get("preflight", {}).get("require", [])
    except Exception:
        return []


def run_checks(settings_path=".claude/settings.json", core_dir=".claude/agents/core"):
    """Run all checks and return (results, overall_status, summary).

    Reads worca.preflight.require from settings_path to promote warn→fail.
    """
    required = set(read_required_checks(settings_path))

    # Build list of (name, callable) with path parameters bound
    checks_to_run = [
        ("claude_cli", check_claude_cli),
        ("git_repo", check_git_repo),
        ("bd_cli", check_bd_cli),
        ("settings_json", lambda: check_settings_json(settings_path=settings_path)),
        ("agent_templates", lambda: check_agent_templates(core_dir=core_dir)),
        ("disk_space", check_disk_space),
        ("gh_cli", check_gh_cli),
        ("python_available", check_python_available),
        ("test_runner", check_test_runner),
        ("node_available", check_node_available),
    ]

    results = []
    for name, fn in checks_to_run:
        status, message = fn()
        if status == "warn" and name in required:
            status = "fail"
            message = message.replace("(optional)", "(required by settings)")
        results.append({"name": name, "status": status, "message": message})

    failures = sum(1 for r in results if r["status"] == "fail")
    warnings = sum(1 for r in results if r["status"] == "warn")
    passes = sum(1 for r in results if r["status"] == "pass")
    total = len(results)

    overall = "fail" if failures > 0 else "pass"
    summary = f"{passes}/{total} checks passed, {failures} failed, {warnings} warnings"
    return results, overall, summary


def main():
    checks, overall, summary = run_checks()
    output = {"status": overall, "checks": checks, "summary": summary}
    print(json.dumps(output, indent=2))
    sys.exit(0 if overall == "pass" else 1)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"status": "crash", "error": str(exc)}))
        sys.exit(2)
