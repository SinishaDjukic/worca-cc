"""Tests for PromptBuilder context persistence (save_context / load_context)."""

import json
import os

import pytest

from worca.orchestrator.context_keys import CONTEXT_ALIASES
from worca.orchestrator.prompt_builder import (
    PROMPT_CONTEXT_SCHEMA_VERSION,
    PromptBuilder,
)


# ---------------------------------------------------------------------------
# save_context tests
# ---------------------------------------------------------------------------

def test_save_context_creates_file(tmp_path):
    """save_context writes prompt_context.json to the given path."""
    ctx_path = str(tmp_path / "prompt_context.json")
    pb = PromptBuilder("title", "desc")
    pb.update_context("plan_approach", "Use JWT")
    pb.save_context(ctx_path)
    assert os.path.exists(ctx_path)


def test_save_context_writes_expected_fields(tmp_path):
    """save_context persists standard and custom context keys."""
    ctx_path = str(tmp_path / "prompt_context.json")
    pb = PromptBuilder("title", "desc")
    pb.update_context("plan_approach", "Use JWT")
    pb.update_context("coordinate_output", {"beads": 3})
    pb.update_context("test_failures", [{"test_name": "t1", "error": "boom"}])
    pb.update_context("assigned_bead_id", "bd-abc")
    pb.update_context("my_custom_key", "custom_value")
    pb.save_context(ctx_path)

    with open(ctx_path) as f:
        data = json.load(f)

    assert data["plan_approach"] == "Use JWT"
    assert data["coordinate_output"] == {"beads": 3}
    assert data["test_failures"] == [{"test_name": "t1", "error": "boom"}]
    assert data["assigned_bead_id"] == "bd-abc"
    assert data["my_custom_key"] == "custom_value"


def test_save_context_uses_instance_path(tmp_path):
    """When context_path is set on init, save_context() uses it without args."""
    ctx_path = str(tmp_path / "prompt_context.json")
    pb = PromptBuilder("title", "desc", context_path=ctx_path)
    pb.update_context("plan_approach", "approach")
    pb.save_context()
    assert os.path.exists(ctx_path)


def test_save_context_no_path_is_noop():
    """save_context with no path and no instance path does nothing."""
    pb = PromptBuilder("title", "desc")
    pb.update_context("plan_approach", "x")
    # Should not raise
    pb.save_context()


def test_save_context_creates_parent_directories(tmp_path):
    """save_context creates parent directories as needed."""
    ctx_path = str(tmp_path / "runs" / "run-123" / "prompt_context.json")
    pb = PromptBuilder("title", "desc")
    pb.update_context("plan_approach", "x")
    pb.save_context(ctx_path)
    assert os.path.exists(ctx_path)


def test_save_context_uses_atomic_write(tmp_path):
    """save_context uses temp file + rename (no partial writes visible)."""
    ctx_path = str(tmp_path / "prompt_context.json")
    pb = PromptBuilder("title", "desc")
    pb.update_context("plan_approach", "atomic")
    pb.save_context(ctx_path)
    # Atomic write: no temp file should remain
    tmp_files = [f for f in os.listdir(tmp_path) if f.startswith(".tmp_")]
    assert len(tmp_files) == 0
    # File must be valid JSON
    with open(ctx_path) as f:
        data = json.load(f)
    assert data["plan_approach"] == "atomic"


def test_save_context_overwrites_previous(tmp_path):
    """Repeated save_context calls overwrite the previous file."""
    ctx_path = str(tmp_path / "prompt_context.json")
    pb = PromptBuilder("title", "desc")
    pb.update_context("plan_approach", "first")
    pb.save_context(ctx_path)
    pb.update_context("plan_approach", "second")
    pb.save_context(ctx_path)

    with open(ctx_path) as f:
        data = json.load(f)
    assert data["plan_approach"] == "second"


# ---------------------------------------------------------------------------
# load_context tests
# ---------------------------------------------------------------------------

def test_load_context_populates_context(tmp_path):
    """load_context reads the file and merges into self._context."""
    ctx_path = str(tmp_path / "prompt_context.json")
    data = {
        "plan_approach": "JWT",
        "assigned_bead_id": "bd-xyz",
        "test_failures": [{"test_name": "t", "error": "e"}],
    }
    with open(ctx_path, "w") as f:
        json.dump(data, f)

    pb = PromptBuilder("title", "desc")
    pb.load_context(ctx_path)

    assert pb.get_context("plan_approach") == "JWT"
    assert pb.get_context("assigned_bead_id") == "bd-xyz"
    assert pb.get_context("test_failures") == [{"test_name": "t", "error": "e"}]


def test_load_context_missing_file_is_noop(tmp_path):
    """load_context on a missing file does not raise and leaves context empty."""
    pb = PromptBuilder("title", "desc")
    pb.load_context(str(tmp_path / "nonexistent.json"))
    assert pb.get_context("plan_approach") is None


def test_load_context_uses_instance_path(tmp_path):
    """load_context() with no args uses the instance context_path."""
    ctx_path = str(tmp_path / "prompt_context.json")
    with open(ctx_path, "w") as f:
        json.dump({"plan_approach": "from-file"}, f)

    pb = PromptBuilder("title", "desc", context_path=ctx_path)
    pb.load_context()
    assert pb.get_context("plan_approach") == "from-file"


def test_load_context_no_path_is_noop():
    """load_context with no path and no instance path does nothing."""
    pb = PromptBuilder("title", "desc")
    pb.load_context()
    assert pb.get_context("plan_approach") is None


def test_load_context_merges_with_existing_context(tmp_path):
    """load_context merges loaded keys into existing context without wiping it."""
    ctx_path = str(tmp_path / "prompt_context.json")
    with open(ctx_path, "w") as f:
        json.dump({"plan_approach": "loaded"}, f)

    pb = PromptBuilder("title", "desc")
    pb.update_context("assigned_bead_id", "bd-existing")
    pb.load_context(ctx_path)

    assert pb.get_context("plan_approach") == "loaded"
    assert pb.get_context("assigned_bead_id") == "bd-existing"


def test_load_context_overrides_existing_key(tmp_path):
    """Loaded values override existing context keys with the same name."""
    ctx_path = str(tmp_path / "prompt_context.json")
    with open(ctx_path, "w") as f:
        json.dump({"plan_approach": "from-file"}, f)

    pb = PromptBuilder("title", "desc")
    pb.update_context("plan_approach", "in-memory")
    pb.load_context(ctx_path)

    assert pb.get_context("plan_approach") == "from-file"


def test_save_load_round_trip(tmp_path):
    """save_context then load_context recovers the same context."""
    ctx_path = str(tmp_path / "prompt_context.json")
    pb = PromptBuilder("title", "desc")
    pb.update_context("plan_approach", "approach")
    pb.update_context("coordinate_output", {"n": 5})
    pb.update_context("assigned_bead_id", "bd-001")
    pb.update_context("test_failures", [{"test_name": "t", "error": "e"}])
    pb.update_context("my_key", "my_val")
    pb.save_context(ctx_path)

    pb2 = PromptBuilder("title", "desc")
    pb2.load_context(ctx_path)

    assert pb2.get_context("plan_approach") == "approach"
    assert pb2.get_context("coordinate_output") == {"n": 5}
    assert pb2.get_context("assigned_bead_id") == "bd-001"
    assert pb2.get_context("test_failures") == [{"test_name": "t", "error": "e"}]
    assert pb2.get_context("my_key") == "my_val"


# ---------------------------------------------------------------------------
# 100KB cap with oldest-entry truncation
# ---------------------------------------------------------------------------

def test_save_context_caps_at_100kb(tmp_path):
    """save_context truncates oldest entries when context exceeds 100KB."""
    ctx_path = str(tmp_path / "prompt_context.json")
    pb = PromptBuilder("title", "desc")

    # Insert entries in order: "key_0", "key_1", ..., "key_N" — large values
    large_value = "x" * 10_000  # 10KB each
    for i in range(20):
        pb.update_context(f"key_{i}", large_value)  # ~200KB total

    pb.save_context(ctx_path)

    file_size = os.path.getsize(ctx_path)
    assert file_size <= 100_000, f"File too large: {file_size} bytes"

    with open(ctx_path) as f:
        data = json.load(f)

    # Should be valid JSON with some keys retained
    assert len(data) > 0


def test_save_context_truncation_keeps_newest_entries(tmp_path):
    """When truncating for 100KB cap, oldest entries are removed first."""
    ctx_path = str(tmp_path / "prompt_context.json")
    pb = PromptBuilder("title", "desc")

    large_value = "x" * 10_000
    for i in range(20):
        pb.update_context(f"key_{i}", large_value)

    pb.save_context(ctx_path)

    with open(ctx_path) as f:
        data = json.load(f)

    keys = list(data.keys())
    # Newest keys (highest indices) should be present
    assert "key_19" in data, "Newest key should survive truncation"
    # Oldest keys should have been dropped (not all of them necessarily)
    if len(keys) < 20:
        assert "key_0" not in data, "Oldest key should be dropped first"


def test_save_context_no_truncation_when_under_100kb(tmp_path):
    """When context is under 100KB, no keys are dropped."""
    ctx_path = str(tmp_path / "prompt_context.json")
    pb = PromptBuilder("title", "desc")
    pb.update_context("plan_approach", "small")
    pb.update_context("assigned_bead_id", "bd-001")
    pb.save_context(ctx_path)

    with open(ctx_path) as f:
        data = json.load(f)

    assert "plan_approach" in data
    assert "assigned_bead_id" in data


def test_load_context_corrupt_json_raises(tmp_path):
    """A corrupt prompt_context.json must fail the resume loudly, not silently
    continue with missing inter-stage context (arch review 2026-06)."""
    ctx_path = str(tmp_path / "prompt_context.json")
    with open(ctx_path, "w") as f:
        f.write("{broken json!")

    pb = PromptBuilder("title", "desc")
    with pytest.raises(ValueError, match="prompt_context"):
        pb.load_context(ctx_path)


def test_load_context_missing_file_still_noop(tmp_path):
    """Missing file remains a silent no-op — only *corrupt* files are fatal."""
    pb = PromptBuilder("title", "desc")
    pb.load_context(str(tmp_path / "does_not_exist.json"))  # must not raise


# ---------------------------------------------------------------------------
# Namespaced context: schema_version 2, publish_output, aliases (W-072)
# ---------------------------------------------------------------------------

def test_save_context_writes_schema_version(tmp_path):
    """save_context stamps the current format version into the file."""
    ctx_path = str(tmp_path / "prompt_context.json")
    pb = PromptBuilder("title", "desc")
    pb.update_context("plan_approach", "x")
    pb.save_context(ctx_path)

    with open(ctx_path) as f:
        data = json.load(f)
    assert data["schema_version"] == PROMPT_CONTEXT_SCHEMA_VERSION


def test_schema_version_survives_truncation(tmp_path):
    """The schema_version marker is never dropped by the 100KB cap."""
    ctx_path = str(tmp_path / "prompt_context.json")
    pb = PromptBuilder("title", "desc")
    for i in range(20):
        pb.update_context(f"key_{i}", "x" * 10_000)
    pb.save_context(ctx_path)

    with open(ctx_path) as f:
        data = json.load(f)
    assert data["schema_version"] == PROMPT_CONTEXT_SCHEMA_VERSION


def test_load_context_does_not_leak_schema_version(tmp_path):
    """schema_version is file metadata, never a context key."""
    ctx_path = str(tmp_path / "prompt_context.json")
    pb = PromptBuilder("title", "desc")
    pb.update_context("k", "v")
    pb.save_context(ctx_path)

    pb2 = PromptBuilder("title", "desc")
    pb2.load_context(ctx_path)
    assert pb2.get_context("schema_version") is None
    assert pb2.get_context("k") == "v"


def test_publish_output_namespaced_round_trip(tmp_path):
    """publish_output writes stages.<stage>.<name>; persists and reloads."""
    ctx_path = str(tmp_path / "prompt_context.json")
    pb = PromptBuilder("title", "desc")
    pb.publish_output("plan", "approach", "Use JWT")
    assert pb.get_context("stages.plan.approach") == "Use JWT"
    pb.save_context(ctx_path)

    with open(ctx_path) as f:
        data = json.load(f)
    assert data["stages"]["plan"]["approach"] == "Use JWT"

    pb2 = PromptBuilder("title", "desc")
    pb2.load_context(ctx_path)
    assert pb2.get_context("stages.plan.approach") == "Use JWT"


def test_alias_dual_write_from_publish_output(monkeypatch):
    """publish_output dual-writes the legacy flat key during migration."""
    monkeypatch.setitem(CONTEXT_ALIASES, "plan_approach", "stages.plan.approach")
    pb = PromptBuilder("title", "desc")
    pb.publish_output("plan", "approach", "Use JWT")
    assert pb._context["plan_approach"] == "Use JWT"
    assert pb._context["stages"]["plan"]["approach"] == "Use JWT"


def test_alias_dual_write_from_update_context(monkeypatch):
    """update_context on an aliased flat key also writes the namespaced form."""
    monkeypatch.setitem(CONTEXT_ALIASES, "plan_approach", "stages.plan.approach")
    pb = PromptBuilder("title", "desc")
    pb.update_context("plan_approach", "Use JWT")
    assert pb._context["stages"]["plan"]["approach"] == "Use JWT"
    assert pb.get_context("stages.plan.approach") == "Use JWT"


def test_alias_read_through_both_directions(monkeypatch):
    monkeypatch.setitem(CONTEXT_ALIASES, "plan_approach", "stages.plan.approach")
    pb = PromptBuilder("title", "desc")
    # namespaced-only data, flat read
    pb._context["stages"] = {"plan": {"approach": "ns-only"}}
    assert pb.get_context("plan_approach") == "ns-only"
    # flat-only data, namespaced read (v1 file shape)
    pb2 = PromptBuilder("title", "desc")
    pb2._context["plan_approach"] = "flat-only"
    assert pb2.get_context("stages.plan.approach") == "flat-only"


def test_pop_context_removes_both_forms(monkeypatch):
    monkeypatch.setitem(CONTEXT_ALIASES, "plan_approach", "stages.plan.approach")
    pb = PromptBuilder("title", "desc")
    pb.publish_output("plan", "approach", "x")
    assert pb.pop_context("plan_approach") == "x"
    assert pb.get_context("plan_approach") is None
    assert pb.get_context("stages.plan.approach") is None


def test_prompt_context_v1_loads_via_aliases(tmp_path, monkeypatch):
    """A version-1 file (flat keys, no marker) resumes cleanly: namespaced
    reads of its data resolve through the alias table (W-072 §4)."""
    monkeypatch.setitem(CONTEXT_ALIASES, "plan_approach", "stages.plan.approach")
    ctx_path = str(tmp_path / "prompt_context.json")
    with open(ctx_path, "w") as f:
        json.dump({"plan_approach": "v1 approach", "assigned_bead_id": "bd-1"}, f)

    pb = PromptBuilder("title", "desc")
    pb.load_context(ctx_path)
    assert pb.get_context("plan_approach") == "v1 approach"
    assert pb.get_context("stages.plan.approach") == "v1 approach"


def test_build_context_carries_namespaced_values():
    """build_context exposes the nested stages dict for {{dotted}} rendering."""
    pb = PromptBuilder("title", "desc")
    pb.publish_output("plan", "approach", "nested")
    ctx = pb.build_context("test")
    assert ctx["stages"]["plan"]["approach"] == "nested"


def test_load_context_after_resume_affects_context(tmp_path):
    """After loading context, build_context() uses recovered values."""
    ctx_path = str(tmp_path / "prompt_context.json")
    with open(ctx_path, "w") as f:
        json.dump({
            "plan_approach": "Recovered approach",
            "assigned_bead_id": "bd-resumed",
            "assigned_bead_title": "Resumed Task",
            "assigned_bead_description": "Do the thing again",
        }, f)

    pb = PromptBuilder("title", "desc")
    pb.load_context(ctx_path)

    ctx = pb.build_context("implement")
    assert "bd-resumed" in ctx.get("assigned_task", "")
    assert "Resumed Task" in ctx.get("assigned_task", "")
