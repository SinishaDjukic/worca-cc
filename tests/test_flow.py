"""Tests for the declarative pipeline flow spec (W-070).

Parity suite: the compiled default flow must reproduce STAGE_ORDER,
STAGE_AGENT_MAP, STAGE_SCHEMA_MAP, runner._STAGE_BLOCK_MAP, and the five
loopback transitions exactly — table-driven against the runner literals.

Validation suite: every FlowError branch in load_flow.
"""
import json

import pytest

from worca.orchestrator.flow import (
    FlowError,
    Transition,
    compile_default_flow,
    load_flow,
    resolve_loop_limit,
)
from worca.orchestrator.stages import (
    STAGE_AGENT_MAP,
    STAGE_ORDER,
    STAGE_SCHEMA_MAP,
    Stage,
    get_enabled_stages,
)


def _write_settings(tmp_path, worca: dict) -> str:
    settings_path = tmp_path / "settings.json"
    settings_path.write_text(json.dumps({"worca": worca}))
    return str(settings_path)


def _install_runtime(tmp_path, agents=("planner", "plan_reviewer", "coordinator",
                                        "implementer", "tester", "reviewer",
                                        "guardian", "learner"),
                     schemas=("plan.json", "plan_review.json", "coordinate.json",
                              "implement.json", "test_result.json", "review.json",
                              "pr.json", "learn.json")):
    """Materialize a minimal .claude/worca runtime tree for file-existence checks."""
    core = tmp_path / ".claude" / "worca" / "agents" / "core"
    core.mkdir(parents=True)
    for a in agents:
        (core / f"{a}.md").write_text(f"# {a}")
    schema_dir = tmp_path / ".claude" / "worca" / "schemas"
    schema_dir.mkdir(parents=True)
    for s in schemas:
        (schema_dir / s).write_text("{}")
    return tmp_path


# --- Default flow parity ---

class TestDefaultFlowParity:
    def test_default_flow_matches_legacy_order(self, tmp_path):
        settings = _write_settings(tmp_path, {})
        flow = compile_default_flow(settings)
        # stages = enabled, non-post — must match get_enabled_stages exactly
        assert [s.name for s in flow.stages] == [s.value for s in get_enabled_stages(settings)]

    def test_default_flow_all_stages_cover_enum(self, tmp_path):
        settings = _write_settings(tmp_path, {})
        flow = compile_default_flow(settings)
        expected = [s.value for s in STAGE_ORDER] + [Stage.LEARN.value]
        assert [s.name for s in flow.all_stages] == expected

    def test_default_flow_agents_match_map(self, tmp_path):
        settings = _write_settings(tmp_path, {})
        flow = compile_default_flow(settings)
        by_name = {s.name: s for s in flow.all_stages}
        for stage, agent in STAGE_AGENT_MAP.items():
            assert by_name[stage.value].agent == agent

    def test_default_flow_schemas_match_map(self, tmp_path):
        settings = _write_settings(tmp_path, {})
        flow = compile_default_flow(settings)
        by_name = {s.name: s for s in flow.all_stages}
        for stage, schema in STAGE_SCHEMA_MAP.items():
            assert by_name[stage.value].schema == schema

    def test_default_flow_blocks_match_default_map(self, tmp_path):
        # The runner-local _STAGE_BLOCK_MAP was retired in W-071 — the loop
        # now consumes FlowStage.prompt_block, so DEFAULT_STAGE_BLOCKS is the
        # single source of truth for the builtin block names.
        from worca.orchestrator.flow import DEFAULT_STAGE_BLOCKS
        settings = _write_settings(tmp_path, {})
        flow = compile_default_flow(settings)
        by_name = {s.name: s for s in flow.all_stages}
        for stage in list(STAGE_ORDER) + [Stage.LEARN]:
            expected = DEFAULT_STAGE_BLOCKS.get(stage.value)
            assert by_name[stage.value].prompt_block == expected

    def test_default_flow_transitions_match_jump_sites(self, tmp_path):
        """The five hardcoded jump sites in runner.py, as transition literals."""
        settings = _write_settings(
            tmp_path, {"stages": {"plan_review": {"enabled": True}}}
        )
        flow = compile_default_flow(settings)
        by_name = {s.name: s for s in flow.all_stages}
        assert by_name["plan_review"].on == {
            "plan_review_revise": Transition(goto="plan", loop="plan_review"),
        }
        assert by_name["implement"].on == {
            "next_bead": Transition(goto="implement", loop="bead_iteration"),
        }
        assert by_name["test"].on == {
            "test_failure": Transition(goto="implement", loop="implement_test"),
        }
        assert by_name["review"].on == {
            "review_changes": Transition(goto="implement", loop="pr_changes"),
            "restart_planning": Transition(goto="plan", loop="restart_planning"),
        }
        assert by_name["plan"].on == {}
        assert by_name["pr"].on == {}

    def test_default_flow_disabled_defaults(self, tmp_path):
        settings = _write_settings(tmp_path, {})
        flow = compile_default_flow(settings)
        by_name = {s.name: s for s in flow.all_stages}
        assert by_name["plan_review"].enabled is False
        assert by_name["learn"].enabled is False
        assert by_name["learn"].post is True
        for name in ("preflight", "plan", "coordinate", "implement", "test", "review", "pr"):
            assert by_name[name].enabled is True
            assert by_name[name].post is False

    def test_default_flow_respects_stages_enabled_override(self, tmp_path):
        settings = _write_settings(
            tmp_path,
            {"stages": {"plan_review": {"enabled": True}, "test": {"enabled": False}}},
        )
        flow = compile_default_flow(settings)
        names = [s.name for s in flow.stages]
        assert "plan_review" in names
        assert "test" not in names
        assert names == [s.value for s in get_enabled_stages(settings)]

    def test_default_flow_respects_stages_agent_override(self, tmp_path):
        settings = _write_settings(
            tmp_path, {"stages": {"plan": {"agent": "custom_planner"}}}
        )
        flow = compile_default_flow(settings)
        by_name = {s.name: s for s in flow.all_stages}
        assert by_name["plan"].agent == "custom_planner"

    def test_default_flow_drops_transition_to_disabled_target(self, tmp_path):
        """Mirrors the runner's 'IMPLEMENT not in stage_order' guards: the
        default flow degrades silently when a builtin target is disabled."""
        settings = _write_settings(
            tmp_path, {"stages": {"implement": {"enabled": False}}}
        )
        flow = compile_default_flow(settings)
        by_name = {s.name: s for s in flow.stages}
        assert "test_failure" not in by_name["test"].on
        assert "review_changes" not in by_name["review"].on
        # plan stays enabled, so restart_planning survives
        assert "restart_planning" in by_name["review"].on

    def test_learn_enabled_appears_in_post_stages(self, tmp_path):
        settings = _write_settings(
            tmp_path, {"stages": {"learn": {"enabled": True}}}
        )
        flow = compile_default_flow(settings)
        assert [s.name for s in flow.post_stages] == ["learn"]
        assert "learn" not in [s.name for s in flow.stages]


# --- next_index / index_of ---

class TestNextIndex:
    def _flow(self, tmp_path):
        settings = _write_settings(tmp_path, {})
        return compile_default_flow(settings)

    def test_next_index_linear_advance(self, tmp_path):
        flow = self._flow(tmp_path)
        # preflight -> plan (plan_review disabled by default -> plan is idx 1)
        assert flow.next_index("preflight", None) == flow.index_of("plan")
        assert flow.next_index("plan", None) == flow.index_of("coordinate")

    def test_next_index_at_end_returns_none(self, tmp_path):
        flow = self._flow(tmp_path)
        assert flow.next_index("pr", None) is None

    def test_next_index_loop_target(self, tmp_path):
        flow = self._flow(tmp_path)
        assert flow.next_index("test", "test_failure") == flow.index_of("implement")
        assert flow.next_index("review", "review_changes") == flow.index_of("implement")
        assert flow.next_index("review", "restart_planning") == flow.index_of("plan")
        assert flow.next_index("implement", "next_bead") == flow.index_of("implement")

    def test_next_index_unknown_trigger_advances(self, tmp_path):
        flow = self._flow(tmp_path)
        assert flow.next_index("test", "no_such_trigger") == flow.index_of("review")

    def test_transition_for_declared_trigger(self, tmp_path):
        flow = self._flow(tmp_path)
        tr = flow.transition_for("test", "test_failure")
        assert tr == Transition(goto="implement", loop="implement_test")

    def test_transition_for_missing_trigger_returns_none(self, tmp_path):
        flow = self._flow(tmp_path)
        assert flow.transition_for("plan", "test_failure") is None

    def test_transition_for_dropped_when_target_disabled(self, tmp_path):
        settings = _write_settings(
            tmp_path, {"stages": {"implement": {"enabled": False}}}
        )
        flow = compile_default_flow(settings)
        assert flow.transition_for("test", "test_failure") is None

    def test_next_index_unknown_stage_raises(self, tmp_path):
        flow = self._flow(tmp_path)
        with pytest.raises(FlowError):
            flow.next_index("bogus", None)

    def test_index_of_unknown_raises(self, tmp_path):
        flow = self._flow(tmp_path)
        with pytest.raises(FlowError):
            flow.index_of("bogus")


# --- load_flow: custom flows + validation ---

def _custom_flow_doc(**overrides):
    doc = {
        "version": 1,
        "stages": [
            {"name": "preflight"},
            {"name": "plan", "agent": "planner", "schema": "plan.json"},
            {"name": "implement", "agent": "implementer",
             "schema": "implement.json"},
            {"name": "test", "agent": "tester", "schema": "test_result.json",
             "on": {"test_failure": {"goto": "implement", "loop": "implement_test"}}},
            {"name": "pr", "agent": "guardian", "schema": "pr.json"},
        ],
    }
    doc.update(overrides)
    return doc


class TestLoadFlow:
    def test_load_flow_without_config_returns_default(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        settings = _write_settings(tmp_path, {})
        flow = load_flow(settings)
        assert [s.name for s in flow.stages] == [s.value for s in get_enabled_stages(settings)]
        assert flow.custom is False

    def test_load_flow_custom_sets_custom_flag(self, tmp_path, monkeypatch):
        _install_runtime(tmp_path)
        monkeypatch.chdir(tmp_path)
        settings = _write_settings(tmp_path, {"flow": _custom_flow_doc()})
        assert load_flow(settings).custom is True

    def test_load_flow_custom(self, tmp_path, monkeypatch):
        _install_runtime(tmp_path)
        monkeypatch.chdir(tmp_path)
        settings = _write_settings(tmp_path, {"flow": _custom_flow_doc()})
        flow = load_flow(settings)
        assert [s.name for s in flow.stages] == ["preflight", "plan", "implement", "test", "pr"]
        by_name = {s.name: s for s in flow.stages}
        assert by_name["test"].on["test_failure"] == Transition(goto="implement", loop="implement_test")

    def test_load_flow_custom_defaults_builtin_fields(self, tmp_path, monkeypatch):
        """Omitted agent/schema/prompt_block fall back to builtin maps."""
        _install_runtime(tmp_path)
        monkeypatch.chdir(tmp_path)
        doc = {"version": 1, "stages": [
            {"name": "preflight"}, {"name": "plan"}, {"name": "pr"},
        ]}
        settings = _write_settings(tmp_path, {"flow": doc})
        flow = load_flow(settings)
        by_name = {s.name: s for s in flow.stages}
        assert by_name["plan"].agent == "planner"
        assert by_name["plan"].schema == "plan.json"
        assert by_name["plan"].prompt_block == "plan"
        assert by_name["preflight"].agent is None

    def test_load_flow_custom_respects_stages_enabled(self, tmp_path, monkeypatch):
        """worca.stages.<name>.enabled merges into custom flows too."""
        _install_runtime(tmp_path)
        monkeypatch.chdir(tmp_path)
        doc = _custom_flow_doc()
        # remove the on-entry so disabling implement doesn't invalidate goto
        doc["stages"][3] = {"name": "test", "agent": "tester", "schema": "test_result.json"}
        settings = _write_settings(
            tmp_path, {"flow": doc, "stages": {"test": {"enabled": False}}}
        )
        flow = load_flow(settings)
        assert "test" not in [s.name for s in flow.stages]

    def test_flow_explicit_enabled_wins_over_stages_config(self, tmp_path, monkeypatch):
        _install_runtime(tmp_path)
        monkeypatch.chdir(tmp_path)
        doc = _custom_flow_doc()
        doc["stages"][4]["enabled"] = True
        settings = _write_settings(
            tmp_path, {"flow": doc, "stages": {"pr": {"enabled": False}}}
        )
        flow = load_flow(settings)
        assert "pr" in [s.name for s in flow.stages]


class TestFlowValidation:
    def _load(self, tmp_path, monkeypatch, doc, worca_extra=None):
        _install_runtime(tmp_path)
        monkeypatch.chdir(tmp_path)
        worca = {"flow": doc}
        if worca_extra:
            worca.update(worca_extra)
        settings = _write_settings(tmp_path, worca)
        return load_flow(settings)

    def test_flow_rejects_bad_version(self, tmp_path, monkeypatch):
        with pytest.raises(FlowError, match="version"):
            self._load(tmp_path, monkeypatch, _custom_flow_doc(version=2))

    def test_flow_rejects_duplicate_names(self, tmp_path, monkeypatch):
        doc = _custom_flow_doc()
        doc["stages"].append({"name": "plan"})
        with pytest.raises(FlowError, match="[Dd]uplicate"):
            self._load(tmp_path, monkeypatch, doc)

    def test_flow_rejects_unknown_goto(self, tmp_path, monkeypatch):
        doc = _custom_flow_doc()
        doc["stages"][3]["on"]["test_failure"]["goto"] = "nonexistent"
        with pytest.raises(FlowError, match="nonexistent"):
            self._load(tmp_path, monkeypatch, doc)

    def test_flow_rejects_goto_disabled_stage(self, tmp_path, monkeypatch):
        doc = _custom_flow_doc()
        doc["stages"][2]["enabled"] = False
        with pytest.raises(FlowError, match="disabled"):
            self._load(tmp_path, monkeypatch, doc)

    def test_flow_rejects_unbounded_backward_goto(self, tmp_path, monkeypatch):
        doc = _custom_flow_doc()
        doc["stages"][3]["on"]["test_failure"] = {"goto": "implement"}  # no loop key
        with pytest.raises(FlowError, match="loop"):
            self._load(tmp_path, monkeypatch, doc)

    def test_flow_rejects_reserved_loop_key(self, tmp_path, monkeypatch):
        doc = _custom_flow_doc()
        doc["stages"][3]["on"]["test_failure"]["loop"] = "test_iteration"
        with pytest.raises(FlowError, match="reserved"):
            self._load(tmp_path, monkeypatch, doc)

    def test_flow_rejects_missing_schema_file(self, tmp_path, monkeypatch):
        doc = _custom_flow_doc()
        doc["stages"][1]["schema"] = "no_such_schema.json"
        with pytest.raises(FlowError, match="no_such_schema.json"):
            self._load(tmp_path, monkeypatch, doc)

    def test_flow_rejects_missing_agent_file(self, tmp_path, monkeypatch):
        doc = _custom_flow_doc()
        doc["stages"][1]["agent"] = "no_such_agent"
        with pytest.raises(FlowError, match="no_such_agent"):
            self._load(tmp_path, monkeypatch, doc)

    def test_flow_rejects_unknown_stage_field(self, tmp_path, monkeypatch):
        doc = _custom_flow_doc()
        doc["stages"][1]["promt_block"] = "plan"  # typo'd key must fail loudly
        with pytest.raises(FlowError, match="promt_block"):
            self._load(tmp_path, monkeypatch, doc)

    def test_flow_rejects_missing_name(self, tmp_path, monkeypatch):
        doc = _custom_flow_doc()
        doc["stages"][1].pop("name")
        with pytest.raises(FlowError, match="name"):
            self._load(tmp_path, monkeypatch, doc)

    def test_flow_rejects_empty_stages(self, tmp_path, monkeypatch):
        with pytest.raises(FlowError, match="stages"):
            self._load(tmp_path, monkeypatch, {"version": 1, "stages": []})

    # --- custom stages (W-071) ---

    def _install_custom_stage_files(self, tmp_path, agent="docs_auditor",
                                    schema="docs_audit.json", schema_doc=None):
        agents_dir = tmp_path / ".claude" / "agents"
        agents_dir.mkdir(parents=True, exist_ok=True)
        (agents_dir / f"{agent}.md").write_text(f"# {agent}")
        schemas_dir = tmp_path / ".claude" / "schemas"
        schemas_dir.mkdir(parents=True, exist_ok=True)
        if schema_doc is None:
            schema_doc = {"properties": {"outcome": {
                "type": "string", "enum": ["success", "needs_rework", "reject"],
            }}}
        (schemas_dir / schema).write_text(json.dumps(schema_doc))

    def _doc_with_custom_stage(self, **entry_overrides):
        doc = _custom_flow_doc()
        entry = {
            "name": "docs_audit",
            "agent": "docs_auditor",
            "schema": "docs_audit.json",
            "on": {"needs_rework": {"goto": "implement", "loop": "docs_rework"}},
        }
        entry.update(entry_overrides)
        doc["stages"].insert(4, entry)  # between test and pr
        return doc

    def test_flow_accepts_custom_stage(self, tmp_path, monkeypatch):
        """W-071: a custom stage with project-tier agent + schema validates."""
        self._install_custom_stage_files(tmp_path)
        flow = self._load(tmp_path, monkeypatch, self._doc_with_custom_stage())
        by_name = {s.name: s for s in flow.stages}
        assert by_name["docs_audit"].agent == "docs_auditor"
        assert by_name["docs_audit"].schema == "docs_audit.json"
        # custom stages default their prompt_block to the stage name
        assert by_name["docs_audit"].prompt_block == "docs_audit"

    def test_flow_rejects_custom_stage_missing_agent_everywhere(self, tmp_path, monkeypatch):
        self._install_custom_stage_files(tmp_path)
        (tmp_path / ".claude" / "agents" / "docs_auditor.md").unlink()
        with pytest.raises(FlowError, match="docs_auditor"):
            self._load(tmp_path, monkeypatch, self._doc_with_custom_stage())

    def test_flow_rejects_custom_stage_missing_schema_everywhere(self, tmp_path, monkeypatch):
        self._install_custom_stage_files(tmp_path)
        (tmp_path / ".claude" / "schemas" / "docs_audit.json").unlink()
        with pytest.raises(FlowError, match="docs_audit.json"):
            self._load(tmp_path, monkeypatch, self._doc_with_custom_stage())

    def test_flow_rejects_undeclared_custom_outcome(self, tmp_path, monkeypatch):
        """on: triggers must appear in the custom schema's outcome enum."""
        self._install_custom_stage_files(tmp_path, schema_doc={
            "properties": {"outcome": {"type": "string",
                                       "enum": ["success", "reject"]}},
        })
        with pytest.raises(FlowError, match="needs_rework"):
            self._load(tmp_path, monkeypatch, self._doc_with_custom_stage())

    def test_flow_rejects_custom_outcomes_without_enum(self, tmp_path, monkeypatch):
        """A custom stage with on: transitions needs an outcome enum at all."""
        self._install_custom_stage_files(tmp_path, schema_doc={
            "properties": {"summary": {"type": "string"}},
        })
        with pytest.raises(FlowError, match="outcome"):
            self._load(tmp_path, monkeypatch, self._doc_with_custom_stage())

    def test_flow_accepts_custom_stage_without_transitions_or_enum(self, tmp_path, monkeypatch):
        """No on: map → no enum requirement."""
        self._install_custom_stage_files(tmp_path, schema_doc={
            "properties": {"summary": {"type": "string"}},
        })
        flow = self._load(tmp_path, monkeypatch,
                          self._doc_with_custom_stage(on={}))
        assert "docs_audit" in [s.name for s in flow.stages]

    def test_flow_rejects_custom_post_stage(self, tmp_path, monkeypatch):
        """Custom post stages are out of W-071 scope (learn path is bespoke)."""
        self._install_custom_stage_files(tmp_path)
        with pytest.raises(FlowError, match="post"):
            self._load(tmp_path, monkeypatch,
                       self._doc_with_custom_stage(on={}, post=True))

    def test_flow_rejects_invalid_custom_stage_name(self, tmp_path, monkeypatch):
        """Hyphenated / non-identifier custom names break the {stage}-{agent}
        resolved-prompt convention and the agent-role extraction."""
        self._install_custom_stage_files(tmp_path)
        with pytest.raises(FlowError, match="docs-audit"):
            self._load(tmp_path, monkeypatch,
                       self._doc_with_custom_stage(name="docs-audit", on={}))

    def test_flow_rejects_invalid_custom_agent_name(self, tmp_path, monkeypatch):
        self._install_custom_stage_files(tmp_path, agent="docs-auditor")
        with pytest.raises(FlowError, match="docs-auditor"):
            self._load(tmp_path, monkeypatch,
                       self._doc_with_custom_stage(agent="docs-auditor", on={}))

    def test_flow_rejects_goto_post_stage(self, tmp_path, monkeypatch):
        doc = _custom_flow_doc()
        doc["stages"].append({"name": "learn", "agent": "learner",
                              "schema": "learn.json", "post": True, "enabled": True})
        doc["stages"][3]["on"]["test_failure"] = {"goto": "learn", "loop": "x"}
        with pytest.raises(FlowError, match="post"):
            self._load(tmp_path, monkeypatch, doc)


# --- loop limits ---

class TestLoopLimit:
    def test_loop_limit_from_settings(self, tmp_path):
        settings = _write_settings(tmp_path, {"loops": {"implement_test": 7}})
        assert resolve_loop_limit("implement_test", settings) == 7

    def test_loop_limit_default(self, tmp_path):
        settings = _write_settings(tmp_path, {})
        assert resolve_loop_limit("implement_test", settings) == 5

    def test_loop_limit_mloops_multiplier(self, tmp_path):
        settings = _write_settings(tmp_path, {"loops": {"pr_changes": 3}})
        assert resolve_loop_limit("pr_changes", settings, mloops=2) == 6

    def test_loop_limit_runtime_provided(self, tmp_path):
        """bead_iteration's cap is dynamic (depends on created bead count) —
        supplied at runtime, never from worca.loops."""
        settings = _write_settings(tmp_path, {"loops": {"bead_iteration": 99}})
        limit = resolve_loop_limit(
            "bead_iteration", settings, runtime_limits={"bead_iteration": 12}
        )
        assert limit == 12


# --- fingerprint ---

class TestFingerprint:
    def test_fingerprint_stable(self, tmp_path):
        settings = _write_settings(tmp_path, {})
        f1 = compile_default_flow(settings).fingerprint()
        f2 = compile_default_flow(settings).fingerprint()
        assert f1 == f2
        assert len(f1) == 64  # sha256 hex

    def test_fingerprint_changes_on_topology_change(self, tmp_path):
        s1 = _write_settings(tmp_path, {})
        base = compile_default_flow(s1).fingerprint()
        s2 = tmp_path / "settings2.json"
        s2.write_text(json.dumps(
            {"worca": {"stages": {"plan_review": {"enabled": True}}}}
        ))
        changed = compile_default_flow(str(s2)).fingerprint()
        assert base != changed

    def test_fingerprint_ignores_loop_limits(self, tmp_path):
        """Limits are tuning, not topology — a paused run must resume after a
        worca.loops tweak."""
        s1 = _write_settings(tmp_path, {})
        base = compile_default_flow(s1).fingerprint()
        s2 = tmp_path / "settings2.json"
        s2.write_text(json.dumps({"worca": {"loops": {"implement_test": 9}}}))
        assert compile_default_flow(str(s2)).fingerprint() == base
