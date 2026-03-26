"""Tests for OverlayResolver — TDD: written before implementation."""

import pytest

from worca.orchestrator.overlay import (
    OverlayResolver,
    _parse_sections,
    _parse_overrides,
    _heading_matches,
)


# ---------------------------------------------------------------------------
# Section parsing
# ---------------------------------------------------------------------------

def test_parse_sections_preamble_only():
    content = "This is just preamble text\nwith no headings.\n"
    sections = _parse_sections(content)
    assert len(sections) == 1
    assert sections[0]["heading"] is None
    assert "preamble text" in sections[0]["body"]
    assert sections[0]["governance"] is False


def test_parse_sections_multiple():
    content = "Preamble line.\n\n## Alpha\n\nAlpha body.\n\n## Beta\n\nBeta body.\n"
    sections = _parse_sections(content)
    assert len(sections) == 3
    assert sections[0]["heading"] is None
    assert sections[1]["heading"] == "Alpha"
    assert "Alpha body" in sections[1]["body"]
    assert sections[2]["heading"] == "Beta"
    assert "Beta body" in sections[2]["body"]


def test_parse_sections_governance_tag():
    content = "## Rules\n\n<!-- governance -->\n- Do not do bad things.\n"
    sections = _parse_sections(content)
    assert len(sections) == 1
    assert sections[0]["heading"] == "Rules"
    assert sections[0]["governance"] is True


def test_parse_sections_no_governance():
    content = "## Rules\n\n- Do some things.\n"
    sections = _parse_sections(content)
    assert len(sections) == 1
    assert sections[0]["governance"] is False


# ---------------------------------------------------------------------------
# Override parsing
# ---------------------------------------------------------------------------

def test_parse_overrides_append_mode():
    content = "## Override: Rules\n\n- Extra rule.\n"
    overrides = _parse_overrides(content)
    assert len(overrides) == 1
    assert overrides[0]["section_name"] == "Rules"
    assert overrides[0]["replace"] is False
    assert "Extra rule" in overrides[0]["body"]


def test_parse_overrides_replace_mode():
    content = "## Override: Process\n<!-- replace -->\n\nNew process body.\n"
    overrides = _parse_overrides(content)
    assert len(overrides) == 1
    assert overrides[0]["section_name"] == "Process"
    assert overrides[0]["replace"] is True
    assert "<!-- replace -->" not in overrides[0]["body"]
    assert "New process body" in overrides[0]["body"]


def test_parse_overrides_no_blocks():
    content = "Just some text\n\n## NotAnOverride\n\nSome content.\n"
    overrides = _parse_overrides(content)
    assert overrides == []


# ---------------------------------------------------------------------------
# Heading matching
# ---------------------------------------------------------------------------

def test_heading_matches_exact():
    assert _heading_matches("Rules", "Rules") is True


def test_heading_matches_case_insensitive():
    assert _heading_matches("Rules", "rules") is True


def test_heading_matches_whitespace():
    assert _heading_matches("Rules", "  Rules  ") is True


def test_heading_no_match():
    assert _heading_matches("Rules", "Context") is False


# ---------------------------------------------------------------------------
# Merge logic via resolve()
# ---------------------------------------------------------------------------

def test_resolve_no_overlay_file(tmp_path):
    resolver = OverlayResolver(overrides_dir=str(tmp_path))
    core = "## Rules\n\n- Rule one.\n"
    result = resolver.resolve("implementer", core)
    assert result == core


def test_resolve_append(tmp_path):
    overlay = tmp_path / "implementer.md"
    overlay.write_text("## Override: Rules\n\n- Appended rule.\n")
    resolver = OverlayResolver(overrides_dir=str(tmp_path))
    core = "## Rules\n\n- Original rule.\n"
    result = resolver.resolve("implementer", core)
    assert "Original rule" in result
    assert "Appended rule" in result
    # Appended content comes after original
    assert result.index("Original rule") < result.index("Appended rule")


def test_resolve_replace(tmp_path):
    overlay = tmp_path / "implementer.md"
    overlay.write_text("## Override: Rules\n<!-- replace -->\n\n- Replacement rule.\n")
    resolver = OverlayResolver(overrides_dir=str(tmp_path))
    core = "## Rules\n\n- Original rule.\n"
    result = resolver.resolve("implementer", core)
    assert "Replacement rule" in result
    assert "Original rule" not in result
    assert "<!-- replace -->" not in result


def test_resolve_governance_replace_demoted(tmp_path, capsys):
    overlay = tmp_path / "implementer.md"
    overlay.write_text("## Override: Rules\n<!-- replace -->\n\n- Attacker rule.\n")
    resolver = OverlayResolver(overrides_dir=str(tmp_path))
    core = "## Rules\n\n<!-- governance -->\n- Original rule.\n"
    result = resolver.resolve("implementer", core)
    # Should be append, not replace
    assert "Original rule" in result
    assert "Attacker rule" in result
    # Warning printed to stderr
    captured = capsys.readouterr()
    assert "governance" in captured.err.lower() or "demot" in captured.err.lower()


def test_resolve_no_matching_section(tmp_path):
    overlay = tmp_path / "implementer.md"
    overlay.write_text("## Override: NonExistent\n\n- New content.\n")
    resolver = OverlayResolver(overrides_dir=str(tmp_path))
    core = "## Rules\n\n- Rule one.\n"
    result = resolver.resolve("implementer", core)
    assert "Rule one" in result
    assert "New content" in result
    assert "## NonExistent" in result


def test_resolve_multiple_overrides(tmp_path):
    overlay = tmp_path / "implementer.md"
    overlay.write_text(
        "## Override: Alpha\n\n- Alpha extra.\n\n## Override: Beta\n\n- Beta extra.\n"
    )
    resolver = OverlayResolver(overrides_dir=str(tmp_path))
    core = "## Alpha\n\n- Alpha original.\n\n## Beta\n\n- Beta original.\n"
    result = resolver.resolve("implementer", core)
    assert "Alpha original" in result
    assert "Alpha extra" in result
    assert "Beta original" in result
    assert "Beta extra" in result


def test_resolve_unreadable_overlay(tmp_path, capsys):
    overlay = tmp_path / "implementer.md"
    overlay.write_text("## Override: Rules\n\n- Something.\n")
    overlay.chmod(0o000)
    resolver = OverlayResolver(overrides_dir=str(tmp_path))
    core = "## Rules\n\n- Original rule.\n"
    try:
        result = resolver.resolve("implementer", core)
        assert result == core
        captured = capsys.readouterr()
        assert captured.err != ""
    finally:
        overlay.chmod(0o644)


def test_resolve_case_insensitive_match(tmp_path):
    overlay = tmp_path / "implementer.md"
    overlay.write_text("## Override: rules\n\n- Lowercase override.\n")
    resolver = OverlayResolver(overrides_dir=str(tmp_path))
    core = "## Rules\n\n- Original rule.\n"
    result = resolver.resolve("implementer", core)
    assert "Original rule" in result
    assert "Lowercase override" in result


# ---------------------------------------------------------------------------
# Governance tag presence in core agent prompt files (Task 2)
# ---------------------------------------------------------------------------

import pathlib  # noqa: E402
import re  # noqa: E402

_CORE_AGENTS_DIR = pathlib.Path(__file__).parent.parent / ".claude" / "agents" / "core"

GOVERNANCE_AGENTS = [
    "implementer",
    "coordinator",
    "tester",
    "planner",
    "guardian",
]


def _rules_section_body(agent_name: str) -> str:
    """Return the body of the ## Rules section from a core agent .md file."""
    content = (_CORE_AGENTS_DIR / f"{agent_name}.md").read_text()
    # Split on ## headings; find Rules section
    parts = re.split(r"^(## .+)$", content, flags=re.MULTILINE)
    for i, part in enumerate(parts):
        if re.match(r"^## Rules\s*$", part):
            return parts[i + 1] if i + 1 < len(parts) else ""
    return ""


@pytest.mark.parametrize("agent", GOVERNANCE_AGENTS)
def test_governance_tag_in_rules_section(agent):
    """Each core agent Rules section must start with <!-- governance -->."""
    body = _rules_section_body(agent)
    assert body, f"{agent}.md has no ## Rules section"
    # First non-blank line of body must be <!-- governance -->
    first_non_blank = next(
        (line for line in body.splitlines() if line.strip()), ""
    )
    assert first_non_blank.strip() == "<!-- governance -->", (
        f"{agent}.md ## Rules section does not start with <!-- governance -->, "
        f"got: {first_non_blank!r}"
    )


# ---------------------------------------------------------------------------
# Overlay file parsing (Task 5) — self-contained fixtures
# ---------------------------------------------------------------------------

_SAMPLE_OVERLAY = """\
# Implementer Overlay

## Override: Rules

- Use TypeScript for all new source files.
- Test file names must follow the pattern `*.test.ts`.
- Commit messages must follow Conventional Commits (e.g. `feat:`, `fix:`).
"""


def test_overlay_file_has_override_block():
    """An overlay file must contain at least one ## Override: block."""
    assert "## Override:" in _SAMPLE_OVERLAY


def test_overlay_file_uses_append_mode():
    """An overlay Rules section without <!-- replace --> uses append mode."""
    overrides = _parse_overrides(_SAMPLE_OVERLAY)
    rules_override = next((o for o in overrides if o["section_name"].lower() == "rules"), None)
    assert rules_override is not None, "No '## Override: Rules' block found"
    assert rules_override["replace"] is False, "Rules override should use append mode (no <!-- replace -->)"


def test_overlay_file_content_parsed():
    """Overlay content is correctly extracted from the body."""
    overrides = _parse_overrides(_SAMPLE_OVERLAY)
    assert len(overrides) == 1
    body = overrides[0]["body"]
    assert "TypeScript" in body
    assert "test" in body.lower()
    assert "Conventional Commits" in body


# ---------------------------------------------------------------------------
# Package export (Task 7)
# ---------------------------------------------------------------------------

def test_overlay_resolver_exported_from_package():
    """OverlayResolver must be importable directly from worca.orchestrator package."""
    from worca.orchestrator import OverlayResolver as _OR
    assert _OR is OverlayResolver
