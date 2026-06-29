"""Source-prompt content tests for the coordinator agent.

These tests verify that the coordinator.md prompt contains the required
role-scope guard sections and CLI reference documentation.
"""
from __future__ import annotations

import pathlib
import re

from worca.orchestrator.overlay import resolve_placeholders


COORDINATOR_PATH = (
    pathlib.Path(__file__).parent.parent
    / "src"
    / "worca"
    / "agents"
    / "core"
    / "coordinator.md"
)


class TestCoordinatorRoleBoundaries:
    """Acceptance: coordinator.md must forbid probed commands and provide CLI reference."""

    def test_banned_commands_listed_in_prompt(self):
        """coordinator.md must list the wasted-turn commands in the guard section."""
        source = COORDINATOR_PATH.read_text()
        for cmd in ("which bd", "bd --help", "bd create --help", "bd dep --help",
                    "bd list --help", "bd status", "bd list --all", "ls .beads/"):
            assert cmd in source, f"coordinator.md must forbid {cmd}"

    def test_bd_reference_section_exists(self):
        """coordinator.md must have a ## bd CLI Reference section."""
        source = COORDINATOR_PATH.read_text()
        assert "## bd CLI Reference" in source

    def test_silent_flag_in_create_command(self):
        """coordinator.md must include --silent in the bd create invocation."""
        source = COORDINATOR_PATH.read_text()
        patterns = [
            r"bd create.*--silent",
            r"bd create.*--title.*--type.*--labels.*--silent",
        ]
        assert any(re.search(p, source) for p in patterns), "bd create must include --silent"

    def test_description_flag_documented(self):
        """coordinator.md must populate --description on bd create from the plan
        slice, so beads carry a body (read by the implementer via `bd show`),
        not a title only. Includes inline shell-safety guidance."""
        source = COORDINATOR_PATH.read_text()
        assert re.search(r"bd create.*--description", source), \
            "bd create template must include --description"
        assert "`--description`" in source, "must explain the --description param"
        assert "source of truth" in source.lower() or "authority order" in source.lower(), \
            "must frame the description as subordinate to the plan"
        assert "sanitize" in source.lower(), "must include inline shell-safety guidance"

    def test_bead_merging_rules_present(self):
        """coordinator.md must include bead-merging / test-ownership rules."""
        source = COORDINATOR_PATH.read_text()
        assert "share a correctness invariant" in source.lower()
        assert "Tester stage owns" in source or "Test stage owns" in source

    def test_bd_create_invocations_use_silent_in_rendered_output(self):
        """Rendered coordinator must include --silent in the bd create example."""
        template = COORDINATOR_PATH.read_text()
        ctx = {"plan_file": "plan.md", "run_id": "test-run"}
        rendered = resolve_placeholders(template, ctx)
        assert "--silent" in rendered
