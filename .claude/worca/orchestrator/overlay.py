"""OverlayResolver: merge per-project agent prompt overlays into rendered core prompts."""

import os
import re
import sys
from pathlib import Path


def _parse_sections(content: str) -> list:
    """Split content into sections at ## headings.

    Returns a list of dicts:
      { "heading": str | None, "body": str, "governance": bool }

    heading is None for the preamble before the first ## heading.
    governance is True if "<!-- governance -->" appears anywhere in body.
    """
    parts = re.split(r"^(## .+)$", content, flags=re.MULTILINE)
    # parts[0] is preamble text (may be empty)
    # then alternating: heading_line, body_text, heading_line, body_text, ...
    sections = []

    preamble_body = parts[0]
    if preamble_body.strip():
        sections.append({
            "heading": None,
            "body": preamble_body,
            "governance": "<!-- governance -->" in preamble_body,
        })

    i = 1
    while i < len(parts) - 1:
        heading_line = parts[i]          # e.g. "## Rules"
        body = parts[i + 1]
        heading = heading_line[3:].strip()  # strip "## " prefix
        sections.append({
            "heading": heading,
            "body": body,
            "governance": "<!-- governance -->" in body,
        })
        i += 2

    return sections


def _parse_overrides(content: str) -> list:
    """Split overlay content into override blocks.

    Returns a list of dicts:
      { "section_name": str, "body": str, "replace": bool }

    replace is True if the first non-blank line of body is "<!-- replace -->".
    The <!-- replace --> line is stripped from body before returning.
    """
    parts = re.split(r"^(## Override:\s*.+)$", content, flags=re.MULTILINE)
    overrides = []

    # parts[0] is text before the first ## Override: (ignored)
    i = 1
    while i < len(parts) - 1:
        heading_line = parts[i]   # e.g. "## Override: Rules"
        body = parts[i + 1]
        section_name = re.sub(r"^##\s*Override:\s*", "", heading_line).strip()

        # Determine replace mode: first non-blank line is "<!-- replace -->"
        replace = False
        lines = body.split("\n")
        new_lines = []
        found_replace = False
        for line in lines:
            if not found_replace and line.strip() == "<!-- replace -->":
                replace = True
                found_replace = True
                continue  # strip this line
            new_lines.append(line)
        body = "\n".join(new_lines)

        overrides.append({
            "section_name": section_name,
            "body": body,
            "replace": replace,
        })
        i += 2

    return overrides


def _heading_matches(core_heading: str, override_name: str) -> bool:
    """Case-insensitive, whitespace-trimmed heading comparison."""
    return core_heading.strip().lower() == override_name.strip().lower()


def _reassemble(sections: list) -> str:
    """Rebuild a Markdown document from a list of section dicts."""
    parts = []
    for section in sections:
        if section["heading"] is None:
            parts.append(section["body"])
        else:
            parts.append(f"## {section['heading']}{section['body']}")
    return "".join(parts)


class OverlayResolver:
    def __init__(self, overrides_dir: str = ".claude/agents/overrides"):
        self.overrides_dir = overrides_dir

    def resolve(self, agent_name: str, rendered_core: str) -> str:
        """Merge overlay for agent_name into rendered_core.

        Returns the merged prompt string. If no overlay file exists for
        agent_name, returns rendered_core unchanged.
        """
        overlay_path = os.path.join(self.overrides_dir, f"{agent_name}.md")

        if not os.path.exists(overlay_path):
            return rendered_core

        try:
            with open(overlay_path) as f:
                overlay_content = f.read()
        except (OSError, PermissionError) as exc:
            print(
                f"[overlay] Warning: cannot read overlay '{overlay_path}': {exc}",
                file=sys.stderr,
            )
            return rendered_core

        overrides = _parse_overrides(overlay_content)
        if not overrides:
            print(
                f"[overlay] Warning: overlay '{overlay_path}' has no ## Override: blocks; skipping.",
                file=sys.stderr,
            )
            return rendered_core

        sections = _parse_sections(rendered_core)

        for override in overrides:
            matched = False
            for section in sections:
                if section["heading"] is not None and _heading_matches(
                    section["heading"], override["section_name"]
                ):
                    matched = True
                    if override["replace"] and section["governance"]:
                        print(
                            f"[overlay] Warning: overlay for '{override['section_name']}' in "
                            f"'{agent_name}.md' requests replace but section is "
                            f"governance-protected; demoting to append.",
                            file=sys.stderr,
                        )
                        # Demote to append
                        _apply_append(section, override["body"])
                    elif override["replace"]:
                        # Replace: keep heading, swap body
                        # Preserve leading newline of original body if present
                        orig_body = section["body"]
                        leading = orig_body[: len(orig_body) - len(orig_body.lstrip("\n"))]
                        section["body"] = leading + override["body"]
                    else:
                        _apply_append(section, override["body"])
                    break

            if not matched:
                # Append as a new section at the end
                new_body = f"\n\n{override['body']}"
                sections.append({
                    "heading": override["section_name"],
                    "body": new_body,
                    "governance": False,
                })

        return _reassemble(sections)


def _apply_append(section: dict, override_body: str) -> None:
    """Append override_body to section['body'], ensuring a blank-line separator."""
    body = section["body"]
    # Ensure the section body ends with a newline before appending
    if not body.endswith("\n"):
        body += "\n"
    # Add blank line separator then override body
    section["body"] = body + "\n" + override_body
