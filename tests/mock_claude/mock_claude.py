#!/usr/bin/env python3
"""Mock Claude CLI for integration testing.

Reads MOCK_CLAUDE_SCENARIO env var for a path to a JSON scenario file.
Parses --agent from argv to select a per-agent directive.
Emits stream-JSON events matching Claude CLI output format, then exits.

Directive resolution order (per scenario):

    1. ``agents[name]["iter_N"]``   — exact iteration match (N parsed from
                                       resolved template path stem)
    2. ``agents[name]["default"]``  — agent default when ``agents[name]`` is
                                       a dict-of-iterations
    3. ``agents[name]``             — flat (non-dict-of-iterations) directive
    4. ``scenario["default"]``      — scenario fallback

A value under ``agents[name]`` is treated as a *dict-of-iterations* iff it
contains at least one ``iter_N`` key or a ``default`` key. Otherwise it is
treated as a flat directive (this is the pre-W-050 behavior — existing
scenarios keep working unchanged).
"""
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time

# Resolved template path stems look like ``{stage}-{agent}-iter-{N}``
# (e.g. ``plan-planner-iter-1``). _RESOLVED_RE extracts the agent slug;
# _ITER_RE extracts the iteration number. Per W-050 plan binding rule #6,
# _RESOLVED_RE must not be changed — _ITER_RE is the iteration-side companion.
_RESOLVED_RE = re.compile(r"^[a-z_]+-([a-z_]+)-iter-\d+$")
_ITER_RE = re.compile(r"-iter-(\d+)$")

_START_PPID = os.getppid() if os.name == "posix" else None


def _extract_agent_name(agent_path):
    """Extract agent name from either a plain path or a resolved template path.

    Plain:    .claude/worca/agents/core/planner.md → planner
    Resolved: .worca/runs/.../resolved/plan-planner-iter-1.md → planner
    """
    stem = os.path.splitext(os.path.basename(agent_path))[0]
    m = _RESOLVED_RE.match(stem)
    return m.group(1) if m else stem


def _extract_iteration(agent_path):
    """Return the iteration number from a resolved template path, or None.

    Resolved: .worca/runs/.../resolved/plan-planner-iter-3.md → 3
    Plain:    .claude/worca/agents/core/planner.md → None
    """
    if not agent_path:
        return None
    stem = os.path.splitext(os.path.basename(agent_path))[0]
    m = _ITER_RE.search(stem)
    return int(m.group(1)) if m else None


def _is_per_iteration_block(value):
    """A dict is per-iteration iff it has any ``iter_N`` key or a ``default`` key."""
    if not isinstance(value, dict):
        return False
    for key in value:
        if key == "default" or (isinstance(key, str) and key.startswith("iter_")):
            return True
    return False


def _resolve_directive(scenario, agent, iteration):
    """Pick the directive for (agent, iteration) using the documented fallback chain."""
    agents_cfg = scenario.get("agents", {}) or {}
    agent_block = agents_cfg.get(agent) if agent else None

    if _is_per_iteration_block(agent_block):
        if iteration is not None:
            iter_directive = agent_block.get(f"iter_{iteration}")
            if iter_directive is not None:
                return iter_directive
        agent_default = agent_block.get("default")
        if agent_default is not None:
            return agent_default
        return scenario.get("default", {})

    if agent_block is not None:
        return agent_block

    return scenario.get("default", {})


def _substitute_head_placeholder(obj):
    """Replace string values that are exactly "$HEAD" with the actual git HEAD SHA."""
    if isinstance(obj, str) and obj == "$HEAD":
        r = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True)
        return r.stdout.strip() if r.returncode == 0 else obj
    if isinstance(obj, dict):
        return {k: _substitute_head_placeholder(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_substitute_head_placeholder(item) for item in obj]
    return obj


def _start_orphan_watchdog():
    """POSIX daemon thread: self-terminate when reparented (parent exited)."""
    if _START_PPID is None:
        return

    def _poll():
        while True:
            time.sleep(1)
            if os.getppid() != _START_PPID:
                os._exit(0)

    t = threading.Thread(target=_poll, daemon=True)
    t.start()


def main():
    _start_orphan_watchdog()
    scenario_path = os.environ.get("MOCK_CLAUDE_SCENARIO")
    if not scenario_path:
        print(json.dumps({"type": "error", "error": "MOCK_CLAUDE_SCENARIO env var not set"}),
              file=sys.stderr)
        sys.exit(1)

    try:
        with open(scenario_path) as f:
            scenario = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"type": "error", "error": f"Failed to read scenario: {exc}"}),
              file=sys.stderr)
        sys.exit(1)

    agent_raw = None
    for i, arg in enumerate(sys.argv):
        if arg == "--agent" and i + 1 < len(sys.argv):
            agent_raw = sys.argv[i + 1]
            break

    agent = _extract_agent_name(agent_raw) if agent_raw else None
    iteration = _extract_iteration(agent_raw) if agent_raw else None
    directive = _resolve_directive(scenario, agent, iteration)
    action = directive.get("action", "succeed")
    delay = directive.get("delay_s", 0.5)

    print(json.dumps({
        "type": "system",
        "subtype": "init",
        "model": "mock-model",
        "session_id": "mock-session",
    }))
    sys.stdout.flush()

    time.sleep(delay)

    # Optional synthetic stderr (W-074): the real Claude CLI prints 429/529
    # backoff diagnostics to stderr. A directive may set "stderr_lines" (a
    # string or list of strings) to exercise worca's retry-signal capture
    # (claude_cli._tee_stderr → _RETRY_RE → api_retries / api_retry_wait_ms and
    # the pipeline.agent.api_retry event). Emitted before the result so the
    # backoff window opens, then a brief sleep lets the next stdout event close
    # it with a measurable (>= 0) span.
    stderr_lines = directive.get("stderr_lines")
    if stderr_lines is not None:
        if isinstance(stderr_lines, str):
            stderr_lines = [stderr_lines]
        for _line in stderr_lines:
            sys.stderr.write(str(_line).rstrip("\n") + "\n")
            sys.stderr.flush()
        time.sleep(0.05)

    if action == "succeed":
        run_cmd = directive.get("run_command")
        if run_cmd:
            subprocess.run(run_cmd, shell=True, check=False)

        result_text = directive.get("result_text", "Done.")
        envelope = {
            "type": "result",
            "subtype": "success",
            "result": result_text,
            "num_turns": 1,
            "total_cost_usd": 0.001,
            "duration_ms": int(delay * 1000),
        }
        # Per-stage structured output. The runner extracts ``structured_output``
        # from the result envelope (orchestrator/runner.py:1058) — directives
        # that set this drive the post-stage pipeline logic
        # (e.g. ``{"passed": True}`` for tester, ``{"outcome": "approve"}``
        # for reviewer). When omitted, the runner reads the raw envelope
        # and ``passed`` / ``outcome`` default to falsy — the pre-W-050
        # behavior, kept for backward compat.
        structured = directive.get("structured_output")
        if structured is not None:
            structured = _substitute_head_placeholder(structured)
            envelope["structured_output"] = structured
        print(json.dumps(envelope))
        sys.stdout.flush()

    elif action == "fail":
        error_msg = directive.get("error", "Mock failure")
        print(json.dumps({
            "type": "result",
            "subtype": "error_max_turns",
            "result": error_msg,
            "num_turns": 1,
            "total_cost_usd": 0.001,
            "duration_ms": int(delay * 1000),
        }))
        sys.stdout.flush()
        sys.exit(1)

    elif action == "hang":
        if hasattr(signal, "pause"):
            signal.pause()
        else:
            time.sleep(3600)

    elif action == "crash":
        os._exit(directive.get("exit_code", 137))

    elif action == "slow":
        slow_s = directive.get("slow_s", 30)
        time.sleep(slow_s)
        print(json.dumps({
            "type": "result",
            "subtype": "success",
            "result": "Done after delay.",
            "num_turns": 1,
            "total_cost_usd": 0.01,
            "duration_ms": int((delay + slow_s) * 1000),
        }))
        sys.stdout.flush()


if __name__ == "__main__":
    main()
