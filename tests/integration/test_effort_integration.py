"""Integration tests for effort mode scenarios (W-052 Phase 18).

Exercises the full pipeline with effort configuration, verifying that
effort levels propagate correctly through settings → runner → env var →
status.json iteration records. Uses the bd stub to serve bead labels.
"""
import json

import pytest

from tests.integration.helpers import make_iteration_scenario  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

BEAD_ID = "bd-test-effort-1"


def _configure_effort(pipeline_env, *, auto_mode="adaptive", auto_cap="xhigh",
                       agents=None, models=None):
    """Patch worca.effort and optionally worca.agents / worca.models."""
    settings_path = pipeline_env.worca_config_path
    settings = json.loads(settings_path.read_text())
    settings["worca"]["effort"] = {"auto_mode": auto_mode, "auto_cap": auto_cap}
    if agents:
        for k, v in agents.items():
            settings["worca"]["agents"].setdefault(k, {}).update(v)
    if models:
        settings["worca"]["models"] = models
    settings_path.write_text(json.dumps(settings, indent=2))


def _bd_responses(bead_id=BEAD_ID, effort_label=None):
    """Build canned bd stub responses for a bead with an optional effort label."""
    labels_parts = []
    if effort_label:
        labels_parts.append(f"worca-effort:{effort_label}")
    labels_line = f"\nLABELS: {','.join(labels_parts)}" if labels_parts else ""
    show_stdout = (
        f"○ {bead_id} · Test bead   [● P2 · OPEN]"
        f"{labels_line}\n"
    )
    ready_stdout = (
        "📋 Ready work (1 issues with no blockers):\n"
        f"1. [● P2] [task] {bead_id}: Test bead\n"
    )
    return {
        f"show {bead_id}": {"stdout": show_stdout, "exit": 0},
        "ready": {"stdout": ready_stdout, "exit": 0},
        "default": {"stdout": "", "exit": 0},
    }


def _setup_beads(pipeline_env, effort_label=None, bead_id=BEAD_ID):
    """Enable the bd stub and write response file with effort label."""
    response_file = pipeline_env.tmp_path / "bd_effort_responses.json"
    response_file.write_text(json.dumps(_bd_responses(bead_id, effort_label)))
    pipeline_env.enable_beads(response_file=response_file)
    return response_file


def _setup_bead_pool(pipeline_env, bead_ids, effort_label=None):
    """Enable the stateful bd stub with a pool of beads (one IMPLEMENT iter each).

    ``bd ready`` serves the beads in order and drops each as it is closed, so
    the runner's Phase-1 loop produces one IMPLEMENT iteration per bead.
    """
    beads_file = pipeline_env.tmp_path / "bd_pool.json"
    beads_file.write_text(json.dumps({
        "beads": [
            {"id": bid, "title": f"Bead {bid}", "effort": effort_label}
            for bid in bead_ids
        ],
    }))
    pipeline_env.enable_beads(beads_file=beads_file)
    return beads_file


def _happy_scenario(*, coord_beads=None, tester_per_iter=None,
                    impl_run_cmd=None, impl_per_iter=None):
    """Build a full-pipeline scenario with coordinator beads and tester outcome.

    All agents succeed. Coordinator returns beads_ids in structured output.
    Tester returns passed=True by default (override via tester_per_iter for
    test-failure loopback tests).
    """
    agents = {}

    # Coordinator
    coord_so = {"beads_ids": coord_beads or []}
    agents["coordinator"] = {
        "action": "succeed",
        "structured_output": coord_so,
    }

    # Implementer
    if impl_per_iter:
        agents["implementer"] = impl_per_iter
    else:
        impl_directive = {
            "action": "succeed",
            "structured_output": {
                "files_changed": ["src/foo.py"],
                "tests_added": ["tests/test_foo.py"],
            },
        }
        if impl_run_cmd:
            impl_directive["run_command"] = impl_run_cmd
        agents["implementer"] = impl_directive

    # Tester
    if tester_per_iter:
        agents["tester"] = tester_per_iter
    else:
        agents["tester"] = {
            "action": "succeed",
            "structured_output": {"passed": True},
        }

    # Reviewer
    agents["reviewer"] = {
        "action": "succeed",
        "structured_output": {"outcome": "approve"},
    }

    # Guardian (PR)
    agents["guardian"] = {
        "action": "succeed",
        "structured_output": {
            "pr_url": "https://github.com/test/test/pull/1",
            "pr_number": 1,
        },
    }

    return make_iteration_scenario(agents, default={"action": "succeed", "delay_s": 0})


def _get_iteration_effort(status, stage, iteration_num):
    """Extract effort dict from a specific iteration record in status.json."""
    stage_data = status.get("stages", {}).get(stage, {})
    iterations = stage_data.get("iterations", [])
    for it in iterations:
        if it.get("number") == iteration_num:
            return it.get("effort")
    return None


# ---------------------------------------------------------------------------
# (a) Adaptive mode — bead label applied to IMPLEMENT
# ---------------------------------------------------------------------------


def test_adaptive_bead_label_applied(pipeline_env):
    """Adaptive mode: coordinator-labeled bead sets implementer effort."""
    _configure_effort(pipeline_env, auto_mode="adaptive", auto_cap="xhigh")
    _setup_beads(pipeline_env, effort_label="high")
    capture_dir = pipeline_env.tmp_path / "effort_capture"
    capture_dir.mkdir()

    scenario = _happy_scenario(
        coord_beads=[BEAD_ID],
        impl_run_cmd=f"echo $CLAUDE_CODE_EFFORT_LEVEL > {capture_dir}/impl_1.txt",
    )
    result = pipeline_env.run(scenario, prompt="adaptive effort test", timeout=60)
    assert result.returncode == 0, f"Pipeline failed: {result.stderr[:500]}"

    eff = _get_iteration_effort(result.status, "implement", 1)
    assert eff is not None, "Effort dict missing from implement iter 1"
    assert eff["level"] == "high"
    assert eff["source"] == "adaptive:llm"
    assert eff["base"] == "high"
    assert eff["bead_classified"]["applied"] is True
    assert eff["bead_classified"]["level"] == "high"
    assert eff["bead_classified"]["skip_reason"] is None
    assert eff["capped_from"] is None

    captured = (capture_dir / "impl_1.txt").read_text().strip()
    assert captured == "high"


# ---------------------------------------------------------------------------
# (b) Adaptive test_failure loopback — escalation
# ---------------------------------------------------------------------------


def test_adaptive_test_failure_escalation(pipeline_env):
    """Adaptive mode: test failure bumps implement effort by +1 rung."""
    _configure_effort(pipeline_env, auto_mode="adaptive", auto_cap="xhigh")
    _setup_beads(pipeline_env, effort_label="high")
    capture_dir = pipeline_env.tmp_path / "effort_capture"
    capture_dir.mkdir()

    scenario = _happy_scenario(
        coord_beads=[BEAD_ID],
        impl_per_iter={
            "iter_1": {
                "action": "succeed",
                "run_command": f"echo $CLAUDE_CODE_EFFORT_LEVEL > {capture_dir}/impl_1.txt",
                "structured_output": {
                    "files_changed": ["src/foo.py"],
                    "tests_added": ["tests/test_foo.py"],
                },
            },
            "iter_2": {
                "action": "succeed",
                "run_command": f"echo $CLAUDE_CODE_EFFORT_LEVEL > {capture_dir}/impl_2.txt",
                "structured_output": {
                    "files_changed": ["src/foo.py"],
                    "tests_added": ["tests/test_foo.py"],
                },
            },
            "default": {
                "action": "succeed",
                "structured_output": {
                    "files_changed": ["src/foo.py"],
                    "tests_added": ["tests/test_foo.py"],
                },
            },
        },
        tester_per_iter={
            "iter_1": {
                "action": "succeed",
                "structured_output": {"passed": False, "failures": [{"test": "test_x"}]},
            },
            "iter_2": {
                "action": "succeed",
                "structured_output": {"passed": True},
            },
        },
    )
    result = pipeline_env.run(scenario, prompt="escalation test", timeout=60)
    assert result.returncode == 0, f"Pipeline failed: {result.stderr[:500]}"

    # Iter 1: base effort from bead label
    eff1 = _get_iteration_effort(result.status, "implement", 1)
    assert eff1 is not None
    assert eff1["level"] == "high"
    assert eff1["source"] == "adaptive:llm"

    # Iter 2: escalated by +1 on Sonnet 4.6 ladder (high → max)
    eff2 = _get_iteration_effort(result.status, "implement", 2)
    assert eff2 is not None
    assert eff2["level"] == "max"
    assert eff2["base"] == "high"
    # Requested is canonical escalation: high +1 = xhigh
    assert eff2["requested"] == "xhigh"

    # Verify env var was set on each iteration
    captured_1 = (capture_dir / "impl_1.txt").read_text().strip()
    assert captured_1 == "high"
    captured_2 = (capture_dir / "impl_2.txt").read_text().strip()
    assert captured_2 == "max"


# ---------------------------------------------------------------------------
# (b2) Multi-bead test_failure loopback — escalation depth excludes Phase-1 fan-out
# ---------------------------------------------------------------------------


def test_adaptive_test_failure_escalation_multibead(pipeline_env):
    """W-052 regression: per-bead Phase-1 iterations must NOT inflate escalation.

    With 3 beads, Phase 1 produces 3 IMPLEMENT iterations (trigger next_bead,
    zero delta). The first test_failure loopback (IMPLEMENT iter 4) must
    escalate by exactly +1 rung (low -> medium on the Sonnet 4.6 ladder), NOT
    by the total iteration count. The pre-fix runner passed
    iter_num = len(prev_iterations) + 1 = 4, escalating low +3 rungs straight
    to max.
    """
    bead_ids = ["bd-eff-a", "bd-eff-b", "bd-eff-c"]
    _configure_effort(pipeline_env, auto_mode="adaptive", auto_cap="xhigh")
    _setup_bead_pool(pipeline_env, bead_ids, effort_label="low")

    scenario = _happy_scenario(
        coord_beads=bead_ids,
        tester_per_iter={
            "iter_1": {
                "action": "succeed",
                "structured_output": {"passed": False, "failures": [{"test": "test_x"}]},
            },
            "iter_2": {
                "action": "succeed",
                "structured_output": {"passed": True},
            },
        },
    )
    result = pipeline_env.run(scenario, prompt="multibead escalation", timeout=120)
    assert result.returncode == 0, f"Pipeline failed: {result.stderr[:500]}"

    # Phase 1: one IMPLEMENT iteration per bead, all at the bead-label base.
    for n in (1, 2, 3):
        eff = _get_iteration_effort(result.status, "implement", n)
        assert eff is not None, f"missing implement iter {n}"
        assert eff["level"] == "low", f"iter {n}: {eff}"
        assert eff["source"] == "adaptive:llm"
        assert eff["escalations"] == []

    # IMPLEMENT iter 4 = first test_failure loopback. Escalation depth is 1
    # (one loopback), so low + 1 rung = "medium" — NOT "max".
    eff4 = _get_iteration_effort(result.status, "implement", 4)
    assert eff4 is not None, "expected a 4th implement iteration (test_failure loopback)"
    assert eff4["base"] == "low"
    assert eff4["level"] == "medium", f"over-escalation regression: {eff4}"
    assert eff4["requested"] == "medium"
    assert eff4["escalations"] == ["test_failure"]
    assert eff4["capped_from"] is None


# ---------------------------------------------------------------------------
# (c) Adaptive with explicit per-agent override — explicit wins
# ---------------------------------------------------------------------------


def test_adaptive_explicit_override(pipeline_env):
    """Explicit per-agent effort overrides bead label in adaptive mode."""
    _configure_effort(
        pipeline_env,
        auto_mode="adaptive", auto_cap="xhigh",
        agents={"implementer": {"effort": "medium"}},
    )
    _setup_beads(pipeline_env, effort_label="high")

    scenario = _happy_scenario(coord_beads=[BEAD_ID])
    result = pipeline_env.run(scenario, prompt="explicit override test", timeout=60)
    assert result.returncode == 0, f"Pipeline failed: {result.stderr[:500]}"

    eff = _get_iteration_effort(result.status, "implement", 1)
    assert eff is not None
    assert eff["level"] == "medium"
    assert eff["source"] == "explicit"
    assert eff["bead_classified"]["applied"] is False
    assert eff["bead_classified"]["skip_reason"] == "explicit_override"
    assert eff["bead_classified"]["level"] == "high"


# ---------------------------------------------------------------------------
# (d) Reactive mode — explicit start, escalation, bead not applied
# ---------------------------------------------------------------------------


def test_reactive_mode_escalation(pipeline_env):
    """Reactive mode: explicit effort as base, escalation on loopback,
    bead label present but not applied."""
    _configure_effort(
        pipeline_env,
        auto_mode="reactive", auto_cap="xhigh",
        agents={"implementer": {"effort": "medium"}},
    )
    _setup_beads(pipeline_env, effort_label="high")
    capture_dir = pipeline_env.tmp_path / "effort_capture"
    capture_dir.mkdir()

    scenario = _happy_scenario(
        coord_beads=[BEAD_ID],
        impl_per_iter={
            "iter_1": {
                "action": "succeed",
                "run_command": f"echo $CLAUDE_CODE_EFFORT_LEVEL > {capture_dir}/impl_1.txt",
                "structured_output": {
                    "files_changed": ["src/foo.py"],
                    "tests_added": ["tests/test_foo.py"],
                },
            },
            "iter_2": {
                "action": "succeed",
                "run_command": f"echo $CLAUDE_CODE_EFFORT_LEVEL > {capture_dir}/impl_2.txt",
                "structured_output": {
                    "files_changed": ["src/foo.py"],
                    "tests_added": ["tests/test_foo.py"],
                },
            },
            "default": {
                "action": "succeed",
                "structured_output": {
                    "files_changed": ["src/foo.py"],
                    "tests_added": ["tests/test_foo.py"],
                },
            },
        },
        tester_per_iter={
            "iter_1": {
                "action": "succeed",
                "structured_output": {"passed": False, "failures": [{"test": "test_y"}]},
            },
            "iter_2": {
                "action": "succeed",
                "structured_output": {"passed": True},
            },
        },
    )
    result = pipeline_env.run(scenario, prompt="reactive mode test", timeout=60)
    assert result.returncode == 0, f"Pipeline failed: {result.stderr[:500]}"

    # Iter 1: explicit effort, bead not applied
    eff1 = _get_iteration_effort(result.status, "implement", 1)
    assert eff1 is not None
    assert eff1["level"] == "medium"
    assert eff1["source"] == "reactive"
    assert eff1["bead_classified"]["applied"] is False

    # Iter 2: escalated from medium +1 = high
    eff2 = _get_iteration_effort(result.status, "implement", 2)
    assert eff2 is not None
    assert eff2["level"] == "high"
    assert eff2["source"] == "reactive"

    captured_1 = (capture_dir / "impl_1.txt").read_text().strip()
    assert captured_1 == "medium"
    captured_2 = (capture_dir / "impl_2.txt").read_text().strip()
    assert captured_2 == "high"


# ---------------------------------------------------------------------------
# (e) Disabled mode — no escalation
# ---------------------------------------------------------------------------


def test_disabled_mode_no_escalation(pipeline_env):
    """Disabled mode: explicit effort in env, no escalation on loopback."""
    _configure_effort(
        pipeline_env,
        auto_mode="disabled", auto_cap="xhigh",
        agents={"implementer": {"effort": "high"}},
    )
    _setup_beads(pipeline_env, effort_label="high")
    capture_dir = pipeline_env.tmp_path / "effort_capture"
    capture_dir.mkdir()

    scenario = _happy_scenario(
        coord_beads=[BEAD_ID],
        impl_per_iter={
            "iter_1": {
                "action": "succeed",
                "run_command": f"echo $CLAUDE_CODE_EFFORT_LEVEL > {capture_dir}/impl_1.txt",
                "structured_output": {
                    "files_changed": ["src/foo.py"],
                    "tests_added": ["tests/test_foo.py"],
                },
            },
            "iter_2": {
                "action": "succeed",
                "run_command": f"echo $CLAUDE_CODE_EFFORT_LEVEL > {capture_dir}/impl_2.txt",
                "structured_output": {
                    "files_changed": ["src/foo.py"],
                    "tests_added": ["tests/test_foo.py"],
                },
            },
            "default": {
                "action": "succeed",
                "structured_output": {
                    "files_changed": ["src/foo.py"],
                    "tests_added": ["tests/test_foo.py"],
                },
            },
        },
        tester_per_iter={
            "iter_1": {
                "action": "succeed",
                "structured_output": {"passed": False, "failures": [{"test": "test_z"}]},
            },
            "iter_2": {
                "action": "succeed",
                "structured_output": {"passed": True},
            },
        },
    )
    result = pipeline_env.run(scenario, prompt="disabled mode test", timeout=60)
    assert result.returncode == 0, f"Pipeline failed: {result.stderr[:500]}"

    eff1 = _get_iteration_effort(result.status, "implement", 1)
    assert eff1 is not None
    assert eff1["level"] == "high"
    assert eff1["source"] == "disabled"

    # Iter 2: same effort, NO escalation
    eff2 = _get_iteration_effort(result.status, "implement", 2)
    assert eff2 is not None
    assert eff2["level"] == "high"
    assert eff2["source"] == "disabled"

    captured_1 = (capture_dir / "impl_1.txt").read_text().strip()
    assert captured_1 == "high"
    captured_2 = (capture_dir / "impl_2.txt").read_text().strip()
    assert captured_2 == "high"


# ---------------------------------------------------------------------------
# (f) Coordinator emits labels under all modes
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("mode", ["adaptive", "reactive", "disabled"])
def test_coordinator_emits_labels_all_modes(mode, pipeline_env):
    """Post-COORDINATE unlabeled bead warning absent when label is present."""
    _configure_effort(pipeline_env, auto_mode=mode)
    _setup_beads(pipeline_env, effort_label="medium")

    scenario = _happy_scenario(coord_beads=[BEAD_ID])
    result = pipeline_env.run(scenario, prompt=f"labels-{mode}", timeout=60)
    assert result.returncode == 0, f"Pipeline failed: {result.stderr[:500]}"

    # No "missing worca-effort label" warning when label is present
    assert "missing worca-effort label" not in result.stderr


# ---------------------------------------------------------------------------
# (g) Pre-set bead label preserved by coordinator
# ---------------------------------------------------------------------------


def test_preset_bead_label_preserved(pipeline_env):
    """A bead that already has a worca-effort label keeps it through the run."""
    _configure_effort(pipeline_env, auto_mode="adaptive", auto_cap="xhigh")
    _setup_beads(pipeline_env, effort_label="low")

    scenario = _happy_scenario(coord_beads=[BEAD_ID])
    result = pipeline_env.run(scenario, prompt="preset label test", timeout=60)
    assert result.returncode == 0, f"Pipeline failed: {result.stderr[:500]}"

    eff = _get_iteration_effort(result.status, "implement", 1)
    assert eff is not None
    assert eff["level"] == "low"
    assert eff["source"] == "adaptive:llm"
    assert eff["bead_classified"]["level"] == "low"
    assert eff["bead_classified"]["applied"] is True


# ---------------------------------------------------------------------------
# (h) Auto_cap clamping
# ---------------------------------------------------------------------------


def test_auto_cap_clamping(pipeline_env):
    """auto_cap clamps effort at the configured ceiling."""
    _configure_effort(
        pipeline_env,
        auto_mode="adaptive", auto_cap="medium",
    )
    _setup_beads(pipeline_env, effort_label="high")

    scenario = _happy_scenario(coord_beads=[BEAD_ID])
    result = pipeline_env.run(scenario, prompt="cap clamp test", timeout=60)
    assert result.returncode == 0, f"Pipeline failed: {result.stderr[:500]}"

    eff = _get_iteration_effort(result.status, "implement", 1)
    assert eff is not None
    assert eff["level"] == "medium"
    assert eff["capped_from"] == "high"
    assert eff["bead_classified"]["level"] == "high"
    assert eff["bead_classified"]["applied"] is True


# ---------------------------------------------------------------------------
# (i) Missing bead label warning (pipeline continues)
# ---------------------------------------------------------------------------


def test_missing_bead_label_warning(pipeline_env):
    """Missing worca-effort label emits warning, pipeline still completes."""
    _configure_effort(pipeline_env, auto_mode="adaptive")
    # Bead WITHOUT effort label
    _setup_beads(pipeline_env, effort_label=None)

    scenario = _happy_scenario(coord_beads=[BEAD_ID])
    result = pipeline_env.run(scenario, prompt="missing label test", timeout=60)
    assert result.returncode == 0, f"Pipeline failed: {result.stderr[:500]}"

    assert "missing worca-effort label" in result.stderr

    # Effort falls back to model_default (level=None → env var not set)
    eff = _get_iteration_effort(result.status, "implement", 1)
    assert eff is not None
    assert eff["source"] == "model_default"


# ---------------------------------------------------------------------------
# (j) Model collapse — planner xhigh on Opus 4.6
# ---------------------------------------------------------------------------


def test_model_collapse_planner_opus46(pipeline_env):
    """Planner with effort=xhigh on Opus 4.6 collapses to high."""
    _configure_effort(
        pipeline_env,
        auto_mode="adaptive", auto_cap="xhigh",
        agents={"planner": {"effort": "xhigh", "model": "opus"}},
        models={"opus": "claude-opus-4-6"},
    )

    scenario = _happy_scenario()
    result = pipeline_env.run(scenario, prompt="model collapse test", timeout=60)
    assert result.returncode == 0, f"Pipeline failed: {result.stderr[:500]}"

    eff = _get_iteration_effort(result.status, "plan", 1)
    assert eff is not None
    assert eff["level"] == "high"
    assert eff["requested"] == "xhigh"


# ---------------------------------------------------------------------------
# (k) Sonnet 4.6 test_failure escalation high → max (one rung)
# ---------------------------------------------------------------------------


def test_sonnet46_high_to_max_escalation(pipeline_env):
    """On Sonnet 4.6 (4-rung ladder), high +1 escalation jumps to max."""
    _configure_effort(pipeline_env, auto_mode="adaptive", auto_cap="xhigh")
    _setup_beads(pipeline_env, effort_label="high")

    scenario = _happy_scenario(
        coord_beads=[BEAD_ID],
        impl_per_iter={
            "iter_1": {
                "action": "succeed",
                "structured_output": {
                    "files_changed": ["src/foo.py"],
                    "tests_added": ["tests/test_foo.py"],
                },
            },
            "iter_2": {
                "action": "succeed",
                "structured_output": {
                    "files_changed": ["src/foo.py"],
                    "tests_added": ["tests/test_foo.py"],
                },
            },
            "default": {
                "action": "succeed",
                "structured_output": {
                    "files_changed": ["src/foo.py"],
                    "tests_added": ["tests/test_foo.py"],
                },
            },
        },
        tester_per_iter={
            "iter_1": {
                "action": "succeed",
                "structured_output": {"passed": False, "failures": [{"test": "t1"}]},
            },
            "iter_2": {
                "action": "succeed",
                "structured_output": {"passed": True},
            },
        },
    )
    result = pipeline_env.run(scenario, prompt="sonnet escalation test", timeout=60)
    assert result.returncode == 0, f"Pipeline failed: {result.stderr[:500]}"

    eff2 = _get_iteration_effort(result.status, "implement", 2)
    assert eff2 is not None
    # Sonnet 4.6 ladder: low, medium, high, max — high +1 = max
    assert eff2["level"] == "max"
    # Canonical requested: high +1 = xhigh
    assert eff2["requested"] == "xhigh"
    assert eff2["base"] == "high"
    # auto_cap xhigh rounds up to max on Sonnet 4.6, so no clamping
    assert eff2["capped_from"] is None
