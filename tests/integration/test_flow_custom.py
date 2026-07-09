"""W-070 — custom declarative flow integration tests.

Drives the runner end-to-end (mock claude) under a user-supplied ``worca.flow``
with (a) an optional stage reordered to a non-default position and (b) a
redirected loop target. Asserts the pipeline completes and ``status.json``
stage keys match the flow names verbatim.
"""
import json

import pytest

from tests.integration.helpers import (
    assert_stage_sequence,
    make_iteration_scenario,
)

pytestmark = pytest.mark.timeout(180)


# plan_review is moved AFTER coordinate (reordered optional stage) and the
# test_failure loop is redirected to re-run the tester itself ("retest")
# instead of looping back to implement.
_CUSTOM_FLOW = {
    "version": 1,
    "stages": [
        {"name": "plan"},
        {"name": "coordinate"},
        {"name": "plan_review", "enabled": True},
        {
            "name": "implement",
            "on": {"next_bead": {"goto": "implement", "loop": "bead_iteration"}},
        },
        {
            "name": "test",
            "on": {"test_failure": {"goto": "test", "loop": "retest"}},
        },
        {"name": "review"},
        {"name": "pr"},
    ],
}


def _set_flow(pipeline_env, flow_doc):
    settings_path = pipeline_env.worca_config_path
    settings = json.loads(settings_path.read_text())
    settings["worca"]["flow"] = flow_doc
    settings_path.write_text(json.dumps(settings, indent=2))


def _scenario_fail_then_pass():
    return make_iteration_scenario({
        "plan_reviewer": {
            "default": {
                "action": "succeed", "delay_s": 0.05,
                "structured_output": {"outcome": "approve", "issues": []},
            },
        },
        "tester": {
            "iter_1": {
                "action": "succeed", "delay_s": 0.05,
                "structured_output": {
                    "passed": False,
                    "failures": [{"test_name": "t_flaky", "error": "boom"}],
                },
            },
            "iter_2": {
                "action": "succeed", "delay_s": 0.05,
                "structured_output": {"passed": True},
            },
        },
    })


def test_custom_flow_reorder_and_redirected_loop_completes(pipeline_env):
    """Reordered plan_review + test_failure→test self-loop runs to completion."""
    _set_flow(pipeline_env, _CUSTOM_FLOW)
    result = pipeline_env.run(_scenario_fail_then_pass(),
                              prompt="custom flow run", timeout=120)
    assert result.returncode == 0, f"stderr: {result.stderr[-500:]}"
    assert result.status["pipeline_status"] == "completed"

    # Stages executed in the FLOW's order — plan_review after coordinate.
    assert_stage_sequence(result.events, [
        "plan", "coordinate", "plan_review", "implement", "test", "review", "pr",
    ])

    # status.json stage keys match flow names verbatim (stage keys, never
    # agent names).
    stage_keys = set(result.status["stages"])
    assert {"plan", "coordinate", "plan_review", "implement", "test",
            "review", "pr"} <= stage_keys
    assert "plan_reviewer" not in stage_keys
    assert "guardian" not in stage_keys


def test_custom_flow_redirected_loop_uses_declared_counter(pipeline_env):
    """The redirected loop increments its own counter and never re-enters
    implement: tester fails iter-1, retries itself, passes iter-2."""
    _set_flow(pipeline_env, _CUSTOM_FLOW)
    result = pipeline_env.run(_scenario_fail_then_pass(),
                              prompt="redirected loop", timeout=120)
    assert result.returncode == 0, f"stderr: {result.stderr[-500:]}"

    # Declared loop key, not the builtin implement_test.
    assert result.status["loop_counters"].get("retest") == 1
    assert "implement_test" not in result.status["loop_counters"]

    # test ran twice (fail → pass); implement ran exactly once.
    test_iters = result.status["stages"]["test"]["iterations"]
    assert [it["outcome"] for it in test_iters] == ["test_failure", "success"]
    impl_iters = result.status["stages"]["implement"]["iterations"]
    assert len(impl_iters) == 1, f"redirect leaked back into implement: {len(impl_iters)}"


def test_custom_flow_fingerprint_persisted(pipeline_env):
    """A custom-flow run records flow_fingerprint in status.json."""
    _set_flow(pipeline_env, _CUSTOM_FLOW)
    result = pipeline_env.run(_scenario_fail_then_pass(),
                              prompt="fingerprint persisted", timeout=120)
    assert result.returncode == 0
    assert len(result.status.get("flow_fingerprint", "")) == 64


def test_invalid_flow_fails_at_launch(pipeline_env):
    """A flow naming an unknown goto target fails before any stage runs."""
    bad_flow = {
        "version": 1,
        "stages": [
            {"name": "plan"},
            {"name": "test", "on": {"test_failure": {"goto": "nonexistent",
                                                      "loop": "retest"}}},
            {"name": "pr"},
        ],
    }
    _set_flow(pipeline_env, bad_flow)
    scenario = make_iteration_scenario({})
    result = pipeline_env.run(scenario, prompt="invalid flow", timeout=120)
    assert result.returncode != 0
    assert "nonexistent" in (result.stderr + result.stdout)
    # No stage ever started.
    stages = result.status.get("stages", {}) if result.status else {}
    assert not any(s.get("status") == "completed" for s in stages.values())
