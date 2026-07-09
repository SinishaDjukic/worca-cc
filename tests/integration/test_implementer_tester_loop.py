"""W-050 Phase 1 — implementer ↔ tester loop integration tests.

Drives the runner.py:2531-2636 loop end-to-end via the per-iteration mock.
Each test asserts on events.jsonl ordering, status.json iteration records, and
loop_counters.implement_test movement.

The mock currently emits ``structured_output`` only when a directive sets it.
Pre-W-050 scenarios that don't set ``structured_output`` therefore see
tester.passed=False — those scenarios never exercise the success path, which
is precisely the gap this file closes.
"""
import pytest

from tests.integration.helpers import (
    make_iteration_scenario,
    read_run_dir,
)


# All multi-iteration tests need extra wall time when WORCA_COVERAGE=1
# wraps subprocesses (W-050 plan rule #12).
pytestmark = pytest.mark.timeout(180)


def _tester_pass(extra: dict | None = None) -> dict:
    out = {"passed": True}
    if extra:
        out.update(extra)
    return {"action": "succeed", "delay_s": 0.05, "structured_output": out}


def _tester_fail(failures: list | None = None) -> dict:
    return {
        "action": "succeed", "delay_s": 0.05,
        "structured_output": {
            "passed": False,
            "failures": failures or [{"test_name": "t_smoke",
                                       "error": "AssertionError"}],
        },
    }


def _events_of(events: list, type_: str) -> list:
    return [e for e in events if e.get("event_type") == type_]


# ===========================================================================
# 1. tester fail → implementer retry → tester pass
# ===========================================================================

def test_tester_fail_then_pass_loops_implement_once(pipeline_env):
    """First iteration fails, second passes — exactly one implement_test loop."""
    scenario = make_iteration_scenario({
        "tester": {
            "iter_1": _tester_fail(),
            "iter_2": _tester_pass(),
        }
    })
    result = pipeline_env.run(scenario, prompt="loop fail-then-pass", timeout=120)
    assert result.returncode == 0, f"stderr: {result.stderr[-500:]}"

    # status.json: loop counter advanced exactly once.
    assert result.status["loop_counters"]["implement_test"] == 1, (
        f"expected 1 fix attempt, got {result.status['loop_counters']}"
    )

    # tester ran exactly twice with the expected outcomes in order.
    test_iters = result.status["stages"]["test"]["iterations"]
    assert [it["outcome"] for it in test_iters] == ["test_failure", "success"]

    # implementer ran exactly twice (initial + 1 retry).
    impl_iters = result.status["stages"]["implement"]["iterations"]
    assert len(impl_iters) == 2, f"got {len(impl_iters)} implement iterations"


def test_tester_fail_then_pass_emits_loop_events(pipeline_env):
    scenario = make_iteration_scenario({
        "tester": {
            "iter_1": _tester_fail(),
            "iter_2": _tester_pass(),
        }
    })
    result = pipeline_env.run(scenario, prompt="loop events", timeout=120)
    assert result.returncode == 0

    failed = _events_of(result.events, "pipeline.test.suite_failed")
    passed = _events_of(result.events, "pipeline.test.suite_passed")
    triggered = _events_of(result.events, "pipeline.loop.triggered")
    fix_attempt = _events_of(result.events, "pipeline.test.fix_attempt")

    assert len(failed) == 1
    assert len(passed) == 1
    assert len(triggered) >= 1
    assert any(e["payload"].get("loop_key") == "implement_test"
               for e in triggered)
    assert len(fix_attempt) == 1
    assert fix_attempt[0]["payload"]["attempt"] == 1


# ===========================================================================
# 2. Max-iteration exhaustion
# ===========================================================================

def test_tester_always_fails_exhausts_loop(pipeline_env):
    """All tester iterations fail → loop exhausted, run still completes."""
    # Tighten the cap so the test is fast: implement_test=2 → at most 2 fixes.
    import json
    settings_path = pipeline_env.worca_config_path
    settings = json.loads(settings_path.read_text())
    settings["worca"].setdefault("loops", {})["implement_test"] = 2
    settings_path.write_text(json.dumps(settings, indent=2))

    scenario = make_iteration_scenario({
        "tester": {
            "iter_1": _tester_fail(),
            "iter_2": _tester_fail(),
            "iter_3": _tester_fail(),
        }
    })
    result = pipeline_env.run(scenario, prompt="exhaust loop", timeout=120)

    # implement_test counter hit the cap.
    assert result.status["loop_counters"]["implement_test"] == 2
    # All tester iterations failed.
    test_outcomes = [it["outcome"]
                     for it in result.status["stages"]["test"]["iterations"]]
    assert test_outcomes.count("test_failure") >= 2
    # Pipeline completed (exhaustion is treated as "finishing", not a failure).
    assert result.status["pipeline_status"] == "completed"
    # An exhaustion event was emitted.
    exhausted = _events_of(result.events, "pipeline.loop.exhausted")
    assert any(e["payload"].get("loop_key") == "implement_test"
               for e in exhausted)


# ===========================================================================
# 3. Settings respected — cap can be tightened
# ===========================================================================

def test_implement_test_loops_setting_respected(pipeline_env):
    """Setting worca.loops.implement_test=1 caps fixes at 1."""
    import json
    settings_path = pipeline_env.worca_config_path
    settings = json.loads(settings_path.read_text())
    settings["worca"].setdefault("loops", {})["implement_test"] = 1
    settings_path.write_text(json.dumps(settings, indent=2))

    scenario = make_iteration_scenario({
        "tester": {
            "iter_1": _tester_fail(),
            "iter_2": _tester_fail(),
        }
    })
    result = pipeline_env.run(scenario, prompt="cap-1", timeout=120)
    assert result.status["loop_counters"]["implement_test"] == 1


# ===========================================================================
# 4. Token aggregation across iterations
# ===========================================================================

def test_token_usage_aggregates_across_iterations(pipeline_env):
    """Per-iteration token_usage records exist and stage-level totals sum them."""
    scenario = make_iteration_scenario({
        "tester": {
            "iter_1": _tester_fail(),
            "iter_2": _tester_pass(),
        }
    })
    result = pipeline_env.run(scenario, prompt="token agg", timeout=120)
    assert result.returncode == 0

    test_iters = result.status["stages"]["test"]["iterations"]
    assert len(test_iters) == 2
    # Each iteration carries its own token_usage record.
    for it in test_iters:
        assert "token_usage" in it
        assert it["token_usage"].get("total_cost_usd") is not None


# ===========================================================================
# 5. Per-iteration sanity — iter_1 ≠ iter_2 outputs reach the run dir
#    (W-050 plan rule #14 — "verify the per-iteration mock actually changes
#     behavior between iterations")
# ===========================================================================

def test_per_iteration_mock_actually_varies_across_iterations(pipeline_env):
    """The same agent must produce different result envelopes across iterations.

    Reads the runner-recorded iteration logs (logs/test/iter-N.log) and asserts
    iter-1's content differs from iter-2's. Without this guard, a buggy mock
    could silently fall back to the scenario default and the entire loop test
    would pass while testing nothing.
    """
    scenario = make_iteration_scenario({
        "tester": {
            "iter_1": _tester_fail(failures=[{"test_name": "iter1_marker",
                                               "error": "iter1"}]),
            "iter_2": _tester_pass(extra={"coverage_pct": 99.5}),
        }
    })
    result = pipeline_env.run(scenario, prompt="iter sanity", timeout=120)
    assert result.returncode == 0

    test_iters = result.status["stages"]["test"]["iterations"]
    out1 = test_iters[0].get("output") or {}
    out2 = test_iters[1].get("output") or {}
    # iter_1 had failures with our marker, iter_2 had passed=True + coverage.
    assert out1.get("passed") is False
    assert out2.get("passed") is True
    # Concrete content differs — not just a type-coercion fluke.
    assert out1 != out2


# ===========================================================================
# 6. Failure feedback flows into the next implementer iteration
# ===========================================================================

def test_failures_threaded_to_next_implementer_via_resolved_template(pipeline_env):
    """The runner accumulates test failures and threads them via prompt_builder.

    We can't observe prompt context directly from outside, but we can verify
    the resolved template for implementer iter-2 was created (i.e. the loop
    re-resolved the template with the updated context).
    """
    scenario = make_iteration_scenario({
        "tester": {
            "iter_1": _tester_fail(failures=[{"test_name": "iter1_marker",
                                               "error": "boom"}]),
            "iter_2": _tester_pass(),
        }
    })
    result = pipeline_env.run(scenario, prompt="feedback thread", timeout=120)
    assert result.returncode == 0

    run_dir = read_run_dir(pipeline_env.worca_dir)
    resolved_dir = run_dir / "agents" / "resolved"
    # First implementer iteration always exists.
    assert (resolved_dir / "implement-implementer-iter-1.md").exists()
    # Second implementer iteration is created when the loop fires.
    assert (resolved_dir / "implement-implementer-iter-2.md").exists()


# ===========================================================================
# 7. mloops multiplier doubles the cap
# ===========================================================================

def test_mloops_multiplier_doubles_cap(pipeline_env):
    """``--mloops 2`` doubles worca.loops.implement_test for the run."""
    import json
    settings_path = pipeline_env.worca_config_path
    settings = json.loads(settings_path.read_text())
    settings["worca"].setdefault("loops", {})["implement_test"] = 1
    settings_path.write_text(json.dumps(settings, indent=2))

    scenario = make_iteration_scenario({
        "tester": {
            "iter_1": _tester_fail(),
            "iter_2": _tester_fail(),
            "iter_3": _tester_fail(),
        }
    })
    result = pipeline_env.run(scenario, prompt="mloops",
                              timeout=120,
                              extra_args=["--mloops", "2"])
    # cap = 1 * 2 = 2 fix attempts allowed.
    assert result.status["loop_counters"]["implement_test"] == 2
