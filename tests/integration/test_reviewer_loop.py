"""W-050 Phase 1 — reviewer ↔ implementer loop integration tests.

Drives the runner.py:2638-2733 loop end-to-end. The reviewer outcome is parsed
from ``result.outcome`` (review.json schema). Only ``critical`` / ``major``
severity issues trigger the loop back to IMPLEMENT (runner.py:2682).

To exercise the reviewer loop cleanly we keep tester always passing — otherwise
the implement_test loop would fire first and exhaust before review runs.
"""
import json

import pytest

from tests.integration.helpers import read_run_dir


pytestmark = pytest.mark.timeout(180)


def _tester_always_pass() -> dict:
    """Flat tester directive — every iteration passes. Avoids implement_test loops."""
    return {"action": "succeed", "delay_s": 0.05,
            "structured_output": {"passed": True}}


def _review_revise(severity: str = "critical",
                   description: str = "needs error handling") -> dict:
    return {
        "action": "succeed", "delay_s": 0.05,
        "structured_output": {
            "outcome": "request_changes",
            "issues": [{"severity": severity, "description": description}],
        },
    }


def _review_approve() -> dict:
    return {"action": "succeed", "delay_s": 0.05,
            "structured_output": {"outcome": "approve", "issues": []}}


def _events_of(events: list, type_: str) -> list:
    return [e for e in events if e.get("event_type") == type_]


# ===========================================================================
# 1. revise → approve
# ===========================================================================

def test_reviewer_revise_then_approve_loops_once(pipeline_env):
    """First review requests changes, second approves — exactly one pr_changes loop."""
    scenario = {
        "agents": {
            "tester": _tester_always_pass(),
            "reviewer": {
                "iter_1": _review_revise(),
                "iter_2": _review_approve(),
            },
        },
        "default": {"action": "succeed", "delay_s": 0.05},
    }
    result = pipeline_env.run(scenario, prompt="reviewer revise-approve",
                              timeout=120)
    assert result.returncode == 0, f"stderr: {result.stderr[-500:]}"

    assert result.status["loop_counters"]["pr_changes"] == 1, (
        f"expected 1 review-fix attempt, got {result.status['loop_counters']}"
    )
    review_outcomes = [it["outcome"]
                       for it in result.status["stages"]["review"]["iterations"]]
    assert review_outcomes == ["request_changes", "approve"]


def test_reviewer_revise_then_approve_emits_events(pipeline_env):
    scenario = {
        "agents": {
            "tester": _tester_always_pass(),
            "reviewer": {
                "iter_1": _review_revise(),
                "iter_2": _review_approve(),
            },
        },
        "default": {"action": "succeed", "delay_s": 0.05},
    }
    result = pipeline_env.run(scenario, prompt="reviewer events", timeout=120)
    assert result.returncode == 0

    verdicts = _events_of(result.events, "pipeline.review.verdict")
    fix_attempts = _events_of(result.events, "pipeline.review.fix_attempt")
    triggered = _events_of(result.events, "pipeline.loop.triggered")

    # Two review verdicts in order.
    assert [v["payload"]["outcome"] for v in verdicts] == [
        "request_changes", "approve",
    ]
    assert len(fix_attempts) == 1
    # The pr_changes loop fired exactly once.
    pr_triggered = [e for e in triggered
                    if e["payload"].get("loop_key") == "pr_changes"]
    assert len(pr_triggered) == 1


# ===========================================================================
# 2. Review loop exhaustion
# ===========================================================================

def test_reviewer_always_revises_exhausts_pr_changes_loop(pipeline_env):
    settings_path = pipeline_env.worca_config_path
    settings = json.loads(settings_path.read_text())
    settings["worca"].setdefault("loops", {})["pr_changes"] = 2
    settings_path.write_text(json.dumps(settings, indent=2))

    scenario = {
        "agents": {
            "tester": _tester_always_pass(),
            "reviewer": {
                "iter_1": _review_revise(),
                "iter_2": _review_revise(),
                "iter_3": _review_revise(),
            },
        },
        "default": {"action": "succeed", "delay_s": 0.05},
    }
    result = pipeline_env.run(scenario, prompt="reviewer exhaust", timeout=120)

    assert result.status["loop_counters"]["pr_changes"] == 2
    assert result.status["pipeline_status"] == "completed"
    exhausted = _events_of(result.events, "pipeline.loop.exhausted")
    assert any(e["payload"].get("loop_key") == "pr_changes" for e in exhausted)


# ===========================================================================
# 3. Minor/suggestion issues do NOT trigger the loop (severity gate)
# ===========================================================================

def test_minor_issues_treated_as_approve_no_loop(pipeline_env):
    """request_changes with only minor severity → no pr_changes loop fires."""
    scenario = {
        "agents": {
            "tester": _tester_always_pass(),
            "reviewer": _review_revise(severity="minor",
                                        description="docstring typo"),
        },
        "default": {"action": "succeed", "delay_s": 0.05},
    }
    result = pipeline_env.run(scenario, prompt="minor only", timeout=120)
    assert result.returncode == 0
    # No pr_changes loop — the counter was never set.
    assert result.status["loop_counters"].get("pr_changes", 0) == 0


# ===========================================================================
# 4. Per-iteration sanity — review feedback differs across iterations
#    (W-050 plan rule #14)
# ===========================================================================

def test_review_feedback_differs_across_iterations(pipeline_env):
    """The runner must see different review outputs per iteration."""
    scenario = {
        "agents": {
            "tester": _tester_always_pass(),
            "reviewer": {
                "iter_1": _review_revise(description="iter1_marker"),
                "iter_2": _review_approve(),
            },
        },
        "default": {"action": "succeed", "delay_s": 0.05},
    }
    result = pipeline_env.run(scenario, prompt="review sanity", timeout=120)
    assert result.returncode == 0

    review_iters = result.status["stages"]["review"]["iterations"]
    out1 = review_iters[0].get("output") or {}
    out2 = review_iters[1].get("output") or {}
    assert out1.get("outcome") == "request_changes"
    assert out2.get("outcome") == "approve"
    assert out1 != out2

    # Resolved templates for both iterations exist on disk.
    run_dir = read_run_dir(pipeline_env.worca_dir)
    resolved = run_dir / "agents" / "resolved"
    assert (resolved / "review-reviewer-iter-1.md").exists()
    assert (resolved / "review-reviewer-iter-2.md").exists()


# ===========================================================================
# 5. mloops multiplier doubles the review-fix cap
# ===========================================================================

def test_mloops_multiplier_doubles_pr_changes_cap(pipeline_env):
    settings_path = pipeline_env.worca_config_path
    settings = json.loads(settings_path.read_text())
    settings["worca"].setdefault("loops", {})["pr_changes"] = 1
    settings_path.write_text(json.dumps(settings, indent=2))

    scenario = {
        "agents": {
            "tester": _tester_always_pass(),
            "reviewer": {
                "iter_1": _review_revise(),
                "iter_2": _review_revise(),
                "iter_3": _review_revise(),
            },
        },
        "default": {"action": "succeed", "delay_s": 0.05},
    }
    result = pipeline_env.run(scenario, prompt="reviewer mloops", timeout=120,
                              extra_args=["--mloops", "2"])
    # 1 * 2 = 2 review fix attempts allowed.
    assert result.status["loop_counters"]["pr_changes"] == 2
