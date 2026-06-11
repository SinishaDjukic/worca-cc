"""W-071 — user-defined custom stage integration tests.

Drives the runner end-to-end (mock claude) with a ``docs_audit`` custom stage
inserted between review and pr. The stage's agent ``.md`` and schema ``.json``
live in the project tiers (``.claude/agents/`` / ``.claude/schemas/``); its
``needs_rework`` outcome loops back to implement per the flow's ``on:`` map.
Also covers resume-mid-custom-stage and launch-time validation failures.
"""
import json

import pytest

from tests.integration.helpers import (
    assert_stage_sequence,
    make_iteration_scenario,
    run_and_act,
    send_sigkill,
)

pytestmark = pytest.mark.timeout(180)


_CUSTOM_STAGE_FLOW = {
    "version": 1,
    "stages": [
        {"name": "plan"},
        {"name": "coordinate"},
        {
            "name": "implement",
            "on": {"next_bead": {"goto": "implement", "loop": "bead_iteration"}},
        },
        {
            "name": "test",
            "on": {"test_failure": {"goto": "implement", "loop": "implement_test"}},
        },
        {
            "name": "review",
            "on": {"review_changes": {"goto": "implement", "loop": "pr_changes"}},
        },
        {
            "name": "docs_audit",
            "agent": "docs_auditor",
            "schema": "docs_audit.json",
            "on": {"needs_rework": {"goto": "implement", "loop": "docs_rework"}},
        },
        {"name": "pr"},
    ],
}

_DOCS_AUDIT_SCHEMA = {
    "type": "object",
    "properties": {
        "outcome": {
            "type": "string",
            "enum": ["success", "needs_rework", "reject"],
        },
        "summary": {"type": "string"},
    },
    "required": ["outcome"],
}


def _install_custom_stage(pipeline_env, flow_doc=_CUSTOM_STAGE_FLOW,
                          schema=_DOCS_AUDIT_SCHEMA, with_block=True):
    """Drop the custom agent/schema files and wire worca.flow."""
    project = pipeline_env.project

    agents_dir = project / ".claude" / "agents"
    agents_dir.mkdir(parents=True, exist_ok=True)
    (agents_dir / "docs_auditor.md").write_text(
        "# Docs Auditor\n\nYou audit the documentation for {{title}}.\n",
        encoding="utf-8",
    )
    if with_block:
        (agents_dir / "docs_audit.block.md").write_text(
            "Audit the docs for this change.\n\nPlan: {{plan_file}}\n",
            encoding="utf-8",
        )

    schemas_dir = project / ".claude" / "schemas"
    schemas_dir.mkdir(parents=True, exist_ok=True)
    (schemas_dir / "docs_audit.json").write_text(
        json.dumps(schema, indent=2), encoding="utf-8",
    )

    settings_path = project / ".claude" / "settings.json"
    settings = json.loads(settings_path.read_text())
    settings["worca"]["flow"] = flow_doc
    settings_path.write_text(json.dumps(settings, indent=2))


def _scenario(docs_audit_iters):
    return make_iteration_scenario({
        "docs_auditor": docs_audit_iters,
    })


class TestCustomStageEndToEnd:

    def test_custom_stage_runs_and_completes(self, pipeline_env):
        """docs_audit executes between review and pr; success advances."""
        _install_custom_stage(pipeline_env)
        result = pipeline_env.run(
            _scenario({
                "default": {
                    "action": "succeed", "delay_s": 0.05,
                    "structured_output": {"outcome": "success", "summary": "docs ok"},
                },
            }),
            prompt="custom stage run",
            timeout=120,
        )
        assert result.returncode == 0, f"stderr: {result.stderr[-800:]}"
        assert result.status["pipeline_status"] == "completed"

        assert_stage_sequence(result.events, [
            "plan", "coordinate", "implement", "test", "review", "docs_audit", "pr",
        ])

        # Custom stage key lands in status.json verbatim with full bookkeeping.
        audit = result.status["stages"]["docs_audit"]
        assert audit["status"] == "completed"
        assert audit["agent"] == "docs_auditor"
        iters = audit["iterations"]
        assert [it["outcome"] for it in iters] == ["success"]
        assert iters[0]["output"]["summary"] == "docs ok"

    def test_custom_outcome_loops_back_to_implement(self, pipeline_env):
        """needs_rework jumps to implement per the flow's on: map, then the
        second audit pass succeeds and the run completes."""
        _install_custom_stage(pipeline_env)
        result = pipeline_env.run(
            _scenario({
                "iter_1": {
                    "action": "succeed", "delay_s": 0.05,
                    "structured_output": {"outcome": "needs_rework",
                                          "summary": "examples missing"},
                },
                "iter_2": {
                    "action": "succeed", "delay_s": 0.05,
                    "structured_output": {"outcome": "success", "summary": "fixed"},
                },
            }),
            prompt="custom loopback run",
            timeout=120,
        )
        assert result.returncode == 0, f"stderr: {result.stderr[-800:]}"
        assert result.status["pipeline_status"] == "completed"

        # Declared loop key consumed exactly once.
        assert result.status["loop_counters"].get("docs_rework") == 1

        # docs_audit ran twice (needs_rework → success); implement re-entered.
        audit_iters = result.status["stages"]["docs_audit"]["iterations"]
        assert [it["outcome"] for it in audit_iters] == ["needs_rework", "success"]
        impl_iters = result.status["stages"]["implement"]["iterations"]
        assert len(impl_iters) >= 2, (
            f"needs_rework should re-enter implement; got {len(impl_iters)} iteration(s)"
        )
        # The loopback iteration carries the custom outcome as its trigger.
        assert impl_iters[-1]["trigger"] == "needs_rework"

    def test_custom_stage_reject_fails_run(self, pipeline_env):
        """An undeclared 'reject' outcome takes the existing failure path."""
        _install_custom_stage(pipeline_env)
        result = pipeline_env.run(
            _scenario({
                "default": {
                    "action": "succeed", "delay_s": 0.05,
                    "structured_output": {"outcome": "reject",
                                          "summary": "docs unacceptable"},
                },
            }),
            prompt="custom reject run",
            timeout=120,
        )
        assert result.returncode != 0
        assert result.status["pipeline_status"] == "failed"
        # PR never ran — the rejection stopped the pipeline at docs_audit.
        pr_data = result.status["stages"].get("pr", {})
        assert pr_data.get("status") != "completed"

    def test_custom_block_reaches_prompt(self, pipeline_env):
        """The project-tier .block.md is routed into the custom stage prompt."""
        _install_custom_stage(pipeline_env)
        result = pipeline_env.run(
            _scenario({
                "default": {
                    "action": "succeed", "delay_s": 0.05,
                    "structured_output": {"outcome": "success"},
                },
            }),
            prompt="custom block run",
            timeout=120,
        )
        assert result.returncode == 0, f"stderr: {result.stderr[-800:]}"
        prompt = result.status["stages"]["docs_audit"].get("prompt", "")
        assert "Audit the docs for this change." in prompt


class TestCustomStageValidation:

    def test_missing_agent_file_fails_at_launch(self, pipeline_env):
        """A flow naming a custom stage with no agent .md anywhere fails loud."""
        _install_custom_stage(pipeline_env)
        (pipeline_env.project / ".claude" / "agents" / "docs_auditor.md").unlink()
        result = pipeline_env.run(
            _scenario({"default": {"action": "succeed", "delay_s": 0.05,
                                   "structured_output": {"outcome": "success"}}}),
            prompt="missing agent run",
            timeout=120,
        )
        assert result.returncode != 0
        assert "agent" in result.stderr.lower()

    def test_undeclared_custom_outcome_rejected_at_launch(self, pipeline_env):
        """on: triggers missing from the schema's outcome enum fail at launch."""
        schema_without_needs_rework = {
            "type": "object",
            "properties": {
                "outcome": {"type": "string", "enum": ["success", "reject"]},
            },
            "required": ["outcome"],
        }
        _install_custom_stage(pipeline_env, schema=schema_without_needs_rework)
        result = pipeline_env.run(
            _scenario({"default": {"action": "succeed", "delay_s": 0.05,
                                   "structured_output": {"outcome": "success"}}}),
            prompt="undeclared outcome run",
            timeout=120,
        )
        assert result.returncode != 0
        assert "needs_rework" in result.stderr


class TestCustomStageResume:

    def test_resume_mid_custom_stage(self, pipeline_env):
        """A run crashed while docs_audit is in progress resumes and completes it.

        The auditor hangs; the pipeline is SIGKILLed mid-docs_audit (uncatchable,
        so pipeline_status stays non-terminal — the same contract as
        test_resume_e2e; a SIGTERM would record terminal 'interrupted', which
        --resume rejects by design). The resumed run's find_resume_point must
        treat the incomplete custom stage as resumable work.
        """
        _install_custom_stage(pipeline_env)
        hang_scenario = {
            "agents": {"docs_auditor": {"action": "hang"}},
            "default": {"action": "succeed", "delay_s": 0.05},
        }
        crashed = run_and_act(
            pipeline_env, hang_scenario,
            action_fn=send_sigkill,
            act_after_stage="docs_audit",
            timeout=30,
        )
        assert crashed.status["pipeline_status"] != "completed"
        assert crashed.status["stages"]["docs_audit"]["status"] != "completed"

        resume_scenario = _scenario({
            "default": {
                "action": "succeed", "delay_s": 0.05,
                "structured_output": {"outcome": "success", "summary": "after resume"},
            },
        })
        result = pipeline_env.run(
            resume_scenario,
            extra_args=["--resume"], timeout=120,
        )
        assert result.returncode == 0, f"stderr: {result.stderr[-800:]}"
        assert result.status["pipeline_status"] == "completed"
        audit = result.status["stages"]["docs_audit"]
        assert audit["status"] == "completed"
