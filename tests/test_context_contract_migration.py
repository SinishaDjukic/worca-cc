"""Render parity for the W-072 builtin template migration.

Each converted stage's consumer templates must render byte-identically
regardless of which form the producer's value arrived in:

- the new pipeline path (``publish_output`` -> nested ``stages.*`` + flat
  dual-write),
- a legacy flat-only context (a resume from a schema-version-1
  ``prompt_context.json``),
- a nested-only context (the post-deprecation shape, after flat
  publication is dropped).
"""

from pathlib import Path

from worca.orchestrator.overlay import (
    OverlayResolver,
    resolve_blocks,
    resolve_placeholders,
)
from worca.orchestrator.prompt_builder import PromptBuilder

_CORE = str(Path(__file__).resolve().parents[1] / "src" / "worca" / "agents" / "core")


def _render_block(name: str, ctx: dict) -> str:
    resolver = OverlayResolver(overrides_dir="/nonexistent-overrides")
    block = resolver.resolve_block(name, _CORE, None)
    assert block, f"core block {name!r} must exist"
    block = resolve_blocks(block, ctx, resolver, _CORE, None)
    return resolve_placeholders(block, ctx).strip()


# ---------------------------------------------------------------------------
# plan stage conversion: pr.block.md consumes {{stages.plan.approach}}
# ---------------------------------------------------------------------------

def _pr_ctx(pb: PromptBuilder) -> dict:
    return pb.build_context("pr")


def test_pr_block_renders_published_plan_approach():
    """The new pipeline path: declared output published post-validation."""
    pb = PromptBuilder("t", "d")
    pb.publish_output("plan", "approach", "JWT with refresh tokens")
    out = _render_block("pr", _pr_ctx(pb))
    assert "## Approach" in out
    assert "JWT with refresh tokens" in out


def test_pr_block_parity_flat_nested_dual():
    """Flat-only (v1 resume), nested-only (post-deprecation), and dual-write
    contexts must render the pr block byte-identically."""
    pb_dual = PromptBuilder("t", "d")
    pb_dual.publish_output("plan", "approach", "JWT approach")

    pb_flat = PromptBuilder("t", "d")
    pb_flat._context["plan_approach"] = "JWT approach"  # v1 file shape

    pb_nested = PromptBuilder("t", "d")
    pb_nested._context["stages"] = {"plan": {"approach": "JWT approach"}}

    renders = {
        form: _render_block("pr", _pr_ctx(pb))
        for form, pb in (
            ("dual", pb_dual), ("flat", pb_flat), ("nested", pb_nested),
        )
    }
    assert renders["dual"] == renders["flat"] == renders["nested"]
    assert "JWT approach" in renders["dual"]


def test_pr_block_omits_approach_section_when_absent():
    pb = PromptBuilder("t", "d")
    out = _render_block("pr", _pr_ctx(pb))
    assert "## Approach" not in out


# ---------------------------------------------------------------------------
# plan_review conversion: plan.block.md gates revision mode on
# {{#if stages.plan_review.revision_mode}}
# ---------------------------------------------------------------------------

def test_plan_block_revision_mode_parity():
    """The revision branch activates identically whether the flag arrives
    via update_context dual-write, a flat-only v1 context, or nested-only."""
    def render(pb):
        pb.update_context("plan_file_content", "# The plan")
        return _render_block("plan", pb.build_context("plan"))

    pb_dual = PromptBuilder("t", "d")
    pb_dual.update_context("plan_revision_mode", True)

    pb_flat = PromptBuilder("t", "d")
    pb_flat._context["plan_revision_mode"] = True  # v1 file shape

    pb_nested = PromptBuilder("t", "d")
    pb_nested._context["stages"] = {"plan_review": {"revision_mode": True}}

    renders = [render(pb) for pb in (pb_dual, pb_flat, pb_nested)]
    assert renders[0] == renders[1] == renders[2]
    assert "# The plan" in renders[0]


def test_plan_block_initial_mode_skips_revision_branch():
    pb = PromptBuilder("t", "d")
    out = _render_block("plan", pb.build_context("plan"))
    assert "revising an existing plan" not in out.lower()
