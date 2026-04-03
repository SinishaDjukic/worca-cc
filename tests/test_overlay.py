"""Tests for OverlayResolver — replace-by-default behavior.

Override resolution:
- No tag or <!-- replace -->: replace the base prompt entirely
- <!-- append -->: merge sections into base using section merge
"""

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
# Replace-by-default behavior
# ---------------------------------------------------------------------------

def test_resolve_no_overlay_file(tmp_path):
    """No overlay file => core returned unchanged."""
    resolver = OverlayResolver(overrides_dir=str(tmp_path))
    core = "## Rules\n\n- Rule one.\n"
    result = resolver.resolve("implementer", core)
    assert result == core


def test_resolve_replace_by_default(tmp_path):
    """Override file with no tag replaces base entirely."""
    overlay = tmp_path / "implementer.md"
    overlay.write_text("# Custom Implementer\n\n## Rules\n\n- Custom rule.\n")
    resolver = OverlayResolver(overrides_dir=str(tmp_path))
    core = "## Rules\n\n- Original rule.\n"
    result = resolver.resolve("implementer", core)
    assert "Custom rule" in result
    assert "Original rule" not in result


def test_resolve_explicit_replace_tag(tmp_path):
    """<!-- replace --> tag has same effect as default (replace)."""
    overlay = tmp_path / "implementer.md"
    overlay.write_text("<!-- replace -->\n# Custom Implementer\n\n## Rules\n\n- Custom rule.\n")
    resolver = OverlayResolver(overrides_dir=str(tmp_path))
    core = "## Rules\n\n- Original rule.\n"
    result = resolver.resolve("implementer", core)
    assert "Custom rule" in result
    assert "Original rule" not in result
    assert "<!-- replace -->" not in result


def test_resolve_append_mode(tmp_path):
    """<!-- append --> triggers section merge into base."""
    overlay = tmp_path / "implementer.md"
    overlay.write_text("<!-- append -->\n## Override: Rules\n\n- Appended rule.\n")
    resolver = OverlayResolver(overrides_dir=str(tmp_path))
    core = "## Rules\n\n- Original rule.\n"
    result = resolver.resolve("implementer", core)
    assert "Original rule" in result
    assert "Appended rule" in result
    assert result.index("Original rule") < result.index("Appended rule")


def test_resolve_append_replace_section(tmp_path):
    """Append mode with <!-- replace --> on a section replaces that section."""
    overlay = tmp_path / "implementer.md"
    overlay.write_text(
        "<!-- append -->\n## Override: Rules\n<!-- replace -->\n\n- Replacement rule.\n"
    )
    resolver = OverlayResolver(overrides_dir=str(tmp_path))
    core = "## Rules\n\n- Original rule.\n"
    result = resolver.resolve("implementer", core)
    assert "Replacement rule" in result
    assert "Original rule" not in result
    assert "<!-- replace -->" not in result


def test_resolve_append_governance_protected(tmp_path, capsys):
    """Append mode: replace on governance-protected section demotes to append."""
    overlay = tmp_path / "implementer.md"
    overlay.write_text(
        "<!-- append -->\n## Override: Rules\n<!-- replace -->\n\n- Attacker rule.\n"
    )
    resolver = OverlayResolver(overrides_dir=str(tmp_path))
    core = "## Rules\n\n<!-- governance -->\n- Original rule.\n"
    result = resolver.resolve("implementer", core)
    assert "Original rule" in result
    assert "Attacker rule" in result
    captured = capsys.readouterr()
    assert "governance" in captured.err.lower() or "demot" in captured.err.lower()


def test_resolve_append_no_matching_section(tmp_path):
    """Append mode: unmatched section appended at end."""
    overlay = tmp_path / "implementer.md"
    overlay.write_text("<!-- append -->\n## Override: NonExistent\n\n- New content.\n")
    resolver = OverlayResolver(overrides_dir=str(tmp_path))
    core = "## Rules\n\n- Rule one.\n"
    result = resolver.resolve("implementer", core)
    assert "Rule one" in result
    assert "New content" in result
    assert "## NonExistent" in result


def test_resolve_append_multiple_overrides(tmp_path):
    """Append mode with multiple Override sections."""
    overlay = tmp_path / "implementer.md"
    overlay.write_text(
        "<!-- append -->\n"
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
    overlay.write_text("Custom content.\n")
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


def test_resolve_append_case_insensitive_match(tmp_path):
    """Append mode: case-insensitive heading matching."""
    overlay = tmp_path / "implementer.md"
    overlay.write_text("<!-- append -->\n## Override: rules\n\n- Lowercase override.\n")
    resolver = OverlayResolver(overrides_dir=str(tmp_path))
    core = "## Rules\n\n- Original rule.\n"
    result = resolver.resolve("implementer", core)
    assert "Original rule" in result
    assert "Lowercase override" in result


def test_resolve_append_no_override_blocks(tmp_path):
    """Append mode with no ## Override: blocks — raw append."""
    overlay = tmp_path / "implementer.md"
    overlay.write_text("<!-- append -->\n\n## Extra Context\n\nSome extra context.\n")
    resolver = OverlayResolver(overrides_dir=str(tmp_path))
    core = "## Rules\n\n- Original rule.\n"
    result = resolver.resolve("implementer", core)
    assert "Original rule" in result
    assert "Extra Context" in result


# ---------------------------------------------------------------------------
# Default overrides dir is .claude/agents (not .claude/agents/overrides)
# ---------------------------------------------------------------------------

def test_default_overrides_dir():
    resolver = OverlayResolver()
    assert resolver.overrides_dir == ".claude/agents"


# ---------------------------------------------------------------------------
# Governance tag presence in core agent prompt files
# ---------------------------------------------------------------------------

import pathlib  # noqa: E402
import re  # noqa: E402

_CORE_AGENTS_DIR = pathlib.Path(__file__).parent.parent / "src" / "worca" / "agents" / "core"

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
    first_non_blank = next(
        (line for line in body.splitlines() if line.strip()), ""
    )
    assert first_non_blank.strip() == "<!-- governance -->", (
        f"{agent}.md ## Rules section does not start with <!-- governance -->, "
        f"got: {first_non_blank!r}"
    )


# ---------------------------------------------------------------------------
# Overlay file parsing — self-contained fixtures
# ---------------------------------------------------------------------------

_SAMPLE_OVERLAY = """\
# Implementer Overlay

## Override: Rules

- Use TypeScript for all new source files.
- Test file names must follow the pattern `*.test.ts`.
- Commit messages must follow Conventional Commits (e.g. `feat:`, `fix:`).
"""


def test_overlay_file_has_override_block():
    assert "## Override:" in _SAMPLE_OVERLAY


def test_overlay_file_uses_append_mode():
    overrides = _parse_overrides(_SAMPLE_OVERLAY)
    rules_override = next((o for o in overrides if o["section_name"].lower() == "rules"), None)
    assert rules_override is not None, "No '## Override: Rules' block found"
    assert rules_override["replace"] is False


def test_overlay_file_content_parsed():
    overrides = _parse_overrides(_SAMPLE_OVERLAY)
    assert len(overrides) == 1
    body = overrides[0]["body"]
    assert "TypeScript" in body
    assert "test" in body.lower()
    assert "Conventional Commits" in body


# ---------------------------------------------------------------------------
# Package export
# ---------------------------------------------------------------------------

def test_overlay_resolver_exported_from_package():
    from worca.orchestrator import OverlayResolver as _OR
    assert _OR is OverlayResolver
